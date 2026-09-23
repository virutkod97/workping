#!/usr/bin/env bash
# ============================================================================
#  WorkPing — cài đặt / nâng cấp 1 lệnh trên Ubuntu 22.04 / 24.04 (không Docker)
#
#  Chạy từ thư mục mã nguồn đã tải về:
#     sudo bash deploy/install.sh                                   # truy cập bằng IP, HTTP
#     sudo bash deploy/install.sh --domain workping.congty.vn --email it@congty.vn   # có HTTPS
#     sudo bash deploy/install.sh --domain workping.congty.vn --email it@congty.vn --https-port 8443
#
#  Chạy lại bất cứ lúc nào để NÂNG CẤP: giữ nguyên dữ liệu, mật khẩu, cấu hình
#  (tên miền, cổng, HTTPS lần trước được nhớ trong /etc/workping/install.conf).
# ============================================================================
set -Eeuo pipefail

# ----------------------------- Tham số mặc định -----------------------------
APP_NAME=workping
APP_USER=workping
APP_DIR=/opt/workping
CONF_DIR=/etc/workping
ENV_FILE=$CONF_DIR/workping.env
BACKUP_DIR=/var/backups/workping
PORT=4000
DOMAIN=""
EMAIL=""
NODE_MAJOR=22
TZ_NAME="Asia/Ho_Chi_Minh"
SKIP_NGINX=0
HTTPS_PORT=443
SSL_CERT=""
SSL_KEY=""
INSTALL_CONF=$CONF_DIR/install.conf
ACME_ROOT=/var/www/letsencrypt

# Nhớ lựa chọn của lần cài trước → chạy lại / update.sh không cần gõ lại tham số
[[ -f "$ENV_FILE" ]] && PORT=$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 || echo 4000)
if [[ -f "$INSTALL_CONF" ]]; then
  # shellcheck source=/dev/null
  . "$INSTALL_CONF"
elif [[ -f /etc/nginx/sites-available/workping ]]; then
  # Bản cài cũ (chưa có install.conf): lấy lại tên miền từ cấu hình nginx
  _sn=$(awk '/server_name/ {gsub(";","",$2); print $2; exit}' /etc/nginx/sites-available/workping)
  [[ -n "$_sn" && "$_sn" != "_" ]] && DOMAIN=$_sn
fi

usage() {
  cat <<USAGE
Cách dùng: sudo bash deploy/install.sh [tuỳ chọn]

  --domain <tên-miền>     Tên miền trỏ về máy chủ (bật HTTPS nếu có --email)
  --email <email>         Email đăng ký chứng chỉ Let's Encrypt
  --https-port <số>       Cổng HTTPS công khai (mặc định 443), VD 8443
  --ssl-cert <file>       Dùng chứng chỉ có sẵn (fullchain .pem/.crt) thay cho Let's Encrypt
  --ssl-key <file>        Khoá riêng của chứng chỉ trên
  --port <số>             Cổng nội bộ của API (mặc định 4000)
  --no-nginx              Không cài/cấu hình nginx (tự dùng reverse proxy khác)
  -h, --help              Hiện hướng dẫn này
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --firebase) warn "Không còn dùng Firebase (thông báo đẩy dùng Web Push) — bỏ qua $2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --https-port) HTTPS_PORT="$2"; shift 2 ;;
    --ssl-cert) SSL_CERT="$2"; shift 2 ;;
    --ssl-key) SSL_KEY="$2"; shift 2 ;;
    --no-nginx) SKIP_NGINX=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Tuỳ chọn không hợp lệ: $1"; usage; exit 1 ;;
  esac
done

# ------------------------------- Tiện ích in -------------------------------
C_OK=$'\e[32m'; C_WARN=$'\e[33m'; C_ERR=$'\e[31m'; C_B=$'\e[1m'; C_0=$'\e[0m'
step() { echo; echo "${C_B}==> $*${C_0}"; }
ok()   { echo "${C_OK}✔${C_0} $*"; }
warn() { echo "${C_WARN}!${C_0} $*"; }
die()  { echo "${C_ERR}✘ $*${C_0}" >&2; exit 1; }
trap 'die "Lỗi ở dòng $LINENO: $BASH_COMMAND"' ERR

