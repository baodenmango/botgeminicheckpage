// Bộ thước cho SỔ LIỆU TRÌNH CỦA THẢO (src/lieutrinh.js).
// Chạy: npm test   (node:test + node:assert, KHÔNG thêm dependency, KHÔNG đụng mạng)
//
// LUẬT VIẾT TEST Ở ĐÂY: mọi ca đều LẤY TỪ DỮ LIỆU THẬT trong sổ ngày 06/09/2026.
// Không bịa ca đẹp — chính mấy ô xấu (SĐT mất số 0, ngày không năm, tên dính '\r',
// dòng tên rỗng, dòng ma toàn 'FALSE') mới là thứ làm hỏng bot.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  vaSdtTheoTen, chuanHoaSdt, bocNgay, docTongSoLan, donO, timDongHeader, mapCot, dungBang,
  napTuOThoChoTest, xoaCacheChoTest, traSdt, traTen, theLieuTrinh, tra,
} from '../src/lieutrinh.js';

// ===========================================================================
// FIXTURE — chép NGUYÊN VĂN từ sổ thật (chỉ cắt bớt số dòng)
// ===========================================================================
const CNC = [
  ['', 'LỊCH LIỆU TRÌNH ĐI MÁY CNC VÀ ĐIỆN XUNG TRỊ LIỆU '],
  [],
  [],
  ['STT', 'HỌ VÀ TÊN', 'Liệu trình ', 'SÓ ĐIỆN THOẠI', 'LẦN 1', 'LẦN 2', 'LẦN 3', 'LẦN 4',
    'LẦN 5', 'LẦN 6', 'LẦN 7', 'LẦN 8', 'LẦN 9', 'HOÀN THÀNH', 'LIỆU TRÌNH ', 'LỊCH HẸN'],
  ['1', 'TRƯƠNG VĨNH TUẤN', 'Điện di máy CNC, Điện xung dòng TENS', '0933396909',
    '', '', '', '', '', '', '', '', '', 'FALSE', 'LIỆU TRÌNH 3 LẦN', 'CÒN 1 LẦN ĐIỆN DI+ ĐIỆN XUNG'],
  ['3', 'NGÔ THỊ THU ĐÀO', 'Điện di máy CNC', '931608906',
    '', '', '', '10/01', '12/01', '14/01', '16/01', '18/01', '19/01', 'TRUE', 'LIỆU TRÌNH 9 LẦN'],
  ['9', 'NGUYỄN TRƯƠNG CÔNG THẮNG', 'Điện di máy CNC, Điện xung dòng TENS', '914040900',
    '09/01', '11/01', '14/01', '', '', '', '', '', '', 'TRUE', 'ĐIỆN DI 3L+ĐIỆN 3UNG 3L'],
  ['10', 'NGUYỄN TRƯƠNG CÔNG THẮNG', 'Điện di máy CNC, Điện xung dòng TENS', '',
    '16/01', '18/01', '21/01', '', '', '', '', '', '', 'TRUE', 'ĐIỆN DI 3L+ĐIỆN 3UNG 3L'],
  // DÒNG MA: cột HOÀN THÀNH có ARRAYFORMULA nên 900+ dòng trống vẫn trả 'FALSE'.
  ['', '', '', '', '', '', '', '', '', '', '', '', '', 'FALSE'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', 'FALSE'],
];

const PRP = [
  ['LỊCH TIÊM PRP+PRF CỦA BỆNH NHÂN'],
  ['STT', 'HỌ VÀ TÊN', 'VỊ TRÍ TIÊM', 'SÓ ĐIỆN THOẠI', 'NGÀY TIÊM LẦN 1', 'LẦN 2', 'LẦN 3',
    'HOÀN THÀNH', 'GHI CHÚ', 'TIÊM GIẢM BÉO'],
  ['1', 'PHẠM LAN HẢO1991', 'Gối (P)', '938807802', '21/07/25 (R)', '20/08/25 (R)', '19/09/25 (R)', 'TRUE'],
  ['9', 'PHAN THỊ THANH THẢO 1992', 'GÂN GÓT (T-P)', '922222538',
    '09/08/25 (R)', '29/09/25 (R)', '15/11/2025 (R)', 'TRUE'],
  // Dòng NỐI TIẾP: tên rỗng, SĐT rỗng, nhưng CÓ ngày → liệu trình thứ 2 của người ngay trên.
  ['10', '', 'FACE', '', '29/09/25 (R)', '15/11/2025 (R)', '24/01/2026(R)', 'TRUE'],
  ['', 'PHAN TRẦN THIỀU ANH\r', 'TIÊM EXOSOME LƯNG', '', '28/08/2026 (R)', '', '', 'FALSE'],
  ['', 'NGUYỄN VĂN CƯ\r', 'TBG GỐI P', '', '28/08/2026 (R)', '', '', 'FALSE'],
  ['', '', 'HA ARTOSYAL80 GỐI T', '', '28/08/2026 (R)', '', '', 'TRUE'],
  // Ô ngày HỤT NGOẶC — có thật trong sổ.
  ['', 'ĐINH THỊ DIỄM', 'BIOGEN CỔ CHÂN', '972652275', '20/07/2026 (R', '16/08/2026 (R)', '', 'FALSE'],
  ['', '', '', '', '', '', '', 'FALSE'],
];

function napFixture() {
  xoaCacheChoTest();
  return napTuOThoChoTest([{ rows: CNC, kieu: 'CNC' }, { rows: PRP, kieu: 'PRP' }]);
}

// ===========================================================================
// BẪY #2 — SĐT MẤT SỐ 0 ĐẦU (49/58 dòng có số trong sổ thật)
// ===========================================================================
test('chuẩn hoá SĐT — mất số 0 đầu, có +84, có rác', () => {
  assert.equal(chuanHoaSdt('931608906'), '0931608906');   // ← ca thật NGÔ THỊ THU ĐÀO
  assert.equal(chuanHoaSdt('902724709'), '0902724709');
  assert.equal(chuanHoaSdt('0933396909'), '0933396909');  // đã đúng thì giữ nguyên
  assert.equal(chuanHoaSdt('84931608906'), '0931608906');
  assert.equal(chuanHoaSdt('+84 931 608 906'), '0931608906');
  assert.equal(chuanHoaSdt('0931-608-906'), '0931608906');
  // KHÔNG được "sửa" thứ không phải SĐT thành SĐT
  assert.equal(chuanHoaSdt(''), '');
  assert.equal(chuanHoaSdt('123'), '');
  assert.equal(chuanHoaSdt('09316089061234'), '');
  assert.equal(chuanHoaSdt(null), '');
});

test('SĐT mất số 0 tra ra ĐÚNG người (đường thật, qua cache)', () => {
  napFixture();
  const ds = traSdt('0931608906');   // sổ ghi '931608906'
  assert.equal(ds.length, 1);
  assert.equal(ds[0].ten, 'NGÔ THỊ THU ĐÀO');
  // tra bằng đúng chuỗi sổ ghi cũng phải ra
  assert.equal(traSdt('931608906').length, 1);
});

// ===========================================================================
// BẪY #3 — 4 KIỂU NGÀY + ký hiệu (R) của Thảo
// ===========================================================================
test('bóc ngày — 4 kiểu thật trong sổ, KHÔNG vứt cả ô vì có (R)', () => {
  assert.deepEqual(bocNgay('07/01'), { raw: '07/01', ngay: '07/01', epoch: null, roNam: true, ghiChu: null });
  const a = bocNgay('21/07/25 (R)');
  assert.equal(a.ngay, '21/07/2025'); assert.equal(a.roNam, false); assert.equal(a.ghiChu, 'R');
  const b = bocNgay('15/11/2025 (R)');
  assert.equal(b.ngay, '15/11/2025'); assert.equal(b.ghiChu, 'R');
  const c = bocNgay('24/01/2026(R)');           // dính liền, không khoảng trắng
  assert.equal(c.ngay, '24/01/2026'); assert.equal(c.ghiChu, 'R');
  const d = bocNgay('20/07/2026 (R');           // NGOẶC HỤT — có thật trong sổ
  assert.equal(d.ngay, '20/07/2026'); assert.equal(d.ghiChu, 'R');
  const e = bocNgay('25/1');                    // 1 chữ số tháng
  assert.equal(e.ngay, '25/01'); assert.equal(e.roNam, true);
});

test('ngày KHÔNG CÓ NĂM thì KHÔNG được tự suy năm (epoch phải null)', () => {
  // Bot nói sai NĂM cho bệnh nhân còn tệ hơn không nói. Tab CNC không ghi năm.
  const x = bocNgay('19/01');
  assert.equal(x.epoch, null, 'không được đoán năm rồi sinh epoch');
  assert.equal(x.roNam, true);
  const y = bocNgay('28/08/2026 (R)');
  assert.ok(typeof y.epoch === 'number' && y.epoch > 0, 'có năm thì phải ra epoch');
});

test('bóc ngày — ô rác không được biến thành ngày', () => {
  assert.equal(bocNgay(''), null);
  assert.equal(bocNgay('   '), null);
  assert.equal(bocNgay('FALSE').ngay, null);          // dòng ma
  assert.equal(bocNgay('TIÊM GIẢM CÂN THỨ 5').ngay, null);
  assert.equal(bocNgay('45/13/2026').ngay, null);     // ngày/tháng vô lý
});

// ===========================================================================
// TỔNG SỐ LẦN
// ===========================================================================
test('đọc tổng số lần từ chữ Thảo ghi', () => {
  assert.equal(docTongSoLan('LIỆU TRÌNH 3 LẦN'), 3);
  assert.equal(docTongSoLan('LIỆU TRÌNH 9 LẦN'), 9);
  assert.equal(docTongSoLan('ĐIỆN DI 3L+ĐIỆN 3UNG 3L'), 3);
  assert.equal(docTongSoLan('ĐIỆN DI 5L+ĐIỆN XUNG 5L'), 5);
  assert.equal(docTongSoLan('LT 2 BUỔI'), 2);
  assert.equal(docTongSoLan('LT 4 BUỔI, ĐÃ LÀM 2 BUỔI TRẢ TIỀN, CÒN 2 BUỔI FREE'), 4); // số ĐẦU
  assert.equal(docTongSoLan(null, 'LIỆU TRÌNH 1 LẦN'), 1);      // rơi sang ô sau
  assert.equal(docTongSoLan('', ''), null);                      // không đoán
  assert.equal(docTongSoLan('Thoái hoá khớp gối (T)'), null);
});

// ===========================================================================
// BẪY #1 — HEADER KHÔNG Ở DÒNG 1
// ===========================================================================
test('dò dòng header — CNC ở dòng 4, PRP ở dòng 2, cấm hardcode dòng 1', () => {
  assert.equal(timDongHeader(CNC), 3, 'CNC header nằm ở index 3 (dòng 4)');
  assert.equal(timDongHeader(PRP), 1, 'PRP header nằm ở index 1 (dòng 2)');
  assert.equal(timDongHeader([['a', 'b'], ['c', 'd']]), -1, 'không có header thì phải trả -1');
});

test('map cột — CNC có HAI cột cùng tên "Liệu trình": đầu = dịch vụ, cuối = cỡ liệu trình', () => {
  const m = mapCot(CNC[3]);
  assert.equal(m.ten, 1);
  assert.equal(m.sdt, 3, 'phải đọc được "SÓ ĐIỆN THOẠI" dù Thảo gõ thiếu dấu');
  assert.equal(m.dichVu, 2);
  assert.equal(m.keHoach, 14);
  assert.equal(m.lan.length, 9);
  assert.equal(m.lichHen, 15);
  const p = mapCot(PRP[1]);
  assert.equal(p.dichVu, 2, 'PRP dùng "VỊ TRÍ TIÊM" làm dịch vụ');
  assert.equal(p.lan.length, 3, '"NGÀY TIÊM LẦN 1" cũng là cột lần');
  assert.equal(p.ghiChu, 8);
});

// ===========================================================================
// BẪY #7 — DÒNG MA (ARRAYFORMULA trả 'FALSE' cho 900+ dòng trống)
// ===========================================================================
test('dòng ma chỉ có mỗi "FALSE" KHÔNG được tính là bệnh nhân', () => {
  const kq = dungBang(PRP, 'PRP');
  assert.equal(kq.loi, null);
  assert.equal(kq.boQua, 1, 'phải bỏ đúng 1 dòng ma trong fixture');
  assert.ok(kq.ban.every((b) => b.ten), 'không bản ghi nào được rỗng tên');
  // Sổ thật: nếu không lọc thì 92 dòng thật đếm thành 1.001.
  assert.ok(kq.ban.length < PRP.length, 'số bản ghi phải ít hơn số dòng thô');
});

// ===========================================================================
// BẪY #4 — DÒNG TÊN RỖNG mà vẫn có ngày
// ===========================================================================
test('dòng tên rỗng = dòng NỐI TIẾP của người ngay trên, KHÔNG gán cho người khác', () => {
  const kq = dungBang(PRP, 'PRP');
  assert.equal(kq.keThua, 2, 'fixture có 2 dòng nối tiếp (FACE và HA ARTOSYAL80)');
  const face = kq.ban.find((b) => b.dichVu === 'FACE');
  assert.equal(face.ten, 'PHAN THỊ THANH THẢO 1992', 'FACE là liệu trình thứ 2 của người NGAY TRÊN');
  assert.equal(face.keThua, true, 'phải ĐÁNH DẤU là dòng kế thừa, không im lặng');
  assert.equal(face.sdt, '0922222538', 'kế thừa cả SĐT của người đó');
  const ha = kq.ban.find((b) => b.dichVu === 'HA ARTOSYAL80 GỐI T');
  assert.equal(ha.ten, 'NGUYỄN VĂN CƯ', 'dòng ngay trên là chú Cư, KHÔNG phải Thiều Anh');
  assert.equal(ha.keThua, true);
});

test('dòng tên rỗng khi CHƯA có ai ở trên → BỎ, tuyệt đối không gán bừa', () => {
  const rows = [
    ['STT', 'HỌ VÀ TÊN', 'VỊ TRÍ TIÊM', 'SÓ ĐIỆN THOẠI', 'NGÀY TIÊM LẦN 1', 'LẦN 2', 'LẦN 3', 'HOÀN THÀNH'],
    ['1', '', 'GỐI (P)', '', '01/02/2026 (R)', '', '', 'FALSE'],   // mồ côi ngay dòng đầu
    ['2', 'NGUYỄN VĂN A', 'LƯNG', '0900000000', '02/02/2026 (R)', '', '', 'FALSE'],
  ];
  const kq = dungBang(rows, 'PRP');
  assert.equal(kq.ban.length, 1);
  assert.equal(kq.ban[0].ten, 'NGUYỄN VĂN A');
  assert.equal(kq.boQua, 1);
});

// ===========================================================================
// BẪY #5 + #6 — một người nhiều dòng · tên dính '\r'
// ===========================================================================
test("tên dính '\\r' phải được dọn, tra tên vẫn ra", () => {
  assert.equal(donO('NGUYỄN VĂN CƯ\r'), 'NGUYỄN VĂN CƯ');
  assert.equal(donO('PHẠM THỊ BƯỚM\r\n'), 'PHẠM THỊ BƯỚM');
  napFixture();
  assert.ok(traTen('NGUYỄN VĂN CƯ').length >= 1, "tên dính '\\r' vẫn phải tra ra");
  assert.equal(traTen('PHAN TRẦN THIỀU ANH').length, 1);
});

test('một người NHIỀU liệu trình → trả về MẢNG, không phải 1 bản ghi', () => {
  napFixture();
  // Thảo ghi SĐT ở dòng ĐẦU của một người rồi thôi: dòng 2 VẪN CÓ TÊN nhưng bỏ trống số.
  // vaSdtTheoTen() vá chỗ đó, nếu không thì tra SĐT chỉ ra 1 trong 2 liệu trình.
  const ds = traSdt('0914040900');   // NGUYỄN TRƯƠNG CÔNG THẮNG
  assert.equal(ds.length, 2, 'phải ra ĐỦ 2 liệu trình');
  assert.ok(ds.every((b) => b.ten === 'NGUYỄN TRƯƠNG CÔNG THẮNG'));
  assert.ok(ds.some((b) => b.sdtSuyTuTen), 'bản ghi được vá phải mang cờ sdtSuyTuTen');
});

test('vá SĐT theo tên — CHỈ vá khi tên ứng ĐÚNG MỘT số (tên trùng thì thà để trống)', () => {
  // (a) một tên ↔ một số → vá
  const a = [
    { tenKhoa: 'nguyenvana', sdt: '0900000001' },
    { tenKhoa: 'nguyenvana', sdt: null },
  ];
  assert.equal(vaSdtTheoTen(a), 1);
  assert.equal(a[1].sdt, '0900000001');
  assert.equal(a[1].sdtSuyTuTen, true);

  // (b) TÊN TRÙNG ra 2 SỐ KHÁC NHAU → có thể là 2 người → TUYỆT ĐỐI không vá
  const b = [
    { tenKhoa: 'nguyenvanb', sdt: '0900000001' },
    { tenKhoa: 'nguyenvanb', sdt: '0900000002' },
    { tenKhoa: 'nguyenvanb', sdt: null },
  ];
  assert.equal(vaSdtTheoTen(b), 0, 'tên ra 2 số thì phải BỎ, không được đoán');
  assert.equal(b[2].sdt, null);

  // (c) cả họ đều không có số → không vá được, không crash
  const c = [{ tenKhoa: 'nguyenvanc', sdt: null }, { tenKhoa: 'nguyenvanc', sdt: null }];
  assert.equal(vaSdtTheoTen(c), 0);
});

// ===========================================================================
// SỐ LẦN ĐÃ LÀM / CÒN LẠI
// ===========================================================================
test('đếm số lần đã làm + còn lại + mốc gần nhất', () => {
  napFixture();
  const dao = traSdt('0931608906')[0];   // NGÔ THỊ THU ĐÀO, ô LẦN 4..9 có ngày
  assert.equal(dao.tongLan, 9);
  assert.equal(dao.daLam, 6, 'chỉ đếm ô CÓ NGÀY, không đếm ô trống ở giữa');
  assert.equal(dao.conLai, 3);
  assert.equal(dao.lanGanNhat.ngay, '19/01');
  assert.equal(dao.lanGanNhat.roNam, true);
  assert.equal(dao.hoanThanh, true);

  const tuan = traSdt('0933396909')[0];  // chưa đi lần nào
  assert.equal(tuan.daLam, 0);
  assert.equal(tuan.tongLan, 3);
  assert.equal(tuan.conLai, 3);
  assert.equal(tuan.hoanThanh, false);
  assert.equal(tuan.lichHen, 'CÒN 1 LẦN ĐIỆN DI+ ĐIỆN XUNG');
});

// ===========================================================================
// THẺ NGỮ CẢNH
// ===========================================================================
test('thẻ ngữ cảnh ca THẬT — Thiều Anh + Văn Cư (hai ca lớn nhất tháng 8)', () => {
  napFixture();
  const ta = theLieuTrinh({ sdt: '0903979484', ten: 'PHAN TRẦN THIỀU ANH' });
  assert.ok(ta, 'phải dựng được thẻ dù sổ CHƯA ghi SĐT (khớp bằng tên)');
  assert.ok(ta.includes('TIÊM EXOSOME LƯNG'));
  assert.ok(ta.includes('28/08/2026'));
  assert.ok(ta.includes('ĐỪNG hỏi'), 'phải có câu dặn bot đừng hỏi lại từ đầu');
  assert.ok(ta.includes('khớp theo TÊN'), 'phải nói rõ đây là khớp theo tên, không phải SĐT');

  const cu = theLieuTrinh({ sdt: '0983937026', ten: 'NGUYỄN VĂN CƯ' });
  assert.ok(cu.includes('TBG GỐI P'));
  assert.ok(cu.includes('HA ARTOSYAL80 GỐI T'), 'phải gồm cả dòng nối tiếp của chú Cư');
  assert.ok(cu.includes('dòng nối tiếp'), 'phải cảnh báo nội bộ về dòng kế thừa');
});

test('không tra được thì trả null — caller bỏ qua, KHÔNG bịa thẻ rỗng', () => {
  napFixture();
  assert.equal(theLieuTrinh({ sdt: '0000000000', ten: 'NGƯỜI KHÔNG CÓ THẬT' }), null);
  assert.equal(theLieuTrinh({}), null);
  // Cấm tra tên: Thiều Anh chưa có SĐT trong sổ → phải null
  assert.equal(theLieuTrinh({ sdt: '0903979484', ten: 'PHAN TRẦN THIỀU ANH', choPhepTraTen: false }), null);
});

test('tên quá ngắn KHÔNG được dùng để tra (chống gán nhầm)', () => {
  napFixture();
  assert.deepEqual(traTen('A'), []);
  assert.deepEqual(traTen('cô A'), []);
  assert.deepEqual(traTen(''), []);
});

test('SĐT được ưu tiên hơn TÊN khi cả hai cùng có', () => {
  napFixture();
  const ds = tra({ sdt: '0931608906', ten: 'NGUYỄN VĂN CƯ' });
  assert.equal(ds[0].khopBang, 'sdt');
  assert.equal(ds[0].ten, 'NGÔ THỊ THU ĐÀO', 'SĐT thắng, không được lấy theo tên');
});

// ===========================================================================
// FAIL-SOFT — sổ lỗi thì bot vẫn chạy
// ===========================================================================
test('SỔ LỖI / CHƯA NẠP → mọi hàm trả rỗng, KHÔNG throw, bot chạy tiếp', () => {
  xoaCacheChoTest();
  assert.deepEqual(traSdt('0931608906'), []);
  assert.deepEqual(traTen('NGUYỄN VĂN CƯ'), []);
  assert.equal(theLieuTrinh({ sdt: '0931608906', ten: 'NGÔ THỊ THU ĐÀO' }), null);
  assert.deepEqual(tra({ sdt: '0931608906' }), []);
});

test('SỔ HỎNG CẤU TRÚC → báo lỗi có tiếng nhưng KHÔNG throw', () => {
  for (const rac of [[], null, undefined, [['rác', 'rác']], [[]], 'không phải mảng']) {
    const kq = dungBang(rac, 'PRP');
    assert.deepEqual(kq.ban, [], `sổ rác phải ra 0 bản ghi: ${JSON.stringify(rac)}`);
    assert.ok(kq.loi, 'phải nêu LÝ DO để soi log được, không im lặng');
  }
});

test('sổ THIẾU cột lần → coi như không dùng được, không đoán bừa', () => {
  const rows = [['STT', 'HỌ VÀ TÊN', 'VỊ TRÍ TIÊM', 'SÓ ĐIỆN THOẠI'],
    ['1', 'NGUYỄN VĂN A', 'LƯNG', '0900000000']];
  const kq = dungBang(rows, 'PRP');
  assert.deepEqual(kq.ban, []);
  assert.ok(/thiếu cột/.test(kq.loi));
});
