/* OC Scanner — Race-call graphic and X post generator (IntelHQ desk only)
 *
 * EBCallGraphic.open(info)        preview window: 1080×1350 graphic + post draft
 * EBCallGraphic.openManual(opts)  same window with blank details, for when the board or its API is unavailable
 * EBCallGraphic.post(info, n)     just the post text (n = wording variant 0, 1, 2)
 *
 * info: { raceId, kind: 'candidate' | 'measure', title, subtitle, names: [{ name, party }], measure: 'passes' | 'fails',
 *         source, sim, link, raceLong, pct, tag }
 *
 * The graphic is drawn from an SVG template (no libraries, no network) and exported to PNG in the browser.
 * The post comes from fixed templates; nothing here picks a winner or posts anywhere. The winner, the source
 * and the race all come from a call the desk already published (or are typed in by hand).
 */
(function () {
  'use strict';
  const W = 1080, H = 1350;
  const SHIELD = 'data:image/png;base64,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';
  // System fonts only: an SVG drawn as an image can't use the page's web fonts, so measuring with one would misfit
  const FONT = '"Avenir Next Condensed","Arial Narrow","Roboto Condensed","Helvetica Neue",Arial,sans-serif';
  const FONT_ATTR = FONT.replace(/"/g, "'");
  const RED = '#D91E2E', RED_HI = '#F0394A', RED_DK = '#8E0F1C', INK = '#040B1C', PALE = '#D6E0F5';
  const PARTY = { D: '#5BA2FF', R: '#FF6168', I: '#C9B5FF' };
  const SOURCES = ['AP', 'Decision Desk HQ', 'NBC News', 'CNN', 'Fox News', 'NYT', 'ABC News', 'CBS News', 'State official', 'OC Scanner desk'];

  const xe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const up = s => String(s ?? '').toUpperCase();

  /* ── measuring: the same font stack the SVG uses, so what fits here fits there ── */
  let cx = null;
  function tw(text, size, weight, italic) {
    if (!cx) cx = document.createElement('canvas').getContext('2d');
    cx.font = `${italic === false ? '' : 'italic '}${weight || 800} 100px ${FONT}`;
    return cx.measureText(text).width * size / 100;
  }
  // Width of a line at `size` including letter-spacing (ls is a fraction of the font size)
  const lineW = (text, size, ls, weight) => tw(text, size, weight) + size * (ls || 0) * Math.max(0, [...text].length - 1);
  const SAFE = 0.94;

  // Largest size (≤ max) at which the text fits maxW
  function fitSize(text, maxW, max, ls, weight) {
    const w100 = lineW(text, 100, ls, weight);
    return Math.min(max, (maxW * SAFE) / (w100 / 100));
  }
  // Every way to cut words into k consecutive lines, keeping the one whose longest line is shortest
  function bestSplit(words, k, ls) {
    let best = null;
    (function rec(i, left, acc) {
      if (left === 1) {
        const lines = [...acc, words.slice(i).join(' ')];
        const m = Math.max(...lines.map(l => lineW(l, 100, ls)));
        if (!best || m < best.m) best = { lines, m };
        return;
      }
      for (let j = i + 1; j <= words.length - (left - 1); j++) rec(j, left - 1, [...acc, words.slice(i, j).join(' ')]);
    })(0, k, []);
    return best;
  }
  // One line if it can stay at a readable size; otherwise the 2- or 3-line split that comes out largest.
  // maxH caps the size so the lines always fit their zone vertically. Nothing is ever clipped.
  function layout(text, maxW, maxH, max, minOne, ls, extraW) {
    const t = String(text || '').trim().replace(/\s+/g, ' ');
    const words = t.split(' ').filter(Boolean);
    const one = Math.min(max, maxH, fitSize(t, maxW - (extraW || 0), max, ls));
    // a " · " that lands at the end of a wrapped line would dangle: drop it
    const tidy = ls => ls.map(l => l.replace(/\s*[·•]\s*$/, '').replace(/^\s*[·•]\s*/, ''));
    if (one >= minOne || words.length < 2) return { lines: [t], size: Math.max(18, one) };
    let best = { lines: [t], size: one };
    for (let k = 2; k <= Math.min(3, words.length); k++) {
      const sp = bestSplit(words, k, ls);
      // the party letter (extraW) rides on the last line, so only that line gives up room for it
      const size = Math.min(max, maxH / k, ...sp.lines.map((l, i) => (maxW * SAFE - (i === k - 1 ? (extraW || 0) : 0)) / (lineW(l, 100, ls) / 100)));
      if (size > best.size * 1.04) best = { lines: sp.lines, size };
    }
    return { lines: tidy(best.lines), size: Math.max(18, best.size) };
  }

  /* ── pieces of the template ── */
  const wave = x => 15 * Math.sin(x / 150 + 0.7) + 7 * Math.sin(x / 68 + 1.9);
  function flag(y0, y1) {
    const n = 7, h = (y1 - y0) / n;
    const top = (k, x) => y0 + k * h + wave(x) * (0.55 + k * 0.08);
    let s = '';
    for (let k = 0; k < n; k++) {
      let d = '';
      for (let x = 0; x <= W; x += 24) d += `${x ? 'L' : 'M'}${x},${top(k, x).toFixed(1)}`;
      for (let x = W; x >= 0; x -= 24) d += `L${x},${top(k + 1, x).toFixed(1)}`;
      s += `<path d="${d}Z" fill="${k % 2 ? '#DDE4F2' : '#B01C2B'}" fill-opacity="${k % 2 ? 0.26 : 0.55}"/>`;
    }
    // blue canton with stars
    const cw = 470;
    let d = '';
    for (let x = 0; x <= cw; x += 24) d += `${x ? 'L' : 'M'}${x},${top(0, x).toFixed(1)}`;
    for (let x = cw; x >= 0; x -= 24) d += `L${x},${top(4, x).toFixed(1)}`;
    s += `<path d="${d}Z" fill="#12306B" fill-opacity="0.9"/>`;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) {
      const x = 40 + i * 88 + (j % 2) * 44, y = top(0, x) + 30 + j * 33 * 1.05;
      if (x > cw - 24) continue;
      let p = '';
      for (let q = 0; q < 10; q++) { const r = q % 2 ? 6 : 14, a = -Math.PI / 2 + q * Math.PI / 5; p += `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)} `; }
      s += `<polygon points="${p}" fill="#E4EAF6" fill-opacity="0.6"/>`;
    }
    return s;
  }
  const dash = (x, y, w) => `<rect x="${x}" y="${y}" width="${w}" height="6" fill="${RED}"/>`;

  function nameBlock(info, box) {
    const { x0, x1, y0, y1 } = box;
    const cx0 = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (info.kind === 'measure') {
      const word = info.measure === 'passes' ? 'PASSES' : info.measure === 'fails' ? 'FAILS' : '';
      const size = fitSize(word || '—', x1 - x0, 150, 0.02);
      const col = info.measure === 'passes' ? '#4BE08C' : info.measure === 'fails' ? '#FF6168' : '#FFFFFF';
      return `<text x="${cx0}" y="${cy + size * 0.36}" text-anchor="middle" font-size="${size.toFixed(1)}" font-weight="800" font-style="italic" letter-spacing="${(size * 0.02).toFixed(1)}" fill="${col}">${xe(word || '—')}</text>`;
    }
    const names = (info.names || []).filter(n => n && n.name);
    if (!names.length) return `<text x="${cx0}" y="${cy + 24}" text-anchor="middle" font-size="72" font-weight="800" font-style="italic" fill="#FFFFFF">CANDIDATE NAME</text>`;
    const maxW = x1 - x0;
    if (names.length === 1) {
      const n = names[0], nm = up(n.name), pc = PARTY[n.party] ? `(${n.party})` : '';
      // party letter rides at the end of the last line: reserve its width when sizing
      const probe = layout(nm, maxW, y1 - y0, 118, 74, 0.0, pc ? 170 : 0);
      const size = probe.size, lines = probe.lines;
      const lh = size * 0.98, top = cy - (lines.length * lh) / 2 + lh * 0.78;
      const psz = Math.min(size * 0.62, 84);
      return lines.map((l, i) => {
        const last = i === lines.length - 1;
        const party = last && pc ? `<tspan font-size="${psz.toFixed(1)}" fill="${PARTY[n.party]}" dx="${(size * 0.22).toFixed(1)}">${pc}</tspan>` : '';
        return `<text x="${cx0}" y="${(top + i * lh).toFixed(1)}" text-anchor="middle" font-size="${size.toFixed(1)}" font-weight="800" font-style="italic" fill="#FFFFFF">${xe(l)}${party}</text>`;
      }).join('');
    }
    // several winners (vote-for-2/3/4 races): one per line, all the same size
    const parts = names.map(n => ({ t: up(n.name), p: PARTY[n.party] ? ` (${n.party})` : '', c: PARTY[n.party] }));
    const hAvail = y1 - y0;
    let size = Math.min(84, hAvail / (parts.length * 1.12));
    parts.forEach(p => { size = Math.min(size, fitSize(p.t + p.p, maxW, size, 0)); });
    const lh = size * 1.1, top = cy - (parts.length * lh) / 2 + lh * 0.8;
    return parts.map((p, i) => `<text x="${cx0}" y="${(top + i * lh).toFixed(1)}" text-anchor="middle" font-size="${size.toFixed(1)}" font-weight="800" font-style="italic" fill="#FFFFFF">${xe(p.t)}${p.p ? `<tspan fill="${p.c}">${xe(p.p)}</tspan>` : ''}</text>`).join('');
  }

  /* ── the graphic ── */
  function svg(info) {
    info = info || {};
    const multi = (info.names || []).filter(n => n && n.name).length > 1;
    const label = info.kind === 'measure' ? 'PROJECTED RESULT' : multi ? 'PROJECTED WINNERS' : 'PROJECTED WINNER';

    // headline and subtitle (race / office), centered in their zone between the banner and the name box
    const tl = layout(up(info.title || 'RACE / OFFICE TITLE'), 780, 112, 78, 50, 0.1);
    const sb = info.subtitle ? layout(up(info.subtitle), 880, 70, 42, 30, 0.12) : null;
    const tH = tl.lines.length * tl.size * 1.02, sH = sb ? sb.lines.length * sb.size * 1.1 : 0, gap = sb ? 14 : 0;
    const zy = 520 + Math.max(0, (196 - (tH + gap + sH)) / 2);
    const titleSvg = tl.lines.map((l, i) => `<text x="540" y="${(zy + tl.size * 0.82 + i * tl.size * 1.02).toFixed(1)}" text-anchor="middle" font-size="${tl.size.toFixed(1)}" font-weight="800" font-style="italic" letter-spacing="${(tl.size * 0.1).toFixed(1)}" fill="#FFFFFF">${xe(l)}</text>`).join('');
    const subSvg = sb ? sb.lines.map((l, i) => `<text x="540" y="${(zy + tH + gap + sb.size * 0.82 + i * sb.size * 1.1).toFixed(1)}" text-anchor="middle" font-size="${sb.size.toFixed(1)}" font-weight="600" font-style="italic" letter-spacing="${(sb.size * 0.12).toFixed(1)}" fill="${PALE}">${xe(l)}</text>`).join('') : '';
    // red dashes beside a one-line headline
    const tHalf = lineW(tl.lines[0], tl.size, 0.1) / 2 + 36;
    const dashY = zy + tl.size * 0.52;
    const dashes = tl.lines.length === 1 && tHalf < 440 ? dash(540 - tHalf - 80, dashY, 80) + dash(540 + tHalf, dashY, 80) : '';

    const lblW = lineW(label, 42, 0.3);

    // header
    const wm = fitSize('OC_SCANNER', 600, 132, 0.0);
    const elw = lineW('ELECTION 2026', 46, 0.3);

    // footer: the site name sets the divider; the source line gets the room to its left
    const rSize = Math.min(50, fitSize('OCScanner.media', 420, 50, 0, 800));
    const rW = lineW('OCScanner.media', rSize, 0, 800), divX = 1030 - rW - 34;
    const srcName = info.source || 'Race-call source';
    const sSize = Math.min(44, fitSize(`Source: ${srcName}`, divX - 34 - 50, 44, 0, 700));
    const rehearsal = info.sim
      ? `<g transform="rotate(-24 540 760)" opacity="0.2"><text x="540" y="760" text-anchor="middle" font-size="150" font-weight="800" font-style="italic" fill="#FFFFFF">REHEARSAL</text></g><rect width="${W}" height="46" fill="#FFB700"/><text x="540" y="33" text-anchor="middle" font-size="30" font-weight="800" letter-spacing="3" fill="#1A1200">REHEARSAL · NOT REAL RESULTS</text>` : '';
    const disc = 'UNOFFICIAL RESULTS · NOT YET CERTIFIED';
    const dW = lineW(disc, 31, 0.08) + 64;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_ATTR}">
<title>OC Scanner race call: ${xe(info.title || '')}</title>
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0C2048"/><stop offset="1" stop-color="#050D22"/></linearGradient>
<linearGradient id="ban" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${RED_HI}"/><stop offset="0.5" stop-color="${RED}"/><stop offset="1" stop-color="${RED_DK}"/></linearGradient>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07142E" stop-opacity="1"/><stop offset="1" stop-color="#07142E" stop-opacity="0"/></linearGradient>
<linearGradient id="fade2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050D22" stop-opacity="0"/><stop offset="1" stop-color="#050D22" stop-opacity="0.9"/></linearGradient>
<filter id="glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<g stroke="#FFFFFF" stroke-opacity="0.035" stroke-width="3">${Array.from({ length: 14 }, (_, i) => `<line x1="${-300 + i * 120}" y1="0" x2="${200 + i * 120}" y2="${H}"/>`).join('')}</g>
${flag(980, 1262)}
<rect x="0" y="960" width="${W}" height="110" fill="url(#fade)"/>
<rect x="0" y="1150" width="${W}" height="112" fill="url(#fade2)"/>
<g stroke="${RED}" stroke-linecap="round"><line x1="170" y1="0" x2="0" y2="330" stroke-width="9"/><line x1="214" y1="0" x2="34" y2="350" stroke-width="3" stroke-opacity="0.7"/>
<line x1="1066" y1="990" x2="990" y2="1246" stroke-width="9"/><line x1="1080" y1="1030" x2="1020" y2="1236" stroke-width="3" stroke-opacity="0.7"/></g>

<image href="${SHIELD}" x="118" y="52" width="164" height="172"/>
<text x="318" y="168" font-size="${wm.toFixed(1)}" font-weight="800" font-style="italic" fill="#FFFFFF">OC_SCANNER</text>
${dash(318, 217, 76)}${dash(318 + 600 - 76, 217, 76)}
<text x="618" y="236" text-anchor="middle" font-size="46" font-weight="700" font-style="italic" letter-spacing="${(46 * 0.3).toFixed(1)}" fill="${PALE}" ${elw > 400 ? 'textLength="400" lengthAdjust="spacingAndGlyphs"' : ''}>ELECTION 2026</text>

<polygon points="86,300 1068,300 1000,500 18,500" fill="${RED}" fill-opacity="0.75" filter="url(#glow)"/>
<polygon points="86,300 1068,300 1000,500 18,500" fill="url(#ban)" stroke="${RED_HI}" stroke-width="3"/>
<line x1="98" y1="306" x2="1056" y2="306" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="2"/>
<polyline points="124,408 176,458 268,342" fill="none" stroke="#FFFFFF" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
<text x="660" y="${(400 + fitSize('RACE CALLED', 700, 150, 0.01) * 0.36).toFixed(1)}" text-anchor="middle" font-size="${fitSize('RACE CALLED', 700, 150, 0.01).toFixed(1)}" font-weight="800" font-style="italic" letter-spacing="${(fitSize('RACE CALLED', 700, 150, 0.01) * 0.01).toFixed(1)}" fill="#FFFFFF">RACE CALLED</text>

${dashes}${titleSvg}${subSvg}

<polygon points="98,728 1064,728 994,1000 26,1000" fill="${RED}" fill-opacity="0.6" filter="url(#glow)"/>
<polygon points="98,728 1064,728 994,1000 26,1000" fill="${INK}" stroke="${RED}" stroke-width="5"/>
${nameBlock(info, { x0: 130, x1: 940, y0: 746, y1: 930 })}
${dash(546 - lblW / 2 - 80, 960, 60)}<text x="546" y="976" text-anchor="middle" font-size="42" font-weight="700" font-style="italic" letter-spacing="${(42 * 0.3).toFixed(1)}" fill="#FFFFFF">${label}</text>${dash(546 + lblW / 2 + 20, 960, 60)}

<g><rect x="${(540 - dW / 2).toFixed(1)}" y="1192" width="${dW.toFixed(1)}" height="54" fill="#040B1C" fill-opacity="0.82" stroke="#FFFFFF" stroke-opacity="0.28"/>
<text x="540" y="1230" text-anchor="middle" font-size="31" font-weight="700" letter-spacing="${(31 * 0.08).toFixed(1)}" fill="#FFFFFF">${disc}</text></g>

<rect x="0" y="1262" width="${W}" height="88" fill="#040A1A"/>
<rect x="0" y="1260" width="${W}" height="5" fill="${RED}"/>
<text x="50" y="${(1296 + sSize * 0.3).toFixed(1)}" font-size="${sSize.toFixed(1)}" font-style="italic"><tspan font-weight="500" fill="#B9C6E0">Source: </tspan><tspan font-weight="800" fill="#FFFFFF">${xe(srcName)}</tspan></text>
<rect x="${divX.toFixed(1)}" y="1282" width="4" height="48" fill="${RED}"/>
<text x="1030" y="${(1296 + rSize * 0.4).toFixed(1)}" text-anchor="end" font-size="${rSize.toFixed(1)}" font-weight="800" fill="#FFFFFF">OCScanner.media</text>
${rehearsal}
</svg>`;
  }

  /* ── X post: fixed templates, never AI ── */
  function xLen(t) {
    let n = 0;
    for (const ch of String(t).replace(/https?:\/\/\S+/g, 'x'.repeat(23))) n += ch === '️' ? 0 : /\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
    return n;
  }
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  function post(info, variant) {
    info = info || {};
    const v = ((variant || 0) % 3 + 3) % 3;
    const pre = info.sim ? '[REHEARSAL, NOT REAL RESULTS] ' : '';
    const names = (info.names || []).filter(n => n && n.name).map(n => `${n.name}${n.party in PARTY ? ` (${n.party})` : ''}`);
    const who = names.length < 2 ? names[0] || 'The candidate' : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    const where = info.raceLong || info.title || 'this race';
    const mTitle = info.raceLong || info.title || 'This measure';
    const mWord = info.measure === 'passes' ? ['PASSES', 'pass'] : info.measure === 'fails' ? ['FAILS', 'fail'] : ['', ''];
    const lead = info.kind === 'measure'
      ? [`🗳️ PROJECTED: ${mTitle} ${mWord[0]}.`, `RACE CALL: ${mTitle} is projected to ${mWord[1]}.`, `📢 ${mTitle} projected to ${mWord[1]}.`][v]
      : [`🗳️ PROJECTED WINNER: ${who} in ${where}.`, `RACE CALL: ${who} ${names.length > 1 ? 'are' : 'is'} projected to win ${where}.`, `📢 ${who} projected to win ${where}.`][v];
    const src = info.source ? `Called by ${info.source}.` : '';
    const dis = 'Unofficial results, not certified.';
    const prog = info.pct && v !== 1 ? `${cap(info.pct)}.` : '';
    const link = info.link ? `Live results: ${info.link}` : '';
    const tag = info.tag || '#Election2026';
    const tries = [
      [lead, [src, dis, prog].filter(Boolean).join(' '), link, tag],
      [lead, [src, dis].filter(Boolean).join(' '), link, tag],
      [lead, [src, dis].filter(Boolean).join(' '), link],
      [lead, [src, 'Unofficial.'].filter(Boolean).join(' '), link],
      [lead, src, link],
      [lead],
    ];
    for (const t of tries) {
      const text = pre + t.filter(Boolean).join('\n');
      if (xLen(text) <= 280) return text;
    }
    return (pre + lead).slice(0, 277) + '…';
  }

  /* ── PNG export ── */
  async function png(info) {
    const url = URL.createObjectURL(new Blob([svg(info)], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error('The graphic couldn’t be drawn')); img.src = url; });
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      c.getContext('2d').drawImage(img, 0, 0, W, H);
      return await new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('PNG export failed')), 'image/png'));
    } finally { URL.revokeObjectURL(url); }
  }
  const slug = s => String(s || 'race').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'race';

  /* ── preview window ── */
  const CSS = `
.cg-back{position:fixed;inset:0;z-index:10060;background:rgba(3,8,18,.78);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:16px;font-family:'Barlow Condensed','Avenir Next Condensed',sans-serif}
.cg-win{background:#0b1117;color:#eef4f8;border:1px solid rgba(0,180,255,.25);border-radius:12px;width:100%;max-width:980px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.cg-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.1);font-size:1.15rem}
.cg-head b{font-weight:700;letter-spacing:.03em}
.cg-tag{background:#ffb700;color:#1a1200;border-radius:5px;padding:1px 8px;font-size:.85rem;font-weight:700}
.cg-x{margin-left:auto;background:none;border:1px solid rgba(255,255,255,.25);color:inherit;border-radius:7px;width:36px;height:36px;font-size:1.4rem;line-height:1;cursor:pointer}
.cg-body{display:grid;grid-template-columns:minmax(0,380px) minmax(0,1fr);gap:18px;padding:16px}
.cg-pic img{display:block;width:100%;height:auto;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:#07142e}
.cg-side{display:flex;flex-direction:column;gap:10px;min-width:0}
.cg-note{font-size:.95rem;color:#b8d0dc;background:#0f1820;border-left:3px solid #D91E2E;padding:8px 10px;border-radius:0 6px 6px 0}
.cg-side label{font-size:.9rem;color:#7a9aaa;display:block;margin-bottom:3px}
.cg-post{width:100%;min-height:170px;resize:vertical;background:#0f1820;color:#eef4f8;border:1px solid rgba(0,180,255,.25);border-radius:8px;padding:10px;font:inherit;font-size:1.05rem;line-height:1.35}
.cg-count{font-size:.9rem;color:#7a9aaa;text-align:right}.cg-count.over{color:#ff5a5f;font-weight:700}
.cg-row{display:flex;flex-wrap:wrap;gap:8px}
.cg-btn{flex:1 1 140px;min-height:44px;background:#0f1820;color:#eef4f8;border:1px solid rgba(0,180,255,.3);border-radius:8px;padding:8px 12px;font:inherit;font-weight:700;font-size:1rem;cursor:pointer}
.cg-btn.main{background:#D91E2E;border-color:#D91E2E;color:#fff}
.cg-btn:hover{filter:brightness(1.15)}
.cg-msg{min-height:1.3em;font-size:.95rem;color:#7fe3a8}.cg-msg.err{color:#ff7a7f}
.cg-edit{border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px}
.cg-edit summary{cursor:pointer;font-weight:700}
.cg-post,.cg-edit input,.cg-edit select,.cg-edit textarea{box-sizing:border-box;max-width:100%}.cg-body>*{min-width:0}
.cg-edit input,.cg-edit select,.cg-edit textarea{width:100%;background:#0f1820;color:#eef4f8;border:1px solid rgba(0,180,255,.25);border-radius:6px;padding:7px 9px;font:inherit;font-size:1rem;margin-bottom:8px}
@media (max-width:780px){.cg-back{padding:0}.cg-win{border-radius:0;min-height:100%}.cg-body{grid-template-columns:1fr}.cg-pic{max-width:420px;margin:0 auto;width:100%}}
`;
  function injectCss() {
    if (document.getElementById('cg-css')) return;
    const s = document.createElement('style'); s.id = 'cg-css'; s.textContent = CSS; document.head.appendChild(s);
  }
  const PARTY_RE = /^(.*?)\s*\(([DRI])\)\s*$/;
  const namesToText = names => (names || []).map(n => `${n.name}${n.party in PARTY ? ` (${n.party})` : ''}`).join('\n');
  const textToNames = t => String(t || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(PARTY_RE); return m ? { name: m[1], party: m[2] } : { name: l, party: '' }; });

  function open(input, opts) {
    injectCss();
    const o = opts || {};
    const info = Object.assign({ kind: 'candidate', names: [], source: '', sim: false, tag: '#Election2026' }, input || {});
    info.names = (info.names || []).map(n => ({ ...n }));
    let variant = 0, dirty = false, url = '', pngP = null, timer = null;
    const prev = document.activeElement;

    const back = document.createElement('div');
    back.className = 'cg-back';
    back.innerHTML = `<div class="cg-win" role="dialog" aria-modal="true" aria-label="Race-call graphic">
      <div class="cg-head"><b>Race-call graphic</b>${info.sim ? '<span class="cg-tag">REHEARSAL</span>' : ''}<button type="button" class="cg-x" data-cg="close" aria-label="Close">×</button></div>
      <div class="cg-body">
        <div class="cg-pic"><img alt="Preview of the race-call graphic" width="${W}" height="${H}"></div>
        <div class="cg-side">
          <div class="cg-note">Projection only: unofficial and not certified. Nothing is posted for you; copy the graphic and the post and publish them yourself.</div>
          <div><label for="cg-post">X post draft (you can edit it)</label><textarea id="cg-post" class="cg-post" spellcheck="true"></textarea><div class="cg-count" data-cg="count"></div></div>
          <div class="cg-row"><button type="button" class="cg-btn main" data-cg="copypost">Copy X post</button><button type="button" class="cg-btn" data-cg="regen">Regenerate draft</button></div>
          <div class="cg-row"><button type="button" class="cg-btn main" data-cg="download">Download graphic</button><button type="button" class="cg-btn" data-cg="copyimg" hidden>Copy image</button><button type="button" class="cg-btn" data-cg="share" hidden>Share…</button></div>
          <div class="cg-msg" data-cg="msg" role="status" aria-live="polite"></div>
          <details class="cg-edit"${o.edit ? ' open' : ''}><summary>Edit details</summary>
            <label for="cg-kind">Kind</label><select id="cg-kind" data-f="kind"><option value="candidate">Candidate race</option><option value="measure">Ballot measure</option></select>
            <label for="cg-title">Headline (place or race)</label><input id="cg-title" data-f="title" maxlength="80">
            <label for="cg-sub">Second line (office)</label><input id="cg-sub" data-f="subtitle" maxlength="90">
            <div data-cg="cand"><label for="cg-names">Winner(s), one per line. Add (D), (R) or (I) for a party</label><textarea id="cg-names" data-f="names" rows="3"></textarea></div>
            <div data-cg="meas" hidden><label for="cg-meas">Result</label><select id="cg-meas" data-f="measure"><option value="passes">Passes</option><option value="fails">Fails</option></select></div>
            <label for="cg-src">Who made the call (shown on the graphic)</label><input id="cg-src" data-f="source" list="cg-srcs" maxlength="40"><datalist id="cg-srcs">${SOURCES.map(s => `<option value="${xe(s)}">`).join('')}</datalist>
            <label for="cg-where">Name used in the post</label><input id="cg-where" data-f="raceLong" maxlength="90">
          </details>
        </div>
      </div></div>`;
    document.body.appendChild(back);
    const q = k => back.querySelector(`[data-cg="${k}"]`);
    const post$ = back.querySelector('.cg-post'), img = back.querySelector('.cg-pic img');
    const f = k => back.querySelector(`[data-f="${k}"]`);
    const msg = (t, err) => { const m = q('msg'); m.textContent = t || ''; m.classList.toggle('err', !!err); };

    function syncFields() {
      f('kind').value = info.kind; f('title').value = info.title || ''; f('subtitle').value = info.subtitle || '';
      f('names').value = namesToText(info.names); f('measure').value = info.measure || 'passes'; f('source').value = info.source || ''; f('raceLong').value = info.raceLong || '';
      q('cand').hidden = info.kind === 'measure'; q('meas').hidden = info.kind !== 'measure';
    }
    function count() { const n = xLen(post$.value); const c = q('count'); c.textContent = `${n} / 280`; c.classList.toggle('over', n > 280); }
    function draw() {
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(new Blob([svg(info)], { type: 'image/svg+xml;charset=utf-8' }));
      img.src = url; pngP = null;
    }
    function draft() { post$.value = post(info, variant); dirty = false; count(); }
    function blob() { return pngP || (pngP = png(info)); }

    // The graphic and the post start the same moment, so a slow export can't hold up the draft
    draw(); draft(); syncFields();
    const canClip = !!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);
    if (canClip) q('copyimg').hidden = false;
    try { if (navigator.canShare && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })) q('share').hidden = false; } catch {}

    const fname = () => `oc-scanner-race-call-${slug(info.raceId || info.title)}${info.sim ? '-REHEARSAL' : ''}.png`;
    async function act(a) {
      try {
        if (a === 'close') return close();
        if (a === 'regen') { variant++; draft(); return msg('New wording. Edits you made to the old draft were replaced.'); }
        if (a === 'copypost') {
          try { await navigator.clipboard.writeText(post$.value); msg('Post copied.'); }
          catch { post$.focus(); post$.select(); msg('Select the text and copy it (your browser blocked automatic copying).', true); }
          return;
        }
        if (a === 'download') {
          msg('Making the PNG…');
          const b = await blob(), u = URL.createObjectURL(b), l = document.createElement('a');
          l.href = u; l.download = fname(); document.body.appendChild(l); l.click(); l.remove();
          setTimeout(() => URL.revokeObjectURL(u), 4000);
          return msg('Graphic downloaded.');
        }
        if (a === 'copyimg') {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob() })]);
          return msg('Image copied. Paste it into your post.');
        }
        if (a === 'share') {
          const b = await blob();
          await navigator.share({ files: [new File([b], fname(), { type: 'image/png' })], text: post$.value });
          return msg('');
        }
      } catch (e) { if (e && e.name === 'AbortError') return msg(''); msg(`That didn’t work: ${e.message || e}. Try Download graphic.`, true); }
    }
    function close() {
      clearTimeout(timer); if (url) URL.revokeObjectURL(url);
      document.removeEventListener('keydown', onKey, true); back.remove();
      if (prev && prev.focus) try { prev.focus(); } catch {}
    }
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', e => { if (e.target === back) return close(); const b = e.target.closest('[data-cg]'); if (b && b.tagName === 'BUTTON') act(b.dataset.cg); });
    post$.addEventListener('input', () => { dirty = true; count(); });
    // Edited details redraw the graphic; the post follows unless you've been editing it by hand
    back.addEventListener('input', e => {
      const k = e.target.dataset && e.target.dataset.f; if (!k) return;
      const v = e.target.value;
      if (k === 'names') info.names = textToNames(v); else info[k] = v;
      if (k === 'kind') { q('cand').hidden = v === 'measure'; q('meas').hidden = v !== 'measure'; if (v === 'measure' && !info.measure) info.measure = 'passes'; }
      clearTimeout(timer);
      timer = setTimeout(() => { draw(); if (!dirty) draft(); }, 160);
    });
    q('close').focus();
    return { close, info };
  }
  function openManual(opts) {
    return open({ kind: 'candidate', title: '', subtitle: '', names: [], source: '', sim: !!(opts && opts.sim), tag: '#Election2026', link: opts && opts.link, raceLong: '' }, { edit: true });
  }

  window.EBCallGraphic = { open, openManual, post, svg, png, xLen, SOURCES, _layout: layout };
})();
