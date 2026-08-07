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
import { getUserToken, goiPancake } from './pancake.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const PAGE_ID = '957014354156110';   // page Dr Nhật Trình
const NGAY_CU = 14;                   // chỉ xét hội thoại tương tác trong N ngày gần đây
const TRAN_CHAN = 10;                 // tối đa số PSID chặn mỗi lượt chạy
const TIN_KHACH_LA_THAT = 3;          // khách tự gõ ≥ N tin có nội dung → ĐANG đối thoại thật, cấm chặn
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
// HÀNG RÀO KHÁCH THẬT (vá 07/08/2026 — ca Nick Chan, xem [[vesi-tach-2-nac-an-chan]]).
// INBOX trước đây chấm trên `snippet`, mà snippet là tin BOT MÌNH vừa gửi → thực chất chỉ còn
// cái TÊN để phán → người Đài Loan đã chốt lịch khám bị chặn vì "tên không phải người Việt".
// Trả (số tin khách TỰ GÕ có nội dung, 3 câu gần nhất) để vừa dựng hàng rào vừa cho Gemini
// chấm trên LỜI KHÁCH. Lỗi mạng → trả 0 (không tự tiện tha, để nhánh cũ xử như trước).
async function loiKhach(cv) {
  const cid = cv?.id || '';
  const cus = (cv?.customers || [])[0]?.id;
  const psid = String(cv?.from_psid || (cv?.from || {}).id || '');
  if (!cid || !cus || !psid) return { soTin: 0, cau: '' };
  const r = await goiPancake({
    method: 'get', pageId: PAGE_ID, duongDan: `/conversations/${cid}/messages`,
    params: { customer_id: cus }, viec: 'vệ sĩ đọc lời khách',
  });
  if (!r?.ok) return { soTin: 0, cau: '' };
  const ds = r?.data?.messages || [];
  const cau = ds
    .filter((m) => String((m?.from || {}).id || '') === psid)
    .map((m) => String(m?.message || m?.text || '').trim())
    .filter(Boolean);
  return { soTin: cau.length, cau: cau.slice(-3).join(' | ').slice(0, 400) };
}

// True nếu ANH TRÌNH đã tự bấm chặn ca này trong Pancake.
// Đo thật 07/08/2026: Pancake giữ cờ `is_banned` trên KHÁCH, chỉ bật khi chặn QUA PANCAKE —
// máy chặn qua Graph API KHÔNG bật (Nick Chan is_banned=false dù đã chặn thật; Trung Hà anh
// bấm tay thì is_banned=true). Nhờ đó phân biệt "anh đã xử" với "chưa ai đụng" → hết báo lại
// ca anh vừa bấm xong. Lỗi mạng → false (thà báo thừa còn hơn nuốt mất ca chưa xử).
async function anhDaChan(cv) {
  const cus = (cv?.customers || [])[0]?.id;
  if (!cus) return false;
  const r = await goiPancake({
    method: 'get', pageId: PAGE_ID, duongDan: `/customers/${cus}`,
    viec: 'vệ sĩ soi anh đã chặn chưa',
  });
  if (!r?.ok) return false;
  return Boolean(r?.data?.data?.is_banned);
}

// ANH ĐÃ XEM RỒI MÀ KHÔNG CHẶN = kết luận "tha" (anh Trình hỏi 07/08: "nó đề xuất, anh vào xem
// hội thoại không muốn chặn thì làm sao cho nó im?"). Pancake ghi sẵn `recent_seen_users` —
// ai mở hội thoại, lúc mấy giờ. Anh mở xem SAU tin cuối của khách mà không bấm chặn
// (is_banned vẫn false) → coi như đã duyệt qua → im. Khách nhắn tiếp thì mốc khách vượt lên
// trên mốc xem → tình huống mới → báo lại. Không tốn thêm 1 cú bấm nào của anh.
const FB_ID_ANH = process.env.VESI_FB_ID_ANH || '1143287012411428'; // Phan Nhật Trình
const NHAN_DONE = 59; // nhãn "Done" trong Pancake — anh gắn = dứt điểm, im vĩnh viễn

