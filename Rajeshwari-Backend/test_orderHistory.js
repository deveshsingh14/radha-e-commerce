// Order history survives product deletion: snapshots on checkout, and
// cancel / un-cancel still work when a line's product is gone.
// Fake Prisma, real stock util. No database.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "order_history_test_secret";
function stub(modPath, exportsObj) {
  const resolved = require.resolve(modPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

const stockUpdates = [];
const products = new Map([[3, { id: 3, title: "Gold Bangle", image: "https://img/bangle.jpg", price: 500, stock: 10 }]]);
const orders = new Map();
let cart = [];
let created = null;
const tx = {
  // email for the checkout snapshot; role for the admin route checks
  user: { findUnique: async ({ where }) => ({ email: `user${where.id}@x.test`, role: "ADMIN" }) },
  cart: { findMany: async () => cart, deleteMany: async () => { cart = []; } },
  product: {
    findMany: async ({ where }) => {
      assert.ok(!where.id.in.includes(null), "never query products by a null id");
      return where.id.in.map(id => products.get(id)).filter(Boolean);
    },
    updateMany: async ({ where, data }) => {
      assert.ok(!where.id.in.includes(null), "never update stock for a null id");
      stockUpdates.push({ ids: where.id.in, data }); return { count: where.id.in.length };
    }
  },
  order: {
    create: async ({ data }) => { created = data; const o = { id: 1, status: "Pending", ...data, orderItems: data.orderItems.create }; return o; },
    findUnique: async ({ where }) => orders.get(where.id) || null,
    update: async ({ where, data }) => { const o = orders.get(where.id); Object.assign(o, data); return { ...o }; }
  }
};
stub(path.join(__dirname, "src/config/db"), { ...tx, user: { ...tx.user, update: () => Promise.resolve() },
  pincodeRestriction: { findUnique: async () => null }, $transaction: async fn => fn(tx) });
stub(path.join(__dirname, "src/utils/push"), { notifyUser: () => Promise.resolve(), notifyAdmins: () => Promise.resolve(),
  newOrderForShop: () => ({}), orderPlacedForCustomer: () => ({}), statusChangeForCustomer: () => null, NOTIFY_STATUSES: [] });

const orderRoutes = require("./src/routes/orderRoutes");
let server, base;
test.before(async () => {
  const app = express(); app.use(express.json()); app.use("/orders", orderRoutes);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/orders`;
});
test.after(() => server.close());
const call = async (method, url, role, body) => {
  const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json",
    Authorization: `Bearer ${jwt.sign({ id: 9, role }, process.env.JWT_SECRET)}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

test("checkout stores a title/image snapshot on every order line", async () => {
  cart = [{ quantity: 2, product: products.get(3) }];
  const r = await call("POST", "/checkout", "CUSTOMER",
    { fullName: "A", phone: "1", address: "x", city: "y", state: "z", pincode: "1" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(created.customerEmail, "user9@x.test", "order keeps an email snapshot");
  assert.deepStrictEqual(created.orderItems.create, [
    { quantity: 2, price: 500, productId: 3, title: "Gold Bangle", image: "https://img/bangle.jpg" }
  ]);
});

test("cancelling an order whose product was deleted works and restocks only the remaining products", async () => {
  stockUpdates.length = 0;
  orders.set(20, { id: 20, status: "Pending", orderItems: [
    { productId: null, quantity: 1, title: "Deleted ₹299 item" },
    { productId: 3, quantity: 2, title: "Gold Bangle" }
  ] });
  const r = await call("PUT", "/20/status", "ADMIN", { status: "Cancelled" });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(stockUpdates, [{ ids: [3], data: { stock: { increment: 2 } } }]);
});

test("un-cancelling it also works (deleted line is skipped, not a 409)", async () => {
  stockUpdates.length = 0;
  const r = await call("PUT", "/20/status", "ADMIN", { status: "Pending" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(stockUpdates, [{ ids: [3], data: { stock: { decrement: 2 } } }]);
});

test("an order made only of deleted products can be cancelled", async () => {
  stockUpdates.length = 0;
  orders.set(21, { id: 21, status: "Pending", orderItems: [{ productId: null, quantity: 1, title: "Gone" }] });
  assert.strictEqual((await call("PUT", "/21/status", "ADMIN", { status: "Cancelled" })).status, 200);
  assert.strictEqual(stockUpdates.length, 0);
});
