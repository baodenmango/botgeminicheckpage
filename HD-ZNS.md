# HƯỚNG DẪN ZNS/ZBS NHẮC LỊCH (B5) — cập nhật chuẩn ZBS 2026

> Từ 01/01/2026 Zalo gộp ZNS vào chuẩn **ZBS Template Message** — đăng ký mẫu tại
> Zalo Cloud (zalo.cloud / ZCA của OA). Bản chất không đổi: tin theo SỐ ĐIỆN THOẠI,
> khách KHÔNG cần follow OA, mẫu phải được DUYỆT trước (2–3 ngày làm việc).

## Code bot đã sẵn
- `src/zns.js` — gửi qua `business.openapi.zalo.me/message/template`, tự refresh token.
- `src/rebillengine.js` — chạm nhắc lịch `g2_pre3`/`g2_pre1` khi khách KHÔNG có kênh OA → tự bắn ZNS.
- Test: `POST /admin/zns-test?token=ADMIN` body `{ "phone", "ten", "ngay_hen" }`.
- Env kích hoạt sau khi mẫu duyệt: `ZNS_ENABLED=1` + `ZNS_TEMPLATE_NHACLICH=<id>`.

## LUẬT DUYỆT — các bẫy rớt hay gặp (đúc kết từ quy định ZBS)
1. **Chọn ĐÚNG loại tin khi đăng ký** — sai loại là lý do rớt số 1:
   - Xác nhận đặt lịch = loại **Giao dịch** (rẻ nhất, dễ duyệt nhất)
   - Nhắc hẹn / dặn dò sau điều trị = loại **CSKH**
   - Khảo sát sao = loại **Đánh giá (rating)**
2. Câu đầu phải **thể hiện khách ĐÃ có giao dịch** với phòng khám ("đã đặt lịch", "sau buổi điều trị ngày...").
3. **CẤM chèn link/SĐT vào phần chữ** → mọi liên hệ đưa vào NÚT (nút gọi, nút mở OA).
4. Không từ ngữ quảng cáo trong tin Giao dịch/CSKH: "ưu đãi/giảm giá/miễn phí/tặng…" — rớt ngay.
5. Y tế: KHÔNG cam kết kết quả, không "khỏi 100%", không thần thánh hoá — thuần nhắc hẹn/dặn dò.
6. 1 ngôn ngữ thuần Việt, soát chính tả từng chữ (sai chính tả = rớt), không VIẾT HOA TOÀN BỘ.
7. Tham số khai kèm ví dụ thật (ten="Nguyễn Văn An", ngay_hen="15/07/2026").

## BỘ 4 MẪU THEO PHỄU (đăng ký theo thứ tự ưu tiên)

### Mẫu 1 — NHẮC LỊCH TÁI KHÁM/LIỆU TRÌNH (loại CSKH) ← nối vào bot, LÀM TRƯỚC
Tham số: `ten`, `ngay_hen`, `ten_pk`, `sdt_pk` (sdt_pk chỉ dùng cho nút gọi)
```
Nhắc lịch điều trị

Chào <ten>,

<ten_pk> xin nhắc lịch hẹn điều trị tiếp theo của mình vào ngày <ngay_hen>.

Mình đến đúng hẹn để bác sĩ theo dõi sát tiến triển và giữ hiệu quả của
liệu trình đang theo nha.

Cần đổi lịch, mình bấm nút bên dưới để được hỗ trợ.
```
Nút 1: **Gọi phòng khám** → 0962349329
Nút 2: **Nhắn Zalo phòng khám** → mở OA (zalo.me/3136814239074246132)

### Mẫu 2 — XÁC NHẬN ĐẶT LỊCH (loại Giao dịch — rẻ + dễ duyệt nhất)
Tham số: `ten`, `ngay_hen`, `gio_hen`, `ten_pk`
```
Xác nhận lịch hẹn

Chào <ten>,

<ten_pk> xác nhận mình đã đặt lịch khám thành công vào <gio_hen> ngày <ngay_hen>.

Mình vui lòng đến trước giờ hẹn 10 phút và mang theo kết quả cận lâm sàng
gần nhất (nếu có) nha.
```
Nút 1: **Gọi phòng khám** → 0962349329
Nút 2: **Nhắn Zalo phòng khám** → mở OA

### Mẫu 3 — DẶN DÒ SAU ĐIỀU TRỊ/TIÊM (loại CSKH)
Tham số: `ten`, `ngay_dt`, `ten_pk`
```
Dặn dò sau buổi điều trị

Chào <ten>,

Cảm ơn mình đã điều trị tại <ten_pk> ngày <ngay_dt>.

Trong 1–2 ngày đầu, vùng điều trị có thể hơi căng tức nhẹ — mình nghỉ ngơi,
hạn chế vận động mạnh. Nếu thấy sưng đỏ nhiều hoặc sốt, mình liên hệ ngay
với phòng khám để được bác sĩ kiểm tra.
```
Nút 1: **Gọi phòng khám** → 0962349329
Nút 2: **Nhắn Zalo phòng khám** → mở OA

### Mẫu 4 — ĐÁNH GIÁ 5 SAO (loại Rating) — sau hoàn thành liệu trình
Nội dung khung theo form rating của ZBS (chấm 1–5 sao + góp ý).
Lời dẫn: "Cảm ơn mình đã hoàn thành liệu trình tại <ten_pk>. Mình chấm mức độ
hài lòng để bác sĩ phục vụ tốt hơn nha."
→ Khách chấm 4–5 sao: telesale gọi cảm ơn + mời giới thiệu người thân.

## ĐÒN CHUYỂN ĐỔI (vì sao thiết kế như vậy)
- **Nút "Nhắn Zalo phòng khám" trên MỌI mẫu** = cầu hút khách về OA: khách bấm →
  rơi vào hội thoại OA → bot Gemini chăm + mời follow → từ kênh TRẢ PHÍ (ZNS)
  chuyển về kênh MIỄN PHÍ (OA chat 48h). Mỗi tin ZNS là một cơ hội tăng follower.
- Cá nhân hoá tên + ngày cụ thể → tỉ lệ đọc/hành động cao hơn hẳn tin chung chung.
- Giờ gửi vàng: 8h–11h và 15h–19h (ZNS chỉ cho phép 6h–22h).
- `tracking_id` đã cài trong code → sau này đo tỉ lệ gửi thành công/từng chiến dịch.
