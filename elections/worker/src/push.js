// Phone alerts for the desk: standard Web Push (the same thing installed web apps use), sent straight from the Worker.
// No app store and no outside service: the push services (Apple, Google, Mozilla) just deliver an encrypted message
// to each device that turned alerts on.
//   - The Worker makes its own signing key pair the first time it's needed and keeps it in D1 (table push_key),
//     so there's no secret to paste anywhere.
//   - Messages are encrypted for each device (RFC 8291, "aes128gcm") and signed (VAPID, RFC 8292).
//   - Devices that turned alerts on are in table push_sub, each with its own choice of what to be alerted about.
// iPhone: alerts work once IntelHQ is added to the Home Screen and opened from there (iOS 16.4 or later).

const TABLES = [
  'CREATE TABLE IF NOT EXISTS push_key (id INTEGER PRIMARY KEY, public_key TEXT NOT NULL, private_jwk TEXT NOT NULL, created_at INTEGER)',
  `CREATE TABLE IF NOT EXISTS push_sub (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, prefs TEXT, label TEXT,
    created_at INTEGER, last_ok INTEGER, last_error TEXT, fails INTEGER DEFAULT 0)`,
];
const ready = new WeakSet();
async function ensure(db) {
  if (ready.has(db)) return;
  await db.batch(TABLES.map(q => db.prepare(q)));
  ready.add(db);
}

// What a device can choose to be alerted about. Defaults: what Christian picked on Oct 24.
export const ALERT_TYPES = {
  calls: 'Decision Desk HQ / AP calls',
  conflicts: 'Conflicts with your calls',
  model: 'High-confidence model calls',
  feeds: 'Feed failures',
};
export const DEFAULT_PREFS = { calls: true, conflicts: false, model: true, feeds: true };
const cleanPrefs = p => Object.fromEntries(Object.keys(ALERT_TYPES).map(k => [k, p && k in p ? !!p[k] : DEFAULT_PREFS[k]]));

// Only real push services: the Worker never posts to an address it doesn't recognize
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.api\.chromium\.org)$/i;
export function validEndpoint(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && PUSH_HOSTS.test(x.hostname); } catch { return false; }
}

/* ── base64url and bytes ── */
const enc = new TextEncoder();
export const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = s => { const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/* ── Signing keys (VAPID) ── */
export async function newKeys(subtle = crypto.subtle) {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { publicKey: b64u(await subtle.exportKey('raw', kp.publicKey)), privateJwk: await subtle.exportKey('jwk', kp.privateKey) };
}
export async function vapidKeys(db) {
  await ensure(db);
  const row = await db.prepare('SELECT public_key, private_jwk FROM push_key WHERE id = 1').first();
  if (row) return { publicKey: row.public_key, privateJwk: JSON.parse(row.private_jwk) };
  const k = await newKeys();
  await db.prepare('INSERT OR IGNORE INTO push_key (id, public_key, private_jwk, created_at) VALUES (1,?,?,?)').bind(k.publicKey, JSON.stringify(k.privateJwk), Date.now()).run();
  const again = await db.prepare('SELECT public_key, private_jwk FROM push_key WHERE id = 1').first();   // another run may have won
  return { publicKey: again.public_key, privateJwk: JSON.parse(again.private_jwk) };
}

/** VAPID "Authorization" header for one push service (a signed token valid for 12 hours). */
export async function vapidAuth(endpoint, keys, now = Date.now(), subject = 'https://ocscanner.github.io/IntelHQ/') {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

/* ── Message encryption (RFC 8291, aes128gcm) ── */
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}
/**
 * @param {{p256dh: string, auth: string}} sub   the device's keys (base64url)
 * @param {Uint8Array} plaintext
 * @param {{salt?: Uint8Array, serverKeys?: CryptoKeyPair}} [fixed]  for tests only
 */
export async function encryptPayload(sub, plaintext, fixed = {}) {
  const uaPublic = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
  const server = fixed.serverKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', server.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, server.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = fixed.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  const head = new Uint8Array(16 + 4 + 1 + asPublic.length);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPublic.length;
  head.set(asPublic, 21);
  return concat(head, sealed);
}

/** Send one message to one device. Returns {ok} or {gone} (the device turned alerts off) or {error}. */
export async function sendOne(sub, message, keys, { fetchImpl = fetch, now = Date.now() } = {}) {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
  const resp = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(message.ttl || 3600), Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      Authorization: await vapidAuth(sub.endpoint, keys, now), ...(message.topic ? { Topic: message.topic } : {}),
    },
    body,
  });
  if (resp.status === 404 || resp.status === 410) return { gone: true };
  if (!resp.ok) return { error: `HTTP ${resp.status}` };
  return { ok: true };
}

