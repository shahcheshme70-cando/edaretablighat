# راهنمای استقرار روی سرور

این راهنما برای تیم فنی است. برنامه فقط به **Node.js نسخهٔ ۲۰ یا بالاتر** نیاز دارد. هیچ بستهٔ npm، پایگاه داده یا سرویس بیرونی لازم نیست؛ همه‌چیز در یک فایل JSON با پشتیبان خودکار نگه داشته می‌شود.

## نصب با یک دستور (پیشنهادی)

روی سرور اوبونتو یا دبیان، پس از اینکه دامنه به IP سرور اشاره کرد:

```bash
curl -fsSL https://raw.githubusercontent.com/shahcheshme70-cando/edaretablighat/main/deploy/install.sh | sudo bash -s -- mashal.example.ir --email you@example.ir
```

اسکریپت `deploy/install.sh` این کارها را خودش انجام می‌دهد:
- نصب Node.js 20 اگر نباشد؛
- ساختن کاربر سرویس و پوشهٔ داده (`/var/lib/harfeno`)؛
- گرفتن کد در `/opt/harfeno` و اجرای آزمون‌ها؛
- ساختن `.env`، سرویس systemd و پیکربندی nginx؛
- گرفتن گواهی HTTPS با certbot؛
- ساختن حساب ستاد و چاپ یک‌بارهٔ رمز آن.

اگر پورت ۸۰۸۰ گرفته باشد، اولین پورت آزاد را برمی‌دارد. اگر روی پورت ۸۰ وب‌سرور دیگری جز nginx باشد، به nginx دست نمی‌زند و می‌گوید دامنه را به کدام پورت وصل کنید.

برای **به‌روزرسانی**، همان دستور را دوباره بزنید. کد به‌روز می‌شود و `.env` و همهٔ داده‌ها می‌مانند.

گزینه‌ها: `--port 8090`، `--no-ssl` (فقط برای آزمون روی HTTP)، `--no-proxy` (فقط اجرای برنامه، بدون دست زدن به nginx).

اگر نصب دستی یا Docker را ترجیح می‌دهید، دو راه دیگر این‌هاست: **الف) systemd + nginx** یا **ب) Docker**.

---

## الف) استقرار با systemd و nginx (اوبونتو یا دبیان)

### ۱. نصب Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
node --version   # باید v20 یا بالاتر باشد
```

اگر سرور به اینترنت خارجی دسترسی ندارد، فایل باینری Node 20 را از آینهٔ داخلی بگیرید؛ برنامه به هیچ چیز دیگری وابسته نیست.

### ۲. کاربر، پوشه‌ها و کد

```bash
sudo useradd --system --home /opt/harfeno --shell /usr/sbin/nologin harfeno
sudo mkdir -p /opt/harfeno /var/lib/harfeno
sudo git clone https://github.com/shahcheshme70-cando/edaretablighat.git /opt/harfeno
sudo chown -R harfeno:harfeno /var/lib/harfeno
sudo chmod 700 /var/lib/harfeno
```

### ۳. تنظیمات

```bash
sudo cp /opt/harfeno/.env.example /opt/harfeno/.env
sudo nano /opt/harfeno/.env
```

کمینهٔ لازم:

| متغیر | مقدار |
|---|---|
| `DATA_DIR` | `/var/lib/harfeno` |
| `COOKIE_SECURE` | `1` (پشت HTTPS) |
| `TRUST_PROXY` | `1` (پشت nginx) |
| `PUBLIC_URL` | نشانی سایت مدیران، مثلاً `https://bom.example.ir/` |

### ۴. آزمون‌ها (اختیاری ولی پیشنهادی)

```bash
cd /opt/harfeno && npm test
```

باید همهٔ آزمون‌ها `ok` باشند.

### ۵. سرویس systemd

```bash
sudo cp /opt/harfeno/deploy/harfeno.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now harfeno
sudo systemctl status harfeno
curl http://127.0.0.1:8080/healthz      # {"ok":true}
```

### ۶. nginx و HTTPS

```bash
sudo cp /opt/harfeno/deploy/nginx.conf /etc/nginx/sites-available/harfeno
sudo nano /etc/nginx/sites-available/harfeno     # دامنه و مسیر گواهی را عوض کنید
sudo ln -s /etc/nginx/sites-available/harfeno /etc/nginx/sites-enabled/
sudo certbot --nginx -d bom.example.ir           # یا گواهی سازمانی
sudo nginx -t && sudo systemctl reload nginx
```

### ۷. ساختن حساب ستاد

```bash
cd /opt/harfeno
sudo -u harfeno env $(grep -v '^#' .env | xargs) node server/cli.js create-admin admin --name "معاونت فرهنگی"
```

رمز تصادفی قوی یک بار چاپ می‌شود. آن را به کاربر ستاد بدهید. داشبورد روی `https://دامنه/admin/` است.

### ۸. تعریف مدیران شهرستان‌ها

سه راه هست:

- **از داشبورد** (پیشنهادی): بخش «مدیران و رمزها». یک‌به‌یک یا گروهی از اکسل.
- **از خط فرمان، گروهی**: فایل CSV با ستون‌های `نام,موبایل,شهرستان,استان,سمت` (نمونه: `deploy/directors-sample.csv`):

  ```bash
  sudo -u harfeno env $(grep -v '^#' .env | xargs) node server/cli.js import-directors /path/list.csv
  ```

  رمزها در `list-passwords.csv` کنار همان فایل ذخیره می‌شوند. پس از ارسال رمزها، آن فایل را پاک کنید.
- **از خط فرمان، تکی**:

  ```bash
  sudo -u harfeno env $(grep -v '^#' .env | xargs) node server/cli.js add-director --phone 09150000000 --name "نام" --county "نیشابور"
  ```

