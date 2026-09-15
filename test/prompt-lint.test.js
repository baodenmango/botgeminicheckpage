// PROMPT-LINT — chống "địa tầng tái mọc" trong 2 file não (bước 5 đại tu 15/09/2026).
//
// Não đã bóc hết luật chết (strikethrough, "câu cũ ĐÃ BỎ", changelog, số đo bảo trì) sang
// CHANGELOG-NAO.md — não chỉ giữ luật ĐANG SỐNG. Test này giữ CẢ HAI CHIỀU:
//   ① Câu chết KHÔNG được mọc lại trong não — ai chép ngược từ backup/bản cũ là đỏ ngay.
//   ② Mục sống + mục mới PHẢI còn — cắt gọn quá tay cũng đỏ, không chỉ canh phình.
// Lưu ý: CHANGELOG-NAO.md ĐƯỢC PHÉP chứa câu chết (nó là sổ địa tầng) — chỉ soi 2 file não.
// Các strikethrough còn lại trong não đều nằm TRONG mục giữ-nguyên-văn (4B · luật A mục 2 · 6B)
// nên không assert "hết sạch ~~" — assert theo từng chuỗi chết cụ thể.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOC = path.join(__dirname, '..');
const naoFB = fs.readFileSync(path.join(GOC, 'system-prompt.md'), 'utf8');
const naoZalo = fs.readFileSync(path.join(GOC, 'system-prompt-zalo.md'), 'utf8');

// ── ① CÂU CHẾT không được tái mọc ──────────────────────────────────────────────
test('não FB hết câu chết đã bị số liệu/thiết kế bác', () => {
  const cauChet = [
    'tư vấn miễn phí, thấy hợp thì mình tới', // mục 8 cũ — khung yếu nhất đo được
    'không xa lắm đâu ạ',                      // mục 8 cũ — chối cảm nhận khách ở xa
    'đọc kỹ tin cuối',                         // 8B⑥ cũ — chỉ đọc tin cuối là nuốt câu hỏi (ca Lương Tờ Rình)
    'MẢNG 1–4',                                // mục 10 cũ — số ô lệch với luật 6B
    '9–11 số',                                 // mục 10 cũ — SĐT hợp lệ là ĐÚNG 10 số (10B)
  ];
  for (const cau of cauChet) {
    assert.ok(!naoFB.includes(cau), `câu chết mọc lại trong system-prompt.md: "${cau}"`);
  }
});

test('não Zalo: khối cấm 10/08 chỉ còn là dòng chú phạm vi công khai', () => {
  assert.ok(!naoZalo.includes('TUYỆT ĐỐI không nói phòng khám'),
    'khối cấm 10/08 (bản sống) phải đã gỡ khỏi vùng luật chat 1-1 — não Zalo đang 3-chọi-1 trở lại');
  assert.match(naoZalo, /ZNS \/ broadcast \/ bài đăng công khai/,
    'phải còn dòng chú: bản 10/08 chỉ áp ZNS/broadcast/bài công khai');
  assert.ok(naoZalo.includes('CÓ LÀM'),
    'khối 06/09 (phòng khám CÓ LÀM, nói thẳng trong chat 1-1) phải còn');
  assert.ok(!naoZalo.includes('MẢNG 1–4'), 'số ô não Zalo phải đồng bộ (1–2, không phải 1–4)');
});

