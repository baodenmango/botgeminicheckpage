// ============================================================================
//  CỔNG CHẶN CA LỚN — khách đã chi ≥20 TRIỆU thì BOT KHÔNG TỰ NHẮN khi hồ sơ
//  còn trống. Dựng 06/09/2026 (anh Trình chốt).
//
//  VÌ SAO CÓ FILE NÀY, VÀ VÌ SAO LÀ CODE CHỨ KHÔNG PHẢI LỜI DẶN TRONG PROMPT
//  ------------------------------------------------------------------------
//  system-prompt đã dài 92.065 ký tự; luật nào nằm trong đó thì model quên. Còn
//  đây là luật KHÔNG ĐƯỢC PHÉP QUÊN: hai ca lớn nhất tháng 8 —
//    · PHAN TRẦN THIỀU ANH 54.180.000đ · NGUYỄN VĂN CƯ 52.200.000đ (cùng bill 28/08)
//  — mà thẻ ngữ cảnh của bot chỉ có mỗi TÊN. Bot tự dập một câu "mình bị đau ở
//  đâu ạ" vào mặt người vừa trả 50 triệu là hỏng quan hệ, không phải hỏng 1 tin.
//  Anh Trình gọi đúng tên hiện tượng: BỊ DỘI.
//
//  🔴 CHỈ CHẶN TIN CHỦ ĐỘNG. Khách nhắn trước thì bot VẪN TRẢ LỜI BÌNH THƯỜNG.
//  Im lặng khi khách đang hỏi còn tệ hơn nhắn sai — đã mất khách thật vì bot câm
//  (20/07 và 01/09). Vì vậy cổng này CHỈ được gọi từ 4 chỗ:
//     ① care-send.js sendCareMessages  (⇒ billengine · rebillengine · wakeup)
//     ② handler.js handleRetouch       (chạm lại khi khách im)
//     ③ handler.js handleBotTouch      (chuỗi 7 chạm)
//     ④ zns.js sendZnsVoucher / sendZnsQuanTamOA (tin tiếp thị ngoài hội thoại)
//  KHÔNG cắm vào đường trả lời tin khách, KHÔNG cắm vào sendZnsXacNhanLich /
//  sendZnsNhacLich — hai cái đó là tin GIAO DỊCH khách đang chờ (xác nhận lịch,
//  nhắc giờ hẹn); chặn chúng là hại chính bệnh nhân.
//
//  ⚠️ FAIL-OPEN: đo không được tổng chi (POS sập/thiếu token) ⇒ KHÔNG CHẶN.
//  Fail-closed ở đây có nghĩa "POS sập một lần là cả hệ chăm sóc đứng im" — hại
//  rộng hơn nhiều so với một tin lỡ giọng. Mọi lỗi đều nuốt và log.
//
//  KHI CHẶN THÌ LÀM GÌ: bắn Telegram cho telesale VÀO GÕ TAY — kèm tên · SĐT ·
//  tổng đã chi · link hội thoại · và GHI RÕ THIẾU TRƯỜNG GÌ. Chặn mà không báo
//  ai thì chỉ là im lặng có tổ chức (luật "kêu mà không xử = chưa xong việc").
// ============================================================================
import * as store from './store.js';
import { layTongChi } from './pos.js';
import { traSdt, traTen, napBang } from './lieutrinh.js';

/** Ngưỡng "ca lớn". Anh Trình chốt 20 triệu. Đổi bằng GAC_TONG_CHI_NGUONG. */
export const NGUONG_MAC_DINH = 20000000;
export function nguong() {
  const v = parseInt(process.env.GAC_TONG_CHI_NGUONG || '', 10);
  return Number.isFinite(v) && v > 0 ? v : NGUONG_MAC_DINH;
}
/** Cầu dao tắt khẩn cả cổng: GAC_20TR_TAT=1 */
export function daTat() { return /^(1|true|yes|on)$/i.test(process.env.GAC_20TR_TAT || ''); }

// ---------------------------------------------------------------------------
// 1. SOÁT HỒ SƠ — HÀM THUẦN (không I/O, test thẳng)
// ---------------------------------------------------------------------------
export const TRUONG_BAT_BUOC = ['benh', 'dichVu', 'ngayLam'];
export const TEN_TRUONG_VI = {
  benh: 'bệnh/chẩn đoán',
  dichVu: 'dịch vụ đã làm',
  ngayLam: 'ngày làm',
};

function coChu(v) {
  if (v == null) return false;
  const s = String(v).trim();
  if (!s) return false;
  // 'unknown' / 'chưa rõ' / '?' là CÓ Ô NHƯNG RỖNG NGHĨA — vẫn tính là thiếu.
  return !/^(unknown|chua ro|chưa rõ|khong ro|không rõ|n\/a|null|\?+|-+)$/i.test(s);
}

/**
 * Hồ sơ đã đủ để bot mở lời chưa?
 * @param {{benh?:any, dichVu?:any, ngayLam?:any}} hoSo
 * @returns {{du:boolean, thieu:string[], thieuVi:string[]}}
 */
