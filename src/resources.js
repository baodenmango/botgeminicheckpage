// ============================================================
//  KHO TÀI LIỆU / QUYỀN LỢI / DỊCH VỤ — config TRUNG TÂM (anh Trình chốt 30/06).
//  Một chỗ duy nhất để cắm: brochure/PDF theo bệnh, video clip, "quyền lợi/giá trị" tặng khách,
//  dịch vụ/công nghệ mới của phòng khám. Mọi engine (chạm FB, ca-ra-bill, tái bill, follow OA)
//  tham chiếu về đây → thêm/sửa 1 nơi, cả hệ dùng đúng.
//
//  ⚠️ ĐÂY LÀ KHUNG — link/nội dung thật do anh Trình điền (Drive/Canva). Chỗ nào để '' hoặc []
//  nghĩa là CHƯA có tài liệu cho bệnh đó → engine tự bỏ qua nhẹ nhàng (không gửi link rỗng).
//  Danh mục ĐỀ XUẤT cần làm xem cuối file (RESOURCE_TODO) — checklist để anh duyệt & sản xuất.

// ---------- 1) BROCHURE / CẨM NANG PDF theo bệnh ----------
// BỘ DECK MỚI "Chương trình tập luyện tại nhà" — 17 bệnh, mỗi bệnh 1 deck slide chỉn chu
// (giải phẫu + cơ chế + red flags + bài tập từng slide + giải pháp phòng khám). Render PDF +
// up Drive 03-04/07 (folder Tài nguyên Telesale 18vagh28...). Đã thay TOÀN BỘ link cẩm nang cũ.
// Link cũ (bản markdown-render) còn lưu ở git history nếu cần lùi.
export const BROCHURE_PDF = {
  goi:        'https://drive.google.com/file/d/1xjCazryM_Kzcl1TSVsk7EhDxpqzM7CCy/view',
  vai:        'https://drive.google.com/file/d/1ttFBFQTlRfR6_DLSulYcJSPr21lSvrVC/view',
  gut:        'https://drive.google.com/file/d/1ToNAxue8m8uwaNMeEtfilEdOiGHy180I/view',
  lung:       'https://drive.google.com/file/d/1_9hsHn0ExVmqbHh8U06EZbH-ok-N2COu/view',
  tvdd:       'https://drive.google.com/file/d/1ORMH9kltA5E2DuQ4iUV8rTNC4AfIOGFt/view',
  covaigay:   'https://drive.google.com/file/d/1cufJb4nUfpzjIIvABKkHnEPK8BChQATN/view',
  chopxoay:   'https://drive.google.com/file/d/1HMvqt-Sn4zq7yBY8x41bAHWkvU2Zaep3/view',
  csc:        'https://drive.google.com/file/d/1BB9mFsHSH-V75ZT8cEodEIn4p7KA609H/view',
  ngontay:    'https://drive.google.com/file/d/1hB5V1Vj05SyLHJww2oXIfq_mLQYNwIgX/view',
  cochan:     'https://drive.google.com/file/d/1IFcFwhPwfBy6ON4cCUQds6SGJWVL5q_6/view',
  hang:       'https://drive.google.com/file/d/1qdDLfdp-t1eRXPfjfpQ7vmzQH_UzaVlY/view',
  chomdui:    'https://drive.google.com/file/d/1NuCebWxX_izJmoYOgxpeBCdiMbb9OOnd/view',
  loangxuong: 'https://drive.google.com/file/d/1TVLIXAxUAcwJIMPvbMFw9s8m6ZoeiW9t/view',
  dequervain: 'https://drive.google.com/file/d/19Y5y8h6JtAoH6BZMcvh9HZR5_KeHorvP/view',
  ongcotay:   'https://drive.google.com/file/d/10NQfT2xviYV8Z7CihZTwF1eUb_OZbsFa/view',
  tenniselbow:'https://drive.google.com/file/d/19d8USpi-Lck1USCOnZ5XNjX_z6aHl45s/view',
  gangotchan: 'https://drive.google.com/file/d/18cStZW7pTD_SKjsOjTp0pxZHhg6GYJ1p/view',
};

// Link 2 TỜ CHUNG (gửi khi follow OA / chăm sóc) — cùng folder Drive, đã set public-link.
export const PERK_PDF_URL    = 'https://drive.google.com/file/d/1bzYOw1CczJcUgOhH5MvyAUbWFPVHq1LX/view'; // tờ quyền lợi
export const SERVICE_PDF_URL = 'https://drive.google.com/file/d/1HeyCpy3GpklJXznV12LxNeQuLZ6Uork6/view'; // tờ dịch vụ

