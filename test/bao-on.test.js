// KHÁCH BÁO ỔN + PHAO TRẦN + "ĐỪNG HỎI" — vá 13/09/2026 (ca Hue Pham):
//   Khách nói "ổn định rồi không đau chỗ nào hết" + "không sao đâu" ~10 lần cả ngày,
//   bot vẫn đeo bám hỏi bệnh, phao trung tính lặp nguyên văn 3 lần, chạm 3+4 bắn thêm
//   → khách gọi bot là "anh bạn" (lộ máy hoàn toàn).
//
// Test 2 chiều — chỗ dễ vá lệch nhất:
//   ① Tin báo-ổn thuần → PHẢI BẮT (để đếm bậc thang).
//   ② Tin kể bệnh / còn hỏi / còn nhu cầu → PHẢI THẢ (bắt oan là đuổi lead).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tamDB = fs.mkdtempSync(path.join(os.tmpdir(), 'baoon-db-'));
process.env.DB_PATH = path.join(tamDB, 'test.sqlite');

const { laTinBaoOn, laTinXinNgung } = await import('../src/handler.js');

// ① PHẢI BẮT — khách chốt "tôi ổn, không có nhu cầu"
const BAO_ON_PHAI_BAT = [
  'Không sao',                                  // ca thật Hue Pham
  'Không sao nữa đâu',
  'Không sao đâu bạn ạ',
  'Ổn định rồi không đau chỗ nào hết',          // ca thật 10:22
  'Không bệnh gì cả',
  'Không không có gì đâu',
  'hết đau rồi nha',
  'khỏe rồi em ơi',
  'đỡ nhiều rồi',
  'không có nhu cầu đâu',
];

// ② PHẢI THẢ — còn kể bệnh / còn hỏi / phủ định khác nghĩa
const BAO_ON_PHAI_THA = [
  'tôi bị tê tay nhờ bs tư vấn giúp',
  'không đau lắm nhưng đi lại thấy vướng vướng khó chịu ở gối',  // kể bệnh, dài
  'không sao chứ ạ? tiêm xong có bị gì không?',                   // đang HỎI
  'đỡ rồi nhưng muốn khám lại cho chắc',                           // còn nhu cầu khám
  'giá bao nhiêu vậy em',
  'không biết có nên tiêm không',                                  // phân vân ≠ báo ổn
  'chưa đỡ, vẫn còn đau lắm',
];

test('BẮT tin báo-ổn thuần — để đếm bậc thang, không đeo bám', () => {
  for (const cau of BAO_ON_PHAI_BAT) {
    assert.equal(laTinBaoOn(cau), true, `thả lọt tin báo ổn: "${cau}"`);
  }
});

test('THẢ tin còn nhu cầu / kể bệnh — bắt oan là đuổi lead', () => {
  for (const cau of BAO_ON_PHAI_THA) {
    assert.equal(laTinBaoOn(cau), false, `bắt oan: "${cau}"`);
  }
});

test('XIN NGỪNG bắt được "đừng hỏi" (ca thật 15:59) nhưng thả "thôi hỏi giúp" (nhờ relay)', () => {
  assert.equal(laTinXinNgung('Đã nói đừng hỏi bác sĩ được không'), true);
  assert.equal(laTinXinNgung('Ừ thì đừng hỏi bác sĩ là tốt cho chị'), true);
  assert.equal(laTinXinNgung('khỏi hỏi bác sĩ nữa em ơi'), true);
  assert.equal(laTinXinNgung('Thôi hỏi bác sĩ giúp em nha'), false, '"thôi hỏi... giúp" là NHỜ, không phải xin ngừng');
  assert.equal(laTinXinNgung('cho em hỏi giá khám bao nhiêu'), false);
  assert.equal(laTinXinNgung('em muốn hỏi về bệnh gout'), false);
});
