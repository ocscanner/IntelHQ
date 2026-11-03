/* OC Scanner — Other networks' race calls (IntelHQ desk only)
 *
 * A private log of what Fox, CNN, NBC, ABC and the rest have called, typed in by the desk.
 * It is kept in this browser (localStorage), is never sent anywhere and never shows on the public board.
 * The results pipeline, the board's calls and the public pages don't read it.
 */
(function () {
  'use strict';
  const KEY = 'eb-netcalls';
  const NETWORKS = ['Fox News', 'CNN', 'NBC News', 'ABC News', 'CBS News', 'AP', 'Decision Desk HQ', 'NYT', 'Other'];
  const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const write = list => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(-500))); } catch {} };
  // Rehearsal entries and real entries never mix: each mode only sees its own
  const all = sim => read().filter(e => !!e.sim === !!sim).sort((a, b) => b.at - a.at);
  const forRace = (raceId, sim) => all(sim).filter(e => e.raceId === raceId);
  function add(entry) {
    const list = read();
    const e = Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }, entry);
    list.push(e); write(list);
    return e;
  }
  const remove = id => write(read().filter(e => e.id !== id));
  const clear = sim => write(read().filter(e => !!e.sim !== !!sim));
  // "21:42" from a time box becomes a time today (or yesterday, if that would be more than an hour from now)
  function atFromTime(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || ''), d = new Date();
    if (m) { d.setHours(+m[1], +m[2], 0, 0); if (d.getTime() - Date.now() > 3600e3) d.setDate(d.getDate() - 1); }
    return d.getTime();
  }
  window.EBNetCalls = { NETWORKS, all, forRace, add, remove, clear, atFromTime };
})();
