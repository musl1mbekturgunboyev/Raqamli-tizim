import { all, one, workClock, zone, closedMonth } from './model.mjs';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const moneyFormat = new Intl.NumberFormat('uz-UZ');
const auditClock = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, dateStyle: 'short', timeStyle: 'medium' });
const money = (n) => moneyFormat.format(n) + ' so‘m';
const hidden = (name, value) => `<input type="hidden" name="${name}" value="${escape(value)}">`;
const form = (action, body, label, tail = '') =>
  `<form method="post" action="${action}" ${tail}>${body}<button>${label}</button></form>`;
const input = (name, title, opts = 'required') => `<label>${title}<input name="${name}" ${opts}></label>`;
const number = (name, title, value = '', min = 1, max = 1000000) =>
  input(name, title, `type="number" inputmode="numeric" min="${min}" max="${max}" value="${value}" required`);
const option = (value, title) => `<option value="${escape(value)}">${escape(title)}</option>`;
const table = (headers, rows) => rows.length ? `<div class="scroll"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
  <tbody>${rows.map(cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">Hozircha yozuv yo‘q.</p>';

export function page(title, content, user) {
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escape(title)} · Chevarxona</title><link rel="stylesheet" href="/style.css"></head>
  <body><header><a class="brand" href="/">CHEVARXONA <span> / ISHBAY HISOB</span></a>
  ${user ? `<div class="account">${escape(user.name)}${form('/logout', '', 'Chiqish')}</div>` : ''}</header>
  <main>${content}</main></body></html>`;
}

export function loginPage(admin = false) {
  return page('Kirish', `<section class="card login"><p class="eyebrow">SHAXSIY KABINET</p>
  <h1>${admin ? 'Admin kirishi' : 'Ishchi kirishi'}</h1>
  ${admin ? form('/admin/login', input('login', 'Admin ID', 'required autocomplete="username" maxlength="40"') +
    input('password', 'Parol', 'type="password" required autocomplete="current-password" maxlength="128"'), 'Kirish')
    : `<form id="passkey"><label>Ishchi ID<input id="login" required maxlength="40" autocomplete="username" placeholder="Muqaddam1987"></label>
    <label>Bir martalik kod (birinchi kirishda)<input id="code" maxlength="64" autocomplete="off"></label>
    <button>Kirish</button><p id="login-message" role="status"></p></form>
    <script defer src="/passkey-lib.js"></script><script defer src="/login.js"></script>`}
  <a href="${admin ? '/' : '/admin/login'}">${admin ? 'Ishchi kirishiga qaytish' : 'Admin kirishi'}</a></section>`);
}

export function message(title, text, user) {
  return page(title, `<section class="card"><h1>${escape(title)}</h1><p>${escape(text)}</p><a href="/">Bosh sahifaga qaytish</a></section>`, user);
}

function editForm(row, admin = false, month = '') {
  return `<details><summary>Tahrirlash</summary>${form(admin ? '/admin/edit' : '/work/edit',
    hidden('id', row.id) + hidden('expected', row.qty) + hidden('month', month) +
    input('reason', 'Tahrirlash sababi', 'required maxlength="500"') + number('qty', 'Yangi dona', row.qty, 0),
    'Tahrirni saqlash')}</details>`;
}

function entryRows(rows, editable, month = '', admin = false) {
  return table(['Sana', ...(admin ? ['Ishchi'] : []), 'Buyurtma / operatsiya', 'Dona', 'Tarif', 'Summa', 'Amal'],
    rows.map(r => [escape(r.day), ...(admin ? [escape(r.worker_name)] : []),
      escape(r.order_name) + ' / ' + escape(r.operation_name), r.qty, money(r.rate), money(r.qty * r.rate),
      editable(r) ? editForm(r, admin, month) : 'Yopiq']));
}
const entryQuery = `SELECT e.*, o.order_id, p.name worker_name, p.login worker_login, b.name order_name, o.name operation_name
  FROM entries e JOIN people p ON p.id=e.worker JOIN operations o ON o.id=e.operation
  JOIN orders b ON b.id=o.order_id`;
