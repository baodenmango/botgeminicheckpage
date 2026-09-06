// Bộ thước cho CỔNG CHẶN CA LỚN ≥20 TRIỆU (src/gac20tr.js) + chỗ CẮM cổng.
// Chạy: npm test   (node:test + node:assert, KHÔNG thêm dependency, KHÔNG đụng mạng)
//
// HAI VẾ BẮT BUỘC, thiếu vế nào là luật vô dụng:
//   (a) CHẶN ĐÚNG — ca ≥20tr mà hồ sơ trống thì tin CHỦ ĐỘNG phải im;
//   (b) KHÔNG CHẶN OAN — khách nhắn trước thì bot VẪN TRẢ LỜI. Anh Trình nói thẳng:
//       "im lặng khi khách hỏi còn tệ hơn". Vế (b) được canh bằng test CẤU TRÚC
//       đọc thẳng mã nguồn, vì đó là loại lỗi không hiện ra ở test hàm.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// store.js mở SQLite ngay lúc import → trỏ DB tạm để test KHÔNG đụng DB thật.
process.env.DB_PATH = path.join(os.tmpdir(), `gac20tr-test-${process.pid}.sqlite`);
const G = await import('../src/gac20tr.js');
const {
  soatHoSo, quyetDinh, gomHoSo, nguong, daTat, chanTinChuDong,
  NGUONG_MAC_DINH, TRUONG_BAT_BUOC,
} = G;

const GOC = path.join(import.meta.dirname, '..', 'src');
const doc = (f) => fs.readFileSync(path.join(GOC, f), 'utf8');

// ===========================================================================
// 1. SOÁT HỒ SƠ — thiếu trường nào phải nói ĐÚNG trường đó
// ===========================================================================
test('soát hồ sơ — đủ 3 trường mới là ĐỦ', () => {
  assert.deepEqual(TRUONG_BAT_BUOC, ['benh', 'dichVu', 'ngayLam']);
  const du = soatHoSo({ benh: 'Thoái hoá khớp gối', dichVu: 'TBG GỐI P', ngayLam: '28/08/2026' });
  assert.equal(du.du, true);
  assert.deepEqual(du.thieu, []);
});

test('soát hồ sơ — thiếu trường nào PHẢI GHI RÕ trường đó (telesale cần biết bổ sung gì)', () => {
  assert.deepEqual(soatHoSo({}).thieu, ['benh', 'dichVu', 'ngayLam']);
  assert.deepEqual(soatHoSo({ benh: 'gout' }).thieu, ['dichVu', 'ngayLam']);
  assert.deepEqual(soatHoSo({ benh: 'gout', dichVu: 'PRP' }).thieu, ['ngayLam']);
  assert.ok(soatHoSo({}).thieuVi.includes('bệnh/chẩn đoán'));
  assert.ok(soatHoSo({}).thieuVi.includes('dịch vụ đã làm'));
  assert.ok(soatHoSo({}).thieuVi.includes('ngày làm'));
});

test('ô CÓ CHỮ NHƯNG RỖNG NGHĨA vẫn tính là THIẾU', () => {
  // Đây đúng cái bẫy: conversations.condition mặc định 'unknown' → nhìn như có dữ liệu.
  for (const rac of ['unknown', 'chưa rõ', 'Không rõ', '?', '---', '   ', '', null, undefined]) {
    assert.ok(soatHoSo({ benh: rac, dichVu: 'PRP', ngayLam: '01/01/2026' }).thieu.includes('benh'),
      `"${rac}" phải bị coi là THIẾU bệnh`);
  }
});

// ===========================================================================
// 2. QUYẾT ĐỊNH CHẶN
// ===========================================================================
test('CHẶN: ca ≥20 triệu + hồ sơ trống', () => {
  const k = quyetDinh({ tongChi: 54180000, hoSo: {} });        // ca Thiều Anh
  assert.equal(k.chan, true);
  assert.equal(k.lyDo, 'ca_lon_thieu_ho_so');
  assert.equal(k.thieu.length, 3);
});

