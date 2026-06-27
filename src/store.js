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
    created_at           INTEGER
  );
`);

// Migration: thêm cột sale_link_sent cho DB cũ (trên persistent disk) nếu thiếu.
try {
  const cols = db.prepare("PRAGMA table_info(conversations)").all().map((c) => c.name);
  if (!cols.includes('sale_link_sent')) {
    db.exec('ALTER TABLE conversations ADD COLUMN sale_link_sent INTEGER DEFAULT 0');
  }
} catch (e) {
  console.warn('[store] migration sale_link_sent:', e?.message || e);
}

const nowSec = () => Math.floor(Date.now() / 1000);

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

export function incRetouch(conversationId) {
  db.prepare('UPDATE conversations SET retouch_count = retouch_count + 1 WHERE conversation_id = ?')
    .run(String(conversationId));
}

// Đã giao người? (captured hoặc handover) → ngừng auto-reply.
export function isHandled(conv) {
  return conv && (conv.status === 'handover' || conv.status === 'captured' || conv.phone_captured);
}

/**
 * Tìm hội thoại cần chạm lại:
 * chưa có SĐT, chưa handover, khách im >= minIdleHours, retouch_count < maxCount.
 */
export function findRetouchTargets(minIdleHours, maxCount) {
  const cutoff = nowSec() - Math.floor(minIdleHours * 3600);
  const rows = db.prepare(`
    SELECT * FROM conversations
    WHERE status = 'active' AND phone_captured = 0
      AND last_customer_msg_at IS NOT NULL
      AND last_customer_msg_at <= ?
      AND retouch_count < ?
  `).all(cutoff, maxCount);
  return rows.map((r) => ({ ...r, history: JSON.parse(r.history || '[]') }));
}

export default db;
