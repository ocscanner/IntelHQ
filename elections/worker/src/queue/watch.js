// Watches the two public call feeds every minute and saves each call to the desk's queue (table call_queue).
//   Decision Desk HQ: Bluesky's open API (free, no account): app.bsky.feed.getAuthorFeed for decisiondeskhq.bsky.social
//   AP:              @AP_RaceCalls through the official X API, only if X_BEARER_TOKEN is set (pay-per-use, about
//                    half a cent per post read). Without the token AP is skipped.
// Nothing here publishes a call. The desk reviews every one.
import { parseDDHQ, parseAP, matchCall } from './parse.js';

export const DDHQ_ACTOR = 'decisiondeskhq.bsky.social';
export const AP_HANDLE = 'AP_RaceCalls';
const BSKY = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed';
const X = 'https://api.x.com/2';

const QUEUE_TABLE = `CREATE TABLE IF NOT EXISTS call_queue (
  ns TEXT NOT NULL, key TEXT NOT NULL, source TEXT, race_id TEXT, candidate TEXT, party TEXT, winners TEXT,
  text TEXT, url TEXT, note TEXT, posted_at INTEGER, created_at INTEGER, status TEXT, resolved_at INTEGER,
  PRIMARY KEY (ns, key))`;
const ready = new WeakSet();
export async function ensureQueue(db) {
  if (ready.has(db)) return;
  await db.prepare(QUEUE_TABLE).run();
  ready.add(db);
}

/** Newest DDHQ posts (top-level and their own threads), oldest first. */
export async function readDDHQ(fetchImpl) {
  const r = await fetchImpl(`${BSKY}?actor=${DDHQ_ACTOR}&limit=40&filter=posts_and_author_threads`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Bluesky answered ${r.status}`);
  const j = await r.json();
  return (j.feed || []).map(f => f.post).filter(p => p?.author?.handle === DDHQ_ACTOR && !f_isRepost(p))
    .map(p => ({ id: p.uri, at: Date.parse(p.record?.createdAt) || 0, text: p.record?.text || '', url: `https://bsky.app/profile/${DDHQ_ACTOR}/post/${p.uri.split('/').pop()}` }))
    .sort((a, b) => a.at - b.at);
}
const f_isRepost = p => !p.record || p.record.$type !== 'app.bsky.feed.post';

/** New @AP_RaceCalls posts since the last one seen (X API v2, bearer token). */
export async function readAP(fetchImpl, token, meta) {
  const h = { Authorization: `Bearer ${token}` };
  if (!meta.userId) {
    const u = await fetchImpl(`${X}/users/by/username/${AP_HANDLE}`, { headers: h });
    if (!u.ok) throw new Error(`X answered ${u.status} looking up @${AP_HANDLE}`);
    meta.userId = (await u.json()).data?.id;
    if (!meta.userId) throw new Error(`@${AP_HANDLE} not found`);
  }
  const qs = new URLSearchParams({ max_results: '25', exclude: 'retweets,replies', 'tweet.fields': 'created_at' });
  if (meta.sinceId) qs.set('since_id', meta.sinceId);
  const r = await fetchImpl(`${X}/users/${meta.userId}/tweets?${qs}`, { headers: h });
  if (r.status === 429) throw new Error('X rate limit; trying again next minute');
  if (!r.ok) throw new Error(`X answered ${r.status}`);
  const j = await r.json();
  if (j.meta?.newest_id) meta.sinceId = j.meta.newest_id;
  return (j.data || []).map(t => ({ id: t.id, at: Date.parse(t.created_at) || 0, text: t.text, url: `https://x.com/${AP_HANDLE}/status/${t.id}` })).sort((a, b) => a.at - b.at);
}

/** Turn posts into queue rows: parsed, matched to our races, never older than `since`. */
export function postsToRows(posts, source, { races, props, since }) {
  const parse = source === 'AP' ? parseAP : parseDDHQ;
  const rows = [];
  for (const p of posts) {
    if (p.at <= since) continue;
    const call = parse(p.text);
    if (!call) continue;                                          // forecasts, vote updates, primaries…
    const m = matchCall(call, races, props);
    rows.push({
      key: `${source}|${p.id}`, source, raceId: m.raceId || null, candidate: m.candidate || call.winner || call.result || null,
      party: m.party || null, winners: m.winners || null, text: p.text, url: p.url,
      note: m.unmatched || (m.nameNotOnList ? 'winner isn’t on our candidate list' : null), postedAt: p.at,
    });
  }
  return rows;
}

/**
 * One watch pass (the every-minute cron). Returns what it saved, for the log and tests.
 * @param {object} o  { env, db, races, props, fetchImpl, now, loadMeta, saveMeta }
 */
export async function runWatch({ env, db, races, props, fetchImpl = fetch, now = Date.now(), notBefore = 0 }) {
  await ensureQueue(db);
  const metaRow = await db.prepare("SELECT meta FROM feed_unit WHERE unit = 'WATCH'").first().catch(() => null);
  const meta = safeJSON(metaRow?.meta) || {};
  const status = { ddhq: { ok: null }, ap: { enabled: !!env.X_BEARER_TOKEN, ok: null } };
  const saved = [];
  const save = async rows => {
    const st = rows.map(r => db.prepare(`INSERT OR IGNORE INTO call_queue (ns, key, source, race_id, candidate, party, winners, text, url, note, posted_at, created_at, status)
      VALUES ('live',?,?,?,?,?,?,?,?,?,?,?,'new')`).bind(r.key, r.source, r.raceId, r.candidate, r.party, r.winners ? JSON.stringify(r.winners) : null, r.text, r.url, r.note, r.postedAt, now));
    for (let i = 0; i < st.length; i += 50) await db.batch(st.slice(i, i + 50));
    saved.push(...rows);
  };

  try {
    const posts = await readDDHQ(fetchImpl);
    const since = Math.max(meta.ddhqSince || 0, notBefore);
    await save(postsToRows(posts, 'DDHQ', { races, props, since }));
    if (posts.length) meta.ddhqSince = Math.max(since, posts[posts.length - 1].at);
    status.ddhq = { ok: true, checkedAt: now, latestPost: posts.length ? posts[posts.length - 1].at : null };
  } catch (e) { status.ddhq = { ok: false, checkedAt: now, error: String(e.message || e).slice(0, 160) }; }

  if (env.X_BEARER_TOKEN) {
    try {
      meta.ap ||= {};
      const posts = await readAP(fetchImpl, env.X_BEARER_TOKEN, meta.ap);
      await save(postsToRows(posts, 'AP', { races, props, since: notBefore }));
      status.ap = { enabled: true, ok: true, checkedAt: now };
    } catch (e) { status.ap = { enabled: true, ok: false, checkedAt: now, error: String(e.message || e).slice(0, 160) }; }
  }

  meta.status = status;
  await db.prepare('INSERT OR REPLACE INTO feed_unit (unit, state, fetched_at, ok, status, error, races, meta) VALUES (?,?,?,?,?,?,?,?)')
    .bind('WATCH', 'US', now, status.ddhq.ok === false ? 0 : 1, 'ok', status.ddhq.error || status.ap.error || null, saved.length, JSON.stringify(meta)).run();
  return { saved, status };
}
const safeJSON = s => { try { return JSON.parse(s); } catch { return null; } };