// Tên brochure (để câu mời tự nhiên). Bộ MỚI = "Chương trình tập luyện tại nhà" theo từng bệnh.
export const BROCHURE_NAME = {
  goi:      'Chương trình tập luyện thoái hóa khớp gối tại nhà',
  vai:      'Chương trình tập luyện viêm quanh khớp vai tại nhà',
  gut:      'Chương trình sống khỏe với bệnh gút tại nhà',
  lung:     'Chương trình tập luyện giảm đau cột sống thắt lưng tại nhà',
  tvdd:     'Chương trình tập luyện cho thoát vị đĩa đệm tại nhà',
  covaigay: 'Chương trình tập luyện đau cổ – vai – gáy tại nhà',
  chopxoay: 'Chương trình phục hồi gân chóp xoay vai tại nhà',
  ngontay:  'Chương trình tập luyện ngón tay lò xo tại nhà',
  cochan:   'Chương trình phục hồi bong gân cổ chân tại nhà',
  hang:     'Chương trình tập luyện thoái hóa khớp háng tại nhà',
  chomdui:  'Chương trình giảm tải & chăm sóc chỏm xương đùi tại nhà',
  csc:      'Chương trình tập luyện thoái hóa cột sống cổ tại nhà',
  loangxuong: 'Chương trình tập luyện cho người loãng xương tại nhà',
  dequervain: 'Chương trình tập luyện gân cổ tay De Quervain tại nhà',
  ongcotay:   'Chương trình tập luyện hội chứng ống cổ tay tại nhà',
  tenniselbow:'Chương trình phục hồi khuỷu tay tennis tại nhà',
  gangotchan: 'Chương trình tập luyện viêm cân gan chân tại nhà',
};

// ---------- 2) CLIP video Bác sĩ phân tích theo bệnh (tối đa 3/bệnh) ----------
// Cốt lõi bê từ touches.js. Mở rộng để [] chờ nhân viên gom clip.
export const CLIP_BY_CONDITION = {
  goi: [
    'https://www.facebook.com/share/r/1LZWzyopfW/',
    'https://www.facebook.com/share/r/1DFYq7aNR5/',
  ],
  vai: [
    'https://www.facebook.com/share/v/1bUZLUJQaz/',
    'https://www.facebook.com/share/r/17qGggo8BS/',
    'https://www.facebook.com/share/r/1945KUU4AE/',
  ],
  gut: [
    'https://www.facebook.com/share/r/192Dk5Ct5H/',
    'https://www.facebook.com/share/v/1J4YGvXQHo/',
    'https://www.facebook.com/share/r/1TF4ciks2B/',
  ],
  lung: [
    'https://www.facebook.com/share/r/19E639pQmE/',
    'https://www.facebook.com/share/r/1B4UumKN4a/',
  ],
  tvdd: [
    'https://www.facebook.com/share/r/15xvpESyDix/',
    'https://www.facebook.com/share/r/18z8xc7fZZ/',
    'https://www.facebook.com/share/r/1ERSFS6Aj8/',
  ],
  covaigay: [],
  chopxoay: [],
  ngontay:  [],
  cochan:   [],
  hang:     [],
  chomdui:  [],
  csc:      [],
  loangxuong: [],
  dequervain: [],
  ongcotay:   [],
  tenniselbow:[],
  gangotchan: [],
};

// ---------- 3) QUYỀN LỢI / GIÁ TRỊ tặng khách (đòn bẩy "cho đi") ----------
// Câu mô tả ngắn quyền lợi, cài vào chạm/tin chăm. Để khách thấy follow OA / đến khám ĐƯỢC GÌ.
// ⚠️ Tuân thủ quảng cáo y tế: KHÔNG hứa khỏi 100%, KHÔNG bịa. Chỉ nêu quyền lợi CÓ THẬT.
// Anh Trình điền/sửa cho khớp ưu đãi thật từng thời điểm.
export const PERKS = {
  // quyền lợi khi QUAN TÂM Zalo OA (nhận tài liệu + chăm sóc 1-1)
  oa_follow: [
    'Nhận trọn bộ cẩm nang + video bài tập tại nhà theo đúng bệnh của mình',
    'Được nhắc lịch tái khám / lịch liệu trình khỏi quên',
    'Hỏi đáp trực tiếp, Bác sĩ dặn dò chăm sóc thường xuyên',
  ],
  // quyền lợi khi ĐỂ LẠI SỐ / ĐẾN KHÁM lần đầu
  first_visit: [
    'Tư vấn trực tiếp với Bác sĩ chuyên khoa cơ xương khớp (miễn phí tư vấn)',
    'Được xem kỹ phim chụp, tìm đúng nguyên nhân',
    'Ưu tiên điều trị bảo tồn, hạn chế phẫu thuật',
  ],
  // quyền lợi DUY TRÌ / GIỚI THIỆU (cho BN đã điều trị)
  loyalty: [
    'Ưu tiên giữ suất tái khám với Bác sĩ',
    'Người thân giới thiệu qua được ưu tiên sắp lịch',
  ],
};

