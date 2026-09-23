#!/usr/bin/env bash
# Sao lưu CSDL WorkPing, giữ 14 bản gần nhất. Khôi phục: xem deploy/README.md
set -euo pipefail
DIR=/var/backups/workping
KEEP_DAYS=${KEEP_DAYS:-14}
mkdir -p "$DIR"
FILE="$DIR/workping-$(date +%Y%m%d-%H%M%S).dump"
# shellcheck disable=SC2024  # chạy bằng root: root ghi file, postgres chỉ đọc CSDL
sudo -u postgres pg_dump -Fc workping > "$FILE"
chmod 640 "$FILE"
find "$DIR" -name 'workping-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "Đã sao lưu: $FILE"
