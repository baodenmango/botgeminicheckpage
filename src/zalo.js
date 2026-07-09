// ============================================================
//  ZALO OA — client OpenAPI cho bot Gemini.
//  Hai vai trò:
//   1) GỬI tin/ảnh/file qua Zalo OpenAPI (dùng cho webhook follow giao tài liệu,
//      và làm KÊNH GỬI thay thế khi muốn gửi thứ Pancake không gửi được — file PDF/video).
//   2) Đọc thông tin follower (getUserInfo) để biết tên + (nếu có) số đt.
//
//  ⚠️ HAI ĐƯỜNG GỬI ZALO (anh Trình chốt 30/06 — "cái nào tốt thì làm"):
//   - MẶC ĐỊNH: page Zalo nối vào PANCAKE (PANCAKE_PAGE_3_CHANNEL=zalo) → tin THƯỜNG gửi
//     qua sendMessages() y như 2 page FB. KHÔNG cần token Zalo, không kẹt gói OpenAPI.
//   - OPENAPI (file này): bật khi cần GỬI FILE/ẢNH hoặc khi gói cước Zalo đã có OpenAPI.
//     Điều khiển bằng env ZALO_OPENAPI_ENABLED=1. Token tự refresh (Zalo access token sống ~25h).
//
//  Token nằm trong env (đồng bộ .mcp.json zalo-hieploi):
//   ZALO_ACCESS_TOKEN, ZALO_REFRESH_TOKEN, ZALO_APP_ID, ZALO_APP_SECRET, ZALO_OA_ID
import axios from 'axios';
import https from 'node:https';
import * as store from './store.js';
import { CONDITION_VI } from './conditions.js';
import { noteBotSent, noteBotJustSent } from './echoguard.js';

// ÉP IPv4 cho MỌI call tới hạ tầng Zalo. Bắt tận tay 08/07 trong container Render:
// oauth.zaloapp.com có bản ghi IPv6 nhưng mạng Render không đi được IPv6 tới đó →
// Node/axios chọn IPv6 → ETIMEDOUT với message RỖNG (curl thì tự lùi IPv4 nên chạy ngon).
// Hậu quả: refresh token "chết" câm suốt từ 15:21, sập cả đường OpenAPI + ZNS.
export const zaloAgentV4 = new https.Agent({ family: 4, keepAlive: true });

const OA_API = 'https://openapi.zalo.me/v3.0/oa';
const OA_API_V2 = 'https://openapi.zalo.me/v2.0/oa'; // vài API chỉ có ở v2 (tag, conversation)
const OAUTH_API = 'https://oauth.zaloapp.com/v4/oa/access_token';

// Bật/tắt đường OpenAPI (gửi file/ảnh, getUserInfo, follow). Mặc định TẮT — dùng Pancake.
export function isOpenApiEnabled() {
  return /^(1|true|yes|on)$/i.test(process.env.ZALO_OPENAPI_ENABLED || '');
}

// Page id Zalo (qua Pancake) — để handler nhận diện đây là kênh Zalo. Dạng "zl_<...>".
export function isZaloPage(channel) {
  return String(channel || '').toLowerCase() === 'zalo';
}

// --- Quản lý access token: RAM + PERSIST vào DB (bảng kv) ---
// Zalo XOAY VÒNG refresh token mỗi lần dùng → nếu chỉ giữ trong RAM, restart là nạp lại
// env đã CŨ và chết cả chuỗi (sự cố 03/07). Giờ: refresh xong ghi DB; boot ưu tiên DB;
// DB chết (vd anh vừa dán cặp MỚI lên env) thì tự lùi về env thử lại 1 lần.
let accessToken = store.getKV('zalo_access_token') || process.env.ZALO_ACCESS_TOKEN || null;
let refreshToken = store.getKV('zalo_refresh_token') || process.env.ZALO_REFRESH_TOKEN || null;
let lastRefreshAt = 0;

// Token hiện hành cho module khác (zns.js gọi business.openapi.zalo.me cần header này).
export function getAccessTokenNow() {
  return accessToken;
}

