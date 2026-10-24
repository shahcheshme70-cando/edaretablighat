'use strict';
/*
 * پایگاه دادهٔ فایلی: یک فایل JSON با نوشتن اتمی (فایل موقت + rename + fsync)
 * و پشتیبان ساعتی و روزانه. برای چند صد کاربر کاملاً کافی است و نصب پایگاه داده نمی‌خواهد.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function emptyDb() {
  return { version: 1, users: [], forms: {}, feedback: {}, sessions: {}, audit: [] };
}

class Store {
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'db.json');
    this.backupDir = path.join(dir, 'backups');
    this.keepHourly = opts.keepHourly || 72;
    this.keepDaily = opts.keepDaily || 60;
    fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    this.db = this._load();
    this._lastBackupHour = '';
  }

  _load() {
    if (!fs.existsSync(this.file)) { const d = emptyDb(); this._write(d); return d; }
    const txt = fs.readFileSync(this.file, 'utf8');
    try {
      const d = JSON.parse(txt);
      this._mtime = fs.statSync(this.file).mtimeMs;
      return Object.assign(emptyDb(), d);
    } catch (e) {
      // فایل خراب: نسخهٔ خراب نگه داشته می‌شود و آخرین پشتیبان سالم بارگذاری می‌شود
      const bad = this.file + '.corrupt-' + Date.now();
      fs.copyFileSync(this.file, bad);
      const last = this._backups().pop();
      if (!last) throw new Error('db.json خراب است و پشتیبانی پیدا نشد: ' + bad);
      console.error('[store] db.json خراب بود؛ از پشتیبان بازیابی شد:', last);
      const d = Object.assign(emptyDb(), JSON.parse(fs.readFileSync(path.join(this.backupDir, last), 'utf8')));
      this._write(d);
      return d;
    }
  }

  _write(d) {
    const tmp = this.file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeSync(fd, JSON.stringify(d)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
    try { this._mtime = fs.statSync(this.file).mtimeMs; } catch (e) { this._mtime = 0; }
  }

  /* اگر فایل از بیرون (مثلاً با ابزار خط فرمان) عوض شده باشد، دوباره خوانده می‌شود */
  _sync() {
    try {
      const m = fs.statSync(this.file).mtimeMs;
      if (this._mtime && m !== this._mtime) { this.db = Object.assign(emptyDb(), JSON.parse(fs.readFileSync(this.file, 'utf8'))); this._mtime = m; }
    } catch (e) { /* در صورت خطا همان نسخهٔ حافظه می‌ماند */ }
  }

  _backups() {
    try { return fs.readdirSync(this.backupDir).filter(f => /^db-\d{8}-\d{2}\.json$/.test(f)).sort(); } catch (e) { return []; }
  }

  _backup() {
    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    const hour = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}`;
    if (hour === this._lastBackupHour) return;
    this._lastBackupHour = hour;
    try {
      fs.copyFileSync(this.file, path.join(this.backupDir, `db-${hour}.json`));
      // نگهداری: پشتیبان‌های ساعتی اخیر + یکی برای هر روز
      const all = this._backups();
      const keep = new Set(all.slice(-this.keepHourly));
      const byDay = {};
      all.forEach(f => { byDay[f.slice(3, 11)] = f; });
      Object.values(byDay).slice(-this.keepDaily).forEach(f => keep.add(f));
      all.forEach(f => { if (!keep.has(f)) fs.unlinkSync(path.join(this.backupDir, f)); });
    } catch (e) { console.error('[store] پشتیبان‌گیری نشد:', e.message); }
  }

  /* هر تغییر از این مسیر: تابع روی داده اجرا و بلافاصله روی دیسک نوشته می‌شود */
  update(fn) {
    this._sync();
    const r = fn(this.db);
    this._write(this.db);
    this._backup();
    return r;
  }

  get() { this._sync(); return this.db; }

  audit(who, action, target, extra) {
    this.db.audit.push({ at: new Date().toISOString(), who, action, target, ...(extra || {}) });
    if (this.db.audit.length > 3000) this.db.audit.splice(0, this.db.audit.length - 3000);
  }
}

module.exports = { Store, emptyDb };
