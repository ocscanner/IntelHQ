// Run: node --test test/proxy.test.mjs   (no dependencies; upstream sites and Claude are faked)
import test from 'node:test';
import assert from 'node:assert/strict';

let claudeCalls = 0, fetched = [];
globalThis.fetch = async (url, opts = {}) => {
  url = String(url); fetched.push(url);
  if (url.startsWith('https://api.anthropic.com/')) {
    claudeCalls++;
    const body = JSON.parse(opts.body);
    assert.ok(!body.messages[0].content.includes('PLANTED'), 'caller headlines must never reach Claude');
    return new Response(JSON.stringify({ content: [{ text: 'Digest from server headlines.' }] }), { status: 200 });
  }
  if (url.includes('api.adsb.lol')) return new Response('{"ac":[{"hex":"a1"}]}', { status: 200 });
  // any RSS feed: 8 items so collectHeadlines finds enough
  const items = Array.from({ length: 8 }, (_, i) => `<item><title>Server headline number ${i} from ${new URL(url).hostname}</title></item>`).join('');
  return new Response(`<rss><channel><title>Chan</title>${items}</channel></rss>`, { status: 200 });
};

const kvStore = new Map();
const env = {
  ANTHROPIC_API_KEY: 'test-only',
  DIGEST_KV: {
    async get(k, type) { const v = kvStore.get(k); return v == null ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(k, v) { kvStore.set(k, v); },
  },
};
const pending = [];
const ctx = { waitUntil: p => { pending.push(p); } };
const { default: worker } = await import('../src/index.js');
const call = (path, { origin, method = 'GET', body } = {}) => {
  const headers = {}; if (origin) headers.Origin = origin; if (body) headers['Content-Type'] = 'application/json';
  return worker.fetch(new Request('https://oc-radar-proxy.ocscannernews.workers.dev' + path, { method, headers, body: body && JSON.stringify(body) }), env, ctx);
};
const SITE = 'https://ocscanner.media';
const NPR = '/rss?url=' + encodeURIComponent('https://feeds.npr.org/1003/rss.xml');

test('other websites are refused', async () => {
  const r = await call('/flights', { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
});

test('own sites get data and their origin echoed', async () => {
  for (const o of [SITE, 'https://www.ocscanner.media', 'https://ocscanner.github.io', 'https://intelhq.ocscannernews.workers.dev', 'https://maxq-space.ocscanner-media.pages.dev', 'https://a1b2c3d4-intelhq.ocscannernews.workers.dev']) {
    const r = await call('/flights', { origin: o });
    assert.equal(r.status, 200, o);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), o);
  }
});

test('lookalike origins are refused', async () => {
  for (const o of ['https://ocscanner.media.evil.com', 'https://evilocscanner.media', 'http://ocscanner.media', 'null', 'https://x.ocscanner-media.pages.dev.evil.com'])
    assert.equal((await call('/flights', { origin: o })).status, 403, o);
});

test('preflight works for own sites', async () => {
  const r = await call('/ai-digest', { origin: SITE, method: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), SITE);
});

test('/rss: approved feeds only', async () => {
  assert.equal((await call(NPR, { origin: SITE })).status, 200);
  const bad = await call('/rss?url=' + encodeURIComponent('https://example.com/feed'), { origin: SITE });
  assert.equal(bad.status, 403);
  assert.equal((await call('/rss?url=' + encodeURIComponent('file:///etc/passwd'), { origin: SITE })).status, 403);
  assert.equal((await call('/rss?url=' + encodeURIComponent('https://feeds.npr.org.evil.com/x'), { origin: SITE })).status, 403);
});

test('no Origin: harmless routes open, /rss and /ai-digest closed', async () => {
  assert.equal((await call('/flights')).status, 200);
  assert.equal((await call('/')).status, 200);
  assert.equal((await call(NPR)).status, 403);
  assert.equal((await call('/ai-digest', { method: 'POST', body: {} })).status, 403);
});

test('digest: first call seeds once, later calls never pay', async () => {
  const before = claudeCalls;
  const r1 = await call('/ai-digest', { origin: SITE, method: 'POST', body: { headlines: ['PLANTED fake 1', 'PLANTED fake 2', 'PLANTED fake 3'], force: true } });
  const j1 = await r1.json();
  assert.equal(r1.status, 200);
  assert.equal(j1.digest, 'Digest from server headlines.');
  assert.equal(claudeCalls, before + 1);
  assert.ok(kvStore.has('digest'));
  for (let i = 0; i < 5; i++) {
    const r = await call('/ai-digest', { origin: SITE, method: 'POST', body: { headlines: ['PLANTED a', 'PLANTED b', 'PLANTED c'], force: true } });
    assert.equal((await r.json()).digest, 'Digest from server headlines.');
  }
  assert.equal(claudeCalls, before + 1, 'force and headlines from callers must not trigger Claude');
});

test('scheduled run refreshes the stored digest', async () => {
  const before = claudeCalls;
  await worker.scheduled({}, env, ctx);
  await Promise.all(pending);
  assert.equal(claudeCalls, before + 1);
  assert.ok(JSON.parse(kvStore.get('digest')).timestamp > 0);
});
