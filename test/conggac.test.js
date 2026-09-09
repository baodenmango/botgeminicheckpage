// Bộ thước cho CỔNG GÁC ĐẦU RA (src/conggac.js).
// Chạy: npm test   (node:test + node:assert, KHÔNG thêm dependency nào)
//
// LUẬT VIẾT TEST Ở ĐÂY — mỗi nhóm cấm phải có ĐỦ HAI VẾ:
//   (a) ca DÍNH  — cổng phải bắt được, kể cả biến thể né;
//   (b) ca KHÔNG ĐƯỢC DÍNH — chống dương tính giả.
// Vế (b) quan trọng ngang vế (a): cổng bắt oan thì bot cụt lời giữa lúc khách đang hỏi,
// mà mất khách vì bot câm là chuyện ĐÃ XẢY RA THẬT (20/07 và 01/09).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ganhCong, docTien, reMem, boDau, cauAnToan, thongKe, resetThongKe, GIA_THAT,
} from '../src/conggac.js';

// --- tiện ích ---------------------------------------------------------------
const ra = (s, opts) => ganhCong([s], opts);
const loai = (kq) => kq.viPham.map((v) => v.loai);
const coLoai = (kq, l) => loai(kq).includes(l);
const raChu = (kq) => kq.oCuoi.join(' ');
/** Ô đi qua sạch sẽ: không vi phạm nào, chữ giữ nguyên. */
function sach(t, opts) {
  const kq = ra(t, opts);
  assert.deepEqual(kq.viPham, [], `PHẢI SẠCH nhưng bị bắt: ${JSON.stringify(loai(kq))} — "${t}"`);
  assert.equal(kq.oCuoi[0], t, `chữ phải giữ nguyên — "${t}"`);
  return kq;
}

// ===========================================================================
// NHÓM (C) — HỨA KẾT QUẢ (NĐ 38/2021, cấm VĨNH VIỄN)
// ===========================================================================
test('(C) CÔNG KHAI — bắt CẢ HAI bậc (cứng + mềm) và SỬA thành lời an toàn', () => {
  const ca = [
    'Bên em cam kết chữa khỏi hẳn cho mình ạ.',
    'Liệu trình này trị dứt điểm, không tái phát luôn ạ.',
    'Phương pháp này điều trị tận gốc, hiệu quả 100% ạ.',
    'Mình yên tâm nha, an toàn tuyệt đối và giảm đau ngay từ buổi đầu ạ.',
    'Tỉ lệ khỏi rất cao, gần như khỏi 100% ạ.',
  ];
  for (const t of ca) {
    const kq = ra(t, { congKhai: true });
    assert.ok(coLoai(kq, 'hua_ket_qua'), `phải bắt hứa kết quả: "${t}"`);
    const sau = raChu(kq).toLowerCase();
    for (const cam of ['khỏi hẳn', 'dứt điểm', 'không tái phát', 'cam kết',
      'tận gốc', 'hiệu quả 100%', 'an toàn tuyệt đối', 'tỉ lệ khỏi rất cao']) {
      assert.ok(!sau.includes(cam), `sau khi sửa vẫn còn "${cam}": ${sau}`);
    }
  }
});

test('(C) INBOX — bậc CỨNG (cam kết/bảo đảm/100%) vẫn bị SỬA', () => {
  const ca = [
    'Bên em cam kết chữa cho mình ạ.',
    'Hiệu quả 100% luôn mình nha.',
    'Thủ thuật này an toàn tuyệt đối ạ.',
    'Tiêm xong là không tái phát nữa ạ.',
    'Bên em đảm bảo khỏi cho mình ạ.',
  ];
  for (const t of ca) {
    assert.ok(coLoai(ra(t), 'hua_ket_qua'), `inbox vẫn phải bắt cam kết cứng: "${t}"`);
  }
});

