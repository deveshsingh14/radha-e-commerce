// adminOrOwnerMiddleware: token role AND current DB role must be allowed.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const dbRoles = new Map([[1, 'ADMIN'], [2, 'OWNER'], [3, 'CUSTOMER'], [4, 'DELIVERY_PARTNER'], [5, 'CUSTOMER']]);
let dbThrows = false;
const dbPath = require.resolve(path.join(__dirname, 'src/config/db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
  exports: { user: { findUnique: async ({ where }) => { if (dbThrows) throw new Error('db down'); return dbRoles.has(where.id) ? { role: dbRoles.get(where.id) } : null; } } } };
const mw = require('./src/middleware/adminOrOwnerMiddleware');

async function run(user) {
  const res = { statusCode: undefined, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let nextCalled = false;
  await mw({ user }, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test('allows ADMIN and OWNER whose DB role still matches', async () => {
  for (const [id, role] of [[1, 'ADMIN'], [2, 'OWNER']]) {
    const { res, nextCalled } = await run({ id, role });
    assert.strictEqual(nextCalled, true, role);
    assert.strictEqual(res.statusCode, undefined);
  }
});

test('rejects CUSTOMER and DELIVERY_PARTNER tokens with 403', async () => {
  for (const [id, role] of [[3, 'CUSTOMER'], [4, 'DELIVERY_PARTNER']]) {
    const { res, nextCalled } = await run({ id, role });
    assert.strictEqual(nextCalled, false, role);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.message, 'Admin or Owner access only');
  }
});

test('rejects a forged/stale token whose account no longer has the role', async () => {
  const { res, nextCalled } = await run({ id: 5, role: 'OWNER' });   // DB says CUSTOMER
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 403);
});

test('rejects a token for an account that does not exist', async () => {
  const { res, nextCalled } = await run({ id: 999, role: 'OWNER' });
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 403);
});

test('rejects tokens without a numeric id or user', async () => {
  assert.strictEqual((await run({ id: 'x', role: 'OWNER' })).res.statusCode, 403);
  assert.strictEqual((await run(undefined)).res.statusCode, 403);
});

test('fails closed (500, no next) when the DB check errors', async () => {
  dbThrows = true;
  const { res, nextCalled } = await run({ id: 1, role: 'ADMIN' });
  dbThrows = false;
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 500);
});
