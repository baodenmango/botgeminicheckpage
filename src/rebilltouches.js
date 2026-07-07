// ============================================================
//  CHUỖI CHẠM TÁI BILL theo 4 NHÓM bệnh nhân (thiết kế mục D + D-TER).
//  Gửi qua Zalo OA. Mỗi chạm gắn 1 ĐÒN TÂM LÝ (ethical persuasion) — đòn "tới nóc" nhưng
//  trong RANH GIỚI y tế (không bịa kết quả, không cam kết khỏi 100%, không dọa biến chứng sai;
//  ĐƯỢC nói thật hậu quả CÓ THẬT của bỏ dở điều trị).
//
//  4 NHÓM:
//   1 — Khám 1 lần, chưa quay lại (nguy cơ rơi)        → mốc tính từ bill_date.
//   2 — Đang theo liệu trình (PRP/biogen/TBG)          → mốc tính từ next_session_at (3 buổi × 1 THÁNG).
//   3 — Đã xong liệu trình (tái khám định kỳ + giới thiệu) → mốc tính từ bill_date.
//   4 — Bỏ dở giữa chừng (cứu — đòn mạnh nhất, có trách nhiệm) → mốc tính từ bill_date.
//
//  Mỗi chạm: { code, group, timeField, day, build }.
//   timeField = 'bill_date' | 'next_session_at'. day âm = TRƯỚC mốc (nhắc trước buổi hẹn).

function ten(rec) {
  const fn = rec?.name;
  if (!fn) return 'anh/chị';
  const last = String(fn).trim().split(/\s+/).pop();
  return /^[A-Za-zÀ-ỹ]+$/.test(last) ? last : 'anh/chị';
}

// ---------- NHÓM 1: khám 1 lần chưa lại ----------
const G1 = [
  { code: 'g1_d3',  group: 1, timeField: 'bill_date', day: 3, build: (r) => [
    `Dạ ${ten(r)} ơi, Bác sĩ gửi mình thêm vài lời dặn chăm sóc tại nhà theo đúng tình trạng hôm khám nha ạ 🌿`,
    'Mình vận động nhẹ đều đặn, tránh giữ một tư thế quá lâu. Có gì khó chịu cứ nhắn em nha ạ.',
  ] }, // đòn: có đi có lại
  { code: 'g1_d7',  group: 1, timeField: 'bill_date', day: 7, build: (r) => [
    `Dạ ${ten(r)} ơi, mấy hôm nay tình trạng của mình đỡ hơn chút nào chưa ạ? 🌸`,
    'Nhiều cô chú cùng tình trạng theo Bác sĩ một thời gian thấy đi lại nhẹ nhõm hơn hẳn ạ.',
  ] }, // đòn: bằng chứng xã hội
  { code: 'g1_d14', group: 1, timeField: 'bill_date', day: 14, build: (r) => [
    `Dạ ${ten(r)} ơi, tuần này Bác sĩ còn ít suất tư vấn, em giữ cho mình một suất quay lại kiểm tra nha ạ 🙏`,
    'Để lâu không theo dõi thì khó canh đúng lúc điều chỉnh, mình tranh thủ nha ạ.',
  ] }, // đòn: khan hiếm nhẹ + chi phí cơ hội
];

// ---------- NHÓM 2: đang liệu trình (PRP/biogen/TBG — 3 buổi × 1 THÁNG) ----------
// D-TER: cách 1 THÁNG dễ quên → nhắc KÉP (trước 3 ngày & 1 ngày). Lỡ buổi → đòn SỢ MẤT mạnh.
const G2 = [
  { code: 'g2_after', group: 2, timeField: 'bill_date', day: 3, build: (r) => [
    `Dạ ${ten(r)} ơi, sau buổi vừa rồi mình thấy đáp ứng thế nào ạ? 🌸`,
    'Mình nhớ chăm sóc theo Bác sĩ dặn, giữ đều để buổi sau phát huy tốt nhất nha ạ.',
  ] }, // đòn: cam kết nhất quán
  { code: 'g2_pre3', group: 2, timeField: 'next_session_at', day: -3, build: (r) => [
    `Dạ ${ten(r)} ơi, còn ít hôm nữa là tới lịch buổi tiếp theo trong liệu trình của mình rồi ạ 🗓️`,
    'Em nhắc trước để mình sắp xếp, em giữ suất sáng/chiều cho mình nha ạ.',
  ] }, // đòn: nhắc lịch (cách 1 tháng dễ quên)
  { code: 'g2_pre1', group: 2, timeField: 'next_session_at', day: -1, build: (r) => [
    `Dạ ${ten(r)} ơi, mai tới lịch buổi tiếp theo của mình rồi nha ạ. Em xác nhận giúp mình giờ nào tiện ạ? 🙏`,
  ] }, // đòn: nhắc lịch sát
  { code: 'g2_miss', group: 2, timeField: 'next_session_at', day: 2, build: (r) => [
    `Dạ ${ten(r)} ơi, em thấy mình lỡ buổi hẹn rồi, em lo cho liệu trình của mình ạ 😔`,
    'Các mũi cách nhau quá xa dễ làm giảm hiệu quả cả liệu trình mình đã theo. Mình sắp xếp qua bù sớm nha, em giữ suất cho mình ạ.',
  ] }, // đòn: SỢ MẤT (loss aversion) — mạnh, đúng sự thật
];

