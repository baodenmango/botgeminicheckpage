// ============================================================
//  ENGINE VỚT LEAD BỎ RƠI — vá lỗ webhook rớt (bot chết tạm lúc deploy / Pancake không gửi lại).
//  Triệu chứng: KHÁCH nhắn cuối nhưng bot/telesale CHƯA rep (tin cuối là của khách) → lead nguội.
//  Cách vá: quét Pancake định kỳ, tìm ca "khách nhắn cuối + chưa ai rep + đã quá X phút"
//  → đọc tin cuối của khách → đẩy vào handleIncoming như webhook THẬT (tái dùng toàn bộ logic bot:
//  lock chống trùng, human-taken, stop-label, chốt số, booking...).
//
//  GUARD chống trùng với webhook: chỉ vớt ca khách nhắn cuối ĐÃ LÂU hơn RESCUE_MIN_IDLE_MIN phút
//  (webhook thường về trong vài giây; quá ngưỡng mà chưa rep = webhook đã rớt). Ngoài cửa sổ
//  RESCUE_WINDOW_HOURS thì thôi (lead quá cũ, để engine 7 chạm/retouch lo).
// ============================================================
import axios from 'axios';
import { config } from './config.js';
import { isPageEnabled, getLastCustomerMessage, getPageToken, stripChannelPrefix } from './pancake.js';
import { handleIncoming } from './handler.js';
import * as store from './store.js';

const PANCAKE_TOKEN = process.env.PANCAKE_API_TOKEN || null;
const API_BASE = process.env.PANCAKE_API_BASE_V1 || 'https://pages.fm/api/v1';
// Đường CHÍNH: quét list bằng token TỪNG PAGE (public_api, luôn có sẵn vì bot cần nó để nhận/gửi).
// PANCAKE_API_TOKEN (user token) chỉ còn là DỰ PHÒNG — trước đây bắt buộc, thiếu là engine câm lặng.
const API_BASE_PUBLIC = process.env.PANCAKE_API_BASE || 'https://pages.fm/api/public_api/v1';
const MIN_IDLE_MIN = parseFloat(process.env.RESCUE_MIN_IDLE_MIN || '3');   // khách nhắn cuối phải cũ hơn (phút)
const WINDOW_HOURS = parseFloat(process.env.RESCUE_WINDOW_HOURS || '72');  // chỉ vớt lead trong 72h
const MAX_PER_RUN = parseInt(process.env.RESCUE_MAX_PER_RUN || '10', 10);  // cap mỗi lượt (an toàn)
// Quá ngưỡng này mà KHÔNG AI rep (kể cả telesale) → coi cờ human là KẸT OAN, gỡ cờ + vớt luôn.
// (SLA telesale ≤5'; 20' im lặng = không ai xử thật. Ca Sen Vàng 02/07: tin auto Meta đánh cờ
// human oan → bot câm + rescue né suốt 30'. Nhãn "đã đặt lịch/telesale xử" vẫn chặn ở handleIncoming.)
const HUMAN_OVERRIDE_MIN = parseFloat(process.env.RESCUE_HUMAN_OVERRIDE_MIN || '20');

// CHỐNG VỚT LẶP VÔ HẠN: khách chặn page / khoá nick / hết cửa sổ 24h Meta → gửi HỤT (#551),
// Pancake vẫn thấy "khách nhắn cuối" → không có guard là cron 5' thử lại mãi (đốt Gemini + spam log).
// Mỗi (conv + mốc tin khách) chỉ thử 1 lần; lỗi tạm thời thì được thử lại sau RETRY_HOURS.
const RETRY_HOURS = parseFloat(process.env.RESCUE_RETRY_HOURS || '6');
const attempted = new Map(); // convId -> { mark: mốc tin khách đã thử, at: lúc thử }

// phút kể từ mốc thời gian (chuỗi Pancake UTC không hậu tố Z → ép UTC).
function minutesSince(ts) {
  if (!ts) return null;
  let s = String(ts);
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  const t = new Date(s).getTime();
  if (isNaN(t)) return null;
  return (Date.now() - t) / 60000;
}

async function getConvs(pageId) {
  const pageToken = getPageToken(pageId);
  const until = Math.floor(Date.now() / 1000);
  const since = until - Math.floor(WINDOW_HOURS * 3600); // list endpoint CẦN since/until, thiếu là trả rỗng
  try {
    if (pageToken) {
      const { data } = await axios.get(`${API_BASE_PUBLIC}/pages/${pageId}/conversations`, {
        params: { page_access_token: pageToken, since, until, page_number: 1 },
        timeout: 20000,
      });
      const list = data?.conversations || data?.data;
      if (Array.isArray(list)) return list;
      console.warn(`[rescue] page ${pageId} list qua page-token không trả mảng → thử user token`);
    }
    if (PANCAKE_TOKEN) {
      const { data } = await axios.get(`${API_BASE}/pages/${pageId}/conversations`, {
        params: { access_token: PANCAKE_TOKEN, page_number: 1 },
        timeout: 20000,
      });
      return Array.isArray(data?.conversations) ? data.conversations : [];
    }
    console.warn(`[rescue] page ${pageId} không có token nào đọc được list → bỏ page này`);
    return [];
  } catch (err) {
    console.error(`[rescue] đọc Pancake page ${pageId} lỗi:`, err?.response?.status || err.message);
    return [];
  }
}

