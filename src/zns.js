// ============================================================
//  B5 — ZNS (Zalo Notification Service): nhắn theo SĐT, KHÔNG cần khách follow OA.
//  Dùng cho NHẮC LỊCH liệu trình (g2_pre3/g2_pre1) khi khách KHÔNG có kênh Zalo OA
//  (chưa follow / chưa từng nhắn OA) — mảnh phủ khách lớn nhất còn thiếu.
//  Phí ~200-350đ/tin, trừ vào ví Zalo Cloud Account (ZCA) của OA.
//
//  ĐIỀU KIỆN CHẠY (fail-open, thiếu là im lặng bỏ qua):
//   1) Template ZNS đã được Zalo DUYỆT (đăng ký tại zns.oa.zalo.me — xem HD-ZNS.md).
//   2) Env: ZNS_ENABLED=1 + ZNS_TEMPLATE_NHACLICH=<template_id đã duyệt>.
//  Template dùng 4 tham số: ten, ngay_hen, ten_pk, sdt_pk.
import axios from 'axios';
import crypto from 'node:crypto';
import * as store from './store.js';
import { getAccessTokenNow, refreshAccessToken, zaloAgentV4 } from './zalo.js';

// Sinh mã voucher NGẪU NHIÊN THẬT + ký tự checksum (bảo mật — vá 10/07: mã cũ tính được từ SĐT).
// Chỉ [A-Z0-9] (loại "Mã số" của ZNS + để Zalo render QR đúng), độ dài 9: tiền tố theo chương trình
// + 6 ký tự crypto random + 1 checksum. Checksum lọc nhanh mã bịa trước cả khi tra sổ.
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ I,O,0,1 tránh nhìn nhầm khi đọc mã
function sinhMaVoucher(ct) {
  const tien = ct === 'ct2' ? 'V2' : 'V1';
  let than = '';
  const b = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) than += B32[b[i] % 32];
  const body = tien + than; // 8 ký tự
  let sum = 0;
  for (const c of body) sum += c.charCodeAt(0);
  return body + B32[sum % 32]; // 9 ký tự, vd V1K7QM4PX
}
// Kiểm mã có checksum hợp lệ không (chặn mã bịa trước khi tra sổ).
export function maHopLe(ma) {
  const s = String(ma || '').toUpperCase();
  if (!/^[A-Z0-9]{9}$/.test(s)) return false;
  const body = s.slice(0, 8);
  let sum = 0;
  for (const c of body) sum += c.charCodeAt(0);
  return B32[sum % 32] === s[8];
}

const ZNS_API = 'https://business.openapi.zalo.me/message/template';
const HOTLINE = process.env.HOTLINE_PK || '0962349329';
const TEN_PK = process.env.TEN_PK || 'PK Cơ Xương Khớp Hiệp Lợi';

// --- RATING 5 SAO (anh Trình chốt 07/07): bắn NGAY sau khi ra bill để làm VAN XẢ —
// khách muốn phàn nàn thì xả vào kênh kín (form rating trong Zalo, chỉ mình thấy),
// không leo lên Google/Facebook review công khai. Mẫu 522230 ĐÃ DUYỆT từ 30/12/2025
// → chạy được ngay, không chờ duyệt. Tắt khẩn: ZNS_RATING_ENABLED=0.
const RATING_TEMPLATE = process.env.ZNS_RATING_TEMPLATE || '522230';
const RATING_ENABLED = !/^(0|false|no|off)$/i.test(process.env.ZNS_RATING_ENABLED || '1');
const RATING_COOLDOWN_S = 180 * 86400; // 1 lần/khách/6 tháng — tái khám dày không bị spam form

const gioVN = () => new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
const trongKhungGio = () => gioVN() >= 7 && gioVN() < 21;