// ── ② MỤC MỚI của bản đại tu phải có mặt ───────────────────────────────────────
test('não FB có đủ mục mới của bản đại tu', () => {
  const mucMoi = [
    'PHÂN LOẠI Ý ĐỊNH',              // mục 0 — bảng 7 ô xếp ý định
    'TRẢ LỜI TRƯỚC — DẪN DẮT SAU',   // luật đè mọi kịch bản, đứng trước 5B
    'HỘI THOẠI XÃ GIAO',             // 4D
    'KHÔNG ĐAU',                     // 4E — lời khách là sự thật
    'NHIỀU TIN LIỀN',                // 4F — đọc hết cả loạt
    'QUẢNG CÁO KHÁCH VỪA BẤM',       // 4F — thẻ bối cảnh ad
    'CHÀO TẠM BIỆT',                 // 4G
    'SAU 22H',                       // 4G — đêm khuya đổi nhịp
    'Ở XA',                          // 4H — bán giải pháp cho cái xa
    'MÁY DÒ TỪNG NGHI',              // 4I — thẻ nghi-oan-đã-bác
  ];
  for (const cum of mucMoi) {
    assert.ok(naoFB.includes(cum), `thiếu mục mới trong system-prompt.md: "${cum}"`);
  }
});

// ── ③ MỤC ĐÃ ĐO BẰNG SỐ còn nguyên — cắt gọn không được phạm vào ───────────────
test('mục đã đo bằng số + luật độ dài còn nguyên', () => {
  assert.match(naoFB, /## 4B\./, 'mất mục 4B');
  assert.ok(naoFB.includes('ĐỔI LẤY, ĐỪNG XIN TRỐNG'), '4B phải giữ nguyên tiêu đề');
  assert.ok(naoFB.includes('KHÔNG CÒN AI VÀO GÕ TAY THAY EM'), 'luật A.5 (mục 2) phải nguyên văn');
  assert.ok(naoFB.includes('PHÁC ĐỒ SALE 5 BƯỚC'), 'mất mục 4C');
  assert.ok(naoFB.includes('ĐỘ DÀI LƯỢT — LUẬT CỨNG'), 'mất mục 6B');
  assert.ok(naoFB.includes('2 ô/lượt'), '6B: mặc định 2 ô/lượt phải còn');
  assert.ok(naoFB.includes('300 ký tự'), '6B: trần 300 ký tự phải còn');
  assert.ok(naoFB.includes('ĐÚNG 10 số'), '10B: luật SĐT đúng 10 số phải còn');
  assert.ok(naoZalo.includes('300 ký tự'), 'não Zalo: trần ký tự/ô phải còn');
  // "suất tư vấn" phải còn Ở DẠNG LUẬT CẤM (bot cần biết cụm này bị cấm) — không phải câu mẫu
  assert.ok(naoFB.includes('suất tư vấn'), 'não FB mất dấu vết luật cấm cụm "suất tư vấn"');
  assert.ok(naoZalo.includes('suất tư vấn'), 'não Zalo mất luật cấm "giữ suất tư vấn miễn phí"');
});

// ── ④ DMKT (C) + (E) — cấm vĩnh viễn, kể cả inbox, ở CẢ HAI não ────────────────
test('DMKT (C) hứa kết quả + (E) học vị vẫn cấm vĩnh viễn ở cả hai não', () => {
  for (const [ten, nao] of [['FB', naoFB], ['Zalo', naoZalo]]) {
    assert.ok(nao.includes('CẤM VĨNH VIỄN'), `não ${ten} mất chữ CẤM VĨNH VIỄN`);
    assert.ok(nao.includes('NĐ 38/2021'), `não ${ten} mất căn cứ NĐ 38/2021`);
    assert.ok(nao.includes('BS.CK1'), `não ${ten} mất luật cấm học vị BS.CK1`);
    assert.ok(nao.includes('khỏi hẳn'), `não ${ten} mất danh sách từ cấm nhóm C`);
  }
});

// ── ⑤ TRẦN DÒNG — chống phình trở lại ──────────────────────────────────────────
test('system-prompt.md sau đại tu không vượt 641 dòng', () => {
  const soDong = naoFB.split('\n').length - (naoFB.endsWith('\n') ? 1 : 0);
  assert.ok(soDong <= 641, `system-prompt.md đang ${soDong} dòng — vượt trần 641, phải cắt về CHANGELOG-NAO.md`);
});
