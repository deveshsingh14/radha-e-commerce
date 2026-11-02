/* ============================================================
   PWA glue: registers the service worker, shows a branded
   "Install app" prompt, an offline banner, and an update notice.
   Include on every page: <script src="pwa.js" defer></script>
   Must live at the site root (same folder as the HTML pages) so
   the service worker scope covers every page.

   Installing is always the user's choice — browsers never let a
   site install itself. Android / desktop Chrome & Edge fire
   `beforeinstallprompt`, which we turn into our own install card;
   iOS Safari has no such event, so we show "Share → Add to Home
   Screen" instructions instead.

   Exposes window.RadhaPWA for pages that want their own install
   button (see account.html).
   ============================================================ */

(function (root) {

  const APP_NAME = "Radha E-Commerce";
  const DISMISS_KEY = "pwaPromptDismissedAt";
  const DISMISS_DAYS = 7;

  // ---------- pure helpers (unit-tested) ----------
  function recentlyDismissed(now, storage) {
    let t = 0;
    try { t = Number(storage.getItem(DISMISS_KEY) || 0); } catch (e) { t = 0; }
    return t > 0 && (now - t) < DISMISS_DAYS * 864e5;
  }

  function isIOSDevice(ua, platform, maxTouchPoints) {
    // iPadOS 13+ reports itself as "MacIntel" but has a touch screen.
    return /iphone|ipad|ipod/i.test(ua || "") ||
      (platform === "MacIntel" && (maxTouchPoints || 0) > 1);
  }

  const helpers = { recentlyDismissed, isIOSDevice, APP_NAME, DISMISS_KEY, DISMISS_DAYS };
  if (typeof module !== "undefined" && module.exports) module.exports = helpers;
  if (typeof window === "undefined") return;

  // ---------- environment ----------
  const isIOS = isIOSDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  const isStandalone = () =>
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;

  // ---------- styles (self-contained so every page gets them) ----------
  function injectStyles() {
    if (document.getElementById("pwaStyles")) return;
    const s = document.createElement("style");
    s.id = "pwaStyles";
    s.textContent = `
#pwaInstallCard{position:fixed;left:50%;bottom:90px;z-index:300;transform:translateX(-50%) translateY(20px);
 display:flex;align-items:center;gap:12px;width:calc(100% - 32px);max-width:420px;box-sizing:border-box;
 background:#fff;border:1px solid var(--line,#eee9ec);border-radius:18px;padding:12px 14px;
 box-shadow:0 12px 40px rgba(33,26,32,.18);opacity:0;transition:opacity .3s ease,transform .3s ease;
 font-family:"DM Sans",system-ui,sans-serif}
#pwaInstallCard.in{opacity:1;transform:translateX(-50%) translateY(0)}
#pwaInstallCard .pwa-ico{flex:0 0 auto;width:42px;height:42px;border-radius:12px;
 background:radial-gradient(circle at 32% 26%,#a03355,var(--maroon,#7a1f3d));color:#fff;
 font-family:"Cinzel",serif;font-weight:700;font-size:20px;display:grid;place-items:center;
 box-shadow:inset 0 0 0 1.5px rgba(201,154,63,.85)}
#pwaInstallCard .pwa-copy{flex:1;min-width:0;display:flex;flex-direction:column}
#pwaInstallCard .pwa-copy strong{font-size:13.5px;color:var(--ink,#211a20)}
#pwaInstallCard .pwa-copy span{font-size:11.5px;color:var(--muted,#8f8691)}
#pwaInstallCard .pwa-yes{flex:0 0 auto;border:none;border-radius:999px;background:var(--maroon,#7a1f3d);
 color:#fff;font-weight:700;font-size:13px;padding:9px 17px;cursor:pointer;font-family:inherit}
#pwaInstallCard .pwa-yes:hover{background:#5f172f}
#pwaInstallCard .pwa-no{flex:0 0 auto;border:none;background:none;color:var(--muted,#8f8691);
 font-size:20px;line-height:1;padding:0 2px;cursor:pointer}
#pwaInstallCard .pwa-no:hover{color:var(--ink,#211a20)}
#pwaOfflineBar,#pwaUpdateBar{position:fixed;left:0;right:0;top:0;z-index:310;padding:9px 16px;
 text-align:center;font-size:12.5px;font-weight:600;transform:translateY(-100%);transition:transform .3s ease;
 font-family:"DM Sans",system-ui,sans-serif}
#pwaOfflineBar.in,#pwaUpdateBar.in{transform:none}
#pwaOfflineBar{background:#3d353c;color:#fff}
#pwaUpdateBar{background:var(--gold,#c99a3f);color:#2b2008;display:flex;align-items:center;justify-content:center;gap:12px}
#pwaUpdateBar button{border:none;border-radius:999px;background:#2b2008;color:#fff;font-family:inherit;
 font-size:12px;font-weight:700;padding:5px 14px;cursor:pointer}
@media (display-mode: standalone){#pwaInstallCard{display:none!important}}`;
    document.head.appendChild(s);
  }

  // ---------- state + listeners (for custom install buttons) ----------
  let deferredPrompt = null;
  const listeners = new Set();
  function emit() { listeners.forEach(fn => { try { fn(api.state()); } catch (e) { console.error(e); } }); }

  const api = {
    APP_NAME,
    isIOS,
    isStandalone,
    // "prompt" = native install available, "ios" = show manual steps,
    // "installed" = already running as an app, "unavailable" = neither.
    state() {
      if (isStandalone()) return "installed";
      if (deferredPrompt) return "prompt";
      if (isIOS) return "ios";
      return "unavailable";
    },
    canInstall() { return !!deferredPrompt; },
    async promptInstall() {
      const p = deferredPrompt;
      if (!p) return "unavailable";
      deferredPrompt = null;
      p.prompt();
      const choice = await p.userChoice;
      emit();
      return choice && choice.outcome; // "accepted" | "dismissed"
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  };
  root.RadhaPWA = api;

  // ---------- 1. register the service worker ----------
  if ("serviceWorker" in navigator) {
    // When a new worker takes control, reload once so the page and its
    // cached assets match.
    let reloading = false;
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) { hadController = true; return; } // first install, not an update
      if (reloading) return;
      reloading = true;
      location.reload();
    });

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js")
        .then(reg => {
          if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg);
          reg.addEventListener("updatefound", () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener("statechange", () => {
              if (sw.state === "installed" && navigator.serviceWorker.controller) {
                showUpdateBar(reg);
              }
            });
          });
        })
        .catch(err => console.error("SW registration failed:", err));
    });
  }

  // ---------- 2. install prompt ----------
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();          // suppress the browser's own mini-bar
    deferredPrompt = e;
    emit();
    if (!recentlyDismissed(Date.now(), localStorage)) setTimeout(showInstallCard, 2500);
  });

  window.addEventListener("appinstalled", () => {
    if (typeof window.TRACK === "function") window.TRACK("install");
    deferredPrompt = null;
    removeEl("pwaInstallCard");
    emit();
  });

  function dismissCard(card) {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { /* storage blocked */ }
    card.classList.remove("in");
    setTimeout(() => removeEl("pwaInstallCard"), 300);
  }

  function showInstallCard() {
    if (!deferredPrompt || document.getElementById("pwaInstallCard")) return;
    injectStyles();
    const card = document.createElement("div");
    card.id = "pwaInstallCard";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", `Install ${APP_NAME}`);
    card.innerHTML = `
      <div class="pwa-ico">R</div>
      <div class="pwa-copy">
        <strong>Install ${APP_NAME}</strong>
        <span>Add it to your home screen or desktop for one-tap shopping</span>
      </div>
      <button class="pwa-yes" id="pwaYes">Install</button>
      <button class="pwa-no" id="pwaNo" aria-label="Dismiss">×</button>`;
    document.body.appendChild(card);
    requestAnimationFrame(() => card.classList.add("in"));

    document.getElementById("pwaYes").onclick = async () => {
      card.classList.remove("in");
      await api.promptInstall();
      setTimeout(() => removeEl("pwaInstallCard"), 300);
    };
    document.getElementById("pwaNo").onclick = () => dismissCard(card);
  }

  // iOS/Safari never fires beforeinstallprompt — show manual instructions.
  function showIOSCard() {
    if (document.getElementById("pwaInstallCard")) return;
    injectStyles();
    const card = document.createElement("div");
    card.id = "pwaInstallCard";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", `Install ${APP_NAME}`);
    card.innerHTML = `
      <div class="pwa-ico">R</div>
      <div class="pwa-copy">
        <strong>Add ${APP_NAME} to Home Screen</strong>
        <span>Tap Share <b>⎋</b> then “Add to Home Screen”</span>
      </div>
      <button class="pwa-no" id="pwaNo" aria-label="Dismiss">×</button>`;
    document.body.appendChild(card);
    requestAnimationFrame(() => card.classList.add("in"));
    document.getElementById("pwaNo").onclick = () => dismissCard(card);
  }
  api.showIOSInstructions = showIOSCard;

  // ---------- 2b. declarative install slots ----------
  // <div data-pwa-install hidden>
  //   <p data-pwa-install-text></p>
  //   <button data-pwa-install-btn>Install app</button>
  // </div>
  // Shown only when installing is possible; stays hidden once installed.
  function renderInstallSlots() {
    const state = api.state();
    document.querySelectorAll("[data-pwa-install]").forEach(slot => {
      const btn = slot.querySelector("[data-pwa-install-btn]");
      const text = slot.querySelector("[data-pwa-install-text]");
      slot.hidden = !(state === "prompt" || state === "ios");
      if (text) {
        text.textContent = state === "ios"
          ? `On iPhone/iPad: tap Share ⎋ in Safari, then “Add to Home Screen”.`
          : `Add ${APP_NAME} to your home screen or desktop — opens like an app, in one tap.`;
      }
      if (btn && !btn._pwaBound) {
        btn._pwaBound = true;
        btn.addEventListener("click", () => {
          if (api.state() === "ios") showIOSCard();
          else api.promptInstall();
        });
      }
      if (btn) btn.textContent = state === "ios" ? "Show me how" : "Install app";
    });
  }
  api.onChange(renderInstallSlots);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderInstallSlots);
  } else {
    renderInstallSlots();
  }

  if (isIOS && !isStandalone() && !recentlyDismissed(Date.now(), localStorage)) {
    window.addEventListener("load", () => setTimeout(showIOSCard, 3500));
  }

  // ---------- 3. offline banner ----------
  function setOnlineState() {
    const offline = !navigator.onLine;
    let bar = document.getElementById("pwaOfflineBar");
    if (offline && !bar) {
      injectStyles();
      bar = document.createElement("div");
      bar.id = "pwaOfflineBar";
      bar.setAttribute("role", "status");
      bar.textContent = "You're offline — some things may not load";
      document.body.appendChild(bar);
      requestAnimationFrame(() => bar.classList.add("in"));
    } else if (!offline && bar) {
      bar.classList.remove("in");
      setTimeout(() => removeEl("pwaOfflineBar"), 300);
    }
  }
  window.addEventListener("online", setOnlineState);
  window.addEventListener("offline", setOnlineState);
  window.addEventListener("load", setOnlineState);

  // ---------- 4. update notice ----------
  function showUpdateBar(reg) {
    if (document.getElementById("pwaUpdateBar")) return;
    injectStyles();
    const bar = document.createElement("div");
    bar.id = "pwaUpdateBar";
    bar.setAttribute("role", "status");
    bar.innerHTML = `<span>A new version is available</span><button id="pwaReload">Refresh</button>`;
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add("in"));
    document.getElementById("pwaReload").onclick = () => {
      // The controllerchange listener above reloads once the new worker
      // has taken over; fall back to a plain reload if nothing is waiting.
      if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
      else location.reload();
    };
  }

  function removeEl(id) {
    const el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

})(typeof window !== "undefined" ? window : globalThis);
