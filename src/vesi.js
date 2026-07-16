// ============================================================
//  vesi.js — VỆ SĨ HỘP THƯ Hiệp Lợi (port 1:1 từ canh-pha-hoai.py)
//
//  Việc: mỗi lượt chạy (cron 30'/lần, khung 7h–22h giờ VN):
//    1. Kéo hội thoại INBOX + COMMENT mới từ Pancake (page Dr Nhật Trình 957014354156110).
//    2. Phân loại từng người:
//       - KHACH        : có SĐT → lead thật, KHÔNG BAO GIỜ chặn.
//       - NGOAI_CHAC   : tên chữ ngoại hệ (Bengali/Ả Rập/Devanagari/CJK/Kirin/Thái...)
//                        + không SĐT → TỰ CHẶN trên page (Graph API /blocked).
//       - NGOAI_GEMINI : tên Latin không giống tên Việt, Gemini xác nhận ngoại/ảo → CHẶN.
//       - PHA_HOAI     : anti phòng khám/bác sĩ, chửi phá, tố bịa, seeding đối thủ
//                        (Gemini chấm trên NỘI DUNG THẬT — comment đọc qua Graph API)
//                        → CHẶN + ẨN comment (lệnh anh Trình 14/07). Khách thật đang
//                        phàn nàn trải nghiệm → KHÔNG chặn, chỉ báo để chăm sóc.
//    3. Khai báo lead THẬT cho Facebook: hội thoại có SĐT → bắn event Lead qua
//       Conversions API for Business Messaging (chỉ khi có VESI_DATASET / kv vesi:dataset-id).
//    4. Báo cáo Telegram về group «Hiệp Lợi CEO Giao Ban» khi có hành động.
//
//  An toàn (Mục 6 hiến pháp — block+CAPI KHÔNG đảo ngược):
//    - Mặc định DRY (chỉ ĐỀ-XUẤT + báo Telegram). Đặt VESI_DRY=0 để thực chặn/CAPI.
//    - Thiếu token FB (VESI_FB_TOKEN) hoặc me/accounts rỗng → TỰ LÙI chế độ đề-xuất, KHÔNG crash.
//    - Không bao giờ chặn: có SĐT, hoặc hội thoại cũ > NGAY_CU ngày. Trần TRAN_CHAN con/lượt.
//
//  State: KV bảng `kv` của store.js (key vesi:*) — sống qua restart trên persistent disk Render,
//    thay cho da-xu-ly.json / so-chan.ndjson (ổ đĩa Render ephemeral, mất mỗi redeploy).
//
//  Port 1:1 theo BƯỚC 0→7 của canh-pha-hoai.py. Chống-lặp 16/07 giữ nguyên văn:
//    chặn OK là lưu state ngay (không để ẩn-comment-hụt kéo cả ca chặn lặp lại).
// ============================================================
import axios from 'axios';
import * as store from './store.js';
import { getUserToken } from './pancake.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const PAGE_ID = '957014354156110';   // page Dr Nhật Trình
const NGAY_CU = 14;                   // chỉ xét hội thoại tương tác trong N ngày gần đây
const TRAN_CHAN = 10;                 // tối đa số PSID chặn mỗi lượt chạy
const SO_HOI_THOAI = 60;              // số hội thoại kéo mỗi lượt
const FB_VER = 'v21.0';

function log(msg) {
  console.log(`[vesi] ${msg}`);
}

// ---------- http wrapper (bám py http()): trả {__err__} khi lỗi thay vì throw ----------
async function http(url, { data = null, method = null, timeout = 30000 } = {}) {
  try {
    const res = await axios({
      url,
      method: method || (data != null ? 'POST' : 'GET'),
      data,
      timeout,
      // data là chuỗi urlencoded → giữ header form (bám urllib.parse.urlencode của py)
      headers: data != null && typeof data === 'string'
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : undefined,
      validateStatus: () => true,
    });
    if (res.status >= 400) {
      return { __err__: (res.data && typeof res.data === 'object') ? res.data : { raw: String(res.status) } };
    }
    return res.data;
  } catch (e) {
    return { __err__: { raw: e?.message || String(e) } };
  }
}

