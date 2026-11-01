// Centralized API_URL / esc() / imgSrc() to replace duplicated logic
// across store.js, admin.js, checkout.js, account.js.

const API_URL = "https://project-dev-vat-non-prod-01.onrender.com";

function inr(n) { return "₹" + Number(n || 0).toLocaleString("en-IN"); }

function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Uploaded images are Cloudinary's absolute URLs; a handful of legacy
// products still carry a relative /uploads/... path from before that
// migration, so prefix the API origin for anything that isn't already
// absolute.
const NO_IMAGE_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%23f4ede4'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='14' fill='%23b8a68f' text-anchor='middle' dominant-baseline='middle'%3ENo image%3C/text%3E%3C/svg%3E";
// Cloudinary serves originals (often 0.5–0.8 MB each) unless asked for a
// size. With a width, uploads get a resized, auto-format (WebP/AVIF),
// auto-quality version — typically 15–50× smaller. Only plain upload URLs
// (".../image/upload/v123/...") are rewritten; anything already transformed,
// non-Cloudinary or legacy is left as is.
const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(v\d+\/.+)$/;
const IMG = { thumb: 200, story: 160, card: 600, similar: 300, detail: 1000 };

function imgSrc(image, width) {
  if (!image) return NO_IMAGE_PLACEHOLDER;
  const url = image.startsWith("http") ? image : API_URL + image;
  const w = Math.round(Number(width));
  if (!w || w <= 0) return url;
  const m = CLOUDINARY_UPLOAD.exec(url);
  return m ? `${m[1]}f_auto,q_auto,c_limit,w_${w}/${m[2]}` : url;
}

// Order lines keep a title/image snapshot (the product may since have been
// edited or deleted). Prefer the snapshot, fall back to the live product.
function itemTitle(i) { return (i && (i.title || (i.product && i.product.title))) || "Product (no longer listed)"; }
function itemImage(i) { return (i && (i.image || (i.product && i.product.image))) || null; }

function handle401(res) {
  if (res && res.status === 401 && localStorage.getItem("token")) {
    localStorage.removeItem("token");

    // store.js specific reset
    if (typeof savedProductIds !== 'undefined') savedProductIds = new Set();
    if (typeof WISHLIST !== 'undefined') WISHLIST = [];

    if (typeof updateAuthUI === 'function') updateAuthUI();
    if (typeof updateWishCount === 'function') updateWishCount();
    if (typeof refreshCartCount === 'function') refreshCartCount();
    if (typeof applyFilters === 'function') applyFilters();

    if (typeof toast === 'function') {
      toast("Session expired — please log in again");
    }

    if (typeof openAuth === 'function') {
      openAuth();
    } else {
      setTimeout(() => (window.location.href = "index.html"), 1200);
    }
    return true;
  }
  return false;
}

function token() {
  return localStorage.getItem("token");
}

function authHeaders(json) {
  const h = { Authorization: `Bearer ${token()}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function toast(msg, kind = "ok") {
  const t = document.getElementById("toast");
  if (!t) return alert(msg);
  t.textContent = msg;
  t.className = "show " + kind;
  clearTimeout(t._h);
  t._h = setTimeout(() => {
    t.className = kind;
    t.classList.remove("show");
  }, 2500);
}

// Every logout calls this first: it unsubscribes this device from order
// notifications (needs the token, so it must run before the token is
// removed). Capped at 1.5s and never throws — logout must always work.
async function beforeLogout() {
  try {
    if (typeof window !== "undefined" && window.RadhaPush) {
      await Promise.race([window.RadhaPush.disable(), new Promise(r => setTimeout(r, 1500))]);
    }
  } catch (e) { /* ignore */ }
}

function catchErr(e, msg, el = null) {
  console.error("Error:", e);
  if (el) el.textContent = msg;
  else if (msg) toast(msg, "err");
}

if (typeof module !== "undefined") {
  module.exports = {
    API_URL,
    inr,
    esc,
    imgSrc,
    IMG,
    handle401,
    token,
    authHeaders,
    toast,
    catchErr,
    beforeLogout,
    itemTitle,
    itemImage
  };
}
