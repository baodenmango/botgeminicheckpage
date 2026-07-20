// State store bằng SQLite (better-sqlite3). Nhẹ, không cần DB ngoài.
// Trên Render: đặt file .sqlite vào persistent disk để không mất khi restart.
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

// DB_PATH cho phép trỏ vào persistent disk của Render (vd /data/bot.sqlite).
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'bot.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    conversation_id      TEXT PRIMARY KEY,
    page_id              TEXT,
    customer_name        TEXT,
    phone                TEXT,
    phone_captured       INTEGER DEFAULT 0,
    condition            TEXT,
    status               TEXT DEFAULT 'active',   -- active | handover | captured
    history              TEXT DEFAULT '[]',        -- JSON mảng {role,text}
    last_customer_msg_at INTEGER,                   -- epoch giây
    retouch_count        INTEGER DEFAULT 0,
    sale_link_sent       INTEGER DEFAULT 0,          -- đã gửi link sale page chưa
    summary              TEXT,                        -- tóm tắt bệnh/thông tin giá trị
    human_taken_at       INTEGER,                     -- epoch: lần cuối NGƯỜI THẬT gõ tay (telesale vào)
    touch_done           TEXT DEFAULT '[]',           -- JSON mảng số chạm bot ĐÃ gửi (vd [3,4]) — chống gửi lặp
    channel              TEXT,                          -- 'facebook' | 'zalo' (kênh của hội thoại)
    zalo_user_id         TEXT,                          -- zalo user_id (KHÔNG kèm "zl_") nếu là kênh Zalo
    medi_status          TEXT,                          -- 'cu' | 'moi' | NULL (chưa tra MEDi)
    medi_record          TEXT,                          -- JSON hồ sơ MEDi đã tra (cache để khỏi tra lại mỗi lượt)
    bill_cham_done       TEXT DEFAULT '[]',           -- JSON mảng mốc chuỗi "ca ra bill" đã gửi (ngày 0/1/3/6/7)
    chuoi_done           TEXT DEFAULT '[]',           -- JSON mảng mã chạm tái bill 4 nhóm đã gửi
    opt_out              INTEGER DEFAULT 0,             -- khách nhắn ngừng → dừng mọi chuỗi chăm
    booking_notified     INTEGER DEFAULT 0,             -- đã báo Telegram ca "muốn đặt lịch chưa số" chưa (chống trùng)
    created_at           INTEGER
  );
`);

// Migration: thêm cột mới cho DB cũ (trên persistent disk) nếu thiếu.
try {
  const cols = db.prepare("PRAGMA table_info(conversations)").all().map((c) => c.name);
  if (!cols.includes('sale_link_sent')) {
    db.exec('ALTER TABLE conversations ADD COLUMN sale_link_sent INTEGER DEFAULT 0');
  }
  if (!cols.includes('summary')) {
    db.exec('ALTER TABLE conversations ADD COLUMN summary TEXT');
  }
  if (!cols.includes('human_taken_at')) {
    db.exec('ALTER TABLE conversations ADD COLUMN human_taken_at INTEGER');
  }
  if (!cols.includes('touch_done')) {
    db.exec("ALTER TABLE conversations ADD COLUMN touch_done TEXT DEFAULT '[]'");
  }
  if (!cols.includes('booking_notified')) {
    db.exec('ALTER TABLE conversations ADD COLUMN booking_notified INTEGER DEFAULT 0');
  }
  // Cột cho hệ chăm sóc Zalo OA (bước 2–7).
  if (!cols.includes('channel'))        db.exec('ALTER TABLE conversations ADD COLUMN channel TEXT');
  if (!cols.includes('zalo_user_id'))   db.exec('ALTER TABLE conversations ADD COLUMN zalo_user_id TEXT');
  if (!cols.includes('medi_status'))    db.exec('ALTER TABLE conversations ADD COLUMN medi_status TEXT');
  if (!cols.includes('medi_record'))    db.exec('ALTER TABLE conversations ADD COLUMN medi_record TEXT');
  if (!cols.includes('bill_cham_done')) db.exec("ALTER TABLE conversations ADD COLUMN bill_cham_done TEXT DEFAULT '[]'");
  if (!cols.includes('chuoi_done'))     db.exec("ALTER TABLE conversations ADD COLUMN chuoi_done TEXT DEFAULT '[]'");
  if (!cols.includes('opt_out'))        db.exec('ALTER TABLE conversations ADD COLUMN opt_out INTEGER DEFAULT 0');
  // Đo lường end-to-end: nguồn lead (fb_inbox/fb_comment/zalo_ads/qr_quay/salepage/tu_nhien/unknown).
  if (!cols.includes('source'))         db.exec('ALTER TABLE conversations ADD COLUMN source TEXT');
} catch (e) {
  console.warn('[store] migration:', e?.message || e);
}

// Comment đã xử (chống rep lặp khi Pancake bắn lại cùng 1 comment nhiều lần).
db.exec(`
  CREATE TABLE IF NOT EXISTS handled_comments (
    comment_id  TEXT PRIMARY KEY,
    page_id     TEXT,
    handled_at  INTEGER
  );
