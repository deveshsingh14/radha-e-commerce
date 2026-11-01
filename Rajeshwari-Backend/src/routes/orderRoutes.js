const express = require("express");

const prisma = require("../config/db");
const logger = require("../config/logger");

const authMiddleware = require("../middleware/authMiddleware");
const adminOrOwnerMiddleware = require("../middleware/adminOrOwnerMiddleware");
const deliveryMiddleware = require("../middleware/deliveryMiddleware");
const { bulkUpdateProductStock } = require("../utils/stock");
const push = require("../utils/push");
const { z } = require("zod");
const { validateBody } = require("../middleware/validate");
const { ORDER_STATUSES, DELIVERY_QUEUE, PARTNER_TRANSITIONS, UNASSIGN_ON } = require("../utils/orderStatus");

const router = express.Router();

// ---- PLACE ORDER (checkout) ----
// CHANGED: the whole checkout now runs inside ONE transaction that:
//   1. re-reads the cart,
//   2. verifies stock for every line (rejects with a clear message if not),
//   3. decrements stock,
//   4. creates the order (+ payment method),
//   5. clears the cart.
// If any step fails, nothing is committed — no oversell, no ghost orders.
router.post("/checkout", authMiddleware, async (req, res) => {

  try {

    const {
      fullName,
      phone,
      address,
      city,
      state,
      pincode,
      paymentMethod
    } = req.body;

    if (!fullName || !phone || !address || !city || !state || !pincode) {
      return res.status(400).json({
        message: "All delivery details are required"
      });
    }

    // Remember these delivery details on the user profile regardless of
    // what happens below, so a restricted customer's address isn't lost
    // and next checkout still pre-fills. Best-effort, fire-and-forget.
    prisma.user.update({
      where: { id: req.user.id },
      data: { phone, address, city, state, pincode }
    }).catch(() => {});

    // Delivery-area restriction: browsing, cart and saving the address
    // above are never blocked — this only blocks placing the order.
    // When the pincode's city/state are known, they are authoritative: an
    // address can't claim a different city for an allowed pincode.
    let deliverCity = city;
    let deliverState = state;
    const restriction = await prisma.pincodeRestriction.findUnique({ where: { id: 1 } });
    if (restriction && restriction.enabled) {
      const serviceable = await prisma.serviceablePincode.findUnique({
        where: { pincode: String(pincode).trim() }
      });
      if (!serviceable) {
        return res.status(403).json({
          message: "We don't deliver to this pincode yet. Your address has been saved — we'll notify you as we expand."
        });
      }
      if (serviceable.city && serviceable.state) {
        deliverCity = serviceable.city;
        deliverState = serviceable.state;
      }
    }

    // CHANGED: online UPI prepay is temporarily disabled (the QR shown
    // at checkout was never wired to a real UPI id, so it never
    // actually collected payment) — force COD regardless of what's
    // sent, so a direct API call can't bypass the UI's disabled
    // option either. Re-enable by restoring
    // `paymentMethod === "UPI" ? "UPI" : "COD"` once a real UPI id or
    // payment gateway is wired up.
    const method = "COD";

    const order = await prisma.$transaction(async (tx) => {

      const cartItems = await tx.cart.findMany({
        where: { userId: req.user.id },
        include: { product: true }
      });

      if (cartItems.length === 0) {
        throw { code: "EMPTY_CART" };
      }

      // stock check for every line, with a useful error
      for (const item of cartItems) {
        if (item.product.stock < item.quantity) {
          throw {
            code: "OUT_OF_STOCK",
            title: item.product.title,
            available: item.product.stock
          };
        }
      }

      // decrement stock (optimized to avoid N+1)
      await bulkUpdateProductStock(tx, cartItems, 'decrement');

      const totalAmount = cartItems.reduce((acc, item) => acc + item.product.price * item.quantity, 0);

      // email snapshot (password-login tokens don't carry it)
      const buyer = await tx.user.findUnique({ where: { id: req.user.id }, select: { email: true } });

      const created = await tx.order.create({
        data: {
          totalAmount,
          userId: req.user.id,
          customerEmail: buyer ? buyer.email : null,
          fullName,
          phone,
          address,
          city: deliverCity,
          state: deliverState,
          pincode,
          paymentMethod: method,
          paymentStatus: "Pending",
          orderItems: {
            create: cartItems.map(item => ({
              quantity: item.quantity,
              price: item.product.price,
              productId: item.product.id,
              // snapshot: the order keeps its line even if the product is
              // later renamed or deleted
              title: item.product.title,
              image: item.product.image
            }))
          }
        },
        include: { orderItems: { include: { product: true } } }
      });

      await tx.cart.deleteMany({
        where: { userId: req.user.id }
      });

      return created;
    });

    res.json({
      message: "Order placed successfully",
      order
    });

    // After commit + response: never delays or fails the checkout.
    push.notifyAdmins(push.newOrderForShop(order));
    push.notifyUser(req.user.id, push.orderPlacedForCustomer(order));

  } catch (error) {

    if (error && error.code === "EMPTY_CART") {
      return res.status(400).json({ message: "Cart is empty" });
    }
    if (error && error.code === "OUT_OF_STOCK") {
      return res.status(409).json({
        message: `"${error.title}" only has ${error.available} left in stock. Please adjust your bag.`
      });
    }

    logger.error(error);

    res.status(500).json({
      message: "Checkout failed"
    });

  }

});