# Giữ các biến proxy (máy chủ trong mạng nội bộ đi Internet qua proxy) khi chạy bằng user dịch vụ
PROXY_VARS=HTTP_PROXY,HTTPS_PROXY,NO_PROXY,http_proxy,https_proxy,no_proxy,npm_config_proxy,npm_config_https_proxy,npm_config_noproxy,npm_config_registry,NODE_EXTRA_CA_CERTS
as_app() { sudo -u "$APP_USER" -H --preserve-env="$PROXY_VARS" env PATH="/usr/bin:/bin:$PATH" "$@"; }
rand() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "${1:-32}" || true; }
is_ip() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; }

# ------------------------------- Kiểm tra --------------------------------
[[ $EUID -eq 0 ]] || die "Cần chạy bằng quyền root: sudo bash deploy/install.sh"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[[ -f "$SRC_DIR/backend/package.json" && -f "$SRC_DIR/web/package.json" ]] || die "Không thấy mã nguồn tại $SRC_DIR"
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || warn "Script được viết cho Ubuntu, hệ điều hành hiện tại: ${PRETTY_NAME:-?}"
FIRST_INSTALL=0; [[ -f "$ENV_FILE" ]] || FIRST_INSTALL=1
[[ "$HTTPS_PORT" =~ ^[0-9]+$ && $HTTPS_PORT -ge 1 && $HTTPS_PORT -le 65535 ]] || die "--https-port không hợp lệ: $HTTPS_PORT"
[[ "$HTTPS_PORT" != "80" && "$HTTPS_PORT" != "$PORT" ]] || die "--https-port phải khác 80 và khác cổng nội bộ $PORT"
if [[ -n "$SSL_CERT$SSL_KEY" ]]; then
  [[ -f "$SSL_CERT" && -f "$SSL_KEY" ]] || die "Không thấy file chứng chỉ/khoá: --ssl-cert '$SSL_CERT' --ssl-key '$SSL_KEY'"
  SSL_CERT=$(readlink -f "$SSL_CERT"); SSL_KEY=$(readlink -f "$SSL_KEY")
fi
# Cách lấy chứng chỉ: own = file có sẵn, le = Let's Encrypt, rỗng = chỉ HTTP
TLS_MODE=""
if [[ $SKIP_NGINX == 0 ]]; then
  if [[ -n "$SSL_CERT" ]]; then TLS_MODE=own
  elif [[ -n "$DOMAIN" ]] && ! is_ip "$DOMAIN" && [[ -n "$EMAIL" || -d /etc/letsencrypt/live/$DOMAIN ]]; then TLS_MODE=le; fi
fi
HTTPS_SUFFIX=""; [[ "$HTTPS_PORT" == 443 ]] || HTTPS_SUFFIX=":$HTTPS_PORT"
if [[ -n "$EMAIL" ]]; then VAPID_SUBJECT="mailto:$EMAIL"
elif [[ -n "$DOMAIN" ]] && ! is_ip "$DOMAIN"; then VAPID_SUBJECT="https://$DOMAIN"
else VAPID_SUBJECT="mailto:admin@example.com"; fi

echo "${C_B}WorkPing — $([[ $FIRST_INSTALL == 1 ]] && echo 'CÀI ĐẶT MỚI' || echo 'NÂNG CẤP')${C_0}"
echo "  Mã nguồn : $SRC_DIR"
echo "  Cài vào  : $APP_DIR"
echo "  Tên miền : ${DOMAIN:-(không — truy cập bằng IP)}"
[[ -n "$TLS_MODE" ]] && echo "  HTTPS    : cổng $HTTPS_PORT ($([[ $TLS_MODE == own ]] && echo "chứng chỉ có sẵn" || echo "Let's Encrypt"))"

