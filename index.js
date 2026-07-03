// Bot Gemini tư vấn Phòng khám Hiệp Lợi — service Node.js chạy 24/7.
// Webhook Pancake → Gemini → trả lời tách ô → retouch → báo Telegram.
import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';

import { config, checkConfig } from './src/config.js';
import { handleIncoming, handleRetouch, handlePageMessage } from './src/handler.js';
import { isPageEnabled, getLastCustomerMessage } from './src/pancake.js';
import { isCommentEvent } from './src/comment.js'; // chỉ để NHẬN DIỆN comment và bỏ qua (Meta lo rep comment)
import * as store from './src/store.js';
import { ingestBill, runBillTouches } from './src/billengine.js';
import { runGroupTouches } from './src/rebillengine.js';
import { handleZaloFollow } from './src/follow.js';
import { lookupMedi, mapDiagnosis } from './src/medi.js';
import { runWakeup } from './src/wakeup.js';
import { runSevenTouch } from './src/sevenTouch.js';
import { runRescueLead } from './src/rescueLead.js';

checkConfig();

const app = express();
app.use(express.json({ limit: '2mb' }));

// --- Health check (Render kiểm tra sống) ---
// Kèm commit SHA + thời điểm process khởi động → verify deploy chỉ bằng 1 lệnh curl
// (Render cấp sẵn RENDER_GIT_COMMIT cho mọi service; bootedAt cho biết lần restart gần nhất).
const BOOTED_AT = new Date().toISOString();
const GIT_COMMIT = (process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7);
app.get('/health', (_req, res) =>
  res.status(200).json({ ok: true, ts: Date.now(), commit: GIT_COMMIT, bootedAt: BOOTED_AT }));
app.get('/', (_req, res) => {
  // meta tag xác thực domain Zalo (env ZALO_SITE_VERIFICATION) — không có thì trang chủ như cũ
  const zaloMeta = process.env.ZALO_SITE_VERIFICATION
    ? `<meta name="zalo-platform-site-verification" content="${process.env.ZALO_SITE_VERIFICATION}" />`
    : '';
  res.status(200).type('html').send(
    `<!doctype html><html><head><meta charset="utf-8">${zaloMeta}<title>Bot Gemini Hiệp Lợi</title></head>` +
    `<body>Bot Gemini Hiệp Lợi đang chạy ✅</body></html>`
  );
});

// --- Admin: gỡ cờ "người giữ" bị kẹt (do bug nhận nhầm echo là telesale) ---
// GET /admin/reset-human?token=XXX            → gỡ cờ TẤT CẢ hội thoại
// GET /admin/reset-human?token=XXX&conv=<id>  → gỡ cờ 1 hội thoại
// Token lấy từ env ADMIN_TOKEN (đặt trên Render). Không có token → 403.
app.get('/admin/reset-human', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const conv = req.query.conv;
  const changed = conv ? store.clearHumanTaken(String(conv)) : store.clearAllHumanTaken();
  // thêm &handover=1 để gỡ luôn trạng thái handover (đưa conv về active) — dùng khi bot handover OAN
  let handoverCleared = 0;
  if (conv && (req.query.handover === '1' || req.query.handover === 'true')) {
    handoverCleared = store.clearHandover(String(conv));
  }
  console.log(`[admin] gỡ cờ human-taken ${conv ? `conv ${conv}` : 'TẤT CẢ'} → ${changed} dòng${handoverCleared ? ` + gỡ handover ${handoverCleared}` : ''}`);
  res.status(200).json({ ok: true, scope: conv || 'all', cleared: changed, handoverCleared });
});

