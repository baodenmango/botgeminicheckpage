// ============================================================
//  CHUỖI CHẠM "CA RA BILL" — luồng GIÁ TRỊ NHẤT (thiết kế mục D-BIS).
//  Anh Trình chốt 30/06: TỪ GIỜ 100% BN đến khám bị BẮT bấm Quan tâm Zalo OA tại quầy
//  → ca nào cũng follow OA → ca nào cũng chạm được.
//
//  Kích hoạt: POS ra bill có THUỐC hoặc DỊCH VỤ TIÊM (không phải khám suông).
//  5 chạm, mốc tính từ NGÀY RA BILL (= ngày 0). Gửi qua Zalo OA.
//  Cá nhân hoá: chèn tên bệnh + loại thuốc/tiêm thật (từ POS/MEDi) → lời nói có sức nặng y khoa.
//
//  ĐÒN TÂM LÝ "tới nóc" trong ranh giới y tế (KHÔNG bịa kết quả, KHÔNG cam kết khỏi 100%,
//  KHÔNG dọa biến chứng SAI — ĐƯỢC nói thật mạnh hậu quả CÓ THẬT của bỏ dở điều trị).

import { CONDITION_VI } from './conditions.js';

// Tên bệnh đọc được (vd "khớp gối") để chèn vào câu. Fallback "xương khớp".
function tenBenh(condition) {
  const vi = CONDITION_VI[condition];
  if (!vi) return 'xương khớp';
  // rút gọn cho tự nhiên: "Khớp gối / thoái hóa gối" -> "khớp gối"
  return vi.split('/')[0].trim().toLowerCase();
}

// Mô tả "việc đã làm" trong bill để câu chăm cụ thể (có thuốc / có tiêm / cả hai).
function moTaDieuTri(bill) {
  const co = [];
  if (bill?.hasInjection) co.push('mũi tiêm');
  if (bill?.hasMedicine) co.push('toa thuốc');
  if (co.length === 0) return 'đợt điều trị';
  return co.join(' và ');
}

// ---------- Nội dung 5 chạm ----------
// Mỗi hàm trả về MẢNG ô tin (1–3 ô ngắn). `bill` = { condition, hasMedicine, hasInjection, name }.

function cham0(bill) {                       // Ngày 0 (tối) — chăm sóc ấm
  const benh = tenBenh(bill.condition);
  const msgs = [
    `Dạ ${xung(bill)}ơi, em bên Phòng khám Hiệp Lợi đây ạ 🌿 Hôm nay mình tới khám ${benh}, em hỏi thăm mình chút nha.`,
  ];
  if (bill.hasMedicine) {
    msgs.push('Mình nhớ uống thuốc đúng giờ Bác sĩ dặn, ăn no rồi hẵng uống cho êm bụng nha ạ.');
  }
  if (bill.hasInjection) {
    msgs.push('Chỗ tiêm hôm nay mình giữ khô sạch, hạn chế vận động mạnh vùng đó trong hôm nay nha ạ.');
  }
  msgs.push('Có gì khó chịu mình cứ nhắn em liền nha, em luôn ở đây ạ 🙏');
  return msgs;
}

function cham1(bill) {                       // Ngày 1 — dặn an toàn (chặn khách hoảng bỏ thuốc)
  if (bill.hasInjection) {
    return [
      `Dạ ${xung(bill)}ơi, sau tiêm 1-2 hôm vùng tiêm hơi sưng tức nhẹ là bình thường, mình đắp ấm cho dễ chịu nha ạ.`,
      'Còn nếu sưng đỏ nhiều, sốt, hay đau tăng bất thường thì mình nhắn em NGAY để Bác sĩ xem giúp nha ạ 🙏',
    ];
  }
  return [
    `Dạ ${xung(bill)}ơi, mấy hôm đầu uống thuốc nếu thấy hơi khác lạ (cồn cào, chóng mặt nhẹ) thì cứ nhắn em nha ạ.`,
    'Mình đừng tự ý ngưng thuốc giữa chừng nha, có gì em hỏi Bác sĩ điều chỉnh cho mình ạ 🙏',
  ];
}

