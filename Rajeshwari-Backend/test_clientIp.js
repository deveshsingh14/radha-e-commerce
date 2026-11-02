// Real visitor IP behind Render/Cloudflare, and per-visitor rate limits.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { clientIp } = require('./src/utils/clientIp');

test('clientIp prefers Cloudflare, then True-Client-IP, then req.ip', () => {
  assert.strictEqual(clientIp({ headers: { 'cf-connecting-ip': '203.0.113.7' }, ip: '10.0.0.1' }), '203.0.113.7');
  assert.strictEqual(clientIp({ headers: { 'true-client-ip': '198.51.100.2, 10.0.0.9' }, ip: '10.0.0.1' }), '198.51.100.2');
  assert.strictEqual(clientIp({ headers: {}, ip: '192.0.2.4' }), '192.0.2.4');
  assert.strictEqual(clientIp({ headers: {}, socket: { remoteAddress: '::1' } }), '::1');
  assert.strictEqual(clientIp({}), 'unknown');
});

test('login limit is per visitor, not shared by everyone behind the proxy', async () => {
  delete require.cache[require.resolve('./src/middleware/authRateLimiter')];
  const { loginLimiter } = require('./src/middleware/authRateLimiter');
  const app = express();
  app.set('trust proxy', 1);
  app.post('/login', loginLimiter, (req, res) => res.json({ ok: true }));
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}/login`;
  const hit = ip => fetch(url, { method: 'POST', headers: { 'CF-Connecting-IP': ip } }).then(r => r.status);
  try {
    for (let i = 0; i < 10; i++) assert.strictEqual(await hit('203.0.113.10'), 200);
    assert.strictEqual(await hit('203.0.113.10'), 429, 'visitor A is limited after 10 tries');
    assert.strictEqual(await hit('203.0.113.20'), 200, 'visitor B is NOT affected by A');
  } finally { server.close(); }
});
