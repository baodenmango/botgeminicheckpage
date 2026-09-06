// ============================================================================
//  SỔ LIỆU TRÌNH CỦA THẢO — cho bot BIẾT khách đang theo liệu trình gì.
//  Dựng 06/09/2026 (anh Trình: "Những ca tiêm lớn theo liệu trình thì Thảo có lưu
//  ở đây, em cho BOT đọc ở đây để chăm khách").
//
//  VÌ SAO CÓ FILE NÀY
//  ------------------
//  Thẻ ngữ cảnh cũ (medi.js buildContextTag) thực tế chỉ có mỗi TÊN: ~83% bệnh nhân
//  bot không biết họ bị gì, đã làm gì. Hậu quả thật, hai ca lớn nhất tháng 8:
//    · PHAN TRẦN THIỀU ANH — 54.180.000đ, ra bill 28/08
//    · NGUYỄN VĂN CƯ       — 52.200.000đ, ra bill 28/08
//  Bot mà nhắn "mình bị đau ở đâu ạ" với người vừa trả 50 triệu thì đúng như anh
//  Trình gọi: BỊ DỘI. Sổ của Thảo là nơi DUY NHẤT ghi họ đã tiêm gì, ngày nào.
//
//  ⚠️ CHỈ ĐỌC. Đây là sổ NGƯỜI TA ĐANG DÙNG — tuyệt đối không ghi, không sửa,
//  không tạo tab. Service account chỉ được cấp quyền Xem.
//
//  ⚠️ FAIL-SOFT LÀ LUẬT: sổ lỗi / mất mạng / hết quyền → mọi hàm trả rỗng và bot
//  chạy tiếp như trước, chỉ mất phần liệu trình. Có cache cũ thì XÀI CACHE CŨ
//  (thà số hôm qua còn hơn không có gì). Không hàm nào được throw ra ngoài.
//
//  ⚠️ CACHE: không gọi Sheets API mỗi tin khách. Nạp 1 lần / TTL (mặc định 15').
//  Đường dùng đúng:  await napBang()  (async, 1 lần đầu lượt)  →  traSdt/traTen/
//  theLieuTrinh  (ĐỒNG BỘ, đọc cache — gọi được ở bất kỳ đâu trong handler).
//
//  BẨY DỮ LIỆU THẬT — đo bằng chính sổ ngày 06/09/2026, đừng "dọn" đi:
//   1. HEADER KHÔNG Ở DÒNG 1: tab CNC header ở dòng 4, tab PRP ở dòng 2 → dò
//      bằng chữ "HỌ VÀ TÊN", cấm hardcode chỉ số dòng.
//   2. SĐT MẤT SỐ 0 ĐẦU: '931608906' = '0931608906' (18/27 dòng CNC, 31/31 PRP).
//   3. NGÀY 4 KIỂU: '07/01' · '21/07/25 (R)' · '15/11/2025 (R)' · '24/01/2026(R)'
//      — và một ô hụt ngoặc '20/07/2026 (R'. Ký hiệu (R) là ghi chú của Thảo,
//      bóc riêng, KHÔNG vứt cả ô. Tab CNC ngày KHÔNG CÓ NĂM → giữ nguyên chữ,
//      cấm tự suy năm rồi báo cho khách sai.
//   4. DÒNG TÊN RỖNG mà vẫn có ngày (PRP dòng 11, 17, 24-26, 72, 88): dòng NỐI
//      TIẾP của người ngay trên (liệu trình thứ 2). Kế thừa tên+SĐT của dòng trên
//      và ĐÁNH DẤU keThua=true; KHÔNG được gán cho người khác.
//   5. MỘT NGƯỜI NHIỀU DÒNG: NGUYỄN TRƯƠNG CÔNG THẮNG có 2 liệu trình, CHU TRẦN
//      MINH có 3 → tra ra MẢNG, không phải 1 bản ghi.
//   6. TÊN DÍNH '\r': 24/92 dòng PRP có '\r' cuối tên (Thảo dán từ chỗ khác).
//   7. DÒNG MA: cột HOÀN THÀNH có ARRAYFORMULA nên 900+ dòng trống vẫn trả
//      'FALSE'. Dòng chỉ có mỗi 'FALSE' KHÔNG PHẢI bệnh nhân — lọc bỏ, nếu không
//      sổ 92 dòng thật sẽ đếm thành 1.001.
//
//  🔴 ĐỘ PHỦ THẬT (đo 06/09/2026) — đọc trước khi kỳ vọng vào file này:
//     CNC 88 dòng thật / 27 có SĐT · PRP 92 dòng thật / 31 có SĐT
//     ⇒ tra theo SĐT chỉ với tới 58/180 dòng (32%). Thảo GHI TÊN nhưng THƯỜNG
//     BỎ TRỐNG SĐT ở các dòng mới. Vì vậy có thêm đường tra THEO TÊN, chỉ dùng
//     khi tên đến từ hồ sơ đã xác thực (POS/MEDi), và kết quả gắn cờ khopBang.
// ============================================================================
import axios from 'axios';
import crypto from 'node:crypto';
import fs from 'node:fs';

