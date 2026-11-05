import { random, digest, checkPassword, one, run, transaction, InputError, need, clean,
  integer, loginId, activate, createEntry, editEntry, workClock } from './model.mjs';
import { adminPage, loginPage, message, monthEntries, monthFrom, workerPage } from './view.mjs';

export function createApp(appOrigin, asset = () => null) {
  const originUrl = new URL(appOrigin);
  const origin = originUrl.origin;
  const secure = originUrl.protocol === 'https:';
  if (!secure && !['localhost', '127.0.0.1'].includes(originUrl.hostname)) throw new Error('Telefonlar uchun HTTPS manzil kerak.');
  const rpID = originUrl.hostname;

  const limits = new Map();
  const sessionCookie = secure ? '__Host-chevar' : 'chevar';

  function cookie(req, key) {
    const raw = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(key + '='))?.slice(key.length + 1);
    return /^[\w-]{43}$/.test(raw || '') ? raw : null;
  }

  function setCookie(res, key, value, age) {
    res.setHeader('Set-Cookie', `${key}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`);
  }

  async function userFrom(req) {
    const token = cookie(req, sessionCookie);
    return token && await one(`SELECT p.id,p.name,p.role,p.login FROM sessions s JOIN people p ON p.id=s.person
      WHERE s.token=? AND s.expires>?`, digest(token), Date.now());
  }

  async function signIn(req, res, id) {
    const token = random();
    const old = cookie(req, sessionCookie);
    if (old) await run('DELETE FROM sessions WHERE token=?', digest(old));
    await run('INSERT INTO sessions VALUES(?,?,?)', digest(token), id, Date.now() + 8 * 3600000);
    setCookie(res, sessionCookie, token, 8 * 3600);
  }

  function limit(key, max) {
    const now = Date.now();
    const previous = limits.get(key);
    const row = previous?.until > now ? previous : { count: 0, until: now + 60000 };
    row.count++;
    limits.set(key, row);
    need(row.count <= max, 'Juda ko‘p urinish. Bir daqiqadan so‘ng qayta urinib ko‘ring.');
  }

  let cleanupAt = 0;
  async function cleanExpired() {
    const now = Date.now();
    if (now < cleanupAt) return;
    cleanupAt = now + 60000;
    for (const [key, row] of limits) if (row.until <= now) limits.delete(key);
    await run('DELETE FROM auth_challenges WHERE expires<=?', now);
    await run('DELETE FROM sessions WHERE expires<=?', now);
  }

  async function body(req, json) {
    const type = req.headers['content-type']?.split(';')[0];
    need(type === (json ? 'application/json' : 'application/x-www-form-urlencoded'), 'So‘rov formati xato.');
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      need(size <= 64000, 'So‘rov juda katta.');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!json) return Object.fromEntries(new URLSearchParams(raw));
    try {
      const parsed = JSON.parse(raw);
      need(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'So‘rov xato.');
      return parsed;
    } catch {
      throw new InputError('So‘rov formati xato.');
    }
  }

  const send = (res, data, status = 200, type = 'text/html; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(data);
  };
  const json = (res, data, status) => send(res, JSON.stringify(data), status, 'application/json; charset=utf-8');
  const redirect = (res, path = '/') => { res.writeHead(303, { Location: path }); res.end(); };
  const idValue = value => integer(value, 1, Number.MAX_SAFE_INTEGER);
  const person = id => one("SELECT * FROM people WHERE id=? AND role='worker'", id);

  async function passkey(req, res, path, data) {
    limit('passkey:' + req.socket.remoteAddress, 1000);
    const lib = await import('@simplewebauthn/server');
    const verifyConfig = { expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true };
    if (path === '/auth/options') {
      const login = loginId(data.login);
      limit('worker:' + login.toLowerCase(), 15);
      const worker = await one("SELECT * FROM people WHERE login=? AND role='worker'", login);
      const credential = worker && await one('SELECT * FROM passkeys WHERE person=?', worker.id);
      const code = typeof data.code === 'string' ? data.code.slice(0, 64) : '';
      const registration = !credential;
      need(worker && (credential || (worker.activation_until > Date.now() && worker.activation === digest(code))),
        'ID yoki bir martalik kod xato. Birinchi kirishda admin bergan kodni kiriting.');
      const options = registration
        ? await lib.generateRegistrationOptions({ rpName: 'Chevarxona', rpID,
          userID: Buffer.from(String(worker.id)), userName: worker.login, userDisplayName: worker.name,
          authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' } })
        : await lib.generateAuthenticationOptions({ rpID, userVerification: 'required',
          allowCredentials: [{ id: credential.id, transports: JSON.parse(credential.transports) }] });
      const nonce = random();
      await run('INSERT INTO auth_challenges VALUES(?,?,?)', digest(nonce),
        JSON.stringify({ worker: worker.id, registration, activation: worker.activation, challenge: options.challenge }),
        Date.now() + 180000);
      setCookie(res, secure ? '__Host-chevar-auth' : 'chevar-auth', nonce, 180);
      return json(res, { registration, options });
    }
    const key = cookie(req, secure ? '__Host-chevar-auth' : 'chevar-auth');
    const record = key && await transaction(async () => {
      const row = await one('SELECT data FROM auth_challenges WHERE token=? AND expires>?', digest(key), Date.now());
      if (row) await run('DELETE FROM auth_challenges WHERE token=?', digest(key));
      return row;
    });
    need(record && data.response, 'Kirish vaqti tugadi. Qayta urinib ko‘ring.');
    const attempt = JSON.parse(record.data);
    const config = { ...verifyConfig, response: data.response, expectedChallenge: attempt.challenge };
    if (attempt.registration) {
      const result = await lib.verifyRegistrationResponse(config).catch(() => null);
      need(result?.verified, 'Kirish kalitini tekshirib bo‘lmadi.');
      const c = result.registrationInfo.credential;
      await transaction(async () => {
        const worker = await person(attempt.worker);
        need(worker?.activation && worker.activation === attempt.activation && worker.activation_until > Date.now(),
          'Faollashtirish kodi eskirgan yoki ishlatilgan.');
        await run('INSERT INTO passkeys VALUES(?,?,?,?,?)', c.id, worker.id, Buffer.from(c.publicKey), c.counter, JSON.stringify(c.transports || []));
        await run('UPDATE people SET activation=NULL, activation_until=NULL WHERE id=?', worker.id);
        await signIn(req, res, worker.id);
      });
    } else {
      const credential = await one('SELECT * FROM passkeys WHERE person=? AND id=?', attempt.worker, String(data.response.id || ''));
      need(credential, 'Bu kirish kaliti ishchiga tegishli emas.');
      const result = await lib.verifyAuthenticationResponse({ ...config,
        credential: { id: credential.id, publicKey: new Uint8Array(credential.key), counter: credential.counter } }).catch(() => null);
      need(result?.verified, 'Telefon tasdig‘ini tekshirib bo‘lmadi.');
      await transaction(async () => {
        const update = await run('UPDATE passkeys SET counter=? WHERE id=? AND counter=?',
          result.authenticationInfo.newCounter, credential.id, credential.counter);
        need(update.changes === 1, 'Kirish kaliti yangilangan. Qayta urinib ko‘ring.');
        await signIn(req, res, attempt.worker);
      });
    }
    return json(res, { ok: true });
  }

  function csv(rows) {
    const quote = (value) => {
      const str = String(value);
      const safe = typeof value === 'string' && /^[\s]*[=+@-]/.test(str) ? "'" + str : str;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const totals = new Map();
    const daily = new Map();
    for (const r of rows) {
      const dayKey = r.worker + '/' + r.day;
      const day = daily.get(dayKey) || [r.day, r.worker_login, r.worker_name, 0, 0n];
      day[3] += r.qty;
      day[4] += BigInt(r.rate * r.qty);
      daily.set(dayKey, day);
      const row = totals.get(r.worker) || [r.worker_login, r.worker_name, 0, 0n];
      row[2] += r.qty;
      row[3] += BigInt(r.rate * r.qty);
      totals.set(r.worker, row);
    }
    return '\uFEFF' + [
      ['Sana', 'Ishchi ID', 'Ishchi', 'Buyurtma', 'Operatsiya', 'Dona', 'Tarif', 'Summa'],
      ...rows.map(r => [r.day, r.worker_login, r.worker_name, r.order_name, r.operation_name, r.qty, r.rate, r.qty * r.rate]),
      [],
      ['Kun bo‘yicha jami', 'Ishchi ID', 'Ishchi', '', '', 'Jami dona', '', 'Jami summa'],
      ...[...daily.values()].map(([day, login, name, qty, sum]) => [day, login, name, '', '', qty, '', sum]),
      [],
      ['Oy bo‘yicha jami', 'Ishchi ID', 'Ishchi', '', '', 'Jami dona', '', 'Jami summa'],
      ...[...totals.values()].map(([login, name, qty, sum]) => ['', login, name, '', '', qty, '', sum]),
    ].map(row => row.map(quote).join(',')).join('\r\n');
  }

  async function adminAction(res, user, path, data) {
    if (path === '/admin/worker') {
      const login = loginId(data.login);
      const name = clean(data.name);
      need(!(await one('SELECT id FROM people WHERE login=?', login)), 'Bu ID band.');
      const result = await run("INSERT INTO people(login,name,role) VALUES(?,?,'worker')", login, name);
      return send(res, await adminPage(user, monthFrom(), null, { login, code: await activate(result.lastInsertRowid) }));
    }
    if (path === '/admin/reset') {
      const worker = await person(idValue(data.worker));
      need(worker, 'Ishchi topilmadi.');
      return send(res, await adminPage(user, monthFrom(), null, { login: worker.login, code: await activate(worker.id) }));
    }
    if (path === '/admin/order') {
      await run('INSERT INTO orders(name,target) VALUES(?,?)', clean(data.name), integer(data.target));
    } else if (path === '/admin/operation') {
      const order = idValue(data.order);
      const name = clean(data.name);
      need(await one('SELECT id FROM orders WHERE id=?', order), 'Buyurtma topilmadi.');
      need(!(await one('SELECT id FROM operations WHERE order_id=? AND name=?', order, name)), 'Bu operatsiya mavjud.');
      await run('INSERT INTO operations(order_id,name,rate) VALUES(?,?,?)', order, name, integer(data.rate, 1, 100000000));
    } else if (path === '/admin/rate') {
      await run('UPDATE operations SET rate=? WHERE id=?', integer(data.rate, 1, 100000000), idValue(data.operation));
    } else if (path === '/admin/assign' || path === '/admin/unassign') {
      const worker = idValue(data.worker);
      const operation = idValue(data.operation);
      need(await person(worker) && await one('SELECT id FROM operations WHERE id=?', operation), 'Ishchi yoki operatsiya topilmadi.');
      if (path === '/admin/assign') await run('INSERT OR IGNORE INTO assignments VALUES(?,?)', worker, operation);
      else await run('DELETE FROM assignments WHERE worker=? AND operation=?', worker, operation);
    } else if (path === '/admin/edit') {
      await editEntry(user, idValue(data.id), integer(data.qty, 0), data.reason, integer(data.expected, 0));
      return redirect(res, '/?month=' + monthFrom(data.month) + '#report');
    } else {
      return send(res, message('Topilmadi', 'Bu sahifa mavjud emas.', user), 404);
    }
    return redirect(res, '/#orders');
  }

  return async function app(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Same-origin form submissions need a non-null Origin for the POST check.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    let user;
    let path = '';
    try {
      const url = new URL(req.url, origin);
      path = url.pathname;
      const file = req.method === 'GET' && asset(path);
      if (file) return send(res, file.data, 200, file.type);
      await cleanExpired();
      user = await userFrom(req);
      let admin = user?.role === 'admin';
      if (req.method === 'GET') {
        const month = monthFrom(url.searchParams.get('month'));
        const worker = admin && url.searchParams.get('worker') ? idValue(url.searchParams.get('worker')) : null;
        if (path === '/') return send(res, user ? admin ? await adminPage(user, month, worker, null, Number(url.searchParams.get('page')) || 1) : await workerPage(user, month) : loginPage());
        if (path === '/admin/login') return user ? redirect(res) : send(res, loginPage(true));
        if (path === '/work/status' && user?.role === 'worker') return json(res, workClock());
        if (path === '/admin/export' && admin) {
          res.setHeader('Content-Disposition', `attachment; filename="chevarxona-${month}.csv"`);
          return send(res, csv(await monthEntries(month, worker)), 200, 'text/csv; charset=utf-8');
        }
        return send(res, message('Topilmadi', 'Bu sahifa mavjud emas.', user), 404);
      }
      need(req.method === 'POST' && req.headers.origin === origin, 'So‘rov manzili tasdiqlanmadi.');
      if (path === '/auth/options' || path === '/auth/verify') {
        return await passkey(req, res, path, await body(req, true));
      }
      const data = await body(req, false);
      if (path === '/admin/login') {
        limit('admin:' + req.socket.remoteAddress, 12);
        const login = loginId(data.login);
        const row = await one("SELECT * FROM people WHERE login=? AND role='admin'", login);
        need(row && typeof data.password === 'string' && data.password.length <= 128 && await checkPassword(data.password, row.password), 'ID yoki parol xato.');
        await signIn(req, res, row.id);
        return redirect(res);
      }
      user = await userFrom(req);
      admin = user?.role === 'admin';
      if (!user) return redirect(res);
      if (path === '/logout') {
        const token = cookie(req, sessionCookie);
        if (token) await run('DELETE FROM sessions WHERE token=?', digest(token));
        setCookie(res, sessionCookie, '', 0);
        return redirect(res);
      }
      if (admin && path.startsWith('/admin/')) return await adminAction(res, user, path, data);
      if (user.role === 'worker' && path === '/work/add') {
        const now = new Date();
        need(workClock(now).date === data.day, 'Sana almashgan. Yangi kun sahifasini oching.');
        await createEntry(user.id, idValue(data.operation), integer(data.qty), now);
        return redirect(res);
      }
      if (user.role === 'worker' && path === '/work/edit') {
        await editEntry(user, idValue(data.id), integer(data.qty, 0), data.reason, integer(data.expected, 0));
        return redirect(res);
      }
      return send(res, message('Ruxsat yo‘q', 'Bu amal uchun sizda huquq yo‘q.', user), 403);
    } catch (error) {
      const status = error instanceof InputError ? 400 : 500;
      if (status === 500) console.error(error);
      const detail = status === 400 ? error.message : 'Serverda xato yuz berdi. Qayta urinib ko‘ring.';
      if (path.startsWith('/auth/')) return json(res, { error: detail }, status);
      return send(res, message('Amal bajarilmadi', detail, user), status);
    }
  };
}




