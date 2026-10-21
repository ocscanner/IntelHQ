// Scheduled ingest: downloads state files on a timer and saves results per race.
// Runs from the Worker's cron trigger. Viewers never cause downloads from state servers.
import { enabledAdapters } from './feeds/states.js';

export const USER_AGENT = 'Mozilla/5.0 (compatible; OCScannerElectionWire/1.0; +https://ocscanner.news)';

class BudgetError extends Error { constructor() { super('Download budget for this run used up'); this.budget = true; } }
class HttpError extends Error { constructor(status, url) { super(`HTTP ${status}`); this.status = status; this.url = url; } }

export function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

/** Every unit from the enabled adapters, with its state and label attached. */
export function allUnits(env) {
  return enabledAdapters(env).flatMap(a => a.units.map((u, i) => ({ ...u, order: u.order ?? i, st: a.st, label: a.label, confidence: a.confidence })));
}

/**
 * Run due units until the download budget is spent.
 * @param {object} o
 * @param {object} o.env
 * @param {{races:object[]}} o.universe
 * @param {object} o.store       storage (see d1Store / memoryStore)
 * @param {Function} [o.fetchImpl]
 * @param {number} [o.now]
 * @param {boolean} [o.force]    ignore the refresh interval
 * @param {string[]} [o.only]    limit to these states
 * @param {boolean} [o.dryRun]   parse but don't save (desk preview)
 */
export async function runIngest({ env, universe, store, fetchImpl = fetch, now = Date.now(), force = false, only = null, dryRun = false }) {
  const budget = Math.max(1, +(env.SUBREQUEST_BUDGET || 45));
  const minGap = Math.max(1, +(env.MIN_REFRESH_MINUTES || 9)) * 60000;
  const ids = new Set(universe.races.map(r => r.id));
  const races = new Map(universe.races.map(r => [r.id, r]));
  let used = 0;

  const rewrite = url => env.FEED_PROXY_BASE ? `${env.FEED_PROXY_BASE.replace(/\/$/, '')}/${url.replace(/^https?:\/\//, '')}` : url;
  async function get(url, { conditional = false, allow404 = false, etags } = {}) {
    if (used >= budget) throw new BudgetError();
    used++;
    const headers = { 'User-Agent': USER_AGENT, Accept: '*/*' };
    const prev = conditional && etags?.[url];
    if (prev?.etag) headers['If-None-Match'] = prev.etag;
    if (prev?.lm) headers['If-Modified-Since'] = prev.lm;
    const resp = await fetchImpl(rewrite(url), { headers, cf: { cacheTtl: 0 } });
    if (resp.status === 304) return { notModified: true };
    if (resp.status === 404 && allow404) return { missing: true };
    if (!resp.ok) throw new HttpError(resp.status, url);
    if (conditional && etags) etags[url] = { etag: resp.headers.get('etag'), lm: resp.headers.get('last-modified') };
    return { resp };
  }
  const ctxFor = meta => {
    meta.etags ||= {};
    return {
      meta, ids, races,
      async text(url, o = {}) {
        const r = await get(url, { ...o, etags: meta.etags });
        if (r.notModified) return null;
        if (r.missing) return undefined;
        return r.resp.text();
      },
      async json(url, o = {}) {
        const r = await get(url, { ...o, etags: meta.etags });
        if (r.notModified) return null;
        if (r.missing) return undefined;
        return JSON.parse(await r.resp.text());
      },
      async bytes(url, o = {}) {
        const r = await get(url, { ...o, etags: meta.etags });
        return new Uint8Array(await r.resp.arrayBuffer());
      },
    };
  };

  let units = allUnits(env);
  if (only) units = units.filter(u => only.includes(u.st));
  const state = await store.loadUnits();
  const due = units
    .map(u => ({ u, last: state.get(u.id)?.fetched_at || 0 }))
    .filter(x => force || now - x.last >= minGap)
    .sort((a, b) => a.last - b.last || a.u.order - b.u.order || a.u.st.localeCompare(b.u.st))
    .map(x => x.u);

  const report = [];
  const results = [];             // { raceId, payload }
  for (const u of due) {
    const left = budget - used;
    if (left <= 0) break;
    if (u.requests > left && u.requests <= budget) continue;          // try a smaller unit; this one runs next time
    const prev = state.get(u.id);
    const meta = JSON.parse(JSON.stringify(prev?.meta || {}));
    const row = { unit: u.id, state: u.st, fetched_at: now, ok: 1, error: null, races: prev?.races || 0, status: 'ok', meta };
    try {
      const out = await u.run(ctxFor(meta));
      if (out.notPosted) { row.status = 'not posted'; row.races = 0; }
      else if (out.unchanged) row.status = 'unchanged';
      else {
        meta.haveData = true;
        row.races = out.results.size;
        for (const [raceId, r] of out.results) results.push({ raceId, payload: { ...r, source: u.label, st: u.st, updated: new Date(now).toISOString() } });
      }
    } catch (e) {
      if (e.budget) break;                                           // out of downloads mid-unit: retry next run, record nothing
      row.ok = 0; row.status = 'error';
      meta.etags = {};                                               // force a full download next time
      row.error = (e.status ? `HTTP ${e.status}` : e.message || String(e)).slice(0, 200);
      if (e.status === 404 || e.status === 410) { delete meta.eid; delete meta.ver; }   // election id moved; look it up again next time
    }
    report.push(row);
  }

  if (!dryRun) {
    await store.saveUnits(report);
    await store.saveResults('STATE', results);
  }
  return { used, budget, units: report, results };
}

