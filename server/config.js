'use strict';
/* تنظیمات از متغیرهای محیطی؛ نمونه در .env.example */
const path = require('path');
const fs = require('fs');

// بارگذاری سادهٔ فایل .env (بدون وابستگی)
function loadEnv(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch (e) { /* فایل .env اختیاری است */ }
}
// آزمون‌ها نباید تنظیمات سرور واقعی (.env) را بخوانند
if (!process.env.HARFENO_NO_DOTENV) loadEnv(path.join(__dirname, '..', '.env'));

const bool = (v, d) => v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v);
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

module.exports = {
  ROOT: path.join(__dirname, '..'),
  PUBLIC_DIR: path.join(__dirname, '..', 'public'),
  PORT: int(process.env.PORT, 8080),
  HOST: process.env.HOST || '127.0.0.1',
  DATA_DIR: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  // پشت HTTPS حتماً 1 باشد تا کوکی‌ها Secure شوند
  COOKIE_SECURE: bool(process.env.COOKIE_SECURE, false),
  // اگر پشت nginx هستید 1 بگذارید تا IP واقعی از X-Forwarded-For خوانده شود
  TRUST_PROXY: bool(process.env.TRUST_PROXY, false),
  // دو دامنهٔ جدا (اختیاری): مثلاً bom.example.ir و panel.example.ir
  PUBLIC_HOST: (process.env.PUBLIC_HOST || '').toLowerCase(),
  ADMIN_HOST: (process.env.ADMIN_HOST || '').toLowerCase(),
  // نشانی سایت مدیر شهرستان برای متن پیامک/پیام رمز
  PUBLIC_URL: process.env.PUBLIC_URL || '',
  // اگر سامانه زیر یک مسیر از دامنهٔ دیگر بالا می‌آید (مثلاً harf-no.ir/mashal)؛ خالی یعنی ریشهٔ دامنه
  BASE_PATH: (() => { let b = String(process.env.BASE_PATH || '').trim(); try { b = decodeURIComponent(b); } catch (e) { /* همان */ } b = b.replace(/\/+$/, ''); if (b && !b.startsWith('/')) b = '/' + b; return b === '/' ? '' : b; })(),
  DIRECTOR_SESSION_DAYS: int(process.env.DIRECTOR_SESSION_DAYS, 30),
  DIRECTOR_IDLE_DAYS: int(process.env.DIRECTOR_IDLE_DAYS, 7),
  ADMIN_SESSION_HOURS: int(process.env.ADMIN_SESSION_HOURS, 12),
  ADMIN_IDLE_HOURS: int(process.env.ADMIN_IDLE_HOURS, 2),
  LOGIN_MAX_ATTEMPTS: int(process.env.LOGIN_MAX_ATTEMPTS, 8),
  LOGIN_WINDOW_MIN: int(process.env.LOGIN_WINDOW_MIN, 15),
  MAX_FORM_BYTES: int(process.env.MAX_FORM_BYTES, 800 * 1024),
  BACKUP_KEEP_HOURLY: int(process.env.BACKUP_KEEP_HOURLY, 72),
  BACKUP_KEEP_DAILY: int(process.env.BACKUP_KEEP_DAILY, 60),
  // تحلیل خودکار با Claude (اختیاری؛ فقط اگر سرور به api.anthropic.com دسترسی دارد)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
};
