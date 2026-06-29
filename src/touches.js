// ENGINE 7 CHẠM — định nghĩa các CHẠM BOT (3, 4, 6) mà bot Gemini TỰ GỬI cho khách.
// Chạm 2, 5, 7 do telesale GỌI (engine nhac-7cham bắn nhắc Telegram, KHÔNG ở file này).
// Mốc T+ giờ khớp với nhac-7cham/config.js: chạm3=2h, chạm4=6h, chạm6=30h.
//
// Mỗi chạm có 2 biến thể nội dung tùy lead đã cho SĐT hay chưa:
//   - chưa số  → kèm khơi lại + (chạm 6) mời để lại số. Mục tiêu vẫn là LẤY SỐ.
//   - đã số    → chỉ nuôi dưỡng/đẩy đặt lịch, TUYỆT ĐỐI không xin số.
//
// THIẾT KẾ MỞ: nội dung tách theo `condition` (6 bệnh) để sau dễ thêm bệnh / thêm kênh
// (Pancake → Zalo OA → Viber). Chạm 3 review hiện để PLACEHOLDER, nạp clip thật sau.

// --- Link CẨM NANG PDF theo bệnh (Drive folder Tài nguyên Telesale, đã công khai) ---
// Dùng cho Chạm 4 "cho giá trị". File id lấy từ folder 18vagh28_veQrFfoNKVAMy8uwVF-iKfrz.
export const CAM_NANG_PDF = {
  goi:      'https://drive.google.com/file/d/1MLGPKRIAvQZNVwNcUzBkoNAtlS17gQVQ/view',
  vai:      'https://drive.google.com/file/d/12O-O62GLHWgh_3yG8U-aBt2vMWYNfdxC/view',
  gut:      'https://drive.google.com/file/d/1gPV2a5vOqfhdiUB-d18htQRtX7kK1eSr/view',
  lung:     'https://drive.google.com/file/d/1xDDc8QbgEoifGHvfNiYhH6axlwTha5Ho/view',
  tvdd:     'https://drive.google.com/file/d/1b-huOqDvWVbOpL2hjDNKXfaSnNeyaoEH/view',
  covaigay: 'https://drive.google.com/file/d/1o98wx_wW63ZVHTiWlkByh100Wb2hHwpp/view',
};

// Tên cẩm nang (để câu mời tự nhiên).
const TEN_CAM_NANG = {
  goi:      'Cẩm nang chăm sóc khớp gối tại nhà',
  vai:      'Cẩm nang chăm sóc khớp vai tại nhà',
  gut:      'Cẩm nang ăn uống & kiểm soát bệnh gút',
  lung:     'Cẩm nang 7 ngày giảm đau lưng tại nhà',
  tvdd:     'Cẩm nang sống khỏe với thoát vị đĩa đệm',
  covaigay: 'Cẩm nang thư giãn cổ – vai – gáy',
};

