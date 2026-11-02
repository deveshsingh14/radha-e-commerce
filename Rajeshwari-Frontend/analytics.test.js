const { VISITOR_KEY, trackingAllowed, visitorIdFrom, compactCount, createAnalytics } = require("./analytics");

function memStorage() { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), _m: m }; }
function harness(navOver = {}, beaconOk = true) {
  const sent = [], fetched = [], timers = [];
  const a = createAnalytics({
    apiUrl: "http://api.test", storage: memStorage(), nav: { doNotTrack: null, ...navOver },
    beacon: (u, body) => { sent.push({ u, events: JSON.parse(body) }); return beaconOk; },
    fetchFn: (u, opts) => { fetched.push({ u, opts }); return Promise.resolve(); },
    setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: () => {}
  });
  return { a, sent, fetched, timers };
}

describe("compactCount", () => {
  test("hidden below 10", () => { expect(compactCount(0)).toBe(""); expect(compactCount(9)).toBe(""); expect(compactCount(undefined)).toBe(""); });
  test("plain up to 999", () => { expect(compactCount(10)).toBe("10"); expect(compactCount(999)).toBe("999"); });
  test("k and M, rounded down", () => {
    expect(compactCount(1000)).toBe("1k"); expect(compactCount(1250)).toBe("1.2k");
    expect(compactCount(12999)).toBe("12k"); expect(compactCount(1500000)).toBe("1.5M");
  });
});

describe("privacy switches", () => {
  test("Do-Not-Track and Global Privacy Control disable tracking", () => {
    expect(trackingAllowed({ doNotTrack: "1" })).toBe(false);
    expect(trackingAllowed({ globalPrivacyControl: true })).toBe(false);
    expect(trackingAllowed({ doNotTrack: "0" })).toBe(true);
    const { a, sent } = harness({ doNotTrack: "1" });
    expect(a.track("install")).toBe(false);
    a.flush();
    expect(sent).toHaveLength(0);
  });
  test("visitor id is random, kept, and contains nothing personal", () => {
    const s = memStorage();
    const id = visitorIdFrom(s);
    expect(id).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(visitorIdFrom(s)).toBe(id);
    expect(s._m.get(VISITOR_KEY)).toBe(id);
  });
  test("blocked storage sends nothing", () => {
    const a = createAnalytics({ apiUrl: "x", storage: { getItem() { throw new Error("blocked"); } }, nav: {},
      beacon: () => true, setTimer: () => 1, clearTimer: () => {} });
    expect(a.track("install")).toBe(false);
  });
});

describe("queue", () => {
  test("batches events and sends them with sendBeacon on flush", () => {
    const { a, sent, timers } = harness();
    a.track("product_view", { productId: 3 });
    a.track("save", { productId: 3 });
    expect(sent).toHaveLength(0);
    expect(timers).toHaveLength(1);
    timers[0]();
    expect(sent).toHaveLength(1);
    expect(sent[0].u).toBe("http://api.test/analytics/events");
    expect(sent[0].events.map(e => e.type)).toEqual(["product_view", "save"]);
    expect(sent[0].events[0].visitorId).toBe(sent[0].events[1].visitorId);
  });
  test("an empty queue sends nothing", () => {
    const { a, sent, fetched } = harness();
    expect(a.flush()).toBe(false);
    expect(sent).toHaveLength(0); expect(fetched).toHaveLength(0);
  });
  test("falls back to a text/plain fetch when the beacon is refused", () => {
    const { a, fetched } = harness({}, false);
    a.track("install"); a.flush();
    expect(fetched).toHaveLength(1);
    expect(fetched[0].opts.headers["Content-Type"]).toBe("text/plain");
    expect(fetched[0].opts.keepalive).toBe(true);
  });
  test("sends at most 25 per batch", () => {
    const { a, sent } = harness();
    for (let i = 0; i < 30; i++) a.track("install");
    expect(sent[0].events).toHaveLength(25);
    a.flush();
    expect(sent[1].events).toHaveLength(5);
  });
});
