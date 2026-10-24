// "OC Scanner model": suggests a call when our own vote counts say a race is effectively over, so nothing
// sits uncalled because the desk was busy. It never publishes anything; every suggestion goes to the queue.
//
// The test: estimate the votes still to come from the share already counted, then ask what share of those
// the trailing candidate would need to catch up. "High": the trailer needs 80%+ of what's left (8+ pt lead,
// 60%+ counted), or the lead is 15+ pts with 60%+ counted, or 30+ pts with 25%+ counted. "Medium": needs 70%+
// of what's left with a 6+ pt lead and 40%+ counted.
//
// Slow-count states (mostly mail, counted for days or weeks — California above all) report "precincts", and
// 100% of precincts on election night can still leave a third of the vote uncounted there. In those states
// the model ignores the estimate and asks for a wide lead instead.
// Georgia (50% or a runoff) and the ranked-choice states (Alaska, Maine) need a majority before a suggestion.

export const SLOW_COUNT = new Set(['CA', 'WA', 'OR', 'NV', 'AZ', 'UT', 'CO', 'AK', 'HI']);
const MAJORITY_RULE = new Set(['GA', 'AK', 'ME']);
const MIN_VOTES = 500;

/**
 * @param {object} c  { id, name, state, kind: 'race'|'prop'|'local', cands: [{name, party, votes}], pctIn, voteFor, called }
 * @returns {null | { raceId, candidate, party, winners?, confidence: 'high'|'medium', reason }}
 */
export function suggest(c) {
  if (c.called) return null;
  const cands = (c.cands || []).filter(x => x.votes != null).slice().sort((a, b) => b.votes - a.votes);
  const total = cands.reduce((s, x) => s + (x.votes || 0), 0);
  const voteFor = c.voteFor || 1;
  const pick = cands.slice(0, voteFor);
  const out = (confidence, reason) => ({
    raceId: c.id, candidate: pick.map(x => x.name).join(' | '), party: voteFor === 1 ? pick[0].party || null : null,
    ...(c.kind !== 'race' ? { winners: pick.map(x => x.name) } : {}), confidence, reason,
  });

  // Unopposed: one name on the ballot (or no more names than seats), once votes are being counted
  if (total > 0 && cands.length <= voteFor) return out('high', voteFor > 1 ? `Unopposed: ${cands.length} candidates for ${voteFor} seats` : 'Unopposed');
  if (total < MIN_VOTES || cands.length < 2) return null;

  const lead = cands[voteFor - 1].votes - cands[voteFor].votes;            // last winner vs first loser
  const pts = lead / total * 100;
  const top = cands[0].votes / total * 100;
  const pctIn = c.pctIn;
  const state = c.kind === 'race' ? c.state : 'CA';                        // propositions and OC contests count like California
  if (MAJORITY_RULE.has(state) && c.kind === 'race' && top <= 50) return null;

  const r1 = n => Math.round(n * 10) / 10;
  const who = /^(yes|no)$/i.test(pick[0].name) ? `${pick[0].name} side` : voteFor > 1 ? `${pick[voteFor - 1].name} (last winning spot)` : pick[0].name;
  if (SLOW_COUNT.has(state) || pctIn == null) {
    const tail = SLOW_COUNT.has(state) ? `${STATE_NOTE[state] || 'this state counts mail ballots for days'}, so this looks at the lead only` : 'no count estimate, so this looks at the lead only';
    if (pts >= 20 && (pctIn == null || pctIn >= 40)) return out('high', `${who} leads by ${r1(pts)} pts${pctIn != null ? ` with ${r1(pctIn)}% of precincts in` : ''}; ${tail}`);
    if (pts >= 12 && (pctIn == null || pctIn >= 60)) return out('medium', `${who} leads by ${r1(pts)} pts${pctIn != null ? ` with ${r1(pctIn)}% of precincts in` : ''}; ${tail}`);
    return null;
  }

  const expected = total / Math.max(pctIn, 1) * 100;
  const left = Math.max(0, expected - total);
  // Share of the remaining votes the trailing side would need to tie (two-way approximation)
  const need = left > 0 ? (left + lead) / (2 * left) : Infinity;
  const needTxt = need > 1 ? 'more votes than are left' : `${Math.round(need * 100)}% of the votes left`;
  if (pts >= 30 && pctIn >= 25) return out('high', `${who} leads by ${r1(pts)} pts with ${r1(pctIn)}% in`);
  if (pctIn >= 60 && pts >= 15) return out('high', `${who} leads by ${r1(pts)} pts with ${r1(pctIn)}% in; the trailing candidate would need ${needTxt}`);
  if (pctIn >= 60 && pts >= 8 && need >= 0.8) return out('high', `${who} leads by ${r1(pts)} pts with ${r1(pctIn)}% in; the trailing candidate would need ${needTxt}`);
  if (pctIn >= 40 && pts >= 6 && need >= 0.7) return out('medium', `${who} leads by ${r1(pts)} pts with ${r1(pctIn)}% in; the trailing candidate would need ${needTxt}`);
  return null;
}
const STATE_NOTE = { CA: 'California counts mail ballots for weeks' };