### ۹. حساب مدیرکل (فقط دیدن)

از داشبورد ستاد، بخش «مدیران و رمزها» ← «حساب‌های مدیرکل»؛ یا از خط فرمان:

```bash
sudo -u harfeno env $(grep -v '^#' .env | xargs) node server/cli.js add-viewer --phone 09150000000 --name "نام" --province "خراسان رضوی"
```

مدیرکل روی همان `https://دامنه/admin/` با شمارهٔ همراه وارد می‌شود. اگر مسیر `/admin/` را در nginx به IP شبکهٔ اداره محدود کرده‌اید، یادتان باشد مدیرکل هم از همان شبکه وارد شود یا IP او را اضافه کنید.

ابزار خط فرمان را می‌شود در حالی اجرا کرد که سرویس روشن است. سرور تغییر فایل را خودش می‌بیند.

---

## ب) استقرار با Docker

```bash
git clone https://github.com/shahcheshme70-cando/edaretablighat.git harfeno && cd harfeno
cp .env.example .env && nano .env        # COOKIE_SECURE=1 ، TRUST_PROXY=1 ، PUBLIC_URL
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
docker compose exec harfeno node server/cli.js create-admin admin
```

برنامه روی `127.0.0.1:8080` بالا می‌آید. nginx را مثل بخش «الف ۶» جلوی آن بگذارید. داده در پوشهٔ `./data` می‌ماند.

---

## پشتیبان‌گیری و بازیابی

- **داده:** همهٔ داده در `DATA_DIR/db.json` است. هر نوشتن اتمی است، یعنی قطع برق فایل را خراب نمی‌کند.
- **پشتیبان خودکار:** برنامه هر ساعت یک نسخه در `DATA_DIR/backups/` نگه می‌دارد: ۷۲ نسخهٔ ساعتی و ۶۰ نسخهٔ روزانه.
- **فایل خراب:** اگر `db.json` به هر دلیلی خراب شود، برنامه هنگام شروع خودش آخرین پشتیبان سالم را بار می‌کند و نسخهٔ خراب را با پسوند `.corrupt-…` نگه می‌دارد.
- **پشتیبان بیرون از سرور:** پوشهٔ `DATA_DIR` را در پشتیبان‌گیری شبانهٔ سرور بگذارید، مثلاً:

  ```bash
  0 3 * * * tar czf /backup/harfeno-$(date +\%F).tgz -C /var/lib harfeno
  ```

- **بازیابی دستی:** سرویس را متوقف کنید، فایل پشتیبان دلخواه را جای `db.json` بگذارید و سرویس را روشن کنید.

## به‌روزرسانی

```bash
cd /opt/harfeno && sudo git pull && npm test && sudo systemctl restart harfeno
```

داده‌ها دست نمی‌خورند.

## امنیت

- رمزها با scrypt هش می‌شوند. فقط هش توکن نشست ذخیره می‌شود.
- کوکی‌ها `HttpOnly` و `SameSite=Lax` هستند و با `COOKIE_SECURE=1` حالت `Secure` هم می‌گیرند.
- برای تلاش ناموفق ورود محدودیت هست؛ بر پایهٔ IP و شماره، به‌طور پیش‌فرض ۸ بار در ۱۵ دقیقه.
- درخواست‌های تغییردهنده از دامنهٔ دیگر رد می‌شوند. سرآیندهای CSP و `X-Frame-Options` هم فعال‌اند.
- نشست ستاد پس از ۲ ساعت بی‌کاری بسته می‌شود.
- رمز تازه یا غیرفعال کردن یک مدیر، همهٔ نشست‌های او را می‌بندد.
- پیشنهاد: مسیر `/admin/` را در nginx به IP شبکهٔ اداره محدود کنید (نمونه در `deploy/nginx.conf`).
- پوشهٔ داده فقط برای کاربر سرویس خواندنی است (`chmod 700`).

## تحلیل خودکار با Claude (اختیاری)

- **پیش‌فرض:** ستاد «بستهٔ تحلیل» را از داشبورد دانلود می‌کند، در claude.ai به Claude می‌دهد و خروجی را در داشبورد بارگذاری می‌کند. این مسیر به هیچ دسترسی شبکه‌ای از سرور نیاز ندارد.
- **خودکار:** اگر سرور به `api.anthropic.com` دسترسی دارد، `ANTHROPIC_API_KEY` را در `.env` بگذارید و سرویس را دوباره راه‌اندازی کنید. دکمهٔ «پیش‌نویس با Claude» در داشبورد ظاهر می‌شود.
- **انتشار:** خروجی هر دو مسیر اول پیش‌نویس است و تا ستاد منتشرش نکند، به مدیر شهرستان نمی‌رسد.

## عیب‌یابی

| نشانه | راه‌حل |
|---|---|
| `curl /healthz` جواب نمی‌دهد | `journalctl -u harfeno -n 100` |
| ورود انجام می‌شود ولی دوباره صفحهٔ ورود می‌آید | پشت HTTP هستید و `COOKIE_SECURE=1` است؛ HTTPS را راه بیندازید یا موقتاً `0` کنید |
| همه «تلاش‌ها زیاد بود» می‌گیرند | `TRUST_PROXY=1` تنظیم نشده و همه با IP خود nginx دیده می‌شوند |
| رمز حساب ستاد فراموش شده | `node server/cli.js admin-password admin` |
| رمز مدیرکل فراموش شده | از داشبورد «رمز تازه»، یا `node server/cli.js reset-viewer 0915...` |
| `EACCES` روی پوشهٔ داده | مالک `DATA_DIR` باید کاربر سرویس باشد |
