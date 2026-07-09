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

// --- ĐA DẠNG HOÁ BIẾN THỂ (audit 09/07/2026) ---
// Căn cứ: nhiều câu template gửi NGUYÊN VĂN 100+ lần giữa các khách khác nhau → lộ máy.
// Giải: mỗi câu hay lặp có 5-6 biến thể CÙNG Ý (giữ đòn bẩy + tuân thủ y tế: KHÔNG bịa số suất,
// KHÔNG cam kết khỏi 100%, giữ "miễn phí" + tên "Bác sĩ Trình"), rồi CHỌN NGẪU NHIÊN 1 biến thể.
// Các hàm noiDungChamN KHÔNG nhận conversationId nên dùng Math.random (bot chạy runtime → chấp nhận).
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Câu MỜI QUAN TÂM Zalo OA — đứng riêng 1 ô để FB bung preview nút "Quan tâm" đẹp.
// NGUYÊN TẮC (anh Trình chốt 30/06): KHÔNG ra lệnh "bấm Quan tâm", mà cho LÝ DO/PHẦN THƯỞNG.
// Tệp 45-65 chỉ bấm khi thấy mình NHẬN được gì cụ thể (video bài tập, Bác sĩ dặn dò qua Zalo).
// daCoSo=true  → đã có số, telesale sẽ gọi: OA là nơi nhận tài liệu + nhắc lịch cho khỏi quên.
// daCoSo=false → chưa có số: OA là cách nhẹ nhàng để khách giữ kết nối mà chưa cần cho số ngay.
// daCoPDF: nếu ô trước ĐÃ tặng PDF rồi thì câu mời OA KHÔNG nhắc lại "nhận cẩm nang" (trùng phần
//   thưởng → loãng mồi). Thay bằng phần thưởng OA-only: VIDEO bài tập + Bác sĩ dặn dò riêng qua Zalo.
// 4-5 cách MỜI OA cho mỗi nhánh (daCoPDF × daCoSo) — xoay câu chữ, giữ nguyên phần thưởng/đòn bẩy.
// ${tenCN} = tên cẩm nang theo bệnh; chỉ dùng ở nhánh CHƯA có PDF (OA là nơi nhận trọn bộ tài liệu).
const MOI_OA_COPDF_COSO = [
  `Mình quan tâm thêm Zalo phòng khám nha ạ 🌿 Bên Zalo em gửi mình video bài tập minh hoạ cho dễ làm theo, nhắc lịch hẹn với Bác sĩ khỏi quên, có thắc mắc gì nhắn em trả lời liền cho mình ạ`,
  `Mình quan tâm Zalo phòng khám giúp em nha 🌿 Trên đó em có video bài tập minh hoạ cho dễ tập, còn nhắc lịch với Bác sĩ cho mình khỏi quên, cần gì nhắn em hỗ trợ liền ạ`,
  `Mình kết nối thêm Zalo bên em nha ạ 🌿 Em gửi mình clip bài tập minh hoạ xem cho dễ làm theo, tới lịch hẹn Bác sĩ em cũng nhắc giúp, có gì thắc mắc mình cứ nhắn em ạ`,
  `Mình bấm quan tâm Zalo phòng khám cho tiện nha 🌿 Bên đó em có sẵn video bài tập minh hoạ dễ theo, lại nhắc lịch hẹn với Bác sĩ khỏi quên, cần gì nhắn em liền cho mình ạ`,
  `Mình theo dõi Zalo bên em luôn nha ạ 🌿 Em gửi video bài tập minh hoạ cho dễ tập tại nhà, nhắc mình lịch hẹn với Bác sĩ, thắc mắc gì nhắn em trả lời liền cho mình ạ`,
];
const MOI_OA_COPDF_CHUASO = [
  `Mình quan tâm thêm Zalo phòng khám nha ạ 🌿 Bên Zalo em gửi mình video bài tập minh hoạ cho dễ làm theo, lại được Bác sĩ Trình dặn dò chăm sóc thường xuyên, cần gì cứ nhắn em hỗ trợ liền ạ`,
  `Mình kết nối thêm Zalo bên em nha 🌿 Trên đó em có video bài tập minh hoạ dễ theo, mình còn được Bác sĩ Trình dặn dò chăm sóc thường xuyên, cần gì nhắn em hỗ trợ liền ạ`,
  `Mình bấm quan tâm Zalo phòng khám giúp em nha ạ 🌿 Em gửi clip bài tập minh hoạ xem cho dễ làm, được Bác sĩ Trình theo sát dặn dò, có gì mình cứ nhắn em hỗ trợ ạ`,
  `Mình theo dõi Zalo bên em cho tiện nha 🌿 Bên đó có sẵn video bài tập minh hoạ dễ tập, lại được Bác sĩ Trình dặn dò chăm sóc đều, cần gì nhắn em liền cho mình ạ`,
  `Mình quan tâm Zalo phòng khám nha ạ 🌿 Em gửi mình video bài tập minh hoạ tập tại nhà, được Bác sĩ Trình chăm sóc dặn dò thường xuyên, có gì cứ nhắn em hỗ trợ ạ`,
];
const MOI_OA_CHUAPDF_COSO = [
  (tenCN) => `Mình quan tâm Zalo phòng khám để em gửi trọn bộ "${tenCN}" + video bài tập theo dõi tại nhà nha ạ 🌿 Bên Zalo em cũng nhắc lịch hẹn với Bác sĩ cho mình khỏi quên, có gì thắc mắc nhắn em trả lời liền ạ`,
  (tenCN) => `Mình kết nối Zalo bên em để em gửi trọn bộ "${tenCN}" + clip bài tập tại nhà nha 🌿 Tới lịch hẹn Bác sĩ em nhắc giúp mình khỏi quên, cần gì mình cứ nhắn em hỗ trợ ạ`,
  (tenCN) => `Mình bấm quan tâm Zalo phòng khám nha ạ 🌿 Em gửi trọn bộ "${tenCN}" + video bài tập theo dõi tại nhà, còn nhắc lịch với Bác sĩ cho mình khỏi quên, có gì nhắn em liền ạ`,
  (tenCN) => `Mình theo dõi Zalo bên em cho tiện nha ạ 🌿 Em gửi mình trọn bộ "${tenCN}" + clip bài tập tại nhà, tới lịch hẹn Bác sĩ em nhắc giúp, thắc mắc gì nhắn em trả lời liền ạ`,
  (tenCN) => `Mình quan tâm Zalo phòng khám giúp em nha 🌿 Em gửi trọn bộ "${tenCN}" + video bài tập theo dõi tại nhà cho mình, nhắc lịch với Bác sĩ khỏi quên, cần gì nhắn em hỗ trợ ạ`,
];
const MOI_OA_CHUAPDF_CHUASO = [
  (tenCN) => `Mình quan tâm Zalo phòng khám để nhận trọn bộ "${tenCN}" + video bài tập tại nhà nha ạ 🌿 Bên Zalo mình được Bác sĩ Trình dặn dò chăm sóc thường xuyên, cần gì cứ nhắn em hỗ trợ liền cho mình ạ`,
  (tenCN) => `Mình kết nối Zalo bên em để nhận trọn bộ "${tenCN}" + clip bài tập tại nhà nha 🌿 Trên đó mình được Bác sĩ Trình dặn dò chăm sóc đều, có gì mình cứ nhắn em hỗ trợ ạ`,
  (tenCN) => `Mình bấm quan tâm Zalo phòng khám để nhận trọn bộ "${tenCN}" + video bài tập tại nhà nha ạ 🌿 Bên đó có Bác sĩ Trình theo sát dặn dò, cần gì nhắn em hỗ trợ liền cho mình ạ`,
  (tenCN) => `Mình theo dõi Zalo bên em để nhận trọn bộ "${tenCN}" + clip bài tập tại nhà nha 🌿 Mình được Bác sĩ Trình dặn dò chăm sóc thường xuyên, có gì cứ nhắn em hỗ trợ ạ`,
  (tenCN) => `Mình quan tâm Zalo phòng khám nha ạ, em gửi trọn bộ "${tenCN}" + video bài tập tại nhà cho mình 🌿 Bên Zalo được Bác sĩ Trình dặn dò chăm sóc đều, cần gì nhắn em hỗ trợ liền ạ`,
];

