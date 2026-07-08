// ============================================================
//  SỔ CHỐNG ECHO dùng chung — mọi tin BOT gửi ra (Pancake HOẶC Zalo OpenAPI) phải ghi
//  vào đây, để khi Pancake dội tin page về webhook, handler phân biệt được "bot tự gửi"
//  với "telesale gõ tay" (nhầm là telesale → markHumanTaken → bot câm 6h).
//
//  Tách ra module riêng (07/07, ca Loan Le): trước đây sổ này nằm trong handler.js nên
//  CHỈ đường gửi Pancake có ghi; đường Zalo OpenAPI (lời chào follow, card xin SĐT,
//  chuỗi chăm care-send) gửi xong không ghi gì → echo dội về bị tưởng telesale gõ tay
//  → khách follow xong hỏi lại, bot im 6 tiếng. handler.js ↔ zalo.js import lẫn nhau
//  sẽ thành vòng, nên sổ đứng riêng cho cả hai cùng ghi.

import * as store from './store.js';

// Chuẩn hoá tin để so khớp (bỏ ký tự lạ/khoảng trắng thừa, thường hoá, cắt 120 ký tự).
export function normalizeMsg(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim().toLowerCase().slice(0, 120);
}

// Lưu nội dung tin BOT vừa gửi (để phân biệt với tin telesale gõ tay khi webhook dội về).
// HAI LỚP: RAM (nhanh) + kv DB (sống qua restart). CỬA SỔ 48H chứ không phải 180s nữa —
// ca Hạnh Nguyên 08/07: Pancake dội echo tin page kênh Zalo 2 LẦN, lần hai TRỄ TỚI 10 PHÚT
// → vượt cửa sổ ngắn → bot tưởng telesale gõ tay → tự khoá 6h ngay giữa lúc khách đang nhắn
// (khách đòi cẩm nang mà bot im 23 phút, cron rescue mới vớt). Tin bot là văn Gemini sinh
// từng ca — telesale thật gõ trùng nguyên văn gần như không xảy ra, nên khớp nội dung trong
// 48h an toàn hơn nhiều so với đoán theo thời gian.
const BOT_ECHO_WINDOW_MS = 48 * 3600 * 1000;
const KV_MAX_ENTRIES = 40; // giữ tối đa 40 tin gần nhất mỗi hội thoại trong kv
const botSent = new Map();

function docKvList(conversationId) {
  try { return JSON.parse(store.getKV(`bot_sent:${conversationId}`) || '[]'); } catch { return []; }
}
export function noteBotSent(conversationId, text) {
  const entry = { text: normalizeMsg(text), at: Date.now() };
  const arr = (botSent.get(conversationId) || []).filter((x) => Date.now() - x.at < BOT_ECHO_WINDOW_MS);
  arr.push(entry);
  botSent.set(conversationId, arr);
  try {
    const kvArr = docKvList(conversationId)
      .filter((x) => Date.now() - x.at < BOT_ECHO_WINDOW_MS)
      .slice(-(KV_MAX_ENTRIES - 1));
    kvArr.push(entry);
    store.setKV(`bot_sent:${conversationId}`, JSON.stringify(kvArr));
  } catch { /* kv hỏng không được làm chết luồng gửi */ }
}
function khopEcho(x, n) {
  if (Date.now() - x.at >= BOT_ECHO_WINDOW_MS) return false;
  if (!x.text) return false;
  // khớp khít HOẶC một bên chứa bên kia (Pancake hay thêm/bớt ký tự, bọc link)
  if (x.text === n || x.text.includes(n) || n.includes(x.text)) return true;
  // khớp mềm: trùng phần lớn đầu chuỗi (link bị Pancake rút gọn/đổi đuôi)
  const head = n.slice(0, 40);
  return head.length >= 20 && x.text.includes(head);
}
export function wasSentByBot(conversationId, text) {
  const n = normalizeMsg(text);
  if (!n) return true; // tin rỗng/ảnh/sticker từ page → không coi là telesale gõ tay
  if ((botSent.get(conversationId) || []).some((x) => khopEcho(x, n))) return true;
  return docKvList(conversationId).some((x) => khopEcho(x, n)); // echo trễ / sau restart
}

// Mốc thời gian bot gửi tin GẦN NHẤT cho mỗi hội thoại (epoch ms).
// Dùng để loại echo: tin page về NGAY sau khi bot vừa gửi (vài giây) gần như chắc chắn là
// echo của chính bot, KHÔNG phải telesale gõ tay. Telesale thật cần thời gian để đọc + gõ.
const lastBotSendAt = new Map();
export function noteBotJustSent(conversationId) {
  lastBotSendAt.set(String(conversationId), Date.now());
}
// Số ms từ lần bot gửi gần nhất trong hội thoại (null nếu chưa từng gửi).
export function lastBotSentAgoMs(conversationId) {
  const at = lastBotSendAt.get(String(conversationId));
  return at ? Date.now() - at : null;
}
// Cửa sổ nghi-ngờ-echo: tin page về trong khoảng này sau lần bot gửi cuối → coi là echo, bỏ qua.
export const ECHO_GRACE_MS = parseInt(process.env.ECHO_GRACE_MS || '30000', 10);
