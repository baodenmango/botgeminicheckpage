// ============================================================
//  POS LOOKUP — tra đơn Pancake POS theo SỐ ĐIỆN THOẠI để nhận diện KHÁCH ĐÃ KHÁM.
//
//  Ý nghĩa trạng thái đơn Ở PHÒNG KHÁM (KHÔNG đọc theo nghĩa gốc POS — memory poscake-y-nghia-trang-thai):
//    0 "Mới"          = khách CHỈ để lại SĐT (lead đặt lịch) → CHƯA khám
//    6/16 "Chờ hàng"  = ĐÃ ĐẾN KHÁM        11 "Hoàn thành" = đã khám + bắn bill (đã thu tiền)
//    7/8/9 hủy/xóa    = bỏ, không tính
//  → Có ÍT NHẤT 1 đơn NGOÀI nhóm {0,7,8,9} = KHÁCH ĐÃ ĐẾN KHÁM.
//
//  Token: POS Pancake xác thực bằng CHÍNH PANCAKE_API_TOKEN (đã có trên Render cho engine
//  7 chạm + rescue) → không cần thêm secret. Shop id không phải secret, mặc định shop Hiệp Lợi.
//  Fail-open: thiếu token / lỗi mạng → trả null (coi như chưa biết), KHÔNG làm chết luồng chăm khách.
// ============================================================
import axios from 'axios';

const POS_TOKEN = process.env.POS_API_TOKEN || process.env.PANCAKE_API_TOKEN || null;
const POS_SHOP_ID = process.env.POS_SHOP_ID || '714976321'; // shop Phòng khám Hiệp Lợi
const POS_BASE = process.env.POS_API_BASE || 'https://pos.pancake.vn/api/v1';

// Trạng thái KHÔNG tính là đã khám: 0=Mới (chỉ để lại SĐT), 7=hủy, 8=xóa, 9=hệ thống hủy.
const CHUA_KHAM = new Set(['0', '7', '8', '9']);

// SĐT về dạng so sánh (10 số, bỏ +84/84 → 0) — giống medi.js.
function normPhone(p) {
  let s = String(p || '').replace(/[^\d]/g, '');
  if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
  if (!s.startsWith('0') && s.length === 9) s = '0' + s;
  return s;
}

// Cache theo SĐT: DƯƠNG TÍNH giữ 24h (đã khám thì khó "hết khám"), ÂM TÍNH chỉ 30 phút
// (lead sáng để số, chiều đến khám lên đơn → tối nhắn lại phải nhận ra được).
const cache = new Map(); // phone -> { rec, at }
const TTL_CO_MS = 24 * 3600 * 1000;
const TTL_KHONG_MS = 30 * 60 * 1000;

/**
 * Tra POS theo SĐT: khách có đơn "đã đến khám/đã thu tiền" không?
 * @param {string} phone
 * @returns {Promise<object|null>} { source:'pos', name, visits, lastVisit, hasBill } hoặc null (chưa khám / chưa biết)
 */
export async function lookupPosCustomer(phone) {
  if (!POS_TOKEN) return null;
  const p = normPhone(phone);
  if (!p || p.length !== 10) return null;
  const hit = cache.get(p);
  if (hit && Date.now() - hit.at < (hit.rec ? TTL_CO_MS : TTL_KHONG_MS)) return hit.rec;

  let rec = null;
  try {
    const { data } = await axios.get(`${POS_BASE}/shops/${POS_SHOP_ID}/orders`, {
      params: { access_token: POS_TOKEN, search: p, page_size: 30 },
      timeout: 15000,
    });
    const orders = Array.isArray(data?.data) ? data.data : [];
    const daKham = orders.filter((o) => !CHUA_KHAM.has(String(o.status)));
    if (daKham.length) {
      let last = null;
      for (const o of daKham) {
        const t = Date.parse(o.inserted_at || o.updated_at || '');
        if (!isNaN(t) && (!last || t > last)) last = t;
      }
      rec = {
        source: 'pos',
        name: daKham[0].bill_full_name || '',
        visits: daKham.length,
        lastVisit: last ? new Date(last).toISOString().slice(0, 10) : '',
        hasBill: daKham.some((o) => String(o.status) === '11'),
      };
    }
  } catch (e) {
    console.warn('[pos] tra đơn theo SĐT lỗi:', e?.response?.status || e?.message);
    return null; // lỗi mạng → chưa biết, KHÔNG cache kết quả lỗi
  }
  cache.set(p, { rec, at: Date.now() });
  return rec;
}

