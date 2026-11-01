/* Paste from page (IntelHQ desk): read vote counts out of a results page you copied in your own browser.
   Open a state's official results page, select all, copy, paste into Quick count → Paste from page. The reader
   finds each of our races' candidates by name, takes the vote count on that line (or just below it, for card
   layouts), and the "% in" near the race's heading when the page shows one ("Election Districts Reporting: 340 of
   679", "Precincts reporting 52%"). You check the numbers before anything is saved; saved counts are desk entries,
   so a working state feed or AP still takes over.
   Works on any page that lists candidate names with their vote totals; checked against New York's results page
   (Oct 31) and the layout of Nevada's results app. Plain script: sets window.EBPaste (and module.exports in tests). */
(function (g) {
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z' -]/g, ' ').replace(/['-]/g, ' ').replace(/\s+/g, ' ').trim();
  const SUFFIX = /^(jr|sr|ii|iii|iv)$/;
  const words = s => fold(s).split(' ').filter(w => w && !SUFFIX.test(w));
  const lastOf = s => { const w = words(s); return w[w.length - 1] || ''; };
  const firstOf = s => words(s).find(w => w.length > 1) || '';
  const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };

  /** Copied HTML → lines of text, one table row per line, cells separated by tabs. */
  function htmlToText(html) {
    return String(html || '')
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(td|th)>/gi, '\t')
      .replace(/<br\s*\/?>|<\/(tr|p|div|li|h[1-6]|table|section|article|header)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[  ]+/g, ' ').replace(/ *\t */g, '\t').replace(/\n\s*\n+/g, '\n');
  }

  /** Which state's page this is: the official sites we know, else the state named most often near the top. */
  function detectState(text) {
    const t = String(text || '');
    if (/Election Districts Reporting|NYS Board of Elections|New York State Unofficial Election Night/i.test(t)) return 'NY';
    if (/Nevada Election Results|silverstateelection|Representative In Congress, District/i.test(t)) return 'NV';
    const head = t.slice(0, 4000);
    let best = null, n = 0;
    for (const [st, name] of Object.entries(STATE_NAMES)) {
      const k = (head.match(new RegExp(`\\b${name}\\b`, 'gi')) || []).length;
      if (k > n || (k === n && k && name.length > (STATE_NAMES[best] || '').length)) { best = st; n = k; }
    }
    return n ? best : null;
  }

  // Whole vote counts on a line: "98,000", "312456"; not percentages ("45.2%", "0.00 %") or decimals
  const counts = line => [...String(line).matchAll(/\d[\d,]*(?:\.\d+)?(\s*%)?/g)]
    .filter(m => !m[1] && !/\./.test(m[0]) && /^\d{1,3}(,\d{3})*$|^\d+$/.test(m[0]))
    .map(m => +m[0].replace(/,/g, ''));
  function pctNear(lines, from) {
    for (let i = from; i >= Math.max(0, from - 8); i--) {
      const l = lines[i];
      let m = l.match(/(\d[\d,]*)\s+of\s+(\d[\d,]*)\s*(?:election districts|precincts|counties|polling|reporting|$)/i)
        || l.match(/(?:reporting|reported)[^\d]{0,30}(\d[\d,]*)\s+of\s+(\d[\d,]*)/i);
      if (m) { const a = +m[1].replace(/,/g, ''), b = +m[2].replace(/,/g, ''); if (b > 0 && a <= b) return Math.round(1000 * a / b) / 10; }
      m = l.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:precincts|expected|estimated|reporting|counted|in\b)/i)
        || l.match(/(?:precincts|reporting|expected vote|counted)[^\d%]{0,25}(\d{1,3}(?:\.\d+)?)\s*%/i);
      if (m && +m[1] <= 100) return +m[1];
    }
    return null;
  }

  /**
   * @param {string} text   the pasted page (htmlToText it first when the paste carried HTML)
   * @param {{id:string, name:string, candidates:{name:string, party:string}[]}[]} races  our races in that state
   * @returns {{id, name, pctIn, status: 'ok'|'partial', missing: string[], candidates: {name, party, votes}[]}[]}
   */
  function read(text, races) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim());
    const folded = lines.map(l => ' ' + fold(l) + ' ');
    const has = (i, w) => w && folded[i].includes(` ${w} `);
    const allLast = new Map();
    for (const r of races) for (const c of r.candidates) { const l = lastOf(c.name); allLast.set(l, (allLast.get(l) || 0) + 1); }
    const out = [];
    for (const r of races) {
      const cands = [], missing = [];
      const lastsHere = r.candidates.map(c => lastOf(c.name));
      for (const c of r.candidates) {
        const last = lastOf(c.name), first = firstOf(c.name);
        if (!last) continue;
        // A line with the last name and the first name (or its initial, "J. Lombardo"); the last name alone only when no
        // other candidate we track shares it and the line names no other first name we know for it
        let i = folded.findIndex((f, k) => has(k, last) && (has(k, first) || new RegExp(` ${first[0]} `).test(f)) && !/^\s*(total|blank|void|write)/i.test(lines[k]));
        if (i < 0 && allLast.get(last) === 1) i = folded.findIndex((f, k) => has(k, last));
        if (i < 0) { missing.push(c.name); continue; }
        let v = counts(lines[i]).pop();
        if (v == null) {
          for (let k = i + 1; k <= Math.min(lines.length - 1, i + 5); k++) {
            if (lastsHere.some(l => l !== last && has(k, l))) break;      // reached the next candidate
            const n = counts(lines[k]);
            if (n.length) { v = n[0]; break; }
          }
        }
        if (v == null) { missing.push(c.name); continue; }
        cands.push({ name: c.name, party: c.party, votes: v, line: i });
      }
      if (!cands.length) continue;
      const major = r.candidates.filter(c => c.party === 'D' || c.party === 'R');
      const need = major.length ? major : r.candidates;
      const ok = need.every(c => cands.some(x => x.name === c.name));
      const firstLine = Math.min(...cands.map(c => c.line));
      const spread = Math.max(...cands.map(c => c.line)) - firstLine;
      out.push({
        id: r.id, name: r.name, pctIn: pctNear(lines, firstLine),
        status: ok && spread < 40 ? 'ok' : 'partial', missing,
        candidates: cands.map(({ line, ...c }) => c),
      });
    }
    return out;
  }

  const api = { htmlToText, detectState, read, STATE_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else g.EBPaste = api;
})(typeof window !== 'undefined' ? window : globalThis);
