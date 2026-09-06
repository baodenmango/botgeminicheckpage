#!/bin/bash
# One-shot 09:00 08/08: bắn xin review Google tệp 100 ca đã nhận form đánh giá (anh Trình duyệt rạng sáng 08/08).
# Kết quả tự về Telegram (route tự notifyText). Bắn xong tự gỡ plist.
LOG="$(dirname "$0")/logs/moi-review.log"
mkdir -p "$(dirname "$LOG")"
{
  echo "=== $(date '+%F %T') bắn moi-review-100 dry=0 ==="
  curl -s "https://botgeminicheckpage.onrender.com/admin/moi-review-100?token=708a0e17d0d637e7d1d5568cef4352a5&dry=0"
  echo
} >> "$LOG" 2>&1
launchctl bootout "gui/$(id -u)/com.hieploi.moireview.lo1" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/com.hieploi.moireview.lo1.plist"
