// Setup DOM first
document.body.innerHTML = `
  <div id="toast"></div>
  <input type="text" id="fullName">
  <input type="tel" id="phone">
  <textarea id="address"></textarea>
  <input type="text" id="city">
  <input type="text" id="state">
  <input type="text" id="pincode">
  <div id="summaryItems"></div>
  <span id="subTotal"></span>
  <span id="grandTotal"></span>
  <div id="opt-COD" class="sel"></div>
  <div id="opt-UPI"></div>
  <div id="upiBox" style="display:none;"></div>
  <button id="placeBtn">Place order</button>
  <div id="checkoutView"></div>
  <div id="successView" style="display:none;"></div>
  <span id="successOrderNo"></span>
  <span id="successPayNote"></span>
`;

// Mock globals

global.esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
global.NO_IMAGE_PLACEHOLDER = "";
global.imgSrc = (p) => p || "";
global.token = jest.fn(() => "mock-token");
global.authHeaders = jest.fn(() => ({}));
global.handle401 = jest.fn(() => false);
global.inr = jest.fn((n) => "₹" + n);
global.toast = jest.fn();

// JSDOM specific window location mock
delete window.location;
window.location = {
  assign: jest.fn(),
  replace: jest.fn(),
  reload: jest.fn(),
  href: 'http://localhost/',
  toString: () => 'http://localhost/'
};

// Mock scrollTo
window.scrollTo = jest.fn();

// Avoid jsdom "not implemented" error
jest.spyOn(console, 'error').mockImplementation((msg) => {
  if (msg && msg.toString().includes('Not implemented: navigation')) return;
});

// Avoid fetch errors
global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));

const { boot, setVal, loadSummary, pickPay, placeOrder, val } = require('./checkout');
const { toast } = require('./api');
global.toast = toast;