// ---------- 4) DỊCH VỤ / CÔNG NGHỆ MỚI (cài cắm để "chăm sóc" cho sang) ----------
// Danh mục dịch vụ/công nghệ của phòng khám — bot dùng để cài vào tư vấn/chăm sóc đúng bệnh.
// ⚠️ CHỈ nêu dịch vụ CÓ THẬT. Bệnh nào hợp dịch vụ nào → map ở SERVICE_BY_CONDITION.
// Anh Trình bổ sung công nghệ mới (vd sóng xung kích, laser công suất cao...) vào đây.
export const SERVICES = {
  prp:    { ten: 'Tiêm huyết tương giàu tiểu cầu (PRP)', mota: 'kích thích phục hồi mô tổn thương từ chính máu của mình' },
  ha:     { ten: 'Tiêm Acid Hyaluronic (chất nhờn khớp)', mota: 'bổ sung chất nhờn giúp khớp vận động êm hơn' },
  noikhop:{ ten: 'Tiêm nội khớp / nội gân', mota: 'đưa thuốc đúng vị trí tổn thương, giảm đau tại chỗ' },
  sieuam: { ten: 'Siêu âm cơ xương khớp', mota: 'nhìn rõ tổn thương phần mềm để chẩn đoán chính xác' },
  vltl:   { ten: 'Điện trị liệu – Vật lý trị liệu', mota: 'phục hồi chức năng, giảm đau không dùng nhiều thuốc' },
  // --- CÔNG NGHỆ MỚI (anh điền khi triển khai) ---
  // songxungkich: { ten: 'Sóng xung kích Shockwave', mota: '...' },
  // laser:        { ten: 'Laser công suất cao', mota: '...' },
};

// Map bệnh → dịch vụ phù hợp (để bot gợi đúng, không gợi bừa).
export const SERVICE_BY_CONDITION = {
  goi:      ['prp', 'ha', 'noikhop', 'vltl', 'sieuam'],
  vai:      ['prp', 'noikhop', 'vltl', 'sieuam'],
  chopxoay: ['prp', 'noikhop', 'vltl', 'sieuam'],
  gut:      ['noikhop', 'vltl'],
  lung:     ['vltl', 'noikhop'],
  tvdd:     ['vltl', 'noikhop'],
  covaigay: ['vltl', 'noikhop'],
  csc:      ['vltl', 'noikhop'],
  ngontay:  ['noikhop', 'prp'],
  cochan:   ['prp', 'vltl', 'sieuam'],
  hang:     ['prp', 'ha', 'noikhop', 'vltl'],
  chomdui:  ['prp', 'noikhop', 'vltl'],
  loangxuong: ['vltl', 'sieuam'],
  dequervain: ['noikhop', 'vltl', 'sieuam'],
  ongcotay:   ['noikhop', 'vltl', 'sieuam'],
  tenniselbow:['prp', 'noikhop', 'vltl', 'sieuam'],
  gangotchan: ['prp', 'noikhop', 'vltl', 'sieuam'],
};

// Helper: lấy mô tả dịch vụ gợi ý cho 1 bệnh (1-2 dịch vụ nổi bật) — câu ngắn để chèn vào tin.
export function suggestServices(condition, max = 2) {
  const keys = (SERVICE_BY_CONDITION[condition] || []).slice(0, max);
  return keys.map((k) => SERVICES[k]).filter(Boolean);
}

// ---------- CHECKLIST ĐỀ XUẤT (để anh Trình duyệt & sản xuất nội dung) ----------
// KHÔNG dùng trong code — chỉ là ghi chú điều hướng việc. Xem cũng được, xóa cũng được.
export const RESOURCE_TODO = `
[x] BỘ DECK MỚI "Chương trình tập luyện tại nhà" 17 bệnh — ĐÃ render PDF + up Drive 03-04/07,
    BROCHURE_PDF đã trỏ hết sang deck mới. Nguồn: 02-Marketing-SalePage/Decks-VLTL-17-benh/
    (engine _engine/deck_engine.py + config.py mỗi bệnh + ảnh Gemini). Link cẩm nang cũ ở git history.
[x] Tờ quyền lợi (PERK_PDF_URL) + tờ dịch vụ (SERVICE_PDF_URL) — ĐÃ up Drive.
[ ] Nâng cấp PDF từ bản Chrome-render lên bản Canva ĐẸP hơn (tùy chọn) → chỉ đổi link Drive.
[ ] Clip Bác sĩ phân tích cho: covaigay + các bệnh mới (CLIP_BY_CONDITION còn []) — gom clip 2 fanpage.
[ ] Nếu có công nghệ MỚI (sóng xung kích, laser...) → điền vào SERVICES + map SERVICE_BY_CONDITION
    + cập nhật tờ dịch vụ (02-...-Zalo/02-To-dich-vu-cong-nghe.md) rồi render lại PDF.
`;