test('(C) INBOX — bậc MỀM (giọng tư vấn thường) phải THẢ NGUYÊN VĂN (anh Trình 09/09)', () => {
  // Ca thật 09/09 08:42 — cổng sửa oan câu này rồi réo group, anh Trình bắt tại trận.
  sach('Bác sĩ Trình sẽ xem lại phim và kết quả cũ cho mình, rồi tư vấn hướng điều trị phù hợp hơn để mình dứt điểm hẳn tình trạng này ạ.');
  sach('Nhiều cô chú theo đúng phác đồ thì khỏi hẳn đau, đi lại bình thường ạ.');
  sach('Hướng của Bác sĩ là xử lý tận gốc chỗ viêm đó ạ.');
  sach('Điều trị đúng thì cơn đau hết hẳn được mình nha.');
});

test('(C) CÔNG KHAI — bắt cả BIẾN THỂ né (hoa/thường · ký tự chèn · tách từ)', () => {
  const bienThe = [
    'Cam đoan kh.ỏi hẳn nha mình ơi, yên tâm ạ.',
    'Bệnh này KHỎI HẲN được mình nhé, bác sĩ nói vậy ạ.',
    'Bên em C-A-M K-Ế-T chất lượng dịch vụ cho mình ạ.',
    'Trị d.ứt đ.iểm luôn cho mình ạ, không lo gì hết ạ.',
    'Điều trị tận  gốc luôn mình nha, bác sĩ giỏi lắm ạ.',
  ];
  for (const t of bienThe) {
    assert.ok(coLoai(ra(t, { congKhai: true }), 'hua_ket_qua'), `biến thể né phải bị bắt: "${t}"`);
  }
  // Biến thể né của bậc CỨNG thì INBOX cũng phải bắt.
  assert.ok(coLoai(ra('Bên em C-A-M K-Ế-T chất lượng dịch vụ cho mình ạ.'), 'hua_ket_qua'));
});

test('(C) KHÔNG được dính — câu tư vấn hợp lệ phải đi qua nguyên vẹn (cả 2 làn)', () => {
  for (const opts of [undefined, { congKhai: true }]) {
    sach('Sau điều trị nhiều người thấy đỡ hơn và đi lại nhẹ hơn ạ.', opts);
    sach('Bệnh này dễ tái phát nếu mình ngồi lâu, nên cần tập thêm ạ.', opts);
    sach('Bác sĩ hẹn khám lại để đánh giá đáp ứng của mình ạ.', opts);
    sach('Mình đỡ đau hơn chưa ạ, đi lại có dễ chịu hơn không ạ?', opts);
    sach('Em ghi nhận rồi ạ, Bác sĩ sẽ xem phim rồi tư vấn hướng phù hợp cho mình.', opts);
  }
});

// ===========================================================================
// NHÓM (E) — HỌC VỊ CHƯA CÓ (anh Trình đang học CK1 năm 2, CHƯA có bằng)
// ===========================================================================
test('(E) học vị — DÍNH và bị gỡ khỏi câu', () => {
  const ca = [
    'BS.CK1 Phan Nhật Trình sẽ trực tiếp khám cho mình ạ.',
    'Bác sĩ Chuyên khoa I Phan Nhật Trình có hơn 10 năm kinh nghiệm ạ.',
    'Mình gặp BS CKI Trình nha ạ.',
    'Bác sĩ Trình là BSCK1 về cơ xương khớp ạ.',
  ];
  for (const t of ca) {
    const kq = ra(t);
    assert.ok(coLoai(kq, 'hoc_vi'), `phải bắt học vị: "${t}"`);
    const sau = boDau(raChu(kq)).replace(/[\s.]/g, '');
    assert.ok(!/bsck1|bscki|ck1|cki|chuyenkhoai(?![a-z])/.test(sau), `còn học vị: ${raChu(kq)}`);
  }
});

test('(E) KHÔNG được dính — "chuyên khoa" dùng đúng nghĩa phải đi qua', () => {
  // Đây là chỗ dễ bắt oan nhất của cả cổng.
  sach('Bác sĩ Trình là bác sĩ chuyên khoa cơ xương khớp ạ.');
  sach('Phòng khám chuyên khoa cơ xương khớp Hiệp Lợi ạ.');
  sach('Khám chuyên khoa + siêu âm tầm soát là 300k trọn gói ạ.');
  sach('Mình khám chuyên khoa cơ xương khớp thì đúng chuyên môn của Bác sĩ ạ.');
  sach('Bác sĩ Trình đang học chuyên khoa sâu về cơ xương khớp ạ.');
});