`);

// ---------- BẢNG "CA RA BILL" (bước 5) + "TÁI BILL theo nhóm" (bước 6) ----------
// Nguồn: POS/MEDi (ca ra bill có thuốc/tiêm; BN theo liệu trình). KHÁC bảng conversations
// (lead 48h trên FB). Mỗi BN ra bill 1 dòng; engine tính mốc ngày 0→7 (bill) hoặc theo nhóm (tái bill).
db.exec(`
  CREATE TABLE IF NOT EXISTS bill_care (
    id              TEXT PRIMARY KEY,        -- khóa duy nhất 1 ca (vd "<phone>:<billDate>" hoặc bill id POS)
    phone           TEXT,
    name            TEXT,
    zalo_user_id    TEXT,                     -- để gửi qua Zalo OA (nếu đã follow)
    page_id         TEXT,                     -- page Zalo OA (để gửi qua Pancake nếu không dùng OpenAPI)
    conversation_id TEXT,                     -- hội thoại Zalo của BN này (nếu đã map)
    condition       TEXT,                     -- mã bệnh (goi/vai/...)
    has_medicine    INTEGER DEFAULT 0,
    has_injection   INTEGER DEFAULT 0,
    bill_date       INTEGER,                  -- epoch giây NGÀY RA BILL (= ngày 0)
    group_no        INTEGER,                  -- nhóm tái bill: 1/2/3/4 (bước 6); NULL nếu chỉ chuỗi bill
    treatment       TEXT,                     -- liệu trình (PRP/biogen/TBG...) cho nhóm 2
    sessions_done   INTEGER,                  -- số buổi đã làm (nhóm 2)
    sessions_total  INTEGER,                  -- tổng buổi (nhóm 2)
    next_session_at INTEGER,                  -- epoch hẹn buổi tiếp (nhóm 2) — để nhắc trước/sau
    bill_cham_done  TEXT DEFAULT '[]',        -- JSON mốc chuỗi ca-ra-bill đã gửi (d0/d1/d3/d6/d7)
    group_cham_done TEXT DEFAULT '[]',        -- JSON mã chạm tái-bill theo nhóm đã gửi
    rebooked        INTEGER DEFAULT 0,        -- đã đặt được lịch tái khám → DỪNG chuỗi bill
    opt_out         INTEGER DEFAULT 0,
    updated_at      INTEGER,
    created_at      INTEGER
  );
`);
// Migration bill_care: thêm cột source (đo lường bill theo nguồn). Khối riêng — 1 lỗi ALTER
// không chặn khởi động. Bill kế thừa source của lead → trả lời "kênh nào ra bill rẻ nhất".
try {
  const bcCols = db.prepare("PRAGMA table_info(bill_care)").all().map((c) => c.name);
  if (!bcCols.includes('source')) db.exec('ALTER TABLE bill_care ADD COLUMN source TEXT');
} catch (e) { console.warn('[store] migration bill_care.source:', e?.message || e); }

// Hồ sơ BN từ MEDi, ĐẨY TỪ CRON LOCAL (credentials EMR ở local, không lên cloud).
// Bot tra theo SĐT khi ENRICH (khách nhắn Zalo) + engine đánh thức BN ngủ.
db.exec(`
  CREATE TABLE IF NOT EXISTS medi_cache (
    phone        TEXT PRIMARY KEY,   -- SĐT chuẩn 10 số
    name         TEXT,
    diagnosis    TEXT,               -- bệnh (tên Việt)
    last_visit   INTEGER,            -- epoch giây lần khám cuối
    treatment    TEXT,               -- họ liệu trình (PRP/biogen/TBG/kham_thuong...)
    visits       INTEGER,            -- số lần khám
    raw          TEXT,               -- JSON gốc (dự phòng)
    updated_at   INTEGER
  );
`);

// Nhật ký "đánh thức BN ngủ" (bước D) — chống nhắc lại 1 BN quá dày.
// wake_count = số lần ĐÃ GỬI TIN THẬT (đốt hạn mức, khoá khi >= MAX_COUNT).
// list_count = số lần chỉ ĐƯA VÀO DANH SÁCH telesale (KHÔNG đốt hạn mức) — xem vá 20/07 bên dưới.
db.exec(`
  CREATE TABLE IF NOT EXISTS wakeup_log (
    phone       TEXT PRIMARY KEY,
    last_wake_at INTEGER,
    wake_count   INTEGER DEFAULT 0,
    last_list_at INTEGER,
    list_count   INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS kv (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at INTEGER
  );
`);

// Migration wakeup_log: thêm last_list_at + list_count (vá 20/07 — tách sổ "gửi thật" vs
// "chỉ liệt kê telesale"). Khối riêng, 1 lỗi ALTER không chặn khởi động.
try {
  const wlCols = db.prepare('PRAGMA table_info(wakeup_log)').all().map((c) => c.name);
  if (!wlCols.includes('last_list_at')) db.exec('ALTER TABLE wakeup_log ADD COLUMN last_list_at INTEGER');
  if (!wlCols.includes('list_count')) db.exec('ALTER TABLE wakeup_log ADD COLUMN list_count INTEGER DEFAULT 0');
} catch (e) { console.warn('[store] migration wakeup_log.list:', e?.message || e); }

const nowSec = () => Math.floor(Date.now() / 1000);

// KV nhỏ cho state cần sống qua restart (vd token Zalo sau refresh — env trên Render sẽ cũ đi).
export function getKV(key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(String(key));
  return row ? row.value : null;
}
export function listKVByPrefix(prefix) {
  return db.prepare("SELECT key, value FROM kv WHERE key LIKE ? || '%'").all(String(prefix));
}
export function delKV(key) {
  db.prepare('DELETE FROM kv WHERE key = ?').run(String(key));
}
export function setKV(key, value) {
  db.prepare(`INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(String(key), value === null || value === undefined ? null : String(value), nowSec());
}

// BN này được phép "đánh thức" lại chưa? (chưa nhắc, hoặc lần cuối cách đây > cooldownDays).
//
// ⚠️ VÁ 20/07/2026 — BẪY TỰ KHOÁ TỆP:
// Trước đây wakeup.js gọi markWokeUp() cho CẢ ca chỉ-mới-đưa-vào-danh-sách-telesale
// (khách chưa hề nhận tin nào). Sau 3 vòng cron, wake_count chạm maxCount=3 →
// canWakeup() trả false VĨNH VIỄN → cả tệp câm dù chưa ai được chạm.
// Nay tách 2 sổ: wake_count = ĐÃ GỬI TIN THẬT (đốt hạn mức) · list_count = chỉ liệt kê
// cho telesale (KHÔNG đốt hạn mức, chỉ giữ mốc thời gian để cooldown chống đẩy trùng).
export function canWakeup(phone, cooldownDays = 30, maxCount = 3) {
  if (!phone) return false;
  const row = db.prepare('SELECT * FROM wakeup_log WHERE phone = ?').get(String(phone));
  if (!row) return true;
  // CHỈ số lần GỬI THẬT mới khoá theo hạn mức
  if ((row.wake_count || 0) >= maxCount) return false;
  // cooldown tính trên lần chạm gần nhất (gửi thật HOẶC liệt kê) để không dội trùng ca
  const chamCuoi = Math.max(row.last_wake_at || 0, row.last_list_at || 0);
  return (nowSec() - chamCuoi) > cooldownDays * 86400;
}

