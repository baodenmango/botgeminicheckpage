// Telegram notifier: báo telesale khi có SĐT hoặc cần chuyển người.
import axios from 'axios';
import { config } from './config.js';
import { CONDITION_VI } from './conditions.js';
import * as store from './store.js';
import { canonicalPageId, getPageName } from './pancake.js';
import { adMeta } from './fb.js';

function pancakeLink(pageId, conversationId) {
  // Link mở hội thoại trong Pancake (giúp telesale bấm vào xem ngay).
  // ⚠️ Dạng cũ pages.fm/{page}/inbox/{conv} đã CHẾT (Pancake trả 404 — anh Trình báo 09/07).
  // Dạng web Pancake đang dùng: pancake.vn/{page_id}?c_id={conversation_id}.
  return `https://pancake.vn/${canonicalPageId(pageId)}?c_id=${conversationId}`;
}

// DÒNG NGUỒN cho telesale: khách đến từ trang/kênh nào + camp quảng cáo nào (nếu bắt được).
// Dấu nguồn ghi ở kv `nguon:<convId>` lúc webhook đến (index.js trích, handler.js lưu lần đầu).
// Link Pancake chỉ là phụ — dòng này phải đủ để telesale gọi mà KHÔNG cần mở link.
async function nguonLine(pageId, conversationId) {
  const parts = [getPageName(pageId)];
  try {
    const raw = store.getKV(`nguon:${conversationId}`);
    if (raw) {
      const n = JSON.parse(raw);
      if (n.adId) {
        const meta = await adMeta(n.adId); // tra tên camp/mẫu QC (cần FB_ADS_TOKEN, có cache)
        parts.push(meta?.campaignName
          ? `QC "${meta.campaignName}"${meta.adName ? ` · mẫu "${meta.adName}"` : ''}`
          : `QC Messenger (ad ${n.adId})`);
      }
      if (n.ref) parts.push(`ref ${n.ref}`);
      if (n.postId) parts.push(`comment bài facebook.com/${n.postId}`);
    }
  } catch (err) {
    console.warn('[telegram] dựng dòng nguồn lỗi:', err?.message);
  }
  if (parts.length === 1) parts.push('inbox trực tiếp (không thấy dấu QC)');
  return `📣 Nguồn: ${escapeHtml(parts.join(' — '))}`;
}

async function send(text, replyMarkup) {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    console.warn('[telegram] thiếu token/chat_id → bỏ qua thông báo');
    return;
  }
  try {
    const payload = {
      chat_id: config.telegram.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await axios.post(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      payload,
      { timeout: 15000 }
    );
  } catch (err) {
    console.error('[telegram] gửi lỗi:', err?.response?.data || err.message);
  }
}

// Nút để telesale xác nhận đã gọi lead. callback_data: bk:<sdt>:<action>
// (listener booking-listener.js xử lý — ghi ai gọi, lúc nào, sửa thẻ).
function nutDaGoi(phone) {
  const ph = String(phone || '').replace(/[^0-9]/g, '').slice(0, 15);
  if (!ph) return undefined;
  return { inline_keyboard: [[
    { text: '✅ Đã gọi', callback_data: `bk:${ph}:daGoi` },
    { text: '⏳ Gọi lại', callback_data: `bk:${ph}:goiLai` },
    { text: '❌ Ko nghe', callback_data: `bk:${ph}:khongNghe` },
  ]] };
}

// Báo có LEAD mới (đã cho SĐT).
// Nhãn kiểu khách (tâm lý) cho telesale biết cách tiếp cận.
const CUSTOMER_TYPE_VI = {
  dau_kho_lau_nam: 'Đau khổ lâu năm (cần đồng cảm + hy vọng)',
  lo_so: 'Lo sợ/hoang mang (cần trấn an)',
  tinh_toan: 'Tính toán/quan tâm giá (nhấn giá trị + ưu đãi)',
  phan_van: 'Phân vân (hạ rào cản, chốt nhẹ)',
  nguoi_nha: 'Người nhà hỏi giúp (khơi tình thương)',
  khach_da_kham: '🧡 KHÁCH ĐÃ KHÁM (SĐT trùng đơn POS/hồ sơ EMR — chăm sóc/tái khám, ĐỪNG chốt như lead mới)',
  chua_ro: '',
};

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Gửi 1 tin văn bản tự do (module khác dùng: cảnh báo quota Zalo, báo cáo tuần...).
export async function notifyText(text) {
  await send(text);
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
  text += `${await nguonLine(pageId, conversationId)}\n`;
  text += `💬 Hội thoại: ${pancakeLink(pageId, conversationId)}`;
  await send(text, nutDaGoi(phone));   // giữ NGUYÊN nội dung, chỉ thêm nút telesale bấm
}

