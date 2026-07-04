// Pancake (pages.fm) client — ĐA TRANG.
// Tra token theo page_id rồi gửi tin. Gửi nhiều ô = gọi nhiều lần, có delay.
//
// ⚠️ XÁC MINH ENDPOINT: Pancake Public API có thể đổi đường dẫn/tham số theo
// thời điểm và theo kênh (FB/TikTok/Zalo). Đường dẫn mặc định dưới đây theo
// Public API pages.fm. Nếu gửi lỗi, đối chiếu tài liệu tại
// https://pages.fm/ (Cài đặt → Công cụ → API) hoặc developers.pancake.vn
// và chỉnh PANCAKE_API_BASE / hàm sendMessage cho khớp.
import axios from 'axios';
import { config } from './config.js';
import { isOpenApiEnabled, sendText as zaloSendText } from './zalo.js';

const API_BASE = process.env.PANCAKE_API_BASE || 'https://pages.fm/api/public_api/v1';

// Trích zalo user_id từ conversation_id Pancake-Zalo dạng "zl_<pageId>_<psid>" → psid = user_id.
// Page token Pancake Zalo hay bị xoay vòng (error 105) → kênh Zalo ưu tiên gửi qua Zalo OpenAPI
// (token tự refresh). Trả null nếu không tách được.
function zaloUserIdFromConv(conversationId) {
  const m = String(conversationId || '').match(/^zl_\d+_(\d+)$/);
  return m ? m[1] : null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Delay "giống người thật" TRƯỚC khi gửi ô thứ i (i bắt đầu từ 0).
// Mô phỏng người tư vấn thật: ĐỌC tin khách → NGHĨ (lắng nghe, đồng cảm) → GÕ trên điện thoại.
// Tốc độ gõ ĐT thật ~4–5 ký tự/giây (KHÔNG phải máy bắn tức thì). Tin đầu cũng phải có
// nhịp đọc+nghĩ, KHÔNG gửi ngay — trả lời tức thì là dấu hiệu lộ "bot" rõ nhất.
//
// Có thể tinh chỉnh qua env:
//   TYPE_MS_PER_CHAR (mặc định 180ms/ký tự ≈ 5.5 ký tự/s)
//   THINK_MIN_MS / THINK_RAND_MS (nhịp nghĩ trước khi gõ)
//   FIRST_READ_MS (nhịp đọc tin khách trước khi gõ ô ĐẦU)
//   DELAY_CAP_MS (trần mỗi ô, tránh khách chờ quá lâu)
// Mục tiêu (chốt với anh): 1 câu thường ~45 ký tự hiện ra sau ~4–6s — giống người đọc+gõ.
const TYPE_MS_PER_CHAR = parseInt(process.env.TYPE_MS_PER_CHAR || '70', 10);  // ~14 ký tự/s, gõ nhanh tay
const THINK_MIN_MS = parseInt(process.env.THINK_MIN_MS || '1000', 10);
const THINK_RAND_MS = parseInt(process.env.THINK_RAND_MS || '1200', 10);
const FIRST_READ_MS = parseInt(process.env.FIRST_READ_MS || '800', 10);       // nhịp đọc tin khách trước khi gõ ô đầu
const DELAY_CAP_MS = parseInt(process.env.DELAY_CAP_MS || '8000', 10);        // trần 8s/ô (câu rất dài)

function humanDelay(text, index) {
  const len = (text || '').length;
  // gõ: tỉ lệ độ dài, tốc độ người thật trên ĐT
  const typing = len * TYPE_MS_PER_CHAR;
  // nghĩ: nhịp "lắng nghe + cân nhắc" trước khi gõ, có ngẫu nhiên cho tự nhiên
  const thinking = THINK_MIN_MS + Math.floor(Math.random() * THINK_RAND_MS);
  // ô ĐẦU: thêm nhịp ĐỌC tin khách (người thật đọc xong mới gõ — không bắn ngay)
  const read = index === 0 ? FIRST_READ_MS + Math.floor(Math.random() * 1500) : 0;
  // tin càng về sau nghĩ thêm chút (như đang cân nhắc nói tiếp)
  const lean = index > 0 ? (index - 1) * 500 : 0;
  return Math.min(read + thinking + typing + lean, DELAY_CAP_MS);
}

// Tra cấu hình 1 page theo page_id, KHỚP LINH HOẠT tiền tố kênh.
// Lý do: Pancake gửi webhook page Zalo có thể là "3136..." (không tiền tố) HOẶC "zl_3136..."
// tùy endpoint/sự kiện. Token generate lại theo dạng "zl_...". Ta khớp cả 2 để không rớt tin.
// Chuẩn hoá: bỏ tiền tố kênh (zl_/pzl_/ttm_/fb_) rồi so phần lõi.
export function stripChannelPrefix(id) {
  return String(id || '').replace(/^(zl_|pzl_|ttm_|fb_|tt_)/i, '');
}
function findPageConfig(pageId) {
  const pages = config.pancakePages;
  const key = String(pageId);
  if (pages[key]) return pages[key];                 // khớp khít trước
  const core = stripChannelPrefix(key);              // khớp theo phần lõi (bỏ tiền tố)
  for (const k of Object.keys(pages)) {
    if (stripChannelPrefix(k) === core) return pages[k];
  }
  return null;
}

// Lấy token của 1 trang theo page_id; null nếu trang không được cấu hình.
export function getPageToken(pageId) {
  return findPageConfig(pageId)?.token || null;
}

export function getPageChannel(pageId) {
  return findPageConfig(pageId)?.channel || 'facebook';
}

// Có biết trang này không (để bỏ qua webhook của trang chưa bật bot).
export function isPageEnabled(pageId) {
  return Boolean(findPageConfig(pageId));
}

// Trả về page_id ĐÚNG như đã cấu hình (key trong config) — dùng khi GỬI để khớp token/endpoint.
// Webhook có thể đưa id thiếu tiền tố; khi gửi phải dùng id chuẩn (vd zl_3136...).
export function canonicalPageId(pageId) {
  const pages = config.pancakePages;
  const key = String(pageId);
  if (pages[key]) return key;
  const core = stripChannelPrefix(key);
  for (const k of Object.keys(pages)) {
    if (stripChannelPrefix(k) === core) return k;
  }
  return key;
}

// --- CỜ TẮT BOT THEO NHÃN PANCAKE ---
// Telesale chốt lịch khám / đang xử tay → gắn 1 trong các nhãn này lên hội thoại.
// Bot đọc nhãn TRƯỚC khi gửi; thấy cờ thì IM, không chồng tin tư vấn.
// Tùy biến qua env STOP_BOT_LABELS (phân tách bằng dấu phẩy). So khớp KHÔNG dấu, không phân biệt hoa thường.
//
// ⚠️ CHỈ chứa nhãn "TELESALE ĐANG XỬ / CẦN NGƯỜI / BOT DỪNG HẲN".
// KHÔNG cho nhãn "đã mua / đã thu tiền / checkin" vào đây — vì khách ĐÃ MUA thì bot
// KHÔNG im hẳn, mà CHUYỂN SANG chăm sóc (chạm CSKH). Việc "đã có số → không xin số nữa,
// chỉ chăm" do isCaptured() + STOP_BOT_LABELS_SOFT điều khiển bên dưới, KHÔNG phải tắt bot.
const STOP_BOT_LABELS = (process.env.STOP_BOT_LABELS ||
  'đã đặt lịch,đã hẹn khám,đã hẹn,telesale xử lý,chốt lịch,đã chốt,không gửi bot,bot dừng'
).split(',').map((s) => normalizeLabel(s)).filter(Boolean);

// --- NHÃN "ĐÃ THÀNH KHÁCH" (đã mua/đã đến khám/đã thu tiền) ---
// Khác STOP ở trên: gặp các nhãn này, bot KHÔNG im hẳn mà coi như khách ĐÃ CÓ SỐ →
// chuyển chế độ CHĂM SÓC (chạm CSKH, KHÔNG chào mới, KHÔNG xin số). Đây là sửa ca anh Cầu
// (đã check-in + bắn bill POS mà bot đi chào "cô" + xin số như lead lạ).
const CUSTOMER_LABELS = (process.env.CUSTOMER_LABELS ||
  'đã đến khám,đã thu tiền,đã thanh toán,checkin,check-in,đã cọc,đã đặt cọc,đã mua,khách cũ,đang điều trị,chờ hàng'
).split(',').map((s) => normalizeLabel(s)).filter(Boolean);

function normalizeLabel(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036F]/g, "") // bỏ dấu tiếng Việt
    .replace(/đ/gi, 'd')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Cache nhẹ tên nhãn (15s) để 1 loạt tin dồn không gọi API nhiều lần. 1 lần gọi dùng cho cả
