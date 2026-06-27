// Telegram notifier: báo telesale khi có SĐT hoặc cần chuyển người.
import axios from 'axios';
import { config } from './config.js';

// Map mã bệnh → tên tiếng Việt cho dễ đọc trong thông báo.
const CONDITION_VI = {
  goi: 'Khớp gối / thoái hóa gối',
  vai: 'Khớp vai / đau vai',
  gut: 'Gút / acid uric',
  lung: 'Đau lưng / cột sống',
  tvdd: 'Thoát vị đĩa đệm',
  covaigay: 'Đau cổ vai gáy',
  khac: 'Bệnh khác',
  unknown: 'Chưa rõ',
};

function pancakeLink(pageId, conversationId) {
  // Link mở hội thoại trong Pancake (giúp telesale bấm vào xem ngay).
  return `https://pages.fm/${pageId}/inbox/${conversationId}`;
}

async function send(text) {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    console.warn('[telegram] thiếu token/chat_id → bỏ qua thông báo');
    return;
  }
  try {
    await axios.post(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      {
        chat_id: config.telegram.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      { timeout: 15000 }
    );
  } catch (err) {
    console.error('[telegram] gửi lỗi:', err?.response?.data || err.message);
  }
}

// Báo có LEAD mới (đã cho SĐT).
// Nhãn kiểu khách (tâm lý) cho telesale biết cách tiếp cận.
const CUSTOMER_TYPE_VI = {
  dau_kho_lau_nam: 'Đau khổ lâu năm (cần đồng cảm + hy vọng)',
  lo_so: 'Lo sợ/hoang mang (cần trấn an)',
  tinh_toan: 'Tính toán/quan tâm giá (nhấn giá trị + ưu đãi)',
  phan_van: 'Phân vân (hạ rào cản, chốt nhẹ)',
  nguoi_nha: 'Người nhà hỏi giúp (khơi tình thương)',
  chua_ro: '',
};

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function notifyLead({ name, phone, condition, summary, customerType, pageId, conversationId }) {
  const benh = CONDITION_VI[condition] || CONDITION_VI.unknown;
  const kieu = CUSTOMER_TYPE_VI[customerType] || '';
  let text =
    `🔥 <b>LEAD MỚI có SĐT</b>\n` +
    `👤 Tên: ${escapeHtml(name) || '(chưa rõ)'}\n` +
    `📞 SĐT: <b>${escapeHtml(phone) || '(?)'}</b>\n` +
    `🩺 Bệnh: ${benh}\n`;
  if (kieu) text += `🧭 Kiểu khách: ${kieu}\n`;
  if (summary) text += `📋 Tóm tắt: ${escapeHtml(summary)}\n`;
  text += `💬 Hội thoại: ${pancakeLink(pageId, conversationId)}`;
  await send(text);
}

// Báo cần CHUYỂN NGƯỜI (khiếu nại / hỏi sâu chuyên môn).
export async function notifyHandover({ name, reason, condition, summary, pageId, conversationId }) {
  const benh = CONDITION_VI[condition] || CONDITION_VI.unknown;
  let text =
    `⚠️ <b>CẦN NGƯỜI XỬ LÝ</b>\n` +
    `👤 Tên: ${escapeHtml(name) || '(chưa rõ)'}\n` +
    `📝 Lý do: ${escapeHtml(reason) || 'khách cần gặp người'}\n` +
    `🩺 Bệnh: ${benh}\n`;
  if (summary) text += `📋 Tóm tắt: ${escapeHtml(summary)}\n`;
  text += `💬 Hội thoại: ${pancakeLink(pageId, conversationId)}`;
  await send(text);
}

// Từ khóa CẢNH BÁO Y TẾ KHẨN — bot không tự xử, báo người gọi gấp.
const URGENT_RE = /không đi tiểu|bí tiểu|tê liệt|liệt|không cử động|yếu (hai|2) chân|ngất|khó thở|đau dữ dội|đau quá|cấp cứu|tê cả|mất cảm giác|sốt cao|co giật/i;

export function isUrgent(text) {
  return URGENT_RE.test(text || '');
}

// Khách ĐÃ handover (người thật đang xử) NHƯNG vẫn nhắn tiếp → nhắc người thật,
// gắn cờ KHẨN nếu có dấu hiệu y tế nguy hiểm. KHÔNG để bot im rồi bỏ quên khách.
export async function notifyHandoverNudge({ name, messageText, urgent, pageId, conversationId }) {
  const head = urgent ? '🚨 <b>KHẨN — KHÁCH ĐANG NHẮN TIẾP</b> 🚨' : '🔔 <b>Khách (đã giao người) nhắn tiếp</b>';
  let text =
    `${head}\n` +
    `👤 ${escapeHtml(name) || '(chưa rõ)'}\n` +
    `💬 Khách vừa nhắn: "${escapeHtml((messageText || '').slice(0, 120))}"\n`;
  if (urgent) text += `❗️ Có dấu hiệu y tế cần xử lý GẤP — gọi khách ngay, khuyên tới cơ sở y tế nếu nặng.\n`;
  text += `➡️ ${pancakeLink(pageId, conversationId)}`;
  await send(text);
}
