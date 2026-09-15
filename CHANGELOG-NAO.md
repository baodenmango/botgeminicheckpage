# CHANGELOG-NAO.md — sổ địa tầng của 2 file não (KHÔNG nạp vào model)

> **Vì sao có file này (đại tu 15/09/2026, bước 5):** `system-prompt.md` từng chứa 5 đời vá chồng lên nhau —
> strikethrough `~~…~~`, "câu cũ ĐÃ BỎ", số đo (n=40, 2,5%…), changelog ngày tháng. Model không cần đọc
> luật chết; người bảo trì thì cần. Từ nay: **não chỉ giữ luật ĐANG SỐNG — mọi tầng cũ bóc về đây, ghi rõ
> mục gốc.** Test `test/prompt-lint.test.js` canh 2 chiều: câu chết không được mọc lại trong não, và mục
> sống/mục mới không được cắt oan.
>
> ⚠️ Các mục GIỮ NGUYÊN VĂN theo ràng buộc thiết kế (không đụng, kể cả strikethrough bên trong):
> **4B ①→⑥ · 4C · luật A.1–A.6 + 4b (mục 2) · 2B · 6B · 10/10B/10C/11** (mục 10 chỉ sửa đúng 2 con số
> lệch theo thiết kế C) · **💰 BẢNG GIÁ** (nằm ở `gia-va-uu-dai.md`, không đụng).

---

## 1. MỤC MỚI đã chèn vào `system-prompt.md` (Phần 2-A thiết kế)

| Mục | Vị trí | Nguồn |
|---|---|---|
| **0. PHÂN LOẠI Ý ĐỊNH** (bảng 7 ô) | sau 1B, trước mục 2 | P0 — nguyên văn thiết kế |
| **⚡ LUẬT TRẢ LỜI TRƯỚC — DẪN DẮT SAU** | ngay trước 5B | P1 — đề xuất vòng phân tích, đủ 3 gạch + dòng chốt |
| **4D XÃ GIAO / HÂM MỘ** (ca Hoa Thuy 14/09) | sau 4C | P2 |
| **4E KHÔNG ĐAU / ĐÃ ỔN** | sau 4D | P3 |
| **4F NHIỀU TIN LIỀN + thẻ [QUẢNG CÁO KHÁCH VỪA BẤM]** (ca Lương Tờ Rình 14/09) | sau 4E | P4 (gộp 2 đề xuất) |
| **4G CHÀO TẠM BIỆT + ĐÊM KHUYA SAU 22H** | sau 4F | P5 (gộp 2 đề xuất) |
| **4H Ở XA — bán giải pháp cho cái xa** (3 cửa; cơ sở 2 Quận 10 CHỈ inbox) | sau 4G | P6 — nguyên văn thiết kế |
| **4I thẻ [MÁY DÒ TỪNG NGHI KHÁCH KHÓ CHỊU VÌ TIN NHẮN NHƯNG ĐÃ BÁC]** | sau 4H | P7 — rút gọn, chỉ phần dạy model xử thẻ (phần phán quyết chạy ở classifier riêng, thiết kế 1.1–1.2) |

Biên tập duy nhất so với bản gốc P6: ví dụ CẤM *"không xa lắm đâu ạ"* viết lại thành *«đâu có xa lắm ạ»* —
vì prompt-lint cấm chuỗi chết `không xa lắm đâu ạ` xuất hiện lại trong não dưới MỌI dạng (kể cả làm ví dụ).

## 2. TÁM CHỖ SỬA CHỮ (Phần 2-B) — chữ CŨ nguyên văn để tra