export async function refreshAccessToken() {
  // chống refresh dồn dập (nhiều lượt 401 cùng lúc) — tối đa 1 lần / 60s
  if (Date.now() - lastRefreshAt < 60000) return accessToken;
  const appId = process.env.ZALO_APP_ID;
  const appSecret = process.env.ZALO_APP_SECRET;
  if (!appId || !appSecret || !refreshToken) {
    console.warn('[zalo] thiếu ZALO_APP_ID/SECRET/REFRESH_TOKEN → không refresh được token');
    return accessToken;
  }
  // validateStatus true: HTTP 4xx/5xx KHÔNG được văng ra ngoài — văng là nhảy vào catch,
  // BỎ QUA LUÔN nhánh phao "thử cặp env" bên dưới (bug 08/07: chuỗi chết mà log trống trơn,
  // anh dán cặp mới lên env bot cũng không tự hồi được).
  const goiRefresh = async (rt) => axios.post(
    OAUTH_API,
    new URLSearchParams({
      refresh_token: rt,
      app_id: appId,
      grant_type: 'refresh_token',
    }).toString(),
    {
      headers: { secret_key: appSecret, 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
      validateStatus: () => true,
      httpsAgent: zaloAgentV4,
    }
  );
  const moTa = (res) => `HTTP ${res?.status} body=${JSON.stringify(res?.data ?? null).slice(0, 250)}`;
  try {
    let res = await goiRefresh(refreshToken);
    if (!res.data?.access_token) {
      console.warn(`[zalo] refresh bằng token DB thất bại (${moTa(res)})`);
      // cặp trong DB chết (đã dùng/thu hồi) mà env có cặp KHÁC (anh vừa dán mới) → thử env
      const envRt = process.env.ZALO_REFRESH_TOKEN;
      if (envRt && envRt !== refreshToken) {
        console.warn('[zalo] → thử lại bằng token env (cặp mới dán)');
        res = await goiRefresh(envRt);
        if (!res.data?.access_token) console.warn(`[zalo] token env cũng thất bại (${moTa(res)})`);
      }
    }
    if (res.data?.access_token) {
      accessToken = res.data.access_token;
      if (res.data.refresh_token) refreshToken = res.data.refresh_token; // Zalo xoay vòng refresh token
      lastRefreshAt = Date.now();
      try {
        store.setKV('zalo_access_token', accessToken);
        store.setKV('zalo_refresh_token', refreshToken);
      } catch (e) { console.warn('[zalo] không ghi được token vào DB:', e?.message); }
      console.log('[zalo] ✅ refresh access token thành công (đã persist DB)');
    } else {
      console.error('[zalo] ❌ refresh token THẤT BẠI cả DB lẫn env — chuỗi có thể đã chết, cần anh cấp cặp OAuth mới (lay-token.js) rồi dán lên Render env');
    }
  } catch (err) {
    console.error('[zalo] refresh token lỗi mạng/bất ngờ:', err?.response?.status, JSON.stringify(err?.response?.data ?? null).slice(0, 250), err?.message);
  }
  return accessToken;
}

// Gọi 1 endpoint OA, tự refresh + retry 1 lần nếu token hết hạn (Zalo error -216/-124).
// opts.v2 = true → gọi bên v2.0 (tag API nằm ở v2, gọi v3 dính 404 "invalid API" — test 07/07).
async function oaCall(method, pathName, { params, data, v2 } = {}) {
  if (!accessToken) {
    console.warn('[zalo] chưa có ZALO_ACCESS_TOKEN → bỏ gọi OpenAPI');
    return null;
  }
  const url = `${v2 ? OA_API_V2 : OA_API}/${pathName}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await axios({
        method, url, params,
        data: data ? JSON.stringify(data) : undefined,
        headers: { access_token: accessToken, 'Content-Type': 'application/json' },
        timeout: 20000,
        validateStatus: () => true,
        httpsAgent: zaloAgentV4,
      });
      const body = res.data;
      // Zalo trả error code trong body (error=0 là OK). -216/-124 = token hết hạn/sai.
      if (body && typeof body.error === 'number' && body.error !== 0) {
        const tokenExpired = [-216, -124].includes(body.error);
        if (attempt === 1 && tokenExpired) {
          console.warn(`[zalo] token hết hạn (error ${body.error}) → refresh + thử lại`);
          await refreshAccessToken();
          continue;
        }
        console.error(`[zalo] ${pathName} lỗi error=${body.error}: ${body.message || ''}`);
        return null;
      }
      return body;
    } catch (err) {
      console.error(`[zalo] ${pathName} gọi lỗi:`, err?.response?.data || err.message);
      return null;
    }
  }
  return null;
}

/**
 * GỬI 1 tin text qua Zalo OpenAPI tới 1 user (zalo user_id, KHÔNG kèm tiền tố "zl_").
 * Lưu ý cửa sổ 48h + quota: tin ngoài 48h cần đúng loại "consultation"/template (gói Tăng trưởng).
 * Ở đây gửi message thường (trong cửa sổ tương tác). Trả về true nếu Zalo nhận.
 */
export async function sendText(userId, text) {
  if (!isOpenApiEnabled()) return false;
  const body = await oaCall('post', 'message/cs', {
    data: { recipient: { user_id: String(userId) }, message: { text: String(text || '').slice(0, 2000) } },
  });
  const ok = Boolean(body && body.error === 0);
  // Ghi sổ chống echo: tin OpenAPI cũng dội về webhook Pancake dưới dạng tin page —
  // không ghi thì handler tưởng telesale gõ tay → bot câm 6h (ca Loan Le 07/07:
  // khách follow, bot chào + hỏi vùng đau, rồi tự khoá mồm vì echo chính mình).
  if (ok) {
    const cid = convIdPancake(userId);
    if (cid) { noteBotSent(cid, text); noteBotJustSent(cid); }
  }
  return ok;
}

// conversationId phía Pancake của 1 user Zalo: "zl_<oa_id>_<uid>" (đúng format webhook dội về).
// OA id là định danh CÔNG KHAI (nằm trong mọi conv id) → hardcode fallback được.
function convIdPancake(userId) {
  const oaId = process.env.ZALO_OA_ID || '3136814239074246132';
  return `zl_${oaId}_${userId}`;
}

/**
 * GỬI nhiều ô text lần lượt qua Zalo OpenAPI (cùng nhịp với Pancake — có delay nhẹ).
 */
export async function sendTexts(userId, messages, delayMs = 1200) {
  let okAny = false;
  for (const m of messages) {
    const ok = await sendText(userId, m);
    okAny = okAny || ok;
    if (!ok) break;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return okAny;
}

/**
 * GỬI 1 FILE (PDF cẩm nang) qua Zalo OpenAPI.
 * Quy trình Zalo: upload file → nhận token → gửi message attachment file.
 * @param {string} userId  zalo user_id (không kèm "zl_")
 * @param {string} fileUrl  URL file công khai (Drive direct download) — Zalo tải về để gửi
 */
export async function sendFileByUrl(userId, fileUrl, fileName = 'Cam-nang-cham-soc.pdf') {
  if (!isOpenApiEnabled()) return false;
  // Luồng gửi FILE THẬT (port từ MCP zalo local, test PASS 30/06): tải file về →
  // upload v2.0 /oa/upload/file lấy token → gửi v3.0 message/cs attachment type file.
  // Gói Tăng trưởng đã có OpenAPI nên upload chạy được; lỗi bất kỳ → lùi về gửi link (phao cũ).
  try {
    // Link Google Drive dạng /file/d/<id>/ → link tải trực tiếp
    let url = String(fileUrl);
    const m = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (m) url = `https://drive.google.com/uc?export=download&id=${m[1]}`;
    const resp = await axios.get(url, { responseType: 'arraybuffer', maxRedirects: 5, timeout: 30000 });

    // upload v2 (multipart) — tự refresh + thử lại 1 lần nếu token hết hạn
    const upload = async () => {
      const form = new FormData();
      form.append('file', new Blob([resp.data], { type: 'application/pdf' }), fileName);
      return axios.post('https://openapi.zalo.me/v2.0/oa/upload/file', form, {
        headers: { access_token: accessToken }, timeout: 30000, httpsAgent: zaloAgentV4,
      });
    };
    let up = await upload();
    if ([-216, -124].includes(up.data?.error)) {
      await refreshAccessToken();
      up = await upload();
    }
    const token = up.data?.data?.token;
    if (!token) throw new Error(`upload không có token: ${JSON.stringify(up.data).slice(0, 150)}`);

    const body = await oaCall('post', 'message/cs', {
      data: { recipient: { user_id: String(userId) }, message: { attachment: { type: 'file', payload: { token } } } },
    });
    if (body?.error === 0) {
      const cid = convIdPancake(userId);
      if (cid) noteBotJustSent(cid); // echo file thường attachmentOnly, mốc thời gian là đủ
      return true;
    }
    throw new Error(`gửi attachment lỗi: ${JSON.stringify(body).slice(0, 150)}`);
  } catch (err) {
    console.warn('[zalo] gửi file thật thất bại → lùi về gửi link:', err?.message);
    return sendText(userId, `📄 Tài liệu của mình đây ạ, mình bấm vào tải về nha:\n${fileUrl}`);
  }
}

