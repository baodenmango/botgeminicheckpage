# 🚪 ĐƯỜNG LUI — bot Gemini Hiệp Lợi

> Viết ngày **06/09/2026** cho bản vá 5 lớp (nhánh `va-tang-ra-sdt-06-09`).
> Viết cho người **không nhớ git**. Làm theo từng bước, đừng nhảy cóc.
> Anh Trình đọc được trên điện thoại: **Cách 1 và Cách 2 làm 100% trên web Render, không cần máy tính.**

---

## 📌 SỐ LIỆU GỐC — đọc trước khi làm gì

| Thứ | Giá trị |
|---|---|
| Địa chỉ bot | `https://botgeminicheckpage.onrender.com` |
| Kho mã (GitHub) | `baodenmango/botgeminicheckpage` |
| **Bản ĐANG CHẠY production** | commit **`b5b9d21`** — đã đóng mốc tên **`prod-truoc-5-lop-2026-09-06`** |
| Bằng chứng (không phải đoán) | mở `https://botgeminicheckpage.onrender.com/health` → thấy `"commit":"b5b9d21"` |
| Bản vá 5 lớp (CHƯA deploy) | nhánh `va-tang-ra-sdt-06-09`, commit `9ec09e3` |
| Não FB bản đang chạy | **41.275 ký tự** |
| Não FB sau bản vá | **92.115 ký tự** (×2,23) |
| Não Zalo sau bản vá | **36.812 ký tự** (×3,17 — phình mạnh hơn FB) |

### ⏱️ Cách kiểm bot đang chạy bản nào — 5 giây, làm trên điện thoại
Mở trình duyệt, vào: **`botgeminicheckpage.onrender.com/health`**
Sẽ thấy một dòng như:
```
{"ok":true,"ts":...,"commit":"b5b9d21","bootedAt":"2026-09-04T09:10:42.582Z"}
```
- `commit` = bản đang chạy.
- `bootedAt` = lần khởi động gần nhất (giờ quốc tế, **cộng 7 tiếng** ra giờ Việt Nam).

---

# CÁCH 1 — TẮT 1 LỚP (nhẹ nhất, làm trước tiên)

**Dùng khi:** bot đã deploy bản mới, thấy nó **nói năng kém đi / lan man / báo giá sai / chào ưu đãi bừa**,
nhưng **vẫn còn trả lời khách**. Chưa cần lui hẳn.

**Không cần deploy lại. Không cần git. Mất ~1 phút + ~1 phút chờ bot khởi động lại.**

### Bấm ở đâu trên Render — từng bước

1. Vào **`dashboard.render.com`** → đăng nhập.
2. Danh sách dịch vụ → bấm vào **`botgeminicheckpage`**.
3. Cột menu **bên trái**, bấm **`Environment`**.
4. Thấy khối **`Environment Variables`** → bấm nút **`+ Add Environment Variable`**.
5. Điền đúng 2 ô:
   - Ô **Key** (tên biến): gõ một trong ba tên ở bảng dưới.
   - Ô **Value** (giá trị): gõ đúng số **`1`**.
6. Bấm **`Save Changes`** (nút dưới cùng).
7. Render **tự khởi động lại** service (~1 phút). Không phải bấm Deploy.
8. Kiểm: vào tab **`Logs`**, tìm dòng bắt đầu bằng **`⚡ [cầu dao]`** — xem mục "Kiểm đã lui thành công" bên dưới.

### Ba cầu dao — chọn cái đúng bệnh

