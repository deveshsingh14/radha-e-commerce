/* Checkout — uses the same API. Guards for login, pre-fills saved
   delivery details from /users/me, shows the cart summary, and places
   the order with the chosen payment method. */

// API_URL, esc(), NO_IMAGE_PLACEHOLDER and imgSrc() live in api.js.
// Set this to your real UPI id to render the scan-to-pay QR:
const UPI_ID = "radha@upi";
const UPI_NAME = "Radha Bangles Jewellery";

// ---- guard: must be logged in with items in the cart ----
if (!token()) {
  window.location.href = "index.html";
}

let CART = [];
let payMethod = "COD";

// ---- delivery areas (pincode restriction) ----
// When the shop restricts delivery, the customer's pincode is checked as they
// type; for a known pincode the city and state are filled in and locked (the
// server enforces the same on checkout).
let DELIVERY = { enabled: false, areas: [] };
let pincodeBlocked = false;
let cartEmpty = false;
// Restricted delivery: customers choose from a dropdown of allowed areas
// instead of typing a pincode (the hidden pincode input still carries it).
let areaMode = false;
let areaMessage = "";

function findArea(areas, pincode) {
  return (areas || []).find(a => a.pincode === String(pincode || "").trim()) || null;
}
function describeArea(a) {
  const place = [a.area, a.city, a.state].filter(Boolean).join(", ");
  return place ? `${a.pincode} (${place})` : a.pincode;
}
function deliveryList(areas, max = 6) {
  const list = (areas || []).slice(0, max).map(describeArea).join(", ");
  return areas.length > max ? `${list} and ${areas.length - max} more` : list;
}
function setLocked(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (value !== undefined) el.value = value;
  el.readOnly = value !== undefined;
  el.classList.toggle("locked", value !== undefined);
  el.title = value !== undefined ? "Set from your pincode" : "";
}
function updatePlaceButton() {
  const btn = document.getElementById("placeBtn");
  if (btn) btn.disabled = cartEmpty || pincodeBlocked;
}
function areaOptionLabel(a) {
  const place = [a.area, a.city, a.state].filter(Boolean).join(", ");
  return place ? `${a.pincode} — ${place}` : a.pincode;
}
// Switches checkout to the dropdown when delivery is restricted.
function setupAreaDropdown(savedPincode) {
  const field = document.getElementById("areaField");
  const select = document.getElementById("areaSelect");
  if (!DELIVERY.enabled || !field || !select) return false;
  areaMode = true;
  field.hidden = false;
  const pinField = document.getElementById("pincodeField");
  if (pinField) pinField.hidden = true;
  const notice = document.getElementById("areaNotice");
  if (notice) notice.hidden = true; // the list itself shows where we deliver

  select.length = 1; // keep the placeholder
  for (const a of DELIVERY.areas) {
    const opt = document.createElement("option");
    opt.value = a.pincode;
    opt.textContent = areaOptionLabel(a); // textContent: names can't inject markup
    select.appendChild(opt);
  }
  select.disabled = DELIVERY.areas.length === 0;

  const saved = String(savedPincode || "").trim();
  const match = findArea(DELIVERY.areas, saved);
  select.value = match ? match.pincode : "";
  areaMessage = !match && saved
    ? `Your saved pincode ${saved} isn't in our delivery areas — please choose one.`
    : "";
  const pinEl = document.getElementById("pincode");
  if (pinEl) pinEl.value = select.value;
  if (!select._bound) {
    select._bound = true;
    select.addEventListener("change", () => {
      areaMessage = "";
      const p = document.getElementById("pincode");
      if (p) p.value = select.value;
      applyPincode();
    });
  }
  return true;
}
function applyPincode() {
  const hint = document.getElementById(areaMode ? "areaHint" : "pincodeHint") || { className: "", textContent: "" };
  const pinEl = document.getElementById("pincode");
  const pin = pinEl ? pinEl.value.trim() : "";
  pincodeBlocked = false;
  hint.className = "f-hint";
  hint.textContent = "";
  setLocked("city"); setLocked("state");
  if (areaMode && !pin) {
    pincodeBlocked = true;
    hint.className = "f-hint err";
    hint.textContent = DELIVERY.areas.length
      ? (areaMessage || "Choose your delivery area")
      : "Delivery isn't available right now — please check back soon.";
    updatePlaceButton();
    return;
  }
  if (DELIVERY.enabled && /^\d{6}$/.test(pin)) {
    const a = findArea(DELIVERY.areas, pin);
    if (!a) {
      pincodeBlocked = true;
      hint.className = "f-hint err";
      hint.textContent = `Sorry, we don't deliver to ${pin} yet. We deliver to: ${deliveryList(DELIVERY.areas)}.`;
    } else {
      hint.className = "f-hint ok";
      hint.textContent = `✓ We deliver here${a.area || a.city ? ` — ${[a.area, a.city].filter(Boolean).join(", ")}` : ""}`;
      if (a.city && a.state) { setLocked("city", a.city); setLocked("state", a.state); }
    }
  }
  updatePlaceButton();
}
async function loadDeliveryAreas() {
  try {
    const res = await fetch(`${API_URL}/pincode-restrictions/areas`);
    if (!res.ok) return; // older backend / temporary error: server still validates at checkout
    DELIVERY = await res.json();
    const notice = document.getElementById("areaNotice");
    // fallback banner only where the dropdown isn't available
    if (notice && !document.getElementById("areaSelect") && DELIVERY.enabled && DELIVERY.areas.length) {
      notice.textContent = `We currently deliver only to: ${deliveryList(DELIVERY.areas)}.`;
      notice.hidden = false;
    }
  } catch (e) { console.error("Couldn't load delivery areas:", e); }
}

