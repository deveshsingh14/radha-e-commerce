// Mock localStorage
let store = {};
global.localStorage = {
  getItem: jest.fn((key) => store[key] || null),
  setItem: jest.fn((key, value) => { store[key] = value; }),
  removeItem: jest.fn((key) => { delete store[key]; }),
  clear: jest.fn(() => { store = {}; })
};

// Mock alert
global.alert = jest.fn();

const { inr, esc, imgSrc, token, authHeaders, toast, catchErr, API_URL } = require('./api');

describe('api.js utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
    store = {};
  });

  describe('inr', () => {
    it('formats positive integers', () => {
      expect(inr(100)).toBe('₹100');
      expect(inr(1000)).toBe('₹1,000');
      expect(inr(100000)).toBe('₹1,00,000');
    });

    it('formats zero and handles null/undefined', () => {
      expect(inr(0)).toBe('₹0');
      expect(inr(null)).toBe('₹0');
      expect(inr(undefined)).toBe('₹0');
    });

    it('formats negative numbers', () => {
      expect(inr(-100)).toBe('₹-100');
    });

    it('handles string numbers', () => {
      expect(inr('1000')).toBe('₹1,000');
    });
  });

  describe('esc', () => {
    it('handles null and undefined', () => {
      expect(esc(null)).toBe('');
      expect(esc(undefined)).toBe('');
    });

    it('escapes HTML characters', () => {
      expect(esc('<script>alert("XSS & hacking \'fun\'")</script>'))
        .toBe('&lt;script&gt;alert(&quot;XSS &amp; hacking &#039;fun&#039;&quot;)&lt;/script&gt;');
    });

    it('returns string for numbers or booleans', () => {
      expect(esc(123)).toBe('123');
      expect(esc(true)).toBe('true');
    });
  });

  describe('imgSrc', () => {
    it('returns NO_IMAGE_PLACEHOLDER for falsy values', () => {
      expect(imgSrc(null)).toContain('data:image/svg+xml');
      expect(imgSrc('')).toContain('data:image/svg+xml');
      expect(imgSrc(undefined)).toContain('data:image/svg+xml');
    });

    it('returns absolute URL unchanged', () => {
      const url = 'http://example.com/image.jpg';
      expect(imgSrc(url)).toBe(url);
      const httpsUrl = 'https://example.com/image.png';
      expect(imgSrc(httpsUrl)).toBe(httpsUrl);
    });

    it('prepends API_URL for relative paths', () => {
      expect(imgSrc('/uploads/test.jpg')).toBe(API_URL + '/uploads/test.jpg');
    });
  });

  describe('token', () => {
    it('returns token from localStorage', () => {
      global.localStorage.setItem('token', 'my-mock-token');
      expect(token()).toBe('my-mock-token');
    });
  });

  describe('authHeaders', () => {
    it('returns headers with Authorization', () => {
      global.localStorage.setItem('token', 'my-mock-token');
      const headers = authHeaders();
      expect(headers).toEqual({ Authorization: 'Bearer my-mock-token' });
    });

    it('includes Content-Type when json is true', () => {
      global.localStorage.setItem('token', 'my-mock-token');
      const headers = authHeaders(true);
      expect(headers).toEqual({
        Authorization: 'Bearer my-mock-token',
        'Content-Type': 'application/json'
      });
    });
  });

  describe('toast', () => {
    it('uses alert if toast element is not in DOM', () => {
      toast('Test alert message');
      expect(global.alert).toHaveBeenCalledWith('Test alert message');
    });

    it('updates toast element and adds classes if in DOM', () => {
      document.body.innerHTML = '<div id="toast"></div>';
      toast('Test toast message');

      const t = document.getElementById('toast');
      expect(t.textContent).toBe('Test toast message');
      expect(t.className).toBe('show ok');
    });

    it('uses custom kind if provided', () => {
      document.body.innerHTML = '<div id="toast"></div>';
      toast('Test error message', 'error');

      const t = document.getElementById('toast');
      expect(t.className).toBe('show error');
    });

    it('removes show class after timeout', () => {
      jest.useFakeTimers();
      document.body.innerHTML = '<div id="toast"></div>';
      toast('Test message');

      const t = document.getElementById('toast');
      expect(t.className).toBe('show ok');

      jest.advanceTimersByTime(2500);
      expect(t.className).toBe('ok');
      expect(t.classList.contains('show')).toBe(false);

      jest.useRealTimers();
    });
  });
});

