/* ============================================================
   Radha E-Commerce — service worker
   Strategy:
     pages + same-origin JS/CSS/manifest -> network-first, cache fallback
                                     (a deploy shows up on the next load;
                                      the last good copy works offline)
     same-origin icons/images        -> cache-first
     legacy product images (/uploads)-> cache-first
     API calls (/products, /cart…)   -> network-only, never cached here
                                      (carts, orders, prices at checkout
                                       must always be live; the store page
                                       keeps its own short-lived copy of the
                                       public catalogue — see catalogue.js)
     other cross-origin (fonts, Cloudinary, Google) -> browser default
   Bump CACHE_VERSION whenever SHELL_ASSETS or this logic changes.
   ============================================================ */

const CACHE_VERSION = "v7";
const SHELL_CACHE = `radha-shell-${CACHE_VERSION}`;
const IMG_CACHE = `radha-img-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  "index.html",
  "jewellery.html",
  "checkout.html",
  "account.html",
  "offline.html",
  "store.css",
  "api.js",
  "section.js",
  "catalogue.js",
  "wishlist.js",
  "monitoring.js",
  "notifications.js",
  "store.js",
  "checkout.js",
  "account.js",
  "pwa.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-64.png"
];

const API_PATHS = [
  "/products", "/categories", "/cart", "/wishlist", "/orders", "/users",
  "/auth", "/notifications", "/pincode-restrictions", "/health"
];

// ---------- install ----------
// No skipWaiting() here: an updated worker waits until the user taps
// "Refresh" in the update bar (pwa.js posts SKIP_WAITING), so a page is
// never swapped out from under someone mid-checkout.
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      // addAll fails the whole install if ONE file 404s, so add
      // them individually and tolerate misses.
      Promise.all(SHELL_ASSETS.map(url =>
        cache.add(new Request(url, { cache: "reload" })).catch(() => {})
      ))
    )
  );
});

// ---------- activate: clean old versions ----------
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith("radha-") && k !== SHELL_CACHE && k !== IMG_CACHE)
          .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// allow the page to trigger an immediate update
self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isApiCall(url) {
  return API_PATHS.some(p => url.pathname === p || url.pathname.startsWith(p + "/"));
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return Response.error();
  }
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    // GitHub Pages sends max-age=600; "no-cache" revalidates so a fresh
    // deploy is picked up immediately instead of up to 10 minutes later.
    const res = await fetch(req, { cache: "no-cache" });
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === "navigate") {
      const offline = await cache.match("offline.html");
      if (offline) return offline;
    }
    return Response.error();
  }
}

// ---------- fetch ----------
self.addEventListener("fetch", event => {
  const req = event.request;

  // Only handle GETs. Never touch POST/PUT/DELETE — those are
  // orders, cart changes and logins.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // legacy product images from the API's /uploads folder: cache-first
  if (url.pathname.startsWith("/uploads/")) {
    event.respondWith(cacheFirst(req, IMG_CACHE));
    return;
  }

  // API data: always live, never cached
  if (isApiCall(url)) {
    event.respondWith(fetch(req).catch(() => Response.error()));
    return;
  }

  // other cross-origin (fonts, Cloudinary images, Google sign-in): browser default
  if (url.origin !== self.location.origin) return;

  // our own static images/icons rarely change: cache-first
  if (req.destination === "image") {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // pages, scripts, styles, manifest: network-first
  event.respondWith(networkFirst(req));
});

// ---------- push notifications (order updates) ----------
// Payload from the backend (src/utils/push.js): { title, body, url, tag }.
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const title = data.title || "Radha E-Commerce";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/favicon-64.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "index.html" }
  }));
});

// Tapping a notification focuses an open tab of the app (navigating it to
// the target page) or opens a new one. URLs resolve inside the app scope,
// so this works under the GitHub Pages sub-path.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "index.html", self.registration.scope);
  if (target.origin !== self.location.origin) return; // never open foreign URLs
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && "focus" in client) {
        await client.focus();
        if ("navigate" in client && client.url !== target.href) await client.navigate(target.href).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});

