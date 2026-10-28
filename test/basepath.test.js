'use strict';
/* سامانه زیر یک مسیر از دامنهٔ دیگر (مثلاً harf-no.ir/mashal) */
const test = require('node:test');
const assert = require('node:assert');
const { boot, client } = require('./helpers');

for (const base of ['/mashal', '/مشعل']) {
  test(`زیر مسیر ${base}: صفحه‌ها، API، کوکی و تغییر مسیرها`, async () => {
    const s = await boot({ BASE_PATH: base });
    try {
      const B = encodeURI(base), c = client(s.base);
      // صفحهٔ اصلی و پرونده‌های مشترک
      const home = await c.get(B + '/');
      assert.strictEqual(home.status, 200);
      assert.match(home.text, /نقشهٔ هزار مشعل/);
      assert.strictEqual((await c.get(B + '/shared/login-720.webp')).status, 200);
      // بدون اسلش پایانی به نسخهٔ با اسلش می‌رود
      const r = await c.get(B);
      assert.strictEqual(r.status, 301);
      assert.strictEqual(r.headers.get('location'), B + '/');
      const ad = await c.get(B + '/admin');
      assert.strictEqual(ad.headers.get('location'), B + '/admin/');
      // ورود مدیر و کوکی محدود به همین مسیر
      const lg = await c.post(B + '/api/login', { phone: '09151112233', password: '12345678' });
      assert.strictEqual(lg.status, 200);
      assert.ok(lg.headers.getSetCookie().some(x => x.includes('Path=' + B + ';')));
      assert.strictEqual((await c.get(B + '/api/me')).status, 200);
      // داشبورد با نشانی نسبی
      const a = client(s.base);
      assert.strictEqual((await a.post(B + '/admin/api/admin/login', { username: 'admin', password: 'admin-secret-1' })).status, 200);
      assert.strictEqual((await a.get(B + '/admin/api/admin/users')).status, 200);
      assert.strictEqual((await a.get(B + '/admin/view?u=u_test')).status, 200);
      // اگر پروکسی پیشوند را بردارد هم کار می‌کند
      assert.strictEqual((await c.get('/api/me')).status, 200);
      // HSTS برای کل دامنهٔ مشترک گذاشته نمی‌شود
      assert.strictEqual(home.headers.get('strict-transport-security'), null);
    } finally { await s.close(); }
  });
}
