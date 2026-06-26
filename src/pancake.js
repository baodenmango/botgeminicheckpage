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

// Delay ngẫu nhiên 1.5–3s giữa các ô cho giống người thật.
function humanDelay() {
  return 1500 + Math.floor(Math.random() * 1500);
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
    const ok = await sendOne(pageId, conversationId, messages[i]);
    if (!ok) break; // gửi lỗi thì dừng, tránh spam nửa vời
    if (i < messages.length - 1) await sleep(humanDelay());
  }
}
