// Shared helpers for the state feed adapters: contest matching, CSV, ZIP and name cleanup.
import { normParty, toNum } from '../parties.js';

/* ── Contest names → race ids ── */
const PRIMARY = /\s-\s*(REP|DEM|R|D|REPUBLICAN|DEMOCRATIC|LIB|GRN)\.?$|\((REP|DEM|R|D)\)$|\bPRIMARY\b/;
const STATE_LEG = /\bSTATE\s+(SENATE|SENATOR|HOUSE|REPRESENTATIVE|ASSEMBLY)\b|\bLEGISLATIVE\b|\bASSEMBLY\b|\bGENERAL ASSEMBLY\b/;

/**
 * Work out which race a contest name is, if any.
 * @param {string} name     contest title from the state file
 * @param {string} st       state postal code
 * @param {Set<string>} ids every race id on the board
 * @param {{district?:string|number}} hint  district number when the file carries it in its own column
 * @returns {string|null}   race id such as "GA-SEN", "OH-SEN-S", "TX-GOV", "CA-45", "AK-AL"
 */
export function raceIdFor(name, st, ids, hint = {}) {
  const s = String(name || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!s || PRIMARY.test(s)) return null;

  if (/\b(U\.? ?S\.?|UNITED STATES)\s+SENAT(E|OR)\b/.test(s) && !/\bSTATE SENAT/.test(s)) {
    const special = /SPECIAL|UNEXPIRED|SHORT TERM/.test(s);
    const order = special ? [`${st}-SEN-S`, `${st}-SEN`] : [`${st}-SEN`, `${st}-SEN-S`];
    return order.find(i => ids.has(i)) || null;
  }

  const noLt = s.replace(/\b(LIEUTENANT|LT\.?)\s+GOVERNOR\b/g, '');
  if (/\bGOVERNOR\b/.test(noLt) && !/COUNCIL/.test(noLt)) return ids.has(`${st}-GOV`) ? `${st}-GOV` : null;

  const congress = /\b(U\.? ?S\.?|UNITED STATES|CONGRESS|CONGRESSIONAL)\b/.test(s)
    && /\b(REPRESENTATIVE|REPRESENTATIVES|HOUSE|CONGRESS|CONGRESSIONAL)\b/.test(s);
  if (congress && !STATE_LEG.test(s)) {
    let d = hint.district != null && String(hint.district).match(/\d+/)?.[0];
    if (!d) d = s.match(/DISTRICT\s*(?:NO\.?\s*)?(\d{1,2})\b/)?.[1]
      || s.match(/\b(\d{1,2})(?:ST|ND|RD|TH)\s+(?:CONGRESSIONAL\s+)?DISTRICT\b/)?.[1]
      || s.match(/\bCD\s*-?\s*(\d{1,2})\b/)?.[1];
    const n = d ? parseInt(d, 10) : 0;
    if (n > 0) { const id = `${st}-${String(n).padStart(2, '0')}`; return ids.has(id) ? id : null; }
    return ids.has(`${st}-AL`) ? `${st}-AL` : null;
  }
  return null;
}

/* ── Candidate cleanup ── */
const SKIP = /^(write[- ]?ins?|over ?votes?|under ?votes?|blank( ballots)?|total( votes)?|times cast|registered voters|scattering|none of these candidates|no candidate)\b/i;
export const isRealCandidate = name => !!String(name || '').trim() && !SKIP.test(String(name).trim());

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const SUFFIX = /^(jr|sr|ii|iii|iv)$/;
const lastOf = s => { const p = fold(s).split(' ').filter(w => !SUFFIX.test(w)); return p[p.length - 1] || ''; };

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s\-'(])([a-z])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase())
    .replace(/\b(Ii|Iii|Iv)\b/g, m => m.toUpperCase());
}

/**
 * Tidy a candidate name from a state file. Uses the pre-race candidate list for the race when the
 * last names match, so "KEN PAXTON" and "Kenneth Paxton" both display as the board's "Ken Paxton".
 */
export function cleanName(raw, race, { ticket = false } = {}) {
  let n = String(raw || '').replace(/\s+/g, ' ').replace(/\s*\*+$/, '').replace(/\s*\((I|INC)\)$/i, '').trim();
  if (ticket) n = n.split(/\s+(?:and|&)\s+|\s*\/\s*/i)[0].trim();     // "Ada Example and Cam Example" → first name on the ticket
  if (/^[^,]+,\s*[^,]+$/.test(n) && !/,\s*(jr|sr|ii|iii|iv)\.?$/i.test(n)) {   // "PAXTON, KEN" → "KEN PAXTON"
    const [l, f] = n.split(/,\s*/); n = `${f} ${l}`;
  }
  const pre = race?.candidates || [];
  const hit = pre.find(c => lastOf(c.name) && lastOf(c.name) === lastOf(n));
  if (hit) return hit.name;
  return n === n.toUpperCase() ? titleCase(n) : n;
}