export function soatHoSo(hoSo = {}) {
  const thieu = TRUONG_BAT_BUOC.filter((k) => !coChu(hoSo[k]));
  return { du: thieu.length === 0, thieu, thieuVi: thieu.map((k) => TEN_TRUONG_VI[k]) };
}

/**
 * Quyết định CHẶN hay KHÔNG. HÀM THUẦN — mọi dữ liệu đã được caller gom sẵn.
 * @param {{tongChi:number|null, hoSo:object, nguongTien?:number, tat?:boolean}} p
 * @returns {{chan:boolean, lyDo:string, thieu:string[], thieuVi:string[], tongChi:number|null}}
 */
export function quyetDinh({ tongChi, hoSo = {}, nguongTien = NGUONG_MAC_DINH, tat = false } = {}) {
  const { du, thieu, thieuVi } = soatHoSo(hoSo);
  if (tat) return { chan: false, lyDo: 'cau_dao_tat', thieu, thieuVi, tongChi };
  // FAIL-OPEN: chưa đo được tiền ⇒ không chặn (xem đầu file).
  if (tongChi == null) return { chan: false, lyDo: 'chua_do_duoc_tong_chi', thieu, thieuVi, tongChi };
  if (tongChi < nguongTien) return { chan: false, lyDo: 'duoi_nguong', thieu, thieuVi, tongChi };
  if (du) return { chan: false, lyDo: 'ca_lon_nhung_du_ho_so', thieu, thieuVi, tongChi };
  return { chan: true, lyDo: 'ca_lon_thieu_ho_so', thieu, thieuVi, tongChi };
}

// ---------------------------------------------------------------------------
// 2. GOM HỒ SƠ TỪ MỌI NGUỒN BOT ĐANG CÓ
// ---------------------------------------------------------------------------
/**
 * Gom { benh, dichVu, ngayLam } từ: sổ liệu trình của Thảo → cache MEDi → bản ghi
 * ca-ra-bill → hội thoại. Caller có sẵn gì thì truyền vào qua `san`, hàm chỉ VÁ chỗ trống.
 * KHÔNG throw.
 */
export function gomHoSo({ phone, ten, conversation_id, san = {} } = {}) {
  const hoSo = { benh: san.benh || null, dichVu: san.dichVu || null, ngayLam: san.ngayLam || null };
  try {
    // (a) Sổ liệu trình của Thảo — nguồn giàu nhất cho ca tiêm lớn (cache đồng bộ).
    let ds = phone ? traSdt(phone) : [];
    if (!ds.length && ten) ds = traTen(ten);
    if (ds.length) {
      const b = ds[ds.length - 1];
      if (!hoSo.dichVu && b.dichVu) hoSo.dichVu = b.dichVu;
      if (!hoSo.ngayLam && b.lanGanNhat?.ngay) hoSo.ngayLam = b.lanGanNhat.ngay;
      // Sổ của Thảo ghi VỊ TRÍ TIÊM ('TBG GỐI P'), coi là chẩn đoán làm việc được.
      if (!hoSo.benh && b.dichVu) hoSo.benh = b.dichVu;
      if (!hoSo.benh && b.ghiChu) hoSo.benh = b.ghiChu;
    }
  } catch (e) { console.warn('[gac20tr] đọc sổ liệu trình lỗi (bỏ qua):', e?.message); }
  try {
    // (b) Cache MEDi (bệnh án bác sĩ). Bản ghi TỰ KHAI (khách kể qua chat) KHÔNG
    // tính là chẩn đoán — chính là thứ luật này muốn tránh dùng bừa.
    if (phone) {
      const m = store.getMediByPhone(String(phone).replace(/\D/g, ''));
      if (m) {
        let tuKhai = false;
        try { tuKhai = JSON.parse(m.raw || '{}').nguon === 'tu_khai'; } catch { /* raw hỏng → coi là hồ sơ thật */ }
        if (!tuKhai) {
          if (!hoSo.benh && m.diagnosis) hoSo.benh = m.diagnosis;
          if (!hoSo.dichVu && m.treatment) hoSo.dichVu = m.treatment;
          if (!hoSo.ngayLam && m.last_visit) {
            hoSo.ngayLam = new Date(m.last_visit * 1000).toISOString().slice(0, 10);
          }
        }
      }
    }
  } catch (e) { console.warn('[gac20tr] đọc medi_cache lỗi (bỏ qua):', e?.message); }
  try {
    // (c) Hội thoại: chỉ lấy `condition` khi nó KHÁC 'unknown' (coChu đã lọc).
    if (!hoSo.benh && conversation_id) {
      const c = store.getConversation(conversation_id);
      if (c?.condition) hoSo.benh = c.condition;
    }
  } catch (e) { console.warn('[gac20tr] đọc hội thoại lỗi (bỏ qua):', e?.message); }
  return hoSo;
}

