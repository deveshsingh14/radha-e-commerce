/* ============================================================
   Radha E-Commerce storefront — explore feed engine
   Serves both storefront pages; <body data-section> picks which:
     index.html     -> "general"   (everything except jewellery)
     jewellery.html -> "jewellery" (Jewellery & Bangles)
   Section rules live in section.js.
   Talks to the same backend as before:
     GET /products, /categories
     POST/GET/PUT/DELETE /cart      (auth)
     POST/GET/DELETE /wishlist     (auth)
     POST /auth/login, /auth/register
   Wishlist is now ONE system: the API one. Hearts everywhere
   reflect GET /wishlist, keyed by product id.
   ============================================================ */

// API_URL, esc(), NO_IMAGE_PLACEHOLDER and imgSrc() live in api.js.
// SECTIONS / filterProductsBySection / categoriesForSection live in section.js.

// ---------- state ----------
let PRODUCTS = [];          // ALL normalized products (wishlist/cart/sheet lookups)
let SECTION = sectionFromDocument(document); // "general" | "jewellery"
let SECTION_PRODUCTS = [];  // products shown on this page
let productsByCategory = null; // index for "More like this" (this section)
let CATEGORIES = [];        // all categories
let SECTION_CATEGORIES = []; // categories shown on this page
let WISHLIST = [];          // raw wishlist rows {id, productId, product}
// Saved items: instant hearts, synced in the background (wishlist.js).
const WISH = createWishlistSync({
  apiUrl: API_URL,
  headers: json => authHeaders(json),
  onChange: id => updateHeartUI(id),
  onError: err => {
    if (err && err.status === 401) { handle401({ status: 401 }); return; }
    toast("Couldn't update your saved items — please try again", "err");
  }
});
const HEART_SVG = `<svg class="heart-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 20.6s-7.4-4.5-9.6-9.1C.9 8.2 2.6 4.3 6.3 4c2.2-.2 4.1 1 5.7 3 1.6-2 3.5-3.2 5.7-3 3.7.3 5.4 4.2 3.9 7.5-2.2 4.6-9.6 9.1-9.6 9.1z"/></svg>`;
let activeCategory = "";    // category name; "" = all
let searchQuery = "";
let isLogin = true;

// ---------- helpers ----------
function normalizeProduct(p) {
  const categoryList = (p.categories || [])
    .map(c => c.category && c.category.name).filter(Boolean);
  const _searchIndex = `${p.title} ${p.description || ""} ${p.keywords || ""} ${categoryList.join(" ")}`.toLowerCase();
  return { ...p, categoryList, category: categoryList[0] || "", jewellery: isJewelleryProduct(p), _searchIndex };
}

// Deterministic image height per pin so the masonry feels organic
// but doesn't reshuffle on every render.
const HEIGHTS = [220, 300, 260, 340, 240, 310, 280, 380];
function pinHeight(id) { return HEIGHTS[id % HEIGHTS.length]; }

// Emoji avatar for a category story, by name keywords.
function categoryEmoji(name) {
  const n = name.toLowerCase();
  if (n.includes("bride") || n.includes("chooda") || n.includes("dulhan")) return "👰";
  if (n.includes("earring")) return "💎";
  if (n.includes("necklace")) return "📿";
  if (n.includes("bangle") || n.includes("bracelet")) return "⚜️";
  if (n.includes("gold") || n.includes("gram")) return "🥇";
  if (n.includes("bindi")) return "🔴";
  if (n.includes("nose")) return "💫";
  if (n.includes("makeup") || n.includes("foundation") || n.includes("lip")) return "💄";
  if (n.includes("skin") || n.includes("serum") || n.includes("care")) return "🌸";
  if (n.includes("bhabhi") || n.includes("gift") || n.includes("combo")) return "🎁";
  return "";
}

