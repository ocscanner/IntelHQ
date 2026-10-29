/* OC Scanner — Election results board
 * Usage: ElectionBoard.mount(element, { api, shapesUrl, autoRefresh })
 * Reads /v1/board and /v1/feed from the oc-election-wire Worker. No other libraries needed.
 */
(function () {
  'use strict';
  const DEFAULT_API = 'https://oc-election-wire.ocscannernews.workers.dev';
  const PNAME = { D: 'Dem', R: 'Rep', I: 'Ind', O: 'Other' };
  const PFULL = { D: 'Democrats', R: 'Republicans', I: 'independents', O: 'other parties' };
  const PADJ = { D: 'Democratic', R: 'Republican', I: 'independent', O: 'third-party' };
  const CHAMBERS = [['house', 'House'], ['senate', 'Senate'], ['governor', 'Governors']];
  const TABS = [...CHAMBERS, ['props', 'CA Props'], ['local', 'Orange County'], ['la', 'LA County']];
  const TAB_SHORT = { house: 'House', senate: 'Senate', governor: 'Gov.', props: 'Props', local: 'OC', la: 'LA' };
  // Tabs that list contests instead of drawing the US map: Orange County races and California's propositions
  const AREA_OF = { local: 'OC', props: 'CAP', la: 'LA' };
  const PREFIX = { OC: 'OC-', CAP: 'CA-P', LA: 'LA-' };
  const TAB_OF_AREA = { OC: 'local', CAP: 'props', LA: 'la' };
  const isCounty = ch => ch === 'local' || ch === 'la';
  const isArea = ch => ch in AREA_OF;
  // Louisiana's national races (LA-01, LA-SEN, LA-GOV) share the LA- prefix with LA County races (LA-MAYOR, LA-CD3), so rule them out first
  const LOUISIANA_ID = /^LA-(\d+|AL|SEN(-S)?|GOV)$/;
  // National race ids name their chamber: CA-48 / AK-AL (House), TX-SEN / OH-SEN-S (Senate), CA-GOV (Governor)
  const chamberOfId = id => { const m = String(id || '').match(/^[A-Z]{2}-(\d+|AL|SEN(-S)?|GOV)$/); return !m ? null : m[1] === 'GOV' ? 'governor' : m[1].startsWith('SEN') ? 'senate' : 'house'; };
  const areaOfId = id => { id = String(id || ''); return LOUISIANA_ID.test(id) ? null : Object.keys(PREFIX).find(a => id.startsWith(PREFIX[a])) || null; };
  const GROUP_ORDER = ['county', 'lacity', 'city', 'school', 'district', 'judicial', 'measure', 'legislature', 'prop'];
  // A measure call is a single "Yes" or "No"
  const measureWord = winners => winners?.length === 1 && /^yes$/i.test(winners[0]) ? 'passes' : winners?.length === 1 && /^no$/i.test(winners[0]) ? 'fails' : null;
  // Map colors for candidates who aren't D/R/I, or when the top two share a party (California top-two)
  const CAND_COLORS = ['#8b6fd6', '#d9902f', '#2ba198', '#d0508f', '#6f9a35', '#5f86c4'];
  const SOURCES = ['AP', 'Decision Desk HQ', 'NBC News', 'CNN', 'Fox News', 'NYT', 'ABC News', 'CBS News', 'State official', 'OC Scanner desk'];
  const SMALL = new Set(['VT', 'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD', 'DC', 'HI']);
  const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv)$/i;
  const CLOSE_PTS = 5;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('eb-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('eb-' + k, JSON.stringify(v)); } catch {} },
  };
  // Last name, keeping particles: "Steven Von Der Porten" → "Von Der Porten", "Jenny Rae Le Roux" → "Le Roux"
  const PARTICLE = /^(van|von|der|den|de|del|della|la|le|da|di|du|st\.?)$/i;
  const last = name => {
    const parts = String(name || '').replace(/"[^"]*"/g, ' ').split(/\s+/).filter(p => p && !SUFFIX.test(p));
    if (!parts.length) return name || '';
    let i = parts.length - 1;
    while (i > 1 && PARTICLE.test(parts[i - 1])) i--;
    return parts.slice(i).join(' ');
  };
  const fmtN = n => n == null ? '–' : Number(n).toLocaleString();
  const fmtT = ts => { if (!ts) return ''; const d = new Date(ts); return isNaN(d) ? String(ts) : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const fmtHM = ts => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); };
  const ago = ts => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`; };

  function longRaceName(r) {
    if (r.chamber === 'house') {
      if (!r.district) return `${r.stateName}'s at-large House seat`;
      const ord = r.name.replace(r.stateName + ' ', '');
      return `${r.stateName}'s ${ord} District`;
    }
    return r.chamber === 'senate' ? `the ${r.stateName} Senate${r.special ? ' special election' : ' race'}` : `the ${r.stateName} governor's race`;
  }
  function progress(r) {
    if (r.pctIn == null) return '';
    const label = r.pctLabel || 'expected vote';
    if (label === 'expected vote') return `${r.pctIn}% of the expected vote counted`;
    return label === 'precincts' ? `${r.pctIn}% of precincts reporting` : `${r.pctIn}% of ${label} in`;
  }
  const shortName = r => r.chamber === 'house' ? r.id.replace('-AL', ' at-large').replace(/-0?/, '-') : r.name;

  function mount(root, opts = {}) {
    const qs = new URLSearchParams(location.search);
    const S = {
      api: (qs.get('ebapi') || opts.api || store.get('api', '') || DEFAULT_API).replace(/\/$/, ''),
      shapesUrl: opts.shapesUrl || 'elections/data/us-states.json',
      countiesUrl: opts.countiesUrl || (opts.shapesUrl || 'elections/data/us-states.json').replace(/us-states\.json$/, 'counties'),
      districtsUrl: opts.districtsUrl || (opts.shapesUrl || 'elections/data/us-states.json').replace(/us-states\.json$/, 'districts'),
      pub: !!opts.publicMode,
      sim: opts.publicMode ? false : qs.get('sim') === '1' ? true : store.get('sim', !!opts.sim),
      // A shared race link opens on that race's tab
      chamber: (r => TAB_OF_AREA[areaOfId(r)] || (areaOfId(r) ? null : chamberOfId(r)))(String(qs.get('race') || '').toUpperCase()) || store.get('chamber', 'senate'),
      group: 'all', areas: {}, localById: new Map(),
      zoomSt: null, vb: null, countyData: null, cshapes: new Map(), dshapes: new Map(),
      filter: 'all', sort: 'close', stateFilter: null, q: '', limit: 60,
      selected: qs.get('race') || null,
      watch: new Set(store.get('watch', [])),
      chime: store.get('chime', true),
      token: opts.publicMode ? '' : store.get('token', ''), deskSource: store.get('deskSource', 'OC Scanner desk'),
      data: null, feed: [], seenFeed: null, shapes: null, error: null, lastOk: 0, pending: null,
      sheetOpen: false,
      queue: null, queueSeen: null, qConfirm: null, baseTitle: document.title,
    };

    root.classList.add('eb');
    root.innerHTML = `
      <div class="eb-status" data-r="status"></div>
      <div data-r="banner"></div>
      <div class="eb-strip" data-r="strip"></div>
      <div class="eb-seg eb-chambers" role="tablist" aria-label="Which races to show">
        ${TABS.map(([ch, label]) => `<button type="button" role="tab" data-chamber="${ch}" aria-label="${label}"><b class="tl">${label}</b><b class="ts" aria-hidden="true">${TAB_SHORT[ch]}</b> <span data-r="n-${ch}"></span></button>`).join('')}
      </div>
      <div class="eb-tools">
        <div class="eb-seg" data-r="filters" role="group" aria-label="Show races">
          ${[['all', 'All'], ['close', 'Close'], ['flips', 'Flips'], ['called', 'Called'], ['uncalled', 'Not called'], ['watch', 'Watching']].map(([k, l]) => `<button type="button" data-filter="${k}">${l}</button>`).join('')}
        </div>
        <div class="eb-seg" data-r="sorts" role="group" aria-label="Sort races">
          <button type="button" data-sort="close">Closest first</button><button type="button" data-sort="az">By state</button>
        </div>
        <span data-r="chip"></span>
        <input class="eb-search" type="search" placeholder="Find a race or candidate" aria-label="Find a race or candidate" data-r="search">
      </div>
      <div class="eb-main">
        <div>
          <div class="eb-panel"><div class="eb-map" data-r="map"><div class="eb-empty">Loading map…</div></div><div class="eb-key" data-r="key"></div></div>
          <div class="eb-panel eb-list"><h4><span data-r="listtitle">Races</span><small data-r="listcount"></small></h4><div data-r="list"></div></div>
        </div>
        <div class="eb-side">
          <div class="eb-panel eb-queue" data-r="queue" hidden></div>
          <div class="eb-panel"><h4>Latest calls<small data-r="logcount"></small></h4><div class="eb-log" data-r="log"></div></div>
          <div class="eb-panel eb-detailwrap" data-r="detail"></div>
        </div>
      </div>`;
    const $ = k => root.querySelector(`[data-r="${k}"]`);

    /* ── events ── */
    root.addEventListener('click', e => {
      const t = e.target.closest('button, [data-race], path[data-st], path[data-fips], path[data-dist]');
      if (!t || !root.contains(t)) return;
      if (t.dataset.chamber) {
        S.chamber = t.dataset.chamber; store.set('chamber', S.chamber); S.limit = 60; S.countyData = null;
        // Stay zoomed on the same state when switching between House, Senate and Governors
        S.stateFilter = S.chamber === 'house' ? S.zoomSt : null;
        S.sub = null;
        // A race picked on another tab doesn't stay in the side panel
        if (S.selected && tabOfId(S.selected) !== S.chamber) { S.selected = null; S.sheetOpen = false; }
        if (isArea(S.chamber)) S.group = 'all';
        if (isArea(S.chamber) && !AD()) loadLocal(AREA_OF[S.chamber]);
        renderAll();
        if (S.zoomSt && !isArea(S.chamber)) { const st = S.zoomSt; loadZoomShapes(st).then(() => { if (S.zoomSt === st) { renderMap(); animateTo(targetVB()); } return loadCounties(); }).then(() => renderMap()); }
        return;
      }
      if (t.dataset.qpub) { queuePublish(t.dataset.qpub); return; }
      if (t.dataset.qdis) { queueAct(t.dataset.qdis, 'dismiss', 'Dismissed'); return; }
      if (t.dataset.qbulk) { queueBulk(t.dataset.qbulk); return; }
      if (t.dataset.qopen) { openRace(t.dataset.qopen, t.dataset.qtab); return; }
      if (t.dataset.gotoqueue != null) { $('queue').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (t.dataset.group) { S.group = t.dataset.group; S.limit = 60; renderMap(); renderList(); return; }
      if (t.dataset.back != null) { if (S.sub) zoomOut(); else unzoom(); return; }
      if (t.dataset.fips) { showTip(e, countySummary(t.dataset.fips)); zoomInto(t); return; }
      if (t.dataset.dist) { showTip(e, districtSummary(t.dataset.dist)); zoomInto(t); select(t.dataset.dist, { sheet: false }); return; }
      if (t.dataset.filter) { S.filter = t.dataset.filter; S.limit = 60; renderTools(); renderList(); return; }
      if (t.dataset.sort) { S.sort = t.dataset.sort; renderTools(); renderList(); return; }
      if (t.dataset.clearstate != null) { if (S.zoomSt) unzoom(); else { S.stateFilter = null; renderTools(); renderList(); renderMap(); } return; }
      if (t.dataset.st) { selectState(t.dataset.st); return; }
      if (t.dataset.star) { e.stopPropagation(); toggleWatch(t.dataset.star); return; }
      if (t.dataset.more != null) { S.limit += 100; renderList(); return; }
      if (t.dataset.act) { action(t.dataset.act, t); return; }
      if (t.dataset.race) { select(t.dataset.race); return; }
    });
    $('search').addEventListener('input', e => { S.q = e.target.value.trim().toLowerCase(); S.limit = 60; renderList(); });
    root.addEventListener('change', e => { const k = e.target?.dataset?.apref; if (k) alertsPref(k, e.target.checked); });
    // One tooltip handler for both the US map and the county maps
    $('map').addEventListener('mousemove', e => {
      const box = $('map'), tip = box.querySelector('.eb-tip');
      if (!tip) return;
      const p = e.target.closest('path[data-st], path[data-fips], path[data-dist]');
      if (!p) { tip.hidden = true; return; }
      placeTip(tip, e, p.dataset.st ? stateSummary(p.dataset.st) : p.dataset.dist ? districtSummary(p.dataset.dist) : countySummary(p.dataset.fips));
    });
    // Keep the tooltip inside the map so it isn't cut off at the edges
    function placeTip(tip, e, text) {
      const rect = $('map').getBoundingClientRect();
      tip.hidden = false; tip.textContent = text;
      const half = tip.offsetWidth / 2 + 4;
      const x = Math.min(Math.max(e.clientX - rect.left, half), Math.max(half, rect.width - half));
      tip.style.left = `${x}px`; tip.style.top = `${Math.max(e.clientY - rect.top, tip.offsetHeight + 8)}px`;
    }
    // Phones send a "mouse left" right after a tap; keep a tapped county's numbers showing
    let lastTouch = 0;
    $('map').addEventListener('touchstart', () => { lastTouch = Date.now(); }, { passive: true });
    $('map').addEventListener('mouseleave', () => { if (Date.now() - lastTouch < 1500) return; const tip = $('map').querySelector('.eb-tip'); if (tip) tip.hidden = true; });
    // Taps on phones don't hover, so a tap on a county shows its numbers
    function showTip(e, text) {
      const tip = $('map').querySelector('.eb-tip');
      if (tip) placeTip(tip, e, text);
    }
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape' && S.sheetOpen) { S.sheetOpen = false; renderDetail(); }
      else if (e.key === 'Escape' && S.zoomSt && !isArea(S.chamber)) unzoom();
      const row = e.target.closest?.('.eb-row');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(row.dataset.race); }
    });

    /* ── data ── */
    async function load(fresh) {
      if (S.loading) return; S.loading = true;
      const q = `${S.sim ? 'sim=1' : 'sim=0'}${fresh ? '&fresh=1' : ''}`;
      try {
        const areas = neededAreas();
        const [b, f, ...ls] = await Promise.all([
          fetch(`${S.api}/v1/board?${q}`, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`Results service answered ${r.status}`); return r.json(); }),
          fetch(`${S.api}/v1/feed?${S.sim ? 'sim=1' : 'sim=0'}&limit=60`, { cache: 'no-store' }).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
          ...areas.map(a => fetchLocal(a, fresh)),
        ]);
        S.data = b; S.byId = new Map(b.races.map(r => [r.id, r])); S.error = null; S.lastOk = Date.now();
        ls.forEach((l, i) => { if (l) setLocal(areas[i], l); });
        noteNewCalls(f.items || []);
        S.feed = f.items || [];
        opts.onHealth?.(true);
      } catch (e) {
        S.error = e.message === 'Failed to fetch' ? 'Can’t reach the results service. Check your connection; the board will retry.' : e.message;
        opts.onHealth?.(false, S.error);
      }
      S.loading = false;
      renderAll();
      if (S.zoomSt && S.chamber !== 'house' && !isArea(S.chamber)) { await loadCounties(); renderMap(); }
    }
    /* Orange County and propositions tabs: each downloaded only while open (or one of its races is starred) */
    const AD = () => S.areas[AREA_OF[S.chamber]] || null;
    const neededAreas = () => [...new Set([AREA_OF[S.chamber], ...[...S.watch].map(areaOfId)].filter(Boolean))];
    const fetchLocal = (area, fresh) => fetch(`${S.api}/v1/local?area=${area}&sim=${S.sim ? 1 : 0}${fresh ? '&fresh=1' : ''}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
    function setLocal(area, l) { S.areas[area] = l; S.localById = new Map(Object.values(S.areas).flatMap(a => a.contests.map(c => [c.id, c]))); }
    async function loadLocal(area) { const l = await fetchLocal(area); if (l) { setLocal(area, l); renderAll(); } }
    const raceOf = id => S.byId?.get(id) || S.localById.get(id);
    const tabOfId = id => TAB_OF_AREA[areaOfId(id)] || S.byId?.get(id)?.chamber || chamberOfId(id);

    /* Zoom: clicking a state animates the national map into that state and draws its counties */
    const FULL_VB = () => String(S.shapes?.viewBox || '0 0 960 600').split(/\s+/).map(Number);
    function zoomRace() {
      if (!S.zoomSt || S.chamber === 'house' || isArea(S.chamber)) return null;
      const sel = S.byId?.get(S.selected);
      if (sel && sel.state === S.zoomSt && sel.chamber === S.chamber) return sel;
      return (S.data?.races || []).find(r => r.state === S.zoomSt && r.chamber === S.chamber) || null;
    }
    async function zoomTo(st) {
      if (S.zoomSt !== st) S.countyData = null;
      S.sub = null;
      S.zoomSt = st;
      renderMap();
      await loadZoomShapes(st);
      if (S.zoomSt !== st) return;
      renderMap();
      animateTo(targetVB());
      await loadCounties();
      if (S.zoomSt === st) renderMap();
    }
    function unzoom() {
      S.zoomSt = null; S.countyData = null; S.sub = null;
      if (S.chamber === 'house') S.stateFilter = null;
      renderTools(); renderList(); renderMap();
      animateTo(FULL_VB());
    }
    function targetVB() {
      const shp = S.zoomSt && ((S.chamber === 'house' ? S.dshapes : S.cshapes).get(S.zoomSt) || S.cshapes.get(S.zoomSt) || S.dshapes.get(S.zoomSt));
      if (!shp) return FULL_VB();
      const [, , fw, fh] = FULL_VB();
      let [x0, y0, x1, y1] = shp.bbox;
      let w = x1 - x0, h = y1 - y0;
      const pad = Math.max(w, h) * 0.07 + 3;
      x0 -= pad; y0 -= pad; w += pad * 2; h += pad * 2;
      const aspect = fw / fh;                         // keep the map's own shape so nothing stretches
      if (w / h > aspect) { const nh = w / aspect; y0 -= (nh - h) / 2; h = nh; }
      else { const nw = h * aspect; x0 -= (nw - w) / 2; w = nw; }
      return [x0, y0, w, h];
    }
    /* One level closer: inside a zoomed state, tapping a county or district zooms in on it and its neighbors.
       "← State" steps back out. Shapes that already fill most of the state view don't zoom further. */
    function zoomInto(p) {
      if (!S.zoomSt || !p?.getBBox) return;
      const id = p.dataset.fips || p.dataset.dist;
      if (S.sub?.id === id) return;
      const [, , sw] = targetVB(), [, , fw, fh] = FULL_VB(), aspect = fw / fh;
      const bb = p.getBBox();
      let w = Math.max(bb.width, bb.height * aspect) * (p.dataset.fips ? 4 : 2.6);   // the shape plus its neighbors (counties are small)
      if (w >= sw * 0.8) { if (S.sub) zoomOut(); return; }            // already big enough at state view
      w = Math.max(w, sw / 14);                                       // never closer than ~14x the state view
      const h = w / aspect, cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
      S.sub = { id, name: p.querySelector('title')?.textContent.split(/[:\n]/)[0] || id };
      setTimeout(() => { const tip = $('map')?.querySelector('.eb-tip'); if (tip) tip.hidden = true; }, 0);   // it would point at the old spot
      animateTo([cx - w / 2, cy - h / 2, w, h]);
      sizeDistrictLabels(w);
      markSub();
      renderZoomBar();
    }
    const markSub = () => $('map')?.querySelectorAll('[data-r="counties"] path').forEach(x => x.classList.toggle('sub', S.sub?.id === x.dataset.fips));
    function zoomOut() {
      S.sub = null;
      markSub();
      const to = targetVB();
      animateTo(to);
      sizeDistrictLabels(to[2]);
      renderZoomBar();
    }
    // District numbers stay about 12-21 px on screen at any zoom and screen size (skipped where a district is too small to hold one)
    function sizeDistrictLabels(W) {
      const px = $('map')?.querySelector('svg.eb-us')?.getBoundingClientRect().width || 1000;
      const k = W / px;                                               // map units per screen pixel
      $('map')?.querySelectorAll('[data-r="dlabels"] text').forEach(t => {
        const sz = +t.dataset.s, fs = Math.min(Math.max(sz * 0.25, 12 * k), 21 * k);
        t.style.fontSize = `${fs.toFixed(3)}px`; t.style.strokeWidth = `${(fs * 0.18).toFixed(3)}px`;
        t.style.display = sz < fs * 1.9 ? 'none' : '';
      });
    }
    let anim = 0;
    function animateTo(to) {
      const svg = $('map').querySelector('svg.eb-us');
      if (!svg) { S.vb = to; return; }
      const from = S.vb || FULL_VB();
      cancelAnimationFrame(anim);
      const dur = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650;
      const t0 = performance.now();
      const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const step = now => {
        const k = dur ? Math.min(1, (now - t0) / dur) : 1, e = ease(k);
        S.vb = from.map((v, i) => v + (to[i] - v) * e);
        svg.setAttribute('viewBox', S.vb.map(v => v.toFixed(2)).join(' '));
        if (k < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }
    // House zooms show the state's congressional districts; Senate and governor zooms show counties
    function loadZoomShapes(st) { return S.chamber === 'house' ? loadDistrictShapes(st) : loadCountyShapes(st); }
    async function loadDistrictShapes(st) {
      if (S.dshapes.has(st)) return;
      try { const r = await fetch(`${S.districtsUrl}/${st}.json`); if (!r.ok) throw new Error(); S.dshapes.set(st, await r.json()); }
      catch { S.dshapes.set(st, null); }
    }
    async function loadCountyShapes(st) {
      if (S.cshapes.has(st)) return;
      try { const r = await fetch(`${S.countiesUrl}/${st}.json`); if (!r.ok) throw new Error(); S.cshapes.set(st, await r.json()); }
      catch { S.cshapes.set(st, null); }
    }
    async function loadCounties() {
      const race = zoomRace();
      if (!race) { S.countyData = null; return; }
      try {
        const d = await fetch(`${S.api}/v1/counties?race=${race.id}&sim=${S.sim ? 1 : 0}`, { cache: 'no-store' }).then(r => r.json());
        if (zoomRace()?.id === race.id) S.countyData = { ...d, raceId: race.id };
      } catch { if (zoomRace()?.id === race.id) S.countyData = { raceId: race.id, available: false, reason: 'County results didn’t load. The board will try again on the next refresh.' }; }
    }
    async function loadShapes() {
      try { S.shapes = await fetch(S.shapesUrl).then(r => r.json()); }
      catch { S.shapes = null; }
      renderMap(true);
    }

    function noteNewCalls(items) {
      const keyOf = x => `${x.race_id}|${x.kind}|${x.at}`;
      if (S.seenFeed) {
        const fresh = items.filter(x => !S.seenFeed.has(keyOf(x)));
        S.newKeys = new Set(fresh.map(keyOf));
        if (S.chime && fresh.some(x => S.watch.has(x.race_id))) chime();
      } else S.newKeys = new Set();
      S.seenFeed = new Set(items.map(keyOf));
    }

    /* ── render ── */
    function renderAll() { renderStatus(); renderBanner(); renderStrip(); renderTools(); renderMap(); renderList(); renderLog(); renderDetail(); }

    function renderStatus() {
      const d = S.data;
      const ago_ = `<span data-r="ago">${S.lastOk ? `Updated ${ago(S.lastOk)}` : 'Connecting…'}</span>`;
      const chimeBtn = `<button type="button" class="eb-sw" data-act="chime" aria-pressed="${S.chime}" title="Play a tone when a race you're watching is called">Chime on watched calls</button>`;
      const refreshBtn = `<button type="button" class="eb-sw" data-act="refresh">Refresh</button>`;
      if (S.pub) {
        $('status').innerHTML = `<span>Vote counts from state election offices. Race calls by OC Scanner.</span>${ago_}<span class="eb-sp"></span>${chimeBtn}${refreshBtn}`;
        return;
      }
      const srcs = d?.sources || [];
      const dot = s => s.enabled === false ? 'off' : s.status === 'partial' ? 'warn' : s.ok === true ? 'ok' : s.ok === false ? 'bad' : '';
      const ap = srcs.find(s => s.kind === 'ap');
      const states = srcs.filter(s => s.kind === 'state');
      const sim = srcs.find(s => s.name === 'Simulation');
      let feedHtml = '';
      if (sim) feedHtml = `<span><i class="eb-dot ok"></i>Simulation</span>`;
      else {
        if (ap) feedHtml += `<span title="${esc(ap.error || '')}"><i class="eb-dot ${dot(ap)}"></i>AP${ap.enabled ? '' : ' (off)'}</span>`;
        if (states.length) {
          const good = states.filter(s => s.status === 'ok' || s.status === 'partial').length, bad = states.filter(s => s.status === 'error').length;
          const held = states.every(s => s.status === 'waiting');
          const label = held ? `State feeds start ${fmtStart(d.resultsStart)}` : `State feeds: ${good} of ${states.length} reporting${bad ? `, ${bad} failing` : ''}`;
          const rows = states.map(s => `<li><i class="eb-dot ${dot(s)}"></i><b>${esc(s.name)}</b> ${esc(s.label)}: ${esc(feedWords(s))}${s.confidence !== 'verified' ? ` <em>(${esc(s.confidence)})</em>` : ''}</li>`).join('');
          feedHtml += `<details class="eb-feeds"${S.feedsOpen ? ' open' : ''}><summary><i class="eb-dot ${held ? '' : bad ? 'bad' : good ? 'ok' : ''}"></i>${label}</summary><ul>${rows}</ul></details>`;
        }
      }
      $('status').innerHTML = `
        ${feedHtml}${ago_}
        <span class="eb-sp"></span>
        <button type="button" class="eb-sw simsw" data-act="sim" aria-pressed="${S.sim}">Rehearsal data</button>
        ${chimeBtn}
        <button type="button" class="eb-sw" data-act="desk" aria-pressed="${!!S.token}">${S.token ? 'Desk on' : 'Desk sign-in'}</button>
        ${S.token ? `<button type="button" class="eb-sw eb-qbtn${queueCount() ? ' on' : ''}" data-gotoqueue>Call queue${queueCount() ? ` <b>${queueCount()}</b>` : ''}</button>` : ''}
        ${refreshBtn}`;
      $('status').querySelector('.eb-feeds')?.addEventListener('toggle', e => { S.feedsOpen = e.target.open; });
    }

    function fmtStart(iso) {
      const d = new Date(iso);
      return isNaN(d) ? 'on election night' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    function feedWords(s) {
      if (s.status === 'waiting') return 'starts on election night';
      if (s.status === 'pending') return 'not checked yet';
      if (s.status === 'not posted') return 'state hasn’t posted its Nov 3 file yet';
      if (s.status === 'error') return `last try failed (${s.error || 'error'})`;
      if (s.status === 'partial') return `${s.races} races; ${s.errors} of ${s.units} files failed (${s.error || 'error'})`;
      return `${s.races} races, checked ${s.fetchedAt ? ago(s.fetchedAt) : ''}`;
    }

    function renderBanner() {
      const d = S.data;
      let h = '';
      if (S.sim) h += `<div class="eb-sim">Rehearsal data. <span>These are made-up numbers for testing the board, not real results.</span> Copied posts are marked so they can’t be mistaken for real calls.</div>`;
      if (S.error) h += `<div class="eb-note">${esc(S.error)}</div>`;
      else if (isArea(S.chamber)) {
        const L = AD();
        if (L && !S.sim && L.contests.every(c => c.status === 'waiting'))
          h += S.chamber === 'props'
            ? `<div class="eb-note">No proposition results yet. The Secretary of State posts its first count after polls close at 8 p.m. on Nov 3; this tab picks up each update within about 10 minutes.</div>`
            : S.chamber === 'la'
              ? `<div class="eb-note">No LA County results yet. The Registrar-Recorder/County Clerk posts its first count after polls close at 8 p.m. on Nov 3; this tab picks up each update within about 10 minutes.</div>`
              : `<div class="eb-note">No Orange County results yet. The Registrar of Voters posts its first count after polls close at 8 p.m. on Nov 3; this tab picks up each update within about 10 minutes.</div>`;
      } else if (d && !S.sim && d.races.every(r => r.status === 'waiting')) {
        const day = new Date(d.election + 'T12:00:00').toLocaleDateString([], { month: 'long', day: 'numeric' });
        h += S.pub
          ? `<div class="eb-note">No results yet. Vote counts appear here after polls close on ${day} and update about every 10 minutes.</div>`
          : `<div class="eb-note">No results yet. State feeds start ${fmtStart(d.resultsStart)} and refresh about every 10 minutes. States without a feed fill in from your desk entries. Turn on rehearsal data to test the board.</div>`;
      }
      $('banner').innerHTML = h;
    }

    function renderStrip() {
      const d = S.data;
      $('strip').innerHTML = CHAMBERS.map(([ch, label]) => {
        const s = d?.summary?.[ch];
        if (!s) return `<button type="button" class="eb-bal" data-chamber="${ch}" aria-pressed="${S.chamber === ch}"><h3>${label}</h3><div class="eb-empty">–</div></button>`;
        const T = s.total;
        const w = n => `${(n / T * 100).toFixed(2)}%`;
        const seg = (n, color) => n ? `<i style="width:${w(n)};background:${color}"></i>` : '';
        const dSeats = s.seats.D, rSeats = s.seats.R, iSeats = s.seats.I;
        const tieNote = ch === 'senate' ? `Republicans control at 50 with the vice president` : ch === 'governor' ? `${s.up} races, ${T - s.up} not up` : `${s.majority} for a majority`;
        const flips = s.flips.toD || s.flips.toR || s.flips.toOther
          ? `Flips: <b>${s.flips.toD} to Dem</b>, <b>${s.flips.toR} to Rep</b>${s.flips.toOther ? `, <b>${s.flips.toOther} other</b>` : ''}` : 'No flips yet';
        return `<button type="button" class="eb-bal" data-chamber="${ch}" aria-pressed="${S.chamber === ch}" aria-label="${label}: Democrats ${dSeats}, Republicans ${rSeats}${iSeats ? `, independents ${iSeats}` : ''}">
          <h3>${label}</h3>
          <div class="eb-nums"><span class="eb-big D">${dSeats}<small>Dem${iSeats ? ` + ${iSeats} Ind` : ''}</small></span><span class="eb-big R"><small>Rep</small>${rSeats}</span></div>
          <div class="eb-bar">${seg(dSeats, 'var(--D)')}${seg(iSeats, 'var(--I)')}${seg(s.leading.D, 'var(--Dt)')}${seg(s.leading.I, 'var(--It)')}<i class="gap"></i>${seg(s.leading.O + s.seats.O, 'var(--Ot)')}${seg(s.leading.R, 'var(--Rt)')}${seg(rSeats, 'var(--R)')}
            <span class="eb-tick" style="left:${w(s.majority)}"></span></div>
          <div class="eb-sub"><span>${s.leading.D + s.leading.I ? `Leading ${s.leading.D + s.leading.I}` : ''}</span><span>${tieNote}</span><span>${s.leading.R ? `Leading ${s.leading.R}` : ''}</span></div>
          <div class="eb-sub"><span>${flips}</span><span>${s.waiting ? `${s.waiting} not reporting` : ''}</span></div>
        </button>`;
      }).join('');
    }

    function renderTools() {
      root.querySelectorAll('.eb-chambers [data-chamber]').forEach(b => { b.setAttribute('aria-pressed', b.dataset.chamber === S.chamber); b.setAttribute('aria-selected', b.dataset.chamber === S.chamber); });
      for (const [ch] of CHAMBERS) { const n = S.data?.summary?.[ch]?.up; const el = $(`n-${ch}`); if (el) el.textContent = n ? `${n} races` : ''; }
      $('n-local').textContent = S.areas.OC ? `${S.areas.OC.contests.length} races` : '';
      $('n-la').textContent = S.areas.LA ? `${S.areas.LA.contests.length} races` : '';
      $('n-props').textContent = S.areas.CAP ? `${S.areas.CAP.contests.length} on ballot` : '';
      const local = isArea(S.chamber);
      if (local && S.filter === 'flips') S.filter = 'all';
      root.querySelectorAll('[data-filter]').forEach(b => { b.setAttribute('aria-pressed', b.dataset.filter === S.filter); b.hidden = local && b.dataset.filter === 'flips'; });
      root.querySelectorAll('[data-sort]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sort === S.sort));
      root.querySelector('[data-sort="az"]').textContent = S.chamber === 'props' ? 'By number' : local ? 'By place' : 'By state';
      $('chip').innerHTML = S.stateFilter ? `<button type="button" class="eb-chip" data-clearstate aria-label="Show all states">${esc(stateName(S.stateFilter))}<span aria-hidden="true">×</span></button>` : '';
    }
    const stateName = st => S.data?.races.find(r => r.state === st)?.stateName || st;

    /* map */
    function stateFill(st) {
      const rs = (S.data?.races || []).filter(r => r.state === st && r.chamber === S.chamber);
      if (!rs.length) return { cls: 'norace', fill: null };
      if (S.chamber !== 'house') {
        const r = rs[0];
        if (r.call) return { fill: r.flip ? `url(#eb-flip-${r.call.party})` : `var(--${r.call.party})` };
        if (r.leader) return { fill: `var(--${r.leader}t)` };
        return { fill: 'var(--eb-wait)' };
      }
      const c = { D: 0, R: 0, I: 0, O: 0 }; let called = 0, any = 0;
      for (const r of rs) { const p = r.call?.party || r.leader; if (p) { c[p in c ? p : 'O']++; any++; } if (r.call) called++; }
      if (!any) return { fill: 'var(--eb-wait)' };
      const top = Object.entries(c).sort((a, b) => b[1] - a[1]);
      if (top[0][1] === top[1][1]) return { fill: 'var(--Ot)' };
      return { fill: called === rs.length ? `var(--${top[0][0]})` : `var(--${top[0][0]}t)` };
    }
    function stateSummary(st) {
      const rs = (S.data?.races || []).filter(r => r.state === st && r.chamber === S.chamber);
      if (!rs.length) return `${stateName(st) === st ? st : stateName(st)}: no ${S.chamber === 'governor' ? 'governor' : S.chamber === 'senate' ? 'Senate' : 'House'} race`;
      if (S.chamber !== 'house') { const r = rs[0]; return `${r.name}: ${statusText(r)}`; }
      const c = { D: 0, R: 0 }, l = { D: 0, R: 0 };
      rs.forEach(r => { if (r.call && r.call.party in c) c[r.call.party]++; else if (r.leader in l) l[r.leader]++; });
      return `${rs[0].stateName}: ${rs.length} seats. Called D ${c.D}, R ${c.R}. Leading D ${l.D}, R ${l.R}`;
    }
    function renderMap(rebuild) {
      if (S.chamber === 'props') return renderPropsPanel();
      if (isCounty(S.chamber)) return renderLocalPanel();
      const box = $('map');
      if (!S.shapes) { if (rebuild) { box.innerHTML = '<div class="eb-empty">The map didn’t load. Races are still listed below.</div>'; box.dataset.mode = ''; } return; }
      if (rebuild || box.dataset.mode !== 'us') {
        box.dataset.mode = 'us';
        const stripes = p => `<pattern id="eb-flip-${p}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" style="fill:var(--${p})"/><rect width="2.4" height="7" fill="rgba(255,255,255,.55)"/></pattern>`;
        const paths = Object.entries(S.shapes.shapes).map(([st, s]) => `<path data-st="${st}" d="${s.d}" tabindex="-1"><title>${st}</title></path>`).join('');
        const labels = Object.entries(S.shapes.shapes).filter(([st]) => !SMALL.has(st)).map(([st, s]) => `<text x="${s.c[0]}" y="${s.c[1]}">${st}</text>`).join('');
        box.innerHTML = `<div class="eb-cbar" data-r="cbar" hidden></div>
          <svg class="eb-us" viewBox="${(S.vb || FULL_VB()).join(' ')}" role="img" aria-label="Results map"><defs>${['D', 'R', 'I', 'O'].map(stripes).join('')}${['D', 'R', 'I', 'O'].map(p => stripes(p).replace(`eb-flip-${p}`, `eb-dflip-${p}`)).join('')}<clipPath id="eb-dclip"><path data-r="dclip" d=""></path></clipPath></defs>
            <g class="eb-states">${paths}</g><g class="eb-counties" data-r="counties"></g><g class="eb-districts" data-r="districts" clip-path="url(#eb-dclip)"></g><path class="eb-outline" data-r="outline" d=""></path><g class="eb-labels">${labels}</g><g class="eb-dlabels" data-r="dlabels"></g></svg>
          <div class="eb-cnote" data-r="cnote" hidden></div><div class="eb-tip" hidden></div>`;
      }
      const z = S.zoomSt;
      box.querySelector('svg').classList.toggle('zoomed', !!z);
      box.querySelectorAll('path[data-st]').forEach(p => {
        const st = p.dataset.st; const f = stateFill(st);
        const dim = z ? st !== z : S.stateFilter && S.stateFilter !== st;
        p.setAttribute('class', [f.cls, S.stateFilter === st && !z ? 'sel' : '', st === z ? 'focus' : '', dim ? 'dim' : ''].filter(Boolean).join(' '));
        p.style.fill = f.fill || '';
        p.querySelector('title').textContent = z && st !== z ? `${stateName(st)}: select to zoom here` : stateSummary(st);
      });

      // counties of the zoomed state
      const g = box.querySelector('[data-r="counties"]');
      const house = S.chamber === 'house';
      const shp = z && !house && S.cshapes.get(z);
      if (!shp) { g.innerHTML = ''; g.dataset.st = ''; }
      else if (g.dataset.st !== z) {
        g.innerHTML = Object.entries(shp.counties).map(([f, c]) => `<path data-fips="${f}" d="${c.d}"><title>${esc(c.n)}</title></path>`).join('');
        g.dataset.st = z;
      }
      box.querySelector('[data-r="outline"]').setAttribute('d', z ? S.shapes.shapes[z]?.d || '' : '');
      // Census district lines run out into lakes and bays; clip them to the state's shoreline
      box.querySelector('[data-r="dclip"]').setAttribute('d', z ? S.shapes.shapes[z]?.d || '' : '');
      const race = zoomRace();
      const d = race && S.countyData?.raceId === race.id ? S.countyData : null;
      const has = !!(d?.available && d.counties && Object.values(d.counties).some(c => c.v.some(x => x > 0)));
      g.querySelectorAll('path').forEach(p => {
        // No data yet: let the state's own color show through; a state with no race on this tab goes gray
        p.style.fill = has ? countyFill(p.dataset.fips) : race || S.chamber === 'house' ? 'transparent' : 'var(--eb-wait)';
        p.querySelector('title').textContent = countySummary(p.dataset.fips);
        p.classList.toggle('sub', S.sub?.id === p.dataset.fips);
      });

      // districts of the zoomed state (House tab)
      const dg = box.querySelector('[data-r="districts"]'), dl = box.querySelector('[data-r="dlabels"]');
      const dsh = z && house ? S.dshapes.get(z) : null;
      if (!dsh) { dg.innerHTML = ''; dl.innerHTML = ''; dg.dataset.st = ''; }
      else if (dg.dataset.st !== z) {
        const [x0, y0, x1, y1] = dsh.bbox, span = Math.max(x1 - x0, y1 - y0), W = targetVB()[2];
        dg.innerHTML = Object.entries(dsh.districts).map(([id, c]) => `<path data-dist="${id}" d="${c.d}"><title>${esc(id)}</title></path>`).join('');
        // District numbers: sized to the zoomed view (about 12-21 px on screen), skipped where a district is too small to hold one
        dl.innerHTML = Object.values(dsh.districts).filter(c => c.n !== 'AL').map(c => `<text x="${c.c[0]}" y="${c.c[1]}" data-s="${c.s}">${c.n}</text>`).join('');
        sizeDistrictLabels(S.sub ? (S.vb || targetVB())[2] : W);
        // Flip stripes sized to the state, so they read the same in Rhode Island and Texas
        const sw = (span / 70).toFixed(2);
        box.querySelectorAll('pattern[id^="eb-dflip-"]').forEach(pt => {
          pt.setAttribute('width', sw); pt.setAttribute('height', sw);
          pt.children[0].setAttribute('width', sw); pt.children[0].setAttribute('height', sw);
          pt.children[1].setAttribute('width', (sw * 0.34).toFixed(2)); pt.children[1].setAttribute('height', sw);
        });
        dg.dataset.st = z;
      }
      dg.querySelectorAll('path').forEach(p => {
        const r = S.byId?.get(p.dataset.dist);
        p.style.fill = districtFill(r);
        p.classList.toggle('sel', S.selected === p.dataset.dist);
        p.querySelector('title').textContent = districtSummary(p.dataset.dist);
      });
      // keep the selected district's outline on top
      const selP = dg.querySelector('path.sel'); if (selP && selP !== dg.lastElementChild) dg.appendChild(selP);

      // header bar, note and key
      const bar = box.querySelector('[data-r="cbar"]');
      bar.hidden = !z;
      if (z) {
        const word = { senate: 'Senate', governor: 'governor’s', house: 'House' }[S.chamber];
        const nSeats = house ? (S.data?.races || []).filter(r => r.state === z && r.chamber === 'house').length : 0;
        const title = race ? `${race.name} by county` : house ? `${stateName(z)}: ${nSeats} House ${nSeats === 1 ? 'seat' : 'districts'}` : `${stateName(z)}: no ${word} race this year`;
        const selHouse = house && S.byId?.get(S.selected)?.state === z && S.byId.get(S.selected).chamber === 'house';
        S.zoomTitle = title; S.zoomDetails = !!(race || selHouse);
        renderZoomBar();
      }
      let note = '';
      if (z && house) {
        const ds = S.dshapes.get(z);
        if (ds === undefined) note = 'Loading districts…';
        else if (ds === null) note = 'The district map didn’t load. This state’s races are listed below.';
      }
      if (z && race) {
        if (shp === undefined) note = 'Loading counties…';
        else if (shp === null) note = 'The county map didn’t load.';
        else if (!d) note = 'Loading county results…';
        else if (!d.available) note = S.pub && d.off ? 'County-by-county results aren’t available for this race yet.' : S.pub ? 'County-by-county results aren’t available for this state.' : d.reason || 'No county results for this race.';
        else if (!has) note = S.sim ? 'Rehearsal counties fill in as the practice count starts.' : 'County results appear here once counting starts.';
      }
      const n = box.querySelector('[data-r="cnote"]');
      n.hidden = !note; n.textContent = note;

      if (z && race) {
        $('key').innerHTML = has
          ? `${d.cands.slice(0, 4).map((c, i) => `<span><i style="background:${countyColor(i)}"></i>${esc(last(c.name))} ahead</span>`).join('')}<span>Stronger color = wider lead</span><span><i style="background:var(--eb-wait)"></i>No votes yet</span>${d.simulation ? '<span><b>Rehearsal data</b></span>' : ''}`
          : '<span>Counties are colored by who’s ahead; the stronger the color, the wider the lead.</span>';
        return;
      }
      const hint = z && house ? 'Select a district for its race. Select another state to zoom there.' : z ? 'Select another state to zoom there.' : house ? 'Select a state to zoom in to its districts.' : 'Select a state to zoom in to its counties.';
      $('key').innerHTML = `<span class="eb-hint">${hint}</span><span><i style="background:var(--D)"></i>Dem won</span><span><i style="background:var(--Dt)"></i>Dem leading</span><span><i style="background:var(--Rt)"></i>Rep leading</span><span><i style="background:var(--R)"></i>Rep won</span><span><i style="background:var(--I)"></i>Ind</span>${S.chamber !== 'house' || z ? '<span><i style="background:url(#)" class="kflip"></i>Striped: flipped seat</span>' : '<span>State color: party ahead in most seats</span>'}<span><i style="background:var(--eb-wait)"></i>No results yet</span><span><i style="border:1px dashed var(--eb-muted)"></i>No race</span>`;
      const k = $('key').querySelector('.kflip');
      if (k) k.style.background = 'repeating-linear-gradient(45deg,var(--R) 0 3px,rgba(255,255,255,.6) 3px 5px)';
    }

    /* district colors and summaries (House zoom) */
    function districtFill(r) {
      if (!r) return 'var(--eb-wait)';
      const P = p => ['D', 'R', 'I'].includes(p) ? p : 'O';
      if (r.call) return r.flip ? `url(#eb-dflip-${P(r.call.party)})` : `var(--${P(r.call.party)})`;
      if (r.leader) return `var(--${P(r.leader)}t)`;
      return 'var(--eb-wait)';
    }
    function districtSummary(id) {
      const r = S.byId?.get(id);
      if (!r) return shortName({ chamber: 'house', id });
      const who = !r.total && !r.call ? (r.preCandidates || []).slice(0, 3).map(c => `${last(c.name)} (${c.party})`).join(' vs ') : '';
      return `${shortName(r)}: ${statusText(r)}${who ? `. ${who}` : ''}`;
    }

    /* county colors */
    function countyColor(i) {
      const cands = S.countyData?.cands || [];
      const p = cands[i]?.party;
      const shared = cands.length > 1 && cands[0].party === cands[1].party;
      return !shared && (p === 'D' || p === 'R' || p === 'I') ? `var(--${p})` : CAND_COLORS[i % CAND_COLORS.length];
    }
    function countyFill(fips) {
      const c = S.countyData?.counties?.[fips];
      const tot = c ? c.v.reduce((a, b) => a + b, 0) : 0;
      if (!tot) return 'var(--eb-wait)';
      const order = c.v.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
      const margin = (order[0][0] - (order[1]?.[0] || 0)) / tot * 100;
      if (!margin) return 'var(--Ot)';
      const strength = margin >= 20 ? 100 : margin >= 10 ? 72 : margin >= 5 ? 52 : 34;
      return `color-mix(in srgb, ${countyColor(order[0][1])} ${strength}%, var(--eb-bg2))`;
    }
    function countySummary(fips) {
      const name = S.cshapes.get(S.zoomSt)?.counties?.[fips]?.n || fips;
      const race = zoomRace();
      const d = race && S.countyData?.raceId === race.id ? S.countyData : null, c = d?.counties?.[fips];
      const tot = c ? c.v.reduce((a, b) => a + b, 0) : 0;
      if (!tot) return race ? `${name}: no votes counted yet` : name;
      const parts = c.v.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3)
        .map(([v, i]) => `${last(d.cands[i].name)} ${(v / tot * 100).toFixed(1)}%`);
      return `${name}: ${parts.join(', ')}${c.pct != null ? ` (${Math.round(c.pct)}% in)` : ''}`;
    }

    /* Orange County panel (in place of the map) */
    function localCounts() {
      const n = { all: 0 };
      for (const c of AD()?.contests || []) { n.all++; n[c.group] = (n[c.group] || 0) + 1; }
      return n;
    }
    function renderLocalPanel() {
      const box = $('map');
      box.dataset.mode = 'local';
      const L = AD();
      const isLA = S.chamber === 'la';
      if (!L) { box.innerHTML = `<div class="eb-empty">Loading ${isLA ? 'LA County' : 'Orange County'} races…</div>`; $('key').innerHTML = ''; return; }
      const n = localCounts();
      const groups = [{ key: 'all', label: 'All' }, ...GROUP_ORDER.map(k => L.groups.find(g => g.key === k)).filter(Boolean)].filter(g => g.key === 'all' || n[g.key]);
      const turnout = L.ballotsCast != null && L.registered ? `${fmtN(L.ballotsCast)} ballots counted of ${fmtN(L.registered)} registered voters (${(L.ballotsCast / L.registered * 100).toFixed(1)}%)` : '';
      const upd = L.generated ? `Registrar update ${fmtT(L.generated)}` : '';
      const gnote = L.groups.find(g => g.key === S.group)?.note;
      box.innerHTML = `<div class="eb-local">
        <div class="eb-lhead"><h4>${esc(L.name || 'Orange County')} local races</h4><span>${esc([turnout, upd].filter(Boolean).join(' · ') || (isLA ? (L.contests.some(c => c.total) ? 'Counts from the LA County Registrar-Recorder' : 'Nov 3 runoffs; the rest of the county’s ballot appears when LA posts it') : 'Nov 3 ballot: county, cities, schools and special districts'))}</span></div>
        <div class="eb-groups" role="group" aria-label="Kind of race">${groups.map(g => `<button type="button" data-group="${g.key}" aria-pressed="${S.group === g.key}">${esc(g.label)} <span>${n[g.key]}</span></button>`).join('')}</div>
        ${gnote ? `<p class="eb-lnote">${esc(gnote)}</p>` : ''}
        ${isLA && L.preloadNote && !L.contests.some(c => /^LA-\d/.test(c.id)) ? `<p class="eb-lnote">${esc(L.preloadNote)}</p>` : ''}
        <p class="eb-lnote">Tip: tap <b>Watch</b> on any race to keep your own list; the <b>Watching</b> filter shows just those.</p>
      </div>`;
      $('key').innerHTML = `<span>Unofficial results from the ${esc(L.source)}. ${isLA ? esc(L.note || '') : 'After election night the Registrar updates weekdays at 5 p.m. until the count is certified.'}</span>${L.simulation ? '<span><b>Rehearsal data</b></span>' : ''}`;
    }

    /* California propositions: a scoreboard of all 14 in place of the map */
    function propState(c) {
      const w = measureWord(c.call?.winners);
      if (w) return { cls: w === 'passes' ? 'yes' : 'no', text: w === 'passes' ? 'Passes' : 'Fails', strong: true };
      if (c.total) { const y = c.candidates.find(x => isYes(x.name)); const lead = (y?.pct ?? 0) >= 50; return { cls: lead ? 'yes' : 'no', text: `${lead ? 'Yes' : 'No'} leads`, strong: false }; }
      return { cls: 'wait', text: 'No results', strong: false };
    }
    function renderPropsPanel() {
      const box = $('map');
      box.dataset.mode = 'local';
      const L = S.areas.CAP;
      if (!L) { box.innerHTML = '<div class="eb-empty">Loading propositions…</div>'; $('key').innerHTML = ''; return; }
      const cs = L.contests;
      const pass = cs.filter(c => measureWord(c.call?.winners) === 'passes').length, fail = cs.filter(c => measureWord(c.call?.winners) === 'fails').length;
      const rep = cs.find(c => c.pctIn != null)?.pctIn;
      const any = cs.some(c => c.total);
      const sub = [any && rep != null ? `${rep}% of precincts reporting statewide` : '', any && L.generated ? `Secretary of State update ${fmtT(L.generated)}` : '', pass || fail ? `${pass} called passing, ${fail} failing` : '']
        .filter(Boolean).join(' · ') || 'Nov 3 ballot: 14 statewide measures';
      box.innerHTML = `<div class="eb-local">
        <div class="eb-lhead"><h4>California propositions</h4><span>${esc(sub)}</span></div>
        <div class="eb-props">${cs.map(c => {
          const st = propState(c), y = c.candidates.find(x => isYes(x.name));
          return `<button type="button" class="eb-prop ${st.cls}${st.strong ? ' called' : ''}${S.selected === c.id ? ' sel' : ''}" data-race="${c.id}" aria-label="${esc(c.name)}: ${esc(st.text)}">
            <span class="pn">${esc(c.place)}</span><span class="pt">${esc(c.office)}</span>
            <span class="eb-ynbar">${c.total ? `<i class="y" style="width:${y?.pct ?? 0}%"></i><i class="n"></i>` : ''}</span>
            <span class="ps"><b>${esc(st.text)}</b>${c.total ? ` Yes ${y?.pct ?? '–'}%` : ''}</span>
          </button>`;
        }).join('')}</div>
      </div>`;
      $('key').innerHTML = `<span><i style="background:var(--eb-yes)"></i>Yes</span><span><i style="background:var(--eb-no)"></i>No</span><span>Unofficial results from the ${esc(L.source)}. ${esc(L.note || '')} California counts mail ballots for weeks, so close ones can take a while to call.</span>${L.simulation ? '<span><b>Rehearsal data</b></span>' : ''}`;
    }

    function renderZoomBar() {
      const bar = $('map')?.querySelector('[data-r="cbar"]');
      if (!bar || !S.zoomSt) return;
      const back = S.sub ? `← ${esc(stateName(S.zoomSt))}` : '← US map';
      const title = S.sub ? `${esc(S.zoomTitle || '')} · ${esc(S.sub.name)}` : `${esc(S.zoomTitle || '')}<small class="eb-zhint"> · tap a ${S.chamber === 'house' ? 'district' : 'county'} to zoom in</small>`;
      bar.innerHTML = `<button type="button" class="eb-back" data-back>${back}</button><b>${title}</b>${S.zoomDetails ? '<button type="button" class="eb-back eb-narrow" data-act="opensheet">Race details</button>' : ''}`;
    }

    function selectState(st) {
      if (S.chamber === 'house') { S.stateFilter = st; S.limit = 60; renderTools(); renderList(); zoomTo(st); return; }
      const r = (S.data?.races || []).find(x => x.state === st && x.chamber === S.chamber);
      if (r) select(r.id, { sheet: false }); else zoomTo(st);
    }

    /* list */
    function visibleLocal() {
      let rs = AD()?.contests || [];
      if (S.group !== 'all') rs = rs.filter(c => c.group === S.group);
      if (S.q) rs = rs.filter(c => `${c.name} ${c.place} ${c.office} ${c.candidates.map(x => x.name).join(' ')}`.toLowerCase().includes(S.q));
      const f = S.filter;
      if (f === 'close') rs = rs.filter(c => !c.call && c.total > 0 && c.margin != null && c.margin < CLOSE_PTS);
      if (f === 'called') rs = rs.filter(c => c.call);
      if (f === 'uncalled') rs = rs.filter(c => !c.call);
      if (f === 'watch') rs = rs.filter(c => S.watch.has(c.id));
      const g = c => GROUP_ORDER.indexOf(c.group);
      const byPlace = (a, b) => g(a) - g(b) || a.place.localeCompare(b.place, undefined, { numeric: true }) || a.office.localeCompare(b.office, undefined, { numeric: true });
      const rank = c => c.status === 'counting' ? 0 : c.status === 'called' ? 1 : 2;
      return rs.slice().sort(S.sort === 'az' ? byPlace : (a, b) => rank(a) - rank(b) || (rank(a) === 0 ? (a.margin ?? 99) - (b.margin ?? 99) : 0) || byPlace(a, b));
    }
    function visibleRaces() {
      if (isArea(S.chamber)) return visibleLocal();
      let rs = (S.data?.races || []).filter(r => r.chamber === S.chamber);
      if (S.stateFilter) rs = rs.filter(r => r.state === S.stateFilter);
      if (S.q) rs = rs.filter(r => `${r.name} ${r.id} ${r.stateName} ${(r.candidates.length ? r.candidates : r.preCandidates).map(c => c.name).join(' ')} ${r.holder.name || ''}`.toLowerCase().includes(S.q));
      const f = S.filter;
      if (f === 'close') rs = rs.filter(isClose);
      if (f === 'flips') rs = rs.filter(r => r.flip || (!r.call && r.leader && r.holder.party && r.leader !== r.holder.party));
      if (f === 'called') rs = rs.filter(r => r.call);
      if (f === 'uncalled') rs = rs.filter(r => !r.call);
      if (f === 'watch') rs = rs.filter(r => S.watch.has(r.id));
      const rank = r => r.status === 'counting' ? 0 : r.status === 'runoff' ? 1 : r.status === 'called' ? 2 : 3;
      if (S.sort === 'az') rs.sort((a, b) => a.stateName.localeCompare(b.stateName) || (a.district || 0) - (b.district || 0));
      else rs.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? (a.margin ?? 99) - (b.margin ?? 99) : rank(a) === 2 ? (b.call.at || 0) - (a.call.at || 0) : 0)
        || b.preCandidates.length - a.preCandidates.length || a.stateName.localeCompare(b.stateName) || (a.district || 0) - (b.district || 0));
      return rs;
    }
    const isClose = r => !r.call && r.total > 0 && r.margin != null && r.margin < CLOSE_PTS;

    function split(r) {
      if (!r.total) return '';
      const order = { D: 0, I: 1, O: 2, L: 2, G: 2, R: 3 };
      return [...r.candidates].sort((a, b) => (order[a.party] ?? 2) - (order[b.party] ?? 2))
        .map(c => `<i style="width:${c.pct}%;background:var(--${c.party in PNAME ? c.party : 'O'}${r.call ? '' : 't'})" title="${esc(c.name)} ${c.pct}%"></i>`).join('');
    }
    function statusText(r) {
      if (r.call) return `${last(r.call.candidate) || PNAME[r.call.party]} (${r.call.party}) wins${r.flip ? ', flip' : ''}`;
      if (r.status === 'runoff') return 'Headed to a runoff';
      if (r.leader) { const c = r.candidates[0]; return `${last(c.name)} (${c.party}) leads by ${r.margin} pts, ${r.pctIn ?? '?'}% in`; }
      return 'No results yet';
    }
    function badge(r) {
      if (r.call) return `<span class="eb-badge ${r.call.party in PNAME ? r.call.party : 'O'}">${PNAME[r.call.party] || 'Other'} win</span>${r.flip ? '<span class="eb-flip">Flip</span>' : ''}`;
      if (r.status === 'runoff') return '<span class="eb-badge count">Runoff</span>';
      if (r.total) return `<span class="eb-badge count">${r.pctIn != null ? `${Math.round(r.pctIn)}% in` : 'Counting'}</span>`;
      return '<span class="eb-badge wait">No results</span>';
    }
    /* local rows */
    const isYes = n => /^(yes|bonds? ?[–-] ?yes)/i.test(n), isNo = n => /^(no|bonds? ?[–-] ?no)/i.test(n);
    // Measures always read Yes then No, whichever is ahead
    const ordered = c => c.measure ? [...c.candidates].sort((a, b) => (isYes(b.name) - isYes(a.name)) || (isNo(a.name) - isNo(b.name))) : c.candidates;
    function localColor(c, x) {
      if (c.measure) return isYes(x.name) ? 'var(--eb-yes)' : isNo(x.name) ? 'var(--eb-no)' : 'var(--Ot)';
      if (c.call) return x.winner ? 'var(--eb-lead)' : 'var(--Ot)';
      return c.ahead.includes(x.name) ? 'var(--eb-leadt)' : 'var(--Ot)';
    }
    function localLead(c) {
      const mw = c.measure && measureWord(c.call?.winners);
      if (mw) return mw === 'passes' ? 'Passes' : 'Fails';
      if (c.call) return `${c.call.winners.join(', ')} ${c.call.winners.length > 1 ? 'win' : 'wins'}`;
      if (!c.total && c.measure) return 'No results yet';
      if (!c.total) return c.unopposed ? `Unopposed: ${c.candidates.map(x => x.name).join(', ')}` : c.candidates.map(x => last(x.name)).slice(0, 4).join(' vs. ') + (c.candidates.length > 4 ? ` +${c.candidates.length - 4} more` : '');
      const inN = c.pctIn != null ? `, ${c.pctIn}% in` : '';
      if (c.measure) { const y = c.candidates.find(x => isYes(x.name)); return `Yes ${y?.pct ?? '–'}%, No ${y ? Math.round((100 - y.pct) * 10) / 10 : '–'}%${inN}`; }
      if (c.voteFor > 1) return `Top ${c.voteFor}: ${c.ahead.map(last).join(', ')}${inN}`;
      return c.margin != null ? `${last(c.ahead[0])} leads by ${c.margin} pts${inN}` : `${c.ahead[0]} unopposed`;
    }
    function localBadge(c) {
      const mw = c.measure && measureWord(c.call?.winners);
      if (mw) return `<span class="eb-badge ${mw === 'passes' ? 'yes' : 'no'}">${mw === 'passes' ? 'Passes' : 'Fails'}</span>`;
      if (c.call) return '<span class="eb-badge L">Called</span>';
      if (c.total) return `<span class="eb-badge count">${c.pctIn != null ? `${Math.round(c.pctIn)}% in` : 'Counting'}</span>`;
      return '<span class="eb-badge wait">No results</span>';
    }
    function renderLocalList(rs) {
      const L = AD();
      const glabel = S.chamber === 'props' ? 'California propositions' : S.group === 'all' ? `${L?.name || 'Local'} races` : (L?.groups.find(g => g.key === S.group)?.label || 'Races');
      $('listtitle').textContent = glabel;
      $('listcount').textContent = `${rs.length} shown`;
      if (!L) { $('list').innerHTML = '<div class="eb-empty">Loading races…</div>'; return; }
      if (!rs.length) {
        const why = { close: 'No uncalled race is within 5 points right now.', called: 'Nothing has been called yet.', watch: 'Star a race to keep it here.', uncalled: 'Every race here has been called.' }[S.filter] || 'No race matches your search.';
        $('list').innerHTML = `<div class="eb-empty">${why}</div>`; return;
      }
      $('list').innerHTML = rs.slice(0, S.limit).map(c => `<div class="eb-row${S.selected === c.id ? ' sel' : ''}" data-race="${c.id}" role="button" tabindex="0">
          <button type="button" class="eb-star" data-star="${c.id}" aria-pressed="${S.watch.has(c.id)}" aria-label="${S.watch.has(c.id) ? 'Stop watching' : 'Watch'} ${esc(c.name)}">${S.watch.has(c.id) ? '★' : '☆'}</button>
          <div class="nm">${esc(c.place)}<small>${esc(c.office)}</small></div>
          <div class="barcell"><div class="eb-split">${c.total ? ordered(c).map(x => `<i style="width:${x.pct}%;background:${localColor(c, x)}" title="${esc(x.name)} ${x.pct}%"></i>`).join('') : ''}</div><div class="eb-lead">${esc(localLead(c))}</div></div>
          <div class="pin">${c.oc?.total ? `OC: Yes ${c.oc.yesPct}%` : c.voteFor > 1 ? `Top ${c.voteFor} win` : c.incumbentRunning ? 'Incumbent running' : c.incumbent && !c.measure ? 'Open seat' : ''}</div>
          <div style="text-align:right">${localBadge(c)}</div>
        </div>`).join('') + (rs.length > S.limit ? `<button type="button" class="eb-more" data-more>Show ${Math.min(100, rs.length - S.limit)} more</button>` : '');
    }

    function renderList() {
      const rs = visibleRaces();
      if (isArea(S.chamber)) return renderLocalList(rs);
      const label = { house: 'House races', senate: 'Senate races', governor: 'Governor races' }[S.chamber];
      $('listtitle').textContent = S.stateFilter ? `${stateName(S.stateFilter)} ${label.toLowerCase()}` : label;
      $('listcount').textContent = `${rs.length} shown`;
      if (!S.data) { $('list').innerHTML = '<div class="eb-empty">Loading races…</div>'; return; }
      if (!rs.length) {
        const why = { close: 'No uncalled race is within 5 points right now.', flips: 'No seat has flipped or is trending toward a flip.', called: 'Nothing has been called yet.', watch: 'Star a race to keep it here.', uncalled: 'Every race here has been called.' }[S.filter] || 'No race matches your search.';
        $('list').innerHTML = `<div class="eb-empty">${why}</div>`; return;
      }
      $('list').innerHTML = rs.slice(0, S.limit).map(r => {
        const lead = r.total ? statusText(r) : r.preCandidates.length ? r.preCandidates.map(c => `${last(c.name)} (${c.party})`).join(' vs. ') : 'No results yet';
        const held = r.holder.party ? `Held by ${r.holder.party}${r.holder.open ? ', open' : ''}` : 'Vacant';
        return `<div class="eb-row${S.selected === r.id ? ' sel' : ''}" data-race="${r.id}" role="button" tabindex="0">
          <button type="button" class="eb-star" data-star="${r.id}" aria-pressed="${S.watch.has(r.id)}" aria-label="${S.watch.has(r.id) ? 'Stop watching' : 'Watch'} ${esc(r.name)}">${S.watch.has(r.id) ? '★' : '☆'}</button>
          <div class="nm">${esc(shortName(r))}<small>${esc(r.chamber === 'house' ? r.stateName : held)}</small></div>
          <div class="barcell"><div class="eb-split">${split(r)}</div><div class="eb-lead">${esc(lead)}</div></div>
          <div class="pin">${r.chamber === 'house' ? esc(held) : ''}</div>
          <div style="text-align:right">${badge(r)}</div>
        </div>`;
      }).join('') + (rs.length > S.limit ? `<button type="button" class="eb-more" data-more>Show ${Math.min(100, rs.length - S.limit)} more</button>` : '');
    }

    /* calls log */
    function renderLog() {
      const items = S.feed.filter(x => !S.byId || S.byId.has(x.race_id) || areaOfId(x.race_id));
      $('logcount').textContent = items.length ? `${items.filter(x => x.kind === 'call').length} calls` : '';
      if (!items.length) { $('log').innerHTML = `<div class="eb-empty">Calls appear here the moment they’re made.</div>`; return; }
      $('log').innerHTML = items.map(x => {
        const r = S.byId?.get(x.race_id);
        const key = `${x.race_id}|${x.kind}|${x.at}`;
        const p = x.party in PNAME ? x.party : 'O';
        const area = areaOfId(x.race_id);
        if (area) {
          const w = String(x.candidate || '').split(' | ').filter(Boolean);
          const mw = measureWord(w);
          const where = area === 'CAP' ? 'California' : area === 'LA' ? 'LA County' : 'Orange County';
          const lb = x.kind === 'retract' ? `Call withdrawn: ${esc(x.name || x.race_id)}<small>${esc(x.source || '')}</small>`
            : mw ? `${esc(String(x.name || x.race_id).replace(/:.*/, ''))} ${mw}<small>${esc(x.source || '')}, ${where}</small>`
            : `${esc(w.map(last).join(', ') || 'Call')} ${w.length > 1 ? 'win' : 'wins'} ${esc(x.name || x.race_id)}<small>${esc(x.source || '')}, ${where}</small>`;
          const col = x.kind === 'retract' ? 'var(--eb-muted)' : mw ? `var(--eb-${mw === 'passes' ? 'yes' : 'no'})` : 'var(--eb-lead)';
          return `<button type="button" data-race="${x.race_id}" class="${x.kind === 'retract' ? 'x' : ''} ${S.newKeys?.has(key) ? 'new' : ''}" style="border-left-color:${col}"><span class="t">${fmtHM(x.at)}</span><span class="w">${lb}</span></button>`;
        }
        const body = x.kind === 'retract'
          ? `Call withdrawn: ${esc(r ? shortName(r) : x.race_id)}<small>${esc(x.source || '')}</small>`
          : `${esc(last(x.candidate) || PNAME[p])} (${p}) wins ${esc(r ? shortName(r) : x.race_id)}<small>${esc(x.source || '')}${x.flip ? `, flips seat from ${r?.holder.party || '?'}` : ''}</small>`;
        return `<button type="button" data-race="${x.race_id}" class="${x.kind === 'retract' ? 'x' : ''} ${S.newKeys?.has(key) ? 'new' : ''}" style="border-left-color:${x.kind === 'retract' ? 'var(--eb-muted)' : `var(--${p})`}"><span class="t">${fmtHM(x.at)}</span><span class="w">${body}</span></button>`;
      }).join('');
    }

    /* detail */
    function renderLocalDetail(box, c) {
      const isProp = c.id.startsWith('CA-P');
      const area = areaOfId(c.id), L = S.areas[area];
      const mw = c.measure && measureWord(c.call?.winners);
      const callLine = c.call
        ? `<div class="eb-callline" style="background:${mw ? `var(--eb-${mw === 'passes' ? 'yes' : 'no'})` : 'var(--eb-lead)'}">${mw ? `${esc(isProp ? c.place : 'The measure')} ${mw}` : `${esc(c.call.winners.join(', '))} ${c.call.winners.length > 1 ? 'win' : 'wins'}`}<small>Called by ${esc(c.call.source)}${c.call.at ? ` at ${fmtT(c.call.at)}` : ''}${c.call.note ? `. ${esc(c.call.note)}` : ''}</small></div>`
        : `<div class="eb-callline wait">${c.total ? `Not called.${c.pctIn != null ? ` ${c.pctIn}% of precincts reporting.` : ''}` : c.unopposed ? 'Unopposed.' : 'No results yet.'}</div>`;
      const sub = [c.voteFor > 1 ? `Vote for ${c.voteFor}: the top ${c.voteFor} win` : '', c.incumbent && !c.measure ? (c.incumbentRunning ? `Incumbent: ${esc(c.incumbent)}` : `Open seat (${esc(c.incumbent)} isn’t on the ballot)`) : '', c.group === 'legislature' ? `${area === 'LA' ? 'LA County' : 'Orange County'} votes only` : '']
        .filter(Boolean).join('. ');
      const cand = ordered(c).map(x => `<div class="eb-cand"><span class="n">${esc(x.name)}${x.party ? ` <em>${PNAME[x.party] || x.party}</em>` : ''}${x.incumbent ? ' <em>incumbent</em>' : ''}${x.winner ? '<span class="win" aria-label="winner">✓</span>' : ''}</span>
          <span class="v">${x.pct != null ? `${x.pct}%` : ''}<small>${x.votes != null ? fmtN(x.votes) : ''}</small></span>
          <span class="b"><i style="width:${x.pct || 0}%;background:${localColor(c, x)}"></i></span></div>`).join('');
      box.innerHTML = `<div class="eb-detail">
        <button type="button" class="eb-sheetclose" data-act="closesheet" aria-label="Close">×</button>
        <h5>${esc(isProp ? `${c.place}: ${c.title}` : c.measure ? c.office : `${c.place}: ${c.office}`)}</h5>
        <div class="meta">${isProp
          ? `${esc(c.type)}. ${c.total && L?.generated ? `Numbers from the California Secretary of State, ${esc(fmtT(L.generated))}` : 'Results from the California Secretary of State after polls close'}`
          : area === 'LA' ? `${sub ? `${sub}. ` : ''}${c.total ? 'Numbers from the LA County Registrar-Recorder' : 'Results from the LA County Registrar-Recorder after polls close'}`
          : `${sub ? `${sub}. ` : ''}${L?.generated ? `Numbers from the OC Registrar of Voters, ${esc(fmtT(L.generated))}` : 'Results from the OC Registrar of Voters after polls close'}`}</div>
        ${callLine}${cand}
        ${isProp && c.oc ? ocHtml(c, L) : ''}
        ${isProp ? `<p class="eb-lnote">${esc(L?.note || 'Statewide propositions pass with a simple majority.')}</p>`
          : c.measure ? '<p class="eb-lnote">Most local measures pass with a simple majority; some taxes and bonds need 55% or two-thirds. Check the measure’s text.</p>' : ''}
        <div class="eb-actions">
          <button type="button" class="eb-btn" data-act="watch">${S.watch.has(c.id) ? 'Stop watching' : c.measure ? 'Watch this measure' : 'Watch this race'}</button>
          ${S.pub ? '' : '<button type="button" class="eb-btn" data-act="copypost">Copy post for X</button>'}
          <button type="button" class="eb-btn" data-act="copylink">Copy link</button>
        </div>
        ${S.token && !S.pub ? localDeskHtml(c) : ''}
      </div>`;
    }
    // How Orange County voted on a statewide proposition (the Secretary of State's Orange County file)
    function ocHtml(c, L) {
      const o = c.oc;
      if (!o?.total) return '<div class="eb-ocv"><b>Orange County</b><span>No Orange County count yet.</span></div>';
      const pct = L?.ocReporting?.pctIn;
      return `<div class="eb-ocv"><b>Orange County</b><span>Yes ${o.yesPct}% (${fmtN(o.yes)}) · No ${o.noPct}% (${fmtN(o.no)})${pct != null ? ` · ${pct}% of OC precincts in` : ''}</span>
        <span class="eb-ynbar"><i class="y" style="width:${o.yesPct}%"></i><i class="n"></i></span></div>`;
    }
    function localDeskHtml(c) {
      const p = S.pending && S.pending.raceId === c.id ? S.pending : null;
      const pre = c.call ? c.call.winners : c.total ? c.ahead : [];
      return `<div class="eb-desk"><h6>Desk</h6>
        ${p ? `<div class="eb-confirm">Publish this call? <b>${c.measure && measureWord(p.winners) ? `${esc(c.measure && c.id.startsWith('CA-P') ? c.place : c.name)} ${measureWord(p.winners)}` : `${esc(p.winners.join(', '))} ${p.winners.length > 1 ? 'win' : 'wins'} ${esc(c.name)}`}</b>, called by ${esc(p.source)}.
            <div class="eb-actions"><button type="button" class="eb-btn" data-act="lconfirm">Publish call</button><button type="button" class="eb-btn" data-act="cancelcall">Cancel</button></div></div>`
        : `<fieldset class="eb-pick"><legend>${c.measure ? 'Result' : `Winner${c.voteFor > 1 ? `s (pick ${c.voteFor})` : ''}`}</legend>
             ${ordered(c).map(x => [x, c.candidates.indexOf(x)]).map(([x, i]) => `<label><input type="${c.voteFor > 1 ? 'checkbox' : 'radio'}" name="eb-win" value="${i}"${pre.includes(x.name) ? ' checked' : ''}> ${esc(x.name)}${c.measure && isYes(x.name) ? ' (passes)' : c.measure && isNo(x.name) ? ' (fails)' : ''}</label>`).join('')}
           </fieldset>
           <label for="eb-src">Who made the call</label>
           <select id="eb-src" data-r="src">${SOURCES.map(s => `<option${s === S.deskSource ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
           <div class="eb-actions"><button type="button" class="eb-btn" data-act="lcall">${c.measure ? 'Call this measure' : 'Call this race'}</button></div>`}
        <div class="eb-actions">
          ${c.call ? '<button type="button" class="eb-btn warn" data-act="retract">Withdraw call</button>' : ''}
          ${c.deskOverride ? `<button type="button" class="eb-btn" data-act="clear">${c.deskOverride === 'withdrawn' ? 'Undo withdrawal' : 'Remove desk call'}</button>` : ''}
        </div>
      </div>`;
    }

    function renderDetail() {
      const box = $('detail');
      const lc = S.selected && S.localById.get(S.selected);
      const r = S.selected && S.byId?.get(S.selected);
      box.classList.toggle('eb-sheet', !!((r || lc) && S.sheetOpen));
      if (lc) return renderLocalDetail(box, lc);
      if (!r) { box.innerHTML = `<div class="eb-detail"><div class="eb-empty">${S.chamber === 'props' ? 'Select a proposition.' : isCounty(S.chamber) ? 'Select a race in the list.' : 'Select a race on the map or in the list.'}</div></div>`; return; }
      const cands = r.candidates.length ? r.candidates : r.preCandidates.map(c => ({ ...c, votes: null, pct: null }));
      const callLine = r.call
        ? `<div class="eb-callline" style="background:var(--${r.call.party in PNAME ? r.call.party : 'O'})">${esc(r.call.candidate || PFULL[r.call.party])} wins${r.flip ? `, flipping the seat from ${PFULL[r.holder.party] || 'its holder'}` : ''}<small>Called by ${esc(r.call.source)}${r.call.at ? ` at ${fmtT(r.call.at)}` : ''}${r.call.by === 'desk' ? ', entered by the desk' : ''}${r.call.note ? `. ${esc(r.call.note)}` : ''}</small></div>`
        : `<div class="eb-callline wait">${r.total ? `Not called. ${r.pctIn != null ? `${progress(r).replace(/^./, m => m.toUpperCase())}.` : ''}` : 'No results yet.'}</div>`;
      const candHtml = cands.map(c => {
        const p = c.party in PNAME ? c.party : 'O';
        return `<div class="eb-cand"><span class="n">${esc(c.name)} <em>${PNAME[p]}${c.incumbent ? ', incumbent' : ''}</em>${r.call && c.name === r.call.candidate ? '<span class="win" aria-label="winner">✓</span>' : ''}</span>
          <span class="v">${c.pct != null ? `${c.pct}%` : ''}<small>${c.votes != null ? fmtN(c.votes) : ''}</small></span>
          <span class="b"><i style="width:${c.pct || 0}%;background:var(--${p})"></i></span></div>`;
      }).join('') || '<div class="eb-empty">No candidates listed yet.</div>';
      box.innerHTML = `<div class="eb-detail">
        <button type="button" class="eb-sheetclose" data-act="closesheet" aria-label="Close">×</button>
        <h5>${esc(r.name)}</h5>
        <div class="meta">${r.holder.name ? `Held by ${esc(r.holder.name)} (${r.holder.party})${r.holder.open ? ', open seat' : ''}` : 'Vacant seat'}${r.source ? `. Numbers from ${esc(r.source)}${r.updated ? `, ${esc(fmtT(r.updated))}` : ''}` : ''}</div>
        ${callLine}${candHtml}
        <div class="eb-actions">
          <button type="button" class="eb-btn" data-act="watch">${S.watch.has(r.id) ? 'Stop watching' : 'Watch this race'}</button>
          ${S.pub ? '' : '<button type="button" class="eb-btn" data-act="copypost">Copy post for X</button>'}
          <button type="button" class="eb-btn" data-act="copylink">Copy link</button>
        </div>
        ${S.token && !S.pub ? deskHtml(r) : ''}
      </div>`;
    }

    function deskHtml(r) {
      const cands = r.candidates.length ? r.candidates : r.preCandidates;
      const opts = cands.length ? cands : [{ name: '', party: 'D' }, { name: '', party: 'R' }];
      const p = S.pending && S.pending.raceId === r.id ? S.pending : null;
      const manual = (r.candidates.length ? r.candidates : r.preCandidates.length ? r.preCandidates : opts);
      return `<div class="eb-desk"><h6>Desk</h6>
        ${p ? `<div class="eb-confirm">Publish this call to the board? <b>${esc(p.candidate || PFULL[p.party])} (${p.party}) wins ${esc(r.name)}</b>, called by ${esc(p.source)}.
            <div class="eb-actions"><button type="button" class="eb-btn ${p.party}" data-act="confirmcall">Publish call</button><button type="button" class="eb-btn" data-act="cancelcall">Cancel</button></div></div>`
        : `<label for="eb-src">Who made the call</label>
           <select id="eb-src" data-r="src">${SOURCES.map(s => `<option${s === S.deskSource ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
           <div class="eb-actions">${opts.map((c, i) => `<button type="button" class="eb-btn ${c.party in PNAME ? c.party : 'O'}" data-act="call" data-i="${i}">Call for ${esc(c.name ? last(c.name) : PNAME[c.party])}</button>`).join('')}</div>`}
        <div class="eb-actions">
          ${r.call ? '<button type="button" class="eb-btn warn" data-act="retract">Withdraw call</button>' : ''}
          ${r.deskOverride ? `<button type="button" class="eb-btn" data-act="clear">${r.deskOverride === 'withdrawn' ? 'Undo withdrawal' : 'Remove desk call'}</button>` : ''}
          <button type="button" class="eb-btn" data-act="manual">${S.manualOpen === r.id ? 'Hide vote entry' : 'Enter vote counts'}</button>
        </div>
        ${S.manualOpen === r.id ? `<div data-r="manual">
          ${manual.map((c, i) => `<div class="eb-grid3"><input aria-label="Candidate ${i + 1} name" value="${esc(c.name)}" data-m="name"><input aria-label="Party" value="${esc(c.party)}" data-m="party" maxlength="3"><input aria-label="Votes" inputmode="numeric" value="${c.votes ?? ''}" data-m="votes"></div>`).join('')}
          <label for="eb-pctin">Percent of expected vote counted</label><input id="eb-pctin" inputmode="decimal" value="${r.pctIn ?? ''}">
          <div class="eb-actions"><button type="button" class="eb-btn" data-act="savemanual">Save vote counts</button></div></div>` : ''}
      </div>`;
    }

    /* ── actions ── */
    function select(id, { sheet = true } = {}) {
      const r = S.byId?.get(id);
      if (!r && !S.localById.has(id)) return;
      S.selected = id; S.pending = null;
      // On narrow screens the race opens as a sheet; a tap on the map shows the county map first instead
      S.sheetOpen = sheet && window.matchMedia('(max-width:1100px)').matches;
      renderList(); renderDetail();
      if (S.chamber === 'props') renderMap();
      // Senate and governor races zoom the map into their state's counties
      if (r && r.chamber === 'house' && S.chamber === 'house') {
        if (S.zoomSt !== r.state) zoomTo(r.state);
        else { renderMap(); if (S.sub && S.sub.id !== id) zoomInto($('map').querySelector(`path[data-dist="${id}"]`)); }
      }
      if (r && r.chamber !== 'house' && r.chamber === S.chamber) {
        if (S.zoomSt === r.state) { if (S.countyData?.raceId !== r.id) { S.countyData = null; renderMap(); loadCounties().then(() => renderMap()); } }
        else zoomTo(r.state);
      }
    }
    function toggleWatch(id) {
      S.watch.has(id) ? S.watch.delete(id) : S.watch.add(id);
      store.set('watch', [...S.watch]);
      renderList(); renderDetail();
    }
    async function action(act, btn) {
      const r = S.selected && raceOf(S.selected);
      switch (act) {
        case 'sim': S.sim = !S.sim; store.set('sim', S.sim); S.seenFeed = null; S.countyData = null; S.queue = null; S.queueSeen = null; renderStatus(); renderBanner(); loadQueue(); return load();
        case 'chime': S.chime = !S.chime; store.set('chime', S.chime); if (S.chime) chime(); return renderStatus();
        case 'refresh': return load(true);
        case 'desk': return deskSignIn();
        case 'closesheet': S.sheetOpen = false; return renderDetail();
        case 'testwatch': {
          try {
            const r = await fetch(`${S.api}/v1/desk/watch`, { headers: { Authorization: `Bearer ${S.token}` }, cache: 'no-store' });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || r.status);
            const calls = j.recent.filter(x => x.call !== 'not a November call').length;
            toast(`Read ${j.posts} recent Decision Desk HQ posts: ${calls ? `${calls} look like November calls` : 'no November calls yet (expected before Nov 3)'}. The feed is working.`);
            console.info('[ElectionBoard] DDHQ feed check', j);
          } catch (e) { toast(`DDHQ feed check failed: ${e.message}`); }
          return;
        }
        case 'tools-alerts': S.tools = S.tools === 'alerts' ? null : 'alerts'; renderQueue(); if (S.tools) pushRefresh(); return;
        case 'tools-log': S.tools = S.tools === 'log' ? null : 'log'; renderQueue(); if (S.tools) logLoad(); return;
        case 'alerts-on': return alertsOn();
        case 'alerts-off': return alertsOff();
        case 'alerts-test': return alertsTest();
        case 'log-note': return logNote();
        case 'log-copy': return logCopy();
        case 'log-refresh': return logLoad();
        case 'opensheet': S.sheetOpen = true; return renderDetail();
        case 'watch': return toggleWatch(r.id);
        case 'copypost': return copy(areaOfId(r.id) ? localPost(r) : postText(r), 'Post copied');
        case 'copylink': { const u = new URL(location.href); u.search = `?race=${r.id}`; if (!u.hash) u.hash = '#elections'; return copy(u.toString(), 'Link copied'); }
        case 'call': {
          const src = root.querySelector('[data-r="src"]')?.value || S.deskSource;
          S.deskSource = src; store.set('deskSource', src);
          const opts = r.candidates.length ? r.candidates : r.preCandidates.length ? r.preCandidates : [{ party: 'D' }, { party: 'R' }];
          const c = opts[+btn.dataset.i];
          S.pending = { raceId: r.id, party: c.party in PNAME ? c.party : 'O', candidate: c.name || null, source: src };
          return renderDetail();
        }
        case 'cancelcall': S.pending = null; return renderDetail();
        case 'lcall': {
          const src = root.querySelector('[data-r="src"]')?.value || S.deskSource;
          S.deskSource = src; store.set('deskSource', src);
          const winners = [...root.querySelectorAll('input[name="eb-win"]:checked')].map(i => r.candidates[+i.value]?.name).filter(Boolean);
          if (!winners.length) { toast('Pick the winner first.'); return; }
          if (!r.measure && r.voteFor > 1 && winners.length !== r.voteFor && !confirm(`This race elects ${r.voteFor}, and ${winners.length} ${winners.length === 1 ? 'is' : 'are'} checked. Call it anyway?`)) return;
          S.pending = { raceId: r.id, winners, source: src };
          return renderDetail();
        }
        case 'lconfirm': {
          const p = S.pending; S.pending = null;
          return desk('call', { raceId: p.raceId, winners: p.winners, source: p.source }, 'Call published');
        }
        case 'confirmcall': {
          const p = S.pending; S.pending = null;
          return desk('call', { raceId: p.raceId, party: p.party, candidate: p.candidate, source: p.source }, 'Call published');
        }
        case 'retract':
          if (!confirm(`Withdraw the call in ${r.name}? The board will show it as not called.`)) return;
          return desk('retract', { raceId: r.id }, 'Call withdrawn');
        case 'clear': return desk('clear', { raceId: r.id }, 'Desk override removed');
        case 'manual': S.manualOpen = S.manualOpen === r.id ? null : r.id; return renderDetail();
        case 'savemanual': {
          const rows = [...root.querySelectorAll('[data-r="manual"] .eb-grid3')].map(g => ({
            name: g.querySelector('[data-m="name"]').value.trim(), party: g.querySelector('[data-m="party"]').value.trim(), votes: +g.querySelector('[data-m="votes"]').value.replace(/[^\d]/g, '') || 0,
          })).filter(c => c.name);
          const pct = root.querySelector('#eb-pctin').value;
          S.manualOpen = null;
          return desk('result', { raceId: r.id, pctIn: pct === '' ? null : +pct, candidates: rows }, 'Vote counts saved');
        }
      }
    }
    async function desk(path, body, okMsg) {
      try {
        const resp = await fetch(`${S.api}/v1/desk/${path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${S.token}` },
          body: JSON.stringify({ ...body, sim: S.sim }),
        });
        const j = await resp.json().catch(() => ({}));
        if (resp.status === 401) { S.token = ''; store.set('token', ''); toast('Desk sign-in expired. Sign in again.'); renderAll(); return; }
        if (!resp.ok) throw new Error(j.error || `Error ${resp.status}`);
        toast(okMsg + (S.sim ? ' (rehearsal)' : ''));
        await load(true);
        loadQueue();
      } catch (e) { toast(`Not saved: ${e.message}`); renderDetail(); }
    }
    async function deskSignIn() {
      if (S.token) { if (confirm('Sign out of desk mode on this device?')) { S.token = ''; store.set('token', ''); S.queue = null; renderAll(); renderQueue(); } return; }
      const t = prompt('Desk token (set on the Worker as DESK_TOKEN):');
      if (!t) return;
      const r = await fetch(`${S.api}/v1/desk/check`, { headers: { Authorization: `Bearer ${t.trim()}` } }).catch(() => null);
      if (r?.ok) { S.token = t.trim(); store.set('token', S.token); toast('Desk mode on'); renderAll(); loadQueue(); pushRefresh(); }
      else toast('That token didn’t work.');
    }

    function postText(r) {
      const tag = ' #Election2026';
      const pre = S.sim ? '[REHEARSAL, NOT REAL RESULTS] ' : '';
      if (r.call) {
        const who = `${r.call.candidate || PFULL[r.call.party]} (${r.call.party})`;
        const flip = r.flip ? `, a ${PADJ[r.call.party]} pickup from ${PFULL[r.holder.party] || 'the previous holder'}` : r.holder.party === r.call.party ? `, a ${PADJ[r.call.party]} hold` : '';
        return `${pre}🗳️ RACE CALL: ${who} wins ${longRaceName(r)}${flip}. Called by ${r.call.source}${r.pctIn != null ? ` with ${progress(r)}` : ''}.${tag}`;
      }
      if (r.total) {
        const top = r.candidates.slice(0, 2).map(c => `${c.name} (${c.party}) ${c.pct}%`).join(', ');
        return `${pre}🗳️ ${longRaceName(r).replace(/^the /, 'The ').replace(/^./, m => m.toUpperCase())}: ${top}${r.pctIn != null ? ` with ${progress(r)}` : ''}. No call yet.${tag}`;
      }
      return `${pre}🗳️ Watching ${longRaceName(r)}: ${r.preCandidates.map(c => `${c.name} (${c.party})`).join(' vs. ') || 'no results yet'}. Results after polls close.${tag}`;
    }
    function localPost(c) {
      const pre = S.sim ? '[REHEARSAL, NOT REAL RESULTS] ' : '';
      const isProp = c.id.startsWith('CA-P');
      const tag = isProp ? ' #CAprops #Election2026' : c.id.startsWith('LA-') ? ' #LAvotes #Election2026' : ' #OCvotes';
      const title = isProp ? `California ${c.place} (${c.office})` : c.measure ? c.name : `${c.place} ${c.office}`.replace(/^Orange County Supervisor/, 'OC Supervisor');
      const prog = c.pctIn != null ? ` with ${c.pctIn}% of precincts reporting${isProp ? ' statewide' : ''}` : '';
      const mw = c.measure && measureWord(c.call?.winners);
      if (isProp && !c.call && c.total) {
        const y = c.candidates.find(x => isYes(x.name)), n = c.candidates.find(x => isNo(x.name));
        return `${pre}🗳️ ${title}: Yes ${y.pct}%, No ${n.pct}%${prog}.${c.oc?.total ? ` Orange County: Yes ${c.oc.yesPct}%.` : ''} No call yet.${tag}`;
      }
      if (c.call && mw) return `${pre}🗳️ CALL: ${title} ${mw.toUpperCase()}. Called by ${c.call.source}${prog}.${tag}`;
      if (c.call) return c.measure
        ? `${pre}🗳️ RACE CALL: ${title}: ${c.call.winners[0]}. Called by ${c.call.source}${prog}.${tag}`
        : `${pre}🗳️ RACE CALL: ${c.call.winners.join(' and ')} ${c.call.winners.length > 1 ? 'win' : 'wins'} ${title}. Called by ${c.call.source}${prog}.${tag}`;
      if (c.total) return `${pre}🗳️ ${title}: ${c.candidates.slice(0, Math.max(2, c.voteFor + 1)).map(x => `${x.name} ${x.pct}%`).join(', ')}${prog}. No call yet.${tag}`;
      return `${pre}🗳️ Watching ${title}: ${c.candidates.map(x => x.name).join(' vs. ')}. Results after polls close at 8 p.m.${tag}`;
    }
    async function copy(text, msg) {
      try { await navigator.clipboard.writeText(text); toast(msg); }
      catch { prompt('Copy this:', text); }
    }
    /* ── Desk call queue (IntelHQ desk only: needs the desk token, never on the public page) ── */
    const queueCount = () => (S.queue?.items || []).filter(i => i.type !== 'unmatched').length;
    async function loadQueue() {
      if (!S.token || S.pub) { S.queue = null; renderQueue(); return; }
      try {
        const r = await fetch(`${S.api}/v1/desk/queue?sim=${S.sim ? 1 : 0}`, { headers: { Authorization: `Bearer ${S.token}` }, cache: 'no-store' });
        if (r.status === 401) { S.token = ''; store.set('token', ''); toast('Desk sign-in expired. Sign in again.'); S.queue = null; renderAll(); renderQueue(); return; }
        if (!r.ok) throw new Error(`Queue answered ${r.status}`);
        const q = await r.json();
        const keys = new Set(q.items.map(i => i.key));
        // Chime once for anything new (not on the first load)
        if (S.queueSeen && S.chime && q.items.some(i => !S.queueSeen.has(i.key) && i.type !== 'unmatched')) chime();
        S.queueSeen = new Set([...(S.queueSeen || []), ...keys]);
        S.queue = q; S.queueError = null;
      } catch (e) { S.queueError = e.message === 'Failed to fetch' ? 'Can’t reach the results service' : e.message; }
      renderQueue();
    }
    const ageMin = at => Math.max(0, Math.round((Date.now() - at) / 60000));
    const ageTxt = at => { const m = ageMin(at); return m < 1 ? 'just now' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
    const callWords = i => i.winners?.length && /^(yes|no)$/i.test(i.winners[0]) ? (/^yes$/i.test(i.winners[0]) ? 'passes' : 'fails') : null;
    const whoTxt = i => callWords(i) ? `${i.raceName.replace(/:.*/, '')} ${callWords(i)}` : `${i.winners?.length > 1 ? i.winners.join(', ') : i.candidate}${i.party ? ` (${i.party})` : ''}`;
    function renderQueue() {
      const box = $('queue');
      if (!box) return;
      const on = !!S.token && !S.pub;
      box.hidden = !on;
      const n = on ? queueCount() : 0;
      document.title = n ? `(${n}) ${S.baseTitle}` : S.baseTitle;
      const qb = root.querySelector('.eb-qbtn');
      if (qb) { qb.classList.toggle('on', !!n); qb.innerHTML = `Call queue${n ? ` <b>${n}</b>` : ''}`; }
      if (!on) return;
      const q = S.queue;
      const w = q?.watch;
      const ddhq = w?.held ? `Watching Decision Desk HQ from ${fmtStart(w.resultsStart)}` : w?.ddhq?.ok ? `Decision Desk HQ checked ${ago(w.ddhq.checkedAt)}` : w?.ddhq?.ok === false ? `Decision Desk HQ check failed: ${w.ddhq.error}` : 'Decision Desk HQ: waiting for first check';
      const ap = w?.ap?.enabled ? (w.ap.ok === false ? ` · AP check failed: ${w.ap.error}` : ' · AP on') : ' · AP off (no X key)';
      const items = q?.items || [];
      const body = !q ? `<div class="eb-empty">${esc(S.queueError || 'Loading the queue…')}</div>`
        : !items.length ? `<div class="eb-empty">Nothing waiting. Calls from Decision Desk HQ${w?.ap?.enabled ? ', AP' : ''} and races our counts say are decided show up here.</div>`
        : items.slice(0, 40).map(i => {
          const late = ageMin(i.at) >= 15 ? ' late2' : ageMin(i.at) >= 5 ? ' late' : '';
          const chip = i.type === 'conflict' ? `<span class="qchip conflict">Conflict · ${esc(i.sourceLabel)}</span>`
            : i.type === 'model' ? `<span class="qchip model ${i.confidence}">Model · ${i.confidence === 'high' ? 'High' : 'Medium'}</span>`
            : i.type === 'unmatched' ? `<span class="qchip">Couldn’t match · ${esc(i.sourceLabel)}</span>`
            : `<span class="qchip net">${esc(i.sourceLabel)}</span>`;
          const line = i.type === 'conflict' ? `${esc(i.sourceLabel)} projects <b>${esc(whoTxt(i))}</b>. Your board says ${esc(i.current)}.`
            : i.type === 'model' ? `Call it for <b>${esc(whoTxt(i))}</b>?`
            : i.type === 'unmatched' ? esc(i.text || '')
            : `${esc(i.sourceLabel)} projects <b>${esc(whoTxt(i))}</b>`;
          const why = i.type === 'model' ? esc(i.reason) : i.type === 'unmatched' ? esc(i.note || '') : '';
          const confirming = S.qConfirm === i.key;
          const pubLabel = confirming ? 'Tap again to publish' : i.type === 'conflict' ? 'Switch the call' : i.type === 'model' ? 'Publish as OC Scanner' : `Publish (${i.sourceLabel})`;
          return `<div class="eb-q ${i.type}${late}">
            <div class="qh">${chip}<span class="qage" title="${esc(new Date(i.at).toLocaleString())}">${ageTxt(i.at)}</span></div>
            ${i.raceId ? `<button type="button" class="qrace" data-qopen="${i.raceId}" data-qtab="${i.tab}">${esc(i.raceName)}</button>` : ''}
            <div class="qline">${line}</div>${why ? `<div class="qwhy">${why}</div>` : ''}
            <div class="qact">${i.raceId ? `<button type="button" class="eb-btn${confirming ? ' warn' : ''}" data-qpub="${esc(i.key)}">${pubLabel}</button>` : ''}<button type="button" class="eb-btn" data-qdis="${esc(i.key)}">Dismiss</button>${i.url ? `<a class="eb-btn" href="${esc(i.url)}" target="_blank" rel="noopener">Post</a>` : ''}</div>
          </div>`;
        }).join('') + (items.length > 40 ? `<div class="eb-empty">${items.length - 40} more below the fold — work the top ones first.</div>` : '');
      const bulk = bulkGroups(items);
      const bulkHtml = bulk.filter(g => g.keys.length > 1).map(g => `<button type="button" class="eb-btn" data-qbulk="${g.id}">${esc(g.label)} (${g.keys.length})</button>`).join('');
      box.innerHTML = `<h4>Call queue<small>${items.length ? `${queueCount()} waiting` : ''}</small></h4>
        ${bulkHtml ? `<div class="eb-qbulk">${bulkHtml}</div>` : ''}
        <div class="eb-qwatch">${esc(ddhq + ap)}${q?.simulation ? ' · <b>Rehearsal</b>' : ''} · <button type="button" class="eb-linkbtn" data-act="testwatch">Test DDHQ feed</button></div>
        ${toolsHtml()}
        <div class="eb-qlist">${body}</div>`;
    }

    /* ── Desk tools: phone alerts and the issue log (IntelHQ desk only) ── */
    const deskApi = async (method, path, body) => {
      const r = await fetch(`${S.api}/v1/desk/${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${S.token}` }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      return j;
    };
    const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const deviceLabel = () => {
      const u = navigator.userAgent;
      const dev = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) || isIOS() ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows PC' : 'Device';
      const br = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
      return `${dev}${br && !standalone() ? ` (${br})` : standalone() ? ' (Home Screen app)' : ''}`;
    };
    const keyBytes = b64 => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };
    S.push = S.push || { prefs: null, endpoint: null, info: null, busy: false };
    async function pushRefresh() {
      if (!S.token || S.pub) return;
      try {
        const [info, sub] = await Promise.all([deskApi('GET', 'push'), pushSupported() ? navigator.serviceWorker.getRegistration().then(r => r?.pushManager.getSubscription()) : null]);
        S.push.info = info;
        const mine = sub && info.devices.find(d => d.endpoint === sub.endpoint);
        S.push.endpoint = mine ? sub.endpoint : null;
        S.push.prefs = mine ? mine.prefs : S.push.prefs;
      } catch (e) { S.push.error = e.message === 'Failed to fetch' ? 'Can’t reach the results service' : e.message; }
      renderQueue();
    }
    async function alertsOn() {
      if (S.push.busy) return;
      S.push.busy = true; renderQueue();
      try {
        if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for IntelHQ in this browser’s settings');
        const reg = await navigator.serviceWorker.ready;
        const info = S.push.info || await deskApi('GET', 'push');
        let sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe().catch(() => {});                // start clean (it may belong to an old key)
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) });
        await deskApi('POST', 'push', { action: 'subscribe', subscription: sub.toJSON(), prefs: S.push.prefs || info.defaults || undefined, label: deviceLabel() });
        toast('Alerts are on for this device. A welcome alert is on its way.');
      } catch (e) { toast(`Alerts not turned on: ${e.message}`); }
      S.push.busy = false;
      pushRefresh();
    }
    async function alertsOff() {
      try {
        const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
        if (sub) { await deskApi('POST', 'push', { action: 'unsubscribe', endpoint: sub.endpoint }); await sub.unsubscribe(); }
        toast('Alerts are off for this device');
      } catch (e) { toast(`Couldn’t turn alerts off: ${e.message}`); }
      pushRefresh();
    }
    async function alertsTest() {
      try { const r = await deskApi('POST', 'push', { action: 'test', endpoint: S.push.endpoint }); toast(`Test alert sent${r.devices > 1 ? '' : ''}. It should arrive in a few seconds.`); }
      catch (e) { toast(`Test failed: ${e.message}`); }
    }
    async function alertsPref(k, on) {
      const prefs = { ...(S.push.prefs || {}), [k]: on };
      S.push.prefs = prefs;
      if (!S.push.endpoint) return renderQueue();
      try { await deskApi('POST', 'push', { action: 'prefs', endpoint: S.push.endpoint, prefs }); toast('Saved'); }
      catch (e) { toast(`Not saved: ${e.message}`); }
      pushRefresh();
    }
    async function logLoad() {
      try { S.issueLog = (await deskApi('GET', 'log')).entries; S.issueLogError = null; } catch (e) { S.issueLogError = e.message === 'Failed to fetch' ? 'Can’t reach the results service' : e.message; }
      renderQueue();
    }
    async function logNote() {
      const race = S.selected && raceOf(S.selected);
      const note = prompt(`What didn’t work?${race ? ` (tagged to ${race.id})` : ''}\nThis goes in the issue log for the 2028 rebuild.`);
      if (!note?.trim()) return;
      try { await deskApi('POST', 'log', { note: note.trim(), raceId: race?.id || null }); toast('Logged'); if (S.tools === 'log') logLoad(); }
      catch (e) { toast(`Not logged: ${e.message}`); }
    }
    async function logCopy() {
      try {
        const r = await fetch(`${S.api}/v1/desk/log?format=text`, { headers: { Authorization: `Bearer ${S.token}` }, cache: 'no-store' });
        if (!r.ok) throw new Error(`Error ${r.status}`);
        await copy(await r.text(), 'Issue log copied');
      } catch (e) { toast(`Couldn’t copy the log: ${e.message}`); }
    }
    function toolsHtml() {
      const on = !!S.push.endpoint;
      const row = `<div class="eb-qtools">
        <button type="button" class="eb-btn${S.tools === 'alerts' ? ' sel' : ''}" data-act="tools-alerts">Phone alerts: ${on ? '<b>on</b>' : 'off'}</button>
        <button type="button" class="eb-btn" data-act="log-note">Log issue</button>
        <button type="button" class="eb-btn${S.tools === 'log' ? ' sel' : ''}" data-act="tools-log">Issue log</button></div>`;
      if (S.tools === 'alerts') return row + `<div class="eb-qtool">${alertsHtml()}</div>`;
      if (S.tools === 'log') return row + `<div class="eb-qtool">${logHtml()}</div>`;
      return row;
    }
    function alertsHtml() {
      const info = S.push.info;
      if (!pushSupported()) {
        return isIOS() && !standalone()
          ? '<p>On iPhone, alerts work from the Home Screen app: tap <b>Share</b> → <b>Add to Home Screen</b>, open IntelHQ from the Home Screen, sign in to the desk there, and turn alerts on. (iOS 16.4 or later.)</p>'
          : '<p>This browser can’t receive alerts. Chrome, Edge or Firefox on a computer or Android phone, or IntelHQ added to an iPhone Home Screen, can.</p>';
      }
      if (!info) return `<p>${esc(S.push.error || 'Loading…')}</p>`;
      const prefs = S.push.prefs || info.defaults || {};
      const boxes = Object.entries(info.types).map(([k, label]) => `<label class="eb-qpref"><input type="checkbox" data-apref="${k}"${prefs[k] ? ' checked' : ''}> ${esc(label)}</label>`).join('');
      const others = info.devices.filter(d => d.endpoint !== S.push.endpoint);
      const list = info.devices.length ? `<p class="eb-qsmall">Alerts on: ${info.devices.map(d => esc(d.label) + (d.endpoint === S.push.endpoint ? ' (this one)' : '') + (d.lastError ? ` <span class="warnt">last alert failed: ${esc(d.lastError)}</span>` : '')).join(', ')}</p>` : '';
      const btns = S.push.endpoint
        ? '<button type="button" class="eb-btn" data-act="alerts-test">Send a test alert</button><button type="button" class="eb-btn" data-act="alerts-off">Turn off on this device</button>'
        : `<button type="button" class="eb-btn" data-act="alerts-on"${S.push.busy ? ' disabled' : ''}>${S.push.busy ? 'Turning on…' : 'Turn on alerts on this device'}</button>${others.length ? '<button type="button" class="eb-btn" data-act="alerts-test">Test the other devices</button>' : ''}`;
      return `<p>Your phone buzzes when something needs you, even with IntelHQ closed. Each alert opens the race here. Starts with results on Nov 3; send a test any time.</p>
        <div class="eb-qprefs">${boxes}</div><div class="eb-actions">${btns}</div>${list}`;
    }
    function logHtml() {
      if (!S.issueLog) return `<p>${esc(S.issueLogError || 'Loading…')}</p>`;
      const t = at => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const rows = S.issueLog.slice(0, 30).map(e => `<li><span class="qage">${t(e.at)}</span> <b>${esc(e.label)}</b> ${esc(e.title)}${e.detail ? `<div class="qwhy">${esc(e.detail.slice(0, 160))}</div>` : ''}</li>`).join('');
      return `<p>Everything that broke or needed a hand on election night, written automatically (feeds failing, calls that didn’t match, conflicts, counts typed in, withdrawn calls) plus your notes. After the election it becomes the 2028 rebuild list.</p>
        <div class="eb-actions"><button type="button" class="eb-btn" data-act="log-copy">Copy the whole log</button><button type="button" class="eb-btn" data-act="log-refresh">Refresh</button></div>
        ${rows ? `<ul class="eb-ilog">${rows}</ul>` : '<p class="eb-qsmall">Nothing logged yet.</p>'}${S.issueLog.length > 30 ? `<p class="eb-qsmall">${S.issueLog.length - 30} older entries are in the copied log.</p>` : ''}`;
    }
    // "Publish all" groups: DDHQ calls, AP calls, high-confidence model suggestions. Never conflicts.
    function bulkGroups(items) {
      return [
        { id: 'AP', label: 'Publish all AP calls', keys: items.filter(i => i.type === 'call' && i.source === 'AP').map(i => i.key) },
        { id: 'DDHQ', label: 'Publish all Decision Desk HQ calls', keys: items.filter(i => i.type === 'call' && i.source === 'DDHQ').map(i => i.key) },
        { id: 'MODEL', label: 'Publish all high-confidence model calls', keys: items.filter(i => i.type === 'model' && i.confidence === 'high').map(i => i.key) },
      ];
    }
    async function queueBulk(id) {
      const g = bulkGroups(S.queue?.items || []).find(x => x.id === id);
      if (!g?.keys.length) return;
      const names = (S.queue.items.filter(i => g.keys.includes(i.key)).slice(0, 12).map(i => `• ${i.raceName}: ${whoTxt(i)}`).join('\n'));
      const more = g.keys.length > 12 ? `\n…and ${g.keys.length - 12} more` : '';
      if (!confirm(`${g.label.replace('Publish all', 'Publish')}: ${g.keys.length} calls${S.sim ? ' (rehearsal)' : ''}?\n\n${names}${more}`)) return;
      try {
        const r = await fetch(`${S.api}/v1/desk/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${S.token}` }, body: JSON.stringify({ keys: g.keys, action: 'publish', sim: S.sim }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
        toast(`${j.done} calls published${j.failed?.length ? `, ${j.failed.length} skipped (the race changed; they stay in the queue)` : ''}${S.sim ? ' (rehearsal)' : ''}`);
      } catch (e) { toast(`Not saved: ${e.message}`); }
      await load(true);
      loadQueue();
    }
    let qConfirmTimer = 0;
    function queuePublish(key) {
      if (S.qConfirm !== key) {                        // two taps, so a stray tap can't publish
        S.qConfirm = key; renderQueue();
        clearTimeout(qConfirmTimer); qConfirmTimer = setTimeout(() => { S.qConfirm = null; renderQueue(); }, 5000);
        return;
      }
      S.qConfirm = null; clearTimeout(qConfirmTimer);
      return queueAct(key, 'publish', 'Call published');
    }
    async function queueAct(key, action, okMsg) {
      try {
        const r = await fetch(`${S.api}/v1/desk/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${S.token}` }, body: JSON.stringify({ key, action, sim: S.sim }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
        toast(okMsg + (S.sim ? ' (rehearsal)' : ''));
        if (S.queue) S.queue.items = S.queue.items.filter(i => i.key !== key);
        renderQueue();
        if (action === 'publish') await load(true);
        loadQueue();
      } catch (e) { toast(`Not saved: ${e.message}`); loadQueue(); }
    }
    function openRace(id, tab) {
      if (tab && tab !== S.chamber) { S.chamber = tab; store.set('chamber', tab); S.limit = 60; if (isArea(tab) && !AD()) loadLocal(AREA_OF[tab]).then(() => select(id)); renderAll(); }
      select(id);
      $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function toast(msg) {
      const t = document.createElement('div'); t.className = 'eb-toast'; t.textContent = msg; t.setAttribute('role', 'status');
      document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
    }
    let actx;
    function chime() {
      try {
        actx ||= new (window.AudioContext || window.webkitAudioContext)();
        const now = actx.currentTime;
        [880, 1320].forEach((f, i) => {
          const o = actx.createOscillator(), g = actx.createGain();
          o.frequency.value = f; o.type = 'sine';
          g.gain.setValueAtTime(0.0001, now + i * 0.14); g.gain.exponentialRampToValueAtTime(0.18, now + i * 0.14 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.35);
          o.connect(g).connect(actx.destination); o.start(now + i * 0.14); o.stop(now + i * 0.14 + 0.4);
        });
      } catch {}
    }

    /* ── start ── */
    renderAll();
    loadShapes();
    load();
    let timer = null;
    if (opts.autoRefresh !== false) {
      const every = (opts.refreshSeconds || 60) * 1000;
      timer = setInterval(() => { if (!document.hidden) load(); }, every);
      setInterval(() => { const a = $('ago'); if (a && !document.hidden && S.lastOk) a.textContent = `Updated ${ago(S.lastOk)}`; }, 5000);
    }
    // The desk's queue refreshes every 20 seconds, even in a background tab, so new calls chime
    loadQueue();
    pushRefresh();
    const qTimer = setInterval(() => { if (S.token && !S.pub) loadQueue(); }, 20000);
    setInterval(() => { if (S.queue && !document.hidden) renderQueue(); }, 30000);   // keep the ages current
    return {
      refresh: () => load(),
      destroy: () => { clearInterval(timer); clearInterval(qTimer); },
      get state() { return S; },
    };
  }

  window.ElectionBoard = { mount };
})();
