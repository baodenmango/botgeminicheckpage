// Lõi xử lý hội thoại — dùng chung cho webhook (tin mới) và cron (retouch).
import { generateReply } from './gemini.js';
import { sendMessages, isPageEnabled, hasStopLabel, hasCustomerLabel, getPageChannel } from './pancake.js'; // sendMessages dùng cả khi xin lại SĐT sai
import * as store from './store.js';
import { extractPhone, extractPhoneFromHistory, diagnoseBadPhone } from './utils.js';
import { notifyLead, notifyHandover, notifyHandoverNudge, notifyBooking, isUrgent } from './telegram.js';
import { buildTouchMessages, loiMoiZaloOA } from './touches.js';
import { isZaloPage, stripZaloPrefix, tagFollowerBenh } from './zalo.js';
import { normalizeMsg, noteBotSent, wasSentByBot, noteBotJustSent, lastBotSentAgoMs, ECHO_GRACE_MS } from './echoguard.js';
import { lookupMedi, buildContextTag } from './medi.js';
import { lookupDaKham, buildDaKhamTag } from './daKham.js';
import { SALE_PAGE } from './conditions.js';
import { BROCHURE_PDF, BROCHURE_NAME } from './resources.js';

// 2 page FB = 2 tệp khách (anh chốt 04/07) — thẻ chèn vào contextTag, prompt mục 1B đọc để đổi nhịp.
// Page Bs Trình (clip viral): tò mò là chính, cho giá trị trước, đừng vồ vập xin số.
// Page Phòng khám: khách chủ đích, vào việc nhanh.
const PAGE_AUDIENCE = {
  '957014354156110': '[TỆP PAGE: CLIP VIRAL — page Bs Trình] Khách đến từ clip viral, đa phần tò mò chưa có ý định khám. Cho giá trị trước, đừng vồ vập xin số (làm theo mục 1B).',
  '386613267864665': '[TỆP PAGE: CHỦ ĐÍCH — page Phòng khám] Khách chủ đích tìm phòng khám. Vào việc nhanh, trả lời thẳng, chốt lịch + xin số sớm (làm theo mục 1B).',
};