// ============================================================
//  LOADING
// ============================================================
// ---------- catalogue (catalogue.js keeps a copy for instant repeat visits) ----------
function applyCatalogue(rawProducts, rawCategories) {
  PRODUCTS = rawProducts.map(normalizeProduct);
  CATEGORIES = rawCategories;
  SECTION_PRODUCTS = filterProductsBySection(PRODUCTS, SECTION);
  SECTION_CATEGORIES = categoriesForSection(CATEGORIES, SECTION);
  productsByCategory = null; // invalidate derived caches
  categoryCoverMap = null;
}

function renderCatalogue() {
  renderStories();
  applyFilters();
}

async function fetchCatalogue() {
  // CHANGED: /products is paginated (default limit=50); request a limit
  // generous enough for the whole catalogue, since the storefront
  // filters/searches client-side.
  const [prodRes, catRes] = await Promise.all([
    fetchWithTimeout(`${API_URL}/products?limit=200`),
    fetchWithTimeout(`${API_URL}/categories`)
  ]);
  if (!prodRes.ok || !catRes.ok) throw new Error(`catalogue ${prodRes.status}/${catRes.status}`);
  const products = (await prodRes.json()).items;
  const categories = await catRes.json();
  if (!Array.isArray(products) || !Array.isArray(categories)) throw new Error("catalogue: unexpected response");
  return { products, categories };
}

// Render's free plan sleeps when idle; the first request then waits for it
// to start. Tell people what's happening instead of showing grey boxes.
function setWakeNotice(show) {
  const el = document.getElementById("wakeNotice");
  if (el) el.hidden = !show;
}

function showLoadError() {
  document.getElementById("masonry").innerHTML = `
    <div class="empty-feed" style="column-span:all"><div class="big">⚠</div>
      <h3>Couldn't reach the store</h3>
      <p>Check your connection and try again.</p>
      <button class="btn-solid" style="flex:none" id="retryLoad">Try again</button>
    </div>`;
  document.getElementById("retryLoad").addEventListener("click", () => boot());
}

async function boot() {
  const cached = readCatalogue(localStorage);
  if (cached) {
    applyCatalogue(cached.products, cached.categories);
    applyLaunchCategory();
    renderCatalogue();          // instant: last known catalogue
  } else {
    renderSkeletons();
  }

  const wakeTimer = setTimeout(() => setWakeNotice(true), 4000);
  try {
    const fresh = await fetchCatalogue();
    if (catalogueChanged(cached, fresh.products, fresh.categories)) {
      const y = window.scrollY;
      applyCatalogue(fresh.products, fresh.categories);
      if (!cached) applyLaunchCategory();
      // keep the visitor's category if it still exists in this section
      if (activeCategory && !SECTION_CATEGORIES.some(c => c.name === activeCategory)) activeCategory = "";
      renderCatalogue();        // keeps search text and sort order
      if (cached) window.scrollTo(0, y);
      writeCatalogue(localStorage, fresh.products, fresh.categories);
    }
  } catch (e) {
    console.error("Error loading storefront data:", e);
    if (!cached) showLoadError();
    else toast("Showing saved products — couldn't refresh right now");
  } finally {
    clearTimeout(wakeTimer);
    setWakeNotice(false);
  }
  refreshWishlist();
  refreshCartCount();
  updateAuthUI();
}

function renderSkeletons() {
  const m = document.getElementById("masonry");
  m.innerHTML = Array.from({ length: 10 }, (_, i) =>
    `<div class="skel" style="height:${HEIGHTS[i % HEIGHTS.length]}px"></div>`).join("");
}

