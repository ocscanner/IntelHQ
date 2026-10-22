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
  const TABS = [...CHAMBERS, ['local', 'Orange County']];
  const TAB_SHORT = { house: 'House', senate: 'Senate', governor: 'Gov.', local: 'OC' };
  const GROUP_ORDER = ['county', 'city', 'school', 'district', 'measure', 'legislature'];
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
  const last = name => { const parts = String(name || '').split(/\s+/).filter(p => !SUFFIX.test(p)); return parts[parts.length - 1] || name || ''; };
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
      pub: !!opts.publicMode,
      sim: opts.publicMode ? false : qs.get('sim') === '1' ? true : store.get('sim', !!opts.sim),
      chamber: /^OC-/i.test(qs.get('race') || '') ? 'local' : store.get('chamber', 'senate'),
      group: 'all', local: null, localById: new Map(),
      countyView: null, countyData: null, cshapes: new Map(),
      filter: 'all', sort: 'close', stateFilter: null, q: '', limit: 60,
      selected: qs.get('race') || null,
      watch: new Set(store.get('watch', [])),
      chime: store.get('chime', true),
      token: opts.publicMode ? '' : store.get('token', ''), deskSource: store.get('deskSource', 'OC Scanner desk'),
      data: null, feed: [], seenFeed: null, shapes: null, error: null, lastOk: 0, pending: null,
      sheetOpen: false,
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
          <div class="eb-panel"><h4>Latest calls<small data-r="logcount"></small></h4><div class="eb-log" data-r="log"></div></div>
          <div class="eb-panel eb-detailwrap" data-r="detail"></div>
        </div>
      </div>`;
    const $ = k => root.querySelector(`[data-r="${k}"]`);

    /* ── events ── */
    root.addEventListener('click', e => {
      const t = e.target.closest('button, [data-race], path[data-st]');
      if (!t || !root.contains(t)) return;
      if (t.dataset.chamber) {
        S.chamber = t.dataset.chamber; store.set('chamber', S.chamber); S.stateFilter = null; S.limit = 60; S.countyView = null; S.countyData = null;
        if (S.chamber === 'local' && !S.local) loadLocal();
        renderAll(); return;
      }
      if (t.dataset.group) { S.group = t.dataset.group; S.limit = 60; renderMap(); renderList(); return; }
      if (t.dataset.back != null) { S.countyView = null; S.countyData = null; renderMap(true); return; }
      if (t.dataset.filter) { S.filter = t.dataset.filter; S.limit = 60; renderTools(); renderList(); return; }
      if (t.dataset.sort) { S.sort = t.dataset.sort; renderTools(); renderList(); return; }
      if (t.dataset.clearstate != null) { S.stateFilter = null; renderTools(); renderList(); renderMap(); return; }
      if (t.dataset.st) { selectState(t.dataset.st); return; }
      if (t.dataset.star) { e.stopPropagation(); toggleWatch(t.dataset.star); return; }
      if (t.dataset.more != null) { S.limit += 100; renderList(); return; }
      if (t.dataset.act) { action(t.dataset.act, t); return; }
      if (t.dataset.race) { select(t.dataset.race); return; }
    });
    $('search').addEventListener('input', e => { S.q = e.target.value.trim().toLowerCase(); S.limit = 60; renderList(); });
    // One tooltip handler for both the US map and the county maps
    $('map').addEventListener('mousemove', e => {
      const box = $('map'), tip = box.querySelector('.eb-tip');
      if (!tip) return;
      const p = e.target.closest('path[data-st], path[data-fips]');
      if (!p) { tip.hidden = true; return; }
      const rect = box.getBoundingClientRect();
      tip.hidden = false; tip.textContent = p.dataset.st ? stateSummary(p.dataset.st) : countySummary(p.dataset.fips);
      tip.style.left = `${e.clientX - rect.left}px`; tip.style.top = `${e.clientY - rect.top}px`;
    });
    $('map').addEventListener('mouseleave', () => { const tip = $('map').querySelector('.eb-tip'); if (tip) tip.hidden = true; });
    root.addEventListener('keydown', e => {
      if (e.key === 'Escape' && S.sheetOpen) { S.sheetOpen = false; renderDetail(); }
      const row = e.target.closest?.('.eb-row');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(row.dataset.race); }
    });

    /* ── data ── */
    async function load(fresh) {
      if (S.loading) return; S.loading = true;
      const q = `${S.sim ? 'sim=1' : 'sim=0'}${fresh ? '&fresh=1' : ''}`;
      try {
        const [b, f, l] = await Promise.all([
          fetch(`${S.api}/v1/board?${q}`, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(`Results service answered ${r.status}`); return r.json(); }),
          fetch(`${S.api}/v1/feed?${S.sim ? 'sim=1' : 'sim=0'}&limit=60`, { cache: 'no-store' }).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] })),
          needLocal() ? fetchLocal(fresh) : null,
        ]);
        S.data = b; S.byId = new Map(b.races.map(r => [r.id, r])); S.error = null; S.lastOk = Date.now();
        if (l) setLocal(l);
        noteNewCalls(f.items || []);
        S.feed = f.items || [];
        opts.onHealth?.(true);
      } catch (e) {
        S.error = e.message === 'Failed to fetch' ? 'Can’t reach the results service. Check your connection; the board will retry.' : e.message;
        opts.onHealth?.(false, S.error);
      }
      S.loading = false;
      renderAll();
      if (S.countyView) { await loadCounties(); renderMap(); }
    }
    /* Orange County tab: only downloaded while it's open (or a local race is starred) */
    const needLocal = () => S.chamber === 'local' || [...S.watch].some(id => id.startsWith('OC-'));
    const fetchLocal = fresh => fetch(`${S.api}/v1/local?sim=${S.sim ? 1 : 0}${fresh ? '&fresh=1' : ''}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
    function setLocal(l) { S.local = l; S.localById = new Map(l.contests.map(c => [c.id, c])); }
    async function loadLocal() { const l = await fetchLocal(); if (l) { setLocal(l); renderAll(); } }
    const raceOf = id => S.byId?.get(id) || S.localById.get(id);

    /* County drill-down for Senate and governor races */
    async function openCounty(st, raceId) {
      if (S.countyView?.raceId === raceId) return;
      S.countyView = { st, raceId }; S.countyData = null;
      renderMap(true);
      await Promise.all([loadCountyShapes(st), loadCounties()]);
      renderMap(true);
    }
    async function loadCountyShapes(st) {
      if (S.cshapes.has(st)) return;
      try { const r = await fetch(`${S.countiesUrl}/${st}.json`); if (!r.ok) throw new Error(); S.cshapes.set(st, await r.json()); }
      catch { S.cshapes.set(st, null); }
    }
    async function loadCounties() {
      const v = S.countyView;
      if (!v) return;
      try {
        const d = await fetch(`${S.api}/v1/counties?race=${v.raceId}&sim=${S.sim ? 1 : 0}`, { cache: 'no-store' }).then(r => r.json());
        if (S.countyView === v) S.countyData = d;
      } catch { if (S.countyView === v) S.countyData = { available: false, reason: 'County results didn’t load. The board will try again on the next refresh.' }; }
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
      else if (S.chamber === 'local') {
        if (S.local && !S.sim && S.local.contests.every(c => c.status === 'waiting'))
          h += `<div class="eb-note">No Orange County results yet. The Registrar of Voters posts its first count after polls close at 8 p.m. on Nov 3; this tab picks up each update within about 10 minutes.</div>`;
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
      $('n-local').textContent = S.local ? `${S.local.contests.length} races` : '';
      const local = S.chamber === 'local';
      if (local && S.filter === 'flips') S.filter = 'all';
      root.querySelectorAll('[data-filter]').forEach(b => { b.setAttribute('aria-pressed', b.dataset.filter === S.filter); b.hidden = local && b.dataset.filter === 'flips'; });
      root.querySelectorAll('[data-sort]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sort === S.sort));
      root.querySelector('[data-sort="az"]').textContent = local ? 'By place' : 'By state';
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
      if (S.chamber === 'local') return renderLocalPanel();
      if (S.countyView && S.chamber !== 'house') return renderCountyMap(rebuild);
      const box = $('map');
      if (!S.shapes) { if (rebuild) { box.innerHTML = '<div class="eb-empty">The map didn’t load. Races are still listed below.</div>'; box.dataset.mode = ''; } return; }
      if (rebuild || box.dataset.mode !== 'us') {
        box.dataset.mode = 'us';
        const stripes = p => `<pattern id="eb-flip-${p}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" style="fill:var(--${p})"/><rect width="2.4" height="7" fill="rgba(255,255,255,.55)"/></pattern>`;
        const paths = Object.entries(S.shapes.shapes).map(([st, s]) => `<path data-st="${st}" d="${s.d}" tabindex="-1"><title>${st}</title></path>`).join('');
        const labels = Object.entries(S.shapes.shapes).filter(([st]) => !SMALL.has(st)).map(([st, s]) => `<text x="${s.c[0]}" y="${s.c[1]}">${st}</text>`).join('');
        box.innerHTML = `<svg viewBox="${S.shapes.viewBox}" role="img" aria-label="Results map by state"><defs>${['D', 'R', 'I', 'O'].map(stripes).join('')}</defs><g>${paths}</g><g>${labels}</g></svg><div class="eb-tip" hidden></div>`;
      }
      box.querySelectorAll('path[data-st]').forEach(p => {
        const st = p.dataset.st; const f = stateFill(st);
        p.setAttribute('class', [f.cls, S.stateFilter === st ? 'sel' : '', S.stateFilter && S.stateFilter !== st ? 'dim' : ''].filter(Boolean).join(' '));
        p.style.fill = f.fill || '';
        p.querySelector('title').textContent = stateSummary(st);
      });
      $('key').innerHTML = `${S.chamber !== 'house' ? '<span class="eb-hint">Select a state to see its counties.</span>' : ''}<span><i style="background:var(--D)"></i>Dem won</span><span><i style="background:var(--Dt)"></i>Dem leading</span><span><i style="background:var(--Rt)"></i>Rep leading</span><span><i style="background:var(--R)"></i>Rep won</span><span><i style="background:var(--I)"></i>Ind</span>${S.chamber !== 'house' ? '<span><i style="background:url(#)" class="kflip"></i>Striped: flipped seat</span>' : '<span>State color: party ahead in most seats</span>'}<span><i style="background:var(--eb-wait)"></i>No results yet</span><span><i style="border:1px dashed var(--eb-muted)"></i>No race</span>`;
      const k = $('key').querySelector('.kflip');
      if (k) k.style.background = 'repeating-linear-gradient(45deg,var(--R) 0 3px,rgba(255,255,255,.6) 3px 5px)';
    }

    /* county map */
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
      const name = S.cshapes.get(S.countyView?.st)?.counties?.[fips]?.n || fips;
      const d = S.countyData, c = d?.counties?.[fips];
      const tot = c ? c.v.reduce((a, b) => a + b, 0) : 0;
      if (!tot) return `${name}: no votes counted yet`;
      const parts = c.v.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 3)
        .map(([v, i]) => `${last(d.cands[i].name)} ${(v / tot * 100).toFixed(1)}%`);
      return `${name}: ${parts.join(', ')}${c.pct != null ? ` (${Math.round(c.pct)}% in)` : ''}`;
    }
    function renderCountyMap(rebuild) {
      const box = $('map');
      const v = S.countyView, r = S.byId?.get(v.raceId), shp = S.cshapes.get(v.st);
      const bar = `<div class="eb-cbar"><button type="button" class="eb-back" data-back>← All states</button><b>${esc(r?.name || v.st)} by county</b><button type="button" class="eb-back eb-narrow" data-act="opensheet">Race details</button></div>`;
      if (shp === undefined) { box.innerHTML = `${bar}<div class="eb-empty">Loading counties…</div>`; box.dataset.mode = ''; return; }
      if (shp === null) { box.innerHTML = `${bar}<div class="eb-empty">The county map didn’t load.</div>`; box.dataset.mode = ''; return; }
      const mode = `county:${v.raceId}`;
      if (rebuild || box.dataset.mode !== mode) {
        box.dataset.mode = mode;
        const paths = Object.entries(shp.counties).map(([f, c]) => `<path data-fips="${f}" d="${c.d}"><title>${esc(c.n)}</title></path>`).join('');
        box.innerHTML = `${bar}<svg class="eb-cmap" viewBox="${shp.viewBox}" role="img" aria-label="${esc(r?.name || '')} results by county"><g>${paths}</g></svg><div class="eb-cnote" data-r="cnote" hidden></div><div class="eb-tip" hidden></div>`;
      }
      box.querySelectorAll('path[data-fips]').forEach(p => { p.style.fill = countyFill(p.dataset.fips); p.querySelector('title').textContent = countySummary(p.dataset.fips); });
      const d = S.countyData;
      const has = d?.counties && Object.values(d.counties).some(c => c.v.some(x => x > 0));
      let note = '';
      if (!d) note = 'Loading county results…';
      else if (!d.available) note = S.pub && d.off ? 'County-by-county results aren’t available for this race yet.' : S.pub ? 'County-by-county results aren’t available for this state.' : d.reason || 'No county results for this race.';
      else if (!has) note = S.sim ? 'Rehearsal counties fill in as the fake count starts.' : 'County results appear here once counting starts.';
      const n = box.querySelector('[data-r="cnote"]');
      n.hidden = !note; n.textContent = note;
      $('key').innerHTML = has
        ? `${d.cands.slice(0, 4).map((c, i) => `<span><i style="background:${countyColor(i)}"></i>${esc(last(c.name))} ahead</span>`).join('')}<span>Stronger color = wider lead</span><span><i style="background:var(--eb-wait)"></i>No votes yet</span>${d.simulation ? '<span><b>Rehearsal data</b></span>' : ''}`
        : '<span>Counties are colored by who’s ahead; the stronger the color, the wider the lead.</span>';
    }

    /* Orange County panel (in place of the map) */
    function localCounts() {
      const n = { all: 0 };
      for (const c of S.local?.contests || []) { n.all++; n[c.group] = (n[c.group] || 0) + 1; }
      return n;
    }
    function renderLocalPanel() {
      const box = $('map');
      box.dataset.mode = 'local';
      const L = S.local;
      if (!L) { box.innerHTML = '<div class="eb-empty">Loading Orange County races…</div>'; $('key').innerHTML = ''; return; }
      const n = localCounts();
      const groups = [{ key: 'all', label: 'All' }, ...GROUP_ORDER.map(k => L.groups.find(g => g.key === k)).filter(Boolean)].filter(g => g.key === 'all' || n[g.key]);
      const turnout = L.ballotsCast != null && L.registered ? `${fmtN(L.ballotsCast)} ballots counted of ${fmtN(L.registered)} registered voters (${(L.ballotsCast / L.registered * 100).toFixed(1)}%)` : '';
      const upd = L.generated ? `Registrar update ${fmtT(L.generated)}` : '';
      const gnote = L.groups.find(g => g.key === S.group)?.note;
      box.innerHTML = `<div class="eb-local">
        <div class="eb-lhead"><h4>Orange County local races</h4><span>${esc([turnout, upd].filter(Boolean).join(' · ') || 'Nov 3 ballot: county, cities, schools and special districts')}</span></div>
        <div class="eb-groups" role="group" aria-label="Kind of race">${groups.map(g => `<button type="button" data-group="${g.key}" aria-pressed="${S.group === g.key}">${esc(g.label)} <span>${n[g.key]}</span></button>`).join('')}</div>
        ${gnote ? `<p class="eb-lnote">${esc(gnote)}</p>` : ''}
      </div>`;
      $('key').innerHTML = `<span>Unofficial results from the ${esc(L.source)}. After election night the Registrar updates weekdays at 5 p.m. until the count is certified.</span>${L.simulation ? '<span><b>Rehearsal data</b></span>' : ''}`;
    }

    function selectState(st) {
      if (!(S.data?.races || []).some(r => r.state === st && r.chamber === S.chamber)) return;
      if (S.chamber !== 'house') { const r = S.data.races.find(x => x.state === st && x.chamber === S.chamber); select(r.id, { sheet: false }); return; }
      S.stateFilter = S.stateFilter === st ? null : st; S.limit = 60;
      renderTools(); renderMap(); renderList();
    }

    /* list */
    function visibleLocal() {
      let rs = S.local?.contests || [];
      if (S.group !== 'all') rs = rs.filter(c => c.group === S.group);
      if (S.q) rs = rs.filter(c => `${c.name} ${c.place} ${c.office} ${c.candidates.map(x => x.name).join(' ')}`.toLowerCase().includes(S.q));
      const f = S.filter;
      if (f === 'close') rs = rs.filter(c => !c.call && c.total > 0 && c.margin != null && c.margin < CLOSE_PTS);
      if (f === 'called') rs = rs.filter(c => c.call);
      if (f === 'uncalled') rs = rs.filter(c => !c.call);
      if (f === 'watch') rs = rs.filter(c => S.watch.has(c.id));
      const g = c => GROUP_ORDER.indexOf(c.group);
      const byPlace = (a, b) => g(a) - g(b) || a.place.localeCompare(b.place) || a.office.localeCompare(b.office, undefined, { numeric: true });
      const rank = c => c.status === 'counting' ? 0 : c.status === 'called' ? 1 : 2;
      return rs.slice().sort(S.sort === 'az' ? byPlace : (a, b) => rank(a) - rank(b) || (rank(a) === 0 ? (a.margin ?? 99) - (b.margin ?? 99) : 0) || byPlace(a, b));
    }
    function visibleRaces() {
      if (S.chamber === 'local') return visibleLocal();
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
    function localColor(c, x) {
      if (c.measure) return isYes(x.name) ? 'var(--eb-yes)' : isNo(x.name) ? 'var(--eb-no)' : 'var(--Ot)';
      if (c.call) return x.winner ? 'var(--eb-lead)' : 'var(--Ot)';
      return c.ahead.includes(x.name) ? 'var(--eb-leadt)' : 'var(--Ot)';
    }
    function localLead(c) {
      if (c.call) return `${c.call.winners.join(', ')} ${c.call.winners.length > 1 ? 'win' : 'wins'}`;
      if (!c.total) return c.unopposed ? `Unopposed: ${c.candidates.map(x => x.name).join(', ')}` : c.candidates.map(x => last(x.name)).slice(0, 4).join(' vs. ') + (c.candidates.length > 4 ? ` +${c.candidates.length - 4} more` : '');
      const inN = c.pctIn != null ? `, ${c.pctIn}% in` : '';
      if (c.measure) { const y = c.candidates.find(x => isYes(x.name)); return `Yes ${y?.pct ?? '–'}%${inN}`; }
      if (c.voteFor > 1) return `Top ${c.voteFor}: ${c.ahead.map(last).join(', ')}${inN}`;
      return c.margin != null ? `${last(c.ahead[0])} leads by ${c.margin} pts${inN}` : `${c.ahead[0]} unopposed`;
    }
    function localBadge(c) {
      if (c.call) return '<span class="eb-badge L">Called</span>';
      if (c.total) return `<span class="eb-badge count">${c.pctIn != null ? `${Math.round(c.pctIn)}% in` : 'Counting'}</span>`;
      return '<span class="eb-badge wait">No results</span>';
    }
    function renderLocalList(rs) {
      const glabel = S.group === 'all' ? 'Orange County races' : (S.local?.groups.find(g => g.key === S.group)?.label || 'Races');
      $('listtitle').textContent = glabel;
      $('listcount').textContent = `${rs.length} shown`;
      if (!S.local) { $('list').innerHTML = '<div class="eb-empty">Loading races…</div>'; return; }
      if (!rs.length) {
        const why = { close: 'No uncalled race is within 5 points right now.', called: 'Nothing has been called yet.', watch: 'Star a race to keep it here.', uncalled: 'Every race here has been called.' }[S.filter] || 'No race matches your search.';
        $('list').innerHTML = `<div class="eb-empty">${why}</div>`; return;
      }
      $('list').innerHTML = rs.slice(0, S.limit).map(c => `<div class="eb-row${S.selected === c.id ? ' sel' : ''}" data-race="${c.id}" role="button" tabindex="0">
          <button type="button" class="eb-star" data-star="${c.id}" aria-pressed="${S.watch.has(c.id)}" aria-label="${S.watch.has(c.id) ? 'Stop watching' : 'Watch'} ${esc(c.name)}">${S.watch.has(c.id) ? '★' : '☆'}</button>
          <div class="nm">${esc(c.place)}<small>${esc(c.office)}</small></div>
          <div class="barcell"><div class="eb-split">${c.total ? c.candidates.map(x => `<i style="width:${x.pct}%;background:${localColor(c, x)}" title="${esc(x.name)} ${x.pct}%"></i>`).join('') : ''}</div><div class="eb-lead">${esc(localLead(c))}</div></div>
          <div class="pin">${c.voteFor > 1 ? `Top ${c.voteFor} win` : c.incumbentRunning ? 'Incumbent running' : c.incumbent && !c.measure ? 'Open seat' : ''}</div>
          <div style="text-align:right">${localBadge(c)}</div>
        </div>`).join('') + (rs.length > S.limit ? `<button type="button" class="eb-more" data-more>Show ${Math.min(100, rs.length - S.limit)} more</button>` : '');
    }

    function renderList() {
      const rs = visibleRaces();
      if (S.chamber === 'local') return renderLocalList(rs);
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
      const items = S.feed.filter(x => !S.byId || S.byId.has(x.race_id) || x.race_id.startsWith('OC-'));
      $('logcount').textContent = items.length ? `${items.filter(x => x.kind === 'call').length} calls` : '';
      if (!items.length) { $('log').innerHTML = `<div class="eb-empty">Calls appear here the moment they’re made.</div>`; return; }
      $('log').innerHTML = items.map(x => {
        const r = S.byId?.get(x.race_id);
        const key = `${x.race_id}|${x.kind}|${x.at}`;
        const p = x.party in PNAME ? x.party : 'O';
        if (x.race_id.startsWith('OC-')) {
          const w = String(x.candidate || '').split(' | ').filter(Boolean);
          const lb = x.kind === 'retract' ? `Call withdrawn: ${esc(x.name || x.race_id)}<small>${esc(x.source || '')}</small>`
            : `${esc(w.map(last).join(', ') || 'Call')} ${w.length > 1 ? 'win' : 'wins'} ${esc(x.name || x.race_id)}<small>${esc(x.source || '')}, Orange County</small>`;
          return `<button type="button" data-race="${x.race_id}" class="${x.kind === 'retract' ? 'x' : ''} ${S.newKeys?.has(key) ? 'new' : ''}" style="border-left-color:${x.kind === 'retract' ? 'var(--eb-muted)' : 'var(--eb-lead)'}"><span class="t">${fmtHM(x.at)}</span><span class="w">${lb}</span></button>`;
        }
        const body = x.kind === 'retract'
          ? `Call withdrawn: ${esc(r ? shortName(r) : x.race_id)}<small>${esc(x.source || '')}</small>`
          : `${esc(last(x.candidate) || PNAME[p])} (${p}) wins ${esc(r ? shortName(r) : x.race_id)}<small>${esc(x.source || '')}${x.flip ? `, flips seat from ${r?.holder.party || '?'}` : ''}</small>`;
        return `<button type="button" data-race="${x.race_id}" class="${x.kind === 'retract' ? 'x' : ''} ${S.newKeys?.has(key) ? 'new' : ''}" style="border-left-color:${x.kind === 'retract' ? 'var(--eb-muted)' : `var(--${p})`}"><span class="t">${fmtHM(x.at)}</span><span class="w">${body}</span></button>`;
      }).join('');
    }

    /* detail */
    function renderLocalDetail(box, c) {
      const L = S.local;
      const callLine = c.call
        ? `<div class="eb-callline" style="background:var(--eb-lead)">${esc(c.call.winners.join(', '))} ${c.call.winners.length > 1 ? 'win' : 'wins'}<small>Called by ${esc(c.call.source)}${c.call.at ? ` at ${fmtT(c.call.at)}` : ''}${c.call.note ? `. ${esc(c.call.note)}` : ''}</small></div>`
        : `<div class="eb-callline wait">${c.total ? `Not called.${c.pctIn != null ? ` ${c.pctIn}% of precincts reporting.` : ''}` : c.unopposed ? 'Unopposed.' : 'No results yet.'}</div>`;
      const sub = [c.voteFor > 1 ? `Vote for ${c.voteFor}: the top ${c.voteFor} win` : '', c.incumbent && !c.measure ? (c.incumbentRunning ? `Incumbent: ${esc(c.incumbent)}` : `Open seat (${esc(c.incumbent)} isn’t on the ballot)`) : '', c.group === 'legislature' ? 'Orange County votes only' : '']
        .filter(Boolean).join('. ');
      const cand = c.candidates.map(x => `<div class="eb-cand"><span class="n">${esc(x.name)}${x.party ? ` <em>${PNAME[x.party] || x.party}</em>` : ''}${x.incumbent ? ' <em>incumbent</em>' : ''}${x.winner ? '<span class="win" aria-label="winner">✓</span>' : ''}</span>
          <span class="v">${x.pct != null ? `${x.pct}%` : ''}<small>${x.votes != null ? fmtN(x.votes) : ''}</small></span>
          <span class="b"><i style="width:${x.pct || 0}%;background:${localColor(c, x)}"></i></span></div>`).join('');
      box.innerHTML = `<div class="eb-detail">
        <button type="button" class="eb-sheetclose" data-act="closesheet" aria-label="Close">×</button>
        <h5>${esc(c.measure ? c.office : `${c.place}: ${c.office}`)}</h5>
        <div class="meta">${sub ? `${sub}. ` : ''}${L?.generated ? `Numbers from the OC Registrar of Voters, ${esc(fmtT(L.generated))}` : 'Results from the OC Registrar of Voters after polls close'}</div>
        ${callLine}${cand}
        ${c.measure ? '<p class="eb-lnote">Most local measures pass with a simple majority; some taxes and bonds need 55% or two-thirds. Check the measure’s text.</p>' : ''}
        <div class="eb-actions">
          <button type="button" class="eb-btn" data-act="watch">${S.watch.has(c.id) ? 'Stop watching' : 'Watch this race'}</button>
          ${S.pub ? '' : '<button type="button" class="eb-btn" data-act="copypost">Copy post for X</button>'}
          <button type="button" class="eb-btn" data-act="copylink">Copy link</button>
        </div>
        ${S.token && !S.pub ? localDeskHtml(c) : ''}
      </div>`;
    }
    function localDeskHtml(c) {
      const p = S.pending && S.pending.raceId === c.id ? S.pending : null;
      const pre = c.call ? c.call.winners : c.total ? c.ahead : [];
      return `<div class="eb-desk"><h6>Desk</h6>
        ${p ? `<div class="eb-confirm">Publish this call? <b>${esc(p.winners.join(', '))} ${p.winners.length > 1 ? 'win' : 'wins'} ${esc(c.name)}</b>, called by ${esc(p.source)}.
            <div class="eb-actions"><button type="button" class="eb-btn" data-act="lconfirm">Publish call</button><button type="button" class="eb-btn" data-act="cancelcall">Cancel</button></div></div>`
        : `<fieldset class="eb-pick"><legend>${c.measure ? 'Result' : `Winner${c.voteFor > 1 ? `s (pick ${c.voteFor})` : ''}`}</legend>
             ${c.candidates.map((x, i) => `<label><input type="${c.voteFor > 1 ? 'checkbox' : 'radio'}" name="eb-win" value="${i}"${pre.includes(x.name) ? ' checked' : ''}> ${esc(x.measure ? x.name : x.name)}</label>`).join('')}
           </fieldset>
           <label for="eb-src">Who made the call</label>
           <select id="eb-src" data-r="src">${SOURCES.map(s => `<option${s === S.deskSource ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
           <div class="eb-actions"><button type="button" class="eb-btn" data-act="lcall">Call this race</button></div>`}
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
      if (!r) { box.innerHTML = `<div class="eb-detail"><div class="eb-empty">${S.chamber === 'local' ? 'Select a race in the list.' : 'Select a race on the map or in the list.'}</div></div>`; return; }
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
      // Senate and governor races open their county map
      if (r && r.chamber !== 'house' && r.chamber === S.chamber) openCounty(r.state, r.id);
    }
    function toggleWatch(id) {
      S.watch.has(id) ? S.watch.delete(id) : S.watch.add(id);
      store.set('watch', [...S.watch]);
      renderList(); renderDetail();
    }
    async function action(act, btn) {
      const r = S.selected && raceOf(S.selected);
      switch (act) {
        case 'sim': S.sim = !S.sim; store.set('sim', S.sim); S.seenFeed = null; S.countyData = null; renderStatus(); renderBanner(); return load();
        case 'chime': S.chime = !S.chime; store.set('chime', S.chime); if (S.chime) chime(); return renderStatus();
        case 'refresh': return load(true);
        case 'desk': return deskSignIn();
        case 'closesheet': S.sheetOpen = false; return renderDetail();
        case 'opensheet': S.sheetOpen = true; return renderDetail();
        case 'watch': return toggleWatch(r.id);
        case 'copypost': return copy(r.id.startsWith('OC-') ? localPost(r) : postText(r), 'Post copied');
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
      } catch (e) { toast(`Not saved: ${e.message}`); renderDetail(); }
    }
    async function deskSignIn() {
      if (S.token) { if (confirm('Sign out of desk mode on this device?')) { S.token = ''; store.set('token', ''); renderAll(); } return; }
      const t = prompt('Desk token (set on the Worker as DESK_TOKEN):');
      if (!t) return;
      const r = await fetch(`${S.api}/v1/desk/check`, { headers: { Authorization: `Bearer ${t.trim()}` } }).catch(() => null);
      if (r?.ok) { S.token = t.trim(); store.set('token', S.token); toast('Desk mode on'); renderAll(); }
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
      const tag = ' #OCvotes';
      const title = c.measure ? c.name : `${c.place} ${c.office}`.replace(/^Orange County Supervisor/, 'OC Supervisor');
      const prog = c.pctIn != null ? ` with ${c.pctIn}% of precincts reporting` : '';
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
    return {
      refresh: () => load(),
      destroy: () => clearInterval(timer),
      get state() { return S; },
    };
  }

  window.ElectionBoard = { mount };
})();
