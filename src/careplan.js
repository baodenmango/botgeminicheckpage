// ============================================================
//  BỘ NÃO PHÂN TÍCH CHĂM SÓC SAU KHÁM (anh Trình chốt 14/07):
//  Khách ĐÃ KHÁM quét Zalo OA để lại SĐT → tra ra hồ sơ → bot phải nói KHỚP:
//  bị bệnh gì thì hỏi thăm đúng triệu chứng bệnh đó, điều trị gì thì dặn dò
//  đúng loại điều trị đó (tiêm PRP khác toa thuốc), và chăm theo GIAI ĐOẠN
//  (vừa khám / đang ngấm / giữa liệu trình / quá hẹn tái khám / lâu ngày).
//
//  Đầu ra: buildCarePlanTag(record) → khối [QUY TRÌNH CHĂM SÓC] gắn vào prompt
//  Gemini (cạnh thẻ [BN_CŨ]). Nội dung dặn dò BẢO THỦ y khoa: không chẩn đoán,
//  không hứa khỏi, cờ đỏ thì hướng về Bác sĩ ngay — cùng ranh giới với billtouches.
// ============================================================
import { CONDITION_VI } from './conditions.js';
import { mapDiagnosis, parseVisitDate } from './medi.js';

// ---------- Phác đồ chăm theo BỆNH ----------
// Mỗi bệnh: theoDoi = hỏi thăm đúng triệu chứng; danDo = dặn tại nhà đúng bệnh;
// coDo = dấu hiệu phải báo Bác sĩ NGAY (chỉ liệt kê cái CÓ THẬT, không dọa quá).
const CHAM_SOC_BENH = {
  goi: {
    theoDoi: 'đi lại/lên xuống cầu thang còn đau không, gối còn sưng hay cứng buổi sáng không',
    danDo: 'hạn chế leo cầu thang nhiều và ngồi xổm; đi bộ nhẹ vừa sức; giữ cân nặng',
    coDo: 'gối sưng nóng đỏ nhiều, không co duỗi được, đau tăng nhanh',
  },
  vai: {
    theoDoi: 'giơ tay/chải tóc/với đồ còn đau không, đêm nằm nghiêng bên vai đó còn đau không',
    danDo: 'tránh xách nặng và với tay quá đầu đột ngột; tập lắc lư con lắc nhẹ nếu Bác sĩ đã hướng dẫn',
    coDo: 'vai đau tăng kèm sưng nóng, tê lan xuống tay, yếu tay rõ',
  },
  gut: {
    theoDoi: 'còn cơn sưng đau khớp về đêm không, có tái cơn ở ngón/bàn chân không',
    danDo: 'kiêng bia rượu, hạn chế hải sản - nội tạng - thịt đỏ; uống nhiều nước; uống thuốc đều theo toa, đừng tự ngưng khi hết đau',
    coDo: 'khớp sưng nóng đỏ dữ dội kèm sốt',
  },
  lung: {
    theoDoi: 'cúi/đứng lâu còn đau không, đau có lan xuống mông - chân không',
    danDo: 'tránh khiêng vác nặng và cúi gập đột ngột; không nằm võng/nệm quá mềm; đi lại nhẹ, đừng nằm lì một chỗ',
    coDo: 'đau lan xuống chân kèm tê yếu chân, tiểu khó/bí tiểu — báo Bác sĩ NGAY',
  },
  tvdd: {
    theoDoi: 'còn tê/đau lan xuống chân không, ngồi lâu - đứng dậy có khó không',
    danDo: 'tránh khiêng nặng, xoay vặn cột sống đột ngột; nằm nệm phẳng vừa cứng; tập theo đúng bài Bác sĩ hướng dẫn',
    coDo: 'tê yếu chân tăng dần, bí tiểu, mất cảm giác vùng yên ngựa — báo Bác sĩ NGAY',
  },
  covaigay: {
    theoDoi: 'xoay cổ còn cứng/đau không, có còn tê lan xuống vai tay không, ngủ dậy có đỡ hơn không',
    danDo: 'hạn chế cúi màn hình lâu, kê gối vừa phải; chườm ấm vùng cổ vai; giữa giờ làm nhớ đổi tư thế',
    coDo: 'tê yếu tay tăng dần, chóng mặt nhiều khi xoay cổ',
  },
  chopxoay: {
    theoDoi: 'giơ tay qua đầu còn đau không, đêm còn đau nhức vai không, lực tay có yếu không',
    danDo: 'tuyệt đối tránh xách nặng và động tác giật vai; tập đúng bài phục hồi Bác sĩ giao, đừng tự tăng nặng',
    coDo: 'yếu tay rõ rệt, đau không giảm sau đợt điều trị',
  },
  csc: {
    theoDoi: 'cổ còn cứng buổi sáng không, có tê lan xuống tay không',
    danDo: 'tránh gối cao, tránh cúi đầu xem điện thoại lâu; chườm ấm; vận động cổ nhẹ nhàng đúng bài',
    coDo: 'tê yếu tay tăng, đi loạng choạng',
  },
  ngontay: {
    theoDoi: 'ngón tay còn kẹt/bật lò xo buổi sáng không, còn đau gốc ngón không',
    danDo: 'hạn chế nắm chặt lặp lại (vắt khăn, bóp tay lái); ngâm nước ấm buổi sáng cho mềm gân',
    coDo: 'ngón kẹt cứng hẳn không duỗi được, sưng nóng',
  },
  cochan: {
    theoDoi: 'cổ chân còn sưng không, đi đứng còn lỏng lẻo/đau không',
    danDo: 'hạn chế chạy nhảy và địa hình gồ ghề tới khi Bác sĩ cho phép; băng/nẹp đúng hướng dẫn; kê cao chân khi nghỉ',
    coDo: 'sưng bầm tăng, đứng tì chân đau chói không đỡ',
  },
  hang: {
    theoDoi: 'đi lại/dạng chân còn đau háng không, có còn cứng khớp buổi sáng không',
    danDo: 'tránh ngồi xổm, ngồi ghế thấp; đi bộ vừa sức, có thể dùng gậy hỗ trợ giai đoạn đau nhiều',
    coDo: 'đau háng tăng nhanh, ngắn chân/khập khiễng rõ lên',
  },
  chomdui: {
    theoDoi: 'đau háng - mông khi đứng lâu/đi lại còn không, biên độ xoay chân thế nào',
    danDo: 'giảm tải khớp háng: tránh đứng lâu, khiêng nặng; kiêng rượu bia thuốc lá tuyệt đối; tái khám ĐÚNG hẹn để theo dõi chỏm — bệnh này theo dõi sát rất quan trọng',
    coDo: 'đau tăng nhanh, đi khập khiễng nặng lên',
  },
  loangxuong: {
    theoDoi: 'có đau lưng âm ỉ/giảm chiều cao không, uống thuốc - bổ sung canxi/D3 đều không',
    danDo: 'uống thuốc đều đúng toa; phơi nắng sáng nhẹ; nhà cửa gọn gàng CHỐNG TÉ NGÃ (quan trọng nhất); tập chịu lực nhẹ như đi bộ',
    coDo: 'đau lưng đột ngột sau cúi/bê đồ (coi chừng xẹp đốt sống) — báo Bác sĩ NGAY',
  },
  dequervain: {
    theoDoi: 'cổ tay phía ngón cái còn đau khi bế/xách/vắt đồ không',
    danDo: 'hạn chế bế em bé sai tư thế, vắt khăn, lướt điện thoại nhiều; đeo nẹp ngón cái nếu Bác sĩ đã cấp',
    coDo: 'đau lan rộng, sưng nóng vùng cổ tay',
  },
  ongcotay: {
    theoDoi: 'còn tê bàn tay về đêm không, có rớt đồ/yếu khi cầm nắm không',
    danDo: 'tránh gập cổ tay lâu (chạy xe, gõ phím sai tư thế); đeo nẹp đêm nếu Bác sĩ đã hướng dẫn; vẩy tay nhẹ khi tê',
    coDo: 'tê liên tục cả ngày, teo cơ gò cái, rớt đồ thường xuyên',
  },
  tenniselbow: {
    theoDoi: 'khuỷu còn đau khi xách đồ/vắt khăn/xoay nắm cửa không',
    danDo: 'hạn chế động tác nắm - xoay lặp lại; chườm lạnh khi đau tăng sau vận động; tập giãn cơ cẳng tay đúng bài',
    coDo: 'đau lan xuống cẳng tay kèm tê, sưng nóng khuỷu',
  },
  gangotchan: {
    theoDoi: 'gót còn đau nhói bước đầu tiên buổi sáng không, đi lâu có đau lại không',
    danDo: 'mang giày đế mềm/lót gót, tránh chân đất trên nền cứng; lăn chai nước lạnh dưới lòng bàn chân; giãn bắp chuối mỗi sáng',
    coDo: 'đau gót cả khi nghỉ, sưng nóng vùng gót',
  },
  khac: null,
  unknown: null,
};

