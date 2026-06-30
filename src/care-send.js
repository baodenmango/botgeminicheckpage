// ============================================================
//  GỬI TIN CHĂM SÓC (chuỗi ca-ra-bill + tái bill) — chọn kênh tự động.
//  Ưu tiên:
//   1) Có conversation_id + page_id (Zalo nối Pancake) → gửi qua Pancake sendMessages (như FB/Zalo inbox).
//   2) Có zalo_user_id + ZALO_OPENAPI_ENABLED=1 → gửi qua Zalo OpenAPI (message/cs).
//   3) Không có kênh nào khả dụng → trả false (engine báo log, không crash).
//  Trả về true nếu gửi được ít nhất 1 ô.
import { sendMessages, isPageEnabled } from './pancake.js';
import { sendTexts, isOpenApiEnabled } from './zalo.js';

export async function sendCareMessages(target, messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const { conversation_id, page_id, zalo_user_id } = target || {};

  // 1) Zalo nối Pancake (kênh chính, không kẹt gói OpenAPI).
  if (conversation_id && page_id && isPageEnabled(page_id)) {
    await sendMessages(page_id, conversation_id, messages);
    return true;
  }

  // 2) Zalo OpenAPI trực tiếp (gửi theo user_id) — khi gói cước đã có OpenAPI.
  if (zalo_user_id && isOpenApiEnabled()) {
    return await sendTexts(zalo_user_id, messages);
  }

  console.warn('[care-send] không có kênh gửi (thiếu conversation_id/page_id và Zalo OpenAPI tắt) → bỏ qua');
  return false;
}
