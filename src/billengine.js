// ============================================================
//  ENGINE CHUỖI CHẠM "CA RA BILL" (bước 5 — thiết kế mục D-BIS).
//  Đọc các ca trong bảng bill_care (nguồn POS/MEDi nạp vào) → tới mốc ngày 0/1/3/6/7
//  thì gửi tin chăm sóc qua Zalo OA. Chống trùng bằng bill_cham_done. Đặt được lịch tái khám → DỪNG.
//
//  NẠP NGUỒN (2 cách — fail-open, chưa đấu POS thì engine vẫn chạy trên data đã nạp):
//   A) Admin endpoint POST /admin/bill-ingest (index.js) — nhân viên/automation đẩy 1 ca vào.
//   B) ingestFromPosSheet() — khung đọc Sheet POS export (giống medi.js), đấu sau.
import * as store from './store.js';
import { BILL_TOUCHES, buildBillMessages } from './billtouches.js';
import { sendCareMessages } from './care-send.js';

const nowSec = () => Math.floor(Date.now() / 1000);

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
  };
}

// Nạp 1 ca ra bill vào hàng đợi chăm (idempotent). Trả về record đã lưu hoặc null.
export function ingestBill(input) {
  const rec = normalizeBillRecord(input);
  if (!rec) { console.warn('[bill] ingest: payload thiếu phone/id → bỏ'); return null; }
  const saved = store.upsertBillCare(rec);
  console.log(`[bill] nạp ca ra bill ${rec.id} (bệnh ${rec.condition}, ${rec.has_injection ? 'tiêm' : ''}${rec.has_medicine ? ' thuốc' : ''})`);
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
      const ok = await sendCareMessages(rec, messages, { priority: touchDef?.priority, code });
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
 * (KHUNG) Đọc nguồn POS export (Sheet) để nạp ca ra bill tự động — đấu sau.
 * Khi có POS_SHEET_CSV_URL / POS_SHEET_ID, đọc giống medi.js rồi gọi ingestBill cho mỗi dòng
 * có thuốc/tiêm trong N ngày gần đây. Hiện fail-open: chưa cấu hình → không làm gì.
 */
export async function ingestFromPosSheet() {
  if (!process.env.POS_SHEET_CSV_URL && !process.env.POS_SHEET_ID) return 0;
  // TODO(đấu data): đọc Sheet POS → lọc bill có thuốc/tiêm trong 1 ngày qua → ingestBill mỗi dòng.
  // Cấu trúc đọc giống src/medi.js (CSV công khai hoặc Sheets API + service account).
  console.log('[bill] ingestFromPosSheet: nguồn POS đã khai báo nhưng phần đọc chưa đấu (khung).');
  return 0;
}
