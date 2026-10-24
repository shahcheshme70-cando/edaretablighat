/*
 * محاسبات مشترک «نقشهٔ هزار مشعل»
 * همان منطقی که سایت مدیر شهرستان در مرورگر به کار می‌برد، برای سرور و داشبورد ستاد.
 * اگر منطق سایت مدیر (public/form/index.html) عوض شد، این فایل هم باید هم‌گام شود؛
 * آزمون test/metrics.test.js این هم‌خوانی را با نمونه‌داده می‌سنجد.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HNMetrics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATS = [
    ['مساجد و هیئات', 'g', ['مساجد', 'هیئات مذهبی', 'حوزه‌های علمیه', 'کانون‌ها و خانه‌های قرآنی']],
    ['کانون‌ها و تشکل‌ها', 'g', ['کانون‌های فرهنگی‌هنری مساجد', 'کانون‌های فرهنگی تبلیغی', 'پایگاه‌های بسیج', 'گروه‌های جهادی', 'موکب‌ها', 'مدارس قرآنی و امین']],
    ['روحانیان، مبلغان و مداحان', 'p', ['روحانیون مستقر', 'امامان جماعت', 'بانوان مبلغ', 'مداحان و ذاکرین']],
    ['معلمان، اساتید و مربیان', 'p', ['معلمان پرورشی', 'معلمان و فرهنگیان', 'اساتید دانشگاه', 'مربیان کانون‌ها']],
    ['فعالان رسانه و چهره‌های محلی', 'p', ['فعالان فضای مجازی', 'هنرمندان', 'ورزشکاران', 'پزشکان', 'کسبهٔ معتمد']]
  ];
  const KIND = Object.fromEntries(CATS.flatMap(c => c[2].map(n => [n, c[1]])));
  const MOVE_WAY = {
    'تغییر نقش': 'inv', 'فعال‌سازی ظرفیت': 'inv', 'ایجاد اتصال': 'inv',
    'فعال‌سازی مخاطب': 'new', 'افزودن نیروی جدید': 'new', 'ورود به عرصهٔ جدید': 'aud'
  };
  const WAY_LABEL = { inv: 'دعوت از کنشگران فعلی', new: 'آوردن کنشگر تازه', aud: 'روشن کردن جاهای تاریک' };
  const COST_KEYS = ['train', 'content', 'host', 'gift', 'other'];
  const QUARTERS = ['زمستان ۱۴۰۵', 'بهار ۱۴۰۶', 'تابستان ۱۴۰۶', 'پاییز ۱۴۰۶', 'زمستان ۱۴۰۶', 'بهار ۱۴۰۷', 'تابستان ۱۴۰۷', 'پاییز ۱۴۰۷'];

  const toEn = s => String(s == null ? '' : s)
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  const num = v => {
    const t = toEn(v), m = /میلیون/.test(t) ? 1e6 : /هزار/.test(t) ? 1e3 : 1;
    const x = parseFloat(t.replace(/[,،٬\s]/g, '').replace('٫', '.').replace(/[^\d.\-]/g, ''));
    return isNaN(x) ? 0 : Math.max(0, x * m);
  };
  const has = v => v != null && String(v).trim() !== '' && !(Array.isArray(v) && !v.length);

  /* دادهٔ ورودی ممکن است ناقص یا خراب باشد؛ قبل از هر محاسبه شکلش درست می‌شود */
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const arr = v => Array.isArray(v) ? v : [];
  const str = v => typeof v === 'string' ? v : (v == null ? '' : String(v));
  function sanitize(d) {
    d = isObj(d) ? d : {};
    return Object.assign({}, d, {
      forces: arr(d.forces).filter(isObj).map(f => Object.assign({}, f, { name: str(f.name) })),
      plans: arr(d.plans).filter(isObj).map(p => Object.assign({}, p, { test: isObj(p.test) ? p.test : {}, run: isObj(p.run) ? p.run : {}, costs: isObj(p.costs) ? p.costs : {}, force: str(p.force), type: str(p.type) })),
      pairs: arr(d.pairs).filter(isObj),
      uncovered: arr(d.uncovered).filter(x => typeof x === 'string'),
      summary: isObj(d.summary) ? d.summary : {}
    });
  }
  const forces = d => (d.forces || []).filter(f => has(f.name));
  const isP = f => (f.kind || KIND[f.name] || 'g') === 'p';
  const tA = f => isP(f) ? num(f.n) : num(f.n) * num(f.aa);
  const tM = f => num(f.n) * num(f.mm);
  const isAct = f => f.st === 'قوی' || f.st === 'متوسط';
  const tAT = f => isAct(f) ? (has(f.act) ? Math.min(num(f.act), tA(f)) : tA(f)) : 0;
  const findForce = (d, n) => forces(d).find(f => f.name.trim() === String(n || '').trim());

  function gap(d) {
    const pop = num(d.pop);
    let a = 0, aT = 0, m = 0;
    forces(d).forEach(f => { a += tA(f); aT += tAT(f); m += tM(f); });
    const mm = num(d.mReal) || m;
    const needA = pop * 0.1, needM = pop;
    const ta = Math.min(num(d.ta), 100), tm = Math.min(num(d.tm), 100);
    return {
      pop, a, aT, aI: a - aT, aNew: Math.max(needA - a, 0), m: mm, needA, needM,
      gapA: Math.max(needA - aT, 0), gapM: Math.max(needM - mm, 0),
      aShare: needA ? aT / needA * 100 : 0, mShare: needM ? mm / needM * 100 : 0,
      tgtA: pop * ta / 100, tgtM: pop * tm / 100, ta, tm
    };
  }
  const planDelta = p => ({ dA: Math.max(num(p.afterA) - num(p.baseA), 0), dM: Math.max(num(p.afterM) - num(p.baseM), 0) });
  const planCost = p => p.costMode === 'کل' ? num(p.cost) : COST_KEYS.reduce((s, k) => s + num((p.costs || {})[k]), 0);
  function planSplit(d, p) {
    const dd = planDelta(p), f = findForce(d, p.force);
    const room = f && MOVE_WAY[p.type] === 'inv' ? Math.max(tA(f) - num(p.baseA), 0) : 0;
    const inv = Math.min(dd.dA, room);
    return { inv, fresh: dd.dA - inv };
  }
  function verdict(p) {
    const t = p.test || {}, k = ['stays', 'role', 'grows'];
    if (!k.every(x => has(t[x]))) return '';
    return k.every(x => t[x] === 'بله') ? 'تحول' : 'برنامه';
  }
  function planImpact(d, p) {
    const g = gap(d), dd = planDelta(p);
    return {
      ...dd,
      ofGapA: g.gapA ? dd.dA / g.gapA * 100 : 0,
      ofGapM: g.gapM ? dd.dM / g.gapM * 100 : 0,
      ofTgtA: g.tgtA > g.aT ? dd.dA / (g.tgtA - g.aT) * 100 : 0
    };
  }
  const planQ = (p, i) => { const q = QUARTERS.indexOf(p.q); return q >= 0 ? q : Math.min(i, QUARTERS.length - 1); };

  /* همان شرط‌های «تکمیل» که سایت مدیر برای هر قدم دارد (به‌جز صفحه‌های «چرا») */
  function checklist(d) {
    const fs = forces(d), s = d.summary || {};
    const fDone = f => has(f.st) && has(f.n) && (isP(f) || has(f.aa) || has(f.mm));
    const items = [
      ['pop', 'جمعیت شهرستان', has(d.pop)],
      ['pick', 'انتخاب نیروها', fs.length >= 3],
      ['forces', 'عدد نیروها', fs.filter(fDone).length >= 3],
      ['links', 'ارتباط نیروها', has(d.cohesion)],
      ['gap', 'هدف دو ساله', has(d.ta) && has(d.tm)],
      ['uncovered', 'مخاطبان بی‌پوشش', (d.uncovered || []).length > 0],
      ['summary', 'جمع‌بندی وضع امروز', ['strong', 'weak', 'gaps'].every(k => has(s[k]))]
    ];
    (d.plans || []).forEach((p, i) => {
      const r = p.run || {}, tag = (d.plans.length > 1 ? ` (طرح ${i + 1})` : '');
      items.push(
        ['moves@' + i, 'انتخاب حرکت' + tag, has(p.type)],
        ['shift@' + i, 'جملهٔ تحول' + tag, has(p.title) && has(p.force) && has(p.to)],
        ['ba@' + i, 'سهم از شکاف' + tag, has(p.afterA) || has(p.afterM)],
        ['cost@' + i, 'هزینه' + tag, planCost(p) > 0 && has(p.fund)],
        ['test@' + i, 'تحول یا برنامه' + tag, verdict(p) === 'تحول'],
        ['check@' + i, 'سنجش طرح' + tag, p.keep === 'نگه می‌دارم' && verdict(p) === 'تحول'],
        ['run@' + i, 'اجرا' + tag, has(r.lead) && has(r.s1) && has(r.s3) && has(r.risk)]
      );
    });
    return items.map(([id, label, done]) => ({ id, label, done: !!done }));
  }

  /* خلاصهٔ یک بوم برای داشبورد و بستهٔ تحلیل */
  function summarize(d) {
    d = sanitize(d);
    const g = gap(d), plans = (d.plans || []);
    const ck = checklist(d), done = ck.filter(x => x.done).length;
    let dA = 0, dM = 0, inv = 0, fresh = 0, cost = 0;
    const planRows = plans.map((p, i) => {
      const dd = planDelta(p), sp = planSplit(d, p), c = planCost(p), im = planImpact(d, p);
      dA += dd.dA; dM += dd.dM; inv += sp.inv; fresh += sp.fresh; cost += c;
      return {
        i, title: p.title || '', type: p.type || '', way: MOVE_WAY[p.type] || '', force: p.force || '', to: p.to || '',
        verdict: verdict(p), keep: p.keep || '', quarter: QUARTERS[planQ(p, i)],
        dA: dd.dA, dM: dd.dM, invited: sp.inv, fresh: sp.fresh,
        ofGapA: im.ofGapA, ofTgtA: im.ofTgtA, cost: c, costPerActor: dd.dA && c ? c / dd.dA : 0
      };
    });
    const ok = planRows.filter(p => p.dA > 0);
    const avg = ok.length ? ok.reduce((s, p) => s + p.dA, 0) / ok.length : 0;
    const need = g.tgtA > g.aT ? g.tgtA - g.aT : g.gapA;
    return {
      gap: g,
      forcesCount: forces(d).length,
      plansCount: plans.length,
      plans: planRows,
      totals: { dA, dM, invited: inv, fresh, cost },
      projection2y: Math.round(avg * QUARTERS.length),
      projectionPct: need ? Math.min(avg * QUARTERS.length / need * 100, 999) : 0,
      progress: ck.length ? Math.round(done / ck.length * 100) : 0,
      missing: ck.filter(x => !x.done).map(x => x.label)
    };
  }

  return { sanitize, CATS, KIND, MOVE_WAY, WAY_LABEL, QUARTERS, toEn, num, has, forces, isP, tA, tM, tAT, isAct, gap, planDelta, planCost, planSplit, verdict, planImpact, checklist, summarize };
});
