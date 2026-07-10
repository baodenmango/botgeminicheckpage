// ============================================================
//  LỊCH NỘI DUNG BROADCAST TIN TRUYỀN THÔNG (khai thác 4 tin MIỄN PHÍ/follower/tháng).
//  Đòn 1 của kế hoạch "tối đa hóa Zalo OA" (06-Ke-hoach/KE-HOACH-TOI-DA-HOA-ZALO-OA-*.md).
//
//  broadcastTag() trong zalo.js đã lo: dedup 1 tin/ngày/người, trần 4 tin/tháng/người,
//  chốt giờ vàng 8–21h. File này chỉ CUNG CẤP NỘI DUNG + LỊCH; cron trong index.js gọi.
//
//  NGUYÊN TẮC (giữ report < 0,1% — điều kiện sống còn để nâng quota, xem plan):
//   - Gửi ĐÚNG người theo tag bệnh, KHÔNG gửi đại trà.
//   - Tuần 1 giáo dục (giá trị, không bán) → tạo thiện cảm trước khi mời.
//   - Xoay 4 chủ đề/tháng: giáo dục · nhắc tái khám · ưu đãi CT1 · ưu đãi CT2.
//   - Giọng "đọc không ra AI" — như người quen dặn dò, không quảng cáo lộ liễu.
//   - RANH GIỚI y tế: KHÔNG cam kết khỏi 100%, KHÔNG bịa kết quả, KHÔNG dọa biến chứng sai.
//
//  Mỗi mục: { key (tag bệnh trong TAG_BENH), header (≤100 ký tự), text (≤2000) }.
//  17 tag bệnh khớp bảng TAG_BENH trong zalo.js.

// --- Nội dung theo TỪNG TUẦN (tuanTrongThang: 1..4) ---
// Đặt {ten_benh} nếu muốn chèn — hiện để mỗi tag tự soạn câu tự nhiên (không macro hoá).

// Nhóm 17 tag bệnh → nhãn thân thiện trong câu văn (khớp TAG_BENH ở zalo.js).
const BENH = {
  goi: 'khớp gối', vai: 'khớp vai', gut: 'gút', lung: 'đau lưng',
  tvdd: 'thoát vị đĩa đệm', covaigay: 'cổ vai gáy', ngontay: 'ngón tay lò xo',
  chopxoay: 'chóp xoay vai', cochan: 'cổ chân', hang: 'khớp háng',
  chomdui: 'chỏm xương đùi', csc: 'cột sống cổ', loangxuong: 'loãng xương',
  dequervain: 'viêm gân De Quervain', ongcotay: 'hội chứng ống cổ tay',
  tenniselbow: 'khuỷu tay tennis', gangotchan: 'gai gót chân',
};

// TUẦN 1 — GIÁO DỤC (giá trị ngay, không bán). 1 mẹo tự chăm tại nhà theo bệnh.
function tuan1(key) {
  const b = BENH[key] || 'xương khớp';
  return {
    header: `Mẹo chăm ${b} tại nhà 🌿`,
    text:
      `Dạ mình ơi, Phòng khám Hiệp Lợi gửi mình một mẹo nhỏ chăm ${b} tại nhà nha ạ 🌿\n\n` +
      `Mỗi ngày mình dành vài phút vận động nhẹ nhàng, tránh giữ một tư thế quá lâu, và chườm ấm khi thấy mỏi. ` +
      `Đừng cố chịu đau âm ỉ kéo dài — để lâu thường khó chịu hơn ạ.\n\n` +
      `Có gì thắc mắc về ${b}, mình cứ nhắn lại đây, em nhờ Bác sĩ tư vấn giúp mình nha 🙏`,
  };
}

// TUẦN 2 — NHẮC TÁI KHÁM ĐỊNH KỲ (thẩm quyền + chăm sóc thật).
function tuan2(key) {
  const b = BENH[key] || 'xương khớp';
  return {
    header: `Đừng để ${b} âm thầm nặng thêm 🩺`,
    text:
      `Dạ mình ơi, xương khớp có điểm này: đỡ đau chưa chắc đã khỏi hẳn ạ. ` +
      `Nhiều cô chú thấy bớt là ngưng theo dõi, một thời gian sau ${b} quay lại và thường nặng hơn lúc đầu 😔\n\n` +
      `Bác sĩ khuyên mình nên tái khám định kỳ để canh đúng lúc điều chỉnh, giữ kết quả lâu dài. ` +
      `Mình muốn em giữ một suất kiểm tra thì nhắn lại đây nha ạ 🙏`,
  };
}

// TUẦN 3 — ƯU ĐÃI CT1 (siêu âm vi điểm + đo cơ mỡ 800k → 150k, khách cũ/giới thiệu).
function tuan3(key) {
  const b = BENH[key] || 'xương khớp';
  return {
    header: `Ưu đãi kiểm tra ${b} chuyên sâu 150k 🎁`,
    text:
      `Dạ mình ơi, Phòng khám Hiệp Lợi đang có ưu đãi riêng cho khách cũ ạ 🎁\n\n` +
      `Gói siêu âm vi điểm + đo cơ mỡ (kiểm tra chuyên sâu tình trạng ${b}) từ 800k nay còn 150k. ` +
      `Đây là bước giúp Bác sĩ nhìn rõ tình trạng bên trong để tư vấn đúng hướng cho mình.\n\n` +
      `Suất ưu đãi có hạn, mình muốn giữ một suất thì nhắn lại đây nha ạ 🙏`,
  };
}

// TUẦN 4 — ƯU ĐÃI CT2 (gói 1.3tr → 300k).
function tuan4(key) {
  const b = BENH[key] || 'xương khớp';
  return {
    header: `Gói chăm ${b} 300k — tuần này 🌸`,
    text:
      `Dạ mình ơi, tuần này Phòng khám Hiệp Lợi còn ít suất gói chăm sóc ${b} ưu đãi từ 1.3tr còn 300k ạ 🌸\n\n` +
      `Gói được Bác sĩ xây theo đúng tình trạng từng người, mình theo đều sẽ dễ chịu hơn hẳn khi đi lại, sinh hoạt.\n\n` +
      `Mình quan tâm thì nhắn lại đây, em sắp lịch và giữ ưu đãi cho mình nha 🙏`,
  };
}

const TUAN_BUILDER = { 1: tuan1, 2: tuan2, 3: tuan3, 4: tuan4 };

// Tuần trong tháng theo NGÀY (1–7 → tuần 1, 8–14 → tuần 2, ...). Giờ VN.
export function tuanTrongThang(nowMs = Date.now()) {
  const d = new Date(nowMs + 7 * 3600 * 1000);
  return Math.min(4, Math.floor((d.getUTCDate() - 1) / 7) + 1);
}

// Danh sách tag bệnh sẽ broadcast (mặc định cả 17; giới hạn qua env nếu muốn thử nhỏ).
const ALL_TAGS = Object.keys(BENH);
function activeTags() {
  const only = (process.env.BROADCAST_TAGS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return only.length ? only.filter((t) => ALL_TAGS.includes(t)) : ALL_TAGS;
}

/**
 * Sinh danh sách công việc broadcast cho TUẦN hiện tại: mỗi tag bệnh 1 nội dung.
 * @returns {Array<{tagKey, header, text}>}
 */
export function broadcastJobsForNow(nowMs = Date.now()) {
  const tuan = tuanTrongThang(nowMs);
  const build = TUAN_BUILDER[tuan] || tuan1;
  return activeTags().map((key) => {
    const { header, text } = build(key);
    return { tagKey: key, header, text };
  });
}

export { BENH, ALL_TAGS };
