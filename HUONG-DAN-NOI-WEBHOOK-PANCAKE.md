# Hướng dẫn nối Webhook Pancake (làm khi support đã bật xong)

> Bot đã LIVE sẵn: **https://botgeminicheckpage.onrender.com** — chỉ còn nối webhook là nhận tin thật.

## Bối cảnh
Pancake KHÔNG cho dán webhook URL ngay trong giao diện. Theo docs chính thức (developer.pancake.biz/webhook), phải **đăng ký với support Pancake bật tính năng Webhook trước** (đưa page_id `386613267864665`). Mỗi trang bật webhook tốn **1 connection slot** trong gói subscription.

→ Đã nhắn fanpage Pancake xin bật (26/06/2026). **Đang chờ support phản hồi.**

---

## KHI SUPPORT ĐÃ BẬT XONG — làm 3 bước:

### Bước 1: Vào cấu hình webhook
Pancake → trang **Phòng Khám Hiệp Lợi** → **Cài đặt → Công cụ**
(URL: https://pancake.vn/phongkhamhieploi/setting/tools)
→ Sau khi support bật, ở đây sẽ xuất hiện mục **Webhook** (trước đó chưa có).

### Bước 2: Dán URL + chọn event
- **Webhook URL:**
  ```
  https://botgeminicheckpage.onrender.com/webhook
  ```
- **Event:** chọn **messaging** (tin nhắn mới / cập nhật tin trong inbox).
  - ⚠️ **NẾU Pancake có event riêng cho COMMENT** (vd `comment` / `feed` / `post_comment`)
    → **tick luôn event đó** để bot nhận được comment dưới bài. Bot đã xử comment:
    rep công khai 1 câu mời + nhắn riêng kéo khách vào inbox (xem `src/comment.js`).
  - Nếu gói chỉ có `messaging` mà comment KHÔNG về → báo lại để chuyển sang phương án POLL.
  *(Bỏ qua `subscription` / `post` nếu không phải kênh comment.)*
- Nếu có nút **"Verify endpoint URL"** → bấm verify (bot trả HTTP 200 ở cả `/` và `/webhook` nên sẽ pass).
- **Lưu.**

### Bước 3: Test ngay
1. Nhắn thử vào Page Phòng Khám Hiệp Lợi: *"đau gối có chữa không"*
2. Mở **log Render** (dashboard.render.com → service → Logs) xem:
   - `[webhook] tin từ ...` → bot ĐÃ nhận tin ✅
   - `[pancake] gửi HỤT status=...` → nếu thấy dòng này nghĩa là **endpoint GỬI tin của bot cần chỉnh** (sửa `src/pancake.js`). Báo lại để fix.
3. Nhắn để lại SĐT → kiểm tra **group Telegram telesale** có nhận "🔥 LEAD MỚI" không.

---

## Lưu ý quan trọng (từ docs Pancake)
- **Webhook bị tự ngắt** nếu trong 30 phút: tỷ lệ lỗi > 80% VÀ ≥ 300 request lỗi. Bot mình trả 200 ngay nên không lo, nhưng nếu Render sập lâu thì webhook bị suspend → phải vào **Webhook Settings bật lại**.
- Bot đã viết đúng best practice docs yêu cầu: trả 200 nhanh, xử lý bất đồng bộ, idempotent (khóa theo conversation_id).

## Nếu support KHÔNG bật được / tốn phí cao
Phương án dự phòng: chuyển bot sang **POLL** (tự gọi Public API mỗi 5-10s lấy tin mới, token đã có sẵn). Chạy được ngay không cần support. Báo để em sửa code.
