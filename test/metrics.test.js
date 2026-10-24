'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../public/shared/metrics.js');
const { sampleData } = require('./helpers');

test('خواندن عددهای فارسی، جداکننده‌ها و «هزار/میلیون»', () => {
  assert.equal(M.num('۲۳۰٬۰۰۰'), 230000);
  assert.equal(M.num('۳٫۴ میلیون'), 3400000);
  assert.equal(M.num('۲۵ هزار'), 25000);
  assert.equal(M.num('1,200'), 1200);
  assert.equal(M.num('-5'), 0);
  assert.equal(M.num('متن'), 0);
});

/* این عددها همان است که سایت مدیر در مرورگر برای همین داده نشان داد (آزمون شهرستان آزمایشی تربت) */
test('شکاف با محاسبهٔ سایت مدیر یکی است', () => {
  const g = M.gap(sampleData());
  assert.equal(g.pop, 230000);
  assert.equal(g.a, 2755);
  assert.equal(g.aT, 1285);
  assert.equal(g.aI, 1470);
  assert.equal(g.aNew, 20245);
  assert.equal(g.m, 128400);
  assert.equal(g.gapA, 21715);
  assert.equal(g.gapM, 101600);
  assert.equal(g.tgtA, 6900);
});

test('سهم طرح، دعوت و هزینهٔ هر نفر', () => {
  const d = sampleData(), s = M.summarize(d), p = s.plans[0];
  assert.equal(p.dA, 300);
  assert.equal(p.invited, 300);       // پایگاه‌های بسیج ۷۵۰ کنشگر فرهنگی دارد؛ هر ۳۰۰ نفر دعوت حساب می‌شوند
  assert.equal(p.fresh, 0);
  assert.equal(p.cost, 80);
  assert.ok(Math.abs(p.costPerActor - 80 / 300) < 1e-9);
  assert.equal(p.verdict, 'تحول');
  assert.ok(Math.abs(p.ofTgtA - 300 / (6900 - 1285) * 100) < 1e-9);
  assert.equal(s.progress, 100);
  assert.deepEqual(s.missing, []);
});

test('شمار واقعی کنشگران فعال (پرسش اختیاری) شکاف را درست جابه‌جا می‌کند', () => {
  const d = sampleData();
  d.forces[1].act = '100';             // هیئات: ۱۲۰۰ کنشگر، فقط ۱۰۰ نفر در تبیین
  const g = M.gap(d);
  assert.equal(g.aT, 1285 - 1100);
  assert.equal(g.aI, 1470 + 1100);
});

test('هزینهٔ کل به‌جای ریز هزینه', () => {
  assert.equal(M.planCost({ costMode: 'کل', cost: '۱۵' }), 15);
  assert.equal(M.planCost({ costs: { train: '10', gift: '۵' } }), 15);
});

test('آزمون تحول: یک «هنوز نه» یعنی برنامه', () => {
  assert.equal(M.verdict({ test: { stays: 'بله', role: 'هنوز نه', grows: 'بله' } }), 'برنامه');
  assert.equal(M.verdict({ test: { stays: 'بله' } }), '');
});

test('بوم خالی خطا نمی‌دهد', () => {
  const s = M.summarize({});
  assert.equal(s.progress, 0);
  assert.equal(s.gap.pop, 0);
  assert.equal(M.summarize(null).plansCount, 0);
});