| Bệnh đang thấy | Gõ Key này | Value | Bot đổi thế nào |
|---|---|---|---|
| Bot **chào ưu đãi bừa**, nói giảm giá khi khách chưa hỏi, bịa hạn chót | `BOT_TAT_UU_DAI` | `1` | **Vẫn báo giá bình thường**, nhưng ngừng hẳn 2 ưu đãi (giảm 50% phí khám · tặng điện xung) |
| Bot **nói giá sai / bịa số / mặc cả**, hoặc cần giấu giá gấp | `BOT_TAT_BANG_GIA` | `1` | Ngừng nói **mọi con số giá và mọi ưu đãi**. Khách hỏi giá → "Bác sĩ khám xong mới báo chính xác" + xin số |
| Bot **lan man, sến, lì đòn quá**, giọng như đi bán hàng | `BOT_TAT_KY_NANG` | `1` | Bỏ lớp kỹ năng bán hàng/tâm lý. Bot trả lời **gọn và hiền** lại như trước |

> 💡 **Tắt được nhiều lớp cùng lúc** — thêm nhiều biến, mỗi biến một dòng.
> Tắt cả 3 thì não FB còn **70.377 ký tự** (gần bằng bản cũ về mặt hành vi bán hàng).

### 🔙 BẬT LẠI lớp đã tắt
Vào đúng chỗ cũ (`Environment`) → tìm dòng biến đó → bấm **biểu tượng thùng rác** ở cuối dòng để **xoá hẳn biến** → **`Save Changes`**.
> ⚠️ **Xoá hẳn biến, đừng sửa thành `0`.** Sửa thành `0` cũng chạy đúng, nhưng để lại một dòng rác
> dễ làm người sau tưởng đang tắt. Xoá là sạch nhất.

### 🛡️ Gõ sai thì sao? — Không sao cả, đã chống sẵn
Gõ nhầm `BOT_TAT_UU_DAI=abc` hoặc `=xyz` → máy **KHÔNG tắt gì cả**, giữ nguyên như đang chạy,
và in dòng đỏ trong Logs chỉ đúng chỗ sai. **Cầu dao chỉ hỏng theo hướng "không cắt gì",
không bao giờ tự cắt não bot vì một biến gõ nhầm.**

---

# CÁCH 2 — LUI HẲN VỀ BẢN CŨ, làm trên web Render (không cần máy tính)

**Dùng khi:** bot **hỏng nặng** — im lặng, trả lời sai bệnh, nói bậy, hoặc `/health` không mở được.
Tắt cầu dao không cứu được.

1. `dashboard.render.com` → bấm **`botgeminicheckpage`**.
2. Menu trái → bấm **`Events`** (có nơi ghi là `Deploys`).
3. Tìm trong danh sách dòng deploy có mã **`b5b9d21`** (là bản chạy tốt ngày 04/09).
4. Bấm nút **`Rollback to this deploy`** ở dòng đó (một số giao diện ghi **`Redeploy`**).
5. Xác nhận. Chờ ~2–3 phút.
6. Kiểm bằng `/health` → phải thấy lại **`"commit":"b5b9d21"`**.

> ⚠️ **Rollback KHÔNG xoá các biến `BOT_TAT_*`.** Nếu trước đó đã tắt lớp nào thì sau khi lui vẫn còn tắt —
> nhưng bản `b5b9d21` **không có cầu dao**, nên các biến đó chỉ nằm im vô hại. Dọn sau cũng được.

---

# CÁCH 3 — LUI BẰNG MÁY TÍNH (khi cách 2 không có nút Rollback)

Mở **Terminal** trên MacBook. Chép **từng dòng một**, bấm Enter sau mỗi dòng.

### Bước 1 — vào đúng thư mục
```bash
cd "/Users/mac/Claude/Projects/Phòng khám Hiệp Lợi - Marketing & Vận hành/bot-gemini-checkpage"
```

### Bước 2 — xem đang đứng ở đâu (chỉ để nhìn, không đổi gì)
```bash
git status
```

### Bước 3 — đưa nhánh `main` về đúng bản tốt
```bash
git checkout main
git reset --hard prod-truoc-5-lop-2026-09-06
```
> `prod-truoc-5-lop-2026-09-06` là **cái tên đã đóng mốc** cho commit `b5b9d21`. Gõ tên, khỏi nhớ mã.

