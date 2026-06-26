// Phone detector: regex SĐT Việt Nam — chốt thêm ngoài tín hiệu của Gemini.
// Bắt các kiểu: 0912345678, 0912 345 678, 0912.345.678, +84912345678.

const PHONE_RE = /(?:(?:\+?84)|0)(?:\d[ .\-]?){8,10}\d/g;

// Chuẩn hóa: bỏ khoảng trắng/dấu chấm/gạch; +84 → 0.
function normalize(raw) {
  let s = raw.replace(/[ .\-]/g, '');
  if (s.startsWith('+84')) s = '0' + s.slice(3);
  else if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
  return s;
}

/**
 * Trích SĐT VN đầu tiên hợp lệ từ text (9–11 số sau chuẩn hóa, bắt đầu bằng 0).
 * @returns {string|null}
 */
export function extractPhone(text) {
  if (!text) return null;
  const matches = text.match(PHONE_RE);
  if (!matches) return null;
  for (const m of matches) {
    const n = normalize(m);
    if (/^0\d{8,10}$/.test(n)) return n; // 10–11 chữ số, hợp lệ VN
  }
  return null;
}