describe('catchErr', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = '<div id="toast"></div>';
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('logs the error to console.error', () => {
    const error = new Error('Test error');
    catchErr(error, 'Message');

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error:', error);
  });

  it('sets el.textContent if el is provided', () => {
    const el = { textContent: '' };
    const error = new Error('Test error');

    catchErr(error, 'Message', el);

    expect(el.textContent).toBe('Message');
  });

  it('calls toast with err kind if no el is given but msg is provided', () => {
    const error = new Error('Test error');

    catchErr(error, 'Message');

    const t = document.getElementById('toast');
    expect(t.textContent).toBe('Message');
    expect(t.className).toBe('show err');
  });

  it('only logs to console.error if neither el nor msg is provided', () => {
    const error = new Error('Test error');
    const t = document.getElementById('toast');
    t.className = 'initial';
    t.textContent = 'initial';

    catchErr(error);

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error:', error);
    expect(t.textContent).toBe('initial');
    expect(t.className).toBe('initial');
  });
});

describe('order line snapshot helpers', () => {
  const { itemTitle, itemImage } = require('./api');
  test('prefer the snapshot stored on the order line', () => {
    expect(itemTitle({ title: 'Gold Bangle', product: { title: 'Renamed' } })).toBe('Gold Bangle');
    expect(itemImage({ image: 'a.jpg', product: { image: 'b.jpg' } })).toBe('a.jpg');
  });
  test('fall back to the live product for older lines', () => {
    expect(itemTitle({ product: { title: 'Kada' } })).toBe('Kada');
    expect(itemImage({ product: { image: 'k.jpg' } })).toBe('k.jpg');
  });
  test('deleted product with no snapshot still renders something sensible', () => {
    expect(itemTitle({ productId: null, product: null })).toBe('Product (no longer listed)');
    expect(itemImage({ product: null })).toBeNull();
    expect(itemTitle(undefined)).toBe('Product (no longer listed)');
  });
});

describe('imgSrc sizing (Cloudinary)', () => {
  const { imgSrc, IMG, NO_IMAGE_PLACEHOLDER } = require('./api');
  const up = 'https://res.cloudinary.com/skqhke5p/image/upload/v1788778170/radha-products/x.jpg';
  test('adds resize + auto format/quality to plain Cloudinary uploads', () => {
    expect(imgSrc(up, IMG.card)).toBe('https://res.cloudinary.com/skqhke5p/image/upload/f_auto,q_auto,c_limit,w_600/v1788778170/radha-products/x.jpg');
    expect(imgSrc(up, 160.4)).toContain(',w_160/v1788778170/');
  });
  test('no width = original URL (backwards compatible)', () => {
    expect(imgSrc(up)).toBe(up);
    expect(imgSrc(up, 0)).toBe(up);
  });
  test('leaves already-transformed, other hosts and legacy uploads alone', () => {
    const t = 'https://res.cloudinary.com/skqhke5p/image/upload/w_100/v1/x.jpg';
    expect(imgSrc(t, 600)).toBe(t);
    expect(imgSrc('https://example.com/a.jpg', 600)).toBe('https://example.com/a.jpg');
    expect(imgSrc('http://res.cloudinary.com/x/image/upload/v1/a.jpg', 600)).toBe('http://res.cloudinary.com/x/image/upload/v1/a.jpg');
    expect(imgSrc('/uploads/a.jpg', 600)).toMatch(/\/uploads\/a\.jpg$/);
    expect(imgSrc(null, 600)).toMatch(/^data:image\/svg\+xml,/);
  });
  test('size presets', () => {
    expect(IMG).toEqual({ thumb: 200, story: 160, card: 600, similar: 300, detail: 1000 });
  });
});
