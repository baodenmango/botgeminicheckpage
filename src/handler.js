// Lõi xử lý hội thoại — dùng chung cho webhook (tin mới) và cron (retouch).
import { generateReply } from './gemini.js';
import { sendMessages, isPageEnabled, hasStopLabel, hasCustomerLabel, getPageChannel } from './pancake.js'; // sendMessages dùng cả khi xin lại SĐT sai
import * as store from './store.js';
import { extractPhone, extractPhoneFromHistory, diagnoseBadPhone } from './utils.js';
import { notifyLead, notifyHandover, notifyHandoverNudge, notifyBooking, isUrgent } from './telegram.js';
import { buildTouchMessages, loiMoiZaloOA } from './touches.js';
import { isZaloPage, stripZaloPrefix, tagFollowerBenh, sendRequestInfo, sendFileByUrl, isOpenApiEnabled } from './zalo.js';
import { normalizeMsg, noteBotSent, wasSentByBot, noteBotJustSent, lastBotSentAgoMs, ECHO_GRACE_MS } from './echoguard.js';
import { lookupMedi, buildContextTag } from './medi.js';
import { lookupDaKham, buildDaKhamTag } from './daKham.js';
import { buildCarePlanTag } from './careplan.js';
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

// Ô này có nhắc "suất tư vấn" / "suất tư vấn miễn phí" không? (bỏ dấu cho chắc).
// Audit 09/07: câu mời "giữ suất tư vấn với Bs Trình" lặp ≥2 lần với CÙNG 1 khách ở 54%
// hội thoại → ra số tụt 17% (nhắc 1 lần) xuống 7% (nhắc 2+). Lặp nguyên văn = lộ máy.
function demSuatTuVan(text) {
  const n = String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return /su[aâ]t tu van/.test(n);
}
// Câu chốt trung tính khi đã phải bỏ hết ô "suất tư vấn" (tránh gửi lượt rỗng).
const CAU_CHOT_TRUNG_TINH = 'Dạ mình cứ nhắn em bất cứ lúc nào cần nha ạ 🙏';

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
// TIN HỆ THỐNG FACEBOOK/PANCAKE — mẫu CÓ KÈM TÊN KHÁCH nên không so khít cả câu được.
//
// VÁ 23/07/2026 — LỖI ĐẮT NHẤT ĐO ĐƯỢC TRONG NGÀY (log Render 24h): "X đã trả lời một quảng cáo."
// là tin HỆ THỐNG Facebook bắn kèm mỗi lead vào từ quảng cáo. Nó dài 33 ký tự, không attachment,
// không vân tay bot, không khớp sổ echo → LỌT CẢ 6 CỬA LỌC của handlePageMessage → bot chấm là
// "telesale gõ tay" và TỰ CÂM 2 GIỜ. Đo thật: 46 HỘI THOẠI bị câm trong 24h, 100% cùng câu này —
// toàn bộ là lead ĐÃ TRẢ TIỀN QUẢNG CÁO (ca Hồ Tuyết hỏi "1 mũi bao nhiêu tiền" là một trong số đó).
//
// Vì sao KHÔNG nhét vào AUTO_REPLY_MARKERS: chuỗi con "da tra loi mot quang cao" thì được, nhưng
// mẫu này còn nhiều biến thể kèm tên (link Facebook, "đã để lại bình luận"...) và tên khách nằm ở
// ĐẦU câu → dùng regex neo cuối câu an toàn hơn includes, tránh chặn nhầm telesale thật lỡ nhắc
// tới chữ "quảng cáo" giữa câu tư vấn.
// Chỉnh qua env AUTO_REPLY_PATTERNS (phân tách |, cú pháp regex, so trên chuỗi ĐÃ bỏ dấu).
const AUTO_REPLY_PATTERNS = ((process.env.AUTO_REPLY_PATTERNS || '').trim() ||
  'da tra loi mot quang cao\\.?$|da tra loi quang cao\\.?$|ban dang phan hoi binh luan cua nguoi dung'
).split('|').map((s) => { try { return new RegExp(s.trim(), 'i'); } catch { return null; } }).filter(Boolean);

function isAutoReplyMessage(text) {
  const n = String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase();
  if (AUTO_REPLY_MARKERS.some((m) => n.includes(m))) return true;
  const bare = n.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (AUTO_REPLY_EXACT.includes(bare)) return true;
  // Tin hệ thống kèm tên khách → so bằng regex trên câu đã chuẩn hoá (giữ dấu chấm cuối).
  const cauSach = n.replace(/\s+/g, ' ').trim();
  return AUTO_REPLY_PATTERNS.some((re) => re.test(cauSach));
}

// VÂN TAY BOT (vá 20/07 — ca 13 hội thoại cờ human oan trong 85' log Render): lưới an toàn TẦNG 2
// sau khi bịt lỗ sổ echo ở care-send.js. Tin page mang dấu hiệu CHỈ BOT MỚI CÓ thì tuyệt đối không
// đánh cờ human, kể cả sổ echo trượt (restart mất RAM + kv chưa kịp ghi, Pancake đổi text...).
// Giữ danh sách HẸP: telesale thật cũng có thể dán link sale page khi tư vấn tay → chặn nhầm chỉ
// làm bot chạy song song người (thừa tin), còn đánh cờ oan là khách bị bỏ rơi 6h. Thà thừa còn hơn bỏ rơi.
// Chỉnh qua env CARE_FINGERPRINTS (phân tách |, so sau khi bỏ dấu + thường hoá).
// (dùng ||, và env để RỖNG thì rơi về mặc định — .env.example có dòng CARE_FINGERPRINTS= trống,
//  nếu tôn trọng chuỗi rỗng sẽ vô hiệu hoá lưới an toàn mà không ai biết.)
const CARE_FINGERPRINTS = ((process.env.CARE_FINGERPRINTS || '').trim() ||
  'phongkhamhieploi.vn|bac si trinh gui anh/chi|phong kham co xuong khop hiep loi xin chao' +
  '|em ben phong kham hiep loi|nhac lich tai kham|sau buoi dieu tri hom'
).split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
function laVanTayBot(text) {
  const n = String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase();
  if (!n.trim()) return false;
  return CARE_FINGERPRINTS.some((m) => n.includes(m));
}

