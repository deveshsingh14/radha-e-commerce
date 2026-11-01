// Setup DOM first
const domElements = [
  "toast", "sidebar", "view-dashboard", "view-products", "crumb", "pageTitle",
  "adminAvatar", "editModal", "detailsModal", "adminCpOld", "adminCpNew",
  "adminCpConfirm", "promotionToggleContainer", "btnCreateOwnerModal", "revRange",
  "statusChart", "bulkUploadFile", "f-cat", "f-search", "f-stock", "productGrid",
  "addForm", "pCat", "imagePreview", "editImagePreview", "categoryGrid",
  "pincodeCheck", "pincodeList", "o-search", "o-status", "orderGrid",
  "paymentGrid", "customerGrid", "repStart", "repEnd", "repRev", "repOrders",
  "repAov", "catChart", "productSearch", "productCategoryFilter",
  "productStockFilter", "orderSearch", "orderStatusFilter",
  "customerSearch", "deliveryAreaSearch"
];

document.body.innerHTML = domElements.map(id => `<div id="${id}"></div>`).join('') + `
  <canvas id="revChart"></canvas>
  <button id="btnCreateOwnerModal"></button>
`;

// Mock globals

global.esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
global.NO_IMAGE_PLACEHOLDER = "";
global.imgSrc = (p) => p || "";
global.token = () => "mock-token";
global.authHeaders = jest.fn(() => ({}));
global.handle401 = jest.fn(() => false);
global.inr = jest.fn((n) => "₹" + n);
global.Chart = jest.fn().mockImplementation(() => ({
  destroy: jest.fn()
}));

// JSDOM specific window location mock
delete window.location;
window.location = {
  assign: jest.fn(),
  replace: jest.fn(),
  reload: jest.fn(),
  href: 'http://localhost/',
  toString: () => 'http://localhost/'
};
window.alert = jest.fn();

// Avoid jsdom "not implemented" error
jest.spyOn(console, 'error').mockImplementation((msg) => {
  if (msg && msg.toString().includes('Not implemented: navigation')) return;
});

// Avoid fetch errors
global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }));

global.localStorage = {
  getItem: jest.fn(() => null),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};

// Import code
const { shortDate, statusBadge, stockBadge, revenueOf } = require('./admin');

describe('Admin panel helpers', () => {
  describe('shortDate', () => {
    it('formats a valid date string correctly', () => {
      // 2023-01-15T00:00:00Z -> Should format nicely. We can mock Date or just check general output.
      const dateStr = "2023-01-15T00:00:00Z";
      const formatted = shortDate(dateStr);
      // Depending on node timezone it might be slightly different, but should contain Jan and 23
      expect(formatted).toMatch(/15|14/); // day
      expect(formatted).toMatch(/Jan/i); // month
      expect(formatted).toMatch(/23/); // year
    });

    it('returns "—" for missing or invalid dates', () => {
      expect(shortDate(null)).toBe("—");
      expect(shortDate(undefined)).toBe("—");
      expect(shortDate("")).toBe("—");
    });
  });

  describe('statusBadge', () => {
    it('returns correctly styled badges for each status', () => {
      expect(statusBadge("Delivered")).toContain("b-ok");
      expect(statusBadge("Shipped")).toContain("b-info");
      expect(statusBadge("Pending")).toContain("b-warn");
      expect(statusBadge("Cancelled")).toContain("b-bad");
    });

    it('returns a mute badge for unknown status', () => {
      expect(statusBadge("Unknown")).toContain("b-mute");
      expect(statusBadge(null)).toContain("b-mute");
      expect(statusBadge("")).toContain("b-mute");
    });
  });

  describe('stockBadge', () => {
    it('returns "Out of stock" for stock <= 0', () => {
      expect(stockBadge(0)).toContain("Out of stock");
      expect(stockBadge(0)).toContain("b-bad");
      expect(stockBadge(-5)).toContain("Out of stock");
    });

    it('returns "Low" for stock between 1 and 5 (assuming LOW_STOCK is 5)', () => {
      expect(stockBadge(3)).toContain("Low");
      expect(stockBadge(3)).toContain("b-warn");
      expect(stockBadge(5)).toContain("Low");
    });

    it('returns "In stock" for stock > LOW_STOCK', () => {
      expect(stockBadge(6)).toContain("In stock");
      expect(stockBadge(6)).toContain("b-ok");
      expect(stockBadge(100)).toContain("In stock");
    });
  });

  describe('revenueOf', () => {
    it('calculates total revenue excluding cancelled orders', () => {
      const orders = [
        { status: "Delivered", totalAmount: 100 },
        { status: "Shipped", totalAmount: 200 },
        { status: "Pending", totalAmount: 50 },
        { status: "Cancelled", totalAmount: 500 } // Should be ignored
      ];
      expect(revenueOf(orders)).toBe(350);
    });

    it('returns 0 for empty array', () => {
      expect(revenueOf([])).toBe(0);
    });

    it('returns 0 if all orders are cancelled', () => {
      const orders = [
        { status: "Cancelled", totalAmount: 100 },
        { status: "Cancelled", totalAmount: 200 }
      ];
      expect(revenueOf(orders)).toBe(0);
    });
  });
});

  describe('toast', () => {
    it('shows toast with message and default kind', () => {
      jest.useFakeTimers();
      const toastEl = document.getElementById("toast");

      const { toast } = require('./api');
      toast("Test message");

      expect(toastEl.textContent).toBe("Test message");
      expect(toastEl.className).toBe("show ok");

      jest.runAllTimers();
      expect(toastEl.className).toBe("ok");

      jest.useRealTimers();
    });

    it('shows toast with custom kind', () => {
      jest.useFakeTimers();
      const toastEl = document.getElementById("toast");

      const { toast } = require('./api');
      toast("Error message", "err");

      expect(toastEl.textContent).toBe("Error message");
      expect(toastEl.className).toBe("show err");

      jest.runAllTimers();
      expect(toastEl.className).toBe("err");

      jest.useRealTimers();
    });
  });

