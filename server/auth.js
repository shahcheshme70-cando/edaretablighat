'use strict';
/* رمزها با scrypt، نشست‌ها با توکن تصادفی که فقط هش آن ذخیره می‌شود، و محدودیت تلاش ورود */
const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, saltB, keyB] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const key = Buffer.from(keyB, 'base64');
    const got = crypto.scryptSync(String(pw), Buffer.from(saltB, 'base64'), key.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(key, got);
  } catch (e) { return false; }
}

// رمز اولیه: ۸ رقم، راحت برای تایپ روی گوشی
function generatePassword() {
  let s = '';
  while (s.length < 8) s += crypto.randomInt(0, 10);
  if (/^(\d)\1+$/.test(s)) return generatePassword();
  return s;
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const tokenHash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const newId = (prefix) => prefix + '_' + crypto.randomBytes(8).toString('hex');

/* محدودیت ساده در حافظه: تعداد تلاش ناموفق در یک بازهٔ زمانی */
class RateLimiter {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.map = new Map(); }
  _get(key) {
    const now = Date.now();
    let e = this.map.get(key);
    if (!e || now - e.start > this.windowMs) { e = { start: now, n: 0 }; this.map.set(key, e); }
    return e;
  }
  blocked(key) { return this._get(key).n >= this.max; }
  fail(key) { this._get(key).n++; }
  reset(key) { this.map.delete(key); }
  retryAfter(key) { const e = this._get(key); return Math.max(1, Math.ceil((e.start + this.windowMs - Date.now()) / 1000)); }
  sweep() { const now = Date.now(); for (const [k, e] of this.map) if (now - e.start > this.windowMs) this.map.delete(k); }
}

const toEn = s => String(s == null ? '' : s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
function normPhone(v) {
  let s = toEn(v).replace(/[^\d+]/g, '');
  if (s.startsWith('+98')) s = '0' + s.slice(3);
  else if (s.startsWith('0098')) s = '0' + s.slice(4);
  else if (s.startsWith('98') && s.length === 12) s = '0' + s.slice(2);
  else if (s.startsWith('9') && s.length === 10) s = '0' + s;
  return s;
}
const validPhone = s => /^09\d{9}$/.test(s);
// نام استان یکسان: «ي/ك» عربی، نیم‌فاصله و فاصله‌های اضافه یکی می‌شوند تا «خراسان‌رضوی» و «خراسان رضوی» دو استان نشوند
const normProvince = v => String(v == null ? '' : v).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\u200f\u200e]/g, ' ').replace(/^استان\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 80);

module.exports = { hashPassword, verifyPassword, generatePassword, newToken, tokenHash, newId, RateLimiter, normPhone, validPhone, normProvince, toEn };