// ---- GET MY ORDERS (logged-in user) ----
router.get("/", authMiddleware, async (req, res) => {

  try {

    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: {
        orderItems: { include: { product: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(orders);

  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: "Failed to fetch orders" });
  }

});

// ---- DELIVERY PARTNER: WORK QUEUE ----
// Partners see orders ready to pick up (Shipped, unassigned), their own
// Out for Delivery / Attempted orders, and any Out for Delivery / Attempted
// order that has lost its partner (e.g. partner account removed).
// Admin/owner see the whole delivery queue.
router.get("/delivery", authMiddleware, deliveryMiddleware, async (req, res) => {
  try {
    const isStaff = req.user.role === "ADMIN" || req.user.role === "OWNER";
    const where = isStaff
      ? { status: { in: DELIVERY_QUEUE } }
      : {
          OR: [
            { status: "Shipped", deliveryPartnerId: null },
            { status: { in: ["Out for Delivery", "Attempted"] }, deliveryPartnerId: req.user.id },
            { status: { in: ["Out for Delivery", "Attempted"] }, deliveryPartnerId: null }
          ]
        };
    const orders = await prisma.order.findMany({
      where,
      include: {
        orderItems: { include: { product: true } },
        deliveryPartner: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: "asc" } // oldest first: deliver in order
    });
    res.json(orders);
  } catch (error) {
    logger.error(error, "Failed to fetch delivery orders");
    res.status(500).json({ message: "Failed to fetch orders" });
  }
});

// ---- DELIVERY PARTNER: UPDATE STATUS ----
// Transitions (utils/orderStatus.js):
//   Shipped | Attempted -> Out for Delivery   (claims the order for this partner)
//   Out for Delivery    -> Delivered | Attempted   (assigned partner only)
// Admin/owner may act on any order in the queue. Delivering a cash-on-
// delivery order records the cash as collected (paymentStatus "Paid").
// Each update is a single conditional UPDATE, so two partners can't claim
// the same order and a stale screen can't skip a step.
const deliveryStatusSchema = z.object({
  status: z.enum(Object.keys(PARTNER_TRANSITIONS))
}).strict();

router.patch("/:id/delivery-status", authMiddleware, deliveryMiddleware, validateBody(deliveryStatusSchema), async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ message: "Invalid order id" });
  }

  try {
    const { status } = req.body;
    const isStaff = req.user.role === "ADMIN" || req.user.role === "OWNER";
    const before = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, deliveryPartnerId: true, paymentMethod: true }
    });
    if (!before) return res.status(404).json({ message: "Order not found" });

    const from = PARTNER_TRANSITIONS[status];
    const where = { id: orderId, status: { in: from } };
    const data = { status };

    if (status === "Out for Delivery") {
      // claim: only if unassigned or already mine (staff may reassign)
      if (!isStaff) where.OR = [{ deliveryPartnerId: null }, { deliveryPartnerId: req.user.id }];
      data.deliveryPartnerId = req.user.id;
    } else if (!isStaff) {
      // Delivered / Attempted: only the partner carrying the order
      where.deliveryPartnerId = req.user.id;
    }
    if (status === "Delivered" && before.paymentMethod === "COD") {
      data.paymentStatus = "Paid"; // cash collected on delivery
    }

    const { count } = await prisma.order.updateMany({ where, data });
    if (count === 0) {
      const mine = before.deliveryPartnerId === null || before.deliveryPartnerId === req.user.id || isStaff;
      return res.status(409).json({
        message: !from.includes(before.status)
          ? `Can't mark a "${before.status}" order as "${status}".`
          : mine ? "This order was just updated — refresh and try again."
                 : "This order is assigned to another delivery partner."
      });
    }

    const updated = await prisma.order.findUnique({ where: { id: orderId } });
    res.json(updated);

    if (before.status !== status && push.NOTIFY_STATUSES.includes(status)) {
      push.notifyUser(updated.userId, push.statusChangeForCustomer(updated));
    }
  } catch (error) {
    logger.error(error, "Failed to update delivery status");
    res.status(500).json({ message: "Failed to update order" });
  }
});

