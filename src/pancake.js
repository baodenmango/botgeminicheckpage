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

const API_BASE = process.env.PANCAKE_API_BASE || 'https://pages.fm/api/public_api/v1';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Delay "giống người thật" TRƯỚC khi gửi ô thứ i (i bắt đầu từ 0).
// Tin đầu (i=0) gửi ngay. Từ tin 2 trở đi: mô phỏng người đang LẮNG NGHE + suy nghĩ
// + gõ phím — thời gian tỉ lệ với độ dài tin, cộng chút ngẫu nhiên cho tự nhiên.
function humanDelay(text, index) {
  if (index === 0) return 0; // tin đầu phản hồi nhanh
  const len = (text || '').length;
  // tốc độ gõ ~ 18 ký tự/giây + 1 nhịp "nghĩ" 1.2–2.2s
  const typing = Math.min(len * 55, 4500);          // gõ: tối đa ~4.5s cho tin dài
  const thinking = 1200 + Math.floor(Math.random() * 1000); // nghĩ: 1.2–2.2s
  // tin càng về sau nghĩ thêm chút (như đang cân nhắc nói tiếp)
  const lean = (index - 1) * 400;
  return Math.min(typing + thinking + lean, 7000);  // trần 7s/ô, tránh khách chờ quá lâu
}

// Lấy token của 1 trang theo page_id; null nếu trang không được cấu hình.
export function getPageToken(pageId) {
  return config.pancakePages[String(pageId)]?.token || null;
}

export function getPageChannel(pageId) {
  return config.pancakePages[String(pageId)]?.channel || 'facebook';
}

// Có biết trang này không (để bỏ qua webhook của trang chưa bật bot).
export function isPageEnabled(pageId) {
  return Boolean(config.pancakePages[String(pageId)]);
}

// --- CỜ TẮT BOT THEO NHÃN PANCAKE ---
// Telesale chốt lịch khám / đang xử tay → gắn 1 trong các nhãn này lên hội thoại.
// Bot đọc nhãn TRƯỚC khi gửi; thấy cờ thì IM, không chồng tin tư vấn.
// Tùy biến qua env STOP_BOT_LABELS (phân tách bằng dấu phẩy). So khớp KHÔNG dấu, không phân biệt hoa thường.
const STOP_BOT_LABELS = (process.env.STOP_BOT_LABELS ||
  'đã đặt lịch,đã hẹn khám,đã hẹn,đã đến khám,telesale xử lý,chốt lịch,đã chốt,không gửi bot,bot dừng'
).split(',').map((s) => normalizeLabel(s)).filter(Boolean);

function normalizeLabel(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036F]/g, "") // bỏ dấu tiếng Việt
    .replace(/đ/gi, 'd')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Cache nhẹ kết quả nhãn (15s) để 1 loạt tin dồn không gọi API nhiều lần.
const labelCache = new Map(); // conversationId -> { stop, at }

/**
 * Hội thoại này có nhãn "cờ tắt bot" không? → true thì bot phải IM.
 * Đọc qua Pancake Public API: GET .../conversations/{id} (trả tags/label_ids/labels tùy biến thể).
 * Lỗi mạng / không đọc được nhãn → trả false (KHÔNG chặn nhầm, ưu tiên bot vẫn chạy được;
 * cơ chế "người vào bot lui" vẫn là lớp bảo vệ thứ 2).
 */
export async function hasStopLabel(pageId, conversationId) {
  if (STOP_BOT_LABELS.length === 0) return false;
  const token = getPageToken(pageId);
  if (!token) return false;

  const cached = labelCache.get(String(conversationId));
  if (cached && Date.now() - cached.at < 15000) return cached.stop;

  let stop = false;
  try {
    // ⚠️ Pancake KHÔNG cho đọc nhãn 1 hội thoại lẻ (endpoint /conversations/{id} trả mảng tin nhắn,
    // endpoint /tags trả HTML). Nhãn CHỈ có ở endpoint LIST conversations, field `tags[].text`.
    // → Kéo các hội thoại có hoạt động gần đây rồi tìm đúng id. `since` hẹp để đỡ nặng.
    const conv = await fetchConversationFromList(pageId, token, conversationId);
    if (conv) {
      const names = extractLabelNames(conv);
      stop = names.some((n) => {
        const nn = normalizeLabel(n);
        return STOP_BOT_LABELS.some((stopLbl) => nn === stopLbl || nn.includes(stopLbl));
      });
      if (stop) {
        console.log(`[pancake] 🚫 conv ${conversationId} có nhãn cờ-tắt-bot (${names.join(', ')}) → bot IM`);
      }
    }
  } catch (err) {
    const status = err?.response?.status;
    console.warn(`[pancake] đọc nhãn lỗi (conv ${conversationId}) status=${status || err?.message} → coi như KHÔNG có cờ`);
    stop = false;
  }
  labelCache.set(String(conversationId), { stop, at: Date.now() });
  return stop;
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
  const token = getPageToken(pageId);
  if (!token) {
    console.warn(`[pancake] không có token cho page ${pageId} → bỏ gửi`);
    return false;
  }
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