function anhDaXemMaKhongChan(cv) {
  const mocXem = (cv?.recent_seen_users || [])
    .filter((u) => String(u?.fb_id) === FB_ID_ANH)
    .map((u) => String(u?.seen_at || ''))
    .filter(Boolean)
    .sort()
    .pop();
  if (!mocXem) return false;
  // cả 2 mốc đều là ISO naive UTC của Pancake → so chuỗi là đủ, khỏi parse
  const mocKhach = String(cv?.last_customer_interactive_at || cv?.updated_at || '');
  return mocKhach ? mocXem > mocKhach : true;
}

function daGanNhanDone(cv) {
  return (cv?.tags || []).some((t) => Number(t?.id ?? t) === NHAN_DONE);
}

async function geminiCham(name, snippet, laComment = false) {
  const model = getGeminiModel();
  if (!model) return { ngoai: null, pha_hoai: false, ly_do: 'không có GEMINI_API_KEY' };
  const prompt =
    'Bạn là bộ lọc hộp thư của một phòng khám cơ xương khớp tại TP.HCM (khách mục tiêu: '
    + 'người Việt trong nước). Cho tên tài khoản Facebook và '
    + (laComment ? 'nội dung BÌNH LUẬN công khai của người đó' : 'câu nhắn gần nhất trong hội thoại')
    + ', hãy trả về DUY NHẤT một JSON: {"ngoai": true/false, "pha_hoai": true/false, '
    + '"chac": <0-100>, "ly_do": "<ngắn gọn tiếng Việt>"}.\n'
    + '- "ngoai" = true CHỈ KHI tài khoản là ẢO/RÁC/farm: tên rác vô nghĩa, cụm ký tự ngẫu '
    + 'nhiên, nick clone, spam link, không có nhu cầu khám gì cả.\n'
    + '- ⛔ TÊN NƯỚC NGOÀI KHÔNG PHẢI LÀ TỘI. TP.HCM có rất nhiều người Đài Loan, Trung, Hàn, '
    + 'Nhật, Ấn, Âu-Mỹ sinh sống và làm ăn — họ đau xương khớp thì đến khám như mọi người. '
    + 'Người nước ngoài đang KỂ BỆNH, hỏi giá, hỏi đường, xin lịch, gửi phim X-quang = KHÁCH '
    + 'THẬT → ngoai=false. Chặn nhầm là mất khách VĨNH VIỄN. (Ca thật 07/08/2026: "Nick Chan" '
    + 'người Đài Loan đau tay trái, đã chốt lịch khám 9h30 Chủ Nhật, bị chặn oan vì cái tên.)\n'
    + '- "pha_hoai" = true nếu nội dung anti phòng khám/bác sĩ: chửi bới xúc phạm, tố lừa '
    + 'đảo vô căn cứ, kêu người khác đừng đến khám, phá rối, spam link, seeding cho đối thủ.\n'
    + '- "chac" = độ CHẮC CHẮN của phán đoán (0-100). CHỈ ghi ≥95 khi CỰC KỲ rõ ràng, không '
    + 'còn chút nghi ngờ nào (chửi thề tục tĩu, tố lừa đảo trắng trợn, tên rác hiển nhiên). '
    + 'Còn mập mờ, mỉa mai, cộc lốc, tiếng lóng vùng miền → để chac THẤP (dưới 80).\n'
    + '- QUAN TRỌNG: khách THẬT phàn nàn về trải nghiệm (chờ lâu, giá cao, hỏi lại kết quả '
    + "điều trị, chửi thề vì BỨC XÚC do không ai bắt máy...) KHÔNG phải phá hoại → pha_hoai=false, ly_do ghi 'khách phàn nàn'.\n"
    + '- QUAN TRỌNG: nếu nội dung là tin do PHÒNG KHÁM/bot của phòng khám gửi (mở đầu '
    + "'[Botcake]', xưng 'em'/'Dạ', mời để lại SĐT...) thì đó KHÔNG phải lời của khách → "
    + "pha_hoai=false, chỉ chấm 'ngoai' theo TÊN — và nhớ luật trên: tên nước ngoài KHÔNG "
    + 'phải là tội, chỉ tên RÁC/clone mới tính.\n'
    + '- Nghi ngờ 50/50 thì để cả hai = false (thà bỏ sót còn hơn chặn oan khách thật).\n'
    + `Tên: ${pyRepr(name)}\nNội dung: ${pyRepr(snippet)}`;
  try {
    const res = await model.generateContent(prompt);
    const txt = res?.response?.text() || '';
    const m = txt.match(/\{[\s\S]*\}/);
    const v = JSON.parse(m ? m[0] : txt);
    let chac = Number.isFinite(+v.chac) ? Math.max(0, Math.min(100, +v.chac)) : 0;
    return {
      ngoai: Boolean(v.ngoai),
      pha_hoai: Boolean(v.pha_hoai),
      chac,
      ly_do: String(v.ly_do || '').slice(0, 120),
    };
  } catch (e) {
    return { ngoai: null, pha_hoai: false, chac: 0, ly_do: `Gemini lỗi: ${e?.message || e}` };
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
// vesi:dexuat:<conv_id> → {ts(ISO UTC), moc}  — SỔ CHỐNG BÁO LẶP ca CHỜ ANH DUYỆT.
// Bug anh Trình bắt 07/08/2026: ca chờ duyệt KHÔNG được lưu state (cố ý, để lượt sau còn xử
// thật) → cứ 30' quét lại là báo Telegram y hệt, kể cả khi anh đã tự tay chặn ngoài FB
// (vệ sĩ không nhìn thấy thao tác tay). Từ nay chỉ nhắc lại khi:
//   (a) khách nhắn/comment MỚI hơn mốc lần đề xuất trước, hoặc
//   (b) đã quá VESI_DEXUAT_NHAC_GIO giờ (mặc định 24) — để việc tồn không chìm hẳn.
function canBaoDeXuat(cid, moc, nhacGio) {
  const raw = store.getKV(`vesi:dexuat:${cid}`);
  if (!raw) return true;
  let cu = null;
  try { cu = JSON.parse(raw); } catch { return true; }
  if (!cu) return true;
  if (moc && cu.moc && String(moc) > String(cu.moc)) return true; // khách vừa nhắn/comment tiếp
  const truoc = isoToEpoch(cu.ts);
  if (Number.isNaN(truoc)) return true;
  return Date.now() - truoc >= nhacGio * 3600 * 1000;
}
function ghiSoDeXuat(cid, moc) {
  store.setKV(`vesi:dexuat:${cid}`, JSON.stringify({ ts: nowIsoUtc(), moc: moc || '' }));
}
function xoaSoDeXuat(cid) {
  store.delKV(`vesi:dexuat:${cid}`);
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

  // ─── TÁCH 2 NẤC (anh Trình chốt 26/07): ẨN comment ≠ CHẶN user ───
  //   ẨN comment  = ĐẢO NGƯỢC ĐƯỢC (gỡ ẩn 1 lệnh) → cho AUTO khi Gemini chắc cao.
  //   CHẶN user + report FB = KHÔNG đảo ngược (mất khách vĩnh viễn + FB phạt Page nếu report bừa)
  //                          → mặc định CHỜ ANH DUYỆT trên Telegram, KHÔNG tự chặn.
  // Bài học: chặn nhầm khách bức xúc chính đáng / người nhà = mất khách thật (cùng gia đình
  // lỗi 46 lead bot tự câm 23/07, nhưng chặn thì KHÔNG cứu lại được).
  //   VESI_AN_AUTO=1   → tự ẩn comment phá hoại khi chac ≥ VESI_AN_NGUONG (mặc định BẬT khi có token)
  //   VESI_CHAN_AUTO=1 → tự chặn user (mặc định TẮT — gom đề xuất chờ anh bấm)
  //   VESI_AN_NGUONG   → ngưỡng độ-chắc để auto ẩn (mặc định 95)
  const AN_AUTO = process.env.VESI_AN_AUTO !== '0';        // mặc định BẬT (ẩn reversible)
  const CHAN_AUTO = process.env.VESI_CHAN_AUTO === '1';    // mặc định TẮT (chặn chờ duyệt)
  const AN_NGUONG = parseInt(process.env.VESI_AN_NGUONG || '95', 10);

  //   VESI_DEXUAT_NHAC_GIO → bao lâu mới nhắc lại 1 ca chờ duyệt chưa xử (mặc định 24 giờ)
  const NHAC_GIO = parseInt(process.env.VESI_DEXUAT_NHAC_GIO || '24', 10);

  const chan = [];      // [name, uid, verdict, ok, resp]
  const thaThat = [];   // [name, verdict, cid] — tên ngoại nhưng ĐANG đối thoại thật → hàng rào giữ
  const deXuat = [];    // [name, verdict, cid]  (chế độ đề-xuất khi dry vì thiếu token)
  let imDeXuat = 0;     // số ca chờ duyệt đã báo trước đó → lượt này im (chống spam 30'/lần)
  // gom 1 cửa: mọi đề xuất đều qua đây để đi qua sổ chống lặp vesi:dexuat:*
  const themDeXuat = (n, v, c, moc) => {
    if (!canBaoDeXuat(c, moc, NHAC_GIO)) { imDeXuat += 1; return false; }
    deXuat.push([n, v, c]);
    ghiSoDeXuat(c, moc);
    return true;
  };
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
      // Xử lại khi có tương tác MỚI hơn kết luận cũ. Gồm cả ca anh đã xem-mà-tha / hàng rào tha:
      // khách im thì thôi, khách nhắn tiếp là tình huống mới, phải soi lại. Riêng ca anh đã
      // CHẶN hoặc gắn DONE thì im vĩnh viễn, không dựng dậy nữa.
      const xuLai = ['chan', 'anh_xem_tha', 'tha'].includes(cu.action);
      if (xuLai && moi && moi > (cu.ts || '9')) {
        log(`CHẶN HỤT? ${cid} còn nhắn lúc ${moi} sau khi chặn ${cu.ts} — xử lại`);
        delState(cid);
      } else {
        continue;
      }
    }

    // lọc thời gian (bỏ tương tác cũ hơn NGAY_CU ngày). Parse lỗi thì vẫn xử (bám py).
    const ts = cv?.last_customer_interactive_at || cv?.updated_at || '';
    const mocMoi = cv?.last_customer_interactive_at || ts; // mốc so "khách có nhắn tiếp không"
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

    // ── HÀNG RÀO KHÁCH THẬT: ai đã tự gõ ≥ TIN_KHACH_LA_THAT tin có nội dung thì là người
    // đang hỏi bệnh — CẤM chặn/ẩn, dù tên nước nào. Rác thật hầu như nhắn 1 tin rồi im.
    if (kieu === 'INBOX' && uid && !hasPhone && loai !== 'KHACH') {
      const { soTin, cau } = await loiKhach(cv);
      if (cau) noiDung = cau; // Gemini chấm trên LỜI KHÁCH, không phải tin bot
      if (soTin >= TIN_KHACH_LA_THAT) {
        const v = `THA_DANG_DOI_THOAI(${soTin} tin khách tự gõ)`;
        thaThat.push([name, v, cid]);
        setState(cid, { verdict: v, action: 'tha', ts: nowIsoUtc() });
        continue;
      }
    }
    let chacCham = 0; // độ chắc Gemini chấm (0 = không qua Gemini, vd NGOAI_CHAC theo bảng chữ)

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
      if (g.ngoai === true) { verdict = `NGOAI_GEMINI(${g.ly_do})`; action = 'chan'; chacCham = g.chac; }
      else if (g.pha_hoai) { verdict = `PHA_HOAI(${g.ly_do})`; action = 'chan'; chacCham = g.chac; } // lệnh anh Trình 14/07
      else if (loai === 'NGHI_NGOAI') { verdict = `NGHI_NGOAI_THA(${g.ly_do})`; action = 'bo_qua'; }
    }

    // ── BA ĐƯỜNG ANH KẾT LUẬN, MÁY IM (không cần thêm cú bấm nào ngoài việc anh vốn đã làm) ──
    if (action === 'chan') {
      // 1. Anh gắn nhãn "Done" → dứt điểm, im VĨNH VIỄN kể cả khách nhắn tiếp.
      if (daGanNhanDone(cv)) {
        setState(cid, { verdict: `ANH_GAN_DONE(${verdict})`, action: 'anh_done', ts: nowIsoUtc() });
        xoaSoDeXuat(cid);
        log(`anh gắn nhãn Done cho ${name} → im vĩnh viễn`);
        continue;
      }
      // 2. Anh đã bấm chặn trong Pancake → xong việc, im.
      if (await anhDaChan(cv)) {
        setState(cid, { verdict: `ANH_DA_CHAN_TRONG_PANCAKE(${verdict})`, action: 'anh_da_chan', ts: nowIsoUtc() });
        xoaSoDeXuat(cid);
        log(`anh đã tự chặn ${name} trong Pancake → im, không báo lại`);
        continue;
      }
      // 3. Anh mở xem sau tin cuối của khách mà KHÔNG chặn → kết luận "tha" → im tới khi
      //    khách có tương tác mới (lúc đó mốc khách vượt mốc xem, state bị xoá, báo lại).
      if (anhDaXemMaKhongChan(cv)) {
        setState(cid, { verdict: `ANH_XEM_ROI_KHONG_CHAN(${verdict})`, action: 'anh_xem_tha', ts: nowIsoUtc() });
        xoaSoDeXuat(cid);
        log(`anh đã xem ${name} mà không chặn → hiểu là tha, im`);
        continue;
      }
    }

    if (action === 'chan' && chan.length < TRAN_CHAN) {
      // CHẾ ĐỘ ĐỀ-XUẤT (dry vì thiếu token FB): chỉ gom danh sách đề xuất, KHÔNG block/CAPI/nhãn.
      if (!ptCheck) {
        themDeXuat(name, verdict, cid, mocMoi);
        continue; // không lưu state → lượt sau (có token) xử thật
      }
      const pt = await layPt();
      const nhan = verdict.startsWith('PHA_HOAI') ? '🚫 PHÁ HOẠI' : '🚫 NGOẠI-ẢO';

      // ── NẤC 1: ẨN comment — ĐẢO NGƯỢC ĐƯỢC → cho AUTO khi chắc cao ──
      // NGOAI_CHAC (chấm theo bảng chữ, không qua Gemini) coi như đủ chắc. Qua Gemini thì
      // đòi chac ≥ AN_NGUONG (mặc định 95). dry chung (thiếu token / --dry) vẫn chặn ẩn thật.
      const duChacDeAn = chacCham === 0 ? true : chacCham >= AN_NGUONG;
      const anThat = AN_AUTO && !dry && kieu === 'COMMENT' && duChacDeAn;
      let anOk = null;
      if (kieu === 'COMMENT') {
        const ra = anThat ? await fbAnComment(pt, cid, false) : { dry_run: true };
        anOk = !('__err__' in ra);
        if (anThat && anOk && !ra.already_hidden) anCmt.push([name, noiDung.slice(0, 60)]);
        else if (kieu === 'COMMENT' && !anThat && !dry) {
          // đủ điều kiện chặn nhưng CHƯA đủ chắc để tự ẩn → đưa vào đề xuất cho anh xem
          themDeXuat(name, `${verdict} · chắc ${chacCham}% (dưới ${AN_NGUONG}, chưa tự ẩn)`, cid, mocMoi);
        }
      }

      // ── NẤC 2: CHẶN user + report — KHÔNG đảo ngược → mặc định CHỜ ANH DUYỆT ──
      // Chỉ tự chặn khi CHAN_AUTO=1. Mặc định: gom đề xuất, KHÔNG gọi fbBlock.
      const chanThat = CHAN_AUTO && !dry;
      if (!chanThat) {
        // chưa tự chặn → đề xuất cho anh bấm (tránh trùng dòng đề xuất "chưa tự ẩn" ở trên)
        if (!(kieu === 'COMMENT' && AN_AUTO && !dry && !duChacDeAn)) {
          themDeXuat(name, `${verdict}${chacCham ? ` · chắc ${chacCham}%` : ''} → CHỜ DUYỆT CHẶN`, cid, mocMoi);
        }
        // vẫn ghi sổ để biết đã ẩn (nếu có), nhưng KHÔNG ghi state 'chan' → lượt sau anh còn xử được
        if (anThat && anOk) {
          ghiSoChan(uid, {
            ts: new Date().toISOString(), psid: uid, name, conv: cid, type: kieu,
            verdict, ok: false, an_comment: anOk, chac: chacCham, noi_dung: noiDung.slice(0, 100),
            resp: { chi_an_chua_chan: true }, go_chan: `runVesi({ unblock: '${uid}' })`,
          });
        }
        continue;
      }

      // CHAN_AUTO=1 → chặn thật
      const r = await fbBlock(pt, uid, false, kind);
      const ok = !('__err__' in r);

      if (!daBaoLoi.has(uid)) { // lần đầu → gắn nhãn + đưa vào báo cáo
        await pkGanNhan(pkToken, cid, ok ? `${nhan} ĐÃ CHẶN` : `${nhan} (chặn lỗi)`);
        chan.push([name, uid, verdict, ok, JSON.stringify(r).slice(0, 150)]);
      } else if (ok) { // chặn lỗi trước đây, giờ đã thông (token được cấp quyền)
        await pkGanNhan(pkToken, cid, `${nhan} ĐÃ CHẶN`);
        chan.push([name, uid, verdict, ok, 'thử lại thành công']);
      }

      ghiSoChan(uid, {
        ts: new Date().toISOString(), psid: uid, name, conv: cid, type: kieu,
        verdict, ok, an_comment: anOk, chac: chacCham, noi_dung: noiDung.slice(0, 100), resp: r,
        go_chan: `runVesi({ unblock: '${uid}' })`,
      });

      if (ok) xoaSoDeXuat(cid); // đã chặn thật → dọn sổ đề-xuất, khỏi nhắc lại

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
  if (chan.length || deXuat.length || anCmt.length || thaThat.length) {
    const msg = ['🛡 VỆ SĨ HỘP THƯ' + (dry ? ' (ĐỀ-XUẤT/DRY)' : '')];
    if (thaThat.length) {
      msg.push(`🤝 THA ${thaThat.length} ca tên ngoại nhưng ĐANG hỏi bệnh thật (hàng rào khách thật):`);
      for (const [n, v, c] of thaThat) msg.push(`  • ${n} — ${v} — https://pancake.vn/${PAGE_ID}?c_id=${c}`);
    }
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
      // Câu lý do phải ĐÚNG với chốt đang khoá — bản cũ ghi cứng "chưa cấp VESI_FB_TOKEN"
      // kể cả khi token đã có và chốt thật là VESI_CHAN_AUTO=0, làm anh Trình chẩn nhầm 07/08.
      const vi_sao = !ptCheck
        ? 'chưa cấp VESI_FB_TOKEN nên KHÔNG tự chặn'
        : (CHAN_AUTO ? 'chưa đủ chắc để máy tự xử' : 'VESI_CHAN_AUTO=0 — máy KHÔNG tự chặn, chờ anh bấm');
      msg.push(`⚠️ ĐỀ XUẤT anh xem ${deXuat.length} ca cần chặn (${vi_sao}):`);
      for (const [n, v, c] of deXuat) msg.push(`  • ${n} — ${v} — https://pancake.vn/${PAGE_ID}?c_id=${c}`);
    }
    if (capiOk) msg.push(`📤 Đã khai báo ${capiOk} lead thật cho FB (CAPI).`);
    if (capiSkip) msg.push(`ℹ️ ${capiSkip} lead chưa khai báo được — chưa có dataset/token CAPI.`);
    await tgSend(msg.join('\n'), dry);
  }
  log(`Xong: quét ${convs.length} | chặn ${chan.length} | đề xuất ${deXuat.length} (im ${imDeXuat} ca đã báo trước) | lead CAPI ${capiOk} ok/${capiSkip} chờ`);
  return {
    quet: convs.length, chan: chan.length, de_xuat: deXuat.length,
    capi_ok: capiOk, capi_skip: capiSkip, dry,
  };
}

export default { runVesi };
