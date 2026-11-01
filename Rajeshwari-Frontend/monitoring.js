/* ============================================================
   Browser error monitoring (Sentry). Loaded in <head> right after the
   Sentry CDN bundle, before the page's own scripts, so early errors are
   caught. Only active on the live site — local/test copies send nothing.

   Privacy (same rules as the backend):
   - no personal data (sendDefaultPii: false, no user info attached)
   - the password-reset token is removed from every URL
     (page: reset-password.html?token=…, API: /auth/reset-password/<token>)
   - query strings are dropped from URLs; the Referer header is removed
   - only errors from our own pages are reported (not browser extensions)
   The DSN below is a public key by design (it ships in every page);
   "Allowed Domains" in the Sentry project limits who can use it.
   ============================================================ */

(function (root) {
  var SENTRY_DSN = "https://abfb126cb92687747a7210f883976588@o4512048321593344.ingest.us.sentry.io/4512355285336064";
  var LIVE_HOST = "deveshsingh14.github.io";
  var LIVE_PATH = "/radha-e-commerce/";

  function scrubUrl(u) {
    if (typeof u !== "string") return u;
    return u.replace(/(\/reset-password\/)[^/?#\s"]+/g, "$1[redacted]")
            .replace(/([?&]token=)[^&#\s"]+/g, "$1[redacted]")
            .replace(/\?[^#\s"]*/g, "");
  }

  function scrubEvent(event) {
    if (!event) return event;
    if (event.request) {
      event.request.url = scrubUrl(event.request.url);
      delete event.request.query_string;
      delete event.request.cookies;
      if (event.request.headers) {
        delete event.request.headers.Referer;
        delete event.request.headers.referer;
      }
    }
    delete event.user;
    if (Array.isArray(event.breadcrumbs)) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
    return event;
  }

  function scrubBreadcrumb(crumb) {
    if (!crumb) return crumb;
    if (crumb.message) crumb.message = scrubUrl(crumb.message);
    var d = crumb.data;
    if (d) {
      ["url", "from", "to"].forEach(function (k) { if (typeof d[k] === "string") d[k] = scrubUrl(d[k]); });
    }
    return crumb;
  }

  function shouldEnable(loc) {
    return !!loc && loc.hostname === LIVE_HOST && String(loc.pathname || "").indexOf(LIVE_PATH) === 0;
  }

  function initMonitoring(win) {
    var S = win && win.Sentry;
    if (!S || typeof S.init !== "function" || !shouldEnable(win.location)) return false;
    S.init({
      dsn: SENTRY_DSN,
      environment: "production",
      sendDefaultPii: false,
      allowUrls: [/https:\/\/deveshsingh14\.github\.io\/radha-e-commerce\//],
      maxBreadcrumbs: 30,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb
    });
    var page = (win.location.pathname.split("/").pop() || "index.html");
    if (typeof S.setTag === "function") S.setTag("page", page);
    return true;
  }

  var api = { scrubUrl: scrubUrl, scrubEvent: scrubEvent, scrubBreadcrumb: scrubBreadcrumb, shouldEnable: shouldEnable, initMonitoring: initMonitoring };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.RadhaMonitoring = api;
  initMonitoring(root);
})(typeof window !== "undefined" ? window : globalThis);