async function boot() {
  const areasLoaded = loadDeliveryAreas();
  const pinInput = document.getElementById("pincode");
  if (pinInput) pinInput.addEventListener("input", applyPincode);
  // pre-fill from profile (saved on every checkout)
  try {
    const res = await fetch(`${API_URL}/users/me`, { headers: authHeaders() });
    if (handle401(res)) return;
    if (res.ok) {
      const me = await res.json();
      setVal("fullName", me.name);
      setVal("phone", me.phone);
      setVal("address", me.address);
      setVal("city", me.city);
      setVal("state", me.state);
      setVal("pincode", me.pincode);
    }
  } catch (e) { console.error("Error loading user profile:", e); toast("Couldn't load user profile"); }

  await areasLoaded;
  const pinNow = document.getElementById("pincode");
  setupAreaDropdown(pinNow ? pinNow.value : "");
  applyPincode();
  await loadSummary();
}
function setVal(id, v) { if (v) document.getElementById(id).value = v; }

async function loadSummary() {
  try {
    const res = await fetch(`${API_URL}/cart`, { headers: authHeaders() });
    if (handle401(res)) return;
    CART = await res.json();

    if (!CART.length) {
      document.getElementById("summaryItems").innerHTML =
        `<p style="color:var(--muted);font-size:13px;">Your cart is empty. <a href="index.html" style="color:var(--maroon);font-weight:700;">Go add something ♥</a></p>`;
      cartEmpty = true;
      updatePlaceButton();
      return;
    }
    cartEmpty = false;
    updatePlaceButton();

    let total = 0;
    document.getElementById("summaryItems").innerHTML = CART.map(item => {
      const p = item.product || {};
      total += p.price * item.quantity;
      return `
        <div class="sum-line">
          <img src="${esc(imgSrc(p.image, IMG.thumb))}" alt="">
          <div style="flex:1;min-width:0;">
            <div class="sl-t">${esc(p.title)}</div>
            <div class="sl-q">Qty ${item.quantity}</div>
          </div>
          <div class="sl-p">${inr(p.price * item.quantity)}</div>
        </div>`;
    }).join("");
    document.getElementById("subTotal").textContent = inr(total);
    document.getElementById("grandTotal").textContent = inr(total);
  } catch (e) { console.error("Error loading order summary:", e); toast("Couldn't load order summary"); }
}

function pickPay(method) {
  payMethod = method;
  document.getElementById("opt-COD").classList.toggle("sel", method === "COD");
  const optUpi = document.getElementById("opt-UPI");
  if (optUpi) optUpi.classList.toggle("sel", method === "UPI");
  const upiBox = document.getElementById("upiBox");
  if (upiBox) upiBox.style.display = method === "UPI" ? "block" : "none";
}

async function placeOrder() {
  const body = {
    fullName: val("fullName"), phone: val("phone"),
    address: val("address"), city: val("city"),
    state: val("state"), pincode: val("pincode"),
    paymentMethod: payMethod
  };
  if (pincodeBlocked) {
    toast(areaMode ? "Please choose your delivery area" : "We don't deliver to this pincode yet");
    const focusEl = document.getElementById(areaMode ? "areaSelect" : "pincode");
    if (focusEl) focusEl.focus();
    return;
  }
  if (!body.fullName || !body.phone || !body.address || !body.city || !body.state || !body.pincode) {
    toast("Please fill in all delivery details");
    return;
  }

  const btn = document.getElementById("placeBtn");
  btn.disabled = true; btn.textContent = "Placing order…";

  try {
    const res = await fetch(`${API_URL}/orders/checkout`, {
      method: "POST", headers: authHeaders(true), body: JSON.stringify(body)
    });
    if (handle401(res)) return;
    const data = await res.json();

    if (!res.ok) {
      // e.g. 409 stock conflict with a useful message
      toast(data.message || "Checkout failed");
      btn.disabled = false; btn.textContent = "Place order";
      if (res.status === 409) loadSummary();
      return;
    }

    // success
    document.getElementById("checkoutView").style.display = "none";
    document.getElementById("successView").style.display = "block";
    document.getElementById("successOrderNo").textContent = "#" + data.order.id;
    document.getElementById("successPayNote").textContent =
      payMethod === "UPI"
        ? `Pay ${inr(data.order.totalAmount)} via UPI and mention order #${data.order.id} in the note — we dispatch once payment is confirmed.`
        : `Keep ${inr(data.order.totalAmount)} ready — pay when your order arrives.`;
    window.scrollTo({ top: 0 });
  } catch (e) {
    console.error("Error:", e);
    toast("Couldn't reach the server");
    btn.disabled = false; btn.textContent = "Place order";
  }
}
function val(id) { return document.getElementById(id).value.trim(); }

boot();

if (typeof module !== 'undefined') {
  module.exports = {
    toast,
    boot,
    setVal,
    loadSummary,
    pickPay,
    placeOrder,
    val,
    findArea,
    describeArea,
    deliveryList,
    applyPincode,
    _setDelivery: d => { DELIVERY = d; areaMode = false; areaMessage = ""; },
    setupAreaDropdown,
    areaOptionLabel,
    _setCartEmpty: v => { cartEmpty = v; }
  };
}
