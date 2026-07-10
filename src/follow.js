// ============================================================
//  WEBHOOK FOLLOW ZALO OA (bước 7 — thiết kế mục B "cơ chế giao file sau follow").
//  Khách bấm "Quan tâm" OA → Zalo bắn event 'follow' {user_id} → bot:
//   1) map ra BỆNH khách quan tâm (từ hội thoại Zalo đã có / MEDi theo SĐT),
//   2) TỰ gửi PDF cẩm nang + clip video đúng bệnh qua Zalo OA ("hứa rồi giao ngay").
//  Nếu chưa biết bệnh → chào + hỏi nhẹ vùng đau (KHÔNG gửi tài liệu sai bệnh).
//
//  ⚠️ Webhook follow CHỈ đến khi dùng Zalo OpenAPI (Pancake không bắn event follow).
//  → cần ZALO_OPENAPI_ENABLED=1 + cấu hình URL webhook + ZALO_WEBHOOK_SECRET trong Zalo Console.
import crypto from 'node:crypto';
import { CAM_NANG_PDF, CLIP_THEO_BENH, TEN_CAM_NANG_PUBLIC } from './touches.js';
import { sendTexts, sendFileByUrl, getUserInfo, isOpenApiEnabled, stripZaloPrefix, tagFollowerBenh, sendRequestInfo } from './zalo.js';
import { lookupMedi, mapDiagnosis } from './medi.js';
import { notifyText } from './telegram.js';
import * as store from './store.js';

// Xác thực chữ ký webhook Zalo OA. Công thức CHUẨN (đối chiếu tài liệu Zalo + nhiều nguồn dev,
// 10/07): mac = SHA256(app_id + RAW_BODY + timestamp + OA_SECRET), header X-ZEvent-Signature (hex trần).
//  • RAW_BODY = đúng byte Zalo gửi (req.rawBody), KHÔNG JSON.stringify(parsed) — parse rồi stringify
//    đổi thứ tự key/escape Unicode → hash luôn sai (lỗi của bản cũ).
//  • timestamp = body.timestamp LẤY TỪ TRONG payload (không phải header, không tự sinh).
//  • secret = OA Secret Key (ZALO_OA_SECRET), KHÔNG phải App Secret. Bản cũ dùng nhầm App Secret.
//
// 3 CHẾ ĐỘ (env ZALO_WEBHOOK_MODE), chọn an toàn để KHÔNG rớt event thật khi bật lần đầu:
//   'off'     — bỏ qua kiểm (mặc định khi CHƯA có OA secret). Vẫn xử event.
//   'log'     — verify + CẢNH BÁO nếu sai NHƯNG VẪN XỬ event (mặc định khi CÓ secret).
//               Bật vài ngày, soi log: nếu event thật luôn 'khớp' → yên tâm chuyển 'enforce'.
//   'enforce' — verify NGHIÊM: sai chữ ký → BỎ event (chặn giả mạo).
// Trả về true nếu ĐƯỢC PHÉP xử event (đã khớp, hoặc chế độ off/log).
function webhookMode() {
  const m = String(process.env.ZALO_WEBHOOK_MODE || '').toLowerCase();
  if (['off', 'log', 'enforce'].includes(m)) return m;
  return process.env.ZALO_OA_SECRET ? 'log' : 'off'; // mặc định an toàn
}

// Tính MAC kỳ vọng. Trả { ok, expect } — ok=null nghĩa là thiếu dữ liệu để tính (coi như không kết luận).
export function computeWebhookMac(rawBody, timestamp) {
  const secret = process.env.ZALO_OA_SECRET || process.env.ZALO_WEBHOOK_SECRET; // ưu tiên OA secret
  const appId = process.env.ZALO_APP_ID || '';
  if (!secret || !rawBody || !timestamp) return { ok: null, expect: null };
  const expect = crypto.createHash('sha256').update(appId + rawBody + String(timestamp) + secret).digest('hex');
  return { ok: true, expect };
}

