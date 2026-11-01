const pino = require("pino");
const Sentry = require("@sentry/node");

// Render's log viewer is plain text, not a JSON-aware aggregator, so
// pino-pretty runs unconditionally (not just in dev) — colorize is off
// since ANSI codes don't render usefully there.
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: false,
      translateTime: "SYS:standard",
      ignore: "pid,hostname"
    }
  }
});

// Every route funnels caught errors through logger.error(...), so errors
// logged here are also reported to Sentry (initialised in src/instrument.js;
// no-op without SENTRY_DSN). Expected client errors (4xx) are skipped, and
// Sentry's Dedupe integration drops an error already sent by Express's
// handler. Accepts both logger.error(err, "msg") and logger.error("msg", err).
const logError = logger.error.bind(logger);
logger.error = (...args) => {
  if (Sentry.getClient()) {
    const err = args.find((a) => a instanceof Error) ||
      (args[0] && args[0].err instanceof Error ? args[0].err : null);
    const status = err && (err.status || err.statusCode);
    if (err && !(typeof status === "number" && status < 500)) Sentry.captureException(err);
  }
  return logError(...args);
};

module.exports = logger;
