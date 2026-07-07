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
import { getAccessTokenNow, refreshAccessToken } from './zalo.js';

const ZNS_API = 'https://business.openapi.zalo.me/message/template';
const HOTLINE = process.env.HOTLINE_PK || '0962349329';
const TEN_PK = process.env.TEN_PK || 'PK Cơ Xương Khớp Hiệp Lợi';

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