test('(E) "CK1" trơ trọi chỉ tính là học vị khi có nhắc bác sĩ', () => {
  assert.ok(coLoai(ra('Bác sĩ khám cho mình là CK1 ạ.'), 'hoc_vi'));
  // Không nhắc bác sĩ → không suy diễn (tránh bắt oan mã hồ sơ/mã phòng).
  const kq = ra('Mình cầm phiếu CK1 ra quầy nha ạ.');
  assert.ok(!coLoai(kq, 'hoc_vi'), 'không được suy diễn học vị khi câu không nhắc bác sĩ');
});

// ===========================================================================
// GIÁ — chỉ 5 mức thật, sai một số là CHẶN
// ===========================================================================
test('GIÁ BỊA — con tiền ngoài bảng thì CHẶN, không cho đi', () => {
  const ca = [
    'Liệu trình 3 mũi tầm 15 triệu ạ.',
    'Tiêm 2 khớp thì khoảng 10 triệu ạ.',
    'Chi phí chụp X-quang là 250.000đ ạ.',
    'Bên em rẻ hơn bệnh viện 2 triệu ạ.',
    'Giá tiêm dao động từ 5 triệu đến 7 triệu ạ.',
  ];
  for (const t of ca) {
    const kq = ra(t);
    assert.ok(coLoai(kq, 'gia_bia'), `phải chặn giá bịa: "${t}"`);
    assert.ok(!kq.oCuoi.includes(t), 'ô vi phạm không được lọt ra');
  }
});

test('GIÁ THẬT — 5 mức đã duyệt phải đi qua nguyên vẹn', () => {
  sach('Khám chuyên khoa + siêu âm tầm soát là 300k trọn gói ạ, có siêu âm luôn trong đó.');
  sach('Chi phí tiêm dịch nhờn từ 5 triệu ạ, Bác sĩ coi phim xong mới báo chính xác được.');
  sach('Tiêm cấp tính từ 600.000đ ạ.');
  sach('Phí khám là 300.000đ ạ.');
  sach('PRP thì từ 5.000.000đ ạ.');
});

test('GIÁ — số KHÔNG phải tiền thì không được bắt oan', () => {
  sach('Phòng khám cách nhà mình khoảng 3 km thôi ạ.');
  sach('Mình trên 60 tuổi thì nhớ mang CCCD nha ạ.');
  sach('Phòng khám mở cửa 8h00 mỗi ngày ạ.');
  sach('Số hotline của bên em là 0962 349 329 ạ.');
  sach('Mình uống 2 viên mỗi ngày sau ăn nha ạ.');
  sach('Bác sĩ đã khám cho hơn 1.000 bệnh nhân cơ xương khớp ạ.');
});

test('docTien — đọc đúng trị số, bỏ đúng thứ không phải tiền', () => {
  const doc = (s) => docTien(s).map((t) => t.tri);
  assert.deepEqual(doc('giá 300k'), [300000]);
  assert.deepEqual(doc('từ 5 triệu'), [5000000]);
  assert.deepEqual(doc('chi phí 5tr'), [5000000]);
  assert.deepEqual(doc('phí 600.000đ'), [600000]);
  assert.deepEqual(doc('giá 5.000.000đ'), [5000000]);
  assert.deepEqual(doc('giảm còn 150k'), [150000]);
  assert.deepEqual(doc('trị giá 400.000đ'), [400000]);
  assert.deepEqual(doc('giá 1,5 triệu'), [1500000]);
  // không phải tiền:
  assert.deepEqual(doc('60 tuổi'), []);
  assert.deepEqual(doc('3 km'), []);
  assert.deepEqual(doc('5 khớp'), []);
  assert.deepEqual(doc('0962 349 329'), []);
  assert.deepEqual(doc('ngày 06.09.2026'), []);
  assert.deepEqual(doc('hơn 1.000 bệnh nhân'), []); // không có ngữ cảnh giá
});

