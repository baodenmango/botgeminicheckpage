// Lõi xử lý hội thoại — dùng chung cho webhook (tin mới) và cron (retouch).
import { generateReply } from './gemini.js';
import { sendMessages, isPageEnabled } from './pancake.js';
import * as store from './store.js';
import { extractPhone } from './utils.js';
import { notifyLead, notifyHandover } from './telegram.js';

// Khóa theo conversation_id để KHÔNG xử lý 2 lượt chồng nhau cùng lúc.
const locks = new Set();

// Map bệnh → sale page (đồng bộ với mục 6 system prompt).
const SALE_PAGE = {
  goi: 'https://thoaihoakhop.phongkhamhieploi.vn/',
  vai: 'https://dauvai.phongkhamhieploi.vn/',
  gut: 'https://benhgut.phongkhamhieploi.vn/',
  lung: 'https://daulung.phongkhamhieploi.vn/',
  tvdd: 'https://tvdd.phongkhamhieploi.vn/',
  covaigay: 'https://covaigay.phongkhamhieploi.vn/',
};

// Đảm bảo có 1 ô chứa link sale page đúng bệnh (nếu Gemini quên chèn).
// Trả về mảng messages đã được bổ sung link khi cần.
function ensureSalePageLink(messages, condition, conv) {
  const link = SALE_PAGE[condition];
  if (!link) return messages; // bệnh chưa rõ / khác → không ép link
  const already = messages.some((m) => m.includes('phongkhamhieploi.vn'));
  if (already) return messages;
  // đã gửi link cho hội thoại này trước đó chưa? (tránh spam lại mỗi lượt)
  if (conv && conv.condition && conv.sale_link_sent) return messages;
  // chèn link thành 1 ô riêng, đặt trước ô cuối (thường ô cuối là xin SĐT)
  const out = [...messages];
  const linkMsg = `Anh/chị tham khảo thêm thông tin tình trạng của mình ở đây nha ạ: ${link}`;
  if (out.length >= 2) out.splice(out.length - 1, 0, linkMsg);
  else out.push(linkMsg);
  return out.slice(0, 5); // tối đa 5 ô
}

/**
 * Xử lý 1 tin nhắn mới của khách.
 * @param {object} ev - { conversationId, pageId, customerId, customerName, messageText }
 */
export async function handleIncoming(ev) {
  const { conversationId, pageId, customerName, messageText } = ev;
  if (!conversationId || !pageId) return;
  if (!isPageEnabled(pageId)) return; // trang chưa bật bot → bỏ qua
  if (!messageText || !messageText.trim()) return;

  if (locks.has(conversationId)) {
    console.log(`[handler] ${conversationId} đang xử lý, bỏ qua tin chồng`);
    return;
  }
  locks.add(conversationId);
  try {
    const conv = store.ensureConversation(conversationId, pageId, customerName);

    // Đã giao người (có SĐT / handover) → ngừng auto-reply.
    if (store.isHandled(conv)) {
      console.log(`[handler] ${conversationId} đã giao người → không auto-reply`);
      return;
    }

    // Lưu tin khách + cập nhật mốc thời gian (cho retouch).
    store.appendHistory(conversationId, 'user', messageText);
    store.markCustomerMessaged(conversationId);

    // Chốt SĐT bằng regex ngay cả khi Gemini chưa nhận ra.
    const phoneByRegex = extractPhone(messageText);

    const history = store.getConversation(conversationId).history;
    const reply = await generateReply(history, 'reply', customerName || conv.customer_name);

    await dispatch(conversationId, pageId, conv, reply, phoneByRegex, customerName);
  } catch (err) {
    console.error('[handler] lỗi handleIncoming:', err?.message || err);
  } finally {
    locks.delete(conversationId);
  }
}

/**
 * Xử lý 1 lượt CHẠM LẠI (retouch) do cron gọi.
 */
export async function handleRetouch(conv) {
  const { conversation_id: conversationId, page_id: pageId } = conv;
  if (locks.has(conversationId)) return;
  locks.add(conversationId);
  try {
    const fresh = store.getConversation(conversationId);
    if (!fresh || store.isHandled(fresh)) return; // đã giao người trong lúc chờ
    const reply = await generateReply(fresh.history, 'retouch', fresh.customer_name);
    // retouch chỉ gửi tin nhắc, không kỳ vọng có SĐT — nhưng vẫn xử lý nếu có
    await dispatch(conversationId, pageId, fresh, reply, null, fresh.customer_name);
    store.incRetouch(conversationId);
    console.log(`[retouch] đã chạm lại ${conversationId} (lần ${fresh.retouch_count + 1})`);
  } catch (err) {
    console.error('[handler] lỗi handleRetouch:', err?.message || err);
  } finally {
    locks.delete(conversationId);
  }
}

// Gửi phản hồi + xử lý SĐT / handover + lưu lịch sử bot.
async function dispatch(conversationId, pageId, conv, reply, phoneByRegex, customerName) {
  // Phân loại bệnh để thống kê — chỉ lưu khi nhận diện được (khác unknown),
  // để KHÔNG ghi đè condition đã biết ở lượt trước bằng 'unknown' của lượt cuối.
  if (reply.condition && reply.condition !== 'unknown') {
    store.setCondition(conversationId, reply.condition);
  }

  // Lấy condition ĐÃ NHỚ trong DB (gối/vai/lưng...) thay vì chỉ của lượt cuối.
  const knownCondition =
    (store.getConversation(conversationId)?.condition) || reply.condition || 'unknown';

  // ĐẢM BẢO gửi link sale page đúng bệnh (nếu Gemini quên chèn).
  let outMessages = ensureSalePageLink(reply.messages, knownCondition, conv);
  const linkWasAdded = outMessages.length !== reply.messages.length ||
    outMessages.some((m, i) => m !== reply.messages[i]);

  // Gửi các ô thoại về khách qua Pancake
  await sendMessages(pageId, conversationId, outMessages);
  // Lưu lượt bot vào lịch sử (gộp các ô thành 1 lượt 'model')
  store.appendHistory(conversationId, 'model', outMessages.join('\n'));
  // Đánh dấu đã gửi link để không lặp lại mỗi lượt
  if (linkWasAdded && SALE_PAGE[knownCondition]) {
    store.markSaleLinkSent(conversationId);
  }

  // ƯU TIÊN SĐT: regex hoặc Gemini báo phone_captured
  const phone = phoneByRegex || reply.phone || null;
  const captured = Boolean(phone) || reply.phone_captured;

  if (captured && phone) {
    store.setPhoneCaptured(conversationId, phone, reply.name || customerName);
    await notifyLead({
      name: reply.name || customerName,
      phone,
      condition: knownCondition,
      pageId,
      conversationId,
    });
    console.log(`[lead] 🔥 ${conversationId} có SĐT ${phone} → đã báo Telegram`);
    return;
  }

  // HANDOVER (khiếu nại / hỏi sâu chuyên môn)
  if (reply.handover) {
    store.setHandover(conversationId);
    await notifyHandover({
      name: reply.name || customerName,
      reason: reply.handover_reason,
      condition: knownCondition,
      pageId,
      conversationId,
    });
    console.log(`[handover] ⚠️ ${conversationId} → đã báo Telegram (${reply.handover_reason || 'n/a'})`);
  }
}
