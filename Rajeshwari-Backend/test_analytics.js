// Analytics ingest: validation, privacy filters, per-day unique views,
// anti-inflation cap, bots/foreign origins dropped, sendBeacon text/plain.
// Fake Prisma — no database.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const express = require("express");

const state = { events: [], views: new Map(), viewCount: new Map(), daily: new Map(), raw: [], deletes: 0 };
const fakePrisma = {
  product: { findMany: async ({ where }) => where.id.in.filter(id => id < 100).map(id => ({ id })) },
  analyticsEvent: {
    createMany: async ({ data }) => { state.events.push(...data); return { count: data.length }; },
    deleteMany: async () => { state.deletes++; return { count: 0 }; }
  },
  productView: {
    createManyAndReturn: async ({ data, skipDuplicates }) => {
      assert.ok(skipDuplicates);
      const out = [];
      for (const r of data) {
        const k = `${r.productId}|${r.visitorId}|${r.day.toISOString()}`;
        if (!state.views.has(k)) { state.views.set(k, r); out.push({ productId: r.productId }); }
      }
      return out;
    },
    deleteMany: async () => ({ count: 0 })
  },
  // interpret the two raw statements well enough to check the counters
  $executeRaw: async (strings, ...vals) => {
    const sql = strings.join("?");
    state.raw.push(sql);
    const flat = JSON.stringify(vals);
    const nums = (flat.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    return nums.length;
  }
};
require.cache[require.resolve("./src/config/db")] = {
  id: path.resolve("./src/config/db.js"), filename: path.resolve("./src/config/db.js"), loaded: true, exports: fakePrisma
};
const A = require("./src/utils/analytics");
const routes = require("./src/routes/analyticsRoutes");

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1";
const V1 = "11111111-aaaa-bbbb-cccc-000000000001";
const V2 = "11111111-aaaa-bbbb-cccc-000000000002";
let server, base;
test.before(async () => {
  const app = express(); app.set("trust proxy", 1); app.use(express.json()); app.use("/analytics", routes);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/analytics/events`;
});
test.after(() => server.close());
const settle = () => new Promise(r => setTimeout(r, 30));
async function post(body, { ua = UA, origin, text = false, ip = "203.0.113.5" } = {}) {
  const headers = { "Content-Type": text ? "text/plain;charset=UTF-8" : "application/json", "User-Agent": ua, "CF-Connecting-IP": ip };
  if (origin) headers.Origin = origin;
  const res = await fetch(base, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  await settle();
  return res.status;
}
const reset = () => { state.events = []; state.views.clear(); state.raw = []; A._resetCap(); };

test("parseEvents validates each type and drops junk", () => {
  const evs = A.parseEvents([
    { type: "product_view", visitorId: V1, productId: 5 },
    { type: "product_view", visitorId: "bad id!", productId: 5 },
    { type: "product_view", visitorId: V1 },
    { type: "nope", visitorId: V1 },
    { type: "area_request", visitorId: V1, pincode: "12345" },
    { type: "area_request", visitorId: V1, pincode: "560001" },
    { type: "search", visitorId: V1, term: "  Gold   RING ", resultCount: 3 },
    { type: "page_view", visitorId: V1, page: "<script>" }
  ]);
  assert.deepStrictEqual(evs.map(e => e.type), ["product_view", "area_request", "search"]);
  assert.strictEqual(evs[2].term, "gold ring");
  assert.ok(evs.every(e => !("userId" in e) && !("ip" in e)));
});

test("batches are capped at 25 events and bad JSON is ignored", () => {
  const many = Array.from({ length: 40 }, () => ({ type: "install", visitorId: V1 }));
  assert.strictEqual(A.parseEvents(many).length, 25);
  assert.deepStrictEqual(A.parseEvents("{not json"), []);
  assert.strictEqual(A.parseEvents(JSON.stringify({ events: many })).length, 25);
});

test("search terms that look personal are dropped", () => {
  assert.strictEqual(A.cleanSearchTerm("me@mail.com"), null);
  assert.strictEqual(A.cleanSearchTerm("98765 43210"), null);
  assert.strictEqual(A.cleanSearchTerm("9876543"), null);
  assert.strictEqual(A.cleanSearchTerm("a"), null);
  assert.strictEqual(A.cleanSearchTerm("size 22 bangle"), "size 22 bangle");
  assert.strictEqual(A.cleanSearchTerm("x".repeat(200)).length, 80);
});

test("istDay uses Indian time", () => {
  // 20:00 UTC on 1 Nov = 01:30 IST on 2 Nov
  assert.strictEqual(A.istDay(new Date("2026-11-01T20:00:00Z")).toISOString().slice(0, 10), "2026-11-02");
  assert.strictEqual(A.istDay(new Date("2026-11-01T18:00:00Z")).toISOString().slice(0, 10), "2026-11-01");
});

test("bot user agents are recognised", () => {
  assert.ok(A.isBot("Googlebot/2.1"));
  assert.ok(A.isBot("curl/8.0"));
  assert.ok(A.isBot(""));
  assert.ok(!A.isBot(UA));
});

test("POST always answers 204 and stores valid events (JSON and sendBeacon text/plain)", async () => {
  reset();
  assert.strictEqual(await post([{ type: "page_view", visitorId: V1, page: "index" }]), 204);
  assert.strictEqual(await post(JSON.stringify([{ type: "install", visitorId: V1 }]), { text: true }), 204);
  assert.strictEqual(await post("garbage", { text: true }), 204);
  assert.deepStrictEqual(state.events.map(e => e.type), ["page_view", "install"]);
});

test("a visitor's product view counts once per day", async () => {
  reset();
  await post([{ type: "product_view", visitorId: V1, productId: 5 }, { type: "product_view", visitorId: V1, productId: 5 }]);
  await post([{ type: "product_view", visitorId: V1, productId: 5 }]);
  await post([{ type: "product_view", visitorId: V2, productId: 5 }]);
  assert.strictEqual(state.views.size, 2);
  const updates = state.raw.filter(s => s.includes('UPDATE "product"'));
  assert.strictEqual(updates.length, 2, "viewCount bumped only for new unique views");
});

test("unknown products are ignored", async () => {
  reset();
  await post([{ type: "product_view", visitorId: V1, productId: 500 }]);
  assert.strictEqual(state.events.length, 0);
  assert.strictEqual(state.views.size, 0);
});

test("one network can add at most 3 new views per product per day", async () => {
  reset();
  const fakes = Array.from({ length: 10 }, (_, i) => ({ type: "product_view", visitorId: `fakevisitor${i}`, productId: 7 }));
  await post(fakes, { ip: "198.51.100.9" });
  assert.strictEqual(state.views.size, 3);
  await post([{ type: "product_view", visitorId: V1, productId: 7 }], { ip: "198.51.100.10" });
  assert.strictEqual(state.views.size, 4, "a different network still counts");
});

test("bots and other websites are dropped", async () => {
  reset();
  await post([{ type: "install", visitorId: V1 }], { ua: "Googlebot/2.1" });
  await post([{ type: "install", visitorId: V1 }], { origin: "https://evil.example" });
  assert.strictEqual(state.events.length, 0);
  await post([{ type: "install", visitorId: V1 }], { origin: "https://deveshsingh14.github.io" });
  assert.strictEqual(state.events.length, 1);
});

test("save and add_to_cart update the daily stats", async () => {
  reset();
  await post([{ type: "save", visitorId: V1, productId: 5 }, { type: "add_to_cart", visitorId: V1, productId: 5 }]);
  assert.ok(state.raw.some(s => s.includes("product_daily_stat") && s.includes("ON CONFLICT")));
  assert.ok(!state.raw.some(s => s.includes('UPDATE "product"')), "no view bump for saves");
});

test("old rows are pruned at most once per day per process", async () => {
  A._resetCap(); state.deletes = 0;
  const now = new Date("2026-11-02T06:00:00Z");
  assert.strictEqual(await A.pruneOld(fakePrisma, now), true);
  assert.strictEqual(await A.pruneOld(fakePrisma, now), false);
  assert.strictEqual(state.deletes, 1);
});

test("the endpoint is rate limited per visitor", async () => {
  const src = require("fs").readFileSync("src/routes/analyticsRoutes.js", "utf8");
  assert.match(src, /rateLimit\(/);
  assert.match(src, /\.\.\.perVisitor/);
});
