/* ============================================================
   Radha Admin — dashboard logic (self-contained)
   Works against the existing backend:
     GET  /products                 GET  /orders/admin/all
     POST /products                 PUT  /orders/:id/status
     PUT  /products/:id             GET  /categories
     DELETE /products/:id           POST /categories
     POST /products/upload          DELETE /categories/:id
     GET  /users  (new userRoutes)  GET /users/:id/orders
   ============================================================ */

// API_URL, esc(), NO_IMAGE_PLACEHOLDER and imgSrc() live in api.js.
const LOW_STOCK = 5;

// ---------- auth guard ----------
document.body.style.display = "none";
let adminUser = null;

async function verifyAdmin() {
  const t = localStorage.getItem("token");
  if (!t) return false;
  try {
    const res = await fetch(`${API_URL}/users/me`, { headers: authHeaders() });
    if (!res.ok) return false;
    const user = await res.json();
    if (user.role !== "ADMIN" && user.role !== "OWNER") return false;
    adminUser = user;
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- state ----------
let PRODUCTS = [];
let ORDERS = [];
let CUSTOMERS = [];
let CATEGORIES = [];
let PINCODE_SETTING = { enabled: false, pincodes: [] };
let productById = {};
let orderById = {};
let charts = {};

// ---------- helpers ----------
function shortDate(d) { return d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"; }
async function api(path, opts) {
  const res = await fetch(`${API_URL}${path}`, opts);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

// Mirrors Rajeshwari-Backend/src/utils/orderStatus.js
const ORDER_STATUSES = ["Pending", "Shipped", "Out for Delivery", "Attempted", "Delivered", "Cancelled"];
const ROLE_LABELS = { ADMIN: "Admin", OWNER: "Owner", DELIVERY_PARTNER: "Delivery partner", CUSTOMER: "Customer" };

// Orders outlive customer accounts: when the account is deleted the order
// keeps its delivery details and a customerEmail snapshot.
function orderEmail(o) { return (o.user && o.user.email) || o.customerEmail || ""; }
function orderCustomer(o) { return o.fullName || (o.user && o.user.name) || orderEmail(o) || "—"; }
function deletedAccountTag(o) { return o.userId == null ? ` <span class="badge b-mute">Deleted account</span>` : ""; }

function statusBadge(s) {
  const map = { Delivered: "b-ok", Shipped: "b-info", "Out for Delivery": "b-info", Attempted: "b-warn", Pending: "b-warn", Cancelled: "b-bad" };
  return `<span class="badge ${map[s] || "b-mute"}">${esc(s || "—")}</span>`;
}
function stockBadge(stock) {
  if (stock <= 0) return `<span class="badge b-bad">Out of stock</span>`;
  if (stock <= LOW_STOCK) return `<span class="badge b-warn">Low</span>`;
  return `<span class="badge b-ok">In stock</span>`;
}
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ---------- navigation ----------
const titles = {
  dashboard: ["Overview", "Dashboard"], reports: ["Overview", "Reports"],
  products: ["Catalog", "Products"], addProduct: ["Catalog", "Add product"],
  categories: ["Catalog", "Categories"], orders: ["Commerce", "Orders"],
  payments: ["Commerce", "Payments"], customers: ["Commerce", "Customers"],
  deliveryAreas: ["Commerce", "Delivery areas"]
};
function showView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + view)?.classList.add("active");
  document.querySelectorAll(".nav-item").forEach(n =>
    n.classList.toggle("active", n.dataset.view === view));
  const [crumb, title] = titles[view] || ["", ""];
  document.getElementById("crumb").textContent = crumb;
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("sidebar").classList.remove("open");
  if (view === "reports") runReport();
}
document.querySelectorAll("[data-view]").forEach(el =>
  el.addEventListener("click", () => showView(el.dataset.view)));
function toggleSidebar() { document.getElementById("sidebar").classList.toggle("open"); }
async function adminLogout() {
  if (typeof beforeLogout === "function") await beforeLogout();
  localStorage.removeItem("token");
  window.location.href = "index.html";
}

// ============================================================
//  DATA LOADING
// ============================================================
async function loadAll() {
  try {
    // CHANGED: /products and /orders/admin/all are now paginated
    // (default limit=50); request a limit generous enough to still get
    // everything in one call, since the admin dashboard's tables/charts
    // assume the full list today.
    const [products, orders, customers, categories, pincodeSetting] = await Promise.all([
      api("/products?limit=200"),
      api("/orders/admin/all?limit=200", { headers: authHeaders() }),
      api("/users", { headers: authHeaders() }).catch(() => []),
      api("/categories"),
      api("/pincode-restrictions", { headers: authHeaders() }).catch(() => ({ enabled: false, pincodes: [] }))
    ]);
    PRODUCTS = (products && products.items) || [];
    ORDERS = (orders && orders.items) || [];
    CUSTOMERS = customers || [];
    CATEGORIES = categories || [];
    PINCODE_SETTING = pincodeSetting || { enabled: false, pincodes: [] };
    productById = {};
    PRODUCTS.forEach(p => (productById[p.id] = p));
    orderById = {};
    ORDERS.forEach(o => (orderById[o.id] = o));

    renderDashboard();
    renderProducts();
    renderCategories();
    renderOrders();
    renderPayments();
    renderCustomers();
    renderDeliveryAreas();
    populateCategoryFilters();
    
    if (adminUser.role === "ADMIN") {
      document.getElementById("promotionToggleContainer").style.display = "flex";
      document.getElementById("btnCreateOwnerModal").style.display = "inline-flex";
      loadPromotionStatus();
    } else if (adminUser.role === "OWNER") {
      const customersNavBtn = document.querySelector('.nav-item[data-view="customers"]');
      if(customersNavBtn) customersNavBtn.style.display = "none";
    }
  } catch (err) {
    catchErr(err, "Couldn't load data — is the API running?");
  }
}

// ============================================================
//  DASHBOARD
// ============================================================
function revenueOf(orders) {
  let total = 0;
  for (let i = 0; i < orders.length; i++) {
    if (orders[i].status !== "Cancelled") {
      total += orders[i].totalAmount;
    }
  }
  return total;
}
function renderDashboard() {
  const live = ORDERS.filter(o => o.status !== "Cancelled");
  const revenue = revenueOf(ORDERS);
  const aov = live.length ? Math.round(revenue / live.length) : 0;
  const lowStock = PRODUCTS.filter(p => p.stock <= LOW_STOCK);

  const kpis = [
    { label: "Revenue", value: revenue, cur: true, foot: `${live.length} paid orders` },
    { label: "Orders", value: ORDERS.length, foot: `${live.length} active` },
    { label: "Customers", value: CUSTOMERS.filter(c => !c.role || c.role === "CUSTOMER").length, foot: "customer accounts" },
    { label: "Products", value: PRODUCTS.length, foot: `${CATEGORIES.length} categories` },
    { label: "Avg order value", value: aov, cur: true, foot: "excl. cancelled" },
    { label: "Low stock", value: lowStock.length, alert: lowStock.length > 0, foot: `≤ ${LOW_STOCK} units` }
  ];
  document.getElementById("kpiGrid").innerHTML = kpis.map(k => `
    <div class="kpi ${k.alert ? "alert" : ""}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.cur ? '<span class="cur">₹</span>' : ""}${Number(k.value).toLocaleString("en-IN")}</div>
      <div class="kpi-foot">${k.foot}</div>
    </div>`).join("");

  drawRevenueChart(14);
  drawStatusChart();

  // recent orders
  const recent = [...ORDERS].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
  document.querySelector("#recentOrdersTable tbody").innerHTML = recent.length
    ? recent.map(o => `
      <tr>
        <td class="cell-strong">#${o.id}</td>
        <td>${esc(orderCustomer(o))}</td>
        <td class="num">${inr(o.totalAmount)}</td>
        <td>${statusBadge(o.status)}</td>
        <td class="cell-sub">${shortDate(o.createdAt)}</td>
      </tr>`).join("")
    : emptyRow(5, "No orders yet");

  // low stock
  document.getElementById("lowStockCount").textContent = lowStock.length;
  document.querySelector("#lowStockTable tbody").innerHTML = lowStock.length
    ? lowStock.sort((a, b) => a.stock - b.stock).slice(0, 8).map(p => `
      <tr>
        <td class="row-flex"><img class="thumb" src="${esc(imgSrc(p.image, IMG.thumb))}" alt="" loading="lazy"><span class="cell-strong">${esc(p.title)}</span></td>
        <td class="num"><span class="badge ${p.stock <= 0 ? "b-bad" : "b-warn"}">${p.stock}</span></td>
      </tr>`).join("")
    : emptyRow(2, "Everything well stocked ✦");
}
function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}"><div class="empty"><div class="big">✦</div>${esc(msg)}</div></td></tr>`;
}