// ===========================================================================
// CHỮ "TỪ" — giá thủ thuật bỏ chữ "từ" là nói cứng ⇒ khách thấy hớ tại quầy
// ===========================================================================
test('THIẾU "TỪ" — cổng chèn lại, không chặn oan', () => {
  const ca = [
    ['Tiêm HA 5 triệu một mũi ạ.', 'từ 5 triệu'],
    ['Tiêm dịch nhờn đúng 5 triệu ạ.', 'từ 5 triệu'],
    ['Tiêm cấp tính 600.000đ ạ.', 'từ 600.000đ'],
    ['PRP chỉ 5 triệu thôi ạ.', 'từ 5 triệu'],
  ];
  for (const [t, mong] of ca) {
    const kq = ra(t);
    assert.ok(coLoai(kq, 'thieu_tu'), `phải bắt thiếu "từ": "${t}"`);
    assert.ok(raChu(kq).includes(mong), `phải chèn lại "${mong}", nhận: ${raChu(kq)}`);
    assert.ok(!/(đúng|chỉ)\s+từ/i.test(raChu(kq)), `câu đọc phải trôi, nhận: ${raChu(kq)}`);
  }
});

test('THIẾU "TỪ" — KHÔNG bắt oan câu đã đúng, và 300k thì không cần "từ"', () => {
  sach('Tiêm dịch nhờn từ 5 triệu ạ.');
  sach('Chi phí khoảng 5 triệu trở lên ạ.');
  sach('Khám + siêu âm là 300k ạ.');          // 300k CỐ Ý không có chữ "từ"
  sach('Giá khám 300.000đ ạ, không phát sinh thêm ạ.');
});

// ===========================================================================
// ƯU ĐÃI — chỉ 2 khoản đã duyệt
// ===========================================================================
test('ƯU ĐÃI BỊA — CÔNG KHAI chặn mọi khoản ngoài 2 khoản đã duyệt', () => {
  const ca = [
    'Bên em tặng thêm gói chụp X-quang miễn phí ạ.',
    'Đi 2 người thì được giảm thêm 10% ạ.',
    'Bên em đang có combo trọn gói ưu đãi cho khách quen ạ.',
    'Em tặng mình một voucher giảm giá cho lần sau ạ.',
  ];
  for (const t of ca) {
    const kq = ra(t, { congKhai: true }); // inbox thả (chốt 08/09), chỉ công khai mới siết
    assert.ok(coLoai(kq, 'uu_dai_bia'), `CÔNG KHAI phải chặn ưu đãi bịa: "${t}"`);
    assert.ok(!kq.oCuoi.includes(t));
  }
});

test('ƯU ĐÃI THẬT — 2 khoản đã duyệt đi qua, và câu "giữ suất ưu đãi" không bị chặn oan', () => {
  sach('Mình có thẻ BHYT thì được giảm 50% phí khám, còn 150k thôi ạ.');
  sach('Em tặng mình 1 lần điện xung trị liệu trị giá 400.000đ ạ.');
  // Câu kịch bản đã duyệt (luật ⑥) — có chữ "ưu đãi" nhưng KHÔNG hứa món lợi mới.
  sach('Em giữ suất ưu đãi này cho mình nha, mình cho em xin số để bên em book lịch ạ.');
  sach('Mình có thẻ BHYT không ạ? Hay mình trên 60 tuổi ạ?');
  sach('Mình nhớ đem theo thẻ BHYT nha, đưa ở quầy là được áp liền ạ.');
});

// ===========================================================================
// KHAN HIẾM / HẠN CHÓT BỊA — 2 ưu đãi này KHÔNG có hạn thời gian
// ===========================================================================
test('KHAN HIẾM BỊA — bị gỡ khỏi câu', () => {
  const ca = [
    'Ưu đãi này chỉ còn 2 suất thôi mình ơi, mình đăng ký sớm nha ạ.',
    'Mình đặt lịch hôm nay đi ạ, ưu đãi đến hết ngày mai thôi ạ.',
    'Chương trình này số lượng có hạn, mình cân nhắc giúp em nha ạ.',
    'Còn 3 slot cuối cùng cho tuần này thôi ạ, mình sắp xếp giúp em nha.',
  ];
  for (const t of ca) {
    const kq = ra(t);
    assert.ok(coLoai(kq, 'khan_hiem_bia') || coLoai(kq, 'cau_vun_sau_sua'),
      `phải bắt khan hiếm bịa: "${t}" → ${JSON.stringify(loai(kq))}`);
    const sau = boDau(raChu(kq));
    assert.ok(!/con \d+ suat|slot cuoi|so luong co han|den het ngay/.test(sau),
      `còn dấu khan hiếm: ${raChu(kq)}`);
  }
});

