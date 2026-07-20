// Pancake (pages.fm) client — ĐA TRANG.
// Tra token theo page_id rồi gửi tin. Gửi nhiều ô = gọi nhiều lần, có delay.
//
// ⚠️ XÁC MINH ENDPOINT: Pancake Public API có thể đổi đường dẫn/tham số theo
// thời điểm và theo kênh (FB/TikTok/Zalo). Đường dẫn mặc định dưới đây theo
// Public API pages.fm. Nếu gửi lỗi, đối chiếu tài liệu tại
// https://pages.fm/ (Cài đặt → Công cụ → API) hoặc developers.pancake.vn
// và chỉnh PANCAKE_API_BASE / hàm sendMessage cho khớp.
import axios from 'axios';
// pagesThieuToken: dùng cho tuCuuPageThieuToken() (vá 20/07 vòng 3 — tự cứu page rụng token).
import { config, pagesThieuToken } from './config.js';
import { isOpenApiEnabled, sendText as zaloSendText } from './zalo.js';
import * as store from './store.js';

const API_BASE = process.env.PANCAKE_API_BASE || 'https://pages.fm/api/public_api/v1';
const API_BASE_V1 = process.env.PANCAKE_API_BASE_V1 || 'https://pages.fm/api/v1';

// Trích zalo user_id từ conversation_id Pancake-Zalo dạng "zl_<pageId>_<psid>" → psid = user_id.
// Page token Pancake Zalo hay bị xoay vòng (error 105) → kênh Zalo ưu tiên gửi qua Zalo OpenAPI
// (token tự refresh). Trả null nếu không tách được.
function zaloUserIdFromConv(conversationId) {
  const m = String(conversationId || '').match(/^zl_\d+_(\d+)$/);
  return m ? m[1] : null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- TRẦN BÓNG CỨNG Ở TẦNG GỬI (chống "dội bom") ---
// Căn cứ (audit 09/07/2026 trên 324 hội thoại thật): bot gửi TB 5,2 bóng/lượt, 51% lượt ≥5 bóng
// (người thật chỉ 1,9 bóng). Khách CÒN nhắn tiếp giảm dốc: loạt 1–4 bóng ~70% → loạt 7+ bóng chỉ 15%.
// VÁCH ĐÁ ở bóng thứ 5 → cắt cứng ≤ MAX_BUBBLES ô ở đây là chặn được TẤT CẢ nguồn (dispatch,
// giaoCamNang, chuỗi chạm, care) vì mọi tin bot gửi đều đi qua sendMessages/sendPrivateReply.
// MAX mặc định 4, KHÔNG để thấp hơn 3 kẻo cắt mất ô xin số.
const MAX_BUBBLES = Math.max(3, parseInt(process.env.BOT_MAX_BUBBLES || '4', 10));

// Gộp THÔNG MINH mảng ô về tối đa `max` ô, KHÔNG chặt cụt mất ý:
//  - ≤ max: giữ nguyên.
//  - > max: giữ nguyên các ô ĐẦU (thường là câu trả lời cốt lõi + ô xin số), rồi GỘP phần thừa
//    cuối vào ô cuối cùng được giữ (nối bằng '\n') để không rơi ý.
//  - Ô chứa 'http' (link/clip) cần ĐỨNG RIÊNG (để FB bung preview) → tách các ô link ra, ưu tiên
//    gộp/bỏ các ô CHỮ trùng lặp trước, giữ 1 ô link (nếu còn chỗ, ưu tiên link cuối = mới nhất).
// KHÔNG bao giờ trả mảng rỗng (vào rỗng thì trả rỗng).
function capBubbles(messages, max = MAX_BUBBLES) {
  const arr = (Array.isArray(messages) ? messages : []).filter((m) => m != null && String(m).trim() !== '');
  if (arr.length === 0) return [];
  if (arr.length <= max) return arr;

  // Tách ô link (chứa 'http') ra riêng — link phải đứng 1 ô để bung preview, không gộp chung chữ.
  const links = arr.filter((m) => /https?:\/\//i.test(m));
  const texts = arr.filter((m) => !/https?:\/\//i.test(m));

  // Giữ 1 ô link (mới nhất = cuối) nếu có; phần còn lại của "budget" dành cho ô chữ.
  const keepLink = links.length > 0 ? links[links.length - 1] : null;
  const budgetForText = keepLink ? max - 1 : max;

  let out;
  if (texts.length <= budgetForText) {
    out = texts.slice();
  } else {
    // Giữ các ô chữ ĐẦU, GỘP phần chữ thừa cuối vào ô cuối cùng được giữ (nối bằng '\n').
    const head = texts.slice(0, budgetForText - 1);
    const tail = texts.slice(budgetForText - 1).join('\n');
    out = [...head, tail];
  }
  if (keepLink) out.push(keepLink); // link xuống cuối, đứng riêng để bung preview
  return out;
}

// Delay "giống người thật" TRƯỚC khi gửi ô thứ i (i bắt đầu từ 0).
// Mô phỏng người tư vấn thật: ĐỌC tin khách → NGHĨ (lắng nghe, đồng cảm) → GÕ trên điện thoại.
// Tốc độ gõ ĐT thật ~4–5 ký tự/giây (KHÔNG phải máy bắn tức thì). Tin đầu cũng phải có
// nhịp đọc+nghĩ, KHÔNG gửi ngay — trả lời tức thì là dấu hiệu lộ "bot" rõ nhất.
//
// Có thể tinh chỉnh qua env:
//   TYPE_MS_PER_CHAR (mặc định 180ms/ký tự ≈ 5.5 ký tự/s)
//   THINK_MIN_MS / THINK_RAND_MS (nhịp nghĩ trước khi gõ)
//   FIRST_READ_MS (nhịp đọc tin khách trước khi gõ ô ĐẦU)
//   DELAY_CAP_MS (trần mỗi ô, tránh khách chờ quá lâu)
// Mục tiêu (chốt với anh): 1 câu thường ~45 ký tự hiện ra sau ~4–6s — giống người đọc+gõ.
const TYPE_MS_PER_CHAR = parseInt(process.env.TYPE_MS_PER_CHAR || '70', 10);  // ~14 ký tự/s, gõ nhanh tay
const THINK_MIN_MS = parseInt(process.env.THINK_MIN_MS || '1000', 10);
// Nới THINK_RAND rộng ra (1200 → 2500): biên ngẫu nhiên cũ quá hẹp nên các lượt sau hội tụ 16–20s.
const THINK_RAND_MS = parseInt(process.env.THINK_RAND_MS || '2500', 10);
const FIRST_READ_MS = parseInt(process.env.FIRST_READ_MS || '800', 10);       // nhịp đọc tin khách trước khi gõ ô đầu
// Nâng trần lên 12s để dải delay các ô sau giãn ra (ai muốn giữ 8s cứ set env DELAY_CAP_MS=8000).
const DELAY_CAP_MS = parseInt(process.env.DELAY_CAP_MS || '12000', 10);       // trần 12s/ô (câu rất dài / có jitter)

// DELAY ĐỘNG BIÊN RỘNG — chống "nhịp máy":
// Đo được (audit 09/07/2026): từ lượt khách thứ 3–4, bot trả lời 16–20s ĐỀU TĂM TẮP (median 16–20s,
// IQR chỉ 7–20s) trong khi người thật dao động rộng → đây là "tell" lộ bot. Nghiên cứu Gnewuch et al.
// (ECIS 2018): delay ĐỘNG theo độ phức tạp + có dao động làm tăng cảm nhận "người".
// Cách chữa: GIỮ tin ĐẦU nhanh (<30s, đây là TÀI SẢN — tuyệt đối không làm chậm), còn các ô SAU
// (index>0) nhân thêm hệ số jitter ±30% để phá thế đều đặn.
function humanDelay(text, index) {
  const len = (text || '').length;
  // gõ: tỉ lệ độ dài, tốc độ người thật trên ĐT
  const typing = len * TYPE_MS_PER_CHAR;
  // nghĩ: nhịp "lắng nghe + cân nhắc" trước khi gõ, có ngẫu nhiên cho tự nhiên (biên đã nới rộng)
  const thinking = THINK_MIN_MS + Math.floor(Math.random() * THINK_RAND_MS);
  // ô ĐẦU: thêm nhịp ĐỌC tin khách (người thật đọc xong mới gõ — không bắn ngay)
  const read = index === 0 ? FIRST_READ_MS + Math.floor(Math.random() * 1500) : 0;
  // tin càng về sau nghĩ thêm chút (như đang cân nhắc nói tiếp)
  const lean = index > 0 ? (index - 1) * 500 : 0;
  let total = read + thinking + typing + lean;
  // JITTER ±30% CHỈ cho ô SAU (index>0) — phá thế 16–20s đều tăm tắp. Ô ĐẦU (index===0) GIỮ NGUYÊN
  // để tin đầu vẫn nhanh (<30s), KHÔNG chạm cap — đây là tài sản.
  if (index > 0) total *= (0.7 + Math.random() * 0.6);
  return Math.min(Math.round(total), DELAY_CAP_MS);
}

// Tra cấu hình 1 page theo page_id, KHỚP LINH HOẠT tiền tố kênh.
// Lý do: Pancake gửi webhook page Zalo có thể là "3136..." (không tiền tố) HOẶC "zl_3136..."
// tùy endpoint/sự kiện. Token generate lại theo dạng "zl_...". Ta khớp cả 2 để không rớt tin.
// Chuẩn hoá: bỏ tiền tố kênh (zl_/pzl_/ttm_/fb_) rồi so phần lõi.
export function stripChannelPrefix(id) {
  return String(id || '').replace(/^(zl_|pzl_|ttm_|fb_|tt_)/i, '');
}
function findPageConfig(pageId) {
  const pages = config.pancakePages;
  const key = String(pageId);
  if (pages[key]) return pages[key];                 // khớp khít trước
  const core = stripChannelPrefix(key);              // khớp theo phần lõi (bỏ tiền tố)
  for (const k of Object.keys(pages)) {
    if (stripChannelPrefix(k) === core) return pages[k];
  }
  return null;
}

// Lấy token của 1 trang theo page_id; null nếu trang không được cấu hình.
// Token trang Zalo bị Pancake XOAY VÒNG (error 105) → env trên Render cũ đi mà không ai hay
// (chính ca Minh Trang 06/07: bot mù kênh Zalo cả buổi). Cho phép nạp token MỚI lúc chạy qua
// /admin/set-token → lưu kv 'pancake_token:<pageId>' (sống qua restart), ưu tiên hơn env.
export function getPageToken(pageId) {
  const fromKv = store.getKV(`pancake_token:${canonicalPageId(pageId)}`);
  if (fromKv) return fromKv;
  return findPageConfig(pageId)?.token || null;
}

// USER token Pancake (API v1) — fallback đọc list/messages khi token trang chết.
// Không bị xoay vòng như token trang Zalo. Nạp qua env PANCAKE_API_TOKEN hoặc /admin/set-token.
export function getUserToken() {
  return store.getKV('pancake_user_token') || process.env.PANCAKE_API_TOKEN || null;
}

export function getPageChannel(pageId) {
  return findPageConfig(pageId)?.channel || 'facebook';
}

// Tên hiển thị của trang — cho dòng "📣 Nguồn" báo telesale biết khách đến từ page/OA nào.
// Ưu tiên env PANCAKE_PAGE_{N}_NAME; thiếu thì tra map các trang đã biết; bí quá in id.
const DEFAULT_PAGE_NAMES = {
  '386613267864665': 'Page Phòng Khám Hiệp Lợi',
  '957014354156110': 'Page Dr Nhật Trình',
  '3136814239074246132': 'Zalo OA Hiệp Lợi',
};
export function getPageName(pageId) {
  const cfg = findPageConfig(pageId);
  if (cfg?.name) return cfg.name;
  const core = stripChannelPrefix(pageId);
  if (DEFAULT_PAGE_NAMES[core]) return DEFAULT_PAGE_NAMES[core];
  return getPageChannel(pageId) === 'zalo' ? `Zalo OA (${core})` : `trang ${core}`;
}

// Có biết trang này không (để bỏ qua webhook của trang chưa bật bot).
//
// VÁ 20/07/2026 — GỠ DEADLOCK CỨU HỘ (đo thật bằng stub trước khi sửa):
//   B1  isPageEnabled(957014354156110)          = false   (page thiếu token lúc boot)
//   B2  sau POST /admin/set-token: getPageToken = CÓ TOKEN
//   B2  sau POST /admin/set-token: isPageEnabled = false  ← VẪN CHẾT
// Vì getPageToken() đọc kv 'pancake_token:<id>' còn isPageEnabled() thì KHÔNG. Nên đường cứu hộ
// duy nhất (/admin/set-token — cũng chính là đường mà warnTokenRotated/refreshPageToken khuyên
// dùng) KHÔNG cứu nổi page đã rụng, phải redeploy. Nay công nhận cả token nạp lúc chạy → set-token
// và refreshPageToken() ăn NGAY.
// (canonicalPageId là function declaration nên hoisted — gọi ở đây không dính TDZ.)
export function isPageEnabled(pageId) {
  if (findPageConfig(pageId)) return true;
  return Boolean(store.getKV(`pancake_token:${canonicalPageId(pageId)}`));
}

// Trả về page_id ĐÚNG như đã cấu hình (key trong config) — dùng khi GỬI để khớp token/endpoint.
// Webhook có thể đưa id thiếu tiền tố; khi gửi phải dùng id chuẩn (vd zl_3136...).
export function canonicalPageId(pageId) {
  const pages = config.pancakePages;
  const key = String(pageId);
  if (pages[key]) return key;
  const core = stripChannelPrefix(key);
  for (const k of Object.keys(pages)) {
    if (stripChannelPrefix(k) === core) return k;
  }
  return key;
}

// --- CỜ TẮT BOT THEO NHÃN PANCAKE ---
// Telesale chốt lịch khám / đang xử tay → gắn 1 trong các nhãn này lên hội thoại.
// Bot đọc nhãn TRƯỚC khi gửi; thấy cờ thì IM, không chồng tin tư vấn.
// Tùy biến qua env STOP_BOT_LABELS (phân tách bằng dấu phẩy). So khớp KHÔNG dấu, không phân biệt hoa thường.
//
// ⚠️ CHỈ chứa nhãn "TELESALE ĐANG XỬ / CẦN NGƯỜI / BOT DỪNG HẲN".
// KHÔNG cho nhãn "đã mua / đã thu tiền / checkin" vào đây — vì khách ĐÃ MUA thì bot
// KHÔNG im hẳn, mà CHUYỂN SANG chăm sóc (chạm CSKH). Việc "đã có số → không xin số nữa,
// chỉ chăm" do isCaptured() + STOP_BOT_LABELS_SOFT điều khiển bên dưới, KHÔNG phải tắt bot.
const STOP_BOT_LABELS_RAW = (process.env.STOP_BOT_LABELS ||
  'đã đặt lịch,đã hẹn khám,đã hẹn,telesale xử lý,chốt lịch,đã chốt,không gửi bot,bot dừng'
).split(',').map((s) => normalizeLabel(s)).filter(Boolean);

// --- NHÃN "ĐÃ THÀNH KHÁCH" (đã mua/đã đến khám/đã thu tiền) ---
// Khác STOP ở trên: gặp các nhãn này, bot KHÔNG im hẳn mà coi như khách ĐÃ CÓ SỐ →
// chuyển chế độ CHĂM SÓC (chạm CSKH, KHÔNG chào mới, KHÔNG xin số). Đây là sửa ca anh Cầu
// (đã check-in + bắn bill POS mà bot đi chào "cô" + xin số như lead lạ).
const CUSTOMER_LABELS = (process.env.CUSTOMER_LABELS ||
  'đã đến khám,đã thu tiền,đã thanh toán,checkin,check-in,đã cọc,đã đặt cọc,đã mua,khách cũ,đang điều trị,chờ hàng'
).split(',').map((s) => normalizeLabel(s)).filter(Boolean);

// --- LƯỚI AN TOÀN 20/07: nhãn nằm ở CẢ 2 danh sách thì LOẠI khỏi STOP ---
// Gốc sự cố: .env.example (nguồn hướng dẫn duy nhất để dựng env Render) liệt "đã đến khám" vào
// STOP_BOT_LABELS — TRÁI với code. Env Render copy theo file mẫu → mọi BN đã khám nhắn hỏi đều
// rơi vào hasStopLabel → bot IM + markHumanTaken (chặn cả retouch/chạm về sau) = bỏ rơi khách
// biên cao nhất. File mẫu đã sửa, nhưng env Render là DỮ LIỆU NGOÀI REPO: sửa file không tự chữa
// được giá trị đã dán trên Render. Nên chặn ngay tại code, khỏi phụ thuộc ai đó nhớ sửa env.
// NGUYÊN TẮC VÀNG: thà bot trả lời thừa còn hơn để khách hỏi mà im → CUSTOMER thắng STOP.
const STOP_BOT_LABELS = STOP_BOT_LABELS_RAW.filter((s) => !CUSTOMER_LABELS.includes(s));
{
  const bidat = STOP_BOT_LABELS_RAW.filter((s) => CUSTOMER_LABELS.includes(s));
  if (bidat.length) {
    console.warn(`[pancake] ⚠️ STOP_BOT_LABELS chứa nhãn KHÁCH ĐÃ MUA (${bidat.join(', ')}) → ĐÃ LOẠI khỏi cờ tắt bot ` +
      `(khách đã khám phải được CHĂM, không phải bị IM). Sửa env STOP_BOT_LABELS trên Render cho sạch.`);
  }
}

function normalizeLabel(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036F]/g, "") // bỏ dấu tiếng Việt
    .replace(/đ/gi, 'd')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Cache nhẹ tên nhãn (15s) để 1 loạt tin dồn không gọi API nhiều lần. 1 lần gọi dùng cho cả
// hasStopLabel + hasCustomerLabel (đều cần đọc nhãn của cùng conv).
const labelCache = new Map(); // conversationId -> { names: string[], at }

// Xoá cache nhãn — dùng cho script kiểm chứng (scripts/kiem-duong-gui-pancake.mjs) và cho ca
// vừa nạp token mới muốn đọc lại nhãn ngay. Không ảnh hưởng luồng chạy thật nếu không ai gọi.
export function clearLabelCache() { labelCache.clear(); }

// Đọc DANH SÁCH TÊN NHÃN của 1 hội thoại (có cache 15s). Lỗi → trả [] (fail-open).
// ⚠️ Pancake KHÔNG cho đọc nhãn 1 hội thoại lẻ; nhãn chỉ có ở endpoint LIST conversations
// (field tags[].text) → fetchConversationFromList tìm đúng id trong list.
async function getLabelNames(pageId, conversationId) {
  // VÁ 20/07/2026 (vòng 4): KHÔNG chặn sớm theo token TRANG nữa. Cả 3 page token đang chết
  // (102/105) trong khi USER token vẫn sống → chặn ở đây là tự làm bot mù nhãn vĩnh viễn.
  // Chỉ bỏ cuộc khi KHÔNG còn làn nào có token; còn lại để goiPancake tự chọn/đổi làn.
  if (!getPageToken(pageId) && !getUserToken()) {
    // Trước đây im lặng trả [] → không ai biết bot đang MÙ NHÃN.
    console.warn(`[pancake] ⚠️ conv ${conversationId}: page ${pageId} KHÔNG có token nào (trang lẫn USER) → không đọc được nhãn, coi như KHÔNG có nhãn (bot vẫn trả lời).`);
    return [];
  }
  const cached = labelCache.get(String(conversationId));
  if (cached && Date.now() - cached.at < 15000) return cached.names;
  let names = [];
  // VÁ 20/07/2026 (ca 14 hội thoại chưa đọc, khách hỏi giá tiêm 19:47–20:05 không ai rep):
  // khi token trang chết (105/102), fetchConversationFromList trả null → names = [] → hasStopLabel
  // trả false. Đó là FAIL-OPEN, ĐÚNG nguyên tắc vàng (thà bot trả lời thừa còn hơn để khách im),
  // nên KHÔNG đổi thành fail-closed. NHƯNG cache 15s đang ĐÓNG BĂNG kết quả [] sai đó: token vừa
  // được nạp lại xong thì 15s kế tiếp bot vẫn đọc nhãn rỗng từ cache → chen ngang ca telesale đã
  // chốt. Nay: đọc nhãn HỤT thì KHÔNG cache, lượt sau đọc lại ngay; và kêu to là "đang mù nhãn".
  let muNhan = false;
  try {
    const conv = await fetchConversationFromList(pageId, conversationId);
    if (conv) names = extractLabelNames(conv);
    else muNhan = true; // không thấy conv trong list = hoặc token chết, hoặc conv ngoài cửa sổ quét
  } catch (err) {
    const status = err?.response?.status;
    console.warn(`[pancake] đọc nhãn lỗi (conv ${conversationId}) status=${status || err?.message} → coi như KHÔNG có nhãn`);
    names = [];
    muNhan = true;
  }
  if (muNhan) {
    console.warn(`[pancake] ⚠️ conv ${conversationId} (page ${pageId}): ĐANG MÙ NHÃN — không đọc được danh sách nhãn.`
      + ' Bot VẪN TRẢ LỜI (fail-open, thà thừa còn hơn bỏ rơi khách), nhưng có thể chen ngang ca telesale đã chốt.'
      + ' Không cache kết quả rỗng này → lượt sau đọc lại ngay khi token sống lại.');
    return names;
  }
  labelCache.set(String(conversationId), { names, at: Date.now() });
  return names;
}

// Tên nhãn có khớp 1 trong danh sách từ khóa (đã normalize) không.
function matchAnyLabel(names, keywords) {
  return names.some((n) => {
    const nn = normalizeLabel(n);
    return keywords.some((k) => nn === k || nn.includes(k));
  });
}

/**
 * Hội thoại có nhãn "cờ tắt bot" không? → true thì bot IM (telesale chốt lịch/cần người/bot dừng).
 * Lỗi mạng → false (fail-open, bot vẫn chạy được).
 */
export async function hasStopLabel(pageId, conversationId) {
  if (STOP_BOT_LABELS.length === 0) return false;
  const names = await getLabelNames(pageId, conversationId);
  const stop = matchAnyLabel(names, STOP_BOT_LABELS);
  if (stop) console.log(`[pancake] 🚫 conv ${conversationId} có nhãn cờ-tắt-bot (${names.join(', ')}) → bot IM`);
  return stop;
}

/**
 * Hội thoại có nhãn "ĐÃ THÀNH KHÁCH" (đã mua/đã đến khám/đã thu tiền/đã cọc) không?
 * → true thì bot coi như khách ĐÃ CÓ SỐ: KHÔNG chào mới, KHÔNG xin số, chỉ CHĂM SÓC.
 * (Sửa ca anh Cầu: đã check-in + bắn bill POS mà bot vẫn đi chào + xin số như lead lạ.)
 */
export async function hasCustomerLabel(pageId, conversationId) {
  if (CUSTOMER_LABELS.length === 0) return false;
  const names = await getLabelNames(pageId, conversationId);
  const isCus = matchAnyLabel(names, CUSTOMER_LABELS);
  if (isCus) console.log(`[pancake] 🧡 conv ${conversationId} có nhãn ĐÃ-THÀNH-KHÁCH (${names.join(', ')}) → bot chăm sóc, KHÔNG xin số`);
  return isCus;
}

// Số ngày nhìn lại khi quét list conversations để tìm nhãn (mặc định 14 ngày — đủ phủ lead đang chăm).
const LABEL_LOOKBACK_DAYS = parseInt(process.env.LABEL_LOOKBACK_DAYS || '14', 10);
// Quét tối đa bao nhiêu trang list (mỗi trang ~200 hội thoại) để tìm đúng id, tránh quét vô hạn.
const LABEL_MAX_PAGES = parseInt(process.env.LABEL_MAX_PAGES || '3', 10);

/**
 * Tìm 1 hội thoại theo id trong endpoint LIST (nơi DUY NHẤT trả nhãn `tags`).
 * Trả về object hội thoại (có .tags) hoặc null nếu không thấy trong phạm vi quét.
 *
 * VÁ 20/07/2026 (vòng 4): KHÔNG tự chọn base/token ở đây nữa (trước có 2 bản vá song song, một
 * bản còn dựng riêng hàm duongDoc() — đã gỡ để chỉ còn MỘT cơ chế). Nay gọi listConversations()
 * → goiPancake(): ưu tiên token trang (kv/env), gặp 102/105 thì tự đổi sang USER token v1.
 * Nhờ vậy bot HẾT MÙ NHÃN dù cả 3 page token đang chết (ca 20/07: 29 lần "access_token renewed"
 * trong 1 giờ mà log vẫn in 21 dòng ✅ giả).
 * (goiPancake/listConversations là function declaration → hoisted, gọi ở đây không dính TDZ.)
 */
async function fetchConversationFromList(pageId, conversationId) {
  const until = Math.floor(Date.now() / 1000);
  const since = until - LABEL_LOOKBACK_DAYS * 24 * 3600;
  for (let page = 1; page <= LABEL_MAX_PAGES; page++) {
    // since/until là tham số của làn public_api; làn v1 bỏ qua tham số thừa, không sao.
    const { convs, ok } = await listConversations(pageId, { since, until, page_number: page });
    if (!ok) break; // goiPancake đã log rõ page nào / token loại nào chết
    if (convs.length === 0) break;
    const hit = convs.find((c) => String(c.id || c.conversation_id) === String(conversationId));
    if (hit) return hit;
    if (convs.length < 200) break; // trang cuối, khỏi quét tiếp
  }
  return null; // không thấy trong phạm vi → coi như không có nhãn chặn (fail-open)
}

// Pancake trả nhãn ở field `tags` (mảng object có .text). Gom hết tên nhãn về 1 mảng string.
// Vẫn đọc thêm vài khóa biến thể để chống đổi schema.
function extractLabelNames(conv) {
  if (!conv || typeof conv !== 'object') return [];
  const pools = [
    conv.tags, conv.labels, conv.label_names,
    conv.page_customer?.tags, conv.customer?.tags,
  ];
  const out = [];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const item of pool) {
      if (typeof item === 'string') out.push(item);
      else if (item && typeof item === 'object') out.push(item.text || item.name || item.title || '');
    }
  }
  return out.filter(Boolean);
}

