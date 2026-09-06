# BẢN VÁ TĂNG TỈ LỆ RA SĐT — soạn 06/09/2026, **CHƯA DEPLOY, CHƯA PUSH**

Nhánh: `va-tang-ra-sdt-06-09` (local) · file diff: `VA-TANG-RA-SDT-2026-09-06.patch`
Ranh giới: Mục 6 #8 hiến pháp — deploy Render **chờ anh Trình/anh Bảo bấm**. Bản vá KHÔNG nhắn khách,
KHÔNG đổi nhãn, KHÔNG đổi trạng thái đơn. Phần thêm duy nhất có tác dụng ra ngoài là **1 tin Telegram
nội bộ** báo telesale.

---

## 1. Số liệu bản vá dựng trên (nguồn: `pages.fm/api/v1`, USER token `poscake-hieploi`)

Cửa sổ **30/08 → 05/09/2026**, lọc `type=INBOX`, quét hết tới trần rồi mới lọc `inserted_at`
(3.961 hội thoại CXK + 4.000 Dr Nhật Trình quét ra **783** trong cửa sổ). Tách bot/người bằng
`from.admin_name`: `Public API` = bot Gemini · tên người = telesale gõ tay · rỗng = tin hệ thống Meta.

| Lane | Hội thoại | Ra SĐT | |
|---|---|---|---|
| Có người thật gõ tay | 211 | 48 | **22,7%** |
| **Bot Gemini đơn độc** | 397 | 19 | **4,8%** |

**71,6% số SĐT của cả tuần đến từ 34,5% hội thoại mà người thật xen vào.**

**Dí thêm KHÔNG cứu được** (chỉ đếm lượt xin xảy ra TRƯỚC khi khách cho số):

| Mức tương tác | xin 1 lượt | xin 2 lượt | xin 3+ |
|---|---|---|---|
| khách gõ 2 tin | 2,4% | 0,0% (n=3) | — |
| khách gõ 3–4 tin | 8,4% | 2,6% | 0/3 |
| khách gõ ≥5 tin | 27,4% | 10,3% | — |
| bot đơn độc, khách ≥2 tin | 5,6% | 4,3% | 0/1 |

Continuation (khách còn nhắn tiếp) trên **1.485 lượt TRẢ LỜI THẬT**:
1 ô 65,6% · 2 ô 65,0% · 3 ô 55,4% · 4 ô 56,6% · 5+ ô 36,4%.
Theo độ dài: <150 ký tự 64,8% · 150–299 63,0% · 300–449 60,2% · **450–599 43,3%** · ≥600 45,5%.

**1.516/3.001 lượt bot (50,5%) là DẬP CHỦ ĐỘNG lúc khách đang im** — khách quay lại 14,4–20,6%.
**494 ô "câu trung tính"** (`Dạ em vẫn ở đây nè`…) đã gửi; **226/608 hội thoại (37,2%) KẾT THÚC**
bằng chính nó. Lượt có câu trung tính: continuation **24,9%** vs **72,2%** ở lượt không có.

---

## 2. Bốn thay đổi

### VÁ 1 — `system-prompt.md` mục 2 luật A.4: **xin số ĐÚNG 1 LẦN**, khách né thì thôi
Bỏ luật cũ *"lì đòn, xin 1–2 lần, đổi góc"*. Số liệu bác bỏ nó ở cả 3 mức tương tác.
Thay bằng: xin 1 lần đúng lượt khách vừa kể xong bệnh → khách né thì chuyển sang cho giá trị + mời Zalo OA.

**Phép tính kỳ vọng:** 387 lượt xin-lần-2-trở-đi trong 7 ngày biến mất. Nhóm "xin 2 lượt" (89 ca, ra SĐT
20,2% *thô*) — nhưng kiểm soát theo mức tương tác thì 2 lượt **luôn kém** 1 lượt (bảng trên) ⇒ kỳ vọng
là **giữ nguyên hoặc tăng nhẹ tỉ lệ ra SĐT, và tiết kiệm ~387 lượt dí/tuần**. ⚠️ **Đây là quan hệ
TƯƠNG QUAN, không phải nhân quả đã chứng minh** — không loại được khả năng bot xin lần 2 vì cảm nhận
khách đang nguội. Vì vậy vá này phải **đo lại sau 7–10 ngày** bằng đúng bộ thước ở mục 4.