// Báo ca MUỐN CHỐT LỊCH nhưng CHƯA để số → telesale vào chốt nóng (khách nóng, dễ mất).
// Chỉ báo 1 lần/ca (handler dùng flag booking_notified chống trùng).
export async function notifyBooking({ name, condition, summary, pageId, conversationId }) {
  const benh = CONDITION_VI[condition] || CONDITION_VI.unknown;
  let text =
    `📅 <b>KHÁCH MUỐN ĐẶT LỊCH (chưa có SĐT)</b>\n` +
    `👤 Tên: ${escapeHtml(name) || '(chưa rõ)'}\n` +
    `🩺 Bệnh: ${benh}\n` +
    `⚡️ Khách đang hỏi đặt lịch/hẹn khám — vào chốt nóng kẻo nguội!\n`;
  if (summary) text += `📋 Tóm tắt: ${escapeHtml(summary)}\n`;
  text += `${await nguonLine(pageId, conversationId)}\n`;
  text += `💬 Hội thoại: ${pancakeLink(pageId, conversationId)}`;
  await send(text);
}

// Báo CHẠM TELESALE (2/5/7) cho ca ĐÃ có SĐT → telesale gọi. Kèm nút "Đã chạm".
// callback_data c7:<convId>:done khớp listener nút bấm cloud (bot-nut-bam).
function nutChamLead(convId) {
  const cid = String(convId || '').slice(0, 50);
  return { inline_keyboard: [[
    { text: '✅ Đã chạm', callback_data: `c7:${cid}:done` },
    { text: '❌ Không nghe', callback_data: `c7:${cid}:khongNghe` },
  ]] };
}
// Map mốc chạm (ngôn ngữ ENGINE) → LỆNH cho telesale (ngôn ngữ NGƯỜI).
// Anh Trình chốt 11/07: "telesale nhìn 'Chạm 2/5/7' không hiểu phải làm gì". Số hiệu chỉ có nghĩa
// với bot; tin cho người phải nói VIỆC + độ gấp, giấu số hiệu máy đi.
const CALL_TOUCH_LENH = {
  2: { tieude: '📞 GỌI NGAY — khách vừa cho số', viec: 'Cuộc gọi vàng: gọi trong 5-15 phút đầu, khách đang nóng nhất.' },
  5: { tieude: '📞 GỌI LẠI — hôm qua chưa chốt', viec: 'Đã hơn 1 ngày chưa chốt được. Gọi lại nhắc lịch, đừng để nguội.' },
  7: { tieude: '📞 GỌI CHỐT CUỐI — ca sắp nguội', viec: 'Cơ hội cuối trước khi đóng ca. Gọi chốt hoặc xác nhận khách còn nhu cầu.' },
};
export async function notifyCallTouch({ touchNo, name, phone, condition, summary, muctieu, pageId, conversationId }) {
  const benh = CONDITION_VI[condition] || CONDITION_VI.unknown;
  const lenh = CALL_TOUCH_LENH[touchNo] || { tieude: '📞 GỌI KHÁCH', viec: muctieu || '' };
  let text =
    `${lenh.tieude}\n` +
    `👤 ${escapeHtml(name) || '(chưa rõ)'} · <b>${escapeHtml(phone) || '(?)'}</b>\n` +
    `🩺 Bệnh: ${benh}\n`;
  if (lenh.viec) text += `👉 ${escapeHtml(lenh.viec)}\n`;
  if (summary) text += `📋 ${escapeHtml(summary)}\n`;
  text += `${await nguonLine(pageId, conversationId)}\n`;
  text += `💬 ${pancakeLink(pageId, conversationId)}`;
  await send(text, nutChamLead(conversationId));
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
  text += `${await nguonLine(pageId, conversationId)}\n`;
  text += `💬 Hội thoại: ${pancakeLink(pageId, conversationId)}`;
  await send(text);
}

// Báo có COMMENT mới dưới bài → bot đã rep mời + nhắn riêng, telesale theo dõi inbox.
export async function notifyComment({ name, commentText, pageId, conversationId, privateOk }) {
  let text =
    `💬 <b>COMMENT MỚI dưới bài</b>\n` +
    `👤 ${escapeHtml(name) || '(chưa rõ)'}\n` +
    `📝 Nội dung: "${escapeHtml((commentText || '').slice(0, 150))}"\n` +
    `🤖 Bot đã rep mời công khai${privateOk ? ' + nhắn riêng kéo vào inbox' : ' (private reply CHƯA gửi được — xem inbox/log)'}\n`;
  if (conversationId) {
    text += `${await nguonLine(pageId, conversationId)}\n`;
    text += `➡️ ${pancakeLink(pageId, conversationId)}`;
  }
  await send(text);
}

// Báo DANH SÁCH BN ngủ CHƯA follow OA (engine đánh thức không gửi tự động được) → telesale gọi/add Zalo.
export async function notifyWakeupList(items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const top = items.slice(0, 30);
  let text = `🌙 <b>BN CŨ CẦN ĐÁNH THỨC</b> (${items.length} ca, chưa follow OA → telesale gọi/add Zalo)\n`;
  top.forEach((it, i) => {
    const benh = CONDITION_VI[it.condition] || CONDITION_VI.unknown;
    text += `\n${i + 1}. ${escapeHtml(it.name || '(chưa rõ)')} — <b>${escapeHtml(it.phone || '?')}</b> · ${benh}${it.daysSince ? ` · ${it.daysSince} ngày chưa lại` : ''}`;
  });
  if (items.length > top.length) text += `\n… và ${items.length - top.length} ca nữa.`;
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
  text += `${await nguonLine(pageId, conversationId)}\n`;
  text += `➡️ ${pancakeLink(pageId, conversationId)}`;
  await send(text);
}
