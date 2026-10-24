// California statewide propositions, from the Secretary of State's election-night API (free, no key).
//   https://api.sos.ca.gov/returns/ballot-measures                 every proposition, statewide totals
//   https://api.sos.ca.gov/returns/ballot-measures/county/orange   the same, Orange County's count only
// Each file: { raceTitle, Reporting: "32.1% (9,781 of 30,482) precincts reporting", ReportingTime,
//   "ballot-measures": [{ Name, Number: "01", yesVotes, yesPercent, noVotes, noPercent }] }
// Stored like the Orange County local contests (area "CAP"), so the board lists and calls them the same way:
// each proposition is a contest with two "candidates", Yes and No.
import PROPS from '../../../data/ca-props-2026.json' with { type: 'json' };
import { toNum } from '../parties.js';

const BASE = PROPS.resultsBase;
const KNOWN = new Set(PROPS.contests.map(c => c.id));

/** Read one ballot-measures file. Pure function (tested with a saved sample). */
export function parseCAProps(json) {
  const list = json?.['ballot-measures'];
  if (!Array.isArray(list)) return null;
  const m = String(json.Reporting || '').match(/([\d.]+)%/);
  const props = new Map();
  for (const p of list) {
    const num = String(toNum(p.Number) ?? '');
    if (!num) continue;
    props.set(num, { yes: toNum(p.yesVotes) ?? 0, no: toNum(p.noVotes) ?? 0 });
  }
  return { pctIn: m ? +m[1] : null, updated: json.ReportingTime || null, props };
}

/** What the board stores: statewide Yes/No per proposition, plus Orange County's count when we have it. */
export function propsPayload(state, oc, now = Date.now()) {
  const contests = [];
  for (const [id, v] of state.props) {
    if (!KNOWN.has(id)) continue;
    contests.push({ id, measure: true, voteFor: 1, pctIn: state.pctIn, candidates: [{ name: 'Yes', votes: v.yes }, { name: 'No', votes: v.no }] });
  }
  const ocById = {};
  if (oc) for (const [id, v] of oc.props) if (KNOWN.has(id)) ocById[id] = { yes: v.yes, no: v.no };
  return {
    area: 'CAP', source: PROPS.source, generated: state.updated, updated: new Date(now).toISOString(),
    contests, oc: oc ? { pctIn: oc.pctIn, updated: oc.updated, props: ocById } : null,
  };
}

export const caPropsAdapter = {
  st: 'CAP', label: 'California Secretary of State (propositions)', confidence: 'verified', format: 'api.sos.ca.gov JSON', local: true,
  units: [{
    id: 'CAP', requests: 2, order: -1,
    async run(c) {
      const state = parseCAProps(await c.json(`${BASE}/ballot-measures`));
      if (!state || !state.props.size) return { notPosted: true };
      // Orange County's own count is a bonus: if that file fails, keep the statewide numbers
      let oc = null;
      try { oc = parseCAProps(await c.json(`${BASE}/ballot-measures/county/orange`)); } catch {}
      const payload = propsPayload(state, oc, c.now);
      return { local: payload, count: payload.contests.length };
    },
  }],
};

export const CA_PROPS = PROPS;