### VÁ 2 — `handler.js`: bot xin số rồi mà khách vẫn nhắn tiếp → **BÁO NGƯỜI**, đừng dí
Thêm `notifyLeadAm()` (telegram.js) + cổng trong `dispatch`: `xinso_count ≥ 1` **và** khách đã nhắn
≥3 tin **và** đã biết bệnh **và** chưa có SĐT **và** chưa handover/booking → bắn **1 tin Telegram/hội
thoại** cho telesale vào gõ tay. Chống spam bằng KV `leadam_notified:<convId>`.

**Phép tính kỳ vọng (nêu rõ giả định):** vùng tác động = **173 hội thoại/7 ngày** (bot đơn độc + khách
≥3 tin + chưa ra SĐT). Chênh lệch lane người − lane bot = 22,7% − 4,8% = **17,9 điểm**.

| Telesale vào được | Thêm SĐT/7 ngày | Thêm điểm KPI#6 (nền 611) |
|---|---|---|
| 10% số ca | +3,1 | +0,51 điểm |
| 20% số ca | +6,2 | +1,01 điểm |
| 30% số ca | +9,3 | +1,52 điểm |

⚠️ **Chỗ chưa chắc (cổng ⑤):** con số 22,7% của lane người là **quan sát**, không phải thí nghiệm —
telesale hiện vào những ca đã nóng sẵn, nên tỉ lệ đó **sẽ tụt** khi phải nhận thêm ca nguội. Bảng trên
là **trần trên**, không phải cam kết. Và nó chỉ thành tiền nếu **telesale thật sự gọi** — 173 ca/tuần
≈ 25 ca/ngày là gánh nặng thật, cần anh Bảo chốt ai nhận.

### VÁ 3 — `pancake.js`: hạ trần **4 → 3 ô/lượt** + thêm **trần 420 ký tự/lượt**
`capChars()` cắt theo Ô (không bao giờ cắt giữa câu), luôn giữ ô link, luôn giữ ≥1 ô.

**Phép tính kỳ vọng:** trong 7 ngày có **89 lượt trả lời ≥450 ký tự** (67 lượt 450–599 + 22 lượt ≥600),
continuation trung bình **43,9%**; nhóm <450 ký tự là **63,3%**. Kéo 89 lượt đó về nhóm ngắn ⇒
**+19,4 điểm × 89 ≈ +17 lượt khách còn nói tiếp/tuần**. Đây là **chỉ số trung gian**, KHÔNG quy thẳng
ra SĐT được — ghi rõ để khỏi thổi phồng.

### VÁ 4 — `config.js` + `handler.js`: cắt spam dập chủ động
- `RETOUCH_MAX_COUNT` 3 → **2**; `RETOUCH_MIN_IDLE_HOURS` 0,4h → **0,75h**.
- `dispatch(..., { chuDong: true })` cho `handleRetouch`: ở lượt dập chủ động, khi cửa chống-lặp xoá
  sạch ô thì **KHÔNG thả câu trung tính nữa — im hẳn**. Luật gốc 20/07 *"thà thừa 1 câu còn hơn im"*
  **GIỮ NGUYÊN cho lượt TRẢ LỜI** (khách đang chờ, im là bỏ rơi lead đã trả tiền quảng cáo).

**Phép tính kỳ vọng:** bỏ được phần lớn **494 ô câu-trung-tính/tuần** và ~1/3 số lượt dập chủ động
(1.516 → ~1.000). Lợi ích chính là **giảm rủi ro mất khách vì phiền** (ca Phuong Ngoc 02/08 mất khách
thật), không phải tăng SĐT trực tiếp.

---

## 3. Giả thuyết ĐÃ KIỂM VÀ BỊ BÁC — đừng vá theo hướng này

1. **"Bot không hỏi số"** → SAI. Bot mở lời xin số ở **498/783 (63,6%)** hội thoại, tức **81,9%** số
   hội thoại nó có trả lời. *(Bản đo đầu ra 34,9% là SAI: hàm bỏ dấu thiếu `replace('đ','d')` nên
   "để lại số" không khớp regex — bẫy đã ghi vào code.)*
