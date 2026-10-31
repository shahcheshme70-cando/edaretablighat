'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const AN = require('../server/analysis');
const { emptyDb } = require('../server/store');

test('بیرون کشیدن JSON از پاسخ Claude با متن اضافه یا ```', () => {
  assert.deepEqual(AN.extractJson('[{"a":1}]'), [{ a: 1 }]);
  assert.deepEqual(AN.extractJson('این هم خروجی:\n```json\n[{"a":2}]\n```\nموفق باشید'), [{ a: 2 }]);
  assert.deepEqual(AN.extractJson('خروجی: [{"a":3}] پایان'), [{ a: 3 }]);
  assert.throws(() => AN.extractJson('هیچ JSON'), /JSON معتبر/);
  // خروجی دو بسته که پشت سر هم جای‌گذاری شده، با ویرگول اضافه
  assert.deepEqual(AN.extractJson('بستهٔ ۱:\n```json\n[{"a":1},]\n```\nبستهٔ ۲:\n```json\n[{"a":2}]\n```'), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(AN.extractJson('اول [{"a":1,"t":"[x]"}] و بعد [{"a":2}]'), [{ a: 1, t: '[x]' }, { a: 2 }]);
  assert.deepEqual(AN.extractJson('\uFEFF[{"a":5}]'), [{ a: 5 }]);
});

test('پاک‌سازی بازخورد: امتیاز در بازه، فهرست از متن چندخطی', () => {
  const f = AN.cleanFeedback({ scores: { b1: '۷', b2: 14, b3: -2 }, summary: '  جمع  ', strengths: 'یک\nدو\n\n', gaps: ['', 'x'], suggestions: null });
  assert.deepEqual(f.scores, { b1: 7, b2: 10, b3: 0 });
  assert.equal(f.summary, 'جمع');
  assert.deepEqual(f.strengths, ['یک', 'دو']);
  assert.deepEqual(f.gaps, ['x']);
  assert.deepEqual(f.suggestions, []);
});

test('تطبیق بازخورد با مدیر: شناسه، شماره، یا شهرستان یکتا', () => {
  const db = emptyDb();
  db.users.push({ id: 'u1', role: 'director', phone: '09150000001', county: 'نیشابور' });
  db.users.push({ id: 'u2', role: 'director', phone: '09150000002', county: 'سبزوار' });
  db.users.push({ id: 'u3', role: 'director', phone: '09150000003', county: 'سبزوار' });
  const r = AN.matchItems(db, [{ userId: 'u1' }, { phone: '۰۹۱۵۰۰۰۰۰۰۲' }, { county: 'نیشابور' }, { county: 'سبزوار' }, { county: 'خواف' }, 'بد']);
  // u1 دو بار آمده؛ آخری می‌ماند
  assert.deepEqual(r.matched.map(m => m.userId), ['u2', 'u1']);
  assert.equal(r.unmatched.length, 3); // سبزوار دو مدیر دارد، خواف نیست، «بد» نامعتبر
});

test('امتیاز به هر شکلی که هوش مصنوعی بنویسد', () => {
  assert.deepEqual(AN.cleanFeedback({ scores: { b1: '7/10', b2: '۸ از ۱۰', b3: '۶٫۵' } }).scores, { b1: 7, b2: 8, b3: 6.5 });
  assert.deepEqual(AN.cleanFeedback({ b1: 5, b2: '9', b3: null }).scores, { b1: 5, b2: 9, b3: null });
});

test('تطبیق با نام شهرستان: نیم‌فاصله و ی عربی، و استان برای نام‌های تکراری', () => {
  const db = emptyDb();
  db.users.push({ id: 'u1', role: 'director', phone: '09150000001', county: 'تربت حیدریه', province: 'خراسان رضوی' });
  db.users.push({ id: 'u2', role: 'director', phone: '09130000002', county: 'فریدن', province: 'اصفهان' });
  db.users.push({ id: 'u3', role: 'director', phone: '09170000003', county: 'فریدن', province: 'فارس' });
  const r = AN.matchItems(db, [{ county: 'تربت‌حيدريه' }, { county: 'فریدن', province: 'استان فارس' }, { county: 'فریدن' }]);
  assert.deepEqual(r.matched.map(m => m.userId), ['u1', 'u3']);
  assert.match(r.unmatched[0].reason, /userId/);
});

test('بستهٔ تحلیل دستورالعمل و عددهای محاسبه‌شده دارد', () => {
  const db = emptyDb();
  db.users.push({ id: 'u1', role: 'director', phone: '09150000001', county: 'نیشابور', name: 'x' });
  db.users.push({ id: 'a1', role: 'admin', username: 'admin' });
  db.forms.u1 = { data: { pop: '100000' }, submittedAt: '2026-01-01T00:00:00Z' };
  const b = AN.buildBundle(db);
  assert.equal(b.kind, 'harfeno-analysis-bundle');
  assert.equal(b.counties.length, 1);
  assert.equal(b.counties[0].metrics.gap.needA, 10000);
  assert.match(b.instructions, /JSON/);
  assert.match(b.instructions, /نسازید/);
  assert.equal(b.countiesCount, 1);
  assert.match(b.instructions, /دقیقاً 1 شیء/);
  assert.ok(b.prompt.includes('instructions'));
});
