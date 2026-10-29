// Builds the desk's call queue from: calls saved by the watcher (DDHQ, AP), the model's suggestions, and
// what's already on the board. Pure function: no network or storage, so it's tested with plain Node.
//
// Item types, in the order the desk sees them:
//   conflict   DDHQ/AP called a race differently from the call already on the board
//   call       DDHQ/AP called a race the board hasn't called yet
//   model      our own counts say the race is effectively over (high, then medium)
//   unmatched  a DDHQ/AP call post we couldn't tie to a race; shown so it isn't silently lost
// A DDHQ/AP call for a race already called the same way is resolved automatically.
import { samePerson } from './parse.js';
import { suggest } from './model.js';

export const SOURCE_LABEL = { DDHQ: 'Decision Desk HQ', AP: 'AP', MODEL: 'OC Scanner desk' };
const ORDER = { conflict: 0, call: 1, model: 2, unmatched: 4 };

/** Everything the queue can point at, keyed by board id: national races, propositions, OC contests. */
export function targets(board, props, oc, la = null) {
  const m = new Map();
  for (const r of board?.races || []) m.set(r.id, {
    id: r.id, name: r.name, tab: r.chamber, kind: 'race', state: r.state,
    cands: r.candidates.length ? r.candidates : r.preCandidates.map(c => ({ ...c, votes: null })), pctIn: r.pctIn, voteFor: 1,
    callText: r.call ? r.call.candidate || r.call.party : null, callNames: r.call?.candidate ? [r.call.candidate] : [], callParty: r.call?.party || null,
  });
  for (const [list, tab, kind] of [[props, 'props', 'prop'], [oc, 'local', 'local'], [la, 'la', 'local']]) for (const c of list?.contests || []) m.set(c.id, {
    id: c.id, name: kind === 'prop' ? c.name : `${c.place}: ${c.office}`, tab, kind, state: 'CA',
    cands: c.candidates, pctIn: c.pctIn, voteFor: c.voteFor || 1,
    callText: c.call ? c.call.winners.join(', ') : null, callNames: c.call?.winners || [], callParty: null,
  });
  return m;
}

const sameCall = (t, row) => {
  if (!t.callText) return null;
  if (row.winners?.length) return row.winners.every(w => t.callNames.some(n => n.toLowerCase() === w.toLowerCase()));
  if (t.callNames.length && row.candidate) return t.callNames.some(n => samePerson(n, row.candidate));
  return !!row.party && row.party === t.callParty;
};

/**
 * @param {object} o
 * @param {object[]} o.rows       stored queue rows (live: watcher calls; both: decisions and first-seen times)
 * @param {Map} o.targets         from targets()
 * @param {object[]} [o.extra]    computed network-style items (rehearsal) — same shape as stored rows
 * @param {number} o.now
 * @returns {{ items: object[], autoResolved: string[], newKeys: object[] }}
 */
export function buildQueue({ rows, targets: T, extra = [], now }) {
  const stored = new Map(rows.map(r => [r.key, r]));
  const items = [], autoResolved = [], newKeys = [];
  const pendingRace = new Set();

  // Stored rows win; computed (rehearsal) items only add what isn't stored yet
  const network = [...rows.filter(r => r.source !== 'MODEL'), ...extra.filter(x => !stored.has(x.key))];
  for (const row0 of network) {
    const row = { ...row0, winners: typeof row0.winners === 'string' ? safeJSON(row0.winners) : row0.winners };
    const s = stored.get(row.key);
    if (s && s.status !== 'new') continue;
    if (!s) newKeys.push({ ...row, status: 'new' });
    const at = s?.posted_at || row.posted_at || row.postedAt || s?.created_at || now;
    const base = { key: row.key, source: row.source, sourceLabel: SOURCE_LABEL[row.source], text: row.text, url: row.url, at, note: row.note || null };
    const t = row.race_id ?? row.raceId ? T.get(row.race_id ?? row.raceId) : null;
    if (!t) { items.push({ ...base, type: 'unmatched', note: row.note || 'couldn’t match this call to a race' }); continue; }
    const same = sameCall(t, row);
    if (same === true) { autoResolved.push(row.key); continue; }
    pendingRace.add(t.id);
    items.push({
      ...base, type: same === false ? 'conflict' : 'call', raceId: t.id, raceName: t.name, tab: t.tab,
      candidate: row.candidate, party: row.party || null, winners: row.winners || null, current: t.callText,
    });
  }

  for (const t of T.values()) {
    if (pendingRace.has(t.id)) continue;                         // a DDHQ/AP call already covers it
    const s = suggest({ id: t.id, name: t.name, state: t.state, kind: t.kind, cands: t.cands, pctIn: t.pctIn, voteFor: t.voteFor, called: !!t.callText });
    if (!s) continue;
    // A dismissed medium suggestion comes back if it later becomes high
    const key = `MODEL|${t.id}|${s.candidate}|${s.confidence}`;
    const st = stored.get(key);
    if (st && st.status !== 'new') continue;
    if (!st) newKeys.push({ key, source: 'MODEL', raceId: t.id, candidate: s.candidate, party: s.party, winners: s.winners || null, status: 'new' });
    items.push({
      key, type: 'model', source: 'MODEL', sourceLabel: 'OC Scanner model', confidence: s.confidence, reason: s.reason,
      raceId: t.id, raceName: t.name, tab: t.tab, candidate: s.candidate, party: s.party, winners: s.winners || null,
      at: st?.created_at || now,
    });
  }

  const rank = i => ORDER[i.type] + (i.type === 'model' && i.confidence === 'medium' ? 1 : 0);
  items.sort((a, b) => rank(a) - rank(b) || a.at - b.at);
  return { items, autoResolved, newKeys };
}
const safeJSON = s => { try { return JSON.parse(s); } catch { return null; } };

/** Rehearsal: DDHQ-style posts for races the practice count has made clear, run through the real parser. */
export function rehearsalPosts(board, props, now, hash) {
  const out = [];
  const officeText = r => r.chamber === 'house' ? `US House ${r.district || 'At-Large'}` : r.chamber === 'senate' ? `US Senate${r.special ? ' Special' : ''}` : 'Governor';
  for (const r of board?.races || []) {
    if (r.call || !r.total || r.pctIn < 40 || r.margin < 6 || hash(r.id + 'q') > 0.5) continue;
    out.push({ id: `sim-${r.id}`, at: now - Math.round(hash(r.id + 't') * 9) * 60000, url: null,
      text: `Decision Desk HQ projects ${r.candidates[0].name} wins the ${r.state} ${officeText(r)}\n\n#DecisionMade: rehearsal` });
  }
  for (const c of props?.contests || []) {
    if (c.call || !c.total || (c.margin ?? 0) < 6 || hash(c.id + 'q') > 0.4) continue;
    out.push({ id: `sim-${c.id}`, at: now - 4 * 60000, url: null,
      text: `Decision Desk HQ projects California Proposition ${c.num} ${c.ahead[0] === 'Yes' ? 'passes' : 'fails'}\n\n#DecisionMade: rehearsal` });
  }
  out.push({ id: 'sim-unmatched', at: now - 2 * 60000, url: null, text: 'Decision Desk HQ projects Pat Example wins the ZZ Mayor\n\n#DecisionMade: rehearsal' });
  return out;
}
