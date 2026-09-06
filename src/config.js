// Đọc & gom cấu hình từ process.env (đã nạp bằng dotenv ở index.js).
// Gom danh sách trang Pancake dạng PANCAKE_PAGE_{N}_ID/_TOKEN/_CHANNEL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- ⚡ CẦU DAO TỪNG LỚP (kill switch) — dựng 06/09/2026 ----------
//
// Anh Trình 06/09: "Phải dự phòng tất cả các trường hợp có thể xảy ra... trường hợp nào cũng
// không được lỗi." Rủi ro cụ thể đang treo: bản vá 5 lớp đẩy não FB từ 41.275 → 92.065 ký tự
// (×2,23) và não Zalo từ 11.581 → 36.762 ký tự (×3,17). Prompt càng dài, model càng dễ tuân luật
// kém đi — mà đây là thứ KHÔNG đo trước được, chỉ deploy rồi mới biết.
//
// ⇒ Ba cầu dao dưới đây cho phép anh Trình GỠ TỪNG LỚP ngay trên Render (Environment → sửa biến →
// Save = service tự restart ~1 phút) mà KHÔNG cần deploy lại, KHÔNG cần chạm git, KHÔNG cần máy tính.
//
// ⚠️ LUẬT FAIL-SAFE: biến THIẾU / RỖNG / GHI SAI → coi như lớp đó VẪN BẬT (giữ nguyên hành vi
// hiện tại). Cầu dao hỏng theo hướng "không cắt gì" chứ không bao giờ tự cắt não bot vì một
// biến gõ nhầm. Giá trị lạ thì in dòng ĐỎ để người sửa thấy, chứ không im lặng đoán ý.
const CAU_DAO_TAT = ['1', 'true', 'yes', 'y', 'on', 'tat', 'tắt'];
const CAU_DAO_BAT = ['0', 'false', 'no', 'n', 'off', 'bat', 'bật', ''];
function laTat(ten) {
  const raw = process.env[ten];
  if (raw === undefined || raw === null) return false; // thiếu biến → lớp BẬT
  const v = String(raw).trim().toLowerCase();
  if (CAU_DAO_TAT.includes(v)) return true;
  if (CAU_DAO_BAT.includes(v)) return false;
  console.error(`🔴 [cầu dao] ${ten}="${raw}" — KHÔNG hiểu giá trị này. FAIL-SAFE: coi như lớp VẪN BẬT `
    + `(giữ nguyên hành vi hiện tại, không tự ý cắt não bot). Muốn TẮT lớp thì đặt ${ten}=1`);
  return false;
}

export const CAU_DAO = {
  tatBangGia: laTat('BOT_TAT_BANG_GIA'),   // gỡ HẲN gia-va-uu-dai.md khỏi cả 2 não
  tatUuDai: laTat('BOT_TAT_UU_DAI'),       // giữ giá, chỉ cắt khối ④ ƯU ĐÃI
  tatKyNang: laTat('BOT_TAT_KY_NANG'),     // gỡ HẲN ky-nang-ban-hang.md khỏi cả 2 não
};

