/**
 * catalogue.js — instant repeat visits from a saved copy of the public catalogue.
 */
const { CATALOGUE_KEY, CATALOGUE_MAX_AGE_MS, readCatalogue, writeCatalogue, catalogueChanged, fetchWithTimeout } = require('./catalogue');

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}
const P = [{ id: 1, title: 'Kada', price: 299, categories: [] }];
const C = [{ id: 1, name: 'Bangles', isJewellery: true }];
const NOW = 1_800_000_000_000;

describe('read/write', () => {
  test('round-trips the raw API rows under a versioned key', () => {
    const s = memStorage();
    expect(writeCatalogue(s, P, C, NOW)).toBe(true);
    expect(JSON.parse(s.getItem(CATALOGUE_KEY)).v).toBe(1);
    expect(readCatalogue(s, NOW + 1000)).toEqual({ products: P, categories: C, savedAt: NOW });
  });
  test('nothing saved -> null', () => {
    expect(readCatalogue(memStorage(), NOW)).toBeNull();
  });
  test('older than 24h -> ignored', () => {
    const s = memStorage(); writeCatalogue(s, P, C, NOW);
    expect(readCatalogue(s, NOW + CATALOGUE_MAX_AGE_MS + 1)).toBeNull();
    expect(readCatalogue(s, NOW + CATALOGUE_MAX_AGE_MS - 1)).not.toBeNull();
  });
  test('timestamps from the future (clock skew/tampering) -> ignored', () => {
    const s = memStorage(); writeCatalogue(s, P, C, NOW + 10 * 60000);
    expect(readCatalogue(s, NOW)).toBeNull();
  });
  test('corrupt or wrong-shape data -> ignored, never throws', () => {
    const s = memStorage();
    for (const bad of ['{not json', 'null', '{"v":2,"savedAt":1,"products":[],"categories":[]}',
      JSON.stringify({ v: 1, savedAt: NOW, products: 'x', categories: [] }),
      JSON.stringify({ v: 1, products: [], categories: [] })]) {
      s.setItem(CATALOGUE_KEY, bad);
      expect(readCatalogue(s, NOW)).toBeNull();
    }
  });
  test('blocked storage (private mode / quota) -> no crash', () => {
    const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(readCatalogue(blocked, NOW)).toBeNull();
    expect(writeCatalogue(blocked, P, C, NOW)).toBe(false);
    expect(readCatalogue(null, NOW)).toBeNull();
  });
});

describe('catalogueChanged', () => {
  test('first load counts as changed', () => {
    expect(catalogueChanged(null, P, C)).toBe(true);
  });
  test('identical data -> no re-render', () => {
    expect(catalogueChanged({ products: JSON.parse(JSON.stringify(P)), categories: C }, P, C)).toBe(false);
  });
  test('price, stock or category flag change -> re-render', () => {
    expect(catalogueChanged({ products: P, categories: C }, [{ ...P[0], price: 349 }], C)).toBe(true);
    expect(catalogueChanged({ products: P, categories: C }, P, [{ ...C[0], isJewellery: false }])).toBe(true);
  });
});

describe('fetchWithTimeout', () => {
  test('aborts a request that takes too long', async () => {
    global.fetch = jest.fn((url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted')))));
    await expect(fetchWithTimeout('https://api.test/x', 20)).rejects.toThrow('aborted');
  });
  test('passes through a normal response', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
    await expect(fetchWithTimeout('https://api.test/x', 1000)).resolves.toEqual({ ok: true });
  });
});
