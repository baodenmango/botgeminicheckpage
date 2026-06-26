# Bot Gemini check-page — Phòng khám Hiệp Lợi

Service Node.js chạy 24/7: nhận tin khách từ **Pancake** → trả lời bằng **Gemini** (bộ não ở `system-prompt.md`) tách 3–4 ô có delay → **tự chạm lại** sau 2–3h nếu khách im & chưa cho SĐT → có SĐT/cần người thì **báo Telegram** cho telesale.

> Đang bật DUY NHẤT trang **Phòng Khám Hiệp Lợi** (386613267864665 — không vướng Meta Agent). Trang Dr Nhật Trình đang TẮT trong `.env` (vì đang chạy Meta Business Agent).

---

## Cấu trúc
```
bot-gemini-checkpage/
├── index.js            # Express: /webhook, /health + cron retouch 15 phút
├── system-prompt.md    # Bộ não nạp vào Gemini (= file BOT GEMINI 1)
├── .env                # Khóa thật — ĐÃ gitignore, KHÔNG đẩy GitHub
├── .env.example        # Mẫu để người khác điền
└── src/
    ├── config.js       # Đọc env, gom danh sách trang Pancake
    ├── gemini.js       # Gọi Gemini, ép JSON, mode retouch
    ├── pancake.js      # Gửi tin đa trang (page_id→token), delay giữa ô
    ├── store.js        # SQLite: lịch sử hội thoại + trạng thái
    ├── utils.js        # Bắt SĐT Việt Nam bằng regex
    ├── telegram.js     # Báo lead / handover về Telegram
    └── handler.js      # Lõi xử lý 1 lượt (webhook & retouch)
```

---

## Chạy thử ở máy (local)
```bash
cd bot-gemini-checkpage
npm install
npm start          # mở http://localhost:3000/health → {ok:true}
```
> `.env` đã có sẵn khóa. Để bot nhận tin thật khi test local, cần đưa webhook Pancake trỏ về máy bạn qua ngrok (`ngrok http 3000`) — không bắt buộc, có thể test thẳng trên Render.

---

## DEPLOY LÊN RENDER (làm 1 lần)

### Bước 1 — Đưa code lên GitHub
> `.env` đã được `.gitignore` chặn nên **khóa KHÔNG bị đẩy lên** — yên tâm.
```bash
cd bot-gemini-checkpage
git init
git add .
git commit -m "Bot Gemini check-page Hiệp Lợi"
# Tạo repo trống trên github.com (Private), rồi:
git remote add origin https://github.com/<tài-khoản>/<tên-repo>.git
git branch -M main
git push -u origin main
```

### Bước 2 — Tạo Web Service trên Render
1. Vào https://render.com → **New** → **Web Service** → kết nối GitHub repo vừa push.
2. Cấu hình:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Instance Type:** **Starter (~$7/tháng)** — KHÔNG chọn Free (Free bị "ngủ", bot sẽ không nhận tin).

### Bước 3 — Persistent Disk (giữ lịch sử hội thoại khi restart)
1. Trong service → tab **Disks** → **Add Disk**.
   - **Name:** `data` · **Mount Path:** `/data` · **Size:** 1 GB là đủ.
2. Sang tab **Environment**, thêm biến: `DB_PATH = /data/bot.sqlite`
   (để SQLite ghi vào disk, không mất khi deploy lại).

### Bước 4 — Nhập biến môi trường (copy từ `.env`)
Tab **Environment** → thêm từng biến (mở file `.env` copy giá trị sang):

| Key | Value |
|---|---|
| `GEMINI_API_KEY` | (copy từ .env) |
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `TELEGRAM_BOT_TOKEN` | (copy từ .env) |
| `TELEGRAM_CHAT_ID` | (copy từ .env) |
| `PANCAKE_PAGE_1_ID` | `386613267864665` |
| `PANCAKE_PAGE_1_TOKEN` | (copy từ .env) |
| `PANCAKE_PAGE_1_CHANNEL` | `facebook` |
| `PORT` | `3000` |
| `DB_PATH` | `/data/bot.sqlite` |
| `RETOUCH_MIN_IDLE_HOURS` | `2` |
| `RETOUCH_MAX_COUNT` | `2` |

→ Bấm **Save** → Render tự build & deploy. Xong sẽ có URL: `https://<tên-app>.onrender.com`.
Mở `https://<tên-app>.onrender.com/health` thấy `{"ok":true}` là sống.

### Bước 5 — Nối webhook ở Pancake
1. Pancake → **Cài đặt** → tìm mục **Webhook / Tích hợp / Lập trình viên**.
2. Dán URL: `https://<tên-app>.onrender.com/webhook`
3. Chọn sự kiện **"tin nhắn mới"** (inbox) → **Lưu**.

### Bước 6 — Test nghiệm thu
- [ ] Nhắn "đau gối có chữa không" vào Page → bot trả 3–4 ô, gửi link thoaihoakhop, xin SĐT.
- [ ] Hỏi giá → bot KHÔNG báo số, nêu ưu đãi, xin SĐT.
- [ ] Để lại SĐT → Telegram nhận "🔥 LEAD MỚI", bot ngừng auto (giao người).
- [ ] Để im 2–3h, chưa cho SĐT → bot tự nhắn lại 1 lần (tối đa 2 lần/48h).
- [ ] Khiếu nại → Telegram nhận "⚠️ CẦN NGƯỜI XỬ LÝ".
- [ ] Restart service trên Render → hội thoại không mất (SQLite trên `/data`).

---

## ⚠️ Lưu ý quan trọng

**1. Endpoint Pancake cần xác minh.** Cách gửi tin (`src/pancake.js`) viết theo Public API pages.fm. Nếu test thấy bot **nhận được tin nhưng KHÔNG gửi trả lời được** (log báo `[pancake] gửi lỗi status=...`), thì endpoint/tham số gửi cần chỉnh theo đúng tài liệu Pancake hiện hành (Pancake → Cài đặt → Công cụ → API, hoặc developers.pancake.vn). Có thể chỉnh nhanh bằng biến `PANCAKE_API_BASE` hoặc sửa hàm `sendOne()`. Báo mình log lỗi là mình sửa cho.

**2. Webhook payload.** `parsePancakeWebhook()` trong `index.js` đọc payload linh hoạt, nhưng nếu Pancake gửi cấu trúc lạ thì cần xem log `[webhook]` để map lại đúng khóa.

**3. Bật thêm trang Dr Nhật Trình:** TẮT Meta Business Agent trên trang đó trước, rồi bỏ dấu `#` ở 3 dòng `PANCAKE_PAGE_2_*` trong `.env` (và thêm biến tương ứng trên Render).

**4. Mở rộng kênh TikTok/Zalo:** thêm `PANCAKE_PAGE_3_ID/_TOKEN/_CHANNEL` (channel `tiktok`/`zalo`). Cách gửi cho TikTok/Zalo có thể khác FB — kiểm tra docs Pancake.
