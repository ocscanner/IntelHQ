// Rehearsal feed: fake, progressively-counted results so the board can be tested before Nov 3.
// Enabled with SIMULATE=true (or ?sim=1 on the board URL). Every race it produces is tagged source "SIM".
// Nothing here is real data.
import { normParty } from '../parties.js';

function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

export function simulate(races, now, cycleMinutes = 90) {
  const t = ((now / 60000) % cycleMinutes) / cycleMinutes; // 0 → 1 over the cycle, then restarts
  const out = new Map();
  for (const r of races) {
    const h = hash(r.id), h2 = hash(r.id + 'x');
    const start = h * 0.45;                 // staggered poll closings
    const progress = Math.max(0, Math.min(1, (t - start) / 0.5));
    if (progress <= 0) continue;
    const pctIn = Math.round(progress * (88 + h2 * 11) * 10) / 10;
    let cands = r.candidates.length ? r.candidates : [
      { name: `${r.holder.party === 'R' ? 'Republican' : 'Democratic'} candidate`, party: r.holder.party || 'D' },
      { name: `${r.holder.party === 'R' ? 'Democratic' : 'Republican'} candidate`, party: r.holder.party === 'R' ? 'D' : 'R' },
    ];
    const competitive = r.candidates.length > 0;
    const lean = (r.holder.party === 'R' ? -1 : 1) * (competitive ? (h2 - 0.45) * 14 : 18 + h2 * 20); // D margin in pts
    const drift = Math.sin(progress * 3 + h * 6) * (competitive ? 4 : 2) * (1 - progress);
    const dShare = Math.max(5, Math.min(95, 50 + (lean + drift) / 2));
    const total = Math.round((40000 + h * 260000) * (r.chamber === 'house' ? 1 : 12) * pctIn / 100);
    // Shares: the two "sides" are D (or the lone non-R) vs R (or the lone non-D); everyone else splits 4%.
    const ps = cands.map(c => normParty(c.party));
    const sideA = ps.indexOf('D') >= 0 ? ps.indexOf('D') : ps.findIndex(p => p !== 'R');
    const sideB = ps.indexOf('R') >= 0 ? ps.indexOf('R') : ps.findIndex((p, i) => i !== sideA);
    const minor = cands.length - [sideA, sideB].filter(i => i >= 0).length;
    const o = minor ? 4 : 0;
    const shares = cands.map((c, i) =>
      i === sideA ? (sideB >= 0 ? dShare : 100) * (100 - o) / 100
      : i === sideB ? (sideA >= 0 ? 100 - dShare : 100) * (100 - o) / 100
      : o / minor);
    const list = cands.map((c, i) => ({ name: c.name, party: ps[i], votes: Math.round(total * shares[i] / 100), incumbent: c.name === r.holder.name, winner: false }));
    list.sort((a, b) => b.votes - a.votes);
    const margin = list.length > 1 && total ? (list[0].votes - list[1].votes) / total * 100 : 100;
    if (pctIn > 15 && margin > 30 - pctIn / 4 || pctIn > 80 && margin > 3) list[0].winner = true;
    out.set(r.id, { source: 'SIM', candidates: list, pctIn, pctLabel: 'expected vote', updated: new Date(now).toISOString() });
  }
  return { name: 'Simulation', enabled: true, races: out };
}
