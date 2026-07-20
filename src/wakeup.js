// ============================================================
//  ENGINE "ĐÁNH THỨC BN NGỦ" (anh Trình chốt 30/06 — khách cũ "xa hơn nữa").
//  Quét tệp 1200 BN trong MEDi → BN khám CÁCH ĐÂY > X ngày, CHƯA quay lại → nhắc tái khám:
//   - BN ĐÃ follow OA (có hội thoại Zalo + SĐT khớp) → bot TỰ gửi chuỗi nhắc qua Zalo OA.
//   - BN CHƯA follow OA → gom DANH SÁCH bắn Telegram cho telesale gọi/add Zalo (an toàn,
//     đúng [[zalo-engine-cham-fallback]]: khách cũ chưa OA thì telesale chủ động kéo vào).
//  Chống nhắc dày bằng wakeup_log (cooldown + max lần). Tôn trọng opt_out.
//
//  ⚠️ Fail-open: MEDi chưa cấu hình (chưa bật Sheet) → engine không làm gì, không crash.
import * as store from './store.js';
import { getAllMediRecords, parseVisitDate, mapDiagnosis, isMediConfigured } from './medi.js';
import { CONDITION_VI } from './conditions.js';
import { sendCareMessages } from './care-send.js';
import { notifyWakeupList } from './telegram.js';

const DAY = 86400;
// Ngưỡng "ngủ": khám cách đây > NGÀY này mà chưa quay lại. Mặc định 45 ngày (xa hơn chuỗi tái bill).
const SLEEP_DAYS = parseFloat(process.env.WAKEUP_SLEEP_DAYS || '45');
// Trần "ngủ quá lâu" — quá thì có thể đã đi nơi khác / sai số, KHÔNG nhắc nữa (mặc định 365 ngày).
const SLEEP_MAX_DAYS = parseFloat(process.env.WAKEUP_MAX_DAYS || '365');
const COOLDOWN_DAYS = parseFloat(process.env.WAKEUP_COOLDOWN_DAYS || '30');
const MAX_COUNT = parseInt(process.env.WAKEUP_MAX_COUNT || '3', 10);
// Trần số ca tự gửi mỗi lần chạy (tránh đốt quota Zalo + tránh loạt tin dồn). Phần dư để lần sau.
const BATCH_LIMIT = parseInt(process.env.WAKEUP_BATCH_LIMIT || '40', 10);

function tenGoi(fullName) {
  if (!fullName) return 'anh/chị';
  const last = String(fullName).trim().split(/\s+/).pop();
  return /^[A-Za-zÀ-ỹ]+$/.test(last) ? last : 'anh/chị';
}

// Chuỗi nhắc đánh thức (đòn: thẩm quyền BS + lo sức khỏe + có đi có lại) — gửi qua Zalo OA.
function wakeMessages(rec, benhVi) {
  const ten = tenGoi(rec.name);
  return [
    `Dạ ${ten} ơi, em bên Phòng khám Cơ Xương Khớp Hiệp Lợi đây ạ 🌿 Lâu rồi không thấy mình quay lại, Bác sĩ nhắn em hỏi thăm tình trạng ${benhVi.toLowerCase()} của mình giờ sao rồi ạ?`,
    'Xương khớp để lâu không theo dõi dễ âm thầm nặng thêm, mình sắp xếp ghé Bác sĩ kiểm tra lại cho yên tâm nha ạ.',
    'Em đang giữ ưu tiên suất tái khám cho mình, mình nhắn em ngày tiện để em xếp giúp ạ 🙏',
  ];
}

/**
 * Vòng quét đánh thức. Trả về { sent, listed } (số ca tự gửi qua OA, số ca đẩy telesale).
 */
