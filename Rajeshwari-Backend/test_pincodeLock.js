// Delivery areas: public list, admin add/edit with area/city/state, and checkout
// locking city/state to the pincode. Fake Prisma + fake push; no database.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "pincode_lock_test_secret";
function stub(modPath, exportsObj) {
  const resolved = require.resolve(modPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}
let enabled = true;
const pins = new Map();
let createdOrder = null;
const product = { id: 3, title: "Bangle", image: null, price: 500, stock: 10 };
let cart = [];
const tx = {
  user: { findUnique: async () => ({ email: "c@x.test" }) },
  cart: { findMany: async () => cart, deleteMany: async () => { cart = []; } },
  order: { create: async ({ data }) => { createdOrder = data; return { id: 1, ...data, orderItems: data.orderItems.create }; } }
};
stub(path.join(__dirname, "src/config/db"), {
  ...tx,
  user: { ...tx.user, update: () => Promise.resolve() },
  pincodeRestriction: { findUnique: async () => ({ id: 1, enabled }) },
  serviceablePincode: {
    findMany: async () => [...pins.values()].sort((a, b) => a.pincode.localeCompare(b.pincode)),
    findUnique: async ({ where }) => pins.get(where.pincode) || null,
    upsert: async ({ where, update, create }) => { const r = pins.has(where.pincode) ? Object.assign(pins.get(where.pincode), update) : create; pins.set(where.pincode, r); return r; },
    updateMany: async ({ where, data }) => { if (!pins.has(where.pincode)) return { count: 0 }; Object.assign(pins.get(where.pincode), data); return { count: 1 }; },
    deleteMany: async ({ where }) => ({ count: pins.delete(where.pincode) ? 1 : 0 })
  },
  $transaction: async fn => fn(tx)
});
stub(path.join(__dirname, "src/utils/stock"), { bulkUpdateProductStock: async () => {} });
stub(path.join(__dirname, "src/utils/push"), { notifyUser: () => Promise.resolve(), notifyAdmins: () => Promise.resolve(),
  newOrderForShop: () => ({}), orderPlacedForCustomer: () => ({}), statusChangeForCustomer: () => null, NOTIFY_STATUSES: [] });

const pincodeRoutes = require("./src/routes/pincodeRoutes");
const orderRoutes = require("./src/routes/orderRoutes");
let server, base;
test.before(async () => {
  const app = express(); app.use(express.json());
  app.use("/pincode-restrictions", pincodeRoutes); app.use("/orders", orderRoutes);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());
const call = async (method, url, { role, body } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (role) headers.Authorization = `Bearer ${jwt.sign({ id: 9, role }, process.env.JWT_SECRET)}`;
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test("admin adds a pincode with its area, city and state", async () => {
  const r = await call("POST", "/pincode-restrictions", { role: "OWNER", body: { pincode: " 480884 ", area: " Lakhnadon ", city: "Seoni", state: "Madhya Pradesh" } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual({ ...pins.get("480884") }, { pincode: "480884", area: "Lakhnadon", city: "Seoni", state: "Madhya Pradesh" });
});

test("admin can add a pincode without details (and edit them later)", async () => {
  assert.strictEqual((await call("POST", "/pincode-restrictions", { role: "ADMIN", body: { pincode: "110001" } })).status, 200);
  assert.strictEqual(pins.get("110001").city, null);
  const r = await call("PUT", "/pincode-restrictions/110001", { role: "ADMIN", body: { area: "Connaught Place", city: "New Delhi", state: "Delhi" } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(pins.get("110001").city, "New Delhi");
});

test("validation and permissions", async () => {
  assert.strictEqual((await call("POST", "/pincode-restrictions", { role: "ADMIN", body: { pincode: "12ab" } })).status, 400);
  assert.strictEqual((await call("POST", "/pincode-restrictions", { role: "CUSTOMER", body: { pincode: "123456" } })).status, 403);
  assert.strictEqual((await call("PUT", "/pincode-restrictions/999999", { role: "ADMIN", body: { city: "X" } })).status, 404);
  assert.strictEqual((await call("PUT", "/pincode-restrictions/abc", { role: "ADMIN", body: { city: "X" } })).status, 400);
  assert.strictEqual((await call("PUT", "/pincode-restrictions/480884", { role: "ADMIN", body: { city: "x".repeat(81) } })).status, 400);
});

test("public areas list (no login) only while the restriction is on", async () => {
  let r = await call("GET", "/pincode-restrictions/areas");
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.areas.map(a => a.pincode), ["110001", "480884"]);
  assert.deepStrictEqual(r.body.areas[1], { pincode: "480884", area: "Lakhnadon", city: "Seoni", state: "Madhya Pradesh" });
  enabled = false;
  r = await call("GET", "/pincode-restrictions/areas");
  assert.deepStrictEqual(r.body, { enabled: false, areas: [] });
  enabled = true;
});

const ORDER = { fullName: "A", phone: "1", address: "12 MG Road, Ahmedabad", city: "Ahmedabad", state: "Gujarat" };
test("checkout: allowed pincode + other city -> order stores the pincode's real city/state", async () => {
  cart = [{ quantity: 1, product }];
  const r = await call("POST", "/orders/checkout", { role: "CUSTOMER", body: { ...ORDER, pincode: "480884" } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(createdOrder.city, "Seoni");
  assert.strictEqual(createdOrder.state, "Madhya Pradesh");
});

test("checkout: pincode outside the delivery areas is refused", async () => {
  cart = [{ quantity: 1, product }];
  const r = await call("POST", "/orders/checkout", { role: "CUSTOMER", body: { ...ORDER, pincode: "380001" } });
  assert.strictEqual(r.status, 403);
});

test("checkout: pincode without recorded city/state keeps what the customer typed", async () => {
  pins.set("560001", { pincode: "560001", area: null, city: null, state: null });
  cart = [{ quantity: 1, product }];
  await call("POST", "/orders/checkout", { role: "CUSTOMER", body: { ...ORDER, city: "Bengaluru", state: "Karnataka", pincode: "560001" } });
  assert.strictEqual(createdOrder.city, "Bengaluru");
});

test("checkout: restriction off -> no lock", async () => {
  enabled = false; cart = [{ quantity: 1, product }];
  await call("POST", "/orders/checkout", { role: "CUSTOMER", body: { ...ORDER, pincode: "480884" } });
  assert.strictEqual(createdOrder.city, "Ahmedabad");
  enabled = true;
});