// Số giờ telesale "giữ" hội thoại sau khi gõ tay (quá thì bot tiếp quản lại).
// VÁ 20/07: hạ mặc định 6h → 2h. Cờ human oan khoá luôn cả retouch (handler.js ~650) + 2 truy vấn
// engine chạm (store.js) → 1 cờ sai = 6h khách bị bỏ rơi. Telesale thật gõ tay thường xử dứt ≤2h;
// ca đã gắn nhãn "đã đặt lịch/telesale xử" vẫn bị chặn độc lập ở hasStopLabel nên không bị chen ngang.
const HUMAN_HOLD_HOURS = parseFloat(process.env.HUMAN_HOLD_HOURS || '2');

// --- KHÁCH TỰ BÁO "ĐÃ ĐẾN KHÁM" (ca Loan Le 07/07) ---
// SOP quầy: nhân viên cầm máy bệnh nhân bấm Quan tâm OA + nhắn "Tôi đã đến khám".
// Conv này CHƯA có SĐT (chưa tra được POS/MEDi) nhưng chắc chắn là BỆNH NHÂN — nếu không
// nhận diện, bot đối xử như lead lạ: mời "suất tư vấn miễn phí", xin số... rất kỳ.
// → gắn cờ kv da_kham_conv:<convId>: bot chuyển mode CARE, chặn retouch/chạm xin số kiểu lead.
const boDauKham = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
export function laTinDaKham(text) {
  const n = ` ${boDauKham(text)} `;
  if (n.length > 90) return false; // câu dài là đang kể chuyện/hỏi bệnh → để Gemini xử theo prompt
  if (/ (chua|sap|chuan bi|dinh|muon|can|de|se) (di |den |toi |ghe )?kham/.test(n)) return false; // "chưa/sắp khám" ≠ đã khám
  if (/ khac( |$)/.test(n)) return false; // "đã khám Ở CHỖ/NƠI/BV KHÁC" (ca Hạnh Nguyên 08/07) ≠ đã khám Hiệp Lợi
  // Ý ĐỊNH TƯƠNG LAI ở BẤT KỲ đâu trong câu ≠ đã khám (ca Lê Hải 20/07: "mình MUỐN biết địa chỉ
  // phòng khám rồi mình ĐẾN KHÁM đậy đc ko" — khách chưa khám mà bot chào như bệnh nhân cũ).
  if (/ (muon|dinh|se|sap|chuan bi|chua) /.test(n)) return false;
  if (/ kham (duoc |dc )?(khong|ko|k)( |$)|^ kham /.test(n)) return false; // câu HỎI về việc khám
  // "khám rồi/xong" chỉ tính khi đứng CUỐI mệnh đề — "phòng khám RỒI mình đến..." là từ nối,
  // không phải "đã khám xong" (bẫy 20/07).
  return / (da|vua|moi) (di |den |toi |ghe )?kham | kham (xong|roi)( |$)(?!.* (den|toi|di|ghe) )/.test(n);
}
export function laConvDaKham(conversationId) {
  return Boolean(store.getKV(`da_kham_conv:${conversationId}`));
}

/**
 * Xử lý tin TỪ PAGE: phân biệt BOT tự gửi (bỏ qua) vs TELESALE gõ tay (đánh dấu human → bot lui).
 */