// hasStopLabel + hasCustomerLabel (đều cần đọc nhãn của cùng conv).
const labelCache = new Map(); // conversationId -> { names: string[], at }

// Đọc DANH SÁCH TÊN NHÃN của 1 hội thoại (có cache 15s). Lỗi → trả [] (fail-open).
// ⚠️ Pancake KHÔNG cho đọc nhãn 1 hội thoại lẻ; nhãn chỉ có ở endpoint LIST conversations
// (field tags[].text) → fetchConversationFromList tìm đúng id trong list.
async function getLabelNames(pageId, conversationId) {
  const token = getPageToken(pageId);
  if (!token) return [];
  const cached = labelCache.get(String(conversationId));
  if (cached && Date.now() - cached.at < 15000) return cached.names;
  let names = [];
  try {
    const conv = await fetchConversationFromList(pageId, token, conversationId);
    if (conv) names = extractLabelNames(conv);
  } catch (err) {
    const status = err?.response?.status;
    console.warn(`[pancake] đọc nhãn lỗi (conv ${conversationId}) status=${status || err?.message} → coi như KHÔNG có nhãn`);
    names = [];
  }
  labelCache.set(String(conversationId), { names, at: Date.now() });
  return names;
}

// Tên nhãn có khớp 1 trong danh sách từ khóa (đã normalize) không.
function matchAnyLabel(names, keywords) {
  return names.some((n) => {
    const nn = normalizeLabel(n);
    return keywords.some((k) => nn === k || nn.includes(k));
  });
}

