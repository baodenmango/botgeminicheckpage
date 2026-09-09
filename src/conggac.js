// ============================================================================
//  CỔNG GÁC ĐẦU RA — kiểm câu bot SẮP GỬI, ngay trước lúc gọi API gửi.
//  Dựng 06/09/2026 (anh Trình: "trường hợp nào cũng không được lỗi").
//
//  VÌ SAO CÓ FILE NÀY
//  ------------------
//  Trước hôm nay, MỌI luật cấm của bot chỉ nằm trong LỜI DẶN của system-prompt
//  (92.065 ký tự sau khi ghép 3 mảnh). Prompt càng dài, model càng dễ quên luật —
//  và luật ở đây không phải nội quy công ty mà là PHÁP LUẬT:
//    · nhóm (C) hứa kết quả  — NĐ 38/2021, cấm VĨNH VIỄN, không theo mùa DMKT
//    · nhóm (E) học vị chưa có (BS.CK1) — anh Trình đang học năm 2, CHƯA có bằng
//    · giá/ưu đãi bịa — bịa số là mất khách ngay tại quầy, tệ hơn mất trong inbox
//  Lời dặn không có cổng máy thì không phải luật, chỉ là lời dặn.
//
//  HAI HÀM, HAI VAI (đừng nhập một):
//    · ganhCong()      — HÀM THUẦN, không I/O, không side-effect → test được.
//    · locTruocKhiGui() — vỏ bọc: gọi ganhCong + bắn cảnh báo Telegram (gộp tần suất).
//                         Đây là hàm mà các đường gửi (pancake.js / zalo.js) gọi.
//
//  ⚠️ FAIL-SAFE LÀ LUẬT TỐI THƯỢNG CỦA FILE NÀY: cổng gác ném lỗi thì CHO TIN ĐI QUA
//  và ghi log. Bot câm = mất toàn bộ lead (đã xảy ra thật 20/07 và 01/09) — tệ hơn
//  nhiều so với một câu lọt lưới. Toàn bộ thân hàm bọc try/catch.
//
//  ⚠️ KHÔNG import telegram.js ở đầu file: pancake.js → conggac.js → telegram.js →
//  pancake.js là VÒNG. Dùng dynamic import lúc chạy (khi đó mọi module đã nạp xong).
// ============================================================================

// ---------------------------------------------------------------------------
// 0. NGUỒN SỐ DUY NHẤT — phải khớp `gia-va-uu-dai.md` (anh Trình cấp 06/09/2026)
// ---------------------------------------------------------------------------
// Sửa bảng này là đổi thẳng thứ bot được phép nói. Sửa xong PHẢI chạy `npm test`.
export const GIA_THAT = {
  KHAM: 300000,        // khám chuyên khoa + siêu âm tầm soát — nói THẲNG, không kèm "từ"
  HA: 5000000,         // tiêm HA / dịch nhờn        — BẮT BUỘC giữ chữ "từ"
  PRP: 5000000,        // PRP                        — BẮT BUỘC giữ chữ "từ"
  CORTICOID: 600000,   // tiêm cấp tính (corticoid)  — BẮT BUỘC giữ chữ "từ"
  // Hai ưu đãi ĐÃ DUYỆT (06/09/2026) — ngoài hai số này là bịa:
  KHAM_UU_DAI: 150000, // giảm 50% phí khám: 300.000đ → 150.000đ (BHYT / HS-SV / CNVC / >60 tuổi)
  DIEN_XUNG: 400000,   // tặng 1 lần điện xung trị liệu — trị giá 400.000đ
  // ⚠️ VÁ 06/09/2026 19:45 — CHẶN OAN THẬT, Sếp Trình bắt tại trận.
  // Cổng chặn ô: «Còn gói khám chuyên khoa + siêu âm tầm soát thì 300.000đ thôi ạ
  // (giá gốc 1.300.000đ).» — báo `gia_bia (1.300.000đ)`. NHƯNG 1.300.000đ là GIÁ NEO
  // CHÍNH THỨC, nằm sẵn ở 4 CHỖ trong `system-prompt.md` (dòng 15, 20, 237, 455) và là
  // "MỒI CHỦ LỰC khi khách hỏi giá". Bot nói ĐÚNG, cổng chặn SAI ⇒ khách mất câu chào giá.
  // Bài học: danh sách giá hợp lệ phải ĐỐI CHIẾU VỚI NÃO, không tự liệt kê theo trí nhớ.
  KHAM_GIA_GOC: 1300000, // giá gốc gói khám — dùng để NEO cạnh mốc 300.000đ
};
// Tập số tiền HỢP LỆ. Bất kỳ con tiền nào khác trong câu nói về giá ⇒ vi phạm.
const TIEN_HOP_LE = new Set(Object.values(GIA_THAT));
// Hai mức BẮT BUỘC có chữ "từ" (giá thủ thuật — anh Trình: "giá ở phòng khám có thể cao hơn").
const TIEN_PHAI_CO_TU = new Set([GIA_THAT.HA, GIA_THAT.CORTICOID]);

