'use strict';
/*
 * بستهٔ تحلیل برای هوش مصنوعی (Claude، Gemini، ChatGPT و …) و دریافت بازخورد
 * مسیر عادی: ستاد بسته را دانلود می‌کند، به هر هوش مصنوعی می‌دهد، خروجی JSON را در داشبورد بارگذاری می‌کند،
 * بازخوردها را بازبینی و برای هر مدیر منتشر می‌کند.
 * مسیر اختیاری: اگر ANTHROPIC_API_KEY تنظیم شده باشد، سرور خودش از Claude بازخورد پیش‌نویس می‌گیرد.
 */
const M = require('../public/shared/metrics.js');

const INSTRUCTIONS = `شما «دستیار حرف نو» هستید. این بسته بوم‌های «نقشهٔ هزار مشعل» است که مدیران تبلیغات اسلامی شهرستان‌ها پر کرده‌اند.

زمینه:
- هدف گام دوم تحول سازمان: ده درصد مردم کنشگر جهاد تبیین باشند و پیام تبیین به همهٔ مردم برسد. راهبرد «هزار مشعل»: هر کنشگر پیرامون خودش را روشن می‌کند.
- هر بوم سه بخش دارد: «تصویر آرایش موجود» (نیروها، عددها، شکاف)، «طرح تحول» (یکی از شش حرکت: تغییر نقش، فعال‌سازی ظرفیت، ایجاد اتصال، فعال‌سازی مخاطب، افزودن نیروی جدید، ورود به عرصهٔ جدید) و «برنامهٔ اجرایی».
- شکاف سه جزء دارد: کنشگران فرهنگی منتظر دعوت (مشعل‌های خاموش)، کنشگران تازه‌ای که باید اضافه شوند (مشعل‌های تازه)، و مخاطبان بی‌پوشش (جاهای تاریک).
- «برنامه» برگزار می‌شود و تمام می‌شود؛ «تحول» نقش و آرایش آدم‌ها را عوض می‌کند، می‌ماند و خودش کنشگر می‌سازد.
- برای هر شهرستان، عددهای محاسبه‌شده در بخش metrics آمده است؛ داده‌های خام مدیر در بخش data است.

برای هر شهرستان بسنجید:
۱. آیا تصویر آرایش موجود واقع‌بینانه است؟ (عددهای غیرعادی، نیروهای از قلم افتاده، سطح فعالیت خوش‌بینانه)
۲. آیا طرح واقعاً «تحول» است یا برنامه‌ای در لباس تحول؟
۳. آیا طرح سراغ کنشگران منتظر دعوت می‌رود؟ کنشگر تازه از بیرون دایرهٔ آشنا می‌آورد؟ به جاهای تاریک می‌رسد؟
۴. سهم طرح از شکاف و هزینهٔ هر کنشگر تازه معقول است؟ ریز هزینه (costItems) با نوع حرکت جور است؛ مثلاً در «افزودن نیروی جدید» برای جلب اعتماد و در «ایجاد اتصال» برای کار مشترک خرجی دیده شده؟ مراحل اجرا و راهبر روشن است؟
۵. با آهنگ «هر سه ماه یک طرح»، طرح سه ماه بعد بهتر است از کدام حرکت و کدام نیرو شروع شود؟

قواعد نگارش:
- فارسی معیار، محترمانه، مشخص و قابل اقدام. به عددها و نام نیروهای خود همان شهرستان ارجاع دهید.
- هیچ جمله‌ای را از قول امام شهید (رضوان‌الله‌علیه) یا هیچ شخص دیگری نسازید و نقل نکنید.
- ستایش کلی و نصیحت کلی ننویسید. هر بند یک نکتهٔ مشخص باشد.
- امتیازها از ۰ تا ۱۰: b1 آرایش موجود، b2 طرح تحول، b3 برنامهٔ اجرایی.

خروجی: فقط یک آرایهٔ JSON معتبر، بدون هیچ متن دیگری، با یک شیء برای هر شهرستان. نام کلیدها را دقیقاً همین‌طور به انگلیسی بنویسید و ترجمه نکنید؛ userId را عیناً از بسته کپی کنید. امتیازها عدد باشند.
[
  {
    "userId": "همان userId بسته",
    "county": "نام شهرستان",
    "scores": { "b1": 0, "b2": 0, "b3": 0 },
    "summary": "جمع‌بندی در ۳ تا ۵ جمله",
    "strengths": ["۲ تا ۴ نقطهٔ قوت مشخص"],
    "gaps": ["۲ تا ۴ جای کار مشخص"],
    "suggestions": ["۲ تا ۴ پیشنهاد قابل اقدام، از جمله پیشنهاد طرح سه ماه بعد"],
    "message": "یک پیام کوتاه و دلگرم‌کننده برای مدیر (اختیاری)"
  }
]`;