// --- VÁ 20/07/2026 (ca log Render srv-d8v9896gvqtc73bvme80, 11:10→12:35 UTC) ---
// 9× Pancake trả HTTP 200 kèm success=false "access_token renewed please use new access_token"
// (error 105) → tin KHÔNG tới khách, MÀ log vẫn in "✅ đã gửi chạm bot". Gốc: sendMessages nuốt
// boolean của sendOne (hàm async không có câu return → trả undefined), caller handler.js:748 vẫn
// appendHistory + markTouchDone → chạm ĐÓNG DẤU VĨNH VIỄN cho tin chưa rời máy = mất trắng.
// Nay: nhận diện riêng lỗi "token xoay" → tự xin page token mới bằng USER token → gửi lại ĐÚNG 1 lần
// → CHỈ báo thành công khi thật sự tới nơi. Lỗi khác (#551 "Người này hiện không có mặt", 7 ca cùng
// ca log) KHÔNG đi vào đường refresh — thử lại là vô ích và tốn tin.

// Soi body lỗi xem có phải "page token đã bị Pancake xoay vòng" không.
// EXPORT từ 20/07/2026 (vá LỖI 3): rescueLead.js dùng CHUNG hàm này, không viết trùng logic.
export function laLoiTokenXoay(data) {
  if (!data) return false;
  let s;
  try { s = typeof data === 'string' ? data : JSON.stringify(data); } catch { s = String(data); }
  if (/access[_ ]token renewed|renewed please use new/i.test(s)) return true;
  // error 105 của Pancake = token trang hết hiệu lực (chỉ khớp trường error/code, tránh ăn nhầm số 105 trong text).
  if (/"(error|error_code|code)"\s*:\s*"?105"?/i.test(s)) return true;
  // VÁ 20/07/2026 (vòng 2) — LỖ CÒN HỞ CỦA CHÍNH BẢN VÁ SÁNG NAY:
  // Đo thật ở rescueLead.js:61-62 ghi rõ page Zalo OA zl_3136814239074246132 trả error_code 102
  // ("Invalid access_token"), KHÔNG phải 105. Nhánh rescue đã xử đúng (code===105||code===102),
  // nhưng nhánh GỬI (sendOne) chỉ hỏi hàm này → page Zalo OA rơi thẳng xuống `return false`,
  // KHÔNG BAO GIỜ được refresh token. Nghĩa là: FB được cứu, Zalo OA thì không — tin chăm/tư vấn
  // gửi qua Pancake kênh Zalo mất trắng vĩnh viễn mà log chỉ ghi "gửi HỤT" chung chung.
  // 102 và 105 đều là "token trang không dùng được nữa" → cùng một cách chữa: xin token mới.
  if (/"(error|error_code|code)"\s*:\s*"?102"?/i.test(s)) return true;
  if (/invalid access[_ ]token/i.test(s)) return true;
  return false;
}