const SHEET_ID = process.env.LIEUTRINH_SHEET_ID || '11197nwwl4hKlwJDzazJ1-0oA4LFCUlZCIeTOmcEciTg';
// Dải đọc: lấy dư cột cho chắc, code map theo TÊN header chứ không theo vị trí.
const DAI_DOC = [
  { ten: 'Lịch liệu trình CNC', kieu: 'CNC', dai: "'Lịch liệu trình CNC'!A1:P1000" },
  { ten: 'LỊCH PRP', kieu: 'PRP', dai: "'LỊCH PRP'!A1:J1000" },
];
const CACHE_TTL_MS = parseInt(process.env.LIEUTRINH_CACHE_TTL_MS || '900000', 10); // 15 phút
// Tắt khẩn cả tính năng (cầu dao): LIEUTRINH_TAT=1
const DA_TAT = /^(1|true|yes|on)$/i.test(process.env.LIEUTRINH_TAT || '');

// ---------------------------------------------------------------------------
// 1. TIỆN ÍCH THUẦN (không I/O — test được)
// ---------------------------------------------------------------------------

/** Bỏ dấu + thường hoá + bỏ mọi ký tự không phải chữ/số. Dùng để so header và tên. */
export function boDau(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}
function khoaChu(s) { return boDau(s).replace(/[^a-z0-9]/g, ''); }

