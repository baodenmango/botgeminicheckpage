// ============================================================
//  CÚ CHẠM 2 — NHẮC VOUCHER CHƯA DÙNG (anh Trình chốt 15/07).
//  Voucher ZNS chỉ là cú GÕ CỬA (Zalo trói câu chữ, không kéo được người).
//  Đòn CHỐT là NGƯỜI THẬT gọi lại. Engine này KHÔNG tự nhắn khách —
//  nó quét sổ voucher, lọc ca "đã phát ≥N ngày mà CHƯA tới dùng", rồi
//  đẩy DANH SÁCH GỌI vào Telegram team để telesale gọi nhắc + đặt lịch.
//
//  Ranh giới: CHỈ ĐỌC sổ voucher + đẩy Telegram NỘI BỘ = reversible.
//  Không click-to-call, không nhắn khách tự động (chờ anh nếu muốn tự động).
//
//  Nguồn dữ liệu (đã có sẵn, xem zns.js sendZnsVoucher):
//    kv `voucher:<MÃ>` = { ma, sdt, ten, chuong_trinh, phat_luc, het_han, da_dung, dung_luc }
//    lễ tân bấm /voucher-quay/:ma?dung=1 khi khách tới → da_dung=true (thoát nhắc).
import * as store from './store.js';
import { notifyText } from './telegram.js';

const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);

// Cấu hình qua env (đổi không cần sửa code):
const NHAC_SAU_NGAY = parseInt(process.env.VOUCHER_NHAC_SAU_NGAY || '3', 10);   // phát ≥N ngày chưa dùng → nhắc
const NHAC_TOI_DA = parseInt(process.env.VOUCHER_NHAC_TOI_DA || '2', 10);        // mỗi voucher nhắc tối đa K lần
const NHAC_CACH_NGAY = parseInt(process.env.VOUCHER_NHAC_CACH_NGAY || '3', 10);  // 2 lần nhắc cách ≥M ngày
const SAP_HET_HAN_NGAY = parseInt(process.env.VOUCHER_SAP_HET_HAN || '7', 10);   // ≤7 ngày hết hạn = ưu tiên gấp
// TRẦN LIST = NĂNG LỰC GỌI THẬT (GĐ0 chiến dịch 17/07): đẩy nhiều hơn số telesale gọi nổi = list rơi.
// = số người gọi × 24 cuộc/ngày. 1 người → 24/lượt. Ép bằng CODE, không bằng con số cứng 40.
const SO_NGUOI_GOI = Math.max(1, parseInt(process.env.SLA_NGUOI_GOI || '1', 10));
const TRAN_MOI_LUOT = SO_NGUOI_GOI * 24;

const che = (sdt) => (sdt && sdt.length >= 6) ? sdt.slice(0, 4) + '***' + sdt.slice(-3) : sdt;
const nhan = (ct) => (ct === 'ct2' ? 'Gói khám 300k' : 'Tầm soát 150k');

// Đọc + parse an toàn 1 bản ghi voucher.
function parseRec(value) {
  try { return JSON.parse(value); } catch { return null; }
}

/**
 * Quét sổ voucher, chọn ca cần telesale gọi nhắc.
 * @returns { danhSach: [...], daNhac: n } — danhSach để đẩy Telegram.
 */
