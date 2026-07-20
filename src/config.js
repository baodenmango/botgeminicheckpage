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
//
// VÁ 20/07/2026 (ca thật: ảnh Pancake 20:05, 14 hội thoại CHƯA ĐỌC, khách hỏi giá tiêm từ
// 19:47→20:05 — Hiên Thi Vu / Nguyễn Oanh / Rose Rose / Đặng Sáng / Cu Tủn / Xuân Ngọc — không
// ai rep, giao diện ghi "Chưa có người xem"):
//
// Code CŨ thấy page THIẾU TOKEN thì `continue` = XOÁ HẲN page khỏi config.pancakePages. Hậu quả
// đo được bằng stub, không phải suy đoán:
//   1) isPageEnabled(page) = false ở MỌI cửa → index.js webhook, handler.handleIncoming,
//      handlePageMessage, handleBotTouch, comment.js, care-send.js → 100% tin của page bị vứt.
//   2) rescueLead.js:166 + sevenTouch.js:109 lặp qua Object.keys(config.pancakePages) → page rụng
//      KHÔNG có trong vòng lặp → LƯỚI CỨU HỘ CUỐI CÙNG cũng mù, khách chết kẹt vĩnh viễn.
//   3) HỐ ĐEN KHÔNG TỰ THOÁT: POST /admin/set-token ghi kv 'pancake_token:<id>' và getPageToken()
//      đọc được token đó, NHƯNG isPageEnabled() không ngó KV → nạp token xong log báo
//      "🔑 đã nạp token trang mới" mà page VẪN CÂM. Chỉ redeploy mới sống lại.
//   4) getPageChannel() rơi default 'facebook' → page Zalo (nếu lọt đường gửi nào) đi sai kênh.
// Warn cũ in đúng 1 dòng lúc boot rồi im vĩnh viễn → trôi mất, đúng như đã xảy ra.
//
// NAY: NẠP page kể cả thiếu token, đánh cờ `tokenMissing` thay vì xoá. Page vào config →
// getPageChannel đúng kênh, rescue/7chạm nhìn thấy nó, /admin/set-token + refreshPageToken()
// cứu được NGAY không cần redeploy. Rủi ro: page thiếu token sẽ đi tiếp vào sendOne và gửi HỤT —
// nhưng bản vá sendMessages (20/07) đã trả false đúng nên caller không ghi lịch sử / markTouchDone
// sai. Tức là đổi "vứt tin IM LẶNG" thành "thử, trượt, CÓ LOG + CÓ CHUÔNG" — đúng nguyên tắc vàng
// của dự án: thà thừa còn hơn để khách hỏi mà không ai biết.
function loadPancakePages() {
  const pages = {}; // page_id -> { token, channel, name, tokenMissing }
  for (let n = 1; ; n++) {
    const id = process.env[`PANCAKE_PAGE_${n}_ID`];
    if (!id) break; // hết trang
    const token = process.env[`PANCAKE_PAGE_${n}_TOKEN`] || null;
    const channel = process.env[`PANCAKE_PAGE_${n}_CHANNEL`] || 'facebook';
    const name = process.env[`PANCAKE_PAGE_${n}_NAME`] || null; // tên hiển thị cho dòng "Nguồn" báo telesale
    if (!token) {
      console.error(`⚠️  [config] PANCAKE_PAGE_${n}_ID=${id} THIẾU TOKEN → VẪN NẠP page (cờ tokenMissing) `
        + 'để rescue/7chạm còn thấy + /admin/set-token cứu được không cần redeploy. '
        + `Cần: điền PANCAKE_PAGE_${n}_TOKEN trên Render hoặc POST /admin/set-token?page=${id}.`);
    }
    pages[String(id)] = { token, channel, name, tokenMissing: !token };
  }
  return pages;
}

// Danh sách page đang THIẾU TOKEN trong env — để checkConfig() và cron rescue kêu lặp lại,
// thay vì 1 dòng warn lúc boot rồi im (chính chỗ làm sự cố 20/07 trôi mất cả buổi tối).
// LƯU Ý: page đã được nạp token lúc chạy qua /admin/set-token thì KHÔNG còn thiếu nữa — hàm
// nhận `coTokenRuntime` để loại các page đã cứu, tránh kêu oan.
export function pagesThieuToken(coTokenRuntime = () => false) {
  return Object.entries(config.pancakePages)
    .filter(([id, p]) => p.tokenMissing && !coTokenRuntime(id))
    .map(([id]) => id);
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
  // VÁ 20/07/2026: rụng 1/3 page mà vẫn in "✅ OK — 2 trang" là kiểu báo cáo giết khách.
  // Phải LIỆT KÊ page thiếu token thành dòng ĐỎ riêng, kể cả khi phần còn lại đủ.
  const thieu = Object.entries(config.pancakePages).filter(([, p]) => p.tokenMissing).map(([id]) => id);
  if (thieu.length) {
    console.error(`🔴 [config] ${thieu.length} trang Pancake THIẾU TOKEN trong env: ${thieu.join(', ')} — `
      + 'page vẫn được nạp (không bị xoá khỏi hệ) nhưng GỬI SẼ HỤT tới khi có token. '
      + 'Nạp ngay: POST /admin/set-token?page=<id> (ăn liền, không cần redeploy).');
  }
}