test('KHÔNG chặn: ca ≥20 triệu nhưng ĐỦ hồ sơ → bot chăm bình thường', () => {
  const k = quyetDinh({
    tongChi: 52200000,                                          // ca Văn Cư
    hoSo: { benh: 'TBG GỐI P', dichVu: 'TBG GỐI P', ngayLam: '28/08/2026' },
  });
  assert.equal(k.chan, false);
  assert.equal(k.lyDo, 'ca_lon_nhung_du_ho_so');
});

test('KHÔNG chặn: dưới ngưỡng, dù hồ sơ trống trơn', () => {
  const k = quyetDinh({ tongChi: 300000, hoSo: {} });
  assert.equal(k.chan, false);
  assert.equal(k.lyDo, 'duoi_nguong');
  assert.equal(quyetDinh({ tongChi: 19999999, hoSo: {} }).chan, false, 'ngay dưới mốc → không chặn');
  assert.equal(quyetDinh({ tongChi: 20000000, hoSo: {} }).chan, true, 'đúng mốc 20tr → CHẶN');
});

test('FAIL-OPEN: chưa đo được tổng chi (POS sập/thiếu token) → KHÔNG chặn', () => {
  // Fail-closed ở đây nghĩa là "POS sập 1 lần là cả hệ chăm sóc đứng im" — hại rộng hơn.
  const k = quyetDinh({ tongChi: null, hoSo: {} });
  assert.equal(k.chan, false);
  assert.equal(k.lyDo, 'chua_do_duoc_tong_chi');
});

test('CẦU DAO tắt cổng → không chặn gì hết', () => {
  assert.equal(quyetDinh({ tongChi: 99000000, hoSo: {}, tat: true }).chan, false);
});

test('ngưỡng đọc từ env, sai giá trị thì về mặc định 20 triệu', () => {
  assert.equal(NGUONG_MAC_DINH, 20000000);
  const cu = process.env.GAC_TONG_CHI_NGUONG;
  try {
    delete process.env.GAC_TONG_CHI_NGUONG; assert.equal(nguong(), 20000000);
    process.env.GAC_TONG_CHI_NGUONG = '30000000'; assert.equal(nguong(), 30000000);
    process.env.GAC_TONG_CHI_NGUONG = 'bậy bạ'; assert.equal(nguong(), 20000000);
    process.env.GAC_TONG_CHI_NGUONG = '-5'; assert.equal(nguong(), 20000000);
  } finally { if (cu === undefined) delete process.env.GAC_TONG_CHI_NGUONG; else process.env.GAC_TONG_CHI_NGUONG = cu; }
});

test('cầu dao GAC_20TR_TAT', () => {
  const cu = process.env.GAC_20TR_TAT;
  try {
    process.env.GAC_20TR_TAT = '1'; assert.equal(daTat(), true);
    process.env.GAC_20TR_TAT = '0'; assert.equal(daTat(), false);
    delete process.env.GAC_20TR_TAT; assert.equal(daTat(), false);
  } finally { if (cu === undefined) delete process.env.GAC_20TR_TAT; else process.env.GAC_20TR_TAT = cu; }
});

// ===========================================================================
// 3. GOM HỒ SƠ + ĐƯỜNG CHẠY THẬT (không mạng: POS không có token → null)
// ===========================================================================
test('gomHoSo — dữ liệu caller đưa sẵn được GIỮ, không bị nguồn khác đè', () => {
  const h = gomHoSo({ san: { benh: 'gout', dichVu: 'tiêm HA', ngayLam: '01/09/2026' } });
  assert.deepEqual(h, { benh: 'gout', dichVu: 'tiêm HA', ngayLam: '01/09/2026' });
});

test('gomHoSo — không có nguồn nào thì trả 3 ô trống, KHÔNG bịa', () => {
  const h = gomHoSo({ phone: '0000000000', ten: 'NGƯỜI KHÔNG CÓ THẬT' });
  assert.deepEqual(h, { benh: null, dichVu: null, ngayLam: null });
});

test('chanTinChuDong — KHÔNG SĐT thì không chặn (không đo được tiền)', async () => {
  const k = await chanTinChuDong({ ten: 'Ai đó' });
  assert.equal(k.chan, false);
  assert.equal(k.lyDo, 'khong_co_sdt');
});

