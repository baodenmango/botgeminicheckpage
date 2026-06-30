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

// --- Link CẨM NANG PDF theo bệnh — NGUỒN CHUẨN ở src/resources.js (BROCHURE_PDF) ---
// Giữ tên export CAM_NANG_PDF để không gãy import cũ; trỏ về kho tài liệu trung tâm.
import { BROCHURE_PDF, BROCHURE_NAME, CLIP_BY_CONDITION } from './resources.js';
export const CAM_NANG_PDF = BROCHURE_PDF;

// --- Link QUAN TÂM Zalo OA Phòng khám (khách bấm để follow OA) ---
// Chạm 4 mời khách quan tâm OA: theo dõi tin Bác sĩ + nhận trọn bộ tài liệu qua Zalo.
// Khi khách đã follow OA (có Zalo user_id), engine gửi thẳng file PDF qua MCP zalo (zalo_send_file).
// Token/OA của OA "Phòng khám Cơ xương khớp Hiệp Lợi" cấu hình ở .mcp.json (zalo-hieploi).
export const ZALO_OA_LINK = 'https://zalo.me/3136814239074246132';

// Câu MỜI QUAN TÂM Zalo OA — đứng riêng 1 ô để FB bung preview nút "Quan tâm" đẹp.
// NGUYÊN TẮC (anh Trình chốt 30/06): KHÔNG ra lệnh "bấm Quan tâm", mà cho LÝ DO/PHẦN THƯỞNG.
// Tệp 45-65 chỉ bấm khi thấy mình NHẬN được gì cụ thể (video bài tập, Bác sĩ dặn dò qua Zalo).
// daCoSo=true  → đã có số, telesale sẽ gọi: OA là nơi nhận tài liệu + nhắc lịch cho khỏi quên.
// daCoSo=false → chưa có số: OA là cách nhẹ nhàng để khách giữ kết nối mà chưa cần cho số ngay.
// daCoPDF: nếu ô trước ĐÃ tặng PDF rồi thì câu mời OA KHÔNG nhắc lại "nhận cẩm nang" (trùng phần
//   thưởng → loãng mồi). Thay bằng phần thưởng OA-only: VIDEO bài tập + Bác sĩ dặn dò riêng qua Zalo.
function loiMoiZaloOA(tenCN, daCoSo, daCoPDF) {
  let moi;
  if (daCoPDF) {
    // Đã có PDF → mồi OA là thứ Drive KHÔNG có: video minh hoạ + chăm sóc 1-1.
    moi = daCoSo
      ? `Mình quan tâm thêm Zalo phòng khám nha ạ 🌿 Bên Zalo em gửi mình video bài tập minh hoạ cho dễ làm theo, nhắc lịch hẹn với Bác sĩ khỏi quên, có thắc mắc gì nhắn em trả lời liền cho mình ạ`
      : `Mình quan tâm thêm Zalo phòng khám nha ạ 🌿 Bên Zalo em gửi mình video bài tập minh hoạ cho dễ làm theo, lại được Bác sĩ Trình dặn dò chăm sóc thường xuyên, cần gì cứ nhắn em hỗ trợ liền ạ`;
  } else {
    // Chưa có PDF (bệnh chưa có cẩm nang) → OA chính là nơi nhận trọn bộ tài liệu.
    moi = daCoSo
      ? `Mình quan tâm Zalo phòng khám để em gửi trọn bộ "${tenCN}" + video bài tập theo dõi tại nhà nha ạ 🌿 Bên Zalo em cũng nhắc lịch hẹn với Bác sĩ cho mình khỏi quên, có gì thắc mắc nhắn em trả lời liền ạ`
      : `Mình quan tâm Zalo phòng khám để nhận trọn bộ "${tenCN}" + video bài tập tại nhà nha ạ 🌿 Bên Zalo mình được Bác sĩ Trình dặn dò chăm sóc thường xuyên, cần gì cứ nhắn em hỗ trợ liền cho mình ạ`;
  }
  // Link đứng CUỐI ô để FB bung thẻ preview "Quan tâm OA".
  return `${moi}\n👉 ${ZALO_OA_LINK}`;
}

// Tên cẩm nang — NGUỒN CHUẨN ở resources.js (BROCHURE_NAME). Giữ export cũ cho follow.js.
export const TEN_CAM_NANG_PUBLIC = BROCHURE_NAME;
const TEN_CAM_NANG = BROCHURE_NAME;

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

