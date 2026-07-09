// Xử lý COMMENT dưới bài viết: rep công khai 1 câu mời ngắn + nhắn riêng kéo khách vào inbox.
// KHÔNG tư vấn công khai (tránh lộ thông tin bệnh + lộ bot). Mọi tư vấn diễn ra trong inbox.
//
// ⚠️ XÁC MINH FIELD: Pancake bắn comment qua event `messaging` nhưng payload comment có
// cấu trúc KHÁC tin nhắn (có comment_id / post_id / type='comment'). Parser dưới đọc linh
// hoạt nhiều biến thể field. Khi comment THẬT đầu tiên về, code in nguyên payload thô
// (console '[comment] payload thô') để đối chiếu & chỉnh field cho khít nếu cần.
import { getPageToken, replyComment, sendPrivateReply } from './pancake.js';
import { isPageEnabled } from './pancake.js';
import * as store from './store.js';
import { notifyComment } from './telegram.js';

// --- Mẫu câu rep CÔNG KHAI dưới comment (cố định, xoay vòng cho đỡ lộ) ---
// Ngắn, lịch sự, KHÔNG nhắc bệnh/giá, chỉ mời vào inbox. Khớp giọng phòng khám.
const PUBLIC_REPLIES = [
  'Dạ Hiệp Lợi đã nhận thông tin của mình rồi nha ạ 🥰 Em nhắn tin riêng cho mình để Bác sĩ tư vấn kỹ hơn ạ!',
  'Dạ em cảm ơn anh/chị đã quan tâm ạ 🌷 Em đã nhắn riêng cho mình rồi nha, mình kiểm tra tin nhắn giúp em ạ!',
  'Dạ Hiệp Lợi xin phép nhắn riêng để tư vấn cụ thể cho mình ạ 🙏 Mình check hộp thư giúp em nha!',
];
let publicReplyIdx = 0;
function nextPublicReply() {
  const m = PUBLIC_REPLIES[publicReplyIdx % PUBLIC_REPLIES.length];
  publicReplyIdx++;
  return m;
}

// --- Tin NHẮN RIÊNG (private reply) mở màn trong inbox ---
// Tách 2 ô cho tự nhiên. Tư vấn sâu để bot inbox lo tiếp khi khách trả lời.
function privateOpener(name) {
  const xung = name ? '' : 'mình ';
  return [
    `Dạ em chào ${name ? name + ' ' : 'anh/chị '}ạ, em là trợ lý Phòng khám Hiệp Lợi 🌷`,
    `Em thấy ${xung}có hỏi bên dưới bài viết. Mình đang gặp tình trạng đau ở đâu, bị bao lâu rồi để em nhờ Bác sĩ xem giúp mình nha ạ?`,
  ];
}

// Bỏ thẻ HTML cơ bản (comment cũng có thể bọc <div>).
function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .trim();
}

/**
 * Nhận diện payload webhook có phải là COMMENT không.
 * Pancake gắn dấu hiệu comment qua một trong các field: type/message_type='comment',
 * sự hiện diện của comment_id / post_id, hoặc data.comment.
 */
export function isCommentEvent(body) {
  if (!body || typeof body !== 'object') return false;
  const data = (body.data && typeof body.data === 'object') ? body.data : body;
  const msg = (data.message && typeof data.message === 'object') ? data.message : data;
  const cm = (data.comment && typeof data.comment === 'object') ? data.comment : null;

  const typeStr = String(
    body.type || data.type || msg.type || msg.message_type || msg.event_type || ''
  ).toLowerCase();
  if (typeStr.includes('comment')) return true;
  if (cm) return true;
  // Có comment_id (và không phải tin nhắn inbox thuần) → coi là comment.
  const cid = msg.comment_id || data.comment_id || body.comment_id || (cm && (cm.id || cm.comment_id));
  if (cid) return true;
  return false;
}

/**
 * Trích thông tin comment từ payload (đọc linh hoạt nhiều biến thể field).
 * Trả về null nếu thiếu dữ liệu tối thiểu hoặc comment do CHÍNH PAGE đăng (tránh tự rep mình).
 */