// ---------- BƯỚC 0b — LẤY PAGE TOKEN (fb_page_token) ----------
// Đổi VESI_FB_TOKEN (user token) lấy page token của đúng page đang canh.
// Thiếu token HOẶC me/accounts rỗng → trả null (KHÔNG crash) → cả lượt lùi chế độ đề-xuất.
async function fbPageToken() {
  const fbToken = process.env.VESI_FB_TOKEN;
  if (!fbToken) { log('KHÔNG có VESI_FB_TOKEN → chế độ CHỈ-ĐỀ-XUẤT'); return null; }
  const u = `https://graph.facebook.com/${FB_VER}/me/accounts?fields=id,access_token`
    + `&access_token=${encodeURIComponent(fbToken)}`;
  const r = await http(u);
  const data = Array.isArray(r?.data) ? r.data : [];
  for (const p of data) {
    if (p.id === PAGE_ID) return p.access_token || null;
  }
  log(`KHÔNG lấy được page token: ${JSON.stringify(r?.__err__ || r).slice(0, 200)}`);
  return null;
}

// ---------- BƯỚC 2c — phân loại tên (VN_SYL nguyên vẹn từ py dòng 98-104) ----------
const VN_SYL = new Set((
  `nguyen tran le pham hoang huynh vo dang bui do ho ngo duong ly thi van anh minh
   ngoc thanh hong phuong thu huong lan hai quang duc dung son tuan hung cuong thang binh long phuc
   loc tho khanh linh trang mai dao dinh truong luu vu ta cao mac diep han quyen nhu kim chau sang
   em chi ba bay tam ut nho nga hoa hue cuc truc quynh giang tien loi hiep bich lien nhan hanh phu
   vinh trinh thoai vuong meo thao bo su kha my sa vy ha tu an yen nhi oanh lieu men muoi sau bac
   tin nghia trung hieu qui quy ky luan chien thien vien toan tai phat dat sinh truyen cu ong co chu
   gia bao nam viet hau nhung tuyet tram thuy xuan dong tay hh be ken beo mi na ni ty ti nu`
).split(/\s+/).filter(Boolean));

function stripDia(s) {
  s = String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function coDauViet(s) {
  return /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/.test(String(s || '').toLowerCase());
}

// Có ký tự thuộc hệ chữ ngoài Latin (Bengali, Devanagari, Ả Rập, CJK, Kirin, Thái, Hangul...).
// Bám py: ch.isalpha() và NOT (ord<0x0250 hoặc 0x1E00<=ord<=0x1EFF).
function chuNgoaiHe(s) {
  for (const ch of String(s || '')) {
    const code = ch.codePointAt(0);
    // "alpha" theo Unicode letter — dùng regex \p{L}
    if (/\p{L}/u.test(ch) && !(code < 0x0250 || (code >= 0x1E00 && code <= 0x1EFF))) {
      return true;
    }
  }
  return false;
}

// SĐT Việt trong NỘI DUNG (comment/snippet). Luật bất biến hiến pháp: có SĐT = khách thật,
// KHÔNG BAO GIỜ chặn — không phụ thuộc cờ has_phone của Pancake (có thể trễ / không bắt số comment).
// Bắt cả 0xxxxxxxxx (10 số), 84xxxxxxxxx, +84xxxxxxxxx; bỏ khoảng trắng/dấu chấm/gạch giữa các cụm số.
function coSdtVN(s) {
  const raw = String(s || '');
  // gộp các chữ số bị ngắt bởi space/./-/() để bắt "09 12 345 678" hay "0912.345.678"
  const goc = raw.replace(/[\s.\-()]+/g, '');
  return /(?:\+?84|0)\d{9}(?!\d)/.test(goc);
}

function phanLoaiTen(name) {
  if (!name || !String(name).trim()) return 'NGHI_NGOAI';
  if (coDauViet(name)) return 'KHACH';
  if (chuNgoaiHe(name)) return 'NGOAI_CHAC';
  const toks = (stripDia(name).match(/[a-z]+/g)) || [];
  if (toks.length === 0) return 'NGOAI_CHAC'; // toàn emoji/ký hiệu
  const hit = toks.filter((t) => VN_SYL.has(t)).length;
  if (hit >= Math.max(1, Math.floor(toks.length / 2))) return 'KHACH';
  return 'NGHI_NGOAI';
}

// ---------- BƯỚC 3b — Gemini chấm ca khó (prompt NGUYÊN VĂN py dòng 134-151) ----------
// Model RIÊNG (KHÔNG dùng generateReply của gemini.js — nó gắn system-prompt tư vấn, sai việc).
let _geminiModel = null;
function getGeminiModel() {
  if (_geminiModel) return _geminiModel;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  _geminiModel = new GoogleGenerativeAI(key).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  });
  return _geminiModel;
}

