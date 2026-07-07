// ============================================================
//  GỬI TIN CHĂM SÓC (chuỗi ca-ra-bill + tái bill) — chọn kênh tự động.
//  Ưu tiên:
//   1) Có conversation_id + page_id (Zalo nối Pancake) → gửi qua Pancake sendMessages (như FB/Zalo inbox).
//   2) Có zalo_user_id + ZALO_OPENAPI_ENABLED=1 → gửi qua Zalo OpenAPI (message/cs).
//   3) Không có kênh nào khả dụng → trả false (engine báo log, không crash).
//  Trả về true nếu gửi được ít nhất 1 ô.
//
//  NGÂN SÁCH QUOTA (B3): đây là chốt chặn duy nhất của tin chăm sóc theo lịch
//  (loại tin hay rơi NGOÀI cửa sổ 48h, ăn vào 500 tin tư vấn/tháng của gói Tăng trưởng).
//  → gác cổng theo priority trước khi gửi + đếm ô tin sau khi gửi. Tin bot REP khách
//  (trong cửa sổ 48h, miễn phí) đi đường handler/pancake, KHÔNG qua đây, không bị đếm.
import { sendMessages, isPageEnabled } from './pancake.js';
import { sendTexts, isOpenApiEnabled } from './zalo.js';
import * as quota from './quota.js';

export async function sendCareMessages(target, messages, opts = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const { conversation_id, page_id, zalo_user_id } = target || {};
  const priority = opts.priority || 'thuong';

  // Gác cổng ngân sách: chạm thường nhường đạn khi quota cạn tới mức dự trữ.
  if (!quota.choPhepGui(priority)) {
    console.warn(`[care-send] quota tin tư vấn còn ${quota.conLai()} (≤ dự trữ) → hoãn chạm thường${opts.code ? ` ${opts.code}` : ''}`);
    return false;
  }

  let ok = false;

  // 1) Zalo nối Pancake (kênh chính, không kẹt gói OpenAPI).
  if (conversation_id && page_id && isPageEnabled(page_id)) {
    await sendMessages(page_id, conversation_id, messages);
    ok = true;
  } else if (zalo_user_id && isOpenApiEnabled()) {
    // 2) Zalo OpenAPI trực tiếp (gửi theo user_id) — khi gói cước đã có OpenAPI.
    ok = await sendTexts(zalo_user_id, messages);
  } else {
    console.warn('[care-send] không có kênh gửi (thiếu conversation_id/page_id và Zalo OpenAPI tắt) → bỏ qua');
    return false;
  }

  if (ok) {
    quota.ghiTieu(messages.length);
    quota.canhBaoNeuCan().catch(() => {});
  }
  return ok;
}