// ---------- LỜI THU HỒI (override) — nối CUỐI não, chỗ model nhớ rõ nhất ----------
//
// 🚨 VÌ SAO BẮT BUỘC PHẢI CÓ, KHÔNG ĐƯỢC BỎ: bản thân `system-prompt.md` (bộ não GỐC, không phải
// file phụ) đã VIẾT CỨNG 4 mức giá và 2 ưu đãi ở ít nhất 6 chỗ — dòng 16, 243, 324, 329, 330, 618
// (đo 06/09/2026). Nghĩa là gỡ file `gia-va-uu-dai.md` ra KHÔNG đủ làm bot ngừng báo giá: nó vẫn
// đọc được "300.000đ", "từ 5 triệu", "150k cho BHYT/trên 60 tuổi" ngay trong não gốc.
// Cầu dao mà chỉ cắt file thì là cầu dao GIẢ — bật lên tưởng đã tắt mà thực ra chưa tắt.
// Lời thu hồi đặt ở CUỐI cùng (vị trí recency mạnh nhất) để đè lên các dòng viết cứng phía trên.
const THU_HOI_BANG_GIA = `## 🔴 LỆNH THU HỒI BẢNG GIÁ (cầu dao BOT_TAT_BANG_GIA đang BẬT)

Lệnh này ĐÈ LÊN TOÀN BỘ mọi dòng phía trên, kể cả những dòng trong bộ não gốc có ghi sẵn con số.

⛔ **MỌI CON SỐ GIÁ VÀ MỌI ƯU ĐÃI Ở BẤT KỲ MỤC NÀO PHÍA TRÊN ĐỀU ĐÃ BỊ THU HỒI, COI NHƯ KHÔNG TỒN TẠI.**
Gồm cả: 300.000đ · 150.000đ · "từ 5 triệu" · "từ 600.000đ" · giảm 50% phí khám · tặng điện xung.
Cấm nêu, cấm nhắc lại, cấm ước lượng, cấm nói "khoảng", cấm gợi ý "có ưu đãi đó ạ".

✅ Khách hỏi giá / hỏi chi phí / xin giảm → trả lời đúng tinh thần này rồi XIN SỐ:
*"Dạ chi phí còn tuỳ tình trạng của mình, Bác sĩ khám xong mới báo chính xác được ạ. Mình cho em xin số, em nhờ Bác sĩ xem rồi báo mình cụ thể nha."*

Mọi việc khác giữ nguyên như các mục phía trên.`;

const THU_HOI_UU_DAI = `## 🔴 LỆNH THU HỒI ƯU ĐÃI (cầu dao BOT_TAT_UU_DAI đang BẬT)

Lệnh này ĐÈ LÊN mọi dòng nói về ưu đãi ở phía trên, kể cả trong bộ não gốc.

⛔ **HAI ƯU ĐÃI ĐÃ BỊ THU HỒI:** giảm 50% phí khám (300.000đ → 150.000đ cho BHYT / HS-SV / CNVC /
trên 60 tuổi) **và** tặng 1 lần điện xung trị liệu 400.000đ. **Coi như KHÔNG CÒN.**
Cấm nêu, cấm úp mở ("bên em có chương trình…"), cấm hứa hỏi lại, cấm bịa ưu đãi thay thế.

✅ **BẢNG GIÁ VẪN CÒN HIỆU LỰC** — vẫn báo đúng 4 mức thật như mục 💰 BẢNG GIÁ.
✅ Khách chê đắt / xin giảm → KHÔNG hạ giá, mà chuyển sang GIÁ TRỊ + xin số:
*"Dạ mức đó là phí khám với siêu âm tầm soát trọn gói rồi ạ. Mình để lại số, em nhờ Bác sĩ xem giúp tình trạng rồi báo mình hướng đỡ tốn nhất nha."*`;

const THU_HOI_KY_NANG = `## 🔴 GHI CHÚ (cầu dao BOT_TAT_KY_NANG đang BẬT)

Lớp 🧠 KỸ NĂNG BÁN HÀNG đã được gỡ khỏi bộ não. Mọi chỗ phía trên trỏ tới
"mục 🧠 KỸ NĂNG BÁN HÀNG", "mục A5", "mục B1–B2", "mục 4B" của file đó → **bỏ qua, đừng đi tìm**.
Cứ làm theo các mục còn lại trong bộ não này. Luật và ranh giới không đổi.`;

// Cắt khối ④ ƯU ĐÃI khỏi bảng giá, dùng 2 mốc HTML comment cắm trong `gia-va-uu-dai.md`.
// FAIL-SAFE: không tìm thấy mốc (anh Trình sửa file làm mất mốc) → GIỮ NGUYÊN cả file + kêu ĐỎ.
// Thà để ưu đãi còn đó (đúng hành vi hiện tại) còn hơn cắt mù vào giữa bảng giá làm hỏng cả mục.
const MOC_UD_DAU = '<!-- UU-DAI:BAT-DAU -->';
const MOC_UD_CUOI = '<!-- UU-DAI:KET-THUC -->';
function catKhoiUuDai(s) {
  const i = s.indexOf(MOC_UD_DAU);
  const j = s.indexOf(MOC_UD_CUOI);
  if (i < 0 || j < 0 || j < i) {
    console.error('🔴 [cầu dao] BOT_TAT_UU_DAI=1 nhưng KHÔNG thấy cặp mốc '
      + `${MOC_UD_DAU} … ${MOC_UD_CUOI} trong gia-va-uu-dai.md → FAIL-SAFE: giữ NGUYÊN cả bảng giá `
      + '(ưu đãi VẪN CÒN trong não). Cắm lại 2 mốc đó rồi restart, hoặc dùng BOT_TAT_BANG_GIA=1 để gỡ cả bảng giá.');
    return { text: s, ok: false };
  }
  const con = s.slice(0, i) + '*(Phần ưu đãi đã được gỡ khỏi bộ não — xem LỆNH THU HỒI ƯU ĐÃI ở cuối.)*\n'
    + s.slice(j + MOC_UD_CUOI.length);
  return { text: con, ok: true };
}

