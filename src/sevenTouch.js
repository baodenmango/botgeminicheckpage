// ============================================================
//  ENGINE 7 CHẠM — chạy trên bot Render (gom từ nhac-7cham local).
//  Quét Pancake các page → tính mốc chạm theo inserted_at (48h) → rẽ nhánh:
//   • Chạm 3/4/6 (AUTO giá trị): bot tự gửi (handleBotTouch, đã có).
//   • Chạm 2/5/7:
//       - CÓ SĐT  → BÁO Telegram cho telesale GỌI (notifyCallTouch). Bot KHÔNG tự nhắn.
//       - CHƯA SĐT → bot TỰ nhắn leo thang xin số (handleBotTouch → noiDungCham2/5/7).
//  Báo Telegram LỌC KỸ (đúng ý anh, không spam): chỉ ca có số / muốn đặt lịch chưa số / đặc biệt.
//  Chống trùng: cột touch_done trong bảng conversations (dùng chung với engine cũ).
// ============================================================
import axios from 'axios';
import { config } from './config.js';
import { isPageEnabled, hasStopLabel } from './pancake.js';
import { handleBotTouch } from './handler.js';
import { notifyCallTouch } from './telegram.js';
import { BOT_TOUCHES } from './touches.js';
import * as store from './store.js';

const PANCAKE_TOKEN = process.env.PANCAKE_API_TOKEN || null;
const API_BASE = process.env.PANCAKE_API_BASE_V1 || 'https://pages.fm/api/v1';
const WINDOW_HOURS = parseFloat(process.env.TOUCH_WINDOW_HOURS || '48'); // cửa sổ lead
const GRACE_HOURS = parseFloat(process.env.TOUCH_GRACE_HOURS || '6');    // trễ tối đa sau mốc
// ⚠️ CHỐNG BÙNG NỔ COLD-START: lần đầu deploy, DB chưa có touch_done cho lead CŨ → engine có thể
// thấy hàng chục lead tới mốc cùng lúc → bắn loạt tin (lộ bot + phiền khách). Cap số chạm THẬT
// (bot gửi/telesale báo) mỗi lượt cron. Lead vượt cap sẽ được đánh dấu "đã chạm" để KHÔNG bùng lại
// lượt sau (coi như lỡ — an toàn hơn spam). Chỉnh qua env; mặc định 8/lượt.
const MAX_PER_RUN = parseInt(process.env.SEVEN_TOUCH_MAX_PER_RUN || '8', 10);

// Chạm CALL (telesale gọi khi có số) vs AUTO (bot tự gửi luôn). 2/5/7 = CALL-hoặc-tự tùy có số.
const CALL_TOUCHES = new Set([2, 5, 7]);

// Giờ kể từ inserted_at (Pancake trả UTC KHÔNG hậu tố Z → phải ép UTC, nếu không lệch 7h).
function hoursSince(insertedAt) {
  if (!insertedAt) return null;
  let s = String(insertedAt);
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  const t = new Date(s).getTime();
  if (isNaN(t)) return null;
  return (Date.now() - t) / 36e5;
}

// SĐT của lead từ payload Pancake (recent_phone_numbers) — chuẩn 10 số.
function phoneOf(c) {
  const rp = (c.recent_phone_numbers || [])[0];
  const raw = rp && (rp.phone_number || rp.captured);
  if (!raw) return null;
  const s = String(raw).replace(/[^\d]/g, '');
  return /^0(3|5|7|8|9)\d{8}$/.test(s) ? s : (s.length >= 9 ? s : null);
}

function nameOf(c) {
  return c.from?.name || c.customers?.[0]?.name || null;
}

// Lấy lead 1 page qua Pancake API v1 (như nhac-7cham/getLeads).
async function getLeads(pageId) {
  const url = `${API_BASE}/pages/${pageId}/conversations`;
  try {
    const { data } = await axios.get(url, {
      params: { access_token: PANCAKE_TOKEN, page_number: 1 },
      timeout: 20000,
    });
    return Array.isArray(data?.conversations) ? data.conversations : [];
  } catch (err) {
    console.error(`[7cham] đọc Pancake page ${pageId} lỗi:`, err?.response?.status || err.message);
    return [];
  }
}

