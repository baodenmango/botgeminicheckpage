// Phone detector: regex SĐT Việt Nam — chốt thêm ngoài tín hiệu của Gemini.
// Bắt các kiểu: 0912345678, 0912 345 678, 0912.345.678, +84912345678, (+84)..., O→0, l/I→1.

// Cụm "giống SĐT": CHỈ số + dấu cách/chấm/gạch/ngoặc/+. KHÔNG cho chữ cái vào regex dò
// (nếu cho l/O vào đây nó nuốt cả chữ thường như "zalo"). Lỗi gõ O→0, l→1 xử ở bước riêng
// bên dưới (fixTypos) CHỈ khi cụm gần-giống-số, không đụng text thường.
const DIGIT_GROUP_RE = /(?:(?:\+?84)|0)[\d .\-()]{6,13}\d/g;
// Cụm "số có lẫn lỗi gõ O/l/I" — bắt riêng để cứu ca gõ nhầm (vd 0938l93168, O938193168).
// Yêu cầu CHẶT: bắt đầu 0 hoặc O, theo sau toàn số/O/l/I/dấu, dài ~9-12, để không dính chữ thường.
const TYPO_DIGIT_RE = /\b[0O][\dOIl .\-]{8,12}\d\b/g;

// Chuẩn hóa: sửa lỗi gõ (O→0, l/I/L→1), bỏ dấu/ngoặc/cách; +84/84 → 0.
function normalize(raw) {
  let s = String(raw)
    .replace(/[Oo]/g, '0')   // chữ O (hoa/thường) → số 0
    .replace(/[lIL]/g, '1')  // l, I, L → số 1 (lỗi gõ phổ biến)
    .replace(/[ .\-()]/g, ''); // bỏ cách, chấm, gạch, ngoặc
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
  return s;
}

// SĐT di động VN HỢP LỆ: đúng 10 số, bắt đầu 03/05/07/08/09.
// (Đầu số cố định hiếm gặp trong tư vấn nên không nhận, tránh nhầm.)
const VALID_VN_MOBILE = /^0(3|5|7|8|9)\d{8}$/;

/**
 * Trích SĐT VN HỢP LỆ đầu tiên từ text (đúng 10 số, đầu số di động chuẩn).
 * Khách cho NHIỀU số (số mình + số người nhà) → lấy số HỢP LỆ ĐẦU TIÊN (không báo "dư số").
 * Số thiếu/thừa số → KHÔNG chốt (trả null) để bot hỏi lại, tránh telesale gọi số chết.
 * @returns {string|null}
 */
// Gom mọi cụm "giống số" trong text: cụm số sạch + cụm có lỗi gõ O/l/I.
function findPhoneCandidates(text) {
  const a = text.match(DIGIT_GROUP_RE) || [];
  const b = text.match(TYPO_DIGIT_RE) || [];
  return [...a, ...b];
}

export function extractPhone(text) {
  if (!text) return null;
  for (const m of findPhoneCandidates(text)) {
    const n = normalize(m);
    if (VALID_VN_MOBILE.test(n)) return n; // số hợp lệ đầu tiên → chốt luôn
  }
  return null;
}

/**
 * Quét SĐT hợp lệ trong TOÀN BỘ lịch sử tin của KHÁCH (role 'user'),
 * lấy số khách cho GẦN NHẤT. Vá ca: khách cho số ở lượt trước rồi nhắn câu khác
 * → extractPhone(tin hiện tại) trả null → bot tưởng chưa có số rồi XIN LẠI (lỗi chị Hoa).
 * Bằng cách soi cả lịch sử, bot nhận ra "đã có số rồi" → chuyển chăm sóc, không xin lại.
 * @param {Array<{role:string,text:string}>} history
 * @returns {string|null} số hợp lệ khách cho gần nhất, hoặc null
 */
export function extractPhoneFromHistory(history) {
  if (!Array.isArray(history)) return null;
  // duyệt từ MỚI → CŨ, lấy số khách cho gần nhất
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (!h || h.role !== 'user') continue; // chỉ tin KHÁCH (không quét tin bot/model)
    const p = extractPhone(h.text);
    if (p) return p;
  }
  return null;
}

/**
 * Khách CÓ VẺ đang cho số nhưng SAI/THIẾU (vd "037661694" = 9 số, hoặc 11 số).
 * Dùng để bot chủ động xin khách nhắn lại đủ số — tránh chốt nhầm số chết.
 * Trả về true khi: có cụm chữ số dài 8–11, bắt đầu 0 hoặc 84, NHƯNG không hợp lệ.
 * @returns {boolean}
 */
export function looksLikeBadPhone(text) {
  return diagnoseBadPhone(text) !== null;
}

/**
 * Chẩn LÝ DO số sai để bot nhắn ĐÚNG bệnh (đừng nói "thiếu số" khi thật ra sai đầu số).
 * Trả về:
 *  - 'wrong_prefix' : đủ 10 số nhưng đầu KHÔNG phải 03/05/07/08/09 (vd 0123888777, 0223...).
 *  - 'too_short'    : ít hơn 10 số (vd 038383882 = 9 số).
 *  - 'too_long'     : nhiều hơn 10 số (vd dư số).
 *  - null           : không phải ý định cho SĐT / đã có số hợp lệ.
 */
export function diagnoseBadPhone(text) {
  if (!text) return null;
  const matches = findPhoneCandidates(text);
  if (matches.length === 0) return null;
  for (const m of matches) {
    if (VALID_VN_MOBILE.test(normalize(m))) return null; // đã có số hợp lệ → không sai
  }
  // xét cụm số GIỐNG SĐT nhất (dài 8–11, bắt đầu 0/84)
  for (const m of matches) {
    const d = normalize(m).replace(/\D/g, '');
    if (!/^0|^84/.test(d)) continue;
    const local = d.startsWith('84') ? '0' + d.slice(2) : d; // chuẩn về dạng 0...
    if (local.length < 10) return 'too_short';
    if (local.length > 10) return 'too_long';
    // đúng 10 số mà tới đây = đầu số sai (vì VALID_VN_MOBILE đã loại ở trên)
    return 'wrong_prefix';
  }
  return null;
}
