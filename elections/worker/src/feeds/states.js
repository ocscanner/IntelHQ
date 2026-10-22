// Free election-night feeds published by state election offices.
// Each state has one or more "units". A unit is a small job (1–5 downloads) that the scheduler
// runs when it is due; results are saved per race, so a unit that fails leaves the last good
// numbers on the board.
//
// confidence (checked against the live files on Oct 21, 2026):
//   "verified"           = the state's real files were opened and match this reader
//   "unverified"         = same platform as a verified state, but not opened yet
//   "not found for 2026" = Texas: its results system has nothing after 2024 yet
// Field names come from each office's published formats. State files don't mark winners in a way
// we use: race calls stay with the desk (or AP, if licensed).
import { raceIdFor, makeResult, makeCountyResult, isStatewide, pctFromUnits, isElectionDay, isGeneralName, csvObjects, findCol, unzipEntry } from './util.js';
import { countyFips, mnCountyFips } from './county-names.js';
import { parseCASOS } from '../sources/ca-sos.js';
import { toNum } from '../parties.js';
import { ocLocalAdapter } from './oc-local.js';

const textOf = v => Array.isArray(v) ? (v.find(x => /^en/i.test(x.languageId || 'en')) || v[0] || {}).text || '' : String(v || '');

/** Group parsed rows into board results: Map raceId → result */
function collect(st, c, rows, meta = {}) {
  const groups = new Map();
  for (const r of rows) {
    const id = r.raceId ?? raceIdFor(r.contest, st, c.ids, { district: r.district });
    if (!id) continue;
    const g = groups.get(id) || { rows: [], rep: null, tot: null };
    g.rows.push(r);
    if (r.rep != null) g.rep = r.rep;
    if (r.tot != null) g.tot = r.tot;
    groups.set(id, g);
  }
  const out = new Map();
  for (const [id, g] of groups) {
    out.set(id, makeResult(c.races.get(id), g.rows, {
      pctIn: meta.pctOf ? meta.pctOf(g) : pctFromUnits(g.rep, g.tot),
      pctLabel: meta.pctLabel || 'precincts',
    }));
  }
  return out;
}

/** Group per-county rows by race into county results (statewide races only): Map raceId → result */
function collectCounties(c, rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!r.raceId || !isStatewide(c.races.get(r.raceId))) continue;
    const g = groups.get(r.raceId) || [];
    g.push(r);
    groups.set(r.raceId, g);
  }
  const out = new Map();
  for (const [id, g] of groups) out.set(id, makeCountyResult(c.races.get(id), g));
  return out;
}

/* ── Enhanced Voting (results/public/api) ── */
function enhanced(st, label, apiBase, jurisdiction, confidence) {
  return {
    st, label, confidence, format: 'Enhanced Voting JSON',
    units: [{
      id: st, requests: 6,
      async run(c) {
        let eid = c.meta.eid;
        if (!eid) {
          const j = await c.json(`${apiBase}/jurisdictions/${jurisdiction}`);
          const el = (j.elections || []).find(e => isElectionDay(e.electionDate) && isGeneralName(textOf(e.name)));
          if (!el) return { notPosted: true };
          eid = c.meta.eid = el.publicElectionId;
        }
        const items = [];
        for (let offset = 0, total = Infinity; offset < total;) {
          const page = await c.json(`${apiBase}/elections/${jurisdiction}/${eid}/ballot-items?limit=500&offset=${offset}`);
          const data = page.data || [];
          items.push(...data);
          total = page.totalRecordCount ?? items.length;
          offset += data.length;
          if (!data.length) break;
        }
        const rows = [];
        const statewide = [];
        for (const it of items) {
          const contest = textOf(it.name);
          const rs = it.reportingStatus || {};
          const raceId = raceIdFor(contest, st, c.ids);
          if (isStatewide(c.races.get(raceId))) statewide.push({ raceId, itemId: it.id });
          for (const o of it.summaryResults?.ballotOptions || []) {
            if (o.isWriteIn && !o.isQualifiedWriteIn) continue;
            rows.push({ raceId, contest, name: textOf(o.name), party: o.party?.abbreviation || textOf(o.party?.name), votes: o.voteCount, rep: rs.reportingUnits, tot: rs.totalUnits });
          }
        }
        const out = { results: collect(st, c, rows, { pctLabel: 'reporting units' }) };
        if (c.countiesOn && statewide.length) {
          // One "results by county" download per statewide race (the same data the state's own county map uses)
          const crow = [];
          for (const { raceId, itemId } of statewide.slice(0, 2)) {
            const j = await c.json(`${apiBase}/elections/${jurisdiction}/${eid}/data/ballot-item/${itemId}`);
            crow.push(...parseEVBreakdown(j, st, raceId));
          }
          out.counties = collectCounties(c, crow);
        }
        return out;
      },
    }],
  };
}

