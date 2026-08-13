// ============================================================
//  NHẬN DIỆN "KHÁCH ĐÃ KHÁM" THEO SĐT (anh Trình chốt 02/07):
//  Khách nhắn FB mà SĐT trùng hồ sơ MEDi (EMR) hoặc đơn POS "đã đến khám/đã thu tiền"
//  → bot chuyển GIAI ĐOẠN CHĂM SÓC SAU KHÁM: không chào như lead mới, không xin số,
//  không mời "suất tư vấn miễn phí".
//
//  Thứ tự tra: MEDi trước (EMR chuẩn, có bệnh án/liệu trình) → POS (đơn bắn trên Facebook).
//  Fail-open toàn phần: nguồn nào chưa cấu hình/lỗi → bỏ qua nguồn đó, bot vẫn chạy bình thường.
//  (Nhãn Pancake "đã đến khám/đã thu tiền" vẫn là lớp nhận diện SONG SONG — hasCustomerLabel;
//   lớp này vá ca hội thoại KHÔNG được gắn nhãn nhưng SĐT đã lên đơn.)
// ============================================================
import { lookupMedi } from './medi.js';
import { lookupPosCustomer } from './pos.js';

/**
 * Tra "khách đã khám" theo SĐT qua MEDi → POS.
 * @param {string} phone
 * @returns {Promise<object|null>} { source:'medi'|'pos', name, diagnosis?, treatment?, lastVisit?, visits?, hasBill? } | null
 */
export async function lookupDaKham(phone) {
  if (!phone) return null;
  try {
    const medi = await lookupMedi(phone);
    // VÁ 13/08 (ca Quoc Huy Vo — MẤT LEAD THẬT): vá 27/07 ghi bệnh khách TỰ KHAI qua chat vào
    // cache MEDi (nguon='tu_khai') để chuỗi chăm sau bán hết unknown — nhưng chỗ này tra thấy
    // "có hồ sơ MEDi" là kết luận ĐÃ KHÁM luôn → lead vừa cho SĐT + kể bệnh, 3 phút sau bị bot
    // gọi "khách cũ, phí tái khám vài trăm nghìn" → khách: "Anh chưa hề khám bên em... Bye".
    // Luật: bản ghi TỰ KHAI chỉ để cá nhân hoá nội dung, KHÔNG BAO GIỜ là bằng chứng đã khám.
    // Bằng chứng đã khám = hồ sơ EMR bác sĩ (không tu_khai) HOẶC đơn POS đã đến/đã thu (nhánh dưới).
    if (medi && !medi.tuKhai) return { source: 'medi', ...medi };
    if (medi?.tuKhai) {
      console.log(`[da-kham] SĐT ${String(phone).slice(0, 5)}*** chỉ có hồ sơ TỰ KHAI (lead kể bệnh qua chat, CHƯA khám) → không tính đã khám, tra POS tiếp`);
    }
  } catch { /* fail-open, thử nguồn kế */ }
  try {
    return await lookupPosCustomer(phone);
  } catch { return null; }
}

/**
 * Thẻ ngữ cảnh gắn vào prompt Gemini: đổi vai bot từ "săn lead" sang "chăm sóc sau khám".
 */
export function buildDaKhamTag(rec) {
  const parts = [];
  if (rec.name) parts.push(`tên=${rec.name}`);
  if (rec.diagnosis) parts.push(`bệnh án=${rec.diagnosis}`);
  if (rec.treatment) parts.push(`liệu trình=${rec.treatment}`);
  if (rec.lastVisit) parts.push(`lần đến khám gần nhất=${String(rec.lastVisit).slice(0, 10)}`);
  if (rec.visits) parts.push(`số lần lên đơn=${rec.visits}`);
  return `[KHÁCH ĐÃ KHÁM — nguồn ${rec.source === 'medi' ? 'hồ sơ bệnh án EMR' : 'đơn POS'}] ${parts.join(', ') || '(có hồ sơ)'}.\n` +
    'Đây là bệnh nhân ĐÃ ĐẾN KHÁM tại phòng khám → bước vào giai đoạn CHĂM SÓC SAU KHÁM: ' +
    'hỏi thăm tình trạng sau điều trị, dặn dò theo dõi tại nhà, nhắc tái khám/buổi tiếp theo của liệu trình khi phù hợp. ' +
    'TUYỆT ĐỐI KHÔNG chào như khách mới, KHÔNG xin số điện thoại, KHÔNG mời "suất tư vấn miễn phí" như lead.';
}