1. **Mục 7:** ~~"**Không trả lời cụt rồi im.** Mỗi lượt vẫn dẫn dắt tiến thêm 1 bước về phía SĐT — nhưng nhẹ, từng chút, không dồn."~~ → thêm ngoại lệ xã giao/tạm biệt/báo ổn (4D/4E/4G).
2. **Mục 5B câu mở:** ~~"Tin ĐẦU TIÊN khi khách mới nhắn: mở bằng **ĐỒNG CẢM với nỗi đau của khách + 1 câu hỏi triệu chứng cụ thể**…"~~ → đọc HẾT tin trước; công thức lọc triệu chứng CHỈ khi khách chưa nói gì cụ thể; xã giao → 4D.
3. **8B⑥:** ~~"KHÔNG trả lời lệch tin khách vừa nói (đọc kỹ tin cuối). Khách hỏi A đừng đáp B."~~ → đọc TẤT CẢ tin kể từ lượt đáp trước; hỏi A+B đáp cả A lẫn B.
4. **Mục 3:** thêm bước 0 "Khách này ĐANG CẦN GÌ?" + cấm gán bệnh/cảm xúc khách chưa nói (nhắn khuya ≠ đang đau).
5. **8B③:** ~~"Khách TEST/troll/hỏi linh tinh… Đáp 1 câu dí dỏm ngắn rồi kéo về đúng việc"~~ → tách (a) TROLL (kéo về việc như cũ) vs (b) XÃ GIAO THẬT LÒNG (đi 4D, cấm kéo về "đau chỗ nào").
6. **Mục 8 khách lưỡng lự:** ~~"hạ rào cản tối đa: 'Mình cứ để lại số, Bác sĩ gọi tư vấn miễn phí, thấy hợp thì mình tới, không thì thôi, không sao ạ 😊'"~~ → khung ĐẶT LỊCH 4B ① / luật A.5. (2 cụm trong câu cũ đều đã bị đo bác: "miễn phí" 8,5% · "không thì thôi" họ hàng "không hợp thì thôi" 3,6%, nền 11,0%.)
7. **Mục 8 khách ở xa:** ~~"'không xa lắm đâu ạ' / 'bên em tư vấn qua điện thoại trước được' → vẫn xin số."~~ → nhánh 🅕 4B ④ + 3B + 4H, bán CUỘC GỌI không bán CHUYẾN ĐI.
8. **`system-prompt-zalo.md`:** ① khối ⛔ LUẬT DMKT 10/08 (nguyên văn: *"TUYỆT ĐỐI không nói phòng khám có / làm / thực hiện và không báo giá: tiêm nội khớp · … · mổ. Khách hỏi thẳng → 'Dạ hướng điều trị thì Bác sĩ khám trực tiếp mới tư vấn phù hợp…'"* + sub-bullet ngoại lệ BN_CŨ) thay bằng 1 dòng "bản 10/08 chỉ còn áp cho ZNS/broadcast/bài công khai — chat 1-1 theo khối 06/09". Nội dung sống của sub-bullet BN_CŨ vẫn nằm ở mục 2A (thẻ `[QUY TRÌNH CHĂM SÓC SAU KHÁM]`); ② dòng mục 5 ranh giới: ~~"KHÔNG báo giá con số cụ thể"~~ → giá CHỈ theo 💰 BẢNG GIÁ (4 mức, giữ chữ "từ"); ③ dòng mục 7: ~~"Hỏi giá: không báo số → lái giá trị…"~~ → đi đúng 3 nhịp 💰 BẢNG GIÁ như bên Facebook. (Não Zalo trước đó 3-chọi-1 nghiêng về luật chết — gốc bệnh né giá.)

## 3. TẦNG CŨ đã bóc khỏi `system-prompt.md` (Phần 2-C) — theo mục gốc

