// Bot Gemini tư vấn Phòng khám Hiệp Lợi — service Node.js chạy 24/7.
// Webhook Pancake → Gemini → trả lời tách ô → retouch → báo Telegram.
import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';

import { config, checkConfig } from './src/config.js';
import { handleIncoming, handleRetouch } from './src/handler.js';
import { isPageEnabled } from './src/pancake.js';
import * as store from './src/store.js';

checkConfig();

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- Health check (Render kiểm tra sống) ---
app.get('/health', (_req, res) => res.status(200).json({ ok: true, ts: Date.now() }));
app.get('/', (_req, res) => res.status(200).send('Bot Gemini Hiệp Lợi đang chạy ✅'));

/**
 * Trích thông tin tin nhắn từ payload webhook Pancake.
 * Payload Pancake có nhiều biến thể → cố gắng đọc linh hoạt nhiều khóa.
 * Trả về null nếu không phải tin của KHÁCH (vd page/bot tự gửi) → bỏ qua tránh loop.
 */
function parsePancakeWebhook(body) {
  if (!body || typeof body !== 'object') return null;

  // Một số webhook bọc trong { event, data } hoặc gửi thẳng object hội thoại.
  // CHỈ lấy nhánh lồng khi nó là object (tránh nhầm 'message' dạng chuỗi nội dung).
  const isObj = (x) => x && typeof x === 'object';
  const d = isObj(body.data) ? body.data
    : isObj(body.conversation) ? body.conversation
    : isObj(body.message) ? body.message
    : body;

  const pageId =
    d.page_id || d.pageId || body.page_id || d.page?.id || null;
  const conversationId =
    d.conversation_id || d.conversationId || d.thread_id || d.id || null;
  const customerId =
    d.customer_id || d.from?.id || d.sender?.id || d.customer?.id || null;
  const customerName =
    d.customer_name || d.from?.name || d.sender?.name || d.customer?.name || null;

  // Nội dung tin: thử nhiều khóa thường gặp.
  const messageText =
    d.message || d.text || d.content || d.snippet ||
    (Array.isArray(d.messages) ? d.messages[d.messages.length - 1]?.message : null) ||
    null;

  // Loại tin do CHÍNH PAGE/BOT gửi (tránh vòng lặp tự trả lời).
  // Pancake thường đánh dấu: is_from_page / from_page / type 'page' hoặc sender == page_id.
  const fromPage =
    d.is_from_page === true || d.from_page === true ||
    d.sender_type === 'page' || d.type === 'page_message' ||
    (customerId && pageId && String(customerId) === String(pageId));
  if (fromPage) return null;

  if (!conversationId || !pageId || !messageText) return null;
  return {
    pageId: String(pageId),
    conversationId: String(conversationId),
    customerId: customerId ? String(customerId) : null,
    customerName,
    messageText: String(messageText),
  };
}

// --- Webhook nhận tin từ Pancake ---
app.post('/webhook', (req, res) => {
  // Trả 200 NGAY để Pancake không retry; xử lý bất đồng bộ sau.
  res.status(200).json({ received: true });

  try {
    // LOG RAW: in toàn bộ payload thật của Pancake để soi cấu trúc (gọn 1200 ký tự).
    console.log('[webhook RAW]', JSON.stringify(req.body).slice(0, 1200));

    const ev = parsePancakeWebhook(req.body);
    if (!ev) {
      console.log('[webhook] BỎ QUA (parser trả null — tin page/bot hoặc thiếu field). Xem [webhook RAW] ở trên.');
      return; // tin của page/bot hoặc payload không đủ → bỏ qua
    }
    if (!isPageEnabled(ev.pageId)) {
      console.log(`[webhook] page ${ev.pageId} chưa bật bot → bỏ qua`);
      return;
    }
    console.log(`[webhook] tin từ ${ev.customerName || ev.customerId} (conv ${ev.conversationId}): ${ev.messageText.slice(0, 80)}`);
    handleIncoming(ev); // không await — chạy nền
  } catch (err) {
    console.error('[webhook] lỗi parse:', err?.message || err);
  }
});

// --- Cron retouch mỗi 15 phút ---
cron.schedule('*/15 * * * *', async () => {
  try {
    const targets = store.findRetouchTargets(config.retouch.minIdleHours, config.retouch.maxCount);
    if (targets.length === 0) return;
    console.log(`[cron] ${targets.length} hội thoại cần chạm lại`);
    for (const conv of targets) {
      // chỉ chạm lại trang đang bật bot
      if (!isPageEnabled(conv.page_id)) continue;
      await handleRetouch(conv);
    }
  } catch (err) {
    console.error('[cron] lỗi retouch:', err?.message || err);
  }
});

// --- Khởi động ---
app.listen(config.port, () => {
  console.log(`🚀 Bot Gemini Hiệp Lợi chạy ở cổng ${config.port}`);
  console.log(`   Webhook: POST /webhook | Health: GET /health`);
});
