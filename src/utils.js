// Phone detector: regex SĐT Việt Nam — chốt thêm ngoài tín hiệu của Gemini.
// Bắt các kiểu: 0912345678, 0912 345 678, 0912.345.678, +84912345678.

// Cụm chữ số (kèm dấu cách/chấm/gạch) — để dò mọi chuỗi giống số điện thoại.
const DIGIT_GROUP_RE = /(?:(?:\+?84)|0)[\d .\-]{7,13}\d/g;

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
  if (!text) return false;
  const matches = text.match(DIGIT_GROUP_RE);
  if (!matches) return false;
  for (const m of matches) {
    const n = normalize(m);
    if (VALID_VN_MOBILE.test(n)) return false; // có số hợp lệ rồi → không "bad"
  }
  // có cụm số nhiều chữ số (giống ý định cho SĐT) nhưng không hợp lệ
  for (const m of matches) {
    const digits = normalize(m).replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 11 && /^0|^84/.test(digits)) return true;
  }
  return false;
}