export async function monthEntries(month, worker) {
  return worker
    ? await all(entryQuery + " WHERE day>=? AND day<? AND worker=? ORDER BY day DESC,e.id DESC", month + "-01", month + "-32", worker)
    : await all(entryQuery + " WHERE day>=? AND day<? ORDER BY day DESC,e.id DESC", month + "-01", month + "-32");
}

export function monthFrom(raw) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(raw || '') ? raw : workClock().date.slice(0, 7);
}
function monthForm(month, worker) {
  return `<form class="inline" method="get">${input('month', 'Hisobot oyi', `type="month" value="${month}" required`)}
    ${worker ? hidden('worker', worker) : ''}<button>Ko‘rish</button></form>`;
}

function totals(rows) {
  return rows.reduce((t, row) => ({ qty: t.qty + row.qty, sum: t.sum + BigInt(row.qty * row.rate) }), { qty: 0, sum: 0n });
}

const orderList = `SELECT b.*, c.order_id closed FROM orders b
  LEFT JOIN completed_orders c ON c.order_id=b.id ORDER BY b.id DESC`;

export async function workerPage(user, month, saved) {
  const { date, mode, sunday, untilChange } = workClock();
  const [orders, assigned, today, history, off] = await Promise.all([
    all(orderList),
    all(`SELECT o.*, e.id entry_id FROM assignments a JOIN operations o ON o.id=a.operation
      LEFT JOIN entries e ON e.worker=a.worker AND e.operation=o.id AND e.day=?
      WHERE a.worker=? ORDER BY o.name`, date, user.id),
    all(entryQuery + ' WHERE day=? AND worker=? ORDER BY e.id DESC', date, user.id),
    monthEntries(month, user.id),
    one('SELECT 1 FROM no_work WHERE worker=? AND day=?', user.id, date),
  ]);
  const completed = new Set(orders.filter(order => order.closed).map(order => order.id));
  const active = orders.filter(order => !order.closed);
  const activeById = new Map(active.map(order => [order.id, order]));
  const tasks = assigned.filter(operation => activeById.has(operation.order_id));
  const savedRow = today.find(row => String(row.id) === saved);
  const editable = row => row.day === date && mode !== 'closed' && !completed.has(row.order_id);
  const label = sunday ? 'Yakshanba · dam olish kuni' : {
    entry: 'Kiritish ochiq · 18:00 gacha', edit: 'Faqat tahrirlash · 20:00 gacha', closed: 'Kunlik kiritish yopiq',
  }[mode];
  return page('Ishchi kabineti', `<div class="heading"><p class="eyebrow">ISHCHI KABINETI · ${escape(zone)}</p><h1>Bugungi ish</h1>
  <p>${date} <span class="badge" data-date="${date}" data-work-mode="${mode}" data-until-change="${untilChange}">${label}</span></p></div>
  <section class="cards"><div class="card"><small>BUGUNGI DONA</small><strong>${totals(today).qty}</strong></div>
  <div class="card"><small>BUGUNGI ISHBAY HAQ</small><strong>${money(totals(today).sum)}</strong></div></section>
  <section class="card" id="today-work"><h2>Bugungi vazifalarim</h2>
  ${savedRow ? `<p class="badge" role="status">Bugun ${savedRow.qty} dona saqlandi · ${money(savedRow.qty * savedRow.rate)}</p>` : ''}
  ${off ? '<p class="badge">Bugun ish bo‘lmadi deb belgilangan.</p>' : ''}
  ${tasks.map(o => `<div class="operation"><b>${escape(activeById.get(o.order_id).name)} · ${escape(o.name)}</b>
    <p>${money(o.rate)} / dona</p>
    ${mode === 'entry' && !o.entry_id ? form('/work/add', hidden('operation', o.id) + hidden('day', date) +
      number('qty', 'Bajarilgan dona') + `<output data-rate="${o.rate}" aria-live="polite"></output>`, 'Saqlash', 'class="quick-entry"')
      : o.entry_id ? '<span class="badge">Saqlandi</span>' : ''}</div>`).join('') || '<p>Faol vazifa biriktirilmagan.</p>'}
  ${mode === 'entry' && !today.length && !off ? form('/work/no-work', hidden('day', date), 'Bugun ish bo‘lmadi') : ''}</section>
  <section class="card"><h2>Jarayonda</h2>${table(['Buyurtma', 'Reja, dona'], active.map(b => [escape(b.name), b.target]))}</section>
  <section class="card"><h2>Tugatildi</h2>${table(['Buyurtma', 'Reja, dona'], orders.filter(b => b.closed).map(b => [escape(b.name), b.target]))}</section>
  <section class="card"><h2>Bugungi yozuvlar</h2>${entryRows(today, editable)}</section>
  <section class="card"><h2>Mening oyligim</h2>${monthForm(month)}<p><b>${escape(month)} · ${totals(history).qty} dona · ${money(totals(history).sum)}</b></p>
  ${entryRows(history, editable)}</section><script defer src="/work.js"></script>`, user);
}

