// ===== TEST 2 CHIỀU cho loạt vá regex 15/09/2026 (đại tu "tư vấn viên xuất sắc") =====
// Gốc bệnh chung: regex bỏ-dấu tiếng Việt đồng âm ("gối nữa"="gọi nữa", "giơ"="gởi"...) tự quyết
// hành động VĨNH VIỄN. Mỗi vá đều phải test CẢ HAI CHIỀU: câu oan phải THẢ, câu thật phải BẮT.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-regex1509-')), 'test.db');
const { laTinDaKham, laTinNanBenhNhan, laTinDoiBacSi, nhanDienKhuVuc, laTinBaoOXa, laConvDaDatLich, laTinXinNgung } =
  await import('../src/handler.js');
const store = await import('../src/store.js');

// ── RE_DA_CHOT_LICH: bỏ 'gio|gioi' + 'lich' trần phải là lịch KHÁM/HẸN ──
test('ĐÃ-CHỐT-LỊCH không bắt oan "giơ tay/giờ" và "mới có lịch rảnh"', () => {
  assert.equal(laTinDaKham('Em vừa giơ tay lên cao là đau nhói'), false, '"giơ" không phải "gửi"');
  assert.equal(laTinDaKham('Tuần sau em mới có lịch rảnh, cho em hỏi khám thứ 7 được không'), false, 'lịch RẢNH ≠ lịch KHÁM');
  assert.equal(laTinDaKham('Em vừa gọi cho phòng khám số hotline mà không được'), false, 'gọi điện thoại ≠ gửi số');
});
test('ĐÃ-CHỐT-LỊCH vẫn bắt các câu chốt lịch THẬT', () => {
  assert.equal(laTinDaKham('em đã đặt lịch khám rồi ạ'), true);
  assert.equal(laTinDaKham('tôi đã gửi số điện thoại qua phòng khám rồi mà'), true);
  assert.equal(laTinDaKham('mình vừa đặt cọc 100k xong'), true);
  assert.equal(laTinDaKham('em đã nhận được lịch khám sáng mai rồi'), true);
});

// ── TTL cờ da_dat_lich_conv: 30 ngày (trước là án vĩnh viễn) ──
test('cờ ĐÃ-ĐẶT-LỊCH tự hết hạn sau 30 ngày', () => {
  store.setKV('da_dat_lich_conv:conv_ttl_moi', String(Date.now()));
  assert.equal(laConvDaDatLich('conv_ttl_moi'), true, 'cờ mới cắm phải còn hiệu lực');
  store.setKV('da_dat_lich_conv:conv_ttl_cu', String(Date.now() - 31 * 86400000));
  assert.equal(laConvDaDatLich('conv_ttl_cu'), false, 'cờ quá 30 ngày phải hết hạn');
  assert.equal(laConvDaDatLich('conv_ttl_trong'), false, 'không có cờ');
});

// ── NẢN LIỆU TRÌNH: gate daKham cả 2 tầng + chặn phủ định + câu hỏi ──
test('NẢN-LIỆU-TRÌNH chỉ bắt bệnh nhân ĐÃ KHÁM — lead kể xấu chỗ khác là lead vàng', () => {
  assert.equal(laTinNanBenhNhan('Em khám chỗ kia cả buổi mà không ai giải thích gì hết', false), false,
    'người CHƯA khám ở mình chê CHỖ KHÁC = lead vàng, không phải nản');
  assert.equal(laTinNanBenhNhan('Lúc khám thì k ai nói j, về chỉ nhận tn thôi', true), true,
    'bệnh nhân ĐÃ khám chê trải nghiệm của MÌNH — vẫn phải bắt');
  assert.equal(laTinNanBenhNhan('May mà em không bỏ cuộc, giờ đỡ nhiều rồi', true), false,
    'phủ định "KHÔNG bỏ cuộc" là tin VUI');
  assert.equal(laTinNanBenhNhan('Tiêm nhiều mũi quá có hại gì không ạ?', true), false,
    'câu HỎI về liệu trình = cần giải thích, không phải nản');
  assert.equal(laTinNanBenhNhan('Mà tiêm nhìu quá thôi bỏ cuộc', true), true, 'ca Bé Tuyết gốc vẫn bắt');
});

// ── ĐÒI BÁC SĨ: muốn GẶP để KHÁM = đặt lịch, không phải handover ──
test('ĐÒI-BÁC-SĨ thả khách muốn gặp BS để KHÁM, giữ khách đòi hỏi lại y lệnh', () => {
  assert.equal(laTinDoiBacSi('Em muốn gặp bác sĩ khám thứ 7 được không ạ'), false, 'muốn khám = chốt lịch');
  assert.equal(laTinDoiBacSi('Muốn gặp bác sĩ thì đặt lịch sao ạ'), false);
  assert.equal(laTinDoiBacSi('Chị hỏi bác sĩ lại giúp e nhá'), true, 'ca Duy Cường gốc vẫn bắt');
  assert.equal(laTinDoiBacSi('cho em gặp bác sĩ được không'), true, 'đòi gặp không kèm ý khám → vẫn handover');
});

// ── KHU VỰC: khai nơi ở phải đứng NGAY TRƯỚC tên tỉnh; kể đi chơi thì bỏ ──
test('KHU-VỰC không gắn nhãn XA cho khách kể đi chơi/du lịch', () => {
  assert.equal(nhanDienKhuVuc('em đi Đà Nẵng chơi về là đau lưng luôn'), null, 'đi chơi ≠ đang ở');
  assert.equal(nhanDienKhuVuc('tháng trước em ra Hà Nội du lịch'), null);
  const kq = nhanDienKhuVuc('em ở Nghệ An lận, xa quá');
  assert.equal(kq?.nhom, 'xa', 'khai "ở Nghệ An" thật phải bắt');
  assert.equal(nhanDienKhuVuc('mình sống ở Quy Nhơn')?.nhom, 'xa');
  assert.equal(nhanDienKhuVuc('em ở quận 10 gần không')?.nhom, 'gan');
});

// ── Ở XA KHÔNG TÊN TỈNH (ca Lương Tờ Rình): phải bắt để cắm thẻ ngữ cảnh ──
test('BÁO-Ở-XA-TRỐNG bắt "tôi ở xa thì phải làm sao" (ca Lương Tờ Rình 14/09)', () => {
  assert.equal(laTinBaoOXa('Tôi ở xa thì phải làm sao ạ'), true);
  assert.equal(laTinBaoOXa('xa quá chị ơi không đến được'), true);
  assert.equal(laTinBaoOXa('em bị đau khớp gối hai năm nay'), false);
});

// ── XIN NGỪNG: 2 nhánh vừa vá thêm (gio/gioi + goi nua đã có test riêng) ──
test('XIN NGỪNG không bắt oan "giờ tin nhiều nguồn quá"', () => {
  assert.equal(laTinXinNgung('Giờ tin nhiều nguồn quá không biết tin ai'), false, '"giờ" không phải "gởi"');
  assert.equal(laTinXinNgung('gửi tin nhiều quá rồi đó'), true, 'xin ngừng thật vẫn bắt');
});