describe('checkout.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.getElementById("toast").className = "";
    document.getElementById("toast").textContent = "";
    document.getElementById("fullName").value = "";
    document.getElementById("phone").value = "";
    document.getElementById("address").value = "";
    document.getElementById("city").value = "";
    document.getElementById("state").value = "";
    document.getElementById("pincode").value = "";
    document.getElementById("summaryItems").innerHTML = "";
    document.getElementById("subTotal").textContent = "";
    document.getElementById("grandTotal").textContent = "";
    document.getElementById("opt-COD").className = "sel";
    document.getElementById("opt-UPI").className = "";
    document.getElementById("upiBox").style.display = "none";
    document.getElementById("placeBtn").disabled = false;
    document.getElementById("placeBtn").textContent = "Place order";
    document.getElementById("checkoutView").style.display = "block";
    document.getElementById("successView").style.display = "none";
    document.getElementById("successOrderNo").textContent = "";
    document.getElementById("successPayNote").textContent = "";
  });

  describe('boot', () => {
    it('fetches user profile and populates fields, then loads summary', async () => {
      const mockProfile = {
        name: "Test User",
        phone: "1234567890",
        address: "123 Main St",
        city: "Test City",
        state: "Test State",
        pincode: "123456"
      };

      global.fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockProfile)
      })).mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]) // Mock empty cart for loadSummary
      }));

      await boot();

      expect(global.fetch).toHaveBeenCalledWith(`${API_URL}/users/me`, { headers: {} });
      expect(document.getElementById("fullName").value).toBe(mockProfile.name);
      expect(document.getElementById("phone").value).toBe(mockProfile.phone);
      expect(document.getElementById("address").value).toBe(mockProfile.address);
      expect(document.getElementById("city").value).toBe(mockProfile.city);
      expect(document.getElementById("state").value).toBe(mockProfile.state);
      expect(document.getElementById("pincode").value).toBe(mockProfile.pincode);
    });

    it('shows toast on fetch profile error', async () => {
      global.fetch.mockImplementationOnce(() => Promise.reject(new Error("Network error")));

      await boot();

      expect(document.getElementById("toast").textContent).toBe("Couldn't load user profile");
      expect(document.getElementById("toast").classList.contains("show")).toBe(true);
    });
  });

  describe('loadSummary', () => {
    it('shows empty bag message and disables place button when cart is empty', async () => {
      global.fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve([])
      }));

      await loadSummary();

      expect(document.getElementById("summaryItems").innerHTML).toContain("Your cart is empty");
      expect(document.getElementById("placeBtn").disabled).toBe(true);
    });

    it('calculates total and renders items when cart is not empty', async () => {
      const mockCart = [
        { product: { title: "Item 1", price: 100, image: "img1.png" }, quantity: 2 },
        { product: { title: "Item 2", price: 200, image: "img2.png" }, quantity: 1 }
      ];

      global.fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockCart)
      }));

      await loadSummary();

      expect(document.getElementById("summaryItems").innerHTML).toContain("Item 1");
      expect(document.getElementById("summaryItems").innerHTML).toContain("Qty 2");
      expect(document.getElementById("summaryItems").innerHTML).toContain("Item 2");
      expect(document.getElementById("summaryItems").innerHTML).toContain("Qty 1");

      // Total should be (100 * 2) + (200 * 1) = 400
      expect(document.getElementById("subTotal").textContent).toBe("₹400");
      expect(document.getElementById("grandTotal").textContent).toBe("₹400");
      expect(document.getElementById("placeBtn").disabled).toBe(false);
    });

    it('shows toast on fetch cart error', async () => {
      global.fetch.mockImplementationOnce(() => Promise.reject(new Error("Network error")));

      await loadSummary();

      expect(document.getElementById("toast").textContent).toBe("Couldn't load order summary");
      expect(document.getElementById("toast").classList.contains("show")).toBe(true);
    });
  });

  describe('pickPay', () => {
    it('switches to COD and hides upiBox', () => {
      pickPay("COD");
      expect(document.getElementById("opt-COD").classList.contains("sel")).toBe(true);
      expect(document.getElementById("opt-UPI").classList.contains("sel")).toBe(false);
      expect(document.getElementById("upiBox").style.display).toBe("none");
    });

    it('switches to UPI and shows upiBox', () => {
      pickPay("UPI");
      expect(document.getElementById("opt-COD").classList.contains("sel")).toBe(false);
      expect(document.getElementById("opt-UPI").classList.contains("sel")).toBe(true);
      expect(document.getElementById("upiBox").style.display).toBe("block");
    });
  });

  describe('placeOrder', () => {
    beforeEach(() => {
      // Set valid delivery details
      document.getElementById("fullName").value = "Test User";
      document.getElementById("phone").value = "1234567890";
      document.getElementById("address").value = "123 Main St";
      document.getElementById("city").value = "Test City";
      document.getElementById("state").value = "Test State";
      document.getElementById("pincode").value = "123456";
    });

    it('shows toast if delivery details are incomplete', async () => {
      document.getElementById("fullName").value = "";

      await placeOrder();

      expect(document.getElementById("toast").textContent).toBe("Please fill in all delivery details");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('places order successfully with COD', async () => {
      pickPay("COD");
      const mockResponse = { order: { id: 123, totalAmount: 400 } };

      global.fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      }));

      await placeOrder();

      expect(global.fetch).toHaveBeenCalledWith(`${API_URL}/orders/checkout`, expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"paymentMethod":"COD"')
      }));

      expect(document.getElementById("checkoutView").style.display).toBe("none");
      expect(document.getElementById("successView").style.display).toBe("block");
      expect(document.getElementById("successOrderNo").textContent).toBe("#123");
      expect(document.getElementById("successPayNote").textContent).toContain("Keep ₹400 ready");
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
    });

    it('places order successfully with UPI', async () => {
      pickPay("UPI");
      const mockResponse = { order: { id: 456, totalAmount: 500 } };

      global.fetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      }));

      await placeOrder();

      expect(document.getElementById("checkoutView").style.display).toBe("none");
      expect(document.getElementById("successView").style.display).toBe("block");
      expect(document.getElementById("successOrderNo").textContent).toBe("#456");
      expect(document.getElementById("successPayNote").textContent).toContain("Pay ₹500 via UPI");
    });

    it('handles 409 conflict error by reloading summary', async () => {
      global.fetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ message: "Item out of stock" })
      })).mockImplementationOnce(() => Promise.resolve({
        // mock loadSummary fetch
        ok: true,
        json: () => Promise.resolve([])
      }));

      await placeOrder();

      expect(document.getElementById("toast").textContent).toBe("Item out of stock");
      expect(document.getElementById("placeBtn").disabled).toBe(false);
      expect(global.fetch).toHaveBeenCalledTimes(2); // One for checkout, one for loadSummary
    });

    it('handles server network error', async () => {
      global.fetch.mockImplementationOnce(() => Promise.reject(new Error("Network error")));

      await placeOrder();

      expect(document.getElementById("toast").textContent).toBe("Couldn't reach the server");
      expect(document.getElementById("placeBtn").disabled).toBe(false);
      expect(document.getElementById("placeBtn").textContent).toBe("Place order");
    });
  });
});
