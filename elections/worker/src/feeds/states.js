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
import { raceIdFor, makeResult, makeCountyResult, isStatewide, pctFromUnits, isElectionDay, isGeneralName, csvObjects, parseCSV, findCol, unzipEntry } from './util.js';
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

/* Indiana: the Election Division's results app. statewideElectionsC_A.json lists office categories (US Representative
   is one) and the statewide precinct count; OffCatC_<id>_A.json has every race in that category. Nov 3, 2026 files
   were checked live on Oct 24 (9 House races, candidates loaded, 0 votes). Indiana has no Senate or governor race. */
export function parseIN(elections, offcat) {
  const jr = elections?.Root?.JurisdictionsReporting || {};
  const tot = toNum(jr.TOTAL_ALLPRECINCTS);
  const repKey = Object.keys(jr).find(k => /REPORT/i.test(k) && !/TOTAL_ALL/i.test(k));
  const rep = repKey ? toNum(jr[repKey]) : null;
  const races = [].concat(offcat?.Root?.StatewideSummary?.Race || []);
  const rows = [];
  for (const r of races) {
    const d = String(r.SubSortOrder || '').match(/\((\d+)\)/)?.[1];
    for (const c of [].concat(r.Candidates?.Candidate || [])) {
      if (/\(W\/I\)/i.test(c.NAME_ON_BALLOT || '')) continue;                 // write-ins
      rows.push({ contest: r.OFFICE_TITLE, district: d, name: c.NAME_ON_BALLOT, party: c.PARTY, votes: c.TOTAL, rep, tot });
    }
  }
  return rows;
}
add({
  st: 'IN', label: 'Indiana Election Division', confidence: 'verified', format: 'Results app JSON',
  units: [{
    id: 'IN', requests: 2,
    async run(c) {
      const base = 'https://enr.indianavoters.in.gov/site/data';
      const elections = await c.json(`${base}/statewideElectionsC_A.json`, { allow404: true });
      if (!elections?.Root) return { notPosted: true };
      const items = (elections.Root.List || []).flatMap(h => [].concat(h.Items?.Item || []));
      const cat = items.find(i => /^US Representative$/i.test(i.OFFICE_CATEGORY_NAME || ''))?.OFFICECATEGORYID || '1005';
      const offcat = await c.json(`${base}/OffCatC_${cat}_A.json`, { allow404: true });
      if (!offcat?.Root) return { notPosted: true };
      return { results: collect('IN', c, parseIN(elections, offcat)) };
    },
  }],
});

/* Tennessee: tnelectionresults.com, one server-built page per office (/categories/<slug>/offices). Each race is a
   <div class="chart-container" data-race="…" data-candidates="[{name, party, votes}]"> followed by
   "N of 95 Counties Completed". Layout checked against the Nov 2024 general (archived); the site is dark until
   results start, so the office pages are found from the home page's menu. */
const unescapeHtml = s => String(s).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export function parseTN(html) {
  const rows = [];
  const parts = String(html).split(/(?=<div[^>]*class="chart-container")/i);
  for (const part of parts) {
    const head = part.match(/^<div([^>]*)>/i)?.[1] || '';
    const race = head.match(/data-race="([^"]*)"/i)?.[1];
    const cands = head.match(/data-candidates="([^"]*)"/i)?.[1];
    if (!race || !cands) continue;
    let list; try { list = JSON.parse(unescapeHtml(cands)); } catch { continue; }
    const title = unescapeHtml(part.match(/<h3[^>]*class="chart-title"[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || race.replace(/_/g, ' ')).replace(/<[^>]+>/g, '').trim();
    const cnt = part.match(/(\d+)\s+of\s+(\d+)\s+Counties/i);
    for (const x of list) rows.push({ contest: title, name: x.name, party: x.party, votes: x.votes, rep: cnt ? toNum(cnt[1]) : null, tot: cnt ? toNum(cnt[2]) : null });
  }
  return rows;
}
add({
  st: 'TN', label: 'Tennessee Secretary of State', confidence: 'unverified', format: 'Results pages (HTML with embedded data)',
  units: [{
    id: 'TN', requests: 4,
    async run(c) {
      const base = 'https://www.tnelectionresults.com';
      const home = await c.text(`${base}/home`, { allow404: true });
      const slugs = [...new Set([...String(home || '').matchAll(/\/categories\/([a-z0-9-]+)\/offices/gi)].map(m => m[1]))]
        .filter(sl => /^(us-house|us-senate|governor)$/i.test(sl));
      if (!slugs.length) return { notPosted: true };
      const rows = [];
      for (const sl of slugs) rows.push(...parseTN(await c.text(`${base}/categories/${sl}/offices`, { allow404: true }) || ''));
      if (!rows.length) return { notPosted: true };
      return { results: collect('TN', c, rows, { pctLabel: 'counties' }) };
    },
  }],
});

