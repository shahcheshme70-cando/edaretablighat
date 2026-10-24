'use strict';
/* ابزار آزمون: سرور واقعی روی پورت تصادفی با پوشهٔ دادهٔ موقت */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('../server/index');
const A = require('../server/auth');

async function boot(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harfeno-test-'));
  const env = { PORT: 0, HOST: '127.0.0.1', DATA_DIR: dir, LOGIN_MAX_ATTEMPTS: 5, ...overrides };
  const s = await start(env);
  const base = `http://127.0.0.1:${s.port}`;
  // یک حساب ستاد و یک مدیر شهرستان
  s.store.update(db => {
    db.users.push({ id: 'a_test', role: 'admin', username: 'admin', name: 'ستاد', passHash: A.hashPassword('admin-secret-1'), active: true });
    db.users.push({ id: 'u_test', role: 'director', phone: '09151112233', name: 'علی آزمون', county: 'نیشابور', province: 'خراسان رضوی', title: 'مدیر تبلیغات اسلامی شهرستان', passHash: A.hashPassword('12345678'), active: true, mustChange: true });
  });
  return {
    ...s, base, dir,
    async close() { await new Promise(r => s.server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

/* کلاینت کوچک با نگهداری کوکی */
function client(base) {
  let cookies = {};
  async function call(method, p, body, headers = {}) {
    const h = { ...headers };
    const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (c) h.cookie = c;
    if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
    const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)), redirect: 'manual' });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    sc.forEach(line => { const [kv] = line.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) cookies[k] = v; else delete cookies[k]; });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* متن */ }
    return { status: r.status, json, text, headers: r.headers };
  }
  return {
    get: (p, h) => call('GET', p, undefined, h), post: (p, b, h) => call('POST', p, b, h), put: (p, b, h) => call('PUT', p, b, h), patch: (p, b, h) => call('PATCH', p, b, h),
    cookies: () => cookies, setCookies: c => { cookies = { ...c }; }
  };
}

/* نمونه‌دادهٔ یک بوم کامل (همان شهرستان آزمایشی «تربت» که در آزمون مرورگر سنجیده شد) */
function sampleData() {
  return {
    meta: {},
    pop: '۲۳۰٬۰۰۰',
    forces: [
      { id: 'f1', name: 'مساجد', kind: 'g', st: 'ضعیف', n: '210', aa: '3', mm: '150' },
      { id: 'f2', name: 'هیئات مذهبی', kind: 'g', st: 'متوسط', n: '300', aa: '4', mm: '120' },
      { id: 'f3', name: 'معلمان پرورشی', kind: 'p', st: 'بلااستفاده', n: '90', mm: '60' },
      { id: 'f4', name: 'پایگاه‌های بسیج', kind: 'g', st: 'بلااستفاده', n: '150', aa: '5', mm: '40' },
      { id: 'f5', name: 'روحانیون مستقر', kind: 'p', st: 'متوسط', n: '60', mm: '200' },
      { id: 'f6', name: 'فعالان فضای مجازی', kind: 'p', st: 'قوی', n: '25', mm: '1500' }
    ],
    pairs: [{ a: 'پایگاه‌های بسیج', b: 'مساجد', lv: 'کم' }],
    cohesion: 'همکاری موردی',
    ta: '3', tm: '50',
    uncovered: ['کارگران', 'روستاییان'],
    summary: { strong: 'الف', weak: 'ب', gaps: 'ج' },
    plans: [{
      id: 'p1', type: 'فعال‌سازی ظرفیت', force: 'پایگاه‌های بسیج', from: 'بی‌کار', to: 'هستهٔ تبیین مسئلهٔ روز', title: 'طرح بسیج',
      baseA: '0', baseM: '6000', afterA: '300', afterM: '9000',
      costs: { train: '60', content: '20' }, fund: 'کمک اداره‌کل یا ستاد',
      test: { stays: 'بله', role: 'بله', grows: 'بله' }, keep: 'نگه می‌دارم',
      run: { lead: 'مدیر', s1: 'قدم ۱', s3: 'قدم ۳', risk: 'مانع' }, sup: {}
    }]
  };
}

module.exports = { boot, client, sampleData };
