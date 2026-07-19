// ============================================================
//  B6 — TỰ ĐỘNG NẠP CA RA BILL TỪ PANCAKE POS (hết thời nạp tay từng ca).
//  Cron 30 phút: quét đơn POS mới nhất, trạng thái ĐÃ ĐẾN KHÁM/HOÀN THÀNH,
//  có mục THUỐC/TIÊM (bỏ ca khám suông) → enrich MEDi (bệnh/liệu trình/tên)
//  → nối kênh Zalo theo SĐT (conv Pancake đã có) → ingestBill vào chuỗi chạm D-BIS.
//
//  Ý nghĩa trạng thái Ở PHÒNG KHÁM (như pos.js): 0=chỉ để số (chưa khám),
//  6/16=đã đến khám, 11=hoàn thành (đã thu tiền), 7/8/9=hủy/xóa.
//  Idempotent 2 lớp: kv posingest_seen:<orderId> + ingestBill upsert theo <phone>:<billDate>.
//  Fail-open toàn tập: thiếu token/lỗi mạng/parse hụt → bỏ lượt, không chết cron.
import axios from 'axios';
import * as store from './store.js';
import { ingestBill } from './billengine.js';
import { lookupMedi, mapDiagnosis } from './medi.js';
import { guiHoacXepRating } from './zns.js';

const POS_TOKEN = process.env.POS_API_TOKEN || process.env.PANCAKE_API_TOKEN || null;
const POS_SHOP_ID = process.env.POS_SHOP_ID || '714976321'; // shop Phòng khám Hiệp Lợi
const POS_BASE = process.env.POS_API_BASE || 'https://pos.pancake.vn/api/v1';
// Mặc định BẬT (phủ 100% ca có thuốc/tiêm — anh chốt). Tắt khẩn: POS_INGEST_ENABLED=0.
const ENABLED = !/^(0|false|no|off)$/i.test(process.env.POS_INGEST_ENABLED || '1');

const HUY = new Set(['7', '8', '9']);  // hủy/xóa → đánh dấu seen luôn (khỏi soi lại)

// ⚠️ THỰC TẾ POS PHÒNG KHÁM (soi 07/07): 29/29 đơn hoàn thành đều bill dưới ĐÚNG 1 mục
// chung "KHÁM + DỊCH VỤ" — quầy KHÔNG tách thuốc/tiêm trong POS → lọc theo tên mục hàng
// là mù vĩnh viễn. Luật mới: POS cho SỰ KIỆN (status 11 = đã thu tiền → "ca ra bill"),
// MEDi cho NỘI DUNG (treatment prp_khop/sinh_hoc → cờ tiêm). Cờ thuốc mặc định BẬT cho
// đơn đã thu tiền (phòng khám tư thu tiền điều trị hầu như luôn kèm toa) — tắt bằng
// POS_DEFAULT_HAS_MEDICINE=0 nếu sau này quầy tách mục thuốc riêng trong POS.
const DEFAULT_HAS_MEDICINE = !/^(0|false|no|off)$/i.test(process.env.POS_DEFAULT_HAS_MEDICINE || '1');

// SĐT về 10 số (bỏ +84/84 → 0) — cùng chuẩn pos.js/medi.js.
function normPhone(p) {
  let s = String(p || '').replace(/[^\d]/g, '');
  if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
  if (!s.startsWith('0') && s.length === 9) s = '0' + s;
  return s.length === 10 ? s : null;
}