// ===================== CHẠM 3 — BẰNG CHỨNG / NIỀM TIN CHUYÊN GIA (T+2h) =====================
// Anh CHỐT 29/06: KHÔNG gửi playlist (lùa cả mớ). Gửi ĐÚNG 3 CLIP tâm đắc nhất, đúng loại bệnh
// khách đang quan tâm. Nhân viên sẽ gom clip theo bệnh gửi sau → điền link vào CLIP_THEO_BENH.
//
// CLIP_THEO_BENH[<bệnh>] = [link1..3] — NGUỒN CHUẨN ở resources.js (CLIP_BY_CONDITION).
// Khi trống (vd covaigay / bệnh mới): bot KHÔNG gửi link rỗng, chỉ nhắn 1 câu nuôi dưỡng an toàn.
// Thêm/đổi clip → sửa ở resources.js là cả hệ (chạm 3 + follow OA) dùng đúng ngay.
export const CLIP_THEO_BENH = CLIP_BY_CONDITION;
// Clip DỰ TRỮ (vượt giới hạn 3/bệnh) — đổi vào resources.js nếu muốn:
//   vai #2: https://www.facebook.com/share/r/1D3PF7veue/ · vai bả vai: .../1EdTRfVFGy/
//   gut #4: https://www.facebook.com/share/r/19JKjNL4dE/ · tvdd #4: .../14jA49nJXyv/

// (giữ tương thích) clip review BN THẬT đã khỏi — nếu có thì cũng đưa vào CLIP_BY_CONDITION luôn.
export const REVIEW_THEO_BENH = CLIP_THEO_BENH;

function noiDungCham3(condition, daCoSo) {
  const key = tenBenhKey(condition);
  const clips = (CLIP_THEO_BENH[key] || []).filter(Boolean).slice(0, 3); // tối đa 3 clip đúng bệnh
  const msgs = [];

  // Lời mở: giới thiệu video Bác sĩ Trình phân tích đúng tình trạng của khách (niềm tin chuyên gia).
  msgs.push(daCoSo
    ? 'Dạ trong lúc chờ Bác sĩ gọi, em gửi mình xem mấy video Bác sĩ Trình phân tích kỹ đúng tình trạng của mình, để mình hiểu rõ hơn nha ạ 🥰'
    : 'Dạ em gửi mình xem mấy video Bác sĩ Trình phân tích kỹ về đúng tình trạng của mình nha ạ, mình xem cho yên tâm hơn 🥰');

  if (clips.length === 0) {
    // Chưa có clip cho bệnh này → KHÔNG gửi link rỗng. Chỉ nuôi dưỡng nhẹ + nhắc giá trị khám.
    msgs.push(daCoSo
      ? 'Mình cứ yên tâm nha, Bác sĩ sẽ xem kỹ tình trạng và tư vấn hướng phù hợp cho mình ạ 🙏'
      : 'Tình trạng của mình nên được Bác sĩ xem kỹ phim chụp để tư vấn đúng hướng ạ, mình để lại số để Bác sĩ gọi tư vấn miễn phí nha 🙏');
    return msgs;
  }

  // Gửi từng clip thành 1 ô riêng (link đứng riêng để FB bung preview đẹp) — tối đa 3.
  clips.forEach((link, i) => {
    msgs.push(i === 0 ? `Mình xem nha ạ: ${link}` : link);
  });
  return msgs.slice(0, 4); // 1 lời mở + tối đa 3 clip
}

// ===================== CHẠM 4 — CHO GIÁ TRỊ / BÀI TẬP (T+6h) =====================
function noiDungCham4(condition, daCoSo) {
  const key = tenBenhKey(condition);
  const tenCN = TEN_CAM_NANG[key] || 'Cẩm nang chăm sóc tại nhà';
  const meo = MEO_THEO_BENH[key];
  const msgs = [];

  // Mở đầu ấm áp + cho mẹo NGAY (giá trị thật, không bắt bấm link mới có).
  if (meo) {
    msgs.push(`Dạ em gửi mình vài mẹo nhỏ tự làm tại nhà cho đỡ hơn nha ạ 🌿\n${meo}`);
  } else {
    msgs.push('Dạ em gửi mình vài lời dặn nhỏ để chăm sóc tại nhà cho đỡ hơn nha ạ 🌿 Mình nhớ vận động nhẹ nhàng đều đặn, tránh giữ một tư thế quá lâu ạ.');
  }
  // ĐÒN BẨY (anh Trình chốt 30/06): KHÔNG dán link Drive cho không nữa.
  // Cẩm nang PDF + video là LÝ DO để khách Quan tâm OA — file chỉ nhận được SAU KHI follow.
  // Khách bấm follow → webhook follow OA → engine TỰ gửi PDF + video qua Zalo (giai đoạn webhook).
  // Vì vậy luôn gọi loiMoiZaloOA với daCoPDF=false (OA chính là nơi nhận trọn bộ tài liệu).
  msgs.push(loiMoiZaloOA(tenCN, daCoSo, false));
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
