// Sentry error monitoring — loaded by index.js right after dotenv and BEFORE
// express and the routes (required by @sentry/node v10 for its automatic
// instrumentation). Does nothing unless SENTRY_DSN is set.
//
// Privacy: this API handles passwords, reset tokens, addresses and phone
// numbers, so nothing personal is sent:
//   - request bodies are never captured (no passwords, addresses, tokens)
//   - cookies and authorization headers are removed
//   - the password-reset token in /auth/reset-password/<token> is redacted,
//     and query strings are dropped, in errors, traces and breadcrumbs
//   - sendDefaultPii: false (no IP addresses / user details)
const Sentry = require("@sentry/node");

const RESET_TOKEN = /(\/reset-password\/)[^/?#\s"]+/g;
const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|x-api-key|proxy-authorization)$/i;

function scrubUrl(value) {
  if (typeof value !== "string") return value;
  return value.replace(RESET_TOKEN, "$1[redacted]").replace(/\?[^\s"]*/g, "");
}

const QUERY_KEYS = ["http.query", "url.query", "query", "query_string"];
const URL_KEYS = ["url", "http.url", "http.target", "url.full", "url.path", "http.route"];

function scrubData(data) {
  if (!data || typeof data !== "object") return data;
  for (const key of QUERY_KEYS) delete data[key]; // raw "a=b&c=d" (no "?"), may hold emails etc.
  for (const key of URL_KEYS) {
    if (typeof data[key] === "string") data[key] = scrubUrl(data[key]);
  }
  return data;
}

function scrubEvent(event) {
  if (!event) return event;
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      for (const h of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADER.test(h)) delete event.request.headers[h];
      }
    }
    event.request.url = scrubUrl(event.request.url);
  }
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  if (Array.isArray(event.spans)) {
    for (const span of event.spans) {
      span.description = scrubUrl(span.description);
      scrubData(span.data);
    }
  }
  if (event.contexts && event.contexts.trace) scrubData(event.contexts.trace.data);
  if (Array.isArray(event.breadcrumbs)) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

function scrubBreadcrumb(crumb) {
  if (!crumb) return crumb;
  crumb.message = scrubUrl(crumb.message);
  scrubData(crumb.data);
  return crumb;
}

// Client mistakes (4xx: bad JSON, validation, auth) are expected traffic,
// not bugs — only server errors are reported.
function isClientError(err) {
  const status = err && (err.status || err.statusCode);
  return typeof status === "number" && status < 500;
}

function initSentry(options = {}) {
  const dsn = options.dsn || process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    release: process.env.RENDER_GIT_COMMIT || undefined, // set automatically by Render
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    integrations: [Sentry.httpIntegration({ maxIncomingRequestBodySize: "none" })],
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    ...options.extra
  });
  return true;
}

const enabled = initSentry();

module.exports = { Sentry, enabled, initSentry, scrubEvent, scrubBreadcrumb, scrubUrl, isClientError };
