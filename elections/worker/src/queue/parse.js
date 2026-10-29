// Read race calls posted by Decision Desk HQ (Bluesky) and AP (@AP_RaceCalls on X), and match each one
// to a race on our board. Pure functions, tested with sample posts in test/queue.test.js.
//
// DDHQ, as posted on primary nights in 2026:
//   "Decision Desk HQ projects Ashley Hinson wins the IA US Senate Republican Primary\n\n#DecisionMade: 9:07 PM EDT"
// AP, as posted on @AP_RaceCalls:
//   "WASHINGTON (AP) — Nithya Raman advances to runoff election for Los Angeles mayor. #APRaceCall at 7:55 EDT."
//   "WASHINGTON (AP) — Republican Ashley Hinson wins election to U.S. Senate in Iowa. #APRaceCall at 9:07 p.m. EST."
// General-election wording isn't guaranteed to match primary-night wording, so the parsing is loose and every
// match is checked against our own candidate list. Anything that doesn't match cleanly is shown to the desk
// as "couldn't match" rather than guessed.

import LA from '../../../data/la-local-2026.json' with { type: 'json' };

// LA County runoffs DDHQ/AP may call (mayor, city attorney, sheriff), matched by place and office ("callRe" in
// data/la-local-2026.json). Board ids are "LA-<id>".
export const LOCAL_CALLS = LA.contests.filter(c => c.callRe).map(c => ({ id: `LA-${c.id}`, re: new RegExp(c.callRe, 'i'), candidates: c.candidates }));
const LOCAL_RUNOFF = t => LOCAL_CALLS.some(l => l.re.test(t));

export const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
// Longest names first so "West Virginia" wins over "Virginia"
const BY_NAME = Object.entries(STATES).sort((a, b) => b[1].length - a[1].length);

