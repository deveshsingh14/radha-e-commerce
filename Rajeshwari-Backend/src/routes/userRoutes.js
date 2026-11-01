const express = require("express");

const prisma = require("../config/db");
const logger = require("../config/logger");
const { getSuperAdminId } = require("../utils/superAdmin");

const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const bcrypt = require("bcrypt");
const { z } = require("zod");
const { validateBody } = require("../middleware/validate");

const router = express.Router();


const userProfileUpdateSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").optional(),
  phone: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  pincode: z.string().trim().optional().nullable(),
});

// In-memory toggle for owner promotions, defaults to env var or true
let ownerPromotionsEnabled = process.env.ENABLE_OWNER_PROMOTION !== "false";

// ---- MY PROFILE (any logged-in user) ----
// ADDED: lets a customer read their own profile + saved delivery details.
// Defined before "/:id/orders" so "me" is never treated as an id.
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, name: true, email: true, role: true,
        phone: true, address: true, city: true, state: true, pincode: true,
        createdAt: true
      }
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

// ---- UPDATE MY PROFILE ----
// ADDED: name + delivery details only. Email, role and password are
// deliberately NOT updatable here (role for security; email/password
// deserve their own verified flows later).
router.put("/me", authMiddleware, validateBody(userProfileUpdateSchema), async (req, res) => {
  try {
    const { name, phone, address, city, state, pincode } = req.body;

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { name, phone, address, city, state, pincode },
      select: {
        id: true, name: true, email: true, role: true,
        phone: true, address: true, city: true, state: true, pincode: true
      }
    });
    res.json(user);
  } catch (error) {
    logger.error(error);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

// ---- LIST CUSTOMERS (admin) ----
// Returns every user (without password) plus a few aggregates the admin
// panel needs: how many orders they've placed and how much they've spent
// (cancelled orders excluded from the spend total).
router.get(
  "/",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          orders: {
            select: {
              totalAmount: true,
              status: true,
              createdAt: true
            }
          }
        },
        orderBy: { createdAt: "desc" }
      });

      const superAdminId = await getSuperAdminId(prisma);
      const customers = users.map(u => {
        const orders = u.orders || [];

        const { totalSpent, lastOrder } = orders.reduce(
          (acc, o) => {
            if (o.status !== "Cancelled") acc.totalSpent += o.totalAmount;
            if (!acc.lastOrder || o.createdAt > acc.lastOrder.createdAt) {
              acc.lastOrder = o;
            }
            return acc;
          },
          { totalSpent: 0, lastOrder: null }
        );

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          // lets the admin UI hide demote/delete for the master admin
          // without the email ever being hard-coded in public JavaScript
          isSuperAdmin: u.id === superAdminId,
          createdAt: u.createdAt,
          orderCount: orders.length,
          totalSpent,
          lastOrderAt: lastOrder ? lastOrder.createdAt : null
        };
      });

      res.json(customers);
    } catch (error) {
      logger.error(error);
      res.status(500).json({
        message: "Failed to fetch customers"
      });
    }
  }
);

// ---- ONE CUSTOMER'S ORDERS (admin) ----
router.get(
  "/:id/orders",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const userId = Number(req.params.id);

      const orders = await prisma.order.findMany({
        where: { userId },
        include: {
          orderItems: {
            include: { product: true }
          }
        },
        orderBy: { createdAt: "desc" }
      });

      res.json(orders);
    } catch (error) {
      logger.error(error);
      res.status(500).json({
        message: "Failed to fetch customer orders"
      });
    }
  }
);

// ---- GET PROMOTION STATUS (admin only) ----
router.get(
  "/promotion-status",
  authMiddleware,
  adminMiddleware,
  (req, res) => {
    res.json({ enabled: ownerPromotionsEnabled });
  }
);

// ---- TOGGLE PROMOTION STATUS (admin only) ----
router.put(
  "/promotion-status",
  authMiddleware,
  adminMiddleware,
  (req, res) => {
    if (typeof req.body.enabled !== "boolean") {
      return res.status(400).json({ message: "Invalid payload, expected boolean 'enabled'" });
    }
    ownerPromotionsEnabled = req.body.enabled;
    res.json({ message: "Promotion status updated", enabled: ownerPromotionsEnabled });
  }
);

// ---- CHANGE USER ROLE (admin only) ----
router.put(
  "/:id/role",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { role } = req.body;
      
      if (!["ADMIN", "OWNER", "CUSTOMER", "DELIVERY_PARTNER"].includes(role)) {
        return res.status(400).json({ message: "Invalid role specified" });
      }

      if (role === "OWNER" && !ownerPromotionsEnabled) {
        return res.status(403).json({ message: "Owner promotion feature is disabled" });
      }

      // Check self-demotion
      if (req.user.id === id) {
        return res.status(403).json({ message: "Cannot change your own role" });
      }

      // Check Superadmin protection
      const targetUser = await prisma.user.findUnique({ where: { id } });
      if (!targetUser) return res.status(404).json({ message: "User not found" });

      const superAdminId = await getSuperAdminId(prisma);
      if (superAdminId !== null && targetUser.id === superAdminId) {
        return res.status(403).json({ message: "Cannot change the role of the Superadmin" });
      }

      const user = await prisma.user.update({
        where: { id },
        data: { role },
        select: { id: true, name: true, email: true, role: true }
      });
      res.json({ message: `User role updated to ${role} successfully`, user });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  }
);

// ---- CREATE NEW OWNER ACCOUNT (admin only) ----
router.post(
  "/create-owner",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const { name, email, password } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({ message: "Name, email and password are required" });
      }

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ message: "User already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const user = await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: "OWNER"
        }
      });

      const { password: _pw, ...safeUser } = user;
      res.json({ message: "Owner created successfully", user: safeUser });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ message: "Failed to create owner account" });
    }
  }
);

// ---- DELETE USER (admin only) ----
router.delete(
  "/:id",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id);

      // 1. Check self-deletion
      if (req.user.id === id) {
        return res.status(403).json({ message: "Cannot delete your own account" });
      }

      // 2. Check Superadmin protection
      const targetUser = await prisma.user.findUnique({ where: { id } });
      if (!targetUser) return res.status(404).json({ message: "User not found" });

      const superAdminId = await getSuperAdminId(prisma);
      if (superAdminId !== null && targetUser.id === superAdminId) {
        return res.status(403).json({ message: "Cannot delete the Superadmin account" });
      }

      // 3. Cart, wishlist and push subscriptions cascade-delete at the DB
      // level. Orders are kept as business records: the DB unlinks them
      // (userId -> NULL); each order keeps its delivery details and a
      // customerEmail snapshot.

      // 4. Finally delete user
      await prisma.user.delete({ where: { id } });

      res.json({ message: "User deleted successfully" });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  }
);

module.exports = router;