// ĐÃ GỬI TIN THẬT cho BN (qua Zalo OA) — đốt 1 lượt trong hạn mức maxCount.
export function markWokeUp(phone) {
  if (!phone) return;
  db.prepare(`INSERT INTO wakeup_log (phone, last_wake_at, wake_count) VALUES (?, ?, 1)
    ON CONFLICT(phone) DO UPDATE SET last_wake_at = excluded.last_wake_at, wake_count = wake_count + 1`)
    .run(String(phone), nowSec());
}

// CHỈ đưa vào danh sách telesale (CHƯA gửi gì cho khách) — KHÔNG đốt hạn mức gửi.
export function markListed(phone) {
  if (!phone) return;
  db.prepare(`INSERT INTO wakeup_log (phone, last_list_at, list_count, wake_count) VALUES (?, ?, 1, 0)
    ON CONFLICT(phone) DO UPDATE SET last_list_at = excluded.last_list_at,
      list_count = COALESCE(list_count, 0) + 1`)
    .run(String(phone), nowSec());
}

// DS ca NGHI là nạn nhân bug tự-khoá-tệp (bug cũ đốt hạn mức cho ca chỉ-liệt-kê).
// Tiêu chí THẬN TRỌNG: đang bị đốt lượt (wake_count>0) NHƯNG chưa từng có kênh Zalo
// → không có kênh thì KHÔNG THỂ đã gửi thật → chắc chắn là nạn nhân.
// Ca từng có kênh KHÔNG đụng tới (có thể đã nhận tin thật, gỡ khoá sẽ gửi lố cho khách).
export function dsWakeupNghiNanNhan() {
  try {
    return db.prepare(`
      SELECT w.phone, w.wake_count FROM wakeup_log w
      WHERE COALESCE(w.wake_count,0) > 0
        AND NOT EXISTS (
          -- có hội thoại ZALO khớp SĐT = có kênh gửi được (conversation_id là khoá chính,
          -- luôn khác NULL → phải lọc theo channel/zalo_user_id mới đúng)
          SELECT 1 FROM conversations c
          WHERE c.phone = w.phone
            AND (c.channel = 'zalo' OR c.zalo_user_id IS NOT NULL)
        )
        AND NOT EXISTS (
          -- hoặc đã từng lưu uid Zalo theo SĐT trong KV
          SELECT 1 FROM kv k WHERE k.key = 'phone_zalo:' || w.phone
        )
    `).all();
  } catch (e) {
    console.warn('[store] dsWakeupNghiNanNhan:', e?.message || e);
    return [];
  }
}

// Gỡ khoá: trả wake_count về 0 nhưng GIỮ list_count + mốc thời gian (cooldown vẫn hiệu lực,
// không để engine bắn dồn ngay lượt cron kế tiếp).
export function goKhoaWakeup(phones) {
  if (!Array.isArray(phones) || !phones.length) return 0;
  const st = db.prepare('UPDATE wakeup_log SET wake_count = 0 WHERE phone = ?');
  const tx = db.transaction((ds) => {
    let n = 0;
    for (const p of ds) n += st.run(String(p)).changes;
    return n;
  });
  return tx(phones);
}

// Số liệu chỉ-đọc cho giám sát (dùng cho endpoint /admin/wakeup-stats).
export function wakeupStats(maxCount = 3) {
  try {
    return db.prepare(`SELECT
        COUNT(*) AS tong,
        SUM(CASE WHEN COALESCE(wake_count,0) > 0 THEN 1 ELSE 0 END) AS da_gui_that,
        SUM(CASE WHEN COALESCE(wake_count,0) = 0 AND COALESCE(list_count,0) > 0 THEN 1 ELSE 0 END) AS chi_liet_ke,
        SUM(CASE WHEN COALESCE(wake_count,0) >= ? THEN 1 ELSE 0 END) AS da_khoa_het_luot
      FROM wakeup_log`).get(maxCount) || {};
  } catch (e) {
    return { loi: e?.message || String(e) };
  }
}

// ---------- MEDi cache (đẩy từ cron local) ----------
function normPhone10(p){ let s=String(p||'').replace(/[^\d]/g,''); if(s.startsWith('84')&&s.length>=11)s='0'+s.slice(2); if(!s.startsWith('0')&&s.length===9)s='0'+s; return s; }
// Upsert 1 hồ sơ BN. rec: { phone, name, diagnosis, last_visit(epoch), treatment, visits, raw }
export function upsertMedi(rec){
  const phone=normPhone10(rec?.phone); if(!phone||phone.length<9) return false;
  db.prepare(`INSERT INTO medi_cache (phone,name,diagnosis,last_visit,treatment,visits,raw,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(phone) DO UPDATE SET name=excluded.name, diagnosis=excluded.diagnosis,
      last_visit=excluded.last_visit, treatment=excluded.treatment, visits=excluded.visits,
      raw=excluded.raw, updated_at=excluded.updated_at`)
    .run(phone, rec.name||null, rec.diagnosis||null, rec.last_visit||null, rec.treatment||null,
      rec.visits||null, rec.raw?JSON.stringify(rec.raw):null, nowSec());
  return true;
}
export function getMediByPhone(phone){
  const p=normPhone10(phone); if(!p) return null;
  return db.prepare('SELECT * FROM medi_cache WHERE phone = ?').get(p) || null;
}
// Toàn bộ hồ sơ (cho engine đánh thức BN ngủ đọc từ cache local thay vì Sheet).
export function getAllMediCache(){
  return db.prepare('SELECT * FROM medi_cache').all();
}
export function mediCacheCount(){
  return db.prepare('SELECT COUNT(*) AS n FROM medi_cache').get().n;
}

