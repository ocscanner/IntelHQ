// OC Scanner IntelHQ — Income (P08): the math, kept separate from the page so it can be tested.
// Works in the browser (window.IncomeCore) and in Node (require) for the tests in income/test/.
//
// Money is kept in whole cents (integers) so totals never pick up rounding errors.
// Every entry has a "kind". Only kind "revenue" counts toward income; expenses, taxes and
// transfers (moving your own money, e.g. Venmo → bank) are kept for the record but never added in.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IncomeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SOURCES = [
    { id: 'x_ads', label: 'X ad revenue share', short: 'X ads', payout: true },
    { id: 'x_subs', label: 'X subscriptions', short: 'X subs', payout: true },
    { id: 'x_money', label: 'X Money tips', short: 'X Money' },
    { id: 'kofi', label: 'Ko-fi', short: 'Ko-fi' },
    { id: 'venmo', label: 'Venmo', short: 'Venmo' },
    { id: 'fourthwall', label: 'Fourthwall merch', short: 'Merch' },
    { id: 'sponsorship', label: 'Sponsorship', short: 'Sponsors' },
    { id: 'other', label: 'Other', short: 'Other' },
  ];
  const SOURCE_IDS = SOURCES.map((s) => s.id);
  const KINDS = [
    { id: 'revenue', label: 'Revenue' },
    { id: 'expense', label: 'Expense (not counted)' },
    { id: 'tax', label: 'Tax (not counted)' },
    { id: 'transfer', label: 'Transfer (not counted)' },
  ];
  const KIND_IDS = KINDS.map((k) => k.id);
  const TZ = 'America/Los_Angeles';

  function sourceLabel(id) { const s = SOURCES.find((x) => x.id === id); return s ? s.label : id; }

  // ── Money ───────────────────────────────────────────────────────────────
  // "$1,234.56", "+ $10.00", "- $5.00", "(5.00)", "-12", "USD 7.5" → cents (signed). Blank → null.
  function parseAmount(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : null;
    let s = String(value).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[A-Za-z$€£\s]/g, '');
    if (s.startsWith('+')) s = s.slice(1);
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
    s = s.replace(/,/g, '');
    if (!/^\d*\.?\d+$/.test(s)) return null;
    const cents = Math.round(parseFloat(s) * 100);
    return neg ? -cents : cents;
  }

  function formatMoney(cents, opts) {
    const o = opts || {};
    const n = (cents || 0) / 100;
    const str = Math.abs(n).toLocaleString('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: o.whole ? 0 : 2, maximumFractionDigits: o.whole ? 0 : 2,
    });
    return (n < 0 ? '−' : (o.sign && n > 0 ? '+' : '')) + str;
  }

  // ── Dates ───────────────────────────────────────────────────────────────
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const pad = (n) => String(n).padStart(2, '0');
  function ymd(y, m, d) {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null; // e.g. Feb 30
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  function pacificDate(date) {
    return date.toLocaleDateString('en-CA', { timeZone: TZ });
  }
  // ISO with a time zone (…Z / +00:00) → the Pacific calendar day. Otherwise the date as written.
  // US order (MM/DD/YYYY) is assumed for slashes.
  function parseDate(value) {
    if (!value) return null;
    const s = String(value).trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i))) {
      if (m[7]) {
        const d = new Date(s.replace(' ', 'T'));
        return isNaN(d) ? null : pacificDate(d);
      }
      return ymd(+m[1], +m[2], +m[3]);
    }
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[\s,]+.*)?$/))) return ymd(+m[3], +m[1], +m[2]);
    if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/))) {
      const mo = MONTHS[m[1].toLowerCase().slice(0, 4)] || MONTHS[m[1].toLowerCase().slice(0, 3)];
      return mo ? ymd(+m[3], mo, +m[2]) : null;
    }
    if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/))) {
      const mo = MONTHS[m[2].toLowerCase().slice(0, 3)];
      return mo ? ymd(+m[3], mo, +m[1]) : null;
    }
    return null;
  }
  function todayPacific(now) { return pacificDate(now || new Date()); }
  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) { // inclusive
    const t = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((t(b) - t(a)) / 86400000) + 1;
  }
  function monthKey(iso) { return iso.slice(0, 7); }
  function monthEnd(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  function shiftMonth(key, n) {
    const [y, m] = key.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + n, 1));
    return dt.toISOString().slice(0, 7);
  }

  // Preset ranges, all inclusive, in Pacific days.
  function rangeFor(preset, today) {
    const t = today || todayPacific();
    const mk = monthKey(t);
    const y = t.slice(0, 4);
    switch (preset) {
      case 'this-month': return { from: mk + '-01', to: t };
      case 'last-month': { const p = shiftMonth(mk, -1); return { from: p + '-01', to: monthEnd(p) }; }
      case 'ytd': return { from: y + '-01-01', to: t };
      case 'last-year': return { from: (+y - 1) + '-01-01', to: (+y - 1) + '-12-31' };
      case '12m': return { from: shiftMonth(mk, -11) + '-01', to: t };
      case 'all': return { from: '1900-01-01', to: '2999-12-31' };
      default: return { from: mk + '-01', to: t };
    }
  }
  // The period just before a range, for "vs previous". Whole months compare to whole months;
  // anything else compares to the same number of days immediately before.
  function previousRange(range) {
    const { from, to } = range;
    if (from.endsWith('-01-01') && (to.endsWith('-12-31') || from.slice(0, 4) === to.slice(0, 4))) {
      // Year (or year to date) → same span of the previous year.
      const py = String(+from.slice(0, 4) - 1);
      let pto = py + to.slice(4);
      if (pto.endsWith('-02-29')) pto = py + '-02-28';
      return { from: py + from.slice(4), to: pto };
    }
    if (from.endsWith('-01') && monthKey(from) === monthKey(to)) {
      // Month (or month to date) → same days of the previous month.
      const p = shiftMonth(monthKey(from), -1);
      const day = Math.min(+to.slice(8), +monthEnd(p).slice(8));
      return { from: p + '-01', to: `${p}-${pad(day)}` };
    }
    const len = daysBetween(from, to);
    return { from: addDays(from, -len), to: addDays(from, -1) };
  }

  // ── Entries ─────────────────────────────────────────────────────────────
  // 9+ digits in a row (spaces/dashes allowed) looks like an account or card number: refuse to store it.
  const ACCOUNT_LIKE = /\d(?:[\s-]?\d){8,}/;

  function normalizeEntry(e) {
    const out = {
      id: e.id || '',
      date: e.date || '',
      periodStart: e.periodStart || '',
      periodEnd: e.periodEnd || '',
      source: e.source || 'other',
      kind: e.kind || 'revenue',
      gross: e.gross === '' || e.gross === undefined ? null : e.gross,
      fee: e.fee === '' || e.fee === undefined || e.fee === null ? 0 : Math.abs(e.fee),
      net: e.net === '' || e.net === undefined ? null : e.net,
      destination: (e.destination || '').trim(),
      counterparty: (e.counterparty || '').trim(),
      note: (e.note || '').trim(),
      ref: (e.ref || '').trim(),
      batch: e.batch || '',
      fingerprint: e.fingerprint || '',
      createdAt: e.createdAt || '',
      updatedAt: e.updatedAt || '',
    };
    if (out.gross === null && out.net !== null) out.gross = out.net + (out.net < 0 ? -out.fee : out.fee);
    if (out.net === null && out.gross !== null) out.net = out.gross - (out.gross < 0 ? -out.fee : out.fee);
    // Expenses, taxes and transfers are stored as positive amounts; only revenue can go negative (refunds).
    if (out.kind !== 'revenue') { out.gross = Math.abs(out.gross || 0); out.net = Math.abs(out.net || 0); }
    if (out.source !== 'sponsorship') out.counterparty = '';
    return out;
  }

  function validateEntry(e) {
    const errors = [];
    if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !ymd(+e.date.slice(0, 4), +e.date.slice(5, 7), +e.date.slice(8)))
      errors.push('Date received is missing or not a real date.');
    if (!SOURCE_IDS.includes(e.source)) errors.push('Pick a source.');
    if (!KIND_IDS.includes(e.kind)) errors.push('Pick a kind.');
    if (!Number.isInteger(e.net)) errors.push('Enter an amount.');
    if (e.gross !== null && !Number.isInteger(e.gross)) errors.push('Gross amount is not a number.');
    if (Number.isInteger(e.net) && Math.abs(e.net) > 100000000) errors.push('Amount looks too large (over $1,000,000).');
    if ((e.periodStart && !e.periodEnd) || (!e.periodStart && e.periodEnd)) errors.push('Give both payout period dates, or neither.');
    if (e.periodStart && e.periodEnd && e.periodStart > e.periodEnd) errors.push('Payout period ends before it starts.');
    for (const f of ['destination', 'counterparty', 'note', 'ref']) {
      if (f !== 'ref' && ACCOUNT_LIKE.test(e[f] || '')) errors.push(`"${f === 'destination' ? 'Paid to' : f}" looks like it holds an account or card number. Use a nickname instead.`);
    }
    return errors;
  }

  function summarize(entries, range) {
    const inRange = entries.filter((e) => e.date >= range.from && e.date <= range.to);
    const revenue = { gross: 0, fee: 0, net: 0, count: 0 };
    const excluded = { expense: 0, tax: 0, transfer: 0 };
    const bySource = {};
    const byDestination = {};
    for (const e of inRange) {
      if (e.kind !== 'revenue') { excluded[e.kind] = (excluded[e.kind] || 0) + Math.abs(e.net); continue; }
      revenue.gross += e.gross || 0; revenue.fee += e.fee || 0; revenue.net += e.net; revenue.count++;
      const s = bySource[e.source] || (bySource[e.source] = { gross: 0, fee: 0, net: 0, count: 0 });
      s.gross += e.gross || 0; s.fee += e.fee || 0; s.net += e.net; s.count++;
      const dk = e.destination || '(not set)';
      const d = byDestination[dk] || (byDestination[dk] = { net: 0, count: 0 });
      d.net += e.net; d.count++;
    }
    return { range, revenue, excluded, bySource, byDestination };
  }

  // Net revenue per month (oldest first) for the `count` months ending with `endMonth` (YYYY-MM).
  function monthly(entries, endMonth, count) {
    const months = [];
    for (let i = count - 1; i >= 0; i--) months.push(shiftMonth(endMonth, -i));
    const rows = months.map((m) => ({ month: m, net: 0, bySource: {} }));
    const idx = Object.fromEntries(months.map((m, i) => [m, i]));
    for (const e of entries) {
      if (e.kind !== 'revenue') continue;
      const i = idx[monthKey(e.date)];
      if (i === undefined) continue;
      rows[i].net += e.net;
      rows[i].bySource[e.source] = (rows[i].bySource[e.source] || 0) + e.net;
    }
    return rows;
  }

  // Payout periods (X pays for a set window). Newest first, each with per-day average and change vs the one before.
  function payoutPeriods(entries, sourceIds) {
    const ids = sourceIds || SOURCES.filter((s) => s.payout).map((s) => s.id);
    const groups = {};
    for (const e of entries) {
      if (e.kind !== 'revenue' || !ids.includes(e.source) || !e.periodStart || !e.periodEnd) continue;
      const k = `${e.source}|${e.periodStart}|${e.periodEnd}`;
      const g = groups[k] || (groups[k] = { source: e.source, periodStart: e.periodStart, periodEnd: e.periodEnd, paidOn: e.date, net: 0, gross: 0 });
      g.net += e.net; g.gross += e.gross || 0;
      if (e.date > g.paidOn) g.paidOn = e.date;
    }
    const list = Object.values(groups).sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    const lastBySource = {};
    for (const p of list) {
      p.days = daysBetween(p.periodStart, p.periodEnd);
      p.perDay = Math.round(p.net / p.days);
      const prev = lastBySource[p.source];
      p.change = prev ? p.net - prev.net : null;
      p.changePct = prev && prev.net ? (p.net - prev.net) / Math.abs(prev.net) : null;
      lastBySource[p.source] = p;
    }
    return list.reverse();
  }

  function pctChange(now, before) {
    if (!before) return null;
    return (now - before) / Math.abs(before);
  }

  // ── CSV ─────────────────────────────────────────────────────────────────
  function parseCSV(text) {
    let s = String(text || '');
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    const firstLine = s.split(/\r?\n/, 1)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let q = false;
    for (const ch of firstLine) { if (ch === '"') q = !q; else if (!q && ch in counts) counts[ch]++; }
    const sep = counts['\t'] > counts[','] && counts['\t'] >= counts[';'] ? '\t' : counts[';'] > counts[','] ? ';' : ',';
    const rows = [];
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQ) {
        if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  const RX = {
    date: /date|time|created|paid on|received on|^when$/i,
    gross: /gross|amount|total|received|earnings|revenue|price|payment|subtotal/i,
    net: /\bnet\b|payout amount|you (?:received|earned)/i,
    fee: /fee/i,
    ref: /transaction ?id|order ?(?:id|number|#|no)|payout ?id|reference|^id$|^#$/i,
    type: /type|description|category|event/i,
    status: /status|state/i,
    periodStart: /period start|start date|from date|period from/i,
    periodEnd: /period end|end date|to date|period to/i,
    sponsor: /sponsor|company|client|customer company/i,
  };
  const NOT_GROSS = /fee|tax|tip|balance|beginning|ending|refunded|count|quantity|qty|rate|currency/i;

  // The header is the first row that names a date column and an amount column (statements often start
  // with a few title lines).
  function findHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const r = rows[i];
      const filled = r.filter((c) => c.trim()).length;
      if (filled < 2) continue;
      if (r.some((c) => RX.date.test(c)) && r.some((c) => RX.gross.test(c) || RX.net.test(c))) return i;
    }
    return 0;
  }

  function guessMapping(headers) {
    const find = (rx, not) => headers.findIndex((h) => rx.test(h) && !(not && not.test(h)));
    const m = {
      date: find(RX.date, /period|start|end|update/i),
      net: find(RX.net, /fee/i),
      fee: find(RX.fee),
      ref: find(RX.ref),
      type: find(RX.type, /date|currency/i),
      status: find(RX.status),
      periodStart: find(RX.periodStart),
      periodEnd: find(RX.periodEnd),
      sponsor: find(RX.sponsor),
    };
    m.gross = headers.findIndex((h, i) => i !== m.net && RX.gross.test(h) && !NOT_GROSS.test(h) && !RX.net.test(h));
    if (m.date < 0) m.date = find(RX.date);
    return m;
  }

  // Decide what a row is. Anything not finished (pending, failed…) is skipped.
  function classify(amountCents, typeText, statusText) {
    const t = (typeText || '').toLowerCase();
    const st = (statusText || '').toLowerCase();
    if (st && /pending|fail|declin|cancel|void|reject|issued|hold/.test(st)) return { skip: true, reason: `Status "${statusText}"` };
    if (/refund|chargeback|reversal/.test(t)) return { kind: 'revenue' };
    if (/transfer|withdraw|cash ?out|to bank|instant|deposit to/.test(t)) return { kind: 'transfer' };
    if (/\btax\b|1099|withholding/.test(t)) return { kind: 'tax' };
    if (amountCents < 0) return { kind: 'expense' };
    return { kind: 'revenue' };
  }

  function cell(row, i) { return i >= 0 && i < row.length ? String(row[i]).trim() : ''; }

  // Turn CSV rows into proposed entries. Names and messages are never read (P08 decision: drop payer
  // names); only the sponsor column is kept, and only for sponsorships.
  function rowsToEntries(rows, headerIndex, mapping, opts) {
    const o = opts || {};
    const out = [];
    const seen = {};
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 1;
      const date = parseDate(cell(r, mapping.date));
      const grossRaw = parseAmount(cell(r, mapping.gross));
      const netRaw = parseAmount(cell(r, mapping.net));
      const feeRaw = parseAmount(cell(r, mapping.fee));
      const amount = netRaw !== null ? netRaw : grossRaw;
      const issues = [];
      if (!date) issues.push('no date');
      if (amount === null) issues.push('no amount');
      if (issues.length) { out.push({ line, include: false, reason: issues.join(', '), raw: r }); continue; }
      const cls = classify(amount, cell(r, mapping.type), cell(r, mapping.status));
      if (cls.skip) { out.push({ line, include: false, reason: cls.reason, raw: r }); continue; }
      if (amount === 0 && (grossRaw || 0) === 0) { out.push({ line, include: false, reason: 'zero amount', raw: r }); continue; }
      const ref = cell(r, mapping.ref).slice(0, 80);
      const e = normalizeEntry({
        date,
        periodStart: parseDate(cell(r, mapping.periodStart)) || '',
        periodEnd: parseDate(cell(r, mapping.periodEnd)) || '',
        source: o.source || 'other',
        kind: cls.kind,
        gross: grossRaw,
        fee: feeRaw === null ? 0 : Math.abs(feeRaw),
        net: netRaw,
        destination: o.destination || '',
        counterparty: o.source === 'sponsorship' ? cell(r, mapping.sponsor).slice(0, 80) : '',
        ref,
      });
      let base = ref ? `${e.source}|ref|${ref}` : `${e.source}|${e.date}|${e.gross}|${e.fee}|${e.net}`;
      seen[base] = (seen[base] || 0) + 1;
      if (!ref) base += `|${seen[base]}`;
      e.fingerprint = base;
      const errs = validateEntry(e);
      out.push({ line, include: errs.length === 0, reason: errs.join(' '), entry: e, raw: r });
    }
    return out;
  }

  // Mark proposed rows that are already saved (same fingerprint) so an import can be run twice safely.
  function markDuplicates(proposed, existing) {
    const have = new Set(existing.map((e) => e.fingerprint).filter(Boolean));
    for (const p of proposed) {
      if (p.entry && have.has(p.entry.fingerprint)) { p.include = false; p.duplicate = true; p.reason = 'Already saved'; }
    }
    return proposed;
  }

  // CSV out. Text that starts with = + - @ is prefixed with ' so a spreadsheet won't run it as a formula.
  function csvCell(v) {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const EXPORT_COLUMNS = ['date', 'source', 'kind', 'gross', 'fee', 'net', 'period_start', 'period_end', 'paid_to', 'sponsor', 'reference', 'note', 'id'];
  function toCSV(entries) {
    const lines = [EXPORT_COLUMNS.join(',')];
    const money = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));
    for (const e of entries) {
      lines.push([e.date, e.source, e.kind, money(e.gross), money(e.fee), money(e.net), e.periodStart, e.periodEnd,
        e.destination, e.counterparty, e.ref, e.note, e.id].map((v, i) => (i >= 3 && i <= 5 ? v : csvCell(v))).join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }
  // Our own export reads straight back in (round trip), so a CSV can also move data between devices.
  function isOwnExport(headers) {
    return EXPORT_COLUMNS.every((c, i) => (headers[i] || '').trim().toLowerCase() === c);
  }
  function fromOwnCSV(rows) {
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i].map((c) => String(c).replace(/^'(?=[=+\-@])/, ''));
      const e = normalizeEntry({
        date: r[0], source: r[1], kind: r[2], gross: parseAmount(r[3]), fee: parseAmount(r[4]) || 0, net: parseAmount(r[5]),
        periodStart: r[6], periodEnd: r[7], destination: r[8], counterparty: r[9], ref: r[10], note: r[11], id: r[12],
      });
      e.fingerprint = e.ref ? `${e.source}|ref|${e.ref}` : `${e.source}|${e.date}|${e.gross}|${e.fee}|${e.net}|id:${e.id}`;
      const errs = validateEntry(e);
      out.push({ line: i + 1, include: errs.length === 0, reason: errs.join(' '), entry: e, raw: r });
    }
    return out;
  }

  return {
    SOURCES, SOURCE_IDS, KINDS, KIND_IDS, sourceLabel,
    parseAmount, formatMoney, parseDate, todayPacific, addDays, daysBetween, monthKey, monthEnd, shiftMonth,
    rangeFor, previousRange, normalizeEntry, validateEntry, summarize, monthly, payoutPeriods, pctChange,
    parseCSV, findHeaderRow, guessMapping, classify, rowsToEntries, markDuplicates, toCSV, csvCell,
    isOwnExport, fromOwnCSV, EXPORT_COLUMNS,
  };
});
