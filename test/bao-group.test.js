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

// ── ④ HANDOVER CÓ HẠN (vá 06/09 22:5x — ca Vi Thị Khánh Linh) ──────────────────
// Hai lỗi cùng chỗ: (a) tin 🔔 nhắn-tiếp là rác với group; (b) handover là án chung thân,
// khoá bot 19 ngày, khách bấm quảng cáo MỚI vẫn không ai trả lời.
const nguonStore = fs.readFileSync(path.join(GOC, 'src/store.js'), 'utf8');

test('tin 🔔 "khách đã giao người nhắn tiếp" CHỈ còn bắn khi có cờ KHẨN', () => {
  const i = nguonHandler.indexOf('if (store.isHandover(conv)) {');
  assert.ok(i > 0);
  const khoi = nguonHandler.slice(i, i + 3200);
  const j = khoi.indexOf('notifyHandoverNudge({');
  assert.ok(j > 0, 'mất luôn đường báo KHẨN — cắt quá tay');
  assert.match(khoi.slice(Math.max(0, j - 300), j), /if \(urgent\)/,
    'nudge phải nằm trong nhánh urgent, không bắn cho tin thường');
});

test('handover ghi LÝ DO + mốc giờ, không còn cắm trống trơn', () => {
  assert.match(nguonStore, /export function setHandover\(conversationId, lyDo\)/);
  assert.match(nguonStore, /handover_ly_do:\$\{conversationId\}/);
  assert.ok(!/setHandover\(conversationId\)(?!\s*\{)/.test(nguonHandler),
    'còn chỗ cắm handover mà không khai lý do → ca đó sẽ khoá vĩnh viễn');
});

test('3 lý do nhạy cảm KHOÁ CỨNG — bot không được tự chen vào', async () => {
  const { HANDOVER_KHOA_CUNG } = await import('../src/store.js');
  for (const ly of ['opt_out', 'nan_lieu_trinh', 'doi_bac_si']) {
    assert.ok(HANDOVER_KHOA_CUNG.has(ly), `${ly} phải khoá cứng`);
  }
  assert.ok(!HANDOVER_KHOA_CUNG.has('khac'), 'ca thường thì phải mở lại được');
  assert.ok(!HANDOVER_KHOA_CUNG.has('gemini:hoi sau chuyen mon'));
});

test('ca thường + khách im lâu rồi quay lại → MỞ KHOÁ, bot tư vấn tiếp', () => {
  const i = nguonHandler.indexOf('if (store.isHandover(conv)) {');
  const khoi = nguonHandler.slice(i, i + 3200);
  assert.match(khoi, /!khoaCung && \(duLang \|\| cuKy\) && !urgent/, 'thiếu điều kiện mở khoá');
  assert.match(khoi, /store\.clearHandover\(conversationId\)/, 'clearHandover vẫn không ai gọi');
  assert.match(khoi, /conv\.status = 'active'/, 'quên đồng bộ cờ trong RAM → lớp dưới đọc cờ cũ');
  // mở khoá thì KHÔNG được appendHistory (luồng chính sẽ ghi) và KHÔNG được return
  // Chỉ soi DÒNG MÃ, bỏ dòng chú thích — chú thích của chính bản vá có nhắc 2 chữ này.
  const iMo = khoi.indexOf('store.clearHandover');
  const sauMo = khoi.slice(iMo, iMo + 420)
    .split('\n').filter((d) => !d.trim().startsWith('//')).join('\n');
  assert.ok(!sauMo.includes('appendHistory'), 'ghi history 2 lần → lịch sử nhân đôi');
  assert.ok(!/\breturn;/.test(sauMo), 'mở khoá xong lại return thì bot vẫn câm');
});

test('ngưỡng mở khoá chỉnh được bằng env, mặc định 72h', () => {
  assert.match(nguonHandler, /process\.env\.HANDOVER_MO_LAI_GIO \|\| '72'/);
});

test('mở khoá còn vế CỜ CŨ — khoảng lặng một mình không cứu nổi ca vừa nhắn xong', () => {
  const i = nguonHandler.indexOf('if (store.isHandover(conv)) {');
  const khoi = nguonHandler.slice(i, i + 4200);
  assert.match(khoi, /\(duLang \|\| cuKy\)/, 'thiếu vế cờ-cũ → ca Khánh Linh vẫn câm ở lượt sau');
  assert.match(khoi, /mocCam === 0 \|\|/, 'conv cắm trước bản vá không có mốc giờ → phải coi là CŨ');
  assert.match(khoi, /process\.env\.HANDOVER_HET_HAN_NGAY \|\| '7'/);
});