# ------------------------------ 1. Gói hệ thống ------------------------------
step "1/9 Cài gói hệ thống"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq || warn "apt-get update báo lỗi ở một số kho phần mềm — vẫn tiếp tục"
PKGS=(ca-certificates curl gnupg rsync postgresql postgresql-contrib openssl tzdata)
[[ $SKIP_NGINX == 1 ]] || PKGS+=(nginx)
[[ "$TLS_MODE" == le ]] && PKGS+=(certbot)
apt-get install -y -qq "${PKGS[@]}" >/dev/null
ok "Đã cài: ${PKGS[*]}"
# Đồng hồ lệch → Apple từ chối thông báo đẩy (BadJwtToken): bật đồng bộ giờ tự động
timedatectl set-ntp true 2>/dev/null || true
if [[ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" == "no" ]]; then
  warn "Đồng hồ máy chủ chưa đồng bộ NTP (có thể bị chặn UDP 123) — giờ hiện tại: $(date '+%d/%m/%Y %H:%M:%S')"
fi

# ------------------------------ 2. Node.js ------------------------------
step "2/9 Node.js $NODE_MAJOR"
# Dùng Node hệ thống (/usr/bin/node) để dịch vụ systemd và bước build dùng cùng một phiên bản
CUR_NODE=$(/usr/bin/node -v 2>/dev/null | sed 's/^v//; s/\..*//' || true)
install_node_tarball() {
  # Dự phòng khi không truy cập được kho NodeSource: tải bản chính thức từ nodejs.org
  local arch ver
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) die "Kiến trúc CPU không hỗ trợ: $(uname -m)" ;; esac
  ver=$(curl -fsSL https://nodejs.org/dist/index.json | grep -o "\"version\":\"v${NODE_MAJOR}\.[0-9.]*\"" | head -1 | cut -d'"' -f4)
  [[ -n "$ver" ]] || die "Không lấy được phiên bản Node.js từ nodejs.org"
  rm -rf /usr/local/lib/nodejs && mkdir -p /usr/local/lib/nodejs
  curl -fsSL "https://nodejs.org/dist/$ver/node-$ver-linux-$arch.tar.xz" | tar -xJ -C /usr/local/lib/nodejs --strip-components=1
  for b in node npm npx; do ln -sf /usr/local/lib/nodejs/bin/$b /usr/bin/$b; done
}
if [[ "${CUR_NODE:-0}" -lt 20 ]]; then
  if curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh && bash /tmp/nodesource_setup.sh >/dev/null 2>&1 \
     && apt-get install -y -qq nodejs >/dev/null; then
    ok "Đã cài Node.js từ NodeSource"
  else
    warn "Không dùng được kho NodeSource — cài Node.js từ nodejs.org"
    apt-get install -y -qq xz-utils >/dev/null
    install_node_tarball
  fi
  rm -f /tmp/nodesource_setup.sh
fi
[[ -x /usr/bin/node ]] || die "Không cài được Node.js vào /usr/bin/node"
ok "Node $(/usr/bin/node -v), npm $(/usr/bin/npm -v)"

# ------------------------------ 3. Người dùng & thư mục ------------------------------
step "3/9 Tài khoản hệ thống & thư mục"
id "$APP_USER" &>/dev/null || useradd --system --home-dir /var/lib/$APP_NAME --create-home --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$APP_DIR"
install -d -o root -g "$APP_USER" -m 750 "$CONF_DIR"
install -d -o postgres -g postgres -m 750 "$BACKUP_DIR"
ok "User $APP_USER, thư mục $APP_DIR, cấu hình $CONF_DIR"

# ------------------------------ 4. PostgreSQL ------------------------------
step "4/9 PostgreSQL"
systemctl enable --now postgresql >/dev/null 2>&1 || service postgresql start >/dev/null
for _ in {1..20}; do sudo -u postgres psql -qtAc 'select 1' &>/dev/null && break; sleep 1; done
if [[ $FIRST_INSTALL == 1 ]]; then
  DB_PASS=$(rand 24)
  if sudo -u postgres psql -qtAc "select 1 from pg_roles where rolname='$APP_NAME'" | grep -q 1; then
    sudo -u postgres psql -qc "alter role $APP_NAME with login password '$DB_PASS'"
  else
    sudo -u postgres psql -qc "create role $APP_NAME with login password '$DB_PASS'"
  fi
  sudo -u postgres psql -qtAc "select 1 from pg_database where datname='$APP_NAME'" | grep -q 1 \
    || sudo -u postgres psql -qc "create database $APP_NAME owner $APP_NAME encoding 'UTF8' template template0"
  ok "Đã tạo CSDL $APP_NAME"
else
  ok "Dùng CSDL hiện có (không thay đổi)"
fi

# ------------------------------ 5. File cấu hình ------------------------------
step "5/9 Cấu hình $ENV_FILE"
if [[ $FIRST_INSTALL == 1 ]]; then
  ADMIN_PASS=$(rand 12)
  umask 027
  cat >"$ENV_FILE" <<ENV
# Cấu hình WorkPing — sửa xong chạy: sudo systemctl restart $APP_NAME
# Giá trị có khoảng trắng phải đặt trong dấu ngoặc kép
NODE_ENV=production
PORT=$PORT
DATABASE_URL=postgresql://$APP_NAME:$DB_PASS@127.0.0.1:5432/$APP_NAME?schema=public
JWT_SECRET=$(rand 64)
JWT_EXPIRES_IN=30d
TZ_NAME=$TZ_NAME
WARN_DAYS=3
REMIND_DAYS=3,1,0
# Giờ gửi nhắc việc (cron): 8h sáng thứ 2 – thứ 7
REMINDER_CRON="0 8 * * 1-6"
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PASS
WEB_DIST=$APP_DIR/web/dist
# Thông báo đẩy Web Push: liên hệ quản trị (Apple yêu cầu mailto:/https: hợp lệ). Khoá VAPID tự sinh & lưu trong CSDL.
VAPID_SUBJECT=$VAPID_SUBJECT
ENV
  umask 022
  chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
  printf 'Tài khoản quản trị WorkPing\n  Tên đăng nhập: admin\n  Mật khẩu: %s\n(đổi ngay sau lần đăng nhập đầu tiên)\n' "$ADMIN_PASS" > "$CONF_DIR/admin-credentials.txt"
  chmod 600 "$CONF_DIR/admin-credentials.txt"
  ok "Đã tạo cấu hình với mật khẩu CSDL, JWT secret, mật khẩu admin ngẫu nhiên"
else
  # Cập nhật cổng nếu truyền --port khác
  sed -i "s/^PORT=.*/PORT=$PORT/" "$ENV_FILE"
  ok "Giữ nguyên cấu hình hiện có"
fi
PORT=$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2)
# Cập nhật liên hệ Web Push khi có email mới
if [[ -n "$EMAIL" ]]; then
  if grep -q '^VAPID_SUBJECT=' "$ENV_FILE"; then sed -i "s#^VAPID_SUBJECT=.*#VAPID_SUBJECT=mailto:$EMAIL#" "$ENV_FILE"
  else echo "VAPID_SUBJECT=mailto:$EMAIL" >> "$ENV_FILE"; fi
fi

cat >"$INSTALL_CONF" <<CONF
# Tham số cài đặt lần gần nhất (install.sh / update.sh tự đọc lại). Đổi bằng cách chạy lại install.sh với tham số mới.
DOMAIN="$DOMAIN"
EMAIL="$EMAIL"
HTTPS_PORT="$HTTPS_PORT"
SSL_CERT="$SSL_CERT"
SSL_KEY="$SSL_KEY"
SKIP_NGINX="$SKIP_NGINX"
CONF
chmod 640 "$INSTALL_CONF"

# ------------------------------ 6. Mã nguồn & build ------------------------------
step "6/9 Chép mã nguồn & build (vài phút)"
rsync -a --delete \
  --exclude '.git' --exclude 'node_modules' --exclude 'dist' --exclude 'mobile' \
  --exclude '.env' --exclude 'secrets' --exclude '*.log' \
  "$SRC_DIR"/ "$APP_DIR"/
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
( cd "$APP_DIR/web" && as_app npm ci --no-audit --no-fund --loglevel=error && as_app npm run build --silent >/dev/null )
ok "Đã build web"
( cd "$APP_DIR/backend" && as_app npm ci --no-audit --no-fund --loglevel=error && as_app npm run build --silent >/dev/null )
ok "Đã build API"

# ------------------------------ 7. CSDL: migrate + seed ------------------------------
step "7/9 Cập nhật cấu trúc CSDL"
# Chạy lệnh bằng user dịch vụ với biến môi trường từ file cấu hình
run_env() { ( cd "$APP_DIR/backend" && sudo -u "$APP_USER" -H bash -c 'set -a; . "$0"; set +a; PATH=/usr/bin:/bin:$PATH; exec "$@"' "$ENV_FILE" "$@" ); }
run_env npx prisma migrate deploy >/dev/null
run_env node dist/scripts/seed.js
ok "CSDL sẵn sàng"

# ------------------------------ 8. Dịch vụ systemd ------------------------------
step "8/9 Dịch vụ systemd"
sed -e "s#@APP_DIR@#$APP_DIR#g" -e "s#@APP_USER@#$APP_USER#g" -e "s#@ENV_FILE@#$ENV_FILE#g" -e "s#@TZ@#$TZ_NAME#g" \
  "$APP_DIR/deploy/workping.service" > /etc/systemd/system/$APP_NAME.service
# Sao lưu CSDL hằng ngày lúc 1h sáng, giữ 14 ngày
install -m 755 "$APP_DIR/deploy/backup.sh" /usr/local/bin/workping-backup
echo "0 1 * * * root /usr/local/bin/workping-backup >/dev/null 2>&1" > /etc/cron.d/workping-backup
systemctl daemon-reload
systemctl enable $APP_NAME >/dev/null 2>&1
systemctl restart $APP_NAME
for i in {1..30}; do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  [[ $i == 30 ]] && { journalctl -u $APP_NAME -n 40 --no-pager || true; die "Dịch vụ không khởi động được (xem log ở trên)"; }
  sleep 1
done
ok "Dịch vụ $APP_NAME đang chạy: $(curl -fsS "http://127.0.0.1:$PORT/api/health")"

# ------------------------------ 9. Nginx + HTTPS ------------------------------
step "9/9 Nginx"
SITE=/etc/nginx/sites-available/$APP_NAME
write_site() { # $1 = template, $2/$3 = cert/key
  sed -e "s#@SERVER_NAME@#${DOMAIN:-_}#g" -e "s#@PORT@#$PORT#g" -e "s#@HTTPS_PORT@#$HTTPS_PORT#g" \
      -e "s#@HTTPS_SUFFIX@#$HTTPS_SUFFIX#g" -e "s#@ACME_ROOT@#$ACME_ROOT#g" \
      -e "s#@SSL_CERT@#${2:-}#g" -e "s#@SSL_KEY@#${3:-}#g" "$APP_DIR/deploy/$1" > "$SITE"
  # Máy chủ tắt IPv6 → bỏ dòng listen [::]
  [[ -f /proc/net/if_inet6 ]] || sed -i '/listen \[::\]/d' "$SITE"
  nginx -t -q
  systemctl reload nginx 2>/dev/null || service nginx reload >/dev/null 2>&1 || service nginx start >/dev/null
}
if [[ $SKIP_NGINX == 1 ]]; then
  warn "Bỏ qua nginx — API/web lắng nghe tại 127.0.0.1:$PORT"
else
  install -d -m 755 "$ACME_ROOT"
  ln -sf "$SITE" /etc/nginx/sites-enabled/$APP_NAME
  [[ -z "$DOMAIN" ]] && rm -f /etc/nginx/sites-enabled/default
  systemctl enable --now nginx >/dev/null 2>&1 || true
  # Bước 1: cấu hình HTTP (có chỗ cho Let's Encrypt xác minh tên miền)
  write_site nginx.conf
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null; [[ -n "$TLS_MODE" ]] && ufw allow "$HTTPS_PORT"/tcp >/dev/null
    ok "Đã mở tường lửa (80$([[ -n "$TLS_MODE" ]] && echo "/$HTTPS_PORT"))"
  fi
  # Bước 2: chứng chỉ + cấu hình HTTPS
  CERT=""; KEY=""
  if [[ $TLS_MODE == own ]]; then
    CERT=$SSL_CERT; KEY=$SSL_KEY
  elif [[ $TLS_MODE == le ]]; then
    LE_ARGS=(certonly --webroot -w "$ACME_ROOT" -d "$DOMAIN" --agree-tos --non-interactive --keep-until-expiring
             --deploy-hook "systemctl reload nginx")
    if [[ -n "$EMAIL" ]]; then LE_ARGS+=(-m "$EMAIL"); else LE_ARGS+=(--register-unsafely-without-email); fi
    if certbot "${LE_ARGS[@]}"; then
      CERT=/etc/letsencrypt/live/$DOMAIN/fullchain.pem; KEY=/etc/letsencrypt/live/$DOMAIN/privkey.pem
    elif [[ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]]; then
      warn "Không gia hạn được chứng chỉ lúc này — tạm dùng chứng chỉ hiện có"
      CERT=/etc/letsencrypt/live/$DOMAIN/fullchain.pem; KEY=/etc/letsencrypt/live/$DOMAIN/privkey.pem
    else
      warn "Chưa lấy được chứng chỉ HTTPS. Let's Encrypt cần truy cập http://$DOMAIN (cổng 80) từ Internet."
      warn "Kiểm tra tên miền trỏ đúng IP và cổng 80 đã mở/NAT về máy chủ, rồi chạy lại script."
    fi
  fi
  if [[ -n "$CERT" ]]; then
    write_site nginx-ssl.conf "$CERT" "$KEY"
    ok "Đã bật HTTPS: https://$DOMAIN$HTTPS_SUFFIX$([[ $TLS_MODE == le ]] && echo " (tự gia hạn)")"
  else
    TLS_MODE=""
  fi
  ok "Nginx đã cấu hình"
fi

# Cho ứng dụng biết chứng chỉ để cảnh báo trên web khi sắp hết hạn
set_env() { # $1 = khoá, $2 = giá trị; trả về 0 nếu có thay đổi
  local cur; cur=$(grep -E "^$1=" "$ENV_FILE" | cut -d= -f2- || true)
  [[ "$cur" == "$2" ]] && return 1
  if grep -qE "^$1=" "$ENV_FILE"; then sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
ENV_CHANGED=0
set_env CERT_MODE "$TLS_MODE" && ENV_CHANGED=1
set_env PUBLIC_DOMAIN "$DOMAIN" && ENV_CHANGED=1
set_env HTTPS_PORT "$HTTPS_PORT" && ENV_CHANGED=1
# Có nginx phía trước → API chỉ nghe trên 127.0.0.1, không lộ cổng $PORT ra mạng
set_env HOST "$([[ $SKIP_NGINX == 1 ]] && echo 0.0.0.0 || echo 127.0.0.1)" && ENV_CHANGED=1
if [[ $ENV_CHANGED == 1 ]]; then systemctl restart $APP_NAME 2>/dev/null || true; fi

# ------------------------------ Kết quả ------------------------------
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [[ $SKIP_NGINX == 1 ]]; then URL="http://127.0.0.1:$PORT"
elif [[ -n "$TLS_MODE" ]]; then URL="https://${DOMAIN:-$(hostname -I | awk '{print $1}')}$HTTPS_SUFFIX"
else URL="http://${DOMAIN:-$IP}"; fi

echo
echo "${C_OK}${C_B}══════════════════ HOÀN TẤT ══════════════════${C_0}"
echo "  Địa chỉ web     : $URL"
echo "  API cho app     : $URL/api"
[[ $FIRST_INSTALL == 1 ]] && { echo; sed 's/^/  /' "$CONF_DIR/admin-credentials.txt"; echo "  (đã lưu tại $CONF_DIR/admin-credentials.txt)"; }
echo
echo "  Cấu hình        : $ENV_FILE"
echo "  Trạng thái      : sudo systemctl status $APP_NAME"
echo "  Xem log         : sudo journalctl -u $APP_NAME -f"
echo "  Sao lưu         : $BACKUP_DIR (tự động 1h sáng hằng ngày)"
if [[ "$URL" != https://* ]]; then
  echo
  echo "  ${C_WARN}${C_B}Lưu ý: điện thoại chỉ nhận thông báo đẩy khi truy cập bằng HTTPS.${C_0}"
  echo "  ${C_WARN}Chạy lại với --domain <tên-miền> --email <email> [--https-port <cổng>] để bật HTTPS.${C_0}"
fi
