// Lõi xử lý hội thoại — dùng chung cho webhook (tin mới) và cron (retouch).
import { generateReply } from './gemini.js';
import { sendMessages, isPageEnabled, hasStopLabel, hasCustomerLabel, getPageChannel } from './pancake.js'; // sendMessages dùng cả khi xin lại SĐT sai
import * as store from './store.js';
import { extractPhone, extractPhoneFromHistory, diagnoseBadPhone } from './utils.js';
import { notifyLead, notifyHandover, notifyHandoverNudge, isUrgent } from './telegram.js';
import { buildTouchMessages } from './touches.js';
import { isZaloPage, stripZaloPrefix } from './zalo.js';
import { lookupMedi, buildContextTag } from './medi.js';
import { SALE_PAGE } from './conditions.js';

// Khóa theo conversation_id để KHÔNG xử lý 2 lượt chồng nhau cùng lúc.
// Map (không Set): lưu thời điểm khóa để TỰ HẾT HẠN sau LOCK_TTL — chống kẹt vĩnh viễn
// nếu 1 lượt xử lý bị treo (Gemini/sendMessages hang) → conv đó sẽ không câm mãi.
const locks = new Map();
const LOCK_TTL_MS = parseInt(process.env.LOCK_TTL_MS || '60000', 10);
function lockHeld(id) {
  const at = locks.get(String(id));
  if (!at) return false;
  if (Date.now() - at > LOCK_TTL_MS) { locks.delete(String(id)); return false; } // hết hạn → coi như mở
  return true;
}
function lockAcquire(id) { locks.set(String(id), Date.now()); }
function lockRelease(id) { locks.delete(String(id)); }

