#!/usr/bin/env bash
# Nâng cấp: lấy mã mới nhất (nếu là git clone), sao lưu CSDL, rồi cài lại (giữ dữ liệu & cấu hình)
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $EUID -eq 0 ]] || { echo "Cần chạy: sudo bash deploy/update.sh"; exit 1; }
if [[ -d .git ]]; then
  git config --global --add safe.directory "$PWD" 2>/dev/null || true
  git pull --ff-only
fi
[[ -x /usr/local/bin/workping-backup ]] && /usr/local/bin/workping-backup
exec bash deploy/install.sh "$@"