// buckets orders into the last `days` days
function dailyRevenue(days) {
  const labels = [], data = [];
  const map = {};
  for (const o of ORDERS) {
    if (o.status !== "Cancelled") {
      const key = String(o.createdAt).slice(0, 10);
      map[key] = (map[key] || 0) + o.totalAmount;
    }
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    labels.push(d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }));
    data.push(map[key] || 0);
  }
  return { labels, data };
}
function drawRevenueChart(days) {
  if (typeof Chart === "undefined") return;
  const { labels, data } = dailyRevenue(days);
  const ctx = document.getElementById("revenueChart");
  charts.revenue?.destroy();
  const grad = ctx.getContext("2d").createLinearGradient(0, 0, 0, 260);
  grad.addColorStop(0, "rgba(193,150,60,.28)");
  grad.addColorStop(1, "rgba(193,150,60,0)");
  charts.revenue = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ data, fill: true, backgroundColor: grad,
      borderColor: "#c1963c", borderWidth: 2, tension: .35, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: "#7a1f3d" }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => inr(c.parsed.y) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: "#8b8290", maxRotation: 0, autoSkipPadding: 16 } },
        y: { grid: { color: "#f0ebe3" }, ticks: { color: "#8b8290", callback: v => "₹" + v } }
      }
    }
  });
}
function drawStatusChart() {
  if (typeof Chart === "undefined") return;
  const order = ORDER_STATUSES;
  const colors = { Pending: "#c98a1e", Shipped: "#3f6bb0", "Out for Delivery": "#6b5bb0", Attempted: "#d9822b", Delivered: "#2f9e6f", Cancelled: "#cf4b48" };
  const counts = order.map(s => ORDERS.filter(o => o.status === s).length);
  const ctx = document.getElementById("statusChart");
  charts.status?.destroy();
  if (ORDERS.length === 0) return;
  charts.status = new Chart(ctx, {
    type: "doughnut",
    data: { labels: order, datasets: [{ data: counts, backgroundColor: order.map(s => colors[s]), borderWidth: 0, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "64%",
      plugins: { legend: { position: "bottom", labels: { color: "#2b2430", boxWidth: 10, padding: 14, font: { size: 12 } } } } }
  });
}
// revenue range toggle
document.getElementById("revRange").addEventListener("click", e => {
  const btn = e.target.closest("button"); if (!btn) return;
  document.querySelectorAll("#revRange button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  drawRevenueChart(Number(btn.dataset.days));
});

// ============================================================
//  PRODUCTS
// ============================================================

function downloadCsvTemplate(e) {
  e.preventDefault();
  const headers = ["title", "description", "price", "image", "stock", "keywords", "category"];
  const sampleData = ["Beautiful Saree", "Silk saree from Banaras", "2500", "https://example.com/saree.jpg", "10", "saree, silk", "Sarees"];
  const csvContent = headers.join(",") + "\n" + sampleData.join(",");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "products_template.csv");
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function handleBulkUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  try {
    toast("Uploading and processing CSV...");
    const res = await fetch(`${API_URL}/products/bulk-upload`, {
      method: "POST",
      headers: authHeaders(false), // don't set content-type for formData
      body: formData
    });
    if (handle401(res)) return;
    const data = await res.json();
    if (res.ok) {
      toast(data.message);
      if (data.errors && data.errors.length) {
        toast(`Completed with ${data.errors.length} errors.`);
      }
      await loadAll();
    } else {
      toast(data.message || "Failed to bulk upload", "err");
    }
  } catch (error) {
    catchErr(error, "Network error during bulk upload");
  } finally {
    e.target.value = ""; // reset input
  }
}

function populateCategoryFilters() {
  const sel = document.getElementById("productCategoryFilter");
  sel.innerHTML = `<option value="">All categories</option>` +
    CATEGORIES.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");

  const boxes = CATEGORIES.map(c => `
    <label class="cat-option"><input type="checkbox" value="${c.id}"> ${c.isJewellery ? "💍 " : ""}${esc(c.name)}</label>`).join("");
  document.getElementById("productCategoryOptions").innerHTML = boxes || `<span class="cell-sub">Create a category first.</span>`;
}
function filteredProducts() {
  const q = document.getElementById("productSearch").value.toLowerCase().trim();
  const cat = document.getElementById("productCategoryFilter").value;
  const stock = document.getElementById("productStockFilter").value;
  return PRODUCTS.filter(p => {
    if (q && !(`${p.title} ${p.keywords || ""}`.toLowerCase().includes(q))) return false;
    if (cat && !(p.categories || []).some(c => String(c.category.id) === cat)) return false;
    if (stock === "in" && p.stock <= LOW_STOCK) return false;
    if (stock === "low" && !(p.stock > 0 && p.stock <= LOW_STOCK)) return false;
    if (stock === "out" && p.stock > 0) return false;
    return true;
  });
}
function renderProducts() {
  const rows = filteredProducts();
  document.querySelector("#productsTable tbody").innerHTML = rows.length
    ? rows.map(p => `
      <tr>
        <td class="row-flex">
          <img class="thumb" src="${esc(imgSrc(p.image, IMG.thumb))}" alt="" loading="lazy">
          <div><div class="cell-strong">${esc(p.title)}</div><div class="cell-sub">#${p.id}</div></div>
        </td>
        <td>${(p.categories || []).map(c => `<span class="chip">${esc(c.category.name)}</span>`).join("") || "<span class='cell-sub'>—</span>"}</td>
        <td class="num cell-strong">${inr(p.price)}</td>
        <td class="num">${p.stock}</td>
        <td>${stockBadge(p.stock)}</td>
        <td><div class="btn-row">
          <button class="btn btn-sm" onclick="openEdit(${esc(JSON.stringify(p))})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteProduct(${p.id})">Delete</button>
        </div></td>
      </tr>`).join("")
    : emptyRow(6, "No products match these filters");
}
["productSearch", "productCategoryFilter", "productStockFilter"].forEach(id =>
  document.getElementById(id).addEventListener("input", renderProducts));

async function createProduct() {
  const categoryIds = [...document.querySelectorAll("#productCategoryOptions input:checked")].map(i => Number(i.value));
  const body = {
    title: val("productTitle"), description: val("productDescription"),
    price: val("productPrice"), image: val("productImage"),
    stock: val("productStock"), keywords: val("productKeywords"), categoryIds
  };
  if (!body.title || !body.price) return toast("Title and price are required", "err");
  try {
    await api("/products", { method: "POST", headers: authHeaders(true), body: JSON.stringify(body) });
    toast("Product created");
    resetProductForm();
    await loadAll();
    showView("products");
  } catch (e) { catchErr(e, "Couldn't create product"); }
}
function resetProductForm() {
  ["productTitle", "productDescription", "productPrice", "productImage", "productStock", "productKeywords"].forEach(id => document.getElementById(id).value = "");
  document.querySelectorAll("#productCategoryOptions input:checked").forEach(i => i.checked = false);
  document.getElementById("uploadStatus").textContent = "";
}
async function uploadProductImage() {
  const file = document.getElementById("productImageFile").files[0];
  if (!file) return;
  const status = document.getElementById("uploadStatus");
  status.innerHTML = `<span class="spinner"></span> Uploading…`;
  try {
    const fd = new FormData(); fd.append("image", file);
    const res = await fetch(`${API_URL}/products/upload`, { method: "POST", headers: authHeaders(), body: fd });
    const data = await res.json();
    if (data.imageUrl) {
      document.getElementById("productImage").value = data.imageUrl;
      status.textContent = "Uploaded ✓";
    } else { status.textContent = data.message || "Upload failed"; }
  } catch (e) { catchErr(e, "Upload failed", status); }
}
async function deleteProduct(id) {
  if (!confirm("Delete this product? This cannot be undone.")) return;
  try {
    await api(`/products/${id}`, { method: "DELETE", headers: authHeaders() });
    toast("Product deleted");
    await loadAll();
  } catch (e) { catchErr(e, "Couldn't delete"); }
}
function val(id) { return document.getElementById(id).value; }

// edit modal
function openEdit(p) {
  document.getElementById("editProductId").value = p.id;
  document.getElementById("editProductTitle").value = p.title || "";
  document.getElementById("editProductDescription").value = p.description || "";
  document.getElementById("editProductPrice").value = p.price ?? "";
  document.getElementById("editProductStock").value = p.stock ?? "";
  document.getElementById("editProductImage").value = p.image || "";
  document.getElementById("editProductKeywords").value = p.keywords || "";
  const checked = new Set((p.categories || []).map(c => c.category.id));
  document.getElementById("editCategoryOptions").innerHTML = CATEGORIES.map(c => `
    <label class="cat-option"><input type="checkbox" value="${c.id}" ${checked.has(c.id) ? "checked" : ""}> ${c.isJewellery ? "💍 " : ""}${esc(c.name)}</label>`).join("");
  document.getElementById("editProductImageFile").value = "";
  document.getElementById("editUploadStatus").textContent = "";
  document.getElementById("editModal").classList.add("open");
}
function closeEdit() { document.getElementById("editModal").classList.remove("open"); }
async function uploadEditProductImage() {
  const file = document.getElementById("editProductImageFile").files[0];
  if (!file) return;
  const status = document.getElementById("editUploadStatus");
  status.innerHTML = `<span class="spinner"></span> Uploading…`;
  try {
    const fd = new FormData(); fd.append("image", file);
    const res = await fetch(`${API_URL}/products/upload`, { method: "POST", headers: authHeaders(), body: fd });
    const data = await res.json();
    if (data.imageUrl) {
      document.getElementById("editProductImage").value = data.imageUrl;
      status.textContent = "Uploaded ✓";
    } else { status.textContent = data.message || "Upload failed"; }
  } catch (e) { catchErr(e, "Upload failed", status); }
}
async function updateProduct() {
  const id = val("editProductId");
  const categoryIds = [...document.querySelectorAll("#editCategoryOptions input:checked")].map(i => Number(i.value));
  const body = {
    title: val("editProductTitle"), description: val("editProductDescription"),
    price: val("editProductPrice"), image: val("editProductImage"),
    stock: val("editProductStock"), keywords: val("editProductKeywords"), categoryIds
  };
  try {
    await api(`/products/${id}`, { method: "PUT", headers: authHeaders(true), body: JSON.stringify(body) });
    toast("Product updated");
    closeEdit();
    await loadAll();
  } catch (e) { catchErr(e, "Couldn't update"); }
}
function exportProductsCSV() {
  const rows = [["ID", "Title", "Price", "Stock", "Categories", "Keywords"]];
  filteredProducts().forEach(p => rows.push([p.id, p.title, p.price, p.stock,
    (p.categories || []).map(c => c.category.name).join(" | "), p.keywords || ""]));
  downloadCSV("products.csv", rows);
}

// ============================================================
//  CATEGORIES
// ============================================================
function renderCategories() {
  const counts = {};
  PRODUCTS.forEach(p => (p.categories || []).forEach(c => {
    counts[c.category.id] = (counts[c.category.id] || 0) + 1;
  }));
  document.getElementById("categoryList").innerHTML = CATEGORIES.length
    ? CATEGORIES.map(c => `
      <div class="cat-card ${c.isJewellery ? "is-jewellery" : ""}">
        <div class="cat-info">
          <h4>${c.isJewellery ? "💍 " : ""}${esc(c.name)}</h4>
          <div class="count">${counts[c.id] || 0} products · ${c.isJewellery ? "Jewellery page" : "Main store"}</div>
          <label class="jewel-toggle" title="Show this category on the Jewellery &amp; Bangles page">
            <input type="checkbox" ${c.isJewellery ? "checked" : ""}
              onchange="setCategoryJewellery(${c.id}, this.checked, this)">
            <span>Jewellery &amp; Bangles page</span>
          </label>
        </div>
        <button class="btn btn-sm btn-danger" onclick="deleteCategory(${c.id})">Delete</button>
      </div>`).join("")
    : `<div class="empty" style="grid-column:1/-1;"><div class="big">❖</div>No categories yet — add one above.</div>`;
}
async function createCategory() {
  const name = val("categoryName").trim();
  if (!name) return toast("Enter a category name", "err");
  const jewelBox = document.getElementById("categoryIsJewellery");
  const isJewellery = !!(jewelBox && jewelBox.checked);
  try {
    await api("/categories", { method: "POST", headers: authHeaders(true), body: JSON.stringify({ name, isJewellery }) });
    document.getElementById("categoryName").value = "";
    if (jewelBox) jewelBox.checked = false;
    toast("Category added");
    await loadAll();
  } catch (e) { catchErr(e, "Couldn't add category"); }
}
// Moves a category between the main store and the Jewellery & Bangles
// page. Optimistic: the checkbox flips immediately and is reverted if
// the save fails.
async function setCategoryJewellery(id, isJewellery, checkbox) {
  try {
    const updated = await api(`/categories/${id}`, {
      method: "PATCH", headers: authHeaders(true), body: JSON.stringify({ isJewellery })
    });
    const cat = CATEGORIES.find(c => c.id === id);
    if (cat) cat.isJewellery = updated && typeof updated.isJewellery === "boolean" ? updated.isJewellery : isJewellery;
    toast(isJewellery ? "Now shown on the Jewellery & Bangles page" : "Now shown on the main store");
    renderCategories();
    populateCategoryFilters();
  } catch (e) {
    if (checkbox) checkbox.checked = !isJewellery;
    catchErr(e, "Couldn't update category");
  }
}
async function deleteCategory(id) {
  if (!confirm("Delete this category?")) return;
  try {
    await api(`/categories/${id}`, { method: "DELETE", headers: authHeaders() });
    toast("Category deleted");
    await loadAll();
  } catch (e) { catchErr(e, "Couldn't delete"); }
}

// ============================================================
//  DELIVERY AREAS (pincode restriction)
// ============================================================
function renderDeliveryAreas() {
  document.getElementById("pincodeRestrictionToggle").checked = !!PINCODE_SETTING.enabled;
  const pincodes = PINCODE_SETTING.pincodes || [];
  document.getElementById("pincodeList").innerHTML = pincodes.length
    ? pincodes.map(p => `
      <span class="chip">${esc(p)}
        <a href="#" onclick="removeServiceablePincode(${esc(JSON.stringify(p))}); return false;" style="color:inherit; margin-left:6px; text-decoration:none;" aria-label="Remove ${esc(p)}">×</a>
      </span>`).join("")
    : `<span class="cell-sub">No pincodes added yet.</span>`;
}
async function togglePincodeRestriction(checked) {
  try {
    const data = await api("/pincode-restrictions/toggle", {
      method: "PUT", headers: authHeaders(true), body: JSON.stringify({ enabled: checked })
    });
    PINCODE_SETTING.enabled = data.enabled;
    toast(data.enabled ? "Checkout restricted to listed pincodes" : "Restriction turned off — every pincode can check out");
  } catch (e) {
    catchErr(e, "Couldn't update the restriction");
    document.getElementById("pincodeRestrictionToggle").checked = !!PINCODE_SETTING.enabled;
  }
}
async function addServiceablePincode() {
  const pincode = val("newPincodeInput").trim();
  if (!/^\d{6}$/.test(pincode)) return toast("Enter a valid 6-digit pincode", "err");
  try {
    await api("/pincode-restrictions", { method: "POST", headers: authHeaders(true), body: JSON.stringify({ pincode }) });
    document.getElementById("newPincodeInput").value = "";
    toast("Pincode added");
    const data = await api("/pincode-restrictions", { headers: authHeaders() });
    PINCODE_SETTING = data;
    renderDeliveryAreas();
  } catch (e) { catchErr(e, "Couldn't add pincode"); }
}
async function removeServiceablePincode(pincode) {
  try {
    await api(`/pincode-restrictions/${pincode}`, { method: "DELETE", headers: authHeaders() });
    toast("Pincode removed");
    const data = await api("/pincode-restrictions", { headers: authHeaders() });
    PINCODE_SETTING = data;
    renderDeliveryAreas();
  } catch (e) { catchErr(e, "Couldn't remove pincode"); }
}

// ============================================================
//  ORDERS
// ============================================================
function filteredOrders() {
  const q = document.getElementById("orderSearch").value.toLowerCase().trim();
  const status = document.getElementById("orderStatusFilter").value;
  return ORDERS.filter(o => {
    if (status && o.status !== status) return false;
    if (q && !(`#${o.id} ${o.fullName || ""} ${o.user?.name || ""} ${orderEmail(o)}`.toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
function renderOrders() {
  const rows = filteredOrders();
  document.querySelector("#ordersTable tbody").innerHTML = rows.length
    ? rows.map(o => `
      <tr>
        <td class="cell-strong">#${o.id}</td>
        <td>${esc(orderCustomer(o))}${deletedAccountTag(o)}<div class="cell-sub">${esc(orderEmail(o))}</div></td>
        <td class="num">${(o.orderItems || []).reduce((s, i) => s + i.quantity, 0)}</td>
        <td class="num cell-strong">${inr(o.totalAmount)}</td>
        <td>
          <select onchange="updateOrderStatus(${o.id}, this.value)" style="padding:5px 8px;font-size:12px;">
            ${ORDER_STATUSES.map(s => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </td>
        <td class="cell-sub">${shortDate(o.createdAt)}</td>
        <td><button class="btn btn-sm" onclick="viewOrder(${o.id})">Details</button></td>
      </tr>`).join("")
    : emptyRow(7, "No orders match these filters");
}
["orderSearch", "orderStatusFilter"].forEach(id =>
  document.getElementById(id).addEventListener("input", renderOrders));

async function updateOrderStatus(id, status) {
  try {
    await api(`/orders/${id}/status`, { method: "PUT", headers: authHeaders(true), body: JSON.stringify({ status }) });
    const o = orderById[id]; if (o) o.status = status;
    toast(`Order #${id} → ${status}`);
    renderDashboard(); renderPayments();
  } catch (e) { catchErr(e, "Couldn't update status"); }
}
function viewOrder(id) {
  const o = orderById[id]; if (!o) return;
  document.getElementById("detailsTitle").textContent = `Order #${o.id}`;
  const items = (o.orderItems || []).map(i => `
    <div class="order-line">
      <img class="thumb" src="${esc(imgSrc(itemImage(i), IMG.thumb))}" alt="" loading="lazy">
      <div style="flex:1"><div class="cell-strong">${esc(itemTitle(i))}</div>
      <div class="cell-sub">Qty ${i.quantity} × ${inr(i.price)}</div></div>
      <div class="cell-strong">${inr(i.price * i.quantity)}</div>
    </div>`).join("");
  document.getElementById("detailsBody").innerHTML = `
    <div class="detail-row"><span class="k">Customer</span><span>${esc(orderCustomer(o))}${deletedAccountTag(o)}</span></div>
    <div class="detail-row"><span class="k">Email</span><span>${esc(orderEmail(o) || "—")}</span></div>
    <div class="detail-row"><span class="k">Phone</span><span>${esc(o.phone || "—")}</span></div>
    <div class="detail-row"><span class="k">Address</span><span style="text-align:right;max-width:60%">${esc([o.address, o.city, o.state, o.pincode].filter(Boolean).join(", ") || "—")}</span></div>
    <div class="detail-row"><span class="k">Status</span><span>${statusBadge(o.status)}</span></div>
    <div class="detail-row"><span class="k">Placed</span><span>${shortDate(o.createdAt)}</span></div>
    <h4 style="margin:18px 0 6px;">Items</h4>
    ${items || "<div class='cell-sub'>No items</div>"}
    <div class="detail-row" style="margin-top:10px;border-bottom:none;"><span class="k" style="font-weight:600;color:var(--ink-2)">Total</span><span class="cell-strong">${inr(o.totalAmount)}</span></div>`;
  document.getElementById("detailsModal").classList.add("open");
}
function closeDetails() { document.getElementById("detailsModal").classList.remove("open"); }
function exportOrdersCSV() {
  const rows = [["Order", "Customer", "Email", "Phone", "Amount", "Status", "Date", "City", "Pincode"]];
  filteredOrders().forEach(o => rows.push([o.id, orderCustomer(o), orderEmail(o),
    o.phone || "", o.totalAmount, o.status, shortDate(o.createdAt), o.city || "", o.pincode || ""]));
  downloadCSV("orders.csv", rows);
}

// ============================================================
//  PAYMENTS  (derived from order status)
// ============================================================
function calculatePaymentStats(orders) {
  return orders.reduce((acc, o) => {
    if (o.paymentStatus === "Paid") {
      acc.paid.count++;
      acc.paid.sum += o.totalAmount;
      if (o.paymentMethod === "UPI") acc.upiSum += o.totalAmount;
    } else if (o.paymentStatus === "Refunded") {
      acc.refunded.count++;
      acc.refunded.sum += o.totalAmount;
    } else if (o.paymentStatus === "Pending" && o.status !== "Cancelled") {
      acc.awaiting.count++;
      acc.awaiting.sum += o.totalAmount;
    }
    return acc;
  }, {
    paid: { count: 0, sum: 0 },
    awaiting: { count: 0, sum: 0 },
    refunded: { count: 0, sum: 0 },
    upiSum: 0
  });
}

function renderPaymentUI(stats, orders) {
  const kpis = [
    { label: "Collected", value: stats.paid.sum, foot: `${stats.paid.count} paid orders`, cls: "" },
    { label: "Awaiting payment", value: stats.awaiting.sum, foot: `${stats.awaiting.count} unpaid (COD/UPI)`, cls: "" },
    { label: "Refunded", value: stats.refunded.sum, foot: `${stats.refunded.count} orders`, cls: stats.refunded.count ? "alert" : "" },
    { label: "UPI share", value: stats.upiSum, foot: "collected via UPI", cls: "" }
  ];
  document.getElementById("paymentKpis").innerHTML = kpis.map(k => `
    <div class="kpi ${k.cls}">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value"><span class="cur">₹</span>${Number(k.value).toLocaleString("en-IN")}</div>
      <div class="kpi-foot">${k.foot}</div>
    </div>`).join("");

  const pill = o => {
    if (o.paymentStatus === "Paid") return `<span class="badge b-ok">Paid</span>`;
    if (o.paymentStatus === "Refunded") return `<span class="badge b-mute">Refunded</span>`;
    if (o.status === "Cancelled") return `<span class="badge b-bad">Cancelled unpaid</span>`;
    return `<span class="badge b-warn">Awaiting</span>`;
  };
  const rows = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  document.querySelector("#paymentsTable tbody").innerHTML = rows.length
    ? rows.map(o => `
      <tr>
        <td class="cell-strong">#${o.id}<div class="cell-sub">${esc(o.paymentMethod || "COD")}</div></td>
        <td>${esc(orderCustomer(o))}</td>
        <td class="num cell-strong">${inr(o.totalAmount)}</td>
        <td>${pill(o)}</td>
        <td class="cell-sub">${shortDate(o.createdAt)}</td>
        <td>${o.paymentStatus === "Paid"
            ? `<button class="btn btn-sm btn-ghost" onclick="setPayment(${o.id}, 'Refunded')">Refund</button>`
            : o.status === "Cancelled"
              ? ""
              : `<button class="btn btn-sm btn-gold" onclick="setPayment(${o.id}, 'Paid')">Mark paid</button>`}
        </td>
      </tr>`).join("")
    : emptyRow(6, "No transactions yet");
}

function renderPayments() {
  // CHANGED: now uses the real paymentMethod / paymentStatus fields
  // (falls back to status-derived logic for old orders created before
  // the migration, which will have defaults COD/Pending).
  const stats = calculatePaymentStats(ORDERS);
  renderPaymentUI(stats, ORDERS);
}

// ADDED: flip an order's payment status via the new admin endpoint.
async function setPayment(id, paymentStatus) {
  try {
    await api(`/orders/${id}/payment`, {
      method: "PUT", headers: authHeaders(true),
      body: JSON.stringify({ paymentStatus })
    });
    const o = orderById[id];
    if (o) o.paymentStatus = paymentStatus;
    toast(`Order #${id} payment → ${paymentStatus}`);
    renderPayments();
  } catch (e) { catchErr(e, "Couldn't update payment"); }
}

// ============================================================
//  CUSTOMERS
// ============================================================

async function promptAddCustomer() {
  const name = prompt("Enter customer name:");
  if (!name) return;
  const email = prompt("Enter customer email:");
  if (!email) return;
  const password = prompt("Enter customer password (they can change it later):");
  if (!password) return;

  try {
    toast("Creating customer account...");
    const res = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (res.ok) {
      toast("Customer created successfully");
      await loadAll();
    } else {
      toast(data.message || "Failed to create customer", "err");
    }
  } catch (error) {
    catchErr(error, "Network error while creating customer");
  }
}

// The server flags the master admin (isSuperAdmin) — no email is hard-coded
// here. Rows carry only numeric ids in data-attributes; one delegated
// listener looks the customer up, so names never end up inside script.
function canManage(c) {
  return adminUser && adminUser.role === "ADMIN" && !c.isSuperAdmin && c.id !== adminUser.id;
}
function renderCustomers() {
  const q = document.getElementById("customerSearch").value.toLowerCase().trim();
  const rows = CUSTOMERS.filter(c => !q || `${c.name} ${c.email}`.toLowerCase().includes(q));
  const tbody = document.querySelector("#customersTable tbody");
  tbody.innerHTML = rows.length
    ? rows.map(c => `
      <tr data-customer="${Number(c.id)}">
        <td class="row-flex">
          <div class="admin-chip" style="border:none;padding:0"><div class="avatar" style="width:34px;height:34px">${esc((c.name || "?")[0].toUpperCase())}</div></div>
          <div><div class="cell-strong">${esc(c.name)}${c.isSuperAdmin ? ' <span class="badge b-info">Master admin</span>' : ""}</div><div class="cell-sub">${esc(c.email)}</div></div>
        </td>
        <td>
          ${canManage(c)
            ? `<select class="role-select" data-action="role" style="padding:4px 8px; border-radius:6px; border:1px solid var(--border); font-size:12px; font-weight:500; cursor:pointer; background:var(--surface);">
              ${Object.keys(ROLE_LABELS).map(r => `<option value="${r}" ${c.role === r ? "selected" : ""}>${esc(ROLE_LABELS[r])}</option>`).join("")}
            </select>`
            : `<span class="badge ${c.role === "ADMIN" ? "b-info" : c.role === "OWNER" ? "b-ok" : c.role === "DELIVERY_PARTNER" ? "b-warn" : "b-mute"}">${esc(ROLE_LABELS[c.role] || "Customer")}</span>`}
        </td>
        <td class="num">${Number(c.orderCount) || 0}</td>
        <td class="num cell-strong">${inr(c.totalSpent)}</td>
        <td class="cell-sub">${shortDate(c.lastOrderAt)}</td>
        <td class="cell-sub">${shortDate(c.createdAt)}</td>
        <td>
          <div class="btn-row">
            <button class="btn btn-sm" data-action="orders">Orders</button>
            ${canManage(c)
              ? `<button class="btn btn-sm btn-err" data-action="delete" style="background-color: #ffebe9; color: #cf222e; border: 1px solid rgba(207, 34, 46, 0.2);">Delete</button>`
              : ""}
          </div>
        </td>
      </tr>`).join("")
    : emptyRow(7, "No customers found");
  bindCustomerActions(tbody);
}
const customerActions = {
  role: (c, el) => changeRole(c.id, el.value, c.role, c.name || ""),
  orders: c => viewCustomer(c.id, c.name || ""),
  delete: c => deleteCustomer(c.id, c.name || "")
};
function bindCustomerActions(tbody) {
  if (tbody._customerActionsBound) return;
  tbody._customerActionsBound = true;
  const handle = (e, eventType) => {
    const el = e.target.closest("[data-action]");
    if (!el || (eventType === "change") !== (el.tagName === "SELECT")) return;
    const row = el.closest("tr[data-customer]");
    const c = row && CUSTOMERS.find(x => x.id === Number(row.dataset.customer));
    if (c && customerActions[el.dataset.action]) customerActions[el.dataset.action](c, el);
  };
  tbody.addEventListener("click", e => handle(e, "click"));
  tbody.addEventListener("change", e => handle(e, "change"));
}
document.getElementById("customerSearch").addEventListener("input", renderCustomers);

async function viewCustomer(id, name) {
  try {
    const orders = await api(`/users/${id}/orders`, { headers: authHeaders() });
    document.getElementById("detailsTitle").textContent = `${name} · orders`;
    document.getElementById("detailsBody").innerHTML = orders.length
      ? orders.map(o => `
        <div class="order-line">
          <div style="flex:1"><div class="cell-strong">Order #${o.id}</div>
          <div class="cell-sub">${shortDate(o.createdAt)} · ${(o.orderItems || []).length} items</div></div>
          ${statusBadge(o.status)}
          <div class="cell-strong" style="margin-left:12px">${inr(o.totalAmount)}</div>
        </div>`).join("")
      : "<div class='empty'><div class='big'>✦</div>No orders yet</div>";
    document.getElementById("detailsModal").classList.add("open");
  } catch (e) { catchErr(e, "Couldn't load customer orders"); }
}
function exportCustomersCSV() {
  const rows = [["ID", "Name", "Email", "Role", "Orders", "Total spent", "Joined"]];
  CUSTOMERS.forEach(c => rows.push([c.id, c.name, c.email, c.role, c.orderCount, c.totalSpent, shortDate(c.createdAt)]));
  downloadCSV("customers.csv", rows);
}

async function changeRole(id, newRole, oldRole, name) {
  if (!confirm(`Are you sure you want to change ${name}'s role to ${newRole}?`)) {
    // Revert the select if they cancel
    await loadAll();
    return;
  }
  try {
    const res = await fetch(`${API_URL}/users/${id}/role`, {
      method: "PUT",
      headers: authHeaders(true),
      body: JSON.stringify({ role: newRole })
    });
    if (res.ok) {
      toast(`${name} is now ${ROLE_LABELS[newRole] || newRole} — takes effect at their next login`);
      await loadAll();
    } else {
      const data = await res.json();
      toast(data.message || "Failed to change role", "err");
      await loadAll();
    }
  } catch (e) {
    catchErr(e, "Network error");
    await loadAll();
  }
}

async function deleteCustomer(id, name) {
  if (!confirm(`Are you absolutely sure you want to permanently delete ${name}? Their account, bag and saved items are removed. Their past orders are kept for your records (marked "Deleted account").`)) {
    return;
  }
  try {
    const res = await fetch(`${API_URL}/users/${id}`, {
      method: "DELETE",
      headers: authHeaders()
    });
    if (handle401(res)) return;
    const data = await res.json();
    if (res.ok) {
      toast("Customer deleted successfully");
      await loadAll(); // refresh the list
    } else {
      toast(data.message || "Failed to delete customer", "err");
    }
  } catch (e) {
    catchErr(e, "Failed to connect to server");
  }
}

async function loadPromotionStatus() {
  try {
    const res = await fetch(`${API_URL}/users/promotion-status`, { headers: authHeaders() });
    if (res.ok) {
      const data = await res.json();
      document.getElementById("promotionToggle").checked = data.enabled;
    }
  } catch (e) {
    console.error("Failed to load promotion status", e);
  }
}

async function togglePromotions(enabled) {
  try {
    const res = await fetch(`${API_URL}/users/promotion-status`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ enabled })
    });
    if (res.ok) {
      toast(enabled ? "Owner promotions enabled" : "Owner promotions disabled");
    } else {
      toast("Failed to update status", "err");
      document.getElementById("promotionToggle").checked = !enabled; // Revert
    }
  } catch (e) {
    console.error("Failed to toggle promotion status", e);
    toast("Failed to update status", "err");
    document.getElementById("promotionToggle").checked = !enabled; // Revert
  }
}

function openOwnerModal() {
  document.getElementById("ownerName").value = "";
  document.getElementById("ownerEmail").value = "";
  document.getElementById("ownerPassword").value = "";
  document.getElementById("ownerModal").classList.add("open");
}

function closeOwnerModal() {
  document.getElementById("ownerModal").classList.remove("open");
}

document.getElementById("ownerForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("ownerName").value.trim();
  const email = document.getElementById("ownerEmail").value.trim();
  const password = document.getElementById("ownerPassword").value;
  if (!name || !email || !password) return;

  try {
    const res = await fetch(`${API_URL}/users/create-owner`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ name, email, password })
    });
    if (res.ok) {
      toast("Owner created successfully ✨");
      closeOwnerModal();
      await loadAll();
    } else {
      const data = await res.json();
      toast(data.message || "Failed to create owner", "err");
    }
  } catch (err) {
    catchErr(err, "Network error");
  }
});

