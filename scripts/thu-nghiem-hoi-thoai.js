// ===== THỬ NGHIỆM HỘI THOẠI BÁN TỰ ĐỘNG (đại tu 15/09) — chạy TAY, cần GEMINI_API_KEY =====
// Phát lại các bệnh án thật qua generateReply với não HIỆN TẠI trên đĩa, in đầu ra để người chấm.
//   GEMINI_API_KEY=... node scripts/thu-nghiem-hoi-thoai.js
// 4 tiêu chí chấm (in kèm từng ca):
//   ① có trả lời đúng câu khách vừa hỏi không (nhất là "ở xa làm sao")
//   ② có hỏi bệnh người đã nói "không đau" không (phải KHÔNG)
//   ③ có dí link/xin số sau lời chúc ngủ ngon không (phải KHÔNG)
//   ④ có bám bệnh trong quảng cáo không (thẻ ads)
process.env.DB_PATH = process.env.DB_PATH || '/tmp/thu-nghiem-hoi-thoai.db';
const { generateReply } = await import('../src/gemini.js');
const { dungTheQuangCao } = await import('../src/adcontext.js');

const CA = [
  {
    ten: 'BỆNH ÁN HOA THỦY — fan xã giao đêm khuya (14/09)',
    tieuChi: '②③: KHÔNG hỏi bệnh, KHÔNG link, đáp ấm ngắn rồi chúc ngủ ngon lại',
    history: [
      { role: 'user', text: 'Dạ, cảm ơn BS. Tôi là người Quy Nhơn, có duyên biết Bs từ lúc Bv Chợ Rẫy chuyển qua bv Bưu Điện, thời gian nằm viện thấy BS là người tài giỏi lại có tâm với bệnh nhân nên rất mến mộ BS, nên thường xuyên theo dõi bài đăng của BS để có thêm chút kiến thức chăm sóc sk' },
      { role: 'user', text: 'Khuya quá còn nt làm phiền BS quá, xin lỗi BS nha! Chúc BS ngủ ngon!' },
    ],
    name: 'Hoa Thuy',
  },
  {
    ten: 'BỆNH ÁN HOA THỦY lượt 2 — khách nói KHÔNG ĐAU',
    tieuChi: '②: khách đã nói không đau → cấm hỏi "khớp gối, cột sống hay vai gáy"',
    history: [
      { role: 'user', text: 'Khuya quá còn nt làm phiền BS quá, xin lỗi BS nha! Chúc BS ngủ ngon!' },
      { role: 'model', text: 'Dạ cô ơi, em cảm ơn cô đã thương và theo dõi Bác sĩ Trình nha 🌷' },
      { role: 'user', text: 'Dạ k có đau gì BS, tại thấy Bs nt nên trả lời sợ bs lo cho bệnh nhân thoi ạ!' },
      { role: 'user', text: 'tôi lớn tuổi nên thức khuya thôi ạ, cảm ơn bs nhiều, Chúc Bs ngủ ngon ạ!' },
    ],
    name: 'Hoa Thuy',
  },
  {
    ten: 'BỆNH ÁN LƯƠNG TỜ RÌNH — trả lời ads + hỏi Ở XA (14/09)',
    tieuChi: '①④: phải trả lời "ở xa thì làm sao" + bám bệnh VAI trong ads, không hỏi trống',
    history: [
      { role: 'user', text: 'Tôi bị triệu chứng như bác nói ở trên' },
      { role: 'user', text: 'Tôi ở xa thì phải làm sao ạ' },
    ],
    name: 'Lương Tờ Rình CR',
    contextTag: dungTheQuangCao('Đau nhức khớp vai, giơ tay khó khăn? Cẩn thận bạn đang bị viêm chóp xoay! ⚠️') +
      '\n[KHÁCH BÁO Ở XA — CHƯA RÕ TỈNH] Khách vừa nói mình ở xa / không đến được. Đây là CÂU HỎI THẬT, phải trả lời thẳng theo kịch bản Ở XA.',
  },
  {
    ten: 'KHÁCH HỎI 2 CÂU MỘT LÚC — giá khám + địa chỉ',
    tieuChi: '①: phải đáp CẢ giá lẫn địa chỉ, không nuốt câu nào',
    history: [
      { role: 'user', text: 'Đau lưng 2 năm rồi. Cho hỏi khám hết bao nhiêu tiền, với phòng khám ở đâu vậy?' },
    ],
    name: 'Minh Tan',
  },
];

for (const ca of CA) {
  console.log('\n' + '═'.repeat(90));
  console.log('🧪 ' + ca.ten);
  console.log('   TIÊU CHÍ: ' + ca.tieuChi);
  const reply = await generateReply(ca.history, 'reply', ca.name, null, { channel: 'facebook', contextTag: ca.contextTag || null });
  console.log('   degraded:', reply.degraded, '| condition:', reply.condition, '| opt_out:', reply.opt_out, '| handover:', reply.handover);
  (reply.messages || []).forEach((m, i) => console.log(`   BOT Ô${i + 1}: ${m}`));
}
console.log('\n(Người chấm đọc từng ca theo tiêu chí — đây là thử nghiệm bán tự động, không vào CI.)');