const groupKey = value => (value || '').normalize('NFKC').trim().toLocaleLowerCase('uz')
  .replace(/[‘’ʻʼ]/g, "'").replace(/\s+/g, ' ');

function groupWorkers(workers, field, unassigned) {
  const groups = new Map();
  for (const worker of workers) {
    const key = groupKey(worker[field]);
    if (!groups.has(key)) groups.set(key, { key, title: worker[field] || unassigned, workers: [] });
    groups.get(key).workers.push(worker);
  }
  return [...groups.values()].sort((a, b) => a.key && b.key ? a.title.localeCompare(b.title, 'uz') : Number(!a.key) - Number(!b.key));
}

function workerDirectory(workers, operations, sent, offIds, activation, rawSearch) {
  const search = String(rawSearch || '').slice(0, 120);
  const query = groupKey(search);
  const visible = workers.filter(w => [w.name, w.login, w.brigade, w.job].some(value => groupKey(value).includes(query)));
  const names = (field, id) => `<datalist id="${id}">${groupWorkers(workers, field, '').filter(g => g.key).map(g => option(g.title, g.title)).join('')}</datalist>`;
  const groupInput = (key, label, value = '') => input(key, label,
    `maxlength="80" list="worker-${key}-list" value="${escape(value)}"`);
  const workerRows = list => table(['Ism va familiya', 'ID', 'Kirish kaliti', 'Bugungi yozuv', 'Boshqarish'], list.map(w => [
    escape(w.name), escape(w.login), w.ready ? 'Faol' : 'Faollashtirilmagan',
    sent.has(w.id) ? 'Kiritilgan' : offIds.has(w.id) ? 'Ish bo‘lmadi' : '—',
    `<details><summary>Guruhini o‘zgartirish</summary>
      ${form('/admin/brigade', hidden('worker', w.id) + groupInput('brigade', 'Brigada', w.brigade) + groupInput('job', 'Ish turi', w.job), 'Saqlash')}</details>
    <details><summary>Yangi kod</summary><p>Eski kalit va seanslar bekor qilinadi.</p>
      ${form('/admin/reset#worker-activation', hidden('worker', w.id), 'Yangi kod berish')}</details>`,
  ]));
  const groups = groupWorkers(visible, 'brigade', 'Brigada tanlanmagan');
  return `<section class="card" id="workers"><h2>Ishchilar <span class="badge">${workers.length}</span></h2>
    ${activation ? `<div id="worker-activation" class="operation" role="status"><h3>Bir martalik kod</h3>
      <p>${escape(activation.login)} · <code>${escape(activation.code)}</code></p><p>Kodni ishchining o‘ziga bering. 24 soat amal qiladi.</p></div>` : ''}
    <details class="order"><summary>Ishchi qo‘shish</summary>
      ${form('/admin/worker#worker-activation', input('name', 'Ism va familiya', 'required maxlength="120"') +
        input('login', 'Ishchi ID', 'required maxlength="40" placeholder="Muqaddam1987"') +
        groupInput('brigade', 'Brigada') + groupInput('job', 'Ish turi') +
        (operations.length ? `<label>Buyurtmadagi operatsiya (ixtiyoriy)<select name="operation">
          <option value="">Keyin biriktiraman</option>${operations.map(o => option(o.id, o.order_name + ' / ' + o.name)).join('')}</select></label>` : ''),
        'Ishchini saqlash', 'class="inline"')}
      <p class="muted">Brigada va ish turi bo‘yicha ishchi o‘z guruhiga tushadi. Dona kiritishi uchun buyurtmadagi operatsiyani tanlang.</p>
    </details>
    ${names('brigade', 'worker-brigade-list')}${names('job', 'worker-job-list')}
    <form method="get" action="/#workers" class="inline">${input('workerSearch', 'Ism, ID, brigada yoki ish turidan qidirish',
      `type="search" maxlength="120" value="${escape(search)}"`)}<button>Qidirish</button>
      ${search ? '<a href="/#workers">Qidiruvni tozalash</a>' : ''}</form>
    ${groups.map(g => `<details class="order" ${search || groups.length === 1 ? 'open' : ''}><summary>${escape(g.title)} · ${g.workers.length} ishchi</summary>
      ${groupWorkers(g.workers, 'job', 'Ish turi tanlanmagan').map(j => `<details class="operation" ${search ? 'open' : ''}>
        <summary>${escape(j.title)} · ${j.workers.length} ishchi</summary>${workerRows(j.workers)}</details>`).join('')}</details>`).join('')
      || '<p class="muted">Ishchi topilmadi.</p>'}</section>`;
}

