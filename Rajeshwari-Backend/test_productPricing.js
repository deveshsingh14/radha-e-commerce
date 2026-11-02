// Product pricing & detail fields: MRP rule, cost price kept admin-only,
// SKU uniqueness, PUT merges stored values, CSV rows validated.
// Fake Prisma — no database. (The real-DB leak check runs in E2E.)
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "product_pricing_test_secret";
const calls = [];
const stored = new Map([[5, { id: 5, title: "Ring", price: 500, mrp: 600, costPrice: 300, stock: 3 }]]);
const p2002 = () => Object.assign(new Error("unique"), { code: "P2002" });
const fakePrisma = {
  user: { findUnique: async ({ where }) => ({ 1: { role: "ADMIN" }, 2: { role: "OWNER" }, 3: { role: "CUSTOMER" } })[where.id] || null },
  product: {
    create: async (args) => { calls.push(["create", args]); if (args.data.sku === "DUP") throw p2002(); return { id: 9, ...args.data, categories: [] }; },
    findUnique: async (args) => { calls.push(["findUnique", args]); return stored.get(args.where.id) || null; },
    findMany: async (args) => { calls.push(["findMany", args]); return [...stored.values()]; },
    count: async () => stored.size,
    update: async (args) => { calls.push(["update", args]); if (args.data.sku === "DUP") throw p2002(); return { id: args.where.id }; }
  },
  productCategory: { deleteMany: async () => ({}), createMany: async () => ({}) },
  $transaction: async fn => fn(fakePrisma)
};
require.cache[require.resolve("./src/config/db")] = {
  id: path.resolve("./src/config/db.js"), filename: path.resolve("./src/config/db.js"), loaded: true, exports: fakePrisma
};
const routes = require("./src/routes/productRoutes");
const { csvRowToProduct } = routes;