/**
 * Hội thoại có nhãn "cờ tắt bot" không? → true thì bot IM (telesale chốt lịch/cần người/bot dừng).
 * Lỗi mạng → false (fail-open, bot vẫn chạy được).
 */
export async function hasStopLabel(pageId, conversationId) {
  if (STOP_BOT_LABELS.length === 0) return false;
  const names = await getLabelNames(pageId, conversationId);
  const stop = matchAnyLabel(names, STOP_BOT_LABELS);
  if (stop) console.log(`[pancake] 🚫 conv ${conversationId} có nhãn cờ-tắt-bot (${names.join(', ')}) → bot IM`);
  return stop;
}

/**
 * Hội thoại có nhãn "ĐÃ THÀNH KHÁCH" (đã mua/đã đến khám/đã thu tiền/đã cọc) không?
 * → true thì bot coi như khách ĐÃ CÓ SỐ: KHÔNG chào mới, KHÔNG xin số, chỉ CHĂM SÓC.
 * (Sửa ca anh Cầu: đã check-in + bắn bill POS mà bot vẫn đi chào + xin số như lead lạ.)
 */
export async function hasCustomerLabel(pageId, conversationId) {
  if (CUSTOMER_LABELS.length === 0) return false;
  const names = await getLabelNames(pageId, conversationId);
  const isCus = matchAnyLabel(names, CUSTOMER_LABELS);
  if (isCus) console.log(`[pancake] 🧡 conv ${conversationId} có nhãn ĐÃ-THÀNH-KHÁCH (${names.join(', ')}) → bot chăm sóc, KHÔNG xin số`);
  return isCus;
}

// Số ngày nhìn lại khi quét list conversations để tìm nhãn (mặc định 14 ngày — đủ phủ lead đang chăm).
const LABEL_LOOKBACK_DAYS = parseInt(process.env.LABEL_LOOKBACK_DAYS || '14', 10);
// Quét tối đa bao nhiêu trang list (mỗi trang ~200 hội thoại) để tìm đúng id, tránh quét vô hạn.
const LABEL_MAX_PAGES = parseInt(process.env.LABEL_MAX_PAGES || '3', 10);

/**
 * Tìm 1 hội thoại theo id trong endpoint LIST (nơi DUY NHẤT trả nhãn `tags`).
 * Trả về object hội thoại (có .tags) hoặc null nếu không thấy trong phạm vi quét.
 */
async function fetchConversationFromList(pageId, token, conversationId) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - LABEL_LOOKBACK_DAYS * 24 * 3600;
  for (let page = 1; page <= LABEL_MAX_PAGES; page++) {
    const res = await axios.get(`${API_BASE}/pages/${pageId}/conversations`, {
      params: { page_access_token: token, since, until, page_number: page },
      timeout: 15000,
    });
    const list = res?.data?.conversations || res?.data?.data || [];
    if (!Array.isArray(list) || list.length === 0) break;
    const hit = list.find((c) => String(c.id || c.conversation_id) === String(conversationId));
    if (hit) return hit;
    if (list.length < 200) break; // trang cuối, khỏi quét tiếp
  }
  return null; // không thấy trong phạm vi → coi như không có nhãn chặn (fail-open)
}