test('chanTinChuDong — POS không đọc được (test offline) → FAIL-OPEN, không throw', async () => {
  const k = await chanTinChuDong({ phone: '0903979484', ten: 'PHAN TRẦN THIỀU ANH', nguon: 'test' });
  assert.equal(k.chan, false, 'offline thì phải cho tin đi, không được chặn mù');
  assert.ok(['chua_do_duoc_tong_chi', 'duoi_nguong'].includes(k.lyDo), `lý do lạ: ${k.lyDo}`);
});

// ===========================================================================
// 4. CẮM ĐÚNG CHỖ — test CẤU TRÚC (loại lỗi test hàm không bắt được)
// ===========================================================================
test('cổng được cắm ĐỦ 4 đường TIN CHỦ ĐỘNG', () => {
  assert.ok(doc('care-send.js').includes('chanTinChuDong'), 'care-send (bill/tái bill/wakeup)');
  const h = doc('handler.js');
  assert.ok(h.includes("nguon: 'retouch (chạm lại)'"), 'retouch');
  assert.ok(h.includes('nguon: `7 chạm — chạm ${touchNo}`'), '7 chạm');
  const z = doc('zns.js');
  assert.ok(z.includes("nguon: 'ZNS voucher'"), 'ZNS voucher');
  assert.ok(z.includes("nguon: 'ZNS mời quan tâm OA'"), 'ZNS mời quan tâm OA');
});

test('🔴 KHÔNG chặn đường TRẢ LỜI KHÁCH — handleIncoming tuyệt đối không có cổng', () => {
  const h = doc('handler.js');
  const tu = h.indexOf('export async function handleIncoming');
  const den = h.indexOf('export async function handleRetouch');
  assert.ok(tu > 0 && den > tu, 'không định vị được handleIncoming');
  const than = h.slice(tu, den);
  assert.ok(!than.includes('chanTinChuDong'),
    'CẤM cắm cổng ≥20tr vào đường bot trả lời khách — khách nhắn trước thì bot PHẢI trả lời');
});

test('🔴 KHÔNG chặn ZNS GIAO DỊCH (xác nhận lịch / nhắc giờ hẹn)', () => {
  const z = doc('zns.js');
  const lat = (ten) => {
    const i = z.indexOf(`export async function ${ten}(`);
    assert.ok(i > 0, `không thấy ${ten}`);
    // cắt tới hàm export kế tiếp
    const j = z.indexOf('\nexport ', i + 10);
    return z.slice(i, j > 0 ? j : z.length);
  };
  for (const ten of ['sendZnsXacNhanLich', 'sendZnsNhacLich']) {
    assert.ok(!lat(ten).includes('chanTinChuDong'),
      `${ten} là tin GIAO DỊCH khách đang chờ — chặn nó là hại chính bệnh nhân`);
  }
});

test('chặn thì PHẢI báo telesale, không được im lặng có tổ chức', () => {
  const g = doc('gac20tr.js');
  assert.ok(g.includes('notifyText'), 'phải bắn Telegram');
  for (const phai of ['tổng đã chi', 'Hồ sơ bot đang THIẾU', 'pancake.vn/']) {
    assert.ok(g.includes(phai), `thẻ Telegram thiếu phần: ${phai}`);
  }
  assert.ok(g.includes('gac20tr_bao:'), 'phải chống báo trùng (1 lần/người/ngày)');
});

test('chặn là HOÃN, KHÔNG được đánh dấu "đã chạm" (mất mốc của ca 50 triệu)', () => {
  const h = doc('handler.js');
  const i = h.indexOf('nguon: `7 chạm — chạm ${touchNo}`');
  const khoi = h.slice(i, i + 500);
  assert.ok(!khoi.includes('markTouchDone'),
    'nhánh chặn của 7-chạm không được gọi markTouchDone — bổ sung hồ sơ xong phải chạm lại được');
});

test('sổ liệu trình được đấu vào thẻ ngữ cảnh (việc ①)', () => {
  const m = doc('medi.js');
  assert.ok(/export function buildContextTag\(record, conditionVi, lieuTrinh/.test(m),
    'buildContextTag phải nhận thẻ liệu trình');
  const h = doc('handler.js');
  assert.ok(h.includes('napSoLieuTrinh'), 'handler phải nạp sổ liệu trình');
  assert.ok(h.includes('theLTChoCa'), 'handler phải dựng thẻ liệu trình cho cả FB lẫn Zalo');
});
