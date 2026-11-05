import './local-db.mjs';
import { hashPassword, loginId, clean, one, run } from './model.mjs';
const id = loginId(process.argv[2]);
const name = clean(process.argv[3] || 'Boshliq');
const password = process.env.ADMIN_PASSWORD || '';
if (password.length < 12 || password.length > 128) throw new Error('ADMIN_PASSWORD 12–128 belgidan iborat bo‘lsin.');
if (await one('SELECT id FROM people WHERE role=?', 'admin')) throw new Error('Admin allaqachon yaratilgan.');
await run('INSERT INTO people(login,name,role,password) VALUES(?,?,?,?)', id, name, 'admin', hashPassword(password));
console.log('Admin yaratildi.');


