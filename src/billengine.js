// ============================================================
//  ENGINE CHUỖI CHẠM "CA RA BILL" (bước 5 — thiết kế mục D-BIS).
//  Đọc các ca trong bảng bill_care (nguồn POS/MEDi nạp vào) → tới mốc ngày 0/1/3/6/7
//  thì gửi tin chăm sóc qua Zalo OA. Chống trùng bằng bill_cham_done. Đặt được lịch tái khám → DỪNG.
//
//  NẠP NGUỒN (fail-open — engine vẫn chạy trên data đã nạp nếu 1 nguồn hụt):
//   A) runPosIngest() (src/posingest.js) — NGUỒN CHÍNH, TỰ ĐỘNG: đọc thẳng Pancake POS API
//      (đơn status=11) mỗi 25,55 phút → enrich MEDi → ingestBill. Đây là "đấu POS" đã xong.
//   B) Admin endpoint POST /admin/bill-ingest (index.js) — nhân viên đẩy tay 1 ca (dự phòng).
//   (ingestFromPosSheet() cũ đọc Sheet đã BỎ — xem chú thích tại hàm bên dưới.)
import * as store from './store.js';
import { BILL_TOUCHES, buildBillMessages } from './billtouches.js';
import { sendCareMessages } from './care-send.js';
import { tagFollowerBenh } from './zalo.js';
import { sendZnsNhacLich, isZnsEnabled } from './zns.js';

const nowSec = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

// Liệu trình PRP/biogen/TBG = 3 buổi × 1 THÁNG (anh Trình chốt 30/06, mục D-TER).
// Khoảng cách buổi (ngày) — chỉnh qua env nếu phác đồ đổi.
const SESSION_GAP_DAYS = parseInt(process.env.REBILL_SESSION_GAP_DAYS || '30', 10);
const SESSIONS_TOTAL = parseInt(process.env.REBILL_SESSIONS_TOTAL || '3', 10);
const isLieuTrinh = (treatment) => /prp_khop|sinh_hoc|biogen|tbg|te_bao_goc/i.test(String(treatment || ''));

/**
 * Suy NHÓM TÁI BILL + lịch buổi kế từ payload (mục D + D-TER).
 * Trả về { group_no, sessions_done, sessions_total, next_session_at } hoặc {} nếu không xếp được.
 *   - Nhóm 2 (đang liệu trình PRP/biogen/TBG): tự tính next_session_at = bill_date + gap,
 *     trừ khi payload đã cho sessions_done/next_session_at chính xác từ MEDi.
 *   - Nhóm 4 (bỏ dở): payload.dropped=true (nguồn MEDi đánh dấu ngưng giữa chừng).
 *   - Nhóm 1/3: để trống group_no → đi chuỗi ca-ra-bill (D-BIS) như cũ; engine tái bill bỏ qua.
 * KHÔNG ép nhóm 1/3 vào tái bill để tránh chồng tin với chuỗi D-BIS đang chạy.
 */
export function inferRebillGroup(input, billDate) {
  const out = {};
  if (input.group_no != null) out.group_no = Number(input.group_no); // nguồn MEDi ép sẵn thì tôn trọng
  if (input.dropped === true && out.group_no == null) out.group_no = 4; // bỏ dở giữa chừng
  if (out.group_no == null && isLieuTrinh(input.treatment)) out.group_no = 2; // đang liệu trình

  if (out.group_no === 2) {
    const total = Number(input.sessions_total) || SESSIONS_TOTAL;
    const done = Number(input.sessions_done) || 1; // ca vừa ra bill = vừa xong ≥ buổi 1
    out.sessions_total = total;
    out.sessions_done = done;
    // next_session_at: ưu tiên MEDi cho sẵn; nếu chưa & chưa hết liệu trình → bill_date + gap.
    if (input.next_session_at) {
      out.next_session_at = typeof input.next_session_at === 'number'
        ? input.next_session_at
        : Math.floor(new Date(input.next_session_at).getTime() / 1000);
    } else if (done < total) {
      out.next_session_at = billDate + SESSION_GAP_DAYS * DAY;
    }
  }
  return out;
}

