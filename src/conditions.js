// Map mã bệnh → tên tiếng Việt — DÙNG CHUNG (telegram báo, engine chạm bill/tái bill, follow).
// 6 bệnh CỐT LÕI (có sale page riêng) + nhóm bệnh MỞ RỘNG (anh Trình bổ sung 30/06).
export const CONDITION_VI = {
  // --- cốt lõi (có sale page riêng) ---
  goi: 'Khớp gối / thoái hóa gối',
  vai: 'Khớp vai / đau vai',
  gut: 'Gút / acid uric',
  lung: 'Đau lưng / cột sống thắt lưng',
  tvdd: 'Thoát vị đĩa đệm',
  covaigay: 'Đau cổ vai gáy',
  // --- mở rộng (chưa có sale page riêng → tạm dùng trang gần nhất, xem SALE_PAGE) ---
  ngontay: 'Ngón tay lò xo (viêm bao gân gấp)',
  chopxoay: 'Rách chóp xoay vai',
  cochan: 'Lật sơ mi cổ chân (bong gân cổ chân)',
  hang: 'Thoái hóa khớp háng',
  chomdui: 'Hoại tử chỏm xương đùi',
  csc: 'Thoái hóa cột sống cổ',
  loangxuong: 'Loãng xương',
  dequervain: 'Viêm gân De Quervain (đau cổ tay ngón cái)',
  ongcotay: 'Hội chứng ống cổ tay (tê tay)',
  tenniselbow: 'Viêm điểm bám gân khuỷu (khuỷu tay tennis)',
  gangotchan: 'Viêm cân gan chân / gai gót chân',
  // --- chung ---
  khac: 'Bệnh khác',
  unknown: 'Chưa rõ',
};

// Map mã bệnh → SALE PAGE — CHỈ chứa bệnh CÓ TRANG RIÊNG (hoặc trang liên quan rất sát).
// Anh Trình chốt 30/06: BỆNH LẠ (chưa có sale page) thì KHÔNG gửi link — mục tiêu khác giữ nguyên.
// → Bệnh KHÔNG có trong map này = không gửi sale page (hasSalePage trả false). Tạo trang mới
//   cho bệnh nào thì THÊM dòng vào đây là cả hệ gửi đúng ngay.
export const SALE_PAGE = {
  goi: 'https://thoaihoakhop.phongkhamhieploi.vn/',
  vai: 'https://dauvai.phongkhamhieploi.vn/',
  gut: 'https://benhgut.phongkhamhieploi.vn/',
  lung: 'https://daulung.phongkhamhieploi.vn/',
  tvdd: 'https://tvdd.phongkhamhieploi.vn/',
  covaigay: 'https://covaigay.phongkhamhieploi.vn/',
  // mở rộng có trang LIÊN QUAN rất sát (gửi tạm tới khi có trang riêng) —
  chopxoay: 'https://dauvai.phongkhamhieploi.vn/',   // rách chóp xoay = bệnh lý khớp vai
  csc:      'https://covaigay.phongkhamhieploi.vn/', // thoái hóa cột sống cổ ~ cổ vai gáy
  // ngontay / cochan / hang / chomdui / loangxuong / dequervain / ongcotay / khac / unknown
  //   → CHƯA có trang phù hợp → KHÔNG gửi sale page (bệnh lạ).
};

// Bệnh này có sale page để gửi không? (false = bệnh lạ → bot KHÔNG gửi link)
export function hasSalePage(condition) {
  return Boolean(SALE_PAGE[condition]);
}