/**
 * Đọc thông tin 1 follower (tên, có thể có số đt nếu user đã chia sẻ).
 * Trả về { name, phone } hoặc null.
 */
export async function getUserInfo(userId) {
  if (!isOpenApiEnabled()) return null;
  // v3.0 KHÔNG có /oa/getprofile (404 "invalid API") → endpoint đúng là /oa/user/detail
  const body = await oaCall('get', 'user/detail', {
    params: { data: JSON.stringify({ user_id: String(userId) }) },
  });
  const d = body?.data;
  if (!d) return null;
  return {
    name: d.display_name || d.name || null,
    phone: d.shared_info?.phone || null, // chỉ có khi user bấm "chia sẻ số đt" trong OA
  };
}

// Chuẩn hóa zalo user_id: Pancake lưu fb_id dạng "zl_<uid>" → bỏ tiền tố khi gọi OpenAPI.
export function stripZaloPrefix(rawId) {
  return String(rawId || '').replace(/^zl_/i, '');
}

/**
 * Gửi card XIN CHIA SẺ THÔNG TIN (request_user_info) — khách bấm ĐÚNG 1 NÚT là OA
 * nhận tên + SĐT chính chủ Zalo (webhook user_submit_info), không cần gõ tin nào.
 * Đây là mắt xích nối SĐT ↔ Zalo cho khách quầy chỉ bấm Quan tâm mà không nhắn.
 */
