# Triển khai WorkPing trên Ubuntu (chạy dạng service, không Docker)

Script `install.sh` tự làm toàn bộ: cài PostgreSQL, Node.js 22, nginx; tạo CSDL với mật khẩu ngẫu nhiên; build web + API; tạo dịch vụ **systemd** `workping` (tự khởi động cùng máy, tự chạy lại khi lỗi); cấu hình nginx (+ HTTPS nếu có tên miền); sao lưu CSDL hằng ngày.

Kiến trúc sau khi cài:

```
Trình duyệt / app trên MH chính ──HTTPS──▶ nginx :80/:443 ──▶ workping (Node.js, 127.0.0.1:4000) ──▶ PostgreSQL :5432
                                                                  └─ Web Push ──▶ Apple / Google push ──▶ iPhone / Android
```

| Thành phần | Vị trí |
|---|---|
| Mã chương trình | `/opt/workping` |
| Cấu hình (mật khẩu CSDL, JWT, lịch nhắc…) | `/etc/workping/workping.env` |
| Mật khẩu admin ban đầu | `/etc/workping/admin-credentials.txt` |
| Dịch vụ | `/etc/systemd/system/workping.service` |
| Nginx | `/etc/nginx/sites-available/workping` |
| Sao lưu CSDL (1h sáng, giữ 14 ngày) | `/var/backups/workping/` |

---

## Bước 0 – Chuẩn bị máy chủ

