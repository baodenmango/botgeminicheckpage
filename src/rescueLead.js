// ============================================================
//  ENGINE VỚT LEAD BỎ RƠI — vá lỗ webhook rớt (bot chết tạm lúc deploy / Pancake không gửi lại).
//  Triệu chứng: KHÁCH nhắn cuối nhưng bot/telesale CHƯA rep (tin cuối là của khách) → lead nguội.
//  Cách vá: quét Pancake định kỳ, tìm ca "khách nhắn cuối + chưa ai rep + đã quá X phút"
//  → đọc tin cuối của khách → đẩy vào handleIncoming như webhook THẬT (tái dùng toàn bộ logic bot:
//  lock chống trùng, human-taken, stop-label, chốt số, booking...).
//
//  GUARD chống trùng với webhook: chỉ vớt ca khách nhắn cuối ĐÃ LÂU hơn RESCUE_MIN_IDLE_MIN phút
//  (webhook thường về trong vài giây; quá ngưỡng mà chưa rep = webhook đã rớt). Ngoài cửa sổ
//  RESCUE_WINDOW_HOURS thì thôi (lead quá cũ, để engine 7 chạm/retouch lo).
// ============================================================
import { config } from './config.js';
import {
  isPageEnabled, getLastCustomerMessage, stripChannelPrefix,
  canonicalPageId, listConversations, tuCuuPageThieuToken,
} from './pancake.js';
import { handleIncoming } from './handler.js';
import * as store from './store.js';
// VÁ 20/07/2026 (vòng 4): file này KHÔNG còn tự gọi axios / tự ghép base URL + token nữa.
// Mọi việc đọc list hội thoại đi qua listConversations() của pancake.js (xem goiPancake) —
// một cơ chế chọn token duy nhất cho cả GỬI TIN, ĐỌC TIN và LIST HỘI THOẠI.
const MIN_IDLE_MIN = parseFloat(process.env.RESCUE_MIN_IDLE_MIN || '3');   // khách nhắn cuối phải cũ hơn (phút)
const WINDOW_HOURS = parseFloat(process.env.RESCUE_WINDOW_HOURS || '72');  // chỉ vớt lead trong 72h
const MAX_PER_RUN = parseInt(process.env.RESCUE_MAX_PER_RUN || '10', 10);  // cap mỗi lượt (an toàn)
// Quá ngưỡng này mà KHÔNG AI rep (kể cả telesale) → coi cờ human là KẸT OAN, gỡ cờ + vớt luôn.
// (SLA telesale ≤5'; im lặng quá ngưỡng = không ai xử thật. Ca Sen Vàng 02/07: tin auto Meta đánh cờ
// human oan → bot câm + rescue né suốt 30'. Nhãn "đã đặt lịch/telesale xử" vẫn chặn ở handleIncoming.)
// VÁ 20/07 — HẠ 20' → 5' (ca 13 hội thoại cờ human oan, log Render 11:10–12:35 UTC): cờ bị đánh oan
// bởi echo tin chăm (Pancake ghi "Chưa có người xem" = KHÔNG có người nào cả), 20' chỉ là 20' bỏ rơi
// khách — đo thật có ca chờ 23 PHÚT. Cron rescue chạy mỗi 5' + MIN_IDLE_MIN=3 nên thực tế gỡ ở ~5–8',
// khớp SLA gọi lead ≤5'. Không cần đụng cron. Muốn nới lại: đặt env RESCUE_HUMAN_OVERRIDE_MIN=8.
const HUMAN_OVERRIDE_MIN = parseFloat(process.env.RESCUE_HUMAN_OVERRIDE_MIN || '5');

