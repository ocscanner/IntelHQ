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
  known_gap: 'Known before election night (2028 prep)',
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

/* Gaps found while building the 2026 feeds (Oct 21 – Nov 1), written into the log once so the 2028 rebuild list
   starts with them. Goal for the 2028 primaries and general: every state automated. */
const AT = Date.parse('2026-11-01T08:00:00Z');
export const KNOWN_GAPS = [
  ['MI', 'Michigan: no statewide election-night results', 'SOS tells media to use the 83 county clerk sites; mi.gov/vote posts statewide unofficial results only after every county reports. Counties use mixed systems (PDFs, vendor pages). 2026: Quick count + DDHQ calls. 2028: build county readers for the big counties or get a feed from the SOS; AP license is the fallback.'],
  ['WI', 'Wisconsin: no statewide election-night results', 'WEC: "no central official website"; 72 county clerks post within two hours of getting municipal returns (1,850 municipalities). 2026: Quick count. 2028: county readers (Milwaukee, Dane, Waukesha, Brown first) or AP.'],
  ['NY', 'New York: results site behind Cloudflare', 'nyenr.elections.ny.gov answered ordinary requests on Oct 31, but showed a "verify you are human" check in an earlier survey. Feed built (ASP.NET form, governor + 26 House); falls back to Paste from page. 2028: ask the State Board to allow the Worker or publish a data file.'],
  ['NV', 'Nevada: results app behind Imperva bot protection', 'silverstateelection.nv.gov (new in 2026) is static JSON; feed built, but Imperva blocked automated checks before. Falls back to Paste from page. 2028: ask the SOS for access, or confirm the Worker gets through.'],
  ['ME', 'Maine: no official election-night count', 'Towns report; the state posts results later. 2026: Quick count (Senate, governor, ME-2). 2028: find a town-level source or license AP.'],
  ['NH', 'New Hampshire: no official election-night count', 'Towns report; the SOS posts results later. 2026: Quick count (Senate, governor, NH-1). 2028: same as Maine.'],
  ['NJ', 'New Jersey: no statewide election-night count', '21 county clerks post their own results. 2026: Quick count (NJ-7). 2028: county readers.'],
  ['IL', 'Illinois: no statewide election-night count', '108 local election authorities report separately. 2026: Quick count (IL-17). 2028: readers for Cook and the collar counties.'],
  ['MA', 'Massachusetts: no statewide election-night count', 'Results come from cities and towns; nothing statewide on the night. Safe races in 2026. 2028: find a source.'],
  ['OK', 'Oklahoma: results data needs a login', 'The results API answers 401 unless the site\'s own app signs in. Not built around an access gate. 2028: ask the State Election Board for a public feed.'],
  ['MS', 'Mississippi: no statewide election-night reporting', 'A bill to create it died; SOS posts certified PDFs later; 82 counties. 2028: check whether the state adds one.'],
  ['WY', 'Wyoming: no statewide election-night count', 'SOS posts official PDFs after the canvass and points to county sites. 2028: county readers (23 counties) or AP.'],
  ['WV', 'West Virginia: November election not linked until results start', 'Clarity site; the election ID isn\'t published ahead of time. 2028: watch Clarity\'s election list automatically.'],
  ['AL', 'Alabama: results site blank until results start', 'Layout can\'t be checked ahead of time. 2028: save the 2026 layout and build the reader from it.'],
  ['LAC', 'LA County: results site behind Imperva', 'results.lavote.gov JSON API; may refuse the Worker. Feed check on Nov 2.'],
  [null, 'County maps missing for several states', 'No free county-by-county file: Texas, Nebraska, South Dakota, Ohio; Nevada and Michigan have none on the night. 2028: find county files or county readers.'],
  [null, 'Free plan too small for big state files', 'Free Workers plan: 10 ms per run; NC, TX, FL, GA files and all county files need Workers Paid. Switch on before election night; plan for Paid from the start in 2028.'],
  [null, 'Many feeds unverified until results start', 'Checked against primaries or old elections only: MO, TN, MD, OR, MT, KS, KY, HI, DE, ND, AK, UT, ID, NY, NV, LAC. Feed check on Nov 2-3. 2028: run every feed against the primaries first.'],
  [null, 'Feeds only read general elections', 'Every adapter looks for the November general. 2028 primaries need primary support: party-specific contests, many candidates, different dates per state, runoffs.'],
  [null, 'No source for calls except DDHQ posts and the desk', 'AP calls need a paid X API or the AP Elections API (elections_api_info@ap.org). 2028: decide on AP early.'],
];
export async function seedKnownGaps(db, now = Date.now()) {
  const fresh = await firstTime(db, ['seed|known-gaps-2026'], now);
  if (!fresh.size) return 0;
  return addLog(db, KNOWN_GAPS.map(([state, title, detail]) => ({ at: AT, kind: 'known_gap', state, title, detail, source: 'prep' })), now);
}

export async function listLog(db, limit = 500) {
  await ensureLog(db);
  await seedKnownGaps(db);
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