// --- Đọc system prompt (bộ não) từ file ---
//
// 🔴 VÁ 06/09/2026 — CHỦ Ý CHẾT SỚM, KHÔNG CHẠY TIẾP KHI MẤT NÃO GỐC.
//
// Bản cũ: `fs.readFileSync(...)` trần, không try/catch. Thiếu file → throw ở top-level module →
// process chết TRƯỚC `app.listen` → Render restart loop, `/health` không tồn tại.
// Bản này VẪN CHẾT — nhưng chết CÓ CHỦ Ý, có lời chẩn đoán, và bịt thêm ca nguy hiểm hơn nhiều:
// FILE RỖNG / CỤT.
//
// ⚠️ VÌ SAO KHÔNG "chạy tiếp với não rỗng" như 3 file phụ:
// Ba file phụ (giá · kỹ năng · não Zalo) mất đi thì bot DỐT hơn nhưng vẫn ĐÚNG LUẬT.
// `system-prompt.md` là nơi chứa TOÀN BỘ luật y khoa + 5 nhóm cấm DMKT + ranh giới đạo đức (mục 12).
// Mất nó mà vẫn trả lời khách = bot của một PHÒNG KHÁM đang tư vấn y khoa KHÔNG CÒN MỘT LUẬT NÀO —
// nhóm cấm (A)(B)(C)(E), khung phạt 80–100tr + đình chỉ, đúng lúc hồ sơ DMKT đang nằm trên bàn Sở.
// Bot câm mất lead trong 10 phút; bot vô luật làm hỏng giấy phép. ⇒ CHẾT SỚM là lựa chọn ĐÚNG.
//
// Ca `filter(Boolean)` nuốt chuỗi rỗng còn tệ hơn thiếu file: KHÔNG crash, KHÔNG cảnh báo, mà
// `checkConfig()` vẫn in dòng xanh "não FB ghép đủ 3 mảnh" — đúng thứ bệnh mà chính file này đã
// chửi ở dòng "rụng 1/3 page mà vẫn in ✅ OK là kiểu báo cáo giết khách". Nay có NGƯỠNG TỐI THIỂU.
const NAO_GOC_TOI_THIEU = parseInt(process.env.NAO_GOC_TOI_THIEU || '10000', 10);
const SYSTEM_PROMPT_GOC = (() => {
  const p = path.join(__dirname, '..', 'system-prompt.md');
  let s;
  try {
    s = fs.readFileSync(p, 'utf8');
  } catch (e) {
    console.error('🔴🔴 [config] KHÔNG ĐỌC ĐƯỢC BỘ NÃO GỐC — DỪNG BOT CÓ CHỦ Ý.');
    console.error(`     File cần có: ${p}`);
    console.error(`     Lỗi: ${e?.code || ''} ${e?.message || e}`);
    console.error('     Vì sao dừng: mất file này = mất toàn bộ luật y khoa + 5 nhóm cấm DMKT.');
    console.error('     Bot câm 10 phút thì mất lead; bot chạy KHÔNG LUẬT thì hỏng giấy phép phòng khám.');
    console.error('     Cách sửa: kiểm system-prompt.md đã được commit + deploy lên Render chưa.');
    throw e;
  }
  if (s.length < NAO_GOC_TOI_THIEU) {
    console.error('🔴🔴 [config] BỘ NÃO GỐC CÓ FILE NHƯNG QUÁ NGẮN — DỪNG BOT CÓ CHỦ Ý.');
    console.error(`     Đọc được ${s.length} ký tự, ngưỡng tối thiểu ${NAO_GOC_TOI_THIEU}.`);
    console.error('     Thường là: file rỗng, ghi đứt giữa chừng, hoặc checkout hụt.');
    console.error('     Đây là ca NGUY HIỂM NHẤT: không crash thì bot vẫn trả lời khách mà KHÔNG còn luật nào.');
    throw new Error(`system-prompt.md chỉ có ${s.length} ký tự (< ${NAO_GOC_TOI_THIEU}) — từ chối khởi động`);
  }
  return s;
})();

