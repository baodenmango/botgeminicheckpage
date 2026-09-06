#!/bin/bash
# ONE-SHOT: bắn pilot Y Đạo lô 1 (100 voucher 150k) lúc 8h10 sáng — anh Trình duyệt 08/08.
# Bắn xong TỰ GỠ plist để không lặp. Kết quả bot tự báo Telegram (ydao_pilot_kq).
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN="708a0e17d0d637e7d1d5568cef4352a5"
kq=$(curl -s --max-time 30 -X POST "https://botgeminicheckpage.onrender.com/admin/ydao-pilot?token=$TOKEN" \
  -H "Content-Type: application/json" -d @"$DIR/ydao-lo1.json")
echo "$(date '+%F %T') ydao-lo1: $kq" >> "$DIR/../logs/ydao-pilot.log"
# tự gỡ (dù thành công hay lỗi — không bắn lặp; lỗi thì log còn đó để soi)
launchctl bootout gui/501/com.hieploi.ydao.lo1 2>/dev/null || true
rm -f ~/Library/LaunchAgents/com.hieploi.ydao.lo1.plist
