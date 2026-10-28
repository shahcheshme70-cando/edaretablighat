/*
 * خروجی اکسل (CSV با BOM که اکسل فارسی را درست باز می‌کند)
 * سه جدول: شهرستان‌ها (یک ردیف برای هر شهرستان)، نیروها (یک ردیف برای هر نیرو)، طرح‌ها (یک ردیف برای هر طرح)
 */
(function () {
'use strict';
// در Node از فایل مشترک محاسبات، در پیش‌نمایش مرورگر از HNMetrics
const M = typeof module === 'object' && module.exports ? require('../public/shared/metrics') : self.HNMetrics;

const SUP = { content: 'محتوا و بسته‌های آموزشی', training: 'دوره‌های توانمندسازی', money: 'اعتبار مالی', share: 'انتقال تجربه‌های موفق', letters: 'مکاتبه و هماهنگی با نهادها', other: 'سایر' };
const round = (x, d = 0) => { const n = Number(x) || 0, p = Math.pow(10, d); return Math.round(n * p) / p; };
const str = v => (v == null ? '' : String(v)).replace(/\r?\n+/g, ' / ').trim();
const date = t => {
  if (!t) return '';
  try { return new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tehran' }).format(new Date(t)).replace(',', ''); } catch (e) { return String(t); }
};
// جلوگیری از اجرای فرمول در اکسل وقتی متن مدیر با = یا + شروع می‌شود
const cell = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = str(v);
  if (/^[=+\-@\t]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (head, rows) => '﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
const status = (u, f) => u.active === false ? 'غیرفعال' : f.submittedAt ? (f.editedAfterSubmit ? 'ارسال‌شده، ویرایش بعد از ارسال' : 'ارسال‌شده') : f.updatedAt ? 'در حال تکمیل' : 'شروع‌نشده';

function counties(db, users) {
  const head = ['استان', 'شهرستان', 'مدیر', 'شمارهٔ همراه', 'وضعیت', 'پیشرفت (٪)', 'آخرین تغییر', 'تاریخ ارسال', 'جمعیت',
    'کنشگر تبیینی امروز', 'کنشگر لازم (۱۰٪ جمعیت)', 'سهم از کنشگر لازم (٪)', 'منتظر دعوت', 'کنشگر تازهٔ لازم', 'مخاطب امروز', 'مخاطب بی‌پوشش',
    'هدف دو ساله: کنشگر (٪ جمعیت)', 'هدف دو ساله: مخاطب (٪ جمعیت)', 'هدف دو ساله: کنشگر (نفر)', 'انسجام نیروها', 'تعداد نیروها', 'تعداد طرح‌ها',
    'کنشگر تازه از طرح‌ها', 'مخاطب تازه از طرح‌ها', 'هزینهٔ طرح‌ها (میلیون تومان)', 'پیش‌بینی کنشگر تازه تا دو سال', 'پیش‌بینی: سهم از هدف دو ساله (٪)',
    'مخاطبان بی‌پوشش', 'نقاط قوت', 'نقاط ضعف', 'خلأهای اصلی', 'بازخورد منتشرشده'];
  const rows = users.map(u => {
    const f = db.forms[u.id] || {}, d = M.sanitize(f.data || {}), m = M.summarize(d), g = m.gap, fb = (db.feedback[u.id] || {}).published;
    return [u.province || '', u.county || '', u.name || '', u.phone || '', status(u, f), m.progress, date(f.updatedAt), date(f.submittedAt), g.pop,
      round(g.aT), round(g.needA), g.needA ? round(g.aT / g.needA * 100, 1) : 0, round(g.aI), round(g.aNew), round(g.m), round(g.gapM),
      g.ta || '', g.tm || '', round(g.tgtA), str(d.cohesion), m.forcesCount, m.plans.filter(p => p.type).length,
      round(m.totals.dA), round(m.totals.dM), round(m.totals.cost, 1), m.projection2y, round(m.projectionPct, 1),
      (d.uncovered || []).join('، '), str(d.summary.strong), str(d.summary.weak), str(d.summary.gaps), fb ? str(fb.summary) : ''];
  });
  return toCsv(head, rows);
}

function forces(db, users) {
  const head = ['استان', 'شهرستان', 'نیرو', 'نوع', 'سطح فعالیت در تبیین', 'تعداد (نفر یا واحد)', 'کنشگر هر واحد', 'مخاطب هر نفر یا واحد', 'کنشگر فرهنگی کل', 'کنشگر تبیینی فعال', 'مخاطب کل'];
  const rows = [];
  users.forEach(u => {
    const d = M.sanitize((db.forms[u.id] || {}).data || {});
    M.forces(d).forEach(f => rows.push([u.province || '', u.county || '', f.name, M.isP(f) ? 'فرد' : 'مجموعه', f.st || '', M.num(f.n), M.isP(f) ? '' : M.num(f.aa), M.num(f.mm), round(M.tA(f)), round(M.tAT(f)), round(M.tM(f))]));
  });
  return toCsv(head, rows);
}

function plans(db, users) {
  const head = ['استان', 'شهرستان', 'شمارهٔ طرح', 'عنوان', 'حرکت', 'نیرو یا قشر', 'وضع امروز', 'وضع پس از تحول', 'فصل شروع',
    'کنشگر امروز', 'کنشگر شش ماه بعد', 'مخاطب امروز', 'مخاطب شش ماه بعد', 'کنشگر تازه', 'از دعوت کنشگران فعلی', 'کنشگر کاملاً تازه', 'سهم از شکاف کنشگر (٪)',
    'هزینه (میلیون تومان)', 'ریز هزینه', 'محل تأمین', 'آزمون تحول', 'تصمیم پس از سنجش', 'راهبر', 'مجریان', 'مرحلهٔ ۱', 'مرحلهٔ ۲', 'مرحلهٔ ۳', 'مانع اصلی', 'چاره', 'کمک لازم', 'توضیح کمک'];
  const rows = [];
  users.forEach(u => {
    const d = M.sanitize((db.forms[u.id] || {}).data || {}), m = M.summarize(d);
    d.plans.forEach((p, i) => {
      if (!p.type && !p.title) return;
      const r = p.run || {}, pr = m.plans[i] || {}, sup = p.sup && typeof p.sup === 'object' ? p.sup : {};
      const items = p.costMode === 'کل' ? 'فقط مبلغ کل' : M.planCostItems(p).filter(([k]) => M.num((p.costs || {})[k]) > 0).map(([k, l]) => `${l}: ${M.num(p.costs[k])}`).join('؛ ');
      rows.push([u.province || '', u.county || '', i + 1, str(p.title), p.type || '', str(p.force), str(p.from), str(p.to), pr.quarter || '',
        M.num(p.baseA), M.num(p.afterA), M.num(p.baseM), M.num(p.afterM), round(pr.dA), round(pr.invited), round(pr.fresh), round(pr.ofGapA, 1),
        round(pr.cost, 1), items, str(p.fund), pr.verdict || '', str(p.keep), str(r.lead), str(r.exec), str(r.s1), str(r.s2), str(r.s3), str(r.risk), str(r.fix),
        Object.keys(SUP).filter(k => sup[k] && sup[k].on).map(k => SUP[k]).join('، '), str(r.ask)]);
    });
  });
  return toCsv(head, rows);
}

const TABLES = { counties: ['shahrestanha', counties], forces: ['niroha', forces], plans: ['tarhha', plans] };

/* users: مدیران شهرستان که بیننده اجازهٔ دیدنشان را دارد */
function sheet(kind, db, users) {
  const t = TABLES[kind]; if (!t) return null;
  const list = [...users].sort((a, b) => String(a.county || '').localeCompare(String(b.county || ''), 'fa'));
  return { name: `harfeno-${t[0]}-${new Date().toISOString().slice(0, 10)}.csv`, body: t[1](db, list) };
}

if (typeof module === 'object' && module.exports) module.exports = { sheet, toCsv, cell };
else self.HNSheets = { sheet, toCsv, cell };
})();