// ============================================================
//  REPORTS
// ============================================================
function initReportDates() {
  const to = new Date();
  const from = new Date(); from.setDate(from.getDate() - 30);
  document.getElementById("reportTo").value = to.toISOString().slice(0, 10);
  document.getElementById("reportFrom").value = from.toISOString().slice(0, 10);
}
function runReport() {
  if (!document.getElementById("reportFrom").value) initReportDates();
  const from = new Date(document.getElementById("reportFrom").value); from.setHours(0, 0, 0, 0);
  const to = new Date(document.getElementById("reportTo").value); to.setHours(23, 59, 59, 999);
  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  const inRange = ORDERS.filter(o => {
    return o.createdAt >= fromISO && o.createdAt <= toISO && o.status !== "Cancelled";
  });
  let revenue = 0;
  let units = 0;
  for (let i = 0; i < inRange.length; i++) {
    const o = inRange[i];
    revenue += o.totalAmount;
    if (o.orderItems) {
      for (let j = 0; j < o.orderItems.length; j++) {
        units += o.orderItems[j].quantity;
      }
    }
  }
  const aov = inRange.length ? Math.round(revenue / inRange.length) : 0;

  const kpis = [
    { label: "Revenue", value: revenue, cur: true },
    { label: "Orders", value: inRange.length },
    { label: "Units sold", value: units },
    { label: "Avg order value", value: aov, cur: true }
  ];
  document.getElementById("reportKpis").innerHTML = kpis.map(k => `
    <div class="kpi"><div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.cur ? '<span class="cur">₹</span>' : ""}${Number(k.value).toLocaleString("en-IN")}</div>
      <div class="kpi-foot">${shortDate(from)} – ${shortDate(to)}</div></div>`).join("");

  // top products
  const agg = {};
  inRange.forEach(o => (o.orderItems || []).forEach(i => {
    // deleted products have no id any more: group them by their snapshot title
    const id = i.productId ?? i.product?.id;
    const key = id != null ? `id:${id}` : `title:${itemTitle(i)}`;
    if (!agg[key]) agg[key] = { title: i.title || i.product?.title || (id != null && productById[id]?.title) || itemTitle(i), units: 0, revenue: 0 };
    agg[key].units += i.quantity;
    agg[key].revenue += i.price * i.quantity;
  }));
  const top = Object.values(agg).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  document.querySelector("#topProductsTable tbody").innerHTML = top.length
    ? top.map(p => `<tr><td class="cell-strong">${esc(p.title)}</td><td class="num">${p.units}</td><td class="num">${inr(p.revenue)}</td></tr>`).join("")
    : emptyRow(3, "No sales in this range");

  drawCategoryChart(inRange);
}
function drawCategoryChart(orders) {
  if (typeof Chart === "undefined") return;
  const byCat = {};
  orders.forEach(o => (o.orderItems || []).forEach(i => {
    const prod = productById[i.productId ?? i.product?.id];
    const cat = prod?.categories?.[0]?.category?.name || "Uncategorised";
    byCat[cat] = (byCat[cat] || 0) + i.price * i.quantity;
  }));
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const ctx = document.getElementById("categoryChart");
  charts.category?.destroy();
  if (!entries.length) return;
  charts.category = new Chart(ctx, {
    type: "bar",
    data: { labels: entries.map(e => e[0]), datasets: [{ data: entries.map(e => e[1]),
      backgroundColor: "#7a1f3d", borderRadius: 6, barThickness: 20 }] },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => inr(c.parsed.x) } } },
      scales: { x: { grid: { color: "#f0ebe3" }, ticks: { color: "#8b8290", callback: v => "₹" + v } },
        y: { grid: { display: false }, ticks: { color: "#2b2430" } } } }
  });
}

