'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { boot, client, sampleData } = require('./helpers');

const loginDirector = async (c, pw = '12345678') => c.post('/api/login', { phone: '۰۹۱۵ ۱۱۱ ۲۲۳۳', password: pw });
const loginAdmin = async c => c.post('/admin/api/admin/login', { username: 'Admin', password: 'admin-secret-1' });

test('سایت مدیر شهرستان: ورود، ذخیره، تعارض، ارسال، تغییر رمز', async t => {
  const s = await boot(); t.after(() => s.close());
  const c = client(s.base);

  assert.equal((await c.get('/api/me')).status, 401);
  const bad = await loginDirector(c, 'wrong');
  assert.equal(bad.status, 401);
  assert.match(bad.json.error, /درست نیست/);

  const ok = await loginDirector(c);
  assert.equal(ok.status, 200);
  assert.ok(c.cookies().hn_sid, 'کوکی نشست');
  const me = (await c.get('/api/me')).json;
  assert.equal(me.user.county, 'نیشابور');
  assert.equal(me.user.mustChange, true);
  assert.equal(me.rev, 0);

  const save1 = await c.put('/api/form', { data: sampleData(), rev: 0 });
  assert.equal(save1.status, 200);
  assert.equal(save1.json.rev, 1);

  // دستگاه دوم با نسخهٔ قدیمی
  const conflict = await c.put('/api/form', { data: { pop: '1' }, rev: 0 });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.rev, 1);
  const forced = await c.put('/api/form', { data: sampleData(), rev: 0, force: true });
  assert.equal(forced.json.rev, 2);

  // دادهٔ نامعتبر و حجم زیاد
  assert.equal((await c.put('/api/form', { data: [1, 2] })).status, 400);
  assert.equal((await c.put('/api/form', '{bad json')).status, 400);
  const big = await c.put('/api/form', { data: { x: 'a'.repeat(900 * 1024) } });
  assert.equal(big.status, 413);

  const sub = await c.post('/api/form/submit');
  assert.equal(sub.status, 200);
  assert.ok(sub.json.submittedAt);
  // ویرایش پس از ارسال ثبت می‌شود
  await c.put('/api/form', { data: sampleData(), rev: 2 });
  assert.ok(s.store.get().forms.u_test.editedAfterSubmit);

  // تغییر رمز: نشست‌های دیگر بسته می‌شوند
  const c2 = client(s.base); await loginDirector(c2);
  assert.equal((await c.post('/api/password', { current: 'x', next: '654321' })).status, 400);
  assert.equal((await c.post('/api/password', { current: '12345678', next: '123' })).status, 400);
  assert.equal((await c.post('/api/password', { current: '12345678', next: '۶۵۴۳۲۱' })).status, 200);
  assert.equal((await c2.get('/api/me')).status, 401, 'نشست دستگاه دیگر بسته شد');
  assert.equal((await c.get('/api/me')).status, 200, 'نشست خودش می‌ماند');
  assert.equal((await c.get('/api/me')).json.user.mustChange, false);
  const c3 = client(s.base);
  assert.equal((await loginDirector(c3, '654321')).status, 200);

  await c.post('/api/logout');
  assert.equal((await c.get('/api/me')).status, 401);
});

test('محدودیت تلاش ورود', async t => {
  const s = await boot({ LOGIN_MAX_ATTEMPTS: 3 }); t.after(() => s.close());
  const c = client(s.base);
  for (let i = 0; i < 3; i++) assert.equal((await loginDirector(c, 'x' + i)).status, 401);
  const blocked = await loginDirector(c);
  assert.equal(blocked.status, 429);
  assert.match(blocked.json.error, /دقیقه/);
});