export function parseComment(body) {
  const data = (body.data && typeof body.data === 'object') ? body.data : body;
  const msg = (data.message && typeof data.message === 'object') ? data.message : data;
  const cm = (data.comment && typeof data.comment === 'object') ? data.comment : msg;
  const conv = (data.conversation && typeof data.conversation === 'object') ? data.conversation : {};

  const pageId = msg.page_id || data.page_id || body.page_id || conv.page_id || null;
  const commentId =
    cm.comment_id || cm.id || msg.comment_id || data.comment_id || body.comment_id || null;
  // conversation_id của comment (Pancake gom comment 1 bài/1 người thành 1 conversation)
  const conversationId =
    msg.conversation_id || conv.id || data.conversation_id || cm.conversation_id || null;

  const fromObj = cm.from || msg.from || conv.from || {};
  const senderId = fromObj.id || cm.sender_id || null;
  const customerName = fromObj.name || cm.customer_name || conv.customer_name || null;

  const rawText =
    (typeof cm.message === 'string' ? cm.message : null) ||
    (typeof msg.message === 'string' ? msg.message : null) ||
    cm.content || cm.text || msg.text || null;
  const commentText = stripHtml(rawText);

  if (!pageId || !commentId) return null;

  // Comment do CHÍNH PAGE đăng (from.id === page_id) → bỏ qua, đừng tự rep chính mình / rep của bot.
  const fromPage = !!(senderId && String(senderId) === String(pageId));

  // Bài viết chứa comment — cho dòng "Nguồn" báo telesale biết khách vào từ bài nào.
  const postId = cm.post_id || msg.post_id || data.post_id || conv.post_id || null;

  return {
    pageId: String(pageId),
    commentId: String(commentId),
    conversationId: conversationId ? String(conversationId) : null,
    customerId: senderId ? String(senderId) : null,
    customerName,
    commentText, // có thể rỗng (comment chỉ icon/ảnh) — vẫn rep mời được
    fromPage,
    postId: postId ? String(postId) : null,
  };
}

/**
 * Xử lý 1 comment: rep công khai 1 câu mời + nhắn riêng kéo vào inbox + báo Telegram.
 * Idempotent: mỗi comment_id chỉ xử 1 lần (store.handled_comments).
 */
export async function handleComment(ev) {
  const { pageId, commentId, conversationId, customerName, commentText, fromPage } = ev;
  if (!isPageEnabled(pageId)) {
    console.log(`[comment] page ${pageId} chưa bật bot → bỏ qua`);
    return;
  }
  if (fromPage) {
    console.log(`[comment] comment ${commentId} do chính page đăng → bỏ qua`);
    return;
  }
  if (!getPageToken(pageId)) return;

  // Chống lặp: Pancake có thể bắn lại cùng comment nhiều lần.
  if (!store.markCommentHandledOnce(commentId, pageId)) {
    console.log(`[comment] comment ${commentId} đã xử trước đó → bỏ qua`);
    return;
  }

  console.log(`[comment] 💬 comment mới của ${customerName || ev.customerId} (comment ${commentId}): "${(commentText || '[không chữ]').slice(0, 80)}"`);

  // Ghi dấu nguồn "comment từ bài X" cho hội thoại (nếu Pancake gom được conv) — lần đầu thôi.
  if (ev.postId && conversationId && !store.getKV(`nguon:${conversationId}`)) {
    store.setKV(`nguon:${conversationId}`, JSON.stringify({ postId: ev.postId }));
  }

  // 1) Rep CÔNG KHAI 1 câu mời ngắn dưới comment.
  const publicMsg = nextPublicReply();
  const repOk = await replyComment(pageId, conversationId, commentId, publicMsg);

  // 2) Nhắn RIÊNG (private reply) kéo họ vào inbox — chỉ khi có conversationId.
  let privateOk = false;
  if (conversationId) {
    privateOk = await sendPrivateReply(pageId, conversationId, commentId, privateOpener(customerName));
  } else {
    console.warn(`[comment] comment ${commentId} thiếu conversation_id → không gửi được private reply (chỉ rep công khai)`);
  }

  // 3) Báo Telegram cho telesale theo dõi.
  try {
    await notifyComment({ name: customerName, commentText, pageId, conversationId, privateOk });
  } catch (e) {
    console.error('[comment] notify Telegram lỗi:', e?.message);
  }

  console.log(`[comment] xong comment ${commentId}: rep công khai ${repOk ? '✅' : '❌'}, nhắn riêng ${privateOk ? '✅' : '❌'}`);
}
