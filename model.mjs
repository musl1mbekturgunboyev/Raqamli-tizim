import { currentStorage } from './storage.mjs';
import { randomBytes, createHash, scryptSync, scrypt, timingSafeEqual } from 'node:crypto';

export const zone = process.env.WORK_TIME_ZONE || 'Asia/Tashkent';
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export function workClock(now = new Date()) {
  const p = Object.fromEntries(clock.formatToParts(now).map(({ type, value }) => [type, value]));
  const minute = Number(p.hour) * 60 + Number(p.minute);
  const sunday = p.weekday === 'Sun';
  return {
    date: [p.year, p.month, p.day].join('-'),
    mode: sunday || minute < 360 || minute >= 1200 ? 'closed' : minute < 1080 ? 'entry' : 'edit',
    sunday,
    untilChange: ((sunday || minute >= 1200 ? 1440 : minute < 360 ? 360 : minute < 1080 ? 1080 : 1200) - minute) * 60000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds(),
  };
}

export const schema = `
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY, login TEXT UNIQUE COLLATE NOCASE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','worker')), password TEXT, activation TEXT, activation_until INTEGER
);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY, person INTEGER UNIQUE NOT NULL REFERENCES people, key BLOB NOT NULL,
  counter INTEGER NOT NULL, transports TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, person INTEGER NOT NULL REFERENCES people, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_challenges (
  token TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS challenge_expiration ON auth_challenges(expires);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, target INTEGER NOT NULL CHECK(target > 0)
);
CREATE TABLE IF NOT EXISTS operations (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders, name TEXT NOT NULL,
  rate INTEGER NOT NULL CHECK(rate > 0), UNIQUE(order_id, name)
);
CREATE TABLE IF NOT EXISTS assignments (
  worker INTEGER NOT NULL REFERENCES people, operation INTEGER NOT NULL REFERENCES operations,
  PRIMARY KEY(worker, operation)
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY, worker INTEGER NOT NULL REFERENCES people, operation INTEGER NOT NULL REFERENCES operations,
  day TEXT NOT NULL, qty INTEGER NOT NULL CHECK(qty >= 0), rate INTEGER NOT NULL CHECK(rate > 0),
  UNIQUE(worker, operation, day)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY, entry INTEGER NOT NULL REFERENCES entries, actor INTEGER NOT NULL REFERENCES people,
  old_qty INTEGER NOT NULL, new_qty INTEGER NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_day ON entries(day, worker);
CREATE INDEX IF NOT EXISTS entries_worker ON entries(worker, day);
CREATE INDEX IF NOT EXISTS entries_operation ON entries(operation);
CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires);
`;
export const one = (sql, ...params) => currentStorage().one(sql, ...params);
export const all = (sql, ...params) => currentStorage().all(sql, ...params);
export const run = (sql, ...params) => currentStorage().run(sql, ...params);
export const transaction = (work) => currentStorage().transaction(work);
export const random = (n = 32) => randomBytes(n).toString('base64url');
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export function hashPassword(password) {
  const salt = random();
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export async function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (salt === 'generated') return timingSafeEqual(Buffer.from(digest(password), 'hex'), Buffer.from(hash, 'hex'));
  const key = await new Promise((resolve, reject) => scrypt(password, salt, 64, (error, result) => error ? reject(error) : resolve(result)));
  return timingSafeEqual(key, Buffer.from(hash, 'hex'));
}
export class InputError extends Error {}
export function need(ok, message) {
  if (!ok) throw new InputError(message);
}
export function clean(value, max = 120) {
  const v = typeof value === 'string' ? value.trim() : '';
  need(v.length > 0 && v.length <= max, `Matn uzunligi 1–${max} belgi bo‘lishi kerak.`);
  return v;
}
export function integer(value, min = 1, max = 1_000_000) {
  need(typeof value === 'string' && /^\d+$/.test(value), 'Butun son kiriting.');
  const n = Number(value);
  need(Number.isSafeInteger(n) && n >= min && n <= max, `Son ${min}–${max} oralig‘ida bo‘lishi kerak.`);
  return n;
}
export function loginId(value) {
  const id = clean(value, 40);
  need(/^[a-z0-9_-]{3,40}$/i.test(id), 'ID 3–40 ta lotin harfi, raqam, tire yoki pastki chiziqdan iborat bo‘lsin.');
  return id;
}
export async function activate(worker) {
  const code = random(12);
  await transaction(async () => {
    await run('UPDATE people SET activation=?, activation_until=? WHERE id=? AND role=?',
      digest(code), Date.now() + 86400000, worker, 'worker');
    await run('DELETE FROM passkeys WHERE person=?', worker);
    await run('DELETE FROM sessions WHERE person=?', worker);
  });
  return code;
}

export async function createEntry(worker, operation, qty, now = new Date()) {
  const { date, mode } = workClock(now);
  need(mode === 'entry', 'Yangi yozuv faqat ish kunlari 06:00–18:00 oralig‘ida kiritiladi.');
  need(Number.isInteger(qty) && qty > 0 && qty <= 1_000_000, 'Dona soni 1–1000000 oralig‘ida bo‘lsin.');
  return await transaction(async () => {
    const assigned = await one(`SELECT o.rate FROM assignments a JOIN operations o ON o.id=a.operation
      WHERE a.worker=? AND a.operation=?`, worker, operation);
    need(assigned, 'Bu operatsiya sizga biriktirilmagan.');
    const result = await run(`INSERT INTO entries(worker,operation,day,qty,rate) VALUES(?,?,?,?,?)
      ON CONFLICT(worker,operation,day) DO NOTHING`, worker, operation, date, qty, assigned.rate);
    need(result.changes === 1, 'Bugungi yozuv mavjud. Tahrirlash bo‘limidan foydalaning.');
    return result.lastInsertRowid;
  });
}

export async function editEntry(person, id, qty, reason, expectedQty, now = new Date()) {
  reason = clean(reason, 500);
  need(Number.isInteger(qty) && qty >= 0 && qty <= 1_000_000, 'Dona soni 0–1000000 oralig‘ida bo‘lsin.');
  const { date, mode } = workClock(now);
  await transaction(async () => {
    const row = await one('SELECT * FROM entries WHERE id=?', id);
    need(row && (person.role === 'admin' || person.id === row.worker), 'Yozuv topilmadi.');
    need(person.role === 'admin' || (row.day === date && mode !== 'closed'), 'Bu kun yopilgan.');
    need(expectedQty === row.qty, 'Yozuv yangilangan. Sahifani qayta ochib tekshiring.');
    need(qty !== row.qty, 'Yangi dona soni avvalgisidan farq qilishi kerak.');
    await run('UPDATE entries SET qty=? WHERE id=?', qty, id);
    await run('INSERT INTO audit(entry,actor,old_qty,new_qty,reason,at) VALUES(?,?,?,?,?,?)',
      id, person.id, row.qty, qty, reason, now.toISOString());
  });
}



