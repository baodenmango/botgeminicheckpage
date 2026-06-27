// Bot Gemini tư vấn Phòng khám Hiệp Lợi — service Node.js chạy 24/7.
// Webhook Pancake → Gemini → trả lời tách ô → retouch → báo Telegram.
import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';

import { config, checkConfig } from './src/config.js';
import { handleIncoming, handleRetouch, handlePageMessage } from './src/handler.js';
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
// Bỏ thẻ HTML + giải mã entity cơ bản (Pancake gửi message bọc <div>...</div>).
function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Trích thông tin tin nhắn từ payload webhook Pancake (messaging event).
 * Cấu trúc THẬT (đã xác minh qua log): { data: { conversation: {...}, message: {...} } }
 *  - data.message.conversation_id / data.conversation.id  → conversation_id
 *  - data.message.page_id                                  → page_id
 *  - data.message.message                                  → nội dung (bọc <div>)
 *  - data.message.from.id / .name                          → người gửi (khách hay page)
 * Trả về null nếu tin do PAGE/bot gửi (from.id === page_id) → tránh loop.
 */
function parsePancakeWebhook(body) {
  if (!body || typeof body !== 'object') return null;

  const data = (body.data && typeof body.data === 'object') ? body.data : body;
  const msg = (data.message && typeof data.message === 'object') ? data.message : data;
  const conv = (data.conversation && typeof data.conversation === 'object') ? data.conversation : {};

  const pageId =
    msg.page_id || data.page_id || body.page_id || null;
  const conversationId =
    msg.conversation_id || conv.id || data.conversation_id || null;

  const fromObj = msg.from || conv.from || {};
  const senderId = fromObj.id || null;
  const customerName = fromObj.name || conv.customer_name || null;

  // Nội dung: data.message.message (bọc HTML) — strip ra text sạch.
  const rawText =
    (typeof msg.message === 'string' ? msg.message : null) ||
    msg.text || conv.snippet || null;
  const messageText = stripHtml(rawText);

  if (!conversationId || !pageId || !messageText) return null;

  // Tin TỪ PAGE (người gửi = page_id): có thể là BOT tự gửi HOẶC telesale gõ tay.
  // Không bỏ qua nữa — trả về kèm cờ để handler phân biệt (phục vụ "người vào, bot lui").
  const fromPage = !!(senderId && pageId && String(senderId) === String(pageId));

  return {
    pageId: String(pageId),
    conversationId: String(conversationId),
    customerId: senderId ? String(senderId) : null,
    customerName,
    messageText,
    fromPage,
    aiGenerated: fromObj.ai_generated === true,
  };
}

// --- Webhook nhận tin từ Pancake ---
app.post('/webhook', (req, res) => {
  // Trả 200 NGAY để Pancake không retry; xử lý bất đồng bộ sau.
  res.status(200).json({ received: true });

  try {
    const ev = parsePancakeWebhook(req.body);
    if (!ev) {
      return; // payload không đủ → bỏ qua
    }
    if (!isPageEnabled(ev.pageId)) {
      console.log(`[webhook] page ${ev.pageId} chưa bật bot → bỏ qua`);
      return;
    }
    // Tin TỪ PAGE: nếu là telesale gõ tay → đánh dấu "người tiếp quản" (bot lui).
    // Nếu là bot tự gửi / tin hệ thống → bỏ qua.
    if (ev.fromPage) {
      handlePageMessage(ev); // không await
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
    const holdHours = parseFloat(process.env.HUMAN_HOLD_HOURS || '6');
    const targets = store.findRetouchTargets(config.retouch.minIdleHours, config.retouch.maxCount, holdHours);
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