/* ── Storage ── */
export function d1Store(db) {
  return {
    async loadUnits() {
      const { results } = await db.prepare('SELECT * FROM feed_unit').all();
      return new Map(results.map(r => [r.unit, { ...r, meta: safeJSON(r.meta) }]));
    },
    async saveUnits(rows) {
      const st = rows.map(r => db.prepare('INSERT OR REPLACE INTO feed_unit (unit, state, fetched_at, ok, status, error, races, meta) VALUES (?,?,?,?,?,?,?,?)')
        .bind(r.unit, r.state, r.fetched_at, r.ok, r.status, r.error, r.races, JSON.stringify(r.meta || {})));
      for (let i = 0; i < st.length; i += 50) await db.batch(st.slice(i, i + 50));
    },
    async saveResults(source, rows) {
      if (!rows.length) return 0;
      const { results } = await db.prepare('SELECT race_id, hash FROM feed_result WHERE source = ?').bind(source).all();
      const old = new Map(results.map(r => [r.race_id, r.hash]));
      const changed = [];
      for (const r of rows) {
        const body = JSON.stringify({ ...r.payload, updated: undefined });
        const h = hash(body);
        if (old.get(r.raceId) === h) continue;
        changed.push(db.prepare('INSERT OR REPLACE INTO feed_result (race_id, source, payload, hash, updated_at) VALUES (?,?,?,?,?)')
          .bind(r.raceId, source, JSON.stringify(r.payload), h, Date.parse(r.payload.updated) || Date.now()));
      }
      for (let i = 0; i < changed.length; i += 50) await db.batch(changed.slice(i, i + 50));
      return changed.length;
    },
    async loadResults() {
      const { results } = await db.prepare('SELECT race_id, source, payload FROM feed_result').all();
      return results.map(r => ({ raceId: r.race_id, source: r.source, payload: safeJSON(r.payload) })).filter(r => r.payload);
    },
  };
}
export function memoryStore() {
  const units = new Map(), res = new Map();
  return {
    units, res,
    async loadUnits() { return new Map(units); },
    async saveUnits(rows) { for (const r of rows) units.set(r.unit, JSON.parse(JSON.stringify(r))); },
    async saveResults(source, rows) { for (const r of rows) res.set(`${source}|${r.raceId}`, { raceId: r.raceId, source, payload: r.payload }); return rows.length; },
    async loadResults() { return [...res.values()]; },
  };
}
const safeJSON = s => { try { return JSON.parse(s); } catch { return null; } };
