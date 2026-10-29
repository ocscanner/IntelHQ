// Highlights: a short list of races the desk pins to the top of the board (IntelHQ and the public page).
// Any race can be pinned: national races, Orange County and Los Angeles contests, propositions. Stored as one
// setting row in D1; until the desk changes it, the list starts with the Los Angeles mayor's race.
export const DEFAULT_HIGHLIGHTS = ['OC-LAMAYOR'];
export const MAX_HIGHLIGHTS = 8;

const ready = new WeakSet();
async function ensure(db) {
  if (ready.has(db)) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS desk_setting (k TEXT PRIMARY KEY, v TEXT, updated_at INTEGER)').run();
  ready.add(db);
}
export async function loadHighlights(db) {
  if (!db) return DEFAULT_HIGHLIGHTS;
  await ensure(db);
  const row = await db.prepare("SELECT v FROM desk_setting WHERE k = 'highlights'").first();
  try { return row ? JSON.parse(row.v) : DEFAULT_HIGHLIGHTS; } catch { return DEFAULT_HIGHLIGHTS; }
}
export async function saveHighlights(db, ids, now = Date.now()) {
  await ensure(db);
  await db.prepare("INSERT OR REPLACE INTO desk_setting (k, v, updated_at) VALUES ('highlights', ?, ?)").bind(JSON.stringify(ids), now).run();
  return ids;
}
/** {action: "add"|"remove", raceId} or {ids: [...]} (reorder) → the new list. isKnown(id) checks the id exists. */
export function nextHighlights(current, b, isKnown) {
  if (Array.isArray(b.ids)) {
    const ids = [...new Set(b.ids.map(x => String(x).toUpperCase()))];
    const bad = ids.find(x => !isKnown(x));
    if (bad) return { error: `Unknown race ${bad}` };
    if (ids.length > MAX_HIGHLIGHTS) return { error: `Up to ${MAX_HIGHLIGHTS} highlights` };
    return { ids };
  }
  const id = String(b.raceId || '').toUpperCase();
  if (!isKnown(id)) return { error: `Unknown race ${b.raceId}` };
  if (b.action === 'remove') return { ids: current.filter(x => x !== id) };
  if (b.action !== 'add') return { error: 'action must be add or remove' };
  if (current.includes(id)) return { ids: current };
  if (current.length >= MAX_HIGHLIGHTS) return { error: `Up to ${MAX_HIGHLIGHTS} highlights; remove one first` };
  return { ids: [...current, id] };
}

const r1 = n => n == null ? null : Math.round(n * 10) / 10;
/**
 * Compact cards for the strip (pure; tested).
 * @param {string[]} ids
 * @param {object} board    buildBoard() output (races with candidates, call, pctIn…)
 * @param {object} locals   { OC: buildLocal() output, CAP: … } — only the areas some highlight needs
 */
export function highlightCards(ids, board, locals = {}) {
  const races = new Map((board?.races || []).map(r => [r.id, r]));
  const local = new Map(Object.values(locals).filter(Boolean).flatMap(a => a.contests.map(c => [c.id, c])));
  const out = [];
  for (const id of ids) {
    const r = races.get(id);
    if (r) {
      const cands = (r.total ? r.candidates : r.preCandidates).slice(0, 2).map(c => ({ name: c.name, party: c.party || null, pct: r.total ? r1(c.pct) : null }));
      out.push({
        id, tab: r.chamber, name: r.name, cands, pctIn: r.pctIn ?? null, pctLabel: r.pctLabel || null, counting: !!r.total,
        call: r.call ? { who: r.call.candidate || r.call.party, party: r.call.party || null, source: r.call.source } : null, flip: !!r.flip,
      });
      continue;
    }
    const c = local.get(id);
    if (c) {
      const isProp = id.startsWith('CA-P');
      out.push({
        id, tab: isProp ? 'props' : 'local', name: isProp ? `Prop ${c.num}: ${c.office}` : c.name,
        cands: c.candidates.slice(0, 2).map(x => ({ name: x.name, party: x.party || null, pct: c.total ? r1(x.pct) : null })),
        pctIn: c.pctIn ?? null, pctLabel: c.pctIn != null ? 'precincts' : null, counting: !!c.total,
        call: c.call ? { who: c.call.winners.join(', '), party: null, source: c.call.source } : null, flip: false,
      });
    }
  }
  return out;
}
