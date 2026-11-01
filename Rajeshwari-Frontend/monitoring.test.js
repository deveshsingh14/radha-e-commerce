/**
 * monitoring.js — browser Sentry setup: only on the live site, never sends tokens/query strings.
 */
const m = require('./monitoring');
const live = { hostname: 'deveshsingh14.github.io', pathname: '/radha-e-commerce/index.html' };

describe('enabled only on the live site', () => {
  test('live shop path', () => expect(m.shouldEnable(live)).toBe(true));
  test('localhost, other paths and other hosts stay silent', () => {
    expect(m.shouldEnable({ hostname: 'localhost', pathname: '/radha-e-commerce/' })).toBe(false);
    expect(m.shouldEnable({ hostname: 'deveshsingh14.github.io', pathname: '/project-dev-vat-non-prod-01/' })).toBe(false);
    expect(m.shouldEnable({ hostname: 'evil.example', pathname: '/radha-e-commerce/' })).toBe(false);
    expect(m.shouldEnable(null)).toBe(false);
  });
  test('initMonitoring configures Sentry with privacy settings on the live site', () => {
    const init = jest.fn(), setTag = jest.fn();
    expect(m.initMonitoring({ Sentry: { init, setTag }, location: live })).toBe(true);
    const opts = init.mock.calls[0][0];
    expect(opts.dsn).toMatch(/^https:\/\/[0-9a-f]+@o\d+\.ingest\.us\.sentry\.io\/\d+$/);
    expect(opts.sendDefaultPii).toBe(false);
    expect(opts.environment).toBe('production');
    expect(opts.allowUrls[0].test('https://deveshsingh14.github.io/radha-e-commerce/store.js')).toBe(true);
    expect(opts.allowUrls[0].test('chrome-extension://abc/x.js')).toBe(false);
    expect(setTag).toHaveBeenCalledWith('page', 'index.html');
  });
  test('no Sentry bundle (blocked/offline) or not live: does nothing, never throws', () => {
    expect(m.initMonitoring({ location: live })).toBe(false);
    const init = jest.fn();
    expect(m.initMonitoring({ Sentry: { init }, location: { hostname: 'localhost', pathname: '/' } })).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });
});

describe('scrubbing', () => {
  test('reset tokens (page + API) and query strings are removed', () => {
    expect(m.scrubUrl('https://deveshsingh14.github.io/radha-e-commerce/reset-password.html?token=abc123'))
      .toBe('https://deveshsingh14.github.io/radha-e-commerce/reset-password.html');
    expect(m.scrubUrl('https://api.test/auth/reset-password/abc123')).toBe('https://api.test/auth/reset-password/[redacted]');
    expect(m.scrubUrl('https://api.test/products?limit=200&q=x@y.z')).toBe('https://api.test/products');
    expect(m.scrubUrl('https://x/p#frag')).toBe('https://x/p#frag');
  });
  test('event: url, referer, cookies, user removed; breadcrumbs scrubbed', () => {
    const e = m.scrubEvent({
      request: { url: 'https://s/reset-password.html?token=SECRET', headers: { Referer: 'https://s/?token=SECRET', 'User-Agent': 'UA' }, cookies: 'c=1', query_string: 'token=SECRET' },
      user: { email: 'a@b.c' },
      breadcrumbs: [
        { category: 'navigation', data: { from: '/a?token=SECRET', to: '/b' } },
        { category: 'fetch', data: { url: 'https://api/auth/reset-password/SECRET', method: 'POST' } },
        { category: 'console', message: 'failed https://api/x?email=a@b.c' }
      ]
    });
    const json = JSON.stringify(e);
    expect(json).not.toMatch(/SECRET|a@b\.c|c=1/);
    expect(e.request.headers).toEqual({ 'User-Agent': 'UA' });
    expect(e.user).toBeUndefined();
  });
});
