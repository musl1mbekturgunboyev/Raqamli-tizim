import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { configureLocal, storage } from './storage.mjs';
import { schema } from './model.mjs';
mkdirSync('data', { recursive: true });
const db = new DatabaseSync(process.env.DB_FILE || 'data/chevarxona.sqlite');
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(schema);
const direct = {
  one: (sql, ...params) => db.prepare(sql).get(...params),
  all: (sql, ...params) => db.prepare(sql).all(...params),
  run: (sql, ...params) => db.prepare(sql).run(...params),
};
let pending = Promise.resolve();
function queue(work) {
  const next = pending.then(work);
  pending = next.catch(() => {});
  return next;
}
configureLocal({
  one: (...args) => queue(() => direct.one(...args)),
  all: (...args) => queue(() => direct.all(...args)),
  run: (...args) => queue(() => direct.run(...args)),
  transaction: work => queue(async () => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = await storage.run(direct, work);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }),
});