export function loiMoiZaloOA(tenCN, daCoSo, daCoPDF) {
  let moi;
  if (daCoPDF) {
    // Đã có PDF → mồi OA là thứ Drive KHÔNG có: video minh hoạ + chăm sóc 1-1.
    moi = daCoSo ? pick(MOI_OA_COPDF_COSO) : pick(MOI_OA_COPDF_CHUASO);
  } else {
    // Chưa có PDF (bệnh chưa có cẩm nang) → OA chính là nơi nhận trọn bộ tài liệu.
    moi = daCoSo ? pick(MOI_OA_CHUAPDF_COSO)(tenCN) : pick(MOI_OA_CHUAPDF_CHUASO)(tenCN);
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

// NÉN 04/07 (anh chốt "hết cảnh dội bom"): mỗi chạm TỐI ĐA 2 ô, chỉ 1 clip đắt nhất.
function noiDungCham3(condition, daCoSo) {
  const key = tenBenhKey(condition);
  const clip = ((CLIP_THEO_BENH[key] || []).filter(Boolean))[0] || null;

  if (!clip) {
    // Chưa có clip cho bệnh này → 1 ô nuôi dưỡng nhẹ, không gửi link rỗng.
    return [daCoSo
      ? 'Dạ mình cứ yên tâm nha, Bác sĩ sẽ xem kỹ tình trạng và tư vấn hướng phù hợp cho mình ạ 🙏'
      : 'Dạ tình trạng của mình nên được Bác sĩ xem kỹ để tư vấn đúng hướng ạ, mình để lại số để Bác sĩ gọi tư vấn miễn phí nha 🙏'];
  }
  // 2 ô: lời mở + 1 clip (link đứng riêng để FB bung preview đẹp).
  return [
    daCoSo
      ? 'Dạ trong lúc chờ Bác sĩ gọi, em gửi mình video Bác sĩ Trình phân tích đúng tình trạng của mình nha ạ 🥰'
      : 'Dạ em gửi mình video Bác sĩ Trình phân tích đúng tình trạng của mình, mình xem cho yên tâm nha ạ 🥰',
    clip,
  ];
}

// ===================== CHẠM 4 — CHO GIÁ TRỊ / BÀI TẬP (T+6h) =====================
// NÉN 04/07: 2 ô — [mẹo + 1 câu dẫn ngắn] + [mời OA]. Bỏ ô đóng thứ 3 (dội bom).
function noiDungCham4(condition, daCoSo) {
  const key = tenBenhKey(condition);
  const tenCN = TEN_CAM_NANG[key] || 'Cẩm nang chăm sóc tại nhà';
  const meo = MEO_THEO_BENH[key];

  const than = meo
    ? `Dạ em gửi mình vài mẹo nhỏ tự làm tại nhà cho đỡ hơn nha ạ 🌿\n${meo}`
    : 'Dạ em gửi mình vài lời dặn nhỏ để chăm sóc tại nhà cho đỡ hơn nha ạ 🌿 Mình nhớ vận động nhẹ nhàng đều đặn, tránh giữ một tư thế quá lâu ạ.';
  const dan = daCoSo
    ? '\nMình sắp xếp qua khám hôm nào tiện, em giữ suất cho mình nha 🙏'
    : '\nMuốn Bác sĩ xem kỹ và tư vấn hướng phù hợp (miễn phí) thì mình để lại số giúp em nha 🙏';

  // ĐÒN BẨY (anh chốt 30/06): KHÔNG dán link Drive cho không — cẩm nang PDF + video là LÝ DO
  // Quan tâm OA, file giao SAU khi follow (webhook follow OA tự gửi). daCoPDF luôn = false.
  return [than + dan, loiMoiZaloOA(tenCN, daCoSo, false)];
}

// ===================== CHẠM 6 — BÁM ĐUỔI NHẸ (T+30h) =====================
// Anh chốt 29/06: thay "retarget ad" bằng bot nhắn inbox bám đuổi nhẹ.
// NÉN 04/07: 1 ô duy nhất.
// Biến thể chạm 6 — giữ "suất tư vấn (miễn phí) với Bác sĩ Trình" nhưng xoay câu chữ để không trùng.
const CHAM6_COSO = [
  'Dạ em hỏi thăm mình chút xíu ạ 🌸 Mấy mẹo hôm trước mình áp dụng có đỡ hơn không ạ? Bác sĩ vẫn giữ suất tư vấn cho mình — hôm nào tiện qua khám mình nhắn em book giúp cho khỏi chờ nha 🙏',
  'Dạ mấy hôm nay mình sao rồi ạ 🌸 Bài tập hôm trước có giúp mình dễ chịu hơn chút nào không? Suất tư vấn với Bác sĩ em vẫn để dành cho mình — khi nào tiện qua khám nhắn em xếp lịch cho khỏi chờ nha 🙏',
  'Dạ em ghé hỏi thăm mình xíu nha 🌸 Mấy mẹo bữa trước mình làm thấy đỡ hơn không ạ? Bác sĩ vẫn dành suất tư vấn cho mình đó — bữa nào rảnh qua khám mình nhắn em giữ chỗ trước cho ạ 🙏',
  'Dạ không biết mấy bữa nay mình thấy trong người sao rồi ạ 🌸 Hôm trước em có gửi mấy mẹo, mình áp dụng có nhẹ hơn không? Suất tư vấn với Bác sĩ em vẫn giữ — tiện hôm nào mình nhắn em book cho khỏi phải chờ nha 🙏',
  'Dạ em nhắn hỏi thăm mình chút ạ 🌸 Tình trạng mấy hôm nay đỡ hơn được phần nào chưa mình? Bác sĩ vẫn còn giữ suất tư vấn cho mình — khi nào qua khám tiện thì nhắn em, em xếp lịch trước cho khỏi chờ ạ 🙏',
];
const CHAM6_CHUASO = [
  'Dạ em hỏi thăm mình chút xíu ạ 🌸 Tình trạng mấy hôm nay có đỡ hơn không ạ? Suất tư vấn miễn phí với Bác sĩ Trình em vẫn giữ — mình để lại số giúp em để Bác sĩ gọi xem kỹ cho mình nha 🙏',
  'Dạ mấy bữa nay mình thấy sao rồi ạ 🌸 Chỗ đau có dịu hơn được chút nào chưa? Em vẫn để dành suất tư vấn miễn phí với Bác sĩ Trình cho mình — mình để lại số, Bác sĩ gọi xem kỹ giúp mình nha 🙏',
  'Dạ em ghé hỏi thăm mình xíu nha 🌸 Tình trạng mấy hôm nay đỡ hơn không ạ? Suất tư vấn miễn phí với Bác sĩ Trình vẫn còn cho mình đó — mình cho em xin số để Bác sĩ gọi xem giúp mình sớm nha 🙏',
  'Dạ không biết mấy hôm nay mình còn khó chịu nhiều không ạ 🌸 Em vẫn giữ suất tư vấn miễn phí với Bác sĩ Trình cho mình nè — mình để lại số giúp em, Bác sĩ gọi xem kỹ tình trạng cho mình nha 🙏',
  'Dạ em nhắn hỏi thăm mình chút ạ 🌸 Chỗ đau hôm nay có bớt hơn được phần nào chưa mình? Suất tư vấn miễn phí với Bác sĩ Trình em vẫn để dành — mình gửi em số điện thoại, Bác sĩ gọi xem giúp cho mình nha 🙏',
];
function noiDungCham6(condition, daCoSo) {
  return [daCoSo ? pick(CHAM6_COSO) : pick(CHAM6_CHUASO)];
}

// ===================== CHẠM 2/5/7 — LEO THANG CẤP BÁCH (khi CHƯA có số) =====================
// Vốn là 3 chạm TELESALE GỌI. Nay: có số → telesale gọi (báo Telegram, KHÔNG dùng builder này);
// CHƯA số → bot tự nhắn xin số, mức khan hiếm/cấp bách TĂNG DẦN qua 3 mốc (15p → 24h → 47h).
// Tuân thủ y tế: KHÔNG cam kết khỏi 100%, không bịa kết quả, không dọa. Chỉ khan hiếm suất + bằng chứng nhẹ.

// Biến thể chạm 2 (~15p, chưa số) — giữ đòn bẩy "suất giữ riêng" + xin số, KHÔNG bịa số suất cụ thể.
const CHAM2_CHUASO = [
  'Dạ em thấy mình quan tâm mà chưa kịp để lại số ạ 🌸 Bên em đang giữ riêng cho mình 1 suất tư vấn với Bác sĩ Trình hôm nay — mình để lại số điện thoại, Bác sĩ gọi tư vấn miễn phí cho mình nha 🙏',
  'Dạ nãy mình có quan tâm mà chưa kịp gửi số cho em ạ 🌸 Em vẫn đang giữ riêng cho mình một suất tư vấn với Bác sĩ Trình trong hôm nay — mình cho em xin số, Bác sĩ gọi tư vấn miễn phí cho mình nha 🙏',
  'Dạ hình như mình còn bỏ ngỏ chưa để lại số cho em ạ 🌸 Bên em đang ưu tiên giữ cho mình một suất tư vấn với Bác sĩ Trình — mình gửi em số điện thoại để Bác sĩ gọi tư vấn miễn phí cho mình nha 🙏',
  'Dạ em để ý mình quan tâm mà chưa kịp cho số ạ 🌸 Suất tư vấn với Bác sĩ Trình em đang giữ riêng cho mình hôm nay đó — mình để lại số giúp em, Bác sĩ gọi tư vấn miễn phí cho mình nha 🙏',
  'Dạ nãy giờ mình quan tâm mà em chưa có số để nhờ Bác sĩ gọi ạ 🌸 Bên em vẫn dành riêng cho mình một suất tư vấn với Bác sĩ Trình hôm nay — mình cho em xin số, Bác sĩ gọi tư vấn miễn phí nha 🙏',
];
// Chạm 2 (~15 phút, chưa số) — NÉN 04/07: 1 ô.
function noiDungCham2(condition, daCoSo) {
  return [pick(CHAM2_CHUASO)];
}
// Biến thể chạm 5 (~24h, chưa số) — bằng chứng xã hội nhẹ + xin số. KHÔNG cam kết khỏi 100%.
const CHAM5_CHUASO = [
  'Dạ mấy hôm nay tình trạng của mình sao rồi ạ, còn khó chịu nhiều không? 🌸 Nhiều cô chú giống tình trạng mình được Bác sĩ Trình xem kỹ rồi hướng dẫn đúng là cải thiện tốt lắm ạ — mình để lại số để Bác sĩ gọi xem giúp mình sớm nha 🙏',
  'Dạ chỗ đau của mình mấy bữa nay có dịu hơn được chút nào chưa ạ? 🌸 Nhiều cô chú tình trạng giống mình, được Bác sĩ Trình xem kỹ và hướng dẫn đúng nên đỡ hơn nhiều lắm ạ — mình cho em xin số để Bác sĩ gọi xem giúp mình sớm nha 🙏',
  'Dạ không biết mấy hôm nay mình còn đau nhiều không ạ 🌸 Bên em nhiều cô chú tình trạng như mình, sau khi được Bác sĩ Trình xem kỹ và dặn đúng cách thì cải thiện rõ lắm ạ — mình để lại số, Bác sĩ gọi xem giúp mình sớm nha 🙏',
  'Dạ tình trạng của mình mấy bữa nay đỡ hơn được phần nào chưa ạ? 🌸 Nhiều cô chú giống mình được Bác sĩ Trình khám kỹ tìm đúng gốc rồi hướng dẫn nên nhẹ nhõm hơn hẳn ạ — mình gửi em số để Bác sĩ gọi xem giúp mình sớm nha 🙏',
  'Dạ em hỏi thăm chút, mấy hôm nay mình còn khó chịu nhiều không ạ 🌸 Nhiều cô chú tình trạng như mình được Bác sĩ Trình xem kỹ rồi hướng dẫn đúng nên cải thiện tốt lắm — mình để lại số để Bác sĩ gọi xem giúp mình sớm nha 🙏',
];
// Chạm 5 (~24h, chưa số) — NÉN 04/07: 1 ô.
function noiDungCham5(condition, daCoSo) {
  return [pick(CHAM5_CHUASO)];
}
// Biến thể chạm 7 (~47h, chưa số) — lời cuối nhẹ để cửa mở, giữ "miễn phí" + xin số.
const CHAM7_CHUASO = [
  'Dạ em nhắn mình lần cuối nha ạ 🌸 Suất tư vấn miễn phí với Bác sĩ Trình em giữ cho mình sắp hết hạn — nếu mình còn cần, để lại số điện thoại là Bác sĩ gọi cho mình liền, hoàn toàn miễn phí ạ 🙏',
  'Dạ em xin phép nhắn mình một lần cuối nha 🌸 Suất tư vấn miễn phí với Bác sĩ Trình em dành cho mình cũng sắp hết đợt — nếu mình còn cần thì để lại số, Bác sĩ gọi cho mình liền, không tốn gì đâu ạ 🙏',
  'Dạ em ghé nhắn mình lần cuối thôi ạ 🌸 Suất tư vấn với Bác sĩ Trình em giữ cho mình sắp tới hạn rồi — mình còn cần thì cho em xin số, Bác sĩ gọi tư vấn cho mình liền, hoàn toàn miễn phí nha 🙏',
  'Dạ đây là lần cuối em nhắn để mình khỏi lỡ ạ 🌸 Suất tư vấn miễn phí với Bác sĩ Trình dành cho mình sắp hết hạn — nếu mình còn muốn thì để lại số, Bác sĩ gọi cho mình liền, không mất phí gì đâu ạ 🙏',
  'Dạ em nhắn nhẹ mình lần cuối nha ạ 🌸 Em vẫn còn giữ cho mình suất tư vấn miễn phí với Bác sĩ Trình nhưng sắp hết đợt rồi — mình còn cần thì gửi em số, Bác sĩ gọi cho mình liền, hoàn toàn miễn phí ạ 🙏',
];
// Chạm 7 (~47h, chưa số) — NÉN 04/07: 1 ô, lời cuối nhẹ nhàng để cửa mở.
function noiDungCham7(condition, daCoSo) {
  return [pick(CHAM7_CHUASO)];
}

// --- Bảng định nghĩa các chạm bot TỰ GỬI. `hours` khớp nhac-7cham/config.js. ---
// 3/4/6 = chạm giá trị (clip/cẩm nang/bám đuổi). 2/5/7 = leo thang xin số KHI CHƯA CÓ SỐ
// (engine 7 chạm rẽ nhánh: có số → telesale gọi; chưa số → dùng các builder này).
export const BOT_TOUCHES = [
  { no: 2, hours: 0.25, build: noiDungCham2, muctieu: 'Cuộc gọi vàng hụt → nhắc suất, xin số' },
  { no: 3, hours: 2,    build: noiDungCham3, muctieu: 'Gửi bằng chứng / review đúng bệnh' },
  { no: 4, hours: 6,    build: noiDungCham4, muctieu: 'Cho giá trị: cẩm nang + bài tập/mẹo tại nhà' },
  { no: 5, hours: 24,   build: noiDungCham5, muctieu: 'Cấp bách + bằng chứng xã hội → xin số' },
  { no: 6, hours: 30,   build: noiDungCham6, muctieu: 'Bám đuổi nhẹ (inbox)' },
  { no: 7, hours: 47,   build: noiDungCham7, muctieu: 'Lời cuối trước khi đóng suất' },
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
  // Trần cứng 2 ô/chạm (anh chốt 04/07 — hết cảnh dội bom).
  return Array.isArray(msgs) && msgs.length ? msgs.slice(0, 2) : null;
}