// ============================================================
//  CATEGORY STORIES + CHIPS  (driven by the real DB categories)
// ============================================================
let categoryCoverMap = null;
function categoryCover(cat) {
  // First product image in this category becomes the story face.
  // Precompute map to avoid O(N*M) lookup
  if (!categoryCoverMap) {
    categoryCoverMap = {};
    for (const pr of SECTION_PRODUCTS) {
      if (!pr.categoryList) continue;
      for (const c of pr.categoryList) {
        if (!categoryCoverMap[c]) {
          categoryCoverMap[c] = imgSrc(pr.image, IMG.story);
        }
      }
    }
  }
  return categoryCoverMap[cat.name] || "";
}
function renderStories() {
  const rail = document.getElementById("storiesRail");
  const stories = [{ name: "", label: SECTIONS[SECTION].allLabel }].concat(
    SECTION_CATEGORIES.map(c => ({ name: c.name, label: c.name }))
  );
  rail.innerHTML = stories.map(s => {
    let face;
    if (s.name === "") {
      face = `<div class="face">✨</div>`;
    } else {
      const cover = categoryCover(s);
      const emoji = categoryEmoji(s.name);
      face = cover
        ? `<img class="face" src="${esc(cover)}" alt="">`
        : emoji
          ? `<div class="face">${emoji}</div>`
          : `<div class="face letter">${esc(s.name[0].toUpperCase())}</div>`;
    }
    return `
      <button class="story ${activeCategory === s.name ? "active" : ""}" data-cat="${esc(s.name)}">
        <div class="ring"><div class="ring-inner">${face}</div></div>
        <span class="s-label">${esc(s.label)}</span>
      </button>`;
  }).join("");
  rail.querySelectorAll(".story").forEach(btn =>
    btn.addEventListener("click", () => setCategory(btn.dataset.cat)));
}
// A category chip can point at the other section (e.g. a product tagged
// both "Accessories" and "Bangles"): go to that page instead of showing
// an empty feed here.
function goToCategory(cat) {
  const target = sectionOfCategoryName(CATEGORIES, cat);
  if (cat && target !== SECTION) {
    window.location.href = `${SECTIONS[target].page}?category=${encodeURIComponent(cat)}`;
    return;
  }
  setCategory(cat);
}
function applyLaunchCategory() {
  const cat = new URLSearchParams(window.location.search).get("category");
  if (cat && SECTION_CATEGORIES.some(c => c.name === cat)) activeCategory = cat;
}
function setCategory(cat) {
  activeCategory = cat;
  renderStories();
  applyFilters();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function resetFeed() {
  activeCategory = "";
  searchQuery = "";
  document.getElementById("searchInput").value = "";
  renderStories(); applyFilters();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================================
//  FEED
// ============================================================
function applyFilters() {
  let items = [...SECTION_PRODUCTS];

  if (activeCategory) {
    items = items.filter(p => p.categoryList.includes(activeCategory));
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter(p => p._searchIndex.includes(q));
  }

  const sort = document.getElementById("sortSelect").value;
  if (sort === "priceAsc") items.sort((a, b) => a.price - b.price);
  else if (sort === "priceDesc") items.sort((a, b) => b.price - a.price);
  else items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  renderFeed(items);
}

function createProductCard(p) {
  const h = pinHeight(p.id);
  const saved = WISH.isSaved(p.id);
  const out = p.stock <= 0;
  return `
  <div class="pin" data-id="${p.id}">
    <div class="pin-img" style="height:${h}px" onclick="handlePinClick(event, ${p.id})">
      <img src="${esc(imgSrc(p.image, IMG.card))}" alt="${esc(p.title)}" loading="lazy" decoding="async" style="height:${h}px">
      ${out ? `<div class="pin-out">Out of stock</div>` : ""}
      <div class="pin-veil">
        <div class="veil-top">
          <button class="save-btn ${saved ? "saved" : ""}" onclick="toggleSave(event, ${p.id})">
            ${saved ? "Saved" : "Save"}
          </button>
        </div>
        <div class="veil-bottom">
          <button class="veil-round" title="Add to bag" onclick="quickAdd(event, ${p.id})">🛍</button>
          <button class="veil-round" title="Share" onclick="shareProduct(event, ${p.id})">↗</button>
        </div>
      </div>
      <div class="burst" id="burst-${p.id}">♥</div>
    </div>
    <div class="pin-meta">
      <div class="pin-title">${esc(p.title)}</div>
      <div class="pin-row">
        <span class="pin-price">${inr(p.price)}</span>
        <span class="pin-cat">${esc(p.category)}</span>
      </div>
    </div>
  </div>`;
}

function filtersActive() { return !!(activeCategory || searchQuery); }

function renderFeed(items) {
  const m = document.getElementById("masonry");
  const end = document.getElementById("feedEnd");

  if (!items.length) {
    m.innerHTML = `
      <div class="empty-feed" style="column-span:all">
        <div class="big">${SECTION === "jewellery" ? "💍" : "⌕"}</div>
        <h3>${esc(filtersActive() ? "Nothing here yet" : SECTIONS[SECTION].emptyTitle)}</h3>
        <p>${esc(filtersActive() ? "Try a different search or category." : SECTIONS[SECTION].emptyText)}</p>
        ${filtersActive()
          ? `<button class="btn-solid" style="flex:none" onclick="resetFeed()">Back to ${esc(SECTIONS[SECTION].allLabel)}</button>`
          : SECTION === "jewellery"
            ? `<a class="btn-solid" style="flex:none;text-decoration:none;display:inline-block" href="index.html">Shop the main store</a>`
            : ""}
      </div>`;
    end.style.display = "none";
    return;
  }

  m.innerHTML = items.map(createProductCard).join("");

  end.style.display = "block";

  // staggered reveal
  const obs = new IntersectionObserver(entries => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) {
        setTimeout(() => e.target.classList.add("in"), (i % 6) * 55);
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.05 });
  m.querySelectorAll(".pin").forEach(el => obs.observe(el));
}

// single click opens the sheet; double click = save (Instagram style)
let lastTap = { id: null, t: 0 };
function handlePinClick(e, id) {
  const now = Date.now();
  if (lastTap.id === id && now - lastTap.t < 300) {
    // double tap
    lastTap = { id: null, t: 0 };
    clearTimeout(handlePinClick._single);
    doubleTapSave(id);
    return;
  }
  lastTap = { id, t: now };
  clearTimeout(handlePinClick._single);
  handlePinClick._single = setTimeout(() => openSheet(id), 300);
}
function doubleTapSave(id) {
  const burst = document.getElementById("burst-" + id);
  if (burst) {
    burst.classList.remove("go");
    void burst.offsetWidth; // restart animation
    burst.classList.add("go");
  }
  if (!WISH.isSaved(id)) toggleWishlist(id);
}

// ============================================================
//  SEARCH
// ============================================================
const searchInput = document.getElementById("searchInput");
searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim();
  applyFilters();
});
function clearSearch() {
  searchInput.value = ""; searchQuery = ""; applyFilters(); searchInput.focus();
}
function focusSearch() {
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => searchInput.focus(), 250);
}

