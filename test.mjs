import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash, generateKeyPairSync, randomInt, sign } from 'node:crypto';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@libsql/client';
import { adaptClient } from './turso.mjs';
import { makeHandler } from './netlify/functions/chevarxona.mjs';
import { encodeCBOR } from '@levischuck/tiny-cbor';

process.env.DB_FILE = ':memory:';
process.env.WORK_TIME_ZONE = 'Asia/Tashkent';
await import('./local-db.mjs');
const { createEntry, editEntry, one, run, workClock, hashPassword, markNoWork, setMonthClosed } = await import('./model.mjs');
const date = time => new Date('2026-11-06T' + time + ':00+05:00');

test('Ish vaqti: juma, shanba, yakshanba va dushanba', () => {
  const intervals = [
    ['05:59', 'closed'], ['06:00', 'entry'], ['17:59', 'entry'], ['18:00', 'edit'],
    ['19:59', 'edit'], ['20:00', 'closed'],
  ];
  for (const [time, mode] of intervals) assert.equal(workClock(date(time)).mode, mode);
  assert.equal(workClock(new Date('2026-11-07T06:00:00+05:00')).mode, 'entry');
  assert.equal(workClock(new Date('2026-11-08T12:00:00+05:00')).mode, 'closed');
  assert.deepEqual(workClock(new Date('2026-11-09T06:00:00+05:00')), {
    date: '2026-11-09', mode: 'entry', sunday: false, untilChange: 43200000,
  });
});

test('Dona, tarif, takroriy yozuv, maxfiylik va tahrir tarixi', async () => {
  await run("INSERT INTO people(id,login,name,role) VALUES(1,'ishchi','Ishchi','worker'),(2,'boshqa','Boshqa','worker'),(3,'admin','Admin','admin')");
  await run("INSERT INTO orders VALUES(1,'Oq ko‘ylak',100)");
  await run("INSERT INTO operations VALUES(1,1,'Yoqa tikish',450)");
  await run('INSERT INTO assignments VALUES(1,1)');
  const worker = { id: 1, role: 'worker' };
  const other = { id: 2, role: 'worker' };
  const admin = { id: 3, role: 'admin' };
  await assert.rejects(() => createEntry(1, 1, 25, date('05:59')));
  await assert.rejects(() => createEntry(2, 1, 25, date('17:59')));
  await assert.rejects(() => createEntry(1, 1, 25, date('18:00')));
  await markNoWork(1, '2026-11-06', date('17:30'));
  assert.ok(await one('SELECT 1 FROM no_work WHERE worker=1'));
  const id = await createEntry(1, 1, 25, date('17:59'));
  assert.equal(await one('SELECT 1 FROM no_work WHERE worker=1'), undefined);
  await assert.rejects(() => markNoWork(1, '2026-11-06', date('17:59')), /ish yozuvi kiritilgan/);
  await assert.rejects(() => createEntry(1, 1, 25, date('17:59')));
  await assert.rejects(() => editEntry(other, id, 27, 'Sabab', 25, date('19:00')));
  await assert.rejects(() => editEntry(worker, id, 27, '  ', 25, date('19:00')));
  await assert.rejects(() => editEntry(worker, id, 27, 'Sabab', 25, date('20:00')));
  await assert.rejects(() => editEntry(worker, id, 27, 'Sabab', 25, new Date('2026-11-09T06:00:00+05:00')));
  await run('UPDATE operations SET rate=500');
  await editEntry(worker, id, 27, 'Ikki dona yozilmay qolgan', 25, date('19:59'));
  await assert.rejects(() => editEntry(worker, id, 28, 'Eski sahifa', 25, date('19:59')));
  assert.equal((await one('SELECT qty*rate total FROM entries')).total, 12150);
  await assert.rejects(() => editEntry(admin, id, 26, '', 27, date('20:00')));
  await editEntry(admin, id, 26, 'Brigadir sanadi', 27, date('20:00'));
  assert.equal((await one('SELECT qty*rate total FROM entries')).total, 11700);
  assert.equal((await one('SELECT COUNT(*) count FROM audit')).count, 2);
  assert.equal((await one('SELECT reason FROM audit ORDER BY id DESC LIMIT 1')).reason, 'Brigadir sanadi');
  await run('INSERT INTO completed_orders VALUES(1)');
  await assert.rejects(() => createEntry(1, 1, 25, date('17:59')), /Buyurtma tugatilgan/);
  await assert.rejects(() => editEntry(worker, id, 28, 'Tuzatish', 26, date('19:59')), /Buyurtma tugatilgan/);
  const december = new Date('2026-12-01T12:00:00+05:00');
  await assert.rejects(() => setMonthClosed('2026-11', 3, true, '', date('20:00')), /tugagan oyni/);
  await setMonthClosed('2026-11', 3, true, '', december);
  await assert.rejects(() => editEntry(admin, id, 28, 'Tuzatish', 26, december), /Bu oy yopilgan/);
  await assert.rejects(() => setMonthClosed('2026-11', 3, false, '', december));
  await setMonthClosed('2026-11', 3, false, 'Hisobni tekshirish', december);
  await editEntry(admin, id, 28, 'Ikki dona qo‘shildi', 26, december);
  assert.equal((await one('SELECT reason FROM month_audit ORDER BY id DESC LIMIT 1')).reason, 'Hisobni tekshirish');
});