// Đánh dấu 1 comment đã được bot xử. Trả về TRUE nếu đây là lần ĐẦU (chưa từng xử),
// FALSE nếu đã xử rồi → handler bỏ qua, không rep lặp.
export function markCommentHandledOnce(commentId, pageId) {
  if (!commentId) return false;
  try {
    db.prepare('INSERT INTO handled_comments (comment_id, page_id, handled_at) VALUES (?, ?, ?)')
      .run(String(commentId), String(pageId || ''), nowSec());
    return true; // chèn được = lần đầu
  } catch (e) {
    return false; // trùng PRIMARY KEY = đã xử rồi
  }
}

const stmtGet = db.prepare('SELECT * FROM conversations WHERE conversation_id = ?');

// Demo/giám sát MA TRẬN CHĂM SÓC: toàn bộ ca bill_care + trạng thái chạm (đọc-chỉ).
export function listBillCare(limit = 100) {
  return db.prepare(`
    SELECT id, phone, name, condition, has_medicine, has_injection, bill_date,
           group_no, treatment, next_session_at, bill_cham_done, group_cham_done,
           rebooked, opt_out, conversation_id, zalo_user_id
    FROM bill_care ORDER BY bill_date DESC LIMIT ?
  `).all(Math.min(limit, 500));
}

// B7: số liệu tuần cho báo cáo Zalo (hội thoại Zalo mới 7 ngày + tổng ca trong chuỗi chăm).
export function thongKeTuanZalo() {
  const tuanTruoc = Math.floor(Date.now() / 1000) - 7 * 86400;
  const convMoi = db.prepare(
    "SELECT COUNT(*) AS n FROM conversations WHERE channel = 'zalo' AND created_at > ?"
  ).get(tuanTruoc).n;
  const caCham = db.prepare('SELECT COUNT(*) AS n FROM bill_care').get().n; // GIỮ NGUYÊN (baocao.js đọc)

  // --- Bổ sung đo lường end-to-end (chỉ THÊM field, không đổi field cũ) ---
  const caChamTuan = db.prepare('SELECT COUNT(*) AS n FROM bill_care WHERE created_at > ?').get(tuanTruoc).n;
  // Follower→SĐT: conv Zalo mới trong tuần đã có phone
  const phoneCaptured = db.prepare(
    "SELECT COUNT(*) AS n FROM conversations WHERE channel = 'zalo' AND created_at > ? AND phone IS NOT NULL AND phone != ''"
  ).get(tuanTruoc).n;
  // Lịch qua Zalo: conv Zalo có nhãn đã đặt lịch (booking_notified)
  let bookingZalo = 0;
  try {
    bookingZalo = db.prepare(
      "SELECT COUNT(*) AS n FROM conversations WHERE channel = 'zalo' AND created_at > ? AND booking_notified = 1"
    ).get(tuanTruoc).n;
  } catch { /* cột có thể chưa có ở schema cũ */ }
  // Bill theo nguồn (tích luỹ từ ngày có cột source) — COALESCE để ca cũ hiện 'unknown'
  let billTheoNguon = [];
  try {
    billTheoNguon = db.prepare(
      "SELECT COALESCE(source,'unknown') AS nguon, COUNT(*) AS n FROM bill_care GROUP BY COALESCE(source,'unknown') ORDER BY n DESC"
    ).all();
  } catch { /* cột source có thể chưa migrate kịp */ }
  // Unfollow tuần (đếm từ counter kv — key theo tuanKey() dùng chung với handler unfollow)
  const unfollowTuan = parseInt(getKV(`zalo_unfollow:${tuanKey()}`) || '0', 10);

  return { convMoi, caCham, caChamTuan, phoneCaptured, bookingZalo, billTheoNguon, unfollowTuan };
}

// Khóa tuần dùng chung cho các counter theo tuần (unfollow...). Định danh ổn định: <năm>-<số ngày//7>.
export function tuanKey() {
  const sec = Math.floor(Date.now() / 1000) + 7 * 3600; // giờ VN
  const ngayTuEpoch = Math.floor(sec / 86400);
  return `w${Math.floor(ngayTuEpoch / 7)}`; // đổi mỗi 7 ngày, đơn điệu tăng
}

// B4: các cặp (zalo_user_id, bệnh) đã biết — để backfill gắn tag follower 1 lần sau deploy.
export function listZaloCondUsers() {
  return db.prepare(`
    SELECT DISTINCT zalo_user_id AS uid, condition FROM conversations
    WHERE channel = 'zalo' AND zalo_user_id IS NOT NULL
      AND condition IS NOT NULL AND condition NOT IN ('unknown', 'khac')
  `).all();
}

export function getConversation(conversationId) {
  const row = stmtGet.get(String(conversationId));
  if (!row) return null;
  return { ...row, history: JSON.parse(row.history || '[]') };
}

// Tạo mới nếu chưa có, trả về bản ghi.
export function ensureConversation(conversationId, pageId, customerName) {
  let conv = getConversation(conversationId);
  if (conv) return conv;
  db.prepare(`
    INSERT INTO conversations (conversation_id, page_id, customer_name, history, last_customer_msg_at, created_at)
    VALUES (?, ?, ?, '[]', ?, ?)
  `).run(String(conversationId), String(pageId), customerName || null, nowSec(), nowSec());
  return getConversation(conversationId);
}

// Thêm 1 lượt vào lịch sử (giới hạn 40 lượt gần nhất cho gọn).
export function appendHistory(conversationId, role, text) {
  const conv = getConversation(conversationId);
  if (!conv) return;
  const history = conv.history;
  history.push({ role, text });
  const trimmed = history.slice(-40);
  db.prepare('UPDATE conversations SET history = ? WHERE conversation_id = ?')
    .run(JSON.stringify(trimmed), String(conversationId));
}

// Cập nhật mốc tin cuối của KHÁCH (để tính im lặng cho retouch).
export function markCustomerMessaged(conversationId) {
  db.prepare('UPDATE conversations SET last_customer_msg_at = ? WHERE conversation_id = ?')
    .run(nowSec(), String(conversationId));
}

