// Đọc & gom cấu hình từ process.env (đã nạp bằng dotenv ở index.js).
// Gom danh sách trang Pancake dạng PANCAKE_PAGE_{N}_ID/_TOKEN/_CHANNEL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Đọc system prompt (bộ não) từ file ---
export const SYSTEM_PROMPT = fs.readFileSync(
  path.join(__dirname, '..', 'system-prompt.md'),
  'utf8'
);

// Bộ não RIÊNG cho kênh Zalo OA (chăm sóc sâu, nhận diện BN cũ/mới, đòn tâm lý tới nóc).
// Thiếu file → fallback về prompt FB (an toàn, không crash).
export const SYSTEM_PROMPT_ZALO = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'system-prompt-zalo.md'), 'utf8');
  } catch {
    console.warn('[config] thiếu system-prompt-zalo.md → kênh Zalo dùng tạm bộ não FB');
    return SYSTEM_PROMPT;
  }
})();

// --- Gom các trang Pancake ---
function loadPancakePages() {
  const pages = {}; // page_id -> { token, channel }
  for (let n = 1; ; n++) {
    const id = process.env[`PANCAKE_PAGE_${n}_ID`];
    if (!id) break; // hết trang
    const token = process.env[`PANCAKE_PAGE_${n}_TOKEN`];
    const channel = process.env[`PANCAKE_PAGE_${n}_CHANNEL`] || 'facebook';
    const name = process.env[`PANCAKE_PAGE_${n}_NAME`] || null; // tên hiển thị cho dòng "Nguồn" báo telesale
    if (!token) {
      console.warn(`[config] PANCAKE_PAGE_${n}_ID=${id} thiếu TOKEN → bỏ qua trang này`);
      continue;
    }
    pages[String(id)] = { token, channel, name };
  }
  return pages;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  pancakePages: loadPancakePages(),

  retouch: {
    // Nhịp "NÓNG VỪA" (anh Bảo chốt 11/07): khách chat rồi im ~25' là dập lại để đốn hạ lúc còn
    // lưỡng lự, tối đa 3 lần. Trước đây 2h/2 lần → lỡ mất lúc khách nóng. Mỗi lần vẫn 1 ô, giữ
    // giờ vàng 8-22h (handler.js chặn). Chỉnh qua env nếu muốn xoay nhịp mà không sửa code.
    minIdleHours: parseFloat(process.env.RETOUCH_MIN_IDLE_HOURS || '0.4'),  // ~24 phút
    maxCount: parseInt(process.env.RETOUCH_MAX_COUNT || '3', 10),
  },
};

// --- Cảnh báo cấu hình thiếu (không crash, chỉ log để dễ sửa) ---
export function checkConfig() {
  const miss = [];
  if (!config.gemini.apiKey) miss.push('GEMINI_API_KEY');
  if (!config.telegram.botToken) miss.push('TELEGRAM_BOT_TOKEN');
  if (!config.telegram.chatId) miss.push('TELEGRAM_CHAT_ID');
  if (Object.keys(config.pancakePages).length === 0) miss.push('PANCAKE_PAGE_1_ID/_TOKEN');
  if (miss.length) {
    console.warn('⚠️  [config] Thiếu biến môi trường:', miss.join(', '));
  } else {
    console.log(
      `✅ [config] OK — ${Object.keys(config.pancakePages).length} trang Pancake, model ${config.gemini.model}`
    );
  }
}
