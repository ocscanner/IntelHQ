import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { memoryD1 } from './helpers/d1.js';
import { addLog, listLog, firstTime, feedChanges, logText } from '../src/log.js';
import { saveSub, listSubs, setPrefs, notify, fold, encryptPayload, validEndpoint, vapidKeys, b64u } from '../src/push.js';

/* ── Issue log ── */
test('feed changes per state: failing, working again, gone dark; nothing for steady states', () => {
  const prev = new Map([
    ['KS', { state: 'KS', status: 'ok', meta: { haveData: true } }],
    ['KY', { state: 'KY', status: 'error', error: 'HTTP 403' }],
    ['VT', { state: 'VT', status: 'unchanged', meta: { haveData: true } }],
    ['ND', { state: 'ND', status: 'not posted', meta: {} }],
    ['GA', { state: 'GA', status: 'error', error: 'HTTP 500' }],
  ]);
  const report = [
    { unit: 'KS', state: 'KS', status: 'error', error: 'HTTP 403' },
    { unit: 'KY', state: 'KY', status: 'ok' },
    { unit: 'VT', state: 'VT', status: 'not posted', meta: { haveData: true } },
    { unit: 'ND', state: 'ND', status: 'not posted', meta: {} },
    { unit: 'GA', state: 'GA', status: 'error', error: 'HTTP 502' },
    { unit: 'NM', state: 'NM', status: 'error', error: 'timeout' },
  ];
  const c = feedChanges(prev, report, st => ({ KS: 'Kansas', KY: 'Kentucky', VT: 'Vermont', NM: 'New Mexico' }[st] || st));
  assert.deepEqual(c.map(x => [x.kind, x.title]), [
    ['feed_down', 'Kansas feed failing'],
    ['feed_up', 'Kentucky feed working again'],
    ['feed_dark', 'Vermont feed went dark'],
    ['feed_down', 'New Mexico feed failing'],
  ]);
  assert.equal(c[0].detail, 'HTTP 403');
  assert.match(c[1].detail, /HTTP 403/);
});

test('feed changes: a state split into many parts is one outage, across runs, until every part works', () => {
  let saved = new Map(Array.from({ length: 6 }, (_, i) => [`CA:${i}`, { state: 'CA', status: 'ok', meta: { haveData: true } }]));
  const runOf = (units, status) => units.map(u => ({ unit: `CA:${u}`, state: 'CA', status, error: status === 'error' ? 'HTTP 503' : null }));
  const step = report => { const c = feedChanges(saved, report); for (const r of report) saved.set(r.unit, r); return c.map(x => x.title); };
  assert.deepEqual(step(runOf([0, 1, 2], 'error')), ['CA feed failing (3 parts)']);
  assert.deepEqual(step(runOf([3, 4, 5], 'error')), []);                     // same outage, other parts
  assert.deepEqual(step(runOf([0, 1, 2, 3, 4], 'ok')), []);                  // one part still failing
  assert.deepEqual(step(runOf([5], 'ok')), ['CA feed working again']);
});

test('log: entries saved, listed newest first, exported grouped by kind; firstTime only once', async () => {
  const db = memoryD1();
  const t = Date.parse('2026-11-04T04:00:00Z');
  await addLog(db, [
    { kind: 'feed_down', state: 'KS', title: 'Kansas feed failing', detail: 'HTTP 403', at: t },
    { kind: 'note', raceId: 'AZ-06', title: 'Maricopa drop came late', source: 'desk', at: t + 60000 },
    { kind: 'feed_up', state: 'KS', title: 'Kansas feed working again', at: t + 120000 },
  ]);
  const list = await listLog(db);
  assert.deepEqual(list.map(e => e.kind), ['feed_up', 'note', 'feed_down']);
  assert.equal(list[1].label, 'Desk note');
  const text = logText(list);
  assert.match(text, /## Feed failing \(1\)\n- Nov 3, 8:00 PM · Kansas feed failing — HTTP 403/);
  assert.match(text, /## Desk note \(1\)\n- Nov 3, 8:01 PM · Maricopa drop came late \[AZ-06\]/);
  assert.ok(text.indexOf('Feed failing') < text.indexOf('Feed working again'), 'kinds in a fixed order');
  assert.deepEqual([...await firstTime(db, ['q|a', 'q|b', 'q|a'])].sort(), ['q|a', 'q|b']);
  assert.deepEqual([...await firstTime(db, ['q|a', 'q|c'])], ['q|c']);
});

/* ── Phone alerts ── */
// A "device": a P-256 key pair and auth secret, as PushManager.subscribe makes them, plus a decrypter (RFC 8291)
function device(host = 'https://fcm.googleapis.com/fcm/send/') {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const endpoint = host + crypto.randomBytes(8).toString('hex');
  const decrypt = body => {
    const b = Buffer.from(body);
    const salt = b.subarray(0, 16), idlen = b[20], asPub = b.subarray(21, 21 + idlen), ct = b.subarray(21 + idlen);
    const shared = ecdh.computeSecret(asPub);
    const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPub]);
    const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, info, 32));
    const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
    const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
    const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    assert.equal(plain[plain.length - 1], 2, 'last-record padding delimiter');
    return JSON.parse(plain.subarray(0, plain.length - 1).toString());
  };
  return { subscription: { endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } }, decrypt };
}
function pushServer(statusFor = () => 201) {
  const got = [];
  const fetchImpl = async (url, init) => { got.push({ url, init }); return new Response(null, { status: statusFor(url) }); };
  return { got, fetchImpl };
}