/**
 * VÁ 20/07/2026 (ca log Render 11:10→12:35 UTC, 15× "[rescue] list qua page-token không trả mảng").
 * Pancake trả HTTP 200 + content-type JSON nhưng body là OBJECT LỖI {success:false, error_code:105|102}.
 * Code cũ chỉ kiểm Array.isArray() nên object lỗi rơi vào else → in dòng mơ hồ, NUỐT MẤT error_code
 * → 15 dòng log mà không ai biết là lỗi token. Hàm này moi error_code ra để log/xử cho đúng lớp lỗi.
 * Trả về số error_code (105 = token trang đã xoay, 102 = token sai/không hợp lệ) hoặc null nếu
 * body KHÔNG phải body lỗi Pancake.
 */
export function pancakeErrorCode(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.success !== false && data.error_code == null) return null;
  const code = parseInt(data.error_code ?? data.error ?? data.code, 10);
  return Number.isFinite(code) ? code : (data.success === false ? -1 : null);
}

// Cờ chống spam Telegram khi báo token xoay: 1 lần / page / 6h.
// (Đúng vết xe đổ memory taibill-cron-429-idempotent: cron 5' × 3 page = 864 tin/ngày → Telegram 429.)
const CANH_BAO_TOKEN_MOI_H = parseFloat(process.env.PANCAKE_TOKEN_ALERT_HOURS || '6');

