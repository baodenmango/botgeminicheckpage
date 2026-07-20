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
import { noteBotSent, noteBotJustSent } from './echoguard.js';
import * as quota from './quota.js';
import * as store from './store.js';

// Đọc mốc khách nhắn cuối (last_customer_msg_at) để biết tin gửi có trong cửa sổ 48h miễn phí không.
// Thử 3 đường: conv theo id → conv Zalo suy từ user_id → conv theo SĐT. Đọc-không-được → null (TÍNH PHÍ).
function docLastCustomerMsgAt({ conversation_id, zalo_user_id, phone }) {
  try {
    if (conversation_id) {
      const c = store.getConversation(conversation_id);
      if (c?.last_customer_msg_at) return c.last_customer_msg_at;
    }
    if (zalo_user_id) {
      const oaId = process.env.ZALO_OA_ID || '3136814239074246132';
      const uid = String(zalo_user_id).replace(/^zl_/i, '');
      const c = store.getConversation(`zl_${oaId}_${uid}`); // khớp convIdPancake ở zalo.js:175
      if (c?.last_customer_msg_at) return c.last_customer_msg_at;
    }
    if (phone) {
      const zc = store.getZaloConvByPhone(phone);
      if (zc?.last_customer_msg_at) return zc.last_customer_msg_at;
    }
  } catch { /* đọc hụt → null → tính phí, an toàn */ }
  return null;
}

// ── KHUNG GIỜ GỬI (vá 19/07 — CEO soi log Render): cron chăm sóc chạy '10 * * * *' theo
// giờ MÁY (Render UTC, env KHÔNG có TZ) → 24/24. Log thật 12–18/07: 7/67 tin rơi ngoài
// khung, có ca 00:10 và 22:10 giờ VN. Tin chăm sóc rạng sáng phản tác dụng + dễ bị report OA.
// Gác Ở ĐÂY (chốt chặn chung của cả 3 engine bill/tái bill/wakeup) thay vì chỉ sửa cron,
// để mọi đường gọi tay/webhook cũng bị chặn. Chỉnh bằng CARE_SEND_HOURS="8-21" (giờ VN).
// Tắt gác khẩn: CARE_SEND_HOURS=0-23.
// LƯU Ý: KHÔNG miễn trừ priority='cao' — 'cao' là mức ưu tiên NGÂN SÁCH QUOTA (liệu trình
// PRP/TBG, xem rebilltouches.js:86), không phải "khẩn cấp"; tin đó gửi lúc 2h sáng cũng
// phản tác dụng như tin thường. Cron nhắc LỊCH HẸN đi đường bookingsched.js riêng, không qua đây.
export function gioVN(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', hour12: false,
  }).format(d));
}

export function trongKhungGioGui(d = new Date()) {
  const raw = String(process.env.CARE_SEND_HOURS || '8-21').trim();
  const m = raw.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return true; // cấu hình sai → không chặn oan
  const tu = Number(m[1]); const den = Number(m[2]);
  const h = gioVN(d);
  return tu <= den ? (h >= tu && h <= den) : (h >= tu || h <= den);
}