// CHỐNG VỚT LẶP VÔ HẠN: khách chặn page / khoá nick / hết cửa sổ 24h Meta → gửi HỤT (#551),
// Pancake vẫn thấy "khách nhắn cuối" → không có guard là cron 5' thử lại mãi (đốt Gemini + spam log).
// Mỗi (conv + mốc tin khách) chỉ thử 1 lần; lỗi tạm thời thì được thử lại sau RETRY_HOURS.
// VÁ 20/07/2026 (ca 14 hội thoại CHƯA ĐỌC, ảnh Pancake 20:05 — khách hỏi giá tiêm 19:47–20:05
// không ai rep: Hiên Thi Vu, Nguyễn Oanh, Rose Rose, Đặng Sáng, Cu Tủn, Xuân Ngọc):
// HẠ 6h → 0.25h (15'). Lý do đo thật: khi Gemini 429/503 (đúng khung cao điểm 19:54–20:05), lượt
// vớt CHỈ trả được câu treo suy giảm — khách chưa hề được trả lời câu nào — mà `attempted.set()`
// vẫn ghi mark → ca bị KHOÁ 6 GIỜ. 6h im lặng cho một người vừa hỏi "tiêm bao nhiêu tiền một mũi"
// là mất lead đã trả tiền quảng cáo. Quota Gemini theo phút hồi rất nhanh → 15' là đủ để né
// vòng lặp đốt Gemini mà vẫn khớp tinh thần SLA lead ≤5'.
const RETRY_HOURS = parseFloat(process.env.RESCUE_RETRY_HOURS || '0.25');
const attempted = new Map(); // convId -> { mark: mốc tin khách đã thử, at: lúc thử }

/**
 * XOÁ dấu "đã thử vớt" của 1 hội thoại → vòng cron kế tiếp (5') được vớt lại NGAY.
 * VÁ 20/07/2026: handler.dispatch gọi hàm này khi lượt vừa rồi CHỈ gửi được câu treo suy giảm
 * (reply.degraded = Gemini chết). Nguyên tắc: chưa trả lời được khách thì KHÔNG được coi là
 * "đã thử xong" rồi khoá cửa. Thà vớt lại sớm còn hơn bỏ rơi người đang hỏi giá.
 * (Import động ở handler để không tạo vòng import rescueLead ⇄ handler.)
 */
export function clearRescueAttempt(convId) {
  if (!convId) return false;
  const co = attempted.delete(String(convId));
  if (co) console.log(`[rescue] ♻️ ${convId} lượt vừa rồi chỉ ra CÂU TREO (Gemini chết) → xoá dấu đã-thử, cron sau vớt lại ngay`);
  return co;
}

// phút kể từ mốc thời gian (chuỗi Pancake UTC không hậu tố Z → ép UTC).
function minutesSince(ts) {
  if (!ts) return null;
  let s = String(ts);
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  const t = new Date(s).getTime();
  if (isNaN(t)) return null;
  return (Date.now() - t) / 60000;
}