/**
 * Kêu to khi bắt được token trang chết (105/102) — thay cho dòng log mơ hồ cũ.
 * Log LUÔN (để đọc log Render còn thấy), CÒN Telegram thì chặn theo cờ KV 6h/page.
 * Không throw, không chặn luồng gọi — chỉ là tiếng chuông.
 */
export async function warnTokenRotated(pageId, code, ghiChu = '') {
  const pid = canonicalPageId(pageId);
  // VÁ 20/07/2026 (vòng 3): tách ca "KHÔNG có token" (code=0, do tuCuuPageThieuToken gọi) khỏi ca
  // "có token nhưng token sai". Trước đây in "KHÔNG hợp lệ (error_code 0)" — sai bản chất, đọc log
  // sẽ đi tìm nhầm token hỏng trong khi thật ra env CHƯA HỀ điền token.
  const mo = code === 105
    ? `token trang ${pid} đã bị XOAY VÒNG (error_code 105)`
    : (!code
      ? `page ${pid} CHƯA CÓ TOKEN nào (env thiếu PANCAKE_PAGE_*_TOKEN)`
      : `token trang ${pid} KHÔNG hợp lệ (error_code ${code})`);
  console.error(`[pancake] ⚠️ ${mo} → nạp token mới qua POST /admin/set-token (hoặc sửa PANCAKE_PAGE_*_TOKEN trên Render).${ghiChu ? ' ' + ghiChu : ''}`);
  const k = `pancake_token_alert_at:${pid}`;
  const last = parseInt(store.getKV(k) || '0', 10) || 0;
  if (Date.now() - last < CANH_BAO_TOKEN_MOI_H * 3600 * 1000) return; // đã kêu trong 6h → im
  store.setKV(k, String(Date.now()));
  try {
    // import ĐỘNG: telegram.js đã import pancake.js (vòng tròn) → import tĩnh sẽ gãy.
    const tg = await import('./telegram.js');
    await tg.notifyText(`⚠️ Bot Gemini: ${mo}.\nHệ quả: đọc/gửi tin qua token trang HỤT (rescue mù danh sách hội thoại, tin không tới khách).\nCần: nạp token trang mới qua POST /admin/set-token.`);
  } catch (err) {
    console.warn('[pancake] báo Telegram token xoay hụt:', err?.message || err);
  }
}