export function setPhoneCaptured(conversationId, phone, name) {
  db.prepare(`
    UPDATE conversations SET phone = ?, phone_captured = 1, status = 'captured',
      customer_name = COALESCE(?, customer_name) WHERE conversation_id = ?
  `).run(phone || null, name || null, String(conversationId));
}

export function setHandover(conversationId) {
  db.prepare("UPDATE conversations SET status = 'handover' WHERE conversation_id = ?")
    .run(String(conversationId));
}

export function setCondition(conversationId, condition) {
  if (!condition) return;
  db.prepare('UPDATE conversations SET condition = ? WHERE conversation_id = ?')
    .run(condition, String(conversationId));
}

export function markSaleLinkSent(conversationId) {
  db.prepare('UPDATE conversations SET sale_link_sent = 1 WHERE conversation_id = ?')
    .run(String(conversationId));
}

// Đã báo Telegram ca "muốn đặt lịch nhưng chưa số" chưa (chống báo trùng mỗi lượt).
export function isBookingNotified(conv) {
  return Boolean(conv && conv.booking_notified);
}
export function markBookingNotified(conversationId) {
  db.prepare('UPDATE conversations SET booking_notified = 1 WHERE conversation_id = ?')
    .run(String(conversationId));
}

export function setSummary(conversationId, summary) {
  if (!summary) return;
  db.prepare('UPDATE conversations SET summary = ? WHERE conversation_id = ?')
    .run(String(summary).slice(0, 600), String(conversationId));
}

// ---------- KÊNH + ENRICH MEDi (bước 2–3) ----------
// Ghi kênh hội thoại ('facebook' | 'zalo') + zalo_user_id (nếu Zalo).
export function setChannel(conversationId, channel, zaloUserId = null) {
  db.prepare('UPDATE conversations SET channel = COALESCE(?, channel), zalo_user_id = COALESCE(?, zalo_user_id) WHERE conversation_id = ?')
    .run(channel || null, zaloUserId || null, String(conversationId));
}

// ---------- ĐO LƯỜNG: NGUỒN LEAD (attribution) ----------
// Suy nguồn chuẩn hoá từ payload thô + kênh. GUARD CỨNG: kênh Zalo KHÔNG BAO GIỜ trả fb_*
// (payload Zalo có thể lẫn ad_id cũ → gán nhầm làm sai CPA). followRef = tham số ref của link OA.
export function suyNguon(nguonRaw, channel, followRef = null) {
  const ch = String(channel || '').toLowerCase();
  const raw = String(nguonRaw || '').toLowerCase();
  const ref = String(followRef || '').toLowerCase();
  if (ch === 'zalo') {
    // kênh Zalo: chỉ các nguồn hợp lệ của Zalo
    if (/^lp_/.test(ref) || /salepage|sale_page/.test(ref)) return 'salepage';
    if (/qr|quay|standee/.test(ref)) return 'qr_quay';
    if (/ads|quangcao|ad_/.test(ref) || /ads/.test(raw)) return 'zalo_ads';
    if (ref) return 'tu_nhien'; // có ref nhưng không khớp mẫu → tự nhiên/khác
    return 'tu_nhien';          // follow OA không ref = tự nhiên (organic)
  }
  // kênh FB
  if (/comment/.test(raw)) return 'fb_comment';
  if (/ad|adset|campaign|ctwa|paid/.test(raw)) return 'fb_ads';
  if (raw) return 'fb_inbox';
  return 'unknown';
}

// Ghi source cho conv — CHỈ khi cột đang NULL (first-touch, không ghi đè nguồn đầu tiên).
export function setSource(conversationId, source) {
  if (!conversationId || !source) return;
  try {
    db.prepare('UPDATE conversations SET source = ? WHERE conversation_id = ? AND (source IS NULL OR source = \'\')')
      .run(String(source).slice(0, 40), String(conversationId));
  } catch (e) { console.warn('[store] setSource:', e?.message); }
}

// Tìm hội thoại theo SĐT ở KÊNH KHÁC (vd FB) để NỐI NGỮ CẢNH FB→Zalo.
// Khách cho số bên FB rồi qua Zalo OA → lấy condition + summary từ hội thoại FB cũ để bot Zalo hiểu đủ.
// Bỏ qua chính conv đang xét. Ưu tiên bản có condition rõ + có summary + mới nhất.
export function getConversationByPhone(phone, excludeConvId = null) {
  if (!phone) return null;
  const row = db.prepare(`
    SELECT * FROM conversations
    WHERE phone = ? AND conversation_id != ?
    ORDER BY (condition IS NOT NULL AND condition != 'unknown') DESC,
             (summary IS NOT NULL) DESC, last_customer_msg_at DESC LIMIT 1
  `).get(String(phone), String(excludeConvId || ''));
  if (!row) return null;
  return { ...row, history: JSON.parse(row.history || '[]') };
}

// Tìm hội thoại Zalo theo zalo_user_id (lấy bản có condition rõ, mới nhất) — dùng cho webhook follow.
export function getConversationByZaloUser(zaloUserId) {
  if (!zaloUserId) return null;
  const row = db.prepare(`
    SELECT * FROM conversations WHERE zalo_user_id = ?
    ORDER BY (condition IS NOT NULL AND condition != 'unknown') DESC, created_at DESC LIMIT 1
  `).get(String(zaloUserId));
  if (!row) return null;
  return { ...row, history: JSON.parse(row.history || '[]') };
}