// Bám repr() của Python (bao quanh bằng nháy đơn, thoát nháy đơn) cho name/snippet trong prompt.
function pyRepr(s) {
  const str = String(s == null ? '' : s);
  return "'" + str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
}

// Trả {ngoai: bool|null, pha_hoai: bool, ly_do}. null = Gemini không trả lời được.
async function geminiCham(name, snippet, laComment = false) {
  const model = getGeminiModel();
  if (!model) return { ngoai: null, pha_hoai: false, ly_do: 'không có GEMINI_API_KEY' };
  const prompt =
    'Bạn là bộ lọc hộp thư của một phòng khám cơ xương khớp tại TP.HCM (khách mục tiêu: '
    + 'người Việt trong nước). Cho tên tài khoản Facebook và '
    + (laComment ? 'nội dung BÌNH LUẬN công khai của người đó' : 'câu nhắn gần nhất trong hội thoại')
    + ', hãy trả về DUY NHẤT một JSON: {"ngoai": true/false, "pha_hoai": true/false, '
    + '"ly_do": "<ngắn gọn tiếng Việt>"}.\n'
    + '- "ngoai" = true nếu tên KHÔNG phải tên người Việt (tên Ấn Độ, Khmer, Philippines, '
    + 'tên rác vô nghĩa, cụm ký tự ngẫu nhiên, tên bot/clone farm).\n'
    + '- "pha_hoai" = true nếu nội dung anti phòng khám/bác sĩ: chửi bới xúc phạm, tố lừa '
    + 'đảo vô căn cứ, kêu người khác đừng đến khám, phá rối, spam link, seeding cho đối thủ.\n'
    + '- QUAN TRỌNG: khách THẬT phàn nàn về trải nghiệm (chờ lâu, giá cao, hỏi lại kết quả '
    + "điều trị...) KHÔNG phải phá hoại → pha_hoai=false, ly_do ghi 'khách phàn nàn'.\n"
    + '- QUAN TRỌNG: nếu nội dung là tin do PHÒNG KHÁM/bot của phòng khám gửi (mở đầu '
    + "'[Botcake]', xưng 'em'/'Dạ', mời để lại SĐT...) thì đó KHÔNG phải lời của khách → "
    + "pha_hoai=false, chỉ chấm 'ngoai' theo TÊN.\n"
    + '- Nghi ngờ 50/50 thì để cả hai = false (thà bỏ sót còn hơn chặn oan khách thật).\n'
    + `Tên: ${pyRepr(name)}\nNội dung: ${pyRepr(snippet)}`;
  try {
    const res = await model.generateContent(prompt);
    const txt = res?.response?.text() || '';
    const m = txt.match(/\{[\s\S]*\}/);
    const v = JSON.parse(m ? m[0] : txt);
    return {
      ngoai: Boolean(v.ngoai),
      pha_hoai: Boolean(v.pha_hoai),
      ly_do: String(v.ly_do || '').slice(0, 120),
    };
  } catch (e) {
    return { ngoai: null, pha_hoai: false, ly_do: `Gemini lỗi: ${e?.message || e}` };
  }
}

// ---------- BƯỚC 1 — Pancake (api/v1, giống py — hợp lệ trong repo, xem pancake.js API_BASE_V1) ----------
async function pkGetConvs(pkToken) {
  const u = `https://pages.fm/api/v1/pages/${PAGE_ID}/conversations?`
    + `access_token=${encodeURIComponent(pkToken)}&limit=${SO_HOI_THOAI}&page=1`;
  const r = await http(u);
  return Array.isArray(r?.conversations) ? r.conversations : [];
}

async function pkGanNhan(pkToken, convId, label) {
  const u = `https://pages.fm/api/v1/pages/${PAGE_ID}/conversations/${convId}/labels?`
    + `access_token=${encodeURIComponent(pkToken)}`;
  try {
    const res = await axios.post(u, { label }, {
      headers: { 'Content-Type': 'application/json' }, timeout: 20000, validateStatus: () => true,
    });
    return res.data;
  } catch (e) {
    return { __err__: String(e?.message || e) };
  }
}

