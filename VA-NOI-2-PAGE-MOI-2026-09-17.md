# NỐI 2 PAGE MỚI VÀO BOT — chẩn đoán + bản vá (17/09/2026)

## Kết luận một dòng

**Bot Gemini CHƯA từng phục vụ 2 page mới.** Không phải hỏng, không phải token — mà là
**2 page đó chưa bao giờ được khai vào cấu hình bot**, nên webhook bị bỏ ở mọi cửa.

## Bằng chứng

`.env` của bot khai đúng **5 kênh**, không có 2 page mới:

| # | page_id | kênh | là gì |
|---|---|---|---|
| 1 | `386613267864665` | facebook | PK Hiệp Lợi CXK |
| 2 | `957014354156110` | facebook | Dr Nhật Trình |
| 3 | `zl_3136814239074246132` | zalo | Zalo OA |
| 4–5 | `ttm_-000Ly2…` · `ttm_-000tJF6…` | tiktok | 2 kênh TikTok |
| — | **`1122755484264475`** | — | ⛔ **KHÔNG khai** — Điều trị thoái hoá khớp gối |
| — | **`1226601910533190`** | — | ⛔ **KHÔNG khai** — BS Nhật Trình CXK |

`isPageEnabled()` trả `false` cho page lạ, và nó chặn ở **cả 4 cửa**:
`index.js` (webhook) · `handler.handleIncoming` · `comment.js:147` · `care-send.js:222`.
Mã bot cũng **không có một dòng nào** nhắc 2 page này (`PAGE_AUDIENCE`, `DEFAULT_PAGE_NAMES`).

**Tiền đang chảy vào đó:** 2 camp `N1_CLIPTHANG_190826_HLTHKG` + `N2_CLIPTHANG_190826_BSNT`
chi **1.142.509đ / 7 ngày** (≈4,9tr/tháng) đổ inbox về đúng 2 page bot không nghe.
Inbox **vẫn có người trả lời** (đọc Pancake 16/09 thấy tin trả lời), nhưng **không phải bot Gemini** —
2 câu trả lời mẫu không có trong mã bot. Chất lượng trả lời hiện chưa đo được.

## Token page `1122755484264475` đang CHẾT

Pancake trả `error_code 105 — access_token renewed`. Và **bot KHÔNG tự xoay lại được**:
`refreshPageToken()` có cầu dao `PANCAKE_AUTO_REFRESH`, **mặc định TẮT** (dựng 20/07 sau khi một
agent tự gọi `generate_page_access_token` xoay nhầm token production). Gặp 105 nó chỉ ghi log và
**đứng chờ người dán token tay**.

⚠️ **Sinh token mới là lệnh XOAY VÒNG** — token cũ chết ngay khi có token mới. Ai đang giữ token cũ
(MCP, script khác) sẽ gãy theo. Phải nạp lại **mọi nơi** trong cùng một lần.

## Bản vá này làm gì (3 file, 171/171 test pass)

1. `src/handler.js` — thêm `PAGE_AUDIENCE` cho 2 page: hồ sơ tệp khách riêng, viết theo số đo thật
   (click→nhắn tin 3,18–5,44% so với 10,04% của page cũ ⇒ khách còn đang DÒ, bám đúng trục bệnh).
2. `src/pancake.js` — thêm tên hiển thị, để dòng `📣 Nguồn` báo telesale đúng page.
3. `index.js` — `/admin/env-check` khai luôn **danh sách page đang bật** + cờ `PANCAKE_AUTO_REFRESH`.
   Lý do: hôm nay phải lục `.env` trên máy mới trả lời được câu "bot có phục vụ page X không" —
   từ nay chẩn được từ xa. Chỉ in `page_id` (định danh công khai) và **độ dài** token, không in token.

🔒 **Bản vá này TỰ NÓ không làm bot nhắn cho khách.** Chừng nào Render chưa có
`PANCAKE_PAGE_6_ID` / `PANCAKE_PAGE_7_ID` thì `isPageEnabled()` vẫn `false` ⇒ code mới nằm im.
Deploy trước, bật sau — an toàn theo đúng thứ tự.

## Việc cần anh Trình (theo thứ tự, không đảo)

1. **Duyệt lời văn `PAGE_AUDIENCE`** ở mục 1 — đây là giọng bot sẽ nói với khách thật.
2. **Đẩy deploy** bản vá (code nằm im, chưa ảnh hưởng ai).
3. **Thêm env trên Render** — 2 bộ:
   `PANCAKE_PAGE_6_ID=1122755484264475` · `_CHANNEL=facebook` · `_NAME=...` · `_TOKEN=<token mới>`
   `PANCAKE_PAGE_7_ID=1226601910533190` · `_CHANNEL=facebook` · `_NAME=...` · `_TOKEN=<token>`
4. **Lấy token mới cho page `1122755484264475`** (đang lỗi 105) và nạp lại ở MỌI nơi đang giữ token cũ.
5. **Kiểm Pancake** đã bật webhook `Tin nhắn mới` + `Bình luận mới` cho cả 2 page.
6. **Nghiệm thu:** `GET /admin/env-check?token=XXX` phải thấy đủ 7 page, `token_len > 0` cả 7.
