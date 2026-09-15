// PHAO CÓ MẮT — vá 15/09/2026 chiều (ca Âu Chung Tình):
//   Khách ĐÃ cho SĐT + đã kể "khớp vai, hơn 1 tháng, nằm nghiêng không được"; một lượt gửi hụt
//   (token trang bị xoay) → rescue vớt → mọi ô trùng → phao thả lần lượt "khó chịu nhất ở chỗ
//   nào?" rồi "bị lâu chưa?" — hỏi lại đúng 2 ý khách vừa trả lời. Lời anh Trình: "hỏi lại đúng
//   ý người ta đã trả lời, làm tụt mood ghê gớm".
// Test 2 lớp mắt:
//   ① đã có SĐT → phao = 1 câu CHỐT duy nhất, không bao giờ là câu hỏi-bệnh; chốt rồi → null.
//   ② chưa có SĐT → câu khách đã tự trả lời ý đó thì bỏ, nhảy sang câu sau.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tamDB = fs.mkdtempSync(path.join(os.tmpdir(), 'phao-db-'));
process.env.DB_PATH = path.join(tamDB, 'test.sqlite');

const { thaPhao } = await import('../src/handler.js');
const store = await import('../src/store.js');

let dem = 0;
function convMoi({ captured = false, history = [] } = {}) {
  const id = `test_phao_${++dem}`;
  store.ensureConversation(id, 'test_page', 'Test');
  for (const h of history) store.appendHistory(id, h.role, h.text);
  if (captured) store.setPhoneCaptured(id, '0379908491', 'Test');
  return { id, conv: store.getConversation(id) };
}

// ── ① ĐÃ CÓ SĐT ─────────────────────────────────────────────────────────────
test('đã có SĐT → phao là câu CHỐT, không phải câu hỏi-bệnh', () => {
  const { id, conv } = convMoi({
    captured: true,
    history: [
      { role: 'user', text: 'Dạ e khó chịu nhất ở khớp vai ạ' },
      { role: 'model', text: 'Dạ em ghi nhận ạ' },
      { role: 'user', text: '0379908491' },
    ],
  });
  const phao = thaPhao(id, store.getConversation(id));
  assert.ok(phao, 'phải có phao (chưa gửi câu chốt lần nào)');
  assert.ok(!/khó chịu nhất ở chỗ nào|bị lâu chưa|khó ngủ hay khó đi lại/.test(phao),
    `phao ca đã-có-số KHÔNG được là câu hỏi bệnh, nhận: "${phao}"`);
  assert.ok(/trợ lý/.test(phao), 'phao phải là câu chốt nhắc trợ lý sẽ gọi');
  void conv;
});

test('đã có SĐT + câu chốt đã gửi rồi → null (im, không lặp)', () => {
  const { id } = convMoi({
    captured: true,
    history: [
      { role: 'user', text: 'ok ạ' },
      { role: 'model', text: 'Dạ em ghi nhận hết thông tin rồi nha, trợ lý Bác sĩ sẽ gọi xác nhận giờ khám cho mình sớm nhất ạ. Mình cần hỏi gì thêm cứ nhắn em nha 😊' },
    ],
  });
  assert.equal(thaPhao(id, store.getConversation(id)), null);
});

// ── ② CHƯA CÓ SĐT — khách đã trả lời ý nào thì bỏ câu đó ────────────────────
test('khách đã kể "khớp vai" + "hơn 1 tháng" + "nằm nghiêng ko được" → phao nhảy tới câu [3]', () => {
  // Phát lại đúng ca Âu Chung Tình trước lúc cho số:
  const { id } = convMoi({
    history: [
      { role: 'user', text: 'Dạ e khó chịu nhất ở khớp vai ạ,' },
      { role: 'user', text: 'Dạ 1 tháng hơn rồi bác' },
      { role: 'user', text: 'Dạ có bác, nằm nghiêng ko được, rất khó chịu ạ,' },
    ],
  });
  const phao = thaPhao(id, store.getConversation(id));
  assert.ok(phao, 'vẫn phải có phao (câu mở chung luôn được phép)');
  assert.match(phao, /còn thắc mắc gì/, `phải nhảy tới câu mở chung, nhận: "${phao}"`);
});

test('khách chỉ mới kể vùng đau → bỏ câu [0], được hỏi "bị lâu chưa"', () => {
  const { id } = convMoi({ history: [{ role: 'user', text: 'dạo này đau gối quá bác ơi' }] });
  const phao = thaPhao(id, store.getConversation(id));
  assert.match(phao, /bị lâu chưa/, `nhận: "${phao}"`);
});

test('khách chưa kể gì → phao câu [0] như cũ (không bắt oan)', () => {
  const { id } = convMoi({ history: [{ role: 'user', text: 'cho hỏi có làm việc chủ nhật không' }] });
  const phao = thaPhao(id, store.getConversation(id));
  assert.match(phao, /khó chịu nhất ở chỗ nào/, `nhận: "${phao}"`);
});

test('từ đơn phổ biến ("có", "vài hôm nữa ghé") KHÔNG bị bắt oan là đã-kể-bệnh', () => {
  const { id } = convMoi({ history: [{ role: 'user', text: 'Dạ có, vài hôm nữa mình ghé được không' }] });
  const phao = thaPhao(id, store.getConversation(id));
  assert.match(phao, /khó chịu nhất ở chỗ nào/, `"có"/"vài" không được tính là kể bệnh, nhận: "${phao}"`);
});