// --- Bảng giá (anh Trình cấp 06/09/2026) — nạp RIÊNG, nối vào cuối bộ não FACEBOOK ---
//
// Vì sao tách file thay vì viết thẳng vào system-prompt.md:
//   1) Giá + ưu đãi là thứ anh Trình đổi thường xuyên nhất và là thứ PHẢI do anh duyệt. Để nó thành
//      một file 5KB thì anh sửa/đọc soát được, không phải lội trong bộ não 77KB.
//   2) Ưu đãi CHƯA DUYỆT nằm ở `gia-va-uu-dai-CHO-DUYET.md` và **KHÔNG BAO GIỜ được nạp** ở đây.
//      Đó là cửa chặn bằng CODE: bot không có chữ nào về ưu đãi trong đầu ⇒ không thể hứa bừa.
//      (Chặn bằng câu dặn trong prompt thì model vẫn có thể lách — đã có tiền lệ.)
//
// ⚠️ CHỈ nối vào bộ não FACEBOOK (kênh tin nhắn riêng — nơi anh Trình cho phép báo giá: chốt 11/08,
// 15/08, 06/09). KHÔNG nối vào SYSTEM_PROMPT_ZALO (bộ não riêng, chưa đo, ngoài phạm vi bản vá này).
// Trả lời COMMENT CÔNG KHAI không dùng bộ não này (`src/comment.js` không hề import gemini) ⇒ giá
// thủ thuật KHÔNG có đường lọt ra chỗ công khai — đó là nhóm cấm (B), nhóm nặng nhất của luật DMKT.
//
// Thiếu file → chạy tiếp với bộ não gốc (bot mất bảng giá, quay về cách né cũ) chứ KHÔNG crash:
// bot câm là mất toàn bộ lead, tệ hơn nhiều so với bot thiếu bảng giá.
const BANG_GIA = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'gia-va-uu-dai.md'), 'utf8');
  } catch {
    console.warn('[config] ⚠️ THIẾU gia-va-uu-dai.md → bot KHÔNG có bảng giá, sẽ né câu hỏi giá');
    return '';
  }
})();

// --- LỚP KIẾN THỨC BÁN HÀNG + TÂM LÝ (anh Trình giao 06/09/2026) — nạp RIÊNG, nối cuối não FB ---
//
// Anh Trình: "Mục tiêu tối thượng của BOT là lấy được SĐT, là chốt được khách. Các bộ skill về
// từ ngữ, tâm lý, bán hàng, hành vi khách hàng thì em hãy training, bọc kiến thức cho BOT."
//
// Vì sao lại là file thứ BA thay vì nhồi thêm vào system-prompt.md:
//   1) Ba thứ này đổi theo ba nhịp khác nhau — GIÁ/ƯU ĐÃI đổi khi anh Trình chốt, KIẾN THỨC BÁN HÀNG
//      đổi khi đo lại được số mới, BỘ NÃO GỐC gần như không đổi. Trộn chung thì mỗi lần sửa một thứ
//      phải lội trong 68KB.
//   2) File kiến thức là thứ DUY NHẤT trong ba file có thể xoá đi mà bot vẫn chạy đúng luật — nó dạy
//      bot bán KHÉO hơn, không phải dạy bot được phép nói gì. Tách ra thì gỡ được mà không sợ vỡ luật.
//
// ⚠️ THỨ TỰ NỐI CÓ Ý NGHĨA: BẢNG GIÁ đứng TRƯỚC, KỸ NĂNG đứng SAU. Kỹ năng bán hàng nhiều lần trỏ
// ngược về "💰 BẢNG GIÁ ④" (7 luật dùng ưu đãi); đảo thứ tự thì model đọc lời trỏ trước khi đọc thứ
// được trỏ tới. Cả hai đều đứng SAU bộ não gốc để mục 12 (ranh giới đạo đức) vẫn là nền, và cả hai
// file đều tự ghi rõ "mục 12 + BẢNG GIÁ đè lên tất cả" để không có chỗ nào hiểu ngược.
//
// ⚠️ CHỈ nối vào não FACEBOOK (inbox — nơi anh Trình cho phép nói giá + ưu đãi). KHÔNG nối vào
// SYSTEM_PROMPT_ZALO. `src/comment.js` KHÔNG import gemini (đã kiểm lại 06/09) ⇒ giá, ưu đãi và
// "tặng 1 lần điện xung" (kỹ thuật nhóm A, Sở CHƯA duyệt) KHÔNG có đường lọt ra COMMENT CÔNG KHAI —
// đó là nhóm cấm (A)+(B) của luật DMKT, nhóm nặng nhất.
//
// Thiếu file → CẢNH BÁO rồi chạy tiếp với phần còn lại, KHÔNG crash (bot câm mất toàn bộ lead).
const KY_NANG_BAN_HANG = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'ky-nang-ban-hang.md'), 'utf8');
  } catch {
    console.warn('[config] ⚠️ THIẾU ky-nang-ban-hang.md → bot mất lớp kỹ năng bán hàng/tâm lý, '
      + 'vẫn chạy đúng luật nhưng chốt kém (mốc lane bot đơn độc 4,8%)');
    return '';
  }
})();

