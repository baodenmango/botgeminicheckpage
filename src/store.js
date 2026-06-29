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

const nowSec = () => Math.floor(Date.now() / 1000);

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

export function setSummary(conversationId, summary) {
  if (!summary) return;
  db.prepare('UPDATE conversations SET summary = ? WHERE conversation_id = ?')
    .run(String(summary).slice(0, 600), String(conversationId));
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

export default db;
