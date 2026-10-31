import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker, { slim, runPlan, addDays, pacificParts } from '../src/index.js';

const roster = JSON.parse(readFileSync(new URL('../../liveries.json', import.meta.url)));
const decals = roster.aircraft.filter(a => a.paint === 'Nose decal').length;
const checkable = roster.aircraft.length - decals;

// In-memory stand-in for the BOARD KV namespace
function memoryKV() {
  const m = new Map();
  return { m, get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } };
}

// Fake AeroDataBox: one flight into SNA and one out, per tail. Set `reply` to change behavior.
let calls = [];
let reply = null;
const flight = date => [
  { number: 'WN 1234', callSign: 'SWA1234', status: 'Expected', airline: { name: 'Southwest' },
    departure: { airport: { iata: 'DEN', shortName: 'Denver', municipalityName: 'Denver' }, scheduledTime: { local: `${date} 12:10-06:00` } },
    arrival: { airport: { iata: 'SNA', shortName: 'John Wayne', municipalityName: 'Santa Ana' },
      scheduledTime: { local: `${date} 13:42-07:00` }, revisedTime: { local: `${date} 13:55-07:00` } } },
  { number: 'WN 88', status: 'Expected',
    departure: { airport: { iata: 'SNA' }, scheduledTime: { local: `${date} 14:30-07:00` } },
    arrival: { airport: { iata: 'SJC' }, scheduledTime: { local: `${date} 15:45-07:00` } } },
];
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes('liveries.json')) return new Response(JSON.stringify(roster));
  if (url.includes('aerodatabox')) {
    const [, reg, date] = url.match(/\/flights\/reg\/([^/]+)\/(\d{4}-\d{2}-\d{2})/);
    calls.push(decodeURIComponent(reg));
    if (reply) { const r = reply(decodeURIComponent(reg), calls.length); if (r) return r; }
    return new Response(JSON.stringify(flight(date)));
  }
  throw new Error('unexpected fetch ' + url);
};

let env;
const ctx = () => { let p; return { waitUntil: x => { p = x; }, done: () => p }; };
async function cron() { const c = ctx(); await worker.scheduled({}, env, c); await c.done(); }
const get = async path => worker.fetch(new Request('https://w' + path), env);
const state = () => JSON.parse(env.BOARD.m.get('state') || '{}');
const board = () => JSON.parse(env.BOARD.m.get('board') || '{}');

beforeEach(() => {
  calls = []; reply = null;
  env = { BOARD: memoryKV(), RAPIDAPI_KEY: 'k', ADMIN_KEY: 'pw', API_GAP_MS: 0, RUN_PLAN: '0:today,0:tomorrow' };
});

test('a full check runs in batches of 40 and skips nose-decal jets', async () => {
  env.RUN_PLAN = '0:today';
  await cron();
  assert.equal(calls.length, Math.min(40, checkable));
  assert.ok(state().job, 'job continues on the next wake-up');
  await cron();
  assert.equal(calls.length, checkable);
  assert.equal(state().job, undefined);
  assert.equal(Object.keys(board().aircraft).length, checkable);
  const decalTail = roster.aircraft.find(a => a.paint === 'Nose decal').reg;
  assert.ok(!calls.includes(decalTail));
  await cron();
  assert.equal(calls.length, checkable, 'nothing more until the next planned time');
});

test('today and tomorrow both get checked, and the board keeps both days', async () => {
  for (let i = 0; i < 4; i++) await cron();
  const today = pacificParts(new Date()).date;
  const t = board().aircraft['N8653A'].dates;
  assert.deepEqual(Object.keys(t).sort(), [today, addDays(today, 1)]);
  assert.equal(t[today].flights[0].arr.iata, 'SNA');
  assert.equal(board().usage.calls, checkable * 2);
});

test('saved flights keep only what the page needs', () => {
  const s = slim(flight('2026-10-31')[0]);
  assert.deepEqual(s, {
    num: 'WN 1234', cs: 'SWA1234', status: 'Expected', airline: 'Southwest',
    dep: { iata: 'DEN', name: 'Denver', city: 'Denver', sched: '2026-10-31 12:10-06:00', rev: null, act: null },
    arr: { iata: 'SNA', name: 'John Wayne', city: 'Santa Ana', sched: '2026-10-31 13:42-07:00', rev: '2026-10-31 13:55-07:00', act: null },
    socal: true,
  });
  assert.equal(slim({ number: 'X' }), null);
});

test('a tail with no flights that day is saved as an empty list', async () => {
  reply = reg => reg === 'N955WN' ? new Response(null, { status: 204 }) : null;
  const r = await (await get('/run?key=pw&limit=3')).json();
  assert.equal(r.processed, 3);
  const today = pacificParts(new Date()).date;
  assert.deepEqual(board().aircraft['N955WN'].dates[today].flights, []);
});

test('rate limiting pauses the run and retries the same tail; gives up after 4 tries', async () => {
  env.RUN_PLAN = '0:today';
  reply = (reg, n) => n === 3 ? new Response('', { status: 429 }) : null;
  await cron();
  assert.equal(calls.length, 3);
  assert.equal(state().job.i, 2, 'third tail not marked done');
  await cron();
  assert.equal(calls[3], calls[2], 'retries the tail that was refused');

  calls = []; env.BOARD = memoryKV();
  reply = () => new Response('', { status: 429 });
  for (let i = 0; i < 5; i++) await cron();
  assert.equal(calls.length, 4);
  assert.equal(state().job, undefined);
  assert.match(board().lastError.note, /Gave up/);
});

test('a bad key stops the run right away', async () => {
  reply = () => new Response('', { status: 403 });
  await cron();
  assert.equal(calls.length, 1);
  assert.match(board().lastError.note, /RAPIDAPI_KEY/);
});

test('routes: /board is public, admin routes need the key', async () => {
  assert.equal((await get('/board')).status, 200);
  assert.deepEqual(await (await get('/board')).json(), { updated: null, aircraft: {} });
  assert.equal((await get('/status')).status, 404);
  assert.equal((await get('/run?key=wrong')).status, 404);
  delete env.ADMIN_KEY;
  assert.equal((await get('/status?key=')).status, 404, 'admin routes off until ADMIN_KEY is set');
  env.ADMIN_KEY = 'pw';
  const s = await (await get('/status?key=pw')).json();
  assert.equal(s.tails, 0);
  assert.equal((await get('/board')).headers.get('Access-Control-Allow-Origin'), '*');
});

test('run plan parsing', () => {
  assert.deepEqual(runPlan({}), [{ hour: 6, day: 'today' }, { hour: 18, day: 'tomorrow' }]);
  assert.deepEqual(runPlan({ RUN_PLAN: '18:tomorrow' }), [{ hour: 18, day: 'tomorrow' }]);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
