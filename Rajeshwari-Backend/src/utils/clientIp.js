// The visitor's real IP address. On Render, requests arrive through
// Cloudflare and Render's load balancer, so the TCP peer is a proxy — using
// it would make every "per IP" limit shared by all visitors.
// Order: CF-Connecting-IP (set by Cloudflare, which overwrites any client
// value) → True-Client-IP → req.ip (Express, with `trust proxy` set).
// Never stored anywhere; only used for rate limiting and in-memory caps.
function firstValue(v) {
  if (typeof v !== "string") return null;
  const s = v.split(",")[0].trim();
  return s || null;
}

function clientIp(req) {
  const h = (req && req.headers) || {};
  return firstValue(h["cf-connecting-ip"]) ||
    firstValue(h["true-client-ip"]) ||
    (req && req.ip) ||
    (req && req.socket && req.socket.remoteAddress) ||
    "unknown";
}

module.exports = { clientIp };