// ============================================================
//  TỔNG CHI CỦA MỘT KHÁCH (purchased_amount) — thêm 06/09/2026.
//  Dùng cho LUẬT ≥20 TRIỆU (src/gac20tr.js): ca lớn thì bot KHÔNG được tự nhắn
//  khi hồ sơ còn trống. Nguồn: POS `shop_customer.purchased_amount` — chính con số
//  POS dùng để xếp hạng khách, KHÔNG phải tự cộng đơn (tránh đếm trùng đơn huỷ).
//
//  Đo thật 06/09/2026 để kiểm chứng đường này:
//    0903979484 PHAN TRẦN THIỀU ANH → 54.180.000đ (1 đơn)
//    0983937026 NGUYỄN VĂN CƯ       → 52.200.000đ (1 đơn)
//
//  ⚠️ FAIL-OPEN CÓ CHỦ Ý: POS lỗi/thiếu token → trả null = "CHƯA ĐO ĐƯỢC".
//  Cổng chặn coi null là KHÔNG CHẶN. Lý do: nếu fail-closed thì một lần POS sập
//  là toàn bộ chuỗi chăm của MỌI khách đứng im, mà im lặng hàng loạt thì hại hơn
//  một tin lỡ giọng. Log rõ để soi được khi cần.
// ============================================================
const cacheChi = new Map(); // phone -> { tong, at }
const TTL_CHI_CO_MS = 6 * 3600 * 1000;   // đo được → giữ 6h (khách có thể lên bill thêm trong ngày)
const TTL_CHI_NULL_MS = 15 * 60 * 1000;  // chưa đo được → thử lại sau 15'

/**
 * Tổng tiền khách đã chi tại phòng khám, theo POS.
 * @param {string} phone
 * @returns {Promise<number|null>} số tiền (đ) · 0 nếu có khách nhưng chưa chi · null nếu CHƯA ĐO ĐƯỢC
 */
export async function layTongChi(phone) {
  const p = normPhone(phone);
  if (!p || p.length !== 10) return null;
  if (!POS_TOKEN) return null;
  const hit = cacheChi.get(p);
  if (hit && Date.now() - hit.at < (hit.tong == null ? TTL_CHI_NULL_MS : TTL_CHI_CO_MS)) return hit.tong;

  let tong = null;
  try {
    const { data } = await axios.get(`${POS_BASE}/shops/${POS_SHOP_ID}/customers`, {
      params: { access_token: POS_TOKEN, search: p, page_size: 20 },
      timeout: 15000,
    });
    const ds = Array.isArray(data?.data) ? data.data : [];
    // POS có thể trả nhiều bản ghi cùng SĐT (mỗi kênh 1 bản) → lấy MỨC CAO NHẤT,
    // vì bản ghi "gộp" mới mang đủ tiền; lấy tổng thì đếm trùng.
    for (const c of ds) {
      const sc = c?.shop_customer || {};
      const sdts = [...(c.phone_numbers || []), ...(sc.phone_numbers || [])].map(normPhone);
      if (!sdts.includes(p)) continue;                 // POS search khớp lỏng → soi lại cho chắc
      const v = Number(sc.purchased_amount);
      if (Number.isFinite(v)) tong = Math.max(tong ?? 0, v);
    }
  } catch (e) {
    console.warn('[pos] đọc tổng chi lỗi:', e?.response?.status || e?.message, '→ coi như CHƯA ĐO ĐƯỢC');
    cacheChi.set(p, { tong: null, at: Date.now() });
    return null;
  }
  cacheChi.set(p, { tong, at: Date.now() });
  return tong;
}

/** Cho test: dọn cache tổng chi. */
export function xoaCacheTongChiChoTest() { cacheChi.clear(); }