// Pancake trả nhãn ở field `tags` (mảng object có .text). Gom hết tên nhãn về 1 mảng string.
// Vẫn đọc thêm vài khóa biến thể để chống đổi schema.
function extractLabelNames(conv) {
  if (!conv || typeof conv !== 'object') return [];
  const pools = [
    conv.tags, conv.labels, conv.label_names,
    conv.page_customer?.tags, conv.customer?.tags,
  ];
  const out = [];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const item of pool) {
      if (typeof item === 'string') out.push(item);
      else if (item && typeof item === 'object') out.push(item.text || item.name || item.title || '');
    }
  }
  return out.filter(Boolean);
}

/**
 * Gửi 1 tin tới 1 hội thoại Pancake.
 * Endpoint mặc định: POST {API_BASE}/pages/{pageId}/conversations/{conversationId}/messages
 * Tham số có thể cần điều chỉnh theo docs (xem cảnh báo đầu file).
 */
async function sendOne(pageId, conversationId, text) {
  // KÊNH ZALO: ưu tiên gửi qua Zalo OpenAPI (token tự refresh) thay vì page token Pancake
  // (page token Pancake Zalo bị xoay vòng → error 105 "access_token renewed"). Cần OpenAPI bật + tách được user_id.
  if (getPageChannel(pageId) === 'zalo' && isOpenApiEnabled()) {
    const uid = zaloUserIdFromConv(conversationId);
    if (uid) {
      const ok = await zaloSendText(uid, text);
      if (ok) return true;
      console.warn(`[pancake→zalo] gửi OpenAPI hụt (uid ${uid}) → thử lại qua Pancake`);
    }
  }
  const token = getPageToken(pageId);
  if (!token) {
    console.warn(`[pancake] không có token cho page ${pageId} → bỏ gửi`);
    return false;
  }
  pageId = canonicalPageId(pageId); // gửi bằng page_id chuẩn (vd zl_3136...) để khớp token/endpoint
  const url = `${API_BASE}/pages/${pageId}/conversations/${conversationId}/messages`;
  try {
    const res = await axios.post(
      url,
      { message: text, action: 'reply_inbox' },
      { params: { page_access_token: token }, timeout: 15000 }
    );
    // Pancake trả HTTP 200 KÈM cờ success=false khi gửi hụt → phải kiểm tra body.
    const data = res?.data;
    if (data && data.success === false) {
      console.error(`[pancake] gửi HỤT (page ${pageId}, conv ${conversationId}):`,
        JSON.stringify(data).slice(0, 300),
        '\n   → kiểm tra endpoint/tham số Pancake Public API (xem cảnh báo đầu file pancake.js).');
      return false;
    }
    return true;
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    console.error(`[pancake] gửi lỗi (page ${pageId}, conv ${conversationId}) status=${status}`,
      typeof data === 'object' ? JSON.stringify(data).slice(0, 300) : String(data || err.message));
    return false;
  }
}

/**
 * Gửi nhiều ô thoại lần lượt, có delay giữa các ô (giống người gõ).
 * @param {string} pageId
 * @param {string} conversationId
 * @param {string[]} messages - mảng các ô (đã giới hạn 4 ô ở gemini.js)
 */
export async function sendMessages(pageId, conversationId, messages) {
  for (let i = 0; i < messages.length; i++) {
    // Chờ "đọc + nghĩ + gõ" TRƯỚC khi gửi ô này (tin đầu = 0, gửi ngay).
    await sleep(humanDelay(messages[i], i));
    const ok = await sendOne(pageId, conversationId, messages[i]);
    if (!ok) break; // gửi lỗi thì dừng, tránh spam nửa vời
  }
}