// (Khối ghép SYSTEM_PROMPT đã HẠ XUỐNG dưới — xem "GHÉP NÃO SAU KHI QUA CẦU DAO".
//  Phải ghép SAU khi SYSTEM_PROMPT_ZALO_GOC đọc xong, vì hai não dùng chung một bộ mảnh.)

// Bộ não RIÊNG cho kênh Zalo OA (chăm sóc sâu, nhận diện BN cũ/mới, đòn tâm lý tới nóc).
// Thiếu file → fallback về prompt FB (an toàn, không crash).
//
// 🟢 SỬA 06/09/2026 CHIỀU — anh Trình: "Cập nhật luôn cho não ZALO."
// Trước đó Zalo KHÔNG có bảng giá ⇒ khách Zalo hỏi giá vẫn bị né như cũ, đúng cái đã làm mất
// khách thật ngày 01/09 trên Facebook. Nay ghép CÙNG hai mảnh với não FB — cố ý **dùng lại y hệt
// file**, KHÔNG viết bản thứ hai: hai bản sẽ trôi lệch nhau sau vài tuần rồi không ai biết bản nào đúng.
//
// ⚠️ AN TOÀN ĐÃ KIỂM 06/09: `SYSTEM_PROMPT_ZALO` chỉ được dùng ở `src/gemini.js` (trả lời CHAT 1-1).
// `src/zns.js` KHÔNG import gemini ⇒ **tin ZNS mẫu không bị đụng tới** (ZNS có mẫu duyệt trước,
// không phải muốn viết gì cũng được). `src/comment.js` cũng KHÔNG import gemini ⇒ giá + ưu đãi
// không có đường ra comment công khai (nhóm cấm B, nặng nhất).
const SYSTEM_PROMPT_ZALO_GOC = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'system-prompt-zalo.md'), 'utf8');
  } catch {
    console.warn('[config] thiếu system-prompt-zalo.md → kênh Zalo dùng tạm bộ não FB');
    return null;
  }
})();
// ---------- GHÉP NÃO SAU KHI QUA CẦU DAO ----------
// Cả hai não (FB + Zalo) dùng CHUNG một bộ mảnh đã lọc — cố ý, để không bao giờ có chuyện
// tắt lớp trên FB mà quên tắt trên Zalo (não Zalo phình mạnh hơn: ×3,17 so với ×2,23 của FB).

const _BANG_GIA_HIEU_LUC = (() => {
  if (CAU_DAO.tatBangGia) return '';           // gỡ HẲN cả bảng giá
  if (!BANG_GIA) return '';                    // thiếu file (đã cảnh báo ở trên)
  if (CAU_DAO.tatUuDai) {                      // giữ giá, cắt riêng khối ưu đãi
    const r = catKhoiUuDai(BANG_GIA);
    CAU_DAO._catUuDaiOk = r.ok;
    return r.text;
  }
  return BANG_GIA;
})();