// 2–3 MẸO/BÀI TẬP trích từ chính cẩm nang (để tin có giá trị thật, không rỗng).
// Khách đọc thấy hữu ích NGAY cả khi chưa bấm link → tăng thiện cảm.
const MEO_THEO_BENH = {
  goi: 'Cô/chú thử mỗi ngày: (1) gồng cơ đùi giữ 5 giây, làm 10–15 lần; (2) nằm ngửa nâng chân thẳng cao ~20cm giữ 3–5 giây; (3) bớt ngồi xổm và leo cầu thang nhiều. Cơ đùi khỏe thì gối đỡ đau hẳn ạ.',
  vai: 'Mình thử: (1) đung đưa tay nhẹ như con lắc 30–60 giây cho vai bớt cứng; (2) “bò” ngón tay lên tường 8–10 lần; (3) ĐỪNG treo tay bất động — vai càng ít cử động càng dễ đông cứng đó ạ.',
  gut: 'Mấy điều giúp cô/chú đỡ lên cơn: (1) uống đủ nước cả ngày để thải acid uric; (2) hạn chế bia rượu, nội tạng, hải sản; (3) hết đau cũng ĐỪNG tự ngưng thuốc/ngưng kiêng — acid uric vẫn âm thầm cao ạ.',
  lung: 'Cô/chú thử: (1) nằm ngửa ôm gối về ngực giữ 15–20 giây cho lưng giãn; (2) động tác cây cầu nâng hông 10 lần; (3) khi nhấc đồ thì gập gối ngồi xuống, KHÔNG cúi gập lưng. Vận động nhẹ tốt hơn nằm im cả ngày ạ.',
  tvdd: 'Việc nên làm: (1) đi lại nhẹ nhàng vừa sức mỗi ngày, đừng nằm liệt giường; (2) ngủ nằm nghiêng kê gối giữa hai gối; (3) nhấc đồ thì gập gối, giữ đồ sát người, KHÔNG vừa nhấc vừa xoay người ạ.',
  covaigay: 'Mình thử: (1) thu cằm nhẹ (tạo “cằm đôi”) giữ 3–5 giây, 8–10 lần; (2) nghiêng đầu đưa tai về phía vai giữ 15–20 giây mỗi bên; (3) ĐỪNG cúi xem điện thoại lâu — nâng máy ngang tầm mắt, 30 phút nghỉ một lần ạ.',
};

// Nhóm bệnh chưa rõ → dùng nội dung trung tính (không trích bệnh cụ thể).
const FALLBACK_BENH = 'khac';

function tenBenhKey(condition) {
  return (condition && CAM_NANG_PDF[condition]) ? condition : FALLBACK_BENH;
}

// ===================== CHẠM 3 — BẰNG CHỨNG / REVIEW (T+2h) =====================
// PLACEHOLDER: chờ nhân viên bổ sung clip bệnh nhân tương tự đã khỏi (anh dặn 29/06).
// Khi có clip thật → điền vào REVIEW_THEO_BENH (link clip/album), bot sẽ gửi link đó.
// Hiện chưa có clip → gửi review dạng CHỮ (an toàn, không bịa link), vẫn tạo niềm tin.
export const REVIEW_THEO_BENH = {
  // goi: 'https://...link album/clip review khớp gối...',
  // vai: '...', gut: '...', lung: '...', tvdd: '...', covaigay: '...',
};

function noiDungCham3(condition, daCoSo) {
  const key = tenBenhKey(condition);
  const link = REVIEW_THEO_BENH[key]; // chỉ gửi khi nhân viên đã nạp clip thật
  const msgs = [];
  if (daCoSo) {
    msgs.push('Dạ trong lúc chờ Bác sĩ gọi, em gửi mình xem qua vài trường hợp cô chú lớn tuổi bị giống mình, sau khi khám và chăm đúng cách đã đi lại thoải mái hơn nhiều ạ 🥰');
  } else {
    msgs.push('Dạ em gửi mình tham khảo vài trường hợp cô chú bị tình trạng giống mình, sau khi được khám và xử lý đúng đã cải thiện rõ ạ, để mình yên tâm hơn 🥰');
  }
  if (link) {
    msgs.push(`Mình xem ở đây nha ạ: ${link}`);
  }
  return msgs;
}