// ---------- NHÓM 3: đã xong liệu trình (tái khám định kỳ + giới thiệu) ----------
const G3 = [
  { code: 'g3_d7',  group: 3, timeField: 'bill_date', day: 7, build: (r) => [
    `Dạ ${ten(r)} ơi, mình hoàn thành liệu trình rồi, mừng cho mình ạ 🌿 Em gửi mình ít bài tập duy trì kết quả tại nhà nha.`,
    'Mình giữ thói quen vận động nhẹ đều, có gì cứ nhắn em nha ạ.',
  ] }, // đòn: bằng chứng + chăm sóc
  { code: 'g3_d30', group: 3, timeField: 'bill_date', day: 30, build: (r) => [
    `Dạ ${ten(r)} ơi, được 1 tháng rồi, mình duy trì ổn không ạ? Bác sĩ khuyên tái khám định kỳ để giữ kết quả lâu dài nha ạ 🙏`,
    'À mà người thân mình ai đau xương khớp, mình giới thiệu qua Bác sĩ, em ưu tiên sắp lịch giúp cho ạ 🌸',
  ] }, // đòn: cam kết duy trì + giới thiệu (referral)
];

// ---------- NHÓM 4: bỏ dở giữa chừng (cứu — đòn mạnh nhất, có trách nhiệm) ----------
const G4 = [
  { code: 'g4_d3',  group: 4, timeField: 'bill_date', day: 3, build: (r) => [
    `Dạ ${ten(r)} ơi, Bác sĩ Trình có nhắn em hỏi thăm riêng tình trạng của mình ạ 🙏`,
    'Em thấy mình tạm dừng điều trị giữa chừng, Bác sĩ hơi lo vì bỏ dở dễ làm tình trạng quay lại, lần sau thường nặng hơn ạ.',
    'Mình sắp xếp quay lại để Bác sĩ xem giúp nha, em giữ suất cho mình ạ.',
  ] }, // đòn: thẩm quyền chuyên gia + lo sức khỏe (hậu quả CÓ THẬT)
  { code: 'g4_d10', group: 4, timeField: 'bill_date', day: 10, build: (r) => [
    `Dạ ${ten(r)} ơi, em vẫn để ý ca của mình ạ. Mình quay lại sớm để Bác sĩ chỉnh hướng đúng lúc, đừng để lâu thêm nha 🙏`,
  ] }, // đòn: nhắc nhẹ lần cuối, có trách nhiệm
];

// priority (ngân sách quota B3): G2 (liệu trình PRP/biogen/TBG — tiền + sức khỏe) và
// G4 (cứu ca bỏ dở) = 'cao' → luôn gửi kể cả cạn quota; G1/G3 = 'thuong' → hoãn khi cạn.
export const REBILL_TOUCHES = [...G1, ...G2, ...G3, ...G4].map((t) => ({
  priority: t.group === 2 || t.group === 4 ? 'cao' : 'thuong',
  ...t,
}));

/**
 * Sinh nội dung 1 chạm tái bill.
 * @param {string} code
 * @param {object} rec  bản ghi bill_care
 */
export function buildRebillMessages(code, rec) {
  const t = REBILL_TOUCHES.find((x) => x.code === code);
  if (!t) return null;
  const msgs = t.build(rec || {});
  return Array.isArray(msgs) && msgs.length ? msgs.slice(0, 4) : null;
}