test('KHAN HIẾM — không bắt oan câu hẹn lịch bình thường', () => {
  sach('Mình sắp xếp qua khám buổi sáng hay buổi chiều tiện hơn ạ?');
  sach('Hôm nay phòng khám mở tới 20h ạ, mình qua lúc nào cũng được ạ.');
  sach('Mình cho em xin số, trợ lý Bác sĩ gọi xác nhận giờ giúp mình nha ạ.');
});

// ===========================================================================
// CHẶN SẠCH → KHÔNG BAO GIỜ ĐỂ BOT CÂM
// ===========================================================================
test('chặn sạch cả lượt thì phải THAY bằng câu an toàn (bot không được im)', () => {
  // INBOX (thayCauAnToan mặc định) — giá BỊA (ngoài bảng giá thật) bị chặn cứng mọi làn;
  // chặn sạch ô → cổng phải thay 1 câu an toàn thay vì để bot im.
  const kq = ganhCong(['Gói này 2.750.000đ ạ.']);
  assert.equal(kq.oCuoi.length, 1, 'phải có đúng 1 ô thay thế');
  assert.ok(kq.oCuoi[0].length > 20, 'ô thay thế phải là câu thật');
  assert.ok(coLoai(kq, 'thay_cau_an_toan'));
});

test('câu an toàn XOAY VÒNG theo phút — 2 lượt liên tiếp không trùng nguyên văn', () => {
  // Trùng nguyên văn sẽ bị cửa lọc chống-lặp ở handler.js xoá sạch → bot im hẳn (bệnh 20/07).
  const a = cauAnToan(0);
  const b = cauAnToan(60000);
  assert.notEqual(a, b);
});

test('chế độ CÔNG KHAI: chặn sạch thì trả MẢNG RỖNG (thà không rep còn hơn để lại chữ)', () => {
  const kq = ganhCong(['Tiêm dịch nhờn từ 5 triệu ạ.'], { congKhai: true });
  assert.ok(coLoai(kq, 'gia_noi_cong_khai'), 'giá thủ thuật ở nơi công khai = nhóm cấm (B)');
  assert.equal(kq.oCuoi.length, 0, 'công khai thì KHÔNG thay câu an toàn');
});

test('chế độ CÔNG KHAI — điện xung (nhóm A, Sở chưa duyệt) bị chặn dù inbox thì được', () => {
  const t = 'Em tặng mình 1 lần điện xung trị liệu trị giá 400.000đ ạ.';
  sach(t);                                              // inbox: ĐƯỢC
  const ck = ganhCong([t], { congKhai: true });         // công khai: CẤM
  assert.ok(ck.viPham.length > 0);
  assert.equal(ck.oCuoi.length, 0);
});

test('CÔNG KHAI — giá khám 300k vẫn được nói (không phải thủ thuật)', () => {
  const kq = ganhCong(['Phí khám chuyên khoa là 300.000đ ạ.'], { congKhai: true });
  assert.deepEqual(kq.viPham, []);
  assert.equal(kq.oCuoi.length, 1);
});

