// HTTP-level tests for categoryRoutes with an in-memory fake Prisma.
// No database is touched: src/config/db is replaced in require.cache
// before the router is loaded.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "category_routes_test_secret";

const calls = [];
const rows = new Map([[7, { id: 7, name: "Bangles", isJewellery: false }]]);
const fakePrisma = {
  user: { findUnique: async ({ where }) => ({ 1: { role: "ADMIN" }, 2: { role: "OWNER" }, 3: { role: "CUSTOMER" } })[where.id] || null },
  category: {
    findUnique: async ({ where }) => [...rows.values()].find(r => r.name === where.name) || null,
    findMany: async () => [...rows.values()],
    create: async ({ data }) => { calls.push(["create", data]); const r = { id: 99, ...data }; rows.set(99, r); return r; },
    update: async ({ where, data }) => {
      calls.push(["update", where, data]);
      if (!rows.has(where.id)) { const e = new Error("not found"); e.code = "P2025"; throw e; }
      const r = { ...rows.get(where.id), ...data }; rows.set(where.id, r); return r;
    }
  },
  productCategory: { deleteMany: async () => ({}) }
};
require.cache[require.resolve("./src/config/db")] = {
  id: path.resolve("./src/config/db.js"), filename: path.resolve("./src/config/db.js"),
  loaded: true, exports: fakePrisma
};

const categoryRoutes = require("./src/routes/categoryRoutes");

const ROLE_IDS = { ADMIN: 1, OWNER: 2, CUSTOMER: 3 };
const tokenFor = role => jwt.sign({ id: ROLE_IDS[role], role }, process.env.JWT_SECRET);
let server, base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/categories", categoryRoutes);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/categories`;
});
test.after(() => server.close());

async function call(method, url, { role, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (role) headers.Authorization = `Bearer ${tokenFor(role)}`;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test("PATCH /categories/:id marks a category as jewellery (admin)", async () => {
  const r = await call("PATCH", "/7", { role: "ADMIN", body: { isJewellery: true } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.isJewellery, true);
  assert.deepStrictEqual(calls.at(-1), ["update", { id: 7 }, { isJewellery: true }]);
});

test("PATCH works for OWNER too", async () => {
  const r = await call("PATCH", "/7", { role: "OWNER", body: { isJewellery: false } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.isJewellery, false);
});

test("PATCH rejects customers (403) and anonymous users (401)", async () => {
  assert.strictEqual((await call("PATCH", "/7", { role: "CUSTOMER", body: { isJewellery: true } })).status, 403);
  assert.strictEqual((await call("PATCH", "/7", { body: { isJewellery: true } })).status, 401);
});

test("PATCH validates the body", async () => {
  for (const body of [{}, { isJewellery: "yes" }, { isJewellery: 1 }, { isJewellery: true, name: "x" }]) {
    const r = await call("PATCH", "/7", { role: "ADMIN", body });
    assert.strictEqual(r.status, 400, `body ${JSON.stringify(body)} should be rejected`);
  }
});

test("PATCH rejects a non-numeric id (400) and 404s a missing category", async () => {
  assert.strictEqual((await call("PATCH", "/abc", { role: "ADMIN", body: { isJewellery: true } })).status, 400);
  assert.strictEqual((await call("PATCH", "/0", { role: "ADMIN", body: { isJewellery: true } })).status, 400);
  const r = await call("PATCH", "/12345", { role: "ADMIN", body: { isJewellery: true } });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.body.message, "Category not found");
});

test("POST /categories accepts isJewellery and defaults it to false", async () => {
  let r = await call("POST", "/", { role: "ADMIN", body: { name: "  Necklaces ", isJewellery: true } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(calls.at(-1), ["create", { name: "Necklaces", isJewellery: true }]);

  rows.delete(99);
  r = await call("POST", "/", { role: "ADMIN", body: { name: "Shampoo" } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(calls.at(-1), ["create", { name: "Shampoo", isJewellery: false }]);
});

test("POST /categories rejects a missing/blank name", async () => {
  assert.strictEqual((await call("POST", "/", { role: "ADMIN", body: {} })).status, 400);
  assert.strictEqual((await call("POST", "/", { role: "ADMIN", body: { name: "   " } })).status, 400);
});

test("GET /categories returns the isJewellery flag", async () => {
  const r = await call("GET", "/");
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.every(c => typeof c.isJewellery === "boolean"));
});
