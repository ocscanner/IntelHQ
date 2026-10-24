// Election-night issue log: what broke, what needed a hand, and notes from the desk, kept for the 2028 rebuild.
// Most entries are written automatically (feed failures and recoveries, feeds that go dark, calls the watcher couldn't
// match, conflicts with the board, races whose counts had to be typed in, withdrawn calls). The desk adds one-line notes.
// Rehearsal activity is never logged.

const TABLES = [
  `CREATE TABLE IF NOT EXISTS issue_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL,
    state TEXT, race_id TEXT, title TEXT NOT NULL, detail TEXT, source TEXT)`,
  // Keys already logged or alerted once ("q|<queue key>", "manual|<race>"), so nothing repeats every minute
  'CREATE TABLE IF NOT EXISTS notified (key TEXT PRIMARY KEY, at INTEGER)',
];
const ready = new WeakSet();
export async function ensureLog(db) {
  if (ready.has(db)) return;
  await db.batch(TABLES.map(q => db.prepare(q)));
  ready.add(db);
}

export const KINDS = {
  feed_down: 'Feed failing',
  feed_up: 'Feed working again',
  feed_dark: 'Feed went dark',
  unmatched_call: 'Call the watcher couldn’t match',
  name_mismatch: 'Call for a name not on our list',
  conflict: 'Network call disagreed with the board',
  manual_count: 'Counts typed in by hand',
  retract: 'Call withdrawn',
  note: 'Desk note',
};

/** @param {{at?, kind, state?, raceId?, title, detail?, source?}[]} entries */
export async function addLog(db, entries, now = Date.now()) {
  if (!entries.length) return 0;
  await ensureLog(db);
  const st = entries.map(e => db.prepare('INSERT INTO issue_log (at, kind, state, race_id, title, detail, source) VALUES (?,?,?,?,?,?,?)')
    .bind(e.at ?? now, e.kind, e.state ?? null, e.raceId ?? null, String(e.title).slice(0, 200), e.detail ? String(e.detail).slice(0, 600) : null, e.source || 'auto'));
  for (let i = 0; i < st.length; i += 50) await db.batch(st.slice(i, i + 50));
  return entries.length;
}

export async function listLog(db, limit = 500) {
  await ensureLog(db);
  const { results } = await db.prepare('SELECT * FROM issue_log ORDER BY at DESC, id DESC LIMIT ?').bind(limit).all();
  return results.map(r => ({ id: r.id, at: r.at, kind: r.kind, label: KINDS[r.kind] || r.kind, state: r.state, raceId: r.race_id, title: r.title, detail: r.detail, source: r.source }));
}

/** The keys not seen before; marks them seen. */
export async function firstTime(db, keys, now = Date.now()) {
  const uniq = [...new Set(keys)];
  if (!uniq.length) return new Set();
  await ensureLog(db);
  const seen = new Set();
  for (let i = 0; i < uniq.length; i += 80) {
    const part = uniq.slice(i, i + 80);
    const { results } = await db.prepare(`SELECT key FROM notified WHERE key IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    for (const r of results) seen.add(r.key);
  }
  const fresh = uniq.filter(k => !seen.has(k));
  const st = fresh.map(k => db.prepare('INSERT OR IGNORE INTO notified (key, at) VALUES (?,?)').bind(k, now));
  for (let i = 0; i < st.length; i += 50) await db.batch(st.slice(i, i + 50));
  return new Set(fresh);
}

/**
 * Feed changes per state between the saved state of every feed and this run's report (pure; tested). A state counts
 * as failing while any of its parts fails (California has one part per district, run a few at a time), so an outage
 * is one "failing" entry and one "working again" entry, however many parts or runs it spans.
 * @param {Map} prev   unit → saved row {state, status, error, meta}
 * @param {object[]} report  this run's rows {unit, state, status, error, meta}
 */
export function feedChanges(prev, report, labelOf = st => st) {
  const now = new Map(prev);
  for (const r of report) now.set(r.unit, r);
  const states = [...new Set(report.map(r => r.state))];
  const failing = (m, st) => [...m.values()].filter(r => r.state === st && r.status === 'error');
  const out = [];
  for (const st of states) {
    const was = failing(prev, st), is = failing(now, st);
    const who = labelOf(st);
    const parts = n => n > 1 ? ` (${n} parts)` : '';
    if (!was.length && is.length) out.push({ kind: 'feed_down', state: st, title: `${who} feed failing${parts(is.length)}`, detail: is[0].error || null });
    else if (was.length && !is.length) out.push({ kind: 'feed_up', state: st, title: `${who} feed working again`, detail: was[0].error ? `Was failing with: ${was[0].error}` : null });
    const dark = report.filter(r => r.state === st && r.status === 'not posted' && prev.get(r.unit)?.status && prev.get(r.unit).status !== 'not posted' && prev.get(r.unit)?.meta?.haveData);
    if (dark.length) out.push({ kind: 'feed_dark', state: st, title: `${who} feed went dark${parts(dark.length)}`, detail: 'Had results earlier, now answers "not posted"' });
  }
  return out;
}

/** Plain-text report for the post-mortem: grouped by kind, oldest first, Pacific time. */
export function logText(entries, title = 'OC Scanner election night issue log') {
  const fmt = at => new Date(at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const order = Object.keys(KINDS);
  const groups = new Map();
  for (const e of [...entries].sort((a, b) => a.at - b.at)) {
    const g = groups.get(e.kind) || [];
    g.push(e);
    groups.set(e.kind, g);
  }
  const lines = [title, `${entries.length} entries · exported ${fmt(Date.now())} PT`, ''];
  for (const kind of [...order, ...[...groups.keys()].filter(k => !order.includes(k))]) {
    const g = groups.get(kind);
    if (!g) continue;
    lines.push(`## ${KINDS[kind] || kind} (${g.length})`);
    for (const e of g) lines.push(`- ${fmt(e.at)} · ${e.title}${e.raceId && !e.title.includes(e.raceId) ? ` [${e.raceId}]` : ''}${e.detail ? ` — ${e.detail}` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}