/* ── Devices ── */
export async function listSubs(db) {
  await ensure(db);
  const { results } = await db.prepare('SELECT * FROM push_sub ORDER BY created_at').all();
  return results.map(r => ({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, prefs: cleanPrefs(safeJSON(r.prefs)), label: r.label, createdAt: r.created_at, lastOk: r.last_ok, lastError: r.last_error, fails: r.fails || 0 }));
}
export async function saveSub(db, { subscription, prefs, label }, now = Date.now()) {
  await ensure(db);
  const ep = subscription?.endpoint, k = subscription?.keys || {};
  if (!validEndpoint(ep)) return { error: 'Not a push service address this desk recognizes' };
  if (!k.p256dh || !k.auth || unb64u(k.p256dh).length !== 65 || unb64u(k.auth).length !== 16) return { error: 'Subscription keys are missing or the wrong size' };
  await db.prepare(`INSERT INTO push_sub (endpoint, p256dh, auth, prefs, label, created_at, fails) VALUES (?,?,?,?,?,?,0)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, prefs = excluded.prefs, label = excluded.label, fails = 0, last_error = NULL`)
    .bind(ep, k.p256dh, k.auth, JSON.stringify(cleanPrefs(prefs)), String(label || 'Device').slice(0, 60), now).run();
  return { ok: true };
}
export async function setPrefs(db, endpoint, prefs) {
  await ensure(db);
  await db.prepare('UPDATE push_sub SET prefs = ? WHERE endpoint = ?').bind(JSON.stringify(cleanPrefs(prefs)), endpoint).run();
  return { ok: true };
}
export async function removeSub(db, endpoint) {
  await ensure(db);
  await db.prepare('DELETE FROM push_sub WHERE endpoint = ?').bind(endpoint).run();
  return { ok: true };
}

/**
 * Send alerts to every device that wants them. Each alert: {type: 'calls'|'conflicts'|'model'|'feeds'|'test', title, body, url, tag}.
 * More than 3 alerts of the same type at once are folded into one ("7 calls waiting"), so poll-closing time doesn't
 * buzz the phone 40 times.
 */
export async function notify(db, alerts, { fetchImpl = fetch, now = Date.now(), only = null } = {}) {
  if (!alerts.length) return { sent: 0, devices: 0 };
  let subs = await listSubs(db);
  if (only) subs = subs.filter(s => s.endpoint === only);
  if (!subs.length) return { sent: 0, devices: 0 };
  const keys = await vapidKeys(db);
  let sent = 0;
  const errors = [];
  for (const s of subs) {
    const mine = alerts.filter(a => a.type === 'test' || s.prefs[a.type]);
    if (!mine.length) continue;
    const messages = fold(mine);
    let gone = false, lastError = null, ok = 0;
    for (const m of messages) {
      try {
        const r = await sendOne(s, m, keys, { fetchImpl, now });
        if (r.gone) { gone = true; break; }
        if (r.error) lastError = r.error; else ok++;
      } catch (e) { lastError = String(e.message || e).slice(0, 120); }
    }
    sent += ok;
    if (gone) { await removeSub(db, s.endpoint); continue; }
    if (lastError) errors.push({ device: s.label, error: lastError });
    await db.prepare('UPDATE push_sub SET last_ok = COALESCE(?, last_ok), last_error = ?, fails = CASE WHEN ? THEN fails + 1 ELSE 0 END WHERE endpoint = ?')
      .bind(ok ? now : null, lastError, lastError ? 1 : 0, s.endpoint).run();
  }
  return { sent, devices: subs.length, errors };
}
export function fold(alerts) {
  const byType = new Map();
  for (const a of alerts) { const g = byType.get(a.type) || []; g.push(a); byType.set(a.type, g); }
  const out = [];
  for (const [type, g] of byType) {
    if (g.length <= 3) { out.push(...g); continue; }
    const noun = { calls: 'network calls waiting', model: 'model calls waiting', conflicts: 'conflicts waiting', feeds: 'feed problems' }[type] || 'alerts';
    out.push({
      type, title: `${g.length} ${noun}`, tag: `fold-${type}`,
      body: g.slice(0, 4).map(a => a.short || a.title).join(' · ') + (g.length > 4 ? ` · +${g.length - 4} more` : ''),
      url: 'https://ocscanner.github.io/IntelHQ/hq.html#elections',
    });
  }
  return out;
}
const safeJSON = s => { try { return JSON.parse(s); } catch { return null; } };