describe('Category section toggle (Jewellery & Bangles page)', () => {
  const admin = require('./admin');

  beforeEach(() => {
    for (const id of ['categoryList', 'productCategoryOptions']) {
      if (!document.getElementById(id)) {
        const el = document.createElement('div'); el.id = id; document.body.appendChild(el);
      }
    }
    global.catchErr = jest.fn();
    global.toast = jest.fn(); // provided by api.js in the browser
    admin._setState({
      CATEGORIES: [{ id: 1, name: 'Bangles', isJewellery: false }, { id: 2, name: 'Skin <b>care</b>', isJewellery: false }],
      PRODUCTS: []
    });
    global.fetch.mockClear();
  });

  it('renders a jewellery switch per category and escapes names', () => {
    admin.renderCategories();
    const list = document.getElementById('categoryList');
    expect(list.querySelectorAll('.jewel-toggle input[type=checkbox]')).toHaveLength(2);
    expect(list.innerHTML).toContain('Skin &lt;b&gt;care&lt;/b&gt;');
    expect(list.innerHTML).toContain('Main store');
  });

  it('PATCHes the category and re-renders it as jewellery', async () => {
    global.fetch.mockImplementationOnce(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ id: 1, name: 'Bangles', isJewellery: true })
    }));
    await admin.setCategoryJewellery(1, true, { checked: true });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/categories\/1$/);
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ isJewellery: true });
    const list = document.getElementById('categoryList');
    expect(list.querySelector('.cat-card.is-jewellery h4').textContent).toContain('Bangles');
    expect(list.innerHTML).toContain('Jewellery page');
    expect(global.toast).toHaveBeenCalledWith('Now shown on the Jewellery & Bangles page');
    expect(global.catchErr).not.toHaveBeenCalled();
  });

  it('reverts the checkbox when saving fails', async () => {
    global.fetch.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }));
    const box = { checked: true };
    await admin.setCategoryJewellery(2, true, box);
    expect(box.checked).toBe(false);
    expect(global.catchErr).toHaveBeenCalled();
  });
});