/** Dọn ô: bỏ '\r', '\n', khoảng trắng thừa. Sổ của Thảo dán từ nơi khác nên đầy '\r'. */
export function donO(s) {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * SĐT về dạng chuẩn 10 số. VÁ BẪY #2: sổ của Thảo mất số 0 đầu ở 49/58 dòng có số.
 * '931608906' → '0931608906' · '84931608906' → '0931608906' · rác → ''.
 */
export function chuanHoaSdt(p) {
  let s = String(p ?? '').replace(/\D/g, '');
  if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
  if (!s.startsWith('0') && s.length === 9) s = '0' + s;   // ← BẪY #2
  return s.length === 10 ? s : '';
}

/**
 * Bóc một ô ngày của Thảo. VÁ BẪY #3.
 * @returns {{raw:string, ngay:string|null, epoch:number|null, roNam:boolean, ghiChu:string|null}|null}
 *   ngay  — chuỗi ĐẸP để nói với khách ('28/08/2026' hoặc '07/01' nếu sổ không ghi năm)
 *   epoch — giây, CHỈ có khi sổ ghi đủ năm (roNam=false). Không tự suy năm.
 *   ghiChu— nội dung trong ngoặc, thường là 'R' (ký hiệu riêng của Thảo).
 */
export function bocNgay(o) {
  const raw = donO(o);
  if (!raw) return null;
  // Bóc ghi chú trong ngoặc — chấp cả ngoặc HỤT '(R' (có thật trong sổ).
  let ghiChu = null;
  const mGhi = raw.match(/\(([^)]*)\)?\s*$/);
  let than = raw;
  if (mGhi) { ghiChu = donO(mGhi[1]) || null; than = donO(raw.slice(0, mGhi.index)); }
  const m = than.match(/^(\d{1,2})\s*[/\-.]\s*(\d{1,2})(?:\s*[/\-.]\s*(\d{2,4}))?$/);
  if (!m) return { raw, ngay: null, epoch: null, roNam: true, ghiChu };
  const d = Number(m[1]); const mo = Number(m[2]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return { raw, ngay: null, epoch: null, roNam: true, ghiChu };
  const hai = (n) => String(n).padStart(2, '0');
  if (!m[3]) {
    // BẪY #3b: tab CNC ghi 'dd/mm' KHÔNG NĂM. Tuyệt đối không tự gán năm hiện tại —
    // bot nói sai năm cho bệnh nhân còn tệ hơn không nói. Giữ nguyên chữ, roNam=true.
    return { raw, ngay: `${hai(d)}/${hai(mo)}`, epoch: null, roNam: true, ghiChu };
  }
  let y = Number(m[3]);
  if (m[3].length === 2) y += 2000;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (isNaN(dt.getTime())) return { raw, ngay: null, epoch: null, roNam: true, ghiChu };
  return { raw, ngay: `${hai(d)}/${hai(mo)}/${y}`, epoch: Math.floor(dt.getTime() / 1000), roNam: false, ghiChu };
}

/**
 * Đọc TỔNG SỐ LẦN của liệu trình từ chữ Thảo ghi.
 * 'LIỆU TRÌNH 3 LẦN'→3 · 'LIỆU TRÌNH 9 LẦN'→9 · 'ĐIỆN DI 3L+ĐIỆN 3UNG 3L'→3
 * 'LT 2 BUỔI'→2 · 'LT 4 BUỔI, ĐÃ LÀM 2 BUỔI TRẢ TIỀN, CÒN 2 BUỔI FREE'→4 (số ĐẦU).
 * Không đọc được → null (KHÔNG đoán).
 */
export function docTongSoLan(...oChu) {
  for (const o of oChu) {
    const t = boDau(donO(o));
    if (!t) continue;
    const m = t.match(/(\d{1,2})\s*(lan|l\b|buoi|buổi)/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 30) return n;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2. DỰNG BẢNG TỪ Ô THÔ — HÀM THUẦN, không mạng, không cache → test thẳng được
// ---------------------------------------------------------------------------

/** Dò dòng header bằng chữ "HỌ VÀ TÊN". VÁ BẪY #1 — cấm hardcode dòng 1. */
export function timDongHeader(rows) {
  const gioiHan = Math.min(rows.length, 15);
  for (let i = 0; i < gioiHan; i++) {
    const r = rows[i] || [];
    if (r.some((c) => khoaChu(c) === 'hovaten')) return i;
  }
  return -1;
}

/** Map header → chỉ số cột. Trả { ten, sdt, dichVu, keHoach, hoanThanh, lichHen, ghiChu, lan[] } */
export function mapCot(header) {
  const k = header.map((h) => khoaChu(h));
  const idx = { ten: -1, sdt: -1, dichVu: -1, keHoach: -1, hoanThanh: -1, lichHen: -1, ghiChu: -1, lan: [] };
  const lieuTrinhCot = [];
  k.forEach((h, i) => {
    if (!h) return;
    if (h === 'hovaten') { if (idx.ten < 0) idx.ten = i; return; }
    // 'SÓ ĐIỆN THOẠI' — Thảo gõ thiếu dấu, khớp cả 'so' lẫn 'sodienthoai'.
    if (/^s[oó]?dienthoai$/.test(h) || h === 'sdt') { if (idx.sdt < 0) idx.sdt = i; return; }
    if (h === 'vitritiem') { if (idx.dichVu < 0) idx.dichVu = i; return; }
    if (h === 'lieutrinh') { lieuTrinhCot.push(i); return; }
    if (h === 'hoanthanh') { if (idx.hoanThanh < 0) idx.hoanThanh = i; return; }
    if (h === 'lichhen') { if (idx.lichHen < 0) idx.lichHen = i; return; }
    if (h === 'ghichu') { if (idx.ghiChu < 0) idx.ghiChu = i; return; }
    // Cột lần: 'LẦN 1'..'LẦN 9' và 'NGÀY TIÊM LẦN 1'.
    if (/^(ngaytiem)?lan\d+$/.test(h)) { idx.lan.push(i); return; }
  });
  // BẪY: tab CNC có HAI cột cùng tên 'Liệu trình' — cột C là TÊN DỊCH VỤ
  // ('Điện di máy CNC, Điện xung dòng TENS'), cột O là CỠ LIỆU TRÌNH
  // ('LIỆU TRÌNH 3 LẦN'). Lấy cột ĐẦU làm dịch vụ, cột CUỐI làm kế hoạch.
  if (lieuTrinhCot.length) {
    if (idx.dichVu < 0) idx.dichVu = lieuTrinhCot[0];
    idx.keHoach = lieuTrinhCot[lieuTrinhCot.length - 1];
    if (idx.keHoach === idx.dichVu && lieuTrinhCot.length === 1) idx.keHoach = lieuTrinhCot[0];
  }
  return idx;
}

/**
 * Biến các ô thô của MỘT tab thành danh sách bản ghi liệu trình. HÀM THUẦN.
 * @param {string[][]} rows  values trả về từ Sheets API (nguyên khối, kể cả tiêu đề)
 * @param {string} kieu      'CNC' | 'PRP'
 * @returns {{ban:Array, boQua:number, keThua:number, loi:string|null}}
 */
export function dungBang(rows, kieu = '?') {
  if (!Array.isArray(rows) || !rows.length) return { ban: [], boQua: 0, keThua: 0, loi: 'sổ rỗng' };
  const iH = timDongHeader(rows);
  if (iH < 0) return { ban: [], boQua: 0, keThua: 0, loi: 'không tìm thấy dòng header "HỌ VÀ TÊN"' };
  const idx = mapCot(rows[iH]);
  if (idx.ten < 0 || !idx.lan.length) {
    return { ban: [], boQua: 0, keThua: 0, loi: `header thiếu cột (ten=${idx.ten}, số cột lần=${idx.lan.length})` };
  }
  const ban = [];
  let boQua = 0; let keThua = 0;
  let chuTruoc = null; // người gần nhất CÓ TÊN — để kế thừa cho dòng nối tiếp (BẪY #4)
  for (let r = iH + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const o = (i) => (i >= 0 ? donO(row[i]) : '');
    const ten0 = o(idx.ten);
    const dichVu = o(idx.dichVu);
    const lanO = idx.lan.map((i) => o(i)).filter((x) => x);
    // BẪY #7 — DÒNG MA: ARRAYFORMULA cột HOÀN THÀNH trả 'FALSE' cho 900+ dòng trống.
    // Dòng không có TÊN, không có DỊCH VỤ, không có NGÀY nào ⇒ không phải bệnh nhân.
    if (!ten0 && !dichVu && !lanO.length) { boQua++; continue; }

    let ten = ten0; let sdt = chuanHoaSdt(o(idx.sdt)); let keThuaDong = false;
    if (!ten) {
      // BẪY #4 — dòng NỐI TIẾP: tên rỗng nhưng có ngày/dịch vụ ⇒ liệu trình thứ 2
      // của chính người ngay trên. Kế thừa tên + SĐT, ĐÁNH DẤU rõ, và ĐẾM để log.
      if (!chuTruoc) { boQua++; continue; }   // chưa có ai ở trên → thà bỏ còn hơn gán bừa
      ten = chuTruoc.ten;
      if (!sdt) sdt = chuTruoc.sdt;
      keThuaDong = true; keThua++;
    } else {
      chuTruoc = { ten, sdt };
    }

    const moc = idx.lan.map((i) => bocNgay(o(i))).filter(Boolean);
    const daLam = moc.length;
    const ghiChu = o(idx.ghiChu) || null;
    const keHoach = o(idx.keHoach) || null;
    const tongLan = docTongSoLan(keHoach, ghiChu);
    const htRaw = boDau(o(idx.hoanThanh));
    const hoanThanh = htRaw === 'true' ? true : htRaw === 'false' ? false : null;

    ban.push({
      nguon: kieu,
      dong: r + 1,                       // số dòng THẬT trên bảng tính (1-based) — để soi tay
      ten,
      tenKhoa: khoaChu(ten),
      sdt: sdt || null,
      dichVu: dichVu || null,            // CNC: tên máy · PRP: vị trí tiêm
      keHoach,                           // 'LIỆU TRÌNH 3 LẦN' ...
      tongLan,                           // số lần theo kế hoạch (null nếu sổ không ghi)
      daLam,                             // số lần ĐÃ có ngày trong sổ
      conLai: tongLan != null && tongLan > daLam ? tongLan - daLam : null,
      moc,                               // [{raw, ngay, epoch, roNam, ghiChu}]
      lanGanNhat: moc.length ? moc[moc.length - 1] : null,
      hoanThanh,
      lichHen: o(idx.lichHen) || null,
      ghiChu,
      keThua: keThuaDong,                // true = dòng nối tiếp, tên/SĐT kế thừa dòng trên
    });
  }
  return { ban, boQua, keThua, loi: null };
}

/**
 * VÁ SĐT THEO TÊN — chạy SAU khi gộp cả 2 tab.
 * Vì sao cần: Thảo ghi SĐT ở dòng ĐẦU của một người rồi thôi. Ca thật NGUYỄN TRƯƠNG
 * CÔNG THẮNG: dòng 12 có '914040900', dòng 13 (liệu trình thứ 2, VẪN GHI TÊN) bỏ trống
 * số ⇒ tra theo SĐT chỉ ra 1 trong 2 liệu trình. Cùng bệnh cảnh với PHAN ANH ĐỨC,
 * ĐOÀM NGỌC LINH, CHU TRẦN MINH.
 *
 * 🔒 CHỐT AN TOÀN: chỉ vá khi cái tên đó trong cả sổ ứng với ĐÚNG MỘT SĐT. Tên trùng
 * mà ra 2 số khác nhau ⇒ có thể là 2 người ⇒ THÀ ĐỂ TRỐNG còn hơn gán bệnh nhầm người.
 * Bản ghi được vá mang cờ sdtSuyTuTen=true để soi ngược được.
 */
export function vaSdtTheoTen(ban) {
  const soTheoTen = new Map();
  for (const b of ban) {
    if (!b.sdt || !b.tenKhoa) continue;
    if (!soTheoTen.has(b.tenKhoa)) soTheoTen.set(b.tenKhoa, new Set());
    soTheoTen.get(b.tenKhoa).add(b.sdt);
  }
  let va = 0;
  for (const b of ban) {
    if (b.sdt || !b.tenKhoa) continue;
    const bo = soTheoTen.get(b.tenKhoa);
    if (!bo || bo.size !== 1) continue;   // 0 số → chịu · >1 số → nghi 2 người, BỎ
    b.sdt = [...bo][0];
    b.sdtSuyTuTen = true;
    va++;
  }
  return va;
}

// ---------------------------------------------------------------------------
// 3. ĐỌC SHEET (service account, chỉ-đọc) + CACHE + FAIL-SOFT
// ---------------------------------------------------------------------------
function napServiceAccount() {
  const raw = process.env.LIEUTRINH_SA_JSON || process.env.GOOGLE_SA_JSON;
  if (raw) {
    try {
      const txt = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      return JSON.parse(txt);
    } catch (e) { console.warn('[lieutrinh] SA JSON không parse được:', e?.message); return null; }
  }
  // Đường LOCAL (máy anh Trình / chạy script): trỏ thẳng tới file key.
  const f = process.env.LIEUTRINH_SA_FILE || process.env.GOOGLE_SA_FILE;
  if (f) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (e) { console.warn('[lieutrinh] đọc file SA lỗi:', e?.message); return null; }
  }
  return null;
}

let token = null; let tokenHan = 0;
function b64url(b) { return Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

async function layToken() {
  if (token && Date.now() < tokenHan - 60000) return token;
  const sa = napServiceAccount();
  if (!sa?.client_email || !sa?.private_key) return null;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    // CHỈ-ĐỌC. Đừng đổi scope này thành quyền ghi — sổ của Thảo đang được dùng thật.
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${head}.${claim}`);
  const jwt = `${head}.${claim}.${b64url(signer.sign(sa.private_key))}`;
  try {
    const res = await axios.post('https://oauth2.googleapis.com/token',
      new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
    token = res.data?.access_token || null;
    tokenHan = Date.now() + (res.data?.expires_in || 3600) * 1000;
    return token;
  } catch (e) {
    console.error('[lieutrinh] lấy token Sheets lỗi:', e?.response?.data?.error_description || e?.message);
    return null;
  }
}

// Cache: 2 chỉ mục (theo SĐT, theo tên khoá) + danh sách phẳng.
let cache = null;      // { theoSdt:Map, theoTen:Map, ban:[], luc:number, thongKe:{} }
let capNhatLuc = 0;
let dangNap = null;    // chống nạp chồng khi nhiều tin tới cùng lúc
// Nạp HỤT thì nghỉ một lúc rồi mới thử lại. Không có cửa này thì mỗi tin khách lại
// gọi Sheets API một lần trong khi sổ đang hỏng ⇒ chậm cả đường trả lời khách.
let hutLuc = 0;
const NGHI_SAU_HUT_MS = parseInt(process.env.LIEUTRINH_NGHI_SAU_HUT_MS || '120000', 10); // 2 phút

export function daCauHinh() { return !DA_TAT && Boolean(napServiceAccount()); }

/**
 * Nạp/làm mới bảng liệu trình. GỌI 1 LẦN mỗi lượt xử lý tin, rồi dùng các hàm tra ĐỒNG BỘ.
 * KHÔNG BAO GIỜ throw. Lỗi mà đã có cache cũ → GIỮ cache cũ (thà số hôm qua còn hơn không có).
 * @returns {Promise<boolean>} có bảng dùng được hay không
 */
export async function napBang({ ep = false } = {}) {
  if (DA_TAT) return false;
  if (!ep && cache && Date.now() - capNhatLuc < CACHE_TTL_MS) return true;
  if (!ep && !cache && hutLuc && Date.now() - hutLuc < NGHI_SAU_HUT_MS) return false;
  if (dangNap) return dangNap;
  dangNap = (async () => {
    try {
      const tk = await layToken();
      if (!tk) {
        if (!cache) console.warn('[lieutrinh] chưa cấu hình service account → bỏ qua phần liệu trình (bot vẫn chạy)');
        hutLuc = Date.now();
        return Boolean(cache);
      }
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchGet?`
        + DAI_DOC.map((d) => `ranges=${encodeURIComponent(d.dai)}`).join('&');
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${tk}` }, timeout: 25000 });
      const dais = res.data?.valueRanges || [];
      const ban = []; const tk2 = {};
      dais.forEach((vr, i) => {
        const meta = DAI_DOC[i];
        const kq = dungBang(vr?.values || [], meta.kieu);
        if (kq.loi) console.warn(`[lieutrinh] tab ${meta.ten}: ${kq.loi}`);
        tk2[meta.kieu] = { dong: kq.ban.length, boQuaDongMa: kq.boQua, keThuaDongTren: kq.keThua };
        ban.push(...kq.ban);
      });
      if (!ban.length) {
        console.warn('[lieutrinh] đọc được sổ nhưng 0 dòng hợp lệ → giữ cache cũ nếu có');
        hutLuc = Date.now();
        return Boolean(cache);
      }
      const soVa = vaSdtTheoTen(ban);   // xem vaSdtTheoTen — chỉ vá tên ứng ĐÚNG 1 số
      const theoSdt = new Map(); const theoTen = new Map();
      for (const b of ban) {
        if (b.sdt) { if (!theoSdt.has(b.sdt)) theoSdt.set(b.sdt, []); theoSdt.get(b.sdt).push(b); }
        if (b.tenKhoa) { if (!theoTen.has(b.tenKhoa)) theoTen.set(b.tenKhoa, []); theoTen.get(b.tenKhoa).push(b); }
      }
      cache = { theoSdt, theoTen, ban, luc: Date.now(), thongKe: tk2 };
      capNhatLuc = Date.now(); hutLuc = 0;
      console.log(`[lieutrinh] nạp ${ban.length} dòng liệu trình `
        + `(${theoSdt.size} SĐT · ${theoTen.size} tên · vá ${soVa} SĐT theo tên · ${JSON.stringify(tk2)})`);
      return true;
    } catch (e) {
      // FAIL-SOFT: sổ lỗi thì bot vẫn chạy, chỉ mất phần liệu trình.
      console.error('[lieutrinh] đọc sổ lỗi:', e?.response?.data?.error?.message || e?.message,
        cache ? '→ DÙNG CACHE CŨ' : '→ chưa có cache, bỏ qua phần liệu trình');
      hutLuc = Date.now();
      return Boolean(cache);
    } finally { dangNap = null; }
  })();
  return dangNap;
}

/** Số liệu cache (cho route admin / script soi). */
export function thongKeCache() {
  if (!cache) return { coCache: false };
  return {
    coCache: true, dong: cache.ban.length, soSdt: cache.theoSdt.size, soTen: cache.theoTen.size,
    napLuc: new Date(cache.luc).toISOString(), theoTab: cache.thongKe,
  };
}

/** Tra theo SĐT (ĐỒNG BỘ, đọc cache). Trả MẢNG — 1 người có thể nhiều liệu trình. */
export function traSdt(sdt) {
  if (!cache) return [];
  const p = chuanHoaSdt(sdt);
  if (!p) return [];
  return (cache.theoSdt.get(p) || []).map((b) => ({ ...b, khopBang: 'sdt' }));
}

/**
 * Tra theo TÊN (ĐỒNG BỘ). CHỈ dùng khi tên đến từ hồ sơ ĐÃ XÁC THỰC (POS/MEDi) —
 * tên khách tự gõ trong chat thì CẤM, dễ trùng và gán nhầm bệnh cho người khác.
 * Khớp TUYỆT ĐỐI sau khi bỏ dấu/khoảng trắng; tên trùng nhiều người → trả hết,
 * caller thấy >1 người thì nên bỏ (xem theLieuTrinh).
 */
export function traTen(ten) {
  if (!cache) return [];
  const k = khoaChu(ten);
  if (!k || k.length < 6) return [];   // tên quá ngắn → rủi ro trùng, bỏ
  return (cache.theoTen.get(k) || []).map((b) => ({ ...b, khopBang: 'ten' }));
}

/**
 * Tra gộp: SĐT trước (chắc chắn), không có thì mới tới tên (đã xác thực).
 * @param {{sdt?:string, ten?:string, choPhepTraTen?:boolean}} p
 */
export function tra({ sdt, ten, choPhepTraTen = true } = {}) {
  const theoSdt = traSdt(sdt);
  if (theoSdt.length) return theoSdt;
  if (!choPhepTraTen) return [];
  return traTen(ten);
}

// ---------------------------------------------------------------------------
// 4. DỰNG THẺ NGỮ CẢNH — chữ mà bot ĐỌC trước khi soạn câu
// ---------------------------------------------------------------------------
function motDong(b) {
  const p = [];
  if (b.dichVu) p.push(b.dichVu);
  if (b.tongLan != null) p.push(`liệu trình ${b.tongLan} lần`);
  p.push(`đã làm ${b.daLam} lần`);
  if (b.conLai != null) p.push(`còn ${b.conLai} lần`);
  if (b.lanGanNhat?.ngay) {
    p.push(`lần gần nhất ${b.lanGanNhat.ngay}${b.lanGanNhat.roNam ? ' (sổ không ghi năm)' : ''}`);
  }
  if (b.hoanThanh === true) p.push('ĐÃ XONG liệu trình');
  else if (b.hoanThanh === false) p.push('CHƯA xong');
  if (b.lichHen) p.push(`lịch hẹn: ${b.lichHen}`);
  if (b.ghiChu) p.push(`ghi chú: ${b.ghiChu}`);
  return p.join(' · ');
}

/**
 * Dựng đoạn thẻ ngữ cảnh về liệu trình. Trả null nếu không tra được gì (caller bỏ qua).
 * @param {{sdt?:string, ten?:string, choPhepTraTen?:boolean}} p
 */
export function theLieuTrinh(p = {}) {
  let ds = tra(p);
  if (!ds.length) return null;
  // An toàn: khớp bằng TÊN mà ra nhiều NGƯỜI khác nhau (cùng tên) → bỏ, thà không biết
  // còn hơn kể liệu trình của người khác cho khách.
  if (ds[0].khopBang === 'ten') {
    const sdtKhac = new Set(ds.map((b) => b.sdt).filter(Boolean));
    if (sdtKhac.size > 1) return null;
  }
  ds = ds.slice(-4); // nhiều liệu trình → giữ 4 cái mới nhất, khỏi phình prompt
  const dong = ds.map((b, i) => `  ${i + 1}. [${b.nguon}] ${motDong(b)}`).join('\n');
  const canhBao = [];
  if (ds[0].khopBang === 'ten') canhBao.push('khớp theo TÊN (sổ chưa ghi SĐT) — nếu khách nói không đúng thì tin khách');
  if (ds.some((b) => b.keThua)) canhBao.push('có dòng nối tiếp kế thừa tên dòng trên');
  return `[LIỆU TRÌNH — SỔ CSKH CỦA THẢO] Khách này ĐANG/ĐÃ theo liệu trình tại phòng khám:\n${dong}\n`
    + `→ ĐỪNG hỏi "mình bị đau ở đâu", ĐỪNG chào như người lạ, ĐỪNG mời khám lần đầu. `
    + `Hỏi thăm đúng cái họ đã làm và nhắc buổi kế tiếp nếu còn.`
    + (canhBao.length ? `\n(lưu ý nội bộ: ${canhBao.join('; ')})` : '');
}

/** Bản async tiện dụng: tự nạp bảng rồi dựng thẻ. Không throw. */
export async function theLieuTrinhAsync(p = {}) {
  try { await napBang(); return theLieuTrinh(p); } catch { return null; }
}

/** Cho test: nạp thẳng dữ liệu đã có, không đụng mạng. */
export function napTuOThoChoTest(bangs) {
  const ban = []; const tk = {};
  for (const { rows, kieu } of bangs) {
    const kq = dungBang(rows, kieu);
    tk[kieu] = { dong: kq.ban.length, boQuaDongMa: kq.boQua, keThuaDongTren: kq.keThua, loi: kq.loi };
    ban.push(...kq.ban);
  }
  vaSdtTheoTen(ban);
  const theoSdt = new Map(); const theoTen = new Map();
  for (const b of ban) {
    if (b.sdt) { if (!theoSdt.has(b.sdt)) theoSdt.set(b.sdt, []); theoSdt.get(b.sdt).push(b); }
    if (b.tenKhoa) { if (!theoTen.has(b.tenKhoa)) theoTen.set(b.tenKhoa, []); theoTen.get(b.tenKhoa).push(b); }
  }
  cache = { theoSdt, theoTen, ban, luc: Date.now(), thongKe: tk };
  capNhatLuc = Date.now();
  return { ban, thongKe: tk };
}

/** Cho test: xoá sạch cache (giả lập "sổ chưa nạp / sổ lỗi"). */
export function xoaCacheChoTest() { cache = null; capNhatLuc = 0; token = null; tokenHan = 0; hutLuc = 0; }