export async function handlePageMessage(ev) {
  const { conversationId, pageId, messageText, aiGenerated } = ev;
  if (!conversationId || !pageId) return;
  // VÁ 20/07/2026: `return` trần ở đây là cửa MÙ — page rụng khỏi config (thiếu token) thì
  // KHÔNG một dòng log nào ghi lại việc bỏ tin. Luôn log kèm convId để đếm được trên log Render.
  if (!isPageEnabled(pageId)) {
    console.warn(`[handler] ⛔ BỎ tin PAGE conv ${conversationId}: page ${pageId} chưa bật bot / thiếu token (xem [config] 🔴).`);
    return;
  }
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
  // LỚP 4 (vá 20/07 — ca 13 hội thoại cờ human oan): tin page mang VÂN TAY chuỗi chăm/bot
  // → không bao giờ đánh cờ, kể cả khi sổ echo trượt (restart mất RAM, Pancake đổi text).
  // Lưới an toàn tầng 2, KHÔNG thay việc care-send phải ghi sổ echo.
  if (laVanTayBot(messageText)) {
    console.log(`[handler] ${conversationId}: tin page mang VÂN TAY chuỗi chăm/bot → bỏ qua, KHÔNG đánh telesale | trích: "${String(messageText).slice(0, 40)}"`);
    return;
  }
  // Còn lại = TELESALE GÕ TAY THẬT → đánh dấu người tiếp quản, bot lui.
  // LOG LÝ DO + TRÍCH 40 KÝ TỰ (vá 20/07): trước đây log chỉ ghi "telesale gõ tay" nên soi log
  // Render không biết tin nào đã đánh cờ → mất 85' mới lần ra thủ phạm là echo tin chăm.
  store.ensureConversation(conversationId, pageId, null);
  store.markHumanTaken(conversationId);
  console.log(`[handler] 👤 ${conversationId}: telesale gõ tay → bot LUI (giữ ${HUMAN_HOLD_HOURS}h) | LÝ DO: lọt cả 6 cửa lọc (không aiGenerated / không attachment / không auto-reply / không khớp sổ echo / ngoài ${ECHO_GRACE_MS}ms echo-grace / dài ${cleaned.length}≥${HUMAN_MIN_CHARS} ký tự / không vân tay bot) | trích: "${String(messageText).slice(0, 40)}"`);
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
  // VÁ 20/07/2026 — CỬA MÙ CHẾT NGƯỜI: đây là nơi TIN KHÁCH bị vứt. Ca thật 20:05 ngày 20/07:
  // 14 hội thoại chưa đọc, khách hỏi giá tiêm khớp gối 19:47→20:05 mà "Chưa có người xem".
  // Nếu page rụng khỏi config vì thiếu token thì mọi tin đi qua đây bốc hơi KHÔNG DẤU VẾT.
  // Log ở mức ERROR + kèm tên khách & trích tin để soi log Render đếm được ngay khách nào rơi.
  if (!isPageEnabled(pageId)) {
    console.error(`[handler] ⛔ VỨT TIN KHÁCH — page ${pageId} chưa bật bot/thiếu token. conv=${conversationId} `
      + `khách="${customerName || '?'}" tin="${String(messageText || '').slice(0, 60)}" `
      + '→ nạp token: POST /admin/set-token?page=' + pageId);
    return;
  }
  // VÁ 20/07/2026: cửa này cũng từng câm. Tin khách RỖNG chữ đáng lẽ đã được
  // parsePancakeWebhook đổi thành placeholder ('[khách vừa gửi một hình ảnh/tệp]'), nên rơi
  // xuống đây = có đường gọi khác (rescue/cron) đẩy vào thiếu nội dung → phải thấy được, vì
  // mỗi ca là 1 khách im lặng không ai biết. Log WARN kèm convId để đếm trên log Render.
  if (!messageText || !messageText.trim()) {
    console.warn(`[handler] ⛔ BỎ tin RỖNG chữ — conv=${conversationId} page=${pageId} `
      + `khách="${customerName || '?'}" (nguồn gọi không phải webhook? xem parsePancakeWebhook)`);
    return;
  }

  if (lockHeld(conversationId)) {
    console.log(`[handler] ${conversationId} đang xử lý → XẾP HÀNG tin mới (không vứt)`);
    queuePending(ev);
    return;
  }
  lockAcquire(conversationId);
  try {
    const conv = store.ensureConversation(conversationId, pageId, customerName);

    // GHI DẤU NGUỒN (camp QC/ref/bài viết) — chỉ ghi LẦN ĐẦU (first touch mới là nguồn thật).
    // telegram.js đọc kv này dựng dòng "📣 Nguồn" cho telesale (yêu cầu anh Trình 09/07).
    if (ev.nguon && !store.getKV(`nguon:${conversationId}`)) {
      store.setKV(`nguon:${conversationId}`, JSON.stringify(ev.nguon));
      console.log(`[nguon] ${conversationId}: ${JSON.stringify(ev.nguon)}`);
    }
    // ĐO LƯỜNG: ghi cột source chuẩn hoá (song song kv nguon: trên — kv giữ cho telegram, cột để query).
    // Suy channel từ pageId (getPageChannel) vì conv.channel chưa set kịp lúc này (set tận ~dòng 422).
    try {
      const chSuy = getPageChannel(pageId);
      const src = store.suyNguon(typeof ev.nguon === 'string' ? ev.nguon : JSON.stringify(ev.nguon || ''), chSuy);
      if (src && src !== 'unknown') store.setSource(conversationId, src);
    } catch { /* không chặn luồng chính */ }

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
      // VÁ 20/07 — KHÔNG markHumanTaken ở đây nữa.
      // Trước: mỗi tin khách nhắn lại LÀM MỚI human_taken_at → khách càng hỏi càng tự gia hạn sự im lặng
      // của chính mình; rescue có gỡ cờ (rescueLead.js:195) thì lượt tin sau lại đóng lại = KẸT VĨNH VIỄN,
      // và cờ human còn khoá luôn retouch + 7 chạm + engine chăm. Nhãn đã là cờ chặn ĐỘC LẬP, đọc lại
      // mỗi lượt (có cache 15s ở getLabelNames) nên KHÔNG cần đóng thêm cờ human để "đỡ gọi API".
      // Gỡ nhãn trên Pancake là bot tiếp quản lại NGAY, không phải chờ hết HUMAN_HOLD_HOURS.
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

    // KHÁCH ĐÒI CẨM NANG → ghi "LỜI HỨA" xuống kv NGAY, trước mọi cửa chặn (human-hold...).
    // Ca Hạnh Nguyên 08/07: đòi 3 lần không được — lúc đòi bot đang bị khoá nhầm + chưa rõ bệnh,
    // đến khi biết bệnh thì không ai còn nhớ lời hứa. Giờ: hứa là NỢ, biết bệnh là giao.
    if (wantsDocument(messageText)) {
      store.setKV(`doc_wanted:${conversationId}`, String(Date.now()));
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

    // KHÁCH BÁO "ĐÃ ĐẾN KHÁM" mà conv chưa có SĐT (SOP quầy — ca Loan Le 07/07):
    // đây là BỆNH NHÂN, không phải lead → gắn cờ da_kham + cảm ơn + mời bấm nút
    // "Chia sẻ thông tin" để nối hồ sơ (1 nút, không bắt gõ số). KHÔNG đi kịch bản lead.
    if (!store.isCaptured(conv) && !laConvDaKham(conversationId) && laTinDaKham(messageText)) {
      store.setKV(`da_kham_conv:${conversationId}`, String(Date.now()));
      // Nút "Chia sẻ thông tin" là THẺ RIÊNG CỦA ZALO OA — Facebook KHÔNG có. Ca Lê Hải 20/07:
      // bot mời khách FB bấm thẻ không tồn tại → khách đứng hình. FB thì xin số bằng lời.
      const laZalo = isZaloPage(getPageChannel(pageId));
      const msgs = laZalo
        ? [
            'Dạ em cảm ơn mình đã tin tưởng ghé khám tại Hiệp Lợi nha ạ 🌿',
            'Để em nối đúng hồ sơ khám và gửi tài liệu chăm sóc đúng bệnh cho mình, mình bấm giúp em nút "Chia sẻ thông tin" ở thẻ bên dưới nha ạ 🙏',
          ]
        : [
            'Dạ em cảm ơn mình đã tin tưởng ghé khám tại Hiệp Lợi nha ạ 🌿',
            'Mình cho em xin số điện thoại đã đăng ký lúc khám để em nối đúng hồ sơ và gửi tài liệu chăm sóc đúng bệnh cho mình nha ạ 🙏',
          ];
      msgs.forEach((m) => noteBotSent(conversationId, m));
      noteBotJustSent(conversationId);
      // VÁ 20/07/2026: chỉ ghi lịch sử khi tin THẬT SỰ đi (token Pancake xoay vòng → gửi hụt).
      const okDK = await sendMessages(pageId, conversationId, msgs);
      if (!okDK) {
        console.error(`[da-kham] ❌ GỬI HỤT cho ${conversationId} → không ghi lịch sử, lượt sau mời lại`);
        return;
      }
      store.appendHistory(conversationId, 'model', msgs.join('\n'));
      const zuidDK = ev.customerId ? stripZaloPrefix(ev.customerId) : null;
      if (laZalo && zuidDK) sendRequestInfo(zuidDK).catch(() => {});
      console.log(`[da-kham] 🏥 ${conversationId} khách tự báo ĐÃ ĐẾN KHÁM → gắn cờ da_kham + mời bấm nút chia sẻ SĐT`);
      return;
    }

    // KHÁCH XIN TÀI LIỆU/CẨM NANG/BÀI TẬP → gửi PDF đúng bệnh NGAY (không đợi chạm 4).
    // Chỉ gửi khi ĐÃ biết bệnh (condition khác unknown) + có PDF. Chưa rõ bệnh → để Gemini hỏi bệnh.
    if (wantsDocument(messageText)) {
      const cond = conv.condition && conv.condition !== 'unknown' ? conv.condition : null;
      if (cond && BROCHURE_PDF[cond]) {
        await giaoCamNang(conversationId, pageId, cond, { xinSo: !store.isCaptured(conv) });
        return;
      }
      // chưa rõ bệnh → KHÔNG return, để Gemini hỏi "mình đau vùng nào"; lời hứa đã nằm trong kv,
      // biết bệnh là khối "trả nợ cẩm nang" sau dispatch giao liền.
      console.log(`[doc] ${conversationId} xin tài liệu nhưng chưa rõ bệnh → hứa đã ghi sổ, để Gemini hỏi bệnh`);
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
      // VÁ 20/07/2026: gửi hụt thì đừng ghi lịch sử (tránh tưởng đã xin lại số mà khách chưa nhận).
      const okXinLai = await sendMessages(pageId, conversationId, askAgain);
      if (!okXinLai) {
        console.error(`[handler] ❌ GỬI HỤT ô xin lại SĐT cho ${conversationId} → không ghi lịch sử`);
        return;
      }
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

    // Cờ da_kham (khách tự báo đã đến khám, SOP quầy) → cũng là khách, mode CARE.
    const daKhamTuBao = laConvDaKham(conversationId);
    if (daKhamTuBao) isCustomer = true;

    const channel = getPageChannel(pageId);
    let contextTag = null;
    // Hồ sơ "khách đã khám" tra được ở lượt này (MEDi/POS) — dùng chọn mode aftercare
    // + gắn quy trình chăm sóc + chặn link sale page (khối chung phía dưới).
    let daKhamHoSo = null;

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
            daKhamHoSo = daKham;
            contextTag = buildDaKhamTag(daKham);
            console.log(`[da-kham] 🧡 ${conversationId} SĐT ${phoneKnown} trùng ${daKham.source.toUpperCase()} (${daKham.name || '?'}) → chuyển CHĂM SÓC SAU KHÁM`);
          }
        } catch { /* fail-open */ }
      }
    }

    // ===== ENRICH (kênh ZALO) — nạp hồ sơ BN trước khi chăm (thiết kế mục C2) =====
    // Chỉ cho kênh Zalo (OA = chăm sâu, cần biết khách là ai). FB dùng lớp "đã khám" ở trên.
    // Tra MEDi theo SĐT (regex / lịch sử / phone đã lưu). Có hồ sơ → BN_CŨ; không → BN_MỚI.
    // Fail-open: MEDi chưa cấu hình → lookupMedi trả null → coi như BN_MỚI, vẫn chăm bình thường.
    if (isZaloPage(channel)) {
      // nhớ kênh + zalo_user_id (từ customerId "zl_<uid>") để engine chạm/giao file dùng sau
      const zaloUid = ev.customerId ? stripZaloPrefix(ev.customerId) : null;
      store.setChannel(conversationId, 'zalo', zaloUid);
      const freshZ = store.getConversation(conversationId);
      // Cache CHỈ tin khi đã ra BN_CŨ. Ra 'moi' thì TRA LẠI mỗi lượt (ca quét OA tại quầy:
      // khám hôm nay, hồ sơ MEDi/POS mai mới sync — cache 'moi' cứng làm BN bị coi khách lạ mãi).
      // Tra lại rẻ: cache local SQLite trước, Sheet/POS đã có TTL riêng trong medi.js/pos.js.
      const cachedCu = freshZ.medi_status === 'cu' ? store.getMediRecord(freshZ) : null;
      if (cachedCu) {
        daKhamHoSo = { source: 'medi', ...cachedCu };
        contextTag = buildContextTag(cachedCu, conv.condition || null);
      } else {
        const phoneForLookup = phoneByRegex || freshZ.phone ||
          extractPhoneFromHistory(freshZ.history);
        if (phoneForLookup) {
          // MEDi trước (có bệnh án/liệu trình), POS vá lưới (khách lên đơn nhưng chưa vào EMR-sheet).
          const record = await lookupDaKham(phoneForLookup);
          if (record?.source === 'medi') store.setMedi(conversationId, 'cu', record);
          else if (!freshZ.medi_status) store.setMedi(conversationId, 'moi', null);
          if (record) {
            daKhamHoSo = record;
            contextTag = record.source === 'medi'
              ? buildContextTag(record, conv.condition || null)
              : buildDaKhamTag(record);
          } else {
            contextTag = buildContextTag(null, conv.condition || null);
          }
          console.log(`[enrich] ${conversationId} SĐT ${phoneForLookup} → ${record ? `BN_CŨ/${record.source} (${record.name || '?'})` : 'BN_MỚI'}`);
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

    // ===== BỘ NÃO CHĂM SÓC SAU KHÁM (anh Trình chốt 14/07) — mọi kênh =====
    // Có hồ sơ đã khám → gắn [QUY TRÌNH CHĂM SÓC] (hỏi thăm đúng bệnh, dặn đúng điều trị,
    // chăm theo giai đoạn) + cờ da_kham (thoát chuỗi chạm lead, dispatch chặn link sale page).
    if (daKhamHoSo) {
      isCustomer = true;
      const plan = buildCarePlanTag(daKhamHoSo, conv.condition || null);
      if (plan) contextTag = (contextTag ? contextTag + '\n' : '') + plan;
      if (!laConvDaKham(conversationId)) {
        store.setKV(`da_kham_conv:${conversationId}`, String(Date.now()));
        console.log(`[careplan] 🩺 ${conversationId} gắn quy trình chăm sóc sau khám (${daKhamHoSo.diagnosis || daKhamHoSo.source})`);
      }
    }

    // Thẻ ngữ cảnh ĐÃ-KHÁM-TỰ-BÁO: đè lên mọi tag khác — cấm tuyệt đối kịch bản lead.
    if (daKhamTuBao) {
      contextTag = (contextTag ? contextTag + '\n' : '') +
        '[KHÁCH ĐÃ ĐẾN KHÁM — TỰ XÁC NHẬN] Khách này ĐÃ đến khám tại phòng khám (quầy lễ tân xác nhận). ' +
        'TUYỆT ĐỐI KHÔNG chào như người lạ, KHÔNG mời "suất tư vấn miễn phí", KHÔNG dụ để lại số kiểu chốt lead. ' +
        'Vai của em: chăm sóc sau khám — hỏi thăm nhẹ, dặn theo hướng dẫn Bác sĩ Trình. ' +
        // Nút "Chia sẻ thông tin" CHỈ có trên Zalo OA. Nói câu này với khách Facebook =
        // chỉ khách bấm cái thẻ không tồn tại (ca Lê Hải 20/07).
        (isZaloPage(getPageChannel(pageId))
          ? 'Nếu cần nối hồ sơ, mời khách bấm nút "Chia sẻ thông tin" trên thẻ OA đã gửi (KHÔNG bắt gõ số).'
          : 'Đây là Facebook — KHÔNG có nút "Chia sẻ thông tin"/thẻ OA, TUYỆT ĐỐI không nhắc tới. Cần nối hồ sơ thì xin số điện thoại đã đăng ký lúc khám bằng lời.');
    }

    // THẺ TỆP PAGE (anh chốt 04/07): 2 page = 2 tệp khách, prompt mục 1B đọc thẻ này đổi nhịp tư vấn.
    if (channel !== 'zalo' && PAGE_AUDIENCE[pageId]) {
      contextTag = contextTag ? `${contextTag}\n${PAGE_AUDIENCE[pageId]}` : PAGE_AUDIENCE[pageId];
    }

    // Chọn mode: khách ĐÃ KHÁM (hồ sơ/tự báo) → aftercare (chăm sau khám, cấm kịch bản lead);
    // khách đã cho số/có nhãn → care; còn lại → reply (kịch bản lead thường).
    const mode = (daKhamHoSo || daKhamTuBao) ? 'aftercare' : isCustomer ? 'care' : 'reply';

    const history = store.getConversation(conversationId).history;
    const reply = await generateReply(history, mode, customerName || conv.customer_name, null, { channel, contextTag });

    await dispatch(conversationId, pageId, conv, reply, phoneByRegex, customerName);

    // TRẢ NỢ CẨM NANG: khách từng đòi (kv doc_wanted) mà lúc đó chưa rõ bệnh / bot bị chặn —
    // giờ lượt này đã chốt được bệnh (Gemini/link-fb/MEDi) → giao liền, không bắt đòi lại.
    try {
      const hua = Number(store.getKV(`doc_wanted:${conversationId}`) || 0);
      if (hua) {
        if (Date.now() - hua > 7 * 24 * 3600 * 1000) {
          store.delKV(`doc_wanted:${conversationId}`); // hứa quá 7 ngày → coi như nguội
        } else {
          const after = store.getConversation(conversationId);
          const c = after?.condition && after.condition !== 'unknown' ? after.condition : null;
          if (c && BROCHURE_PDF[c]) await giaoCamNang(conversationId, pageId, c);
        }
      }
    } catch (e) { console.warn('[doc] trả nợ cẩm nang lỗi:', e?.message); }
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
 * GIAO CẨM NANG đúng bệnh. Kênh Zalo có uid + OpenAPI → gửi FILE PDF THẬT (sang hơn link);
 * còn lại gửi link. Xoá "lời hứa" kv doc_wanted sau khi giao.
 * @param {object} opts  { xinSo: true → kèm 1 ô xin số (lead chưa có số) }
 */
async function giaoCamNang(conversationId, pageId, cond, opts = {}) {
  const pdf = BROCHURE_PDF[cond];
  if (!pdf) return false;
  const ten = BROCHURE_NAME[cond] || 'cẩm nang chăm sóc tại nhà';
  const fresh = store.getConversation(conversationId);
  // uid Zalo: ưu tiên cột zalo_user_id; conv Zalo nào thiếu thì móc từ chính conv id "zl_<oa>_<uid>"
  const zuid = stripZaloPrefix(fresh?.zalo_user_id || '') ||
    (String(conversationId).startsWith('zl_') ? String(conversationId).split('_')[2] : null);
  const guiFileThat = Boolean(zuid && isOpenApiEnabled());

  const msgs = [`Dạ em gửi mình "${ten}" nha ạ 🌿`];
  if (!guiFileThat) msgs.push(`Mình xem và áp dụng dần nha: ${pdf}`);
  if (opts.xinSo) {
    msgs.push('Mình muốn Bác sĩ xem kỹ tình trạng và tư vấn hướng phù hợp thì để lại số điện thoại giúp em nha, Bác sĩ gọi tư vấn miễn phí cho mình ạ 🙏');
  }
  msgs.forEach((m) => noteBotSent(conversationId, m));
  noteBotJustSent(conversationId);
  // VÁ 20/07/2026: gửi hụt (token xoay) thì GIỮ cờ doc_wanted để lượt sau giao lại cẩm nang,
  // đừng delKV/appendHistory cho tin chưa rời máy.
  const okDoc = await sendMessages(pageId, conversationId, msgs);
  if (!okDoc) {
    console.error(`[doc] ❌ GỬI HỤT cẩm nang ${cond} cho ${conversationId} → giữ cờ doc_wanted, lượt sau giao lại`);
    return false;
  }
  if (guiFileThat) {
    // sendFileByUrl tự lùi về gửi link khi upload/gửi file hụt → không cần phao thêm
    await sendFileByUrl(zuid, pdf, `${ten}.pdf`).catch(() => {});
  }
  store.appendHistory(conversationId, 'model', `${msgs.join('\n')}${guiFileThat ? '\n[đã gửi file PDF cẩm nang]' : ''}`);
  store.delKV(`doc_wanted:${conversationId}`);
  console.log(`[doc] 📄 ${conversationId} đã giao cẩm nang bệnh ${cond} (${guiFileThat ? 'FILE THẬT qua OpenAPI' : 'link'})`);
  return true;
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
    // Khách ĐÃ KHÁM (cờ da_kham) → KHÔNG chạm kiểu lead ("giữ suất tư vấn miễn phí"...);
    // chuỗi bill-care D0/1/3/6/7 lo phần chăm. Đốt lượt retouch để cron sau khỏi nhặt lại.
    if (laConvDaKham(conversationId)) {
      store.incRetouch(conversationId);
      console.log(`[retouch] ${conversationId} khách ĐÃ KHÁM → bỏ chạm lead, để bill-care lo`);
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
  // VÁ 20/07/2026: log thay vì `return` câm — chạm 7-bước bị bỏ mà không ai biết thì lead nguội chết lặng.
  if (!isPageEnabled(pageId)) {
    console.warn(`[handler] ⛔ BỎ chạm ${touchNo} conv ${conversationId}: page ${pageId} chưa bật bot/thiếu token.`);
    return;
  }
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
    // Khách ĐÃ KHÁM (cờ da_kham) → thoát chuỗi chạm lead hẳn (bill-care lo phần chăm).
    if (laConvDaKham(conversationId)) {
      for (const n of [2, 3, 4, 5, 6, 7]) store.markTouchDone(conversationId, n);
      console.log(`[cham${touchNo}] ${conversationId} khách ĐÃ KHÁM → thoát chuỗi chạm lead`);
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
          // VÁ 20/07/2026: gửi hụt thì KHÔNG ghi lịch sử và KHÔNG khoá cả chuỗi chạm 2–7 bên dưới
          // (trước đây markTouchDone chạy vô điều kiện → ô chốt mời OA mất trắng vĩnh viễn).
          const okChot = await sendMessages(pageId, conversationId, chot);
          if (!okChot) {
            console.error(`[cham${touchNo}] ❌ GỬI HỤT ô chốt mời OA cho ${conversationId} → KHÔNG khoá chuỗi, cron sau thử lại`);
            return;
          }
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

    // ===== CHỐNG LẶP ĐÒN "SUẤT TƯ VẤN" (VIỆC #4) — chạm gửi TRỰC TIẾP, không qua dispatch =====
    // Chuỗi chạm 2/5/6/7 (touches.js) cũng nhắc "suất tư vấn" → dùng CHUNG sổ với dispatch.
    // Audit 09/07: lặp ≥2 lần → ra số 7% vs 17% (nhắc 1 lần), 54% hội thoại lặp.
    {
      const daNhac = parseInt(store.getKV(`suattuvan_count:${conversationId}`) || '0', 10) || 0;
      if (daNhac >= 1) {
        // Audit đặt mốc: NHẮC 1 LẦN = ra số 17%, nhắc 2+ = tụt 7%. Vậy chỉ LẦN ĐẦU (lúc count=0)
        // mới cho câu "suất tư vấn" đi qua; đã nhắc ≥1 lần thì các lượt sau BỎ HẾT ô mời tư vấn.
        const truoc = messages.length;
        messages = messages.filter((m) => !demSuatTuVan(m));
        if (messages.length < truoc) {
          console.log(`[cham${touchNo}] ${conversationId} đã nhắc "suất tư vấn" ${daNhac} lần → bỏ ${truoc - messages.length} ô mời trùng (chỉ cho nhắc 1 lần)`);
        }
        if (!messages.length) {
          console.log(`[cham${touchNo}] ${conversationId} chạm chỉ toàn ô "suất tư vấn" trùng → đánh dấu xong, không nhắn`);
          store.markTouchDone(conversationId, touchNo);
          return;
        }
      }
    }

    messages.forEach((m) => noteBotSent(conversationId, m));
    noteBotJustSent(conversationId); // chống race echo
    // VÁ 20/07/2026 (ca log Render 11:10→12:35 UTC): 9× Pancake "access_token renewed" → tin KHÔNG
    // tới khách mà ở đây vẫn markTouchDone → chạm đóng dấu vĩnh viễn, mất trắng, không tự khỏi.
    // Nay: gửi hụt thì KHÔNG ghi lịch sử, KHÔNG markTouchDone → cron sau chạm lại.
    const guiOk = await sendMessages(pageId, conversationId, messages);
    if (!guiOk) {
      console.error(`[cham${touchNo}] ❌ GỬI HỤT (token/kênh) cho ${conversationId} → KHÔNG đánh dấu xong, cron sau chạm lại`);
      return;
    }
    store.appendHistory(conversationId, 'model', `[CHẠM ${touchNo}] ` + messages.join('\n'));
    // Cập nhật SỔ "suất tư vấn" (dùng chung dispatch) — cộng số ô mời thực gửi ở chạm này.
    {
      const soOMoi = messages.filter((m) => demSuatTuVan(m)).length;
      if (soOMoi > 0) {
        const truoc = parseInt(store.getKV(`suattuvan_count:${conversationId}`) || '0', 10) || 0;
        store.setKV(`suattuvan_count:${conversationId}`, String(truoc + soOMoi));
      }
    }
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
  // KHÁCH ĐÃ KHÁM (cờ da_kham) → KHÔNG ép link sale page (họ là bệnh nhân rồi, gửi trang bán
  // hàng là lộ máy + lạc vai chăm sóc — ca Thủy Tiên 14/07 bị dí link daulung sau khi chia sẻ số).
  let outMessages = laConvDaKham(conversationId)
    ? [...reply.messages]
    : ensureSalePageLink(reply.messages, knownCondition, conv);
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
    // PHAO CỨU SINH (VÁ 20/07/2026 — ca 14 hội thoại CHƯA ĐỌC, ảnh Pancake 20:05):
    // Đây là cửa lọc DUY NHẤT trong 3 cửa của dispatch KHÔNG có phao (cửa gỡ link có phao ở ~910,
    // cửa chống lặp "suất tư vấn" có phao ở ~943). Hậu quả thật: Gemini 429/503 → câu treo suy giảm
    // 35 ký tự (>25) đã nằm trong history → cửa này xoá SẠCH → rơi nhánh else "không gửi gì" → BOT IM HẲN.
    // Khách hỏi giá tiêm 19:47–20:05 (Hiên Thi Vu, Nguyễn Oanh, Rose Rose, Đặng Sáng, Cu Tủn, Xuân Ngọc)
    // đúng vì cái này. THÀ THỪA 1 CÂU TRUNG TÍNH CÒN HƠN IM — im là mất lead đã trả tiền quảng cáo.
    if (outMessages.length === 0 && truoc > 0) {
      outMessages = [CAU_CHOT_TRUNG_TINH];
      console.log(`[dispatch] ${conversationId} ⚠️ mọi ô (${truoc}) trùng tin cũ → THẢ 1 câu trung tính, KHÔNG IM (phao chống bỏ rơi khách)`);
    }
  }

  // ===== VIỆC #2 — KỶ LUẬT LINK (audit 09/07: loạt CÓ link khách nhắn tiếp 30% vs KHÔNG link 57%) =====
  // Bot gắn sale page quá sớm, quá dày → rớt khách. Thêm 2 luật (giữ nguyên cờ sale_link_sent
  // của ensureSalePageLink, chỉ SIẾT thêm):
  {
    // (a) LƯỢT TRẢ LỜI ĐẦU của bot KHÔNG được kèm BẤT KỲ link nào — gửi link ngay câu đầu làm rớt khách.
    //     Bỏ MỌI link http/https (sale page, Drive/PDF, clip FB, Zalo OA), không chỉ riêng sale page.
    //     Lượt model đầu = trong lịch sử CHƯA có 'model' nào trước lượt này.
    const daCoModel = (freshConv?.history || []).some((h) => h.role === 'model');
    if (!daCoModel) {
      const truoc = outMessages.length;
      const locSach = outMessages.filter((m) => !/https?:\/\//i.test(String(m)));
      if (locSach.length > 0) {
        // Còn ô chữ → bỏ hẳn các ô link.
        outMessages = locSach;
      } else {
        // LƯỢT ĐẦU mà Gemini CHỈ trả ô chứa link (không có ô chữ nào) → ĐỪNG để lượt rỗng (bot im).
        // Gỡ link RA KHỎI từng ô, giữ lại phần chữ; ô nào gỡ xong rỗng thì bỏ.
        outMessages = outMessages
          .map((m) => String(m).replace(/https?:\/\/\S+/gi, '').replace(/[ \t]{2,}/g, ' ').trim())
          .filter((m) => m.length > 0);
        // Cùng lắm vẫn rỗng (ô chỉ có mỗi link) → giữ 1 câu trung tính, KHÔNG im.
        if (outMessages.length === 0) outMessages = [CAU_CHOT_TRUNG_TINH];
      }
      if (outMessages.length !== truoc) {
        console.log(`[dispatch] ${conversationId} lượt trả lời ĐẦU → gỡ link (30% vs 57% continuation, không để lượt rỗng)`);
      }
    }
    // (b) TỐI ĐA 1 link/lượt: nếu có ≥2 ô chứa 'http' → chỉ giữ ô link ĐẦU, bỏ các ô link sau.
    let daGiuLink = false;
    const truocHttp = outMessages.length;
    outMessages = outMessages.filter((m) => {
      if (!String(m).includes('http')) return true;
      if (!daGiuLink) { daGiuLink = true; return true; }
      return false; // ô link thứ 2 trở đi → bỏ
    });
    if (outMessages.length < truocHttp) {
      console.log(`[dispatch] ${conversationId} bỏ ${truocHttp - outMessages.length} ô link thừa (tối đa 1 link/lượt)`);
    }
  }

  // ===== VIỆC #4 — SỔ CHỐNG LẶP ĐÒN "SUẤT TƯ VẤN" (audit 09/07: lặp ≥2 lần → ra số 7% vs 17%, 54% hội thoại) =====
  // Sổ đếm theo hội thoại: đã nhắc "suất tư vấn" bao nhiêu lần. Nhiều nguồn (Gemini, chạm, care)
  // cùng nhắc → cần đếm chung. dispatch là điểm nghẽn của cả retouch/incoming nên đặt luật ở đây.
  {
    const daNhac = parseInt(store.getKV(`suattuvan_count:${conversationId}`) || '0', 10) || 0;
    if (daNhac >= 1) {
      // Audit đặt mốc: NHẮC 1 LẦN = ra số 17%, nhắc 2+ = tụt 7%. Vậy chỉ LẦN ĐẦU (lúc count=0)
      // mới cho câu "suất tư vấn" đi qua; đã nhắc ≥1 lần thì các lượt sau BỎ HẾT ô mời tư vấn.
      const truoc = outMessages.length;
      outMessages = outMessages.filter((m) => !demSuatTuVan(m));
      if (outMessages.length < truoc) {
        console.log(`[dispatch] ${conversationId} đã nhắc "suất tư vấn" ${daNhac} lần → bỏ ${truoc - outMessages.length} ô mời trùng (chống lặp đòn)`);
      }
      // Sau khi bỏ mà rỗng lượt (chỉ toàn ô mời) → giữ lại 1 ô trung tính, đừng gửi lượt rỗng/im.
      if (!outMessages.length && truoc > 0) {
        outMessages = [CAU_CHOT_TRUNG_TINH];
      }
    }
  }

  if (outMessages.length) {
    // Gửi các ô thoại về khách qua Pancake
    outMessages.forEach((m) => noteBotSent(conversationId, m)); // đánh dấu bot gửi (để khỏi nhầm là người gõ)
    noteBotJustSent(conversationId); // chống race: đánh dấu thời điểm bot gửi (echo sắp dội về)
    // VÁ 20/07/2026: gửi hụt (token xoay / #551) thì KHÔNG ghi lịch sử, KHÔNG cắm cờ đã-gửi-link
    // — trước đây markSaleLinkSent chạy cho tin chưa hề rời máy → khách không bao giờ nhận link.
    const guiOk = await sendMessages(pageId, conversationId, outMessages);
    if (!guiOk) {
      // KHÔNG return ở đây: phần dưới còn bắt SĐT + báo lead telesale — mất tin bot thì càng
      // phải để người gọi khách. Chỉ bỏ các bước "coi như đã gửi".
      console.error(`[dispatch] ❌ GỬI HỤT cho ${conversationId} → không ghi lịch sử, không cắm cờ đã gửi link/suất tư vấn`);
    } else if (reply.degraded) {
      // VÁ 20/07/2026 — CÂU TREO SUY GIẢM (Gemini 429/503): tin ĐÃ GỬI cho khách (không im),
      // nhưng TUYỆT ĐỐI KHÔNG ghi vào history role=model. Lý do: ghi vào là lượt sau cửa lọc
      // chống-lặp (~883) bắt đúng nó rồi xoá sạch → bot im hẳn. Câu treo tự khoá chính nó.
      // Không ghi history còn giúp Gemini lúc hồi quota không "học" theo câu treo vô nghĩa.
      console.warn(`[dispatch] ⚠️ ${conversationId} Gemini SUY GIẢM → đã gửi câu treo giữ khách, KHÔNG ghi history, KHÔNG cắm cờ link/suất tư vấn`);
      // (1) MỞ LẠI CỬA VỚT: lượt này chưa trả lời được khách câu nào có nghĩa → đừng để rescueLead
      //     coi là "đã thử xong" rồi khoá ca lại. Xoá dấu để cron 5' sau vớt lại khi quota hồi.
      //     Import động: rescueLead đã import handler → import tĩnh ngược lại sẽ thành vòng.
      try {
        const { clearRescueAttempt } = await import('./rescueLead.js');
        clearRescueAttempt(conversationId);
      } catch (e) {
        console.warn(`[dispatch] ${conversationId} không xoá được dấu rescue: ${e?.message || e}`);
      }
      // (2) BÁO NGƯỜI (nguyên tắc vàng: bot không trả lời được thì NGƯỜI phải biết ngay, SLA ≤5').
      //     Ca thật 20/07: Gemini chết đúng lúc khách hỏi giá tiêm → reply.booking_intent bị ép
      //     false nên telesale KHÔNG hề biết có lead nóng. Bot im MÀ người cũng không được báo.
      //     Chặn spam Telegram: 1 lần / hội thoại / 1 giờ (KV có mốc thời gian, tự hết hạn mềm).
      const kDeg = `degraded_notified:${conversationId}`;
      const lanTruoc = parseInt(store.getKV(kDeg) || '0', 10) || 0;
      if (Date.now() - lanTruoc > 3600 * 1000) {
        store.setKV(kDeg, String(Date.now()));
        await notifyHandover({
          name: reply.name || customerName,
          reason: 'Gemini chết (429/503) — khách hỏi mà bot chỉ trả được câu treo. VÀO REP TAY GẤP.',
          condition: knownCondition,
          summary: knownSummary,
          pageId,
          conversationId,
        }).catch((e) => console.error(`[dispatch] ${conversationId} báo Telegram suy giảm hụt: ${e?.message || e}`));
        console.warn(`[dispatch] 📣 ${conversationId} đã BÁO NGƯỜI (Gemini suy giảm) — telesale vào rep tay`);
      } else {
        console.log(`[dispatch] ${conversationId} Gemini suy giảm nhưng đã báo người trong 1h → không báo lại (chống spam)`);
      }
    } else {
      // Lưu lượt bot vào lịch sử (gộp các ô thành 1 lượt 'model')
      store.appendHistory(conversationId, 'model', outMessages.join('\n'));
      // Đánh dấu đã gửi link để không lặp lại mỗi lượt
      if (linkWasAdded && SALE_PAGE[knownCondition]) {
        store.markSaleLinkSent(conversationId);
      }
      // Cập nhật SỔ "suất tư vấn": cộng số ô mời THỰC GỬI (audit 09/07 — 17%→7%, 54% hội thoại).
      const soOMoi = outMessages.filter((m) => demSuatTuVan(m)).length;
      if (soOMoi > 0) {
        const truoc = parseInt(store.getKV(`suattuvan_count:${conversationId}`) || '0', 10) || 0;
        store.setKV(`suattuvan_count:${conversationId}`, String(truoc + soOMoi));
      }
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
