/* ============================================================
   Anonymous shop analytics (what's popular, what people search).
   - A random visitor ID in localStorage; no name, email or account id.
   - Events are queued and sent in small batches every 5 s and when the
     page is hidden (sendBeacon, so it never slows navigation).
   - Do-Not-Track / Global Privacy Control turn it off completely.
   - Never blocks or breaks the shop: every failure is ignored.
   Details for shoppers: privacy.html
   ============================================================ */

const VISITOR_KEY = "radha.visitor";
const FLUSH_MS = 5000;
const MAX_QUEUE = 50;

function trackingAllowed(nav) {
  if (!nav) return false;
  if (nav.globalPrivacyControl === true) return false;
  const dnt = nav.doNotTrack || (typeof window !== "undefined" && window.doNotTrack);
  return !(dnt === "1" || dnt === "yes");
}

function randomId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* fall through */ }
  return "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

function visitorIdFrom(storage) {
  try {
    let id = storage.getItem(VISITOR_KEY);
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) { id = randomId(); storage.setItem(VISITOR_KEY, id); }
    return id;
  } catch (e) {
    return null; // storage blocked: send nothing rather than a new id per page
  }
}

// 👁 public counts: hidden below 10, then 10 … 999, 1.2k, 12k, 1.2M.
function compactCount(n) {
  n = Number(n) || 0;
  if (n < 10) return "";
  if (n < 1000) return String(n);
  if (n < 1e6) { const k = n / 1000; return (k < 10 ? (Math.floor(k * 10) / 10) : Math.floor(k)) + "k"; }
  const m = n / 1e6; return (m < 10 ? (Math.floor(m * 10) / 10) : Math.floor(m)) + "M";
}

function createAnalytics({ apiUrl, storage, nav, beacon, fetchFn, setTimer, clearTimer }) {
  const enabled = trackingAllowed(nav) && !!apiUrl;
  const visitorId = enabled ? visitorIdFrom(storage) : null;
  const url = `${apiUrl}/analytics/events`;
  let queue = [];
  let timer = null;

  function flush() {
    if (timer) { clearTimer(timer); timer = null; }
    if (!queue.length) return false;
    const batch = queue.splice(0, 25);
    const body = JSON.stringify(batch);
    let sent = false;
    try { sent = !!(beacon && beacon(url, body)); } catch (e) { sent = false; }
    if (!sent && fetchFn) {
      try {
        // text/plain keeps it a "simple" request (no CORS preflight), same as the beacon
        Promise.resolve(fetchFn(url, { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } })).catch(() => {});
      } catch (e) { /* ignore */ }
    }
    if (queue.length) schedule();
    return true;
  }
  function schedule() { if (!timer) timer = setTimer(flush, FLUSH_MS); }

  function track(type, fields) {
    if (!enabled || !visitorId) return false;
    queue.push({ type, visitorId, ...(fields || {}) });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    if (queue.length >= 25) flush(); else schedule();
    return true;
  }

  return { track, flush, enabled, _queue: () => queue.slice() };
}

// Browser wiring: one shared instance as window.TRACK(type, fields).
if (typeof window !== "undefined" && typeof document !== "undefined" && typeof API_URL !== "undefined") {
  const RADHA_ANALYTICS = createAnalytics({
    apiUrl: API_URL,
    storage: (() => { try { return window.localStorage; } catch (e) { return null; } })(),
    nav: navigator,
    beacon: navigator.sendBeacon
      ? (u, body) => navigator.sendBeacon(u, new Blob([body], { type: "text/plain" }))
      : null,
    fetchFn: window.fetch ? window.fetch.bind(window) : null,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: t => clearTimeout(t)
  });
  window.TRACK = (type, fields) => { try { return RADHA_ANALYTICS.track(type, fields); } catch (e) { return false; } };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") RADHA_ANALYTICS.flush(); });
  window.addEventListener("pagehide", () => RADHA_ANALYTICS.flush());
  const page = (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "") || "index";
  window.TRACK("page_view", { page });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { VISITOR_KEY, trackingAllowed, visitorIdFrom, compactCount, createAnalytics };
}