// ---------------------------------------------------------------------------
// 1. BỘ DỰNG REGEX CHỊU BIẾN THỂ (hoa/thường · có dấu/không dấu · ký tự né · tách từ)
// ---------------------------------------------------------------------------
// Model lỡ miệng thì viết bình thường; NGƯỜI cố lách mới viết "kh.ỏi hẳn". Cổng phải
// bắt cả hai. Cách làm: từ một cụm tiếng Việt, dựng regex mà MỖI chữ cái chấp nhận
// đủ biến thể dấu, và giữa hai chữ cái cho phép tối đa 2 ký tự NGĂN (khoảng trắng,
// dấu chấm, gạch, sao...). Ký tự ngăn KHÔNG bao gồm chữ cái ⇒ "camXket" không dính.
//
// ⚠️ Regex sinh ra là TUYẾN TÍNH (mỗi ký tự = 1 lớp + 1 lượng từ có trần) → không có
// nguy cơ catastrophic backtracking dù cụm dài.
const BIEN_THE_CHU = {
  a: 'aàáảãạăằắẳẵặâầấẩẫậ',
  d: 'dđ',
  e: 'eèéẻẽẹêềếểễệ',
  i: 'iìíỉĩị',
  o: 'oòóỏõọôồốổỗộơờớởỡợ',
  u: 'uùúủũụưừứửữự',
  y: 'yỳýỷỹỵ',
};
const NGAN = "[\\s.,\\-_*'\"~·|/\\\\]{0,2}"; // ký tự né được phép chen giữa 2 chữ cái

