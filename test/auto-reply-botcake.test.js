// TIN AUTO BOTCAKE/META → KHÔNG được đánh cờ human — vá 15/09/2026 chiều
//   (ca Từ Duy Phương chờ 169' + Lan Huynh chờ 68', cảnh báo CANH BOT 17:25):
//   Kịch bản Botcake bắn câu xin số + Meta bắn ice-breaker "Chào X! Chúng tôi có thể giúp gì
//   cho bạn?" → cả hai lọt 6 cửa lọc → bot chấm "telesale gõ tay" → cờ human 2h → bot lui
//   chờ một người thật KHÔNG TỒN TẠI, khách rơi vào khoảng trống.
// Test 2 chiều: mẫu auto PHẢI BẮT · câu telesale thật PHẢI THẢ (vết xe 'gio lam viec' 15/09 sáng).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tamDB = fs.mkdtempSync(path.join(os.tmpdir(), 'autorep-db-'));
process.env.DB_PATH = path.join(tamDB, 'test.sqlite');

const { isAutoReplyMessage } = await import('../src/handler.js');

const PHAI_BAT = [
  // Meta ice-breaker kèm tên khách — ca Lan Huynh 16:17
  'Chào Lan! Chúng tôi có thể giúp gì cho bạn?',
  'Chào Minh Tân! Chúng tôi có thể giúp gì cho bạn?',
  // Tin hệ thống Meta "message request" — chính nó khoá ca Từ Duy Phương 169' (trích log 15/09)
  'Dr Nhật Trình muốn gửi tin nhắn cho bạn.',
  // 2 mẫu cũ phải còn sống (hồi quy)
  'Dạ cảm ơn anh/chị đã liên hệ, a/c vui lòng mô tả càng chi tiết càng tốt vấn đề mình đang gặp phải',
  'Đã đặt giai đoạn của khách hàng tiềm năng thành Đủ tiêu chuẩn',
];

const PHAI_THA = [
  // Telesale thật gõ tay — chặn oan là bot chen ngang đè người
  'Giờ làm việc bên em 8h-20h nha chị',
  'Chị ơi em gọi chị chưa được, chị để ý điện thoại giúp em nha',
  'Dạ mình để lại số giúp em nha',                       // câu ngắn người hay gõ — KHÔNG khớp mẫu dài
  'Em tư vấn miễn phí cho mình nha chị',                  // nhắc "tư vấn miễn phí" giữa câu thường
  'Bác sĩ nói tình trạng của chị cần khám trực tiếp ạ',
  // ⚠️ Mẫu TRẢ LỜI NHANH "Sodienthoai" — NGƯỜI TRỰC bấm tay trong Pancake (truy ra tối 15/09).
  // Bot PHẢI LUI khi thấy nó → PHẢI THẢ. Bản vá chiều 15/09 từng bắt nhầm câu này, đã rút.
  'Dạ mình để lại số điện thoại giúp em nha, Bác sĩ gọi xem kỹ tình trạng rồi tư vấn hướng phù hợp cho mình — tư vấn miễn phí thôi ạ 🙏',
];

for (const c of PHAI_BAT) {
  test(`PHẢI BẮT auto: "${c.slice(0, 55)}…"`, () => {
    assert.equal(isAutoReplyMessage(c), true);
  });
}
for (const c of PHAI_THA) {
  test(`PHẢI THẢ người thật: "${c.slice(0, 55)}…"`, () => {
    assert.equal(isAutoReplyMessage(c), false);
  });
}