// Chốt chặn refresh dồn: 9 ca hụt trong 85' mà mỗi ca gọi refresh là đấm API Pancake.
const REFRESH_MIN_INTERVAL_MS = 60 * 1000;

/**
 * VÁ 20/07/2026: xin PAGE TOKEN MỚI cho 1 trang bằng USER token Pancake (API v1).
 * USER token (env PANCAKE_API_TOKEN hoặc kv pancake_user_token) KHÔNG bị xoay vòng — đã sống sẵn
 * trên Render (pos.js / posingest.js / sevenTouch.js / rescueLead.js đang dùng).
 * Ghi kết quả vào kv 'pancake_token:<pageId>' — đúng khoá mà getPageToken() đọc, nên sống qua
 * restart và ăn ngay cho MỌI chỗ khác (đọc nhãn, rep comment, private reply, đọc tin, rescue).
 * Trả token mới (string) hoặc null nếu không xin được — null thì hệ QUAY VỀ đúng hành vi cũ (fail-safe).
 */
export async function refreshPageToken(pageId) {
  const pid = canonicalPageId(pageId);
  const userToken = getUserToken();
  if (!userToken) {
    console.warn(`[pancake] ⚠️ page ${pid} token đã bị XOAY nhưng KHÔNG có USER token (PANCAKE_API_TOKEN / kv pancake_user_token)`
      + ' → không tự lấy token mới được. Anh Bảo dán tay qua POST /admin/set-token.');
    return null;
  }
  // ⛔ CẦU DAO 20/07/2026 — MẶC ĐỊNH TẮT, anh Trình bật tay khi đã sẵn sàng.
  // generate_page_access_token là lệnh XOAY token: token cũ chết ngay khi có token mới.
  // Ngày 20/07 một agent tự gọi lệnh này đã xoay token production thật (bot may không gãy).
  // Ở đây có tới 5 đường gọi tự động (sendOne, đọc tin, rescue, tuCuuPageThieuToken, cron 5')
  // → nếu schema trả về sai khoá, hoặc user token yếu quyền, bot có thể tự khoá mồm mình
  // giữa giờ vàng mà KHÔNG ai kịp biết. Bật bằng env PANCAKE_AUTO_REFRESH=1 sau khi đã thử tay.
  if (String(process.env.PANCAKE_AUTO_REFRESH || '0') !== '1') {
    console.warn(`[pancake] ⛔ page ${pid} token đã xoay, NHƯNG tự-refresh đang TẮT (PANCAKE_AUTO_REFRESH≠1).`
      + ' → KHÔNG tự gọi generate_page_access_token. Anh Trình dán token tay qua POST /admin/set-token.');
    return null;
  }
  // Chống bão: tối thiểu 60s/lần/page.
  const kRefresh = `pancake_token_refresh_at:${pid}`;
  const last = parseInt(store.getKV(kRefresh) || '0', 10) || 0;
  if (Date.now() - last < REFRESH_MIN_INTERVAL_MS) {
    console.warn(`[pancake] page ${pid} vừa refresh token <60s trước → dùng token đang có, không xin lại (chống bão).`);
    return getPageToken(pid) || null;
  }
  store.setKV(kRefresh, String(Date.now()));
  const url = `${API_BASE_V1}/pages/${pid}/generate_page_access_token`;
  try {
    const res = await axios.post(url, {}, {
      params: { access_token: userToken },
      timeout: 15000,
      validateStatus: () => true,
    });
    const d = res?.data || {};
    // Schema body chưa từng chạy thật ở dự án này → đọc nhiều khoá cho chắc.
    const tokenMoi = d.page_access_token || d?.data?.page_access_token || d.access_token || d?.data?.access_token || null;
    if (!tokenMoi || typeof tokenMoi !== 'string') {
      console.error(`[pancake] ❌ xin page token mới HỤT (page ${pid}) status=${res?.status} body=`,
        JSON.stringify(d).slice(0, 300), '\n   → đối chiếu khoá trả về của generate_page_access_token rồi chỉnh tại refreshPageToken().');
      return null;
    }
    store.setKV(`pancake_token:${pid}`, tokenMoi);
    console.log(`[pancake] 🔑 đã lấy PAGE TOKEN MỚI cho page ${pid} (token xoay vòng) → ghi kv pancake_token:${pid}`);
    return tokenMoi;
  } catch (err) {
    console.error(`[pancake] ❌ lỗi khi xin page token mới (page ${pid}):`, err?.message || err);
    return null;
  }
}

/**
 * VÁ 20/07/2026 (vòng 3) — TỰ CỨU PAGE THIẾU TOKEN + KÊU LẶP LẠI, không chỉ 1 dòng lúc boot.
 *
 * Ca thật 20/07 20:05: 14 hội thoại CHƯA ĐỌC, khách hỏi giá tiêm khớp gối 19:47→20:05
 * (Hiên Thi Vu / Nguyễn Oanh / Rose Rose / Đặng Sáng / Cu Tủn / Xuân Ngọc) mà "Chưa có người xem".
 *
 * Vòng 1 đã chữa: page thiếu token KHÔNG còn bị xoá khỏi config (config.js), và isPageEnabled()
 * công nhận token nạp lúc chạy (pancake.js:174) → /admin/set-token cứu được không cần redeploy.
 * NHƯNG còn hở 2 chỗ, chính là 2 chỗ làm sự cố tối 20/07 TRÔI MẤT cả buổi:
 *   a) pagesThieuToken() viết ra mà KHÔNG AI GỌI → cảnh báo vẫn chỉ có 1 dòng lúc boot rồi im.
 *      Đúng vết xe đổ memory `mo-van-don4-zns-quantam-oa`: hàm viết xong mà chưa ai gọi = chưa vá.
 *   b) KHÔNG có gì tự gọi refreshPageToken() cho page thiếu token → page nằm chết chờ NGƯỜI phát
 *      hiện. Mà USER token (PANCAKE_API_TOKEN) vẫn sống sẵn trên Render → máy tự xin lại được.
 *
 * Hàm này chạy mỗi lượt cron rescue (5' — khớp SLA lead ≤5' của phòng khám):
 *   1) tự xin page token mới bằng USER token → page sống lại KHÔNG cần ai bấm gì;
 *   2) page nào vẫn thiếu thì KÊU ĐỎ ra log + bắn Telegram (đã có cờ chống spam 6h/page trong
 *      warnTokenRotated) → không bao giờ im lặng quá 1 nhịp cron.
 * KHÔNG throw, không chặn luồng gọi — hụt thì hệ giữ nguyên hành vi hiện tại (fail-safe).
 * @returns {Promise<{cuuDuoc: string[], conThieu: string[]}>}
 */