const _KY_NANG_HIEU_LUC = CAU_DAO.tatKyNang ? '' : KY_NANG_BAN_HANG;

// Lời thu hồi nối CUỐI (recency mạnh nhất) — bắt buộc, vì não gốc viết cứng giá + ưu đãi ở 6 chỗ.
const _THU_HOI = [];
if (CAU_DAO.tatBangGia) {
  _THU_HOI.push(THU_HOI_BANG_GIA);             // đã gồm cả thu hồi ưu đãi
} else if (CAU_DAO.tatUuDai) {
  // ⚠️ ĐẨY LỜI THU HỒI KỂ CẢ KHI CẮT KHỐI THẤT BẠI (mất mốc). Cắt được hay không chỉ là chuyện
  // tiết kiệm token; thứ THỰC SỰ chặn bot nói ưu đãi là LỜI THU HỒI này. Mất mốc mà im luôn
  // thì anh Trình bật cầu dao xong bot VẪN chào ưu đãi — đúng kiểu cầu dao giả.
  _THU_HOI.push(THU_HOI_UU_DAI);
}
if (CAU_DAO.tatKyNang) _THU_HOI.push(THU_HOI_KY_NANG);

function _ghepNao(goc) {
  return [goc, _BANG_GIA_HIEU_LUC, _KY_NANG_HIEU_LUC, ..._THU_HOI]
    .filter(Boolean)
    .join('\n\n---\n\n');
}

export const SYSTEM_PROMPT = _ghepNao(SYSTEM_PROMPT_GOC);
export const SYSTEM_PROMPT_ZALO = SYSTEM_PROMPT_ZALO_GOC
  ? _ghepNao(SYSTEM_PROMPT_ZALO_GOC)
  : SYSTEM_PROMPT;

// --- Gom các trang Pancake ---
//
// VÁ 20/07/2026 (ca thật: ảnh Pancake 20:05, 14 hội thoại CHƯA ĐỌC, khách hỏi giá tiêm từ
// 19:47→20:05 — Hiên Thi Vu / Nguyễn Oanh / Rose Rose / Đặng Sáng / Cu Tủn / Xuân Ngọc — không
// ai rep, giao diện ghi "Chưa có người xem"):
//
// Code CŨ thấy page THIẾU TOKEN thì `continue` = XOÁ HẲN page khỏi config.pancakePages. Hậu quả
// đo được bằng stub, không phải suy đoán:
//   1) isPageEnabled(page) = false ở MỌI cửa → index.js webhook, handler.handleIncoming,
//      handlePageMessage, handleBotTouch, comment.js, care-send.js → 100% tin của page bị vứt.
//   2) rescueLead.js:166 + sevenTouch.js:109 lặp qua Object.keys(config.pancakePages) → page rụng
//      KHÔNG có trong vòng lặp → LƯỚI CỨU HỘ CUỐI CÙNG cũng mù, khách chết kẹt vĩnh viễn.
//   3) HỐ ĐEN KHÔNG TỰ THOÁT: POST /admin/set-token ghi kv 'pancake_token:<id>' và getPageToken()
//      đọc được token đó, NHƯNG isPageEnabled() không ngó KV → nạp token xong log báo
//      "🔑 đã nạp token trang mới" mà page VẪN CÂM. Chỉ redeploy mới sống lại.
//   4) getPageChannel() rơi default 'facebook' → page Zalo (nếu lọt đường gửi nào) đi sai kênh.
// Warn cũ in đúng 1 dòng lúc boot rồi im vĩnh viễn → trôi mất, đúng như đã xảy ra.
//
// NAY: NẠP page kể cả thiếu token, đánh cờ `tokenMissing` thay vì xoá. Page vào config →
// getPageChannel đúng kênh, rescue/7chạm nhìn thấy nó, /admin/set-token + refreshPageToken()
// cứu được NGAY không cần redeploy. Rủi ro: page thiếu token sẽ đi tiếp vào sendOne và gửi HỤT —
// nhưng bản vá sendMessages (20/07) đã trả false đúng nên caller không ghi lịch sử / markTouchDone
// sai. Tức là đổi "vứt tin IM LẶNG" thành "thử, trượt, CÓ LOG + CÓ CHUÔNG" — đúng nguyên tắc vàng
// của dự án: thà thừa còn hơn để khách hỏi mà không ai biết.
function loadPancakePages() {
  const pages = {}; // page_id -> { token, channel, name, tokenMissing }
  for (let n = 1; ; n++) {
    const id = process.env[`PANCAKE_PAGE_${n}_ID`];
    if (!id) break; // hết trang
    const token = process.env[`PANCAKE_PAGE_${n}_TOKEN`] || null;
    const channel = process.env[`PANCAKE_PAGE_${n}_CHANNEL`] || 'facebook';
    const name = process.env[`PANCAKE_PAGE_${n}_NAME`] || null; // tên hiển thị cho dòng "Nguồn" báo telesale
    if (!token) {
      console.error(`⚠️  [config] PANCAKE_PAGE_${n}_ID=${id} THIẾU TOKEN → VẪN NẠP page (cờ tokenMissing) `
        + 'để rescue/7chạm còn thấy + /admin/set-token cứu được không cần redeploy. '
        + `Cần: điền PANCAKE_PAGE_${n}_TOKEN trên Render hoặc POST /admin/set-token?page=${id}.`);
    }
    pages[String(id)] = { token, channel, name, tokenMissing: !token };
  }
  return pages;
}