// epoch giây → dd/MM/yyyy giờ VN (tham số schedule_time của ZNS nhắc lịch)
function ngayVN(epochSec) {
  const d = new Date(epochSec * 1000 + 7 * 3600 * 1000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

// Chuẩn hoá 1 ca từ payload tự do (admin endpoint / nguồn POS) thành record bill_care.
// Bắt buộc: phone HOẶC zalo_user_id (để gửi được), bill_date. id tự sinh nếu thiếu.
export function normalizeBillRecord(input) {
  if (!input) return null;
  const phone = (input.phone || '').toString().replace(/[^\d]/g, '');
  const billDate = input.bill_date
    ? (typeof input.bill_date === 'number' ? input.bill_date : Math.floor(new Date(input.bill_date).getTime() / 1000))
    : nowSec();
  const id = input.id || (phone ? `${phone}:${billDate}` : null);
  if (!id) return null;
  // Suy nhóm tái bill + lịch buổi kế (mục D/D-TER) — mở khóa engine rebill vốn luôn trả 0
  // vì record cũ không có group_no/next_session_at. Nhóm 1/3 để trống → đi chuỗi D-BIS như cũ.
  const grp = inferRebillGroup(input, billDate);
  return {
    id: String(id),
    phone: phone || null,
    name: input.name || null,
    zalo_user_id: input.zalo_user_id || null,
    page_id: input.page_id || null,
    conversation_id: input.conversation_id || null,
    condition: input.condition || 'unknown',
    has_medicine: Boolean(input.has_medicine),
    has_injection: Boolean(input.has_injection),
    bill_date: billDate,
    treatment: input.treatment || null,
    group_no: grp.group_no ?? null,
    sessions_done: grp.sessions_done ?? null,
    sessions_total: grp.sessions_total ?? null,
    next_session_at: grp.next_session_at ?? null,
    source: input.source || null, // đo lường: nguồn lead kế thừa vào bill
  };
}

// Nạp 1 ca ra bill vào hàng đợi chăm (idempotent). Trả về record đã lưu hoặc null.
export function ingestBill(input) {
  const rec = normalizeBillRecord(input);
  if (!rec) { console.warn('[bill] ingest: payload thiếu phone/id → bỏ'); return null; }
  const saved = store.upsertBillCare(rec);
  console.log(`[bill] nạp ca ra bill ${rec.id} (bệnh ${rec.condition}, ${rec.has_injection ? 'tiêm' : ''}${rec.has_medicine ? ' thuốc' : ''})`);
  // B4: ca ra bill có Zalo + biết bệnh → gắn tag bệnh cho follower (fire-and-forget)
  if (rec.zalo_user_id && rec.condition && rec.condition !== 'unknown') {
    tagFollowerBenh(rec.zalo_user_id, rec.condition).catch(() => {});
  }
  return saved;
}

const BILL_GRACE_DAYS = parseFloat(process.env.BILL_GRACE_DAYS || '2');

/**
 * Vòng cron: với mỗi mốc, tìm ca tới hạn & chưa gửi → gửi tin chăm.
 * Mỗi ca 1 lượt cron CHỈ gửi 1 mốc (mốc CAO NHẤT đã tới hạn) — tránh dồn nhiều mốc một lúc.
 */
export async function runBillTouches() {
  const chon = new Map(); // id -> { rec, code, day }
  for (const t of BILL_TOUCHES) {
    const targets = store.findBillTargets(t.code, t.day, BILL_GRACE_DAYS);
    for (const rec of targets) {
      const cur = chon.get(rec.id);
      if (!cur || t.day > cur.day) chon.set(rec.id, { rec, code: t.code, day: t.day });
    }
  }
  if (chon.size === 0) return 0;
  console.log(`[bill] ${chon.size} ca ra bill tới mốc chăm`);
  let sent = 0;
  for (const { rec, code } of chon.values()) {
    try {
      const messages = buildBillMessages(code, {
        condition: rec.condition,
        hasMedicine: !!rec.has_medicine,
        hasInjection: !!rec.has_injection,
        name: rec.name,
      });
      if (!messages) { store.markBillChamDone(rec.id, code); continue; }
      const touchDef = BILL_TOUCHES.find((x) => x.code === code);
      let ok = await sendCareMessages(rec, messages, { priority: touchDef?.priority, code });

      // ZNS FALLBACK cho chạm NHẮC TÁI KHÁM d6/d7 (anh Trình chốt 09/07: "ngày 7 kéo họ tái khám").
      // 43/44 ca ra bill KHÔNG follow OA → sendCareMessages hụt vì mù kênh → mất luôn đòn tái khám.
      // Giờ: d6/d7 gửi hụt OA + có SĐT + ZNS bật → bắn ZNS nhắc lịch theo SĐT (mời quay lại trong 3 ngày).
      if (!ok && (code === 'd6' || code === 'd7') && rec.phone && isZnsEnabled()) {
        const hen = ngayVN(nowSec() + 3 * 86400); // mời tái khám trong ~3 ngày tới
        ok = await sendZnsNhacLich(rec.phone, { ten: rec.name, ngay_hen: hen, maKH: rec.id });
        if (ok) console.log(`[bill] ✅ ZNS nhắc tái khám ${code} (mù kênh OA) cho ca ${rec.id}`);
      }

      if (ok) {
        store.markBillChamDone(rec.id, code);
        // đánh dấu các mốc THẤP hơn còn sót là đã xong (ca nạp muộn, đã quá nhiều mốc → gửi mốc cao nhất)
        for (const t of BILL_TOUCHES) {
          if (t.day < BILL_TOUCHES.find((x) => x.code === code).day) store.markBillChamDone(rec.id, t.code);
        }
        sent++;
        console.log(`[bill] ✅ gửi chạm ${code} cho ca ${rec.id}`);
      } else {
        console.warn(`[bill] gửi hụt chạm ${code} ca ${rec.id} (không có kênh / lỗi) → giữ lại thử lần sau`);
      }
    } catch (err) {
      console.error(`[bill] lỗi gửi chạm ${code} ca ${rec.id}:`, err?.message || err);
    }
  }
  return sent;
}

/**
 * ⚠️ ĐÃ THAY THẾ (11/07/2026) — KHÔNG dùng nữa, GIỮ để tương thích import cũ.
 *
 * Đường nạp ca ra bill tự động THẬT giờ là runPosIngest() trong src/posingest.js:
 * đọc THẲNG Pancake POS API (đơn status=11 đã thu tiền) → enrich MEDi → nối kênh Zalo
 * → ingestBill(), chạy bằng cron 25,55 phút (index.js). KHÔNG còn đọc Sheet trung gian.
 * Lý do bỏ Sheet: quầy POS không tách mục thuốc/tiêm nên lọc theo tên hàng là mù —
 * POS cho SỰ KIỆN (ra bill), MEDi cho NỘI DUNG (bệnh/liệu trình). Xem posingest.js.
 *
 * Hàm này chủ động no-op để CA-RA-BILL không còn "TODO gây hiểu lầm engine mù POS".
 */
export async function ingestFromPosSheet() {
  console.log('[bill] ingestFromPosSheet đã ngừng dùng — nguồn POS đọc qua runPosIngest() (posingest.js).');
  return 0;
}
