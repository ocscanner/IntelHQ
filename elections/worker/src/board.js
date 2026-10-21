// Merges the race list, every feed and the desk's own calls into one board.
// Pure function — no network or storage — so it can be tested with plain Node.
import { normParty } from './parties.js';

/**
 * @param {{config:object, races:object[]}} universe
 * @param {{name:string, races:Map}[]} feeds   in priority order (first wins for vote counts)
 * @param {{calls:Map, results:Map}} desk      desk calls / manually entered results, keyed by race id
 */
export function buildBoard(universe, feeds, desk, now = Date.now()) {
  const races = universe.races.map(r => buildRace(r, feeds, desk));
  const summary = {};
  for (const ch of ['house', 'senate', 'governor']) summary[ch] = summarize(universe.config, ch, races.filter(r => r.chamber === ch));
  return {
    generated: new Date(now).toISOString(),
    election: universe.config.election,
    config: universe.config,
    summary,
    races,
  };
}

function buildRace(r, feeds, desk) {
  let data = null;
  for (const f of feeds) { const d = f.races.get(r.id); if (d) { data = d; break; } }
  const manual = desk.results.get(r.id);
  if (!data && manual) data = { ...manual, source: 'Desk' };

  const candidates = (data?.candidates || []).map(c => ({ ...c, party: normParty(c.party) }));
  const total = candidates.reduce((s, c) => s + (c.votes || 0), 0);
  for (const c of candidates) c.pct = total ? Math.round(c.votes / total * 1000) / 10 : null;
  candidates.sort((a, b) => (b.votes || 0) - (a.votes || 0));

  // Call: an explicit desk call (or desk retraction) beats the feed.
  let call = null;
  const dc = desk.calls.get(r.id);
  if (dc && !dc.retracted_at) {
    call = { party: normParty(dc.party), candidate: dc.candidate || null, source: dc.source || 'OC Scanner desk', note: dc.note || null, at: dc.called_at, by: 'desk' };
  } else if (!dc) {
    const w = candidates.find(c => c.winner);
    if (w) call = { party: w.party, candidate: w.name, source: data.source, at: data.callSeen || null, by: 'feed' };
  }
  if (call && !call.candidate) {
    const match = candidates.find(c => c.party === call.party) || r.candidates.find(c => normParty(c.party) === call.party);
    call.candidate = match?.name || null;
  }

  const lead = total && candidates.length ? candidates[0] : null;
  const margin = lead && candidates[1] && total ? Math.round((candidates[0].votes - candidates[1].votes) / total * 1000) / 10 : null;
  const runoff = candidates.some(c => c.runoff);
  const status = call ? 'called' : runoff ? 'runoff' : total > 0 ? 'counting' : 'waiting';
  const holderParty = r.holder.party;
  const flip = !!(call && holderParty && call.party !== holderParty);

  return {
    id: r.id, chamber: r.chamber, state: r.state, stateName: r.stateName, district: r.district ?? null,
    name: r.name, special: !!r.special, holder: r.holder,
    preCandidates: r.candidates,
    status, candidates, total,
    leader: lead?.party || null, margin,
    pctIn: data?.pctIn ?? null, pctLabel: data?.pctLabel || null,
    call, flip, source: data?.source || null, updated: data?.updated || null,
    deskOverride: dc ? (dc.retracted_at ? 'withdrawn' : 'called') : null,
  };
}

function summarize(config, chamber, races) {
  const notUp = config.notUp?.[chamber] || {};
  const s = {
    total: config.totalSeats[chamber], majority: config.majority[chamber], up: races.length,
    notUp: { D: notUp.D || 0, R: notUp.R || 0, I: notUp.I || 0 },
    called: { D: 0, R: 0, I: 0, O: 0 }, leading: { D: 0, R: 0, I: 0, O: 0 },
    waiting: 0, flips: { toD: 0, toR: 0, toOther: 0 }, counting: 0,
  };
  for (const r of races) {
    if (r.call) {
      const p = r.call.party in s.called ? r.call.party : 'O';
      s.called[p]++;
      if (r.flip) s.flips[p === 'D' ? 'toD' : p === 'R' ? 'toR' : 'toOther']++;
    } else if (r.leader) { s.leading[r.leader in s.leading ? r.leader : 'O']++; s.counting++; }
    else s.waiting++;
  }
  // Seats won so far = called this year + seats not on the ballot.
  s.seats = { D: s.called.D + s.notUp.D, R: s.called.R + s.notUp.R, I: s.called.I + s.notUp.I, O: s.called.O };
  return s;
}
