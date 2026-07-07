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
import * as store from './store.js';
import { getAccessTokenNow, refreshAccessToken } from './zalo.js';

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
export async function sendZnsNhacLich(phone, { ten, ngay_hen } = {}) {
  if (!isZnsEnabled()) return false;
  const sdt = phone84(phone);
  if (!sdt || !ngay_hen) return false;
  // Tham số khớp template ZBS 603887 "Nhắc lịch hẹn điều trị" (tạo + nộp duyệt 07/07/2026):
  // customer_name (Tên khách hàng, ≤30) + schedule_time (Thời gian, ≤20, vd "08:30 15/07/2026").
  const goi = async () => axios.post(ZNS_API, {
    phone: sdt,
    template_id: process.env.ZNS_TEMPLATE_NHACLICH,
    template_data: {
      customer_name: (ten || 'Quý khách').slice(0, 30),
      schedule_time: String(ngay_hen).slice(0, 20),
    },
    tracking_id: `nhaclich-${Date.now()}`,
  }, { headers: { access_token: getAccessTokenNow() }, timeout: 20000, validateStatus: () => true });

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
  }, { headers: { access_token: getAccessTokenNow() }, timeout: 20000, validateStatus: () => true });

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
