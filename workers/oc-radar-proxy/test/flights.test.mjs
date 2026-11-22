// Run: node --test test/flights.test.mjs   (adsb.lol is faked; the clock is moved by hand)
import test from 'node:test';
import assert from 'node:assert/strict';

let mode = 'ok', calls = 0, clock = 1_800_000_000_000;
Date.now = () => clock;
globalThis.fetch = async (url) => {
  url = String(url);
  assert.ok(url.startsWith('https://api.adsb.lol/'), 'only adsb.lol is asked: ' + url);
  calls++;
  if (mode === 'ok') return new Response(JSON.stringify({ ac: [{ hex: 'a1' }, { hex: 'b2' }], msg: 'No error' }), { status: 200 });
  if (mode === 'empty') return new Response('{"ac":[],"msg":"No error"}', { status: 200 });
  if (mode === '503') return new Response('busy', { status: 503 });
  throw new Error('timeout');
};
const { default: worker } = await import('../src/index.js');
const env = {}, ctx = { waitUntil() {} };
const get = async (q = 'lat=33.83&lon=-118.02&dist=25') => {
  const r = await worker.fetch(new Request('https://oc-radar-proxy.ocscannernews.workers.dev/flights?' + q), env, ctx);
  return { status: r.status, src: r.headers.get('X-Source'), body: await r.json() };
};

test('a good answer is passed through and credited to adsb.lol', async () => {
  const r = await get();
  assert.equal(r.status, 200); assert.equal(r.body.ac.length, 2); assert.equal(r.src, 'adsb.lol');
});

test('tabs refreshing within 8 s share one upstream call', async () => {
  const before = calls; clock += 3000;
  const r = await get();
  assert.equal(calls, before); assert.match(r.src, /cached 3s/);
});

test('when adsb.lol fails, the last good answer (under 3 min) is served', async () => {
  for (const m of ['503', 'throw', 'empty']) {
    mode = m; clock += 20_000; const before = calls;
    const r = await get();
    assert.equal(calls - before, 2, m + ': tries twice');
    assert.equal(r.body.ac.length, 2, m); assert.match(r.src, /^adsb\.lol \(cached \d+s\)$/, m);
  }
});

test('after 3 min with no good answer, an honest empty list', async () => {
  mode = 'empty'; clock += 3 * 60_000;
  const r = await get();
  assert.equal(r.body.ac.length, 0); assert.equal(r.src, 'adsb.lol');
});

test('a different area never gets another area\'s copy', async () => {
  mode = '503';
  const r = await get('lat=34.05&lon=-118.24&dist=25');
  assert.equal(r.body.ac.length, 0); assert.equal(r.body.msg, 'All APIs unavailable');
});

test('a recovered adsb.lol is used again', async () => {
  mode = 'ok'; clock += 60_000;
  const r = await get();
  assert.equal(r.src, 'adsb.lol'); assert.equal(r.body.ac.length, 2);
});