// Dặn dò MẶC ĐỊNH khi chưa map được bệnh (vẫn chăm được, không bịa).
const CHAM_SOC_CHUNG = {
  theoDoi: 'tình trạng sau buổi khám/điều trị vừa rồi đỡ hơn hay còn khó chịu chỗ nào',
  danDo: 'nghỉ ngơi hợp lý, làm đúng theo hướng dẫn Bác sĩ Trình đã dặn trong buổi khám',
  coDo: 'đau tăng bất thường, sưng nóng đỏ, sốt, tê yếu tay chân',
};

// ---------- Nhận diện LOẠI ĐIỀU TRỊ từ chữ liệu trình/toa (MEDi ghi tự do) ----------
function nhanDienDieuTri(record) {
  const t = `${record?.treatment || ''} ${record?.prescription || ''}`.toLowerCase();
  const out = [];
  if (/prp|huyết tương|huyet tuong|tiểu cầu|tieu cau/.test(t)) out.push('prp');
  if (/hyaluronic|chất nhờn|chat nhon|hyalgan|\bha\b/.test(t)) out.push('ha');
  else if (/tiêm|tiem|inject/.test(t) && !out.includes('prp')) out.push('tiem');
  if (/vật lý|vat ly|trị liệu|tri lieu|điện xung|dien xung|kéo giãn|keo gian|siêu âm trị|laser/.test(t)) out.push('vltl');
  if (/thuốc|thuoc|toa|đơn|uống|uong/.test(t)) out.push('thuoc');
  return out;
}