### Bước 4 — đẩy lên GitHub để Render tự deploy lại
```bash
git push origin main --force-with-lease
```
> ⚠️ Dòng này **ghi đè lịch sử trên GitHub**. Chỉ chạy khi thật sự muốn lui.
> Dùng `--force-with-lease` (không phải `--force`) để nếu có người vừa đẩy gì lên thì nó **chặn lại**, không cán qua.

### Bước 5 — chờ Render deploy (~2–3 phút), rồi kiểm
```bash
curl -s https://botgeminicheckpage.onrender.com/health
```
Phải thấy `"commit":"b5b9d21"`.

### 😰 Lỡ tay rồi, muốn quay lại bản vá thì sao?
**Không mất gì cả.** Bản vá vẫn nằm nguyên ở nhánh `va-tang-ra-sdt-06-09`:
```bash
git checkout va-tang-ra-sdt-06-09
```

---

# ✅ KIỂM ĐÃ LUI THÀNH CÔNG CHƯA

Làm đủ **cả 3 cửa**, đừng chỉ xem 1 cửa.

### Cửa 1 — bot còn sống + đúng bản
Mở `botgeminicheckpage.onrender.com/health`, xem `commit`:
- Muốn lui hẳn → phải là **`b5b9d21`**.
- Chỉ tắt cầu dao → **vẫn là bản mới**, đúng như vậy.

### Cửa 2 — Logs Render nói đúng thứ mình vừa làm
Render → `botgeminicheckpage` → **`Logs`**. Tìm dòng **`⚡ [cầu dao]`** (chỉ có ở bản mới):
```
⚡ [cầu dao] BẢNG GIÁ 🟢 BẬT · ƯU ĐÃI ⛔ TẮT · KỸ NĂNG BÁN HÀNG 🟢 BẬT
```
Đọc: cái nào **⛔ TẮT** là đã tắt. Không khớp ý mình → xem lại tên biến gõ đúng chưa.

Xem thêm dòng **`🧠 [config] não FB`** để biết não đang bao nhiêu ký tự.

### Cửa 3 — thử thật bằng tin nhắn
Nhắn thử vào page bằng **tài khoản Facebook riêng của mình** (⛔ đừng thử trên hội thoại khách thật):
- Tắt `BOT_TAT_BANG_GIA` → hỏi *"khám bao nhiêu tiền"* → bot **không được nói số nào**.
- Tắt `BOT_TAT_UU_DAI` → nói *"mắc quá"* → bot **không được nhắc 150k / giảm 50% / tặng điện xung**.

> ⚠️ Bot có thể **giữ hội thoại cũ trong bộ nhớ**. Thử bằng **hội thoại mới** cho chắc.

---

# 💾 BẢN SAO LƯU ĐANG GIỮ Ở ĐÂU

| Thư mục | Chứa gì |
|---|---|
| `backup-nao/2026-09-06-truoc-5-lop/` | **2 file não của bản ĐANG CHẠY** (`b5b9d21`): `system-prompt.md` (53.478 byte) · `system-prompt-zalo.md` (14.658 byte) |
| `backup-nao/2026-09-06-BAN-VA-5-LOP/` | **5 file não của bản vá**, gồm cả `gia-va-uu-dai-CHO-DUYET.md` (bản ưu đãi **chưa duyệt**, không được nạp vào bot) |

> 🔎 **Bản đang chạy chỉ có 2 file não, không phải 4** — `gia-va-uu-dai.md` và `ky-nang-ban-hang.md`
> là **file mới, chưa từng chạy production**. Đây là lý do vì sao mốc lui về là an toàn: nó là bản đã chạy thật 2 ngày.

---

# 🚨 BA VIỆC PHẢI LÀM **TRƯỚC KHI** BẤM DEPLOY BẢN VÁ