test('push: only real push services; keys checked', async () => {
  assert.ok(validEndpoint('https://web.push.apple.com/QGx...'));
  assert.ok(validEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(!validEndpoint('https://example.com/collect'));
  assert.ok(!validEndpoint('http://fcm.googleapis.com/x'));
  const db = memoryD1();
  assert.match((await saveSub(db, { subscription: { endpoint: 'https://evil.example/x', keys: {} } })).error, /push service/);
  assert.match((await saveSub(db, { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'abc', auth: 'def' } } })).error, /keys/);
});

test('push: the Worker makes and keeps one signing key', async () => {
  const db = memoryD1();
  const a = await vapidKeys(db), b = await vapidKeys(db);
  assert.equal(a.publicKey, b.publicKey);
  assert.equal(Buffer.from(a.publicKey, 'base64url').length, 65);
});

test('push: each device gets only what it chose, encrypted for it, signed, and readable', async () => {
  const db = memoryD1();
  const phone = device('https://web.push.apple.com/'), laptop = device();
  await saveSub(db, { subscription: phone.subscription, label: 'iPhone' });                         // defaults: calls, model, feeds
  await saveSub(db, { subscription: laptop.subscription, label: 'Laptop', prefs: { calls: false, conflicts: true, model: false, feeds: false } });
  assert.deepEqual((await listSubs(db)).find(s => s.label === 'iPhone').prefs, { calls: true, conflicts: false, model: true, feeds: true });
  const { got, fetchImpl } = pushServer();
  const r = await notify(db, [
    { type: 'calls', title: 'Decision Desk HQ: Kentucky Senate', body: 'Projects Andy Barr (R).', url: 'https://ocscanner.github.io/IntelHQ/hq.html?race=KY-SEN#elections', tag: 'DDHQ|1' },
    { type: 'conflicts', title: 'Conflict: Arizona 6th', body: 'x', tag: 'DDHQ|2' },
  ], { fetchImpl });
  assert.equal(r.sent, 2);
  const toPhone = got.filter(g => g.url === phone.subscription.endpoint), toLaptop = got.filter(g => g.url === laptop.subscription.endpoint);
  assert.equal(toPhone.length, 1);
  assert.equal(toLaptop.length, 1);
  const msg = phone.decrypt(toPhone[0].init.body);
  assert.equal(msg.title, 'Decision Desk HQ: Kentucky Senate');
  assert.equal(msg.url, 'https://ocscanner.github.io/IntelHQ/hq.html?race=KY-SEN#elections');
  assert.equal(laptop.decrypt(toLaptop[0].init.body).title, 'Conflict: Arizona 6th');
  const h = toPhone[0].init.headers;
  assert.equal(h['Content-Encoding'], 'aes128gcm');
  assert.equal(h.Urgency, 'high');
  const [, jwt, k] = h.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url')).aud, 'https://web.push.apple.com');
  assert.equal(k, (await vapidKeys(db)).publicKey);
  // Turning a type off stops it
  await setPrefs(db, phone.subscription.endpoint, { calls: false, model: true, feeds: true });
  const second = pushServer();
  await notify(db, [{ type: 'calls', title: 'x', body: 'y' }], { fetchImpl: second.fetchImpl });
  assert.equal(second.got.filter(g => g.url === phone.subscription.endpoint).length, 0);
});

test('push: a device that turned alerts off (410) is forgotten; a failure is remembered', async () => {
  const db = memoryD1();
  const gone = device(), flaky = device();
  await saveSub(db, { subscription: gone.subscription, label: 'Old phone' });
  await saveSub(db, { subscription: flaky.subscription, label: 'Tablet' });
  const { fetchImpl } = pushServer(url => url === gone.subscription.endpoint ? 410 : 500);
  const r = await notify(db, [{ type: 'feeds', title: 'Kansas feed failing', body: 'HTTP 403' }], { fetchImpl });
  assert.equal(r.sent, 0);
  const left = await listSubs(db);
  assert.deepEqual(left.map(s => s.label), ['Tablet']);
  assert.equal(left[0].lastError, 'HTTP 500');
  assert.equal(left[0].fails, 1);
});

test('push: more than 3 at once fold into one alert per type', () => {
  const calls = Array.from({ length: 7 }, (_, i) => ({ type: 'calls', title: `t${i}`, short: `Race ${i}: Someone` }));
  const out = fold([...calls, { type: 'feeds', title: 'Kansas feed failing' }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, '7 network calls waiting');
  assert.match(out[0].body, /^Race 0: Someone · Race 1: Someone · Race 2: Someone · Race 3: Someone · \+3 more$/);
  assert.equal(out[1].title, 'Kansas feed failing');
});

test('push: encryption is fresh every time (new salt and key)', async () => {
  const d = device();
  const a = await encryptPayload(d.subscription.keys, new TextEncoder().encode('{"a":1}'));
  const b = await encryptPayload(d.subscription.keys, new TextEncoder().encode('{"a":1}'));
  assert.notDeepEqual(Buffer.from(a), Buffer.from(b));
  assert.deepEqual(d.decrypt(a), { a: 1 });
});
