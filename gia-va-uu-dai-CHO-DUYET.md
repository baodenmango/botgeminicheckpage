# ✅ ĐÃ DUYỆT — HỒ SƠ LƯU, KHÔNG CÒN LÀ CỬA CHẶN

> 🗄️ **File này nay chỉ để TRA LỊCH SỬ. Nội dung ưu đãi đã chuyển sang `gia-va-uu-dai.md` mục ④
> và ĐANG ĐƯỢC NẠP vào bộ não Facebook.** `src/config.js` vẫn **không** đọc file này — giữ nguyên
> như vậy, đừng nối nó vào, để tránh nạp hai bản mô tả ưu đãi lệch nhau vào cùng một bộ não.

## Anh Trình chốt 06/09/2026

Nguyên văn: *"Ưu đãi đó là **BOT linh hoạt**, anh gợi ý cho **những ca giải quyết về giá**."*

⇒ Trả lời dứt điểm cho câu hỏi treo ở bản trước: **cả 2 khoản đều CÓ THẬT**, và chúng là **công cụ
xử lý phản đối giá**, không phải chính sách chào sân. Đây chính là lý do bản này **không** hạ thẳng
giá khám xuống 150k như phương án đã nêu ở bản trước — giữ 300k làm **neo giá** (mục A1 của
`ky-nang-ban-hang.md`) và chỉ mở khoá 150k khi khách vướng tiền, thì con số 150k mới có sức nặng.

| # | Ưu đãi | Điều kiện | Trạng thái |
|---|---|---|---|
| 1 | Giảm 50% phí khám (300.000đ → **150.000đ**) | BHYT · học sinh–sinh viên · công nhân viên chức · trên 60 tuổi | 🟢 ĐANG DÙNG |
| 2 | Tặng 1 lần điện xung trị liệu (400.000đ) | không kèm điều kiện | 🟢 ĐANG DÙNG |

**Hạn thời gian: KHÔNG CÓ.** ⇒ mọi câu bot nói về hạn chót/số suất đều là **bịa** — thước
`scripts/do-chot-so.py` có cổng `HAN_BIA` bắt buộc = 0.

## Ba việc đã làm khi bật (đối chiếu "Cách BẬT" của bản trước — đủ cả 4 bước)

1. ✅ Chép sang `gia-va-uu-dai.md` (file được nạp), kèm **7 luật dùng**.
2. ✅ **Gỡ hết mâu thuẫn**: luật ④ cũ (*"KHÔNG CÓ ƯU ĐÃI NÀO KHÁC"*) đã viết lại; ba chỗ trong
   `system-prompt.md` còn ghi *"chưa có ưu đãi nào được duyệt"* (mục **4C ⑤** · mục **9 retouch** ·
   mục **12**) đã sửa. `grep "chưa có ưu đãi nào được duyệt"` nay trả **0 dòng**.
3. ✅ Dạy bot **hỏi điều kiện trước khi hứa** (luật ④) và **dặn mang giấy tờ** (luật ⑤).
4. ✅ `node --check` sạch; thước `do-chot-so.py` thêm **3 đo ưu đãi** + đổi cổng an toàn
   (bộ dò cũ coi *mọi* chữ "giảm/tặng/điện xung" là bot bịa — để nguyên thì mỗi lần bot làm **đúng**
   lại bị đếm thành lỗi nặng).

## ⚠️ Rủi ro anh Trình đã biết mà vẫn quyết — ghi lại để sau này còn tra

**Điện xung trị liệu thuộc nhóm (A)** — kỹ thuật Sở **chưa duyệt** (hồ sơ `H29.19-260729-180177`,
hạn xử 16/10/2026). Anh đã chốt **inbox thoải mái** nên máy không chặn. Nhưng khác biệt cần nhớ:
**hứa TẶNG một dịch vụ là hứa sẽ THỰC HIỆN nó**, nặng hơn việc chỉ trả lời một câu hỏi trong inbox.
Máy đã khoá chặt phần công khai: `src/comment.js` **không** import gemini ⇒ chữ "điện xung" không có
đường ra comment/caption. Phần còn lại là quyết định của anh.
