#!/bin/bash
# KEVIN LO ZALO VIDEO — cron hằng ngày 10:30 (anh Trình giao 07/08/2026: "lên full Zalo Video,
# đặt cron auto bắn nhiệm vụ cho thằng Kevin nó lo luôn").
#
# Kênh THẬT (đo 07/08): video.zalo.me/creator — 449 video (đồng bộ TikTok) · 121 người theo dõi
# · 4.447 lượt xem/7 ngày · hôm nay 604 view. Kênh SỐNG mà từ trước không ai quản.
#
# Nhiệm vụ Kevin mỗi ngày: ① đọc số liệu → ghi sổ + báo Telegram ② trả lời bình luận mới
# ③ Thứ 2 & Thứ 5: đăng 1 clip sạch từ kho Xưởng lên (nút Đăng video).
# Chạy cwd = project Marketing để nạp MCP chrome (profile hieploi đã đăng nhập Zalo).

set -uo pipefail
cd "/Users/mac/Claude/Projects/Phòng khám Hiệp Lợi - Marketing & Vận hành" || exit 1
source "/Users/mac/Claude/Projects/Xay-Kenh-HiepLoi/06-CRON-DO-CLIP/goi-claude-co-retry.sh"

THU=$(date +%u)   # 1=T2 ... 7=CN
NGAY=$(date '+%d/%m/%Y')
VIEC_DANG=""
if [ "$THU" = "1" ] || [ "$THU" = "4" ]; then
  VIEC_DANG="③ HÔM NAY LÀ NGÀY ĐĂNG (T2/T5): chọn 1 clip SẠCH mới nhất chưa đăng Zalo Video từ kho Xưởng Media (đọc sổ đã đăng scripts/so-zalo-video-da-dang.json trong bot-gemini-checkpage — thiếu file thì tạo; kho clip: hỏi sổ 05-OUTPUT của project Xay-Kenh-HiepLoi hoặc kho Final Xưởng-Media), vào video.zalo.me/creator bấm 'Đăng video' upload, tiêu đề ngắn trúng nỗi đau + hashtag ngành vừa phải, mô tả kèm hotline 0962 349 329. Đăng xong ghi vào sổ so-zalo-video-da-dang.json (đường dẫn clip + ngày + tiêu đề) để không đăng lặp — luật: kiểm ĐẦU RA (video hiện trên kênh) mới ghi sổ."
fi

goi_claude "Bạn là Kevin — lo kênh ZALO VIDEO của Phòng khám CXK Hiệp Lợi. Hôm nay ${NGAY}.
Chrome MCP profile hieploi ĐÃ đăng nhập Zalo (nếu 'Browser is already in use' thì kill process Chrome giữ /Users/mac/.claude/mcp-servers/hieploi/chrome-profile rồi thử lại).

① ĐO SỐ: vào https://video.zalo.me/creator/phan-tich/tong-quat đọc: tổng video / người theo dõi / lượt xem hôm nay / lượt xem 7 ngày / like / share / bình luận. Ghi 1 dòng NDJSON vào file 'bot-gemini-checkpage/scripts/so-zalo-video.ndjson' (tạo nếu chưa có): {\"ngay\":\"${NGAY}\",\"video\":..,\"follower\":..,\"view_homnay\":..,\"view_7ngay\":..,...}. So với dòng hôm trước: follower/view tăng hay giảm.

② BÌNH LUẬN: vào mục Bình luận trong Creator Center. Có bình luận MỚI chưa trả lời → trả lời giọng phòng khám thân thiện, tuân thủ y tế (KHÔNG hứa khỏi, KHÔNG chẩn đoán qua mạng, câu hỏi bệnh cụ thể thì mời nhắn Zalo OA hoặc gọi 0962 349 329). Câu hỏi nhạy cảm/phàn nàn → KHÔNG tự trả lời, ghi lại để báo.

${VIEC_DANG}

④ BÁO CÁO: gửi Telegram (dùng cách gửi trong bot-gemini-checkpage/scripts/dem-quota-zns.sh — TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID từ bot-gemini-checkpage/.env) 1 tin gọn: '🎬 Zalo Video ${NGAY}: X video · Y follower · Z view hôm nay (7d: W)' + số bình luận đã trả lời + tên clip đã đăng (nếu có) + việc bất thường cần anh Trình.

🚨 LUẬT DMKT (áp từ 10/08/2026 — Zalo Video là kênh CÔNG KHAI mang tên phòng khám, Sở Y tế thấy được; bản gốc: Xay-Kenh-HiepLoi/05-OUTPUT/LUAT-DMKT-TOAN-HE.md). Danh mục kỹ thuật được duyệt hiện CHỈ CÓ KHÁM BỆNH + KÊ TOA (hồ sơ bổ sung H29.19-260729-180177 chưa duyệt, hạn ~07/10/2026):
- CẤM đăng clip / viết tiêu đề - mô tả / trả lời bình luận cho thấy phòng khám THỰC HIỆN: tiêm nội khớp · tiêm nội gân · tiêm chất nhờn/HA · PRP · PRF · tế bào gốc · tiêm corticoid · tiêm dưới siêu âm · chọc hút dịch · nắn chỉnh · bó bột · cắt chỉ/thay băng · tiểu phẫu · sóng xung kích · laser · điện xung/điện trị liệu · kéo giãn cột sống · vật lý trị liệu · đo mật độ xương · nội soi khớp · thay khớp · mổ. CẤM mọi BẢNG GIÁ các kỹ thuật đó. CẤM hứa kết quả ('khỏi hẳn/dứt điểm/không tái phát/cam kết/100%') — dùng 'đỡ hơn', 'dễ chịu hơn'. CẤM nêu 'cơ sở 2/chi nhánh/Y Đạo/46-48 Ngô Quyền/Quận 10'. CẤM xưng 'BS.CK1 / Bác sĩ Chuyên khoa I' (anh Trình đang HỌC CK1, chưa có bằng).
- ĐƯỢC PHÉP, đừng cắt oan: bác sĩ ngồi nói kiến thức (kể cả bàn 'khi nào cần mổ'), clip mô phỏng 3D/hoạt hình ca mổ, khám - tư vấn tại bàn (xem phim X-quang, mô hình khớp, siêu âm CHẨN ĐOÁN), kiến thức bệnh học - bài tập - dinh dưỡng - tâm sự đời thường.
- Clip có MẶT BÁC SĨ KHÁC (không phải anh Trình) → KHÔNG đăng; clip đã đăng thì gỡ. Bệnh nhân/điều dưỡng/lễ tân không tính.
- Rà 449 video đang có: mỗi lượt chạy soi thêm ~20 clip cũ (tiêu đề + mô tả) xem có dính 5 nhóm cấm không, ghi danh sách nghi phạm vào 'bot-gemini-checkpage/scripts/zalo-video-nghi-vuot-dmkt.ndjson' và BÁO Telegram — MỌI thứ định xoá phải BACKUP (tải clip + chép tiêu đề/mô tả) trước, để đăng lại sau khi DMKT duyệt.

LUẬT: chỉ đọc/đăng nội dung — KHÔNG đụng Cài đặt/Quản trị viên/Đồng bộ video/Ads. Xong việc thì đóng tab Chrome. Nếu Chrome không vào được sau 2 lần thử → vẫn gửi Telegram báo 'Zalo Video: kẹt Chrome, cần xem tay'." --permission-mode acceptEdits --dangerously-skip-permissions
