# Triển khai WorkPing trên Ubuntu (chạy dạng service, không Docker)

Script `install.sh` tự làm toàn bộ: cài PostgreSQL, Node.js 22, nginx; tạo CSDL với mật khẩu ngẫu nhiên; build web + API; tạo dịch vụ **systemd** `workping` (tự khởi động cùng máy, tự chạy lại khi lỗi); cấu hình nginx (+ HTTPS nếu có tên miền); sao lưu CSDL hằng ngày.

Kiến trúc sau khi cài:

```
Trình duyệt / App mobile ──HTTPS──▶ nginx :80/:443 ──▶ workping (Node.js, 127.0.0.1:4000) ──▶ PostgreSQL :5432
                                                          └─ gửi push ──▶ Firebase ──▶ Android / iOS
```

| Thành phần | Vị trí |
|---|---|
| Mã chương trình | `/opt/workping` |
| Cấu hình (mật khẩu CSDL, JWT, lịch nhắc…) | `/etc/workping/workping.env` |
| Mật khẩu admin ban đầu | `/etc/workping/admin-credentials.txt` |
| Khoá Firebase | `/etc/workping/firebase-service-account.json` |
| Dịch vụ | `/etc/systemd/system/workping.service` |
| Nginx | `/etc/nginx/sites-available/workping` |
| Sao lưu CSDL (1h sáng, giữ 14 ngày) | `/var/backups/workping/` |

---

## Bước 0 – Chuẩn bị máy chủ

- Ubuntu Server **22.04** hoặc **24.04** (64-bit), tối thiểu 2 CPU / 2 GB RAM / 20 GB ổ đĩa.
- Có quyền `sudo` và máy chủ ra được Internet (tải gói apt, npm, Node.js). Nếu đi qua proxy, đặt trước: `export https_proxy=http://proxy:port http_proxy=http://proxy:port` rồi chạy script bằng `sudo -E`.
- Muốn có HTTPS (bắt buộc khi dùng app iOS ngoài mạng nội bộ): một **tên miền** đã trỏ bản ghi A về IP máy chủ, mở cổng **80** và **443**.

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

## Bước 2 – Chép các file cần thiết (tuỳ chọn, có thể làm sau)

```bash
# Khoá Firebase để gửi push (Firebase Console → Project settings → Service accounts → Generate new private key)
scp firebase-service-account.json user@IP_MAY_CHU:~
# File Excel đang dùng để nhập dữ liệu ban đầu
scp "Cong_cu_Quan_ly_Tien_do.xlsx" user@IP_MAY_CHU:~
```

## Bước 3 – Chạy cài đặt (1 lệnh)

Chỉ dùng trong mạng nội bộ, truy cập bằng IP:

```bash
sudo bash deploy/install.sh \
  --firebase ~/firebase-service-account.json \
  --import ~/Cong_cu_Quan_ly_Tien_do.xlsx
```