// ---------- BƯỚC 4 — FB block / comment (nguyên văn py dòng 185-232) ----------
async function fbBlock(pageToken, uid, dry = false, kind = 'psid') {
  if (dry) return { dry_run: true };
  const u = `https://graph.facebook.com/${FB_VER}/${PAGE_ID}/blocked`;
  let thu = [{ user: uid }, { asid: JSON.stringify([uid]) }, { psid: JSON.stringify([uid]) }];
  if (kind === 'psid') {
    thu = [{ psid: JSON.stringify([uid]) }, { user: uid }, { asid: JSON.stringify([uid]) }];
  }
  let err = null;
  for (const payload of thu) {
    const body = new URLSearchParams({ ...payload, access_token: pageToken }).toString();
    const r = await http(u, { data: body });
    if (!('__err__' in r)) return r;
    err = r.__err__;
  }
  return { __err__: err };
}

// conv_id Pancake dạng '<post>_<comment>' → lấy phần comment id THẬT sau dấu _ cuối.
// (Graph API ẩn comment nhận comment_id đơn, không nhận '<post>_<comment>'.)
function commentIdThat(convId) {
  const s = String(convId || '');
  return s.includes('_') ? s.split('_').pop() : s;
}

async function fbDocComment(pageToken, commentId) {
  const cid = commentIdThat(commentId);
  const u = `https://graph.facebook.com/${FB_VER}/${cid}?`
    + `fields=${encodeURIComponent('message,from,is_hidden')}&access_token=${encodeURIComponent(pageToken)}`;
  return http(u);
}

async function fbAnComment(pageToken, convId, dry = false) {
  const cid = commentIdThat(convId);
  // đã ẩn rồi thì thôi (coi như thành công, khỏi thử lặp)
  const chkU = `https://graph.facebook.com/${FB_VER}/${cid}?`
    + `fields=is_hidden&access_token=${encodeURIComponent(pageToken)}`;
  const chk = await http(chkU);
  if (chk?.is_hidden === true) return { already_hidden: true };
  if (dry) return { dry_run: true };
  const u = `https://graph.facebook.com/${FB_VER}/${cid}`;
  const body = new URLSearchParams({ is_hidden: 'true', access_token: pageToken }).toString();
  return http(u, { data: body });
}

async function fbUnblock(pageToken, psid) {
  const u = `https://graph.facebook.com/${FB_VER}/${PAGE_ID}/blocked?`
    + `psid=${encodeURIComponent(JSON.stringify([psid]))}&access_token=${encodeURIComponent(pageToken)}`;
  return http(u, { method: 'DELETE' });
}

// ---------- CAPI Lead (khai báo khách tiềm năng cho FB) ----------
function getDatasetId() {
  const fromEnv = process.env.VESI_DATASET;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const fromKv = store.getKV('vesi:dataset-id');
  return fromKv && fromKv.trim() ? fromKv.trim() : null;
}

async function capiLead(pageToken, psid, eventTime, dry = false) {
  const ds = getDatasetId();
  if (!ds) return { skip: 'chưa có dataset CAPI (VESI_DATASET / kv vesi:dataset-id)' };
  const events = [{
    event_name: 'LeadSubmitted',
    event_time: Math.floor(eventTime),
    action_source: 'business_messaging',
    messaging_channel: 'messenger',
    user_data: { page_id: PAGE_ID, page_scoped_user_id: psid },
  }];
  if (dry) return { dry_run: true };
  const u = `https://graph.facebook.com/${FB_VER}/${ds}/events`;
  const body = new URLSearchParams({ data: JSON.stringify(events), access_token: pageToken }).toString();
  return http(u, { data: body });
}

// ---------- Telegram — env riêng VESI_TG_CHAT (group CEO), KHÔNG dùng notifyText (group telesale) ----------
async function tgSend(text, dry = false) {
  if (dry) { log('DRY — Telegram:\n' + text); return; }
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.VESI_TG_CHAT;
  if (!tgToken || !chat) { log('thiếu TELEGRAM_BOT_TOKEN / VESI_TG_CHAT → bỏ gửi Telegram'); return; }
  try {
    const res = await axios.post(`https://api.telegram.org/bot${tgToken}/sendMessage`,
      { chat_id: chat, text }, { timeout: 20000, validateStatus: () => true });
    if (!res?.data?.ok) log(`Telegram lỗi: ${JSON.stringify(res?.data).slice(0, 200)}`);
  } catch (e) {
    log(`Telegram lỗi: ${e?.message || e}`);
  }
}