async function loginFlow(t, netlify = false) {
  const port = randomInt(20000, 50000);
  const origin = netlify ? 'https://chevarxona-test.netlify.app' : 'http://localhost:' + port;
  const file = 'data/test-' + port + '.sqlite';
  let handler;
  if (netlify) {
    const values = {
      APP_ORIGIN: origin, TURSO_DATABASE_URL: 'https://test.invalid', TURSO_AUTH_TOKEN: 'local-test',
      ADMIN_LOGIN: 'boshliq', ADMIN_PASSWORD_HASH: createHash('sha256').update('Test-password-123').digest('hex'),
    };
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    Object.assign(process.env, values);
    const database = createClient({ url: 'file::memory:' });
    t.after(() => {
      database.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    const connector = () => adaptClient(database);
    handler = makeHandler(connector);
    assert.equal((await handler(new Request(origin))).status, 200);
    await database.batch([
      "INSERT INTO people(id,login,name,role) VALUES(2,'Boshqa','Boshqa','worker')",
      "INSERT INTO orders VALUES(1,'Oq ko‘ylak',100)",
      "INSERT INTO operations VALUES(1,1,'Yoqa tikish',450)",
      "INSERT INTO entries VALUES(1,2,1,'2026-11-06',17,450)",
    ], 'write');
    handler = makeHandler(connector);
  } else {
    const app = spawn(process.execPath, ['server.mjs'], {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', APP_ORIGIN: origin, DB_FILE: file },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    t.after(async () => {
      if (app.exitCode === null) { app.kill(); await once(app, 'exit'); }
      for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
    });
    await Promise.race([
      once(app.stdout, 'data'),
      once(app, 'exit').then(([code]) => { throw new Error('Server yopildi: ' + code); }),
    ]);
    const seed = new DatabaseSync(file);
    seed.prepare("INSERT INTO people(id,login,name,role,password) VALUES(1,'boshliq','Boshliq','admin',?)")
      .run(hashPassword('Test-password-123'));
    seed.exec("INSERT INTO people(id,login,name,role) VALUES(2,'Boshqa','Boshqa','worker')");
    seed.exec("INSERT INTO orders VALUES(1,'Oq ko‘ylak',100); INSERT INTO operations VALUES(1,1,'Yoqa tikish',450)");
    seed.exec("INSERT INTO entries VALUES(1,2,1,'2026-11-06',17,450)");
    seed.close();
  }

  function client() {
    const jar = new Map();
    return async (path, payload, isJson = false) => {
      const headers = { Origin: origin, Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; ') };
      if (payload) headers['Content-Type'] = isJson ? 'application/json' : 'application/x-www-form-urlencoded';
      const target = (netlify ? origin : 'http://127.0.0.1:' + port) + path;
      const request = new Request(target, {
        method: payload ? 'POST' : 'GET', headers, redirect: 'manual',
        body: payload ? isJson ? JSON.stringify(payload) : new URLSearchParams(payload) : undefined,
      });
      const res = netlify ? await handler(request, { ip: '127.0.0.1' }) : await fetch(request);
      for (const set of res.headers.getSetCookie()) {
        const [name, value] = set.split(';')[0].split('=');
        jar.set(name, value);
      }
      return res;
    };
  }
  const admin = client();
  const worker = client();
  assert.equal((await admin('/admin/login')).headers.get('referrer-policy'), 'same-origin');
  if (!netlify) assert.equal((await worker('/passkey-lib.js')).status, 200);
  const adminLogin = await admin('/admin/login', { login: 'boshliq', password: 'Test-password-123' });
  assert.equal(adminLogin.status, 303);
  assert.match(adminLogin.headers.get('set-cookie'), /Max-Age=2592000/);
  const login = 'Muqaddam1987';
  const created = await admin('/admin/worker', {
    login, name: 'Muqaddam', brigade: 'Tikuv brigadasi', job: 'Tikuvchi', operation: 1,
  });
  assert.equal(created.status, 200);
  const adminHtml = await created.text();
  assert.match(adminHtml, /Tikuv brigadasi · 1 ishchi/);
  assert.match(adminHtml, /Tikuvchi · 1 ishchi/);
  const directory = (await (await admin('/?workerSearch=tikuvchi')).text()).split('id="workers"')[1].split('id="report"')[0];
  assert.match(directory, /Muqaddam1987/);
  assert.doesNotMatch(directory, /<td>Boshqa<\/td>/);
  const code = adminHtml.match(/<code>([\w-]+)<\/code>/)[1];
  assert.equal((await worker('/auth/options', { login, code: 'bad' }, true)).status, 400);
  const { registration, options } = await (await worker('/auth/options', { login, code }, true)).json();
  assert.equal(registration, true);
  const hash = data => createHash('sha256').update(data).digest();
  const rpHash = hash(new URL(origin).hostname);
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin }));
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const coseKey = encodeCBOR(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const keyId = Buffer.alloc(32, 25);
  const id = keyId.toString('base64url');
  const regData = Buffer.concat([rpHash, Buffer.from([0x45, 0, 0, 0, 0]), Buffer.alloc(16),
    Buffer.from([0, keyId.length]), keyId, coseKey]);
  const attestation = Buffer.from(encodeCBOR(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', regData]])));
  const regResponse = { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: {
    clientDataJSON: clientData('webauthn.create', options.challenge).toString('base64url'),
    attestationObject: attestation.toString('base64url'), transports: ['internal'],
  } };
  const registered = await worker('/auth/verify', { response: regResponse }, true);
  assert.equal(registered.status, 200, await registered.text());
  assert.equal((await worker('/auth/verify', { response: regResponse }, true)).status, 400);
  assert.match(await (await worker('/?month=2026-11')).text(), /Muqaddam/);
  assert.doesNotMatch(await (await worker('/?month=2026-11')).text(), /7.?650/);
  assert.match(await (await admin('/?month=2026-11')).text(), /Boshqa/);
  assert.equal((await worker('/admin/order', { name: 'X', target: 3 })).status, 403);
  assert.equal((await worker('/work/edit', { id: 1, qty: 2, expected: 17, reason: 'Sinov' })).status, 400);
  assert.equal((await worker('/logout', {})).status, 303);

  const auth = await (await worker('/auth/options', { login }, true)).json();
  assert.equal(auth.registration, false);
  const authData = Buffer.concat([rpHash, Buffer.from([5, 0, 0, 0, 1])]);
  const authClient = clientData('webauthn.get', auth.options.challenge);
  const signature = sign('sha256', Buffer.concat([authData, hash(authClient)]), privateKey);
  const verified = await worker('/auth/verify', { response: {
    id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: {
      authenticatorData: authData.toString('base64url'), clientDataJSON: authClient.toString('base64url'),
      signature: signature.toString('base64url'),
    },
  } }, true);
  assert.equal(verified.status, 200, await verified.text());
  const report = await admin('/admin/export?month=2026-11');
  assert.match(await report.text(), /7650/);
  assert.equal((await admin('/admin/brigade', { worker: 2, brigade: 'Birinchi brigada' })).status, 303);
  assert.equal((await admin('/admin/assign', { worker: 2, operation: 1 })).status, 303);
  const dashboard = await (await admin('/?todayOrder=1&brigade=Birinchi+brigada')).text();
  assert.match(dashboard, /Bugun kim kiritmadi/);
  assert.match(dashboard, /value="Birinchi brigada" selected/);
  assert.match(dashboard, /<progress[^>]+value="17" max="100"/);
  assert.match(await (await worker('/')).text(), /Mening oyligim/);
  assert.match(await (await worker('/')).text(), /Oq ko‘ylak · Yoqa tikish/);
  assert.match(verified.headers.get('set-cookie'), /Max-Age=2592000/);
  assert.equal((await worker('/admin/order/complete', { order: 1 })).status, 403);
  assert.equal((await admin('/admin/order/complete', { order: 1 })).headers.get('location'), '/#completed-orders');
  assert.equal((await admin('/admin/worker', { login: 'yangi', name: 'Yangi ishchi', operation: 1 })).status, 400);
  for (const account of [admin, worker]) {
    const html = await (await account('/')).text();
    assert.match(html, /<h2>Tugatildi<\/h2>.*?Oq ko‘ylak/s);
    assert.doesNotMatch(html.split('<h2>Tugatildi</h2>')[0], /Oq ko‘ylak/);
  }
  const workerId = [...adminHtml.matchAll(/<option value="(\d+)"[^>]*>Muqaddam · ([^<]+)<\/option>/g)]
    .find(match => match[2] === login)[1];
  const reset = await admin('/admin/reset', { worker: workerId });
  assert.equal(reset.status, 200);
  assert.match(await (await worker('/')).text(), /Ishchi kirishi/);
}

test('HTTP: admin, faollashtirish, imzolangan passkey va rollar', t => loginFlow(t));
test('Netlify Function: SQLite adapter, HTTPS kirish kaliti va hisobot', t => loginFlow(t, true));




