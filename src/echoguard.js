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

// Chuẩn hoá tin để so khớp (bỏ ký tự lạ/khoảng trắng thừa, thường hoá, cắt 120 ký tự).
export function normalizeMsg(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim().toLowerCase().slice(0, 120);
}

// Lưu nội dung tin BOT vừa gửi (để phân biệt với tin telesale gõ tay khi webhook dội về).
// Map: conversationId -> [{text, at}]. Tự dọn entry cũ.
// CỬA SỔ 180s (không phải 60s): bot có humanDelay tới ~7s/ô + Pancake xử lý + webhook
// dội về có thể chậm. 60s quá ngắn → webhook tin-của-bot về muộn bị tưởng là telesale gõ tay.
const BOT_ECHO_WINDOW_MS = 180000;
const botSent = new Map();
export function noteBotSent(conversationId, text) {
  const arr = botSent.get(conversationId) || [];
  arr.push({ text: normalizeMsg(text), at: Date.now() });
  botSent.set(conversationId, arr.filter((x) => Date.now() - x.at < BOT_ECHO_WINDOW_MS));
}
export function wasSentByBot(conversationId, text) {
  const arr = botSent.get(conversationId) || [];
  const n = normalizeMsg(text);
  if (!n) return true; // tin rỗng/ảnh/sticker từ page → không coi là telesale gõ tay
  return arr.some((x) => {
    if (Date.now() - x.at >= BOT_ECHO_WINDOW_MS) return false;
    if (!x.text) return false;
    // khớp khít HOẶC một bên chứa bên kia (Pancake hay thêm/bớt ký tự, bọc link)
    if (x.text === n || x.text.includes(n) || n.includes(x.text)) return true;
    // khớp mềm: trùng phần lớn đầu chuỗi (link bị Pancake rút gọn/đổi đuôi)
    const head = n.slice(0, 40);
    return head.length >= 20 && x.text.includes(head);
  });
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
