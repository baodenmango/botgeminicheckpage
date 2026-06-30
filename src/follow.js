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
import { sendTexts, sendFileByUrl, getUserInfo, isOpenApiEnabled, stripZaloPrefix } from './zalo.js';
import { lookupMedi, mapDiagnosis } from './medi.js';
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
    console.log(`[follow] ${userId} follow OA (chưa rõ bệnh) → đã chào + hỏi vùng đau`);
    return;
  }

  // ĐÃ biết bệnh → "hứa rồi giao ngay": gửi PDF cẩm nang + clip video đúng bệnh.
  const pdf = CAM_NANG_PDF[condition];
  const clips = (CLIP_THEO_BENH[condition] || []).filter(Boolean).slice(0, 2);
  const tenCN = TEN_CAM_NANG_PUBLIC?.[condition] || 'Cẩm nang chăm sóc tại nhà';

  await sendTexts(userId, [`Như đã hẹn, em gửi mình trọn bộ "${tenCN}" + video bài tập nha ạ 🎁`]);
  if (pdf) await sendFileByUrl(userId, pdf);
  for (const c of clips) await sendTexts(userId, [c]);
  await sendTexts(userId, [
    'Mình xem rồi áp dụng dần nha ạ. Có gì thắc mắc cứ nhắn em, hoặc để lại số em nhờ Bác sĩ Trình gọi tư vấn kỹ giúp mình ạ 🙏',
  ]);
  console.log(`[follow] ✅ ${userId} follow OA (bệnh ${condition}) → đã giao PDF + ${clips.length} clip`);
}