function thoatRe(c) { return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Dựng regex chịu biến thể từ một cụm tiếng Việt. Trả về RegExp có cờ 'giu'. */
export function reMem(cum) {
  const chu = String(cum).toLowerCase();
  const phan = [];
  for (const c of chu) {
    if (c === ' ') continue;                 // khoảng trắng do NGAN lo, không ép phải có
    if (/[0-9]/.test(c)) { phan.push(thoatRe(c)); continue; }
    if (c === '%') { phan.push('%'); continue; }
    // ⚠️ PHẢI HẠ VỀ CHỮ GỐC TRƯỚC KHI TRA BẢNG. Bản đầu tra thẳng BIEN_THE_CHU['ỏ'] → undefined
    // → chỉ khớp đúng chữ 'ỏ' có dấu, nên "khỏi hẳn" KHÔNG bắt được "KHOI HAN" (kiểu gõ không
    // dấu, rất phổ biến). Bộ test bắt được đúng lỗ này.
    const goc = boDau(c) || c;
    const bien = BIEN_THE_CHU[goc];
    phan.push(bien ? `[${bien}]` : thoatRe(goc));
  }
  // Không cho dính vào giữa một từ khác (tránh dương tính giả).
  return new RegExp(`(?<![\\p{L}\\p{N}])${phan.join(NGAN)}(?![\\p{L}\\p{N}])`, 'giu');
}

/** Chuỗi đã bỏ dấu + thường hoá — dùng cho các phép dò KHÔNG cần map ngược vị trí. */
export function boDau(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// 2. NHÓM (C) — HỨA KẾT QUẢ. NĐ 38/2021.
// ---------------------------------------------------------------------------
// ⚠️ CHIA 2 BẬC từ 09/09/2026 — anh Trình bắt tại trận ca cổng sửa oan trong INBOX:
// câu "...tư vấn hướng điều trị phù hợp hơn để mình DỨT ĐIỂM HẲN tình trạng này ạ"
// (giọng tư vấn thường, không phải lời cam kết) bị sửa + réo group. Nguyên văn anh:
// "Mấy tin này thoải mái, em đừng có chặn nhiều cái quá đáng quá, trong Inbox thì
// thoải mái hơn cho anh."
//   · BẬC CỨNG — lời CAM KẾT / BẢO ĐẢM / 100% (khách chụp màn hình khiếu nại được,
//     là bằng chứng bất lợi kể cả trong inbox): sửa ở CẢ HAI làn. Riêng inbox sửa
//     LẶNG LẼ (chỉ log + đếm sổ, KHÔNG réo Telegram — xem banCanhBao).
//   · BẬC MỀM — giọng tư vấn thường ("dứt điểm", "khỏi hẳn", "tận gốc"...):
//     INBOX THẢ NGUYÊN VĂN, chỉ CÔNG KHAI (nơi Sở thấy — NĐ38) mới sửa.
// Cách xử: SỬA (scrub) — thay bằng cụm an toàn tương đương, giữ câu đọc trôi.
// Chặn hẳn là hạ sách: câu bị xoá sạch = bot cụt lời giữa lúc khách đang hỏi.
// Thứ tự trong bảng CÓ Ý NGHĨA: cụm DÀI đứng trước cụm ngắn chứa trong nó
// ("điều trị tận gốc" phải được thay trước khi "trị dứt"/"tận gốc" kịp cắn).
const THAY_HUA_CUNG = [
  ['an toàn tuyệt đối', 'được làm cẩn thận'],
  ['không tái phát', 'hạn chế tái phát'],
  ['hiệu quả 100%', 'nhiều người đáp ứng tốt'],
  ['khỏi 100%', 'đỡ hơn nhiều'],
  ['đảm bảo khỏi', 'cố gắng giúp mình đỡ'],
  ['bảo đảm khỏi', 'cố gắng giúp mình đỡ'],
  ['cam kết', 'cố gắng'],
];
const THAY_HUA_MEM = [
  ['giảm đau ngay từ buổi đầu', 'nhiều người thấy dễ chịu hơn sau khi điều trị'],
  ['tỉ lệ khỏi rất cao', 'nhiều người đáp ứng tốt'],
  ['tỷ lệ khỏi rất cao', 'nhiều người đáp ứng tốt'],
  ['điều trị tận gốc', 'xử lý đúng nguyên nhân'],
  ['chữa tận gốc', 'xử lý đúng nguyên nhân'],
  ['chữa tới gốc', 'xử lý đúng nguyên nhân'],
  ['trị tận gốc', 'xử lý đúng nguyên nhân'],
  ['hết đau luôn', 'đỡ đau hơn'],
  ['hết hẳn', 'đỡ hơn nhiều'],
  ['khỏi hẳn', 'đỡ hơn nhiều'],
  ['dứt điểm', 'đỡ hơn nhiều'],
  ['trị dứt', 'giúp đỡ hơn'],
];
const RE_HUA_CUNG = THAY_HUA_CUNG.map(([cum, thay]) => [reMem(cum), thay, cum]);
const RE_HUA_MEM = THAY_HUA_MEM.map(([cum, thay]) => [reMem(cum), thay, cum]);

// ---------------------------------------------------------------------------
// 3. NHÓM (E) — HỌC VỊ CHƯA CÓ. Anh Trình đang học CK1 năm 2, CHƯA có bằng.
// ---------------------------------------------------------------------------
// ⚠️ CHỖ DỄ BẮT OAN NHẤT CỦA CẢ CỔNG: "chuyên khoa cơ xương khớp", "khám chuyên khoa",
// "phòng khám chuyên khoa" là ĐÚNG và phải cho qua. Chỉ nổ khi sau "chuyên khoa" là
// đúng một chữ số 1 / chữ I La Mã ĐỨNG RIÊNG (hết từ), tức là đang xưng CẤP BẰNG.
const RE_HOC_VI = [
  // BS.CK1 · BS CKI · BSCK1 · B.S CK.I …
  [/(?<![\p{L}\p{N}])b[\s.]*s[\s.]*c[\s.]*k[\s.]*[1i](?![\p{L}\p{N}])/giu, 'Bác sĩ', 'BS.CK1'],
  // "bác sĩ chuyên khoa I" / "chuyên khoa 1" — chỉ khi 1/I đứng riêng
  [/(?<![\p{L}\p{N}])chuy[êe]n[\s.]*khoa[\s.]*(?:1|i)(?![\p{L}\p{N}])/giu, 'chuyên khoa', 'chuyên khoa I'],
  // hashtag #bacsick1thammy và biến thể dính liền
  [/(?<![\p{L}\p{N}])b[aáàảãạ]c[\s.]*s[iíìỉĩị][\s.]*c[\s.]*k[\s.]*[1i]\p{L}*/giu, 'Bác sĩ', 'bacsick1'],
];
// "CK1" / "CKI" đứng trơ trọi: chỉ tính là học vị khi trong ô có nhắc bác sĩ/BS/Trình —
// tránh bắt oan mã hồ sơ, mã phòng, ký hiệu kỹ thuật.
const RE_CK_TRO = /(?<![\p{L}\p{N}])c[\s.]*k[\s.]*[1i](?![\p{L}\p{N}])/giu;
const RE_CO_BAC_SI = /(?<![\p{L}\p{N}])(?:b[aáàảãạ]c\s*s[iíìỉĩị]|bs|tr[iìíỉĩị]nh)(?![\p{L}\p{N}])/iu;

// ---------------------------------------------------------------------------
// 4. TIỀN — đọc mọi con tiền trong câu, đối chiếu 5 mức thật
// ---------------------------------------------------------------------------
// Hai dạng được tính là TIỀN:
//   (A) số có nhóm nghìn: 300.000 · 5.000.000 · 1.800.000  (dấu . hoặc ,)
//   (B) số + đơn vị:      300k · 5 triệu · 5tr · 600.000đ · 1,5 triệu
// KHÔNG tính: "60 tuổi" · "0962 349 329" · "8h30" · "2 khớp" · "3 km" · "06.09.2026"
//   (chặn bằng cách bắt đơn vị phải KẾT THÚC TỪ: dùng (?![\p{L}\p{N}]) chứ KHÔNG dùng \b —
//    \b coi "ạ"/"ớ" là ranh giới từ nên "3 kg"/"5 khớp"/"3 dạng" sẽ lọt thành tiền.)
const DON_VI = {
  'triệu': 1e6, 'trieu': 1e6, 'tr': 1e6, 'củ': 1e6, 'cu': 1e6,
  'nghìn': 1e3, 'nghin': 1e3, 'ngàn': 1e3, 'ngan': 1e3, 'k': 1e3,
  'đồng': 1, 'dong': 1, 'đ': 1, 'd': 1, 'vnd': 1, 'vnđ': 1,
};
const RE_TIEN = new RegExp(
  '(?<![\\p{L}\\p{N}])'
  + '(\\d{1,3}(?:[.,]\\d{3})+|\\d+(?:[.,]\\d{1,2})?)'          // phần số
  + '\\s*'
  + '(tri[ệe]u|tr|c[ủu]|ngh[ìi]n|ng[àa]n|k|[đd][ồo]ng|vn[đd]|[đd])?' // đơn vị (có thể vắng)
  + '(?![\\p{L}\\p{N}])',
  'giu'
);
// Ngữ cảnh GIÁ trong câu — dùng để quyết số "trần" (không đơn vị) có phải tiền không.
const RE_NGU_CANH_GIA = /(gi[áa]|chi ph[íi]|ph[íi]|ti[ềe]n|bao nhi[êe]u|tr[ọo]n g[óo]i|[ưu]u [đd][ãa]i|gi[ảa]m|combo|g[óo]i)/i;

/**
 * Đọc mọi con TIỀN trong một chuỗi.
 * @returns {Array<{raw:string, tri:number, dau:number, cuoi:number, coDonVi:boolean}>}
 */
export function docTien(chuoi) {
  const s = String(chuoi || '');
  const coNguCanh = RE_NGU_CANH_GIA.test(boDau(s)) || RE_NGU_CANH_GIA.test(s);
  const ra = [];
  RE_TIEN.lastIndex = 0;
  let m;
  while ((m = RE_TIEN.exec(s)) !== null) {
    if (m[0].trim() === '') { RE_TIEN.lastIndex++; continue; }
    const phanSo = m[1];
    const donViRaw = (m[2] || '').toLowerCase();
    const coNhomNghin = /[.,]\d{3}(?:[.,]|$)/.test(phanSo) && /^\d{1,3}(?:[.,]\d{3})+$/.test(phanSo);
    const heSo = donViRaw ? (DON_VI[boDau(donViRaw)] ?? DON_VI[donViRaw] ?? null) : null;

    let tri = null;
    if (coNhomNghin) {
      // 5.000.000 → 5000000. Có đơn vị "triệu" đi kèm thì hiếm, bỏ qua nhân thêm.
      tri = parseInt(phanSo.replace(/[.,]/g, ''), 10);
    } else if (heSo != null) {
      const so = parseFloat(phanSo.replace(',', '.'));
      if (!Number.isFinite(so)) { continue; }
      tri = Math.round(so * heSo);
    } else {
      continue; // số trần, không đơn vị, không nhóm nghìn → không phải tiền
    }
    // Số trần (có nhóm nghìn nhưng KHÔNG có đơn vị tiền) chỉ tính là tiền khi câu nói về giá.
    // Nhờ đó "hơn 1.000 bệnh nhân" không bị bắt oan.
    if (coNhomNghin && !heSo && !coNguCanh) continue;
    if (!Number.isFinite(tri) || tri <= 0) continue;
    ra.push({ raw: m[0], tri, dau: m.index, cuoi: m.index + m[0].length, coDonVi: Boolean(heSo) });
  }
  return ra;
}

// ---------------------------------------------------------------------------
// 5. ƯU ĐÃI — chỉ 2 khoản đã duyệt
// ---------------------------------------------------------------------------
// Từ khoá "có mùi ưu đãi". Riêng nó thì CHƯA đủ để kết tội: câu kịch bản đã duyệt
// "Em giữ suất ưu đãi này cho mình nha" cũng chứa chữ "ưu đãi" — chặn nó là chặn
// đúng đòn đổi-ưu-đãi-lấy-số, thứ mạnh nhất bot có (luật ⑥ của gia-va-uu-dai.md).
const RE_TU_UU_DAI = /([ưu]u [đd][ãa]i|khuy[ếe]n m[ãa]i|khuy[ếe]n m[ạa]i|gi[ảa]m gi[áa]|gi[ảa]m th[êe]m|gi[ảa]m\s*\d+\s*%|mi[ễe]n ph[íi]|t[ặa]ng|voucher|combo|qu[àa] t[ặa]ng|freeship)/i;
// ⚠️ VÁ 06/09/2026 19:45 — CHẶN OAN THẬT, Sếp Trình bắt tại trận.
// Cổng chặn ô: «…mình để lại số để Bác sĩ gọi tư vấn miễn phí nha 🙏» — báo `uu_dai_bia`,
// chỉ vì dính chữ "miễn phí". Nhưng "TƯ VẤN/GỌI miễn phí" KHÔNG phải ưu đãi — nó tả việc
// cuộc gọi không mất tiền, đúng sự thật, và nằm sẵn 9 CHỖ trong `system-prompt.md`.
// Chặn nó = chặn đúng câu xin số của bot ⇒ mất luôn cơ hội lấy SĐT.
// Chỉ coi là ưu đãi khi "miễn phí" gắn với MÓN LỢI VẬT CHẤT, không phải với lời tư vấn.
const RE_MIEN_PHI_HOP_LE = /(t[ưu] v[ấa]n|g[ọo]i|nh[ắa]n|inbox|tin nh[ắa]n|trao [đd][ổo]i|h[ỗo] tr[ợo]|gi[ảa]i [đd][áa]p)\s*(l[àa]\s*)?mi[ễe]n ph[íi]|mi[ễe]n ph[íi]\s*(cho\s*)?(t[ưu] v[ấa]n|g[ọo]i|nh[ắa]n)/i;
// ⚠️ VÁ 08/09/2026 — CHẶN OAN THẬT, Sếp Trình bắt tại trận (câu mời follow OA tặng cẩm nang).
// "TẶNG/GỬI cẩm nang · tài liệu · ebook · bài tập · video · trọn bộ" KHÔNG phải ưu đãi dịch vụ —
// đó là NỘI DUNG KIẾN THỨC Y HỌC MIỄN PHÍ để kéo follow Zalo OA (đúng đòn mở van co_kenh Đòn 4,
// hợp pháp DMKT). Chặn nó = chặn đúng đòn kéo follow ta muốn bot làm. Gỡ cụm này ra TRƯỚC khi dò
// ưu đãi; nếu sau khi gỡ không còn từ ưu đãi nào thì đây là câu tặng tài liệu, KHÔNG chặn.
// Global (g) để gỡ HẾT mọi cụm "tặng ... tài liệu" trong ô (câu mời OA hay lặp 2 lần).
const RE_TANG_NOI_DUNG_HOP_LE = /(t[ặa]ng|g[ửu]i|g[ửu]i t[ặa]ng|chia s[ẻe]|nh[ậa]n)\s*[^.!?]{0,25}?(c[ẩa]m nang|t[àa]i li[ệe]u|ebook|e-?book|b[àa]i t[ậa]p|video|clip|infographic|tr[ọo]n b[ộo]|b[ộo] t[àa]i li[ệe]u|h[ìi]nh [ảa]nh minh h[ọo]a|t[àa]i li[ệe]u tham kh[ảa]o)/gi;
// …phải KÈM một MÓN LỢI CỤ THỂ mới tính là đang hứa ưu đãi.
const RE_MON_LOI = /(\d\s*%|mi[ễe]n ph[íi]|t[ặa]ng|voucher|combo|qu[àa]|gi[ảa]m th[êe]m|khuy[ếe]n m[ãa]i|khuy[ếe]n m[ạa]i)/i;
// Hai khuôn ĐÃ DUYỆT.
const RE_UU_DAI_1 = /(gi[ảa]m\s*50\s*%|150)/i;                     // giảm 50% phí khám → 150k
const RE_UU_DAI_1_BOI_CANH = /(ph[íi]\s*kh[áa]m|kh[áa]m|bhyt|h[ọo]c sinh|sinh vi[êe]n|c[ôo]ng nh[âa]n|vi[êe]n ch[ứu]c|60 tu[ổo]i)/i;
const RE_UU_DAI_2 = /[đd]i[ệe]n xung/i;                            // tặng 1 lần điện xung (400k)

// ---------------------------------------------------------------------------
// 6. KHAN HIẾM / HẠN CHÓT BỊA — hai ưu đãi trên KHÔNG có hạn thời gian
// ---------------------------------------------------------------------------
// Cách xử: SỬA — cắt đúng mệnh đề bịa, giữ phần còn lại của câu.
const RE_KHAN_HIEM = [
  /(?:ch[ỉi]\s*)?c[òo]n\s*\d+\s*(?:su[ấa]t|slot|ch[ỗo])(?:\s*cu[ốo]i)?/giu,
  /\d+\s*(?:su[ấa]t|slot|ch[ỗo])\s*cu[ốo]i(?:\s*c[ùu]ng)?/giu,
  /ch[ỉi]\s*(?:c[òo]n\s*)?(?:trong\s*)?h[ôo]m nay/giu,
  /h[ôo]m nay\s*th[ôo]i/giu,
  /h[ếe]t h[ạa]n\s*(?:trong\s*)?h[ôo]m nay/giu,
  /(?:[ưu]u [đd][ãa]i\s*)?[đd][ếe]n h[ếe]t\s*(?:ng[àa]y|tu[ầa]n|th[áa]ng)[^,.!?\n]{0,20}/giu,
  /tu[ầa]n n[àa]y\s*th[ôo]i/giu,
  /s[ốo] l[ượuơ]{0,3}ng c[óo] h[ạa]n/giu,
  /nhanh tay\s*(?:k[ẻe]o|[đd][ểe])?[^,.!?\n]{0,15}/giu,
  /s[ắa]p h[ếe]t\s*(?:su[ấa]t|[ưu]u [đd][ãa]i)/giu,
  /(?:ch[ỉi]\s*)?[áa]p d[ụu]ng\s*(?:trong\s*)?h[ôo]m nay/giu,
];

// ---------------------------------------------------------------------------
// 7. CÂU AN TOÀN — dùng khi ô bị chặn hẳn. TUYỆT ĐỐI KHÔNG để bot im.
// ---------------------------------------------------------------------------
// Xoay theo PHÚT (đúng cơ chế cauTreoXoay của gemini.js): hai lượt liên tiếp không
// trùng nguyên văn ⇒ không bị cửa lọc chống-lặp ở handler.js xoá sạch → bot im hẳn.
const CAU_AN_TOAN = [
  'Dạ để em nắm rõ hơn, mình đang đau ở vùng nào và đau bao lâu rồi ạ?',
  'Dạ mình mô tả giúp em tình trạng hiện tại với ạ, lúc nào mình thấy đau nhiều nhất ạ?',
  'Dạ em hỏi thêm chút xíu nha, mình đau bên nào và đi lại có khó không ạ?',
  'Dạ mình cho em biết thêm về tình trạng đang gặp với ạ, em xem rồi báo Bác sĩ giúp mình nha.',
];
export function cauAnToan(mocMs = Date.now()) {
  return CAU_AN_TOAN[Math.floor(mocMs / 60000) % CAU_AN_TOAN.length];
}

// ---------------------------------------------------------------------------
// 8. SỔ ĐẾM — thống kê được, không chỉ log trôi
// ---------------------------------------------------------------------------
const soDem = { tongLuot: 0, tongO: 0, oSua: 0, oChan: 0, loi: 0, theoLoai: Object.create(null) };
function dem(loai, xuLy) {
  const k = `${loai}:${xuLy}`;
  soDem.theoLoai[k] = (soDem.theoLoai[k] || 0) + 1;
}
/** Ảnh chụp sổ đếm (dùng cho /admin, báo cáo, test). */
export function thongKe() {
  return JSON.parse(JSON.stringify(soDem));
}
export function resetThongKe() {
  soDem.tongLuot = 0; soDem.tongO = 0; soDem.oSua = 0; soDem.oChan = 0; soDem.loi = 0;
  soDem.theoLoai = Object.create(null);
}

// ---------------------------------------------------------------------------
// 9. DỌN CHỮ sau khi cắt cụm — không để lại "  ,," hay câu cụt dấu
// ---------------------------------------------------------------------------
function donChu(s) {
  return String(s)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,;:])\s*([,.!?;:])/g, '$2')
    .replace(/^[\s,;:.\-–—]+/, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+$/gm, '')
    .trim();
}