function countyEntry(user, form) {
  const data = (form && form.data) || {};
  return {
    userId: user.id,
    county: user.county || '',
    province: user.province || '',
    director: user.name || '',
    status: form && form.submittedAt ? 'ارسال‌شده' : (form && form.updatedAt ? 'در حال تکمیل' : 'شروع‌نشده'),
    submittedAt: (form && form.submittedAt) || null,
    updatedAt: (form && form.updatedAt) || null,
    metrics: M.summarize(data),
    data
  };
}

const PROMPT = 'طبق دستورالعمل داخل این فایل (بخش instructions)، بوم هر شهرستان را تحلیل کن و فقط آرایهٔ JSON خروجی را بده.';

// مدیران فعال به ترتیب استان و شهرستان (همان ترتیبی که بسته‌ها و داشبورد به کار می‌برند)
const orderedDirectors = db => db.users.filter(u => u.role === 'director' && u.active !== false)
  .sort((a, b) => String(a.province || '').localeCompare(String(b.province || ''), 'fa') || String(a.county || '').localeCompare(String(b.county || ''), 'fa'));

function buildBundle(db, ids, label) {
  const want = ids ? new Set(ids) : null;
  const users = orderedDirectors(db).filter(u => !want || want.has(u.id));
  const n = users.length;
  return {
    kind: 'harfeno-analysis-bundle',
    version: 2,
    generatedAt: new Date().toISOString(),
    label: label || '',
    prompt: PROMPT,
    countiesCount: n,
    instructions: INSTRUCTIONS + `\n\nاین بسته ${n} شهرستان دارد؛ خروجی باید دقیقاً ${n} شیء داشته باشد، یکی برای هر شهرستان، به همان ترتیب. اگر پاسخ برای همه جا نمی‌شود، همهٔ شیءها را کوتاه‌تر بنویسید؛ هیچ شهرستانی را جا نیندازید.`,
    counties: users.map(u => countyEntry(u, db.forms[u.id]))
  };
}

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const list = (v, n, max) => (Array.isArray(v) ? v : String(v || '').split(/\n+/)).map(x => str(x, max)).filter(Boolean).slice(0, n);
// «۷»، «7.5»، «۷٫۵»، «7/10» و «۷ از ۱۰» همه پذیرفته می‌شوند
const score = v => { if (v == null || String(v).trim() === '') return null; const m = M.toEn(v).replace(/[٫,]/g, '.').match(/-?\d+(\.\d+)?/); const x = m ? Number(m[0]) : NaN; return Number.isFinite(x) ? Math.max(0, Math.min(10, Math.round(x * 10) / 10)) : null; };

/* پاک‌سازی یک بازخورد ورودی (از فایل، از Claude یا از ویرایشگر داشبورد) */
function cleanFeedback(f) {
  f = f || {};
  const s = f.scores && typeof f.scores === 'object' ? f.scores : { b1: f.b1, b2: f.b2, b3: f.b3 };
  return {
    scores: { b1: score(s.b1), b2: score(s.b2), b3: score(s.b3) },
    summary: str(f.summary, 3000),
    strengths: list(f.strengths, 8, 600),
    gaps: list(f.gaps, 8, 600),
    suggestions: list(f.suggestions, 8, 600),
    message: str(f.message, 1500)
  };
}

/* JSON از خروجی هوش مصنوعی بیرون کشیده می‌شود: داخل ``` یا با متن اضافه، چند بلوک پشت سر هم
   (مثلاً خروجی چند بسته که با هم جای‌گذاری شده) و ویرگول اضافهٔ آخر فهرست هم پذیرفته می‌شود */
