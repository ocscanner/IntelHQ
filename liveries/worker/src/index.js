/**
 * OC Scanner — Special Livery flight board (livery-board Worker)
 *
 * On a schedule (6 AM and 6 PM Pacific by default) this looks up every special-livery tail on
 * AeroDataBox and saves the flights to KV. The tracker page (liveries/index.html) reads the
 * saved board from GET /board, so page visitors never use up API calls.
 *
 * Routes
 *   GET /board                      public: the saved board (cached 5 min)
 *   GET /status?key=ADMIN_KEY       usage this month, last run, last error
 *   GET /run?key=ADMIN_KEY          start a check now (&day=tomorrow, &limit=3 to test a few tails)
 *
 * Settings: see wrangler.toml. Secrets: RAPIDAPI_KEY, ADMIN_KEY.
 */

const API_HOST = 'aerodatabox.p.rapidapi.com';
const TZ = 'America/Los_Angeles';
export const SOCAL = ['LAX', 'SNA', 'LGB', 'BUR', 'ONT', 'SAN', 'PSP'];
const DEFAULT_ROSTER = 'https://raw.githubusercontent.com/ocscanner/IntelHQ/main/liveries/liveries.json';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });

    if (url.pathname === '/board') {
      const board = await env.BOARD.get('board');
      return json(board ? JSON.parse(board) : { updated: null, aircraft: {} }, 200,
        { 'Cache-Control': 'public, max-age=300' });
    }

    // Everything else needs ?key=ADMIN_KEY (and is off entirely until ADMIN_KEY is set)
    if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
      return json({ error: 'Use GET /board' }, 404);
    }
    if (url.pathname === '/status') {
      const state = await readJSON(env, 'state', {});
      const board = await readJSON(env, 'board', {});
      return json({
        running: state.job ? { date: state.job.date, done: state.job.i, of: state.job.queue.length } : null,
        lastRun: state.lastJob || null,
        updated: board.updated || null, next: board.next || null,
        usage: board.usage || null, lastError: board.lastError || null,
        tails: Object.keys(board.aircraft || {}).length,
      });
    }
    if (url.pathname === '/run') {
      const day = url.searchParams.get('day') === 'tomorrow' ? 'tomorrow' : 'today';
      const limit = parseInt(url.searchParams.get('limit') || '0', 10) || 0;
      try {
        const started = await startJob(env, day, `manual-${Date.now()}`, limit);
        const result = await processBatch(env);
        return json({ started, ...result });
      } catch (e) {
        return json({ error: String(e.message || e) }, 500);
      }
    }
    return json({ error: 'Unknown route' }, 404);
  },
};

// ── scheduling ──
export async function tick(env) {
  const state = await readJSON(env, 'state', {});
  if (state.job && state.job.i < state.job.queue.length) return processBatch(env);

  const now = pacificParts(new Date());
  for (const { hour, day } of runPlan(env)) {
    const slot = `${now.date}-${hour}-${day}`;
    if (now.hour >= hour && !(state.done || []).includes(slot)) {
      await startJob(env, day, slot, 0);
      return processBatch(env);
    }
  }
}

export function runPlan(env) {
  return String(env.RUN_PLAN || '6:today,18:tomorrow').split(',').map(s => {
    const [h, d] = s.trim().split(':');
    return { hour: parseInt(h, 10), day: d === 'tomorrow' ? 'tomorrow' : 'today' };
  }).filter(p => p.hour >= 0 && p.hour < 24);
}

async function startJob(env, day, slot, limit) {
  const roster = await loadRoster(env);
  let queue = roster.map(a => a.reg);
  if (limit) queue = queue.slice(0, limit);
  const today = pacificParts(new Date()).date;
  const date = day === 'tomorrow' ? addDays(today, 1) : today;
  const state = await readJSON(env, 'state', {});
  state.job = { slot, date, queue, i: 0, started: new Date().toISOString() };
  await env.BOARD.put('state', JSON.stringify(state));
  return { slot, date, tails: queue.length };
}

async function loadRoster(env) {
  const r = await fetch(env.ROSTER_URL || DEFAULT_ROSTER, { cf: { cacheTtl: 3600 } });
  if (!r.ok) throw new Error(`Couldn't load the tail list (HTTP ${r.status}). Check ROSTER_URL.`);
  const data = await r.json();
  const skipDecals = String(env.SKIP_DECALS ?? 'true') !== 'false';
  return (data.aircraft || []).filter(a => a.reg && a.status !== 'Retired' && !(skipDecals && a.paint === 'Nose decal'));
}

