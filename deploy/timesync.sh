#!/usr/bin/env bash
# ============================================================================
#  Đồng bộ giờ máy chủ qua HTTPS — dùng khi mạng chặn NTP (UDP 123).
#  Lấy giờ chuẩn từ header "Date" của các máy chủ lớn (Google, Cloudflare, Microsoft).
#  Chạy tay:  sudo workping-timesync        Xem nhật ký: journalctl -t workping-timesync
# ============================================================================
set -uo pipefail

# Máy chủ đã đồng bộ NTP bình thường → không cần làm gì
if [[ "${1:-}" != "--force" && "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" == "yes" ]]; then
  exit 0
fi

# Đi Internet qua proxy (nếu có cấu hình cho thông báo đẩy)
PROXY=""
[[ -f /etc/workping/workping.env ]] && PROXY=$(grep -E '^PUSH_PROXY=' /etc/workping/workping.env | cut -d= -f2- | tr -d '"' || true)

real=""
for url in https://www.google.com https://www.cloudflare.com https://www.microsoft.com; do
  d=$(curl -fsSI --max-time 10 ${PROXY:+-x "$PROXY"} "$url" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="date"{print $2; exit}')
  if [[ -n "$d" ]] && real=$(date -u -d "$d" +%s 2>/dev/null); then
    src=$url
    break
  fi
  real=""
done
if [[ -z "$real" ]]; then
  logger -t workping-timesync "không lấy được giờ chuẩn qua HTTPS"
  echo "Không lấy được giờ chuẩn qua HTTPS (kiểm tra máy chủ ra Internet cổng 443)" >&2
  exit 1
fi

now=$(date -u +%s)
diff=$((now - real))
if (( diff > 2 || diff < -2 )); then
  date -u -s "@$real" >/dev/null
  hwclock --systohc 2>/dev/null || true
  msg="đã chỉnh giờ: lệch ${diff} giây so với ${src} → $(date '+%d/%m/%Y %H:%M:%S %Z')"
else
  msg="giờ chuẩn (lệch ${diff} giây so với ${src})"
fi
logger -t workping-timesync "$msg"
[[ -t 1 ]] && echo "$msg"
exit 0
