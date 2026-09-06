// Bộ đọc JSON model trả về (src/gemini.js → docJsonModel).
//
// Vì sao đáng test riêng: Gemini được ép `responseMimeType: 'application/json'` nhưng vẫn có
// ngày trả kèm chữ thừa, bọc ```json, hoặc bị CẮT GIỮA CHỪNG khi đụng maxOutputTokens.
// Parser ném ở đây = cả lượt trả lời chết. Hợp đồng: KHÔNG BAO GIỜ NÉM, cùng lắm trả null
// để caller dùng CÂU TREO XOAY VÒNG (đường lui đã có sẵn từ vá 20/07).

import test from 'node:test';
import assert from 'node:assert/strict';
import { docJsonModel, viPhamDmkt } from '../src/gemini.js';

test('JSON chuẩn → đọc được', () => {
  const o = docJsonModel('{"messages":["Dạ em nghe ạ."],"phone":null}');
  assert.deepEqual(o.messages, ['Dạ em nghe ạ.']);
});

test('JSON bọc ```json hoặc kèm lời dẫn → vẫn bóc được', () => {
  const ca = [
    '```json\n{"messages":["a"]}\n```',
    'Đây là câu trả lời của tôi:\n{"messages":["a"]}\nHy vọng giúp được bạn.',
    '   \n\n{"messages":["a"]}   ',
    '{"messages":["a"]}\n\n(hết)',
  ];
  for (const t of ca) {
    const o = docJsonModel(t);
    assert.ok(o && Array.isArray(o.messages), `phải bóc được: ${JSON.stringify(t)}`);
    assert.deepEqual(o.messages, ['a']);
  }
});

test('JSON HỎNG / rỗng / null → trả null, TUYỆT ĐỐI không ném', () => {
  const ca = [
    '', '   ', null, undefined,
    '{"messages":["a"',                 // thiếu ngoặc đóng
    '{messages: [a]}',                  // không phải JSON
    'không có ngoặc nhọn nào ở đây',
    '{',
    '}',
    '{"a":}',
    '[1,2,3]',                          // mảng — không phải object
    '"chỉ là một chuỗi"',
    '42',
    'null',
  ];
  for (const t of ca) {
    assert.doesNotThrow(() => docJsonModel(t), `không được ném với: ${JSON.stringify(t)}`);
    assert.equal(docJsonModel(t), null, `phải trả null với: ${JSON.stringify(t)}`);
  }
});

test('JSON bị CẮT giữa chừng nhưng còn khối con hợp lệ → cứu được', () => {
  // Ca thật: maxOutputTokens cắt đuôi. Còn một object hoàn chỉnh phía trước thì dùng tạm
  // còn hơn vứt cả lượt.
  const t = '{"messages":["Dạ em nghe ạ."]} và phần sau bị cắt {"messages": ["b"';
  const o = docJsonModel(t);
  assert.ok(o && Array.isArray(o.messages));
});

test('không ném với đầu vào kiểu lạ', () => {
  for (const t of [{}, [], 0, false, NaN, Symbol.iterator ? 123 : 0]) {
    assert.doesNotThrow(() => docJsonModel(t));
  }
});

// ---------------------------------------------------------------------------
// CỔNG DMKT (viPhamDmkt) — sau bản vá 06/09 phải cho câu BẢNG GIÁ ĐÃ DUYỆT đi qua
// ---------------------------------------------------------------------------
test('cổng DMKT KHÔNG được xoá câu bảng giá đã duyệt (vá 06/09)', () => {
  // 5 câu này là câu mẫu ✅ ĐÚNG nằm trong chính `gia-va-uu-dai.md`.
  // Trước vá 06/09, cổng xoá sạch cả 5 → bot rơi nhánh degraded → khách hỏi giá nhận lại
  // "chờ em chút xíu" = đúng cơ chế đã mất khách thật ngày 01/09.
  const duocPhep = [
    'Chi phí tiêm dịch nhờn từ 5 triệu ạ.',
    'Tiêm PRP từ 5 triệu ạ, Bác sĩ khám xong mới báo chính xác.',
    'Tiêm cấp tính từ 600.000đ ạ.',
    'Khám chuyên khoa + siêu âm tầm soát là 300k trọn gói ạ.',
    'Em tặng mình 1 lần điện xung trị liệu trị giá 400.000đ ạ.',
  ];
  for (const t of duocPhep) {
    assert.equal(viPhamDmkt(t), null, `câu bảng giá đã duyệt bị chặn oan: "${t}"`);
  }
});

test('cổng DMKT VẪN chặn giá bịa và vẫn chặn chào bán (nhóm A)', () => {
  assert.equal(viPhamDmkt('Tiêm dịch nhờn 15 triệu một liệu trình ạ.'), 'bao_gia');
  assert.equal(viPhamDmkt('Tiêm PRP khoảng 8 triệu ạ.'), 'bao_gia');
  // (A) chào bán — cố ý KHÔNG nới, khung phạt nặng nhất.
  assert.equal(viPhamDmkt('Bên em có làm tiêm khớp ạ.'), 'chao_ban');
  assert.equal(viPhamDmkt('Phòng khám đang triển khai tiêm dịch nhờn ạ.'), 'chao_ban');
});

test('cổng DMKT không đụng câu chăm sóc sau điều trị', () => {
  assert.equal(viPhamDmkt('Sau mũi tiêm hôm trước mình đỡ hơn chưa ạ?'), null);
  assert.equal(viPhamDmkt('Mình nhớ tái khám đúng hẹn nha ạ.'), null);
});