// ============================================================
//  PRODUCT SHEET
// ============================================================
// ADDED: "More like this" — up to 4 products sharing a category,
// shown inside the sheet. Clicking one opens its sheet.
function moreLikeThisHTML(p) {
  if (!productsByCategory) {
    productsByCategory = {};
    for (const prod of SECTION_PRODUCTS) {
      if (!prod.categoryList) continue;
      for (const c of prod.categoryList) {
        if (!productsByCategory[c]) productsByCategory[c] = [];
        productsByCategory[c].push(prod);
      }
    }
  }

  const similar = [];
  const seen = new Set([p.id]);

  if (p.categoryList) {
    for (const c of p.categoryList) {
      const list = productsByCategory[c] || [];
      for (const x of list) {
        if (!seen.has(x.id)) {
          similar.push(x);
          seen.add(x.id);
          if (similar.length >= 4) break;
        }
      }
      if (similar.length >= 4) break;
    }
  }

  if (!similar.length) return "";
  return `
    <div class="mlt">
      <h4 class="mlt-title">More like this</h4>
      <div class="mlt-row">
        ${similar.map(s => `
          <button class="mlt-card" onclick="openSheet(${s.id})">
            <img src="${esc(imgSrc(s.image, IMG.similar))}" alt="${esc(s.title)}" loading="lazy" decoding="async">
            <span class="mlt-name">${esc(s.title)}</span>
            <span class="mlt-price">${inr(s.price)}</span>
          </button>`).join("")}
      </div>
    </div>`;
}