const DAN_DO_DIEU_TRI = {
  prp: 'Sau tiêm PRP 1-3 ngày đầu vùng tiêm hơi căng tức nhẹ là BÌNH THƯỜNG (thuốc đang kích thích tự phục hồi) — KHÔNG uống kháng viêm khi chưa hỏi Bác sĩ (giảm tác dụng PRP), hạn chế vận động mạnh vùng tiêm 48-72h, giữ khô sạch chỗ tiêm.',
  ha: 'Sau tiêm chất nhờn, vùng tiêm hơi tức nhẹ 1-2 hôm là bình thường; hạn chế vận động mạnh khớp đó 48h; hiệu quả trơn khớp thường rõ dần sau 1-2 tuần, đừng sốt ruột.',
  tiem: 'Sau tiêm, giữ chỗ tiêm khô sạch, hạn chế vận động mạnh vùng tiêm 24-48h; sưng tức nhẹ 1-2 hôm là bình thường, đắp ấm cho dễ chịu.',
  vltl: 'Đi đủ và đúng lịch các buổi trị liệu — bỏ buổi giữa chừng dễ mất đà phục hồi; sau buổi tập hơi mỏi là bình thường, đau tăng nhiều thì báo lại để Bác sĩ chỉnh cường độ.',
  thuoc: 'Uống thuốc đúng giờ, đủ liều theo toa, ăn no rồi hẵng uống; ĐỪNG tự ngưng thuốc khi thấy đỡ — đỡ chưa phải là khỏi; thấy cồn cào/dị ứng thì nhắn ngay để Bác sĩ điều chỉnh.',
};

// ---------- Giai đoạn chăm theo số ngày từ lần khám cuối ----------
function giaiDoanCham(record) {
  const ts = parseVisitDate(String(record?.lastVisit || '').slice(0, 10)) ||
    (record?.lastVisit ? Math.floor(Date.parse(record.lastVisit) / 1000) || null : null);
  if (!ts) return { ten: 'không rõ ngày khám', muc_tieu: 'hỏi thăm tình trạng hiện tại rồi chăm theo câu trả lời; nếu lâu chưa tái khám thì mời qua Bác sĩ kiểm tra lại' };
  const ngay = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 86400));
  if (ngay <= 2) return { ngay, ten: `VỪA KHÁM/ĐIỀU TRỊ (${ngay} ngày trước)`, muc_tieu: 'hỏi thăm sau buổi khám, dặn dò an toàn theo đúng điều trị vừa làm, trấn an phản ứng bình thường vs cờ đỏ' };
  if (ngay <= 7) return { ngay, ten: `ĐANG NGẤM ĐIỀU TRỊ (${ngay} ngày sau khám)`, muc_tieu: 'hỏi tiến triển (khơi để khách tự nói "đỡ"), củng cố tuân thủ toa/bài tập, nhắc mốc tái khám sắp tới' };
  if (ngay <= 30) return { ngay, ten: `GIỮA LIỆU TRÌNH (${ngay} ngày sau khám)`, muc_tieu: 'hỏi tiến triển + nhắc buổi tiếp theo/tái khám — xương khớp bỏ giữa chừng dễ tái lại, công 2 mũi/buổi trước uổng' };
  if (ngay <= 90) return { ngay, ten: `QUÁ LÂU CHƯA TÁI KHÁM (${ngay} ngày)`, muc_tieu: 'hỏi thăm chân thành tình trạng hiện tại, nếu còn khó chịu thì mời tái khám để Bác sĩ Trình kiểm tra lại — KHÔNG trách khách bỏ hẹn' };
  return { ngay, ten: `KHÁCH CŨ LÂU NGÀY (${ngay} ngày)`, muc_tieu: 'hỏi thăm như người quen cũ, quan tâm tình trạng dạo này; nếu khách than đau lại thì mời qua Bác sĩ xem lại, đừng bán vồ vập' };
}