Có tên miền + HTTPS tự động (Let's Encrypt, tự gia hạn):

```bash
sudo bash deploy/install.sh \
  --domain workping.congty.vn --email it@congty.vn \
  --firebase ~/firebase-service-account.json \
  --import ~/Cong_cu_Quan_ly_Tien_do.xlsx
```

Tất cả tuỳ chọn:

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `--domain <tên-miền>` | Tên miền của hệ thống |
| `--email <email>` | Kèm `--domain` để bật HTTPS |
| `--firebase <file.json>` | Khoá service account Firebase (push) |
| `--import <file.xlsx>` | Nhập dữ liệu từ file Excel cũ |
| `--port <số>` | Cổng nội bộ của API (mặc định 4000) |
| `--no-nginx` | Không cài nginx (khi đã có reverse proxy khác) |

Mất khoảng 3–5 phút. Cuối cùng script in ra:

```
══════════════════ HOÀN TẤT ══════════════════
  Địa chỉ web     : https://workping.congty.vn
  API cho app     : https://workping.congty.vn/api
  Tài khoản quản trị WorkPing
    Tên đăng nhập: admin
    Mật khẩu: xxxxxxxxxxxx
```

## Bước 4 – Sau khi cài

1. Mở địa chỉ web, đăng nhập `admin` với mật khẩu ở trên → hệ thống bắt đổi mật khẩu.
2. Vào **Nhân sự** kiểm tra danh sách, **cấp** (Trưởng phòng/Phó phòng/Nhân viên) và **quản lý trực tiếp** của từng người.
3. Báo cho mọi người: đăng nhập bằng **mã nhân sự viết thường** (vd `ns002`), mật khẩu mặc định `123456`, lần đầu phải đổi.
4. Nếu chưa nhập Excel ở bước 3: **Cấu hình & Excel → Chọn file Excel**.
5. Trên app mobile: *Cấu hình máy chủ* = `https://workping.congty.vn/api` (hoặc build app với `EXPO_PUBLIC_API_URL` này).
6. Kiểm tra push: app → **Cá nhân → Gửi thông báo thử**. Kiểm tra máy chủ: `curl -s http://127.0.0.1:4000/api/health` phải có `"push":true`.

---

## Quản trị hằng ngày

| Việc | Lệnh |
|---|---|
| Xem trạng thái | `sudo systemctl status workping` |
| Xem log trực tiếp | `sudo journalctl -u workping -f` |
| Khởi động lại | `sudo systemctl restart workping` |
| Dừng / chạy | `sudo systemctl stop workping` / `sudo systemctl start workping` |
| Sửa cấu hình | `sudo nano /etc/workping/workping.env` rồi `sudo systemctl restart workping` |
| Gửi nhắc việc ngay | web → Cấu hình & Excel → *Gửi nhắc việc ngay* |

Các cấu hình hay chỉnh trong `workping.env`:

```ini
REMINDER_CRON="0 8 * * 1-6"   # giờ gửi nhắc việc (phút giờ ngày tháng thứ) — đặt trong ngoặc kép
WARN_DAYS=3                   # còn ≤ N ngày thì báo "Sắp đến hạn"
REMIND_DAYS=3,1,0             # nhắc riêng từng mốc khi còn 3, 1, 0 ngày
DEFAULT_PASSWORD=123456       # mật khẩu khi tạo nhân sự mới / đặt lại
```

Thêm/đổi khoá Firebase sau khi đã cài:

```bash
sudo install -o root -g workping -m 640 ~/firebase-service-account.json /etc/workping/firebase-service-account.json
sudo systemctl restart workping
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

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| Script báo lỗi giữa chừng | Sửa theo thông báo rồi chạy lại **đúng lệnh cũ** — script chạy lại an toàn |
| Web báo 502 Bad Gateway | `sudo systemctl status workping` và `sudo journalctl -u workping -n 100` |
| Không lấy được chứng chỉ HTTPS | Kiểm tra tên miền trỏ đúng IP (`dig +short tên-miền`), mở cổng 80/443, chạy lại script |
| Không nhận push | Log có `[push] Chưa cấu hình Firebase` → thêm khoá; điện thoại phải cho phép thông báo; iOS cần APNs key trên Firebase |
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
sudo mkdir -p /opt/workping && sudo rsync -a --exclude node_modules --exclude .git --exclude mobile ./ /opt/workping/
sudo chown -R workping:workping /opt/workping
cd /opt/workping/web     && sudo -u workping -H npm ci && sudo -u workping -H npm run build
cd /opt/workping/backend && sudo -u workping -H npm ci && sudo -u workping -H npm run build

# 4. Cấu hình: tạo /etc/workping/workping.env theo mẫu backend/.env.example, thêm:
#    NODE_ENV=production
#    WEB_DIST=/opt/workping/web/dist
#    FIREBASE_SERVICE_ACCOUNT_PATH=/etc/workping/firebase-service-account.json
sudo chown root:workping /etc/workping/workping.env && sudo chmod 640 /etc/workping/workping.env

# 5. Tạo bảng + tài khoản admin
cd /opt/workping/backend
sudo -u workping -H bash -c 'set -a; . /etc/workping/workping.env; set +a; npx prisma migrate deploy && node dist/scripts/seed.js'

# 6. Dịch vụ systemd: copy deploy/workping.service vào /etc/systemd/system/ và thay các biến @...@
sudo systemctl daemon-reload && sudo systemctl enable --now workping

# 7. Nginx: copy deploy/nginx.conf vào /etc/nginx/sites-available/workping, thay @SERVER_NAME@ @PORT@
sudo ln -s /etc/nginx/sites-available/workping /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 8. HTTPS
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d workping.congty.vn -m it@congty.vn --agree-tos --redirect
```