/** Enhanced Voting "results by county": the response carries breakdownResults[] for the ballot item. */
export function parseEVBreakdown(j, st, raceId) {
  const holder = j && (j.breakdownResults ? j : Object.values(j).find(v => v && typeof v === 'object' && Array.isArray(v.breakdownResults)));
  const rows = [];
  for (const b of holder?.breakdownResults || []) {
    const loc = b.locality || {};
    const fips = countyFips(st, textOf(loc.name)) || countyFips(st, loc.mapFeatureId);
    const pct = toNum(loc.percentReporting);
    for (const o of b.ballotOptions || []) {
      if (o.isWriteIn && !o.isQualifiedWriteIn) continue;
      rows.push({ raceId, fips, name: textOf(o.name), party: o.party?.abbreviation || textOf(o.party?.name), votes: o.voteCount, pct });
    }
  }
  return rows;
}

/** Clarity detail.xml: Contest → Choice → VoteType → County votes (summed over vote types). */
export function parseClarityDetail(xml, st, ids) {
  const rows = [];
  const attr = (tag, k) => { const m = tag.match(new RegExp(`\\b${k}="([^"]*)"`)); return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'") : null; };
  const contestRe = /<Contest\b([^>]*)>([\s\S]*?)<\/Contest>/g;
  let m;
  while ((m = contestRe.exec(xml))) {
    const raceId = raceIdFor(attr(m[1], 'text'), st, ids);
    if (!raceId) continue;
    const body = m[2];
    const pct = new Map();
    for (const cm of body.matchAll(/<County\b([^>]*?)precinctsReportingPercent="([\d.]+)"/g)) pct.set(attr(cm[1], 'name'), +cm[2]);
    for (const ch of body.matchAll(/<Choice\b([^>]*)>([\s\S]*?)<\/Choice>/g)) {
      const name = attr(ch[1], 'text'), party = attr(ch[1], 'party');
      const sum = new Map();
      for (const ct of ch[2].matchAll(/<County\b([^>]*)\/>/g)) {
        const cn = attr(ct[1], 'name');
        sum.set(cn, (sum.get(cn) || 0) + (toNum(attr(ct[1], 'votes')) || 0));
      }
      for (const [cn, votes] of sum) rows.push({ raceId, fips: countyFips(st, cn), name, party, votes, pct: pct.get(cn) ?? null });
    }
  }
  return rows;
}

/* ── Clarity ENR (elections.json → current_ver.txt → reports/summary.zip) ── */
function clarity(st, label, indexUrl, fileBase, confidence) {
  return {
    st, label, confidence, format: 'Clarity summary CSV',
    units: [{
      id: st, requests: 4,
      async run(c) {
        let eid = c.meta.eid;
        if (!eid) {
          const list = await c.json(indexUrl);
          const el = (Array.isArray(list) ? list : list.elections || []).find(e =>
            isGeneralName(e.ElectionName) && (isElectionDay(e.Date) || (!e.Date && /2026/.test(e.ElectionName))));
          if (!el) return { notPosted: true };
          eid = c.meta.eid = el.EID;
        }
        const ver = (await c.text(`${fileBase}/${eid}/current_ver.txt`)).trim();
        if (ver === c.meta.ver && c.meta.haveData) return { unchanged: true };
        const csv = await unzipEntry(await c.bytes(`${fileBase}/${eid}/${ver}/reports/summary.zip`), /summary\.csv$/i);
        c.meta.ver = ver;
        const { head, rows } = csvObjects(csv);
        const k = {
          contest: findCol(head, /^contest name$/i), name: findCol(head, /^choice name$/i), party: findCol(head, /^party name$/i),
          votes: findCol(head, /^total votes$/i), tot: findCol(head, /^num (area|precinct)s? total$/i), rep: findCol(head, /^num (area|precinct)s? rptg$/i),
        };
        const out = {
          results: collect(st, c, rows.map(r => ({ contest: r[k.contest], name: r[k.name], party: r[k.party], votes: r[k.votes], rep: r[k.rep], tot: r[k.tot] })),
            { pctLabel: /area/i.test(k.tot || '') ? 'reporting areas' : 'precincts' }),
        };
        if (c.countiesOn) {
          const xml = await unzipEntry(await c.bytes(`${fileBase}/${eid}/${ver}/reports/detailxml.zip`), /detail\.xml$/i);
          out.counties = collectCounties(c, parseClarityDetail(xml, st, c.ids));
        }
        return out;
      },
    }],
  };
}

/* ── "resultsCSV.aspx" sites (Nebraska, South Dakota) ── */
function aspxCsv(st, label, urls, confidence) {
  return {
    st, label, confidence, format: 'Statewide results CSV',
    units: [{
      id: st, requests: urls.length,
      async run(c) {
        const rows = [];
        let found = false;
        for (const url of urls) {
          const text = await c.text(url, { allow404: true });
          if (text == null) continue;
          found = true;
          const { head, rows: objs } = csvObjects(text);
          const k = {
            contest: findCol(head, /^RaceName$/i), area: findCol(head, /^AreaType$/i), areaNum: findCol(head, /^AreaNum$/i),
            name: findCol(head, /^CandidateName$/i), party: findCol(head, /^PartyCode$/i), votes: findCol(head, /^CandidateVotes$/i), prec: findCol(head, /^PrecinctsReporting$/i),
          };
          for (const r of objs) {
            const area = String(r[k.area] || '').toUpperCase();
            if (area && area !== 'SW' && area !== 'CG') continue;       // county rows are a breakdown, not a total
            const [rep, tot] = String(r[k.prec] || '').replace(/[="]/g, '').split('/');
            rows.push({ contest: r[k.contest], district: area === 'CG' ? r[k.areaNum] : undefined, name: r[k.name], party: r[k.party], votes: r[k.votes], rep: toNum(rep), tot: toNum(tot) });
          }
        }
        if (!found) return { notPosted: true };
        return { results: collect(st, c, rows) };
      },
    }],
  };
}

/** California "maps" file: { statewide: {...}, "contra-costa": { raceTitle, Reporting, candidates[] }, ... } */
export function parseCASOSCounties(json, raceId) {
  const rows = [];
  for (const [key, r] of Object.entries(json || {})) {
    if (key === 'statewide' || !Array.isArray(r?.candidates)) continue;
    const fips = countyFips('CA', key.replace(/-/g, ' '));
    const pct = toNum(String(r.Reporting || '').match(/([\d.]+)%/)?.[1]);
    for (const cand of r.candidates) rows.push({ raceId, fips, name: cand.Name, party: cand.Party, votes: cand.Votes, pct });
  }
  return rows;
}

const A = {};
const add = a => { A[a.st] = a; };

/* California: one unit per race so it fits the free plan's 50 downloads per run */
add({
  st: 'CA', label: 'California Secretary of State', confidence: 'verified', format: 'api.sos.ca.gov JSON',
  units: [{ path: 'governor', raceId: 'CA-GOV' }, ...Array.from({ length: 52 }, (_, i) => ({ path: `us-rep/district/${i + 1}`, raceId: `CA-${String(i + 1).padStart(2, '0')}` }))]
    .map((u, order) => ({
      id: `CA:${u.raceId}`, requests: 1, order,
      async run(c) {
        const race = c.races.get(u.raceId);
        // Statewide races: the "maps" file has the statewide total plus every county in one download
        const maps = c.countiesOn && isStatewide(race);
        const json = await c.json(`https://api.sos.ca.gov/returns/${maps ? `maps/${u.path}` : u.path}`);
        const p = parseCASOS(maps && json?.statewide ? json.statewide : json);
        if (!p) return { notPosted: true };
        const out = { results: new Map([[u.raceId, makeResult(race, p.candidates, { pctIn: p.pctIn, pctLabel: 'precincts' })]]) };
        if (maps) out.counties = new Map([[u.raceId, makeCountyResult(race, parseCASOSCounties(json, u.raceId))]]);
        return out;
      },
    })),
});

add(enhanced('AZ', 'Arizona Secretary of State', 'https://app.enhancedvoting.com/results/public/api', 'Arizona', 'verified'));
add(enhanced('GA', 'Georgia Secretary of State', 'https://results.sos.ga.gov/results/public/api', 'Georgia', 'verified'));
add(enhanced('UT', 'Utah elections office', 'https://electionresults.utah.gov/results/public/api', 'Utah', 'unverified'));
add(enhanced('VA', 'Virginia Department of Elections', 'https://enr.elections.virginia.gov/results/public/api', 'Virginia', 'verified'));
add(enhanced('ID', 'Idaho Secretary of State', 'https://results.voteidaho.gov/results/public/api', 'id', 'unverified'));
add(clarity('CO', 'Colorado Secretary of State', 'https://results.enr.clarityelections.com/CO/elections.json', 'https://results.enr.clarityelections.com/CO', 'verified'));
add(clarity('IA', 'Iowa Secretary of State', 'https://electionresults.iowa.gov/IA/elections.json', 'https://electionresults.iowa.gov/IA', 'verified'));
add(aspxCsv('NE', 'Nebraska Secretary of State', [
  'https://electionresults.nebraska.gov/resultsCSV.aspx?text=All&type=SW&map=CTY',
  'https://electionresults.nebraska.gov/resultsCSV.aspx?text=All&type=CG&map=DIST',
], 'verified'));
add(aspxCsv('SD', 'South Dakota Secretary of State', ['https://electionresults.sd.gov/resultsCSV.aspx?text=All&type=SWR&map=CTY'], 'verified'));

/* North Carolina: one JSON file of statewide contest totals */
add({
  st: 'NC', label: 'NC State Board of Elections', confidence: 'verified', format: 'ENR JSON',
  units: [{
    id: 'NC', requests: 2,
    async run(c) {
      const text = await c.text('https://er.ncsbe.gov/enr/20261103/data/results_0.txt', { conditional: true, allow404: true });
      if (text === undefined) return { notPosted: true };
      if (text === null) return { unchanged: true };
      const raw = JSON.parse(text);
      const rows = raw.map(r => ({ contest: r.cnm, name: r.bnm, party: r.pty, votes: r.vct, rep: toNum(r.prt), tot: toNum(r.ptl) }));
      const out = { results: collect('NC', c, rows) };
      if (c.countiesOn) {
        // precinct_0.txt: every statewide contest by county ("lid" = contest, "anm" = county)
        const contestOf = new Map(raw.map(r => [String(r.lid ?? r.gid), raceIdFor(r.cnm, 'NC', c.ids)]));
        const cty = JSON.parse(await c.text('https://er.ncsbe.gov/enr/20261103/data/precinct_0.txt'));
        out.counties = collectCounties(c, cty.map(r => ({
          raceId: contestOf.get(String(r.lid)), fips: countyFips('NC', r.anm), name: r.bnm, party: r.pty, votes: r.vct, rep: r.prt, tot: r.ptl,
        })));
      }
      return out;
    },
  }],
});

/* Texas: Version.json → election id → Federal.json + StateWide.json */
add({
  st: 'TX', label: 'Texas Secretary of State', confidence: 'not found for 2026', format: 'ENR JSON',
  units: [{
    id: 'TX', requests: 5,
    async run(c) {
      const base = 'https://results.texas-election.com/static/data';
      let eid = c.meta.eid;
      if (!eid) {
        const v = await c.json(`${base}/Version.json`);
        const k = await c.json(`${base}/ElectionConstants_${v.___versionNo}.json`);
        const hit = Object.entries(k.electionInfo?.['2026']?.G || {}).find(([, e]) => isGeneralName(e.N));
        if (!hit) return { notPosted: true };
        eid = c.meta.eid = hit[0];
      }
      const ev = await c.json(`${base}/election/${eid}/Version.json`);
      if (ev.___versionNo === c.meta.ver && c.meta.haveData) return { unchanged: true };
      const rows = [];
      for (const f of ['Federal.json', 'StateWide.json']) {
        const json = await c.json(`${base}/election/${eid}/${ev.___versionNo}/${f}`, { allow404: true });
        for (const race of json?.Races || []) for (const cand of race.Candidates || []) {
          rows.push({ contest: race.N, name: cand.N, party: cand.P, votes: cand.V, rep: race.PrecinctsReporting ?? race.PR, tot: race.PrecinctsTotal ?? race.TP });
        }
      }
      c.meta.ver = ev.___versionNo;
      return { results: collect('TX', c, rows) };
    },
  }],
});

/* Florida: one tab-separated file, votes by county */
add({
  st: 'FL', label: 'Florida Division of Elections', confidence: 'verified', format: 'Election Watch TSV',
  units: [{
    id: 'FL', requests: 1,
    async run(c) {
      const text = await c.text('https://flelectionfiles.floridados.gov/enightfilespublic/20261103_ElecResultsFL.txt', { conditional: true, allow404: true });
      if (text === undefined) return { notPosted: true };
      if (text === null) return { unchanged: true };
      const { rows: objs } = csvObjects(text, '\t');
      const counties = new Map();          // raceKey → Set of counties already counted for precincts
      const rows = [];
      for (const r of objs) {
        const raceId = raceIdFor(r.RaceName, 'FL', c.ids, { district: r.Juris1num });
        if (!raceId) continue;
        const seen = counties.get(raceId) || new Set();
        let rep = 0, tot = 0;
        if (!seen.has(r.CountyCode)) { seen.add(r.CountyCode); rep = toNum(r.PrecinctsReporting) || 0; tot = toNum(r.Precincts) || 0; }
        counties.set(raceId, seen);
        rows.push({
          raceId, name: `${r.CanNameFirst} ${r.CanNameLast}`, party: r.PartyCode, votes: r.CanVotes, addRep: rep, addTot: tot,
          fips: countyFips('FL', r.CountyName), rep: r.PrecinctsReporting, tot: r.Precincts,
        });
      }
      const out = {
        results: collect('FL', c, rows, {
          pctOf: g => pctFromUnits(g.rows.reduce((s, x) => s + x.addRep, 0), g.rows.reduce((s, x) => s + x.addTot, 0)),
        }),
      };
      if (c.countiesOn) out.counties = collectCounties(c, rows);
      return out;
    },
  }],
});

/* Minnesota: semicolon-separated media files; county rows skipped */
add({
  st: 'MN', label: 'Minnesota Secretary of State', confidence: 'verified', format: 'Media text files',
  units: [{
    id: 'MN', requests: 4,
    async run(c) {
      const rows = [];
      let found = false;
      for (const f of ['ussenate.txt', 'governor.txt', 'ushouse.txt']) {
        const text = await c.text(`https://electionresultsfiles.sos.mn.gov/20261103/${f}`, { allow404: true });
        if (text == null) continue;
        found = true;
        for (const line of text.split(/\r?\n/)) {
          const p = line.split(';');
          if (p.length < 14 || p[1]) continue;                 // p[1] = county id; blank = statewide/districtwide row
          rows.push({ contest: p[4], district: p[5] || undefined, name: p[7], party: p[10], votes: p[13], rep: toNum(p[11]), tot: toNum(p[12]) });
        }
      }
      if (!found) return { notPosted: true };
      const out = { results: collect('MN', c, rows) };
      if (c.countiesOn) {
        const text = await c.text('https://electionresultsfiles.sos.mn.gov/20261103/allracesbycounty.txt', { allow404: true });
        const crow = [];
        for (const line of String(text || '').split(/\r?\n/)) {
          const p = line.split(';');
          if (p.length < 14 || !p[1] || p[2]) continue;
          if (!/^(U\.S\. Senator|Governor)/i.test(p[4])) continue;
          crow.push({ raceId: raceIdFor(p[4], 'MN', c.ids), fips: mnCountyFips(p[1]), name: p[7], party: p[10], votes: p[13], rep: p[11], tot: p[12] });
        }
        out.counties = collectCounties(c, crow);
      }
      return out;
    },
  }],
});

/* Washington: CSV export of congressional races (no Senate or governor race in 2026) */
add({
  st: 'WA', label: 'Washington Secretary of State', confidence: 'verified', format: 'CSV export',
  units: [{
    id: 'WA', requests: 1,
    async run(c) {
      const text = await c.text('https://results.vote.wa.gov/results/20261103/export/20261103_Congressional.csv', { conditional: true, allow404: true });
      if (text === undefined) return { notPosted: true };
      if (text === null) return { unchanged: true };
      const { rows: objs } = csvObjects(text);
      const WIDE = /^(|congressional|federal|united states|state|statewide)$/i;
      const use = objs.filter(r => WIDE.test((r.JurisdictionName || '').trim()) || r.JurisdictionName === r.Race);
      return { results: collect('WA', c, use.map(r => ({ contest: r.Race, name: r.Candidate, party: r.Party, votes: r.Votes }))) };
    },
  }],
});

/* Orange County Registrar: local contests (city councils, schools, districts, measures) */
add(ocLocalAdapter);

export const ADAPTERS = A;
/** Adapters switched on by STATE_FEEDS (comma list, default all). */
export function enabledAdapters(env) {
  const list = String(env.STATE_FEEDS || 'all').toUpperCase();
  if (list === 'OFF' || list === 'NONE') return [];
  if (list === 'ALL') return Object.values(A);
  return list.split(',').map(s => A[s.trim()]).filter(Boolean);
}