function openSheet(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  const saved = WISH.isSaved(p.id);
  const stockCls = p.stock <= 0 ? "out" : p.stock <= 5 ? "low" : "ok";
  const stockTxt = p.stock <= 0 ? "Out of stock" : p.stock <= 5 ? `Only ${p.stock} left` : "In stock";

  document.getElementById("sheetGrid").innerHTML = `
    <div class="sh-img"><img src="${esc(imgSrc(p.image, IMG.detail))}" alt="${esc(p.title)}" decoding="async"></div>
    <div class="sh-body">
      <span class="sh-cat">${esc(p.category || "Collection")}</span>
      <h2 class="sh-title">${esc(p.title)}</h2>
      <p class="sh-desc">${esc(p.description)}</p>
      <div class="sh-price-row">
        <span class="sh-price">${inr(p.price)}</span>
        <span class="sh-stock ${stockCls}">${stockTxt}</span>
      </div>
      <div class="sh-cats">
        ${p.categoryList.map(c =>
          `<button class="sh-chip" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}
      </div>
      <div class="sh-actions">
        <button class="btn-solid" ${p.stock <= 0 ? "disabled" : ""} onclick="addToCart(${p.id})">
          ${p.stock <= 0 ? "Out of stock" : "Add to bag · " + inr(p.price)}
        </button>
        <button type="button" class="btn-line heart-btn ${saved ? "saved" : ""}" id="sheetHeart" data-id="${p.id}"
          aria-pressed="${saved}" aria-label="${saved ? "Remove from saved" : "Save"}">${HEART_SVG}</button>
      </div>
      ${moreLikeThisHTML(p)}
    </div>`;
  document.getElementById("sheetHeart").addEventListener("click", () => toggleSaveFromSheet(p.id));
  // data-attribute + listener (not inline onclick) so a category name can
  // never be interpreted as script.
  document.querySelectorAll("#sheetGrid .sh-chip").forEach(btn =>
    btn.addEventListener("click", () => { closeSheet(); goToCategory(btn.dataset.cat); }));
  document.getElementById("productSheet").classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  document.getElementById("productSheet").classList.remove("open");
  document.body.style.overflow = "";
}
document.getElementById("productSheet").addEventListener("click", function (e) {
  if (e.target === this) closeSheet();
});

// ============================================================
//  WISHLIST  (one system: the API)
// ============================================================
async function refreshWishlist() {
  if (!token()) { WISHLIST = []; WISH.clear(); updateWishCount(); return; }
  try {
    const res = await fetch(`${API_URL}/wishlist`, { headers: authHeaders() });
    if (handle401(res)) return;
    if (!res.ok) return;
    WISHLIST = await res.json();
    WISH.loadFromServer(WISHLIST);
    updateWishCount();
    WISH.ids().forEach(updateHeartUI);
  } catch (e) {
    console.error("Error refreshing wishlist:", e);
    toast("Couldn't refresh wishlist");
  }
}
function updateWishCount() {
  const el = document.getElementById("wishCount");
  const n = WISH.count();
  el.textContent = n || "";
  el.dataset.zero = n ? "0" : "1";
}
// Update every heart / "Save" button for one product, in place (no feed re-render).
function updateHeartUI(productId) {
  const saved = WISH.isSaved(productId);
  const h = document.getElementById("sheetHeart");
  if (h && Number(h.dataset.id) === productId) {
    h.classList.toggle("saved", saved);
    h.setAttribute("aria-pressed", String(saved));
    h.setAttribute("aria-label", saved ? "Remove from saved" : "Save");
  }
  document.querySelectorAll(`.pin[data-id="${Number(productId)}"] .save-btn`).forEach(b => {
    b.classList.toggle("saved", saved);
    b.textContent = saved ? "Saved" : "Save";
  });
  updateWishCount();
}
function popHeart(productId) {
  const els = [document.getElementById("sheetHeart"),
    ...document.querySelectorAll(`.pin[data-id="${Number(productId)}"] .save-btn`)];
  els.forEach(el => {
    if (!el || (el.id === "sheetHeart" && Number(el.dataset.id) !== productId)) return;
    el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop");
  });
}
function toggleSave(e, id) {
  e.stopPropagation();
  toggleWishlist(id);
}
function toggleSaveFromSheet(id) {
  toggleWishlist(id);
}
// Instant: the heart flips now; wishlist.js syncs with the server and
// collapses rapid repeat taps into at most two requests.
function toggleWishlist(productId) {
  if (!token()) {
    // remembered in this tab only; saved to the account right after login
    rememberPendingSave(sessionStorage, productId);
    toast("Log in to save this — we'll keep it for you ♥");
    openAuth();
    return;
  }
  const saved = WISH.toggle(productId);
  popHeart(productId);
  if (saved && navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* not supported */ } }
  toast(saved ? "Saved ♥" : "Removed from saved");
  if (!saved) {
    WISHLIST = WISHLIST.filter(w => (w.productId ?? w.product?.id) !== productId);
    if (document.getElementById("wishBack").classList.contains("open")) renderWishlistDrawer();
  }
}

function openWishlist() {
  if (!token()) { openAuth(); return; }
  document.getElementById("wishBack").classList.add("open");
  refreshWishlist().then(renderWishlistDrawer);
}
function closeWishlist() { document.getElementById("wishBack").classList.remove("open"); }
function renderWishlistDrawer() {
  const box = document.getElementById("wishlistItems");
  if (!WISHLIST.length) {
    box.innerHTML = `<div class="drawer-empty"><div class="big">♡</div>
      Nothing saved yet.<br>Double-tap any product to save it.</div>`;
    return;
  }
  box.innerHTML = WISHLIST.map(w => {
    const p = w.product || {};
    return `
    <div class="line-item">
      <img src="${esc(imgSrc(p.image, IMG.thumb))}" alt="" loading="lazy">
      <div class="li-info">
        <div class="li-title">${esc(p.title)}</div>
        <div class="li-price">${inr(p.price)}</div>
        <div class="li-controls">
          <button class="li-move" onclick="moveToBag(${w.id}, ${p.id})">Move to bag</button>
          <button class="li-remove" onclick="toggleWishlist(${p.id})">Remove</button>
        </div>
      </div>
    </div>`;
  }).join("");
}
async function moveToBag(wishId, productId) {
  await addToCart(productId, true);
  if (WISH.isSaved(productId)) toggleWishlist(productId);
}

// ============================================================
//  CART
// ============================================================
async function refreshCartCount() {
  const el = document.getElementById("cartCount");
  if (!token()) { el.textContent = ""; el.dataset.zero = "1"; return; }
  try {
    const res = await fetch(`${API_URL}/cart`, { headers: authHeaders() });
    if (handle401(res)) return;
    if (!res.ok) return;
    const items = await res.json();
    const n = items.reduce((s, i) => s + i.quantity, 0);
    el.textContent = n || "";
    el.dataset.zero = n ? "0" : "1";
  } catch (e) {
    console.error("Error refreshing cart count:", e);
    toast("Couldn't refresh cart count");
  }
}
async function addToCart(productId, silent) {
  if (!token()) { openAuth(); return; }
  try {
    const res = await fetch(`${API_URL}/cart`, {
      method: "POST", headers: authHeaders(true),
      body: JSON.stringify({ productId, quantity: 1 })
    });
    if (handle401(res)) return;
    if (res.ok) {
      if (!silent) toast("Added to bag 🛍");
      refreshCartCount();
    }
  } catch (e) {
    console.error("Error adding to cart:", e);
    if (!silent) toast("Couldn't add to bag");
  }
}
function quickAdd(e, id) { e.stopPropagation(); addToCart(id); }

function openCart() {
  if (!token()) { openAuth(); return; }
  document.getElementById("cartBack").classList.add("open");
  loadCartDrawer();
}
function closeCart() { document.getElementById("cartBack").classList.remove("open"); }
async function loadCartDrawer() {
  const box = document.getElementById("cartItems");
  try {
    const res = await fetch(`${API_URL}/cart`, { headers: authHeaders() });
    if (handle401(res)) return;
    const items = await res.json();
    let total = 0;
    if (!items.length) {
      box.innerHTML = `<div class="drawer-empty"><div class="big">🛍</div>Your bag is empty.</div>`;
      document.getElementById("cartTotal").textContent = inr(0);
      return;
    }
    box.innerHTML = items.map(item => {
      const p = item.product || {};
      total += p.price * item.quantity;
      return `
      <div class="line-item">
        <img src="${esc(imgSrc(p.image, IMG.thumb))}" alt="" loading="lazy">
        <div class="li-info">
          <div class="li-title">${esc(p.title)}</div>
          <div class="li-price">${inr(p.price)}</div>
          <div class="li-controls">
            <div class="qty">
              <button onclick="changeQty(${item.id}, ${item.quantity - 1})">−</button>
              <span>${item.quantity}</span>
              <button onclick="changeQty(${item.id}, ${item.quantity + 1})">+</button>
            </div>
            <button class="li-remove" onclick="removeCartItem(${item.id})">Remove</button>
          </div>
        </div>
      </div>`;
    }).join("");
    document.getElementById("cartTotal").textContent = inr(total);
  } catch (e) {
    console.error("Error loading cart drawer:", e);
    toast("Couldn't load cart");
  }
}
async function changeQty(cartItemId, qty) {
  if (qty < 1) return removeCartItem(cartItemId);
  try {
    const res = await fetch(`${API_URL}/cart/${cartItemId}`, {
      method: "PUT", headers: authHeaders(true),
      body: JSON.stringify({ quantity: qty })
    });
    if (!res.ok) throw new Error("Failed to change quantity");
    loadCartDrawer(); refreshCartCount();
  } catch (e) {
    console.error("Error changing quantity:", e);
    toast("Couldn't update quantity");
  }
}
async function removeCartItem(cartItemId) {
  try {
    const res = await fetch(`${API_URL}/cart/${cartItemId}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new Error("Failed to remove item");
    loadCartDrawer(); refreshCartCount();
  } catch (e) {
    console.error("Error removing cart item:", e);
    toast("Couldn't remove item");
  }
}
function goToCheckout() { window.location.href = "checkout.html"; }