// Lưu nội dung tin BOT vừa gửi (để phân biệt với tin telesale gõ tay khi webhook dội về).
// Map: conversationId -> [{text, at}]. Tự dọn entry cũ.
// CỬA SỔ 180s (không phải 60s): bot có humanDelay tới ~7s/ô + Pancake xử lý + webhook
// dội về có thể chậm. 60s quá ngắn → webhook tin-của-bot về muộn bị tưởng là telesale gõ tay.
const BOT_ECHO_WINDOW_MS = 180000;
const botSent = new Map();
function noteBotSent(conversationId, text) {
  const arr = botSent.get(conversationId) || [];
  arr.push({ text: normalizeMsg(text), at: Date.now() });
  botSent.set(conversationId, arr.filter((x) => Date.now() - x.at < BOT_ECHO_WINDOW_MS));
}
function wasSentByBot(conversationId, text) {
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
function normalizeMsg(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim().toLowerCase().slice(0, 120);
}

// --- Nhận diện TIN TỰ ĐỘNG OA (welcome/auto-reply cố định) để KHÔNG nhầm là telesale gõ tay ---
// Mỗi marker là 1 cụm CỐ ĐỊNH trong tin auto-reply (khớp KHÔNG dấu, không hoa thường).
// Chỉnh/bổ sung qua env AUTO_REPLY_MARKERS (phân tách bằng |). Khớp 1 marker là coi như auto-reply.
const AUTO_REPLY_MARKERS = (process.env.AUTO_REPLY_MARKERS ||
  'bo phan tu van se phan hoi|tin nhan cua ban da duoc ghi nhan|cam on ban da lien he phong kham|gio lam viec'
).split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
function isAutoReplyMessage(text) {
  const n = String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase();
  return AUTO_REPLY_MARKERS.some((m) => n.includes(m));
}

// Số giờ telesale "giữ" hội thoại sau khi gõ tay (quá thì bot tiếp quản lại).
const HUMAN_HOLD_HOURS = parseFloat(process.env.HUMAN_HOLD_HOURS || '6');

// Mốc thời gian bot gửi tin GẦN NHẤT cho mỗi hội thoại (epoch ms).
// Dùng để loại echo: tin page về NGAY sau khi bot vừa gửi (vài giây) gần như chắc chắn là
// echo của chính bot, KHÔNG phải telesale gõ tay. Telesale thật cần thời gian để đọc + gõ.
const lastBotSendAt = new Map();
export function noteBotJustSent(conversationId) {
  lastBotSendAt.set(String(conversationId), Date.now());
}
// Cửa sổ nghi-ngờ-echo: tin page về trong khoảng này sau lần bot gửi cuối → coi là echo, bỏ qua.
const ECHO_GRACE_MS = parseInt(process.env.ECHO_GRACE_MS || '30000', 10);

/**
 * Xử lý tin TỪ PAGE: phân biệt BOT tự gửi (bỏ qua) vs TELESALE gõ tay (đánh dấu human → bot lui).
 */
export async function handlePageMessage(ev) {
  const { conversationId, pageId, messageText, aiGenerated } = ev;
  if (!conversationId || !pageId) return;
  if (!isPageEnabled(pageId)) return;
  if (aiGenerated) return; // tin AI/hệ thống (Meta transfer...) — bỏ qua
  // LỚP 0 (kênh Zalo): TIN TỰ ĐỘNG OA (welcome/auto-reply cố định) gửi từ page mỗi khi khách nhắn
  // → webhook dội về, ĐỪNG tưởng telesale gõ. Nhận diện qua mẫu cố định (chỉnh qua AUTO_REPLY_MARKERS).
  // Đây là thủ phạm làm bot LUI khi đấu Zalo OA (tin "Bộ phận tư vấn sẽ phản hồi...").
  if (isAutoReplyMessage(messageText)) {
    console.log(`[handler] ${conversationId}: tin page khớp mẫu AUTO-REPLY OA → bỏ qua, KHÔNG đánh telesale`);
    return;
  }
  // LỚP 1: khớp nội dung với tin bot vừa gửi → đúng thì bỏ qua.
  if (wasSentByBot(conversationId, messageText)) return;
  // LỚP 2 (chống race condition): nếu bot VỪA gửi tin trong ECHO_GRACE_MS giây qua mà
  // nội dung không khớp kịp (Pancake đổi text / webhook về trước khi noteBotSent ghi xong)
  // → vẫn coi là echo của bot, KHÔNG đánh telesale. Đây chính là ca đã làm rớt khách Nguyên.
  const last = lastBotSendAt.get(String(conversationId));
  if (last && Date.now() - last < ECHO_GRACE_MS) {
    console.log(`[handler] ${conversationId}: tin page về ${Math.round((Date.now()-last)/1000)}s sau khi bot gửi → coi là echo, KHÔNG đánh telesale`);
    return;
  }
  // LỚP 3 (chống đánh nhầm cờ human): telesale THẬT tư vấn bằng câu tử tế, không phải mẩu cụt
  // ("alo", "ok", emoji...). Tin page ngắn dưới ngưỡng → nhiều khả năng là echo/tin test/Pancake AI
  // sót → KHÔNG đánh cờ human. Ngưỡng chỉnh qua HUMAN_MIN_CHARS (mặc định 12 ký tự).
  const cleaned = normalizeMsg(messageText);
  if (cleaned.length < HUMAN_MIN_CHARS) {
    console.log(`[handler] ${conversationId}: tin page quá ngắn ("${messageText.slice(0,20)}") → KHÔNG coi là telesale gõ tay`);
    return;
  }
  // Còn lại = TELESALE GÕ TAY THẬT → đánh dấu người tiếp quản, bot lui.
  store.ensureConversation(conversationId, pageId, null);
  store.markHumanTaken(conversationId);
  console.log(`[handler] 👤 ${conversationId}: telesale gõ tay → bot LUI (giữ ${HUMAN_HOLD_HOURS}h)`);
}
// Ngưỡng ký tự tối thiểu để coi tin page là "telesale gõ tay thật" (lọc mẩu cụt/echo).
const HUMAN_MIN_CHARS = parseInt(process.env.HUMAN_MIN_CHARS || '12', 10);

// Map bệnh → sale page: dùng chung từ conditions.js (gồm cả bệnh mở rộng).
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

  if (lockHeld(conversationId)) {
    console.log(`[handler] ${conversationId} đang xử lý, bỏ qua tin chồng`);
    return;
  }
  lockAcquire(conversationId);
  try {
    const conv = store.ensureConversation(conversationId, pageId, customerName);

    // CHỈ handover thật (khiếu nại/đòi gặp người) → bot KHÔNG tự trả lời.
    // NHƯNG nếu khách vẫn nhắn tiếp → NHẮC người thật qua Telegram (đừng bỏ quên khách),
    // gắn cờ KHẨN nếu có dấu hiệu y tế nguy hiểm.
    if (store.isHandover(conv)) {
      const urgent = isUrgent(messageText);
      console.log(`[handler] ${conversationId} handover + khách nhắn tiếp${urgent ? ' (KHẨN)' : ''} → nhắc người thật`);
      store.appendHistory(conversationId, 'user', messageText);
      try {
        await notifyHandoverNudge({
          name: customerName || conv.customer_name,
          messageText,
          urgent,
          pageId,
          conversationId,
        });
      } catch (e) { console.error('[handler] nudge lỗi:', e?.message); }
      return; // vẫn KHÔNG để bot tự trả lời ca handover
    }

    // CỜ TẮT BOT theo NHÃN Pancake: telesale đã gọi/chốt lịch khám (xảy ra NGOÀI inbox)
    // → gắn nhãn lên hội thoại. Bot thấy nhãn thì IM HẲN, không chồng tin tư vấn nữa.
    // Đây là lớp chặn cho ca "telesale xử ngoài Pancake" mà cơ chế người-gõ-tay không bắt được.
    if (await hasStopLabel(pageId, conversationId)) {
      console.log(`[handler] ${conversationId} có nhãn chốt lịch/telesale xử → bot IM (khách vừa nhắn)`);
      store.appendHistory(conversationId, 'user', messageText);
      store.markCustomerMessaged(conversationId);
      store.markHumanTaken(conversationId); // chặn luôn retouch về sau, khỏi gọi lại API mỗi lượt
      return;
    }

    // ⚠️ CHỐT LEAD TRƯỚC KHI BOT LUI (sửa ca Kim Anh 29/06): nếu tin khách chứa SĐT hợp lệ
    // và conv CHƯA captured → BẮN TELEGRAM NGAY, bất kể sau đó bot có lui vì cờ human hay không.
    // Trước đây notifyLead chỉ nằm trong dispatch (cuối luồng) → khi telesale gõ tay nhanh hơn bot
    // (đánh cờ human), bot return SỚM ở isHumanActive → lead có số mà KHÔNG bao giờ báo Telegram.
    // Số điện thoại là tài sản — không để lọt vì bất kỳ lý do gì.
    {
      const leadPhone = extractPhone(messageText) ||
        (!store.isCaptured(conv) ? extractPhoneFromHistory(store.getConversation(conversationId).history) : null);
      if (leadPhone && !store.isCaptured(conv)) {
        store.setPhoneCaptured(conversationId, leadPhone, customerName || conv.customer_name);
        try {
          await notifyLead({
            name: customerName || conv.customer_name,
            phone: leadPhone,
            condition: conv.condition || 'unknown',
            summary: conv.summary || null,
            customerType: 'chua_ro',
            pageId,
            conversationId,
          });
          console.log(`[lead] 🔥 ${conversationId} có SĐT ${leadPhone} (chốt sớm trước khi xét cờ human) → đã báo Telegram`);
        } catch (e) { console.error('[lead] báo Telegram lỗi:', e?.message); }
      }
    }

    // NGƯỜI THẬT VÀO → BOT LUI. (Thiết kế mới chốt với anh 28/06: bot TOÀN QUYỀN xử tới khi
    // gửi sale page + xin SĐT. Telesale KHÔNG đụng check page, chỉ xử qua Telegram; muốn bot im
    // thì GẮN NHÃN — đã chặn ở hasStopLabel trên.) Cờ human CHỈ được đánh khi CHẮC CHẮN telesale
    // gõ tay thật (handlePageMessage đã lọc echo/Pancake AI nhiều lớp), nên ở đây tin tưởng nó.
    if (store.isHumanActive(conv, HUMAN_HOLD_HOURS)) {
      console.log(`[handler] ${conversationId} người thật đang giữ → bot lui (khách vừa nhắn)`);
      store.appendHistory(conversationId, 'user', messageText);
      store.markCustomerMessaged(conversationId);
      return; // bot im, để người thật trả lời
    }

    // Lưu tin khách + cập nhật mốc thời gian (cho retouch).
    store.appendHistory(conversationId, 'user', messageText);
    store.markCustomerMessaged(conversationId);

    // Chốt SĐT bằng regex (CHỈ nhận số VN hợp lệ đúng 10 số).
    let phoneByRegex = extractPhone(messageText);

    // VÁ LỖI "XIN SỐ LẶP" (ca chị Hoa): khách đã cho số ở LƯỢT TRƯỚC rồi nhắn câu khác
    // → tin hiện tại không có số → bot tưởng chưa có rồi xin lại. Soi cả LỊCH SỬ: nếu khách
    // TỪNG cho số hợp lệ mà conv chưa captured → coi như có số NGAY tại lượt này (sẽ chốt +
    // báo Telegram + chuyển care ở dispatch), TUYỆT ĐỐI không xin lại nữa.
    if (!phoneByRegex && !store.isCaptured(conv)) {
      const phoneInHistory = extractPhoneFromHistory(store.getConversation(conversationId).history);
      if (phoneInHistory) {
        console.log(`[handler] ${conversationId} khách ĐÃ cho số ${phoneInHistory} ở lượt trước → chốt lại, KHÔNG xin nữa`);
        phoneByRegex = phoneInHistory; // ép vào nhánh capture phía dưới
      }
    }

    // Khách CHO SỐ nhưng SAI + chưa có số hợp lệ → bot HỎI LẠI, nói ĐÚNG LÝ DO sai
    // (thiếu số vs SAI ĐẦU SỐ là 2 chuyện khác nhau — nói nhầm làm khách bối rối, rớt lead).
    // KHÔNG chốt lead số chết. (Bỏ qua nếu đã captured rồi.)
    const badPhoneReason = !phoneByRegex && !store.isCaptured(conv) ? diagnoseBadPhone(messageText) : null;
    if (badPhoneReason) {
      console.log(`[handler] ${conversationId} khách cho SĐT sai (${badPhoneReason}) → xin nhắn lại`);
      const cname = customerName || conv.customer_name;
      const xung = cname ? '' : 'anh/chị ';
      // Câu giải thích theo đúng lý do
      let why;
      if (badPhoneReason === 'wrong_prefix') {
        why = `Dạ ${xung}ơi, số mình gửi đầu số chưa đúng rồi ạ 😅 Số di động Việt Nam mình đầu là 03/05/07/08/09 đó ạ.`;
      } else if (badPhoneReason === 'too_long') {
        why = `Dạ ${xung}ơi, hình như số mình gửi bị dư mất một số rồi ạ 😅`;
      } else { // too_short
        why = `Dạ ${xung}ơi, hình như số mình gửi bị thiếu mất một số rồi ạ 😅`;
      }
      const askAgain = [
        why,
        `Mình kiểm tra gửi lại giúp em số đủ 10 số nha, để Bác sĩ gọi tư vấn cho mình không bị nhầm ạ.`,
      ];
      askAgain.forEach((m) => noteBotSent(conversationId, m));
      noteBotJustSent(conversationId); // chống race: đánh dấu bot vừa gửi (echo sắp về)
      await sendMessages(pageId, conversationId, askAgain);
      store.appendHistory(conversationId, 'model', `Xin khách gửi lại SĐT (lý do: ${badPhoneReason}).`);
      return;
    }

    // Đã có SĐT rồi mà khách NHẮN TIẾP → chuyển mode CARE (chăm sóc, KHÔNG xin lại số,
    // mà nhắc đặt lịch / trấn an chờ Bác sĩ gọi / giải đáp thêm) — không buông khách.
    // phoneByRegex (kể cả vừa vớt từ lịch sử) → cũng coi như đã có số → care, đừng xin lại.
    //
    // NGOÀI RA: khách ĐÃ THÀNH KHÁCH (nhãn Pancake "đã đến khám/đã thu tiền/đã cọc..." — số
    // vào qua POS chứ không qua chat, ca anh Cầu) → cũng care: chăm sóc, KHÔNG chào mới/xin số.
    let isCustomer = store.isCaptured(conv) || Boolean(phoneByRegex);
    if (!isCustomer) {
      try { isCustomer = await hasCustomerLabel(pageId, conversationId); } catch { /* fail-open */ }
      if (isCustomer) store.setPhoneCaptured(conversationId, conv.phone || null, customerName || conv.customer_name); // nhớ trạng thái để lần sau khỏi gọi API
    }
    const mode = isCustomer ? 'care' : 'reply';

    // ===== ENRICH (kênh ZALO) — nạp hồ sơ BN trước khi chăm (thiết kế mục C2) =====
    // Chỉ cho kênh Zalo (OA = chăm sâu, cần biết khách là ai). FB giữ luồng săn lead như cũ.
    // Tra MEDi theo SĐT (regex / lịch sử / phone đã lưu). Có hồ sơ → BN_CŨ; không → BN_MỚI.
    // Fail-open: MEDi chưa cấu hình → lookupMedi trả null → coi như BN_MỚI, vẫn chăm bình thường.
    const channel = getPageChannel(pageId);
    let contextTag = null;
    if (isZaloPage(channel)) {
      // nhớ kênh + zalo_user_id (từ customerId "zl_<uid>") để engine chạm/giao file dùng sau
      const zaloUid = ev.customerId ? stripZaloPrefix(ev.customerId) : null;
      store.setChannel(conversationId, 'zalo', zaloUid);
      const freshZ = store.getConversation(conversationId);
      // đã tra MEDi rồi (cache) → dùng lại; chưa → tra 1 lần
      if (freshZ.medi_status) {
        contextTag = buildContextTag(store.getMediRecord(freshZ), conv.condition || null);
      } else {
        const phoneForLookup = phoneByRegex || freshZ.phone ||
          extractPhoneFromHistory(freshZ.history);
        if (phoneForLookup) {
          const record = await lookupMedi(phoneForLookup);
          store.setMedi(conversationId, record ? 'cu' : 'moi', record);
          contextTag = buildContextTag(record, conv.condition || null);
          console.log(`[enrich] ${conversationId} SĐT ${phoneForLookup} → ${record ? 'BN_CŨ (' + (record.name || '?') + ')' : 'BN_MỚI'}`);
        } else {
          // chưa có số → chưa tra được, coi là BN mới tạm thời (bot Zalo sẽ khéo xin số để tra)
          contextTag = buildContextTag(null, conv.condition || null);
        }
      }
    }

    const history = store.getConversation(conversationId).history;
    const reply = await generateReply(history, mode, customerName || conv.customer_name, null, { channel, contextTag });

    await dispatch(conversationId, pageId, conv, reply, phoneByRegex, customerName);
  } catch (err) {
    console.error('[handler] lỗi handleIncoming:', err?.message || err);
  } finally {
    lockRelease(conversationId);
  }
}