// ===========================================================================
// Ô TIN DỊ DẠNG — rỗng / quá dài / HTML / kiểu sai. Cổng KHÔNG được vỡ.
// ===========================================================================
test('ô tin dị dạng — không vỡ, không ném', () => {
  assert.deepEqual(ganhCong([]).oCuoi, []);
  assert.deepEqual(ganhCong(null).oCuoi, []);
  assert.deepEqual(ganhCong(undefined).oCuoi, []);
  assert.deepEqual(ganhCong(['', '   ', '\n']).oCuoi, []);
  assert.deepEqual(ganhCong([null, undefined, 'Dạ em nghe ạ.']).oCuoi, ['Dạ em nghe ạ.']);
  // chuỗi rất dài
  const dai = 'Dạ mình đau vai lâu chưa ạ? '.repeat(400);
  assert.doesNotThrow(() => ganhCong([dai]));
  assert.ok(ganhCong([dai]).oCuoi.length === 1);
  // HTML
  const html = '<div>Bên em <b>cam kết</b> khỏi hẳn ạ.<br/></div>';
  const kq = ganhCong([html]);
  assert.ok(coLoai(kq, 'hua_ket_qua'), 'phải soi được qua thẻ HTML');
  // kiểu sai
  assert.doesNotThrow(() => ganhCong([{ a: 1 }, 42, true, 'Dạ ạ.']));
  assert.doesNotThrow(() => ganhCong('một chuỗi trần không phải mảng'));
});

test('ganhCong là HÀM THUẦN — không đổi mảng đầu vào', () => {
  const vao = ['Bên em cam kết khỏi hẳn ạ.', 'Dạ ạ.'];
  const chup = vao.slice();
  ganhCong(vao);
  assert.deepEqual(vao, chup, 'mảng đầu vào phải nguyên vẹn');
});

test('ô sạch đi qua thì daSua = false và chữ y nguyên', () => {
  const vao = ['Dạ mình đau gối bên nào ạ?', 'Khám + siêu âm là 300k ạ.'];
  const kq = ganhCong(vao);
  assert.equal(kq.daSua, false);
  assert.deepEqual(kq.oCuoi, vao);
  assert.deepEqual(kq.viPham, []);
});

// ===========================================================================
// FAIL-SAFE + SỔ ĐẾM
// ===========================================================================
test('FAIL-SAFE — cổng ném lỗi thì tin vẫn đi qua, không làm bot câm', () => {
  // Ép lỗi: mảng có phần tử mà .toString() ném.
  const acQuy = { toString() { throw new Error('ép lỗi'); } };
  const kq = ganhCong([acQuy, 'Dạ em nghe mình ạ.']);
  assert.equal(kq.loi !== null || kq.oCuoi.length >= 1, true);
  assert.doesNotThrow(() => ganhCong([acQuy]));
});

test('sổ đếm — đếm được số ô sửa / ô chặn', () => {
  resetThongKe();
  ganhCong(['Bên em cam kết khỏi hẳn ạ.']);   // sửa
  ganhCong(['Liệu trình 3 mũi tầm 15 triệu ạ.']); // chặn
  const tk = thongKe();
  assert.ok(tk.tongLuot >= 2);
  assert.ok(tk.oSua >= 1, 'phải đếm được ô sửa');
  assert.ok(tk.oChan >= 1, 'phải đếm được ô chặn');
  assert.ok(Object.keys(tk.theoLoai).some((k) => k.startsWith('hua_ket_qua')));
  resetThongKe();
});

test('bảng giá trong cổng phải khớp gia-va-uu-dai.md', () => {
  assert.equal(GIA_THAT.KHAM, 300000);
  assert.equal(GIA_THAT.HA, 5000000);
  assert.equal(GIA_THAT.PRP, 5000000);
  assert.equal(GIA_THAT.CORTICOID, 600000);
  assert.equal(GIA_THAT.KHAM_UU_DAI, 150000);
  assert.equal(GIA_THAT.DIEN_XUNG, 400000);
});

test('reMem — chịu dấu, chịu hoa thường, không ăn lan sang từ khác', () => {
  assert.ok(reMem('khỏi hẳn').test('nói KHOI HAN được không'));   // bỏ dấu
  assert.ok(reMem('khỏi hẳn').test('kh.ỏi hẳn'));                  // ký tự né
  assert.ok(!reMem('cam kết').test('camXket'));                    // chữ cái không được chen
  assert.ok(!reMem('dứt điểm').test('dứt điểmm'));                 // không dính vào giữa từ khác
});

