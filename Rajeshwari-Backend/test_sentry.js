// Sentry setup: what would actually be sent (in-memory transport, no network).
// Run in its own process: Sentry instruments modules at init.
const test = require("node:test");
const assert = require("node:assert");

delete process.env.SENTRY_DSN;
const sent = [];
const S = require("@sentry/node");
const memoryTransport = (options) => S.createTransport(options, async (req) => {
  // envelope: header line, then item header/payload pairs
  const lines = String(req.body).split("\n").filter(Boolean);
  for (let i = 1; i < lines.length; i += 2) {
    const head = JSON.parse(lines[i]);
    if (head.type === "event" || head.type === "transaction") sent.push({ type: head.type, ...JSON.parse(lines[i + 1]) });
  }
  return { statusCode: 200 };
});

const inst = require("./src/instrument");
assert.strictEqual(inst.enabled, false, "no DSN -> disabled");
inst.initSentry({ dsn: "https://public@o0.ingest.sentry.io/0", extra: { transport: memoryTransport, tracesSampleRate: 1 } });

const express = require("express");
const logger = require("./src/config/logger");
const errorHandler = require("./src/middleware/errorHandler");

let server, base;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.post("/auth/reset-password/:token", (req, res) => { throw new Error("boom in reset"); });
  app.post("/auth/login", (req, res, next) => { const e = new Error("bad input"); e.status = 400; next(e); });
  app.get("/caught", (req, res) => { logger.error("Failed thing:", new Error("caught 500")); res.status(500).json({}); });
  S.setupExpressErrorHandler(app, { shouldHandleError: (err) => !(Number(err.status || err.statusCode) < 500) });
  app.use(errorHandler);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());
const flush = () => S.flush(2000);

// Secrets are assembled at runtime so they never appear in this file's source
// (Sentry attaches surrounding source lines to stack frames).
const EMAIL = ["visitor", "example.test"].join("@");
const TOKEN = ["SECRET", "TOKEN", "123"].join("-");
const PASSWORD = ["hunter2", "NewPassword"].join("-");
const JWT = ["JWT", "SECRET", "VALUE"].join("-");

test("server error is reported ONCE, with no body, no auth/cookies, no reset token, no query", async () => {
  sent.length = 0;
  await fetch(`${base}/auth/reset-password/${TOKEN}?email=${EMAIL}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}`, Cookie: "sid=abc" },
    body: JSON.stringify({ password: PASSWORD })
  });
  await flush();
  const errors = sent.filter(e => e.type === "event");
  assert.strictEqual(errors.length, 1, `expected 1 error event, got ${errors.length}`);
  const all = JSON.stringify(sent);
  for (const secret of [TOKEN, PASSWORD, JWT, "sid=abc", EMAIL]) {
    assert.ok(!all.includes(secret), `"${secret}" must never be sent to Sentry`);
  }
  assert.match(all, /reset-password\/\[redacted\]/);
  assert.strictEqual(errors[0].exception.values[0].value, "boom in reset");
});

test("client errors (4xx) are not reported", async () => {
  sent.length = 0;
  await fetch(`${base}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  await flush();
  assert.strictEqual(sent.filter(e => e.type === "event").length, 0);
});

test("errors caught in routes and logged as logger.error('msg', err) are reported", async () => {
  sent.length = 0;
  await fetch(`${base}/caught`);
  await flush();
  const ev = sent.filter(e => e.type === "event");
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].exception.values[0].value, "caught 500");
});

test("scrubUrl / scrubEvent units", () => {
  assert.strictEqual(inst.scrubUrl("https://x/auth/reset-password/abc?y=1"), "https://x/auth/reset-password/[redacted]");
  const e = inst.scrubEvent({ request: { url: "/a?b=1", data: "{x}", cookies: { s: 1 }, query_string: "b=1",
    headers: { Authorization: "x", cookie: "y", "user-agent": "ua" } }, transaction: "POST /auth/reset-password/tok" });
  assert.deepStrictEqual(e.request, { url: "/a", headers: { "user-agent": "ua" } });
  assert.strictEqual(e.transaction, "POST /auth/reset-password/[redacted]");
  assert.strictEqual(inst.isClientError({ status: 404 }), true);
  assert.strictEqual(inst.isClientError(new Error("x")), false);
});