### ① Hai file não mới **CHƯA ĐƯỢC ĐƯA VÀO GIT** — deploy bây giờ là bot mất 2/3 não
`gia-va-uu-dai.md` và `ky-nang-ban-hang.md` đang ở trạng thái **untracked** (chưa `git add`).
Chúng **không bị `.gitignore` chặn** — chỉ là chưa ai thêm vào.
⇒ Deploy mà quên thêm thì trên Render **hai file này không tồn tại**, bot chạy với **mỗi bộ não gốc**,
trong khi bộ não gốc lại trỏ tới *"mục 💰 BẢNG GIÁ cuối bộ não"* — **trỏ vào chỗ trống**.
Bot sẽ biết mình *được phép* báo giá mà **không có bảng giá để đọc**.

Sửa (chạy trong Terminal, đúng thư mục ở Bước 1):
```bash
git add gia-va-uu-dai.md ky-nang-ban-hang.md
git commit -m "Thêm 2 mảnh não: bảng giá + kỹ năng bán hàng"
```
> ⛔ **Đừng `git add` file `gia-va-uu-dai-CHO-DUYET.md`** — đó là ưu đãi **chưa được duyệt**,
> cố ý để ngoài, không bao giờ được nạp vào bot.

### ② Kiểm log boot ngay sau khi deploy
Vào `Logs`, phải thấy đủ **3 dòng này**:
```
⚡ [cầu dao] BẢNG GIÁ 🟢 BẬT · ƯU ĐÃI 🟢 BẬT · KỸ NĂNG BÁN HÀNG 🟢 BẬT
🧠 [config] não FB ghép đủ 3 mảnh — 92115 ký tự
🧠 [config] não ZALO ghép đủ 3 mảnh — 36812 ký tự
```
Thấy dòng đỏ **`🔴 [config] NÃO FB THIẾU MẢNH`** = đúng lỗi ① ở trên, **lui ngay**.

### ③ Biết trước con số để so
Não FB **92.115** ký tự (bản cũ 41.275). Đây là thứ chưa ai đo được trước —
**phải theo dõi 2–3 ngày đầu**, và cầu dao ở Cách 1 chính là để xử lý nếu nó tệ đi.

---

# 🩺 MÁY CANH SỨC KHOẺ (chạy trên MacBook)

```bash
node scripts/canh-suc-khoe-bot.mjs --thu   # chạy thử, KHÔNG bắn Telegram
node scripts/canh-suc-khoe-bot.mjs         # chạy thật
```
Chi tiết + lịch chạy đề xuất: xem phần cuối báo cáo bàn giao.

---

# 🧹 ĐỀ XUẤT DỌN (chưa làm — chờ anh Trình gật)

Trong `src/` đang có 2 file sao lưu tay: `vesi.js.bak-04-09` và `vesi.js.bak-21-08`.

**Vì sao nên dọn:** file `.bak` nằm **ngay trong `src/`** thì (a) người đọc mã dễ mở nhầm bản cũ,
(b) mỗi lần tìm kiếm trong `src/` đều lòi ra kết quả trùng từ bản chết, (c) không ai biết
`.bak-04-09` khác bản đang chạy chỗ nào — vì nó **không nằm trong git**.

**Cách dọn đề xuất (KHÔNG xoá gì):**
```bash
mkdir -p .bak/src-cu
git mv src/vesi.js.bak-04-09 .bak/src-cu/ 2>/dev/null || mv src/vesi.js.bak-04-09 .bak/src-cu/
mv src/vesi.js.bak-21-08 .bak/src-cu/
```
`.bak/` **đã có sẵn trong `.gitignore`** ⇒ dọn xong `src/` sạch mà file cũ vẫn còn trên đĩa.
Về sau muốn xem bản cũ thì dùng git (`git log -- src/vesi.js`) — an toàn hơn hẳn file `.bak` chép tay.

> ⛔ Em **không tự dọn** vì đây là việc xoá/di chuyển file, ngoài quyền tự chạy. Anh Trình gật thì làm.

---

# 🆕 BỔ SUNG 06/09/2026 (chiều) — 3 VIỆC MỚI SẾP TRÌNH CHỐT

