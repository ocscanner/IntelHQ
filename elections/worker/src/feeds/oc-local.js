// Orange County Registrar of Voters: local contests on election night.
// The Registrar publishes results through Live Voter Turnout as one summary XML per election:
//   https://www.livevoterturnout.com/ENR/orangecaenr/<n>/summary_<n>.xml
// Election numbers count up (18 = Nov 2024 general, 23 = June 2026 primary), so November's file is
// expected at 24 or a little after. The unit looks for it until it appears, then remembers the number.
// RaceID in the file matches the contest numbers on the Registrar's candidate list (data/oc-local-2026.json).
import OC from '../../../data/oc-local-2026.json' with { type: 'json' };
import { toNum, normParty } from '../parties.js';

const BASE = OC.resultsBase;
const LIST = new Map(OC.contests.map(c => [c.id, c]));
const letters = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/** "STEVE HILTON (REP)" → name "STEVE HILTON", party "REP" */
function splitParty(raw) {
  const m = String(raw || '').trim().match(/^(.*?)\s*\(([A-Z]{2,4})\)$/);
  return m ? [m[1], m[2]] : [String(raw || '').trim(), null];
}
function titleCase(s) {
  return String(s).toLowerCase().replace(/(^|[\s\-'"(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
    .replace(/\bMc(\p{L})/gu, (m, c) => 'Mc' + c.toUpperCase()).replace(/\b(Ii|Iii|Iv)\b/g, m => m.toUpperCase());
}

/** Read the Registrar's summary XML into contests. Pure function (tested with a saved sample). */
export function parseOCSummary(xml) {
  const tag = (block, k) => { const m = block.match(new RegExp(`<${k}>([^<]*)</${k}>|<${k}\\s*/>`)); return m ? (m[1] ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'") : null; };
  const head = xml.slice(0, xml.indexOf('<Table>') > 0 ? xml.indexOf('<Table>') : 2000);
  const byId = new Map();
  for (const m of xml.matchAll(/<Table>([\s\S]*?)<\/Table>/g)) {
    const b = m[1];
    const id = tag(b, 'RaceID');
    if (!id) continue;
    let c = byId.get(id);
    if (!c) {
      c = { id, rawName: tag(b, 'RaceName') || '', voteFor: toNum(tag(b, 'VoteFor')) || 1, prec: { rep: toNum(tag(b, 'PrecReported')), tot: toNum(tag(b, 'NumberOfPrec')) }, cands: [] };
      byId.set(id, c);
    }
    if (tag(b, 'ContestantWithdrawn') === 'Y') continue;
    const [name, party] = splitParty(tag(b, 'ContestantName'));
    if (!name || /^write-?in$/i.test(name)) continue;
    c.cands.push({ raw: name, party, votes: toNum(tag(b, 'TotalVotes')) || 0, winner: tag(b, 'ContestantWinner') === 'Y' });
  }
  return {
    generated: tag(head, 'GeneratedDate'),
    ballotsCast: toNum(tag(head, 'TotalBallotsCast')),
    registered: toNum(tag(head, 'RegisteredVoters')),
    contests: [...byId.values()],
  };
}

/** Measures are named like "K - City of Costa Mesa, Short Description" */
export const isMeasure = name => /^[A-Z]{1,3}\s+-\s+/.test(name);

/**
 * Turn a parsed summary into what the board stores: listed local contests plus every local measure.
 * Statewide and federal contests are skipped (the national board has them).
 */
export function localPayload(parsed, now = Date.now()) {
  const contests = [];
  for (const c of parsed.contests) {
    const known = LIST.get(c.id);
    const measure = !known && isMeasure(c.rawName);
    if (!known && !measure && +c.id < 2000) continue;               // statewide/federal/propositions
    const cands = c.cands.map(x => {
      const match = known?.candidates.find(k => letters(k.name) === letters(x.raw));
      return {
        name: match ? match.name : measure ? titleCase(x.raw).replace(/\s*-\s*/g, ' – ') : titleCase(x.raw),
        party: match?.party ?? (x.party ? normParty(x.party) : null),
        votes: x.votes,
      };
    });
    contests.push({
      id: c.id,
      measure: measure || undefined,
      rawName: known ? undefined : c.rawName,
      voteFor: c.voteFor,
      pctIn: c.prec.tot ? Math.round(Math.min(100, c.prec.rep / c.prec.tot * 100) * 10) / 10 : null,
      candidates: cands,
    });
  }
  return {
    area: 'OC', source: OC.source, generated: parsed.generated, ballotsCast: parsed.ballotsCast, registered: parsed.registered,
    updated: new Date(now).toISOString(), contests,
  };
}

/** Find this election's file: the first number from 24 up whose file carries our contests. */
async function findElection(c, start) {
  for (let n = start; n < start + 6; n++) {
    const xml = await c.text(`${BASE}/${n}/summary_${n}.xml`, { allow404: true });
    if (xml == null) continue;
    const parsed = parseOCSummary(xml);
    const ours = parsed.contests.filter(x => LIST.has(x.id)).length;
    if (ours >= 10) return { n, parsed };
  }
  return null;
}

export const ocLocalAdapter = {
  st: 'OC', label: 'Orange County Registrar of Voters', confidence: 'verified', format: 'Live Voter Turnout summary XML', local: true,
  units: [{
    id: 'OC', requests: 6,
    async run(c) {
      let n = c.meta.eid;
      let parsed;
      if (!n) {
        const hit = await findElection(c, +(c.env?.OC_ELECTION_FROM || 24));
        if (!hit) return { notPosted: true };
        n = c.meta.eid = hit.n;
        parsed = hit.parsed;
      } else {
        const xml = await c.text(`${BASE}/${n}/summary_${n}.xml`, { conditional: true, allow404: true });
        if (xml === undefined) { delete c.meta.eid; return { notPosted: true }; }
        if (xml === null) return { unchanged: true };
        parsed = parseOCSummary(xml);
      }
      const payload = localPayload(parsed, c.now);
      return { local: payload, count: payload.contests.length };
    },
  }],
};

// The board's local tab: Orange County's contests plus the Los Angeles races (see la-local.js)
import LA from '../../../data/la-local-2026.json' with { type: 'json' };
export const OC_LOCAL = { ...OC, groups: [...OC.groups, ...LA.groups], contests: [...OC.contests, ...LA.contests] };