// @param opts { rawBody, macHeader } — rawBody đúng byte (req.rawBody). Fallback JSON.stringify chỉ để
//   không crash khi thiếu rawBody (sẽ không khớp — nên luôn truyền rawBody thật).
function verifySignature(body, { rawBody, macHeader } = {}) {
  const mode = webhookMode();
  if (mode === 'off') return true;
  try {
    const raw = rawBody || (typeof body === 'string' ? body : JSON.stringify(body));
    const ts = body?.timestamp || '';
    const { ok, expect } = computeWebhookMac(raw, ts);
    const khop = ok && macHeader &&
      macHeader.length === expect.length &&
      crypto.timingSafeEqual(Buffer.from(macHeader), Buffer.from(expect));
    if (khop) return true;
    if (mode === 'log') {
      console.warn(`[zalo-webhook] ⚠️ chữ ký KHÔNG khớp (mode=log, VẪN xử event). mac_header=${String(macHeader).slice(0, 12)}… ts=${ts}`);
      return true; // log-only: không chặn
    }
    console.warn('[zalo-webhook] ❌ chữ ký KHÔNG hợp lệ (mode=enforce) → BỎ event');
    return false;
  } catch (e) {
    // lỗi tính toán: enforce thì chặn (an toàn), log/off thì cho qua
    if (webhookMode() === 'enforce') { console.warn('[zalo-webhook] lỗi verify → chặn:', e?.message); return false; }
    return true;
  }
}

// Tìm bệnh (condition) đã biết cho 1 zalo user: ưu tiên hội thoại Zalo đã lưu; rồi MEDi theo SĐT.
async function resolveCondition(zaloUserId) {
  // 1) hội thoại Zalo đã có trong store (khách từng nhắn) → lấy condition đã nhận diện
  try {
    const conv = store.getConversationByZaloUser?.(zaloUserId);
    if (conv?.condition && conv.condition !== 'unknown') return { condition: conv.condition, phone: conv.phone || null };
  } catch { /* getConversationByZaloUser có thể chưa có → bỏ qua */ }
  // 2) MEDi theo SĐT (nếu Zalo chia sẻ số)
  try {
    const info = await getUserInfo(zaloUserId);
    if (info?.phone) {
      const rec = await lookupMedi(info.phone);
      if (rec?.diagnosis) {
        // map text chẩn đoán MEDi → mã bệnh (hàm chung trong medi.js — đủ mọi bệnh)
        const c = mapDiagnosis(rec.diagnosis);
        if (c && c !== 'unknown') return { condition: c, phone: info.phone };
      }
      return { condition: null, phone: info.phone };
    }
  } catch { /* OpenAPI có thể tắt */ }
  return { condition: null, phone: null };
}

/**
 * Cổng verify chung cho MỌI handler webhook Zalo (follow/submit-info/rating).
 * Trả true nếu được phép xử event. Dùng ở index.js trước khi gọi từng handler.
 * @param {object} body  payload đã parse
 * @param {object} opts  { rawBody, macHeader }
 */
export function zaloWebhookAllowed(body, opts) {
  return verifySignature(body, opts);
}

/**
 * Xử lý 1 event webhook Zalo. Chỉ quan tâm event_name = 'follow'.
 * @param {object} body  payload webhook Zalo
 * @param {object} opts  { rawBody, macHeader } — rawBody đúng byte để verify chữ ký
 */