// ---------------------------------------------------------------------------
// 3. BÁO TELESALE — chặn thì phải có người vào gõ tay, không im lặng
// ---------------------------------------------------------------------------
function tien(n) { return Number(n || 0).toLocaleString('vi-VN') + 'đ'; }
function ngayVN(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/** 1 lần/người/ngày — chặn thì mỗi engine đều gọi, không gộp thì group ngập tin. */
function daBaoHomNay(phone) {
  const k = `gac20tr_bao:${ngayVN()}:${String(phone || '').replace(/\D/g, '')}`;
  if (store.getKV(k)) return true;
  store.setKV(k, String(Date.now()));
  return false;
}

async function baoTelesale({ phone, ten, tongChi, thieuVi, nguon, conversation_id, page_id }) {
  try {
    if (daBaoHomNay(phone)) return false;
    const { notifyText } = await import('./telegram.js'); // import động: tránh vòng import
    const link = conversation_id && page_id
      ? `\n🔗 https://pancake.vn/${String(page_id).replace(/^zl_/, '')}?c_id=${conversation_id}`
      : '';
    await notifyText(
      `🛑 <b>CA LỚN — MÁY KHÔNG TỰ NHẮN, CẦN NGƯỜI GÕ TAY</b>\n`
      + `👤 <b>${esc(ten || '(chưa rõ tên)')}</b> — ${esc(phone || '(chưa có SĐT)')}\n`
      + `💰 Đã chi tại phòng khám: <b>${tien(tongChi)}</b> (ngưỡng ${tien(nguong())})\n`
      + `❗ Hồ sơ bot đang THIẾU: <b>${esc(thieuVi.join(' · '))}</b>\n`
      + `🤖 Tin bị chặn: ${esc(nguon || 'tin chủ động')}`
      + link
      + `\n\n<i>Vì sao chặn: bot không biết khách bị gì / đã làm gì / làm ngày nào — nhắn ra là "mình bị đau ở đâu ạ" với người vừa trả ${tien(tongChi)}. `
      + `Nhờ anh/chị mở hội thoại nhắn tay, hoặc bổ sung hồ sơ rồi máy tự chăm tiếp.</i>`
    );
    return true;
  } catch (e) {
    console.error('[gac20tr] báo Telegram lỗi (không chặn luồng):', e?.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 4. HÀM CÁC ENGINE GỌI
// ---------------------------------------------------------------------------
/**
 * Có phải CHẶN tin chủ động cho khách này không?
 * @param {object} p
 * @param {string}  p.phone            SĐT khách (bắt buộc để đo được tiền)
 * @param {string} [p.ten]             tên (tra sổ Thảo khi sổ chưa ghi SĐT)
 * @param {string} [p.conversation_id]
 * @param {string} [p.page_id]
 * @param {string} [p.nguon]           tên engine, để in vào thẻ Telegram
 * @param {object} [p.san]             hồ sơ caller đã có sẵn ({benh,dichVu,ngayLam})
 * @returns {Promise<{chan:boolean, lyDo:string, thieu:string[], thieuVi:string[], tongChi:number|null}>}
 */
export async function chanTinChuDong(p = {}) {
  const mac = { chan: false, lyDo: 'loi_bo_qua', thieu: [], thieuVi: [], tongChi: null };
  try {
    if (daTat()) return { ...mac, lyDo: 'cau_dao_tat' };
    const phone = String(p.phone || '').replace(/\D/g, '');
    // Không có SĐT ⇒ không đo được tiền ⇒ không chặn (fail-open, xem đầu file).
    if (phone.length < 9) return { ...mac, lyDo: 'khong_co_sdt' };

    const tongChi = await layTongChi(phone);
    if (tongChi == null || tongChi < nguong()) {
      return quyetDinh({ tongChi, hoSo: {}, nguongTien: nguong() });
    }
    // Chỉ tới đây (ca lớn thật) mới bỏ công nạp sổ liệu trình + soi hồ sơ.
    try { await napBang(); } catch { /* fail-soft, gomHoSo vẫn chạy với nguồn khác */ }
    const hoSo = gomHoSo({ phone, ten: p.ten, conversation_id: p.conversation_id, san: p.san });
    const kq = quyetDinh({ tongChi, hoSo, nguongTien: nguong() });
    if (kq.chan) {
      console.warn(`[gac20tr] 🛑 CHẶN ${p.nguon || 'tin chủ động'} cho ${p.ten || phone} `
        + `— đã chi ${tien(tongChi)}, thiếu: ${kq.thieuVi.join(', ')} → báo telesale gõ tay`);
      await baoTelesale({
        phone, ten: p.ten, tongChi, thieuVi: kq.thieuVi,
        nguon: p.nguon, conversation_id: p.conversation_id, page_id: p.page_id,
      });
    } else if (kq.lyDo === 'ca_lon_nhung_du_ho_so') {
      console.log(`[gac20tr] ✅ ca lớn ${p.ten || phone} (${tien(tongChi)}) đủ hồ sơ → cho ${p.nguon || 'tin'} đi tiếp`);
    }
    return kq;
  } catch (e) {
    // Cổng hỏng thì CHO TIN ĐI (đồng bộ triết lý conggac.js): thà lọt còn hơn câm hàng loạt.
    console.error('[gac20tr] cổng lỗi → CHO QUA:', e?.message);
    return mac;
  }
}