const ROLE_IDS = { ADMIN: 1, OWNER: 2, CUSTOMER: 3 };
let server, base;
test.before(async () => {
  const app = express(); app.use(express.json()); app.use("/products", routes);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/products`;
});
test.after(() => server.close());
async function call(method, url, { role, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (role) headers.Authorization = `Bearer ${jwt.sign({ id: ROLE_IDS[role], role }, process.env.JWT_SECRET)}`;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const last = name => calls.filter(c => c[0] === name).at(-1)[1];

test("create: selling price above MRP is refused", async () => {
  const r = await call("POST", "/", { role: "ADMIN", body: { title: "A", price: 700, mrp: 600, stock: 1 } });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.message, /can't be more than the MRP/);
});

test("create: saves all new fields, normalised, and returns cost price to the admin", async () => {
  const r = await call("POST", "/", { role: "OWNER", body: {
    title: "Kundan Set", price: "499", mrp: "599", costPrice: "350", stock: 2,
    brand: " Radha ", sku: "KS-01", size: "Free", color: "Gold", material: "Brass",
    tags: "Bridal; kundan, BRIDAL", attributes: [{ label: "Purity", value: "22K" }, { label: "Weight", value: " " }]
  } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const args = last("create");
  assert.deepStrictEqual(args.omit, { costPrice: false });
  assert.strictEqual(args.data.price, 499); assert.strictEqual(args.data.mrp, 599); assert.strictEqual(args.data.costPrice, 350);
  assert.strictEqual(args.data.brand, "Radha");
  assert.deepStrictEqual(args.data.tags, ["bridal", "kundan"]);
  assert.deepStrictEqual(args.data.attributes, [{ label: "Purity", value: "22K" }]);
  assert.strictEqual(r.body.costPrice, 350);
});

test("create: blank optional fields become null; bad values are rejected", async () => {
  const r = await call("POST", "/", { role: "ADMIN", body: { title: "B", price: 10, stock: 0, mrp: "", costPrice: "", sku: "  " } });
  assert.strictEqual(r.status, 200);
  const d = last("create").data;
  assert.strictEqual(d.mrp, null); assert.strictEqual(d.costPrice, null); assert.strictEqual(d.sku, null);
  for (const bad of [{ mrp: -5 }, { costPrice: -1 }, { mrp: "abc" }, { attributes: "x" }, { attributes: [{ label: { a: 1 }, value: "x" }] },
    { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, { brand: "x".repeat(61) }]) {
    const res = await call("POST", "/", { role: "ADMIN", body: { title: "C", price: 10, stock: 0, ...bad } });
    assert.strictEqual(res.status, 400, `should reject ${JSON.stringify(bad)}`);
  }
});

test("create/update: a duplicate SKU is a clean 409", async () => {
  assert.strictEqual((await call("POST", "/", { role: "ADMIN", body: { title: "D", price: 10, stock: 0, sku: "DUP" } })).status, 409);
  assert.strictEqual((await call("PUT", "/5", { role: "ADMIN", body: { sku: "DUP" } })).status, 409);
});

test("update: the MRP rule uses stored values for the side not sent", async () => {
  // stored mrp 600 -> raising the price to 700 alone must fail
  let r = await call("PUT", "/5", { role: "ADMIN", body: { price: 700 } });
  assert.strictEqual(r.status, 400);
  // stored price 500 -> lowering MRP to 450 alone must fail
  r = await call("PUT", "/5", { role: "ADMIN", body: { mrp: 450 } });
  assert.strictEqual(r.status, 400);
  // clearing the MRP lets the price go up
  r = await call("PUT", "/5", { role: "ADMIN", body: { price: 700, mrp: null } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  // stock-only edits skip the price lookup
  const before = calls.filter(c => c[0] === "findUnique").length;
  r = await call("PUT", "/5", { role: "ADMIN", body: { stock: 9 } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(calls.filter(c => c[0] === "findUnique").length - before, 1, "only the final re-read");
  assert.strictEqual((await call("PUT", "/404", { role: "ADMIN", body: { price: 1 } })).status, 404);
});

test("update: response opts back in to cost price for the admin", async () => {
  await call("PUT", "/5", { role: "ADMIN", body: { costPrice: 320 } });
  const reread = calls.filter(c => c[0] === "findUnique").at(-1)[1];
  assert.deepStrictEqual(reread.omit, { costPrice: false });
});

test("GET /products/admin is admin/owner only and includes cost price", async () => {
  assert.strictEqual((await call("GET", "/admin")).status, 401);
  assert.strictEqual((await call("GET", "/admin", { role: "CUSTOMER" })).status, 403);
  const r = await call("GET", "/admin", { role: "OWNER" });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(last("findMany").omit, { costPrice: false });
});

test("public GET /products and /products/:id never opt in to cost price", async () => {
  await call("GET", "/");
  assert.strictEqual(last("findMany").omit, undefined);
  await call("GET", "/5");
  assert.strictEqual(last("findUnique").omit, undefined);
});

test("the shared client hides costPrice by default", () => {
  const src = require("fs").readFileSync("src/config/db.js", "utf8");
  assert.match(src, /omit:\s*\{\s*product:\s*\{\s*costPrice:\s*true\s*\}\s*\}/);
});

test("CSV rows go through the same rules", () => {
  const ok = csvRowToProduct({ title: "Saree", price: "2500", mrp: "2999", cost_price: "1800", stock: "4",
    brand: "Radha", sku: "SR-1", colour: "Red", tags: "silk;banarasi", image: " " });
  assert.ok(ok.data, ok.error);
  assert.strictEqual(ok.data.costPrice, 1800); assert.strictEqual(ok.data.color, "Red");
  assert.deepStrictEqual(ok.data.tags, ["silk", "banarasi"]); assert.strictEqual(ok.data.image, null);
  assert.match(csvRowToProduct({ title: "X", price: "500", mrp: "400" }).error, /MRP/);
  assert.ok(csvRowToProduct({ title: "X", price: "abc" }).error);
  assert.ok(csvRowToProduct({ title: "", price: "10" }).error);
});
