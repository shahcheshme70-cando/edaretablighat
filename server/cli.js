'use strict';
/*
 * ابزار خط فرمان
 *   node server/cli.js create-admin <username> [--name "نام"] [--password رمز]
 *   node server/cli.js admin-password <username> [--password رمز]
 *   node server/cli.js add-director --phone 0915... --name "نام" --county "شهرستان" [--province "استان"] [--title "سمت"]
 *   node server/cli.js import-directors <file.csv>      ستون‌ها: name,phone,county,province,title (سطر اول عنوان)
 *   node server/cli.js reset-director <phone>
 *   node server/cli.js list
 * رمزهای ساخته‌شده فقط یک بار چاپ می‌شوند.
 */
const fs = require('fs');
const crypto = require('crypto');
const cfg = require('./config');
const { Store } = require('./store');
const A = require('./auth');

const args = process.argv.slice(2);
const cmd = args.shift();
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const store = new Store(cfg.DATA_DIR);
const die = m => { console.error('✗ ' + m); process.exit(1); };
const strongPw = () => crypto.randomBytes(12).toString('base64url');

function addDirector(o) {
  const phone = A.normPhone(o.phone);
  if (!A.validPhone(phone)) throw new Error(`شمارهٔ «${o.phone}» معتبر نیست`);
  if (!String(o.name || '').trim() || !String(o.county || '').trim()) throw new Error('نام و شهرستان لازم است');
  if (store.get().users.some(u => u.role === 'director' && u.phone === phone)) throw new Error(`شمارهٔ ${phone} قبلاً ثبت شده`);
  const pw = A.generatePassword();
  store.update(db => db.users.push({
    id: A.newId('u'), role: 'director', phone, name: String(o.name).trim(), county: String(o.county).trim(),
    province: String(o.province || 'خراسان رضوی').trim(), title: String(o.title || 'مدیر تبلیغات اسلامی شهرستان').trim(),
    passHash: A.hashPassword(pw), active: true, mustChange: true, createdAt: new Date().toISOString()
  }));
  return { phone, pw };
}

function parseCsv(txt) {
  const rows = []; let row = [], cur = '', q = false;
  txt = txt.replace(/^﻿/, '');
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"' && txt[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '،' || c === '\t') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

try {
  switch (cmd) {
    case 'create-admin': {
      const username = String(args[0] || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) die('نام کاربری ۳ تا ۳۲ حرف انگلیسی، عدد، نقطه یا خط تیره باشد.');
      if (store.get().users.some(u => u.role === 'admin' && u.username === username)) die('این نام کاربری وجود دارد.');
      const pw = opt('password') || strongPw();
      if (pw.length < 10) die('رمز مدیر کل دست‌کم ۱۰ نویسه باشد.');
      store.update(db => db.users.push({ id: A.newId('a'), role: 'admin', username, name: opt('name') || username, passHash: A.hashPassword(pw), active: true, createdAt: new Date().toISOString() }));
      console.log(`✓ مدیر کل ساخته شد\n  نام کاربری: ${username}\n  رمز: ${pw}`);
      break;
    }
    case 'admin-password': {
      const username = String(args[0] || '').trim().toLowerCase();
      const pw = opt('password') || strongPw();
      if (pw.length < 10) die('رمز مدیر کل دست‌کم ۱۰ نویسه باشد.');
      const ok = store.update(db => { const u = db.users.find(x => x.role === 'admin' && x.username === username); if (!u) return false; u.passHash = A.hashPassword(pw); for (const [h, s] of Object.entries(db.sessions)) if (s.userId === u.id) delete db.sessions[h]; return true; });
      if (!ok) die('چنین مدیر کلی نیست.');
      console.log(`✓ رمز تازهٔ ${username}: ${pw}`);
      break;
    }
    case 'add-director': {
      const r = addDirector({ phone: opt('phone'), name: opt('name'), county: opt('county'), province: opt('province'), title: opt('title') });
      console.log(`✓ ساخته شد · شماره: ${r.phone} · رمز: ${r.pw}`);
      break;
    }
    case 'import-directors': {
      const file = args[0]; if (!file) die('مسیر فایل CSV را بدهید.');
      const rows = parseCsv(fs.readFileSync(file, 'utf8'));
      const head = rows[0].map(h => h.trim().toLowerCase());
      const map = { name: ['name', 'نام'], phone: ['phone', 'موبایل', 'شماره', 'شمارهٔ همراه', 'تلفن همراه'], county: ['county', 'شهرستان'], province: ['province', 'استان'], title: ['title', 'سمت'] };
      const idx = Object.fromEntries(Object.entries(map).map(([k, names]) => [k, head.findIndex(h => names.includes(h))]));
      const hasHead = idx.phone >= 0;
      const data = hasHead ? rows.slice(1) : rows;
      const col = (r, k, d) => { const i = hasHead ? idx[k] : ['name', 'phone', 'county', 'province', 'title'].indexOf(k); return i >= 0 ? (r[i] || '').trim() : d; };
      const out = ['name,phone,county,password'];
      data.forEach((r, i) => {
        try { const x = addDirector({ name: col(r, 'name'), phone: col(r, 'phone'), county: col(r, 'county'), province: col(r, 'province', ''), title: col(r, 'title', '') }); out.push(`${col(r, 'name')},${x.phone},${col(r, 'county')},${x.pw}`); console.log(`✓ ${col(r, 'county')} · ${x.phone} · ${x.pw}`); }
        catch (e) { console.log(`✗ سطر ${i + 1 + (hasHead ? 1 : 0)}: ${e.message}`); }
      });
      const outFile = file.replace(/\.csv$/i, '') + '-passwords.csv';
      fs.writeFileSync(outFile, '﻿' + out.join('\n'), { mode: 0o600 });
      console.log(`\nرمزها در ${outFile} ذخیره شد. پس از ارسال به مدیران، این فایل را پاک کنید.`);
      break;
    }
    case 'reset-director': {
      const phone = A.normPhone(args[0]); const pw = A.generatePassword();
      const ok = store.update(db => { const u = db.users.find(x => x.role === 'director' && x.phone === phone); if (!u) return false; u.passHash = A.hashPassword(pw); u.mustChange = true; for (const [h, s] of Object.entries(db.sessions)) if (s.userId === u.id) delete db.sessions[h]; return true; });
      if (!ok) die('مدیری با این شماره نیست.');
      console.log(`✓ رمز تازهٔ ${phone}: ${pw}`);
      break;
    }
    case 'list': {
      store.get().users.forEach(u => console.log(u.role === 'admin' ? `مدیر کل   ${u.username}` : `شهرستان  ${u.county.padEnd(14)} ${u.phone}  ${u.name}${u.active === false ? '  (غیرفعال)' : ''}`));
      break;
    }
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace('/*', '').replace(/^ \* ?/gm, ''));
  }
} catch (e) { die(e.message); }