function parseLoose(t) {
  try { return JSON.parse(t); } catch (e) { /* ادامه */ }
  try { return JSON.parse(t.replace(/,\s*([\]}])/g, '$1')); } catch (e) { return undefined; }
}
// همهٔ آرایه‌ها/شیءهای سطح بالا با شمردن کروشه‌ها (رشته‌ها نادیده گرفته می‌شوند)
function topLevelChunks(t) {
  const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { if (depth > 0) inStr = true; continue; }
    if (c === '[' || c === '{') { if (depth === 0) start = i; depth++; }
    else if ((c === ']' || c === '}') && depth > 0) { depth--; if (depth === 0 && start >= 0) { out.push(t.slice(start, i + 1)); start = -1; } }
  }
  return out;
}
function extractJson(text) {
  if (typeof text !== 'string') return text;
  const t = text.replace(/^﻿/, '').replace(/[​‎‏]/g, '').trim();
  const whole = parseLoose(t);
  if (whole !== undefined) return whole;
  const blocks = [...t.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)].map(m => m[1].trim());
  const chunks = blocks.length ? blocks : topLevelChunks(t);
  const items = [];
  chunks.forEach(c => {
    const v = parseLoose(c);
    if (Array.isArray(v)) items.push(...v);
    else if (v && typeof v === 'object') items.push(...(Array.isArray(v.items) ? v.items : [v]));
  });
  if (items.length) return items;
  throw new Error('در متن واردشده JSON معتبری پیدا نشد. پاسخ هوش مصنوعی را کامل و بدون تغییر جای‌گذاری کنید.');
}

const normName = v => String(v == null ? '' : v).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\s]+/g, '').replace(/^استان/, '');
/* تطبیق بازخوردهای واردشده با کاربران: با userId، یا شمارهٔ همراه، یا نام شهرستان */
function matchItems(db, items) {
  const directors = db.users.filter(u => u.role === 'director');
  const out = { matched: [], unmatched: [] };
  (Array.isArray(items) ? items : [items]).forEach((it, idx) => {
    if (!it || typeof it !== 'object') { out.unmatched.push({ idx, reason: 'مورد نامعتبر' }); return; }
    let u = directors.find(x => x.id === it.userId);
    if (!u && it.phone) u = directors.find(x => x.phone === String(M.toEn(it.phone)).replace(/\D/g, ''));
    if (!u && it.county) {
      let c = directors.filter(x => normName(x.county) === normName(it.county));
      if (c.length > 1 && it.province) c = c.filter(x => normName(x.province) === normName(it.province));
      if (c.length === 1) u = c[0];
      else if (c.length > 1) { out.unmatched.push({ idx, county: it.county, reason: 'چند شهرستان با این نام هست؛ userId لازم است' }); return; }
    }
    if (u) {
      const prev = out.matched.findIndex(m => m.userId === u.id);
      if (prev >= 0) out.matched.splice(prev, 1);
      out.matched.push({ userId: u.id, county: u.county, feedback: cleanFeedback(it) });
    } else out.unmatched.push({ idx, county: it.county || '', reason: 'مدیری با این شناسه یا شهرستان پیدا نشد' });
  });
  return out;
}

async function analyzeWithClaude(cfg, entry) {
  if (!cfg.ANTHROPIC_API_KEY) throw new Error('کلید Claude تنظیم نشده است.');
  const body = {
    model: cfg.ANTHROPIC_MODEL,
    max_tokens: 4000,
    system: INSTRUCTIONS,
    messages: [{ role: 'user', content: 'بوم این شهرستان را تحلیل کن و فقط آرایهٔ JSON با یک شیء برگردان:\n\n' + JSON.stringify(entry) }]
  };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180000);
  let r;
  try {
    r = await fetch(cfg.ANTHROPIC_BASE_URL.replace(/\/$/, '') + '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
  } catch (e) {
    throw new Error('به سرویس Claude وصل نشدیم: ' + (e.name === 'AbortError' ? 'مهلت تمام شد' : e.message));
  } finally { clearTimeout(t); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('خطای سرویس Claude: ' + ((j.error && j.error.message) || r.status));
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  let parsed = extractJson(text);
  if (Array.isArray(parsed)) parsed = parsed[0];
  return cleanFeedback(parsed);
}

module.exports = { INSTRUCTIONS, orderedDirectors, buildBundle, countyEntry, cleanFeedback, extractJson, matchItems, analyzeWithClaude };
