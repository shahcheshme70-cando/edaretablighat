#!/usr/bin/env bash
# Naghshe Hezar Mashal - one-command installer (Ubuntu / Debian)
#
# Private repo: clone first with your GitHub login, then run the script from the clone:
#   sudo git clone https://github.com/shahcheshme70-cando/edaretablighat.git /opt/harfeno
#   sudo bash /opt/harfeno/deploy/install.sh harf-no.ir --path /mashal
#
# Public repo (one line):
#   curl -fsSL https://raw.githubusercontent.com/shahcheshme70-cando/edaretablighat/main/deploy/install.sh | sudo bash -s -- mashal.example.ir
#
# Under a path of an existing site (e.g. https://harf-no.ir/mashal/):
#   ... | sudo bash -s -- harf-no.ir --path /mashal
#   The app runs on 127.0.0.1:PORT; the script prints the nginx "location" block to add to that site.
#
# Options (after the domain):
#   --email you@example.com   email for the Let's Encrypt certificate (optional)
#   --port 8080               internal port (default: first free port from 8080)
#   --no-ssl                  do not request a certificate (HTTP only, for testing)
#   --no-proxy                do not touch nginx; just run the app on 127.0.0.1:PORT
#   --path /mashal            serve under this path of an existing domain (implies --no-proxy, prints the block to add)
#
# Safe to run again: it updates the code, keeps .env and all data, and restarts the service.
set -euo pipefail

REPO="${HARFENO_REPO:-https://github.com/shahcheshme70-cando/edaretablighat.git}"
APP_DIR=/opt/harfeno
DATA_DIR=/var/lib/harfeno
SVC=harfeno
USER_NAME=harfeno

DOMAIN="${1:-}"; shift || true
EMAIL=""; PORT=""; SSL=1; PROXY=1; BASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --email) EMAIL="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --no-ssl) SSL=0; shift ;;
    --no-proxy) PROXY=0; shift ;;
    --path) BASE="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX  %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (sudo)."
[ -n "$DOMAIN" ] || die "Usage: install.sh <domain> [--email ..] [--port ..] [--no-ssl] [--no-proxy]"
echo "$DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' || die "Domain looks wrong: $DOMAIN"
if [ -n "$BASE" ]; then
  BASE="/${BASE#/}"; BASE="${BASE%/}"
  [ "$BASE" = "/" ] && BASE=""
  PROXY=0
fi
command -v apt-get >/dev/null || die "This script supports Ubuntu/Debian (apt). See docs/DEPLOY.md for other systems."
command -v systemctl >/dev/null || die "systemd is required. Use Docker instead (see docs/DEPLOY.md)."

port_busy() { (ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null) | awk '{print $4}' | grep -Eq "[:.]$1\$"; }

# ---------- 1. packages ----------
say "Checking packages"
NEED=""
command -v git  >/dev/null || NEED="$NEED git"
command -v curl >/dev/null || NEED="$NEED curl"
[ -n "$NEED" ] && { apt-get update -y; apt-get install -y $NEED; }

node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; }
if ! node_ok; then
  say "Installing Node.js 20"
  if curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh; then
    bash /tmp/nodesource_setup.sh && apt-get install -y nodejs
  else
    warn "NodeSource is not reachable; trying the distribution package"
    apt-get update -y && apt-get install -y nodejs
  fi
  node_ok || die "Node.js 20+ could not be installed. Install it manually (any mirror works) and run this script again."
fi
NODE_BIN="$(command -v node)"
echo "node $(node --version) at $NODE_BIN"

# ---------- 2. user, folders, code ----------
say "Getting the code"
id "$USER_NAME" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$USER_NAME"
mkdir -p "$DATA_DIR"
chown "$USER_NAME:$USER_NAME" "$DATA_DIR"; chmod 700 "$DATA_DIR"
if [ -d "$APP_DIR/.git" ]; then
  # مخزن خصوصی: اگر گرفتن نسخهٔ تازه نشد (نیاز به رمز گیت‌هاب)، با همان کدی که هست ادامه می‌دهیم
  git -C "$APP_DIR" pull --ff-only || warn "Could not update from GitHub (private repo needs a login/token). Continuing with the code already in $APP_DIR."