// Tìm hội thoại ZALO theo SĐT (BN đã follow OA + đã nhắn) — để engine đánh thức gửi qua đúng conv.
export function getZaloConvByPhone(phone) {
  if (!phone) return null;
  const row = db.prepare(`
    SELECT * FROM conversations
    WHERE channel = 'zalo' AND phone = ? AND opt_out = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(String(phone));
  return row || null;
}

// Lưu kết quả tra MEDi: status 'cu'/'moi' + bản ghi (JSON) để khỏi tra lại mỗi lượt.
export function setMedi(conversationId, status, record) {
  db.prepare('UPDATE conversations SET medi_status = ?, medi_record = ? WHERE conversation_id = ?')
    .run(status || null, record ? JSON.stringify(record) : null, String(conversationId));
}

// Đọc bản ghi MEDi đã cache (hoặc null). status: conv.medi_status.
export function getMediRecord(conv) {
  if (!conv || !conv.medi_record) return null;
  try { return JSON.parse(conv.medi_record); } catch { return null; }
}

// Khách nhắn ngừng (opt-out) → dừng mọi chuỗi chăm.
export function setOptOut(conversationId) {
  db.prepare('UPDATE conversations SET opt_out = 1 WHERE conversation_id = ?').run(String(conversationId));
}
// Kiểm 1 SĐT có opt-out ở BẤT KỲ kênh nào không (voucher-medi có phone nhưng chưa chắc có conv).
// Khách đã nhắn "ngừng" ở FB/Zalo → tôn trọng, KHÔNG bắn voucher (chống spam → giữ chất OA).
export function isPhoneOptedOut(phone) {
  if (!phone) return false;
  const p = String(phone).replace(/[^\d]/g, '');
  if (!p) return false;
  const row = db.prepare('SELECT 1 FROM conversations WHERE phone = ? AND opt_out = 1 LIMIT 1').get(p);
  return Boolean(row);
}
export function isOptedOut(conv) {
  return Boolean(conv && conv.opt_out);
}

// Đánh dấu NGƯỜI THẬT (telesale) vừa gõ tay vào hội thoại này.
export function markHumanTaken(conversationId) {
  db.prepare('UPDATE conversations SET human_taken_at = ? WHERE conversation_id = ?')
    .run(nowSec(), String(conversationId));
}

// Gỡ cờ "người giữ" cho 1 hội thoại (bot được tiếp quản lại ngay). Dùng khi cờ bị đánh nhầm.
export function clearHumanTaken(conversationId) {
  const r = db.prepare('UPDATE conversations SET human_taken_at = NULL WHERE conversation_id = ?')
    .run(String(conversationId));
  return r.changes;
}

// Gỡ cờ "người giữ" cho TẤT CẢ hội thoại (dọn sạch cờ kẹt do bug). Trả về số dòng đổi.
export function clearAllHumanTaken() {
  const r = db.prepare('UPDATE conversations SET human_taken_at = NULL WHERE human_taken_at IS NOT NULL').run();
  return r.changes;
}

// Gỡ trạng thái handover (đưa về active) cho 1 conv → bot tư vấn lại từ đầu.
// Dùng khi bot handover OAN (ca thật ra nhẹ, là lead). KHÔNG đụng phone đã có.
export function clearHandover(conversationId) {
  const r = db.prepare("UPDATE conversations SET status = 'active', human_taken_at = NULL WHERE conversation_id = ? AND status = 'handover'")
    .run(String(conversationId));
  return r.changes;
}

// Telesale có đang "giữ" hội thoại không? (đã gõ tay trong vòng holdHours giờ)
// → true thì bot IM, để người thật xử. Quá holdHours không gõ thêm → bot được tiếp quản lại.
export function isHumanActive(conv, holdHours) {
  if (!conv || !conv.human_taken_at) return false;
  const cutoff = nowSec() - Math.floor((holdHours || 6) * 3600);
  return conv.human_taken_at > cutoff;
}

export function incRetouch(conversationId) {
  db.prepare('UPDATE conversations SET retouch_count = retouch_count + 1 WHERE conversation_id = ?')
    .run(String(conversationId));
}

// ---------- ENGINE 7 CHẠM: trạng thái chạm bot (3/4/6) đã gửi ----------
// touch_done lưu JSON mảng số chạm bot ĐÃ gửi cho hội thoại (vd [3,4]) → chống gửi lặp.
function parseTouchDone(row) {
  try { return JSON.parse(row?.touch_done || '[]'); } catch { return []; }
}

// Chạm số `touchNo` đã được bot gửi cho hội thoại này chưa?
export function isTouchDone(conv, touchNo) {
  if (!conv) return false;
  return parseTouchDone(conv).includes(Number(touchNo));
}

// Đánh dấu bot ĐÃ gửi chạm `touchNo` cho hội thoại (idempotent).
export function markTouchDone(conversationId, touchNo) {
  const conv = getConversation(conversationId);
  if (!conv) return;
  const done = parseTouchDone(conv);
  if (!done.includes(Number(touchNo))) done.push(Number(touchNo));
  db.prepare('UPDATE conversations SET touch_done = ? WHERE conversation_id = ?')
    .run(JSON.stringify(done), String(conversationId));
}

/**
 * Tìm hội thoại tới mốc 1 CHẠM BOT cụ thể (3/4/6) để bot tự gửi tin.
 * Điều kiện:
 *  - đã qua mốc T+`hours` kể từ khi vào (created_at), còn trong cửa sổ `windowHours` (mặc định 48h)
 *  - CHƯA gửi chạm `touchNo` này (chống lặp)
 *  - KHÔNG đang có người thật giữ (telesale gõ tay trong holdHours qua) — để bot không chen ngang
 *  - KHÔNG handover (khiếu nại/cần người)
 * LƯU Ý: chạy cho CẢ lead đã có số lẫn chưa có số — nội dung do mode quyết định ở handler.
 * @param {number} touchNo  số chạm (3|4|6)
 * @param {number} hours    mốc T+ (giờ) của chạm đó
 * @param {number} holdHours
 * @param {number} graceHours  trễ tối đa cho phép sau mốc (tránh gửi chạm quá muộn)
 * @param {number} windowHours cửa sổ tổng (mặc định 48h)
 */
export function findTouchTargets(touchNo, hours, holdHours = 6, graceHours = 6, windowHours = 48) {
  const now = nowSec();
  const humanCutoff = now - Math.floor(holdHours * 3600);
  const earliest = now - Math.floor((hours + graceHours) * 3600); // vào sớm nhất (đã quá mốc nhưng chưa quá grace)
  const latest = now - Math.floor(hours * 3600);                   // vào muộn nhất (vừa tới mốc)
  const windowEarliest = now - Math.floor(windowHours * 3600);     // không chạm lead cũ hơn cửa sổ
  const rows = db.prepare(`
    SELECT * FROM conversations
    WHERE status != 'handover'
      AND created_at IS NOT NULL
      AND created_at >= ?              -- còn trong cửa sổ 48h
      AND created_at <= ?              -- đã qua mốc T+hours
      AND created_at >= ?              -- chưa quá mốc + grace (đừng gửi quá muộn)
      AND (human_taken_at IS NULL OR human_taken_at <= ?)
  `).all(windowEarliest, latest, earliest, humanCutoff);
  // lọc chạm đã gửi ở tầng JS (touch_done là JSON, khó query SQL)
  return rows
    .map((r) => ({ ...r, history: JSON.parse(r.history || '[]') }))
    .filter((r) => !parseTouchDone(r).includes(Number(touchNo)));
}

// CHỈ handover thật (khiếu nại/đòi gặp người) → bot IM, để người thật xử.
export function isHandover(conv) {
  return conv && conv.status === 'handover';
}

// Đã có SĐT → telesale tiếp quản, NHƯNG bot vẫn chăm sóc nếu khách nhắn tiếp.
export function isCaptured(conv) {
  return conv && (conv.status === 'captured' || conv.phone_captured);
}

// (giữ tương thích) coi như "đã xử lý" = handover thật.
export function isHandled(conv) {
  return isHandover(conv);
}

/**
 * Tìm hội thoại cần chạm lại:
 * chưa có SĐT, chưa handover, khách im >= minIdleHours, retouch_count < maxCount,
 * VÀ không đang có người thật giữ (telesale gõ tay / chốt lịch trong holdHours qua).
 */
export function findRetouchTargets(minIdleHours, maxCount, holdHours = 6) {
  const cutoff = nowSec() - Math.floor(minIdleHours * 3600);
  const humanCutoff = nowSec() - Math.floor(holdHours * 3600);
  const rows = db.prepare(`
    SELECT * FROM conversations
    WHERE status = 'active' AND phone_captured = 0
      AND last_customer_msg_at IS NOT NULL
      AND last_customer_msg_at <= ?
      AND retouch_count < ?
      AND (human_taken_at IS NULL OR human_taken_at <= ?)
  `).all(cutoff, maxCount, humanCutoff);
  return rows.map((r) => ({ ...r, history: JSON.parse(r.history || '[]') }));
}

// ================= BILL_CARE: ca ra bill (bước 5) + tái bill nhóm (bước 6) =================
function parseJsonArr(s) { try { return JSON.parse(s || '[]'); } catch { return []; } }

/**
 * UPSERT 1 ca bill_care (idempotent theo id). Cập nhật field truyền vào, giữ field cũ nếu không truyền.
 * @param {object} rec  { id, phone, name, zalo_user_id, page_id, conversation_id, condition,
 *                        has_medicine, has_injection, bill_date, group_no, treatment,
 *                        sessions_done, sessions_total, next_session_at }
 */
export function upsertBillCare(rec) {
  if (!rec || !rec.id) return null;
  const id = String(rec.id);
  const existing = db.prepare('SELECT * FROM bill_care WHERE id = ?').get(id);
  const now = nowSec();
  const v = (k, def = null) => (rec[k] !== undefined && rec[k] !== null ? rec[k] : (existing ? existing[k] : def));
  const bool = (k) => (rec[k] !== undefined ? (rec[k] ? 1 : 0) : (existing ? existing[k] : 0));
  if (existing) {
    db.prepare(`UPDATE bill_care SET phone=?, name=?, zalo_user_id=?, page_id=?, conversation_id=?,
      condition=?, has_medicine=?, has_injection=?, bill_date=?, group_no=?, treatment=?,
      sessions_done=?, sessions_total=?, next_session_at=?, source=?, updated_at=? WHERE id=?`)
      .run(v('phone'), v('name'), v('zalo_user_id'), v('page_id'), v('conversation_id'),
        v('condition'), bool('has_medicine'), bool('has_injection'), v('bill_date'),
        v('group_no'), v('treatment'), v('sessions_done'), v('sessions_total'),
        v('next_session_at'), v('source'), now, id);
  } else {
    db.prepare(`INSERT INTO bill_care (id, phone, name, zalo_user_id, page_id, conversation_id,
      condition, has_medicine, has_injection, bill_date, group_no, treatment,
      sessions_done, sessions_total, next_session_at, source, updated_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, v('phone'), v('name'), v('zalo_user_id'), v('page_id'), v('conversation_id'),
        v('condition'), bool('has_medicine'), bool('has_injection'), v('bill_date'),
        v('group_no'), v('treatment'), v('sessions_done'), v('sessions_total'),
        v('next_session_at'), v('source'), now, now);
  }
  return db.prepare('SELECT * FROM bill_care WHERE id = ?').get(id);
}

