#!/usr/bin/env bash
# Khôi phục CSDL WorkPing từ file sao lưu:  sudo bash deploy/restore.sh /var/backups/workping/workping-YYYYMMDD-HHMMSS.dump
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Cần chạy bằng sudo"; exit 1; }
FILE="${1:-}"
[[ -f "$FILE" ]] || { echo "Cách dùng: sudo bash deploy/restore.sh <file.dump>"; ls -t /var/backups/workping/*.dump 2>/dev/null | head -5; exit 1; }
read -r -p "Dữ liệu hiện tại sẽ bị THAY THẾ bằng bản sao lưu $FILE. Tiếp tục? (gõ yes): " ans
[[ "$ans" == "yes" ]] || { echo "Đã huỷ"; exit 1; }
/usr/local/bin/workping-backup || true   # giữ lại bản hiện tại phòng khi cần
systemctl stop workping
cat "$FILE" | sudo -u postgres pg_restore --clean --if-exists -d workping
systemctl start workping
echo "Đã khôi phục từ $FILE"
