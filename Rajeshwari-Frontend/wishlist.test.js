/**
 * wishlist.js — instant hearts, tap-safe syncing.
 */
const { createWishlistSync } = require('./wishlist');

function fakeServer({ failPost = false, failDelete = false, delay = 5 } = {}) {
  const rows = new Map(); let nextId = 100; const calls = [];
  const wait = () => new Promise(r => setTimeout(r, delay));
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetchFn = async (url, opts = {}) => {
    const method = opts.method || 'GET'; calls.push(`${method} ${url.replace('https://api', '')}`);
    await wait();
    if (method === 'GET') return json(200, [...rows].map(([productId, id]) => ({ id, productId })));
    if (method === 'POST') {
      if (failPost) return json(500, {});
      const { productId } = JSON.parse(opts.body);
      if (rows.has(productId)) return json(400, { message: 'Already in wishlist' });
      const id = nextId++; rows.set(productId, id); return json(200, { id, productId });
    }
    if (method === 'DELETE') {
      if (failDelete) return json(500, {});
      const id = Number(url.split('/').pop());
      for (const [pid, rid] of rows) if (rid === id) { rows.delete(pid); return json(200, {}); }
      return json(404, {});
    }
  };
  return { fetchFn, rows, calls };
}
const make = (srv, extra = {}) => createWishlistSync({ apiUrl: 'https://api', fetchFn: srv.fetchFn, headers: () => ({}), ...extra });

test('a tap changes the heart immediately, before the server answers', async () => {
  const srv = fakeServer({ delay: 50 }); const changes = [];
  const w = make(srv, { onChange: (id, s) => changes.push([id, s]) });
  w.toggle(7);
  expect(w.isSaved(7)).toBe(true);           // instantly
  expect(changes).toEqual([[7, true]]);
  expect(srv.rows.has(7)).toBe(false);       // server not done yet
  await w.idle();
  expect(srv.rows.has(7)).toBe(true);
  expect(w.serverId(7)).toBe(100);
});

test('7 rapid taps: final state = last tap, at most 2 requests, server matches', async () => {
  const srv = fakeServer({ delay: 30 });
  const w = make(srv);
  for (let i = 0; i < 7; i++) w.toggle(7);    // ends "saved" (odd number of taps)
  expect(w.isSaved(7)).toBe(true);
  await w.idle();
  expect(srv.rows.has(7)).toBe(true);
  expect(srv.calls.length).toBeLessThanOrEqual(2);
  expect(w.isSaved(7)).toBe(true);
});

test('even number of rapid taps ends unsaved and the server agrees', async () => {
  const srv = fakeServer({ delay: 30 });
  const w = make(srv);
  for (let i = 0; i < 6; i++) w.toggle(7);
  await w.idle();
  expect(w.isSaved(7)).toBe(false);
  expect(srv.rows.has(7)).toBe(false);
  expect(srv.calls.length).toBeLessThanOrEqual(2);
});

test('server failure: heart goes back to the real state and one error is reported', async () => {
  const srv = fakeServer({ failPost: true }); const errors = []; const changes = [];
  const w = make(srv, { onError: e => errors.push(e.message), onChange: (id, s) => changes.push(s) });
  w.toggle(7); w.toggle(7); w.toggle(7);
  await w.idle();
  expect(w.isSaved(7)).toBe(false);
  expect(errors).toHaveLength(1);
  expect(changes[changes.length - 1]).toBe(false);
});

test('already saved elsewhere (400) is treated as saved, learning the row id', async () => {
  const srv = fakeServer(); srv.rows.set(7, 555);
  const w = make(srv);                         // this tab doesn't know yet
  w.toggle(7);
  await w.idle();
  expect(w.isSaved(7)).toBe(true);
  expect(w.serverId(7)).toBe(555);
  w.toggle(7); await w.idle();                 // and it can be removed again
  expect(srv.rows.has(7)).toBe(false);
});

test('removing something already removed elsewhere (404) just ends unsaved', async () => {
  const srv = fakeServer(); const errors = [];
  const w = make(srv, { onError: e => errors.push(e) });
  w.loadFromServer([{ id: 900, productId: 7 }]);  // stale view: server doesn't have it
  w.toggle(7); await w.idle();
  expect(w.isSaved(7)).toBe(false);
  expect(errors).toHaveLength(0);
});

test('loadFromServer, count, ids and clear (logout)', () => {
  const w = make(fakeServer());
  w.loadFromServer([{ id: 1, productId: 3 }, { id: 2, product: { id: 4 } }]);
  expect(w.count()).toBe(2);
  expect(w.ids().sort()).toEqual([3, 4]);
  w.clear();
  expect(w.count()).toBe(0);
});