export function getBillCare(id) {
  return db.prepare('SELECT * FROM bill_care WHERE id = ?').get(String(id)) || null;
}

// Đã gửi mốc chuỗi ca-ra-bill này (d0/d1/...) chưa?
export function isBillChamDone(rec, code) {
  return parseJsonArr(rec?.bill_cham_done).includes(code);
}
export function markBillChamDone(id, code) {
  const r = getBillCare(id); if (!r) return;
  const arr = parseJsonArr(r.bill_cham_done);
  if (!arr.includes(code)) arr.push(code);
  db.prepare('UPDATE bill_care SET bill_cham_done=?, updated_at=? WHERE id=?').run(JSON.stringify(arr), nowSec(), String(id));
}

// Đã gửi chạm tái-bill theo nhóm này chưa?
export function isGroupChamDone(rec, code) {
  return parseJsonArr(rec?.group_cham_done).includes(code);
}
export function markGroupChamDone(id, code) {
  const r = getBillCare(id); if (!r) return;
  const arr = parseJsonArr(r.group_cham_done);
  if (!arr.includes(code)) arr.push(code);
  db.prepare('UPDATE bill_care SET group_cham_done=?, updated_at=? WHERE id=?').run(JSON.stringify(arr), nowSec(), String(id));
}

// BN đã đặt được lịch tái khám → DỪNG chuỗi ca-ra-bill (đã đạt mục tiêu).
export function markRebooked(id) {
  db.prepare('UPDATE bill_care SET rebooked=1, updated_at=? WHERE id=?').run(nowSec(), String(id));
}
export function setBillOptOut(id) {
  db.prepare('UPDATE bill_care SET opt_out=1, updated_at=? WHERE id=?').run(nowSec(), String(id));
}