// Bỏ thẻ HTML (tin Pancake dội về có thể bọc <div>/<br>) — chỉ để DÒ, không đổi ô gửi đi.
function boHtml(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
}

// ---------------------------------------------------------------------------
// 10. SOI + SỬA MỘT Ô
// ---------------------------------------------------------------------------
/**
 * @returns {{o:string|null, viPham:Array<{loai:string,xuLy:string,cum:string}>}}
 *          o = null nghĩa là CHẶN HẲN ô này.
 */
function soiMotO(oGoc, { congKhai = false } = {}) {
  const viPham = [];
  let o = String(oGoc);
  const daiGoc = o.trim().length;

  // --- (C) HỨA KẾT QUẢ → SỬA ---
  // Inbox chỉ soi BẬC CỨNG (cam kết/bảo đảm/100%); công khai soi CẢ HAI bậc (anh Trình 09/09).
  const dsHuaKetQua = congKhai ? [...RE_HUA_CUNG, ...RE_HUA_MEM] : RE_HUA_CUNG;
  for (const [re, thay, ten] of dsHuaKetQua) {
    re.lastIndex = 0;
    if (re.test(o)) {
      re.lastIndex = 0;
      o = o.replace(re, thay);
      viPham.push({ loai: 'hua_ket_qua', xuLy: 'sua', cum: ten });
    }
  }

  // --- (E) HỌC VỊ → SỬA ---
  for (const [re, thay, ten] of RE_HOC_VI) {
    re.lastIndex = 0;
    if (re.test(o)) {
      re.lastIndex = 0;
      o = donChu(o.replace(re, thay));
      viPham.push({ loai: 'hoc_vi', xuLy: 'sua', cum: ten });
    }
  }
  // "CK1" trơ trọi — chỉ tính khi ô có nhắc bác sĩ / BS / Trình.
  RE_CK_TRO.lastIndex = 0;
  if (RE_CK_TRO.test(o) && RE_CO_BAC_SI.test(o)) {
    RE_CK_TRO.lastIndex = 0;
    o = donChu(o.replace(RE_CK_TRO, ''));
    viPham.push({ loai: 'hoc_vi', xuLy: 'sua', cum: 'CK1' });
  }

  // --- KHAN HIẾM / HẠN CHÓT BỊA → SỬA (cắt mệnh đề) ---
  for (const re of RE_KHAN_HIEM) {
    re.lastIndex = 0;
    if (re.test(o)) {
      re.lastIndex = 0;
      o = donChu(o.replace(re, ''));
      viPham.push({ loai: 'khan_hiem_bia', xuLy: 'sua', cum: 'hạn chót/khan hiếm bịa' });
    }
  }

  // --- THIẾU CHỮ "TỪ" trước giá thủ thuật → SỬA (chèn lại "từ") ---
  // Làm TRƯỚC bước soi giá bịa: sửa xong mới chấm, để không kết tội câu vừa chữa được.
  {
    const tien = docTien(boHtml(o));
    // Duyệt từ CUỐI về ĐẦU để chèn chữ không làm lệch chỉ số của các vị trí phía trước.
    const canSua = tien.filter((t) => TIEN_PHAI_CO_TU.has(t.tri)).sort((a, b) => b.dau - a.dau);
    for (const t of canSua) {
      // Dò lại trên chính chuỗi `o` (boHtml chỉ dùng để đọc số; ô thật hiếm khi có HTML).
      const idx = o.indexOf(t.raw, Math.max(0, t.dau - 10));
      if (idx < 0) continue;
      const truoc = o.slice(0, idx);
      if (/t[ừu]\s*$/i.test(truoc)) continue;                    // đã có "từ" → bỏ qua
      if (/(kho[ảa]ng|tr[êe]n|d[ướuơ]{1,3}i)\s*$/i.test(truoc)) continue; // "khoảng/trên/dưới" — không phải nói cứng
      // Gỡ các từ NÓI CỨNG ngay trước con số ("đúng 5 triệu", "chỉ 5 triệu", "chẵn 5 triệu").
      const truocDaGo = truoc.replace(/(?:[đd][úu]ng|ch[ỉi]|ch[ẵe]n|c[óo])\s*$/i, '');
      o = `${truocDaGo}từ ${o.slice(idx)}`;
      viPham.push({ loai: 'thieu_tu', xuLy: 'sua', cum: t.raw });
    }
  }

  // --- GIÁ BỊA → CHẶN (con số sai thì không sửa an toàn được) ---
  {
    const tien = docTien(boHtml(o));
    const bia = tien.filter((t) => !TIEN_HOP_LE.has(t.tri));
    if (bia.length) {
      viPham.push({ loai: 'gia_bia', xuLy: 'chan', cum: bia.map((t) => t.raw).join(' · ') });
      return { o: null, viPham };
    }
    // Kiểm lại sau khi sửa: vẫn thiếu "từ" ⇒ không cứu được ⇒ chặn.
    for (const t of tien) {
      if (!TIEN_PHAI_CO_TU.has(t.tri)) continue;
      const truoc = o.slice(0, t.dau);
      if (!/(t[ừu]|kho[ảa]ng|tr[êe]n|d[ướuơ]{1,3}i)\s*$/i.test(truoc)) {
        viPham.push({ loai: 'thieu_tu', xuLy: 'chan', cum: t.raw });
        return { o: null, viPham };
      }
    }
    // --- CÔNG KHAI: cấm MỌI giá thủ thuật (nhóm cấm B — nặng nhất của luật DMKT) ---
    if (congKhai && tien.some((t) => t.tri !== GIA_THAT.KHAM && t.tri !== GIA_THAT.KHAM_UU_DAI)) {
      viPham.push({ loai: 'gia_noi_cong_khai', xuLy: 'chan', cum: tien.map((t) => t.raw).join(' · ') });
      return { o: null, viPham };
    }
  }

  // --- ƯU ĐÃI: INBOX thả thoải mái, CÔNG KHAI mới siết (anh Trình chốt 08/09/2026) ---
  // Nguyên văn anh Trình: "ưu đãi trong TIN NHẮN thì cứ thoải mái — hứa hẹn, ưu đãi, tặng này kia
  // thoải mái." ⇒ làn INBOX/chat 1-1 KHÔNG chặn ưu đãi/khuyến mãi/tặng. Chỉ làn CÔNG KHAI
  // (comment/broadcast/bài đăng — nơi Sở thấy) mới giữ luật "chỉ 2 khoản đã duyệt".
  // ⚠️ Hứa KẾT QUẢ điều trị (nhóm C: "khỏi hẳn/cam kết/hết đau luôn") + học vị (E) KHÔNG nằm ở đây —
  // chúng bị chặn ở cổng riêng CẢ inbox lẫn công khai (luật pháp lý NĐ38, không theo làn).
  if (congKhai) {
    const soi = boHtml(o);
    // Gỡ cụm hợp lệ TRƯỚC khi dò: "tư vấn/gọi miễn phí" + "tặng cẩm nang/tài liệu" (kiến thức, không phải ưu đãi tiền).
    const soiUuDai = soi.replace(RE_MIEN_PHI_HOP_LE, ' ').replace(RE_TANG_NOI_DUNG_HOP_LE, ' ');
    if (RE_TU_UU_DAI.test(soiUuDai) && RE_MON_LOI.test(soiUuDai)) {
      const laUuDai1 = RE_UU_DAI_1.test(soiUuDai) && RE_UU_DAI_1_BOI_CANH.test(soiUuDai);
      const laUuDai2 = RE_UU_DAI_2.test(soiUuDai);
      if (!laUuDai1 && !laUuDai2) {
        viPham.push({ loai: 'uu_dai_bia', xuLy: 'chan', cum: 'ưu đãi ngoài 2 khoản đã duyệt (công khai)' });
        return { o: null, viPham };
      }
      // Ưu đãi ĐÚNG nhưng ở nơi CÔNG KHAI: "tặng điện xung" là kỹ thuật nhóm (A) Sở CHƯA duyệt.
      if (laUuDai2) {
        viPham.push({ loai: 'uu_dai_cong_khai', xuLy: 'chan', cum: 'điện xung ở nơi công khai' });
        return { o: null, viPham };
      }
    }
  }

  o = donChu(o);
  if (!o) {
    viPham.push({ loai: 'rong_sau_sua', xuLy: 'chan', cum: '(ô rỗng sau khi sửa)' });
    return { o: null, viPham };
  }
  // CÂU VỤN SAU KHI CẮT — cắt mệnh đề bịa xong còn lại "ưu đãi ạ!" thì thà thay hẳn bằng câu
  // an toàn: mảnh cụt lủn vừa lộ máy vừa vô nghĩa, khách đọc còn khó chịu hơn là bị hỏi lại.
  // Ngưỡng: còn dưới 40 ký tự VÀ mất hơn 40% độ dài gốc.
  if (viPham.length && o.length < 40 && o.length < daiGoc * 0.6) {
    viPham.push({ loai: 'cau_vun_sau_sua', xuLy: 'chan', cum: `còn "${o}" (gốc ${daiGoc} ký tự)` });
    return { o: null, viPham };
  }
  return { o, viPham };
}

