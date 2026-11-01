// Master-admin protection is tied to ONE account id resolved from ADMIN_EMAIL.
// HTTP-level tests with an in-memory fake Prisma (no database).
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const express = require("express");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "superadmin_test_secret";
function stub(modPath, exportsObj) {
  const resolved = require.resolve(modPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}
let users;
function seed() {
  users = [
    { id: 1, email: "devesh141singh@gmail.com", name: "Devesh", role: "ADMIN" },
    { id: 2, email: "other.admin@x.test", name: "Other", role: "ADMIN" },
    { id: 3, email: "Devesh141Singh@gmail.com", name: "Look-alike", role: "ADMIN" }, // registered later
    { id: 4, email: "cust@x.test", name: "Cust", role: "CUSTOMER" }
  ];
}
const match = (u, where) => Object.entries(where).every(([k, v]) => {
  if (v && typeof v === "object" && "equals" in v) return v.mode === "insensitive" ? String(u[k]).toLowerCase() === v.equals.toLowerCase() : u[k] === v.equals;
  return u[k] === v;
});
stub(path.join(__dirname, "src/config/db"), { user: {
  findFirst: async ({ where, orderBy }) => { let r = users.filter(u => match(u, where)); if (orderBy) r = r.sort((a, b) => a.id - b.id); return r[0] ? { id: r[0].id } : null; },
  findUnique: async ({ where }) => users.find(u => u.id === where.id) || null,
  findMany: async () => users.map(u => ({ ...u, createdAt: new Date(0), orders: [] })),
  update: async ({ where, data }) => { const u = users.find(x => x.id === where.id); Object.assign(u, data); return { id: u.id, name: u.name, email: u.email, role: u.role }; },
  delete: async ({ where }) => { users = users.filter(u => u.id !== where.id); return {}; }
} });

const userRoutes = require("./src/routes/userRoutes");
const { _resetWarning } = require("./src/utils/superAdmin");
let server, base;
test.before(async () => {
  const app = express(); app.use(express.json()); app.use("/users", userRoutes);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/users`;
});
test.after(() => server.close());
const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json",
    Authorization: `Bearer ${jwt.sign({ id: 2, role: "ADMIN" }, process.env.JWT_SECRET)}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};

for (const value of ["devesh141singh@gmail.com", "  devesh141singh@gmail.com  ", "DEVESH141SINGH@gmail.com"]) {
  test(`ADMIN_EMAIL=${JSON.stringify(value)}: master admin (id 1) can't be demoted or deleted`, async () => {
    seed(); process.env.ADMIN_EMAIL = value;
    assert.strictEqual((await call("PUT", "/1/role", { role: "CUSTOMER" })).status, 403);
    assert.strictEqual((await call("DELETE", "/1")).status, 403);
    assert.ok(users.find(u => u.id === 1 && u.role === "ADMIN"));
  });
}

test("a case-variant look-alike account is NOT protected", async () => {
  seed(); process.env.ADMIN_EMAIL = "devesh141singh@gmail.com";
  assert.strictEqual((await call("PUT", "/3/role", { role: "CUSTOMER" })).status, 200);
  assert.strictEqual((await call("DELETE", "/3")).status, 200);
});

test("GET /users flags exactly the master admin", async () => {
  seed(); process.env.ADMIN_EMAIL = "devesh141singh@gmail.com";
  const r = await call("GET", "/");
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.filter(u => u.isSuperAdmin).map(u => u.id), [1]);
});

test("ADMIN_EMAIL unset: nobody is flagged (and other admins are manageable)", async () => {
  seed(); delete process.env.ADMIN_EMAIL; _resetWarning();
  const r = await call("GET", "/");
  assert.ok(r.body.every(u => u.isSuperAdmin === false));
  assert.strictEqual((await call("PUT", "/4/role", { role: "OWNER" })).status, 200);
});

test("ADMIN_EMAIL pointing at a non-admin protects nobody", async () => {
  seed(); process.env.ADMIN_EMAIL = "cust@x.test";
  const r = await call("GET", "/");
  assert.ok(r.body.every(u => u.isSuperAdmin === false));
  delete process.env.ADMIN_EMAIL;
});
