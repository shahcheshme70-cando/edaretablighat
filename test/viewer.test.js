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

test('خروجی اکسل: سه جدول با دادهٔ درست، برای ستاد و مدیرکل', async () => {
  const { s, admin, pw } = await setup();
  try {
    const c = await admin.get('/api/admin/sheet/counties');
    assert.strictEqual(c.status, 200);
    assert.match(c.headers.get('content-type'), /text\/csv/);
    assert.strictEqual(require('../server/sheets').toCsv(['a'], []).charCodeAt(0), 0xFEFF);
    const lines = c.text.trim().split('\r\n');
    assert.strictEqual(lines.length, 2);
    assert.ok(lines[1].includes('نیشابور') && lines[1].includes('09151112233'));
    const f = await admin.get('/api/admin/sheet/forces');
    assert.strictEqual(f.text.trim().split('\r\n').length, 7);
    assert.ok(f.text.includes('پایگاه‌های بسیج'));
    const p = await admin.get('/api/admin/sheet/plans');
    assert.ok(p.text.includes('فعال‌سازی ظرفیت') && p.text.includes('طرح بسیج'));
    assert.strictEqual((await admin.get('/api/admin/sheet/nope')).status, 404);
    const v = client(s.base);
    await v.post('/api/admin/login', { username: '09159998877', password: pw });
    assert.strictEqual((await v.get('/api/admin/sheet/plans')).status, 200);
  } finally { await s.close(); }
});

test('متنی که با = شروع شود در اکسل فرمول نمی‌شود', () => {
  const { cell } = require('../server/sheets');
  assert.strictEqual(cell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.strictEqual(cell(-5), '-5');
  assert.strictEqual(cell('سلام, دنیا'), '"سلام, دنیا"');
});

test('چند استان: نام استان یکسان می‌شود، مدیرکل هر استان فقط استان خودش را می‌بیند، اکسل و بسته به تفکیک استان', async () => {
  const s = await boot();
  try {
    const admin = client(s.base);
    await admin.post('/api/admin/login', { username: 'admin', password: 'admin-secret-1' });
    // دو شهرستان در استان‌های دیگر، با نوشتار ناهمسان
    const a = await admin.post('/api/admin/users', { name: 'مدیر اصفهان', phone: '09130000001', county: 'کاشان', province: 'استان  اصفهان' });
    const b = await admin.post('/api/admin/users', { name: 'مدیر خراسان', phone: '09150000009', county: 'سبزوار', province: 'خراسان‌رضوي' });
    assert.strictEqual(a.json.user.province, 'اصفهان');
    assert.strictEqual(b.json.user.province, 'خراسان رضوی');
    const all = (await admin.get('/api/admin/users')).json.users;
    assert.deepStrictEqual([...new Set(all.map(u => u.province))].sort(), ['اصفهان', 'خراسان رضوی']);
    // مدیرکل اصفهان
    const v = await admin.post('/api/admin/viewers', { name: 'مدیرکل اصفهان', phone: '09130000099', province: 'اصفهان' });
    const vc = client(s.base);
    await vc.post('/api/admin/login', { username: '09130000099', password: v.json.password });
    const seen = (await vc.get('/api/admin/users')).json.users;
    assert.deepStrictEqual(seen.map(u => u.county), ['کاشان']);
    assert.strictEqual((await vc.get('/api/admin/users/u_test/form')).status, 404);
    // اکسل و بستهٔ تحلیل به تفکیک استان
    const sh = await admin.get('/api/admin/sheet/counties?province=' + encodeURIComponent('اصفهان'));
    const lines = sh.text.trim().split('\r\n');
    assert.strictEqual(lines.length, 2);
    assert.ok(lines[1].includes('کاشان'));
    const ex = await admin.get('/api/admin/export?province=' + encodeURIComponent('خراسان رضوی'));
    assert.deepStrictEqual(ex.json.counties.map(c => c.county).sort(), ['سبزوار', 'نیشابور'].sort());
  } finally { await s.close(); }
});