export async function handleZaloFollow(body, opts = {}) {
  if (!body || typeof body !== 'object') return;
  if (!verifySignature(body, opts)) {
    console.warn('[follow] chữ ký webhook KHÔNG hợp lệ → bỏ qua event');
    return;
  }
  const eventName = body.event_name || body.event || '';
  if (!/follow/i.test(eventName)) return; // chỉ xử follow (bỏ unfollow/khác)
  if (/^un/i.test(eventName)) return;     // unfollow

  const rawUid = body.follower?.id || body.user_id_by_app || body.user_id || '';
  const userId = stripZaloPrefix(rawUid);
  if (!userId) { console.warn('[follow] event follow thiếu user_id'); return; }

  // ĐO LƯỜNG: ghi ref nguồn follow NGAY (trước guard OpenAPI — nếu OpenAPI tắt, nhánh return
  // dưới sẽ nuốt mất attribution). ref từ link Quan tâm OA (?ref=lp_...) nếu Zalo đính kèm.
  try {
    const ref = body.follower?.ref || body.ref || body.source || '';
    const src = store.suyNguon('', 'zalo', ref);
    store.setKV(`nguon_follow:${userId}`, src);
  } catch { /* không chặn */ }

  if (!isOpenApiEnabled()) {
    console.warn(`[follow] khách ${userId} follow OA nhưng ZALO_OPENAPI_ENABLED tắt → chưa gửi tài liệu được (cần OpenAPI để gửi file).`);
    return;
  }

  const { condition } = await resolveCondition(userId);

  // Chào cảm ơn follow (luôn gửi).
  await sendTexts(userId, [
    'Dạ em chào mình, cảm ơn mình đã quan tâm Zalo Phòng khám Cơ Xương Khớp Hiệp Lợi nha 🌿',
  ]);

  if (!condition) {
    // chưa biết bệnh → hỏi nhẹ để chăm đúng (KHÔNG gửi tài liệu sai bệnh)
    await sendTexts(userId, [
      'Mình đang gặp vấn đề xương khớp ở vùng nào để em gửi đúng tài liệu chăm sóc cho mình ạ? 😊',
    ]);
    // card "Chia sẻ thông tin": khách bấm 1 nút là nối SĐT ↔ Zalo (không cần gõ tin)
    sendRequestInfo(userId).catch(() => {});
    console.log(`[follow] ${userId} follow OA (chưa rõ bệnh) → đã chào + hỏi vùng đau + card xin thông tin`);
    return;
  }

  // ĐÃ biết bệnh → gắn tag bệnh cho follower (B4, fire-and-forget) rồi "hứa rồi giao ngay".
  tagFollowerBenh(userId, condition).catch(() => {});
  const pdf = CAM_NANG_PDF[condition];
  const clips = (CLIP_THEO_BENH[condition] || []).filter(Boolean).slice(0, 2);
  const tenCN = TEN_CAM_NANG_PUBLIC?.[condition] || 'Cẩm nang chăm sóc tại nhà';

  await sendTexts(userId, [`Như đã hẹn, em gửi mình trọn bộ "${tenCN}" + video bài tập nha ạ 🎁`]);
  if (pdf) await sendFileByUrl(userId, pdf);
  for (const c of clips) await sendTexts(userId, [c]);
  await sendTexts(userId, [
    'Mình xem rồi áp dụng dần nha ạ. Có gì thắc mắc cứ nhắn em, hoặc để lại số em nhờ Bác sĩ Trình gọi tư vấn kỹ giúp mình ạ 🙏',
  ]);
  sendRequestInfo(userId).catch(() => {});
  console.log(`[follow] ✅ ${userId} follow OA (bệnh ${condition}) → đã giao PDF + ${clips.length} clip + card xin thông tin`);
}

// SĐT về dạng 10 số (bỏ +84/84 → 0) — cùng chuẩn medi.js/pos.js.
function normPhone10(p) {
  let s = String(p || '').replace(/[^\d]/g, '');
  if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
  if (!s.startsWith('0') && s.length === 9) s = '0' + s;
  return s.length === 10 ? s : null;
}

/**
 * Webhook USER_SUBMIT_INFO — khách bấm nút "Chia sẻ thông tin" trên card request_user_info.
 * Nhận tên + SĐT chính chủ → lưu map 2 chiều (phone↔zalo uid) cho posingest/chuỗi chăm,
 * gắn vào conv nếu đã có, và báo Telegram (lead nóng đã có số → telesale gọi được ngay).
 */
