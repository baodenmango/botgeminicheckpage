// ===== BỐI CẢNH QUẢNG CÁO (đại tu 15/09/2026 — ca Lương Tờ Rình) =====
// Khách bấm ads rồi nhắn "tôi bị triệu chứng như bác nói ở trên" — bot MÙ nội dung ads nên hỏi
// lại từ đầu "gối, lưng hay vai ạ?" = khách phải kể lại thứ họ vừa đọc. Module này lấy CAPTION
// của bài/ad khách bấm để nhét vào prompt.
// 3 tầng fail-soft (mọi lỗi → null, KHÔNG chặn luồng trả lời):
//   ① webhook Meta có sẵn ads_context_data.ad_title → index.js trích, handler ghi thẳng KV (0 API call)
//   ② Pancake /posts (page_access_token, since/until) — cache 30 ngày theo postId
//      (⚠️ xác minh 15/09: endpoint nhận đúng tham số since/until nhưng server Pancake đang trả
//       500 diện rộng — code để sẵn, hồi lúc nào ăn lúc đó)
//   ③ không có caption → handler vẫn cắm thẻ "khách đến từ quảng cáo" để bot khỏi hỏi trống
// Cầu dao: BOT_AD_CONTEXT=0 → tắt hẳn (không gọi API, không cắm thẻ caption).
import * as store from './store.js';
import { config } from './config.js';

const TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 30 * 86400000;

export function adContextBat() {
  return String(process.env.BOT_AD_CONTEXT ?? '1') !== '0';
}

// Token page cho pages.fm — lấy từ config.pancakePages (env PANCAKE_PAGE_N_TOKEN) hoặc KV pancake_token:<id>.
function layPageToken(pageId) {
  const p = (config.pancakePages || {})[String(pageId)];
  if (p?.token) return p.token;
  try { return store.getKV(`pancake_token:${pageId}`) || null; } catch { return null; }
}

async function fetchTimeout(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch { return null; } finally { clearTimeout(t); }
}

/**
 * Lấy caption bài/ad. postId dạng "pageid_postid" (từ referral webhook).
 * @returns {Promise<string|null>} caption (cắt 350 ký tự) hoặc null.
 */
export async function layCaptionQuangCao({ pageId, postId }) {
  if (!adContextBat() || !postId) return null;
  const kvKey = `adcap_post:${postId}`;
  try {
    const cached = JSON.parse(store.getKV(kvKey) || 'null');
    if (cached && Date.now() - cached.t < CACHE_TTL_MS) return cached.cap || null;
  } catch { /* cache hỏng → tra lại */ }

  const token = layPageToken(pageId);
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const u = `https://pages.fm/api/public_api/v1/pages/${pageId}/posts` +
    `?page_access_token=${encodeURIComponent(token)}&page_number=1&page_size=30` +
    `&since=${now - 90 * 86400}&until=${now}`;
  const d = await fetchTimeout(u);
  const posts = d?.posts || [];
  const hit = posts.find((p) => String(p.id) === String(postId) || String(p.id).endsWith(`_${String(postId).split('_')[1]}`));
  const cap = (hit && String(hit.message || hit.content || '').trim().slice(0, 350)) || null;
  // Cache cả kết quả RỖNG (chống gọi lại mỗi tin khi bài không tra được) — TTL ngắn hơn: 6h.
  store.setKV(kvKey, JSON.stringify({ cap, t: cap ? Date.now() : Date.now() - CACHE_TTL_MS + 6 * 3600000 }));
  if (cap) console.log(`[adcontext] 📣 lấy được caption bài ${postId} (${cap.length} ký tự, đã cache)`);
  return cap;
}

/** Dựng thẻ ngữ cảnh quảng cáo cho một lượt trả lời. caption=null vẫn ra thẻ nhẹ. */
export function dungTheQuangCao(caption) {
  if (caption) {
    return `[QUẢNG CÁO KHÁCH VỪA BẤM] "${caption}"\n` +
      'Khách đến từ quảng cáo trên. Khách nói "như bác nói ở trên/trong video" là đang nhắc NỘI DUNG NÀY — ' +
      'bám đúng bệnh/triệu chứng trong quảng cáo mà tư vấn tiếp, TUYỆT ĐỐI không hỏi lại thứ quảng cáo vừa nói ' +
      '(khách vừa đọc xong, hỏi lại là lộ máy). KHÔNG lặp nguyên văn caption.';
  }
  return '[KHÁCH ĐẾN TỪ QUẢNG CÁO — hệ thống chưa tra được nội dung ad] ' +
    'Khách nói "như bác nói ở trên/trong video/bài viết" là đang nhắc quảng cáo họ vừa bấm. ' +
    'ĐỪNG hỏi trống "mình đau gối, lưng hay vai ạ?" — dựa vào manh mối trong tin khách mà hỏi MỘT câu ' +
    'ĐÓNG xác nhận (vd khách nói "triệu chứng như bác nói" sau ad về vai → "Dạ mình đang bị đau vai, giơ tay ' +
    'khó phải không ạ?"), rồi tư vấn tiếp.';
}
