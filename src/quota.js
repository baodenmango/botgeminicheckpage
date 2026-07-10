// ============================================================
//  NGÂN SÁCH TIN TƯ VẤN ZALO (B3 kế hoạch khai thác gói Tăng trưởng, 07/07).
//  Gói cho 500 tin tư vấn NGOÀI cửa sổ 48h/tháng (vượt tính ~72đ/tin). Tin chăm sóc
//  theo lịch (chuỗi ca-ra-bill + tái bill) hầu hết rơi ngoài 48h → đếm mỗi Ô TIN
//  gửi đi như 1 đơn vị ngân sách (đếm dư còn hơn đếm thiếu).
//
//  LUẬT TIÊU:
//   - Chạm ƯU TIÊN CAO (nhắc tái khám d6/d7, liệu trình G2, cứu ca bỏ dở G4):
//     LUÔN gửi — lố quota chịu 72đ/tin, rẻ hơn nhiều so với mất 1 ca tái khám.
//   - Chạm THƯỜNG: hoãn khi phần còn lại <= mức dự trữ (ZALO_QUOTA_RESERVE, mặc định 100)
//     — để dành đạn cho chạm cao đến cuối tháng. Engine giữ ca lại thử lần sau,
//     quá grace thì chạm tự rơi (đúng ý: lúc thiếu đạn chỉ bắn phát một).
//  Cảnh báo Telegram 1 lần/ngưỡng/tháng khi tiêu chạm 80% và 100% quota.
import * as store from './store.js';
import { notifyText } from './telegram.js';

const QUOTA_THANG = parseInt(process.env.ZALO_TIN_TUVAN_THANG || '500', 10);
const RESERVE = parseInt(process.env.ZALO_QUOTA_RESERVE || '100', 10);

// CỬA SỔ MIỄN PHÍ: tin gửi trong vòng 48h kể từ lần KHÁCH tương tác gần nhất KHÔNG tính vào
// 500 tin tư vấn (gói Tăng trưởng). Chốt 48h = 172800s (khớp thiết kế + comment care-send.js).
// Đổi bằng ENV nếu tài liệu gói đổi (VD một số gói 7 ngày cho OpenAPI — hiện GIỮ 48h an toàn).
const CUA_SO_GIAY = parseInt(process.env.ZALO_CUA_SO_GIAY || '172800', 10);

/** Tin gửi bây giờ có nằm trong cửa sổ miễn phí không? Thiếu mốc → false (mặc định TÍNH PHÍ, an toàn). */
export function trongCuaSoMienPhi(lastCustomerMsgAt) {
  if (!lastCustomerMsgAt) return false;
  return (Math.floor(Date.now() / 1000) - Number(lastCustomerMsgAt)) <= CUA_SO_GIAY;
}

// Đếm tin ĐÃ BỎ TRỪ vì trong cửa sổ 48h (đo lượng quota được giải phóng, cho báo cáo).
const keyMienPhi = () => `zalo_mienphi_48h:${thangHienTai()}`;
export function ghiMienPhi(soTin) {
  store.setKV(keyMienPhi(), String((parseInt(store.getKV(keyMienPhi()) || '0', 10)) + Math.max(1, soTin | 0)));
}
export function daMienPhi() {
  return parseInt(store.getKV(keyMienPhi()) || '0', 10);
}

// Tháng theo giờ VN (quota Zalo reset theo tháng dương lịch).
export function thangHienTai() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const keySpend = () => `zalo_spend:${thangHienTai()}`;

export function daTieu() {
  return parseInt(store.getKV(keySpend()) || '0', 10);
}
export function ghiTieu(soTin) {
  store.setKV(keySpend(), String(daTieu() + Math.max(1, soTin | 0)));
}
export function conLai() {
  return QUOTA_THANG - daTieu();
}

/** Chạm này có được phép tiêu quota không? priority: 'cao' | 'thuong'. */
export function choPhepGui(priority) {
  if (priority === 'cao') return true;
  return conLai() > RESERVE;
}

/** Bắn Telegram khi tiêu chạm 80%/100% — mỗi ngưỡng chỉ báo 1 lần/tháng. */
export async function canhBaoNeuCan() {
  const tieu = daTieu();
  for (const nguong of [80, 100]) {
    if (tieu * 100 >= QUOTA_THANG * nguong) {
      const flag = `zalo_spend_alert:${thangHienTai()}:${nguong}`;
      if (!store.getKV(flag)) {
        store.setKV(flag, '1');
        const conlai = QUOTA_THANG - tieu;
        await notifyText(
          nguong >= 100
            ? `🔴 <b>ZALO QUOTA</b>: đã tiêu HẾT ${QUOTA_THANG} tin tư vấn tháng ${thangHienTai()} (${tieu} tin). Từ giờ chạm THƯỜNG dừng, chạm ƯU TIÊN CAO vẫn gửi (tính ~72đ/tin lố).`
            : `🟠 <b>ZALO QUOTA</b>: đã tiêu ${tieu}/${QUOTA_THANG} tin tư vấn (≥80%) tháng ${thangHienTai()}, còn ${conlai}. Chạm thường sẽ tự hoãn khi còn ≤ ${RESERVE} tin.`
        );
      }
    }
  }
}

/** Số liệu cho /admin/zalo-quota + báo cáo tuần. */
export function thongKe() {
  return {
    thang: thangHienTai(), quota: QUOTA_THANG, da_tieu: daTieu(), con_lai: conLai(), du_tru: RESERVE,
    mien_phi_48h: daMienPhi(), // tin đã KHÔNG trừ quota vì gửi trong cửa sổ 48h
  };
}