Ba việc này nằm **CHUNG nhánh** `va-tang-ra-sdt-06-09`, deploy cùng bản vá 5 lớp.

| Việc | File | Tắt khẩn bằng |
|---|---|---|
| ① Bot đọc **sổ liệu trình của Thảo** | `src/lieutrinh.js` + `src/medi.js` + `src/handler.js` | `LIEUTRINH_TAT=1` |
| ② Đổ **Zalo uid từ POS** sang bot | `scripts/do-zalo-uid-tu-pos.mjs` | (script chạy tay, không tự chạy) |
| ③ Luật **ca ≥20 triệu** không tự nhắn | `src/gac20tr.js` + 4 chỗ cắm | `GAC_20TR_TAT=1` |

## 🔑 BIẾN MÔI TRƯỜNG PHẢI NẠP TRÊN RENDER (nếu không, việc ① nằm im)

| Biến | Giá trị | Bắt buộc? |
|---|---|---|
| `GOOGLE_SA_JSON` | nội dung file `hiep-loi-nhac-l-823a57f8ad83.json`, **mã hoá base64** | ✅ — thiếu là bot không đọc được sổ Thảo |
| `LIEUTRINH_SHEET_ID` | `11197nwwl4hKlwJDzazJ1-0oA4LFCUlZCIeTOmcEciTg` | không (đã có mặc định trong mã) |
| `GAC_TONG_CHI_NGUONG` | `20000000` | không (mặc định 20 triệu) |
| `POS_API_TOKEN` | dùng chung `PANCAKE_API_TOKEN` đã có | không (tự lấy) |

Cách tạo chuỗi base64 trên MacBook:
```bash
base64 -i /Users/mac/.secrets/hiep-loi-nhac-l-823a57f8ad83.json | tr -d '\n' | pbcopy
```
rồi dán vào Render → Environment → `GOOGLE_SA_JSON`.

> ⚠️ **Thiếu biến này KHÔNG làm bot chết** — mã fail-soft: bot chạy y như cũ, chỉ mất
> phần liệu trình. Nhưng cũng có nghĩa là **việc ① không có tác dụng gì** cho tới khi nạp.

## 🚪 LUI RIÊNG TỪNG VIỆC (không cần lui cả bản)

- **Việc ① đọc sai / nói nhầm liệu trình cho khách** → Render → Environment → thêm
  `LIEUTRINH_TAT=1` → Save. Thẻ ngữ cảnh quay về đúng như trước, mọi thứ khác nguyên vẹn.
- **Việc ③ chặn oan, khách lớn không được chăm** → thêm `GAC_20TR_TAT=1` → Save.
  Hoặc nới ngưỡng: `GAC_TONG_CHI_NGUONG=50000000`.
- **Việc ②** không cần lui: script chỉ ghi khoá `phone_zalo:<sđt>` vào DB bot. Muốn gỡ thì
  chạy lại với `--json` để xem danh sách rồi xoá tay từng khoá.

## ⚠️ ĐIỀU PHẢI BIẾT VỀ SỔ CỦA THẢO

**Chỉ-đọc tuyệt đối.** Service account `linh-nhac-hen@hiep-loi-nhac-l.iam.gserviceaccount.com`
chỉ được cấp quyền **Xem**, và mã chỉ xin scope `spreadsheets.readonly`. Bot **không thể** ghi,
sửa, hay tạo tab trong sổ Thảo đang dùng — kể cả khi ai đó lỡ tay đổi mã.

**Sổ ghi thiếu SĐT ở 2/3 số dòng** (đo 06/09: 58/180 dòng có số). Vì vậy bot còn tra
**theo TÊN** — và mọi thẻ khớp-bằng-tên đều in kèm dòng *"khớp theo TÊN … nếu khách nói
không đúng thì tin khách"*. Nếu sau này thấy bot kể nhầm liệu trình của người khác,
đó là chỗ cần siết đầu tiên.
