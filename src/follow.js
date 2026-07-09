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

// Xác thực chữ ký webhook Zalo (mac = SHA256(appId + data + timestamp + oaSecret)).
// Nếu không cấu hình secret → bỏ qua kiểm (fail-open, vẫn xử event) nhưng log cảnh báo.
function verifySignature(body, macHeader) {
  const secret = process.env.ZALO_WEBHOOK_SECRET;
  if (!secret) return true; // chưa cấu hình → không chặn (môi trường nội bộ)
  try {
    const appId = process.env.ZALO_APP_ID || '';
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const ts = body?.timestamp || '';
    const expect = crypto.createHash('sha256').update(appId + data + ts + secret).digest('hex');
    return macHeader && expect === macHeader;
  } catch { return false; }
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
 * Xử lý 1 event webhook Zalo. Chỉ quan tâm event_name = 'follow'.
 * @param {object} body  payload webhook Zalo
 * @param {string} macHeader  header X-ZEvent-Signature (nếu có)
 */
export async function handleZaloFollow(body, macHeader) {
  if (!body || typeof body !== 'object') return;
  if (!verifySignature(body, macHeader)) {
    console.warn('[follow] chữ ký webhook KHÔNG hợp lệ → bỏ qua event');
    return;
  }
  const eventName = body.event_name || body.event || '';
  if (!/follow/i.test(eventName)) return; // chỉ xử follow (bỏ unfollow/khác)
  if (/^un/i.test(eventName)) return;     // unfollow

  const rawUid = body.follower?.id || body.user_id_by_app || body.user_id || '';
  const userId = stripZaloPrefix(rawUid);
  if (!userId) { console.warn('[follow] event follow thiếu user_id'); return; }

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
