import { random, digest } from './model.mjs';
const password = random();
console.log('Admin paroli (saqlab qo‘ying): ' + password);
console.log('ADMIN_PASSWORD_HASH (Netlify Environment variables uchun): ' + digest(password));