// ---------- STATE qua KV store.js (thay da-xu-ly.json / so-chan.ndjson) ----------
// vesi:state:<conv_id>  → {verdict, action, ts(ISO UTC)}   (chống chấm/chặn lặp)
// vesi:chan:<psid>      → {ts,name,conv,type,verdict,ok,an_comment,noi_dung,resp,go_chan}
function getState(cid) {
  const raw = store.getKV(`vesi:state:${cid}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function setState(cid, obj) {
  store.setKV(`vesi:state:${cid}`, JSON.stringify(obj));
}
function delState(cid) {
  store.delKV(`vesi:state:${cid}`);
}
function ghiSoChan(psid, obj) {
  store.setKV(`vesi:chan:${psid}`, JSON.stringify(obj));
}
// dựng set psid từng chặn LỖI (ok===false) từ KV vesi:chan:*
function loadDaBaoLoi() {
  const s = new Set();
  for (const row of store.listKVByPrefix('vesi:chan:')) {
    try { const d = JSON.parse(row.value); if (d && d.ok === false) s.add(d.psid); } catch { /* bỏ dòng hỏng */ }
  }
  return s;
}

// ISO UTC "YYYY-MM-DDTHH:MM:SS.sss..." → epoch giây (parse an toàn, bám datetime.fromisoformat py)
function isoToEpoch(ts) {
  if (!ts) return NaN;
  // py cắt phần sau '.' rồi coi là NAIVE UTC → ép hậu tố Z để JS hiểu là UTC.
  const base = String(ts).split('.')[0];
  const d = new Date(base + 'Z');
  return d.getTime();
}
function nowIsoUtc() {
  return new Date().toISOString().replace('Z', ''); // NAIVE UTC như datetime.utcnow().isoformat()
}

// ---------- main (port main() py dòng 244-409) ----------
// runVesi({ dry, force, unblock })
export async function runVesi(opts = {}) {
  let { dry = false, force = false, unblock = null, clearDryChan = false } = opts;

  // Dọn state 'chan' bị ghi lỡ lúc chạy DRY (fbBlock trả dry_run, CHƯA chặn thật) — xóa để
  // lượt LIVE chặn lại thật. Chỉ xóa ca chưa có trong sổ-chặn-thật (vesi:chan:<psid> ok=true).
  if (clearDryChan) {
    const chanThat = new Set();
    for (const row of store.listKVByPrefix('vesi:chan:')) {
      try { const d = JSON.parse(row.value); if (d && d.ok === true) chanThat.add(String(d.conv)); } catch { /* bỏ */ }
    }
    let xoa = 0;
    for (const row of store.listKVByPrefix('vesi:state:')) {
      try {
        const d = JSON.parse(row.value);
        const cid = row.key.replace('vesi:state:', '');
        if (d && d.action === 'chan' && !chanThat.has(cid)) { store.delKV(row.key); xoa += 1; }
      } catch { /* bỏ */ }
    }
    log(`clearDryChan: xóa ${xoa} state 'chan' ghi lỡ lúc DRY`);
    return { clearDryChan: true, da_xoa: xoa };
  }

  // khung giờ 7h–22h giờ VN (cron gọi trong 7-22 nhưng vẫn guard phòng lệch)
  const gioVN = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
  if (!force && !dry && !(gioVN >= 7 && gioVN <= 22)) {
    log(`ngoài khung 7-22h (giờ VN=${gioVN}) → ngủ`);
    return { skipped: 'ngoai_gio' };
  }

  // token: endpoint Pancake api/v1 (pkGetConvs/pkGanNhan) CẦN USER token, KHÔNG phải page token.
  // getUserToken tự đọc kv pancake_user_token rồi env PANCAKE_API_TOKEN (giống canh-pha-hoai.py
  // dùng pk['PANCAKE_API_TOKEN']). Dùng page token vào v1 sẽ lỗi auth / trả 0 hội thoại → vệ sĩ im.
  const pkToken = getUserToken();
  if (!pkToken) {
    log('thiếu USER token Pancake (kv pancake_user_token / PANCAKE_API_TOKEN) → SKIP, không crash bot');
    return { skipped: 'thieu_pancake_token' };
  }

  // nhánh --unblock <psid>
  if (unblock) {
    const pt = await fbPageToken();
    if (!pt) return { unblock, ket_qua: 'không có page token (thiếu VESI_FB_TOKEN)' };
    const r = await fbUnblock(pt, unblock);
    log(`unblock ${unblock}: ${JSON.stringify(r).slice(0, 200)}`);
    return { unblock, ket_qua: r };
  }

  const daBaoLoi = loadDaBaoLoi();
  const convs = await pkGetConvs(pkToken);
  if (!convs || convs.length === 0) {
    log('Pancake trả 0 hội thoại — token hỏng? DỪNG, không bịa.');
    return { skipped: 'pancake_0_conv' };
  }
  const han = Date.now() - NGAY_CU * 86400 * 1000;

  // lazy-load page token (cache 1 lần). null → cả lượt lùi chế độ đề-xuất.
  let pageToken;
  let pageTokenLoaded = false;
  const layPt = async () => {
    if (!pageTokenLoaded) { pageToken = await fbPageToken(); pageTokenLoaded = true; }
    return pageToken;
  };

  // dry = true NẾU tham số dry, HOẶC VESI_DRY !== '0', HOẶC thiếu page token FB (tự lùi đề-xuất).
  if (process.env.VESI_DRY !== '0') dry = true;
  const ptCheck = await layPt();
  if (!ptCheck) {
    dry = true; // thiếu token FB → CHỈ-ĐỀ-XUẤT (chấm + báo Telegram, KHÔNG block/CAPI)
    log('thiếu page token FB → tự lùi CHẾ ĐỘ ĐỀ-XUẤT (không block/CAPI)');
  }

  const chan = [];      // [name, uid, verdict, ok, resp]
  const deXuat = [];    // [name, verdict, cid]  (chế độ đề-xuất khi dry vì thiếu token)
  const leadMoi = [];   // [cid, name, uid, updated_at]
  const anCmt = [];     // [name, noi_dung]

  for (const cv of convs) {
    const kieu = cv?.type;
    if (kieu !== 'INBOX' && kieu !== 'COMMENT') continue;
    const cid = cv?.id || '';

    // chống lặp + tự kiểm chặn hụt (nguyên văn py 295-304)
    const cu = getState(cid);
    if (cu) {
      const moi = cv?.last_customer_interactive_at || '';
      if (cu.action === 'chan' && moi && moi > (cu.ts || '9')) {
        log(`CHẶN HỤT? ${cid} còn nhắn lúc ${moi} sau khi chặn ${cu.ts} — xử lại`);
        delState(cid);
      } else {
        continue;
      }
    }

    // lọc thời gian (bỏ tương tác cũ hơn NGAY_CU ngày). Parse lỗi thì vẫn xử (bám py).
    const ts = cv?.last_customer_interactive_at || cv?.updated_at || '';
    const tsEpoch = isoToEpoch(ts);
    if (!Number.isNaN(tsEpoch) && tsEpoch < han) continue;

    const name = (cv?.from || {}).name || '';
    const uid = cv?.from_psid || (cv?.from || {}).id;
    const kind = cv?.from_psid ? 'psid' : 'user';
    let noiDung = String(cv?.snippet || '').slice(0, 300);
    let docDuocCmt = false;
    if (kieu === 'COMMENT') {
      // snippet Pancake là tin MỚI NHẤT (thường bot mình) → đọc comment THẬT qua Graph API
      const pt = await layPt();
      const c = pt ? await fbDocComment(pt, cid) : {};
      if (c?.message) { noiDung = String(c.message).slice(0, 300); docDuocCmt = true; }
    }
    // "có SĐT" = cờ Pancake has_phone HOẶC có SĐT VN trong nội dung tin/comment thật
    // (luật bất biến: khách để lại số = khách thật, KHÔNG BAO GIỜ chặn kể cả khi Pancake chưa gắn cờ).
    const hasPhone = Boolean(cv?.has_phone) || coSdtVN(noiDung);

    const loai = phanLoaiTen(name);
    let verdict = loai;
    let action = 'bo_qua';

    // Khách có SĐT = lead thật → khai báo cho FB học (KHÔNG BAO GIỜ chặn)
    if (hasPhone) {
      verdict = 'KHACH_LEAD'; action = 'capi_lead';
      leadMoi.push([cid, name, uid, cv?.updated_at]);
    } else if (loai === 'NGOAI_CHAC' && uid) {
      action = 'chan';
    } else if (uid && kieu === 'COMMENT' && !docDuocCmt) {
      // chưa đọc được nội dung comment thật → snippet là tin bot mình → chỉ xử tên ngoại.
      // KHÔNG lưu state (để lượt sau có quyền chấm lại từ đầu) — nguyên văn py 337-342.
      if (loai === 'NGHI_NGOAI') {
        const g = await geminiCham(name, '(chưa đọc được nội dung comment)');
        if (g.ngoai === true) { verdict = `NGOAI_GEMINI(${g.ly_do})`; action = 'chan'; }
      }
      if (action !== 'chan') continue;
    } else if (uid && (loai === 'NGHI_NGOAI' || kieu === 'COMMENT')) {
      // tên Latin lạ, hoặc COMMENT đọc được nội dung thật (soi anti/phá hoại)
      const g = await geminiCham(name, noiDung, kieu === 'COMMENT');
      if (g.ngoai === true) { verdict = `NGOAI_GEMINI(${g.ly_do})`; action = 'chan'; }
      else if (g.pha_hoai) { verdict = `PHA_HOAI(${g.ly_do})`; action = 'chan'; } // lệnh anh Trình 14/07
      else if (loai === 'NGHI_NGOAI') { verdict = `NGHI_NGOAI_THA(${g.ly_do})`; action = 'bo_qua'; }
    }

    if (action === 'chan' && chan.length < TRAN_CHAN) {
      // CHẾ ĐỘ ĐỀ-XUẤT (dry vì thiếu token FB): chỉ gom danh sách đề xuất, KHÔNG block/CAPI/nhãn.
      if (!ptCheck) {
        deXuat.push([name, verdict, cid]);
        continue; // không lưu state → lượt sau (có token) xử thật
      }
      const pt = await layPt();
      const r = pt ? await fbBlock(pt, uid, dry, kind) : { __err__: 'no page token' };
      const ok = !('__err__' in r);
      const nhan = verdict.startsWith('PHA_HOAI') ? '🚫 PHÁ HOẠI' : '🚫 NGOẠI-ẢO';

      // ẩn comment phá hoại/ngoại (an_ok=true nếu ẩn được HOẶC đã ẩn sẵn từ lượt trước)
      let anOk = null;
      if (kieu === 'COMMENT') {
        const ra = pt ? await fbAnComment(pt, cid, dry) : { __err__: 'no page token' };
        anOk = !('__err__' in ra);
        if (anOk && !dry && !ra.already_hidden) anCmt.push([name, noiDung.slice(0, 60)]);
      }

      if (!daBaoLoi.has(uid)) { // lần đầu → gắn nhãn + đưa vào báo cáo
        await pkGanNhan(pkToken, cid, ok ? `${nhan} ĐÃ CHẶN` : `${nhan} (chặn lỗi)`);
        chan.push([name, uid, verdict, ok, JSON.stringify(r).slice(0, 150)]);
      } else if (ok) { // chặn lỗi trước đây, giờ đã thông (token được cấp quyền)
        await pkGanNhan(pkToken, cid, `${nhan} ĐÃ CHẶN`);
        chan.push([name, uid, verdict, ok, 'thử lại thành công']);
      }

      ghiSoChan(uid, {
        ts: new Date().toISOString(), psid: uid, name, conv: cid, type: kieu,
        verdict, ok, an_comment: anOk, noi_dung: noiDung.slice(0, 100), resp: r,
        go_chan: `runVesi({ unblock: '${uid}' })`,
      });

      // DRY: fbBlock trả {dry_run} → CHƯA chặn thật ai. TUYỆT ĐỐI KHÔNG lưu state 'chan',
      // nếu không lượt LIVE sau sẽ bỏ qua ca này (getState+continue) = account ngoại/ảo LỌT,
      // không bao giờ bị chặn thật. (Cùng lớp lỗi dry-ghi-state như nhánh CAPI.)
      if (dry) continue; // đề-xuất/test → để lượt LIVE chặn thật + ghi state

      // CHỐNG LẶP 16/07 (nguyên văn py 377-390): chặn OK là LƯU STATE NGAY, kể cả ẩn comment
      // còn trục trặc — nếu không sẽ chặn+báo mỗi 30' cho ca đã xử. Ẩn comment hụt tự retry
      // lượt sau qua fbAnComment (đã ẩn sẵn = coi như xong). CHỈ chặn hụt (!ok) mới không lưu.
      if (!ok) continue; // chặn hụt → lượt sau thử chặn lại
    }

    if (action === 'capi_lead') continue; // state lead chỉ ghi sau khi CAPI xác nhận
    // ts lưu UTC để so được với last_customer_interactive_at của Pancake (UTC)
    setState(cid, { verdict, action, ts: nowIsoUtc() });
  }

  // ---------- CAPI lead thật — chỉ đánh dấu đã-xử-lý khi FB xác nhận (py 392-406) ----------
  let capiOk = 0, capiSkip = 0;
  for (const [cid, name, psid, upd] of leadMoi) {
    let et = isoToEpoch(upd);
    et = Number.isNaN(et) ? Date.now() / 1000 : et / 1000;
    if (!getDatasetId()) { capiSkip += 1; continue; } // chưa có dataset → giữ lead, có là bắn bù
    const pt = await layPt();
    if (!pt) { capiSkip += 1; continue; } // thiếu page token → chế độ đề-xuất, giữ lead lại
    const r = await capiLead(pt, psid, et, dry);
    if (r?.events_received) {
      // FB xác nhận THẬT → đánh dấu đã khai báo (chống bắn lặp lượt sau)
      capiOk += 1;
      setState(cid, { verdict: 'KHACH_LEAD', action: 'capi_ok', ts: new Date().toISOString() });
    } else if (r?.dry_run) {
      // DRY: chưa gửi gì lên FB → CHỈ đếm để báo cáo, TUYỆT ĐỐI KHÔNG setState('capi_ok').
      // Nếu ghi state ở đây, lượt live (VESI_DRY=0) sau sẽ bỏ qua conv này (dòng getState+continue)
      // → lead THẬT không bao giờ được bắn lên FB = nuốt mất lead.
      capiOk += 1;
    } else {
      log(`CAPI lỗi ${name}: ${JSON.stringify(r).slice(0, 200)}`);
    }
  }

  // ---------- gom báo cáo Telegram bản gọn (py 410-427) ----------
  if (chan.length || deXuat.length || anCmt.length) {
    const msg = ['🛡 VỆ SĨ HỘP THƯ' + (dry ? ' (ĐỀ-XUẤT/DRY)' : '')];
    if (chan.length) {
      msg.push(`Đã ${dry ? 'ĐỀ XUẤT chặn' : 'chặn'} ${chan.length} tài khoản ngoại/ảo/phá hoại (không SĐT):`);
      for (const [n, , v, ok, resp] of chan) {
        msg.push(`  ${ok ? '✅' : '❌'} ${n} — ${v}` + (ok ? '' : ` (lỗi: ${resp})`));
      }
    }
    if (anCmt.length) {
      msg.push(`🙈 Đã ẩn ${anCmt.length} bình luận phá hoại/ngoại:`);
      for (const [n, nd] of anCmt) msg.push(`  • ${n}: «${nd}...»`);
      msg.push('Gỡ nhầm: runVesi({ unblock: "<psid>" }) (sổ: KV vesi:chan:*)');
    }
    if (deXuat.length) {
      msg.push(`⚠️ ĐỀ XUẤT anh xem ${deXuat.length} ca cần chặn (chưa cấp VESI_FB_TOKEN nên KHÔNG tự chặn):`);
      for (const [n, v, c] of deXuat) msg.push(`  • ${n} — ${v} — https://pancake.vn/${PAGE_ID}?c_id=${c}`);
    }
    if (capiOk) msg.push(`📤 Đã khai báo ${capiOk} lead thật cho FB (CAPI).`);
    if (capiSkip) msg.push(`ℹ️ ${capiSkip} lead chưa khai báo được — chưa có dataset/token CAPI.`);
    await tgSend(msg.join('\n'), dry);
  }
  log(`Xong: quét ${convs.length} | chặn ${chan.length} | đề xuất ${deXuat.length} | lead CAPI ${capiOk} ok/${capiSkip} chờ`);
  return {
    quet: convs.length, chan: chan.length, de_xuat: deXuat.length,
    capi_ok: capiOk, capi_skip: capiSkip, dry,
  };
}

export default { runVesi };
