// ============================================================
//  NHẮC LỊCH HẸN CHO KHÁCH (anh Trình duyệt 14/07): booking từ group Telegram
//  đã được xác nhận ZNS lúc chốt → sổ hẹn (store.bookings) → cron này nhắc lại
//  T-1 NGÀY và T-2 GIỜ trước giờ hẹn, dùng lại mẫu ZNS xác nhận lịch (đã duyệt,
//  4 tham số tên/mã/giờ hẹn — nội dung "thông tin lịch hẹn" nên nhắc lại vẫn đúng nghĩa).
//  Biên nhận gửi/lỗi → REPLY thẳng dưới tin Booking trong group Đặt Lịch (bot booking riêng).
// ============================================================
import axios from 'axios';
import * as store from './store.js';
import { sendZnsXacNhanLich } from './zns.js';

// Gửi biên nhận vào group đặt lịch (reply dưới tin Booking gốc nếu còn).
// Dùng TELEGRAM_BOOKING_TOKEN (bot riêng của group đặt lịch) — KHÔNG đụng bot thông báo.
export async function guiBienNhan(chatId, msgId, text) {
  const bt = process.env.TELEGRAM_BOOKING_TOKEN;
  if (!bt || !chatId) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${bt}/sendMessage`, {
      chat_id: chatId,
      text,
      reply_to_message_id: msgId || undefined,
      allow_sending_without_reply: true,
      parse_mode: 'HTML',
    }, { timeout: 15000 });
    return true;
  } catch (e) {
    console.warn('[booking] gửi biên nhận group lỗi:', e?.response?.data?.description || e?.message);
    return false;
  }
}

/**
 * "17:45 13/07" / "09:00 14/07/2026" / "16:30 18/07 TẠI Y Đạo" (đã qua chuanGioHen)
 * → epoch giây (giờ VN). null nếu không đọc được ngày giờ.
 */
export function parseHenEpoch(gioHenText, nowMs = Date.now()) {
  const m = String(gioHenText || '').match(/(\d{1,2}):(\d{2})\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const [, h, mi, d, mo, y] = m;
  const nowVN = new Date(nowMs + 7 * 3600 * 1000);
  const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : nowVN.getUTCFullYear();
  let epoch = Date.UTC(year, Number(mo) - 1, Number(d), Number(h) - 7, Number(mi)) / 1000;
  // thiếu năm + mốc lùi QUÁ 30 ngày → hiểu là năm sau (đặt lịch vắt qua giao thừa: cuối 12 book "05/01").
  // Hẹn mới qua vài giờ/vài ngày thì ĐỂ NGUYÊN quá khứ (booking cũ — không nhắc là đúng).
  if (!y && epoch < nowMs / 1000 - 30 * 86400) {
    epoch = Date.UTC(year + 1, Number(mo) - 1, Number(d), Number(h) - 7, Number(mi)) / 1000;
  }
  return Number.isFinite(epoch) ? Math.floor(epoch) : null;
}

const gioVN = () => new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();

/**
 * Cron tick (mỗi 10'): quét sổ hẹn, bắn nhắc đúng cửa sổ.
 *  - nhắc T-1 ngày: còn 3–24h tới hẹn, booking đã tạo >3h (khỏi nhắc dính ngay sau xác nhận)
 *  - nhắc T-2 giờ:  còn 15'–2h tới hẹn, booking đã tạo >90' (đặt sát giờ thì xác nhận là đủ)
 *  - chỉ chạy 7h–20h VN (ZNS ngoài giờ là phá khách)
 *  - markBookingNhac ghi TRƯỚC khi gửi — idempotent, lỗi giữa chừng không nhắc lặp (bài học taibill 429)
 */
export async function bookingNhacTick() {
  const h = gioVN();
  if (h < 7 || h >= 20) return;
  const now = Math.floor(Date.now() / 1000);
  for (const b of store.getBookingsSapDenHen(now)) {
    const conLai = b.hen_epoch - now;
    const tuoi = now - (b.created_at || now);
    let loai = null;
    if (!b.nhac1_at && conLai <= 24 * 3600 && conLai > 3 * 3600 && tuoi > 3 * 3600) loai = 'nhac1';
    else if (!b.nhac2_at && conLai <= 2 * 3600 && conLai > 15 * 60 && tuoi > 90 * 60) loai = 'nhac2';
    if (!loai) continue;

    store.markBookingNhac(b.id, loai);
    const nhan = loai === 'nhac1' ? 'trước 1 ngày' : 'trước 2 giờ';
    try {
      const r = await sendZnsXacNhanLich(b.phone, { ten: b.ten, gio_hen: b.gio_hen_text, loai });
      if (r.ok) {
        console.log(`[booking] ⏰ nhắc ${nhan} #${b.id} ${b.phone} (hẹn ${b.gio_hen_text}) OK`);
        await guiBienNhan(b.chat_id, b.msg_id,
          `⏰ Đã nhắc lịch ${nhan} qua Zalo: ${b.ten || 'khách'} ${b.phone} — hẹn ${b.gio_hen_text}`);
      } else if (r.ly_do !== 'vua_gui_roi') {
        console.warn(`[booking] nhắc ${nhan} #${b.id} ${b.phone} LỖI: ${r.ly_do}`);
        await guiBienNhan(b.chat_id, b.msg_id,
          `⚠️ Nhắc lịch ${nhan} qua Zalo KHÔNG gửi được (${r.ly_do}): ${b.ten || 'khách'} ${b.phone} — hẹn ${b.gio_hen_text}. Nhờ telesale gọi/nhắn tay giúp em ạ.`);
      }
    } catch (e) {
      console.error(`[booking] nhắc ${loai} #${b.id} lỗi:`, e?.message);
    }
  }
}