function cham3(bill) {                       // Ngày 3 — hỏi tiến triển (khách tự nói "đỡ")
  const dt = moTaDieuTri(bill);
  return [
    `Dạ ${xung(bill)}ơi, ${dt} bắt đầu ngấm rồi đó ạ, mấy hôm nay mình thấy đỡ hơn chút nào chưa ạ? 🌸`,
    'Mình kể em nghe với, để em báo Bác sĩ theo dõi tiến triển cho mình nha ạ.',
  ];
}

function cham6(bill) {                       // Ngày 6 — NHẮC TÁI KHÁM (chốt) — đòn mạnh nhất
  return [
    `Dạ ${xung(bill)}ơi, mình đỡ hơn là mừng rồi, nhưng đỡ chưa phải là khỏi hẳn đâu ạ 🙏`,
    'Xương khớp mà ngưng giữa chừng dễ tái lại, lần sau thường khó chịu hơn lần trước ạ. Bác sĩ cần xem lại để chỉnh phác đồ đúng lúc cho mình.',
    'Mình sắp xếp qua tái khám cho Bác sĩ kiểm tra nha, em giữ suất cho mình trước ạ 🌿',
  ];
}

function cham7(bill) {                       // Ngày 7 (nếu chưa đặt lịch) — khan hiếm
  return [
    `Dạ ${xung(bill)}ơi, tuần này lịch Bác sĩ Trình còn vài suất, em tranh thủ giữ một suất tái khám cho mình nha ạ.`,
    'Mình nhắn em ngày nào tiện để em xếp giúp cho khỏi phải chờ ạ 🙏',
  ];
}

// Xưng hô đơn giản từ tên (engine không có giới tính chắc → "mình/anh chị" an toàn,
// có tên thì gọi tên). Trả "anh/chị " hoặc "<tên> " (kèm dấu cách để ghép câu).
function xung(bill) {
  const ten = tenGoi(bill?.name);
  return ten ? `${ten} ` : 'anh/chị ';
}
function tenGoi(fullName) {
  if (!fullName) return null;
  const parts = String(fullName).trim().split(/\s+/);
  const last = parts[parts.length - 1];
  // tránh dùng tên FB tiếng Anh/biệt danh khó đoán
  return /^[A-Za-zÀ-ỹ]+$/.test(last) ? last : null;
}

// --- Bảng định nghĩa 5 chạm. `day` = mốc ngày kể từ ngày ra bill (ngày 0). ---
// `priority` (ngân sách quota B3): 'cao' = luôn gửi kể cả cạn quota (d6/d7 là chạm ra tiền);
// 'thuong' = tự hoãn khi quota còn ≤ mức dự trữ.
export const BILL_TOUCHES = [
  { code: 'd0', day: 0, build: cham0, priority: 'thuong', muctieu: 'Chăm sóc ấm sau khám/tiêm' },
  { code: 'd1', day: 1, build: cham1, priority: 'thuong', muctieu: 'Dặn an toàn — chặn hoảng bỏ thuốc' },
  { code: 'd3', day: 3, build: cham3, priority: 'thuong', muctieu: 'Hỏi tiến triển — khách tự nói đỡ' },
  { code: 'd6', day: 6, build: cham6, priority: 'cao', muctieu: 'NHẮC TÁI KHÁM (chốt) — đòn mạnh nhất' },
  { code: 'd7', day: 7, build: cham7, priority: 'cao', muctieu: 'Khan hiếm — giữ suất tái khám' },
];

/**
 * Sinh nội dung 1 chạm ca-ra-bill.
 * @param {string} code  'd0'|'d1'|'d3'|'d6'|'d7'
 * @param {object} bill  { condition, hasMedicine, hasInjection, name }
 * @returns {string[]|null}
 */
export function buildBillMessages(code, bill) {
  const t = BILL_TOUCHES.find((x) => x.code === code);
  if (!t) return null;
  const msgs = t.build(bill || {});
  return Array.isArray(msgs) && msgs.length ? msgs.slice(0, 4) : null;
}