// Danh sách page đang THIẾU TOKEN trong env — để checkConfig() và cron rescue kêu lặp lại,
// thay vì 1 dòng warn lúc boot rồi im (chính chỗ làm sự cố 20/07 trôi mất cả buổi tối).
// LƯU Ý: page đã được nạp token lúc chạy qua /admin/set-token thì KHÔNG còn thiếu nữa — hàm
// nhận `coTokenRuntime` để loại các page đã cứu, tránh kêu oan.
export function pagesThieuToken(coTokenRuntime = () => false) {
  return Object.entries(config.pancakePages)
    .filter(([id, p]) => p.tokenMissing && !coTokenRuntime(id))
    .map(([id]) => id);
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  pancakePages: loadPancakePages(),

  retouch: {
    // Nhịp "NÓNG VỪA" (anh Bảo chốt 11/07): khách chat rồi im ~25' là dập lại để đốn hạ lúc còn
    // lưỡng lự, tối đa 3 lần. Trước đây 2h/2 lần → lỡ mất lúc khách nóng. Mỗi lần vẫn 1 ô, giữ
    // giờ vàng 8-22h (handler.js chặn). Chỉnh qua env nếu muốn xoay nhịp mà không sửa code.
    // ⚠️ VÁ 06/09/2026 — HẠ SỐ LẦN DÍ 3 → 2, GIÃN MỐC ĐẦU 24' → 45'.
    // ĐO 30/08→05/09 (783 hội thoại INBOX): 1.516/3.001 lượt bot (50,5%) là DẬP CHỦ ĐỘNG lúc
    // khách đang im; khách quay lại chỉ 14,4% (lượt 1 ô) – 20,6% (lượt 2 ô). Tức một nửa lời bot
    // đang nói vào chỗ không ai nghe. Đây đúng cơ chế đã MẤT KHÁCH THẬT ca Phuong Ngoc 02/08
    // ("1 ngày mà gởi tới 10 tn hết hồn luôn... tui đã bỏ ý định đến chữa bệnh rồi").
    // Cộng cả engine: retouch 3 + 7-chạm (3/4/6) + care ⇒ tối đa 7 lần dập/khách. Hạ retouch
    // xuống 2 và giãn mốc đầu ra 45' để lần dập đầu rơi đúng lúc khách còn nhớ mình đang hỏi gì.
    minIdleHours: parseFloat(process.env.RETOUCH_MIN_IDLE_HOURS || '0.75'), // ~45 phút
    maxCount: parseInt(process.env.RETOUCH_MAX_COUNT || '2', 10),
  },
};