export async function tuCuuPageThieuToken() {
  const cuuDuoc = [];
  const conThieu = [];
  // Page thiếu token trong env NHƯNG đã có token nạp lúc chạy (kv) thì KHÔNG kêu oan.
  const thieu = pagesThieuToken((id) => Boolean(store.getKV(`pancake_token:${canonicalPageId(id)}`)));
  for (const pid of thieu) {
    let tokenMoi = null;
    try {
      tokenMoi = await refreshPageToken(pid); // tự chống bão 60s/page bên trong
    } catch (err) {
      console.error(`[pancake] lỗi khi tự xin token cho page ${pid}:`, err?.message || err);
    }
    if (tokenMoi) {
      cuuDuoc.push(pid);
      console.log(`[pancake] ✅ TỰ CỨU page ${pid}: đã xin được token trang mới bằng USER token → page nhận tin lại NGAY.`);
      continue;
    }
    conThieu.push(pid);
    // Kêu lặp lại mỗi nhịp cron (log), Telegram vẫn bị cờ 6h/page chặn spam.
    await warnTokenRotated(pid, 0,
      '(page THIẾU TOKEN trong env — mọi tin của page này KHÔNG ai trả lời được.'
      + ` Nạp ngay: POST /admin/set-token?page=${pid}, hoặc điền PANCAKE_PAGE_*_TOKEN trên Render.)`);
  }
  return { cuuDuoc, conThieu };
}

// ============================================================================
// VÁ 20/07/2026 (vòng 4) — MỘT CƠ CHẾ CHỌN TOKEN DUY NHẤT CHO CẢ GỬI / ĐỌC / LIST
// ============================================================================
// CA LỖI THẬT (log Render srv-d8v9896gvqtc73bvme80, 13:36→14:51 UTC — ĐÚNG 1 GIỜ):
//   29× "[pancake] gửi HỤT ... {"message":"access_token renewed please use new access_token"}"
//   21× dòng "✅ đã gửi chạm bot" / "[dispatch] ..."  ← BÁO THÀNH CÔNG GIẢ
// Nghĩa là: tiền ads đổ inbox về, khách hỏi giá tiêm, bot "trả lời" vào KHOẢNG KHÔNG.
//
// ĐO THẬT (24 phép thử GET chỉ-đọc, 3 page × 2 base × 4 kiểu token) — CHỈ 1/24 tổ hợp SỐNG:
//   public_api + page_access_token  → 105 "access_token renewed" (FB) / 102 "Invalid" (Zalo OA)
//   v1         + page_access_token  → 102
//   public_api + access_token=USER  → 102
//   v1         + access_token=USER  → 200, trả MẢNG hội thoại THẬT cho CẢ 3 page ✅
// Cả 3 PAGE TOKEN trên Render đều CHẾT. USER token (env PANCAKE_API_TOKEN) thì SỐNG.
// Đối chiếu sha256: token USER trên Render TRÙNG KHÍT token mà MCP pancake-hieploi
// (/Users/mac/.claude/mcp-servers/hieploi/pancake/index.js) ĐANG gửi tin được ở production —
// cùng base v1, cùng tên tham số access_token, cùng body {message, action:'reply_inbox'}.
//
// ⚠️ POST generate_page_access_token ĐÃ THỬ: có sinh token, nhưng token sinh ra ĐỌC CŨNG KHÔNG ĐƯỢC
// (vẫn 102) → KHÔNG PHẢI lời giải. Cầu dao PANCAKE_AUTO_REFRESH giữ nguyên TẮT, đừng gỡ.
//
// HAI LÀN ĐƯỜNG (thứ tự ưu tiên đúng yêu cầu anh Trình):
//   Làn 1 "page" : public_api + page_access_token = token kv 'pancake_token:<pageId>' (anh dán tay)
//                  hoặc env PANCAKE_PAGE_*_TOKEN.  ← ưu tiên TRƯỚC vì anh dán tay là token mới nhất
//   Làn 2 "user" : v1 + access_token = USER token (PANCAKE_API_TOKEN / kv pancake_user_token)
// Gặp 102/105 ở làn này thì TỰ ĐỘNG THỬ LÀN CÒN LẠI trước khi bỏ cuộc — và log rõ page nào,
// token LOẠI NÀO chết. Làn nào thắng thì ghi nhớ 10' (kv) để lượt sau đi thẳng, khỏi tốn 1 nhịp hụt.
// KHÔNG hàm nào dưới đây được tự viết lại logic chọn token — tất cả đi qua goiPancake().

// Nhớ làn thắng trong 10' để khỏi mỗi lượt đều đâm vào làn chết trước.
const LAN_NHO_MS = parseInt(process.env.PANCAKE_LANE_MEMORY_MS || '600000', 10);

function kLan(pid) { return `pancake_lan_tot:${pid}`; }

function docLanTot(pid) {
  try {
    const raw = store.getKV(kLan(pid));
    if (!raw) return null;
    const [lan, at] = String(raw).split('|');
    if (!lan || Date.now() - (parseInt(at, 10) || 0) > LAN_NHO_MS) return null;
    return lan === 'user' || lan === 'page' ? lan : null;
  } catch { return null; }
}

function ghiLanTot(pid, lan) {
  try { store.setKV(kLan(pid), `${lan}|${Date.now()}`); } catch { /* kho hỏng thì thôi, không chặn gửi */ }
}

// Mô tả 1 làn: base URL + tên tham số token + token thật. Trả null nếu làn đó không có token.
function dungLan(lan, pid) {
  if (lan === 'page') {
    const token = getPageToken(pid);
    if (!token) return null;
    return { lan, base: API_BASE, tenThamSo: 'page_access_token', token, moTa: 'public_api + TOKEN TRANG' };
  }
  const token = getUserToken();
  if (!token) return null;
  return { lan: 'user', base: API_BASE_V1, tenThamSo: 'access_token', token, moTa: 'v1 + USER token' };
}

// Body trả về có phải "token làn này chết" không (102 Invalid / 105 renewed)?
function laTokenChet(data) {
  const code = pancakeErrorCode(data);
  if (code === 102 || code === 105) return true;
  return laLoiTokenXoay(data);
}

/**
 * GỌI PANCAKE QUA 2 LÀN, TỰ ĐỔI LÀN KHI GẶP 102/105.
 * Đây là ĐIỂM NGHẼN DUY NHẤT quyết định "đi base nào, kèm token loại nào" —
 * gửi tin, đọc tin, list hội thoại đều dùng chung, không viết trùng 3 kiểu.
 *
 * @param {object} o
 * @param {'get'|'post'} o.method
 * @param {string} o.pageId
 * @param {string} o.duongDan  đường dẫn SAU /pages/{pageId}, ví dụ `/conversations/${cid}/messages`
 * @param {object} [o.body]    body JSON cho POST (giữ nguyên, KHÔNG đụng — {message, action} đã đúng)
 * @param {object} [o.params]  query param phụ (since/until/page_number/customer_id...)
 * @param {number} [o.timeout]
 * @param {string} [o.viec]    tên việc để log ("gửi tin", "đọc nhãn", "đọc tin", "list hội thoại")
 * @returns {Promise<{ok: boolean, data: any, status: number|null, lan: string|null, loiToken: boolean}>}
 *   ok=true CHỈ khi Pancake nhận thật (không success=false, không lỗi mạng).
 */
