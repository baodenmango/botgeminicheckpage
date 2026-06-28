// Phone detector: regex SĐT Việt Nam — chốt thêm ngoài tín hiệu của Gemini.
// Bắt các kiểu: 0912345678, 0912 345 678, 0912.345.678, +84912345678.

// Cụm chữ số (kèm dấu cách/chấm/gạch) — để dò mọi chuỗi giống số điện thoại.
const DIGIT_GROUP_RE = /(?:(?:\+?84)|0)[\d .\-]{6,13}\d/g;

// Chuẩn hóa: bỏ khoảng trắng/dấu chấm/gạch; +84 → 0; 84... → 0...
function normalize(raw) {
  let s = String(raw).replace(/[ .\-]/g, '');
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
  return s;
}

// SĐT di động VN HỢP LỆ: đúng 10 số, bắt đầu 03/05/07/08/09.
// (Đầu số cố định hiếm gặp trong tư vấn nên không nhận, tránh nhầm.)
const VALID_VN_MOBILE = /^0(3|5|7|8|9)\d{8}$/;

/**
 * Trích SĐT VN HỢP LỆ đầu tiên từ text (đúng 10 số, đầu số di động chuẩn).
 * Số thiếu/thừa số → KHÔNG chốt (trả null) để bot hỏi lại, tránh telesale gọi số chết.
 * @returns {string|null}
 */
export function extractPhone(text) {
  if (!text) return null;
  const matches = text.match(DIGIT_GROUP_RE);
  if (!matches) return null;
  for (const m of matches) {
    const n = normalize(m);
    if (VALID_VN_MOBILE.test(n)) return n;
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
  const matches = text.match(DIGIT_GROUP_RE);
  if (!matches) return null;
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