function backdropClose(e, which) {
  if (e.target !== e.currentTarget) return;
  which === "cart" ? closeCart() : closeWishlist();
}

// ============================================================
//  SHARE
// ============================================================
function shareProduct(e, id) {
  e.stopPropagation();
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  if (navigator.share) {
    navigator.share({ title: p.title, text: `${p.title} — ${inr(p.price)} at Radha E-Commerce` })
      .catch(() => {});
  } else {
    toast("Sharing isn't supported on this browser");
  }
}

// ============================================================
//  AUTH
// ============================================================
let googleAuthInitialized = false;
function openAuth() { 
  document.getElementById("authModal").classList.add("open"); 
  if (!googleAuthInitialized) {
    initGoogleAuth();
    googleAuthInitialized = true;
  }
}
function closeAuth(keepPending) {
  document.getElementById("authModal").classList.remove("open");
  if (!keepPending) forgetPendingSave(sessionStorage); // dismissed without logging in
}
document.getElementById("authModal").addEventListener("click", function (e) {
  if (e.target === this) closeAuth();
});
function toggleAuthMode() {
  isLogin = !isLogin;
  document.getElementById("authTitle").textContent = isLogin ? "Welcome back" : "Create account";
  document.getElementById("authSub").textContent = isLogin
    ? "Log in to save products and shop."
    : "Sign up to start saving your favourites.";
  document.getElementById("authBtn").textContent = isLogin ? "Log in" : "Sign up";
  document.getElementById("authName").style.display = isLogin ? "none" : "block";
  document.getElementById("forgotPwdLink").parentElement.style.display = isLogin ? "block" : "none";
  document.getElementById("authSwitchText").textContent = isLogin ? "New here?" : "Already have an account?";
  document.getElementById("authSwitchBtn").textContent = isLogin ? "Create account" : "Log in";
}
async function submitAuth() {
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const name = document.getElementById("authName").value.trim();
  if (!email || !password || (!isLogin && !name)) { toast("Please fill in all fields"); return; }

  const endpoint = isLogin ? "login" : "register";
  const body = isLogin ? { email, password } : { name, email, password };
  try {
    const res = await fetch(`${API_URL}/auth/${endpoint}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!isLogin && res.ok) {
      // registered — now log them in seamlessly
      isLogin = true; toggleAuthMode(); toggleAuthMode(); // resync labels
      const loginRes = await fetch(`${API_URL}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const loginData = await loginRes.json();
      if (loginData.token) return finishLogin(loginData.token);
    }

    if (data.token) return finishLogin(data.token);
    toast(data.message || "Something went wrong");
  } catch (e) {
    console.error("Error submitting authentication:", e);
    toast("Couldn't reach the server");
  }
}