// GỘP 2 NGUỒN, không phải fallback: list public_api (token trang) HAY THIẾU hội thoại —
// ca anh Cầu 05–07/07: khách "Hi" nằm trong cửa sổ 72h, v1 thấy mà public_api since/until
// không trả → token trang sống nên không bao giờ rơi xuống v1 → rescue mù ca đó 2 ngày.
// v1 ghi đè public_api khi trùng id (v1 có last_customer_interactive_at chính xác hơn).
//
// --- VÁ 20/07/2026 (ca log Render srv-d8v9896gvqtc73bvme80, 11:10→12:35 UTC) ---
// Triệu chứng: 15× "[rescue] page <id> list qua page-token không trả mảng" trên CẢ 3 page,
// rescue phải vớt 7 lead, có ca khách chờ 23 PHÚT.
// ĐO THẬT (chỉ GET, không gửi tin): public_api trả HTTP 200 + content-type JSON, body là OBJECT LỖI:
//   386613267864665 / 957014354156110 → {"success":false,"error_code":105,"message":"access_token renewed..."}
//   zl_3136814239074246132            → {"success":false,"error_code":102,"message":"Invalid access_token"}
// → GỐC LỖI = TOKEN TRANG BỊ PANCAKE XOAY VÒNG, CÙNG GỐC với 9 ca "gửi HỤT" (Lỗi 1), KHÔNG phải
// 2 lỗi riêng. Code cũ chỉ kiểm Array.isArray() nên object lỗi rơi vào else → in dòng mơ hồ,
// NUỐT MẤT error_code → 15 dòng log mà không ai biết là lỗi token.
// Nay: đọc error_code → dùng CHUNG warnTokenRotated/refreshPageToken của pancake.js (không viết
// trùng logic Lỗi 1) → thử token mới ĐÚNG 1 lần → nếu vẫn chết thì đánh dấu pageTokenDead và
// dựa hẳn vào đường USER token v1 (JWT tài khoản, KHÔNG bị xoay vòng — chính nó vớt được 7 lead).
//
// LƯU Ý ĐÃ KIỂM CHỨNG: v1 KHÔNG nhận page_access_token (trả error_code 102) — chỉ nhận
// access_token = USER token. Đổi endpoint suông KHÔNG chữa được gì.
const LIST_PAGES = Math.max(1, parseInt(process.env.RESCUE_LIST_PAGES || '3', 10)); // phân trang v1
// Lọc type=INBOX ngay tầng API v1. TẮT mặc định: chưa kiểm chứng v1 hiểu tham số này —
// nếu nó không hiểu mà trả RỖNG thì rescue mù NGƯỢC LẠI. Lọc client (dòng ~115) vẫn là lưới an toàn.
const V1_TYPE_INBOX = process.env.RESCUE_V1_TYPE_INBOX === '1';
// Ngưỡng cảnh báo "hội thoại COMMENT khách chờ quá lâu không ai rep" → nghi Automation Meta chết.
// Chỉ CẢNH BÁO ra log, KHÔNG tự gửi tin (giữ ranh giới không trùng chân Meta/telesale).
const COMMENT_ALERT_MIN = parseFloat(process.env.RESCUE_COMMENT_ALERT_MIN || '15');

// VÁ 20/07/2026 (vòng 4) — RESCUE DÙNG CHUNG CƠ CHẾ CHỌN TOKEN VỚI GỬI TIN.
// Trước đây file này TỰ dựng lại 2 nhánh (public_api+page token / v1+user token) bằng axios riêng
// → 3 nơi (gửi tin, đọc nhãn, rescue) viết 3 kiểu, vá 1 chỗ không ăn 2 chỗ kia. Nay cả 3 đều gọi
// listConversations() → goiPancake() của pancake.js: ưu tiên token trang (kv anh Trình dán tay /
// env), gặp 102/105 thì TỰ ĐỔI sang USER token v1, và log rõ page nào + token loại nào chết.
// GIỮ NGUYÊN ý đồ GỘP 2 nguồn: v1 có last_customer_interactive_at chính xác hơn nên ghi đè khi
// trùng id → gọi 2 lượt (kèm since/until cho làn public_api, rồi phân trang cho làn v1).
async function getConvs(pageId) {
  const out = new Map(); // id -> conv
  const pid = canonicalPageId(pageId); // khớp key config (zl_/ttm_) như sendOne & getLastCustomerMessage

  // --- Lượt 1: kèm since/until (làn public_api CẦN, thiếu là trả rỗng; làn v1 bỏ qua tham số thừa) ---
  const until = Math.floor(Date.now() / 1000);
  const since = until - Math.floor(WINDOW_HOURS * 3600);
  const l1 = await listConversations(pid, { since, until, page_number: 1 });
  for (const c of l1.convs) { if (c?.id) out.set(String(c.id), c); }

  // --- Lượt 2: PHÂN TRANG (từ 20/07: trước chỉ đọc trang 1 → comment/hội thoại cũ ăn hết slot
  //     → sót lead → ca khách chờ 23 phút). Dừng sớm khi rỗng hoặc < 20 item. ---
  let lanCuoi = l1.lan;
  let docDuoc = l1.ok;
  for (let p = 1; p <= LIST_PAGES; p++) {
    const params = { page_number: p };
    if (V1_TYPE_INBOX) params.type = 'INBOX';
    const r = await listConversations(pid, params);
    lanCuoi = r.lan || lanCuoi;
    docDuoc = docDuoc || r.ok;
    if (!r.ok || r.convs.length === 0) break;
    for (const c of r.convs) { if (c?.id) out.set(String(c.id), c); }
    if (r.convs.length < 20) break; // trang cuối
  }

  // Cảnh báo ĐỎ: mù hoàn toàn = KHÔNG làn nào đọc nổi (goiPancake đã log chi tiết lý do).
  if (!docDuoc) {
    console.error(`[rescue] 🔴 page ${pid} MÙ HOÀN TOÀN — không làn token nào đọc được danh sách hội thoại`
      + ' (token trang 102/105 + USER token PANCAKE_API_TOKEN cũng hụt) → 0 lead nào được vớt cho page này.');
  } else if (lanCuoi === 'user') {
    console.warn(`[rescue] page ${pid}: token TRANG chết → đang vớt lead bằng USER token (v1). Nạp token trang mới qua POST /admin/set-token khi rảnh.`);
  }
  return [...out.values()];
}