// Người gửi CUỐI có phải KHÁCH không (không phải page/bot). true = khách nhắn cuối → cần vớt.
// So theo phần lõi (bỏ tiền tố zl_/ttm_...): Zalo lúc "zl_3136..." lúc "3136..." tùy endpoint —
// so khít sẽ coi tin của chính OA là tin khách → bot tự trả lời chính mình lặp vô hạn.
function khachNhanCuoi(c, pageId) {
  const lsb = c.last_sent_by;
  if (!lsb) return false;
  return stripChannelPrefix(lsb.id) !== stripChannelPrefix(pageId);
}

/**
 * Quét toàn bộ page → vớt ca khách nhắn cuối chưa rep. Gọi bởi cron.
 * @returns {Promise<number>} số ca đã đẩy vào xử lý.
 */
export async function runRescueLead() {
  let done = 0;
  for (const pageId of Object.keys(config.pancakePages)) {
    if (!isPageEnabled(pageId)) continue;
    const convs = await getConvs(pageId);
    for (const c of convs) {
      if (done >= MAX_PER_RUN) break;
      const convId = c.id;
      if (!convId) continue;
      // CHỈ vớt INBOX (FB messenger + Zalo + TikTok đều INBOX). COMMENT là việc của Meta auto-rep,
      // đẩy comment vào handleIncoming là bot rep nhầm kênh.
      if (String(c.type || '').toUpperCase() !== 'INBOX') continue;
      if (!khachNhanCuoi(c, pageId)) continue;            // page/bot nhắn cuối → khách chưa hỏi mới

      // đủ lâu chưa? (webhook về ngay trong vài giây; quá ngưỡng = webhook rớt)
      const idle = minutesSince(c.last_customer_interactive_at || c.updated_at);
      if (idle == null || idle < MIN_IDLE_MIN) continue;   // vừa nhắn → để webhook lo, tránh trùng
      if (idle > WINDOW_HOURS * 60) continue;              // quá cũ → thôi

      // đã thử vớt ĐÚNG tin này rồi (khách chặn page/hết cửa sổ 24h → gửi hụt hoài) → chờ khách
      // nhắn mới hoặc quá RETRY_HOURS mới thử lại, không xay Gemini mỗi 5 phút.
      const mark = String(c.last_customer_interactive_at || c.updated_at || '');
      const prev = attempted.get(convId);
      if (prev && prev.mark === mark && Date.now() - prev.at < RETRY_HOURS * 3600 * 1000) continue;

      // trạng thái: bỏ ca đang có người giữ / handover / opt-out / nhãn stop
      const conv = store.getConversation(convId);
      if (conv) {
        if (store.isOptedOut(conv)) continue;
        if (store.isHandover(conv)) continue;
        if (store.isHumanActive(conv, parseFloat(process.env.HUMAN_HOLD_HOURS || '6'))) {
          // cờ human nhưng khách chờ QUÁ LÂU không ai rep → cờ kẹt oan (tin auto Meta/echo) → gỡ + vớt
          if (idle < HUMAN_OVERRIDE_MIN) continue;
          store.clearHumanTaken(convId);
          console.log(`[rescue] ⚠️ ${convId} cờ human nhưng khách chờ ${Math.round(idle)}p không ai rep → gỡ cờ kẹt, vớt luôn`);
        }
      }

      // đọc ĐÚNG tin cuối của khách rồi đẩy vào handleIncoming như webhook thật
      let last;
      try { last = await getLastCustomerMessage(pageId, convId); }
      catch { last = null; }
      if (!last || !last.messageText) continue;             // tin cuối thực ra là của page → bỏ

      attempted.set(convId, { mark, at: Date.now() });
      if (attempted.size > 500) { // giữ map gọn — xoá mục cũ nhất
        const oldest = [...attempted.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) attempted.delete(oldest[0]);
      }
      console.log(`[rescue] 🛟 vớt lead ${convId} (khách nhắn cuối ${Math.round(idle)}p chưa rep): "${last.messageText.slice(0, 40)}"`);
      // KHÔNG await để 1 ca treo không chặn cả vòng; handleIncoming tự có lock chống trùng.
      handleIncoming({
        conversationId: convId,
        pageId,
        customerName: last.customerName || c.from?.name || null,
        messageText: last.messageText,
      });
      done++;
      // giãn nhịp giữa các ca → tránh Pancake rate-limit (429) khi vớt loạt nhiều lead cùng lúc.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (done) console.log(`[rescue] xong 1 lượt — vớt ${done} lead bị bỏ rơi`);
  return done;
}
