/* ============================================================
   Catalogue cache for instant repeat visits.
   The last products + categories the API returned are kept in
   localStorage and shown immediately on the next visit, while fresh
   data loads (Render's free plan can take a while to wake up).
   - Raw API rows are stored (normalisation is redone on load).
   - Public catalogue only — never cart, wishlist or user data.
   - Prices and stock are always re-checked by the server when adding
     to the bag and at checkout, so a briefly stale view is safe.
   ============================================================ */

const CATALOGUE_KEY = "radha.catalogue.v1";
const CATALOGUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readCatalogue(storage, now = Date.now()) {
  try {
    const raw = storage && storage.getItem(CATALOGUE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || c.v !== 1 || !Array.isArray(c.products) || !Array.isArray(c.categories)) return null;
    if (typeof c.savedAt !== "number" || now - c.savedAt > CATALOGUE_MAX_AGE_MS || c.savedAt > now + 60000) return null;
    return { products: c.products, categories: c.categories, savedAt: c.savedAt };
  } catch (e) {
    return null; // blocked storage or corrupt JSON: behave as if nothing was saved
  }
}

function writeCatalogue(storage, products, categories, now = Date.now()) {
  try {
    storage.setItem(CATALOGUE_KEY, JSON.stringify({ v: 1, savedAt: now, products, categories }));
    return true;
  } catch (e) {
    return false; // quota exceeded / private mode: the site still works, just no instant start
  }
}

// True when freshly fetched data differs from what is on screen.
function catalogueChanged(cached, products, categories) {
  if (!cached) return true;
  return JSON.stringify(cached.products) !== JSON.stringify(products) ||
         JSON.stringify(cached.categories) !== JSON.stringify(categories);
}

// fetch() with a timeout; long by default because a cold start can take
// close to a minute.
function fetchWithTimeout(url, ms = 70000, opts = {}) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  return fetch(url, ctl ? { ...opts, signal: ctl.signal } : opts)
    .finally(() => { if (timer) clearTimeout(timer); });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CATALOGUE_KEY, CATALOGUE_MAX_AGE_MS, readCatalogue, writeCatalogue, catalogueChanged, fetchWithTimeout };
}