export async function sendRequestInfo(userId) {
  if (!isOpenApiEnabled()) return false;
  const body = await oaCall('post', 'message/cs', {
    data: {
      recipient: { user_id: stripZaloPrefix(userId) },
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'request_user_info',
            elements: [{
              title: 'Phòng khám Cơ xương khớp Hiệp Lợi',
              subtitle: 'Mình bấm "Chia sẻ thông tin" để phòng khám nối đúng hồ sơ khám và chăm sóc cho mình nha ạ 🙏',
              image_url: process.env.ZALO_REQINFO_IMAGE || 'https://s120-ava-talk.zadn.vn/4/d/8/e/2/120/794ff6da5a2b38f62a77c70ddde9e330.jpg',
            }],
          },
        },
      },
    },
  });
  const ok = body?.error === 0;
  if (ok) {
    const cid = convIdPancake(stripZaloPrefix(userId));
    if (cid) {
      // echo card về dạng tin page có subtitle → ghi cả nội dung lẫn mốc thời gian
      noteBotSent(cid, 'Mình bấm "Chia sẻ thông tin" để phòng khám nối đúng hồ sơ khám và chăm sóc cho mình nha ạ');
      noteBotJustSent(cid);
    }
  } else {
    // ĐỪNG nuốt lỗi im lặng (08/07: anh Trình báo "khách không thấy nút" mà log trắng trơn)
    console.warn(`[zalo] card request_user_info gửi HỤT (uid ${stripZaloPrefix(userId)}):`, JSON.stringify(body || {}).slice(0, 250));
  }
  return ok;
}

