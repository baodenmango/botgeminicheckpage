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

const POS_TOKEN = process.env.POS_API_TOKEN || process.env.PANCAKE_API_TOKEN || null;
const POS_SHOP_ID = process.env.POS_SHOP_ID || '714976321'; // shop Phòng khám Hiệp Lợi
const POS_BASE = process.env.POS_API_BASE || 'https://pos.pancake.vn/api/v1';
// Mặc định BẬT (phủ 100% ca có thuốc/tiêm — anh chốt). Tắt khẩn: POS_INGEST_ENABLED=0.
const ENABLED = !/^(0|false|no|off)$/i.test(process.env.POS_INGEST_ENABLED || '1');

const HUY = new Set(['7', '8', '9']);  // hủy/xóa → đánh dấu seen luôn (khỏi soi lại)
const CHO = '0';                       // chỉ để số → CHƯA seen (mai có thể thành đã khám)

// Mục DỊCH VỤ khám/chẩn đoán hình ảnh — KHÔNG tính là thuốc.
const RE_DICHVU = /kh[áa]m|x[- ]?quang|si[êe]u [âa]m|\bmri\b|đo lo[ãa]ng|ch[ụu]p|phim/i;
// Mục TIÊM/thủ thuật nội khớp.
const RE_TIEM = /ti[êe]m|\bprp\b|biogen|t[ếe] b[àa]o g[ốo]c|\btbg\b|huy[ếe]t t[ưu][ơo]ng|hyalgan|corticoid|n[ộo]i kh[ớo]p|ch[ọo]c h[úu]t/i;

// SĐT về 10 số (bỏ +84/84 → 0) — cùng chuẩn pos.js/medi.js.
function normPhone(p) {
  let s = String(p || '').replace(/[^\d]/g, '');
  if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
  if (!s.startsWith('0') && s.length === 9) s = '0' + s;
  return s.length === 10 ? s : null;
}

// Gom tên các mục trong đơn (nhiều dạng field tuỳ phiên bản POS).
function tenCacMuc(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items
    .map((it) => it?.variation_info?.name || it?.product_name || it?.name || '')
    .filter(Boolean);
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
      if (!oid || store.getKV(`posingest_seen:${oid}`)) continue;
      const status = String(o?.status);
      if (status === CHO) continue;                       // chưa khám — soi lại lượt sau
      if (HUY.has(status)) { store.setKV(`posingest_seen:${oid}`, '1'); continue; }

      const muc = tenCacMuc(o);
      const hasInjection = muc.some((m) => RE_TIEM.test(m));
      const hasMedicine = muc.some((m) => !RE_DICHVU.test(m) && !RE_TIEM.test(m));
      if (!hasInjection && !hasMedicine) {                // khám suông → không vào chuỗi bill
        store.setKV(`posingest_seen:${oid}`, '1');
        continue;
      }
      const phone = normPhone(o?.bill_phone_number);
      if (!phone) { store.setKV(`posingest_seen:${oid}`, '1'); continue; }

      const payload = {
        phone,
        name: o?.bill_full_name || null,
        has_medicine: hasMedicine,
        has_injection: hasInjection,
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

      // Nối kênh Zalo theo SĐT (khách đã follow OA + từng nhắn) → chạm gửi được ngay.
      const zconv = store.getZaloConvByPhone(phone);
      if (zconv) {
        payload.conversation_id = zconv.conversation_id;
        payload.page_id = zconv.page_id;
        payload.zalo_user_id = zconv.zalo_user_id || null;
      }

      if (ingestBill(payload)) {
        store.setKV(`posingest_seen:${oid}`, '1');
        daNap++;
      }
    } catch (e) {
      console.warn('[pos-ingest] lỗi 1 đơn (bỏ qua):', e?.message);
    }
  }
  if (daNap) console.log(`[pos-ingest] ✅ tự nạp ${daNap} ca ra bill từ POS vào chuỗi chăm`);
  return daNap;
}