/**
 * Xử lý 1 lượt CHẠM LẠI (retouch) do cron gọi.
 */
export async function handleRetouch(conv) {
  const { conversation_id: conversationId, page_id: pageId } = conv;
  if (lockHeld(conversationId)) return;
  lockAcquire(conversationId);
  try {
    const fresh = store.getConversation(conversationId);
    if (!fresh || store.isHandled(fresh)) return; // đã giao người trong lúc chờ
    // CỜ TẮT BOT theo nhãn: telesale đã chốt lịch/đang xử → KHÔNG chạm lại tự động.
    if (await hasStopLabel(pageId, conversationId)) {
      console.log(`[retouch] ${conversationId} có nhãn chốt lịch/telesale xử → bỏ chạm lại`);
      store.markHumanTaken(conversationId); // chặn các lượt cron sau, khỏi gọi API mỗi 15'
      return;
    }
    const reply = await generateReply(fresh.history, 'retouch', fresh.customer_name);
    // retouch chỉ gửi tin nhắc, không kỳ vọng có SĐT — nhưng vẫn xử lý nếu có
    await dispatch(conversationId, pageId, fresh, reply, null, fresh.customer_name);
    store.incRetouch(conversationId);
    console.log(`[retouch] đã chạm lại ${conversationId} (lần ${fresh.retouch_count + 1})`);
  } catch (err) {
    console.error('[handler] lỗi handleRetouch:', err?.message || err);
  } finally {
    lockRelease(conversationId);
  }
}

