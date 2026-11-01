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

async function boot() {
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
      document.getElementById("placeBtn").disabled = true;
      return;
    }

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
    val
  };
}