// Đếm tổng follower OA (B7 báo cáo tuần). Trả null nếu OpenAPI tắt/lỗi.
export async function demFollower() {
  if (!isOpenApiEnabled()) return null;
  const body = await oaCall('get', 'user/getlist', {
    params: { data: JSON.stringify({ offset: 0, count: 1, is_follower: true }) },
  });
  return body?.data?.total ?? null;
}

// --- GẮN TAG BỆNH cho follower (B4 — broadcast theo tag bệnh) ---
// ⚠️ Zalo giới hạn tag_name ≤ 15 KÝ TỰ (test 07/07: error -201 nếu dài hơn; tính theo ký tự,
// không phải byte) → bảng tên tag NGẮN riêng, không lấy nguyên văn CONDITION_VI.
// Nhân viên thấy tag ngay trong OA chat; broadcast tin truyền thông lọc theo tag này.
const TAG_BENH = {
  goi: 'Khớp gối',        vai: 'Khớp vai',        gut: 'Gút',
  lung: 'Đau lưng',       tvdd: 'Thoát vị ĐĐ',    covaigay: 'Cổ vai gáy',
  ngontay: 'Ngón tay lò xo', chopxoay: 'Chóp xoay vai', cochan: 'Cổ chân',
  hang: 'Khớp háng',      chomdui: 'Chỏm xương đùi', csc: 'Cột sống cổ',
  loangxuong: 'Loãng xương', dequervain: 'De Quervain',  ongcotay: 'Ống cổ tay',
  tenniselbow: 'Khuỷu tennis', gangotchan: 'Gai gót chân',
};
export function tagTheoBenh(condition) {
  if (TAG_BENH[condition]) return TAG_BENH[condition];
  const vi = CONDITION_VI[condition];
  if (!vi) return null;
  return vi.split('/')[0].trim().slice(0, 15); // fallback cho mã bệnh mới chưa vào bảng
}

/**
 * Gắn tag bệnh cho 1 follower — idempotent (kv chống gọi lặp), fail-open (lỗi thì thôi,
 * không được chặn luồng chính). Gọi fire-and-forget từ handler/follow/bill-ingest.
 */