// ── fetching ──
export async function processBatch(env) {
  const state = await readJSON(env, 'state', {});
  const job = state.job;
  if (!job) return { processed: 0 };

  const board = await readJSON(env, 'board', { aircraft: {} });
  board.aircraft ||= {};
  const month = pacificParts(new Date()).date.slice(0, 7);
  if (!board.usage || board.usage.month !== month) board.usage = { month, calls: 0, errors: 0 };

  const budget = Math.max(1, Math.min(48, parseInt(env.SUBREQUEST_BUDGET || '40', 10) || 40));
  const gap = env.API_GAP_MS !== undefined ? Number(env.API_GAP_MS) : 1100;
  const end = Math.min(job.i + budget, job.queue.length);
  let processed = 0;

  while (job.i < end) {
    const reg = job.queue[job.i];
    const res = await fetchTail(env, reg, job.date);
    board.usage.calls++;
    processed++;
    if (res.ok) {
      const t = (board.aircraft[reg] ||= { dates: {} });
      t.dates[job.date] = { fetched: new Date().toISOString(), flights: res.flights };
      job.i++;
    } else {
      board.usage.errors++;
      board.lastError = { reg, status: res.status, at: new Date().toISOString() };
      if (res.status === 429) {                          // rate limited or out of quota: retry this tail next wake-up
        job.limited = (job.limited || 0) + 1;
        board.lastError.note = 'Rate limited or out of AeroDataBox quota';
        if (job.limited >= 4) {                          // still refused after an hour: give up on this run
          board.lastError.note += '. Gave up on this check after 4 tries.';
          job.i = job.queue.length;
        }
        break;
      }
      if (res.status === 401 || res.status === 403) {   // bad key or no subscription: stop the run
        board.lastError.note = 'Check RAPIDAPI_KEY and your AeroDataBox subscription';
        job.i = job.queue.length;
        break;
      }
      job.i++;                                           // anything else: skip this tail for this run
    }
    if (job.i < end && gap > 0) await sleep(gap);
  }

  // Keep today and later (Pacific)
  const today = pacificParts(new Date()).date;
  for (const [reg, t] of Object.entries(board.aircraft)) {
    for (const d of Object.keys(t.dates || {})) if (d < today) delete t.dates[d];
    if (!Object.keys(t.dates || {}).length) delete board.aircraft[reg];
  }
  board.updated = new Date().toISOString();
  board.next = nextRunISO(env);

  if (job.i >= job.queue.length) {
    state.done = [...(state.done || []), job.slot].slice(-20);
    state.lastJob = { slot: job.slot, date: job.date, tails: job.queue.length, started: job.started, finished: new Date().toISOString() };
    delete state.job;
  }
  await env.BOARD.put('board', JSON.stringify(board));
  await env.BOARD.put('state', JSON.stringify(state));
  return { processed, remaining: state.job ? state.job.queue.length - state.job.i : 0, usage: board.usage };
}

async function fetchTail(env, reg, date) {
  if (!env.RAPIDAPI_KEY) return { ok: false, status: 401 };
  const url = `https://${API_HOST}/flights/reg/${encodeURIComponent(reg)}/${date}?withAircraftImage=false&withLocation=false`;
  try {
    const r = await fetch(url, { headers: { 'x-rapidapi-key': env.RAPIDAPI_KEY, 'x-rapidapi-host': API_HOST } });
    if (r.status === 204 || r.status === 404) return { ok: true, flights: [] };   // no flights that day
    if (!r.ok) return { ok: false, status: r.status };
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data.items || []);
    return { ok: true, flights: list.map(slim).filter(Boolean) };
  } catch (e) {
    return { ok: false, status: 0 };
  }
}

// Keep only what the page shows, so the saved board stays small.
export function slim(f) {
  if (!f || !f.departure || !f.arrival) return null;
  const leg = m => ({
    iata: m.airport?.iata || m.airport?.icao || '',
    name: m.airport?.shortName || m.airport?.name || '',
    city: m.airport?.municipalityName || '',
    sched: m.scheduledTime?.local || null,
    rev: m.revisedTime?.local || null,
    act: m.runwayTime?.local || null,
  });
  const dep = leg(f.departure), arr = leg(f.arrival);
  return {
    num: f.number || '', cs: f.callSign || '', status: f.status || 'Unknown',
    airline: f.airline?.name || '', dep, arr,
    socal: SOCAL.includes(dep.iata) || SOCAL.includes(arr.iata),
  };
}

// ── helpers ──
export function pacificParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: parseInt(p.hour, 10) };
}
export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function nextRunISO(env) {
  const hours = runPlan(env).map(r => r.hour);
  const now = new Date();
  for (let h = 1; h <= 26; h++) {
    const t = new Date(now.getTime() + h * 3600e3);
    if (hours.includes(pacificParts(t).hour)) { t.setUTCMinutes(0, 0, 0); return t.toISOString(); }
  }
  return null;
}
async function readJSON(env, key, fallback) {
  const v = await env.BOARD.get(key);
  if (!v) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function cors() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors(), 'Content-Type': 'application/json', ...extra } });
}
