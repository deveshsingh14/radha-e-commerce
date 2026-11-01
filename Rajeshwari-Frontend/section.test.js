/**
 * Section split: main "Radha E-Commerce" store vs "Jewellery & Bangles".
 */
const fs = require("fs");
const path = require("path");
const {
  SECTIONS, sectionFromDocument, isJewelleryProduct, productInSection,
  filterProductsBySection, categoriesForSection, sectionOfCategoryName
} = require("./section");

const cat = (id, name, isJewellery) => ({ id, name, ...(isJewellery === undefined ? {} : { isJewellery }) });
const prod = (id, cats) => ({ id, title: `P${id}`, categories: cats.map(c => ({ category: c })) });

const BANGLES = cat(1, "Bangles", true);
const EARRINGS = cat(2, "Earrings", true);
const SKIN = cat(3, "Skin care", false);
const ACCESS = cat(4, "Accessories", false);
const LEGACY = cat(5, "Old category"); // no flag yet (backend not migrated)

describe("product classification", () => {
  test("a product is jewellery if ANY of its categories is", () => {
    expect(isJewelleryProduct(prod(1, [BANGLES]))).toBe(true);
    expect(isJewelleryProduct(prod(2, [ACCESS, EARRINGS]))).toBe(true);
    expect(isJewelleryProduct(prod(3, [SKIN]))).toBe(false);
  });
  test("uncategorised and unflagged products stay in the main store", () => {
    expect(isJewelleryProduct(prod(4, []))).toBe(false);
    expect(isJewelleryProduct({ id: 5 })).toBe(false);
    expect(isJewelleryProduct(prod(6, [LEGACY]))).toBe(false);
  });
  test("only a strict boolean true counts", () => {
    expect(isJewelleryProduct(prod(7, [{ id: 9, name: "x", isJewellery: "true" }]))).toBe(false);
  });
});

describe("section filtering", () => {
  const products = [prod(1, [BANGLES]), prod(2, [SKIN]), prod(3, []), prod(4, [ACCESS, EARRINGS]), prod(5, [LEGACY])];

  test("home shows everything EXCEPT jewellery", () => {
    expect(filterProductsBySection(products, "general").map(p => p.id)).toEqual([2, 3, 5]);
  });
  test("jewellery page shows only jewellery", () => {
    expect(filterProductsBySection(products, "jewellery").map(p => p.id)).toEqual([1, 4]);
  });
  test("every product lands in exactly one section", () => {
    for (const p of products) {
      expect(productInSection(p, "general")).toBe(!productInSection(p, "jewellery"));
    }
  });
  test("uses the precomputed `jewellery` flag when present", () => {
    expect(productInSection({ jewellery: true, categories: [] }, "jewellery")).toBe(true);
  });
  test("categories split the same way", () => {
    const cats = [BANGLES, SKIN, EARRINGS, ACCESS, LEGACY];
    expect(categoriesForSection(cats, "jewellery").map(c => c.name)).toEqual(["Bangles", "Earrings"]);
    expect(categoriesForSection(cats, "general").map(c => c.name)).toEqual(["Skin care", "Accessories", "Old category"]);
  });
  test("before the backend ships the flag, the jewellery page is empty and home has everything", () => {
    const old = [cat(1, "Bangles"), cat(2, "Skin care")];
    expect(categoriesForSection(old, "jewellery")).toEqual([]);
    expect(categoriesForSection(old, "general")).toHaveLength(2);
  });
  test("sectionOfCategoryName routes cross-section chips", () => {
    expect(sectionOfCategoryName([BANGLES, SKIN], "Bangles")).toBe("jewellery");
    expect(sectionOfCategoryName([BANGLES, SKIN], "Skin care")).toBe("general");
    expect(sectionOfCategoryName([BANGLES, SKIN], "Unknown")).toBe("general");
  });
});

describe("page wiring", () => {
  test("sectionFromDocument reads <body data-section>", () => {
    document.body.dataset.section = "jewellery";
    expect(sectionFromDocument(document)).toBe("jewellery");
    document.body.dataset.section = "anything-else";
    expect(sectionFromDocument(document)).toBe("general");
    delete document.body.dataset.section;
    expect(sectionFromDocument(document)).toBe("general");
  });
  test("each section knows its page", () => {
    expect(SECTIONS.general.page).toBe("index.html");
    expect(SECTIONS.jewellery.page).toBe("jewellery.html");
  });
});