2. **"Đưa địa chỉ xong hội thoại chết"** → SAI. 153/611 (25,0%) khách có hỏi địa chỉ/giờ; trong nhóm
   đó bot vẫn xin số ở **95,4%** và tỉ lệ ra SĐT là **11,8% — CAO HƠN** nền chung 11,0%. Con số 25%
   khớp memory `[[inbox-cxk-hoi-dia-chi-25-phan-tram]]` (CXK riêng: 28,1%), nhưng **kết luận "van khoá"
   thì không đứng được**.
3. **"Câu chào Meta *Chúng tôi có thể giúp gì cho bạn?* lọt cửa `AUTO_REPLY_MARKERS` → bot bị chấm là
   telesale gõ tay → câm 2h."** Về CODE thì đúng (`ai_generated:false`, 42 ký tự > `HUMAN_MIN_CHARS`
   12, không khớp marker/exact/pattern nào, không vân tay bot ⇒ rơi vào nhánh `markHumanTaken({confirm:true})`).
   **Nhưng ĐO THẬT thì KHÔNG xảy ra**: 318 hội thoại dính câu chào → bot im **0,0%**, trễ trả lời lần
   đầu **trung vị 25 giây** — y hệt 293 hội thoại không dính (24 giây). Nhiều khả năng Pancake không
   đẩy tin đó qua webhook. **KHÔNG vá.** Ghi lại để lần sau khỏi đi đường cụt.

---

## 4. Bộ thước nghiệm thu (chạy lại sau 7–10 ngày chạy thật)

Script đo: cùng đường của skill `do-ra-sdt-va-cau-moi-gia`, cộng thêm `from.admin_name` để tách lane.

| Thước | Mốc 30/08→05/09 | Đích |
|---|---|---|
| KPI#6 ra SĐT (nền 783) | 8,6% | ≥ 12% |
| Ra SĐT nền "khách có nói" (611) | 11,0% | ≥ 15% |
| **Ra SĐT lane bot đơn độc** | **4,8%** | ≥ 7% |
| Lượt dập chủ động / tổng lượt bot | 50,5% | ≤ 35% |
| Ô "câu trung tính" gửi đi | 494 | ≤ 100 |
| Hội thoại kết bằng câu trung tính | 37,2% | ≤ 15% |
| Lượt trả lời ≥450 ký tự | 89 (6,0%) | ≤ 20 (1,5%) |
| Lượt xin số lần 2+ | 387 | ≤ 50 |
| Số tin `LEAD ẤM` telesale nhận & gọi | 0 | đo được, ≥60% được gọi |

---

## 5. VIỆC CHO ANH — nằm NGOÀI code, máy không tự làm được

1. 🔴 **Kịch bản Pancake đang bắn "📍 Cơ sở 2: Quận 10 — Phòng khám Đa khoa Y Đạo — 46–48 Ngô Quyền"
   (77 lần/7 ngày) và "Hiện tại bên em đang có hai cơ sở ở quận 10 và Tân Phú" (80 lần)** — gửi dưới
   `admin_name = "Phan Nhật Trình"`, **không nằm trong code bot** (bot đã bị cấm 2 chuỗi này ở mục 12
   system-prompt). Đây là quick-reply/kịch bản cài trong Pancake. Cụm `2 cơ sở` / `chi nhánh` là chuỗi
   **CẤM CẢ 2 NHÓM** theo hiến pháp (khối 15/08 tối). Đang chạy trên page CXK = **NHÓM 1**.
   → Cần anh vào Pancake sửa chữ. Máy không có quyền sửa kịch bản Pancake.
2. **Ai nhận 173 ca "LEAD ẤM"/tuần?** Đội telesale hiện 3 người (Thắng · Hana · Yến). ~25 ca/ngày.
   Không chốt người nhận thì tin Telegram của VÁ 2 chỉ là thêm chuông.
3. **Duyệt deploy** nhánh `va-tang-ra-sdt-06-09` lên Render (Mục 6 #8).
