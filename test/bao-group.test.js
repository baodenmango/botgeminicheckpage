// GÁC CỬA GROUP TELESALE — anh Trình chốt 06/09/2026 20:59:
//   "Bỏ cái vụ báo lead ấm cho anh, BOT xin số tốt hơn người... tới người là có số chốt
//    khách thôi, hoặc là có gì cực kỳ khó, cực kỳ gấp thì mới báo group thôi."
//
// Test giữ 2 chiều — đây là chỗ dễ vá lệch nhất:
//   ① Tin CHƯA CÓ SỐ (lead ấm · muốn đặt lịch chưa số · khách ở xa) → PHẢI im.
//   ② Tin CÓ SỐ + CỰC KỲ KHÓ/GẤP (lead có SĐT · handover · nản liệu trình · đòi bác sĩ ·
//      opt-out · Gemini chết) → PHẢI CÒN NGUYÊN. Tắt nhầm mấy đường này là bỏ rơi bệnh nhân.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOC = path.join(__dirname, '..');
const tamDB = fs.mkdtempSync(path.join(os.tmpdir(), 'baogroup-db-'));
process.env.DB_PATH = path.join(tamDB, 'test.sqlite');

const nguonTelegram = fs.readFileSync(path.join(GOC, 'src/telegram.js'), 'utf8');
const nguonHandler = fs.readFileSync(path.join(GOC, 'src/handler.js'), 'utf8');
const nao = fs.readFileSync(path.join(GOC, 'system-prompt.md'), 'utf8');

// ── ① MẶC ĐỊNH PHẢI TẮT ────────────────────────────────────────────────────────
test('mặc định KHÔNG báo group khi khách chưa cho số', async () => {
  delete process.env.BAO_LEAD_CHUA_SO;
  const { baoLeadChuaSo } = await import('../src/telegram.js');
  assert.equal(baoLeadChuaSo(), false, 'thiếu env phải là TẮT, không phải mặc định bật');
});

test('bật lại được bằng env, không cần deploy', async () => {
  const { baoLeadChuaSo } = await import('../src/telegram.js');
  process.env.BAO_LEAD_CHUA_SO = '1';
  assert.equal(baoLeadChuaSo(), true);
  process.env.BAO_LEAD_CHUA_SO = '0';
  assert.equal(baoLeadChuaSo(), false);
  delete process.env.BAO_LEAD_CHUA_SO;
});

test('cổng nằm TRONG hàm gửi — không đường gọi nào lách được', () => {
  for (const ten of ['notifyLeadAm', 'notifyBooking']) {
    const i = nguonTelegram.indexOf(`export async function ${ten}(`);
    assert.ok(i > 0, `không thấy ${ten}`);
    const than = nguonTelegram.slice(i, i + 600);
    assert.match(than, /if \(!baoLeadChuaSo\(\)\) \{[\s\S]{0,220}?return;/,
      `${ten} phải tự chặn ở đầu hàm, đừng chỉ chặn ở nơi gọi`);
  }
});

test('tin "khách ở xa" cũng im — telesale không có số thì không gọi được ai', () => {
  assert.match(nguonHandler, /kv\.nhom === 'xa' && baoLeadChuaSo\(\)/);
});

// ── ② CÁC ĐƯỜNG PHẢI CÒN SỐNG ──────────────────────────────────────────────────
test('đường CÓ SỐ và đường CỰC KỲ KHÓ/GẤP không bị tắt lây', () => {
  const conSong = [
    ['notifyLead(',            'lead CÓ SĐT'],
    ['notifyHandover(',        'handover khiếu nại/hỏi sâu'],
    ['notifyHandoverNudge(',   'khách handover nhắn tiếp (có cờ KHẨN)'],
    ['BỆNH NHÂN NẢN LIỆU TRÌNH', 'nguy cơ bỏ ngang liệu trình'],
    ['KHÁCH YÊU CẦU HỎI/GẶP TRỰC TIẾP BÁC SĨ', 'khách đòi bác sĩ'],
    ['KHÁCH XIN NGỪNG NHẬN TIN', 'opt-out — ca mất khách'],
  ];
  for (const [dau, ten] of conSong) {
    assert.ok(nguonHandler.includes(dau), `ĐỨT đường báo "${ten}" — đây là loại tin anh Trình GIỮ`);
  }
  // và chúng KHÔNG được nằm sau cổng chưa-có-số
  const iLead = nguonHandler.indexOf('await notifyLead({');
  const truocLead = nguonHandler.slice(Math.max(0, iLead - 400), iLead);
  assert.ok(!truocLead.includes('baoLeadChuaSo()'), 'lead CÓ SỐ bị kẹp nhầm sau cổng chưa-có-số');
});

// ── ③ NÃO PHẢI KHỚP VỚI MÁY ────────────────────────────────────────────────────
test('não KHÔNG còn hứa "hệ thống sẽ tự báo telesale" (lời hứa đã thành sai)', () => {
  assert.ok(!/Hệ thống sẽ tự báo telesale/.test(nao),
    'não vẫn dạy bot rằng người sẽ vào gõ tay — trong khi tin đó đã tắt');
});

test('não có luật A.5: bot tự giữ khách + được xin số lần 2 khi có tín hiệu mua mới', () => {
  assert.match(nao, /KHÔNG CÒN AI VÀO GÕ TAY THAY EM/);
  assert.match(nao, /T[ÍI]N HI[ỆE]U MUA M[ỚO]I/);
  assert.match(nao, /2 l[ầa]n c[ảa] h[ộo]i tho[ạa]i/);
  assert.match(nao, /c[ấa]m 2 l[ưu][ợo]t li[êe]n ti[ếe]p/i);
});
