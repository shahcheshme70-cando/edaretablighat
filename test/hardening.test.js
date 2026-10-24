'use strict';
/* آزمون‌های مقاوم‌سازی: ورودی خراب، مسیر نامعتبر، دور زدن محدودیت ورود */
const test = require('node:test');
const assert = require('node:assert');
const { boot, client } = require('./helpers');

test('مسیر و بدنهٔ نامعتبر ۴۰۰ می‌گیرد، نه ۵۰۰', async () => {
  const s = await boot();
  try {
    const c = client(s.base);
    assert.strictEqual((await c.get('/%E0%A4%A')).status, 400);
    assert.strictEqual((await c.post('/api/login', 'null')).status, 400);
    assert.strictEqual((await c.post('/api/login', '[1,2]')).status, 400);
    assert.strictEqual((await c.post('/api/login', '{bad json')).status, 400);
    const ok = await c.post('/api/login', { phone: '09151112233', password: '12345678' });
    assert.strictEqual(ok.status, 200);
    const me = await c.get('/api/me');
    const bad = await c.put('/api/form', { data: { forces: 'not-array' }, rev: me.json.rev });
    assert.strictEqual(bad.status, 400);
    const bad2 = await c.put('/api/form', { data: { plans: [1], summary: 'x' }, rev: me.json.rev });
    assert.strictEqual(bad2.status, 400);
    // بوم هنوز سالم است
    assert.strictEqual((await c.get('/api/me')).status, 200);
  } finally { await s.close(); }
});

test('بی TRUST_PROXY، عوض کردن X-Forwarded-For محدودیت ورود را دور نمی‌زند', async () => {
  const s = await boot({ TRUST_PROXY: false });
  try {
    const c = client(s.base);
    let last;
    for (let i = 0; i < 8; i++) {
      last = await c.post('/api/login', { phone: '0915000000' + i, password: 'wrong' }, { 'x-forwarded-for': '10.0.0.' + i });
    }
    assert.strictEqual(last.status, 429);
  } finally { await s.close(); }
});

test('مسیر /admin/view/ به /admin/view با همان پرس‌وجو می‌رود', async () => {
  const s = await boot();
  try {
    const r = await client(s.base).get('/admin/view/?u=u_test');
    assert.strictEqual(r.status, 301);
    assert.match(r.headers.get('location'), /^\/admin\/view\?u=u_test$/);
  } finally { await s.close(); }
});