export async function sendCareMessages(target, messages, opts = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  let { conversation_id, page_id, zalo_user_id } = target || {};
  const priority = opts.priority || 'thuong';

  // Gác KHUNG GIỜ trước mọi thứ: hoãn (return false) chứ không đánh dấu đã gửi →
  // engine chống-trùng giữ nguyên mốc, lượt cron kế trong khung giờ sẽ gửi lại.
  if (!trongKhungGioGui()) {
    console.warn(`[care-send] ⏰ ${gioVN()}h giờ VN ngoài khung ${process.env.CARE_SEND_HOURS || '8-21'} → HOÃN chạm${opts.code ? ` ${opts.code}` : ''} (sẽ gửi lượt sau)`);
    return false;
  }

  // NỐI LẠI KÊNH NGAY LÚC GỬI (08/07 — "chưa ca nào vào được luồng 0-1-3-6-7"):
  // lúc POS ingest ca thường CHƯA có link SĐT↔Zalo, nhưng link hình thành DẦN về sau
  // (khách bấm nút Chia sẻ thông tin / nhắn OA / gõ số). Trước đây kênh chốt cứng tại
  // thời điểm ingest → ca nào ingest lúc chưa nối là mù kênh VĨNH VIỄN. Giờ: mỗi lần
  // gửi chạm, thiếu kênh thì tra lại theo SĐT; nối được thì ghi ngược vào bill_care.
  if (!((conversation_id && page_id) || zalo_user_id) && target?.phone) {
    const zconv = store.getZaloConvByPhone(target.phone);
    if (zconv) {
      conversation_id = zconv.conversation_id;
      page_id = zconv.page_id;
      zalo_user_id = zconv.zalo_user_id || zalo_user_id;
    } else {
      const uid = store.getKV(`phone_zalo:${target.phone}`);
      if (uid) zalo_user_id = uid;
    }
    if (((conversation_id && page_id) || zalo_user_id) && target.id) {
      try {
        store.upsertBillCare({ id: target.id, conversation_id, page_id, zalo_user_id });
        console.log(`[care-send] 🔗 nối được kênh Zalo cho ca ${target.id} theo SĐT lúc gửi`);
      } catch { /* ghi ngược hụt không chặn gửi */ }
    }
  }

  // TÁCH TIN GIAO DỊCH: nếu tin gửi trong cửa sổ 48h kể từ lần khách nhắn cuối → MIỄN PHÍ,
  // KHÔNG tính vào quota 500 → bỏ luôn gác đạn (tin miễn phí không cần giữ đạn).
  const lc = docLastCustomerMsgAt({ conversation_id, zalo_user_id, phone: target?.phone });
  const mienPhi = quota.trongCuaSoMienPhi(lc);

  // Gác cổng ngân sách: CHỈ áp cho tin TÍNH PHÍ (ngoài 48h). Chạm thường nhường đạn khi quota cạn.
  if (!mienPhi && !quota.choPhepGui(priority)) {
    console.warn(`[care-send] quota tin tư vấn còn ${quota.conLai()} (≤ dự trữ) → hoãn chạm thường${opts.code ? ` ${opts.code}` : ''}`);
    return false;
  }

  let ok = false;

  // 1) Zalo nối Pancake (kênh chính, không kẹt gói OpenAPI).
  if (conversation_id && page_id && isPageEnabled(page_id)) {
    // VÁ 20/07 (ca 13 hội thoại cờ human oan, log Render 11:10–12:35 UTC): GHI SỔ ECHO TRƯỚC KHI GỬI.
    // Trước vá, nhánh Pancake của care-send là call site DUY NHẤT trong repo gọi sendMessages mà
    // KHÔNG ghi noteBotSent/noteBotJustSent (6 call site handler.js + zalo.js:167 đều có ghi).
    // Hệ quả: Pancake dội echo tin chăm về webhook → tin là văn tư vấn dài, tử tế nên lọt HẾT 5 cửa
    // lọc ở handlePageMessage → handler tưởng telesale gõ tay → markHumanTaken → bot tự khoá mình 6h
    // dù giao diện Pancake ghi "Chưa có người xem". Nạn nhân: billengine/rebillengine/wakeup.
    // (Vá 07/07 nêu ở echoguard.js:8 chỉ đụng đường Zalo OpenAPI, KHÔNG đụng nhánh Pancake này.)
    // Ghi TRƯỚC chứ không sau: echo Pancake có thể dội về trước khi ghi xong → lại đánh cờ oan.
    messages.forEach((m) => noteBotSent(conversation_id, m));
    noteBotJustSent(conversation_id);
    // VÁ 20/07/2026 (ca log Render 11:10→12:35 UTC): trước đây HARDCODE ok = true sau lệnh gửi →
    // Pancake trả "access_token renewed" (tin không tới khách) mà vẫn ghiTieu() TRỪ QUOTA 500 tin
    // tư vấn Zalo. Vừa mất tin vừa mất đạn. Nay lấy đúng kết quả thật của sendMessages.
    ok = await sendMessages(page_id, conversation_id, messages);
    if (!ok) console.error(`[care-send] ❌ GỬI HỤT conv ${conversation_id}${opts.code ? ` (${opts.code})` : ''} → KHÔNG trừ quota, không tính là đã chăm`);
  } else if (zalo_user_id && isOpenApiEnabled()) {
    // 2) Zalo OpenAPI trực tiếp (gửi theo user_id) — khi gói cước đã có OpenAPI.
    ok = await sendTexts(zalo_user_id, messages);
  } else {
    // VÁ 20/07/2026: dòng cũ gộp 2 ca khác hẳn nhau vào 1 câu mơ hồ. Ca "có đủ conv+page nhưng
    // page BỊ TẮT/thiếu token" là lỗi CẤU HÌNH chữa được trong 1 phút (POST /admin/set-token),
    // còn "thiếu conv/page" là dữ liệu khách chưa có kênh. Tách ra để đọc log biết ngay phải làm gì.
    if (conversation_id && page_id && !isPageEnabled(page_id)) {
      console.error(`[care-send] ⛔ BỎ chăm conv ${conversation_id}${opts.code ? ` (${opts.code})` : ''}: `
        + `page ${page_id} chưa bật bot/THIẾU TOKEN → nạp ngay POST /admin/set-token?page=${page_id}`);
    } else {
      console.warn(`[care-send] không có kênh gửi (conv=${conversation_id || '?'} page=${page_id || '?'}, `
        + 'Zalo OpenAPI tắt / thiếu zalo_user_id) → bỏ qua');
    }
    return false;
  }

  if (ok) {
    if (mienPhi) {
      quota.ghiMienPhi(messages.length); // trong 48h → không trừ quota, chỉ đếm để đo
    } else {
      quota.ghiTieu(messages.length);    // ngoài 48h → trừ quota 500 (đếm theo ô, đếm dư an toàn)
      quota.canhBaoNeuCan().catch(() => {});
    }
  }
  return ok;
}
