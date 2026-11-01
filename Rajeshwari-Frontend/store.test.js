// Mock fetch and API variables before requiring
global.fetch = jest.fn((url) => {
  return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
});

global.NO_IMAGE_PLACEHOLDER = "";
global.imgSrc = (p) => p || "";
global.esc = (s) => s;
// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock localStorage
global.localStorage = {
  getItem: jest.fn(() => null),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};

// Setup DOM before requiring store.js
document.body.innerHTML = `
  <div id="toast"></div>
  <div id="masonry"></div>
  <div id="storiesRail"></div>
  <input id="searchInput" />
  <select id="sortSelect"><option value="newest"></option></select>
  <div id="feedEnd"></div>
  <div id="sheetGrid"></div>
  <div id="productSheet"></div>
  <div id="wishCount"></div>
  <div id="sheetHeart"></div>
  <div id="wishBack"></div>
  <div id="wishlistItems"></div>
  <div id="cartCount"></div>
  <div id="cartBack"></div>
  <div id="cartItems"></div>
  <div id="cartTotal"></div>
  <div id="authModal"></div>
  <div id="authTitle"></div>
  <div id="authSub"></div>
  <div id="authBtn"></div>
  <input id="authName" />
  <div id="authSwitchText"></div>
  <div id="authSwitchBtn"></div>
  <input id="authEmail" />
  <input id="authPassword" />
  <div id="loginBtn"></div>
  <div id="logoutBtn"></div>
  <div id="accountBtn"></div>
`;

// Avoid fetch errors by spying on console.error
jest.spyOn(console, 'error').mockImplementation(() => {});

const { inr } = require('./api');

describe('inr currency formatter', () => {
  it('formats positive integers correctly with Indian numbering system', () => {
    expect(inr(100)).toBe('₹100');
    expect(inr(1000)).toBe('₹1,000');
    expect(inr(100000)).toBe('₹1,00,000');
    expect(inr(10000000)).toBe('₹1,00,00,000'); // 1 crore
  });

  it('formats zero correctly', () => {
    expect(inr(0)).toBe('₹0');
  });

  it('formats negative numbers correctly', () => {
    expect(inr(-100)).toBe('₹-100');
    expect(inr(-100000)).toBe('₹-1,00,000');
  });

  it('formats decimal numbers correctly', () => {
    expect(inr(100.5)).toBe('₹100.5');
    expect(inr(1000.99)).toBe('₹1,000.99');
    expect(inr(100000.123)).toBe('₹1,00,000.123'); // toLocaleString default precision
  });

  it('handles undefined, null, and empty string as zero', () => {
    expect(inr(undefined)).toBe('₹0');
    expect(inr(null)).toBe('₹0');
    expect(inr('')).toBe('₹0');
  });

  it('handles string numbers correctly', () => {
    expect(inr('1000')).toBe('₹1,000');
    expect(inr('100000')).toBe('₹1,00,000');
    expect(inr('100.5')).toBe('₹100.5');
  });

  it('handles non-numeric strings by returning NaN formatted', () => {
    expect(inr('abc')).toBe('₹NaN');
  });
});