export async function tagFollowerBenh(userId, condition) {
  try {
    if (!isOpenApiEnabled()) return false;
    const uid = stripZaloPrefix(userId);
    if (!uid || !condition || condition === 'unknown' || condition === 'khac') return false;
    const tag = tagTheoBenh(condition);
    if (!tag) return false;
    const key = `zalo_tagged:${uid}:${condition}`;
    if (store.getKV(key)) return true; // đã gắn rồi
    const body = await oaCall('post', 'tag/tagfollower', {
      data: { user_id: uid, tag_name: tag },
      v2: true, // tag API chỉ có ở v2.0 — v3.0 trả 404 (test 07/07)
    });
    if (body?.error === 0) {
      store.setKV(key, '1');
      console.log(`[zalo] 🏷️ gắn tag "${tag}" cho follower ${uid}`);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[zalo] tagFollowerBenh lỗi (bỏ qua):', err?.message);
    return false;
  }
}

// --- BROADCAST TIN TRUYỀN THÔNG theo tag bệnh (khai thác 4 tin miễn phí/follower/tháng) ---
// Tin truyền thông là loại KHÁC tin tư vấn 1-1 → KHÔNG đụng quota 500 của quota.js.
// Zalo giới hạn: ≤4 tin truyền thông/follower/tháng + ≤1 tin/ngày/người → dedup CHỦ ĐỘNG
// bằng kv trước khi gửi (khỏi đốt oan + tránh Zalo phạt rate). Dùng oaCall (auto-refresh + IPv4).
const thangVN = () => { const d = new Date(Date.now() + 7 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const ngayVNstr = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const TT_TRAN_THANG = parseInt(process.env.ZALO_TT_THANG || '4', 10); // trần Zalo: 4 tin/follower/tháng

/**
 * Gửi 1 tin truyền thông cho toàn bộ follower gắn 1 tag bệnh.
 * @param {object} p { tagKey?, tagName?, header, text, dryRun }
 *   - tagKey: key trong TAG_BENH (vd 'goi'); HOẶC tagName: giá trị tag thô (vd 'Khớp gối')
 *   - dryRun: chỉ đếm người nhận, KHÔNG gửi
 * @returns {Promise<object>} thống kê { tag, tong_follower, da_gui, bo_qua, loi }
 */
export async function broadcastTag({ tagKey, tagName, header, text, dryRun = false } = {}) {
  if (!isOpenApiEnabled()) return { ok: false, ly_do: 'openapi_tat', se_gui_cho: 0 };
  const tag = tagName || (tagKey ? tagTheoBenh(tagKey) : null);
  if (!tag) return { ok: false, ly_do: 'thieu_tag', se_gui_cho: 0 };
  if (!dryRun && (!header || !text)) return { ok: false, ly_do: 'thieu_noi_dung', se_gui_cho: 0 };

  // 1) gom danh sách user_id theo tag (phân trang, chặn trần offset chống lặp vô hạn)
  const uids = [];
  let offset = 0;
  for (let guard = 0; guard < 40; guard++) { // 40*50 = 2000 trần
    const body = await oaCall('get', 'user/getlist', {
      params: { data: JSON.stringify({ offset, count: 50, is_follower: true, tag_name: tag }) },
    });
    const arr = body?.data?.users || [];
    for (const u of arr) { const id = stripZaloPrefix(u.user_id || u.user_id_by_app || ''); if (id) uids.push(id); }
    const total = body?.data?.total ?? uids.length;
    offset += 50;
    if (offset >= total || arr.length === 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  if (dryRun) return { ok: true, dry_run: true, tag, se_gui_cho: uids.length };

  // 2) gửi từng người, dedup 1 tin/ngày + trần 4 tin/tháng
  const thang = thangVN();
  const ngay = ngayVNstr();
  let daGui = 0, boQua = 0; const loi = [];
  for (const uid of uids) {
    const kNgay = `zalo_bc_day:${ngay}:${uid}`;
    const kThang = `zalo_bc_month:${thang}:${uid}`;
    if (store.getKV(kNgay)) { boQua++; continue; }            // đã nhận tin truyền thông hôm nay
    if (parseInt(store.getKV(kThang) || '0', 10) >= TT_TRAN_THANG) { boQua++; continue; } // hết 4 tin/tháng
    const body = await oaCall('post', 'message/promotion', {
      data: {
        recipient: { user_id: uid },
        message: { attachment: { type: 'template', payload: {
          template_type: 'promotion', language: 'VI',
          elements: [
            { type: 'header', content: String(header).slice(0, 100) },
            { type: 'text', align: 'left', content: String(text).slice(0, 2000) },
          ],
        } } },
      },
    });
    if (body?.error === 0) {
      store.setKV(kNgay, '1');
      store.setKV(kThang, String(parseInt(store.getKV(kThang) || '0', 10) + 1));
      daGui++;
    } else {
      loi.push(`${uid.slice(0, 8)}:${body?.error}`);
    }
    await new Promise((r) => setTimeout(r, 350)); // nương rate-limit Zalo
  }
  console.log(`[broadcast] tag "${tag}": gửi ${daGui}, bỏ qua ${boQua}, lỗi ${loi.length}`);
  return { ok: true, tag, tong_follower: uids.length, da_gui: daGui, bo_qua: boQua, loi: loi.slice(0, 10) };
}
