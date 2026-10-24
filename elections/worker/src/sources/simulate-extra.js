// Rehearsal (fake) county and local results, built on the same 90-minute cycle as simulate.js.
// Nothing here is real data; the board labels everything from here as rehearsal.
import FIPS_BY_NAME from '../county-fips.json' with { type: 'json' };

function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
const countiesOf = st => [...new Set(Object.values(FIPS_BY_NAME[st] || {}))].sort();

/**
 * Fake county results that roughly add up to a race's (fake) statewide numbers.
 * @param {object} race   board race with candidates[{name,party,votes}] and pctIn
 */
export function simulateCounties(race, now) {
  const cands = (race.candidates || []).filter(c => c.votes > 0);
  if (!cands.length) return { cands: [], counties: {}, source: 'SIM' };
  const total = cands.reduce((s, c) => s + c.votes, 0);
  const share = cands.map(c => c.votes / total);
  const fipsList = countiesOf(race.state);
  const counties = {};
  const weights = fipsList.map(f => 0.15 + Math.pow(hash(f + 'w'), 3) * 6);
  const wSum = weights.reduce((a, b) => a + b, 0);
  fipsList.forEach((fips, i) => {
    const h = hash(fips + race.id);
    // Each county leans one way: a swing of up to ±30 points between the top two candidates
    const swing = (h - 0.5) * 0.6 * (hash(fips + 'u') > 0.5 ? 1 : 0.6);
    const s = share.slice();
    if (s.length > 1) { s[0] = Math.max(0.02, s[0] + swing / 2); s[1] = Math.max(0.02, s[1] - swing / 2); }
    const sSum = s.reduce((a, b) => a + b, 0);
    // Counties report at different speeds around the statewide figure
    const pct = Math.max(0, Math.min(100, Math.round(((race.pctIn ?? 0) + (hash(fips + 'p') - 0.5) * 50) * 10) / 10));
    const votes = total * weights[i] / wSum * (pct / Math.max(1, race.pctIn || 1));
    counties[fips] = { v: s.map(x => Math.round(votes * x / sSum)), pct: pct || null };
  });
  return { cands: cands.map(c => ({ name: c.name, party: c.party })), counties, source: 'SIM', updated: new Date(now).toISOString() };
}

/** Fake local results for every contest on the list (and two made-up measures). */
export function simulateLocal(list, now, cycleMinutes = 90, { extras = true } = {}) {
  const t = ((now / 60000) % cycleMinutes) / cycleMinutes;
  const progress = Math.max(0, Math.min(1, (t - 0.2) / 0.55));    // OC posts after 8 p.m. Pacific
  const contests = [];
  const all = [...list.contests, ...!extras ? [] : [
    { id: '9901', measure: true, rawName: 'Z - City of Example, Rehearsal Sales Tax Measure', candidates: [{ name: 'Yes' }, { name: 'No' }], voteFor: 1 },
    { id: '9902', measure: true, rawName: 'Y - Example School District, Rehearsal Bond Measure', candidates: [{ name: 'Yes' }, { name: 'No' }], voteFor: 1 }]];
  if (progress > 0) {
    for (const c of all) {
      const h = hash(c.id);
      const pctIn = Math.round(progress * (85 + h * 14) * 10) / 10;
      const size = (c.group === 'prop' ? 9500000 : c.group === 'legislature' ? 120000 : c.group === 'county' ? 180000 : 6000 + h * 70000) * pctIn / 100 * c.voteFor;
      const raw = c.candidates.map((x, i) => 0.3 + hash(c.id + x.name + i) * (i === 0 ? 1.4 : 1));
      const sum = raw.reduce((a, b) => a + b, 0);
      contests.push({
        id: c.id, measure: c.measure || undefined, rawName: c.rawName,
        voteFor: c.voteFor, pctIn,
        candidates: c.candidates.map((x, i) => ({ name: x.name, party: x.party ?? null, votes: Math.round(size * raw[i] / sum) })),
      });
    }
  }
  return { area: list.area, source: 'SIM', generated: new Date(now).toISOString(), updated: new Date(now).toISOString(), contests };
}

/** Fake statewide proposition results, plus a made-up Orange County count that leans a little differently. */
export function simulateProps(list, now, cycleMinutes = 90) {
  const res = simulateLocal(list, now, cycleMinutes, { extras: false });
  if (!res.contests.length) return { ...res, oc: null };
  const props = {};
  for (const c of res.contests) {
    const [y, n] = c.candidates.map(x => x.votes);
    const total = y + n;
    const share = Math.max(0.05, Math.min(0.95, y / Math.max(1, total) + (hash(c.id + 'oc') - 0.5) * 0.2));
    const ocTotal = Math.round(total * 0.085);
    props[c.id] = { yes: Math.round(ocTotal * share), no: Math.round(ocTotal * (1 - share)) };
  }
  return { ...res, oc: { pctIn: res.contests[0].pctIn, updated: res.updated, props } };
}