export async function goiPancake({ method, pageId, duongDan, body = null, params = {}, timeout = 15000, viec = 'gọi API' }) {
  const pid = canonicalPageId(pageId);
  // Thứ tự: kv/env page token TRƯỚC (anh Trình dán tay = mới nhất), rồi USER token.
  // Nhưng nếu 10' qua đã biết làn nào sống thì đi thẳng làn đó trước (đỡ 1 nhịp hụt mỗi tin).
  let thuTu = ['page', 'user'];
  const nho = docLanTot(pid);
  if (nho === 'user') thuTu = ['user', 'page'];

  let cuoiCung = { ok: false, data: null, status: null, lan: null, loiToken: false };
  const daThuLan = [];
  for (const ten of thuTu) {
    const lan = dungLan(ten, pid);
    if (!lan) continue;
    daThuLan.push(lan.lan);
    const url = `${lan.base}/pages/${pid}${duongDan}`;
    const cauHinh = {
      params: { ...params, [lan.tenThamSo]: lan.token },
      timeout,
      validateStatus: () => true, // Pancake trả HTTP 200 KÈM success=false → phải tự soi body
    };
    let res;
    try {
      res = method === 'post' ? await axios.post(url, body || {}, cauHinh) : await axios.get(url, cauHinh);
    } catch (err) {
      const data = err?.response?.data;
      const status = err?.response?.status || null;
      cuoiCung = { ok: false, data, status, lan: lan.lan, loiToken: laTokenChet(data) };
      if (cuoiCung.loiToken) {
        console.warn(`[pancake] ${viec}: page ${pid} làn ${lan.moTa} TOKEN CHẾT (status=${status}) → thử làn còn lại.`);
        continue;
      }
      console.error(`[pancake] ${viec}: page ${pid} làn ${lan.moTa} lỗi mạng/HTTP status=${status}:`, err?.message || err);
      continue; // lỗi mạng cũng thử làn kia — thà thừa 1 lần gọi còn hơn để khách chờ
    }
    const data = res?.data;
    const status = res?.status ?? null;
    const thatBai = data && data.success === false;
    if (!thatBai) {
      if (lan.lan !== nho) ghiLanTot(pid, lan.lan);
      return { ok: true, data, status, lan: lan.lan, loiToken: false };
    }
    const loiToken = laTokenChet(data);
    cuoiCung = { ok: false, data, status, lan: lan.lan, loiToken };
    if (loiToken) {
      const code = pancakeErrorCode(data);
      console.warn(`[pancake] ${viec}: page ${pid} — ${lan.moTa} CHẾT (error_code ${code}: `
        + `${code === 105 ? 'token trang đã bị xoay vòng' : 'token không hợp lệ'}) → thử làn còn lại.`);
      continue;
    }
    // Lỗi KHÔNG phải token (vd #551 "Người này hiện không có mặt") → đổi làn cũng vô ích, dừng luôn.
    console.error(`[pancake] ${viec} HỤT (page ${pid}, làn ${lan.moTa}):`, JSON.stringify(data).slice(0, 300));
    return cuoiCung;
  }

  if (!daThuLan.length) {
    console.error(`[pancake] ❌ ${viec}: page ${pid} KHÔNG có token nào (thiếu cả kv 'pancake_token:${pid}'/env PANCAKE_PAGE_*_TOKEN`
      + ' lẫn USER token PANCAKE_API_TOKEN) → không làm gì được.');
    return cuoiCung;
  }
  if (cuoiCung.loiToken) {
    console.error(`[pancake] 🔴 ${viec}: page ${pid} CHẾT CẢ ${daThuLan.length} LÀN (${daThuLan.join(' + ')}) — token trang lẫn USER token đều bị từ chối.`
      + " Nạp token mới: POST /admin/set-token (page token) hoặc sửa PANCAKE_API_TOKEN trên Render (user token).");
    await warnTokenRotated(pid, pancakeErrorCode(cuoiCung.data) || 102, `(khi ${viec} — hụt cả 2 làn)`);
  }
  return cuoiCung;
}

/**
 * Gửi 1 tin tới 1 hội thoại Pancake.
 * Endpoint mặc định: POST {API_BASE}/pages/{pageId}/conversations/{conversationId}/messages
 * Tham số có thể cần điều chỉnh theo docs (xem cảnh báo đầu file).
 * @returns {Promise<boolean>} true CHỈ khi Pancake/Zalo nhận tin thật.
 */
async function sendOne(pageId, conversationId, text) {
  // KÊNH ZALO: ưu tiên gửi qua Zalo OpenAPI (token tự refresh) thay vì page token Pancake
  // (page token Pancake Zalo bị xoay vòng → error 105 "access_token renewed"). Cần OpenAPI bật + tách được user_id.
  if (getPageChannel(pageId) === 'zalo' && isOpenApiEnabled()) {
    const uid = zaloUserIdFromConv(conversationId);
    if (uid) {
      const ok = await zaloSendText(uid, text);
      if (ok) return true;
      console.warn(`[pancake→zalo] gửi OpenAPI hụt (uid ${uid}) → thử lại qua Pancake`);
    }
  }
  // ĐỔI ĐƯỜNG GỬI 20/07/2026 (vòng 4) — ca thật: log Render 1 GIỜ (13:36→14:51 UTC) có
  //   29× "gửi HỤT ... access_token renewed please use new access_token"
  //   21× dòng "✅ đã gửi chạm bot" ← BÁO THÀNH CÔNG GIẢ, khách KHÔNG nhận được gì.
  // Nay KHÔNG tự chọn base/token tại chỗ nữa: đẩy hết cho goiPancake() — 1 cơ chế duy nhất,
  // ưu tiên token kv/env của trang (anh Trình dán tay) rồi TỰ ĐỔI SANG USER token v1 khi gặp
  // 102/105. Body giữ NGUYÊN {message, action:'reply_inbox'} — đã đúng, trùng khít MCP đang chạy.
  const kq = await goiPancake({
    method: 'post',
    pageId,
    duongDan: `/conversations/${conversationId}/messages`,
    body: { message: text, action: 'reply_inbox' },
    viec: `gửi tin (conv ${conversationId})`,
  });
  if (!kq.ok) {
    console.error(`[pancake] ❌ tin KHÔNG tới khách (page ${canonicalPageId(pageId)}, conv ${conversationId}).`
      + ' TUYỆT ĐỐI không tính là đã gửi — caller phải chạm lại.');
    return false;
  }
  return true;
}

/**
 * Gửi nhiều ô thoại lần lượt, có delay giữa các ô (giống người gõ).
 * @param {string} pageId
 * @param {string} conversationId
 * @param {string[]} messages - mảng các ô (đã giới hạn 4 ô ở gemini.js)
 * @returns {Promise<boolean>} VÁ 20/07/2026 — HỢP ĐỒNG MỚI: true khi có ít nhất 1 ô tới nơi THẬT,
 *   false khi không ô nào đi được. Trước đây hàm không có câu return (trả undefined) → caller
 *   handler.js:748 tưởng gửi xong, vẫn markTouchDone/appendHistory → 9 chạm mất trắng ngày 20/07.
 *   AI THÊM CALLER MỚI: phải kiểm giá trị trả về trước khi ghi lịch sử / cắm cờ đã-gửi / trừ quota.
 */
export async function sendMessages(pageId, conversationId, messages) {
  // TRẦN BÓNG CỨNG: gộp/cắt xuống ≤ MAX_BUBBLES ở tầng gửi (điểm nghẽn duy nhất) — chống dội bom.
  messages = capBubbles(messages);
  let sentOk = 0;
  for (let i = 0; i < messages.length; i++) {
    // Chờ "đọc + nghĩ + gõ" TRƯỚC khi gửi ô này (tin đầu = 0, gửi ngay).
    await sleep(humanDelay(messages[i], i));
    const ok = await sendOne(pageId, conversationId, messages[i]);
    if (!ok) break; // gửi lỗi thì dừng, tránh spam nửa vời
    sentOk++;
  }
  if (sentOk < messages.length) {
    console.error(`[pancake] ❌ conv ${conversationId} chỉ gửi được ${sentOk}/${messages.length} ô → KHÔNG coi là gửi xong.`);
  }
  // Ngưỡng "> 0": gửi được ≥1 ô là coi như chạm đã tới khách (bộ lọc chống-lặp-nguyên-văn ở
  // handler.js che ca gửi lại 2 ô đầu). sentOk = 0 = mất trắng → caller phải chạm lại.
  return sentOk > 0;
}