- Ubuntu Server **22.04** hoặc **24.04** (64-bit), tối thiểu 2 CPU / 2 GB RAM / 20 GB ổ đĩa.
- Có quyền `sudo` và máy chủ ra được Internet (tải gói apt, npm, Node.js). Nếu đi qua proxy, đặt trước: `export https_proxy=http://proxy:port http_proxy=http://proxy:port` rồi chạy script bằng `sudo -E`.
- Muốn có HTTPS (bắt buộc khi dùng app iOS ngoài mạng nội bộ): một **tên miền** đã trỏ bản ghi A về IP máy chủ, mở cổng **80** và **443** (hoặc một cổng HTTPS khác, xem [HTTPS cổng khác 443](#https-cổng-khác-443)).

## Bước 1 – Đưa mã nguồn lên máy chủ

Cách A – clone từ GitHub (repo private cần Personal Access Token):

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/virutkod97/workping.git
cd workping
```

Cách B – không dùng git: tải file zip của repo về máy tính, rồi:

```bash
scp workping.zip user@IP_MAY_CHU:~        # chạy trên máy tính của bạn
ssh user@IP_MAY_CHU
sudo apt-get install -y unzip && unzip workping.zip && cd workping*
```

## Bước 2 – Chạy cài đặt (1 lệnh)

**Khuyến nghị – có tên miền + HTTPS** (bắt buộc để điện thoại nhận thông báo đẩy; chứng chỉ Let's Encrypt tự gia hạn):

```bash
sudo bash deploy/install.sh --domain workping.congty.vn --email it@congty.vn
```

Chỉ thử nghiệm trong mạng nội bộ bằng IP (dùng được web, **không** có thông báo đẩy trên điện thoại):

```bash
sudo bash deploy/install.sh
```

Tất cả tuỳ chọn:

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `--domain <tên-miền>` | Tên miền của hệ thống |
| `--email <email>` | Kèm `--domain` để bật HTTPS; cũng dùng làm liên hệ cho dịch vụ Web Push |
| `--https-port <số>` | Cổng HTTPS công khai (mặc định 443), VD `8443` |
| `--ssl-cert <file>` `--ssl-key <file>` | Dùng chứng chỉ có sẵn (VD chứng chỉ wildcard của công ty) thay cho Let's Encrypt |
| `--port <số>` | Cổng nội bộ của API (mặc định 4000) |
| `--no-nginx` | Không cài nginx (khi đã có reverse proxy khác) |

Các tham số được nhớ trong `/etc/workping/install.conf`: lần sau chạy `update.sh` hoặc `install.sh` không cần gõ lại.

### HTTPS cổng khác 443

Dùng được với bất kỳ cổng nào, VD **8443**. Thông báo đẩy vẫn chạy bình thường, cả trên iPhone. Người dùng truy cập bằng `https://workping.congty.vn:8443`.

**Cách 1 – Let's Encrypt (miễn phí, tự gia hạn).** Cổng **80** vẫn phải mở từ Internet để Let's Encrypt xác minh tên miền (cổng 80 chỉ dùng để xác minh và chuyển hướng sang HTTPS):

```bash
sudo bash deploy/install.sh --domain workping.congty.vn --email it@congty.vn --https-port 8443
```

Mở / NAT trên tường lửa, router: `80 → máy chủ:80` và `8443 → máy chủ:8443`.

**Chỉ mở cổng 80 khi cần gia hạn.** Sau khi cài xong có thể đóng NAT cổng 80, lúc đó người dùng phải gõ đủ `https://…:8443`. Khi chứng chỉ còn ≤ 30 ngày, WorkPing tự cảnh báo cho Quản trị và Trưởng phòng: banner trên mọi trang, thông báo đẩy ở các mốc 30/14/7/3/1 ngày, và mục *Cấu hình → Chứng chỉ HTTPS*. Để gia hạn:

1. Mở lại NAT cổng 80 về máy chủ.
2. Chạy `sudo certbot renew` (hoặc để nguyên, certbot tự thử 2 lần/ngày).
3. Bấm **Kiểm tra lại** trên web. Hết cảnh báo nghĩa là đã gia hạn xong; đóng lại cổng 80.

Ngưỡng cảnh báo đổi được bằng `CERT_WARN_DAYS` trong `/etc/workping/workping.env`.

**Cách 2 – chứng chỉ có sẵn** (không cần cổng 80). Dùng khi cổng 80 bị chặn, hoặc công ty đã có chứng chỉ, VD `*.congty.vn`:

```bash
sudo bash deploy/install.sh --domain workping.congty.vn --https-port 8443 \
  --ssl-cert /etc/ssl/congty/fullchain.pem --ssl-key /etc/ssl/congty/privkey.pem
```

File `--ssl-cert` phải chứa **cả chuỗi chứng chỉ trung gian** (fullchain), nếu không iPhone/Android sẽ báo không an toàn. Khi chứng chỉ được thay mới, chép đè file cũ rồi chạy `sudo systemctl reload nginx`.

> Nếu chặn cả cổng 80 mà không có chứng chỉ sẵn: lấy chứng chỉ Let's Encrypt qua DNS bằng `sudo certbot certonly --manual --preferred-challenges dns -d workping.congty.vn` (thêm bản ghi TXT theo hướng dẫn hiện ra), rồi dùng Cách 2 với `/etc/letsencrypt/live/workping.congty.vn/fullchain.pem` và `privkey.pem`. Cách này **không tự gia hạn**, phải làm lại mỗi 90 ngày.

Mất khoảng 3–5 phút. Cuối cùng script in ra:

```
══════════════════ HOÀN TẤT ══════════════════
  Địa chỉ web     : https://workping.congty.vn
  Tài khoản quản trị WorkPing
    Tên đăng nhập: admin
    Mật khẩu: xxxxxxxxxxxx
```

## Bước 3 – Sau khi cài

1. Mở địa chỉ web, đăng nhập `admin` với mật khẩu ở trên → hệ thống bắt đổi mật khẩu.
2. **Cấu hình** → kiểm tra danh mục *Nhóm công việc* và *Bộ phận*.
3. **Nhân sự → Thêm nhân sự**: tạo lần lượt Trưởng phòng → các Phó trưởng phòng → nhân viên. Chọn **Chức danh** (Cấp tự đặt theo: *Trưởng phòng*, *Phó trưởng phòng* hoặc *Nhân viên*) và với nhân viên chọn **Nhóm / quản lý trực tiếp** = Phó trưởng phòng phụ trách. Kiểm tra ở *Sơ đồ nhóm*.
4. Báo cho mọi người: đăng nhập bằng **mã nhân sự viết thường** (vd `ns002`), mật khẩu tạm do hệ thống sinh (hiện ra **một lần** khi tạo nhân sự hoặc bấm 🔑 đặt lại mật khẩu), lần đầu đăng nhập bắt buộc đổi.
5. **Cài lên điện thoại** (mỗi người tự làm, không cần tài khoản nhà phát triển):
   - **iPhone** (iOS 16.4+): mở `https://workping.congty.vn` bằng **Safari** → nút **Chia sẻ** → **Thêm vào MH chính** → mở WorkPing **từ biểu tượng** → đăng nhập → **Cài app & thông báo** → **Bật thông báo** → *Cho phép*.
   - **Android**: mở bằng **Chrome** → menu **⋮** → **Thêm vào màn hình chính** (hoặc nút *Cài ứng dụng*) → đăng nhập → **Cài app & thông báo** → **Bật thông báo** → *Cho phép*.
6. Kiểm tra: trang **Cài app & thông báo** → **Gửi thông báo thử** — điện thoại phải hiện thông báo (kể cả khi đã đóng ứng dụng).

---

## Quản trị hằng ngày

| Việc | Lệnh |
|---|---|
| Xem trạng thái | `sudo systemctl status workping` |
| Xem log trực tiếp | `sudo journalctl -u workping -f` |
| Khởi động lại | `sudo systemctl restart workping` |
| Dừng / chạy | `sudo systemctl stop workping` / `sudo systemctl start workping` |
| Sửa cấu hình | `sudo nano /etc/workping/workping.env` rồi `sudo systemctl restart workping` |
| Gửi nhắc việc ngay | web → Cấu hình → *Gửi nhắc việc ngay* |

Các cấu hình hay chỉnh trong `workping.env`:

```ini
REMINDER_CRON="0 8 * * 1-6"   # giờ gửi nhắc việc (phút giờ ngày tháng thứ) — đặt trong ngoặc kép
WARN_DAYS=3                   # còn ≤ N ngày thì báo "Sắp đến hạn"
REMIND_DAYS=3,1,0             # nhắc riêng từng mốc khi còn 3, 1, 0 ngày
```


## Nâng cấp phiên bản mới

```bash
cd ~/workping
sudo bash deploy/update.sh        # git pull + sao lưu CSDL + build + migrate + restart
```

(Nếu dùng zip: giải nén bản mới đè lên thư mục cũ rồi chạy `sudo bash deploy/install.sh`.)
Nâng cấp **giữ nguyên** dữ liệu, mật khẩu và toàn bộ cấu hình trong `/etc/workping`.

## Sao lưu & khôi phục

- Tự động sao lưu lúc 1h sáng vào `/var/backups/workping/` (giữ 14 ngày). Sao lưu ngay: `sudo workping-backup`.
- Nên chép định kỳ thư mục này sang máy khác/NAS.
- Khôi phục:

```bash
ls -t /var/backups/workping/                 # chọn bản cần khôi phục
sudo bash deploy/restore.sh /var/backups/workping/workping-20260923-010000.dump
```

## Bảo mật khi public ra Internet

Những gì hệ thống đã tự làm:
- Sai mật khẩu 5 lần thì khoá tài khoản đó 15 phút. Một IP sai 20 lần thì chặn IP đó 15 phút.
- Không còn mật khẩu mặc định chung. Tạo nhân sự hoặc đặt lại mật khẩu (nút 🔑) sẽ sinh mật khẩu tạm ngẫu nhiên, chỉ hiện **một lần**. Người dùng phải đổi mật khẩu trước khi dùng được các chức năng khác.
- Mật khẩu mới tối thiểu 8 ký tự, có cả chữ và số. Đổi hoặc đặt lại mật khẩu sẽ đăng xuất mọi thiết bị khác.
- API chỉ nghe trên `127.0.0.1`, người dùng chỉ vào được qua nginx HTTPS.
- Có header bảo mật (CSP, HSTS, chống nhúng iframe) và nginx ẩn số phiên bản.

Việc quản trị cần làm:
1. Vào **Nhân sự**, xem cột *Tài khoản*. Ai có nhãn **MK tạm** là chưa đổi mật khẩu lần đầu, bấm 🔑 để cấp mật khẩu tạm mới rồi chuyển riêng cho họ.
2. Sau khi admin đã đổi mật khẩu: `sudo rm /etc/workping/admin-credentials.txt`.
3. Chỉ NAT cổng HTTPS (VD 8888). **Không** NAT cổng 22 (SSH), 5432 (PostgreSQL), 4000 (API).
4. Xem ai đăng nhập sai: `sudo journalctl -u workping | grep "đăng nhập sai"`.

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Script báo lỗi giữa chừng | Sửa theo thông báo rồi chạy lại **đúng lệnh cũ** — script chạy lại an toàn |
| Web báo 502 Bad Gateway | `sudo systemctl status workping` và `sudo journalctl -u workping -n 100` |
| Không lấy được chứng chỉ HTTPS | Kiểm tra tên miền trỏ đúng IP (`dig +short tên-miền`), cổng **80** mở từ Internet (kể cả khi dùng `--https-port`), chạy lại script. Không mở được cổng 80 → dùng `--ssl-cert/--ssl-key` |
| Không có nút *Bật thông báo* | Phải truy cập bằng **https://** (không phải http://IP). iPhone: phải mở từ biểu tượng trên màn hình chính, iOS ≥ 16.4 |
| Bật rồi nhưng không nhận push | Bấm *Gửi thông báo thử*; xem log `sudo journalctl -u workping | grep push`. Máy chủ phải ra được Internet tới `web.push.apple.com`, `fcm.googleapis.com` (cổng 443) — nếu đi qua proxy, thêm `PUSH_PROXY=http://proxy:port` vào `/etc/workping/workping.env` rồi restart |
| Gửi thử báo `BadJwtToken` / giờ hạn công việc bị lệch | Đồng hồ máy chủ sai. Mạng chặn NTP thì script tự đồng bộ giờ qua HTTPS 30 phút/lần; chạy ngay: `sudo workping-timesync --force`. Xem: `timedatectl`, `journalctl -t workping-timesync` |
| iPhone lâu lâu không nhận | Kiểm tra *Cài đặt → Thông báo → WorkPing*; chế độ Tập trung/Không làm phiền có thể chặn |
| Quên mật khẩu admin | `sudo cat /etc/workping/admin-credentials.txt` (mật khẩu ban đầu), hoặc Trưởng phòng/Admin khác đặt lại ở trang Nhân sự |
| Đổi cổng 4000 bị trùng | `sudo bash deploy/install.sh --port 4100` |

## Gỡ cài đặt

```bash
sudo systemctl disable --now workping
sudo rm -f /etc/systemd/system/workping.service /etc/nginx/sites-enabled/workping /etc/nginx/sites-available/workping /etc/cron.d/workping-backup /usr/local/bin/workping-backup
sudo systemctl daemon-reload && sudo systemctl reload nginx
sudo rm -rf /opt/workping
# Xoá luôn dữ liệu (không thể hoàn tác!):
# sudo -u postgres dropdb workping && sudo -u postgres dropuser workping && sudo rm -rf /etc/workping /var/backups/workping
```

---

## Cài thủ công từng bước (nếu không muốn dùng script)

```bash
# 1. Gói hệ thống + Node.js 22
sudo apt-get update
sudo apt-get install -y curl rsync postgresql nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs

# 2. User dịch vụ & CSDL
sudo useradd --system --create-home --home-dir /var/lib/workping --shell /usr/sbin/nologin workping
sudo -u postgres psql -c "create role workping login password 'MAT_KHAU_CSDL'"
sudo -u postgres psql -c "create database workping owner workping"

# 3. Mã nguồn & build
sudo mkdir -p /opt/workping && sudo rsync -a --exclude node_modules --exclude .git ./ /opt/workping/
sudo chown -R workping:workping /opt/workping
cd /opt/workping/web     && sudo -u workping -H npm ci && sudo -u workping -H npm run build
cd /opt/workping/backend && sudo -u workping -H npm ci && sudo -u workping -H npm run build

# 4. Cấu hình: tạo /etc/workping/workping.env theo mẫu backend/.env.example, thêm:
#    NODE_ENV=production
#    WEB_DIST=/opt/workping/web/dist
#    VAPID_SUBJECT=mailto:it@congty.vn
sudo chown root:workping /etc/workping/workping.env && sudo chmod 640 /etc/workping/workping.env

# 5. Tạo bảng + tài khoản admin
cd /opt/workping/backend
sudo -u workping -H bash -c 'set -a; . /etc/workping/workping.env; set +a; npx prisma migrate deploy && node dist/scripts/seed.js'

# 6. Dịch vụ systemd: copy deploy/workping.service vào /etc/systemd/system/ và thay các biến @...@
sudo systemctl daemon-reload && sudo systemctl enable --now workping

# 7. Nginx: copy deploy/nginx.conf vào /etc/nginx/sites-available/workping, thay @SERVER_NAME@ @PORT@ @ACME_ROOT@ (/var/www/letsencrypt)
sudo mkdir -p /var/www/letsencrypt
sudo ln -s /etc/nginx/sites-available/workping /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 8. HTTPS: lấy chứng chỉ, rồi thay cấu hình bằng deploy/nginx-ssl.conf
#    (@HTTPS_PORT@ = 443 hoặc 8443…, @HTTPS_SUFFIX@ = rỗng hoặc :8443, @SSL_CERT@ @SSL_KEY@ = đường dẫn chứng chỉ)
sudo apt-get install -y certbot
sudo certbot certonly --webroot -w /var/www/letsencrypt -d workping.congty.vn -m it@congty.vn --agree-tos \
  --deploy-hook "systemctl reload nginx"
```
