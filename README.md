# Bot Gemini check-page — Phòng khám Hiệp Lợi

Service Node.js chạy 24/7: nhận tin khách từ **Pancake** → trả lời bằng **Gemini** (bộ não ở `system-prompt.md`) tách 3–4 ô có delay → **tự chạm lại** sau 2–3h nếu khách im & chưa cho SĐT → có SĐT/cần người thì **báo Telegram** cho telesale.

> Đang bật DUY NHẤT trang **Phòng Khám Hiệp Lợi** (386613267864665 — không vướng Meta Agent). Trang Dr Nhật Trình đang TẮT trong `.env` (vì đang chạy Meta Business Agent).

---

## Cấu trúc
```
bot-gemini-checkpage/
├── index.js              # Express: /webhook, /zalo/webhook, /admin/*, /health + cron retouch/7-chạm/chăm-bill
├── system-prompt.md      # Bộ não FB (săn lead)
├── system-prompt-zalo.md # Bộ não ZALO OA (chăm sâu, nhận diện BN cũ/mới, đòn tâm lý "tới nóc")
├── .env / .env.example
└── src/
    ├── config.js         # Đọc env, gom trang Pancake, nạp 2 bộ não
    ├── gemini.js         # Gọi Gemini, ép JSON, chọn bộ não theo channel + chèn thẻ ngữ cảnh MEDi
    ├── pancake.js        # Gửi tin đa trang (page_id→token), nhãn cờ-tắt-bot
    ├── zalo.js           # Zalo OpenAPI: gửi text/file, getUserInfo, follow, tự refresh token
    ├── medi.js           # ENRICH: tra hồ sơ BN theo SĐT (Sheet MEDi) → thẻ [BN_CŨ]/[BN_MỚI] + đọc cả bảng cho wakeup
    ├── conditions.js     # Map mã bệnh → tên VN + SALE_PAGE (12 bệnh, dùng chung)
    ├── resources.js      # KHO TÀI LIỆU: brochure/PDF, clip, quyền lợi, dịch vụ/công nghệ (config trung tâm)
    ├── store.js          # SQLite: hội thoại + bill_care + wakeup_log
    ├── utils.js          # Bắt SĐT Việt Nam
    ├── telegram.js       # Báo lead / handover / DS BN ngủ cần gọi
    ├── handler.js        # Lõi 1 lượt (webhook & retouch) + ENRICH kênh Zalo
    ├── touches.js        # ENGINE 7 CHẠM lead mới (FB) — chạm bot 3/4/6 (tài liệu lấy từ resources.js)
    ├── care-send.js      # Gửi tin chăm: tự chọn kênh (Pancake-Zalo / Zalo OpenAPI)
    ├── billtouches.js    # Nội dung chuỗi CA RA BILL (ngày 0→7)
    ├── billengine.js     # Engine + nạp ca ra bill (/admin/bill-ingest)
    ├── rebilltouches.js  # Nội dung chuỗi TÁI BILL 4 nhóm (gồm liệu trình PRP 3 buổi×1 tháng)
    ├── rebillengine.js   # Engine tái bill theo nhóm + mốc trước/sau buổi hẹn
    ├── follow.js         # Webhook follow OA → giao PDF + video đúng bệnh
    └── wakeup.js         # Engine ĐÁNH THỨC BN NGỦ (tệp MEDi cũ) → nhắc qua OA / đẩy telesale
```

### 17 mặt bệnh (conditions.js) — bệnh LẠ KHÔNG gửi sale page
Cốt lõi (có sale page riêng): `goi vai gut lung tvdd covaigay`. Có trang LIÊN QUAN sát: `chopxoay`→dauvai · `csc`→covaigay.
Bệnh LẠ (chưa có trang → `hasSalePage()=false` → **bot KHÔNG gửi link**, chỉ tư vấn + xin số + mời OA): `ngontay cochan hang chomdui loangxuong dequervain ongcotay tenniselbow gangotchan`.
> Anh Trình chốt 30/06: bệnh lạ thì đừng gửi sale page. Tạo trang riêng cho bệnh nào → thêm 1 dòng vào `SALE_PAGE` (conditions.js) là cả hệ gửi đúng ngay.
> Nội dung cẩm nang/quyền lợi/dịch vụ 17 bệnh: `02-Marketing-SalePage/Tai-lieu-cham-soc-Zalo/` (20 file markdown → đưa Canva → PDF → dán link vào resources.js).