describe('Customers: role dropdown is safe against hostile names', () => {
  const admin = require('./admin');
  const realEsc = require('./api').esc; // the browser uses api.js's esc (escapes quotes too)
  let stubEsc;
  beforeAll(() => { stubEsc = global.esc; global.esc = realEsc; });
  afterAll(() => { global.esc = stubEsc; });
  beforeEach(() => {
    const search = document.getElementById('customerSearch');
    if (search && search.tagName !== 'INPUT') search.outerHTML = '<input id="customerSearch" value="">';
    if (!document.getElementById('customersTable')) {
      document.body.insertAdjacentHTML('beforeend', '<table id="customersTable"><tbody></tbody></table>');
    }
  });

  it.each([
    [`x');alert(1);//`],
    [`a"); alert(1); ("`],
    [`</select><img src=x onerror=alert(1)>`]
  ])('name %s is never part of any script and reaches changeRole as plain text', (evil) => {
    admin._setState({ adminUser: { id: 1, role: 'ADMIN' }, CUSTOMERS: [{ id: 5, name: evil, email: 'e@x.test', role: 'CUSTOMER' }] });
    admin.renderCustomers();
    const table = document.querySelector('#customersTable');
    expect(table.querySelector('img')).toBeNull();
    expect(table.querySelectorAll('[onchange],[onclick]').length).toBe(0); // no inline handlers at all
    const select = table.querySelector('select.role-select');
    expect([...select.options].map(o => o.value)).toEqual(['ADMIN', 'OWNER', 'DELIVERY_PARTNER', 'CUSTOMER']);

    const role = jest.fn();
    const orig = admin.customerActions.role;
    admin.customerActions.role = role;
    select.value = 'DELIVERY_PARTNER';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    admin.customerActions.role = orig;
    expect(role).toHaveBeenCalledTimes(1);
    expect(role.mock.calls[0][0]).toMatchObject({ id: 5, name: evil });
    expect(role.mock.calls[0][1]).toBe(select);
  });

  it('the master admin (flagged by the server) cannot be demoted or deleted from the UI', () => {
    admin._setState({ adminUser: { id: 1, role: 'ADMIN' }, CUSTOMERS: [
      { id: 2, name: 'Devesh', email: 'devesh@x.test', role: 'ADMIN', isSuperAdmin: true },
      { id: 3, name: 'Other admin', email: 'o@x.test', role: 'ADMIN', isSuperAdmin: false }
    ] });
    admin.renderCustomers();
    const row = id => document.querySelector(`#customersTable tr[data-customer="${id}"]`);
    expect(row(2).querySelector('select')).toBeNull();
    expect(row(2).querySelector('[data-action="delete"]')).toBeNull();
    expect(row(2).textContent).toContain('Master admin');
    expect(row(3).querySelector('select')).not.toBeNull();
    expect(row(3).querySelector('[data-action="delete"]')).not.toBeNull();
  });

  it('Orders and Delete buttons reach their actions with the right customer', () => {
    admin._setState({ adminUser: { id: 1, role: 'ADMIN' }, CUSTOMERS: [{ id: 9, name: 'Asha', email: 'a@x.test', role: 'CUSTOMER' }] });
    admin.renderCustomers();
    const orders = jest.fn(), del = jest.fn();
    const o1 = admin.customerActions.orders, o2 = admin.customerActions.delete;
    admin.customerActions.orders = orders; admin.customerActions.delete = del;
    document.querySelector('[data-action="orders"]').click();
    document.querySelector('[data-action="delete"]').click();
    admin.customerActions.orders = o1; admin.customerActions.delete = o2;
    expect(orders.mock.calls[0][0]).toMatchObject({ id: 9 });
    expect(del.mock.calls[0][0]).toMatchObject({ id: 9 });
  });

  it('shows a Delivery partner badge for partners (when not editable)', () => {
    admin._setState({ adminUser: { id: 1, role: 'OWNER' }, CUSTOMERS: [{ id: 6, name: 'Ravi', email: 'r@x.test', role: 'DELIVERY_PARTNER' }] });
    admin.renderCustomers();
    expect(document.querySelector('#customersTable .badge').textContent).toBe('Delivery partner');
  });
});

describe('orders whose customer account was deleted', () => {
  const { orderEmail, orderCustomer, deletedAccountTag } = require('./admin');
  const live = { userId: 3, fullName: 'Asha K', user: { name: 'Asha', email: 'asha@x.test' }, customerEmail: 'old@x.test' };
  const gone = { userId: null, user: null, fullName: 'Asha K', customerEmail: 'asha@x.test' };

  it('uses the live account email when it exists, else the snapshot', () => {
    expect(orderEmail(live)).toBe('asha@x.test');
    expect(orderEmail(gone)).toBe('asha@x.test');
    expect(orderEmail({ userId: null })).toBe('');
  });
  it('still names the customer', () => {
    expect(orderCustomer(gone)).toBe('Asha K');
    expect(orderCustomer({ userId: null, customerEmail: 'z@x.test' })).toBe('z@x.test');
    expect(orderCustomer({})).toBe('—');
  });
  it('labels deleted accounts only', () => {
    expect(deletedAccountTag(gone)).toMatch(/Deleted account/);
    expect(deletedAccountTag(live)).toBe('');
  });
});