// --- Cảnh báo cấu hình thiếu (không crash, chỉ log để dễ sửa) ---
export function checkConfig() {
  // ⚡ VÁ 06/09/2026 — IN TRẠNG THÁI CẦU DAO MỖI LẦN KHỞI ĐỘNG.
  // Bắt buộc in CẢ khi không tắt lớp nào: anh Trình tắt một lớp trên Render rồi vài hôm sau quên,
  // thấy bot cư xử lạ mà không biết vì sao. Dòng này là chỗ DUY NHẤT trả lời được câu
  // "bot đang chạy với mấy lớp?" — nhìn log boot trên Render là biết, không phải đoán.
  const _tt = (tat) => (tat ? '⛔ TẮT' : '🟢 BẬT');
  console.log('⚡ [cầu dao] BẢNG GIÁ ' + _tt(CAU_DAO.tatBangGia)
    + ' · ƯU ĐÃI ' + _tt(CAU_DAO.tatBangGia || CAU_DAO.tatUuDai)
    + ' · KỸ NĂNG BÁN HÀNG ' + _tt(CAU_DAO.tatKyNang));
  if (CAU_DAO.tatBangGia || CAU_DAO.tatUuDai || CAU_DAO.tatKyNang) {
    console.log('⚡ [cầu dao] Não FB ' + SYSTEM_PROMPT.length + ' ký tự · não ZALO '
      + SYSTEM_PROMPT_ZALO.length + ' ký tự (đã trừ phần bị cắt). '
      + 'Bật lại: xoá biến BOT_TAT_* trên Render → Save (service tự restart).');
    if (CAU_DAO.tatUuDai && CAU_DAO._catUuDaiOk === false) {
      console.error('🔴 [cầu dao] ƯU ĐÃI: cắt khối THẤT BẠI (mất mốc) nhưng LỜI THU HỒI vẫn được nối '
        + '→ bot vẫn bị cấm nói ưu đãi. Chỉ tốn thêm token, không sai hành vi.');
    }
  }
  const miss = [];
  if (!config.gemini.apiKey) miss.push('GEMINI_API_KEY');
  if (!config.telegram.botToken) miss.push('TELEGRAM_BOT_TOKEN');
  if (!config.telegram.chatId) miss.push('TELEGRAM_CHAT_ID');
  if (Object.keys(config.pancakePages).length === 0) miss.push('PANCAKE_PAGE_1_ID/_TOKEN');
  if (miss.length) {
    console.warn('⚠️  [config] Thiếu biến môi trường:', miss.join(', '));
  } else {
    console.log(
      `✅ [config] OK — ${Object.keys(config.pancakePages).length} trang Pancake, model ${config.gemini.model}`
    );
  }
  // VÁ 06/09/2026: não FB nay ghép từ 3 file. Thiếu file phụ thì bot VẪN CHẠY nhưng dốt đi —
  // phải in thành dòng ĐỎ riêng, đừng để lẫn vào log boot rồi trôi mất (đúng bệnh của sự cố 20/07).
  const naoThieu = [];
  if (!BANG_GIA) naoThieu.push('gia-va-uu-dai.md (mất bảng giá + 2 ưu đãi)');
  if (!KY_NANG_BAN_HANG) naoThieu.push('ky-nang-ban-hang.md (mất lớp kỹ năng bán hàng)');
  if (naoThieu.length) {
    console.error(`🔴 [config] NÃO FB THIẾU MẢNH: ${naoThieu.join(' · ')} — bot vẫn trả lời được `
      + 'nhưng chốt kém hẳn. Kiểm lại file có nằm cạnh system-prompt.md không.');
  } else {
    console.log(`🧠 [config] não FB ghép đủ 3 mảnh — ${SYSTEM_PROMPT.length} ký tự`);
    console.log(`🧠 [config] não ZALO ghép đủ 3 mảnh — ${SYSTEM_PROMPT_ZALO.length} ký tự`);
  }
  // VÁ 20/07/2026: rụng 1/3 page mà vẫn in "✅ OK — 2 trang" là kiểu báo cáo giết khách.
  // Phải LIỆT KÊ page thiếu token thành dòng ĐỎ riêng, kể cả khi phần còn lại đủ.
  const thieu = Object.entries(config.pancakePages).filter(([, p]) => p.tokenMissing).map(([id]) => id);
  if (thieu.length) {
    console.error(`🔴 [config] ${thieu.length} trang Pancake THIẾU TOKEN trong env: ${thieu.join(', ')} — `
      + 'page vẫn được nạp (không bị xoá khỏi hệ) nhưng GỬI SẼ HỤT tới khi có token. '
      + 'Nạp ngay: POST /admin/set-token?page=<id> (ăn liền, không cần redeploy).');
  }
}
