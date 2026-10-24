'use strict';
/* نقطهٔ شروع: node server/index.js */
const http = require('http');
const cfg = require('./config');
const { Store } = require('./store');
const { createApp } = require('./app');

function start(overrides = {}) {
  const c = { ...cfg, ...overrides };
  const store = new Store(c.DATA_DIR, { keepHourly: c.BACKUP_KEEP_HOURLY, keepDaily: c.BACKUP_KEEP_DAILY });
  const server = http.createServer(createApp(c, store));
  server.headersTimeout = 30000;
  server.requestTimeout = 60000;
  return new Promise(resolve => server.listen(c.PORT, c.HOST, () => resolve({ server, store, port: server.address().port })));
}

if (require.main === module) {
  start().then(({ store, port }) => {
    const admins = store.get().users.filter(u => u.role === 'admin').length;
    console.log(`[harfeno] روی http://${cfg.HOST}:${port} آماده است · داده: ${cfg.DATA_DIR}`);
    if (!admins) console.log('[harfeno] هنوز مدیر کلی ساخته نشده. بسازید:  npm run create-admin -- <نام‌کاربری>');
  });
  const stop = sig => { console.log(`[harfeno] ${sig} دریافت شد؛ خروج.`); process.exit(0); };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

module.exports = { start };