/** Quét 1 lượt đơn POS → nạp ca đủ điều kiện. Trả về số ca đã nạp. */
export async function runPosIngest() {
  if (!ENABLED || !POS_TOKEN) return 0;
  let orders = [];
  try {
    const { data } = await axios.get(`${POS_BASE}/shops/${POS_SHOP_ID}/orders`, {
      params: { access_token: POS_TOKEN, page_size: 60, page_number: 1 },
      timeout: 20000,
    });
    orders = Array.isArray(data?.data) ? data.data : [];
  } catch (e) {
    console.warn('[pos-ingest] đọc đơn POS lỗi:', e?.response?.status || e?.message);
    return 0;
  }

  let daNap = 0;
  for (const o of orders) {
    try {
      const oid = String(o?.id ?? '');
      // namespace "seen2": lượt đầu (bộ lọc tên mục hàng cũ) đã đánh dấu nhầm loạt đơn
      // thật là "khám suông" → đổi khoá để xử lại sạch từ đầu.
      if (!oid || store.getKV(`posingest_seen2:${oid}`)) continue;
      const status = String(o?.status);
      if (HUY.has(status)) { store.setKV(`posingest_seen2:${oid}`, '1'); continue; }
      // LUẬT 19/07 (anh Trình chốt): "mọi bill CÓ TIỀN đều là bệnh nhân thật".
      // Trước đây lọc cứng status==='11' → MÙ phần lớn ca thật, vì POScake để trạng thái
      // loạn: đơn đã thu nằm rải ở 16/6/3 và POS CHẶN đổi 16→11 qua API (đo 19/07:
      // 0/214 đơn ở status 11, trong khi 90 ngày có 304 đơn có tiền = 1,465 tỷ).
      // Tín hiệu "đã thu" đáng tin duy nhất là total_price > 0 (cùng luật MCP poscake
      // + gads_offline_upload + bill-push đang dùng).
      const tien = Number(o?.total_price || 0);
      if (!(tien > 0)) continue;                          // total=0 = LEAD chưa thu → chờ lượt sau
      const phone = normPhone(o?.bill_phone_number);
      if (!phone) { store.setKV(`posingest_seen2:${oid}`, '1'); continue; }

      const payload = {
        phone,
        name: o?.bill_full_name || null,
        has_medicine: DEFAULT_HAS_MEDICINE,
        has_injection: false, // MEDi quyết bên dưới (treatment prp_khop/sinh_hoc)
        bill_date: Math.floor((Date.parse(o?.inserted_at || o?.updated_at || '') || Date.now()) / 1000),
        condition: null,
        treatment: null,
      };

      // Enrich MEDi (bệnh + liệu trình + tên) — cùng luật với /admin/bill-ingest.
      try {
        const medi = await lookupMedi(phone);
        if (medi) {
          const c = mapDiagnosis(medi.diagnosis);
          if (c !== 'unknown') payload.condition = c;
          if (medi.treatment) payload.treatment = medi.treatment;
          if (/prp_khop|sinh_hoc/.test(medi.treatment || '')) payload.has_injection = true;
          if (!payload.name && medi.name) payload.name = medi.name;
        }
      } catch { /* fail-open */ }

      // Nối kênh Zalo theo SĐT: (1) conv đã nhắn OA, (2) map từ nút "Chia sẻ thông tin"
      // (webhook user_submit_info lưu kv phone_zalo:<sdt> → uid, không cần khách gõ tin).
      const zconv = store.getZaloConvByPhone(phone);
      if (zconv) {
        payload.conversation_id = zconv.conversation_id;
        payload.page_id = zconv.page_id;
        payload.zalo_user_id = zconv.zalo_user_id || null;
      } else {
        const uid = store.getKV(`phone_zalo:${phone}`);
        if (uid) payload.zalo_user_id = uid;
      }
      // ĐO LƯỜNG: bill kế thừa nguồn của lead → trả lời "kênh nào ra bill rẻ nhất".
      // Ưu tiên: source của conv Zalo → conv theo SĐT (kênh FB) → nguồn follow → unknown.
      const uidNoPrefix = String(payload.zalo_user_id || '').replace(/^zl_/i, '');
      payload.source = zconv?.source
        || store.getConversationByPhone(phone)?.source
        || (uidNoPrefix && store.getKV(`nguon_follow:${uidNoPrefix}`))
        || 'unknown';

      if (ingestBill(payload)) {
        store.setKV(`posingest_seen2:${oid}`, '1');
        daNap++;
        // ⭐ VAN XẢ (anh chốt 07/07): bắn form đánh giá NGAY sau khi ra bill —
        // khách bực xả vào kênh kín, không lên Google/Facebook review.
        guiHoacXepRating(phone, payload.name, String(o?.display_id || '')).catch(() => {});
      }
    } catch (e) {
      console.warn('[pos-ingest] lỗi 1 đơn (bỏ qua):', e?.message);
    }
  }
  if (daNap) console.log(`[pos-ingest] ✅ tự nạp ${daNap} ca ra bill từ POS vào chuỗi chăm`);
  return daNap;
}