export function quetVoucherCanNhac() {
  const now = nowSec();
  const rows = store.listKVByPrefix('voucher:');
  const canNhac = [];

  for (const { value } of rows) {
    const v = parseRec(value);
    if (!v || !v.sdt || !v.phat_luc) continue;
    if (v.da_dung) continue;                                  // đã tới dùng → thoát
    if (v.het_han && now > v.het_han) continue;               // hết hạn → bỏ (telesale khỏi gọi phí)
    if (now - v.phat_luc < NHAC_SAU_NGAY * DAY) continue;     // chưa đủ "để lâu" → chờ

    // chống spam: đếm số lần đã nhắc + khoảng cách lần cuối
    const nhacKey = `voucher_nhac:${v.ma}`;
    let meta = {};
    try { meta = JSON.parse(store.getKV(nhacKey) || '{}'); } catch { meta = {}; }
    const soLan = meta.so_lan || 0;
    const lanCuoi = meta.lan_cuoi || 0;
    if (soLan >= NHAC_TOI_DA) continue;                        // đã nhắc đủ K lần → thôi
    if (soLan > 0 && now - lanCuoi < NHAC_CACH_NGAY * DAY) continue; // chưa tới nhịp nhắc kế

    const conNgay = v.het_han ? Math.max(0, Math.ceil((v.het_han - now) / DAY)) : null;
    canNhac.push({
      ma: v.ma, sdt: v.sdt, ten: v.ten || null, ct: v.chuong_trinh,
      con_ngay: conNgay, gap: conNgay != null && conNgay <= SAP_HET_HAN_NGAY,
      soLanDaNhac: soLan, nhacKey,
    });
  }

  // gấp trước (sắp hết hạn), rồi tới ca chưa nhắc lần nào
  canNhac.sort((a, b) => (b.gap - a.gap) || (a.soLanDaNhac - b.soLanDaNhac) || ((a.con_ngay ?? 9999) - (b.con_ngay ?? 9999)));
  return canNhac.slice(0, TRAN_MOI_LUOT);
}

/**
 * Vòng cron: quét → đẩy 1 thẻ Telegram "DANH SÁCH GỌI NHẮC" cho team + đánh dấu đã nhắc.
 * dry=true → chỉ trả danh sách, không ghi state / không gửi Telegram (kiểm thử).
 */
export async function runVoucherFollowup({ dry = false } = {}) {
  const ds = quetVoucherCanNhac();
  if (ds.length === 0) return { ok: true, canNhac: 0 };

  if (dry) return { ok: true, dry: true, canNhac: ds.length, mau: ds.slice(0, 5) };

  // Soạn thẻ Telegram (SĐT ĐẦY ĐỦ cho team gọi — đây là group NỘI BỘ, không phải khách).
  const dong = ds.map((c, i) => {
    const ten = c.ten ? c.ten : '(chưa có tên)';
    const han = c.con_ngay != null ? `còn ${c.con_ngay}d` : 'HSD ?';
    const flag = c.gap ? '🔴' : '•';
    const lan = c.soLanDaNhac > 0 ? ` [nhắc lần ${c.soLanDaNhac + 1}]` : '';
    return `${flag} ${i + 1}. <b>${ten}</b> — ${c.sdt} — ${nhan(c.ct)} — mã ${c.ma} (${han})${lan}`;
  }).join('\n');

  const text =
    `📞 <b>DANH SÁCH GỌI NHẮC VOUCHER</b> (${ds.length} ca)\n` +
    `Khách đã nhận voucher ≥${NHAC_SAU_NGAY} ngày chưa tới dùng. Telesale gọi hỏi thăm khớp + nhắc mã còn hạn + đặt lịch.\n` +
    `🔴 = sắp hết hạn (≤${SAP_HET_HAN_NGAY}d), gọi trước.\n\n${dong}\n\n` +
    `<i>Khách tới rồi → lễ tân bấm dùng mã (tự thoát danh sách). Chốt được lịch = ăn tiền.</i>`;

  await notifyText(text);

  // đánh dấu đã nhắc (chống lặp) — chỉ sau khi đã đẩy Telegram thành công
  const now = nowSec();
  for (const c of ds) {
    let meta = {};
    try { meta = JSON.parse(store.getKV(c.nhacKey) || '{}'); } catch { meta = {}; }
    store.setKV(c.nhacKey, JSON.stringify({ so_lan: (meta.so_lan || 0) + 1, lan_cuoi: now }));
  }
  console.log(`[voucher-followup] đẩy ${ds.length} ca cần gọi nhắc vào Telegram team`);
  return { ok: true, canNhac: ds.length };
}