// ===================== CHẠM 4 — CHO GIÁ TRỊ / BÀI TẬP (T+6h) =====================
function noiDungCham4(condition, daCoSo) {
  const key = tenBenhKey(condition);
  const pdf = CAM_NANG_PDF[key];
  const tenCN = TEN_CAM_NANG[key] || 'Cẩm nang chăm sóc tại nhà';
  const meo = MEO_THEO_BENH[key];
  const msgs = [];

  // Mở đầu ấm áp + cho mẹo NGAY (giá trị thật, không bắt bấm link mới có).
  if (meo) {
    msgs.push(`Dạ em gửi mình vài mẹo nhỏ tự làm tại nhà cho đỡ hơn nha ạ 🌿\n${meo}`);
  } else {
    msgs.push('Dạ em gửi mình vài lời dặn nhỏ để chăm sóc tại nhà cho đỡ hơn nha ạ 🌿 Mình nhớ vận động nhẹ nhàng đều đặn, tránh giữ một tư thế quá lâu ạ.');
  }
  // Tặng cẩm nang PDF đầy đủ (nếu có theo bệnh).
  if (pdf) {
    msgs.push(`Em tặng mình trọn bộ "${tenCN}" của phòng khám nha, mình lưu lại tập dần ạ: ${pdf}`);
  }
  // Đóng: đã có số → đẩy đặt lịch; chưa có số → mời để lại số nhẹ.
  if (daCoSo) {
    msgs.push('Mình tập thử mấy hôm nhé, mà để chắc ăn thì Bác sĩ khám trực tiếp xem đúng nguyên nhân vẫn tốt nhất ạ. Mình sắp xếp qua khám hôm nào tiện, em giữ suất cho mình nha 🙏');
  } else {
    msgs.push('Mình cứ tập thử nha ạ. Nếu muốn Bác sĩ xem kỹ phim chụp và tư vấn hướng xử lý phù hợp (miễn phí), mình để lại số điện thoại giúp em, Bác sĩ gọi cho mình ạ 🙏');
  }
  return msgs;
}

// ===================== CHẠM 6 — BÁM ĐUỔI NHẸ (T+30h) =====================
// Anh chốt 29/06: thay "retarget ad" bằng bot nhắn inbox bám đuổi nhẹ.
function noiDungCham6(condition, daCoSo) {
  if (daCoSo) {
    return [
      'Dạ em hỏi thăm mình chút xíu ạ 🌸 Mấy mẹo hôm trước mình áp dụng có thấy đỡ hơn không ạ?',
      'Bác sĩ vẫn đang giữ suất tư vấn cho mình nha. Mình sắp xếp được hôm nào qua khám thì nhắn em, em book giúp cho khỏi phải chờ lâu ạ 🙏',
    ];
  }
  return [
    'Dạ em nhắn hỏi thăm mình chút xíu ạ 🌸 Tình trạng của mình mấy hôm nay có đỡ hơn không ạ?',
    'Bên em vẫn đang giữ suất tư vấn miễn phí với Bác sĩ Trình cho mình. Nếu cần, mình để lại số điện thoại (hoặc Zalo) giúp em để Bác sĩ gọi xem kỹ giúp mình nha ạ 🙏',
  ];
}

// --- Bảng định nghĩa 3 chạm bot. `hours` khớp nhac-7cham/config.js. ---
export const BOT_TOUCHES = [
  { no: 3, hours: 2,  build: noiDungCham3, muctieu: 'Gửi bằng chứng / review đúng bệnh' },
  { no: 4, hours: 6,  build: noiDungCham4, muctieu: 'Cho giá trị: cẩm nang + bài tập/mẹo tại nhà' },
  { no: 6, hours: 30, build: noiDungCham6, muctieu: 'Bám đuổi nhẹ (inbox)' },
];

/**
 * Sinh nội dung 1 chạm bot cho 1 hội thoại.
 * @param {number} touchNo  3 | 4 | 6
 * @param {string} condition  mã bệnh (goi/vai/...)
 * @param {boolean} daCoSo  hội thoại đã có SĐT chưa
 * @returns {string[]|null} mảng ô tin, hoặc null nếu chạm không hợp lệ / chạm 3 chưa có review
 */
export function buildTouchMessages(touchNo, condition, daCoSo) {
  const t = BOT_TOUCHES.find((x) => x.no === Number(touchNo));
  if (!t) return null;
  const msgs = t.build(condition, daCoSo);
  return Array.isArray(msgs) && msgs.length ? msgs.slice(0, 4) : null;
}