// ---------- boot ----------
async function boot() {
  const isAuthorized = await verifyAdmin();
  if (!isAuthorized) {
    alert("Admin or Owner access required. Please sign in with an authorized account.");
    window.location.href = "index.html";
    return;
  }
  document.body.style.display = "";
  document.getElementById("adminAvatar").textContent = adminUser.name ? adminUser.name.charAt(0).toUpperCase() : "A";
  initReportDates();
  loadAll();
}
boot();

async function adminChangePassword() {
  const oldPassword = document.getElementById("adminCpOld").value;
  const newPassword = document.getElementById("adminCpNew").value;
  const cpConfirm = document.getElementById("adminCpConfirm").value;

  if (!oldPassword || !newPassword || !cpConfirm) return toast("Please fill in all password fields");
  if (newPassword !== cpConfirm) return toast("New passwords do not match");

  try {
    const res = await fetch(`${API_URL}/auth/change-password`, {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ oldPassword, newPassword })
    });
    
    if (res.ok) {
      toast("Password updated successfully");
      document.getElementById("adminCpOld").value = "";
      document.getElementById("adminCpNew").value = "";
      document.getElementById("adminCpConfirm").value = "";
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.message || "Failed to update password");
    }
  } catch (err) {
    catchErr(err, "Something went wrong");
  }
}
if (typeof module !== "undefined") {
  module.exports = {
    orderEmail,
    orderCustomer,
    deletedAccountTag,
    ORDER_STATUSES,
    ROLE_LABELS,
    setCategoryJewellery,
    renderCategories,
    renderCustomers,
    customerActions,
    _setState: (state) => {
      if (state.CATEGORIES) CATEGORIES = state.CATEGORIES;
      if (state.PRODUCTS) PRODUCTS = state.PRODUCTS;
      if (state.CUSTOMERS) CUSTOMERS = state.CUSTOMERS;
      if (state.adminUser) adminUser = state.adminUser;
    },
    shortDate,
    statusBadge,
    stockBadge,
    revenueOf,
    toast
  };
}
