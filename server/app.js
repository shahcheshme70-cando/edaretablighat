'use strict';
/* مسیرها: API مدیر شهرستان، API ستاد، و فایل‌های ایستا */
const fs = require('fs');
const path = require('path');
const A = require('./auth');
const AN = require('./analysis');
const SH = require('./sheets');
const M = require('../public/shared/metrics.js');

// خلاصهٔ یک بوم؛ دادهٔ خراب یک مدیر نباید داشبورد همه را از کار بیندازد
function safeSummary(d) { try { return M.summarize(d || {}); } catch (e) { console.error('[metrics]', e.message); return M.summarize({}); } }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }

function createApp(cfg, store) {
  const DUMMY_HASH = A.hashPassword(A.newToken());
  const loginLimiter = new RateLimiter2(cfg);
  setInterval(() => loginLimiter.sweep(), 60000).unref();

  /* ---------- ابزارها ---------- */
  const send = (res, status, obj, headers = {}) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };
  const clientIp = req => {
    if (cfg.TRUST_PROXY) {
      // X-Real-IP را nginx خودش می‌گذارد؛ از X-Forwarded-For فقط آخرین مورد (افزودهٔ nginx) قابل اعتماد است
      if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']).trim();
      const xf = req.headers['x-forwarded-for'];
      if (xf) return String(xf).split(',').pop().trim();
    }
    return req.socket.remoteAddress || '';
  };
  const parseCookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf('='); let v = s.slice(i + 1); try { v = decodeURIComponent(v); } catch (e) { /* کوکی نامعتبر نادیده گرفته می‌شود */ } return [s.slice(0, i), v];
  }));
  const BASE = cfg.BASE_PATH || '';
  const at = loc => encodeURI(BASE + loc);
  const cookie = (name, val, maxAge) => `${name}=${encodeURIComponent(val)}; Path=${encodeURI(BASE || '/')}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.COOKIE_SECURE ? '; Secure' : ''}`;

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0, over = false; const chunks = [];
      const tooBig = () => new HttpError(413, 'حجم داده بیش از حد مجاز است.');
      if (+req.headers['content-length'] > limit) { over = true; req.resume(); req.on('end', () => reject(tooBig())); return; }
      req.on('data', c => {
        if (over) { size += c.length; if (size > limit * 4) req.destroy(); return; }
        size += c.length;
        if (size > limit) { over = true; chunks.length = 0; return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (over) return reject(tooBig());
        if (!size) return resolve({});
        let v; try { v = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return reject(new HttpError(400, 'دادهٔ ارسالی معتبر نیست.')); }
        if (!v || typeof v !== 'object' || Array.isArray(v)) return reject(new HttpError(400, 'دادهٔ ارسالی معتبر نیست.'));
        resolve(v);
      });
      req.on('error', reject);
    });
  }

  /* ---------- نشست ---------- */
  const KIND = {
    director: { cookie: 'hn_sid', maxMs: cfg.DIRECTOR_SESSION_DAYS * 864e5, idleMs: cfg.DIRECTOR_IDLE_DAYS * 864e5 },
    admin: { cookie: 'hn_admin', maxMs: cfg.ADMIN_SESSION_HOURS * 36e5, idleMs: cfg.ADMIN_IDLE_HOURS * 36e5 }
  };
  function startSession(res, user, kind, req) {
    const token = A.newToken(), now = Date.now();
    store.update(db => {
      db.sessions[A.tokenHash(token)] = { userId: user.id, kind, createdAt: now, lastSeen: now, ip: clientIp(req), ua: String(req.headers['user-agent'] || '').slice(0, 160) };
      const u = db.users.find(x => x.id === user.id); if (u) u.lastLoginAt = new Date(now).toISOString();
    });
    res.setHeader('Set-Cookie', cookie(KIND[kind].cookie, token, Math.floor(KIND[kind].maxMs / 1000)));
  }
  function getSession(req, kind) {
    const token = parseCookies(req)[KIND[kind].cookie];
    if (!token) return null;
    const h = A.tokenHash(token), db = store.get(), s = db.sessions[h];
    if (!s || s.kind !== kind) return null;
    const now = Date.now();
    if (now - s.createdAt > KIND[kind].maxMs || now - s.lastSeen > KIND[kind].idleMs) {
      store.update(d => { delete d.sessions[h]; }); return null;
    }
    const user = db.users.find(u => u.id === s.userId && u.active !== false && u.role === kind);
    if (!user) return null;
    // به‌روزرسانی lastSeen حداکثر هر ۵ دقیقه یک بار تا دیسک بی‌دلیل نوشته نشود
    if (now - s.lastSeen > 300000) store.update(() => { s.lastSeen = now; });
    return { hash: h, user };
  }
  function endSession(req, res, kind) {
    const token = parseCookies(req)[KIND[kind].cookie];
    if (token) store.update(db => { delete db.sessions[A.tokenHash(token)]; });
    res.setHeader('Set-Cookie', cookie(KIND[kind].cookie, '', 0));
  }
  const killUserSessions = (db, userId, exceptHash) => {
    for (const [h, s] of Object.entries(db.sessions)) if (s.userId === userId && h !== exceptHash) delete db.sessions[h];
  };
  function sweepSessions() {
    const now = Date.now(), db = store.get();
    const dead = Object.entries(db.sessions).filter(([, s]) => { const k = KIND[s.kind]; return !k || now - s.createdAt > k.maxMs || now - s.lastSeen > k.idleMs; });
    if (dead.length) store.update(d => dead.forEach(([h]) => delete d.sessions[h]));
  }
  setInterval(sweepSessions, 3600000).unref();

  const isViewer = u => !!u && u.role === 'admin' && u.access === 'view';
  const viewerView = u => ({ id: u.id, kind: 'viewer', name: u.name || '', phone: u.username, title: u.title || '', province: u.province || '' });
  const directorView = u => ({ id: u.id, name: u.name || '', county: u.county || '', province: u.province || '', role: u.title || 'مدیر تبلیغات اسلامی شهرستان', phone: u.phone });
  const meFor = (db, u) => {
    const f = db.forms[u.id] || {}, fb = db.feedback[u.id] || {};
    return { user: { ...directorView(u), mustChange: !!u.mustChange }, data: f.data || {}, rev: f.rev || 0, updatedAt: f.updatedAt || null, submittedAt: f.submittedAt || null, feedback: fb.published || null, feedbackAt: fb.publishedAt || null };
  };

  /* ---------- مسیرهای API ---------- */
  async function api(req, res, p, url) {
    const method = req.method;
    // محافظت در برابر درخواست از دامنهٔ دیگر برای درخواست‌های تغییر‌دهنده
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try { const o = new URL(origin); ok = o.host === req.headers.host || [cfg.PUBLIC_HOST, cfg.ADMIN_HOST].includes(o.host.toLowerCase()); } catch (e) { ok = false; }
        if (!ok) throw new HttpError(403, 'درخواست از مبدأ نامعتبر.');
      }
      const ct = String(req.headers['content-type'] || '');
      if (req.headers['content-length'] && +req.headers['content-length'] > 0 && !ct.includes('application/json')) throw new HttpError(415, 'نوع داده باید JSON باشد.');
    }

    /* ===== مدیر شهرستان ===== */
    if (p === '/api/me' && method === 'GET') {
      const s = getSession(req, 'director'); if (!s) throw new HttpError(401, 'وارد نشده‌اید.');
      return send(res, 200, meFor(store.get(), s.user));
    }
    if (p === '/api/login' && method === 'POST') {
      const b = await readBody(req, 10 * 1024);
      const phone = A.normPhone(b.phone), pw = A.toEn(b.password || '');
      const keys = ['ip:' + clientIp(req), 'ph:' + phone];
      const bk = keys.find(k => loginLimiter.blocked(k));
      if (bk) throw new HttpError(429, `تلاش‌ها زیاد بود؛ ${Math.ceil(loginLimiter.retryAfter(bk) / 60)} دقیقهٔ دیگر دوباره امتحان کنید.`);
      const u = store.get().users.find(x => x.role === 'director' && x.phone === phone);
      // حتی برای شمارهٔ ناموجود هم رمز سنجیده می‌شود تا از زمان پاسخ نشود فهمید شماره ثبت شده یا نه
      const okPw = A.verifyPassword(pw, u ? u.passHash : DUMMY_HASH);
      if (!A.validPhone(phone) || !u || u.active === false || !okPw) {
        keys.forEach(k => loginLimiter.fail(k));
        if (u && u.active === false) throw new HttpError(403, 'حساب شما غیرفعال است. با ستاد تماس بگیرید.');
        throw new HttpError(401, 'شماره یا رمز درست نیست.');
      }
      keys.forEach(k => loginLimiter.reset(k));
      startSession(res, u, 'director', req);
      store.update(db => store.audit(u.id, 'login', u.id));
      return send(res, 200, { ok: true });
    }
    if (p === '/api/logout' && method === 'POST') { endSession(req, res, 'director'); return send(res, 200, { ok: true }); }
    if (p === '/api/form' && method === 'PUT') {
      const s = getSession(req, 'director'); if (!s) throw new HttpError(401, 'نشست شما تمام شده است؛ دوباره وارد شوید.');
      const b = await readBody(req, cfg.MAX_FORM_BYTES);
      if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) throw new HttpError(400, 'دادهٔ بوم معتبر نیست.');
      for (const k of ['forces', 'plans', 'pairs', 'uncovered']) if (b.data[k] != null && !Array.isArray(b.data[k])) throw new HttpError(400, 'دادهٔ بوم معتبر نیست.');
      if (b.data.summary != null && (typeof b.data.summary !== 'object' || Array.isArray(b.data.summary))) throw new HttpError(400, 'دادهٔ بوم معتبر نیست.');
      const db = store.get(), cur = db.forms[s.user.id] || { rev: 0 };
      if (!b.force && b.rev != null && Number(b.rev) !== Number(cur.rev || 0)) {
        throw new HttpError(409, 'این بوم روی دستگاه دیگری تغییر کرده است.', { rev: cur.rev || 0, updatedAt: cur.updatedAt || null });
      }
      const now = new Date().toISOString();
      const out = store.update(d => {
        const f = d.forms[s.user.id] = d.forms[s.user.id] || { rev: 0 };
        f.data = b.data; f.rev = (f.rev || 0) + 1; f.updatedAt = now;
        if (f.submittedAt) f.editedAfterSubmit = now;
        return { rev: f.rev, updatedAt: now };
      });
      return send(res, 200, out);
    }
    if (p === '/api/form/submit' && method === 'POST') {
      const s = getSession(req, 'director'); if (!s) throw new HttpError(401, 'نشست شما تمام شده است؛ دوباره وارد شوید.');
      const f = store.get().forms[s.user.id];
      if (!f || !f.data) throw new HttpError(400, 'هنوز چیزی برای ارسال ذخیره نشده است.');
      const now = new Date().toISOString();
      store.update(db => { const x = db.forms[s.user.id]; x.submittedAt = now; x.submitCount = (x.submitCount || 0) + 1; delete x.editedAfterSubmit; store.audit(s.user.id, 'submit', s.user.id); });
      return send(res, 200, { submittedAt: now });
    }
    if (p === '/api/password' && method === 'POST') {
      const s = getSession(req, 'director'); if (!s) throw new HttpError(401, 'نشست شما تمام شده است؛ دوباره وارد شوید.');
      const b = await readBody(req, 10 * 1024);
      const cur = A.toEn(b.current || ''), next = A.toEn(b.next || '');
      if (!A.verifyPassword(cur, s.user.passHash)) throw new HttpError(400, 'رمز فعلی درست نیست.');
      if (next.length < 6) throw new HttpError(400, 'رمز تازه دست‌کم ۶ نویسه باشد.');
      store.update(db => { const u = db.users.find(x => x.id === s.user.id); u.passHash = A.hashPassword(next); u.mustChange = false; killUserSessions(db, u.id, s.hash); store.audit(u.id, 'password', u.id); });
      return send(res, 200, { ok: true });
    }

    /* ===== ستاد ===== */
    if (p === '/api/admin/login' && method === 'POST') {
      const b = await readBody(req, 10 * 1024);
      const username = A.toEn(String(b.username || '')).trim().toLowerCase(), pw = A.toEn(b.password || '');
      // حساب مدیرکل با شمارهٔ همراه وارد می‌شود؛ شماره به هر شکلی نوشته شود یکسان می‌شود
      const asPhone = A.normPhone(username), login = A.validPhone(asPhone) ? asPhone : username;
      const keys = ['aip:' + clientIp(req), 'au:' + login];
      if (keys.some(k => loginLimiter.blocked(k))) throw new HttpError(429, 'تلاش‌ها زیاد بود؛ چند دقیقهٔ دیگر دوباره امتحان کنید.');
      const u = store.get().users.find(x => x.role === 'admin' && x.username === login);
      const okPw = A.verifyPassword(pw, u ? u.passHash : DUMMY_HASH);
      if (!u || u.active === false || !okPw) {
        keys.forEach(k => loginLimiter.fail(k));
        if (u && okPw && u.active === false) throw new HttpError(403, 'این حساب غیرفعال است. با ستاد تماس بگیرید.');
        throw new HttpError(401, 'نام کاربری یا رمز درست نیست.');
      }
      keys.forEach(k => loginLimiter.reset(k));
      startSession(res, u, 'admin', req);
      store.update(d => { const x = d.users.find(y => y.id === u.id); if (x) x.lastLoginAt = new Date().toISOString(); store.audit(u.username, isViewer(u) ? 'viewer-login' : 'admin-login', u.id); });
      return send(res, 200, { ok: true });
    }
    if (p.startsWith('/api/admin/')) {
      const s = getSession(req, 'admin'); if (!s) throw new HttpError(401, 'نشست شما تمام شده است؛ دوباره وارد شوید.');
      const who = s.user.username;
      const db = store.get();
      const seg = p.slice('/api/admin/'.length).split('/');

      const viewer = isViewer(s.user);
      // مدیرکل فقط شهرستان‌های استان خودش را می‌بیند (اگر استانی برایش ثبت شده باشد)
      const inScope = u => !viewer || !s.user.province || (u.province || '') === s.user.province;

      if (seg[0] === 'logout' && method === 'POST') { endSession(req, res, 'admin'); return send(res, 200, { ok: true }); }
      if (seg[0] === 'me' && method === 'GET') return send(res, 200, { user: { username: s.user.username, name: s.user.name || s.user.username, title: s.user.title || '', province: s.user.province || '', mustChange: !!s.user.mustChange }, access: viewer ? 'view' : 'full', aiEnabled: !viewer && !!cfg.ANTHROPIC_API_KEY, publicUrl: cfg.PUBLIC_URL });
      if (seg[0] === 'password' && method === 'POST') {
        const b = await readBody(req, 10 * 1024);
        const min = viewer ? 8 : 10;
        if (!A.verifyPassword(A.toEn(b.current || ''), s.user.passHash)) throw new HttpError(400, 'رمز فعلی درست نیست.');
        if (A.toEn(b.next || '').length < min) throw new HttpError(400, `رمز تازه دست‌کم ${min === 8 ? '۸' : '۱۰'} نویسه باشد.`);
        store.update(d => { const u = d.users.find(x => x.id === s.user.id); u.passHash = A.hashPassword(A.toEn(b.next)); u.mustChange = false; killUserSessions(d, u.id, s.hash); store.audit(who, 'admin-password', u.id); });
        return send(res, 200, { ok: true });
      }
      // حساب مدیرکل فقط دیدن: فهرست شهرستان‌ها و بوم هر شهرستان؛ هر کار دیگری روی سرور رد می‌شود
      if (viewer && !(method === 'GET' && ((seg[0] === 'users' && (!seg[1] || (seg[1] && seg[2] === 'form' && !seg[3]))) || (seg[0] === 'sheet' && seg[1] && !seg[2])))) {
        throw new HttpError(403, 'دسترسی شما فقط برای دیدن است.');
      }

      if (seg[0] === 'users' && !seg[1] && method === 'GET') {
        const rows = db.users.filter(u => u.role === 'director' && inScope(u)).map(u => {
          const f = db.forms[u.id] || {}, fb = db.feedback[u.id] || {};
          return {
            ...directorView(u), active: u.active !== false, createdAt: u.createdAt, lastLoginAt: viewer ? null : (u.lastLoginAt || null),
            updatedAt: f.updatedAt || null, submittedAt: f.submittedAt || null, editedAfterSubmit: f.editedAfterSubmit || null,
            feedback: viewer ? { draft: false, published: !!fb.published, publishedAt: fb.publishedAt || null, draftAt: null } : { draft: !!fb.draft, published: !!fb.published, publishedAt: fb.publishedAt || null, draftAt: fb.draftAt || null },
            metrics: safeSummary(f.data)
          };
        });
        return send(res, 200, { users: rows });
      }
      if (seg[0] === 'users' && !seg[1] && method === 'POST') {
        const b = await readBody(req, 20 * 1024);
        const r = createDirector(b, who);
        return send(res, 200, r);
      }
      if (seg[0] === 'users' && seg[1] === 'import' && method === 'POST') {
        const b = await readBody(req, 512 * 1024);
        const rows = Array.isArray(b.rows) ? b.rows.slice(0, 2000) : [];
        const created = [], errors = [];
        rows.forEach((row, i) => { try { created.push(createDirector(row, who)); } catch (e) { errors.push({ row: i + 1, phone: row && row.phone, error: e.message }); } });
        return send(res, 200, { created, errors });
      }
      const uid = seg[1];
      const target = uid && seg[0] === 'users' && db.users.find(u => u.id === uid && u.role === 'director' && inScope(u));
      if (seg[0] === 'users' && uid && !target) throw new HttpError(404, 'این مدیر پیدا نشد.');

      if (seg[0] === 'users' && target && !seg[2] && method === 'PATCH') {
        const b = await readBody(req, 20 * 1024);
        let ph = null;
        if (b.phone != null) {
          ph = A.normPhone(b.phone);
          if (!A.validPhone(ph)) throw new HttpError(400, 'شمارهٔ همراه معتبر نیست.');
          if (db.users.some(x => x.id !== uid && x.role === 'director' && x.phone === ph)) throw new HttpError(409, 'این شماره برای مدیر دیگری ثبت شده است.');
        }
        if (b.name != null && !String(b.name).trim()) throw new HttpError(400, 'نام مدیر را بنویسید.');
        if (b.county != null && !String(b.county).trim()) throw new HttpError(400, 'نام شهرستان را بنویسید.');
        store.update(d => {
          const u = d.users.find(x => x.id === uid);
          if (b.name != null) u.name = String(b.name).trim().slice(0, 120);
          if (b.county != null) u.county = String(b.county).trim().slice(0, 80);
          if (b.province != null) u.province = String(b.province).trim().slice(0, 80);
          if (b.title != null) u.title = String(b.title).trim().slice(0, 120);
          if (ph) u.phone = ph;
          if (b.active != null) { u.active = !!b.active; if (!u.active) killUserSessions(d, uid); }
          store.audit(who, 'user-edit', uid);
        });
        return send(res, 200, { ok: true });
      }
      if (seg[0] === 'users' && target && seg[2] === 'reset-password' && method === 'POST') {
        const pw = A.generatePassword();
        store.update(d => { const u = d.users.find(x => x.id === uid); u.passHash = A.hashPassword(pw); u.mustChange = true; killUserSessions(d, uid); store.audit(who, 'reset-password', uid); });
        return send(res, 200, { password: pw, user: directorView(target) });
      }
      if (seg[0] === 'users' && target && seg[2] === 'form' && method === 'GET') {
        const out = meFor(db, target), fb = db.feedback[uid] || {};
        out.feedbackDraft = viewer ? null : (fb.draft || null); out.feedbackDraftAt = viewer ? null : (fb.draftAt || null);
        out.metrics = safeSummary(out.data);
        out.readonly = true;
        return send(res, 200, out);
      }
      if (seg[0] === 'users' && target && seg[2] === 'feedback') {
        if (!seg[3] && method === 'PUT') {
          const b = await readBody(req, 64 * 1024);
          const fb = AN.cleanFeedback(b.draft || b);
          store.update(d => { const x = d.feedback[uid] = d.feedback[uid] || {}; x.draft = fb; x.draftAt = new Date().toISOString(); x.source = b.source || 'manual'; store.audit(who, 'feedback-draft', uid); });
          return send(res, 200, { ok: true, draft: fb });
        }
        if (seg[3] === 'publish' && method === 'POST') {
          const x = db.feedback[uid];
          if (!x || !x.draft) throw new HttpError(400, 'پیش‌نویسی برای انتشار نیست.');
          store.update(d => { const y = d.feedback[uid]; y.published = y.draft; y.publishedAt = new Date().toISOString(); store.audit(who, 'feedback-publish', uid); });
          return send(res, 200, { ok: true });
        }
        if (seg[3] === 'unpublish' && method === 'POST') {
          store.update(d => { const y = d.feedback[uid]; if (y) { delete y.published; delete y.publishedAt; } store.audit(who, 'feedback-unpublish', uid); });
          return send(res, 200, { ok: true });
        }
      }
      if (seg[0] === 'users' && target && seg[2] === 'analyze' && method === 'POST') {
        if (!cfg.ANTHROPIC_API_KEY) throw new HttpError(400, 'تحلیل خودکار فعال نیست؛ کلید Claude روی سرور تنظیم نشده است.');
        let fb;
        try { fb = await AN.analyzeWithClaude(cfg, AN.countyEntry(target, db.forms[uid])); } catch (e) { throw new HttpError(502, e.message); }
        store.update(d => { const x = d.feedback[uid] = d.feedback[uid] || {}; x.draft = fb; x.draftAt = new Date().toISOString(); x.source = 'ai'; store.audit(who, 'feedback-ai', uid); });
        return send(res, 200, { ok: true, draft: fb });
      }
      /* حساب‌های مدیرکل (فقط دیدن) */
      if (seg[0] === 'viewers') {
        const vid = seg[1], vt = vid && db.users.find(u => u.id === vid && isViewer(u));
        if (vid && !vt) throw new HttpError(404, 'این حساب پیدا نشد.');
        if (!vid && method === 'GET') return send(res, 200, { viewers: db.users.filter(isViewer).map(u => ({ ...viewerView(u), active: u.active !== false, createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null })) });
        if (!vid && method === 'POST') { const b = await readBody(req, 20 * 1024); return send(res, 200, createViewer(b, who)); }
        if (vt && !seg[2] && method === 'PATCH') {
          const b = await readBody(req, 20 * 1024);
          let ph = null;
          if (b.phone != null) {
            ph = A.normPhone(b.phone);
            if (!A.validPhone(ph)) throw new HttpError(400, 'شمارهٔ همراه معتبر نیست.');
            if (db.users.some(x => x.id !== vid && x.role === 'admin' && x.username === ph)) throw new HttpError(409, 'این شماره برای حساب دیگری ثبت شده است.');
          }
          if (b.name != null && !String(b.name).trim()) throw new HttpError(400, 'نام را بنویسید.');
          store.update(d => {
            const u = d.users.find(x => x.id === vid);
            if (b.name != null) u.name = String(b.name).trim().slice(0, 120);
            if (b.title != null) u.title = String(b.title).trim().slice(0, 120);
            if (b.province != null) u.province = String(b.province).trim().slice(0, 80);
            if (ph && ph !== u.username) { u.username = ph; u.phone = ph; killUserSessions(d, vid); }
            if (b.active != null) { u.active = !!b.active; if (!u.active) killUserSessions(d, vid); }
            store.audit(who, 'viewer-edit', vid);
          });
          return send(res, 200, { ok: true });
        }
        if (vt && seg[2] === 'reset-password' && method === 'POST') {
          const pw = A.generatePassword();
          store.update(d => { const u = d.users.find(x => x.id === vid); u.passHash = A.hashPassword(pw); u.mustChange = true; killUserSessions(d, vid); store.audit(who, 'viewer-reset-password', vid); });
          return send(res, 200, { password: pw, user: viewerView(vt) });
        }
        throw new HttpError(404, 'مسیر پیدا نشد.');
      }
      /* خروجی اکسل: شهرستان‌ها، نیروها، طرح‌ها */
      if (seg[0] === 'sheet' && seg[1] && !seg[2] && method === 'GET') {
        const out = SH.sheet(seg[1], db, db.users.filter(u => u.role === 'director' && inScope(u)));
        if (!out) throw new HttpError(404, 'این جدول پیدا نشد.');
        store.update(() => store.audit(who, 'sheet', seg[1]));
        const buf = Buffer.from(out.body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${out.name}"` });
        return res.end(buf);
      }
      if (seg[0] === 'export' && method === 'GET') {
        let ids = url.searchParams.get('ids'); ids = ids ? ids.split(',').filter(Boolean) : null;
        const only = url.searchParams.get('submitted') === '1';
        let bundle = AN.buildBundle(db, ids);
        if (only) bundle.counties = bundle.counties.filter(c => c.submittedAt);
        store.update(() => store.audit(who, 'export', String(bundle.counties.length)));
        const name = 'harfeno-analysis-' + new Date().toISOString().slice(0, 10) + '.json';
        return send(res, 200, bundle, { 'Content-Disposition': `attachment; filename="${name}"` });
      }
      if (seg[0] === 'feedback' && seg[1] === 'import' && method === 'POST') {
        const b = await readBody(req, 4 * 1024 * 1024);
        let items = b.items;
        if (typeof b.text === 'string') { try { items = AN.extractJson(b.text); } catch (e) { throw new HttpError(400, e.message); } }
        if (items && !Array.isArray(items) && Array.isArray(items.items)) items = items.items;
        if (!items) throw new HttpError(400, 'بازخوردی پیدا نشد.');
        const r = AN.matchItems(db, items);
        const now = new Date().toISOString();
        store.update(d => { r.matched.forEach(m => { const x = d.feedback[m.userId] = d.feedback[m.userId] || {}; x.draft = m.feedback; x.draftAt = now; x.source = 'import'; }); store.audit(who, 'feedback-import', String(r.matched.length)); });
        return send(res, 200, { matched: r.matched.map(m => ({ userId: m.userId, county: m.county })), unmatched: r.unmatched });
      }
      if (seg[0] === 'audit' && method === 'GET') return send(res, 200, { audit: db.audit.slice(-300).reverse() });
      throw new HttpError(404, 'مسیر پیدا نشد.');
    }
    throw new HttpError(404, 'مسیر پیدا نشد.');
  }

  function createViewer(b, who) {
    const phone = A.normPhone(b.phone);
    if (!A.validPhone(phone)) throw new HttpError(400, `شمارهٔ همراه «${b.phone || ''}» معتبر نیست.`);
    const name = String(b.name || '').trim();
    if (!name) throw new HttpError(400, 'نام را بنویسید.');
    if (store.get().users.some(u => u.role === 'admin' && u.username === phone)) throw new HttpError(409, `شمارهٔ ${phone} قبلاً برای حسابی ثبت شده است.`);
    const pw = A.generatePassword();
    const u = {
      id: A.newId('v'), role: 'admin', access: 'view', username: phone, phone, name: name.slice(0, 120),
      title: String(b.title || 'مدیرکل تبلیغات اسلامی استان').trim().slice(0, 120), province: String(b.province == null ? 'خراسان رضوی' : b.province).trim().slice(0, 80),
      passHash: A.hashPassword(pw), active: true, mustChange: true, createdAt: new Date().toISOString()
    };
    store.update(db => { db.users.push(u); store.audit(who, 'viewer-create', u.id); });
    return { user: viewerView(u), password: pw };
  }

  function createDirector(b, who) {
    const phone = A.normPhone(b.phone);
    if (!A.validPhone(phone)) throw new HttpError(400, `شمارهٔ همراه «${b.phone || ''}» معتبر نیست.`);
    const name = String(b.name || '').trim(), county = String(b.county || '').trim();
    if (!name) throw new HttpError(400, 'نام مدیر را بنویسید.');
    if (!county) throw new HttpError(400, 'نام شهرستان را بنویسید.');
    if (store.get().users.some(u => u.role === 'director' && u.phone === phone)) throw new HttpError(409, `شمارهٔ ${phone} قبلاً ثبت شده است.`);
    const pw = A.generatePassword();
    const u = {
      id: A.newId('u'), role: 'director', phone, name: name.slice(0, 120), county: county.slice(0, 80),
      province: String(b.province || 'خراسان رضوی').trim().slice(0, 80), title: String(b.title || 'مدیر تبلیغات اسلامی شهرستان').trim().slice(0, 120),
      passHash: A.hashPassword(pw), active: true, mustChange: true, createdAt: new Date().toISOString()
    };
    store.update(db => { db.users.push(u); store.audit(who, 'user-create', u.id); });
    return { user: directorView(u), password: pw };
  }

  /* ---------- فایل‌های ایستا ---------- */
  function serveFile(req, res, file, extraHeaders = {}) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('پیدا نشد'); }
      const ext = path.extname(file).toLowerCase();
      const isHtml = ext === '.html';
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=604800',
        'Last-Modified': st.mtime.toUTCString(),
        ...extraHeaders
      };
      if (req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']) >= new Date(st.mtime.toUTCString())) { res.writeHead(304, headers); return res.end(); }
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      const st2 = fs.createReadStream(file);
      st2.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
      st2.pipe(res);
    });
  }
  function staticRoute(req, res, p) {
    const pub = cfg.PUBLIC_DIR;
    // فونت‌ها، نگاره‌ها و فایل‌های مشترک از هر مسیری
    const sh = p.match(/(?:^|\/)(fonts|motifs)\/([\w.\-]+)$/) || p.match(/(?:^|\/)shared\/([\w.\-]+)$/);
    if (sh) return serveFile(req, res, sh.length === 3 ? path.join(pub, 'shared', sh[1], sh[2]) : path.join(pub, 'shared', sh[1]));
    if (/(?:^|\/)(favicon\.svg|favicon\.ico|logo\.svg)$/.test(p)) return serveFile(req, res, path.join(pub, 'shared', p.endsWith('.ico') ? 'favicon.svg' : path.basename(p)));
    if (p === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('User-agent: *\nDisallow: /\n'); }
    if (p === '/admin') { res.writeHead(301, { Location: at('/admin/') }); return res.end(); }
    if (p === '/admin/' || p === '/admin/index.html') return serveFile(req, res, path.join(pub, 'admin', 'index.html'));
    if (p === '/admin/view/') { res.writeHead(301, { Location: at('/admin/view') + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '') }); return res.end(); }
    if (p === '/admin/view') return serveFile(req, res, path.join(pub, 'form', 'index.html'));
    if (p === '/' || p === '/index.html') return serveFile(req, res, path.join(pub, 'form', 'index.html'));
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('پیدا نشد');
  }

  /* ---------- دروازهٔ اصلی ---------- */
  async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // زیر مسیرِ دامنهٔ مشترک، HSTS را برای کل دامنه تعیین نمی‌کنیم
    if (cfg.COOKIE_SECURE && !BASE) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    let url;
    try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
    let p;
    try { p = decodeURIComponent(url.pathname).replace(/\/{2,}/g, '/'); } catch (e) { res.writeHead(400); return res.end(); }
    if (p.includes('..')) { res.writeHead(400); return res.end(); }
    // پیشوند مسیر: هم وقتی پروکسی آن را نگه می‌دارد و هم وقتی برمی‌دارد کار می‌کند
    if (BASE) {
      if (p === BASE) { res.writeHead(301, { Location: at('/') + url.search }); return res.end(); }
      if (p.startsWith(BASE + '/')) p = p.slice(BASE.length);
    }
    const host = String(req.headers.host || '').toLowerCase().split(':')[0];
    // دو دامنهٔ جدا (اختیاری)
    if (cfg.ADMIN_HOST && host === cfg.ADMIN_HOST && (p === '/' || p === '/index.html')) { res.writeHead(302, { Location: at('/admin/') }); return res.end(); }
    if (cfg.PUBLIC_HOST && host === cfg.PUBLIC_HOST && (p.startsWith('/admin') || p.startsWith('/api/admin'))) { res.writeHead(404); return res.end(); }
    // داشبورد زیر /admin/ است؛ درخواست‌های نسبی آن به /admin/api/... می‌رسد
    if (p.startsWith('/admin/api/')) p = p.slice('/admin'.length);
    if (p === '/healthz') return send(res, 200, { ok: true });
    if (p.startsWith('/api/')) {
      try { await api(req, res, p, url); } catch (e) {
        const status = e.status || 500;
        if (status >= 500) console.error('[api]', req.method, p, e);
        if (!res.headersSent) send(res, status, { error: status >= 500 ? 'خطای سرور؛ چند لحظهٔ دیگر دوباره تلاش کنید.' : e.message, ...(e.extra || {}) }, status === 429 ? { 'Retry-After': '60' } : {});
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    staticRoute(req, res, p);
  }
  // هیچ خطای پیش‌بینی‌نشده‌ای نباید سرور را از کار بیندازد
  return (req, res) => handler(req, res).catch(e => {
    console.error('[http]', req.method, req.url, e);
    try { if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); } res.end(); } catch (e2) { /* اتصال بسته شده */ }
  });
}

// محدودکنندهٔ ورود با تنظیمات
class RateLimiter2 extends A.RateLimiter {
  constructor(cfg) { super(cfg.LOGIN_MAX_ATTEMPTS, cfg.LOGIN_WINDOW_MIN * 60000); }
}

module.exports = { createApp, HttpError };