describe("index.html and jewellery.html", () => {
  const read = f => fs.readFileSync(path.join(__dirname, f), "utf8");
  const ids = html => [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]).sort();
  const index = read("index.html");
  const jewel = read("jewellery.html");

  test("share identical element ids (store.js needs them all)", () => {
    expect(ids(jewel)).toEqual(ids(index));
  });
  test("categories appear once: story circles only, no duplicate chip row", () => {
    for (const html of [index, jewel]) {
      expect(html).toMatch(/id="storiesRail"/);
      expect(html).not.toMatch(/id="chipBar"|class="chips"/);
      expect(html).toMatch(/id="sortSelect"/);
    }
  });
  test("declare their section", () => {
    expect(index).toMatch(/<body data-section="general">/);
    expect(jewel).toMatch(/<body data-section="jewellery">/);
  });
  test("load section.js, catalogue.js and wishlist.js before store.js", () => {
    for (const html of [index, jewel]) {
      for (const dep of ["catalogue.js", "wishlist.js", "masonry.js"]) {
        expect(html.indexOf(`src="${dep}"`)).toBeGreaterThan(-1);
        expect(html.indexOf(`src="${dep}"`)).toBeLessThan(html.indexOf('src="store.js"'));
      }
      expect(html.indexOf('src="section.js"')).toBeGreaterThan(-1);
      expect(html.indexOf('src="section.js"')).toBeLessThan(html.indexOf('src="store.js"'));
    }
  });
  test("bottom nav links the two pages, with the right item active", () => {
    const nav = html => html.slice(html.indexOf('<nav class="bottom-nav">'), html.indexOf("</nav>", html.indexOf('<nav class="bottom-nav">')));
    expect(nav(index)).toMatch(/<a class="bn-item" href="jewellery.html">.*#i-jewel.*<span>Jewellery<\/span><\/a>/);
    expect(nav(index)).toMatch(/bn-item active"[^>]*>.*#i-home.*<span>Home<\/span>/);
    expect(nav(jewel)).toMatch(/<a class="bn-item" href="index.html">.*#i-home.*<span>Home<\/span><\/a>/);
    expect(nav(jewel)).toMatch(/bn-item active"[^>]*>.*#i-jewel.*<span>Jewellery<\/span>/);
  });
  test("navigation uses the shared SVG icons (no emoji) and says Cart, not Bag", () => {
    for (const html of [index, jewel]) {
      const chrome = html.slice(html.indexOf("<header"), html.indexOf("</header>")) +
        html.slice(html.indexOf('<nav class="bottom-nav">'), html.indexOf("<!-- ============ PRODUCT SHEET"));
      expect(chrome).not.toMatch(/[\u{1F300}-\u{1FAFF}\u2302\u2315\u2665\u263A\u238B]/u);
      for (const id of ["i-home", "i-search", "i-heart", "i-cart", "i-user", "i-jewel"]) {
        expect(html).toMatch(new RegExp(`<symbol id="${id}"`));
      }
      expect(chrome).toMatch(/<span>Cart<\/span>/);
      expect(chrome).not.toMatch(/>Bag</);
    }
  });
  test("branding", () => {
    expect(index).toMatch(/<title>Radha E-Commerce<\/title>/);
    expect(index).toMatch(/Radha<em>E-Commerce<\/em>/);
    expect(jewel).toMatch(/<title>Jewellery &amp; Bangles — Radha E-Commerce<\/title>/);
    for (const f of ["index.html", "jewellery.html", "account.html", "checkout.html", "offline.html",
      "forgot-password.html", "reset-password.html", "admin.html", "delivery.html"]) {
      expect(read(f)).not.toMatch(/Bangles &amp; Jewellery|Bangles & Jewellery/);
    }
  });
  test("service worker precaches the jewellery page", () => {
    const sw = read("service-worker.js");
    expect(sw).toMatch(/"jewellery.html"/);
    expect(sw).toMatch(/"section.js"/);
  });
});