const SUFFIX = /^(jr|sr|ii|iii|iv)$/;
export const letters = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/['-]/g, '').replace(/\s+/g, ' ').trim();
/** "Robert S. "Bob" Smith Jr." → { first: "robert", last: "smith" } */
export function nameKey(name) {
  const parts = letters(String(name || '').replace(/"[^"]*"/g, ' ')).split(' ').filter(p => p && !SUFFIX.test(p));
  return { first: parts[0] || '', last: parts[parts.length - 1] || '', all: parts };
}
/** Same person? Last names must match; first name or initial too when both are there. */
export function samePerson(a, b) {
  const x = nameKey(a), y = nameKey(b);
  if (!x.last || x.last !== y.last) {
    // "Mary Peltola" vs "Mary Sattler Peltola", or a two-word last name ("Le Roux")
    const xl = x.all.slice(-2).join(''), yl = y.all.slice(-2).join('');
    if (!(x.all.length > 1 && y.all.length > 1 && xl === yl)) return false;
  }
  if (!x.first || !y.first || x.all.length < 2 || y.all.length < 2) return true;
  return x.first === y.first || x.first[0] === y.first[0];
}

const office = s => /senate/i.test(s) ? 'senate' : /governor/i.test(s) ? 'governor' : /\bhouse\b|congress|district|at-large/i.test(s) ? 'house' : null;
const districtOf = s => { const m = String(s).match(/(?:house|district)\s*(?:#|no\.?)?\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+(?:congressional\s+)?district/i); return m ? +(m[1] || m[2]) : /at-large|at large/i.test(s) ? 0 : null; };
function stateIn(s) {
  for (const [ab, nm] of BY_NAME) if (new RegExp(`\\b${nm}\\b`, 'i').test(s)) return ab;
  return null;
}
// A ballot-measure call: "Proposition 39 fails", "voters approve Proposition 1", "projects Yes on CA Prop 3"
function propCall(s) {
  if (!/\bprop(?:osition)?\.?\s*\d/i.test(s)) return null;
  const num = String(+s.match(/\bprop(?:osition)?\.?\s*(\d{1,3})/i)[1]);
  if (/\b(fails|failed|rejects?|rejected|defeated|voted down|no wins|projects no\b)/i.test(s)) return { num, result: 'No' };
  if (/\b(passes|passed|approves?|approved|adopted|yes wins|projects yes\b)/i.test(s)) return { num, result: 'Yes' };
  return null;
}

/** Decision Desk HQ post → call, or null if it isn't a general-election call. */
export function parseDDHQ(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!/Decision Desk HQ projects/i.test(t)) return null;
  if (/\badvances?\b/i.test(t) || (/\bprimary\b|\brunoff\b/i.test(t) && !LOCAL_RUNOFF(t))) return null;   // November only (LA's runoffs are in November)
  const body = t.replace(/#DecisionMade.*$/i, '').trim();
  const prop = propCall(body);
  if (prop) return { kind: 'prop', ...prop, st: stateIn(body) || (/\bCA\b/.test(body) ? 'CA' : null), text: t };
  const m = body.match(/projects (?:that )?(.+?) (?:wins|will win|has won|is elected|re-?elected)\b(?: the| re-?election in the| reelection in the)? ?(.*)$/i);
  if (!m) return null;
  const rest = m[2] || '';
  const ab = (rest.match(/^([A-Z]{2})\b/) || [])[1];
  return {
    kind: 'race', winner: cleanName(m[1]), st: STATES[ab] ? ab : stateIn(rest),
    office: office(rest), district: districtOf(rest), special: /special/i.test(rest), text: t,
  };
}

/** AP race call post → call, or null. */
export function parseAP(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!/#APRaceCall/i.test(t)) return null;
  if (/\badvances?\b|nomination/i.test(t) || (/\bprimary\b|\brunoff\b/i.test(t) && !LOCAL_RUNOFF(t))) return null;
  const body = t.replace(/^.*?\(AP\)\s*[—–-]+\s*/, '').replace(/#APRaceCall.*$/i, '').trim();
  const prop = propCall(body);
  if (prop) return { kind: 'prop', ...prop, st: stateIn(body), text: t };
  const m = body.match(/^(.+?) (?:wins|won|is elected)\b ?(.*)$/i);
  if (!m) return null;
  return {
    kind: 'race', winner: cleanName(m[1]), st: stateIn(m[2]), office: office(m[2]),
    district: districtOf(m[2]), special: /special/i.test(m[2]), text: t,
  };
}
// "Republican Sen. Josh Hawley" → "Josh Hawley"
function cleanName(s) {
  return String(s).replace(/^(?:incumbent|democratic|republican|democrat|independent|libertarian|green|u\.s\.|us|rep\.|sen\.|gov\.|state|former|\s)+/gi, '').trim();
}

/**
 * Match a parsed call to our board.
 * @param {object} call      from parseDDHQ / parseAP
 * @param {object[]} races   board races (id, state, chamber, district, special, candidates, preCandidates)
 * @param {object[]} props   California propositions (board ids "CA-P1"…)
 * @returns {{raceId, candidate, party, winners?} | {unmatched: string}}
 */
export function matchCall(call, races, props = []) {
  if (!call) return { unmatched: 'not a call' };
  if (call.kind === 'prop') {
    if (call.st && call.st !== 'CA') return { unmatched: 'ballot measure outside California' };
    const p = props.find(x => x.id === `CA-P${call.num}`);
    return p ? { raceId: p.id, candidate: call.result, party: null, winners: [call.result] } : { unmatched: `no Proposition ${call.num} on our list` };
  }
  // Local races called by name and place ("… wins the Los Angeles mayoral runoff")
  for (const l of LOCAL_CALLS) {
    if (!l.re.test(call.text || '')) continue;
    const c = l.candidates.find(x => samePerson(x.name, call.winner));
    return c ? { raceId: l.id, candidate: c.name, party: null, winners: [c.name] } : { raceId: l.id, candidate: call.winner, party: null, winners: [call.winner], nameNotOnList: true };
  }
  let pool = races.filter(r => !call.st || r.state === call.st);
  if (call.office) pool = pool.filter(r => r.chamber === call.office);
  if (call.office === 'house' && call.district != null) pool = pool.filter(r => (r.district || 0) === call.district);
  if (call.office === 'senate' && pool.length > 1) pool = pool.filter(r => !!r.special === !!call.special);
  const hits = [];
  for (const r of pool) {
    const names = [...(r.candidates || []), ...(r.preCandidates || [])];
    const c = names.find(x => samePerson(x.name, call.winner));
    if (c) hits.push({ r, c });
  }
  const uniq = [...new Map(hits.map(h => [h.r.id, h])).values()];
  if (uniq.length === 1) return { raceId: uniq[0].r.id, candidate: uniq[0].c.name, party: uniq[0].c.party || null };
  if (uniq.length > 1) return { unmatched: `${call.winner} matches more than one race` };
  if (pool.length === 1 && call.office) return { raceId: pool[0].id, candidate: call.winner, party: null, nameNotOnList: true };
  return { unmatched: call.st ? `no ${call.office || 'race'} in ${call.st} with ${call.winner}` : `couldn't tell which race` };
}