/** Turn parsed rows into the board's per-race shape, merging duplicate candidates. */
export function makeResult(race, rows, extra) {
  const ticket = race.chamber === 'governor';
  const byName = new Map();
  for (const r of rows) {
    if (!isRealCandidate(r.name)) continue;
    const name = cleanName(r.name, race, { ticket });
    const prev = byName.get(name);
    if (prev) prev.votes += Math.max(0, Math.round(toNum(r.votes) || 0));
    else byName.set(name, { name, party: normParty(r.party), votes: Math.max(0, Math.round(toNum(r.votes) || 0)), winner: false });
  }
  const candidates = [...byName.values()].sort((a, b) => b.votes - a.votes);
  return { candidates, ...extra };
}

/**
 * Per-county results for one race, in a compact shape the map reads directly:
 *   { cands: [{name, party}], counties: { "13121": { v: [votes per cand], pct } } }
 * Candidates are ordered by statewide total; v[] lines up with cands[].
 * @param {object} race   race from the board's race list
 * @param {{fips:string, name:string, party?:string, votes:any, rep?:any, tot?:any, pct?:number}[]} rows
 */
export function makeCountyResult(race, rows) {
  const ticket = race.chamber === 'governor';
  const totals = new Map(), parties = new Map(), byCounty = new Map();
  for (const r of rows) {
    if (!r.fips || !isRealCandidate(r.name)) continue;
    const name = cleanName(r.name, race, { ticket });
    const v = Math.max(0, Math.round(toNum(r.votes) || 0));
    totals.set(name, (totals.get(name) || 0) + v);
    if (!parties.has(name)) parties.set(name, normParty(r.party));
    const c = byCounty.get(r.fips) || { votes: new Map(), pct: null };
    c.votes.set(name, (c.votes.get(name) || 0) + v);
    const pct = r.pct ?? pctFromUnits(r.rep, r.tot);
    if (pct != null) c.pct = pct;
    byCounty.set(r.fips, c);
  }
  const names = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a));
  const counties = {};
  for (const [fips, c] of byCounty) counties[fips] = { v: names.map(n => c.votes.get(n) || 0), pct: c.pct };
  return { cands: names.map(n => ({ name: n, party: parties.get(n) })), counties };
}

/** True for races the county map covers (statewide: Senate and governor). */
export const isStatewide = race => race && (race.chamber === 'senate' || race.chamber === 'governor');

export function pctFromUnits(rep, total) {
  const a = toNum(rep), b = toNum(total);
  if (a == null || !b) return null;
  return Math.round(Math.min(100, a / b * 100) * 10) / 10;
}

/* ── Dates ── */
/** True when a date string (any common US format) is Nov 3, 2026. */
export function isElectionDay(text, ymd = '2026-11-03') {
  const s = String(text || '').trim();
  if (s.startsWith(ymd)) return true;
  const [y, m, d] = ymd.split('-').map(Number);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return +us[1] === m && +us[2] === d && +us[3] === y;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const long = s.toUpperCase().match(/\b([A-Z]{3})[A-Z]*\.? (\d{1,2}),? (\d{4})/);
  if (long) return months.indexOf(long[1]) + 1 === m && +long[2] === d && +long[3] === y;
  return false;
}
export const isGeneralName = name => /GENERAL/i.test(String(name || '')) && !/PRIMARY/i.test(String(name || ''));

/* ── CSV ── */
export function parseCSV(text, delim = ',') {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}
/** CSV rows as objects keyed by header (case-insensitive lookups via col()). */
export function csvObjects(text, delim = ',') {
  const rows = parseCSV(text.replace(/^﻿/, ''), delim);
  const head = (rows.shift() || []).map(h => h.trim());
  return { head, rows: rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}
export const findCol = (head, ...patterns) => head.find(h => patterns.some(p => p.test(h)));

/* ── ZIP (Clarity's summary.zip) ── */
/** Read one file out of a .zip held in memory. Supports stored and deflate entries. */
export async function unzipEntry(bytes, wanted = /\.csv$/i) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted.test(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + csize);
    if (method === 0) return new TextDecoder().decode(data);
    if (method !== 8) throw new Error(`Unsupported zip method ${method}`);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }
  throw new Error('No matching file in zip');
}
