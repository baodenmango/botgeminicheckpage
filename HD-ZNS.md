# HƯỚNG DẪN BẬT ZNS NHẮC LỊCH (B5)

> ZNS = tin nhắn Zalo gửi theo SỐ ĐIỆN THOẠI, khách **không cần follow OA**.
> Dùng cho nhắc lịch liệu trình (PRP/biogen/TBG cách 1 tháng — khách rất hay quên).
> Phí ~200–350đ/tin, trừ ví Zalo Cloud Account (ZCA) — ví đã nạp khi mua gói Tăng trưởng.

## Code đã sẵn (deploy xong là chờ template)
- `src/zns.js` — gửi ZNS qua `business.openapi.zalo.me/message/template`, tự refresh token.
- `src/rebillengine.js` — chạm nhắc lịch `g2_pre3`/`g2_pre1` mà khách **không có kênh OA**
  → tự bắn ZNS theo SĐT (đánh dấu done như chạm thường).
- Test tay: `POST /admin/zns-test?token=ADMIN` body `{ "phone": "09...", "ten": "Anh Ba", "ngay_hen": "15/07/2026" }`.
- Quyền API "Gửi tin qua số điện thoại" + "Quản lý Message Template" **đã cấp** trong lần OAuth 07/07.

## Việc anh Trình làm 1 lần (10 phút + chờ Zalo duyệt 1–2 ngày)
1. Vào **https://zns.oa.zalo.me** (đăng nhập Zalo admin OA) → chọn OA Phòng khám.
2. **Tạo template mới** → loại **"Chăm sóc khách hàng"** (nhắc hẹn) → dán nội dung dưới.
3. Khai 4 **tham số** đúng tên: `ten`, `ngay_hen`, `ten_pk`, `sdt_pk`.
4. Gửi duyệt. Khi trạng thái **Đã duyệt** → copy **Template ID**.
5. Lên Render thêm 2 env rồi Save:
   ```
   ZNS_ENABLED=1
   ZNS_TEMPLATE_NHACLICH=<template_id vừa duyệt>
   ```

## Nội dung template gợi ý (đã né từ cấm quảng cáo y tế)

**Tiêu đề:** Nhắc lịch hẹn điều trị

**Nội dung:**
```
Chào <ten>,

<ten_pk> xin nhắc lịch hẹn điều trị của mình vào ngày <ngay_hen>.

Mình vui lòng đến đúng hẹn để đảm bảo tiến độ và hiệu quả của liệu trình đang theo.

Cần hỗ trợ hoặc đổi lịch, mình gọi <sdt_pk> nha.
```

**Nút (button):** `Gọi phòng khám` → số `0962349329`

> Lưu ý khi Zalo duyệt: template nhắc hẹn thuộc nhóm "hậu mãi/CSKH" — KHÔNG chèn
> nội dung khuyến mãi/quảng cáo (sẽ bị từ chối). Nội dung trên là thuần nhắc hẹn, dễ đậu.
