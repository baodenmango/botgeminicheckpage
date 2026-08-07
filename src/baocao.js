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

  // Đánh giá sao (sổ rating_log — kéo từ Zalo qua rating/get, xem /admin/danh-gia).
  // Tách lượt 7 ngày để thấy nhịp tuần; ca ≤3★ đã réo riêng lúc kéo về, đây chỉ là tổng.
  let dgStr = '(chưa có lượt nào)';
  try {
    const ds = store.listKVByPrefix('rating_log:').map((r) => { try { return JSON.parse(r.value); } catch { return null; } }).filter((r) => r && r.sao >= 1 && r.sao <= 5);
    if (ds.length) {
      const tb = Math.round(ds.reduce((s, r) => s + r.sao, 0) / ds.length * 100) / 100;
      const tuanQua = ds.filter((r) => (r.luc || 0) > Date.now() / 1000 - 7 * 86400);
      const cheTuan = tuanQua.filter((r) => r.sao <= 3).length;
      dgStr = `TB <b>${tb}★</b>/${ds.length} lượt · tuần này +${tuanQua.length}${cheTuan ? ` (⚠️ ${cheTuan} ca ≤3★)` : ''}`;
    }
  } catch { /* không chặn báo cáo */ }

  const text =
    `📊 <b>BÁO CÁO ZALO TUẦN</b> (${homNay})\n` +
    `• Follower OA: <b>${follower ?? 'n/a'}</b>\n` +
    `• Hội thoại Zalo mới 7 ngày: <b>${t.convMoi}</b>\n` +
    `• Follower→SĐT tuần: <b>${t.phoneCaptured}/${t.convMoi}</b> (${tyLeSDT}%)\n` +
    `• Lịch đặt qua Zalo tuần: <b>${t.bookingZalo}</b>\n` +
    `• Ca chăm mới tuần / tổng: <b>${t.caChamTuan}</b> / ${t.caCham}\n` +
    `• Unfollow/block tuần: <b>${t.unfollowTuan}</b>\n` +
    `• Đánh giá sao: ${dgStr}\n` +
    `• Bill theo nguồn (tích luỹ): ${nguonStr}\n` +
    `• Quota tin tư vấn ${q.thang}: đã tiêu <b>${q.da_tieu}/${q.quota}</b> (còn ${q.con_lai}` +
    `${q.mien_phi_48h ? `, miễn phí 48h: ${q.mien_phi_48h}` : ''})\n` +
    `→ Xem chi tiết: /admin/zalo-quota`;

  await notifyText(text);
  return text;
}