// Người gửi CUỐI có phải KHÁCH không (không phải page/bot). true = khách nhắn cuối → cần vớt.
// So theo phần lõi (bỏ tiền tố zl_/ttm_...): Zalo lúc "zl_3136..." lúc "3136..." tùy endpoint —
// so khít sẽ coi tin của chính OA là tin khách → bot tự trả lời chính mình lặp vô hạn.
function khachNhanCuoi(c, pageId) {
  const lsb = c.last_sent_by;
  if (!lsb) return false;
  return stripChannelPrefix(lsb.id) !== stripChannelPrefix(pageId);
}

/**
 * Quét toàn bộ page → vớt ca khách nhắn cuối chưa rep. Gọi bởi cron.
 * @returns {Promise<number>} số ca đã đẩy vào xử lý.
 */
export async function runRescueLead() {
  let done = 0;
  const boQuaTheoKieu = {}; // {COMMENT: 12, ...} — đo cửa mù, in 1 dòng cuối vòng
  const cmtTre = [];        // ca COMMENT khách chờ quá lâu = nghi Automation Meta chết

  // VÁ 20/07/2026 (vòng 3) — TỰ CỨU TRƯỚC KHI QUÉT.
  // Cron rescue chạy mỗi 5' = đúng nhịp SLA lead ≤5' của phòng khám, nên đây là chỗ hợp lý nhất
  // để máy tự vá cấu hình: page nào thiếu token thì tự xin lại bằng USER token, page nào vẫn chết
  // thì KÊU ĐỎ lặp lại (thay vì 1 dòng warn lúc boot rồi im — chính chỗ làm sự cố 20/07 trôi mất
  // cả buổi tối, 14 hội thoại chưa đọc, khách hỏi giá tiêm 19:47–20:05 không ai rep).
  // Đặt TRƯỚC vòng quét để page vừa được cứu là được vớt lead ngay trong CHÍNH lượt này.
  try {
    const { cuuDuoc, conThieu } = await tuCuuPageThieuToken();
    if (cuuDuoc.length) console.log(`[rescue] ✅ tự cứu được ${cuuDuoc.length} page thiếu token: ${cuuDuoc.join(', ')} → quét luôn lượt này.`);
    if (conThieu.length) {
      console.error(`[rescue] 🔴 CÒN ${conThieu.length} page KHÔNG có token: ${conThieu.join(', ')}`
        + ' → mọi tin khách của page này KHÔNG AI TRẢ LỜI. Nạp: POST /admin/set-token?page=<id>.');
    }
  } catch (err) {
    console.error('[rescue] lỗi khi tự cứu page thiếu token:', err?.message || err);
  }

  for (const pageId of Object.keys(config.pancakePages)) {
    // VÁ 20/07/2026: trước đây `continue` IM LẶNG → page rụng token bị lưới cứu hộ CUỐI CÙNG bỏ
    // qua mà không một dòng log. Nay kêu rõ để soi log Render đếm được ngay page nào đang chết.
    if (!isPageEnabled(pageId)) {
      console.error(`[rescue] ⛔ BỎ QUÉT page ${pageId}: chưa bật bot / thiếu token → lead của page này KHÔNG được vớt.`);
      continue;
    }
    const convs = await getConvs(pageId);
    for (const c of convs) {
      if (done >= MAX_PER_RUN) break;
      const convId = c.id;
      if (!convId) continue;
      // CHỈ vớt INBOX (FB messenger + Zalo + TikTok đều INBOX). COMMENT là việc của Meta auto-rep,
      // đẩy comment vào handleIncoming là bot rep nhầm kênh.
      // VÁ 20/07/2026: trước đây `continue` IM LẶNG → không ai biết mỗi vòng bỏ bao nhiêu ca,
      // nên luồng comment chết mà không có số liệu. Nay ĐẾM lại và in 1 dòng tổng kết cuối vòng
      // (đếm, không in từng ca, để khỏi ngập log).
      const kieu = String(c.type || '').toUpperCase();
      if (kieu !== 'INBOX') {
        boQuaTheoKieu[kieu || 'RỖNG'] = (boQuaTheoKieu[kieu || 'RỖNG'] || 0) + 1;
        // Ca COMMENT mà khách nhắn cuối + chờ quá lâu = Automation Meta có thể đã chết → cảnh báo
        // để anh Bảo thấy trên log Render, KHÔNG tự gửi tin (giữ ranh giới không spam/không trùng).
        if (kieu === 'COMMENT' && khachNhanCuoi(c, pageId)) {
          const idleCmt = minutesSince(c.last_customer_interactive_at || c.updated_at);
          if (idleCmt != null && idleCmt >= COMMENT_ALERT_MIN && idleCmt < WINDOW_HOURS * 60) {
            cmtTre.push(`${convId}(${Math.round(idleCmt)}p)`);
          }
        }
        continue;
      }
      if (!khachNhanCuoi(c, pageId)) continue;            // page/bot nhắn cuối → khách chưa hỏi mới

      // đủ lâu chưa? (webhook về ngay trong vài giây; quá ngưỡng = webhook rớt)
      const idle = minutesSince(c.last_customer_interactive_at || c.updated_at);
      if (idle == null || idle < MIN_IDLE_MIN) continue;   // vừa nhắn → để webhook lo, tránh trùng
      if (idle > WINDOW_HOURS * 60) continue;              // quá cũ → thôi

      // đã thử vớt ĐÚNG tin này rồi (khách chặn page/hết cửa sổ 24h → gửi hụt hoài) → chờ khách
      // nhắn mới hoặc quá RETRY_HOURS mới thử lại, không xay Gemini mỗi 5 phút.
      const mark = String(c.last_customer_interactive_at || c.updated_at || '');
      const prev = attempted.get(convId);
      if (prev && prev.mark === mark && Date.now() - prev.at < RETRY_HOURS * 3600 * 1000) continue;

      // trạng thái: bỏ ca đang có người giữ / handover / opt-out / nhãn stop
      const conv = store.getConversation(convId);
      if (conv) {
        if (store.isOptedOut(conv)) continue;
        if (store.isHandover(conv)) continue;
        // VÁ 20/07/2026 — ĐỒNG BỘ MẶC ĐỊNH 6 → 2 (khớp handler.js:130 + .env.example:91).
        // store.js:622 đã chữa "ba giá trị chạy song song" nhưng CHỖ NÀY VÀ index.js:1248 còn sót '6'.
        // Hậu quả khi env Render KHÔNG đặt HUMAN_HOLD_HOURS: handler coi cờ hết hạn sau 2h (bot trả
        // lời lại) trong khi rescue vẫn coi là còn hiệu lực tới 6h → suốt 4h ĐÓ engine cứu hộ TỰ LOẠI
        // hội thoại khỏi danh sách vớt (`continue`), đúng lúc khách cần được vớt nhất. Cùng một cờ mà
        // hai bên hết hạn hai lúc = lỗ hổng bỏ rơi khách KHÔNG ai thấy trên log.
        if (store.isHumanActive(conv, parseFloat(process.env.HUMAN_HOLD_HOURS || '2'))) {
          // cờ human nhưng khách chờ QUÁ LÂU không ai rep → cờ kẹt oan (tin auto Meta/echo) → gỡ + vớt
          if (idle < HUMAN_OVERRIDE_MIN) continue;
          store.clearHumanTaken(convId);
          console.log(`[rescue] ⚠️ ${convId} cờ human nhưng khách chờ ${Math.round(idle)}p không ai rep → gỡ cờ kẹt, vớt luôn`);
        }
      }

      // đọc ĐÚNG tin cuối của khách rồi đẩy vào handleIncoming như webhook thật
      // (kèm customer_id từ list — API v1 fallback bắt buộc có khi token trang chết)
      let last;
      try { last = await getLastCustomerMessage(pageId, convId, c.customers?.[0]?.id || c.customer_id || null); }
      catch { last = null; }
      if (!last || !last.messageText) continue;             // tin cuối thực ra là của page → bỏ

      attempted.set(convId, { mark, at: Date.now() });
      if (attempted.size > 500) { // giữ map gọn — xoá mục cũ nhất
        const oldest = [...attempted.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) attempted.delete(oldest[0]);
      }
      console.log(`[rescue] 🛟 vớt lead ${convId} (khách nhắn cuối ${Math.round(idle)}p chưa rep): "${last.messageText.slice(0, 40)}"`);
      // KHÔNG await để 1 ca treo không chặn cả vòng; handleIncoming tự có lock chống trùng.
      handleIncoming({
        conversationId: convId,
        pageId,
        customerName: last.customerName || c.from?.name || null,
        messageText: last.messageText,
      });
      done++;
      // giãn nhịp giữa các ca → tránh Pancake rate-limit (429) khi vớt loạt nhiều lead cùng lúc.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (done) console.log(`[rescue] xong 1 lượt — vớt ${done} lead bị bỏ rơi`);
  // VÁ 20/07/2026 — ĐO CỬA MÙ COMMENT: in số ca bị bỏ theo kiểu để soi log Render biết được
  // "luồng comment có đang sống không", thay vì continue im lặng như trước.
  const tongBoQua = Object.values(boQuaTheoKieu).reduce((a, b) => a + b, 0);
  if (tongBoQua > 0) {
    console.log(`[rescue] bỏ qua ${tongBoQua} hội thoại không phải INBOX: `
      + Object.entries(boQuaTheoKieu).map(([k, v]) => `${k}=${v}`).join(', '));
  }
  if (cmtTre.length > 0) {
    console.error(`[rescue] 🔴 NGHI AUTOMATION META CHẾT — ${cmtTre.length} hội thoại COMMENT có`
      + ` khách nhắn cuối, chờ ≥${COMMENT_ALERT_MIN}p mà KHÔNG ai rep: ${cmtTre.slice(0, 10).join(', ')}`
      + `\n   → kiểm Automation "Bình luận để nhắn tin" bên Meta Business Suite.`
      + ` Nếu Automation đã tắt hẳn: đặt env COMMENT_BOT_ENABLED=1 để bot Gemini tự rep comment.`);
  }
  return done;
}