### Mục tiêu BOTGEMINI Facebook (system-prompt.md mục 2) = 3 ĐÍCH SONG SONG
(1) lấy SĐT · (2) đúng sale page · (3) **kéo bằng được vào Zalo OA** (mời tự nhiên xuyên suốt, có số rồi vẫn mời để nhận tài liệu).

### Đánh thức BN ngủ (wakeup.js, cron 09:15 VN/ngày)
Quét MEDi: BN khám cách đây >45 ngày & chưa lại → đã follow OA thì bot tự nhắc qua Zalo; chưa follow thì gom DS bắn Telegram cho telesale gọi/add Zalo. Chống nhắc dày bằng `wakeup_log` (cooldown 30 ngày, tối đa 3 lần).

---

## 🌿 HỆ CHĂM SÓC ZALO OA (chốt 30/06 — thiết kế: THIET-KE-ZALO-OA-CHAM-SOC.md)
Zalo OA = **chăm sóc SÂU** (khách đã follow = đã ấm), KHÁC FB (săn lead). 6 mảnh:
1. **Bộ não Zalo riêng** (`system-prompt-zalo.md`): nhận diện BN cũ/mới qua THẺ ngữ cảnh, đòn tâm lý "tới nóc" trong ranh giới y tế, xin số → bắn telesale gọi nóng.
2. **ENRICH** (`medi.js`): tin Zalo đến → tra SĐT trong MEDi → gắn `[BN_CŨ]`/`[BN_MỚI]` vào prompt. *(Sheet MEDi chưa bật → fail-open: coi là BN mới, vẫn chạy.)*
3. **Chuỗi CA RA BILL** (`billengine.js`): BN ra bill có thuốc/tiêm → chăm ngày 0/1/3/6/7 (đỉnh: ngày 6 nhắc tái khám). Nạp ca: `POST /admin/bill-ingest`.
4. **Chuỗi TÁI BILL 4 nhóm** (`rebillengine.js`): khám-1-lần / đang-liệu-trình / xong / bỏ-dở. Nhóm liệu trình PRP·biogen·TBG = 3 buổi × 1 tháng (nhắc kép trước buổi, đòn sợ-mất nếu lỡ buổi).
5. **Webhook follow** (`follow.js`): khách bấm Quan tâm OA → tự giao PDF cẩm nang + clip đúng bệnh ("hứa rồi giao ngay").
6. **Gửi đa kênh** (`care-send.js`): ưu tiên Zalo-qua-Pancake; bật `ZALO_OPENAPI_ENABLED=1` để gửi file/ảnh + nhận webhook follow.

> **Đấu data sau:** `medi.js` (Sheet MEDi) và POS (ca ra bill). Khi chưa đấu, nạp ca tay qua `/admin/bill-ingest`. Mọi nguồn fail-open — không cấu hình thì không crash.

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

**4. Bật kênh ZALO OA:** thêm `PANCAKE_PAGE_3_ID/_TOKEN/_CHANNEL=zalo` (Zalo nối Pancake) → tin thường gửi như FB, bộ não Zalo + ENRICH tự kích hoạt. Để **gửi file PDF/ảnh** và **nhận webhook follow**, thêm `ZALO_OPENAPI_ENABLED=1` + token Zalo (`ZALO_ACCESS_TOKEN`/`REFRESH_TOKEN`/`APP_ID`/`APP_SECRET`) và trỏ webhook Zalo Console về `https://<app>.onrender.com/zalo/webhook`.

**5. Nạp ca ra bill (khi POS chưa đấu tự động):**
```bash
curl -X POST "https://<app>.onrender.com/admin/bill-ingest?token=$ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"phone":"0938xxxxxx","name":"Nguyễn Văn A","condition":"goi",
       "has_injection":true,"has_medicine":true,
       "conversation_id":"<convZalo>","page_id":"<pageZalo>",
       "bill_date":"2026-06-30"}'
```
Nhóm tái bill (bước 6) thêm `"group_no":2,"treatment":"PRP","next_session_at":"2026-07-30"`.

**6. Đấu data thật sau:** điền `MEDI_SHEET_*`/`GOOGLE_SA_JSON` (ENRICH) và `POS_SHEET_*` (tự nạp ca ra bill — phần đọc trong `billengine.ingestFromPosSheet()` còn là khung TODO).
