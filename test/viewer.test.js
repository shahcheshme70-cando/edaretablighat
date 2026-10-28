'use strict';
/* حساب مدیرکل: فقط دیدن بوم‌ها؛ هیچ تغییری روی سرور ممکن نیست */
const test = require('node:test');
const assert = require('node:assert');
const { boot, client, sampleData } = require('./helpers');

async function setup() {
  const s = await boot();
  const admin = client(s.base);
  assert.strictEqual((await admin.post('/api/admin/login', { username: 'admin', password: 'admin-secret-1' })).status, 200);
  // مدیر شهرستان بوم را پر می‌کند و ستاد برایش بازخورد پیش‌نویس می‌نویسد
  const dir = client(s.base);
  await dir.post('/api/login', { phone: '09151112233', password: '12345678' });
  const me = await dir.get('/api/me');
  await dir.put('/api/form', { data: sampleData(), rev: me.json.rev });
  await admin.put('/api/admin/users/u_test/feedback', { draft: { summary: 'پیش‌نویس محرمانه', scores: {} } });
  const cr = await admin.post('/api/admin/viewers', { name: 'حاج آقای آزمون', phone: '۰۹۱۵۹۹۹۸۸۷۷' });
  assert.strictEqual(cr.status, 200);
  assert.match(cr.json.password, /^\d{8}$/);
  return { s, admin, pw: cr.json.password, vid: cr.json.user.id };
}

test('ستاد حساب مدیرکل می‌سازد و مدیرکل با شمارهٔ همراه وارد می‌شود', async () => {
  const { s, admin, pw } = await setup();
  try {
    const list = await admin.get('/api/admin/viewers');
    assert.strictEqual(list.json.viewers.length, 1);
    assert.strictEqual(list.json.viewers[0].phone, '09159998877');
    const v = client(s.base);
    // شماره با رقم فارسی و بی‌صفر هم پذیرفته می‌شود
    assert.strictEqual((await v.post('/api/admin/login', { username: '۹۱۵۹۹۹۸۸۷۷', password: pw })).status, 200);
    const me = await v.get('/api/admin/me');
    assert.strictEqual(me.json.access, 'view');
    assert.strictEqual(me.json.user.mustChange, true);
    assert.strictEqual(me.json.aiEnabled, false);
    // تکرار شماره پذیرفته نمی‌شود
    assert.strictEqual((await admin.post('/api/admin/viewers', { name: 'دیگری', phone: '09159998877' })).status, 409);
  } finally { await s.close(); }
});

test('مدیرکل بوم‌ها و بازخورد منتشرشده را می‌بیند، پیش‌نویس را نه', async () => {
  const { s, admin, pw } = await setup();
  try {
    const v = client(s.base);
    await v.post('/api/admin/login', { username: '09159998877', password: pw });
    const users = await v.get('/api/admin/users');
    assert.strictEqual(users.status, 200);
    assert.strictEqual(users.json.users.length, 1);
    assert.strictEqual(users.json.users[0].feedback.draft, false);
    assert.ok(users.json.users[0].metrics.gap.aT > 0);
    const form = await v.get('/api/admin/users/u_test/form');
    assert.strictEqual(form.status, 200);
    assert.strictEqual(form.json.feedbackDraft, null);
    assert.ok(form.json.data.forces.length > 0);
    assert.ok(!form.text.includes('پیش‌نویس محرمانه'));
    // پس از انتشار، بازخورد را می‌بیند
    await admin.post('/api/admin/users/u_test/feedback/publish');
    const f2 = await v.get('/api/admin/users/u_test/form');
    assert.strictEqual(f2.json.feedback.summary, 'پیش‌نویس محرمانه');
  } finally { await s.close(); }
});

test('مدیرکل هیچ تغییری نمی‌تواند بدهد', async () => {
  const { s, vid, pw } = await setup();
  try {
    const v = client(s.base);
    await v.post('/api/admin/login', { username: '09159998877', password: pw });
    const denied = [
      ['post', '/api/admin/users', { name: 'x', phone: '09150000001', county: 'y' }],
      ['post', '/api/admin/users/import', { rows: [] }],
      ['patch', '/api/admin/users/u_test', { active: false }],
      ['post', '/api/admin/users/u_test/reset-password'],
      ['put', '/api/admin/users/u_test/feedback', { draft: { summary: 'x' } }],
      ['post', '/api/admin/users/u_test/feedback/publish'],
      ['post', '/api/admin/users/u_test/feedback/unpublish'],
      ['post', '/api/admin/users/u_test/analyze'],
      ['get', '/api/admin/export'],
      ['post', '/api/admin/feedback/import', { text: '[]' }],
      ['get', '/api/admin/audit'],
      ['get', '/api/admin/viewers'],
      ['post', '/api/admin/viewers', { name: 'x', phone: '09150000002' }],
      ['post', '/api/admin/viewers/' + vid + '/reset-password'],
      ['patch', '/api/admin/viewers/' + vid, { active: true }]
    ];
    for (const [m, p, b] of denied) {
      const r = await v[m](p, b);
      assert.strictEqual(r.status, 403, `${m} ${p} باید رد شود، ولی ${r.status} شد`);
    }
    // مدیرکل می‌تواند رمز خودش را عوض کند
    assert.strictEqual((await v.post('/api/admin/password', { current: pw, next: '1234567' })).status, 400);
    assert.strictEqual((await v.post('/api/admin/password', { current: pw, next: '87654321' })).status, 200);
  } finally { await s.close(); }
});

test('غیرفعال کردن مدیرکل نشستش را می‌بندد و مدیرکل استان دیگر شهرستان‌ها را نمی‌بیند', async () => {
  const { s, admin, vid, pw } = await setup();
  try {
    const v = client(s.base);
    await v.post('/api/admin/login', { username: '09159998877', password: pw });
    assert.strictEqual((await admin.patch('/api/admin/viewers/' + vid, { active: false })).status, 200);
    assert.strictEqual((await v.get('/api/admin/users')).status, 401);
    assert.strictEqual((await v.post('/api/admin/login', { username: '09159998877', password: pw })).status, 403);
    // استان دیگر
    const cr = await admin.post('/api/admin/viewers', { name: 'استان دیگر', phone: '09151110000', province: 'خراسان شمالی' });
    const v2 = client(s.base);
    await v2.post('/api/admin/login', { username: '09151110000', password: cr.json.password });
    assert.strictEqual((await v2.get('/api/admin/users')).json.users.length, 0);
    assert.strictEqual((await v2.get('/api/admin/users/u_test/form')).status, 404);
  } finally { await s.close(); }
});