/**
 * Tìm các ca ra bill TỚI MỐC `dayMin..dayMax` (tính từ bill_date) mà CHƯA gửi `code`,
 * chưa rebooked, chưa opt_out, có bill_date.
 * @param {number} day        mốc ngày của chạm (0/1/3/6/7)
 * @param {number} graceDays  cho phép trễ (gửi muộn tối đa) — tránh sót khi cron lỡ
 */
export function findBillTargets(code, day, graceDays = 2) {
  const now = nowSec();
  const latest = now - day * 86400;                 // đã qua mốc (bill_date <= now - day)
  const earliest = now - (day + graceDays) * 86400; // chưa quá mốc + grace
  const rows = db.prepare(`
    SELECT * FROM bill_care
    WHERE rebooked = 0 AND opt_out = 0
      AND bill_date IS NOT NULL
      AND bill_date <= ? AND bill_date >= ?
  `).all(latest, earliest);
  return rows.filter((r) => !parseJsonArr(r.bill_cham_done).includes(code));
}

/**
 * Tìm các ca TÁI BILL theo nhóm (bước 6) cần chạm 1 mốc cụ thể.
 * Lọc theo group_no + điều kiện thời gian do engine truyền (since/until trên trường mốc).
 * @param {number} groupNo
 * @param {string} timeField  trường epoch để so (vd 'bill_date' | 'next_session_at')
 * @param {number} minSec, maxSec  khoảng [now-?..now-?] áp lên timeField
 * @param {string} code        mã chạm để chống trùng (group_cham_done)
 */
export function findGroupTargets(groupNo, timeField, minSec, maxSec, code) {
  const allow = ['bill_date', 'next_session_at']; // whitelist tên cột — chống SQL injection
  if (!allow.includes(timeField)) return [];
  const rows = db.prepare(`
    SELECT * FROM bill_care
    WHERE rebooked = 0 AND opt_out = 0
      AND group_no = ?
      AND ${timeField} IS NOT NULL
      AND ${timeField} <= ? AND ${timeField} >= ?
  `).all(groupNo, maxSec, minSec);
  return rows.filter((r) => !parseJsonArr(r.group_cham_done).includes(code));
}

// ============================================================
//  SỔ HẸN (anh Trình duyệt 14/07): block "Booking" telesale dán vào group Telegram
//  không chỉ xác nhận 1 lần rồi vứt — lưu lại để cron nhắc T-1 ngày + T-2 giờ.
// ============================================================
db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone        TEXT NOT NULL,
    ten          TEXT,
    gio_hen_text TEXT,                                  -- chuỗi khách đọc ("09:00 14/07")
    hen_epoch    INTEGER,                               -- epoch giây; NULL = không đọc được giờ
    chat_id      TEXT,                                  -- group Telegram nơi đăng booking (để reply biên nhận)
    msg_id       INTEGER,
    created_at   INTEGER DEFAULT (strftime('%s','now')),
    xacnhan      TEXT,                                  -- 'ok' | 'loi_<ly_do>' | NULL (chưa gửi)
    nhac1_at     INTEGER,                               -- đã nhắc T-1 ngày lúc (epoch)
    nhac2_at     INTEGER                                -- đã nhắc T-2 giờ lúc (epoch)
  )
`);

// Ghi 1 booking vào sổ. Cùng SĐT + cùng giờ hẹn → cập nhật (telesale dán lại), không nhân đôi nhắc.
export function addBooking({ phone, ten, gioHenText, henEpoch, chatId, msgId }) {
  const cu = henEpoch
    ? db.prepare('SELECT id FROM bookings WHERE phone = ? AND hen_epoch = ?').get(String(phone), henEpoch)
    : null;
  if (cu) {
    db.prepare('UPDATE bookings SET ten = ?, gio_hen_text = ?, chat_id = ?, msg_id = ? WHERE id = ?')
      .run(ten || null, gioHenText || null, String(chatId || ''), msgId || null, cu.id);
    return { id: cu.id, moi: false };
  }
  const r = db.prepare('INSERT INTO bookings (phone, ten, gio_hen_text, hen_epoch, chat_id, msg_id) VALUES (?,?,?,?,?,?)')
    .run(String(phone), ten || null, gioHenText || null, henEpoch || null, String(chatId || ''), msgId || null);
  return { id: r.lastInsertRowid, moi: true };
}

export function setBookingXacNhan(id, kq) {
  db.prepare('UPDATE bookings SET xacnhan = ? WHERE id = ?').run(String(kq || ''), id);
}

// Các hẹn trong cửa sổ [-10 phút .. +30 giờ] — đủ cho cả nhắc T-1 ngày lẫn T-2 giờ.
export function getBookingsSapDenHen(nowS) {
  return db.prepare(
    'SELECT * FROM bookings WHERE hen_epoch IS NOT NULL AND hen_epoch > ? AND hen_epoch < ? ORDER BY hen_epoch'
  ).all(nowS - 600, nowS + 30 * 3600);
}

// Ghi mốc đã nhắc. cot whitelist cứng — chống SQL injection.
export function markBookingNhac(id, cot) {
  if (cot !== 'nhac1' && cot !== 'nhac2') return;
  db.prepare(`UPDATE bookings SET ${cot}_at = strftime('%s','now') WHERE id = ?`).run(id);
}

// Danh sách sổ hẹn mới nhất (cho /admin/so-hen soi nhanh).
export function listBookings(limit = 30) {
  return db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT ?').all(limit);
}

export default db;