// --- Admin: ÉP bot trả lời lại 1 hội thoại bị bỏ lửng (khách chưa nhắn mới) ---
// GET /admin/poke?token=XXX&page=<pageId>&conv=<conversationId>
// Đọc tin cuối của KHÁCH trong conv đó rồi đẩy vào handleIncoming như webhook thật.
// Cũng gỡ cờ human-taken trước, để bot không bị chính cờ cũ chặn.
app.get('/admin/poke', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const pageId = String(req.query.page || '');
  const conv = String(req.query.conv || '');
  if (!pageId || !conv) return res.status(400).json({ ok: false, error: 'thiếu page hoặc conv' });
  if (!isPageEnabled(pageId)) return res.status(400).json({ ok: false, error: 'page chưa bật bot' });

  try {
    store.clearHumanTaken(conv); // gỡ cờ kẹt trước khi xử
    const last = await getLastCustomerMessage(pageId, conv);
    if (!last) {
      return res.status(200).json({ ok: false, error: 'không thấy tin cuối của khách (tin cuối là của page hoặc rỗng)' });
    }
    console.log(`[admin] 🤖 poke conv ${conv}: ép bot trả lời tin khách "${last.messageText.slice(0, 50)}"`);
    // gọi như webhook tin khách mới (không await để trả response nhanh)
    handleIncoming({ conversationId: conv, pageId, customerName: last.customerName, messageText: last.messageText });
    res.status(200).json({ ok: true, conv, poked: last.messageText.slice(0, 80), name: last.customerName });
  } catch (err) {
    console.error('[admin] poke lỗi:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: NẠP 1 ca ra bill vào hàng đợi chăm sóc Zalo (bước 5) ---
// POST /admin/bill-ingest?token=XXX  body JSON: { phone, name, zalo_user_id, page_id,
//   conversation_id, condition, has_medicine, has_injection, bill_date, treatment }
// Dùng cho nhân viên/automation đẩy ca ra bill (có thuốc/tiêm) từ POS vào engine.
// POS không có chẩn đoán → nếu payload thiếu condition, tự tra hồ sơ MEDi theo SĐT
// (cache /admin/medi-upsert) để điền bệnh + liệu trình + cờ tiêm, tin gửi khách mới đúng ca.
app.post('/admin/bill-ingest', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  try {
    const body = { ...(req.body || {}) };
    if ((!body.condition || body.condition === 'unknown') && body.phone) {
      const medi = await lookupMedi(body.phone);
      if (medi) {
        const c = mapDiagnosis(medi.diagnosis);
        if (c !== 'unknown') body.condition = c;
        if (!body.treatment && medi.treatment) body.treatment = medi.treatment;
        if (body.has_injection === undefined && /prp_khop|sinh_hoc/.test(medi.treatment || '')) {
          body.has_injection = true;
        }
        if (!body.name && medi.name) body.name = medi.name;
      }
    }
    const saved = ingestBill(body);
    if (!saved) return res.status(400).json({ ok: false, error: 'payload thiếu phone/id' });
    res.status(200).json({ ok: true, id: saved.id, condition: saved.condition, treatment: saved.treatment || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: NHẬN hồ sơ BN MEDi đẩy từ cron LOCAL (việc 2) ---
// POST /admin/medi-upsert?token=XXX  body JSON: { records: [ {phone,name,diagnosis,last_visit,treatment,visits,raw}... ] }
// Credentials EMR ở LOCAL; cron local gom BN qua medi-source.js rồi đẩy lên đây (PII không lên cloud dưới dạng login).
app.post('/admin/medi-upsert', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  try {
    const recs = Array.isArray(req.body?.records) ? req.body.records : [];
    let n = 0;
    for (const r of recs) { if (store.upsertMedi(r)) n++; }
    console.log(`[medi-upsert] nhận ${recs.length} hồ sơ BN, lưu ${n} (tổng cache ${store.mediCacheCount()})`);
    res.status(200).json({ ok: true, received: recs.length, saved: n, total: store.mediCacheCount() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Webhook FOLLOW Zalo OA (bước 7): khách bấm Quan tâm → tự giao PDF + video ---
// Zalo gửi event 'follow' về URL này (cấu hình trong Zalo Developer Console).
// Nút "Kiểm tra" của Console gửi GET → phải trả 200, không thì báo "đường dẫn không hợp lệ".
app.get('/zalo/webhook', (_req, res) => res.status(200).json({ ok: true }));
app.post('/zalo/webhook', (req, res) => {
  res.status(200).json({ received: true }); // trả 200 ngay
  const mac = req.get('X-ZEvent-Signature') || req.get('x-zevent-signature') || null;
  try { handleZaloFollow(req.body, mac); } catch (err) { console.error('[zalo-webhook] lỗi:', err?.message || err); }
});

// --- Xác thực domain với Zalo (nếu Console đòi) ---
// Cách 1 (file): Zalo phát file zalo_verifierXXX.html → dán NỘI DUNG file vào env
//   ZALO_VERIFIER_CONTENT là route này phục vụ đúng file đó.
// Cách 2 (meta tag): dán mã vào env ZALO_SITE_VERIFICATION → nhúng vào trang chủ bên dưới.
app.get(/^\/zalo[\w.-]*\.html$/i, (_req, res) => {
  const content = process.env.ZALO_VERIFIER_CONTENT;
  if (!content) return res.status(404).send('chưa cấu hình ZALO_VERIFIER_CONTENT');
  res.status(200).type('html').send(content);
});

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
// Quét ĐỆ QUY mọi field trong payload (card liên hệ/attachment) tìm SĐT VN hợp lệ (đúng 10 số, đầu 03/05/07/08/09).
// Dùng cho card liên hệ Zalo chứa số. Trả về số chuẩn hoá hoặc null.
function findPhoneInPayload(obj, depth = 0) {
  if (obj == null || depth > 6) return null;
  if (typeof obj === 'string' || typeof obj === 'number') {
    const digits = String(obj).replace(/[^\d]/g, '');
    // thử các cụm 10-11 số trong chuỗi
    const m = String(obj).match(/(?:\+?84|0)[\d .\-()]{8,13}\d/g) || [];
    for (const cand of [...m, digits]) {
      let s = String(cand).replace(/[^\d]/g, '');
      if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
      if (/^0(3|5|7|8|9)\d{8}$/.test(s)) return s;
    }
    return null;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) { const r = findPhoneInPayload(x, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) { const r = findPhoneInPayload(obj[k], depth + 1); if (r) return r; }
  }
  return null;
}

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
  let messageText = stripHtml(rawText);

  // Khách KHÔNG gõ chữ mà gửi ẢNH/STICKER/FILE/VOICE/CARD LIÊN HỆ.
  // ⚠️ KÊNH ZALO: khách hay gửi "danh thiếp/card liên hệ" chứa SĐT thay vì gõ — phải BẮT số đó,
  // nếu không bot xin số lại hoài (lỗi đã thấy: card "097 845 1211" bot không nhận). Quét SĐT trong
  // toàn bộ payload attachment; thấy số VN hợp lệ → đưa thành text để extractPhone chốt lead.
  let attachmentOnly = false; // tin CHỈ có ảnh/tệp, không chữ (để handlePageMessage khỏi nhầm là telesale)
  if (!messageText) {
    const att = msg.attachments || msg.attachment || conv.attachments || data.attachments;
    const hasAttachment = Array.isArray(att) ? att.length > 0 : Boolean(att);
    if (hasAttachment) {
      const phoneInAtt = findPhoneInPayload(att);
      messageText = phoneInAtt
        ? `Số điện thoại của tôi là ${phoneInAtt}`   // card liên hệ → đưa số vào để bot chốt
        : '[khách vừa gửi một hình ảnh/tệp]';
      attachmentOnly = !phoneInAtt;
    }
  }
  // CARD liên hệ đôi khi VẪN có messageText (tên) + số nằm trong attachment → vẫn cố vớt số.
  else {
    const att = msg.attachments || msg.attachment || conv.attachments || data.attachments;
    if (att && !/\d{9,}/.test(messageText)) {
      const phoneInAtt = findPhoneInPayload(att);
      if (phoneInAtt) messageText = `${messageText} (số: ${phoneInAtt})`;
    }
  }

  if (!conversationId || !pageId || !messageText) return null;

  // Tin TỪ PAGE (người gửi = page_id): có thể là BOT tự gửi HOẶC telesale gõ tay.
  // Không bỏ qua nữa — trả về kèm cờ để handler phân biệt (phục vụ "người vào, bot lui").
  const fromPage = !!(senderId && pageId && String(senderId) === String(pageId));

  // DEBUG tạm (kênh Zalo): in from.id vs page_id để biết Pancake gắn vai khách Zalo thế nào.
  // (admin OA nhắn → Pancake có thể set from=page → fromPage=true → bot bỏ luồng tư vấn). Gỡ sau khi rõ.
  if (String(pageId).startsWith('zl_') || String(conversationId).startsWith('zl_')) {
    console.log(`[zalo-debug] from.id=${senderId} | page_id=${pageId} | fromPage=${fromPage} | name=${customerName} | text="${String(messageText).slice(0,30)}"`);
  }

  return {
    pageId: String(pageId),
    conversationId: String(conversationId),
    customerId: senderId ? String(senderId) : null,
    customerName,
    messageText,
    fromPage,
    attachmentOnly,
    aiGenerated: fromObj.ai_generated === true,
  };
}

// --- Webhook nhận tin từ Pancake ---
app.post('/webhook', (req, res) => {
  // Trả 200 NGAY để Pancake không retry; xử lý bất đồng bộ sau.
  res.status(200).json({ received: true });

  try {
    // COMMENT dưới bài → BỎ QUA HẲN. Việc rep comment + kéo vào inbox đã do
    // META BUSINESS SUITE (Automation "Bình luận để nhắn tin") lo. Bot Gemini KHÔNG đụng
    // comment nữa để tránh TRÙNG + tránh lỗi sai tham số Pancake (action private_replies /
    // thiếu message_id — đã thấy hụt trong log 29/06). comment.js giữ lại làm dự phòng,
    // chỉ KHÔNG gọi. Vẫn phải nhận diện để comment không rơi xuống parse như tin inbox.
    if (isCommentEvent(req.body)) {
      return; // Meta lo comment; bot chỉ xử inbox
    }

    const ev = parsePancakeWebhook(req.body);
    if (!ev) {
      // DEBUG tạm (gỡ sau khi đấu xong Zalo): log gọn payload không parse được để bắt format Zalo.
      try {
        const b = req.body?.data || req.body || {};
        const pid = b.message?.page_id || b.page_id || b.conversation?.page_id;
        if (pid) console.log(`[webhook][raw] không parse được — page_id=${pid} keys=${Object.keys(b).join(',')}`);
      } catch {}
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

// --- Cron ENGINE 7 CHẠM (gom từ nhac-7cham local) mỗi 15 phút, lệch 5' với retouch ---
// QUÉT Pancake các page → tính mốc chạm theo inserted_at (48h) → rẽ nhánh:
//   • Chạm 3/4/6 (giá trị): bot tự gửi.  • Chạm 2/5/7: có SĐT → báo telesale gọi; chưa SĐT → bot tự nhắn xin số.
// Báo Telegram LỌC KỸ (chỉ ca có số / muốn đặt lịch chưa số / đặc biệt). Chống trùng qua touch_done.
cron.schedule('5,20,35,50 * * * *', async () => {
  try {
    await runSevenTouch();
  } catch (err) {
    console.error('[cron-cham] lỗi engine 7 chạm:', err?.message || err);
  }
});

// --- Cron VỚT LEAD BỎ RƠI mỗi 5 phút — vá lỗ webhook rớt (bot chết tạm lúc deploy / Pancake không gửi lại) ---
// Quét Pancake: ca KHÁCH nhắn cuối + chưa rep + quá 3 phút → đẩy vào handleIncoming như webhook thật.
// Chạy DÀY (5') để cứu lead sớm, đặc biệt lead ĐÃ CHO SỐ mà tin rớt lúc deploy.
cron.schedule('*/5 * * * *', async () => {
  try {
    await runRescueLead();
  } catch (err) {
    console.error('[cron-rescue] lỗi engine vớt lead:', err?.message || err);
  }
});

// --- Cron CHUỖI CHẠM CA RA BILL (bước 5) + TÁI BILL theo nhóm (bước 6) ---
// Chạy mỗi giờ (phút 10). Engine tự lọc theo mốc + chống trùng → an toàn khi chạy lặp.
// Giờ VN = UTC+7; tin chăm vẫn rơi giờ hợp lý vì engine lọc theo NGÀY, không gửi đêm khuya quá vì
// cron chạy theo giờ máy (Render UTC) — nếu cần chặn khung giờ, đặt CARE_SEND_HOURS sau.
cron.schedule('10 * * * *', async () => {
  try {
    const n1 = await runBillTouches();      // bước 5: ngày 0→7 ca ra bill
    const n2 = await runGroupTouches();     // bước 6: tái bill 4 nhóm + liệu trình
    if (n1 || n2) console.log(`[cron-care] gửi ${n1} chạm bill + ${n2} chạm tái bill`);
  } catch (err) {
    console.error('[cron-care] lỗi engine chăm sóc bill/tái bill:', err?.message || err);
  }
});

// --- Cron ĐÁNH THỨC BN NGỦ (tệp MEDi cũ) — 1 lần/ngày lúc 02:15 UTC = 09:15 giờ VN ---
cron.schedule('15 2 * * *', async () => {
  try {
    const { sent, listed } = await runWakeup();
    if (sent || listed) console.log(`[cron-wakeup] ${sent} tự nhắc OA + ${listed} đẩy telesale`);
  } catch (err) {
    console.error('[cron-wakeup] lỗi engine đánh thức BN ngủ:', err?.message || err);
  }
});

// --- Khởi động ---
app.listen(config.port, () => {
  console.log(`🚀 Bot Gemini Hiệp Lợi chạy ở cổng ${config.port}`);
  console.log(`   Webhook: POST /webhook | Health: GET /health`);
});