// Chuẩn hóa câu để so trùng nguyên văn (chống bot lặp lại chính mình — lộ máy).
function chuanHoaCau(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Khách XIN tài liệu/cẩm nang/bài tập → gửi PDF ngay (không đợi chạm 4).
const ASK_DOC_RE = /\b(gửi|cho|xin|share|sen)\b.*(tài liệu|tai lieu|cẩm nang|cam nang|bài tập|bai tap|file|pdf|hướng dẫn|huong dan|video)|(tài liệu|cẩm nang|bài tập|file|pdf).*(đâu|chưa|gửi|gui)/i;
function wantsDocument(text) {
  return ASK_DOC_RE.test(String(text || ''));
}

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

// HÀNG ĐỢI TIN DỒN: khách gõ 2-3 tin liền tay (tin sau về khi tin trước còn đang xử lý/lock)
// → trước đây tin sau bị VỨT ("bỏ qua tin chồng") → bot trả lời thiếu ý / im luôn (ca Sen Vàng 02/07:
// khách reply quảng cáo rồi gõ tiếp "1 ông gia bn bac si" ngay sau đó). Giờ: xếp hàng, xử xong
// lượt trước thì GOM các tin chờ thành 1 lượt mới. Tối đa 5 tin chờ/hội thoại (chống spam).
const pendingQueue = new Map(); // conversationId -> [ev]
function queuePending(ev) {
  const q = pendingQueue.get(ev.conversationId) || [];
  if (q.length < 5) q.push(ev);
  pendingQueue.set(ev.conversationId, q);
}
function drainPending(conversationId) {
  const q = pendingQueue.get(conversationId);
  if (!q || q.length === 0) return null;
  pendingQueue.delete(conversationId);
  // gom các tin chờ thành 1 lượt (giữ metadata tin mới nhất, nối text theo thứ tự gửi)
  return { ...q[q.length - 1], messageText: q.map((e) => e.messageText).join('\n') };
}

// Sổ chống echo giờ nằm ở echoguard.js (dùng chung với đường gửi Zalo OpenAPI —
// zalo.js cũng ghi vào sổ này sau mỗi lần gửi, khỏi nhầm echo là telesale gõ tay).

// --- Nhận diện TIN TỰ ĐỘNG (welcome/auto-reply cố định) để KHÔNG nhầm là telesale gõ tay ---
// Mỗi marker là 1 cụm CỐ ĐỊNH trong tin auto-reply (khớp KHÔNG dấu, không hoa thường).
// Chỉnh/bổ sung qua env AUTO_REPLY_MARKERS (phân tách bằng |). Khớp 1 marker là coi như auto-reply.
// Gồm cả: auto-reply Zalo OA + CÂU CHÀO TỰ ĐỘNG META khi khách nhắn từ quảng cáo/bình luận
// (ca Sen Vàng 02/07: Meta chào "...mô tả càng chi tiết càng tốt..." → bot tưởng telesale gõ → câm 6h).
const AUTO_REPLY_MARKERS = (process.env.AUTO_REPLY_MARKERS ||
  'bo phan tu van se phan hoi|tin nhan cua ban da duoc ghi nhan|cam on ban da lien he phong kham|gio lam viec' +
  '|mo ta cang chi tiet cang tot|de lai sdt giup bac trinh|da de lai binh luan|[botcake]'
).split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
// DANH THIẾP OA: Zalo tự bắn tin CHỈ GỒM TÊN OA (+ emoji) mỗi khi khách mở chat — vd
// "Phòng khám Cơ Xương Khớp Hiệp Lợi 🦴" (ca Minh Trang 06/07: bot tưởng telesale → câm 6h).
// Khớp CHÍNH XÁC cả câu sau khi bỏ emoji/dấu — KHÔNG dùng includes vì telesale thật cũng
// hay nhắc tên phòng khám giữa câu tư vấn. Chỉnh qua env AUTO_REPLY_EXACT (phân tách |).
const AUTO_REPLY_EXACT = (process.env.AUTO_REPLY_EXACT ||
  'phong kham co xuong khop hiep loi|phong kham hiep loi'
).split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
function isAutoReplyMessage(text) {
  const n = String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase();
  if (AUTO_REPLY_MARKERS.some((m) => n.includes(m))) return true;
  const bare = n.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return AUTO_REPLY_EXACT.includes(bare);
}

// Số giờ telesale "giữ" hội thoại sau khi gõ tay (quá thì bot tiếp quản lại).
const HUMAN_HOLD_HOURS = parseFloat(process.env.HUMAN_HOLD_HOURS || '6');

/**
 * Xử lý tin TỪ PAGE: phân biệt BOT tự gửi (bỏ qua) vs TELESALE gõ tay (đánh dấu human → bot lui).
 */
export async function handlePageMessage(ev) {
  const { conversationId, pageId, messageText, aiGenerated } = ev;
  if (!conversationId || !pageId) return;
  if (!isPageEnabled(pageId)) return;
  if (aiGenerated) return; // tin AI/hệ thống (Meta transfer...) — bỏ qua
  // Tin page CHỈ CÓ ẢNH/TỆP (không chữ): là card ảnh của Meta automation/Botcake gửi kèm câu chào.
  // ĐỪNG đánh cờ human — placeholder '[khách vừa gửi một hình ảnh/tệp]' dài 29 ký tự từng vượt
  // ngưỡng HUMAN_MIN_CHARS → bot câm 6h + rescue né luôn (ca Sen Vàng 02/07). Telesale thật tư vấn bằng CHỮ.
  if (ev.attachmentOnly) {
    console.log(`[handler] ${conversationId}: tin page chỉ có ảnh/tệp → bỏ qua, KHÔNG đánh telesale`);
    return;
  }
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
  const agoMs = lastBotSentAgoMs(conversationId);
  if (agoMs !== null && agoMs < ECHO_GRACE_MS) {
    console.log(`[handler] ${conversationId}: tin page về ${Math.round(agoMs/1000)}s sau khi bot gửi → coi là echo, KHÔNG đánh telesale`);
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
    console.log(`[handler] ${conversationId} đang xử lý → XẾP HÀNG tin mới (không vứt)`);
    queuePending(ev);
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
        // Số này đã từng lên đơn/khám chưa? → báo telesale ĐÚNG vai (chăm sóc vs chốt mới). Fail-open.
        let daKhamEarly = null;
        try { daKhamEarly = await lookupDaKham(leadPhone); } catch { /* fail-open */ }
        try {
          await notifyLead({
            name: customerName || conv.customer_name,
            phone: leadPhone,
            condition: conv.condition || 'unknown',
            summary: conv.summary || null,
            customerType: daKhamEarly ? 'khach_da_kham' : 'chua_ro',
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

    // KHÁCH XIN TÀI LIỆU/CẨM NANG/BÀI TẬP → gửi PDF đúng bệnh NGAY (không đợi chạm 4).
    // Chỉ gửi khi ĐÃ biết bệnh (condition khác unknown) + có PDF. Chưa rõ bệnh → để Gemini hỏi bệnh.
    if (wantsDocument(messageText)) {
      const cond = conv.condition && conv.condition !== 'unknown' ? conv.condition : null;
      const pdf = cond ? BROCHURE_PDF[cond] : null;
      if (pdf) {
        const ten = BROCHURE_NAME[cond] || 'cẩm nang chăm sóc tại nhà';
        const msgs = [
          `Dạ em gửi mình "${ten}" nha ạ 🌿`,
          `Mình xem và áp dụng dần nha: ${pdf}`,
        ];
        if (!store.isCaptured(conv)) {
          msgs.push('Mình muốn Bác sĩ xem kỹ tình trạng và tư vấn hướng phù hợp thì để lại số điện thoại giúp em nha, Bác sĩ gọi tư vấn miễn phí cho mình ạ 🙏');
        }
        msgs.forEach((m) => noteBotSent(conversationId, m));
        noteBotJustSent(conversationId);
        await sendMessages(pageId, conversationId, msgs);
        store.appendHistory(conversationId, 'model', msgs.join('\n'));
        console.log(`[doc] 📄 ${conversationId} xin tài liệu → đã gửi PDF bệnh ${cond}`);
        return;
      }
      // chưa rõ bệnh → KHÔNG return, để Gemini hỏi "mình đau vùng nào" rồi lần sau gửi.
      console.log(`[doc] ${conversationId} xin tài liệu nhưng chưa rõ bệnh → để Gemini hỏi bệnh`);
    }

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

    const channel = getPageChannel(pageId);
    let contextTag = null;

    // ===== KHÁCH ĐÃ KHÁM theo SĐT — kênh FB (anh Trình chốt 02/07) =====
    // Nhiều ca ĐÃ ĐẾN KHÁM (đơn bắn trên Facebook / có hồ sơ EMR) nhưng hội thoại KHÔNG có nhãn
    // → trước đây bot vẫn đối xử như lead lạ. Giờ: biết SĐT (khách gõ / lịch sử / đã lưu)
    // → tra MEDi + POS; trúng → GIAI ĐOẠN CHĂM SÓC (mode care + thẻ ngữ cảnh đổi vai bot).
    // Có cache trong pos.js/medi.js nên không gọi API mỗi tin. Fail-open toàn phần.
    if (!isZaloPage(channel)) {
      const phoneKnown = phoneByRegex || conv.phone ||
        extractPhoneFromHistory(store.getConversation(conversationId).history);
      if (phoneKnown) {
        try {
          const daKham = await lookupDaKham(phoneKnown);
          if (daKham) {
            isCustomer = true;
            contextTag = buildDaKhamTag(daKham);
            console.log(`[da-kham] 🧡 ${conversationId} SĐT ${phoneKnown} trùng ${daKham.source.toUpperCase()} (${daKham.name || '?'}) → chuyển CHĂM SÓC SAU KHÁM`);
          }
        } catch { /* fail-open */ }
      }
    }

    const mode = isCustomer ? 'care' : 'reply';

    // ===== ENRICH (kênh ZALO) — nạp hồ sơ BN trước khi chăm (thiết kế mục C2) =====
    // Chỉ cho kênh Zalo (OA = chăm sâu, cần biết khách là ai). FB dùng lớp "đã khám" ở trên.
    // Tra MEDi theo SĐT (regex / lịch sử / phone đã lưu). Có hồ sơ → BN_CŨ; không → BN_MỚI.
    // Fail-open: MEDi chưa cấu hình → lookupMedi trả null → coi như BN_MỚI, vẫn chăm bình thường.
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

      // NỐI NGỮ CẢNH FB→ZALO (anh Trình chốt): khách từng nhắn bên FB rồi qua Zalo OA → tra SĐT ra
      // hội thoại FB cũ, lấy BỆNH + TÓM TẮT để bot Zalo HIỂU ĐỦ (mới chạm 4 đúng được).
      const phoneForLink = phoneByRegex || freshZ.phone || extractPhoneFromHistory(freshZ.history);
      if (phoneForLink) {
        const fbConv = store.getConversationByPhone(phoneForLink, conversationId);
        if (fbConv && (fbConv.condition || fbConv.summary)) {
          // mang condition + summary sang conv Zalo để engine chạm/gửi file đúng bệnh
          if (fbConv.condition && fbConv.condition !== 'unknown' &&
              (!freshZ.condition || freshZ.condition === 'unknown')) {
            store.setCondition(conversationId, fbConv.condition);
          }
          if (fbConv.summary && !freshZ.summary) store.setSummary(conversationId, fbConv.summary);
          const tomtat = fbConv.summary ? ` Tóm tắt FB: ${fbConv.summary}` : '';
          contextTag = (contextTag || '') +
            `\n[NGỮ CẢNH TỪ FACEBOOK] Khách này TỪNG nhắn bên Facebook (bệnh=${fbConv.condition || 'chưa rõ'}).${tomtat} → ĐỪNG hỏi lại từ đầu, chăm tiếp dựa trên cái họ đã trao đổi.`;
          console.log(`[link-fb] ${conversationId} nối ngữ cảnh FB qua SĐT ${phoneForLink}: bệnh=${fbConv.condition}, có summary=${!!fbConv.summary}`);
        }
      }
    }

    // THẺ TỆP PAGE (anh chốt 04/07): 2 page = 2 tệp khách, prompt mục 1B đọc thẻ này đổi nhịp tư vấn.
    if (channel !== 'zalo' && PAGE_AUDIENCE[pageId]) {
      contextTag = contextTag ? `${contextTag}\n${PAGE_AUDIENCE[pageId]}` : PAGE_AUDIENCE[pageId];
    }

    const history = store.getConversation(conversationId).history;
    const reply = await generateReply(history, mode, customerName || conv.customer_name, null, { channel, contextTag });

    await dispatch(conversationId, pageId, conv, reply, phoneByRegex, customerName);
  } catch (err) {
    console.error('[handler] lỗi handleIncoming:', err?.message || err);
  } finally {
    lockRelease(conversationId);
    // Có tin khách dồn trong lúc xử lý → gom lại thành 1 lượt, xử tiếp (giãn 1s cho tin kịp gom).
    const merged = drainPending(conversationId);
    if (merged) {
      console.log(`[handler] ${conversationId} xử tiếp ${merged.messageText.split('\n').length} tin dồn trong hàng đợi`);
      setTimeout(() => handleIncoming(merged), 1000);
    }
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

    // ===== LUẬT CHỐNG DỘI BOM (anh chốt 04/07) =====
    // Khách đã IM qua 2 chạm liên tiếp (2 lượt bot gửi sau tin khách cuối mà không có hồi âm)
    // → DỪNG chuỗi chạm. Nếu trong các tin đó CHƯA có lời mời Zalo OA thì gửi đúng 1 ô mời OA
    // làm câu chốt (cửa nhẹ nhàng để khách giữ kết nối), rồi im hẳn.
    {
      const hist = fresh.history || [];
      let lastUser = -1;
      hist.forEach((h, i) => { if (h.role === 'user') lastUser = i; });
      const sauKhach = hist.slice(lastUser + 1).map((h) => String(h.text || ''));
      const chamImLang = sauKhach.filter((t) => t.startsWith('[CHẠM')).length;
      if (chamImLang >= 2) {
        const daMoiOA = sauKhach.some((t) => t.includes('zalo.me/'));
        if (!daMoiOA) {
          const tenCN = BROCHURE_NAME[condition] || 'Cẩm nang chăm sóc tại nhà';
          const chot = [loiMoiZaloOA(tenCN, daCoSo, false)];
          chot.forEach((m) => noteBotSent(conversationId, m));
          noteBotJustSent(conversationId);
          await sendMessages(pageId, conversationId, chot);
          store.appendHistory(conversationId, 'model', '[CHẠM-CHỐT-OA] ' + chot.join('\n'));
          console.log(`[cham${touchNo}] ${conversationId} khách im 2 chạm → gửi 1 ô chốt mời OA rồi DỪNG chuỗi`);
        } else {
          console.log(`[cham${touchNo}] ${conversationId} khách im 2 chạm (đã từng mời OA) → DỪNG chuỗi, không nhắn thêm`);
        }
        for (const n of [2, 3, 4, 5, 6, 7]) store.markTouchDone(conversationId, n);
        return;
      }
    }

    let messages = buildTouchMessages(touchNo, condition, daCoSo);
    if (!messages) {
      // Chạm 3 chưa có review clip → coi như đã làm (khỏi kẹt cron), bỏ qua nhẹ nhàng.
      console.log(`[cham${touchNo}] ${conversationId} không có nội dung (vd review chưa nạp) → đánh dấu xong, bỏ qua`);
      store.markTouchDone(conversationId, touchNo);
      return;
    }

    // ===== CHỐNG LẶP NGUYÊN VĂN (anh chốt 04/07: "lặp nguyên văn là lộ rõ BOT") =====
    // Ô nào đã từng gửi (nằm trong lịch sử tin bot) thì BỎ, không gửi lại lần 2.
    {
      const daGui = (fresh.history || [])
        .filter((h) => h.role === 'model')
        .map((h) => chuanHoaCau(h.text))
        .join('\n');
      messages = messages.filter((m) => {
        const trung = chuanHoaCau(m).length > 25 && daGui.includes(chuanHoaCau(m));
        if (trung) console.log(`[cham${touchNo}] ${conversationId} bỏ 1 ô trùng nguyên văn với tin đã gửi`);
        return !trung;
      });
      if (!messages.length) {
        console.log(`[cham${touchNo}] ${conversationId} mọi ô đều đã gửi trước đó → đánh dấu xong, không nhắn`);
        store.markTouchDone(conversationId, touchNo);
        return;
      }
    }

    messages.forEach((m) => noteBotSent(conversationId, m));
    noteBotJustSent(conversationId); // chống race echo
    await sendMessages(pageId, conversationId, messages);
    store.appendHistory(conversationId, 'model', `[CHẠM ${touchNo}] ` + messages.join('\n'));
    store.markTouchDone(conversationId, touchNo);
    // Bỏ qua các chạm THẤP hơn còn sót (lead vào đêm, sáng đã quá nhiều mốc → ta gửi mốc cao nhất,
    // các mốc cũ coi như lỡ, đánh dấu xong để KHÔNG gửi ngược chạm 3 sau khi đã gửi chạm 4).
    for (const lower of [2, 3, 4, 5, 6, 7]) {
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

  // B4: kênh Zalo + đã biết bệnh → gắn tag bệnh cho follower (fire-and-forget, idempotent)
  // để broadcast tin truyền thông lọc đúng nhóm bệnh sau này.
  if (freshConv?.channel === 'zalo' && freshConv?.zalo_user_id && knownCondition !== 'unknown') {
    tagFollowerBenh(freshConv.zalo_user_id, knownCondition).catch(() => {});
  }

  // ĐẢM BẢO gửi link sale page đúng bệnh (nếu Gemini quên chèn).
  let outMessages = ensureSalePageLink(reply.messages, knownCondition, conv);
  const linkWasAdded = outMessages.length !== reply.messages.length ||
    outMessages.some((m, i) => m !== reply.messages[i]);

  // CHỐNG LẶP NGUYÊN VĂN (anh chốt 04/07): bot lặp y câu đã nói là lộ máy → bỏ ô trùng.
  // Chỉ soi ô dài (>25 ký tự) để không chặn oan câu ngắn đời thường ("Dạ vâng ạ"…).
  {
    const daGui = (freshConv?.history || [])
      .filter((h) => h.role === 'model')
      .map((h) => chuanHoaCau(h.text))
      .join('\n');
    const truoc = outMessages.length;
    outMessages = outMessages.filter((m) => !(chuanHoaCau(m).length > 25 && daGui.includes(chuanHoaCau(m))));
    if (outMessages.length < truoc) {
      console.log(`[dispatch] ${conversationId} bỏ ${truoc - outMessages.length} ô trùng nguyên văn tin bot đã gửi`);
    }
  }

  if (outMessages.length) {
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
  } else {
    console.log(`[dispatch] ${conversationId} mọi ô đều trùng tin cũ → không gửi gì (tránh lộ bot)`);
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
    return;
  }

  // MUỐN ĐẶT LỊCH nhưng CHƯA có số → ca nóng, telesale vào chốt (báo 1 lần/ca).
  // (Ca đã có số đã báo notifyLead ở trên → không rơi xuống đây.)
  if (reply.booking_intent && !captured && !store.isBookingNotified(freshConv)) {
    store.markBookingNotified(conversationId);
    await notifyBooking({
      name: reply.name || customerName,
      condition: knownCondition,
      summary: knownSummary,
      pageId,
      conversationId,
    });
    console.log(`[booking] 📅 ${conversationId} muốn đặt lịch (chưa số) → đã báo Telegram`);
  }
}
