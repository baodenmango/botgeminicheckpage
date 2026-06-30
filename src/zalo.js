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

const OA_API = 'https://openapi.zalo.me/v3.0/oa';
const OAUTH_API = 'https://oauth.zaloapp.com/v4/oa/access_token';

// Bật/tắt đường OpenAPI (gửi file/ảnh, getUserInfo, follow). Mặc định TẮT — dùng Pancake.
export function isOpenApiEnabled() {
  return /^(1|true|yes|on)$/i.test(process.env.ZALO_OPENAPI_ENABLED || '');
}

// Page id Zalo (qua Pancake) — để handler nhận diện đây là kênh Zalo. Dạng "zl_<...>".
export function isZaloPage(channel) {
  return String(channel || '').toLowerCase() === 'zalo';
}

// --- Quản lý access token trong RAM, tự refresh khi 401/hết hạn ---
// Lưu trong RAM thôi (Render restart sẽ nạp lại từ env). Khi refresh, Zalo trả token MỚI cả 2;
// ta cập nhật RAM để các lần sau dùng. (Persist ra disk là việc nâng cấp sau, không bắt buộc.)
let accessToken = process.env.ZALO_ACCESS_TOKEN || null;
let refreshToken = process.env.ZALO_REFRESH_TOKEN || null;
let lastRefreshAt = 0;

async function refreshAccessToken() {
  // chống refresh dồn dập (nhiều lượt 401 cùng lúc) — tối đa 1 lần / 60s
  if (Date.now() - lastRefreshAt < 60000) return accessToken;
  const appId = process.env.ZALO_APP_ID;
  const appSecret = process.env.ZALO_APP_SECRET;
  if (!appId || !appSecret || !refreshToken) {
    console.warn('[zalo] thiếu ZALO_APP_ID/SECRET/REFRESH_TOKEN → không refresh được token');
    return accessToken;
  }
  try {
    const res = await axios.post(
      OAUTH_API,
      new URLSearchParams({
        refresh_token: refreshToken,
        app_id: appId,
        grant_type: 'refresh_token',
      }).toString(),
      { headers: { secret_key: appSecret, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );
    if (res.data?.access_token) {
      accessToken = res.data.access_token;
      if (res.data.refresh_token) refreshToken = res.data.refresh_token; // Zalo xoay vòng refresh token
      lastRefreshAt = Date.now();
      console.log('[zalo] ✅ refresh access token thành công');
    } else {
      console.error('[zalo] refresh token: phản hồi không có access_token:', JSON.stringify(res.data).slice(0, 200));
    }
  } catch (err) {
    console.error('[zalo] refresh token lỗi:', err?.response?.data || err.message);
  }
  return accessToken;
}

// Gọi 1 endpoint OA, tự refresh + retry 1 lần nếu token hết hạn (Zalo error -216/-124).
async function oaCall(method, pathName, { params, data } = {}) {
  if (!accessToken) {
    console.warn('[zalo] chưa có ZALO_ACCESS_TOKEN → bỏ gọi OpenAPI');
    return null;
  }
  const url = `${OA_API}/${pathName}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await axios({
        method, url, params,
        data: data ? JSON.stringify(data) : undefined,
        headers: { access_token: accessToken, 'Content-Type': 'application/json' },
        timeout: 20000,
        validateStatus: () => true,
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
  return Boolean(body && body.error === 0);
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
export async function sendFileByUrl(userId, fileUrl) {
  if (!isOpenApiEnabled()) return false;
  // Zalo OpenAPI gửi file qua attachment "file" cần token upload. Một số gói cho gửi link trực tiếp
  // qua tin text kèm preview; để chắc ăn cross-gói, ta gửi link trong text (khách bấm tải).
  // Khi gói hỗ trợ upload file thật → thay bằng luồng upload/file + attachment ở đây.
  return sendText(userId, `📄 Tài liệu của mình đây ạ, mình bấm vào tải về nha:\n${fileUrl}`);
}

/**
 * Đọc thông tin 1 follower (tên, có thể có số đt nếu user đã chia sẻ).
 * Trả về { name, phone } hoặc null.
 */
export async function getUserInfo(userId) {
  if (!isOpenApiEnabled()) return null;
  const body = await oaCall('get', 'getprofile', {
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
