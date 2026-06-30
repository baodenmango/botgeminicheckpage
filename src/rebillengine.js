// ============================================================
//  ENGINE TÁI BILL theo 4 NHÓM (bước 6 — thiết kế mục D + D-TER).
//  Đọc bill_care (đã gắn group_no + mốc) → tới mốc của từng chạm thì gửi qua Zalo OA.
//  Chạm có `day >= 0` = SAU mốc (timeField đã qua day ngày); `day < 0` = TRƯỚC mốc (nhắc trước buổi hẹn).
//  Chống trùng: group_cham_done. Đặt lịch tái khám/đi buổi tiếp → engine ngoài đánh rebooked → dừng.
import * as store from './store.js';
import { REBILL_TOUCHES, buildRebillMessages } from './rebilltouches.js';
import { sendCareMessages } from './care-send.js';

const DAY = 86400;
const GRACE_DAYS = parseFloat(process.env.REBILL_GRACE_DAYS || '1.5');

/**
 * Vòng cron: với mỗi chạm tái bill, tìm ca tới hạn & chưa gửi → gửi.
 * KHÔNG gom "mốc cao nhất" như bill (các nhóm tách biệt theo timeField/đòn khác nhau,
 * mỗi chạm là 1 thông điệp riêng) — nhưng vẫn 1 ca chỉ nhận MỖI mã chạm 1 lần (group_cham_done).
 */
export async function runGroupTouches() {
  const now = Math.floor(Date.now() / 1000);
  let sent = 0;
  // gom theo ca: 1 lượt cron mỗi ca chỉ gửi 1 chạm (tránh dồn nhiều tin cùng lúc)
  const chon = new Map(); // id -> { rec, code, prio }
  for (const t of REBILL_TOUCHES) {
    let minSec, maxSec;
    if (t.day >= 0) {
      // SAU mốc: timeField <= now - day*DAY (đã qua), và >= now-(day+grace)*DAY (chưa quá grace)
      maxSec = now - t.day * DAY;
      minSec = now - (t.day + GRACE_DAYS) * DAY;
    } else {
      // TRƯỚC mốc: timeField ở tương lai |day| ngày. Cửa sổ gửi: trong khoảng [|day|, |day|+grace] ngày tới.
      const ahead = Math.abs(t.day);
      minSec = now + ahead * DAY;
      maxSec = now + (ahead + GRACE_DAYS) * DAY;
    }
    const targets = store.findGroupTargets(t.group, t.timeField, minSec, maxSec, t.code);
    for (const rec of targets) {
      // ưu tiên chạm "khẩn" hơn nếu trùng ca: lỡ buổi (g2_miss) > nhắc sát (pre1) > còn lại
      const prio = t.code === 'g2_miss' ? 3 : t.code.endsWith('pre1') ? 2 : 1;
      const cur = chon.get(rec.id);
      if (!cur || prio > cur.prio) chon.set(rec.id, { rec, code: t.code, prio });
    }
  }
  if (chon.size === 0) return 0;
  console.log(`[rebill] ${chon.size} ca tái bill tới mốc chạm`);
  for (const { rec, code } of chon.values()) {
    try {
      const messages = buildRebillMessages(code, rec);
      if (!messages) { store.markGroupChamDone(rec.id, code); continue; }
      const ok = await sendCareMessages(rec, messages);
      if (ok) {
        store.markGroupChamDone(rec.id, code);
        sent++;
        console.log(`[rebill] ✅ gửi chạm ${code} (nhóm ${rec.group_no}) cho ca ${rec.id}`);
      } else {
        console.warn(`[rebill] gửi hụt chạm ${code} ca ${rec.id} → giữ lại thử lần sau`);
      }
    } catch (err) {
      console.error(`[rebill] lỗi gửi chạm ${code} ca ${rec.id}:`, err?.message || err);
    }
  }
  return sent;
}