export async function handleZaloSubmitInfo(body) {
  const eventName = body?.event_name || body?.event || '';
  if (!/user_submit_info/i.test(eventName)) return false;
  const uid = stripZaloPrefix(body.sender?.id || body.user_id_by_app || body.user_id || body.follower?.id || '');
  const info = body.info || {};
  const phone = normPhone10(info.phone);
  if (!uid) return true;
  if (!phone) { console.warn(`[submit-info] ${uid} chia sẻ info nhưng không có SĐT hợp lệ`); return true; }

  // map 2 chiều để posingest (phone→uid) và các luồng khác (uid→phone) dùng
  store.setKV(`phone_zalo:${phone}`, uid);
  store.setKV(`zalo_phone:${uid}`, phone);

  // đã có hội thoại Zalo của uid này → ghi SĐT thẳng vào conv (ENRICH các lượt sau dùng được)
  const conv = store.getConversationByZaloUser(uid);
  if (conv && !conv.phone) {
    store.setPhoneCaptured(conv.conversation_id, phone, info.name || conv.customer_name || null);
  }
  // ĐO LƯỜNG: gán source cho conv theo nguồn follow đã ghi lúc bấm Quan tâm (nếu có).
  if (conv) {
    const srcFollow = store.getKV(`nguon_follow:${uid}`);
    if (srcFollow) store.setSource(conv.conversation_id, srcFollow);
  }

  console.log(`[submit-info] ✅ ${uid} bấm nút chia sẻ: ${info.name || '(không tên)'} ${phone.slice(0, 4)}***`);
  notifyText(
    `📱 <b>Khách Zalo bấm nút CHIA SẺ SĐT</b>\n• Tên: ${info.name || '(chưa rõ)'}\n• SĐT: ${phone}\n→ Đã nối hồ sơ tự động. Telesale gọi được ngay nếu là khách mới.`
  ).catch(() => {});
  return true;
}

// --- RADAR ĐÁNH GIÁ THẤP (đóng vòng van xả rating) ---
// Khách chấm sao trên form ZNS 522230 → Zalo bắn event feedback về webhook.
// ≤3 sao = khách KHÔNG hài lòng → réo anh Telegram NGAY kèm SĐT/tên/góp ý để gọi cứu
// trước khi họ đăng review công khai. ≥4 sao → chỉ log (không làm phiền).
function escTele(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Đọc điểm sao 1-5 từ payload feedback linh hoạt (star/rating/rate/value/score/point).
function docDiemSao(obj, depth = 0) {
  if (obj == null || depth > 6) return null;
  if (typeof obj === 'number') return (obj >= 1 && obj <= 5) ? obj : null;
  if (typeof obj === 'string') { const n = parseInt(obj, 10); return (n >= 1 && n <= 5) ? n : null; }
  if (Array.isArray(obj)) { for (const x of obj) { const r = docDiemSao(x, depth + 1); if (r) return r; } return null; }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (/^(star|rating|rate|value|score|point)s?$/i.test(k)) { const r = docDiemSao(obj[k], depth + 1); if (r) return r; }
    }
    for (const k of Object.keys(obj)) { const r = docDiemSao(obj[k], depth + 1); if (r) return r; }
  }
  return null;
}
// Đọc nội dung góp ý (comment/feedback/content/note/reason/message).
function docGopY(obj, depth = 0) {
  if (obj == null || depth > 6 || typeof obj === 'number') return null;
  if (typeof obj === 'string') return obj.trim() ? obj.trim().slice(0, 500) : null;
  if (Array.isArray(obj)) { for (const x of obj) { const r = docGopY(x, depth + 1); if (r) return r; } return null; }
  for (const k of Object.keys(obj)) {
    if (/^(comment|feedback|content|note|reason|message|noi_?dung|gop_?y)$/i.test(k)) { const r = docGopY(obj[k], depth + 1); if (r) return r; }
  }
  return null;
}