// ---------------------------------------------------------------------------
// 11. HÀM THUẦN — CỔNG GÁC
// ---------------------------------------------------------------------------
/**
 * Soi mảng ô tin bot SẮP GỬI.
 * HÀM THUẦN: không I/O, không Telegram, không đụng DB → test được, gọi được ở mọi nơi.
 *
 * @param {string[]} oVao   mảng ô tin
 * @param {object}   opts   { congKhai?:boolean, thayCauAnToan?:boolean, moc?:number }
 *        congKhai = true khi tin ra chỗ SỞ Y TẾ THẤY ĐƯỢC (rep comment công khai) →
 *        siết thêm: cấm mọi giá thủ thuật + cấm nhắc điện xung (nhóm cấm A+B).
 *        thayCauAnToan = false → chặn sạch thì trả MẢNG RỖNG thay vì thay câu an toàn.
 *        Mặc định true cho INBOX (bot im = mất khách), tự động false cho CÔNG KHAI
 *        (thà không rep còn hơn để lại chữ trên tường page).
 * @returns {{oCuoi:string[], viPham:Array, daSua:boolean, loi:string|null}}
 */
export function ganhCong(oVao, opts = {}) {
  const { congKhai = false, moc = Date.now() } = opts || {};
  const thayCauAnToan = opts?.thayCauAnToan ?? !congKhai;
  try {
    const vao = (Array.isArray(oVao) ? oVao : [oVao])
      .filter((m) => m != null && typeof m !== 'object' && String(m).trim() !== '')
      .map((m) => String(m));
    if (!vao.length) return { oCuoi: [], viPham: [], daSua: false, loi: null };

    soDem.tongLuot++;
    soDem.tongO += vao.length;

    const oCuoi = [];
    const viPham = [];
    let daSua = false;

    for (const oGoc of vao) {
      const kq = soiMotO(oGoc, { congKhai });
      for (const v of kq.viPham) {
        viPham.push({ ...v, nguyenVan: oGoc.slice(0, 400) });
        dem(v.loai, v.xuLy);
        if (v.xuLy === 'chan') soDem.oChan++; else soDem.oSua++;
      }
      if (kq.o === null) { daSua = true; continue; }      // chặn hẳn ô này
      if (kq.o !== oGoc) daSua = true;                    // đã sửa
      oCuoi.push(kq.o);
    }

    // CHẶN SẠCH mà KHÔNG thay gì = BOT CÂM = mất khách. Luôn trả về ít nhất 1 ô.
    if (!oCuoi.length && viPham.length && thayCauAnToan) {
      oCuoi.push(cauAnToan(moc));
      viPham.push({ loai: 'thay_cau_an_toan', xuLy: 'thay', cum: '(toàn bộ lượt bị chặn → thay câu an toàn)', nguyenVan: vao.join(' | ').slice(0, 400) });
    }

    if (viPham.length) {
      const gom = viPham.map((v) => `${v.loai}/${v.xuLy}`).join(', ');
      console.warn(`[conggac] ${congKhai ? 'CÔNG KHAI ' : ''}bắt ${viPham.length} vi phạm: ${gom} — vào ${vao.length} ô, ra ${oCuoi.length} ô`);
    }
    return { oCuoi, viPham, daSua, loi: null };
  } catch (err) {
    // FAIL-SAFE: cổng hỏng thì CHO TIN ĐI QUA. Bot câm tệ hơn một câu lọt lưới.
    soDem.loi++;
    console.error('[conggac] 🔴 CỔNG GÁC NÉM LỖI → cho tin đi qua nguyên trạng (fail-safe):', err?.message || err);
    const luiVe = (Array.isArray(oVao) ? oVao : [oVao])
      .filter((m) => m != null && String(m).trim() !== '').map((m) => String(m));
    return { oCuoi: luiVe, viPham: [], daSua: false, loi: String(err?.message || err) };
  }
}