// ─────────────────────────────────────────────────────────────────────────────
// VÁ 06/09/2026 19:45 — HAI CA CHẶN OAN THẬT, Sếp Trình bắt tại trận trên Telegram.
// Cổng vừa deploy lúc 19:31 thì 19:35–19:36 đã chặn nhầm 2 ô mà bot nói ĐÚNG.
// Đây là bài học "cổng mới nuốt chính cái não nó phải bảo vệ" — cùng họ với cổng DMKT
// cũ nuốt bảng giá mới. Giữ 2 test này VĨNH VIỄN để không tái phát.
// ─────────────────────────────────────────────────────────────────────────────
test('CHẶN OAN 1: "tư vấn miễn phí" KHÔNG phải ưu đãi bịa', () => {
  const o = ganhCong(['Dạ tình trạng của mình nên được Bác sĩ xem kỹ để tư vấn đúng hướng ạ, '
    + 'mình để lại số để Bác sĩ gọi tư vấn miễn phí nha 🙏']);
  assert.equal(o.viPham.filter((v) => v.loai === 'uu_dai_bia').length, 0,
    'câu xin số kèm "gọi tư vấn miễn phí" phải ĐI QUA — nó nằm sẵn 9 chỗ trong system-prompt');
  assert.equal(o.oCuoi.length, 1, 'không được nuốt ô');
});

test('CHẶN OAN 2: giá neo 1.300.000đ là giá gốc HỢP LỆ', () => {
  const o = ganhCong(['Còn gói khám chuyên khoa + siêu âm tầm soát thì 300.000đ thôi ạ '
    + '(giá gốc 1.300.000đ).']);
  assert.equal(o.viPham.filter((v) => v.loai === 'gia_bia').length, 0,
    '1.300.000đ là giá neo chính thức, có ở 4 chỗ trong system-prompt');
  assert.equal(o.oCuoi.length, 1, 'không được nuốt ô');
});

test('CÔNG KHAI vẫn CHẶN ưu đãi bịa (nơi Sở thấy)', () => {
  const o = ganhCong(['Bên em đang giảm thêm 20% cho khách mới ạ, tặng luôn 1 buổi massage.'], { congKhai: true });
  assert.ok(o.viPham.some((v) => v.loai === 'uu_dai_bia'),
    'ưu đãi ngoài 2 khoản duyệt ở CÔNG KHAI vẫn phải bị chặn');
});

test('INBOX thả ưu đãi thoải mái (anh Trình chốt 08/09)', () => {
  const o = ganhCong(['Bên em đang giảm thêm 20% cho khách mới ạ, tặng luôn 1 buổi massage.']); // congKhai=false
  assert.equal(o.viPham.filter((v) => v.loai === 'uu_dai_bia').length, 0,
    'inbox cho ưu đãi/tặng/khuyến mãi thoải mái, không chặn');
  assert.equal(o.oCuoi.length, 1, 'không được nuốt ô');
});

test('CHẶN OAN 3: mời follow OA tặng cẩm nang (kiến thức, không phải ưu đãi tiền)', () => {
  const cau = 'Nếu mình cần thêm cẩm nang về thoái hóa khớp gối và lưng, mình quan tâm Zalo OA '
    + 'của phòng khám để em gửi tặng mình trọn bộ nha: https://zalo.me/3136814239074246132';
  // kể cả ở làn CÔNG KHAI, tặng TÀI LIỆU KIẾN THỨC vẫn hợp lệ (không phải ưu đãi dịch vụ/tiền)
  const o = ganhCong([cau], { congKhai: true });
  assert.equal(o.viPham.filter((v) => v.loai === 'uu_dai_bia').length, 0,
    'tặng cẩm nang là nội dung kiến thức miễn phí kéo follow OA, không được chặn');
  assert.equal(o.oCuoi.length, 1, 'không được nuốt ô mời follow OA');
});

test('vẫn CHẶN giá bịa thật (không nới quá tay)', () => {
  const o = ganhCong(['Gói này bên em 2.750.000đ thôi ạ.']);
  assert.ok(o.viPham.some((v) => v.loai === 'gia_bia'),
    'con số ngoài bảng giá vẫn phải bị chặn');
});