// Bỏ thẻ HTML cơ bản (tin Pancake bọc <div>).
function stripHtmlBasic(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

/**
 * REP CÔNG KHAI dưới 1 comment (để lại 1 câu mời ngắn).
 * Pancake Public API: POST {API_BASE}/pages/{pageId}/conversations/{conversationId}/messages
 * với action 'reply_comment' (trả lời ngay dưới comment đó).
 * ⚠️ Một số kênh/biến thể dùng đường dẫn /comments riêng — nếu lỗi, đối chiếu docs &
 * chỉnh tại đây (log dưới sẽ in nguyên body lỗi để biết phải sửa gì).
 */
export async function replyComment(pageId, conversationId, commentId, text) {
  // VÁ 20/07/2026 (vòng 4): dùng CHUNG goiPancake() — cùng ca lỗi với sendOne (29 lần "access_token
  // renewed" trong 1 giờ 13:36→14:51 UTC). Comment quảng cáo là CỬA LEAD ADS: token trang chết thì
  // rep comment cũng câm y hệt gửi tin, mà log cũ chỉ in "hụt" chung chung.
  // ⚠️ CHƯA KIỂM CHỨNG: action 'reply_comment' trên làn v1+USER token chưa có bằng chứng chạy
  // (MCP pancake không có tool comment). Vì goiPancake vẫn giữ làn page token, hụt nhất là bằng
  // hành vi hôm nay — không xấu đi. Soi log lượt đầu sau deploy.
  const kq = await goiPancake({
    method: 'post',
    pageId,
    duongDan: `/conversations/${conversationId}/messages`,
    body: { message: text, action: 'reply_comment', comment_id: commentId },
    viec: `rep comment (conv ${conversationId}, comment ${commentId})`,
  });
  return kq.ok;
}

/**
 * NHẮN RIÊNG (private reply) cho người vừa comment → kéo họ vào inbox.
 * Facebook/Pancake: private reply phải tham chiếu comment_id (chỉ được gửi 1 lần/comment,
 * trong vòng 7 ngày kể từ comment). Dùng action 'private_reply'.
 * Trả về true nếu Pancake nhận; false (kèm log) nếu hụt — để handler vẫn báo Telegram đỡ.
 */
export async function sendPrivateReply(pageId, conversationId, commentId, messages) {
  // VÁ 20/07/2026 (vòng 4): cùng cơ chế chọn token với sendOne/replyComment (goiPancake).
  // Private reply = đường KÉO người comment vào inbox — chính cửa tiền ads. Trước đây chỉ đi
  // public_api + page token → chết y hệt 29 ca "access_token renewed" trong 1 giờ.
  // TRẦN BÓNG CỨNG: chống dội bom ngay cả với private reply (xem capBubbles).
  messages = capBubbles(messages);
  let okAny = false;
  for (let i = 0; i < messages.length; i++) {
    await sleep(humanDelay(messages[i], i));
    const kq = await goiPancake({
      method: 'post',
      pageId,
      duongDan: `/conversations/${conversationId}/messages`,
      body: { message: messages[i], action: 'private_reply', comment_id: commentId },
      viec: `private reply (comment ${commentId})`,
    });
    if (!kq.ok) break; // ô đầu hụt → dừng, đừng spam nửa vời
    okAny = true;
  }
  return okAny;
}

/**
 * Đọc TIN CUỐI CÙNG CỦA KHÁCH trong 1 hội thoại (để "poke" bot xử lại thủ công).
 * Dùng cho endpoint /admin/poke — ép bot trả lời ca đã bị bỏ lửng mà khách chưa nhắn mới.
 * Trả về { messageText, customerName } hoặc null nếu không đọc được / tin cuối là của page.
 */
export async function getLastCustomerMessage(pageId, conversationId, customerId = null) {
  // VÁ 20/07/2026 (vòng 4): đọc tin cũng đi qua goiPancake() — CÙNG cơ chế chọn token với gửi tin.
  // v1 BẮT BUỘC customer_id (public_api thì không) → có id nào thì kèm id đó, làn public_api bỏ qua
  // tham số thừa. Thiếu customer_id thì tra từ list hội thoại (cũng qua goiPancake).
  const pid = canonicalPageId(pageId);
  let cid = customerId;
  if (!cid) {
    for (let page = 1; page <= 2 && !cid; page++) {
      const conv = await timConvTrongList(pid, conversationId, { page_number: page });
      if (conv) cid = conv.customers?.[0]?.id || conv.customer_id || null;
      else break;
    }
  }
  const kq = await goiPancake({
    method: 'get',
    pageId: pid,
    duongDan: `/conversations/${conversationId}/messages`,
    params: cid ? { customer_id: cid } : {},
    timeout: 20000,
    viec: `đọc tin (conv ${conversationId})`,
  });
  const msgs = kq.ok ? kq.data?.messages : null;
  if (!Array.isArray(msgs) || msgs.length === 0) {
    if (kq.ok) console.warn(`[pancake] đọc tin conv ${conversationId} (page ${pid}) trả RỖNG`
      + `${cid ? '' : ' — KHÔNG có customer_id, làn v1 luôn rỗng nếu thiếu tham số này'}.`);
    return null;
  }
  return pickLastCustomerMsg(msgs, pageId);
}

/**
 * VÁ 20/07/2026 (vòng 4) — LIST HỘI THOẠI DÙNG CHUNG (đọc nhãn + rescue đều gọi cái này).
 * Trả về MẢNG hội thoại (rỗng nếu không đọc được). Đi qua goiPancake → tự đổi làn khi 102/105,
 * nên rescueLead.js KHÔNG cần tự dựng lại 2 nhánh public_api/v1 nữa.
 * @param {string} pageId
 * @param {object} [params] since/until/page_number/type...
 * @returns {Promise<{convs: any[], lan: string|null, ok: boolean}>}
 */
export async function listConversations(pageId, params = {}) {
  const kq = await goiPancake({
    method: 'get',
    pageId,
    duongDan: '/conversations',
    params,
    timeout: 20000,
    viec: 'list hội thoại',
  });
  const list = kq.ok ? (kq.data?.conversations || kq.data?.data) : null;
  if (!Array.isArray(list)) return { convs: [], lan: kq.lan, ok: false };
  return { convs: list, lan: kq.lan, ok: true };
}

// Tìm 1 hội thoại theo id trong list (dùng lại listConversations — không tự gọi axios).
async function timConvTrongList(pageId, conversationId, params = {}) {
  const { convs } = await listConversations(pageId, params);
  return convs.find((c) => String(c.id || c.conversation_id) === String(conversationId)) || null;
}

// messages xếp CŨ→MỚI; tìm tin gần nhất KHÔNG phải do page gửi.
// So theo phần lõi (bỏ tiền tố zl_/ttm_...): Zalo lúc trả "zl_3136..." lúc "3136..." tùy endpoint —
// so khít sẽ tưởng tin của chính OA là tin khách → bot tự trả lời chính mình.
function pickLastCustomerMsg(msgs, pageId) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    const from = m.from || {};
    const isPage = stripChannelPrefix(from.id) === stripChannelPrefix(pageId);
    if (isPage) continue;
    const text = stripHtmlBasic(m.message || m.original_message || '');
    if (!text) continue;
    return { messageText: text, customerName: from.name || null };
  }
  return null; // tin cuối là của page → khách chưa hỏi gì mới, không poke
}