/**
 * Webhook ĐÁNH GIÁ ZNS (form 522230): khách chấm sao → Zalo bắn event feedback/rating.
 * ≤3 sao → réo anh Telegram kèm SĐT/tên + góp ý; ≥4 sao → chỉ log.
 */
export async function handleZaloRating(body) {
  const eventName = body?.event_name || body?.event || '';
  if (/user_submit_info/i.test(eventName)) return false; // đã có handler riêng
  if (!/rat(e|ing)|feedback|review|danh_?gia|user_submit/i.test(eventName)) return false;
  const uid = stripZaloPrefix(body.sender?.id || body.user_id_by_app || body.user_id || body.follower?.id || '');
  const sao = docDiemSao(body.info || body.data || body);
  if (sao == null) { console.log('[rating] event dạng đánh giá nhưng không đọc được điểm sao:', eventName); return true; }
  const gopY = docGopY(body.info || body.data || body);

  // chống trùng: 1 form có thể bắn event lặp (Zalo retry) → chỉ xử 1 lần/uid/ngày
  const ngay = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const dkey = `zalo_rating_done:${uid}:${ngay}`;
  if (store.getKV(dkey)) return true;
  store.setKV(dkey, String(sao));

  // tra SĐT + tên (map do handleZaloSubmitInfo tạo, hoặc getUserInfo)
  let phone = store.getKV(`zalo_phone:${uid}`) || null;
  let ten = null;
  if (uid) { try { const info = await getUserInfo(uid); ten = info?.name || null; if (!phone) phone = info?.phone || null; } catch { /* OpenAPI tắt */ } }

  if (sao >= 4) {
    console.log(`[rating] 😊 ${uid} chấm ${sao}★ (tốt) — chỉ log, không réo`);
    return true;
  }
  // ≤3 sao → RADAR: réo anh gọi cứu khách trước khi họ review công khai
  const dong = [
    `🚨 <b>ĐÁNH GIÁ THẤP ${sao}★ — CẦN GỌI CỨU KHÁCH</b>`,
    `👤 Tên: ${escTele(ten) || '(chưa rõ)'}`,
    `📞 SĐT: <b>${escTele(phone) || '(chưa có — mở Zalo OA tìm uid ' + escTele(uid).slice(0, 12) + ')'}</b>`,
    `⭐ Chấm: ${sao}/5 sao`,
  ];
  if (gopY) dong.push(`📝 Góp ý: "${escTele(gopY)}"`);
  dong.push('⚡️ Gọi xin lỗi + xử lý NGAY để khách không đăng review công khai (van xả complain).');
  notifyText(dong.join('\n')).catch(() => {});
  console.log(`[rating] 🚨 ${uid} chấm ${sao}★ → đã réo Telegram (phone ${phone ? phone.slice(0, 4) + '***' : 'chưa có'})`);
  return true;
}

// --- UNFOLLOW/BLOCK: đếm để đo sức khỏe OA (tỷ lệ rời bỏ). Handler ĐỘC LẬP (không nhét vào
// handleZaloFollow — hàm đó return sớm ở event unfollow). Chống trùng theo uid+tuần (Zalo retry).
export function handleZaloUnfollow(body) {
  const eventName = body?.event_name || body?.event || '';
  if (!/unfollow|unsub|block/i.test(eventName)) return false;
  const uid = stripZaloPrefix(body.follower?.id || body.user_id_by_app || body.user_id || '');
  const tuan = store.tuanKey();
  const dkey = `zalo_unfollow_seen:${uid}:${tuan}`;
  if (uid && store.getKV(dkey)) return true; // đã đếm uid này tuần này
  if (uid) store.setKV(dkey, '1');
  const key = `zalo_unfollow:${tuan}`;
  store.setKV(key, String(parseInt(store.getKV(key) || '0', 10) + 1));
  console.log(`[unfollow] ${uid || '(ẩn)'} rời OA — đếm tuần ${tuan}`);
  return true;
}