else
  [ -e "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ] && die "$APP_DIR exists and is not a git checkout. Move it away first."
  git clone --depth 1 "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

say "Running tests"
npm test >/tmp/harfeno-test.log 2>&1 || { tail -40 /tmp/harfeno-test.log; die "Tests failed; nothing was changed in the running service."; }
grep -E '^# (pass|fail)' /tmp/harfeno-test.log || true

# ---------- 3. settings ----------
if [ -f "$APP_DIR/.env" ]; then
  say "Keeping existing .env"
  PORT="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"; PORT="${PORT:-8080}"
else
  if [ -z "$PORT" ]; then PORT=8080; while port_busy "$PORT"; do PORT=$((PORT+1)); done; fi
  SECURE=1; [ "$SSL" -eq 0 ] && SECURE=0
  SCHEME=https; [ "$SSL" -eq 0 ] && SCHEME=http
  say "Writing .env (port $PORT)"
  sed -e "s|^PORT=.*|PORT=$PORT|" \
      -e "s|^DATA_DIR=.*|DATA_DIR=$DATA_DIR|" \
      -e "s|^COOKIE_SECURE=.*|COOKIE_SECURE=$SECURE|" \
      -e "s|^TRUST_PROXY=.*|TRUST_PROXY=1|" \
      -e "s|^PUBLIC_URL=.*|PUBLIC_URL=$SCHEME://$DOMAIN$BASE/|" \
      .env.example > .env
  [ -n "$BASE" ] && printf '\n# served under a path of %s\nBASE_PATH=%s\n' "$DOMAIN" "$BASE" >> .env
fi
chown root:"$USER_NAME" .env; chmod 640 .env

# ---------- 4. service ----------
say "Installing the service"
sed -e "s|^ExecStart=.*|ExecStart=$NODE_BIN server/index.js|" deploy/harfeno.service > /etc/systemd/system/$SVC.service
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1
systemctl restart "$SVC"
for _ in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null || { journalctl -u "$SVC" -n 40 --no-pager; die "The service did not start."; }
echo "service is up on 127.0.0.1:$PORT"

# ---------- 5. nginx + HTTPS ----------
URL="http://127.0.0.1:$PORT/"
if [ "$PROXY" -eq 1 ]; then
  if ! command -v nginx >/dev/null; then
    if port_busy 80; then
      warn "Port 80 is used by another web server (not nginx). Point $DOMAIN to 127.0.0.1:$PORT in that server and rerun with --no-proxy if needed."
      PROXY=0
    else
      say "Installing nginx"; apt-get install -y nginx
    fi
  fi
fi
if [ "$PROXY" -eq 1 ]; then
  say "Configuring nginx for $DOMAIN"
  CONF=/etc/nginx/sites-available/harfeno
  [ -d /etc/nginx/sites-available ] || { mkdir -p /etc/nginx/conf.d; CONF=/etc/nginx/conf.d/harfeno.conf; }
  if [ ! -f "$CONF" ] || ! grep -q "ssl_certificate" "$CONF"; then
    cat > "$CONF" <<NGINX
# Naghshe Hezar Mashal (written by deploy/install.sh)
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 5m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 240s;
    }
}
NGINX
  fi
  [ -d /etc/nginx/sites-enabled ] && ln -sf "$CONF" /etc/nginx/sites-enabled/harfeno
  nginx -t && systemctl reload nginx
  URL="http://$DOMAIN/"
  if [ "$SSL" -eq 1 ]; then
    if ! grep -q "ssl_certificate" "$CONF"; then
      say "Requesting HTTPS certificate"
      command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx || true
      if [ -n "$EMAIL" ]; then CB_MAIL=(-m "$EMAIL"); else CB_MAIL=(--register-unsafely-without-email); fi
      if command -v certbot >/dev/null && certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${CB_MAIL[@]}"; then
        URL="https://$DOMAIN/"
      else
        warn "Could not get a certificate (DNS not pointing here yet, or no internet)."
        warn "The site works on HTTP for now, but logins need HTTPS. Fix DNS and run:"
        warn "  certbot --nginx -d $DOMAIN    (then nothing else to change)"
        warn "Or, to test on plain HTTP, set COOKIE_SECURE=0 in $APP_DIR/.env and: systemctl restart $SVC"
      fi
    else
      URL="https://$DOMAIN/"
    fi
  fi
fi

if [ -n "$BASE" ]; then
  URL="https://$DOMAIN$BASE/"; [ "$SSL" -eq 0 ] && URL="http://$DOMAIN$BASE/"
  SNIP=/etc/nginx/snippets/harfeno.conf
  BLOCK="# Naghshe Hezar Mashal under $BASE (written by deploy/install.sh)
location = $BASE { return 301 $BASE/; }
location $BASE/ {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 240s;
    client_max_body_size 5m;
}"
  if [ -d /etc/nginx ]; then mkdir -p /etc/nginx/snippets; printf '%s\n' "$BLOCK" > "$SNIP"; fi
  say "One manual step: route $DOMAIN$BASE/ to this app"
  if [ -d /etc/nginx ]; then
    echo "  Saved as $SNIP. Inside the 'server { ... }' block that serves $DOMAIN (port 443), add:"
    echo "      include snippets/harfeno.conf;"
    echo "  then: nginx -t && systemctl reload nginx"
  else
    echo "  Add this to the web server that serves $DOMAIN:"
  fi
  echo; printf '%s\n' "$BLOCK" | sed 's/^/      /'; echo
  echo "  If $DOMAIN is served by another tool (Bargozar, Caddy, a panel), make $BASE/ a reverse proxy to http://127.0.0.1:$PORT"
  echo "  keeping the full path. Check: curl -I https://$DOMAIN$BASE/   -> 200"
fi

# ---------- 6. staff account ----------
ADMIN_OUT=""
if ! runuser -u "$USER_NAME" -- "$NODE_BIN" server/cli.js list 2>/dev/null | grep -q '^ستاد'; then
  say "Creating the staff (ستاد) account"
  ADMIN_OUT="$(runuser -u "$USER_NAME" -- "$NODE_BIN" server/cli.js create-admin admin --name "ستاد")"
fi

# ---------- done ----------
say "Done"
cat <<DONE
  Directors' site : $URL
  Staff dashboard : ${URL}admin/
  Service         : systemctl status $SVC   |  logs: journalctl -u $SVC -f
  Data + backups  : $DATA_DIR   (add this folder to the nightly server backup)
  Update later    : run this same command again
DONE
if [ -n "$ADMIN_OUT" ]; then
  echo
  echo "$ADMIN_OUT"
  echo "  ^ Staff login. It is shown only once; send it to the project owner."
fi
