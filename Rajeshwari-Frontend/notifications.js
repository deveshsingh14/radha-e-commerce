/* ============================================================
   Order notifications (Web Push) — customer + shop owner.
   Needs api.js (API_URL, token, authHeaders) and the service worker.

   window.RadhaPush:
     state()   -> "unsupported" | "unavailable" | "needs-login" | "ios-install"
                  | "blocked" | "off" | "on"
     enable()  -> asks permission (call from a click), subscribes this
                  device and registers it for the logged-in account
     disable() -> unsubscribes this device (called on logout so a shared
                  device stops getting the previous user's orders)

   Declarative UI (any page):
     <div data-push-panel>
       <p data-push-text></p>
       <button data-push-toggle>Turn on</button>
     </div>
   ============================================================ */

(function (root) {

  // ---------- pure helpers (unit-tested) ----------
  function urlBase64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = (typeof atob === "function" ? atob : s => Buffer.from(s, "base64").toString("binary"))(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  const STATE_TEXT = {
    "unsupported": "This browser doesn't support notifications.",
    "unavailable": "Notifications aren't available right now.",
    "needs-login": "Log in to get updates about your orders.",
    "ios-install": "On iPhone/iPad, first add Radha E-Commerce to your Home Screen (Share → Add to Home Screen), then open it from there to turn on notifications.",
    "blocked": "Notifications are blocked for this site. Allow them in your browser's site settings to get order updates.",
    "off": "Get a notification when your order is placed, shipped or delivered.",
    "on": "On — you'll be notified about your orders on this device."
  };

  const helpers = { urlBase64ToUint8Array, STATE_TEXT };
  if (typeof module !== "undefined" && module.exports) module.exports = helpers;
  if (typeof window === "undefined") return;

  // ---------- environment ----------
  const supported = () =>
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = () =>
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;
  const loggedIn = () => typeof token === "function" && !!token();

  let publicKeyPromise = null;
  function getPublicKey() {
    if (!publicKeyPromise) {
      publicKeyPromise = fetch(`${API_URL}/notifications/vapid-public-key`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => (d && d.enabled && d.publicKey) || null)
        .catch(() => null);
    }
    return publicKeyPromise;
  }

  async function registration() {
    // Resolves once pwa.js has registered the worker; time out rather than hang.
    return Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error("Service worker not ready")), 10000))
    ]);
  }

  async function currentSubscription() {
    try { return await (await registration()).pushManager.getSubscription(); }
    catch (e) { return null; }
  }

  let cachedState = "off";
  async function computeState() {
    if (!supported()) return isIOS() && !isStandalone() ? "ios-install" : "unsupported";
    if (!(await getPublicKey())) return "unavailable";
    if (!loggedIn()) return "needs-login";
    if (Notification.permission === "denied") return "blocked";
    const sub = await currentSubscription();
    return sub && Notification.permission === "granted" ? "on" : "off";
  }

  async function sendToServer(sub) {
    const res = await fetch(`${API_URL}/notifications/subscribe`, {
      method: "POST", headers: authHeaders(true), body: JSON.stringify(sub.toJSON ? sub.toJSON() : sub)
    });
    if (!res.ok) throw new Error(`subscribe failed (${res.status})`);
  }

  async function enable() {
    if (!supported()) throw new Error("Notifications aren't supported on this browser");
    if (!loggedIn()) throw new Error("Please log in first");
    const key = await getPublicKey();
    if (!key) throw new Error("Notifications aren't available right now");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") { await refreshUI(); return "blocked"; }

    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    }
    await sendToServer(sub);
    if (typeof window.TRACK === "function") window.TRACK("notify_on");
    await refreshUI();
    return "on";
  }

  async function disable() {
    if (!supported()) return "unsupported";
    const sub = await currentSubscription();
    if (sub) {
      if (loggedIn()) {
        await fetch(`${API_URL}/notifications/subscribe`, {
          method: "DELETE", headers: authHeaders(true), body: JSON.stringify({ endpoint: sub.endpoint })
        }).catch(() => {});
      }
      await sub.unsubscribe().catch(() => {});
    }
    await refreshUI();
    return "off";
  }

  // Keep the server's copy fresh (subscriptions can rotate) and bound to
  // whoever is logged in on this device now.
  async function resync() {
    if (!supported() || !loggedIn() || Notification.permission !== "granted") return;
    const sub = await currentSubscription();
    if (sub && (await getPublicKey())) await sendToServer(sub).catch(() => {});
  }

  // ---------- declarative UI ----------
  async function refreshUI() {
    cachedState = await computeState().catch(() => "unavailable");
    document.querySelectorAll("[data-push-panel]").forEach(panel => {
      const hideWhen = (panel.getAttribute("data-push-hide") || "unsupported unavailable").split(/\s+/);
      panel.hidden = hideWhen.includes(cachedState);
      panel.dataset.state = cachedState;
      const text = panel.querySelector("[data-push-text]");
      if (text) text.textContent = STATE_TEXT[cachedState];
      const btn = panel.querySelector("[data-push-toggle]");
      if (btn) {
        btn.hidden = !["off", "on"].includes(cachedState);
        btn.textContent = cachedState === "on"
          ? (btn.getAttribute("data-push-off-label") || "Turn off")
          : (btn.getAttribute("data-push-on-label") || btn.dataset.defaultLabel || (btn.dataset.defaultLabel = btn.textContent));
        btn.setAttribute("aria-pressed", String(cachedState === "on"));
        if (!btn._pushBound) {
          btn._pushBound = true;
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            try {
              const result = cachedState === "on" ? await disable() : await enable();
              if (typeof toast === "function") {
                toast(result === "on" ? "Order notifications on 🔔"
                  : result === "blocked" ? "Notifications were blocked" : "Order notifications off");
              }
            } catch (e) {
              console.error("Notification toggle failed:", e);
              if (typeof toast === "function") toast(e.message || "Couldn't update notifications", "err");
            } finally {
              btn.disabled = false;
            }
          });
        }
      }
    });
    return cachedState;
  }

  root.RadhaPush = { state: () => cachedState, refresh: refreshUI, enable, disable, resync, isSupported: supported };

  function init() { refreshUI(); resync(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

})(typeof window !== "undefined" ? window : globalThis);
