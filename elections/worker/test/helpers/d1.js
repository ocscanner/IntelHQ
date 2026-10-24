// A small stand-in for Cloudflare D1 on Node's built-in SQLite, so the real SQL runs in tests.
import { DatabaseSync } from 'node:sqlite';
export function memoryD1() {
  const db = new DatabaseSync(':memory:');
  const plain = r => r && JSON.parse(JSON.stringify(r));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() { db.prepare(sql).run(...args); return { success: true }; },
    async first() { return plain(db.prepare(sql).get(...args)) ?? null; },
    async all() { return { results: plain(db.prepare(sql).all(...args)) }; },
  });
  return { prepare: sql => stmt(sql), async batch(list) { for (const s of list) await s.run(); return []; }, sqlite: db };
}