- **Mục 1 (bảng giá + DMKT):** bỏ các nhãn changelog "🟢 CẬP NHẬT 06/09 — ANH TRÌNH ĐÃ CẤP BẢNG GIÁ", "🔴 NHƯNG CÁCH TỪ CHỐI HIỆN TẠI ĐANG GIẾT… SỬA 06/09" (số đo: nhóm hỏi giá chung ra SĐT 2,5% n=40, nền 11,0%; ca 01/09 khách *"mập mờ quá không ai muốn đến"*), "✅ NÚT THẮT NÀY ĐÃ MỞ (06/09) … anh Trình chốt 11/08 · 15/08 · 06/09", strikethrough ~~Bản 10/08 cũ: "TUYỆT ĐỐI KHÔNG nói phòng khám CÓ/LÀM/THỰC HIỆN…"~~, ghi chú hồ sơ `H29.19-260729-180177` hạn xử 16/10/2026, nhịp 3-bước lặp (nay chỉ trỏ 4B ④ 🅑). Dòng "Dịch vụ ĐƯỢC NÊU… *(Các thủ thuật khác: xem luật DMKT — không nêu)*" gộp vào dòng phương châm (vế "không nêu" đã chết từ 06/09).
- **Mục 2 (phần trước luật A):** câu "Nguyên tắc vàng" bị lặp ĐÔI (2 dòng gần y hệt) — giữ bản đầy đủ; khối "VÌ SAO phải kéo vào Zalo OA" gộp vào đích #3; 3 bullet cách mời OA gộp còn 2.
- **Mục 3:** 4 bullet "cách hỏi gài" gộp 1 dòng (giữ đủ 4 câu).
- **3B:** đoạn "Vì sao" 3 dòng nén 1; bảng "3 việc PHẢI / 3 việc CẤM" (6 hàng) nén thành 2 dòng chữ (giữ đủ ý: gom MỘT buổi + dặn mang phim cũ · hẹn mở "khi nào vào TP.HCM" · cấm từ chối/đẩy đối thủ/nhắc lại chuyện xa) + trỏ 4H.
- **Mục 4 (bảng 5 kiểu khách):** hàng Phân vân: gỡ nhãn "⛔ SỬA 06/09: bỏ ~~…~~" → ghi trần "khung đã bỏ, xem 4B ①".
- **Mục 5:** nhãn "(VÁ 06/09…)" + strikethrough ~~"…tư vấn miễn phí thôi ạ"~~ (đo: 386 lần, 2,7%/13,7% so khung ĐẶT LỊCH 7,7%/55,6%) + ~~khan hiếm "suất tư vấn trong hôm nay"~~ (88 lần, 2,9%) — gộp thành 1 dòng "tất cả đã BỎ". 4 bước gộp nhãn+ví dụ mỗi bước 1 dòng.
- **5B:** khối "⚠️ VÁ 11/07" (số đo: lặp "suất tư vấn" 54% hội thoại; nhắc 2+ lần ra số 7% vs 17%) bóc; ghi chú "18,8% lượng khách" chào trống; khối khan hiếm bỏ nhãn "SỬA 06/09 — TÁCH LÀM HAI" + số đo 88 lần/2,9%; bỏ 1/3 câu ví dụ tone (câu "vai gáy tê xuống tay… để lâu khó chữa lắm"); LUẬT ĐỌC RA NGƯỜI THẬT: bỏ nhãn "(VÁ 02/08)", item 2 rút về trỏ luật A.4+A.5 mục 2 (một nguồn duy nhất — số đo 8,4%→2,6% · 27,4%→10,3% vẫn nằm nguyên văn trong luật A.4).
- **Mục 6:** 9 hàng bệnh "chưa có trang" gộp 1 hàng (giữ đủ 9 mã `ngontay cochan hang chomdui loangxuong dequervain ongcotay tenniselbow gangotchan`).
- **Mục 7:** số đo "≥5 bong bóng khách bỏ đi / người thật ~1,9 bóng/lượt" + trần "1–2 tin/3 bong bóng" → trỏ về 6B (một nguồn).
- **Mục 8 hỏi giá:** cả đoạn dài (3 nhịp chép lại + strikethrough ~~"em không báo giá điều trị qua tin nhắn được ạ"~~ + nhãn SỬA 06/09) → 1 dòng trỏ 4B ④ 🅑 + 💰 BẢNG GIÁ.
- **8B④:** bỏ chú "(Câu 'đã bỏ khung từ' ban sáng nay LỖI THỜI…)" + dải giá chép lại → trỏ 💰 BẢNG GIÁ.
- **Mục 9 (re-touch):** bỏ nhãn SỬA 06/09 ×3 + strikethrough ~~"hoặc khan hiếm / ưu đãi / tư vấn miễn phí"~~, ~~"xoay câu chốt số, mỗi lần một cách"~~ + số đo (chạm lúc khách im 50,5% lượt, khách quay lại 14–21%; câu rỗng 494 ô/7 ngày, 226/608 = 37,2% hội thoại kết thúc bằng nó, khách nhắn tiếp 24,9% vs 72,2%).
- **Mục 10 (2 con số lệch — thiết kế C cho phép sửa):** ~~"MẢNG 1–4 chuỗi ngắn… Mỗi ô < 300 ký tự"~~ → theo 6B; ~~"SĐT VN 9–11 số"~~ → ĐÚNG 10 số (luật kiểm số 10B). *(Vách kỹ thuật sanitize 3 ô/420 ký tự trong code giữ nguyên, không đổi code.)*
- **Mục 12:** bỏ chú "(Bản cũ của dòng này… LỖI THỜI…)"; dòng ~~"⛔ KHÔNG chào bán thủ thuật ngoài KHÁM + KÊ TOA (luật DMKT 10/08)… cấm mọi câu 'bên em có / bên em làm'…"~~ (mâu thuẫn trực diện với luật DMKT INBOX 06/09 ở mục 1) → thay bằng luật sống: inbox xác nhận CÓ LÀM theo mục 1, nơi công khai vẫn cấm tuyệt đối; dòng "KHÔNG hứa 'khỏi 100%'" (bản ngắn, trùng) gộp vào dòng NĐ 38/2021 đầy đủ; dòng cơ sở ngoài giấy phép: giữ cấm tuyệt đối ở nơi CÔNG KHAI, riêng "Quận 10" trong inbox đi theo kịch bản 4H (anh Trình đã duyệt giữ, chỉ inbox).
- **Separator `---` giữa các mục** (4 chỗ) bỏ — heading tự phân mục.

## 4. Ràng buộc DMKT không đổi (nhắc để khỏi "nới nhầm")

- **(C) hứa kết quả + (E) học vị `BS.CK1`: CẤM VĨNH VIỄN, KỂ CẢ INBOX** — không theo mùa DMKT. Còn nguyên ở mục 1 + 4C ④ + mục 12 (não FB) và khối 06/09 + mục 5 (não Zalo).
- Inbox được nói phòng khám CÓ LÀM thủ thuật + giá theo 💰 BẢNG GIÁ (luật 06/09). Nơi công khai (comment/caption/bài đăng/ZNS/broadcast) vẫn siết.