test('جدایی نشست‌ها و حفاظت از مسیرها', async t => {
  const s = await boot(); t.after(() => s.close());
  const d = client(s.base); await loginDirector(d);
  assert.equal((await d.get('/admin/api/admin/users')).status, 401, 'مدیر شهرستان به داشبورد دسترسی ندارد');
  const a = client(s.base); await loginAdmin(a);
  assert.equal((await a.get('/api/me')).status, 401, 'نشست مدیر کل جای مدیر شهرستان نمی‌نشیند');
  // درخواست از دامنهٔ دیگر
  const x = await d.put('/api/form', { data: {} }, { origin: 'https://evil.example' });
  assert.equal(x.status, 403);
  // نوع دادهٔ غیر JSON
  const y = await d.post('/api/form/submit', 'a=1', { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(y.status, 415);
  // پیمایش مسیر
  const r = await fetch(s.base + '/fonts/..%2f..%2fserver%2fconfig.js');
  assert.notEqual(r.status, 200);
  const h = await fetch(s.base + '/');
  assert.match(h.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(h.headers.get('x-frame-options'), 'DENY');
});

test('فایل‌های ایستا و مسیرهای داشبورد', async t => {
  const s = await boot(); t.after(() => s.close());
  const get = async p => { const r = await fetch(s.base + p, { redirect: 'manual' }); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };
  assert.match((await get('/')).text, /نقشهٔ هزار مشعل/);
  assert.match((await get('/admin/')).text, /داشبورد مدیر کل/);
  assert.equal((await get('/admin')).status, 301);
  assert.match((await get('/admin/view')).text, /startAdminView/);
  assert.equal((await get('/fonts/RavaghFaNum-Bold.woff')).type, 'font/woff');
  assert.equal((await get('/admin/fonts/RavaghFaNum-Bold.woff')).status, 200);
  assert.equal((await get('/motifs/ferferi-3-sky.png')).type, 'image/png');
  assert.equal((await get('/admin/favicon.svg')).status, 200);
  assert.equal((await get('/healthz')).status, 200);
  assert.equal((await get('/nope')).status, 404);
  // سایت نهایی: هیچ اثری از حالت پیش‌نمایش و بازخورد نمونه نیست
  const html = (await get('/')).text;
  assert.ok(!/SAMPLE_FB|data-demo|بازخورد نمونه|پیش‌نمایش ·/.test(html));
});

test('داشبورد: ساختن مدیر، ورود گروهی، ویرایش، رمز تازه، غیرفعال‌سازی', async t => {
  const s = await boot(); t.after(() => s.close());
  const a = client(s.base);
  assert.equal((await a.post('/admin/api/admin/login', { username: 'admin', password: 'x' })).status, 401);
  assert.equal((await loginAdmin(a)).status, 200);
  const me = (await a.get('/admin/api/admin/me')).json;
  assert.equal(me.aiEnabled, false);

  const cr = await a.post('/admin/api/admin/users', { name: 'زهرا', phone: '+989157654321', county: 'سبزوار' });
  assert.equal(cr.status, 200);
  assert.equal(cr.json.user.phone, '09157654321');
  assert.match(cr.json.password, /^\d{8}$/);
  assert.equal((await a.post('/admin/api/admin/users', { name: 'تکراری', phone: '09157654321', county: 'x' })).status, 409);
  assert.equal((await a.post('/admin/api/admin/users', { name: 'بد', phone: '123', county: 'x' })).status, 400);

  const im = await a.post('/admin/api/admin/users/import', { rows: [
    { name: 'حسن', phone: '09150001111', county: 'تربت حیدریه' },
    { name: 'بد', phone: '12', county: 'خواف' },
    { name: 'مریم', phone: '۰۹۱۵۰۰۰۲۲۲۲', county: 'کاشمر', province: 'خراسان رضوی', title: 'معاون' }
  ] });
  assert.equal(im.json.created.length, 2);
  assert.equal(im.json.errors.length, 1);
  assert.equal(im.json.errors[0].row, 2);

  const list = (await a.get('/admin/api/admin/users')).json.users;
  assert.equal(list.length, 4);
  const zahra = list.find(u => u.county === 'سبزوار');
  assert.equal(zahra.metrics.progress, 0);

  // مدیر تازه با رمزش وارد می‌شود
  const z = client(s.base);
  assert.equal((await z.post('/api/login', { phone: '09157654321', password: cr.json.password })).status, 200);

  // ویرایش
  assert.equal((await a.patch('/admin/api/admin/users/' + zahra.id, { county: 'سبزوار ۲', phone: '09150001111' })).status, 409);
  assert.equal((await a.patch('/admin/api/admin/users/' + zahra.id, { county: 'سبزوار ۲' })).status, 200);
  assert.equal(s.store.get().users.find(u => u.id === zahra.id).county, 'سبزوار ۲');

  // رمز تازه: رمز قبلی و نشست‌ها از کار می‌افتد
  const rp = await a.post('/admin/api/admin/users/' + zahra.id + '/reset-password');
  assert.match(rp.json.password, /^\d{8}$/);
  assert.equal((await z.get('/api/me')).status, 401);
  assert.equal((await client(s.base).post('/api/login', { phone: '09157654321', password: cr.json.password })).status, 401);
  assert.equal((await z.post('/api/login', { phone: '09157654321', password: rp.json.password })).status, 200);

  // غیرفعال‌سازی
  await a.patch('/admin/api/admin/users/' + zahra.id, { active: false });
  assert.equal((await z.get('/api/me')).status, 401);
  const blocked = await client(s.base).post('/api/login', { phone: '09157654321', password: rp.json.password });
  assert.equal(blocked.status, 403);

  assert.equal((await a.get('/admin/api/admin/users/u_nope/form')).status, 404);
  assert.ok((await a.get('/admin/api/admin/audit')).json.audit.length > 3);
});

test('چرخهٔ تحلیل: بسته، واردکردن خروجی Claude، انتشار، دیدن مدیر', async t => {
  const s = await boot(); t.after(() => s.close());
  const d = client(s.base); await loginDirector(d);
  await d.put('/api/form', { data: sampleData() });
  await d.post('/api/form/submit');
  const a = client(s.base); await loginAdmin(a);

  const users = (await a.get('/admin/api/admin/users')).json.users;
  assert.equal(users[0].metrics.gap.aT, 1285);
  assert.equal(users[0].metrics.totals.invited, 300);

  const ex = await a.get('/admin/api/admin/export?submitted=1');
  assert.equal(ex.status, 200);
  assert.match(ex.headers.get('content-disposition'), /harfeno-analysis/);
  assert.equal(ex.json.counties.length, 1);
  assert.equal(ex.json.counties[0].userId, 'u_test');
  assert.equal(ex.json.counties[0].data.pop, '۲۳۰٬۰۰۰');

  const text = 'خروجی:\n```json\n' + JSON.stringify([{ userId: 'u_test', scores: { b1: 7, b2: 6, b3: 8 }, summary: 'خوب', strengths: ['الف'], gaps: ['ب'], suggestions: ['ج'] }, { county: 'ناموجود' }]) + '\n```';
  const im = await a.post('/admin/api/admin/feedback/import', { text });
  assert.equal(im.json.matched.length, 1);
  assert.equal(im.json.unmatched.length, 1);

  assert.equal((await d.get('/api/me')).json.feedback, null, 'پیش‌نویس به مدیر نمی‌رسد');
  const form = (await a.get('/admin/api/admin/users/u_test/form')).json;
  assert.equal(form.feedbackDraft.summary, 'خوب');
  assert.equal(form.readonly, true);

  await a.put('/admin/api/admin/users/u_test/feedback', { draft: { ...form.feedbackDraft, message: 'موفق باشید' } });
  assert.equal((await a.post('/admin/api/admin/users/u_test/feedback/publish')).status, 200);
  const me = (await d.get('/api/me')).json;
  assert.equal(me.feedback.message, 'موفق باشید');
  assert.deepEqual(me.feedback.scores, { b1: 7, b2: 6, b3: 8 });

  await a.post('/admin/api/admin/users/u_test/feedback/unpublish');
  assert.equal((await d.get('/api/me')).json.feedback, null);
  assert.equal((await a.post('/admin/api/admin/users/u_test/analyze')).status, 400, 'بدون کلید، تحلیل خودکار خاموش است');
});

test('تحلیل خودکار با Claude (سرویس شبیه‌سازی‌شده)', async t => {
  let seen = null;
  const mock = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      seen = { headers: req.headers, body: JSON.parse(b), url: req.url };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: '```json\n[{"scores":{"b1":8,"b2":7,"b3":6},"summary":"تحلیل خودکار","strengths":["x"],"gaps":["y"],"suggestions":["z"]}]\n```' }] }));
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r));
  const s = await boot({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}`, ANTHROPIC_MODEL: 'test-model' });
  t.after(async () => { await s.close(); mock.close(); });
  const a = client(s.base); await loginAdmin(a);
  assert.equal((await a.get('/admin/api/admin/me')).json.aiEnabled, true);
  const r = await a.post('/admin/api/admin/users/u_test/analyze');
  assert.equal(r.status, 200);
  assert.equal(r.json.draft.summary, 'تحلیل خودکار');
  assert.equal(seen.url, '/v1/messages');
  assert.equal(seen.headers['x-api-key'], 'test-key');
  assert.equal(seen.body.model, 'test-model');
  assert.equal(s.store.get().feedback.u_test.source, 'ai');
});

test('دو دامنهٔ جدا', async t => {
  const s = await boot({ PUBLIC_HOST: 'bom.test', ADMIN_HOST: 'panel.test' }); t.after(() => s.close());
  const r1 = await new Promise(res => http.get({ host: '127.0.0.1', port: s.port, path: '/', headers: { host: 'panel.test' } }, res));
  assert.equal(r1.statusCode, 302); assert.equal(r1.headers.location, '/admin/');
  const r2 = await new Promise(res => http.get({ host: '127.0.0.1', port: s.port, path: '/admin/', headers: { host: 'bom.test' } }, res));
  assert.equal(r2.statusCode, 404);
  const r3 = await new Promise(res => http.get({ host: '127.0.0.1', port: s.port, path: '/', headers: { host: 'bom.test' } }, res));
  assert.equal(r3.statusCode, 200);
});

test('ابزار خط فرمان و هم‌گامی با سرور در حال اجرا', async t => {
  const s = await boot(); t.after(() => s.close());
  const cli = (...args) => execFileSync(process.execPath, [path.join(__dirname, '..', 'server', 'cli.js'), ...args], { env: { ...process.env, DATA_DIR: s.dir }, encoding: 'utf8' });
  const out = cli('add-director', '--phone', '09159998877', '--name', 'رضا', '--county', 'خواف');
  const pw = out.match(/رمز: (\d+)/)[1];
  // سرور در حال اجرا تغییر فایل را می‌بیند
  const c = client(s.base);
  assert.equal((await c.post('/api/login', { phone: '09159998877', password: pw })).status, 200);
  const csv = path.join(s.dir, 'list.csv');
  fs.writeFileSync(csv, 'نام,موبایل,شهرستان\nالف,09151110001,گناباد\nب,بد,بجستان\n');
  const o2 = cli('import-directors', csv);
  assert.match(o2, /گناباد/);
  assert.ok(fs.existsSync(path.join(s.dir, 'list-passwords.csv')));
  const ad = cli('create-admin', 'second', '--password', 'second-pass-123');
  assert.match(ad, /second/);
  const a = client(s.base);
  assert.equal((await a.post('/api/admin/login', { username: 'second', password: 'second-pass-123' })).status, 200);
  // ادامهٔ کار سرور تغییرات CLI را پاک نمی‌کند
  await c.put('/api/form', { data: { pop: '1' } });
  assert.ok(s.store.get().users.some(u => u.phone === '09151110001'));
});

test('پشتیبان و بازیابی از فایل خراب', async t => {
  const s = await boot(); t.after(() => s.close());
  const { Store } = require('../server/store');
  const backups = fs.readdirSync(path.join(s.dir, 'backups'));
  assert.ok(backups.length >= 1, 'پشتیبان ساعتی ساخته شد');
  fs.writeFileSync(path.join(s.dir, 'db.json'), '{خراب');
  const st = new Store(s.dir);
  assert.ok(st.get().users.length >= 1, 'از پشتیبان بازیابی شد');
  assert.ok(fs.readdirSync(s.dir).some(f => f.startsWith('db.json.corrupt-')));
});
