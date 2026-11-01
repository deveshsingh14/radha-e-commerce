/* My account — orders history with a status timeline + editable profile. */

// API_URL, esc(), NO_IMAGE_PLACEHOLDER and imgSrc() live in api.js.

function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}
async function logout() {
  if (typeof beforeLogout === "function") await beforeLogout();
  localStorage.removeItem("token");
  window.location.href = "index.html";
}

if (!token()) window.location.href = "index.html";

// ---- tabs ----
function showTab(which) {
  document.getElementById("pane-orders").style.display = which === "orders" ? "block" : "none";
  document.getElementById("pane-profile").style.display = which === "profile" ? "block" : "none";
  document.getElementById("tab-orders").classList.toggle("active", which === "orders");
  document.getElementById("tab-profile").classList.toggle("active", which === "profile");
}

// ---- orders ----
const STEPS = ["Pending", "Shipped", "Out for Delivery", "Delivered"];
const STEP_LABELS = { Pending: "Placed", Shipped: "Shipped", "Out for Delivery": "Out for delivery", Delivered: "Delivered" };
function timelineHTML(status) {
  if (status === "Cancelled") {
    return `<div class="timeline cancelled">
      ${STEPS.map(s => `<div class="tl-step"><div class="tl-dot">•</div><div class="tl-label">${STEP_LABELS[s]}</div></div>`).join("")}
    </div>
    <p style="font-size:12.5px;color:#cf4b48;font-weight:700;margin:6px 0 0;">This order was cancelled.</p>`;
  }
  // "Attempted" = was out for delivery, couldn't be handed over; we'll retry.
  const reached = status === "Attempted" ? STEPS.indexOf("Shipped") : STEPS.indexOf(status);
  return `<div class="timeline">
    ${STEPS.map((s, i) => `
      <div class="tl-step ${i <= reached ? "done" : ""}">
        <div class="tl-dot">${i <= reached ? "✓" : "•"}</div>
        <div class="tl-label">${STEP_LABELS[s]}</div>
      </div>`).join("")}
  </div>${status === "Attempted"
    ? `<p style="font-size:12.5px;color:#b25400;font-weight:700;margin:6px 0 0;">We tried to deliver but couldn't reach you — we'll try again soon.</p>`
    : ""}`;
}
function payPill(o) {
  if (o.paymentStatus === "Paid") return `<span class="pill pl-ok">Paid · ${esc(o.paymentMethod || "COD")}</span>`;
  if (o.paymentStatus === "Refunded") return `<span class="pill pl-mute">Refunded</span>`;
  return `<span class="pill pl-warn">${o.paymentMethod === "UPI" ? "Awaiting UPI payment" : "Pay on delivery"}</span>`;
}
function statusPill(s) {
  const cls = { Delivered: "pl-ok", Shipped: "pl-info", "Out for Delivery": "pl-info", Attempted: "pl-warn", Pending: "pl-warn", Cancelled: "pl-bad" }[s] || "pl-mute";
  return `<span class="pill ${cls}">${esc(s)}</span>`;
}

async function loadOrders() {
  const box = document.getElementById("ordersList");
  try {
    const res = await fetch(`${API_URL}/orders`, { headers: authHeaders() });
    if (handle401(res)) return;
    const orders = await res.json();

    if (!orders.length) {
      box.innerHTML = `<div class="empty-feed"><div class="big"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/></svg></div>
        <h3>No orders yet</h3><p>Your orders will appear here after checkout.</p>
        <a class="btn-solid" style="flex:none;text-decoration:none;display:inline-block;" href="index.html">Start exploring</a></div>`;
      return;
    }

    box.innerHTML = orders.map(o => `
      <div class="order-card">
        <div class="oc-head">
          <div>
            <div class="oc-id">Order #${o.id}</div>
            <div class="oc-date">Placed ${fmtDate(o.createdAt)} · ${(o.orderItems || []).length} item${(o.orderItems || []).length !== 1 ? "s" : ""}</div>
          </div>
          <div class="oc-badges">
            ${statusPill(o.status)}
            ${payPill(o)}
            <span class="pill pl-mute">${inr(o.totalAmount)}</span>
          </div>
        </div>
        ${timelineHTML(o.status)}
        <div class="oc-items">
          ${(o.orderItems || []).map(i => `
            <div class="sum-line">
              <img src="${esc(imgSrc(itemImage(i), IMG.thumb))}" alt="" loading="lazy">
              <div style="flex:1;min-width:0;">
                <div class="sl-t">${esc(itemTitle(i))}</div>
                <div class="sl-q">Qty ${i.quantity} × ${inr(i.price)}</div>
              </div>
              <div class="sl-p">${inr(i.price * i.quantity)}</div>
            </div>`).join("")}
        </div>
      </div>`).join("");
  } catch (e) {
    if (typeof Sentry !== "undefined") Sentry.captureException(e);
    box.innerHTML = `<div class="empty-feed"><div class="big">⚠</div>Couldn't load your orders.</div>`;
  }
}

// ---- profile ----
async function loadProfile() {
  try {
    const res = await fetch(`${API_URL}/users/me`, { headers: authHeaders() });
    if (handle401(res)) return;
    const me = await res.json();
    document.getElementById("helloTitle").textContent = `Hi, ${me.name?.split(" ")[0] || "there"} ✨`;
    set("pfName", me.name); set("pfEmail", me.email);
    set("pfPhone", me.phone); set("pfAddress", me.address);
    set("pfCity", me.city); set("pfState", me.state); set("pfPincode", me.pincode);
  } catch (e) {
    if (typeof Sentry !== "undefined") Sentry.captureException(e);
    console.error("Error:", e);
    toast("Couldn't load profile data");
  }
}
function set(id, v) { document.getElementById(id).value = v || ""; }
function get(id) { return document.getElementById(id).value.trim(); }

async function saveProfile() {
  try {
    const res = await fetch(`${API_URL}/users/me`, {
      method: "PUT", headers: authHeaders(true),
      body: JSON.stringify({
        name: get("pfName"), phone: get("pfPhone"), address: get("pfAddress"),
        city: get("pfCity"), state: get("pfState"), pincode: get("pfPincode")
      })
    });
    if (handle401(res)) return;
    const data = await res.json();
    if (!res.ok) return toast(data.message || "Couldn't save");
    toast("Profile saved ✓");
    document.getElementById("helloTitle").textContent = `Hi, ${data.name?.split(" ")[0]} ✨`;
  } catch (e) {
    if (typeof Sentry !== "undefined") Sentry.captureException(e);
    toast("Couldn't reach the server");
  }
}

loadOrders();
loadProfile();
// "My profile" in the account menu links to account.html#profile
if (typeof window !== "undefined" && window.location && window.location.hash === "#profile") showTab("profile");

async function changePassword() {
  const oldPassword = document.getElementById("cpOld").value;
  const newPassword = document.getElementById("cpNew").value;
  const cpConfirm = document.getElementById("cpConfirm").value;

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
      document.getElementById("cpOld").value = "";
      document.getElementById("cpNew").value = "";
      document.getElementById("cpConfirm").value = "";
    } else {
      const data = await res.json().catch(() => ({}));
      toast(data.message || "Failed to update password");
    }
  } catch (err) {
    if (typeof Sentry !== "undefined") Sentry.captureException(err);
    console.error("Error:", err);
    toast("Something went wrong");
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    fmtDate,
    statusPill,
    payPill,
    timelineHTML,
    showTab,
    logout,
    loadOrders
  };
}