// Bỏ thẻ HTML cơ bản (tin Pancake bọc <div>).
function stripHtmlBasic(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

/**
 * REP CÔNG KHAI dưới 1 comment (để lại 1 câu mời ngắn).
 * Pancake Public API: POST {API_BASE}/pages/{pageId}/conversations/{conversationId}/messages
 * với action 'reply_comment' (trả lời ngay dưới comment đó).
 * ⚠️ Một số kênh/biến thể dùng đường dẫn /comments riêng — nếu lỗi, đối chiếu docs &
 * chỉnh tại đây (log dưới sẽ in nguyên body lỗi để biết phải sửa gì).
 */
export async function replyComment(pageId, conversationId, commentId, text) {
  const token = getPageToken(pageId);
  if (!token) {
    console.warn(`[pancake] không có token cho page ${pageId} → bỏ rep comment`);
    return false;
  }
  const url = `${API_BASE}/pages/${pageId}/conversations/${conversationId}/messages`;
  try {
    const res = await axios.post(
      url,
      { message: text, action: 'reply_comment', comment_id: commentId },
      { params: { page_access_token: token }, timeout: 15000 }
    );
    const data = res?.data;
    if (data && data.success === false) {
      console.error(`[pancake] REP COMMENT hụt (page ${pageId}, conv ${conversationId}, comment ${commentId}):`,
        JSON.stringify(data).slice(0, 400),
        '\n   → đối chiếu action/đường dẫn reply comment Pancake (xem cảnh báo đầu file).');
      return false;
    }
    return true;
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    console.error(`[pancake] rep comment lỗi (page ${pageId}, comment ${commentId}) status=${status}`,
      typeof data === 'object' ? JSON.stringify(data).slice(0, 400) : String(data || err.message));
    return false;
  }
}

/**
 * NHẮN RIÊNG (private reply) cho người vừa comment → kéo họ vào inbox.
 * Facebook/Pancake: private reply phải tham chiếu comment_id (chỉ được gửi 1 lần/comment,
 * trong vòng 7 ngày kể từ comment). Dùng action 'private_reply'.
 * Trả về true nếu Pancake nhận; false (kèm log) nếu hụt — để handler vẫn báo Telegram đỡ.
 */
export async function sendPrivateReply(pageId, conversationId, commentId, messages) {
  const token = getPageToken(pageId);
  if (!token) return false;
  const url = `${API_BASE}/pages/${pageId}/conversations/${conversationId}/messages`;
  let okAny = false;
  for (let i = 0; i < messages.length; i++) {
    await sleep(humanDelay(messages[i], i));
    try {
      const res = await axios.post(
        url,
        { message: messages[i], action: 'private_reply', comment_id: commentId },
        { params: { page_access_token: token }, timeout: 15000 }
      );
      const data = res?.data;
      if (data && data.success === false) {
        console.error(`[pancake] PRIVATE REPLY hụt (page ${pageId}, comment ${commentId}):`,
          JSON.stringify(data).slice(0, 400));
        break; // private reply lỗi ô đầu → dừng, đừng spam
      }
      okAny = true;
    } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      console.error(`[pancake] private reply lỗi (page ${pageId}, comment ${commentId}) status=${status}`,
        typeof data === 'object' ? JSON.stringify(data).slice(0, 400) : String(data || err.message));
      break;
    }
  }
  return okAny;
}

/**
 * Đọc TIN CUỐI CÙNG CỦA KHÁCH trong 1 hội thoại (để "poke" bot xử lại thủ công).
 * Dùng cho endpoint /admin/poke — ép bot trả lời ca đã bị bỏ lửng mà khách chưa nhắn mới.
 * Trả về { messageText, customerName } hoặc null nếu không đọc được / tin cuối là của page.
 */
export async function getLastCustomerMessage(pageId, conversationId) {
  const token = getPageToken(pageId);
  if (!token) return null;
  const url = `${API_BASE}/pages/${pageId}/conversations/${conversationId}/messages`;
  const res = await axios.get(url, { params: { page_access_token: token }, timeout: 20000, validateStatus: () => true });
  const msgs = res?.data?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return null;
  // messages xếp CŨ→MỚI; tìm tin gần nhất KHÔNG phải do page gửi.
  // So theo phần lõi (bỏ tiền tố zl_/ttm_...): Zalo lúc trả "zl_3136..." lúc "3136..." tùy endpoint —
  // so khít sẽ tưởng tin của chính OA là tin khách → bot tự trả lời chính mình.
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const from = m.from || {};
    const isPage = stripChannelPrefix(from.id) === stripChannelPrefix(pageId);
    if (isPage) continue;
    const text = stripHtmlBasic(m.message || m.original_message || '');
    if (!text) continue;
    return { messageText: text, customerName: from.name || null };
  }
  return null; // tin cuối là của page → khách chưa hỏi gì mới, không poke
}
