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

  const text =
    `📊 <b>BÁO CÁO ZALO TUẦN</b> (${homNay})\n` +
    `• Follower OA: <b>${follower ?? 'n/a'}</b>\n` +
    `• Hội thoại Zalo mới 7 ngày: <b>${t.convMoi}</b>\n` +
    `• Ca trong chuỗi chăm (bill/tái bill): <b>${t.caCham}</b>\n` +
    `• Quota tin tư vấn ${q.thang}: đã tiêu <b>${q.da_tieu}/${q.quota}</b> (còn ${q.con_lai})\n` +
    `→ Xem chi tiết: /admin/zalo-quota`;

  await notifyText(text);
  return text;
}