export async function runWakeup() {
  if (!isMediConfigured()) return { sent: 0, listed: 0 }; // chưa đấu MEDi → bỏ qua
  const records = await getAllMediRecords();
  if (records.length === 0) return { sent: 0, listed: 0 };

  const now = Math.floor(Date.now() / 1000);
  const toTelesale = [];
  let sent = 0;

  for (const rec of records) {
    if (!rec.phone) continue;
    const visit = parseVisitDate(rec.lastVisit);
    if (!visit) continue;
    const daysSince = Math.floor((now - visit) / DAY);
    if (daysSince < SLEEP_DAYS || daysSince > SLEEP_MAX_DAYS) continue; // ngoài cửa sổ "ngủ"
    if (!store.canWakeup(rec.phone, COOLDOWN_DAYS, MAX_COUNT)) continue; // đã nhắc gần đây / hết lượt

    const condition = mapDiagnosis(rec.diagnosis);
    const benhVi = CONDITION_VI[condition] || CONDITION_VI.unknown;

    // BN có kênh Zalo → bot tự gửi.
    // VÁ 20/07 — MỞ CỔNG VÀO: trước đây chỉ đi tiếp khi getZaloConvByPhone() có hội thoại,
    // nên BN mới quét QR quan tâm OA (có zalo_user_id nhưng CHƯA có hội thoại) bị chặn ngay
    // ở cổng, dù care-send.js:81-96 thừa sức gửi bằng OpenAPI theo user_id — và còn tự tra
    // lại kênh theo SĐT (kể cả KV `phone_zalo:<sdt>`) ngay lúc gửi.
    // Nay: có hội thoại HOẶC có zalo_user_id HOẶC có KV phone_zalo → cho đi tiếp,
    // để care-send tự nối kênh. Không có gì cả thì mới đẩy telesale.
    const zaloConv = store.getZaloConvByPhone(rec.phone);
    const uidKV = zaloConv ? null : store.getKV(`phone_zalo:${rec.phone}`);
    const coKenh = !!(zaloConv?.conversation_id || zaloConv?.zalo_user_id || uidKV);
    if (coKenh && sent < BATCH_LIMIT) {
      try {
        const ok = await sendCareMessages(
          {
            phone: rec.phone,
            conversation_id: zaloConv?.conversation_id,
            page_id: zaloConv?.page_id,
            zalo_user_id: zaloConv?.zalo_user_id || uidKV,
          },
          wakeMessages(rec, benhVi)
        );
        if (ok) {
          store.markWokeUp(rec.phone);
          sent++;
          console.log(`[wakeup] ✅ tự nhắc qua OA: ${rec.name || rec.phone} (${benhVi}, ${daysSince} ngày)`);
          continue;
        }
      } catch (err) {
        console.error(`[wakeup] gửi OA lỗi ${rec.phone}:`, err?.message || err);
      }
    }
    // Chưa follow OA (hoặc gửi hụt / quá batch) → đẩy telesale.
    toTelesale.push({ name: rec.name, phone: rec.phone, condition, daysSince });
  }

  if (toTelesale.length) {
    try { await notifyWakeupList(toTelesale); } catch (e) { console.error('[wakeup] báo Telegram lỗi:', e?.message); }
    // VÁ 20/07 — TRƯỚC ĐÂY GỌI markWokeUp() Ở ĐÂY LÀ BUG TỰ KHOÁ TỆP:
    // ca mới chỉ được LIỆT KÊ cho telesale (khách chưa nhận tin nào) vẫn bị đốt 1 lượt
    // trong hạn mức 3 lần → sau 3 vòng cron cả tệp bị khoá VĨNH VIỄN, engine im lặng.
    // Nay dùng markListed(): chỉ ghi mốc thời gian cho cooldown chống đẩy trùng ca lên
    // Telegram, KHÔNG đốt hạn mức gửi. Ca vẫn quay lại được khi đã có kênh Zalo.
    for (const it of toTelesale) store.markListed(it.phone);
  }
  if (sent || toTelesale.length) console.log(`[wakeup] xong: ${sent} tự nhắc OA + ${toTelesale.length} đẩy telesale`);
  return { sent, listed: toTelesale.length };
}