async function initGoogleAuth() {
  try {
    const res = await fetch(`${API_URL}/auth/google-client-id`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.clientId) return;

    if (window.google && google.accounts) {
      google.accounts.id.initialize({
        client_id: data.clientId,
        callback: handleGoogleLogin,
        context: "signin",
        ux_mode: "popup",
        auto_prompt: false
      });
      google.accounts.id.renderButton(
        document.getElementById("googleBtnContainer"),
        { theme: "outline", size: "large", type: "standard", shape: "rectangular", text: "signin_with", logo_alignment: "left" }
      );
    }
  } catch (e) {
    console.error("Failed to load Google Client ID:", e);
  }
}

async function handleGoogleLogin(response) {
  try {
    const res = await fetch(`${API_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: response.credential })
    });
    
    const data = await res.json();
    if (data.token) {
      finishLogin(data.token);
    } else {
      toast(data.message || "Google login failed");
    }
  } catch (err) {
    console.error("Google auth error", err);
    toast("Couldn't reach the server");
  }
}

function finishLogin(jwt) {
  const pendingSave = takePendingSave(sessionStorage); // heart tapped before logging in
  localStorage.setItem("token", jwt);
  closeAuth(true);
  toast("Welcome ✨");
  let payload = null;
  try { payload = JSON.parse(atob(jwt.split(".")[1])); } catch (e) { console.error("Error decoding JWT:", e); }
  if (payload && (payload.role === "ADMIN" || payload.role === "OWNER")) { window.location.href = "admin.html"; return; }
  if (payload && payload.role === "DELIVERY_PARTNER") { window.location.href = "delivery.html"; return; }
  updateAuthUI();
  refreshWishlist().then(() => {
    applyFilters();
    if (pendingSave && !WISH.isSaved(pendingSave)) {
      WISH.set(pendingSave, true);
      popHeart(pendingSave);
      toast("Saved ♥ — find it under Saved");
    }
  });
  refreshCartCount();
}
async function logout() {
  await beforeLogout();
  localStorage.removeItem("token");
  WISH.clear(); WISHLIST = [];
  updateAuthUI(); updateWishCount(); refreshCartCount(); applyFilters();
  toast("Logged out");
}
// Role from the token, for showing links only — every server route checks
// the real role itself.
function tokenRole() {
  try { return JSON.parse(atob(String(token()).split(".")[1])).role || ""; } catch (e) { return ""; }
}
function updateAuthUI() {
  const authed = !!token();
  const portal = document.getElementById("portalBtn");
  if (portal) portal.style.display = authed && tokenRole() === "DELIVERY_PARTNER" ? "flex" : "none";
  document.getElementById("loginBtn").style.display = authed ? "none" : "flex";
  document.getElementById("logoutBtn").style.display = authed ? "flex" : "none";
  const acct = document.getElementById("accountBtn");
  if (acct) acct.style.display = authed ? "flex" : "none";
}


// Home-screen shortcut "Saved items" opens index.html?open=saved.
// The wishlist API returns full product rows, so this doesn't need to
// wait for the catalogue to load.
function handleLaunchParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("open") === "saved") openWishlist();
}

// ---------- boot ----------
document.getElementById("searchInput").placeholder = SECTIONS[SECTION].searchPlaceholder;
boot();
handleLaunchParams();

if (typeof module !== "undefined") {
  module.exports = {
  };
}