/**
 * Xử lý 1 CHẠM BOT (3/4/6) do cron 7-chạm gọi — bot TỰ GỬI tin giá trị cho khách.
 * Khác handleRetouch (Gemini sinh tự do): chạm dùng NỘI DUNG SOẠN SẴN theo bệnh (touches.js)
 * → kiểm soát chất lượng, không lệch giọng, gửi đúng cẩm nang/mẹo của phòng khám.
 * @param {object} conv  bản ghi hội thoại (từ findTouchTargets)
 * @param {number} touchNo  3 | 4 | 6
 */
export async function handleBotTouch(conv, touchNo) {
  const { conversation_id: conversationId, page_id: pageId } = conv;
  if (!isPageEnabled(pageId)) return;
  if (lockHeld(conversationId)) return;
  lockAcquire(conversationId);
  try {
    const fresh = store.getConversation(conversationId);
    if (!fresh) return;
    if (store.isTouchDone(fresh, touchNo)) return;      // đã gửi chạm này rồi (đua cron)
    if (store.isHandover(fresh)) return;                  // khiếu nại/cần người → bot không chen
    if (store.isHumanActive(fresh, HUMAN_HOLD_HOURS)) {   // telesale đang giữ → để người thật
      console.log(`[cham${touchNo}] ${conversationId} người thật đang giữ → bỏ chạm bot`);
      return;
    }
    // Nhãn chốt lịch / telesale xử ngoài inbox → IM, đánh dấu để khỏi gọi API mỗi cron.
    if (await hasStopLabel(pageId, conversationId)) {
      console.log(`[cham${touchNo}] ${conversationId} có nhãn chốt lịch/telesale xử → bỏ chạm`);
      store.markTouchDone(conversationId, touchNo);
      return;
    }

    const daCoSo = store.isCaptured(fresh);
    const condition = fresh.condition || 'unknown';
    const messages = buildTouchMessages(touchNo, condition, daCoSo);
    if (!messages) {
      // Chạm 3 chưa có review clip → coi như đã làm (khỏi kẹt cron), bỏ qua nhẹ nhàng.
      console.log(`[cham${touchNo}] ${conversationId} không có nội dung (vd review chưa nạp) → đánh dấu xong, bỏ qua`);
      store.markTouchDone(conversationId, touchNo);
      return;
    }

    messages.forEach((m) => noteBotSent(conversationId, m));
    noteBotJustSent(conversationId); // chống race echo
    await sendMessages(pageId, conversationId, messages);
    store.appendHistory(conversationId, 'model', `[CHẠM ${touchNo}] ` + messages.join('\n'));
    store.markTouchDone(conversationId, touchNo);
    // Bỏ qua các chạm THẤP hơn còn sót (lead vào đêm, sáng đã quá nhiều mốc → ta gửi mốc cao nhất,
    // các mốc cũ coi như lỡ, đánh dấu xong để KHÔNG gửi ngược chạm 3 sau khi đã gửi chạm 4).
    for (const lower of [3, 4, 6]) {
      if (lower < touchNo) store.markTouchDone(conversationId, lower);
    }
    console.log(`[cham${touchNo}] ✅ đã gửi chạm bot cho ${conversationId} (bệnh ${condition}, ${daCoSo ? 'đã có số' : 'chưa số'})`);
  } catch (err) {
    console.error(`[handler] lỗi handleBotTouch (chạm ${touchNo}):`, err?.message || err);
  } finally {
    lockRelease(conversationId);
  }
}

