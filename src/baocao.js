// ============================================================
//  B7 — BÁO CÁO TUẦN ZALO về Telegram (cron thứ 2, 08:00 giờ VN).
//  Đo sức khỏe cỗ máy Zalo: follower, hội thoại mới, ca đang chăm, quota đã tiêu.
import * as store from './store.js';
import { thongKe as quotaThongKe } from './quota.js';
import { demFollower } from './zalo.js';
import { notifyText } from './telegram.js';

export async function baoCaoTuanZalo() {
  const q = quotaThongKe();
  const t = store.thongKeTuanZalo();
  const follower = await demFollower();
  const homNay = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  // Bill theo nguồn — chỉ TỔNG theo nguồn, KHÔNG in SĐT/tên/bệnh (group chung, giữ riêng tư BN).
  const nguonStr = (t.billTheoNguon && t.billTheoNguon.length)
    ? t.billTheoNguon.map((r) => `${r.nguon}:${r.n}`).join(' · ')
    : '(chưa có dữ liệu — tích luỹ từ ngày deploy)';
  const tyLeSDT = t.convMoi ? Math.round((t.phoneCaptured / t.convMoi) * 100) : 0;

  const text =
    `📊 <b>BÁO CÁO ZALO TUẦN</b> (${homNay})\n` +
    `• Follower OA: <b>${follower ?? 'n/a'}</b>\n` +
    `• Hội thoại Zalo mới 7 ngày: <b>${t.convMoi}</b>\n` +
    `• Follower→SĐT tuần: <b>${t.phoneCaptured}/${t.convMoi}</b> (${tyLeSDT}%)\n` +
    `• Lịch đặt qua Zalo tuần: <b>${t.bookingZalo}</b>\n` +
    `• Ca chăm mới tuần / tổng: <b>${t.caChamTuan}</b> / ${t.caCham}\n` +
    `• Unfollow/block tuần: <b>${t.unfollowTuan}</b>\n` +
    `• Bill theo nguồn (tích luỹ): ${nguonStr}\n` +
    `• Quota tin tư vấn ${q.thang}: đã tiêu <b>${q.da_tieu}/${q.quota}</b> (còn ${q.con_lai}` +
    `${q.mien_phi_48h ? `, miễn phí 48h: ${q.mien_phi_48h}` : ''})\n` +
    `→ Xem chi tiết: /admin/zalo-quota`;

  await notifyText(text);
  return text;
}
