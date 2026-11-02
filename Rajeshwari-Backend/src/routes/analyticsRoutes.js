const express = require("express");
const { rateLimit } = require("express-rate-limit");

const prisma = require("../config/db");
const logger = require("../config/logger");
const { perVisitor } = require("../middleware/authRateLimiter");
const { clientIp } = require("../utils/clientIp");
const { ALLOWED_ORIGINS } = require("../config/origins");
const { parseEvents, isBot, hashIp, ingest, pruneOld } = require("../utils/analytics");

const router = express.Router();

const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, ...perVisitor,
  handler: (req, res) => res.status(204).end() // over the limit: quietly ignore
});

// Anonymous shop events. Always answers 204 immediately (the browser doesn't
// wait), then stores in the background. sendBeacon posts text/plain.
router.post("/events", analyticsLimiter, express.text({ type: "text/plain", limit: "16kb" }), (req, res) => {
  res.status(204).end();
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return;   // other websites
  if (isBot(req.headers["user-agent"])) return;
  const events = parseEvents(req.body);
  if (!events.length) return;
  const ipHash = hashIp(clientIp(req));
  setImmediate(async () => {
    try {
      await ingest(prisma, events, ipHash);
      await pruneOld(prisma);
    } catch (error) {
      logger.error(error, "analytics ingest failed");
    }
  });
});

module.exports = router;