/**
 * Dựng khối [QUY TRÌNH CHĂM SÓC] gắn vào prompt cho BỆNH NHÂN ĐÃ KHÁM.
 * @param {object} record  hồ sơ từ lookupMedi/lookupDaKham (có thể thiếu trường — fail mềm)
 * @param {string|null} conditionFallback  mã bệnh đã biết từ hội thoại (khi MEDi không có chẩn đoán)
 */
export function buildCarePlanTag(record, conditionFallback = null) {
  if (!record) return null;
  const cond = (record.diagnosis ? mapDiagnosis(record.diagnosis) : null) ||
    (conditionFallback && conditionFallback !== 'unknown' ? conditionFallback : 'unknown');
  const benh = CHAM_SOC_BENH[cond] || CHAM_SOC_CHUNG;
  const tenBenh = record.diagnosis || CONDITION_VI[cond] || 'chưa rõ (hỏi thăm để nắm)';
  const gd = giaiDoanCham(record);
  const dieuTri = nhanDienDieuTri(record);

  const dong = [
    `[QUY TRÌNH CHĂM SÓC SAU KHÁM — bệnh: ${tenBenh} · giai đoạn: ${gd.ten}]`,
    `MỤC TIÊU LƯỢT NÀY: ${gd.muc_tieu}.`,
    `1) HỎI THĂM ĐÚNG BỆNH: ${benh.theoDoi}.`,
    `2) NGHE & PHÂN LOẠI: khách nói ĐỠ → khen quá trình tuân thủ + dặn giữ nhịp (đỡ chưa phải khỏi); ` +
      `CHƯA ĐỠ/còn đau → đồng cảm, hỏi rõ đau lúc nào - cử động nào, trấn an là Bác sĩ sẽ theo sát, mời tái khám để chỉnh phác đồ; ` +
      `NẶNG HƠN hoặc có cờ đỏ → báo Bác sĩ xem NGAY, đặt handover nếu là cấp cứu thật.`,
    `3) DẶN DÒ ĐÚNG BỆNH: ${benh.danDo}.`,
  ];
  for (const dt of dieuTri) {
    if (DAN_DO_DIEU_TRI[dt]) dong.push(`   • ĐÚNG ĐIỀU TRỊ ĐÃ LÀM: ${DAN_DO_DIEU_TRI[dt]}`);
  }
  dong.push(`4) CỜ ĐỎ phải báo Bác sĩ ngay (nói nhẹ nhàng, không dọa): ${benh.coDo || CHAM_SOC_CHUNG.coDo}.`);
  if (record.sessionsDone || record.sessionsTotal) {
    dong.push(`LIỆU TRÌNH: đã làm ${record.sessionsDone || '?'}/${record.sessionsTotal || '?'} buổi — còn buổi thì nhắc buổi tiếp theo, xong hết thì hướng mốc tái khám định kỳ.`);
  }
  dong.push(
    'LUẬT CỨNG: chỉ dùng dữ kiện CÓ THẬT ở trên — thẻ thiếu gì thì HỎI, không suy diễn. ' +
    'KHÔNG xin số (đã có hồ sơ), KHÔNG gửi link sale page, KHÔNG mời "suất tư vấn miễn phí", ' +
    'KHÔNG nói "trợ lý sẽ gọi lại trong ít phút" trừ khi khách CHỦ ĐỘNG cần gọi. ' +
    'Mỗi lượt chỉ đi 1 bước của quy trình (thường là hỏi thăm trước), ĐỪNG dồn cả 4 bước vào một lần nhắn.'
  );
  return dong.join('\n');
}
