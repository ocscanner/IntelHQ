// Builds the "Orange County" tab: the Registrar's contest list, merged with the latest results file
// and the desk's own calls. Pure function — no network or storage — so it can be tested with Node.
// Local race ids on the board are "OC-<contest number>", e.g. OC-5031 (Costa Mesa mayor).

const letters = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
// "Robert S. "Bob" McKinnell" vs incumbent "Robert McKinnell": same first and last name
const sameName = (a, b) => { const x = a.split(' '), y = b.split(' '); return x[0] === y[0] && x[x.length - 1] === y[y.length - 1]; };

/** "K - City of Costa Mesa, Transient Occupancy Tax" → { letter: 'K', place: 'City of Costa Mesa', title: 'Transient Occupancy Tax' } */
export function measureParts(raw) {
  const m = String(raw || '').match(/^([A-Z]{1,3})\s+-\s+(.*)$/);
  if (!m) return { letter: null, place: null, title: raw };
  const rest = m[2];
  const comma = rest.indexOf(',');
  return comma > 0 ? { letter: m[1], place: rest.slice(0, comma).trim(), title: rest.slice(comma + 1).trim() } : { letter: m[1], place: null, title: rest.trim() };
}

function ocCount(v) {
  if (!v) return null;
  const total = (v.yes || 0) + (v.no || 0);
  return { yes: v.yes, no: v.no, total, yesPct: total ? Math.round(v.yes / total * 1000) / 10 : null, noPct: total ? Math.round(v.no / total * 1000) / 10 : null };
}

/**
 * @param {object} list        data/oc-local-2026.json or data/ca-props-2026.json
 * @param {object|null} res   stored results payload (see feeds/oc-local.js localPayload) or rehearsal data
 * @param {Map<string,object>} calls  desk calls keyed by board id ("OC-5031")
 * @param {string} prefix    board id prefix: "OC-" for Orange County, "CA-P" for propositions
 */
export function buildLocal(list, res, calls = new Map(), now = Date.now(), prefix = 'OC-') {
  const byId = new Map((res?.contests || []).map(c => [c.id, c]));
  const out = [];
  const seen = new Set();
  const make = (base, r) => {
    const id = `${prefix}${base.id}`;
    const inc = letters(base.incumbent);
    const cands = (r?.candidates?.length ? r.candidates : base.candidates.map(c => ({ ...c, votes: null })))
      .map(c => ({ name: c.name, party: c.party || null, votes: c.votes ?? null, incumbent: !!inc && sameName(letters(c.name), inc) }));
    const total = cands.reduce((s, c) => s + (c.votes || 0), 0);
    for (const c of cands) c.pct = total ? Math.round(c.votes / total * 1000) / 10 : null;
    if (total) cands.sort((a, b) => b.votes - a.votes);
    const voteFor = base.voteFor || r?.voteFor || 1;
    const dc = calls.get(id);
    const call = dc && !dc.retracted_at ? {
      winners: String(dc.candidate || '').split(' | ').filter(Boolean),
      source: dc.source || 'OC Scanner desk', note: dc.note || null, at: dc.called_at,
    } : null;
    for (const c of cands) c.winner = !!call?.winners.includes(c.name);
    // "Ahead": the top N (vote for N) — or the side leading on a measure
    const ahead = total ? cands.slice(0, voteFor).map(c => c.name) : [];
    const cut = total && cands[voteFor] ? Math.round((cands[voteFor - 1].votes - cands[voteFor].votes) / total * 1000) / 10 : null;
    return {
      id, num: base.id, group: base.group, place: base.place, office: base.office, name: base.name,
      measure: !!base.measure, voteFor, incumbent: base.incumbent || null, incumbentRunning: cands.some(c => c.incumbent), unopposed: cands.length <= voteFor,
      candidates: cands, total, ahead, margin: cut,
      pctIn: r?.pctIn ?? null,
      status: call ? 'called' : total ? 'counting' : 'waiting',
      call, deskOverride: dc ? (dc.retracted_at ? 'withdrawn' : 'called') : null,
      // Statewide propositions: official title, measure type and Orange County's own count
      ...(base.title ? { title: base.title, type: base.type } : {}),
      ...(res?.oc ? { oc: ocCount(res.oc.props?.[base.id]) } : {}),
    };
  };
  for (const c of list.contests) { out.push(make(c, byId.get(c.id))); seen.add(c.id); }
  // Measures (and any local contest not on the candidate list) come only from the results file
  for (const r of res?.contests || []) {
    if (seen.has(r.id)) continue;
    if (r.group) {                                       // LA County: the feed already describes the contest
      out.push(make({ id: r.id, group: r.group, measure: !!r.measure, place: r.place, office: r.office, name: r.name, voteFor: r.voteFor, candidates: [] }, r));
      continue;
    }
    const mp = measureParts(r.rawName);
    const place = mp.place ? mp.place.replace(/^City of /i, '') : 'Orange County';
    out.push(make({
      id: r.id, group: r.measure ? 'measure' : 'district', measure: !!r.measure,
      place, office: r.measure ? `Measure ${mp.letter}${mp.title ? `: ${mp.title}` : ''}` : r.rawName,
      name: r.measure ? `Measure ${mp.letter} (${mp.place || 'Orange County'})${mp.title ? `: ${mp.title}` : ''}` : r.rawName,
      voteFor: r.voteFor, candidates: [],
    }, r));
  }
  return {
    area: list.area, name: list.name, source: list.source, election: list.election,
    groups: list.groups,
    note: list.note || null,
    preloadNote: list.preloadNote || null,
    generated: res?.generated || null, updated: res?.updated || null,
    ocReporting: res?.oc ? { pctIn: res.oc.pctIn ?? null, updated: res.oc.updated || null } : null,
    ballotsCast: res?.ballotsCast ?? null, registered: res?.registered ?? null,
    simulation: res?.source === 'SIM',
    contests: out,
    builtAt: new Date(now).toISOString(),
  };
}