// Gửi phản hồi + xử lý SĐT / handover + lưu lịch sử bot.
async function dispatch(conversationId, pageId, conv, reply, phoneByRegex, customerName) {
  // Phân loại bệnh để thống kê — chỉ lưu khi nhận diện được (khác unknown),
  // để KHÔNG ghi đè condition đã biết ở lượt trước bằng 'unknown' của lượt cuối.
  if (reply.condition && reply.condition !== 'unknown') {
    store.setCondition(conversationId, reply.condition);
  }

  // Lưu summary (tóm tắt bệnh/thông tin giá trị) khi Gemini có sinh ra.
  if (reply.summary) store.setSummary(conversationId, reply.summary);

  // Khách xin NGỪNG nhận tin → đánh dấu opt-out (dừng mọi chuỗi chăm tự động sau này).
  if (reply.opt_out) {
    store.setOptOut(conversationId);
    console.log(`[handler] 🛑 ${conversationId} khách opt-out → dừng chuỗi chăm`);
  }

  // Lấy condition + summary ĐÃ NHỚ trong DB (qua nhiều lượt) thay vì chỉ lượt cuối.
  const freshConv = store.getConversation(conversationId);
  const knownCondition = freshConv?.condition || reply.condition || 'unknown';
  const knownSummary = freshConv?.summary || reply.summary || null;

  // ĐẢM BẢO gửi link sale page đúng bệnh (nếu Gemini quên chèn).
  let outMessages = ensureSalePageLink(reply.messages, knownCondition, conv);
  const linkWasAdded = outMessages.length !== reply.messages.length ||
    outMessages.some((m, i) => m !== reply.messages[i]);

  // Gửi các ô thoại về khách qua Pancake
  outMessages.forEach((m) => noteBotSent(conversationId, m)); // đánh dấu bot gửi (để khỏi nhầm là người gõ)
  noteBotJustSent(conversationId); // chống race: đánh dấu thời điểm bot gửi (echo sắp dội về)
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
  // CHỈ báo lead lần ĐẦU lấy được số (conv chưa captured) → tránh báo Telegram trùng
  // khi khách đã cho số rồi nhắn tiếp (mode care).
  const alreadyCaptured = store.isCaptured(freshConv);

  if (captured && phone && !alreadyCaptured) {
    store.setPhoneCaptured(conversationId, phone, reply.name || customerName);
    await notifyLead({
      name: reply.name || customerName,
      phone,
      condition: knownCondition,
      summary: knownSummary,
      customerType: reply.customer_type,
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
      summary: knownSummary,
      pageId,
      conversationId,
    });
    console.log(`[handover] ⚠️ ${conversationId} → đã báo Telegram (${reply.handover_reason || 'n/a'})`);
  }
}
