// ===== TEST LỚP PHÊ DUYỆT (kiến trúc 2 lớp 15/09/2026) — mock model, KHÔNG gọi mạng =====
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-pheduyet-')), 'test.db');
const { pheDuyetYDinh } = await import('../src/pheduyet.js');

const CA = {
  loai: 'xin_ngung',
  cauNghi: 'Dạ khớp vai và gối nữa ạ',
  tinGanNhat: [
    { role: 'user', text: 'Tôi bị triệu chứng như bác nói ở trên' },
    { role: 'user', text: 'Tôi ở xa thì phải làm sao ạ' },
    { role: 'model', text: 'Dạ chào mình ạ, mình đang gặp vấn đề ở khớp gối, lưng hay vai ạ?' },
    { role: 'user', text: 'Dạ khớp vai và gối nữa ạ' },
  ],
  tenKhach: 'Lương Tờ Rình CR',
};

test('model trả xac_nhan=false → KHÔNG hành động, không degraded', async () => {
  const kq = await pheDuyetYDinh(CA, async () => '{"xac_nhan": false, "ly_do": "khách đang kể bệnh thêm khớp gối"}');
  assert.equal(kq.xacNhan, false);
  assert.equal(kq.degraded, false);
  assert.ok(kq.lyDo.includes('kể bệnh'));
});

test('model trả xac_nhan=true → xác nhận hành động', async () => {
  const kq = await pheDuyetYDinh(
    { ...CA, cauNghi: 'đừng nhắn cho tôi nữa', tinGanNhat: [{ role: 'user', text: 'đừng nhắn cho tôi nữa' }] },
    async () => '{"xac_nhan": true, "ly_do": "khách yêu cầu ngừng rõ ràng"}');
  assert.equal(kq.xacNhan, true);
  assert.equal(kq.degraded, false);
});

test('model timeout/lỗi cả 2 lần → degraded=true + xacNhan=false (không hành động vĩnh viễn)', async () => {
  const kq = await pheDuyetYDinh(CA, async () => { throw new Error('503 overloaded'); });
  assert.equal(kq.xacNhan, false);
  assert.equal(kq.degraded, true);
});

test('model trả JSON rác → degraded', async () => {
  const kq = await pheDuyetYDinh(CA, async () => 'xin chào tôi là model tôi không biết JSON');
  assert.equal(kq.degraded, true);
  assert.equal(kq.xacNhan, false);
});

test('model bọc ```json``` + chữ thừa → vẫn đọc được', async () => {
  const kq = await pheDuyetYDinh(CA, async () => 'Đây ạ:\n```json\n{"xac_nhan": false, "ly_do": "kể bệnh"}\n```');
  assert.equal(kq.degraded, false);
  assert.equal(kq.xacNhan, false);
});

test('cầu dao BOT_2LOP_PHE_DUYET=0 → trả xacNhan=true không gọi model (hành vi cũ)', async () => {
  process.env.BOT_2LOP_PHE_DUYET = '0';
  let daGoi = false;
  const kq = await pheDuyetYDinh(CA, async () => { daGoi = true; return '{"xac_nhan": false}'; });
  delete process.env.BOT_2LOP_PHE_DUYET;
  assert.equal(kq.xacNhan, true);
  assert.equal(daGoi, false, 'cầu dao tắt thì không được gọi model');
});

test('loại nghi vấn lạ → degraded, không nổ', async () => {
  const kq = await pheDuyetYDinh({ loai: 'khong_ton_tai', cauNghi: 'x', tinGanNhat: [] }, async () => '{}');
  assert.equal(kq.degraded, true);
});