/* Missouri: enr.sos.mo.gov is an ASP.NET form (pick the election, press Submit). The feed does the same: read the
   form, post it back, and read the results table. Checked Oct 24 against the Aug 4, 2026 primary, without cookies.
   Only runs once the selected election is the November general. */
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1] ?? null;
export function missouriForm(html) {
  const form = String(html).match(/<form[\s\S]*?<\/form>/i)?.[0] || '';
  const body = new URLSearchParams();
  for (const m of form.matchAll(/<input\b[^>]*>/gi)) {
    const type = (attr(m[0], 'type') || 'text').toLowerCase(), name = attr(m[0], 'name');
    if (!name || type === 'button' || type === 'text') continue;
    if (type === 'submit' && !/btnElectionType/i.test(name)) continue;
    body.set(name, unescapeHtml(attr(m[0], 'value') || ''));
  }
  const sel = form.match(/<select\b[^>]*name="([^"]*cboElectionNames[^"]*)"[^>]*>([\s\S]*?)<\/select>/i);
  if (!sel) return null;
  const opts = [...sel[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(o => ({ value: attr(o[1], 'value'), text: o[2].replace(/\s+/g, ' ').trim(), selected: /selected/i.test(o[1]) }));
  const pick = opts.find(o => /general/i.test(o.text) && /november/i.test(o.text) && /2026/.test(o.text)) || null;
  if (!pick) return null;
  body.set(sel[1], pick.value);
  return { body, election: pick.text };
}
export function parseMO(html) {
  const rows = [];
  let contest = null, rep = null, tot = null;
  for (const tr of String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x => stripTags(x[1]));
    if (cells.length < 3) continue;
    const pr = cells.join(' ').match(/([\d,]+) of ([\d,]+) Precincts Reported/i);
    if (pr && /<strong>/i.test(tr[1])) { contest = cells[0]; rep = toNum(pr[1]); tot = toNum(pr[2]); continue; }
    if (!contest || !cells[0] || /total/i.test(cells[1] || '')) continue;
    const votes = toNum(cells[2]);
    if (votes == null) continue;
    rows.push({ contest, name: cells[0], party: cells[1], votes, rep, tot });
  }
  return rows;
}
add({
  st: 'MO', label: 'Missouri Secretary of State', confidence: 'unverified', format: 'Results page (ASP.NET form)',
  units: [{
    id: 'MO', requests: 2,
    async run(c) {
      const url = 'https://enr.sos.mo.gov/';
      const form = missouriForm(await c.text(url, { allow404: true }) || '');
      if (!form) return { notPosted: true };                         // November's election isn't on the site yet
      const html = await c.post(url, form.body.toString());
      const rows = parseMO(html);
      if (!rows.length) return { notPosted: true };
      return { results: collect('MO', c, rows) };
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

/* ── Oct 24 survey: Arkansas, Connecticut, Delaware, Hawaii, Kansas, Kentucky, North Dakota, Rhode Island, Vermont.
   Mississippi and Wyoming publish no statewide count on election night (counties post their own), so DDHQ calls
   cover them. ── */

// Page text as lines (tags become line breaks), for pages laid out as a grid of <div>/<p> cells
const htmlLines = html => unescapeHtml(String(html).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' '))
  .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
// Candidates listed under more than one party line (Connecticut's cross-endorsements): put the D/R line first so
// the merged candidate keeps the major-party label
const majorFirst = rows => rows.slice().sort((a, b) => +!/^(D|R|DEM|REP|DEMOCRATIC|REPUBLICAN)/i.test(a.party || '') - +!/^(D|R|DEM|REP|DEMOCRATIC|REPUBLICAN)/i.test(b.party || ''));

/* Arkansas: Tally ENR (arkansas.tally-enr.com), backed by a public JSON API. The Nov 3 election ("2026 General
   Election - Judical Runoff") and its candidates were loaded when checked Oct 24. Names come from the contest
   list (large, so read once and kept); votes from one results file per contest type, with county breakdowns. */
const AR_API = 'https://enr-results-api.totalresults.com';
export function arNames(list, ids) {
  const out = { contests: {}, choices: {} };
  for (const ct of Object.values(list?.response?.contests || {})) {
    if (!raceIdFor(ct.contestName, 'AR', ids)) continue;
    out.contests[ct.contestId] = ct.contestName;
    for (const ch of Object.values(ct.choices || {})) out.choices[ch.id] = ch.name;
  }
  return out;
}
const AR_PARTY = /^(DEM|REP|LIB|GRN|IND|NP)\s+/;
export function parseAR(names, results) {
  const rows = [], county = [], missing = [];
  for (const ct of Object.values(results?.response?.contests || {})) {
    const contest = names.contests[ct.contestID];
    if (!contest) continue;
    const cand = id => {
      const full = names.choices[id];
      if (!full) { missing.push(id); return null; }
      const m = full.match(AR_PARTY);
      return { name: full.replace(AR_PARTY, ''), party: m ? m[1] : null };
    };
    for (const ch of ct.choices || []) {
      const x = cand(ch.choiceID);
      if (x) rows.push({ contest, ...x, votes: ch.totalVotes, rep: ct.precinctsReporting, tot: ct.totalPrecincts });
    }
    for (const [fips, loc] of Object.entries(ct.locations || {})) {
      const pct = loc.totalPrecincts ? Math.round(loc.precinctsReporting / loc.totalPrecincts * 1000) / 10 : null;
      for (const ch of loc.choices || []) {
        const x = cand(ch.choiceID);
        if (x) county.push({ contest, fips, ...x, votes: ch.totalVotes, pct });
      }
    }
  }
  return { rows, county, missing };
}
add({
  st: 'AR', label: 'Arkansas Secretary of State', confidence: 'verified', format: 'Tally ENR JSON',
  units: [{
    id: 'AR', requests: 4,
    async run(c) {
      let eid = c.meta.eid;
      if (!eid) {
        const list = await c.json(`${AR_API}/Election/GetElectionList?cid=arkansas`, { allow404: true });
        const el = (list || []).find(e => isElectionDay(e.electionDate) && /general/i.test(e.electionName || ''));
        if (!el) return { notPosted: true };
        eid = c.meta.eid = el.electionID;
      }
      if (!c.meta.names) c.meta.names = arNames(await c.json(`${AR_API}/Contest/GetContestSearchList?cid=arkansas&electionID=${eid}`), c.ids);
      const rows = [], county = [];
      for (const type of ['Federal', 'Statewide']) {
        const r = parseAR(c.meta.names, await c.json(`${AR_API}/Contest/GetContestResults?cId=arkansas&electionID=${eid}&contestType=${type}`));
        rows.push(...r.rows); county.push(...r.county);
        if (r.missing.length) c.meta.names = null;                     // a candidate added since: re-read names next time
      }
      const out = { results: collect('AR', c, rows) };
      if (c.countiesOn) out.counties = collectCounties(c, county.map(r => ({ ...r, raceId: raceIdFor(r.contest, 'AR', c.ids) })));
      return out;
    },
  }],
});

/* Connecticut: the Secretary of the State's public reporting site (ctemspublic.tgstg.net) is built from static JSON:
   Elections.json → election/<id>/Version.json → election/<id>/<version>/{Lookupdata, stateVotes_Electiondata,
   officePrecincts_Electiondata}.json. Checked Oct 24 against the Nov 2024 general; the Nov 3, 2026 election (id 108)
   is loaded with its candidates. Cross-endorsed candidates appear once per party line and are added together. */
const CT_DATA = 'https://ctemspublic.tgstg.net/ng-app/data';
export function ctLookup(L, stateVotes, ids) {
  const offices = {}, cands = {};
  for (const entry of L?.officeList || []) for (const o of Object.values(entry)) {
    const house = /congress/i.test(o.NM);
    if (!raceIdFor(o.NM, 'CT', ids, house ? { district: o.D } : {})) continue;
    offices[o.ID] = { name: o.NM, d: house ? o.D : undefined };
    for (const line of stateVotes?.[o.ID] || []) for (const id of Object.keys(line)) {
      const x = L.candidateIds?.[id];
      if (x) cands[id] = { n: x.NM, p: L.partyIds?.[x.P]?.NM || null };
    }
  }
  return { offices, cands };
}
export function parseCT(lookup, stateVotes, officePrecincts) {
  const rows = [];
  for (const [id, o] of Object.entries(lookup.offices)) {
    const pr = String(officePrecincts?.[id] || '').match(/([\d,]+)\s+of\s+([\d,]+)/);
    const got = [];
    for (const line of stateVotes?.[id] || []) for (const [cid, v] of Object.entries(line)) {
      const cand = lookup.cands[cid];
      if (cand && !/write.?in/i.test(cand.p || '')) got.push({ contest: o.name, district: o.d, name: cand.n, party: cand.p, votes: toNum(v.V), rep: pr ? toNum(pr[1]) : null, tot: pr ? toNum(pr[2]) : null });
    }
    rows.push(...majorFirst(got));
  }
  return rows;
}
add({
  st: 'CT', label: 'Connecticut Secretary of the State', confidence: 'verified', format: 'Public reporting JSON',
  units: [{
    id: 'CT', requests: 5,
    async run(c) {
      let eid = c.meta.eid;
      if (!eid) {
        const list = await c.json(`${CT_DATA}/Elections.json`, { allow404: true });
        const el = (list || []).find(e => isElectionDay(e.Name) && /state election|general/i.test(e.Name));
        if (!el) return { notPosted: true };
        eid = c.meta.eid = el.ID;
      }
      const ver = (await c.json(`${CT_DATA}/election/${eid}/Version.json`, { allow404: true }))?.Version;
      if (!ver) return { notPosted: true };
      if (String(ver) === String(c.meta.ver) && c.meta.haveData) return { unchanged: true };
      const base = `${CT_DATA}/election/${eid}/${ver}`;
      const votes = await c.json(`${base}/stateVotes_Electiondata.json`);
      if (!c.meta.lookup) c.meta.lookup = ctLookup(await c.json(`${base}/Lookupdata.json`), votes, c.ids);
      const prec = await c.json(`${base}/officePrecincts_Electiondata.json`, { allow404: true });
      c.meta.ver = ver;
      return { results: collect('CT', c, parseCT(c.meta.lookup, votes, prec)) };
    },
  }],
});

/* Delaware: one results page per election (/results/enr/PR2026.html was the Sept primary). The page is ~4 MB with
   every county and district, but the statewide tables come first, so only the start is read. The general is
   expected at GE2026.html; the 2024 general's report used the same table layout with a Party column. */
export function parseDE(html) {
  const s = String(html);
  const start = s.search(/<div[^>]+id=["'](st|statewide)["']/i);
  if (start < 0) return [];
  const pr = stripTags(s.slice(0, start)).match(/([\d,]+)\s+of\s+([\d,]+)\s+election districts reporting/i);
  // The statewide block ends where the next group starts (by district, election district, county: <div id="dist"> …)
  const rest = s.slice(start + 8);
  const next = rest.search(/<div[^>]+id=["'](dist|ed|cty|county|wilm|rd|sd)\w*["']/i);
  const block = next >= 0 ? s.slice(start, start + 8 + next) : s.slice(start);
  const rows = [], seen = new Set();
  let h3 = '';
  for (const m of block.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>|<table[\s\S]*?<\/table>/gi)) {
    if (m[1] != null) { h3 = stripTags(m[1]); continue; }
    const t = m[0];
    const cap = t.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i)?.[1];
    const parts = cap ? cap.split(/<br\s*\/?>/i).map(stripTags) : [h3];
    if (parts.length > 2) continue;                                  // "U.S. Senator / Representative District 01 / …": a breakdown
    const [title, capParty = null] = parts;
    if (!title) continue;
    const key = cap ? stripTags(cap) : title;                        // a primary has one table per party for the same office
    if (seen.has(key)) break;                                       // the same table again: the county tables have started
    seen.add(key);
    const head = [...t.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(x => stripTags(x[1]).toLowerCase());
    const iName = head.findIndex(h => /^candidate/.test(h)), iParty = head.indexOf('party'), iTotal = head.indexOf('total votes');
    if (iName < 0 || iTotal < 0) continue;
    for (const tr of t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x => stripTags(x[1]));
      if (cells.length <= iTotal) continue;
      rows.push({ contest: title, name: cells[iName], party: iParty >= 0 ? cells[iParty] : capParty, votes: toNum(cells[iTotal]), rep: pr ? toNum(pr[1]) : null, tot: pr ? toNum(pr[2]) : null });
    }
  }
  return rows;
}
add({
  st: 'DE', label: 'Delaware Department of Elections', confidence: 'unverified', format: 'Results page (HTML, statewide part)',
  units: [{
    id: 'DE', requests: 1,
    async run(c) {
      const html = await c.textHead('https://elections.delaware.gov/results/enr/GE2026.html', 400000, { allow404: true });
      if (!html) return { notPosted: true };
      const rows = parseDE(html);
      if (!rows.length) return { notPosted: true };
      return { results: collect('DE', c, rows, { pctLabel: 'election districts' }) };
    },
  }],
});

/* Hawaii: the Office of Elections' "summary.txt" (one row per candidate, with precinct counts). The 2026 primary was
   tab-separated under elections.hawaii.gov/wp-content/results/2026 Primary/; the 2024 general was comma-separated on
   files.hawaii.gov. Same columns in both. House districts are written "Dist I", "Dist II". */
const HI_URLS = [
  'https://elections.hawaii.gov/wp-content/results/2026%20General/summary.txt',
  'https://files.hawaii.gov/elections/files/results/2026/General/summary.txt',
];
const ROMAN = { I: 1, II: 2, III: 3, IV: 4 };
export function parseHI(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
  const tab = lines.some(l => l.includes('\t'));
  const rows = [];
  for (const cells of tab ? lines.map(l => l.split('\t').map(x => x.replace(/^"|"$/g, '').trim())) : parseCSV(lines.join('\n'))) {
    if (cells.length < 21) continue;
    const contest = cells[1], raw = cells[15];
    const m = String(raw).match(/^\(([A-Z]+)\)\s*(.*)$/);
    const d = contest.match(/\bDist(?:rict)?\.?\s+([IVX]+|\d+)\b/i)?.[1];
    rows.push({
      contest, district: d ? String(ROMAN[d.toUpperCase()] || d) : undefined,
      name: m ? m[2] : raw, party: m ? m[1] : cells[17] || null, votes: toNum(cells[20]), rep: toNum(cells[13]), tot: toNum(cells[12]),
    });
  }
  return rows;
}
add({
  st: 'HI', label: 'Hawaii Office of Elections', confidence: 'unverified', format: 'Summary text file',
  units: [{
    id: 'HI', requests: 2,
    async run(c) {
      for (const url of HI_URLS) {
        const text = await c.text(url, { allow404: true });
        if (!text || !/Representative|Governor/i.test(text)) continue;
        const rows = parseHI(text);
        if (rows.length) return { results: collect('HI', c, rows) };
      }
      return { notPosted: true };
    },
  }],
});

/* Kansas: ent.sos.ks.gov, static pages (national.html: Senate and House; statewide.html: governor). Each race is an
   <h3> title, "Precincts Reporting: N of M", then name / votes / % cells; general-election names carry the party
   ("D-Mark R. Holland"). Checked Oct 24 against the Aug 2026 primary and the archived Nov 2022 general. Between
   elections the site still shows the primary, so pages updated before Nov 3 and "(D)"/"(R)" primary titles are ignored. */
export function parseKS(html) {
  const rows = [];
  for (const part of String(html).split(/<h3[^>]*>/i).slice(1)) {
    const end = part.search(/<\/h3>/i);
    const contest = stripTags(part.slice(0, end));
    if (/\((D|R|L|DEM|REP)\)\s*$/i.test(contest)) continue;
    const lines = htmlLines(part.slice(end));
    const stop = lines.findIndex(l => /^total votes$/i.test(l));
    const body = stop >= 0 ? lines.slice(0, stop) : lines;
    const pr = body.join(' ').match(/Precincts Reporting:\s*([\d,]+)\s+of\s+([\d,]+)/i);
    const district = contest.match(/Representatives?\s+(\d+)\s*$/i)?.[1];
    for (let i = 0; i + 2 < body.length; i++) {
      if (!/^[\d,]+$/.test(body[i + 1]) || !/%$/.test(body[i + 2]) || /^[\d,%]+$|^(votes|%)$/i.test(body[i])) continue;
      const m = body[i].match(/^([A-Z]{1,3})-(.+)$/);
      rows.push({ contest, district, name: m ? m[2] : body[i], party: m ? m[1] : null, votes: toNum(body[i + 1]), rep: pr ? toNum(pr[1]) : null, tot: pr ? toNum(pr[2]) : null });
      i += 2;
    }
  }
  return rows;
}
const updatedOn = html => { const m = stripTags(html).match(/Last Update[d]?:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
add({
  st: 'KS', label: 'Kansas Secretary of State', confidence: 'unverified', format: 'Results pages (HTML)',
  units: [{
    id: 'KS', requests: 2,
    async run(c) {
      const rows = [];
      for (const page of ['national.html', 'statewide.html']) {
        const html = await c.text(`https://ent.sos.ks.gov/${page}`, { allow404: true });
        if (!html || (updatedOn(html) || '') < '2026-11-03') continue;    // still the August primary
        rows.push(...parseKS(html));
      }
      if (!rows.length) return { notPosted: true };
      return { results: collect('KS', c, rows) };
    },
  }],
});

/* Kentucky: the State Board's Election Night Reporting site (vrsws.sos.ky.gov/liveresults/). One page carries every
   statewide-ballot contest (U.S. Senate and all six House districts) as .results-tbl blocks, plus a statewide precinct
   count. Layout checked against the archived May 19, 2026 primary; the site is "under maintenance" between elections.
   Precinct counts are statewide only, so they're used for the Senate race and House races show no "% in". */
export function parseKY(html) {
  // The page is ~2.2 MB (styles and map first); the results are at the end, so jump there with indexOf (cheap)
  const all = String(html);
  const info = all.indexOf('STATEWIDE INFORMATION');
  const s = info >= 0 ? all.slice(info) : all;
  const pr = stripTags(s.slice(0, 4000)).match(/Precincts\s+Participating:\s*([\d,]+)\s+Reporting:\s*([\d,]+)/i);
  // The live page is minified: single class names have no quotes (class=results-tbl-title), so quotes are optional
  const rows = [], seen = new Set();
  for (const part of s.split(/class=(?:"[^"]*|'[^']*|)\bresults-tbl-title\b[^>]*>/i).slice(1)) {
    const contest = stripTags(part.slice(0, part.search(/<\/div>/i)));
    if (seen.has(contest)) continue;
    const body = part.split(/class=(?:"[^"]*|'[^']*|)\bresults-tbl-footer\b/i)[0];
    const got = [];
    for (const row of body.split(/class=(?:"[^"]*|'[^']*|)\bresults-tbl-row-data\b/i).slice(1)) {
      const cell = k => stripTags(row.match(new RegExp(`results-tbl-row-candidate-${k}\\b[^>]*>([\\s\\S]*?)<\\/div>`, 'i'))?.[1] || '');
      const name = cell('name').replace(/^Other\s+/i, ''), votes = toNum(cell('total'));
      if (name && votes != null) got.push({ contest, name, party: cell('party'), votes });
    }
    if (!got.length) continue;
    seen.add(contest);
    const statewide = /SENATOR|GOVERNOR/i.test(contest) && pr;
    rows.push(...got.map(g => ({ ...g, rep: statewide ? toNum(pr[2]) : null, tot: statewide ? toNum(pr[1]) : null })));
  }
  return rows;
}
add({
  st: 'KY', label: 'Kentucky State Board of Elections', confidence: 'unverified', format: 'Election Night Reporting page (HTML)',
  units: [{
    id: 'KY', requests: 1,
    async run(c) {
      const html = await c.text('https://vrsws.sos.ky.gov/liveresults/', { allow404: true });
      if (!html || !/2026 General Election|November 0?3, 2026/i.test(html)) return { notPosted: true };
      const rows = parseKY(html);
      if (!rows.length) return { notPosted: true };
      return { results: collect('KY', c, rows) };
    },
  }],
});

/* North Dakota: results.sos.nd.gov runs a newer version of the Nebraska/New Mexico software with no CSV address, so
   the statewide page is read instead (<h1> per contest, "Precincts Fully: N / M", one block per candidate). Checked
   Oct 24 against the 2024 general it still shows; switches on once the page says "2026 General Election". */
export function parseND(html) {
  const rows = [];
  for (const part of String(html).split(/<h1[^>]*>/i).slice(1)) {
    const contest = stripTags(part.slice(0, part.search(/<\/h1>/i)));
    const full = part.match(/Precincts Fully:\s*([\d,]+)\s*\/\s*([\d,]+)/i);
    for (const b of part.split(/class=(?:"[^"]*|'[^']*)\bsection group\b/i).slice(1)) {
      const name = b.match(/display-results-box-d[^>]*>\s*<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
      const party = b.match(/display-results-box-e[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/i)?.[1];
      const votes = b.match(/display-results-box-g[^>]*>\s*([\d,]+)\s*</i)?.[1];
      if (!name || votes == null) continue;
      rows.push({ contest, name: stripTags(name), party: party ? stripTags(party) : null, votes: toNum(votes), rep: full ? toNum(full[1]) : null, tot: full ? toNum(full[2]) : null });
    }
  }
  return rows;
}
add({
  st: 'ND', label: 'North Dakota Secretary of State', confidence: 'unverified', format: 'Results page (HTML)',
  units: [{
    id: 'ND', requests: 1,
    async run(c) {
      const html = await c.text('https://results.sos.nd.gov/ResultsSW.aspx?text=All&type=SW&map=CTY', { allow404: true });
      if (!html || !/2026\s+GENERAL\s+ELECTION/i.test(html)) return { notPosted: true };
      const rows = parseND(html);
      if (!rows.length) return { notPosted: true };
      return { results: collect('ND', c, rows) };
    },
  }],
});

/* Rhode Island: electionresults.ri.gov is Enhanced Voting (same as Georgia and Virginia). Sept 9 primary checked
   Oct 24; November isn't listed yet. Its ballot calls the Senate race "Senator in Congress". */
add(enhanced('RI', 'Rhode Island Board of Elections', 'https://electionresults.ri.gov/results/public/api', 'RhodeIsland', 'verified'));

/* Vermont: electionresults.vermont.gov is built from static JSON on static.electionresults.vermont.gov:
   elections/elections.json (list) → elections/<guid>.json (paths of the current federal and statewide files, towns
   reporting) → per-town votes, summed here. The Nov 3 general's files were posted (0 votes) when checked Oct 24. */
const VT_STATIC = 'https://static.electionresults.vermont.gov/';
export function parseVT(j, rep, tot) {
  const rows = [];
  for (const p of j?.d || []) for (const o of p.o || []) {
    const sums = new Map();
    for (const town of o.cs || []) for (const r of town.rc || []) {
      if (r.isWriteIn) continue;
      const prev = sums.get(r.cn);
      if (prev) prev.votes += r.vc || 0;
      else sums.set(r.cn, { contest: o.on, name: r.cn, party: r.pn, votes: r.vc || 0, rep, tot });
    }
    rows.push(...sums.values());
  }
  return rows;
}
add({
  st: 'VT', label: 'Vermont Secretary of State', confidence: 'verified', format: 'Results site JSON',
  units: [{
    id: 'VT', requests: 4,
    async run(c) {
      let guid = c.meta.guid;
      if (!guid) {
        const list = await c.json(`${VT_STATIC}elections/elections.json`, { allow404: true });
        const el = (list || []).find(e => isElectionDay(e.electionDate) && !e.town && (e.isGeneralElection || /general election/i.test(e.electionName || '')));
        if (!el) return { notPosted: true };
        guid = c.meta.guid = el.electionGuid;
      }
      const e = await c.json(`${VT_STATIC}elections/${guid}.json`);
      const paths = [e?.federal, e?.stateWide].filter(p => p?.isEnable && p.path).map(p => p.path.replace(/\\/g, '/'));
      if (!paths.length) return { notPosted: true };
      const key = paths.join('|');
      if (key === c.meta.key && c.meta.haveData) return { unchanged: true };
      const [rep, tot] = String(e.townsReporting || '').split('/').map(toNum);
      const rows = [];
      for (const p of paths) rows.push(...parseVT(await c.json(VT_STATIC + p), rep, tot));
      c.meta.key = key;
      return { results: collect('VT', c, rows, { pctLabel: 'towns' }) };
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