// ---------------------------------------------------------------------------
// 12. CẢNH BÁO TELEGRAM — GỘP TẦN SUẤT (1 tin / 5 phút / loại)
// ---------------------------------------------------------------------------
// Bắn từng ca là spam group điều hành → người ta tắt thông báo → cảnh báo thật cũng chìm.
const CUA_SO_CANH_BAO_MS = parseInt(process.env.CONGGAC_ALERT_WINDOW_MS || '300000', 10);
const lanBaoCuoi = new Map();   // loai -> mốc ms
const donCho = new Map();       // loai -> số ca bị gộp từ lần báo trước

function linkHoiThoai(pageId, conversationId) {
  if (!pageId || !conversationId) return '';
  return `https://pancake.vn/${String(pageId).replace(/^\d+_/, '')}?c_id=${conversationId}`;
}

async function banCanhBao(viPham, { pageId, conversationId, congKhai }) {
  // INBOX: chỉ báo người khi CHẶN HẲN (giá bịa, ưu đãi bịa...) — sửa vặt (C)(E) làm lặng lẽ,
  // ghi log + sổ đếm là đủ. Anh Trình 09/09: "đừng báo group mấy quả tào lao như thế".
  // CÔNG KHAI: báo cả việc SỬA (C)(E) — chỗ Sở thấy được thì người phải biết ngay.
  const dangBao = viPham.filter((v) => v.xuLy === 'chan'
    || (congKhai && (v.loai === 'hua_ket_qua' || v.loai === 'hoc_vi')));
  if (!dangBao.length) return;
  const bay = Date.now();
  for (const v of dangBao) {
    const truoc = lanBaoCuoi.get(v.loai) || 0;
    if (bay - truoc < CUA_SO_CANH_BAO_MS) {
      donCho.set(v.loai, (donCho.get(v.loai) || 0) + 1);
      continue;
    }
    lanBaoCuoi.set(v.loai, bay);
    const gop = donCho.get(v.loai) || 0;
    donCho.set(v.loai, 0);
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const nhan = v.xuLy === 'chan' ? '⛔ ĐÃ CHẶN' : '✏️ ĐÃ SỬA';
    const noi = congKhai ? 'COMMENT CÔNG KHAI' : 'inbox';
    let tin = `🚧 <b>CỔNG GÁC BOT — ${nhan}</b>\n`
      + `🏷 Loại: <b>${esc(v.loai)}</b> (${esc(v.cum)})\n`
      + `📍 Nơi: ${noi}\n`
      + `💬 Nguyên văn ô: <code>${esc(String(v.nguyenVan || '').slice(0, 300))}</code>`;
    const link = linkHoiThoai(pageId, conversationId);
    if (link) tin += `\n🔗 ${link}`;
    if (gop > 0) tin += `\n➕ (${gop} ca cùng loại bị gộp trong ${Math.round(CUA_SO_CANH_BAO_MS / 60000)} phút qua)`;
    try {
      const tg = await import('./telegram.js');   // dynamic: tránh vòng import pancake↔telegram
      await tg.notifyText(tin);
    } catch (e) {
      console.error('[conggac] không bắn được cảnh báo Telegram:', e?.message || e);
    }
  }
}

// ---------------------------------------------------------------------------
// 13. VỎ BỌC DÙNG Ở ĐƯỜNG GỬI — gọi cổng + bắn cảnh báo (không chặn luồng gửi)
// ---------------------------------------------------------------------------
/**
 * Gọi ở ĐIỂM CUỐI CÙNG trước khi đẩy tin ra API. Trả về mảng ô ĐÃ QUA CỔNG.
 * Cảnh báo Telegram chạy nền (fire-and-forget) — không để khách phải chờ.
 */
export function locTruocKhiGui(oVao, opts = {}) {
  const kq = ganhCong(oVao, opts);
  if (kq.viPham.length) {
    banCanhBao(kq.viPham, {
      pageId: opts.pageId, conversationId: opts.conversationId, congKhai: Boolean(opts.congKhai),
    }).catch((e) => console.error('[conggac] cảnh báo lỗi:', e?.message || e));
  }
  return kq.oCuoi;
}

/** Bản 1-ô cho các đường gửi từng tin (zalo.sendText, pancake.replyComment). */
export function locMotO(text, opts = {}) {
  const ra = locTruocKhiGui([text], opts);
  return ra.length ? ra[0] : '';
}
