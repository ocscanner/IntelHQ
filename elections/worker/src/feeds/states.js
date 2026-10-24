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
import { caPropsAdapter } from './ca-props.js';
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
function clarity(st, label, indexUrl, fileBase, confidence, findEid = null) {
  return {
    st, label, confidence, format: 'Clarity summary CSV',
    units: [{
      id: st, requests: 4,
      async run(c) {
        let eid = c.meta.eid;
        if (!eid) {
          const list = await c.json(indexUrl, { allow404: true });
          const el = (Array.isArray(list) ? list : list?.elections || []).find(e =>
            isGeneralName(e.ElectionName) && (isElectionDay(e.Date) || (!e.Date && /2026/.test(e.ElectionName))));
          eid = el?.EID || (findEid ? await findEid(c) : null);
          if (!eid) return { notPosted: true };
          c.meta.eid = eid;
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
          // Between elections some states redirect this address to their home page; only a real results CSV counts
          if (!/RaceName/i.test(text.slice(0, 300))) continue;
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
            // Nebraska marks House rows with AreaType "CG"; New Mexico and Oregon have no AreaType and put "DISTRICT 1" in AreaNum
            const areaNum = String(r[k.areaNum] || '');
            const district = area === 'CG' || (!area && /district/i.test(areaNum)) ? areaNum : undefined;
            if (!area && areaNum && !district) continue;                 // a county row in a file without AreaType
            rows.push({ contest: r[k.contest], district, name: r[k.name], party: r[k.party], votes: r[k.votes], rep: toNum(rep), tot: toNum(tot) });
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
// South Carolina runs Clarity on its own domain. Its election list (elections.json) is often empty, so the feed also
// looks for the Nov 3 link on scvotes.gov's results page. Files checked Oct 24 against the Sept 2026 Senate runoff.
add(clarity('SC', 'South Carolina Election Commission', 'https://www.enr-scvotes.org/SC/elections.json', 'https://www.enr-scvotes.org/SC', 'verified',
  async c => {
    const html = await c.text('https://scvotes.gov/elections-statistics/election-results/', { allow404: true });
    for (const m of String(html || '').matchAll(/<a[^>]+href="https?:\/\/www\.enr-scvotes\.org\/SC\/(\d+)\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const text = m[2].replace(/<[^>]+>/g, ' ');
      if (/general/i.test(text) && !/primar|runoff|special|municipal|city|town|county/i.test(text)) return m[1];
    }
    return null;
  }));
add(clarity('IA', 'Iowa Secretary of State', 'https://electionresults.iowa.gov/IA/elections.json', 'https://electionresults.iowa.gov/IA', 'verified'));
add(aspxCsv('NE', 'Nebraska Secretary of State', [
  'https://electionresults.nebraska.gov/resultsCSV.aspx?text=All&type=SW&map=CTY',
  'https://electionresults.nebraska.gov/resultsCSV.aspx?text=All&type=CG&map=DIST',
], 'verified'));
add(aspxCsv('SD', 'South Dakota Secretary of State', ['https://electionresults.sd.gov/resultsCSV.aspx?text=All&type=SWR&map=CTY'], 'verified'));
// Same results software as Nebraska and South Dakota. New Mexico's Nov 3 file was checked live (Oct 24, candidates
// loaded). Oregon and Montana run the same software but only switch their results sites on near Election Day.
add(aspxCsv('NM', 'New Mexico Secretary of State', [
  'https://electionresults.sos.nm.gov/resultsCSV.aspx?text=All&type=FED&map=CTY',
  'https://electionresults.sos.nm.gov/resultsCSV.aspx?text=All&type=SW&map=CTY',
], 'verified'));
add(aspxCsv('OR', 'Oregon Secretary of State', [
  'https://results.oregonvotes.gov/resultsCSV.aspx?text=All&type=FED&map=CTY',
  'https://results.oregonvotes.gov/resultsCSV.aspx?text=All&type=SW&map=CTY',
], 'unverified'));
add(aspxCsv('MT', 'Montana Secretary of State', [
  'https://electionresults.mt.gov/resultsCSV.aspx?text=All&type=FED&map=CTY',
], 'unverified'));

/* Alaska: one precinct-level CSV for every contest (about 5 MB), summed here. Paid plan only.
   The primary used /enr26/results/GA_ENR_Precinct_State_of_Alaska.csv; November is expected at the same address,
   so the primary's file is told apart by its crowded U.S. Senate field (the general has at most four finalists). */
export function parseAK(text) {
  const lines = text.split(/\r?\n/);
  const keep = [lines[0], ...lines.slice(1).filter(l => /"(U\.S\. Senator|U\.S\. Representative|Governor[^"]*)"/.test(l))];
  const { head, rows: objs } = csvObjects(keep.join('\n'));
  const k = {
    contest: findCol(head, /^Contest_title$/i), name: findCol(head, /^candidate_name$/i), party: findCol(head, /^Party_Code$/i),
    votes: findCol(head, /^total_votes$/i), type: findCol(head, /^Candidate_Type$/i),
  };
  // Reporting_flag is 0 on every row (even certified files), so there's no "% in"; the board shows "Counting"
  const byKey = new Map();
  for (const r of objs) {
    const contest = r[k.contest];
    if (!contest || /write-?in/i.test(r[k.name]) || (k.type && r[k.type] === 'W')) continue;
    // "Sullivan, Dan" → "Dan Sullivan"; tickets "Dunleavy, Mike/Dahlstrom, Nancy" → the first name on the ticket
    const first = String(r[k.name] || '').split('/')[0];
    const name = first.includes(',') ? `${first.split(',').slice(1).join(',').trim()} ${first.split(',')[0].trim()}` : first.trim();
    const key = `${contest}|${name}`;
    const prev = byKey.get(key);
    if (prev) prev.votes += toNum(r[k.votes]) || 0;
    else byKey.set(key, { contest, name, party: r[k.party], votes: toNum(r[k.votes]) || 0 });
  }
  return [...byKey.values()];
}
add({
  st: 'AK', label: 'Alaska Division of Elections', confidence: 'unverified', format: 'Precinct results CSV (large)',
  units: [{
    id: 'AK', requests: 1, paidOnly: true,
    async run(c) {
      const text = await c.text('https://www.elections.alaska.gov/enr26/results/GA_ENR_Precinct_State_of_Alaska.csv', { conditional: true, allow404: true });
      if (text === undefined) return { notPosted: true };
      if (text === null) return { unchanged: true };
      if (!/Contest_title/i.test(text.slice(0, 600))) return { notPosted: true };
      const rows = parseAK(text);
      const senate = new Set(rows.filter(r => /U\.S\. Senator/.test(r.contest)).map(r => r.name));
      if (senate.size > 5) return { notPosted: true };                  // still the August primary's file
      return { results: collect('AK', c, rows) };
    },
  }],
});

/* Maryland: plain HTML results pages, one per office (the House page has all 8 districts).
   June 2026 primary: /elections/2026/primary_results/gen_results_2026_1.html (governor), _4.html (Congress).
   November's folder isn't posted yet; the feed finds it from the 2026 election page, then the two pages by name. */
const stripTags = s => String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
export function parseMD(html) {
  const rows = [];
  let contest = '', district;
  let rep = null, tot = null;
  // Walk headings, "N of M ... precincts reported" notes and tables in page order
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>|<h3[^>]*>([\s\S]*?)<\/h3>|\((\d[\d,]*) of (\d[\d,]*)[^)]*precincts reported\)|<table[\s\S]*?<\/table>/gi;
  for (const m of html.matchAll(re)) {
    if (m[1] != null) { contest = stripTags(m[1]); district = undefined; continue; }
    if (m[2] != null) { const d = stripTags(m[2]).match(/District\s+(\d+)/i); if (d) district = d[1]; continue; }
    if (m[3] != null) { rep = toNum(m[3]); tot = toNum(m[4]); continue; }
    const table = m[0];
    const head = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(x => stripTags(x[1]).toLowerCase());
    const iName = head.indexOf('name'), iParty = head.indexOf('party'), iTotal = head.indexOf('total');
    if (iName < 0 || iTotal < 0) continue;
    for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x => stripTags(x[1]));
      if (cells.length <= iTotal) continue;
      rows.push({ contest, district, name: cells[iName], party: iParty >= 0 ? cells[iParty] : null, votes: cells[iTotal], rep, tot });
    }
  }
  return rows;
}
add({
  st: 'MD', label: 'Maryland State Board of Elections', confidence: 'unverified', format: 'Results web pages (HTML)',
  units: [{
    id: 'MD', requests: 4,
    async run(c) {
      const site = 'https://elections.maryland.gov/elections/2026/';
      let folder = c.meta.folder;
      if (!folder) {
        const home = await c.text(`${site}index.html`, { allow404: true });
        const link = home && [...home.matchAll(/href="([^"]*general[^"]*results[^"]*)"/gi)].map(m => m[1])[0];
        if (!link) return { notPosted: true };
        folder = new URL(link.replace(/index\.html?$/i, ''), site).href.replace(/\/?$/, '/');
        const index = await c.text(folder, { allow404: true });
        if (!index) return { notPosted: true };
        const pageFor = re => [...index.matchAll(/<a[^>]+href="([^"]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi)].find(m => re.test(stripTags(m[2])))?.[1];
        const gov = pageFor(/^governor/i), house = pageFor(/^representative in congress$/i);
        if (!gov && !house) return { notPosted: true };
        c.meta.folder = folder; c.meta.pages = [gov, house].filter(Boolean);
      }
      const rows = [];
      for (const page of c.meta.pages || []) {
        const html = await c.text(new URL(page, folder).href, { allow404: true });
        if (html) rows.push(...parseMD(html));
      }
      if (!rows.length) return { notPosted: true };
      return { results: collect('MD', c, rows) };
    },
  }],
});

/* Louisiana: two JSON files (named .htm) for races on more than one parish's ballot: races + candidates, and votes */
export function parseLA(racesJson, votesJson) {
  const votes = new Map();
  const prec = new Map();
  for (const r of votesJson?.Races?.Race || []) {
    prec.set(String(r.ID), [toNum(r.PrecinctsReporting), toNum(r.PrecinctsExpected)]);
    for (const ch of r.Choice || []) votes.set(String(ch.ID), toNum(ch.VoteTotal) || 0);
  }
  const rows = [];
  for (const r of racesJson?.Races?.Race || []) {
    const [rep, tot] = prec.get(String(r.ID)) || [];
    for (const ch of r.Choice || []) {
      const m = String(ch.Desc || '').match(/^(.*?)\s*\(([A-Z]+)\)\s*$/);
      rows.push({ contest: r.SpecificTitle || r.GeneralTitle, name: (m ? m[1] : ch.Desc).replace(/"/g, ''), party: m ? m[2] : null, votes: votes.get(String(ch.ID)) ?? 0, rep, tot });
    }
  }
  return rows;
}
add({
  st: 'LA', label: 'Louisiana Secretary of State', confidence: 'verified', format: 'Voter Portal JSON',
  units: [{
    id: 'LA', requests: 2,
    async run(c) {
      const base = 'https://voterportal.sos.la.gov/ElectionResults/ElectionResults/Data?blob=20261103';
      const races = await c.json(`${base}/RacesCandidates_Multiparish.htm`, { allow404: true });
      if (!races?.Races?.Race?.length) return { notPosted: true };
      const votes = await c.json(`${base}/Votes_Multiparish.htm`);
      return { results: collect('LA', c, parseLA(races, votes)) };
    },
  }],
});

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

/* Pennsylvania: the Department of State's media feed "Results by Office" — every race, row by county */
export function parsePAFeed(xml, c) {
  const head = xml.slice(0, 1500);
  const pm = head.match(/([\d,]+) Out of ([\d,]+) Districts/i);
  const pctIn = pm ? pctFromUnits(toNum(pm[1]), toNum(pm[2])) : null;
  const rows = [];
  for (const m of xml.matchAll(/<item>\s*<title>([^<]*)<\/title>\s*<description>([\s\S]*?)<\/description>/g)) {
    const raceId = raceIdFor(m[1].replace(/&amp;/g, '&'), 'PA', c.ids);
    if (!raceId) continue;
    for (const tr of m[2].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim());
      if (cells.length < 7 || /^county$/i.test(cells[0])) continue;
      rows.push({ raceId, county: cells[0], fips: countyFips('PA', cells[0]), name: cells[1], party: cells[2], votes: cells[6] });
    }
  }
  return { rows, pctIn };
}
add({
  st: 'PA', label: 'Pennsylvania Department of State', confidence: 'verified', format: 'Election feed (RSS, by county)',
  units: [{
    id: 'PA', requests: 1,
    async run(c) {
      const xml = await c.text('https://www.electionreturns.pa.gov/electionFeed.aspx?ID=83', { conditional: true, allow404: true });
      if (xml === undefined) return { notPosted: true };
      if (xml === null) return { unchanged: true };
      if (!/<rss\b/i.test(xml.slice(0, 500))) throw new Error('Feed answered with a web page, not the results feed (bot check?)');
      if (!/2026 General/i.test(xml.slice(0, 1500))) return { notPosted: true };
      const { rows, pctIn } = parsePAFeed(xml, c);
      const out = { results: collect('PA', c, rows, { pctOf: () => pctIn, pctLabel: 'voting districts statewide' }) };
      if (c.countiesOn) out.counties = collectCounties(c, rows);
      return out;
    },
  }],
});

/* Ohio: "Ohio Decides" contest API — governor, U.S. Senate and all House districts (3 downloads) */
add({
  st: 'OH', label: 'Ohio Secretary of State', confidence: 'verified', format: 'Ohio Decides JSON',
  units: [{
    id: 'OH', requests: 3,
    async run(c) {
      const rows = [];
      let any = false;
      for (const name of ['Governor and Lieutenant Governor', 'U.S. Senator', 'Representative to Congress']) {
        const j = await c.json(`https://liveresults.ohiosos.gov/Api/v1/Contest/GetContestDetailsObject?contestName=${encodeURIComponent(name)}&resultsLevel=&countyId=`, { allow404: true });
        for (const k of j?.contestList || []) {
          any = true;
          for (const cand of k.candidatesRunning || []) {
            if (cand.isWriteIn) continue;
            rows.push({ contest: k.name, name: cand.primaryCandidate, party: cand.candidateParty, votes: cand.vCount ?? cand.voteCount, rep: k.reportedPrecincts, tot: k.totalPrecincts });
          }
        }
      }
      if (!any) return { notPosted: true };
      return { results: collect('OH', c, rows) };
    },
  }],
});

/* Orange County Registrar: local contests (city councils, schools, districts, measures) */
add(ocLocalAdapter);

/* California Secretary of State: the 14 statewide propositions (statewide and Orange County counts) */
add(caPropsAdapter);

export const ADAPTERS = A;
/** Adapters switched on by STATE_FEEDS (comma list, default all). */
export function enabledAdapters(env) {
  const list = String(env.STATE_FEEDS || 'all').toUpperCase();
  if (list === 'OFF' || list === 'NONE') return [];
  if (list === 'ALL') return Object.values(A);
  return list.split(',').map(s => A[s.trim()]).filter(Boolean);
}