// Epoch giây (hoặc ms) → dd/MM/yyyy giờ VN. Nhận số giây; nếu > 1e12 coi là ms.
function ngayVN(epoch) {
  const ms = epoch > 1e12 ? epoch : epoch * 1000;
  const d = new Date(ms + 7 * 3600 * 1000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

// Voucher tri ân khách cũ (template ZBS 518980 ĐÃ DUYỆT, loại Voucher 600đ/tin) — anh Trình
// chốt 09/07: CT1 siêu âm vi điểm + đo cơ mỡ 800k→150k, CT2 gói 1.3tr→300k. Template riêng,
// KHÔNG dùng chung ZNS_TEMPLATE_NHACLICH. Bật độc lập bằng ZNS_TEMPLATE_VOUCHER.
const VOUCHER_TEMPLATE = process.env.ZNS_TEMPLATE_VOUCHER || '518980';
const VOUCHER_HSD_NGAY = parseInt(process.env.ZNS_VOUCHER_HSD_NGAY || '30', 10);

export function isZnsEnabled() {
  return /^(1|true|yes|on)$/i.test(process.env.ZNS_ENABLED || '') && !!process.env.ZNS_TEMPLATE_NHACLICH;
}

// SĐT VN → dạng 84xxxxxxxxx (chuẩn ZNS).
function phone84(p) {
  let s = String(p || '').replace(/[^\d]/g, '');
  if (s.startsWith('0')) s = '84' + s.slice(1);
  if (!s.startsWith('84') || s.length !== 11) return null;
  return s;
}

/**
 * Gửi ZNS nhắc lịch hẹn. Trả true nếu Zalo nhận.
 * @param {string} phone  SĐT khách (0xxx...)
 * @param {object} p      { ten, ngay_hen } — ngay_hen dạng dd/MM/yyyy
 */
export async function sendZnsNhacLich(phone, { ten, ngay_hen, maKH } = {}) {
  if (!isZnsEnabled()) return false;
  const sdt = phone84(phone);
  if (!sdt || !ngay_hen) return false;
  // Chọn template bằng ENV ZNS_TEMPLATE_NHACLICH → gửi CẢ HAI khoá mã KH để khớp cả 2 mẫu:
  //  • 500295 (ĐÃ DUYỆT, dùng ngay): customer_name + schedule_time + booking_code (Nhãn tùy chỉnh ≤30)
  //  • 603887 (đang duyệt lại): customer_name + schedule_time + ma_khach_hang (Mã số ≤30)
  // Zalo chỉ đọc tham số CÓ trong mẫu, khoá thừa vô hại → đổi 500295↔603887 chỉ cần sửa ENV.
  // Không có mã thật (POS display_id) → "KH-" + 5 số cuối SĐT: đủ định danh, không lộ nguyên số.
  const maSt = String(maKH || `KH-${sdt.slice(-5)}`).slice(0, 30);
  const goi = async () => axios.post(ZNS_API, {
    phone: sdt,
    template_id: process.env.ZNS_TEMPLATE_NHACLICH,
    template_data: {
      customer_name: (ten || 'Quý khách').slice(0, 30),
      schedule_time: String(ngay_hen).slice(0, 20),
      booking_code: maSt,   // mẫu 500295
      ma_khach_hang: maSt,  // mẫu 603887
    },
    tracking_id: `nhaclich-${Date.now()}`,
  }, { headers: { access_token: getAccessTokenNow() }, timeout: 20000, validateStatus: () => true, httpsAgent: zaloAgentV4 });

  try {
    let r = await goi();
    if ([-216, -124].includes(r.data?.error)) { // token hết hạn → refresh + thử lại 1 lần
      await refreshAccessToken();
      r = await goi();
    }
    if (r.data?.error === 0) {
      console.log(`[zns] ✅ nhắc lịch ${ngay_hen} tới ${sdt.slice(0, 5)}*** (msg_id ${r.data?.data?.msg_id || '?'})`);
      return true;
    }
    console.warn('[zns] gửi nhắc lịch lỗi:', JSON.stringify(r.data).slice(0, 200));
    return false;
  } catch (err) {
    console.warn('[zns] gọi API lỗi:', err?.message);
    return false;
  }
}

// Template XÁC NHẬN ĐẶT LỊCH 605793 (ĐÃ DUYỆT 10/07) — tham số THẬT đã xác minh trên ZBS:
// customer_name (Tên KH ≤30) + booking_code (Mã số ≤30) + schedule_time (Nhãn tùy chỉnh ≤30).
// Bật độc lập bằng ZNS_TEMPLATE_XACNHAN (KHÔNG dùng chung ZNS_TEMPLATE_NHACLICH — khác mục đích).
const XACNHAN_TEMPLATE = process.env.ZNS_TEMPLATE_XACNHAN || '605793';

/**
 * Gửi ZNS XÁC NHẬN ĐẶT LỊCH ngay sau khi telesale chốt lịch (giảm no-show).
 * Nguồn giờ hẹn: block "Booking" telesale dán vào Telegram (parse ở index.js).
 * KHÔNG dedup cứng theo SĐT (1 khách đặt nhiều lịch khác giờ vẫn phải xác nhận từng cái);
 * chỉ chống double-fire vô tình bằng dedup mềm phone+giờ TTL 5 phút.
 * @param {object} p { ten, gio_hen (chuỗi "08:30 15/07/2026"), maDatLich }
 */
export async function sendZnsXacNhanLich(phone, { ten, gio_hen, maDatLich } = {}) {
  const sdt = phone84(phone);
  if (!sdt || !gio_hen) return { ok: false, ly_do: 'thieu_sdt_hoac_gio' };
  if (!XACNHAN_TEMPLATE) return { ok: false, ly_do: 'chua_cau_hinh_template' };
  // dedup mềm: cùng SĐT + cùng giờ hẹn trong 5 phút → coi là bấm lặp, bỏ qua
  const dkey = `zns_xacnhan:${sdt}:${String(gio_hen).replace(/\s+/g, '')}`;
  if (store.getKV(dkey)) return { ok: false, ly_do: 'vua_gui_roi' };

  const goi = async () => axios.post(ZNS_API, {
    phone: sdt,
    template_id: XACNHAN_TEMPLATE,
    template_data: {
      customer_name: (ten || 'Quý khách').slice(0, 30),
      booking_code: String(maDatLich || `HL-${sdt.slice(-5)}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 30),
      schedule_time: String(gio_hen).slice(0, 30),
    },
    tracking_id: `xacnhanlich-${Date.now()}`,
  }, { headers: { access_token: getAccessTokenNow() }, timeout: 20000, validateStatus: () => true, httpsAgent: zaloAgentV4 });

  try {
    let r = await goi();
    if ([-216, -124].includes(r.data?.error)) { await refreshAccessToken(); r = await goi(); }
    if (r.data?.error === 0) {
      store.setKV(dkey, String(Math.floor(Date.now() / 1000)));
      // TTL mềm: xoá key sau 5' để lịch mới (giờ khác) hoặc đặt lại vẫn gửi được
      setTimeout(() => { try { store.delKV(dkey); } catch { /* bỏ qua */ } }, 5 * 60 * 1000);
      console.log(`[zns] 📅 xác nhận đặt lịch ${gio_hen} tới ${sdt.slice(0, 5)}***`);
      return { ok: true };
    }
    console.warn('[zns] xác nhận lịch lỗi:', JSON.stringify(r.data).slice(0, 200));
    return { ok: false, ly_do: `zalo_loi_${r.data?.error}` };
  } catch (err) {
    console.warn('[zns] xác nhận lịch API lỗi:', err?.message);
    return { ok: false, ly_do: 'ngoai_le' };
  }
}

/**
 * Gửi ZNS ĐÁNH GIÁ 5 SAO (mẫu 522230 đã duyệt — customer_name + ma_khach_hang).
 * Chống trùng 6 tháng/khách. Trả true nếu Zalo nhận.
 */
export async function sendZnsRating(phone, { ten, maKH } = {}) {
  if (!RATING_ENABLED) return false;
  const sdt = phone84(phone);
  if (!sdt) return false;
  const key = `zns_rating_sent:${sdt}`;
  const lanTruoc = parseInt(store.getKV(key) || '0', 10);
  if (Math.floor(Date.now() / 1000) - lanTruoc < RATING_COOLDOWN_S) return false;

  const goi = async () => axios.post(ZNS_API, {
    phone: sdt,
    template_id: RATING_TEMPLATE,
    template_data: {
      customer_name: (ten || 'Quý khách').slice(0, 30),
      ma_khach_hang: String(maKH || sdt.slice(-4)).slice(0, 30),
    },
    tracking_id: `rating-${Date.now()}`,
  }, { headers: { access_token: getAccessTokenNow() }, timeout: 20000, validateStatus: () => true, httpsAgent: zaloAgentV4 });

  try {
    let r = await goi();
    if ([-216, -124].includes(r.data?.error)) { await refreshAccessToken(); r = await goi(); }
    if (r.data?.error === 0) {
      store.setKV(key, String(Math.floor(Date.now() / 1000)));
      console.log(`[zns] ⭐ gửi form đánh giá tới ${sdt.slice(0, 5)}*** (van xả complain về kênh kín)`);
      return true;
    }
    console.warn('[zns] gửi rating lỗi:', JSON.stringify(r.data).slice(0, 200));
    return false;
  } catch (err) {
    console.warn('[zns] rating gọi API lỗi:', err?.message);
    return false;
  }
}

/**
 * Gửi VOUCHER tri ân khách cũ (template 518980). Chống trùng 1 voucher/khách/chiến dịch.
 * @param {string} phone  SĐT khách (0xxx...)
 * @param {object} p      { ten, maHoSo, ngayKham } — ngayKham là epoch giây (bill_date)
 * @returns {Promise<{ok:boolean, voucher_code?:string, ly_do?:string}>}
 */
export async function sendZnsVoucher(phone, { ten, maHoSo, ngayKham, chuongTrinh } = {}) {
  const sdt = phone84(phone);
  if (!sdt) return { ok: false, ly_do: 'sdt_khong_hop_le' };
  if (!VOUCHER_TEMPLATE) return { ok: false, ly_do: 'chua_cau_hinh_template' };
  const key = `zns_voucher_sent:${sdt}`;
  if (store.getKV(key)) return { ok: false, ly_do: 'da_gui_roi' };

  const now = Math.floor(Date.now() / 1000);
  const ct = chuongTrinh === 'ct2' ? 'ct2' : 'ct1'; // mặc định CT1 (tầm soát 150k)
  const voucher_code = sinhMaVoucher(ct); // ngẫu nhiên thật, không suy ra được từ SĐT

  const goi = async () => axios.post(ZNS_API, {
    phone: sdt,
    template_id: VOUCHER_TEMPLATE,
    template_data: {
      customer_name: (ten || 'Quý khách').slice(0, 30),
      voucher_code: voucher_code.slice(0, 30),
      record_code: String(maHoSo || `KH-${sdt.slice(-5)}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 30),
      start_date: ngayVN(now),
      expire: ngayVN(now + VOUCHER_HSD_NGAY * 86400),
      visit_date: ngayVN(ngayKham || now),
    },
    tracking_id: `voucher-${Date.now()}`,
  }, { headers: { access_token: getAccessTokenNow() }, timeout: 20000, validateStatus: () => true, httpsAgent: zaloAgentV4 });

  try {
    let r = await goi();
    if ([-216, -124].includes(r.data?.error)) { await refreshAccessToken(); r = await goi(); }
    if (r.data?.error === 0) {
      store.setKV(key, String(now));
      // SỔ VOUCHER (anh Trình chốt 09/07): lưu bản ghi để quầy XÁC THỰC + khách xem ưu đãi rõ.
      // Key theo MÃ (quầy tra bằng mã), lưu đủ SĐT/tên/chương trình/HSD/trạng thái dùng.
      store.setKV(`voucher:${voucher_code}`, JSON.stringify({
        ma: voucher_code, sdt, ten: ten || null, chuong_trinh: ct,
        phat_luc: now, het_han: now + VOUCHER_HSD_NGAY * 86400,
        da_dung: false, dung_luc: null,
      }));
      console.log(`[zns] 🎁 gửi voucher ${voucher_code} (${ct.toUpperCase()}) tới ${sdt.slice(0, 5)}*** (HSD ${VOUCHER_HSD_NGAY} ngày)`);
      return { ok: true, voucher_code, chuong_trinh: ct };
    }
    console.warn('[zns] gửi voucher lỗi:', JSON.stringify(r.data).slice(0, 200));
    return { ok: false, ly_do: `zalo_loi_${r.data?.error}` };
  } catch (err) {
    console.warn('[zns] voucher gọi API lỗi:', err?.message);
    return { ok: false, ly_do: 'ngoai_le' };
  }
}

// ============================================================
//  T2 — DẶN DÒ SAU BUỔI ĐIỀU TRỊ (loại CSKH) + T3 — THÔNG BÁO KẾT QUẢ ĐÃ CÓ (loại Giao dịch).
//  Bộ template soạn lại 10/07 (qua panel adversarial) để LÁCH được kiểm duyệt Zalo — xem
//  05-Ky-thuat-AI/ZNS-BO-TEMPLATE-DE-DUYET-2026-07-10.md. CHỜ Zalo duyệt → điền ENV template id.
//  Đến khi có id, hàm fail-safe trả false (không gửi) — bật bằng cách set ENV, không phải sửa code.

// T2 — DẶN DÒ (CSKH). Tham số template: customer_name, ma_phieu_dieu_tri, ngay_dieu_tri.
const DANDO_TEMPLATE = process.env.ZNS_TEMPLATE_DANDO || null; // set sau khi duyệt
export function isDanDoEnabled() { return !!DANDO_TEMPLATE && /^(1|true|yes|on)$/i.test(process.env.ZNS_ENABLED || ''); }

/**
 * Gửi ZNS DẶN DÒ sau buổi điều trị. Trả true nếu Zalo nhận.
 * @param {string} phone SĐT (0xxx...)
 * @param {object} p { ten, ma_phieu (mã phiếu điều trị), ngay_dt (dd/MM/yyyy hoặc epoch giây) }
 */
export async function sendZnsDanDo(phone, { ten, ma_phieu, ngay_dt } = {}) {
  if (!isDanDoEnabled()) return false;
  const sdt = phone84(phone);
  if (!sdt) return false;
  const ngay = typeof ngay_dt === 'number' ? ngayVN(ngay_dt) : String(ngay_dt || ngayVN(Math.floor(Date.now() / 1000)));
  const goi = async () => axios.post(ZNS_API, {
    phone: sdt,
    template_id: DANDO_TEMPLATE,
    template_data: {
      customer_name: (ten || 'Quý khách').slice(0, 30),
      ma_phieu_dieu_tri: String(ma_phieu || `PDT-${sdt.slice(-5)}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 30),
      ngay_dieu_tri: ngay.slice(0, 20),
    },
    tracking_id: `dando-${Date.now()}`,
  }, { headers: { access_token: getAccessTokenNow() }, timeout: 20000, validateStatus: () => true, httpsAgent: zaloAgentV4 });
  try {
    let r = await goi();
    if ([-216, -124].includes(r.data?.error)) { await refreshAccessToken(); r = await goi(); }
    if (r.data?.error === 0) { console.log(`[zns] 💊 dặn dò sau điều trị → ${sdt.slice(0, 5)}***`); return true; }
    console.warn('[zns] dặn dò lỗi:', JSON.stringify(r.data).slice(0, 200));
    return false;
  } catch (err) { console.warn('[zns] dặn dò API lỗi:', err?.message); return false; }
}

// T3 — KẾT QUẢ ĐÃ CÓ (Giao dịch). Tham số: customer_name, ma_ho_so, ma_phieu, ngay_kham.
// TRUNG TÍNH: chỉ báo "kết quả đã có, mời đến nhận" — TUYỆT ĐỐI không chẩn đoán/chỉ số/tên thuốc.
const KETQUA_TEMPLATE = process.env.ZNS_TEMPLATE_KETQUA || null; // set sau khi duyệt
export function isKetQuaEnabled() { return !!KETQUA_TEMPLATE && /^(1|true|yes|on)$/i.test(process.env.ZNS_ENABLED || ''); }

/**
 * Gửi ZNS THÔNG BÁO KẾT QUẢ ĐÃ CÓ. Trả true nếu Zalo nhận.
 * @param {string} phone SĐT (0xxx...)
 * @param {object} p { ten, ma_ho_so, ma_phieu (mã phiếu kết quả), ngay_kham (dd/MM/yyyy hoặc epoch giây) }
 */
export async function sendZnsKetQua(phone, { ten, ma_ho_so, ma_phieu, ngay_kham } = {}) {
  if (!isKetQuaEnabled()) return false;
  const sdt = phone84(phone);
  if (!sdt) return false;
  const ngay = typeof ngay_kham === 'number' ? ngayVN(ngay_kham) : String(ngay_kham || ngayVN(Math.floor(Date.now() / 1000)));
  const goi = async () => axios.post(ZNS_API, {
    phone: sdt,
    template_id: KETQUA_TEMPLATE,
    template_data: {
      customer_name: (ten || 'Quý khách').slice(0, 30),
      ma_ho_so: String(ma_ho_so || `HL-${sdt.slice(-5)}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 30),
      ma_phieu: String(ma_phieu || `KQ-${sdt.slice(-5)}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 30),
      ngay_kham: ngay.slice(0, 20),
    },
    tracking_id: `ketqua-${Date.now()}`,
  }, { headers: { access_token: getAccessTokenNow() }, timeout: 20000, validateStatus: () => true, httpsAgent: zaloAgentV4 });
  try {
    let r = await goi();
    if ([-216, -124].includes(r.data?.error)) { await refreshAccessToken(); r = await goi(); }
    if (r.data?.error === 0) { console.log(`[zns] 📋 báo kết quả đã có → ${sdt.slice(0, 5)}***`); return true; }
    console.warn('[zns] kết quả lỗi:', JSON.stringify(r.data).slice(0, 200));
    return false;
  } catch (err) { console.warn('[zns] kết quả API lỗi:', err?.message); return false; }
}

/**
 * Gửi rating NGAY nếu trong khung 7h–21h VN; ngoài khung → xếp hàng chờ,
 * cron flushRatingCho() sẽ bắn vào khung giờ cho phép (ca thanh toán tối muộn → sáng mai).
 */
export async function guiHoacXepRating(phone, ten, maKH) {
  if (!RATING_ENABLED || !phone) return false;
  if (trongKhungGio()) return sendZnsRating(phone, { ten, maKH });
  store.setKV(`zns_rating_cho:${phone}`, JSON.stringify({ ten: ten || null, maKH: maKH || null }));
  console.log(`[zns] ⏰ ngoài khung giờ → xếp hàng rating cho ${String(phone).slice(0, 4)}***`);
  return true;
}

/** Xả hàng đợi rating (gọi từ cron POS mỗi 30'). */
export async function flushRatingCho() {
  if (!RATING_ENABLED || !trongKhungGio()) return 0;
  let n = 0;
  for (const row of store.listKVByPrefix('zns_rating_cho:')) {
    const phone = row.key.slice('zns_rating_cho:'.length);
    let d = {};
    try { d = JSON.parse(row.value || '{}'); } catch { /* rác → vẫn xoá */ }
    if (await sendZnsRating(phone, { ten: d.ten, maKH: d.maKH })) n++;
    store.delKV(row.key); // gửi xong/bị dedupe đều xoá — không kẹt hàng đợi
    await new Promise((s) => setTimeout(s, 300));
  }
  if (n) console.log(`[zns] ⭐ xả hàng đợi: gửi ${n} form đánh giá`);
  return n;
}
