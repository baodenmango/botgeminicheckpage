// ĐƯỜNG GỬI — cổng gác phải nằm ở ĐIỂM CUỐI, và trần ô/trần ký tự vẫn đúng sau khi qua cổng.
//
// Hai loại thước ở đây:
//   1. HÀNH VI — capBubbles (trần 3 ô + trần 420 ký tự/lượt) còn đúng sau khi cổng gác sửa chữ.
//   2. CHỐNG THÁO — quét mã nguồn, bắt buộc mỗi đường gửi phải có lời gọi cổng. Ai gỡ dây nối
//      thì test đỏ ngay, chứ không phải phát hiện bằng một câu lọt ra tới bệnh nhân thật.
//      (Không thể test hành vi thật của sendMessages vì nó gọi API Pancake ra ngoài.)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOC = path.join(__dirname, '..');

// store.js mở SQLite ngay lúc nạp module → trỏ vào file tạm, TUYỆT ĐỐI không đụng data/bot.sqlite thật.
const tamDB = fs.mkdtempSync(path.join(os.tmpdir(), 'conggac-db-'));
process.env.DB_PATH = path.join(tamDB, 'test.sqlite');

const { capBubbles } = await import('../src/pancake.js');
const { ganhCong } = await import('../src/conggac.js');

const doc = (f) => fs.readFileSync(path.join(GOC, 'src', f), 'utf8');

// ---------------------------------------------------------------------------
// 1. TRẦN Ô + TRẦN KÝ TỰ (luật lớp 1) vẫn đúng sau khi qua cổng
// ---------------------------------------------------------------------------
test('trần 3 ô/lượt — gộp chứ không rơi ý', () => {
  const vao = ['một', 'hai', 'ba', 'bốn', 'năm'];
  const ra = capBubbles(vao);
  assert.ok(ra.length <= 3, `phải ≤3 ô, nhận ${ra.length}`);
  assert.ok(ra.join('\n').includes('năm'), 'ô thừa phải được GỘP, không được vứt');
});

test('trần 420 ký tự/lượt — cắt theo Ô, không cắt giữa câu', () => {
  const o = 'Dạ mình đau vai bên nào và đau bao lâu rồi ạ, em hỏi để báo Bác sĩ giúp mình nha. ';
  const ra = capBubbles([o, o, o, o, o, o]);
  const tong = ra.reduce((a, m) => a + m.length, 0);
  assert.ok(ra.length <= 3);
  // Không được có ô nào bị chặt cụt giữa chừng (dấu hiệu: kết thúc bằng '…' do cắt thô).
  for (const m of ra) assert.ok(!/…$/.test(m) || m.length > 100, 'không được cắt cụt giữa câu');
  assert.ok(tong > 0);
});

test('ô link luôn được giữ và đứng riêng (để bung preview)', () => {
  const ra = capBubbles(['a', 'b', 'c', 'd', 'https://phongkhamhieploi.vn/cam-nang']);
  assert.ok(ra.length <= 3);
  assert.ok(ra.some((m) => m.includes('https://')), 'ô link không được rơi mất');
});

test('cổng gác → capBubbles: nối hai lớp vẫn ra kết quả hợp lệ', () => {
  const vao = [
    'Bên em cam kết chữa khỏi hẳn ạ.',
    'Liệu trình 3 mũi tầm 15 triệu ạ.',     // sẽ bị CHẶN
    'Tiêm dịch nhờn từ 5 triệu ạ.',
    'Khám + siêu âm 300k ạ.',
    'Mình cho em xin số nha ạ.',
  ];
  const quaCong = ganhCong(vao).oCuoi;
  const cuoi = capBubbles(quaCong);
  assert.ok(cuoi.length >= 1, 'không bao giờ được ra lượt rỗng');
  assert.ok(cuoi.length <= 3, 'trần ô vẫn phải đúng sau cổng');
  const chu = cuoi.join(' ');
  // 09/09: inbox chỉ còn soi bậc CỨNG ("cam kết") — "khỏi hẳn" là giọng tư vấn thường, được thả.
  assert.ok(!/cam kết/i.test(chu), 'lời cam kết cứng không được lọt qua 2 lớp');
  assert.ok(!/15 triệu/.test(chu), 'giá bịa không được lọt qua 2 lớp');
});

test('capBubbles chịu được đầu vào dị dạng', () => {
  assert.deepEqual(capBubbles([]), []);
  assert.deepEqual(capBubbles(null), []);
  assert.deepEqual(capBubbles(['', '  ']), []);
  assert.doesNotThrow(() => capBubbles(['<div>a</div>', 'b'.repeat(5000)]));
});

// ---------------------------------------------------------------------------
// 2. CHỐNG THÁO DÂY — mọi đường ra ngoài phải đi qua cổng
// ---------------------------------------------------------------------------
test('pancake.js — cả 3 đường gửi đều gọi cổng gác', () => {
  const s = doc('pancake.js');
  assert.match(s, /from '\.\/conggac\.js'/, 'pancake.js phải import cổng gác');

  // Cắt thân từng hàm để chắc chắn lời gọi nằm ĐÚNG trong hàm đó, không phải ở đâu khác.
  const than = (ten) => {
    const i = s.indexOf(`export async function ${ten}(`);
    assert.ok(i > 0, `không tìm thấy hàm ${ten}`);
    return s.slice(i, i + 2500);
  };
  assert.match(than('sendMessages'), /locTruocKhiGui\(/, 'sendMessages phải qua cổng');
  assert.match(than('sendPrivateReply'), /locTruocKhiGui\(/, 'sendPrivateReply phải qua cổng');
  // replyComment = COMMENT CÔNG KHAI → bắt buộc chế độ congKhai.
  assert.match(than('replyComment'), /locMotO\([\s\S]{0,200}congKhai:\s*true/, 'replyComment phải bật congKhai');
});

test('zalo.js — sendText (điểm cuối của kênh Zalo OpenAPI) gọi cổng gác', () => {
  const s = doc('zalo.js');
  assert.match(s, /from '\.\/conggac\.js'/, 'zalo.js phải import cổng gác');
  const i = s.indexOf('export async function sendText(');
  assert.ok(i > 0);
  const than = s.slice(i, i + 1600);
  assert.match(than, /locMotO\(/, 'sendText phải qua cổng');
  // Ghi sổ chống-echo phải dùng chữ ĐÃ QUA CỔNG, không phải chữ gốc — ghi lệch thì echo dội về
  // không khớp → handler tưởng telesale gõ tay → bot tự khoá 6h (ca Loan Le 07/07).
  assert.match(than, /noteBotSent\(cid,\s*textSach\)/, 'sổ echo phải ghi chữ đã qua cổng');
});

test('cổng gác không kéo theo vòng import (chỉ nạp module chuẩn của Node)', () => {
  const s = doc('conggac.js');
  const importTinh = [...s.matchAll(/^import .*from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(importTinh, [], 'conggac.js phải KHÔNG có import tĩnh nào (telegram nạp động)');
  assert.match(s, /await import\('\.\/telegram\.js'\)/, 'telegram phải được nạp động');
});

test('mọi caller của sendTexts đều đi qua sendText (đã có cổng)', () => {
  const s = doc('zalo.js');
  const i = s.indexOf('export async function sendTexts(');
  assert.ok(i > 0);
  assert.match(s.slice(i, i + 900), /await sendText\(/, 'sendTexts phải gọi lại sendText');
});

test.after(() => fs.rmSync(tamDB, { recursive: true, force: true }));