// ---- GET ALL ORDERS (admin) ----
// CHANGED: paginated, same reasoning as GET /products — this was an
// unbounded findMany over the entire order history on every admin
// dashboard load.
router.get(
  "/admin/all",
  authMiddleware,
  adminOrOwnerMiddleware,
  async (req, res) => {

    try {

      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          include: {
            user: {
              select: { id: true, name: true, email: true }
            },
            orderItems: { include: { product: true } }
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit
        }),
        prisma.order.count()
      ]);

      res.json({
        items: orders,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      });

    } catch (error) {
      logger.error(error);
      res.status(500).json({ message: "Failed to fetch all orders" });
    }

  }
);

// ---- UPDATE ORDER STATUS (admin) ----
// CHANGED: cancelling an order now RESTOCKS its items (in a transaction).
// Un-cancelling (Cancelled -> anything else) re-decrements, and refuses
// if stock has since run out.
router.put(
  "/:id/status",
  authMiddleware,
  adminOrOwnerMiddleware,
  async (req, res) => {

    try {

      const id = Number(req.params.id);
      const { status } = req.body;

      if (!ORDER_STATUSES.includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
      }

      const updatedOrder = await prisma.$transaction(async (tx) => {

        const order = await tx.order.findUnique({
          where: { id },
          include: { orderItems: true }
        });

        if (!order) throw { code: "NOT_FOUND" };

        const wasCancelled = order.status === "Cancelled";
        const willBeCancelled = status === "Cancelled";

        if (!wasCancelled && willBeCancelled) {
          // restock (optimized to avoid N+1)
          await bulkUpdateProductStock(tx, order.orderItems, 'increment');
        }

        if (wasCancelled && !willBeCancelled) {
          // taking it back out of stock — verify first
          // lines whose product was deleted have no stock to take back
          const stockedItems = order.orderItems.filter(item => item.productId !== null);
          const productIds = stockedItems.map(item => item.productId);
          const products = await tx.product.findMany({
            where: { id: { in: productIds } }
          });
          const productMap = new Map(products.map(p => [p.id, p]));

          for (const item of stockedItems) {
            const product = productMap.get(item.productId);
            if (!product || product.stock < item.quantity) {
              throw { code: "RESTOCK_FAIL", title: product ? product.title : "A product" };
            }
          }

          // decrement stock (optimized to avoid N+1)
          await bulkUpdateProductStock(tx, order.orderItems, 'decrement');
        }

        const data = { status };
        // Moving an order back before pickup releases the delivery partner.
        if (UNASSIGN_ON.includes(status)) data.deliveryPartnerId = null;

        const updated = await tx.order.update({
          where: { id },
          data
        });
        return { previousStatus: order.status, updated };
      });

      res.json(updatedOrder.updated);

      // Tell the customer only when the status really changed to one
      // they care about (re-saving the same status sends nothing).
      if (updatedOrder.previousStatus !== status && push.NOTIFY_STATUSES.includes(status)) {
        push.notifyUser(updatedOrder.updated.userId, push.statusChangeForCustomer(updatedOrder.updated));
      }

    } catch (error) {

      if (error && error.code === "NOT_FOUND") {
        return res.status(404).json({ message: "Order not found" });
      }
      if (error && error.code === "RESTOCK_FAIL") {
        return res.status(409).json({
          message: `Can't reactivate: "${error.title}" no longer has enough stock.`
        });
      }

      logger.error(error);
      res.status(500).json({ message: "Failed to update order status" });
    }

  }
);

// ---- UPDATE PAYMENT STATUS (admin) ----
// ADDED: lets the admin mark an order's payment as received/refunded.
router.put(
  "/:id/payment",
  authMiddleware,
  adminOrOwnerMiddleware,
  async (req, res) => {

    try {

      const id = Number(req.params.id);
      const { paymentStatus } = req.body;

      const allowed = ["Pending", "Paid", "Refunded"];
      if (!allowed.includes(paymentStatus)) {
        return res.status(400).json({ message: "Invalid payment status" });
      }

      const order = await prisma.order.update({
        where: { id },
        data: { paymentStatus }
      });

      res.json(order);

    } catch (error) {
      logger.error(error);
      res.status(500).json({ message: "Failed to update payment status" });
    }

  }
);

module.exports = router;
