/* ============================================================
   Saved items (wishlist) — instant, tap-safe hearts.

   Tapping a heart changes it IMMEDIATELY; the server is updated in the
   background. Each product has at most one request in flight: taps made
   meanwhile only change what the user wants, and when the request
   finishes it reconciles once more if needed. So any number of quick
   taps = at most 2 requests, and the final state is the last tap.
   If the server refuses, the heart returns to the real saved state.

   createWishlistSync({ apiUrl, fetchFn, headers, onChange, onError })
     .isSaved(id) / .count() / .ids()
     .toggle(id) -> new wanted state (boolean)
     .set(id, wanted)
     .loadFromServer(rows)  // rows of GET /wishlist
     .clear()               // logout
     .idle()                // promise: all pending syncs finished (tests)
   ============================================================ */

function createWishlistSync(opts) {
  const apiUrl = opts.apiUrl;
  const fetchFn = opts.fetchFn || ((...a) => fetch(...a));
  const headers = opts.headers || (() => ({}));
  const onChange = opts.onChange || (() => {});
  const onError = opts.onError || (() => {});

  const server = new Map();   // productId -> wishlist row id (what the server has)
  const wanted = new Map();   // productId -> boolean (what the user wants, while syncing)
  const running = new Map();  // productId -> promise of the sync loop

  const rowProductId = r => (r.productId ?? (r.product && r.product.id));

  function isSaved(id) { return wanted.has(id) ? wanted.get(id) : server.has(id); }
  function ids() {
    const all = new Set([...server.keys(), ...wanted.keys()]);
    return [...all].filter(isSaved);
  }

  function set(id, want) {
    const before = isSaved(id);
    wanted.set(id, !!want);
    if (before !== !!want) onChange(id, !!want);
    if (!running.has(id)) {
      const p = syncLoop(id).finally(() => running.delete(id));
      running.set(id, p);
    }
    return !!want;
  }
  function toggle(id) { return set(id, !isSaved(id)); }

  async function learnIdFromServer(id) {
    const res = await fetchFn(`${apiUrl}/wishlist`, { headers: headers() });
    if (!res.ok) throw new Error(`wishlist ${res.status}`);
    for (const r of await res.json()) {
      if (rowProductId(r) === id) { server.set(id, r.id); return; }
    }
  }

  async function syncLoop(id) {
    try {
      for (let guard = 0; guard < 4; guard++) {
        const want = wanted.get(id);
        if (want === undefined || want === server.has(id)) break;
        if (want) {
          const res = await fetchFn(`${apiUrl}/wishlist`, {
            method: "POST", headers: headers(true), body: JSON.stringify({ productId: id })
          });
          if (res.ok) {
            const row = await res.json().catch(() => null);
            if (row && row.id) server.set(id, row.id); else await learnIdFromServer(id);
          } else if (res.status === 400) {
            await learnIdFromServer(id);            // already saved (another tab/device)
            if (!server.has(id)) throw new Error("save rejected");
          } else {
            throw Object.assign(new Error(`save failed (${res.status})`), { status: res.status });
          }
        } else {
          const rowId = server.get(id);
          const res = await fetchFn(`${apiUrl}/wishlist/${rowId}`, { method: "DELETE", headers: headers() });
          if (res.ok || res.status === 404) server.delete(id); // 404: already gone
          else throw Object.assign(new Error(`remove failed (${res.status})`), { status: res.status });
        }
      }
      const shown = isSaved(id);
      wanted.delete(id);
      if (shown !== server.has(id)) onChange(id, server.has(id));
    } catch (err) {
      const shown = isSaved(id);
      wanted.delete(id);                       // fall back to the real server state
      if (shown !== server.has(id)) onChange(id, server.has(id));
      onError(err, id);
    }
  }

  function loadFromServer(rows) {
    server.clear();
    for (const r of rows || []) {
      const pid = rowProductId(r);
      if (pid != null) server.set(pid, r.id);
    }
  }

  function clear() { server.clear(); wanted.clear(); }
  function idle() { return Promise.all([...running.values()]); }

  return { isSaved, ids, count: () => ids().length, toggle, set, loadFromServer, clear, idle,
    serverId: id => server.get(id), isSyncing: id => running.has(id) };
}

// ---------- "save after login" ----------
// A logged-out heart tap is remembered in THIS TAB only (sessionStorage):
// one product id, nothing sent to the server. After login it's saved to the
// account; closing the login window or 30 minutes passing discards it.
const PENDING_SAVE_KEY = "radha.pendingSave";
const PENDING_SAVE_MAX_AGE_MS = 30 * 60 * 1000;

function rememberPendingSave(storage, productId, now = Date.now()) {
  try { storage.setItem(PENDING_SAVE_KEY, JSON.stringify({ id: Number(productId), at: now })); return true; }
  catch (e) { return false; }
}
function takePendingSave(storage, now = Date.now()) {
  try {
    const raw = storage.getItem(PENDING_SAVE_KEY);
    storage.removeItem(PENDING_SAVE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || !Number.isInteger(v.id) || v.id <= 0 || typeof v.at !== "number" || now - v.at > PENDING_SAVE_MAX_AGE_MS || v.at > now + 60000) return null;
    return v.id;
  } catch (e) { return null; }
}
function forgetPendingSave(storage) { try { storage.removeItem(PENDING_SAVE_KEY); } catch (e) { /* ignore */ } }

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createWishlistSync, rememberPendingSave, takePendingSave, forgetPendingSave, PENDING_SAVE_KEY };
}
