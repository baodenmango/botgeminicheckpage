# VÁ **NÃO** BOT GEMINI — LỜI LẼ & CHIẾN THUẬT CHỐT SỐ (06/09/2026)

Nhánh: `va-tang-ra-sdt-06-09` (local) · **CHƯA DEPLOY, CHƯA PUSH** (Mục 6 #8 hiến pháp).
Bản này **đi sau và không chồng lấn** `VA-TANG-RA-SDT-2026-09-06.md` — bản kia vá **cơ khí**
(độ dài, số lần xin, dập chủ động, báo telesale); bản này vá **LỜI LẼ + PHÂN NHÁNH KHÁCH**.

**Nguồn số:** `pages.fm/api/v1`, USER token `poscake-hieploi`. Cửa sổ **30/08→05/09/2026**,
`type=INBOX`, quét hết tới trần rồi mới lọc `inserted_at` — **783 hội thoại** (CXK 200 + Dr Nhật
Trình 583), trong đó **607 hội thoại khách CÓ NÓI**, **67 ra SĐT = 11,0%**. Tách lane bằng
`from.admin_name` (`Public API` = bot Gemini · `Phan Nhật Trình` = người gõ tay · `Botcake` =
kịch bản Pancake · tên page = tin hệ thống Meta). Bộ số này **tái lập đúng** bản đo phiên trước
(bot đơn độc 19/397 = 4,8% · có người 48/210 = 22,9%) — hai lần đo độc lập trùng nhau.

⚠️ **Mức phát ngôn:** mọi con số dưới đây là **QUAN SÁT**, không phải nhân quả đã chứng minh.
Không loại được chiều ngược (bot chọn câu nào tuỳ theo khách đang nóng/nguội). Vì vậy mục 4
là bộ thước bắt buộc chạy lại sau 7–10 ngày.

---

## 1. Việc đã làm

| File | Đổi gì |
|---|---|
| `system-prompt.md` | **THÊM mục 4B — "LUẬT CHỐT SỐ: ĐỔI LẤY, ĐỪNG XIN TRỐNG"** (khung lý do đo được · luật đổi ngang · 4 điểm người-hơn-bot · **6 nhánh theo nhóm khách** · 3 câu phải xoá · lỗi nhận nhầm khách cũ). **SỬA** mục 1 (cách trả lời giá), mục 4 (bảng 5 kiểu khách), mục 5 bước 4, mục 5B, mục 8, mục 8B ④, mục 8D, mục 9. **GỠ 3 mâu thuẫn nội bộ** đang có sẵn trong não. |
| `src/handler.js` | Thay **4 câu phao trung tính** — đều là ngõ cụt — bằng 4 câu **luôn để lại câu hỏi mở**. |
| `src/touches.js` | Thay **5 biến thể chạm-2** (gộp cả "suất tư vấn" lẫn "tư vấn miễn phí") bằng 5 câu **khung ĐẶT LỊCH**. |

`node --check` PASS trên cả 2 file JS. **Không** đụng ngân sách, **không** nhắn khách, **không** deploy.

---

## 2. Phát hiện lớn nhất — khung lý do xin số đang dùng là khung YẾU NHẤT

Đo **lượt xin số ĐẦU TIÊN** của mỗi hội thoại, chia theo độ nồng (để không lẫn với "khách nồng thì bot xin nhiều"):

| Khung ở lượt xin ĐẦU | khách gõ 2–3 tin | khách gõ 4–6 tin | bot đang dùng |
|---|---|---|---|
| **B. ĐẶT LỊCH** — "giữ lịch / khỏi chờ / xác nhận giờ" | **7,7%** (n=13) | **55,6%** (n=9) | chỉ **22** lần |
| XIN TRỐNG, không kèm lý do nào | 0,0% (n=44) | **25,0%** (n=32) | 76 lần |
| C. khan hiếm "suất tư vấn giữ riêng" | 2,9% (n=69) | 23,5% (n=17) | 88 lần |
| **A. "tư vấn MIỄN PHÍ / không mất gì"** | **2,7%** (n=255) | **13,7%** (n=131) | **386 lần — mặc định** 🔴 |
| D. "không hợp thì thôi" | 3,6% cả cụm (n=28) | | 28 lần |

🚨 Câu **"không hợp thì thôi ạ"** (3,6%) chính là câu mẫu mà **bản vá cơ khí sáng nay vừa ghi vào não**
làm câu hạ-rào-cản. Đã gỡ trong bản này. Đây là ví dụ đúng của luật "cấm số cảm tính".

⚠️ n của khung ĐẶT LỊCH nhỏ (13 và 9). Hướng nhất quán ở **cả hai** mức nồng và khớp với cách người
thật gõ tay — nhưng **55,6% không phải cam kết**.

---

## 3. MƯỜI CẶP TRÍCH ĐỐI CHIẾU — người làm được / bot làm hỏng (nguyên văn)

### ① Người biến TRỞ NGẠI thành ĐIỀU KHOẢN — bot thả câu ngõ cụt
*(CXK `28891934697071360`, Hoàng Cương, Vĩnh Long)*
> **KH:** "Mình đang phải làm o tien gọi được phải 5h mới nghỉ làm"
> ⛔ **BOT:** "Dạ mình cứ nhắn em bất cứ lúc nào cần nha ạ 🙏"
> ✅ **NGƯỜI:** "Dạ vâng cho em xin số điện thoại để được hỗ trợ nhé, **sau 5h em sẽ gọi mình nhé.**"
> **KH:** "Số điện của mình 0947156656"

**Bài học:** trở ngại của khách là **nguyên liệu của lời hẹn**, không phải chướng ngại phải lờ đi.

### ② Người đưa LỰA CHỌN ĐÓNG — bot hỏi mở
*(DrNT `28237817595872824`, Nguyễn Huyền)*
> **KH:** "Em chưa rảnh ạ" / "Khi nào rảnh em a lo ạ"
> ✅ **NGƯỜI:** "Dạ mai em còn lịch trống bên quận tân phú **lúc 9h hoặc 4h chiều** — Em lên lịch giúp mình nhé chị"
> **KH:** "0939447293"

⚠️ **Bot KHÔNG được bắt chước nguyên xi** — bot không giữ lịch thật, bịa giờ trống là sai (mục 8D điểm 2).
Bản vá dạy bot dùng **lựa chọn hai đường không bịa**: *"Mình tiện sáng hay chiều ạ?"* → *"Khoảng mấy giờ ạ, em ghi vào lịch."*

### ③ Câu chốt của người: **1 ô, ~20 chữ**. Bot bọc trong 3 ô đồng cảm
*(DrNT `28712407351698525`, Hoàng Sơn)*
> ✅ **NGƯỜI:** "Dạ mình cho em xin số điện thoại để hỗ trợ giải đáp kĩ về bệnh và đăng ký lịch khám của mình nhé."
> **KH:** "0989746471"

**Luật mới:** **lượt CHỐT SỐ chỉ được 1 ô.** Đồng cảm để ở lượt TRƯỚC.

### ④ 🔴 GIÁ — bot viện "quy định Sở Y tế" và mất khách đã sẵn sàng đi tiêm
*(DrNT `28627862733485671`, Song Hương — MẤT)*
> **KH:** "Hợp lý thì đến khám và tiêm. Ví dụ 1 mũi bao nhiêu"
> ⛔ **BOT:** "bên em **tuân thủ quy định của Sở Y tế** nên không báo được khoảng giá chi phí điều trị qua tin nhắn"
> **KH:** "Giá ko công khai ko ai dám đến khám. đường đi xa xôi"
> ⛔ **BOT:** "Bên em có **quy định rõ ràng là không được báo giá** điều trị qua tin nhắn…"
> **KH:** "Vậy là còn mập mờ quá ko ai muốn đến" → "**Thôi cám ơn bạn**" → "Hỏi cũng ko có kết quả. Để đi viện khám"

**vs. cùng câu hỏi, ca CHỐT ĐƯỢC** *(DrNT `28081080531500784`, Huỳnh Tuấn Dũng)*:
> **KH:** "tôi muốn tiêm 1mũi bao nhiêu tiền vậy"
> ✅ **BOT:** cho ngay gói khám **300.000đ** (gốc 1.300.000đ) → giải thích **một lần** vì sao chưa có con số mũi tiêm
> **KH:** "0938373748"

**Khác nhau ở đâu:** ca thắng **từ chối ĐÚNG MỘT LẦN và cho ngay con số mình có**; ca thua **lặp lời từ chối
4 lượt bằng một lý do bịa**. Nhóm hỏi giá chung chung là nhóm **kém nhất: 2,5% (n=40)**.
⛔ Bản vá **cấm tuyệt đối** viện dẫn "quy định Sở Y tế" và **cấm lặp câu từ chối ở lần hỏi thứ hai**.

### ⑤ ĐỊA CHỈ — người hỏi đường là người ĐÃ QUYẾT; bot lại lùi về "tư vấn miễn phí"
**CHỐT ĐƯỢC** *(DrNT `39135351812730454`, Huỳnh Chí Lân)*:
> **KH:** "Phòng khám ở đâu mình tới trực típ"
> ✅ **BOT:** địa chỉ + link Maps + giờ → "Anh Lân cho em xin số điện thoại **để em giữ lịch cho mình, đỡ phải chờ lâu khi tới** nha ạ 😊"
> **KH:** "0917882882"

**MẤT** *(CXK `28194456526870708`, Ngân Phạm)*:
> **KH:** "Phòng khám mình ở đâu ạ"
> ⛔ **BOT:** địa chỉ → rồi **4 lượt liên tiếp** "Suất tư vấn với Bác sĩ Trình em đang giữ riêng cho mình hôm nay…" (lặp **y nguyên 2 lần cách 16 phút**) → khách im hẳn.

### ⑥ KHÁCH Ở XA (21,4% — **cao gấp đôi nền**) — bán CUỘC GỌI, đừng bán CHUYẾN ĐI
**CHỐT ĐƯỢC** *(CXK `39088577010729566`, Thy Le — Quảng Nam, con nhỏ)*:
> **KH:** "E con nhỏ ko đi đc xa vậy"
> ✅ **BOT:** "Bác sĩ sẽ gọi **tư vấn online** miễn phí cho mình trước… Bác sĩ sẽ **hướng dẫn mình cách chăm sóc tại nhà** để đỡ khó chịu hơn ạ."
> **KH:** "0935003966"

**MẤT** *(CXK `28684807354477233`, Ngoc Le — Nha Trang)*:
> **KH:** "Vây xa qua cô khô cô không điêu kiên vô toi đo bac si oi" → "nho bac si co thuôc gi uông không giup dum cô voi"
> ⛔ **BOT:** "Bác sĩ không kê thuốc qua tin nhắn được đâu cô ạ" (**từ chối mà không đưa gì thay thế**) → rồi **6 lượt xin số** trong 4 tiếng (23:16 · 23:17 · 01:07 · 01:21 · **01:22 lặp y nguyên câu 01:21** · 03:10) → khách im hẳn.

### ⑦ "CHỮA NHIỀU NƠI KHÔNG HẾT" — bán ĐỌC LẠI HỒ SƠ, đừng bán "khám lại"
*(DrNT `28395877553400809`, Ly Nguyễn — MẤT)*
> **KH:** "Khám tại BV chợ rẫy rồi… BS bảo chích thuốc dịch nhờn một mũi tới 5 triệu chưa có tiền chích" → "Rồi giờ sao"
> ⛔ **BOT:** "Bên em có **gói khám tổng quát chỉ 300k** để Bác sĩ Trình khám lại…"
> **KH:** "**Khám rồi khám lại làm gì thêm tốn tiền** nó cũng chỉ là vậy thôi"

**Luật mới:** nhóm này (n=25, 8,0%) phải được bán **thứ họ chưa từng có — một người đọc lại toàn bộ phim + toa cũ**,
và phải **công nhận công sức chữa của họ TRƯỚC** khi nói "ưu tiên bảo tồn".

### ⑧ CÂU NGÕ CỤT — dội 6 lần vào một khách
*(DrNT `26103955399301424`, Hong Gam Le)*
> **BOT:** "Dạ mình cứ nhắn em bất cứ lúc nào cần nha ạ 🙏" — **7 lần trong 1 hội thoại**, có lúc 2 lần **cách nhau 34 giây** (13:38:01 và 13:38:35).
> **KH:** "Lúc nào có thời Gian rảnh chị sẽ vào gặp bs ạ" → ⛔ **BOT:** "khi nào chị sắp xếp được thì cứ báo em nha" → hết.

Toàn cửa sổ: **395 ô / 363 hội thoại**; nhóm dính câu này ra SĐT **6,4%** vs nền 11,0%; **37,2% hội thoại
KẾT THÚC bằng đúng câu đó**. ⇒ đã thay pool trong `handler.js` bằng 4 câu **luôn kết bằng câu hỏi mở**.

### ⑨ 🐞 BOT NHẬN NHẦM KHÁCH CŨ — bắn đúng vào nhóm khó nhất
*(DrNT `28788074970777187`, Thuy Trang)*
> **KH:** "**Mẹ mình đa đi khám ở Bv** và Bv có yêu cầu là phải tiêm dịch nhờn vào khớp gối"
> ⛔ **BOT:** "Dạ em cảm ơn mình **đã tin tưởng ghé khám tại Hiệp Lợi** nha ạ 🌿 / Mình cho em xin số điện thoại **đã đăng ký lúc khám** để em nối đúng hồ sơ…"

**6 ô / 3 hội thoại, ra SĐT 0,0%** — và cả 3 đều rơi vào nhóm hỏi giá / chữa-nhiều-nơi. Khách đọc câu này
là biết chắc đang nói chuyện với máy. ⇒ luật mới: chỉ coi là khách cũ khi hệ thống báo `MODE: CARE`;
khách tự kể "đã khám" thì **mặc định là NƠI KHÁC**, không chắc thì **hỏi**.

### ⑩ CHÀO TRỐNG (18,8% lượng khách) — bot hỏi câu mở 3 vế cho người vừa gõ 2 ký tự
*(CXK `28362109680052531`, Y Nhu Tran)*
> **KH:** "dạ chào bsĩ"
> ⛔ **BOT:** "Mình đang gặp vấn đề gì về xương khớp vậy Nhu ơi, **đau ở đâu và bị lâu chưa** ạ?"

Khách gõ **trung vị 24 ký tự/tin**. ⇒ luật mới: hỏi **1 câu ĐÓNG** để khách chỉ cần gõ 1 chữ —
*"Mình đang đau **gối, lưng hay vai** ạ?"*

---

## 4. Ba mâu thuẫn NỘI BỘ của bộ não — đã gỡ

| Mâu thuẫn | Xử lý |
|---|---|
| Mục 5B nói *"tối đa **3 lần** xin số/hội thoại"* — trong khi VÁ 1 sáng nay chốt **1 lần** | Sửa 5B về **1 lần**, dẫn số (3–4 tin: 8,4%→2,6% · ≥5 tin: 27,4%→10,3%) |
| Mục 1 cấm *"báo khoảng **từ…**"* — mục 8B ④ lại bảo đưa *"khung **từ** của điều trị"* | Bỏ vế ở 8B ④: bot **không có** bảng giá thủ thuật ⇒ nêu khoảng là **bịa số** (Điều 2 hiến pháp) |
| Mục 5B cho phép *"suất tư vấn"* 1 lần, mục 9 nhắc lại; nhưng đo được 2,9% | **BỎ HẲN (0 lần)** cụm khan-hiếm-bịa; **GIỮ** cụm "giữ chỗ/giữ lịch/khỏi chờ" vì đó là tiện lợi **có thật** |

---

## 5. Bộ thước NGHIỆM THU (chạy lại sau 7–10 ngày chạy thật)

**Đã đóng gói thành script chạy được:**

```bash
python3 scripts/do-chot-so.py 2026-09-07 2026-09-16     # <ngày đầu> <ngày cuối>
```

Chỉ-đọc, fail-closed khi token hỏng, đã vá sẵn 5 bẫy (sắp theo `updated_at` · con trỏ
`current_count` chứ không phải `page` · `limit` không được tôn trọng · bỏ dấu thiếu `đ→d` ·
cấm báo 0% khi token chết). Chạy lại trên chính cửa sổ nền thì ra **đúng 783 / 607 / 11,0% /
4,8%** — trùng cả bản đo phiên trước lẫn bản đo phiên này.

🚨 **ĐƠN VỊ — đừng so nhầm vế.** Bảng dưới có dòng đếm theo **hội thoại ở lượt-xin-ĐẦU**, còn
script đếm theo **Ô (bong bóng) trên toàn hội thoại**. Hai đơn vị khác nhau. Script đã in kèm
**mốc do CHÍNH NÓ đo** trên cửa sổ nền — **chỉ so số của script với mốc của script**.

| Thước | Mốc 30/08→05/09 | Đích |
|---|---|---|
| Ra SĐT nền "khách CÓ NÓI" (607) | **11,0%** | ≥ 15% |
| Ra SĐT lane **bot đơn độc** | **4,8%** | ≥ 7% |
| — nhóm **hỏi ĐỊA CHỈ/giờ** (n=142) | 10,6% | ≥ 18% *(nhóm đã quyết đi khám)* |
| — nhóm **hỏi GIÁ chung** (n=40) | **2,5%** | ≥ 7% |
| — nhóm **hỏi GIÁ MŨI TIÊM** (n=45) | 11,1% | ≥ 15% |
| — nhóm **chào trống** (n=36) | 8,3% | ≥ 12% |
| — nhóm **"chữa nhiều nơi"** (n=25) | 8,0% | ≥ 14% |
| — nhóm **ở xa** (n=28) | 21,4% | giữ ≥ 21% *(đừng làm hỏng)* |
| Ô có cụm **"suất tư vấn"** | 88 | **0** |
| Ô có **"không hợp thì thôi"** | 28 | **0** |
| Ô viện dẫn **"Sở Y tế"** để né giá | 3 | **0** |
| Ô **"cứ nhắn em bất cứ lúc nào cần"** | 395 | ≤ 40 |
| % hội thoại **KẾT THÚC** bằng câu ngõ cụt | **37,2%** | ≤ 15% |
| Lượt xin số dùng khung **ĐẶT LỊCH** | 22 | ≥ 150 |
| Lượt xin số dùng khung **"miễn phí"** làm lý do chính | 386 | ≤ 80 |
| Ô nhận nhầm khách cũ ("ghé khám tại Hiệp Lợi") | 6 | **0** |
| Độ dài lượt bot, trung vị/ô | 102 ký tự | ≤ 70 |

---

## 6. 📋 VIỆC CHO ANH — máy không tự làm được

1. 🔴 **CẤP BẢNG GIÁ THỦ THUẬT THẬT cho bot đọc trong INBOX.** Đây là **đòn bẩy đơn lẻ lớn nhất** còn lại:
   nhóm hỏi giá là nhóm ra SĐT **kém nhất (2,5%)**, và anh đã chốt **11/08 + 15/08 + 06/09** rằng
   **inbox được báo giá thủ thuật**. Cái đang chặn **không phải luật — mà là bot không có số nào để đọc**,
   nên nó phải né, và né thì khách bỏ đi (ca Song Hương 01/09). Cần anh cho: giá tiêm dịch nhờn/HA ·
   PRP · corticoid — mức hoặc khoảng, và **nói rõ inbox có được xác nhận "phòng khám có làm" hay chỉ
   được nói "Bác sĩ làm tại cơ sở Q10"**. Có 2 thứ đó, em gắn thẳng vào mục 1 và mở hẳn nhánh 🅑.
2. 🔴 **Kịch bản Pancake vẫn bắn "📍 Cơ sở 2: Quận 10 — PK Đa khoa Y Đạo — 46–48 Ngô Quyền" trên page CXK.**
   Xác nhận lại trong cửa sổ này (ca `28362109680052531` ngày 04/09, gửi dưới `admin_name = Phan Nhật Trình`).
   Page CXK là **NHÓM 1** ⇒ cụm "Y Đạo / 46-48 Ngô Quyền" là chuỗi **CẤM** với Nhóm 1 (khối 15/08 tối).
   **Không nằm trong code bot** — máy không sửa được kịch bản Pancake. *(Đã nêu ở bản vá cơ khí, nhắc lại vì vẫn còn.)*
3. **Duyệt deploy** nhánh `va-tang-ra-sdt-06-09` lên Render (Mục 6 #8) — gồm cả bản vá cơ khí lẫn bản vá não này.

---

## 7. Chỗ CHƯA CHẮC (cổng ⑤ chuẩn đề xuất tiền)

1. **Tất cả là quan sát, không phải thí nghiệm.** Không loại được chiều ngược: bot có thể chọn khung
   "giữ lịch" đúng lúc khách đang nóng sẵn. Bảng ① đã kiểm soát theo độ nồng nhưng **n của khung
   ĐẶT LỊCH chỉ 13 và 9**.
2. **Lane "người thật" lẫn kịch bản Pancake.** `admin_name = "Phan Nhật Trình"` chứa **cả** tin gõ tay
   **lẫn** quick-reply cài sẵn (khối địa chỉ, câu "hai cơ sở"). Con số 22,7% vì vậy là "**có người can
   thiệp**", không thuần "người gõ tay".
3. **Nhóm khách phân bằng từ khoá + đọc mắt ~60 hội thoại**, không phải đọc hết 607. Nhóm nhỏ
   (lo biến chứng n=10, đã mổ n=5) **quá nhỏ để quyết**, chỉ dùng để chỉ hướng.
4. **`has_phone` là SĐT bắt được trong hội thoại**, không phải khách đã được gọi, càng không phải ra tiền.
   Nối sang doanh thu vẫn cần join OmiCall + POS.
5. **Chưa đo được nhánh nào của bản vá cơ khí đã ăn** — hai bản vá vào cùng lúc thì **không tách được
   công**. Nếu cần biết cái nào ăn, phải thả lệch ngày; hiện tại chấp nhận đo gộp.