// Mốc chạm CAO NHẤT đã tới hạn (và còn trong grace) cho 1 lead. Trả {no, muctieu} hoặc null.
function chamToiHan(hrs) {
  let best = null;
  for (const t of BOT_TOUCHES) {
    // đã qua mốc t.hours, chưa quá mốc + grace (tránh chạm lead đã nguội hẳn)
    if (hrs >= t.hours && hrs <= t.hours + GRACE_HOURS) {
      if (!best || t.hours > best.hours) best = t;
    }
  }
  return best;
}

/**
 * Quét toàn bộ page → xử 1 lượt chạm. Gọi bởi cron (index.js).
 * Trả về số việc đã làm (để log).
 */
export async function runSevenTouch() {
  if (!PANCAKE_TOKEN) {
    console.warn('[7cham] thiếu PANCAKE_API_TOKEN → bỏ (engine 7 chạm cần token quét Pancake)');
    return 0;
  }
  let done = 0;      // tổng việc (báo telesale + bot tự chạm)
  let botSent = 0;   // riêng số tin BOT tự gửi — áp cap cold-start
  const pageIds = Object.keys(config.pancakePages);
  for (const pageId of pageIds) {
    if (!isPageEnabled(pageId)) continue;
    const leads = await getLeads(pageId);
    for (const c of leads) {
      const convId = c.id;
      if (!convId) continue;
      const hrs = hoursSince(c.inserted_at);
      if (hrs == null || hrs > WINDOW_HOURS) continue;   // ngoài cửa sổ 48h

      const cham = chamToiHan(hrs);
      if (!cham) continue;                                // chưa tới mốc nào

      // đảm bảo có bản ghi để lưu touch_done + trạng thái
      const conv = store.ensureConversation(convId, pageId, nameOf(c));
      if (store.isOptedOut(conv)) continue;               // khách xin ngừng
      if (store.isTouchDone(conv, cham.no)) continue;     // đã chạm mốc này rồi
      if (store.isHandover(conv)) continue;               // đang cần người

      // nhãn telesale chốt/xử ngoài inbox → dừng, đánh dấu để khỏi lặp
      if (await hasStopLabel(pageId, convId)) { store.markTouchDone(convId, cham.no); continue; }

      const phonePancake = phoneOf(c);
      const daCoSo = Boolean(phonePancake) || store.isCaptured(conv);

      // ---- RẼ NHÁNH ----
      if (CALL_TOUCHES.has(cham.no) && daCoSo) {
        // CÓ SỐ ở chạm 2/5/7 → telesale GỌI (báo Telegram). QUAN TRỌNG + ít → KHÔNG áp cap cold-start.
        if (phonePancake && !store.isCaptured(conv)) store.setPhoneCaptured(convId, phonePancake, nameOf(c));
        await notifyCallTouch({
          touchNo: cham.no,
          name: nameOf(c),
          phone: phonePancake || conv.phone,
          condition: conv.condition || 'unknown',
          summary: conv.summary || null,
          muctieu: cham.muctieu,
          pageId,
          conversationId: convId,
        });
        store.markTouchDone(convId, cham.no);
        for (const lower of [2, 3, 4, 5, 6, 7]) if (lower < cham.no) store.markTouchDone(convId, lower);
        console.log(`[7cham] 📞 chạm ${cham.no} CÓ SỐ → báo telesale gọi (${convId})`);
        done++;
      } else {
        // CHƯA SỐ (mọi chạm) hoặc chạm AUTO 3/4/6 → bot TỰ gửi. Áp CAP cold-start để không bùng nổ:
        // quá ngưỡng/lượt → đánh dấu đã chạm (coi như lỡ) để KHÔNG dồn lại bắn loạt lượt sau.
        if (botSent >= MAX_PER_RUN) {
          store.markTouchDone(convId, cham.no);
          continue;
        }
        await handleBotTouch({ conversation_id: convId, page_id: pageId }, cham.no);
        botSent++;
        done++;
      }
    }
  }
  if (done) console.log(`[7cham] xong 1 lượt — ${done} việc chạm`);
  return done;
}