export async function adminPage(user, month, worker, activation, pageNumber = 1, filters = {}) {
  const { date, sunday } = workClock();
  const [orders, workers, operations, assignments, rows, today, audit, off, locked, monthAudit] = await Promise.all([
    all(orderList),
    all(`SELECT p.id, p.login, p.name, g.brigade, j.job, EXISTS(SELECT 1 FROM passkeys k WHERE k.person=p.id) ready
      FROM people p LEFT JOIN worker_brigades g ON g.worker=p.id LEFT JOIN worker_jobs j ON j.worker=p.id
      WHERE p.role='worker' ORDER BY p.name`),
    all(`SELECT o.*, b.name order_name, b.target, COALESCE(SUM(e.qty),0) done
      FROM operations o JOIN orders b ON b.id=o.order_id LEFT JOIN entries e ON e.operation=o.id
      GROUP BY o.id ORDER BY b.id DESC,o.name`),
    all(`SELECT a.*, p.name FROM assignments a JOIN people p ON p.id=a.worker ORDER BY p.name`),
    monthEntries(month, worker),
    all('SELECT DISTINCT e.worker, o.order_id FROM entries e JOIN operations o ON o.id=e.operation WHERE e.day=?', date),
    all(`SELECT a.*, p.name actor_name, w.name worker_name, e.day, o.name operation_name, b.name order_name
      FROM audit a JOIN people p ON p.id=a.actor JOIN entries e ON e.id=a.entry JOIN people w ON w.id=e.worker
      JOIN operations o ON o.id=e.operation JOIN orders b ON b.id=o.order_id
      WHERE e.day>=? AND e.day<? AND (? IS NULL OR e.worker=?) ORDER BY a.id DESC`, month + "-01", month + "-32", worker, worker),
    all('SELECT worker FROM no_work WHERE day=?', date),
    closedMonth(month),
    all(`SELECT a.*, p.name FROM month_audit a JOIN people p ON p.id=a.actor WHERE a.month=? ORDER BY a.id DESC`, month),
  ]);
  const active = orders.filter(order => !order.closed);
  const completed = orders.filter(order => order.closed);
  const activeIds = new Set(active.map(order => order.id));
  const activeOperations = operations.filter(operation => activeIds.has(operation.order_id));
  const daily = new Map();
  const monthly = new Map();
  for (const r of rows) {
    for (const [map, key] of [[daily, r.worker + '/' + r.day], [monthly, r.worker]]) {
      const sum = map.get(key) || { name: r.worker_name, day: r.day, qty: 0, amount: 0n };
      sum.qty += r.qty;
      sum.amount += BigInt(r.qty * r.rate);
      map.set(key, sum);
    }
  }
  const sent = new Set(today.map(row => row.worker));
  const offIds = new Set(off.map(row => row.worker));
  const relevantOperations = new Set(activeOperations.filter(o => !filters.order || o.order_id === filters.order).map(o => o.id));
  const expected = new Set(assignments.filter(a => relevantOperations.has(a.operation)).map(a => a.worker));
  const submitted = new Set(today.filter(row => !filters.order || row.order_id === filters.order).map(row => row.worker));
  const roster = workers.filter(w => expected.has(w.id) && (!filters.brigade || groupKey(w.brigade) === groupKey(filters.brigade)));
  const missing = roster.filter(w => !submitted.has(w.id) && !offIds.has(w.id));
  const brigades = groupWorkers(workers, 'brigade', '').filter(g => g.key).map(g => g.title);
  const filterOption = (value, title, selected) =>
    `<option value="${escape(value)}"${selected ? ' selected' : ''}>${escape(title)}</option>`;
  const pageCount = Math.max(1, Math.ceil(Math.max(rows.length, audit.length) / 100));
  const current = Math.min(pageCount, Math.max(1, pageNumber));
  const show = list => list.slice((current - 1) * 100, current * 100);
  const report = `month=${month}${worker ? '&amp;worker=' + worker : ''}`;
  const pageLink = (n, label) => `<a href="/?${report}&amp;page=${n}#report">${label}</a>`;
  const paging = pageCount > 1 ? `<p>${current > 1 ? pageLink(current - 1, 'Oldingi') + ' · ' : ''}Sahifa ${current} / ${pageCount}${current < pageCount ? ' · ' + pageLink(current + 1, 'Keyingi') : ''}</p>` : '';
  const workerOptions = workers.map(w => option(w.id, w.name + ' · ' + w.login)).join('');
  return page('Admin kabineti', `<div class="heading"><p class="eyebrow">ADMIN KABINETI · ${date}</p><h1>Ishlab chiqarish nazorati</h1>
  <nav><a href="#today-check">Bugungi nazorat</a><a href="#orders">Buyurtmalar</a><a href="#workers">Ishchilar</a><a href="#report">Hisobot</a><a href="#audit">Tahrirlar</a></nav></div>
  <section class="cards"><div class="card"><small>ISHCHILAR</small><strong>${workers.length}</strong></div>
  <div class="card"><small>BUGUN KIRITGAN</small><strong>${sent.size}</strong></div>
  <div class="card"><small>BUYURTMALAR</small><strong>${orders.length}</strong></div></section>
  <section class="card" id="today-check"><h2>Bugun kim kiritmadi?</h2>
  <form method="get" action="/#today-check" class="inline">
  <label>Brigada<select name="brigade"><option value="">Barchasi</option>${brigades.map(g => filterOption(g, g, filters.brigade === g)).join('')}</select></label>
  <label>Buyurtma<select name="todayOrder"><option value="">Barchasi</option>${active.map(o => filterOption(o.id, o.name, filters.order === o.id)).join('')}</select></label>
  <button>Filtrlash</button></form>
  ${sunday ? '<p>Yakshanba · dam olish kuni.</p>' : `<p>${roster.length} ishchi · ${roster.filter(w => submitted.has(w.id)).length} kiritdi ·
    ${roster.filter(w => offIds.has(w.id)).length} ish bo‘lmadi · <b>${missing.length} kiritmadi</b></p>
    ${table(['Ishchi', 'ID', 'Brigada'], missing.map(w => [escape(w.name), escape(w.login), escape(w.brigade || '—')]))}`}</section>
  <section class="card" id="orders"><h2>Jarayonda</h2>
  <div class="split"><div><h3>Buyurtma ochish</h3>${form('/admin/order', input('name', 'Buyurtma nomi') + number('target', 'Reja, dona'), 'Buyurtma yaratish')}</div>
  <div><h3>Operatsiya ochish</h3>${active.length ? form('/admin/operation', `<label>Buyurtma<select name="order">${active.map(b => option(b.id, b.name)).join('')}</select></label>` +
  input('name', 'Operatsiya nomi') + number('rate', 'Donabay narx, so‘m', '', 1, 100000000), 'Operatsiya yaratish') : '<p>Avval buyurtma oching.</p>'}</div></div>
  ${table(['Buyurtma / operatsiya', 'Bajarildi / reja', 'Tarif', 'Biriktirilgan ishchilar'],
  activeOperations.map(o => [escape(o.order_name) + ' / ' + escape(o.name),
    `<progress aria-label="Bajarilgan dona" value="${Math.min(o.done, o.target)}" max="${o.target}"></progress> ${o.done} / ${o.target}`,
    `<details><summary>${money(o.rate)}</summary>${form('/admin/rate', hidden('operation', o.id) + number('rate', 'Yangi tarif', o.rate, 1, 100000000), 'Tarifni saqlash')}</details>`,
    assignments.filter(a => a.operation === o.id).map(a => escape(a.name) + form('/admin/unassign', hidden('worker', a.worker) + hidden('operation', a.operation), 'Ajratish', 'class="small"')).join('<br>') || '—']))}
  ${workers.length && activeOperations.length ? form('/admin/assign', `<label>Ishchi<select name="worker">${workerOptions}</select></label>
  <label>Operatsiya<select name="operation">${activeOperations.map(o => option(o.id, o.order_name + ' / ' + o.name)).join('')}</select></label>`, 'Vazifani biriktirish', 'class="inline"') : ''}
  ${table(['Buyurtma', 'Reja, dona', 'Amal'], active.map(b => [escape(b.name), b.target,
    `<details><summary>Yopish</summary><p>Ishchilar bu buyurtmaga boshqa yozuv kirita olmaydi.</p>${form('/admin/order/complete', hidden('order', b.id), 'Tugatildi deb belgilash')}</details>`]))}</section>
  <section class="card" id="completed-orders"><h2>Tugatildi</h2>
  ${table(['Buyurtma', 'Reja, dona', 'Operatsiyalar'], completed.map(b => [escape(b.name), b.target,
    operations.filter(o => o.order_id === b.id).map(o => escape(o.name) + ' · ' + o.done + ' dona').join('<br>') || '—']))}</section>
  ${workerDirectory(workers, activeOperations, sent, offIds, activation, filters.workerSearch)}
  <section class="card" id="report"><h2>Oylik hisobot</h2>
  <form method="get" action="/#report" class="inline">${input('month', 'Oy', `type="month" value="${month}" required`)}
  <label>Ishchi<select name="worker"><option value="">Barchasi</option>${workers.map(w => `<option value="${w.id}" ${w.id === worker ? 'selected' : ''}>${escape(w.name)} · ${escape(w.login)}</option>`).join('')}</select></label><button>Ko‘rish</button></form>
  <p><a href="/admin/export?${report}">Excel uchun CSV yuklash</a></p>
  <p><span class="badge">${locked ? 'Oy yopilgan' : 'Oy ochiq'}</span></p>
  ${locked ? form('/admin/month/reopen', hidden('month', month) + input('reason', 'Qayta ochish sababi', 'required maxlength="500"'), 'Oyni qayta ochish')
    : month < date.slice(0, 7) ? `<details><summary>Oy hisobini yopish</summary><p>Yopilgan oyning yozuvlari tahrir uchun bloklanadi.</p>
      ${form('/admin/month/close', hidden('month', month), 'Oyni yopish')}</details>` : ''}
  ${monthAudit.length ? table(['Vaqt', 'Kim', 'Amal', 'Sabab'], monthAudit.map(a => [
    escape(auditClock.format(new Date(a.at))), escape(a.name), a.action === 'close' ? 'Yopildi' : 'Qayta ochildi', escape(a.reason || '—'),
  ])) : ''}
  <h3>Oy bo‘yicha jami</h3>${table(['Ishchi', 'Jami dona', 'Jami haq'], [...monthly.values()].map(r => [escape(r.name), r.qty, money(r.amount)]))}
  <h3>Kun bo‘yicha jami</h3>${table(['Sana', 'Ishchi', 'Dona', 'Summa'], [...daily.values()].map(r => [escape(r.day), escape(r.name), r.qty, money(r.amount)]))}
  <h3>Barcha yozuvlar</h3>${paging}${entryRows(show(rows), () => !locked, month, true)}</section>
  <section class="card" id="audit"><h2>Tahrirlar tarixi</h2>${table(['Vaqt', 'Ish sanasi', 'Ishchi', 'Buyurtma / operatsiya', 'Kim', 'Dona', 'Sabab'], show(audit).map(r =>
    [escape(auditClock.format(new Date(r.at))),
    escape(r.day), escape(r.worker_name), escape(r.order_name) + ' / ' + escape(r.operation_name), escape(r.actor_name), r.old_qty + ' → ' + r.new_qty, escape(r.reason)]))}</section>`, user);
}





