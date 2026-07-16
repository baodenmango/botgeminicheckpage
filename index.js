// Bot Gemini tư vấn Phòng khám Hiệp Lợi — service Node.js chạy 24/7.
// Webhook Pancake → Gemini → trả lời tách ô → retouch → báo Telegram.
import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';

import { config, checkConfig } from './src/config.js';
import { handleIncoming, handleRetouch, handlePageMessage } from './src/handler.js';
import { isPageEnabled, getLastCustomerMessage } from './src/pancake.js';
import { isCommentEvent } from './src/comment.js'; // chỉ để NHẬN DIỆN comment và bỏ qua (Meta lo rep comment)
import * as store from './src/store.js';
import { ingestBill, runBillTouches } from './src/billengine.js';
import { thongKe as quotaThongKe } from './src/quota.js';
import { runGroupTouches } from './src/rebillengine.js';
import { handleZaloFollow, handleZaloSubmitInfo, handleZaloRating, handleZaloUnfollow, zaloWebhookAllowed } from './src/follow.js';
import { tagFollowerBenh, sendRequestInfo, broadcastTag, trongGioVang } from './src/zalo.js';
import { broadcastJobsForNow, tuanTrongThang } from './src/broadcast-schedule.js';
import { runPosIngest } from './src/posingest.js';
import { baoCaoTuanZalo } from './src/baocao.js';
import { sendZnsNhacLich, isZnsEnabled, flushRatingCho, sendZnsVoucher, maHopLe, sendZnsXacNhanLich, sendZnsQuanTamOA, isQuanTamOAEnabled } from './src/zns.js';
import { lookupMedi, mapDiagnosis, getAllMediRecords, parseVisitDate, isMediConfigured } from './src/medi.js';
import { runWakeup } from './src/wakeup.js';
import { runSevenTouch } from './src/sevenTouch.js';
import { runRescueLead } from './src/rescueLead.js';
import { guiBienNhan, parseHenEpoch, bookingNhacTick } from './src/bookingsched.js';
import { runVoucherFollowup } from './src/voucherfollowup.js';

checkConfig();

const app = express();
// verify hook: giữ RAW body (đúng byte Zalo gửi) để verify chữ ký webhook Zalo OA.
// Chữ ký Zalo = sha256(app_id + rawBody + timestamp + OA_secret) — PHẢI dùng raw body,
// KHÔNG được JSON.stringify(parsed) (đổi thứ tự key/escape → hash sai). Xem src/follow.js.
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

// --- Health check (Render kiểm tra sống) ---
// Kèm commit SHA + thời điểm process khởi động → verify deploy chỉ bằng 1 lệnh curl
// (Render cấp sẵn RENDER_GIT_COMMIT cho mọi service; bootedAt cho biết lần restart gần nhất).
const BOOTED_AT = new Date().toISOString();
const GIT_COMMIT = (process.env.RENDER_GIT_COMMIT || 'dev').slice(0, 7);
app.get('/health', (_req, res) =>
  res.status(200).json({ ok: true, ts: Date.now(), commit: GIT_COMMIT, bootedAt: BOOTED_AT }));
app.get('/', (_req, res) => {
  // meta tag xác thực domain Zalo (env ZALO_SITE_VERIFICATION) — không có thì trang chủ như cũ
  const zaloMeta = process.env.ZALO_SITE_VERIFICATION
    ? `<meta name="zalo-platform-site-verification" content="${process.env.ZALO_SITE_VERIFICATION}" />`
    : '';
  res.status(200).type('html').send(
    `<!doctype html><html><head><meta charset="utf-8">${zaloMeta}<title>Bot Gemini Hiệp Lợi</title></head>` +
    `<body>Bot Gemini Hiệp Lợi đang chạy ✅</body></html>`
  );
});

// ============================================================
//  VOUCHER — trang xem ưu đãi (khách bấm "Xem mã ưu đãi") + xác thực cho quầy.
//  Template ZNS 518980 chữ CỐ ĐỊNH "voucher siêu âm vi điểm", KHÔNG ghi được giá/chương trình
//  → giá + điều kiện + trạng thái mã hiển thị Ở ĐÂY (nút "Xem mã ưu đãi" trỏ về URL này).
//  Sổ voucher lưu ở kv `voucher:<MÃ>` khi sendZnsVoucher phát mã.
const VOUCHER_CT = {
  ct1: { ten: 'Gói tầm soát xương khớp', g_goc: '800.000đ', gia: '150.000đ',
    gom: ['Siêu âm vi điểm cơ xương khớp (500.000đ)', 'Đo cơ mỡ, đánh giá xương khớp (300.000đ)'] },
  ct2: { ten: 'Gói khám ưu đãi chủ lực', g_goc: '1.300.000đ', gia: '300.000đ',
    gom: ['Khám BS chuyên khoa Cơ Xương Khớp', 'Siêu âm khớp gối (máy Mindray MX3)', 'Điện trị liệu 1 buổi giảm đau', 'Tư vấn phác đồ riêng + lộ trình', 'Bộ bài tập tại nhà (tặng kèm)'] },
};
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function ngayVNstr(sec) { const d = new Date(sec * 1000 + 7 * 3600 * 1000); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; }
// SĐT che để quầy đối chiếu mà không lộ nguyên số: 0978***211
function sdtChe(sdt84) { const s = String(sdt84 || '').replace(/^84/, '0'); return s.length === 10 ? `${s.slice(0, 4)}***${s.slice(-3)}` : '(ẩn)'; }

// choQuay=true → trang lễ tân: hiện TÊN + SĐT che để đối chiếu người thật. Mặc định (khách) ẩn PII.
function trangVoucher(rec, thongBao, choQuay = false) {
  const nowS = Math.floor(Date.now() / 1000);
  const ct = VOUCHER_CT[rec?.chuong_trinh] || VOUCHER_CT.ct1;
  const hetHan = rec ? rec.het_han < nowS : false;
  const daDung = rec ? rec.da_dung : false;
  let trangThai, mauTt;
  if (!rec) { trangThai = 'Mã không tồn tại'; mauTt = '#B4232A'; }
  else if (daDung) { trangThai = 'ĐÃ SỬ DỤNG'; mauTt = '#8A6D1F'; }
  else if (hetHan) { trangThai = 'ĐÃ HẾT HẠN'; mauTt = '#B4232A'; }
  else { trangThai = 'CÒN HIỆU LỰC'; mauTt = '#2F6B54'; }
  const dsGom = ct.gom.map((g) => `<li>${esc(g)}</li>`).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Voucher — Phòng khám Hiệp Lợi</title>
<style>
:root{--g:#2F6B54;--gold:#9A7B1F;--ink:#1C3A32;--muted:#6B7169;--line:#E3E0D7;--bg:#F4F6F3}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",system-ui,sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:440px;margin:0 auto;padding:24px 18px 40px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 8px 28px -14px rgba(28,58,50,.22)}
.top{background:linear-gradient(135deg,#2F6B54,#3F8468);color:#fff;padding:22px 22px 18px}
.top .brand{font-size:.82rem;opacity:.9;letter-spacing:.02em}
.top h1{margin:6px 0 0;font-size:1.32rem;line-height:1.25;font-weight:700}
.status{display:inline-block;margin:14px 22px 0;padding:6px 14px;border-radius:999px;font-weight:700;font-size:.86rem;color:#fff;background:${mauTt}}
.body{padding:18px 22px 24px}
.price{display:flex;align-items:baseline;gap:12px;margin:6px 0 4px}
.price .now{font-size:2rem;font-weight:800;color:var(--g);letter-spacing:-.02em}
.price .was{font-size:1rem;color:var(--muted);text-decoration:line-through}
.lbl{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700;margin:18px 0 8px}
ul.gom{margin:0;padding-left:18px;color:var(--ink)}ul.gom li{margin:4px 0}
.ma{margin-top:18px;padding:14px;background:var(--bg);border:1px dashed var(--g);border-radius:12px;text-align:center}
.ma .code{font-size:1.5rem;font-weight:800;letter-spacing:.12em;color:var(--ink);font-family:ui-monospace,Menlo,monospace}
.ma .hd{font-size:.78rem;color:var(--muted)}
.meta{margin-top:16px;font-size:.86rem;color:var(--muted)}.meta b{color:var(--ink)}
.dk{margin-top:16px;font-size:.82rem;color:var(--muted);border-top:1px solid var(--line);padding-top:14px}
.foot{text-align:center;margin-top:20px;font-size:.78rem;color:var(--muted)}
.tb{margin:0 0 14px;padding:10px 14px;border-radius:10px;background:#EAF3EE;color:#245c47;font-size:.9rem;font-weight:600}
</style></head><body><div class="wrap">
${thongBao ? `<div class="tb">${esc(thongBao)}</div>` : ''}
<div class="card">
  <div class="top"><div class="brand">🩺 Phòng khám Cơ Xương Khớp Hiệp Lợi</div>
    <h1>Ưu đãi tri ân khách cũ</h1></div>
  <div class="status">${trangThai}</div>
  <div class="body">
    ${rec ? `
    <div class="lbl">${esc(ct.ten)}</div>
    <div class="price"><span class="now">${esc(ct.gia)}</span><span class="was">${esc(ct.g_goc)}</span></div>
    <div class="lbl">Bao gồm</div>
    <ul class="gom">${dsGom}</ul>
    <div class="ma"><div class="hd">Mã ưu đãi — đưa mã này cho quầy lễ tân</div><div class="code">${esc(rec.ma)}</div></div>
    <div class="meta">${choQuay ? `Khách: <b>${esc(rec.ten || 'Quý khách')}</b> · SĐT: <b>${esc(sdtChe(rec.sdt))}</b><br>` : ''}Hiệu lực đến: <b>${ngayVNstr(rec.het_han)}</b></div>
    <div class="dk">Áp dụng cho bệnh nhân cũ hoặc người được giới thiệu. Mỗi mã dùng 1 lần, xuất trình khi đến khám. Giá trị dịch vụ mang tính thăm khám — tầm soát, không thay thế chỉ định trực tiếp của Bác sĩ.</div>
    ` : `<p>Mã ưu đãi không đúng hoặc đã bị thu hồi. Vui lòng liên hệ phòng khám <b>0962 349 329</b> để được hỗ trợ.</p>`}
  </div>
</div>
<div class="foot">📍 262/3 Lũy Bán Bích, P. Hòa Thạnh, Q. Tân Phú · ☎️ 0962 349 329</div>
</div></body></html>`;
}

// Trang khách xem ưu đãi (PUBLIC — nút "Xem mã ưu đãi" trỏ về đây).
app.get('/voucher/:ma', (req, res) => {
  let rec = null;
  try { rec = JSON.parse(store.getKV(`voucher:${String(req.params.ma || '').toUpperCase()}`) || 'null'); } catch { /* mã lỗi */ }
  res.status(200).type('html').send(trangVoucher(rec));
});

// Token quầy TÁCH khỏi token admin (bảo mật — lễ tân chỉ có quyền tra/đánh dấu voucher,
// KHÔNG đụng được /admin/*). Env QUAY_TOKEN riêng; ADMIN_TOKEN vẫn vào được để anh test.
function laTokenQuay(t) {
  const q = process.env.QUAY_TOKEN, a = process.env.ADMIN_TOKEN;
  return !!t && ((q && t === q) || (a && t === a));
}

// Quầy XÁC THỰC + đánh dấu đã dùng. GET để quầy mở link/quét nhanh trên điện thoại.
// /voucher-quay/:ma?token=XXX        → xem trạng thái + tên/SĐT che để đối chiếu người thật
// /voucher-quay/:ma?token=XXX&dung=1 → đánh dấu ĐÃ DÙNG (chốt khi khách tới thật)
app.get('/voucher-quay/:ma', (req, res) => {
  if (!laTokenQuay(req.query.token)) {
    return res.status(403).type('html').send('<h3>403 — thiếu/sai token quầy</h3>');
  }
  const ma = String(req.params.ma || '').toUpperCase();
  let rec = null;
  if (maHopLe(ma)) { // chặn mã bịa (sai checksum) trước khi tra sổ
    try { rec = JSON.parse(store.getKV(`voucher:${ma}`) || 'null'); } catch { /* lỗi */ }
  }
  let thongBao = null;
  if (!maHopLe(ma)) { thongBao = '⚠️ Mã sai định dạng — không phải mã hợp lệ của phòng khám.'; }
  else if (rec && (req.query.dung === '1' || req.query.dung === 'true')) {
    if (rec.da_dung) { thongBao = `⚠️ Mã này ĐÃ được dùng lúc ${ngayVNstr(rec.dung_luc)} — KHÔNG áp dụng lại.`; }
    else if (rec.het_han < Math.floor(Date.now() / 1000)) { thongBao = '⚠️ Mã đã HẾT HẠN — không áp dụng.'; }
    else {
      rec.da_dung = true; rec.dung_luc = Math.floor(Date.now() / 1000);
      store.setKV(`voucher:${ma}`, JSON.stringify(rec));
      thongBao = '✅ Đã xác nhận sử dụng mã. Áp dụng ưu đãi cho khách.';
    }
  }
  res.status(200).type('html').send(trangVoucher(rec, thongBao, true));
});

// TRANG QUẦY — lễ tân bookmark 1 lần: /quay?token=QUAY_TOKEN. Có ô nhập/dán mã (quét QR ra mã
// rồi dán), bấm "Kiểm tra" mở /voucher-quay/<mã>. Token nhúng sẵn nên không phải gõ lại.
app.get('/quay', (req, res) => {
  if (!laTokenQuay(req.query.token)) {
    return res.status(403).type('html').send('<h3>403 — cần link quầy có token. Liên hệ quản trị.</h3>');
  }
  const tk = esc(req.query.token);
  res.status(200).type('html').send(`<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Quầy — kiểm voucher Hiệp Lợi</title>
<style>body{margin:0;background:#F4F6F3;color:#1C3A32;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.w{max-width:420px;margin:0 auto;padding:32px 20px}h1{font-size:1.3rem;margin:0 0 4px}p.sub{color:#6B7169;margin:0 0 24px;font-size:.9rem}
form{background:#fff;border:1px solid #E3E0D7;border-radius:16px;padding:22px;box-shadow:0 8px 28px -14px rgba(28,58,50,.2)}
label{font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6B7169}
input{width:100%;margin-top:8px;padding:14px;font-size:1.3rem;letter-spacing:.1em;text-align:center;text-transform:uppercase;font-family:ui-monospace,Menlo,monospace;border:2px solid #2F6B54;border-radius:12px;box-sizing:border-box}
button{width:100%;margin-top:16px;padding:15px;font-size:1.05rem;font-weight:700;color:#fff;background:#2F6B54;border:0;border-radius:12px;cursor:pointer}
.hint{margin-top:18px;font-size:.82rem;color:#6B7169;line-height:1.5}</style></head><body><div class="w">
<h1>🩺 Kiểm voucher — Quầy lễ tân</h1><p class="sub">Phòng khám Cơ Xương Khớp Hiệp Lợi</p>
<form onsubmit="var m=document.getElementById('m').value.trim().toUpperCase();if(m){location.href='/voucher-quay/'+encodeURIComponent(m)+'?token='+encodeURIComponent('${tk}')};return false;">
<label>Mã voucher khách đưa</label>
<input id="m" autocomplete="off" autocapitalize="characters" placeholder="V1XXXXXXX" autofocus>
<button type="submit">Kiểm tra mã</button>
</form>
<div class="hint">📷 Quét QR trên điện thoại khách bằng camera → ra chuỗi mã → dán vào ô trên.<br>✅ Trang sau hiện tên + SĐT che để đối chiếu đúng người, rồi bấm "Xác nhận đã dùng".</div>
</div></body></html>`);
});

// --- Admin: gỡ cờ "người giữ" bị kẹt (do bug nhận nhầm echo là telesale) ---
// GET /admin/reset-human?token=XXX            → gỡ cờ TẤT CẢ hội thoại
// GET /admin/reset-human?token=XXX&conv=<id>  → gỡ cờ 1 hội thoại
// Token lấy từ env ADMIN_TOKEN (đặt trên Render). Không có token → 403.
app.get('/admin/reset-human', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const conv = req.query.conv;
  const changed = conv ? store.clearHumanTaken(String(conv)) : store.clearAllHumanTaken();
  // thêm &handover=1 để gỡ luôn trạng thái handover (đưa conv về active) — dùng khi bot handover OAN
  let handoverCleared = 0;
  if (conv && (req.query.handover === '1' || req.query.handover === 'true')) {
    handoverCleared = store.clearHandover(String(conv));
  }
  console.log(`[admin] gỡ cờ human-taken ${conv ? `conv ${conv}` : 'TẤT CẢ'} → ${changed} dòng${handoverCleared ? ` + gỡ handover ${handoverCleared}` : ''}`);
  res.status(200).json({ ok: true, scope: conv || 'all', cleared: changed, handoverCleared });
});

// --- Admin: ÉP bot trả lời lại 1 hội thoại bị bỏ lửng (khách chưa nhắn mới) ---
// GET /admin/poke?token=XXX&page=<pageId>&conv=<conversationId>
// Đọc tin cuối của KHÁCH trong conv đó rồi đẩy vào handleIncoming như webhook thật.
// Cũng gỡ cờ human-taken trước, để bot không bị chính cờ cũ chặn.
app.get('/admin/poke', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const pageId = String(req.query.page || '');
  const conv = String(req.query.conv || '');
  if (!pageId || !conv) return res.status(400).json({ ok: false, error: 'thiếu page hoặc conv' });
  if (!isPageEnabled(pageId)) return res.status(400).json({ ok: false, error: 'page chưa bật bot' });

  try {
    store.clearHumanTaken(conv); // gỡ cờ kẹt trước khi xử
    const last = await getLastCustomerMessage(pageId, conv);
    if (!last) {
      return res.status(200).json({ ok: false, error: 'không thấy tin cuối của khách (tin cuối là của page hoặc rỗng)' });
    }
    console.log(`[admin] 🤖 poke conv ${conv}: ép bot trả lời tin khách "${last.messageText.slice(0, 50)}"`);
    // gọi như webhook tin khách mới (không await để trả response nhanh)
    handleIncoming({ conversationId: conv, pageId, customerName: last.customerName, messageText: last.messageText });
    res.status(200).json({ ok: true, conv, poked: last.messageText.slice(0, 80), name: last.customerName });
  } catch (err) {
    console.error('[admin] poke lỗi:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: KÍCH 1 lượt vớt lead NGAY (không chờ cron 5') — kiểm tra sau deploy / cứu loạt ca sót ---
// GET /admin/rescue-now?token=XXX → { ok, rescued: <số ca đã đẩy vào xử lý> }
app.get('/admin/rescue-now', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  try {
    const rescued = await runRescueLead();
    res.status(200).json({ ok: true, rescued });
  } catch (err) {
    console.error('[admin] rescue-now lỗi:', err?.message || err);
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: XEM ĐỒNG HỒ QUOTA tin tư vấn Zalo (B3 — ngân sách 500 tin/tháng) ---
// GET /admin/zalo-quota?token=XXX → { thang, quota, da_tieu, con_lai, du_tru }
app.get('/admin/zalo-quota', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  res.status(200).json({ ok: true, ...quotaThongKe() });
});

// --- Admin: GỬI THỬ card "Chia sẻ thông tin" tới 1 uid Zalo (soi vì sao khách không thấy nút) ---
// GET /admin/gui-card?token=XXX&uid=<zalo_uid> → gửi card + trả kết quả; lỗi chi tiết nằm trong log.
app.get('/admin/gui-card', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const uid = String(req.query.uid || '').trim();
  if (!uid) return res.status(400).json({ ok: false, error: 'thiếu uid' });
  try {
    const ok = await sendRequestInfo(uid);
    res.status(200).json({ ok, uid, ghi_chu: ok ? 'card đã gửi — nhờ khách/anh kiểm tra Zalo' : 'gửi HỤT — xem log [zalo] card request_user_info' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: RESET dedup voucher 1 SĐT (để test lại / xử ca gửi lỗi cần phát lại) ---
// GET /admin/voucher-reset?token=XXX&phone=09xx → xoá key zns_voucher_sent để số đó nhận lại được.
app.get('/admin/voucher-reset', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  let s = String(req.query.phone || '').replace(/[^\d]/g, '');
  if (s.startsWith('0')) s = '84' + s.slice(1);
  if (!/^84\d{9}$/.test(s)) return res.status(400).json({ ok: false, error: 'SĐT không hợp lệ' });
  store.delKV(`zns_voucher_sent:${s}`);
  res.status(200).json({ ok: true, da_reset: s });
});

// --- Admin: BROADCAST tin truyền thông theo tag bệnh (4 tin miễn phí/follower/tháng) ---
// POST /admin/broadcast-tag?token=XXX  body: { tag, header, text, dry_run }
//   tag = key ('goi') HOẶC giá trị tag ('Khớp gối'); dry_run=true → chỉ đếm người nhận.
app.post('/admin/broadcast-tag', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const { tag, header, text, dry_run, force } = req.body || {};
  if (!tag) return res.status(400).json({ ok: false, error: 'thiếu tag' });
  try {
    // tag có thể là key ('goi') hoặc giá trị ('Khớp gối') — thử cả hai
    const opts = /^[a-z]+$/.test(String(tag)) ? { tagKey: tag } : { tagName: tag };
    const kq = await broadcastTag({ ...opts, header, text, dryRun: !!dry_run, force: !!force });
    if (!dry_run && kq.da_gui) {
      notifyText(`📣 <b>Broadcast tag "${kq.tag}"</b>: gửi ${kq.da_gui} tin, bỏ qua ${kq.bo_qua} (đã nhận hôm nay/hết quota tháng), lỗi ${kq.loi?.length || 0}.`).catch(() => {});
    }
    res.status(200).json({ ok: true, ...kq });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: SỔ VOUCHER — liệt kê mã đã phát + backfill mã cũ ---
// GET /admin/voucher-so?token=XXX                    → liệt kê tất cả voucher đã phát
// GET /admin/voucher-so?token=XXX&backfill=MÃ&sdt=..&ten=..&ct=ct1 → thêm tay 1 mã cũ vào sổ
app.get('/admin/voucher-so', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const bf = req.query.backfill ? String(req.query.backfill).toUpperCase() : null;
  if (bf) {
    const now = Math.floor(Date.now() / 1000);
    const rec = {
      ma: bf, sdt: String(req.query.sdt || ''), ten: req.query.ten || null,
      chuong_trinh: req.query.ct === 'ct2' ? 'ct2' : 'ct1',
      phat_luc: now, het_han: now + 30 * 86400, da_dung: false, dung_luc: null,
    };
    store.setKV(`voucher:${bf}`, JSON.stringify(rec));
    return res.status(200).json({ ok: true, backfilled: rec });
  }
  const ds = store.listKVByPrefix('voucher:').map((row) => {
    try { return JSON.parse(row.value); } catch { return null; }
  }).filter(Boolean);
  const tong = ds.length;
  const daDung = ds.filter((v) => v.da_dung).length;
  res.status(200).json({ ok: true, tong, da_dung: daDung, con_hieu_luc: tong - daDung, ds });
});

// --- Admin: CHIẾN DỊCH VOUCHER khách cũ (template 518980 đã duyệt) ---
// GET /admin/voucher-khach-cu?token=XXX[&cach_day=N][&nhom=3][&limit=200][&dry=1][&force=1][&phone=09xx]
//   Đối tượng = khách ĐÃ TỪNG KHÁM (bill_care có bill_date, chưa opt_out).
//   cach_day=N: chỉ khách khám cách đây ≥ N ngày (mặc định 0 = mọi khách cũ). Đây là tệp chính
//     ("bệnh nhân cũ lâu chưa lại"). nhom (tùy chọn): lọc thêm theo group_no liệu trình nếu có.
//   dry=1 chỉ đếm; phone=09xx bắn thử 1 số; force=1 bỏ chặn giờ vàng.
app.get('/admin/voucher-khach-cu', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const cachDay = Number(req.query.cach_day || 0);
  const nhom = req.query.nhom != null ? Number(req.query.nhom) : null;
  const limit = Math.min(Number(req.query.limit || 200), 500);
  const dry = req.query.dry === '1' || req.query.dry === 'true';
  const force = req.query.force === '1' || req.query.force === 'true';
  const phoneTest = req.query.phone ? String(req.query.phone) : null;
  const nowS = Math.floor(Date.now() / 1000);
  try {
    if (phoneTest) {
      const r = await sendZnsVoucher(phoneTest, { ten: 'Quý khách', ngayKham: nowS });
      return res.status(200).json({ ok: true, test: phoneTest, ket_qua: r });
    }
    const rows = store.listBillCare(limit).filter((r) =>
      r.bill_date && !r.opt_out && r.phone &&
      (nhom == null || r.group_no === nhom) &&
      (cachDay <= 0 || (nowS - r.bill_date) >= cachDay * 86400)
    );
    if (dry) return res.status(200).json({ ok: true, dry_run: true, cach_day: cachDay, nhom, se_gui_cho: rows.length });
    // GIỜ VÀNG: gửi thật ngoài khung → chặn, trừ khi &force=1 (anh Trình chốt 09/07)
    if (!force && !trongGioVang()) {
      return res.status(200).json({ ok: false, ly_do: 'ngoai_gio_vang', ghi_chu: 'Voucher chỉ bắn 8h–21h VN để khách đọc. Thêm &force=1 nếu muốn gửi ngay.', se_gui_cho: rows.length });
    }
    let daGui = 0, boQua = 0, loi = 0;
    for (const rec of rows) {
      const r = await sendZnsVoucher(rec.phone, { ten: rec.name, maHoSo: rec.id, ngayKham: rec.bill_date });
      if (r.ok) daGui++; else if (r.ly_do === 'da_gui_roi') boQua++; else loi++;
      await new Promise((s) => setTimeout(s, 300));
    }
    notifyText(`🎁 <b>Chiến dịch voucher khách cũ</b>: gửi ${daGui}, bỏ qua ${boQua} (đã gửi trước), lỗi ${loi} / tổng ${rows.length} ca.`).catch(() => {});
    res.status(200).json({ ok: true, cach_day: cachDay, nhom, tong: rows.length, da_gui: daGui, bo_qua_da_gui: boQua, that_bai: loi });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: VOUCHER cho ~1200 BỆNH NHÂN CŨ từ MEDi (EMR) — lọc theo BỆNH ---
// GET /admin/voucher-medi?token=XXX&benh=goi[&cach_day=45][&cach_day_max=730][&ct=ct1][&batch=200][&dry=1][&force=1][&phone=09xx]
//   benh = mã bệnh (goi|gut|lung|vai|tvdd|covaigay|...) hoặc 'all'. BẮT BUỘC (chống lỡ bắn cả 1200 mọi bệnh).
//   cach_day = chỉ BN khám cách ≥N ngày (mặc định 45 = "lâu chưa lại"); cach_day_max loại BN quá cũ (SĐT die).
//   batch = TRẦN CỨNG ≤200/lượt (chống đốt ví — mỗi tin 600đ). dedup zns_voucher_sent → gọi nhiều lượt quét hết.
app.get('/admin/voucher-medi', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const benh = String(req.query.benh || '').trim();
  if (!benh) return res.status(400).json({ ok: false, error: 'thiếu tham số benh (mã bệnh hoặc "all") — bắt buộc để không lỡ bắn cả tệp' });
  const cachDay = Number(req.query.cach_day || 45);
  const cachDayMax = Number(req.query.cach_day_max || 0); // 0 = không giới hạn trần trên
  const ct = req.query.ct === 'ct2' ? 'ct2' : 'ct1';
  const batch = Math.min(Number(req.query.batch || 200), 200); // HARD CAP 200 — không tin query
  const dry = req.query.dry === '1' || req.query.dry === 'true';
  const force = req.query.force === '1' || req.query.force === 'true';
  const phoneTest = req.query.phone ? String(req.query.phone) : null;
  // ĐÒN ② kéo follow: mặc định BẬT nếu template đã cấu hình. keo_follow=0 để TẮT (nhánh A/B test).
  const keoFollow = req.query.keo_follow !== '0' && req.query.keo_follow !== 'false' && isQuanTamOAEnabled();
  const nowS = Math.floor(Date.now() / 1000);
  // Bắn KÈM tin mời quan tâm OA — CHỈ cho khách CHƯA follow (không có map phone_zalo) để khỏi phí tin.
  const keoFollowNeuChua = async (phone, ten) => {
    if (!keoFollow) return 'tat';
    const p10 = String(phone || '').replace(/[^\d]/g, '').replace(/^84/, '0');
    if (store.getKV(`phone_zalo:${p10}`)) return 'da_follow'; // đã follow → khỏi mời
    const ok = await sendZnsQuanTamOA(phone, { ten });
    return ok ? 'da_moi' : 'moi_loi';
  };
  try {
    if (phoneTest) {
      const r = await sendZnsVoucher(phoneTest, { ten: 'Quý khách', ngayKham: nowS, chuongTrinh: ct });
      const moi = r.ok ? await keoFollowNeuChua(phoneTest, 'Quý khách') : 'bo_qua';
      return res.status(200).json({ ok: true, test: phoneTest, ket_qua: r, keo_follow: moi });
    }
    if (!isMediConfigured()) return res.status(200).json({ ok: false, ly_do: 'medi_chua_cau_hinh', ghi_chu: 'Cần MEDI_SHEET_CSV_URL hoặc đẩy medi_cache trước.' });
    const records = await getAllMediRecords();
    const ungVien = [];
    for (const rec of records) {
      if (!rec.phone) continue;
      const visit = parseVisitDate(rec.lastVisit);
      if (!visit) continue;
      const tuoi = nowS - visit;
      if (tuoi < cachDay * 86400) continue;                        // chưa đủ "lâu chưa lại"
      if (cachDayMax > 0 && tuoi > cachDayMax * 86400) continue;   // quá cũ → bỏ (SĐT có thể die)
      if (benh !== 'all' && mapDiagnosis(rec.diagnosis) !== benh) continue;
      ungVien.push({ phone: rec.phone, ten: rec.name, visit });
    }
    if (dry) return res.status(200).json({ ok: true, dry_run: true, benh, cach_day: cachDay, tong_ung_vien: ungVien.length, se_gui_lot_batch: Math.min(ungVien.length, batch), uoc_phi_dong: Math.min(ungVien.length, batch) * 600 });
    // GIỜ VÀNG
    if (!force && !trongGioVang()) {
      return res.status(200).json({ ok: false, ly_do: 'ngoai_gio_vang', ghi_chu: 'Chỉ bắn 8h–21h VN. Thêm &force=1 nếu muốn gửi ngay.', se_gui_cho: Math.min(ungVien.length, batch) });
    }
    const lot = ungVien.slice(0, batch);
    let daGui = 0, boQua = 0, loi = 0, daMoiOA = 0;
    for (const uv of lot) {
      const r = await sendZnsVoucher(uv.phone, { ten: uv.ten, ngayKham: uv.visit, chuongTrinh: ct });
      if (r.ok) { daGui++; if ((await keoFollowNeuChua(uv.phone, uv.ten)) === 'da_moi') daMoiOA++; }
      else if (r.ly_do === 'da_gui_roi') boQua++; else loi++;
      await new Promise((s) => setTimeout(s, 300));
    }
    const dongMoi = keoFollow ? ` · mời quan tâm OA: ${daMoiOA}` : '';
    notifyText(`🎁 <b>Voucher MEDi (${esc(benh)}/${ct.toUpperCase()})</b>: gửi ${daGui}, bỏ qua ${boQua} (đã gửi trước), lỗi ${loi}${dongMoi}. Còn lại ${ungVien.length - lot.length} ứng viên (gọi lại để quét tiếp).`).catch(() => {});
    res.status(200).json({ ok: true, benh, cach_day: cachDay, ct, keo_follow: keoFollow, tong_ung_vien: ungVien.length, da_quet: lot.length, da_gui: daGui, bo_qua_da_gui: boQua, that_bai: loi, da_moi_quan_tam_oa: daMoiOA, con_lai: ungVien.length - lot.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: KÍCH cú chạm 2 (nhắc voucher chưa dùng) NGAY — không chờ cron 9h ---
// GET /admin/voucher-followup?token=XXX[&dry=1]
//   dry=1 → chỉ xem danh sách sẽ nhắc (không ghi state, không đẩy Telegram).
app.get('/admin/voucher-followup', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const dry = req.query.dry === '1' || req.query.dry === 'true';
  try {
    const r = await runVoucherFollowup({ dry });
    res.status(200).json(r);
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: GẮN CỜ "ĐÃ KHÁM" tay cho 1 hội thoại (ca lọt lưới trước bản vá da_kham) ---
// GET /admin/danh-dau-da-kham?token=XXX&conversation_id=zl_... → bot chuyển mode CARE,
// thoát chuỗi retouch/chạm lead. Idempotent.
app.get('/admin/danh-dau-da-kham', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const convId = String(req.query.conversation_id || '').trim();
  if (!convId) return res.status(400).json({ ok: false, error: 'thiếu conversation_id' });
  store.setKV(`da_kham_conv:${convId}`, String(Date.now()));
  console.log(`[admin] 🏥 gắn cờ ĐÃ KHÁM tay cho ${convId}`);
  res.status(200).json({ ok: true, conversation_id: convId, da_kham: true });
});

// --- Admin: BACKFILL TAG BỆNH cho follower Zalo đã biết bệnh (B4 — chạy 1 lần sau deploy) ---
// GET /admin/tag-benh-backfill?token=XXX → gắn tag bệnh cho mọi hội thoại Zalo đã nhận diện bệnh.
// Idempotent (kv chống gắn lặp trong tagFollowerBenh) → chạy lại nhiều lần vô hại.
app.get('/admin/tag-benh-backfill', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  try {
    const rows = store.listZaloCondUsers();
    let daGan = 0;
    for (const r of rows) {
      if (await tagFollowerBenh(r.uid, r.condition)) daGan++;
      await new Promise((s) => setTimeout(s, 400)); // nương rate-limit Zalo
    }
    console.log(`[admin] 🏷️ backfill tag bệnh: ${daGan}/${rows.length} follower`);
    res.status(200).json({ ok: true, tong: rows.length, da_gan: daGan });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: XEM MA TRẬN CHĂM SÓC (demo + giám sát) ---
// GET /admin/ma-tran?token=XXX → danh sách ca trong chuỗi chăm: bệnh, ngày bill,
// mốc kế tiếp của chuỗi D-BIS, chạm đã gửi, có kênh Zalo để gửi hay không.
app.get('/admin/ma-tran', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const MOC = [0, 1, 3, 6, 7]; // mốc ngày chuỗi ca-ra-bill
  const now = Math.floor(Date.now() / 1000);
  const rows = store.listBillCare(parseInt(req.query.limit || '100', 10));
  const ds = rows.map((r) => {
    const daGui = JSON.parse(r.bill_cham_done || '[]');
    const tuoiNgay = Math.floor((now - r.bill_date) / 86400);
    const mocKe = r.rebooked ? 'DỪNG (đã đặt lịch)' : r.opt_out ? 'DỪNG (opt-out)'
      : (() => {
          const m = MOC.find((d) => d >= tuoiNgay && !daGui.includes('d' + d));
          return m !== undefined ? `d${m} (ngày ${m})` : 'hết mốc bill';
        })();
    return {
      ten: r.name || '(chưa rõ tên)',
      sdt: r.phone,
      benh: r.condition || 'unknown',
      thuoc: !!r.has_medicine, tiem: !!r.has_injection,
      ngay_bill: new Date(r.bill_date * 1000 + 7 * 3600e3).toISOString().slice(0, 10),
      tuoi_ngay: tuoiNgay,
      cham_da_gui: daGui,
      cham_tai_bill_da_gui: JSON.parse(r.group_cham_done || '[]'),
      moc_ke_tiep: mocKe,
      co_kenh_zalo: Boolean(r.conversation_id || r.zalo_user_id),
      nhom_tai_bill: r.group_no || null,
    };
  });
  res.status(200).json({ ok: true, tong: ds.length, co_kenh: ds.filter((x) => x.co_kenh_zalo).length, ds });
});

// --- Admin: KÍCH 1 lượt quét POS ngay (B6) — test sau deploy / nạp gấp ---
app.get('/admin/pos-ingest-now', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  try {
    const n = await runPosIngest();
    res.status(200).json({ ok: true, da_nap: n });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: BẮN BÁO CÁO TUẦN NGAY (B7) — xem thử format/kiểm số liệu ---
app.get('/admin/bao-cao-tuan-now', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  try {
    const text = await baoCaoTuanZalo();
    res.status(200).json({ ok: true, text });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: TEST ZNS nhắc lịch (B5) — chạy SAU khi template được Zalo duyệt ---
// POST /admin/zns-test?token=XXX  body: { phone, ten, ngay_hen }  (ngay_hen dd/MM/yyyy)
app.post('/admin/zns-test', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  if (!isZnsEnabled()) {
    return res.status(400).json({ ok: false, error: 'ZNS chưa bật (cần ZNS_ENABLED=1 + ZNS_TEMPLATE_NHACLICH sau khi template được duyệt)' });
  }
  const { phone, ten, ngay_hen } = req.body || {};
  const ok = await sendZnsNhacLich(phone, { ten, ngay_hen });
  res.status(ok ? 200 : 500).json({ ok });
});

// --- Admin: NẠP TOKEN PANCAKE lúc chạy (không cần sửa env Render + redeploy) ---
// Token trang Zalo bị Pancake xoay vòng (error 105) → chết lặng lẽ, bot mù kênh Zalo (06/07).
// POST /admin/set-token?token=XXX  body: { page_id: 'zl_31368...', value: '<token trang mới>' }
//                                  body: { user: true, value: '<user token API v1>' }
// Lưu vào kv (sống qua restart); getPageToken/getUserToken ưu tiên kv hơn env.
app.post('/admin/set-token', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const { page_id, user, value } = req.body || {};
  if (!value) return res.status(400).json({ ok: false, error: 'thiếu value' });
  if (user) {
    store.setKV('pancake_user_token', value);
    console.log('[admin] 🔑 nạp pancake_user_token mới (API v1 fallback)');
    return res.status(200).json({ ok: true, set: 'user' });
  }
  if (page_id) {
    store.setKV(`pancake_token:${page_id}`, value);
    console.log(`[admin] 🔑 nạp token trang mới cho ${page_id}`);
    return res.status(200).json({ ok: true, set: String(page_id) });
  }
  res.status(400).json({ ok: false, error: 'thiếu page_id hoặc user' });
});

// --- Admin: NẠP 1 ca ra bill vào hàng đợi chăm sóc Zalo (bước 5) ---
// POST /admin/bill-ingest?token=XXX  body JSON: { phone, name, zalo_user_id, page_id,
//   conversation_id, condition, has_medicine, has_injection, bill_date, treatment }
// Dùng cho nhân viên/automation đẩy ca ra bill (có thuốc/tiêm) từ POS vào engine.
// POS không có chẩn đoán → nếu payload thiếu condition, tự tra hồ sơ MEDi theo SĐT
// (cache /admin/medi-upsert) để điền bệnh + liệu trình + cờ tiêm, tin gửi khách mới đúng ca.
app.post('/admin/bill-ingest', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  try {
    const body = { ...(req.body || {}) };
    if ((!body.condition || body.condition === 'unknown') && body.phone) {
      const medi = await lookupMedi(body.phone);
      if (medi) {
        const c = mapDiagnosis(medi.diagnosis);
        if (c !== 'unknown') body.condition = c;
        if (!body.treatment && medi.treatment) body.treatment = medi.treatment;
        if (body.has_injection === undefined && /prp_khop|sinh_hoc/.test(medi.treatment || '')) {
          body.has_injection = true;
        }
        if (!body.name && medi.name) body.name = medi.name;
      }
    }
    const saved = ingestBill(body);
    if (!saved) return res.status(400).json({ ok: false, error: 'payload thiếu phone/id' });
    res.status(200).json({ ok: true, id: saved.id, condition: saved.condition, treatment: saved.treatment || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: NHẬN hồ sơ BN MEDi đẩy từ cron LOCAL (việc 2) ---
// POST /admin/medi-upsert?token=XXX  body JSON: { records: [ {phone,name,diagnosis,last_visit,treatment,visits,raw}... ] }
// Credentials EMR ở LOCAL; cron local gom BN qua medi-source.js rồi đẩy lên đây (PII không lên cloud dưới dạng login).
app.post('/admin/medi-upsert', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  try {
    const recs = Array.isArray(req.body?.records) ? req.body.records : [];
    let n = 0;
    for (const r of recs) { if (store.upsertMedi(r)) n++; }
    console.log(`[medi-upsert] nhận ${recs.length} hồ sơ BN, lưu ${n} (tổng cache ${store.mediCacheCount()})`);
    res.status(200).json({ ok: true, received: recs.length, saved: n, total: store.mediCacheCount() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// --- Admin: SOI mẫu chẩn đoán MEDi bị "unknown" (để nới bộ lọc bệnh cho voucher) ---
// GET /admin/medi-unknown?token=XXX[&limit=40] → liệt kê các chuỗi diagnosis map ra 'unknown' + tần suất.
app.get('/admin/medi-unknown', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const limit = Math.min(Number(req.query.limit || 40), 120);
  try {
    const records = await getAllMediRecords();
    const dem = new Map();
    for (const r of records) {
      if (mapDiagnosis(r.diagnosis) !== 'unknown') continue;
      const d = String(r.diagnosis || '(trống)').trim().slice(0, 60);
      dem.set(d, (dem.get(d) || 0) + 1);
    }
    const ds = [...dem.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([dienGiai, soCa]) => ({ dienGiai, soCa }));
    res.status(200).json({ ok: true, tong_unknown: [...dem.values()].reduce((a, b) => a + b, 0), so_loai: dem.size, mau: ds });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// ============================================================
//  XÁC NHẬN ĐẶT LỊCH — telesale dán block "Booking" (từ group Viber) vào group Telegram
//  → webhook này parse tên/SĐT/thời gian → gửi ZNS xác nhận 605793 (giảm no-show).
//  Format telesale gõ (ảnh Viber 10/07): "Booking:\n- tên: X\n- sđt: 09..\n- thời gian: 15h 09/07/2026 tại HL"
// Trích 1 trường "- nhãn: giá trị" (không phân biệt hoa thường, chịu dấu tiếng Việt).
// Chịu CẢ 2 format telesale gõ: nhiều dòng (Hana) và 1 DÒNG "Booking: - tên: X - sđt: Y - dịch vụ: Z"
// (Thắng 14/07) — giá trị dừng trước " - nhãn-kế-tiếp:" thay vì nuốt hết đuôi dòng.
function trichTruong(text, nhan) {
  const re = new RegExp(`[-•*]?\\s*${nhan}\\s*[:：]\\s*(.+?)(?=\\s+[-•*]\\s*[^:：]{1,25}[:：]|$)`, 'i');
  const m = String(text || '').split('\n').map((l) => l.match(re)).find(Boolean);
  return m ? m[1].trim() : null;
}
// SĐT VN 10 số từ chuỗi tự do.
function sdtTuChuoi(s) {
  const m = String(s || '').replace(/[^\d]/g, '').match(/0\d{9}/);
  return m ? m[0] : null;
}
// Chuẩn hoá "15h 09/07/2026 tại HL" / "15h NGÀY 09/07" → "15:00 09/07/2026" (≤30, đủ cho khách đọc).
function chuanGioHen(s) {
  let t = String(s || '').replace(/\btại\s+HL\b/i, '').replace(/\bNGÀY\b/i, '').replace(/\s+/g, ' ').trim();
  // "15h" / "15h30" → "15:00" / "15:30"
  t = t.replace(/(\d{1,2})h(\d{2})?/i, (_, h, mi) => `${h.padStart(2, '0')}:${mi || '00'}`);
  return t.slice(0, 30);
}
// parse 1 block Booking → { ten, phone, gio_hen } hoặc null nếu thiếu SĐT/thời gian.
export function parseBooking(text) {
  if (!/booking/i.test(text || '')) return null;
  const ten = trichTruong(text, 'tên') || trichTruong(text, 'ten') || 'Quý khách';
  const phone = sdtTuChuoi(trichTruong(text, 'sđt') || trichTruong(text, 'sdt') || text);
  const gioRaw = trichTruong(text, 'thời gian') || trichTruong(text, 'thoi gian') || trichTruong(text, 'giờ') || trichTruong(text, 'gio');
  if (!phone || !gioRaw) return null;
  return { ten: ten.slice(0, 30), phone, gio_hen: chuanGioHen(gioRaw) };
}

// Webhook Telegram nhận tin group đặt lịch. Đăng ký: setWebhook bot Telegram → BASE/telegram/booking.
// Bảo vệ bằng secret token (header X-Telegram-Bot-Api-Secret-Token khớp TELEGRAM_BOOKING_SECRET).
app.post('/telegram/booking', (req, res) => {
  res.status(200).json({ ok: true }); // trả 200 ngay
  try {
    const secret = process.env.TELEGRAM_BOOKING_SECRET;
    if (secret && req.get('X-Telegram-Bot-Api-Secret-Token') !== secret) return;
    // Lọc theo group được phép (env TELEGRAM_BOOKING_CHAT_ID) — chỉ nhận booking từ đúng group đặt lịch.
    const chatId = req.body?.message?.chat?.id || req.body?.channel_post?.chat?.id;
    const chatTitle = req.body?.message?.chat?.title || req.body?.channel_post?.chat?.title || '';
    // Ghi lại chat gần nhất (để /admin đọc chat_id lúc setup, khỏi phụ thuộc log)
    if (chatId) store.setKV('tele_booking_last_chat', JSON.stringify({ id: chatId, title: chatTitle, at: Date.now() }));
    const msg = req.body?.message || req.body?.channel_post;
    const text = msg?.text || msg?.caption;
    if (!text) return;
    // Cho phép NHIỀU group (phân tách phẩy) — group đặt lịch từng đổi id, env cũ trỏ group chết
    // là cả luồng câm lặng không ai biết. Giờ: tin CÓ chữ Booking mà bị chặn → ghi KV + log rõ
    // để /admin/booking-webhook chẩn đoán được ("anh chưa bao giờ nhận biên nhận" 14/07).
    const allow = (process.env.TELEGRAM_BOOKING_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allow.length && !allow.includes(String(chatId))) {
      if (/booking/i.test(text)) {
        store.setKV('tele_booking_dropped', JSON.stringify({ id: chatId, title: chatTitle, at: Date.now() }));
        console.warn(`[telegram-booking] ⚠️ tin Booking từ chat ${chatId} (${chatTitle}) BỊ CHẶN — TELEGRAM_BOOKING_CHAT_ID=${allow.join(',')} không chứa id này!`);
      }
      return;
    }
    const bk = parseBooking(text);
    if (!bk) return; // không phải block booking đủ dữ liệu → bỏ qua
    // GHI SỔ HẸN trước (anh duyệt 14/07): để cron nhắc T-1 ngày + T-2 giờ.
    const henEpoch = parseHenEpoch(bk.gio_hen);
    const so = store.addBooking({
      phone: bk.phone, ten: bk.ten, gioHenText: bk.gio_hen,
      henEpoch, chatId, msgId: msg?.message_id,
    });
    sendZnsXacNhanLich(bk.phone, { ten: bk.ten, gio_hen: bk.gio_hen }).then(async (r) => {
      // Biên nhận REPLY thẳng dưới tin Booking trong group đặt lịch (anh yêu cầu 14/07);
      // gửi group hụt thì lùi về group thông báo (notifyText) — không được câm.
      if (r.ok) {
        store.setBookingXacNhan(so.id, 'ok');
        const nhac = henEpoch
          ? ' Em sẽ nhắc lại trước 1 ngày và trước 2 giờ.'
          : ' ⚠️ Không đọc được ngày giờ nên KHÔNG hẹn nhắc lại được — gõ dạng "15h 09/07/2026" giúp em.';
        const bien = `📅 Đã gửi ZNS xác nhận cho ${bk.ten} (${bk.phone}) — hẹn ${bk.gio_hen}.${nhac}`;
        if (!(await guiBienNhan(chatId, msg?.message_id, bien))) {
          notifyText(`📅 <b>Đã gửi ZNS xác nhận đặt lịch</b>\n• Khách: ${bk.ten}\n• SĐT: ${bk.phone}\n• Hẹn: ${bk.gio_hen}`).catch(() => {});
        }
      } else if (r.ly_do !== 'vua_gui_roi') {
        store.setBookingXacNhan(so.id, `loi_${r.ly_do}`);
        const bien = `⚠️ ZNS xác nhận KHÔNG gửi được (${r.ly_do}) — ${bk.ten} ${bk.phone}, hẹn ${bk.gio_hen}. Nhờ telesale nhắn/gọi tay giúp em ạ.`;
        if (!(await guiBienNhan(chatId, msg?.message_id, bien))) {
          notifyText(`⚠️ Xác nhận đặt lịch KHÔNG gửi được (${r.ly_do})\n• ${bk.ten} ${bk.phone} — ${bk.gio_hen}`).catch(() => {});
        }
      }
    }).catch(() => {});
  } catch (err) {
    console.error('[telegram-booking] lỗi:', err?.message || err);
  }
});

// Admin: test parse + gửi xác nhận thủ công. GET /admin/xac-nhan-lich?token=&phone=&ten=&gio=
app.get('/admin/xac-nhan-lich', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const { phone, ten, gio } = req.query;
  if (!phone || !gio) return res.status(400).json({ ok: false, error: 'thiếu phone hoặc gio' });
  const r = await sendZnsXacNhanLich(String(phone), { ten: ten ? String(ten) : undefined, gio_hen: chuanGioHen(gio) });
  res.status(r.ok ? 200 : 500).json({ ok: r.ok, ...r });
});

// Admin: quản webhook Telegram bot ĐẶT LỊCH (token riêng TELEGRAM_BOOKING_TOKEN — TÁCH khỏi bot
// thông báo để không đá webhook nhau). Bot tự gọi Telegram API, anh KHÔNG cần cầm token.
// GET /admin/booking-webhook?token=XXX            → xem trạng thái hiện tại (getWebhookInfo)
// GET /admin/booking-webhook?token=XXX&set=1      → set webhook về BASE/telegram/booking (+secret)
// GET /admin/booking-webhook?token=XXX&updates=1  → xem tin gần đây (getUpdates) để lấy chat_id group
app.get('/admin/booking-webhook', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const bt = process.env.TELEGRAM_BOOKING_TOKEN;
  if (!bt) return res.status(400).json({ ok: false, error: 'chưa đặt env TELEGRAM_BOOKING_TOKEN (token bot đặt lịch riêng)' });
  const api = (m) => `https://api.telegram.org/bot${bt}/${m}`;
  try {
    if (req.query.set === '1' || req.query.set === 'true') {
      const base = process.env.PUBLIC_BASE_URL || 'https://botgeminicheckpage.onrender.com';
      const secret = process.env.TELEGRAM_BOOKING_SECRET || '';
      const url = `${base}/telegram/booking`;
      const resp = await fetch(api('setWebhook'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, secret_token: secret || undefined, allowed_updates: ['message', 'channel_post'] }),
      });
      const data = await resp.json();
      return res.status(200).json({ ok: data?.ok === true, action: 'setWebhook', url, co_secret: !!secret, ket_qua: data });
    }
    // đọc chat gần nhất webhook nhận (để lấy chat_id group lúc setup)
    if (req.query.last_chat === '1') {
      let last = null; try { last = JSON.parse(store.getKV('tele_booking_last_chat') || 'null'); } catch { /* trống */ }
      return res.status(200).json({ ok: true, chat_gan_nhat: last });
    }
    const m = (req.query.updates === '1' || req.query.updates === 'true') ? 'getUpdates' : 'getWebhookInfo';
    const data = await (await fetch(api(m))).json();
    // với getUpdates: rút gọn để dễ tìm chat_id + text
    if (m === 'getUpdates') {
      const goi = (data?.result || []).map((u) => {
        const g = u.message || u.channel_post || {};
        return { chat_id: g.chat?.id, chat_ten: g.chat?.title || g.chat?.type, from: g.from?.first_name, text: (g.text || '').slice(0, 60) };
      });
      return res.status(200).json({ ok: true, so_tin: goi.length, tin: goi });
    }
    // Kèm chẩn đoán cấu hình: soi ngay được vì sao booking không chạy (filter chặn / thiếu env).
    let biChan = null; try { biChan = JSON.parse(store.getKV('tele_booking_dropped') || 'null'); } catch { /* trống */ }
    let lastChat = null; try { lastChat = JSON.parse(store.getKV('tele_booking_last_chat') || 'null'); } catch { /* trống */ }
    res.status(200).json({
      ok: true,
      webhook: data?.result,
      cau_hinh: {
        allow_chat_id: process.env.TELEGRAM_BOOKING_CHAT_ID || '(không lọc — nhận mọi group bot ở trong)',
        co_secret: Boolean(process.env.TELEGRAM_BOOKING_SECRET),
        chat_gan_nhat: lastChat,
        booking_bi_chan_gan_nhat: biChan, // ≠ null = có tin Booking bị filter chặn → sửa TELEGRAM_BOOKING_CHAT_ID
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'lỗi' });
  }
});

// Admin: soi SỔ HẸN (booking đã lưu + trạng thái xác nhận/nhắc). GET /admin/so-hen?token=XXX
app.get('/admin/so-hen', (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || req.query.token !== adminToken) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const rows = store.listBookings(parseInt(req.query.limit || '30', 10)).map((b) => ({
    id: b.id, ten: b.ten, phone: b.phone, hen: b.gio_hen_text,
    hen_epoch: b.hen_epoch, xacnhan: b.xacnhan,
    nhac_truoc_1_ngay: b.nhac1_at ? new Date(b.nhac1_at * 1000).toISOString() : null,
    nhac_truoc_2_gio: b.nhac2_at ? new Date(b.nhac2_at * 1000).toISOString() : null,
    tao_luc: b.created_at ? new Date(b.created_at * 1000).toISOString() : null,
  }));
  res.status(200).json({ ok: true, so_luong: rows.length, so_hen: rows });
});

// --- Webhook FOLLOW Zalo OA (bước 7): khách bấm Quan tâm → tự giao PDF + video ---
// Zalo gửi event 'follow' về URL này (cấu hình trong Zalo Developer Console).
// Nút "Kiểm tra" của Console gửi GET → phải trả 200, không thì báo "đường dẫn không hợp lệ".
app.get('/zalo/webhook', (_req, res) => res.status(200).json({ ok: true }));
app.post('/zalo/webhook', (req, res) => {
  res.status(200).json({ received: true }); // trả 200 ngay (Zalo khỏi retry)
  const mac = req.get('X-ZEvent-Signature') || req.get('x-zevent-signature') || null;
  const opts = { rawBody: req.rawBody, macHeader: mac };
  // VERIFY 1 LẦN CHUNG cho cả 3 handler (trước đây submit-info/rating KHÔNG qua verify → giả mạo được).
  // Chế độ 'enforce' sai chữ ký → bỏ TẤT CẢ; 'log'/'off' → cho qua (xem src/follow.js webhookMode()).
  if (!zaloWebhookAllowed(req.body, opts)) return;
  try { handleZaloFollow(req.body, opts); } catch (err) { console.error('[zalo-webhook] lỗi:', err?.message || err); }
  // khách bấm nút "Chia sẻ thông tin" → nhận SĐT chính chủ, nối hồ sơ (mỗi handler tự lọc event)
  try { handleZaloSubmitInfo(req.body); } catch (err) { console.error('[zalo-webhook] submit-info lỗi:', err?.message || err); }
  // khách chấm sao form đánh giá → radar: ≤3 sao réo anh gọi cứu (van xả complain)
  try { handleZaloRating(req.body); } catch (err) { console.error('[zalo-webhook] rating lỗi:', err?.message || err); }
  // khách unfollow/block OA → đếm để đo tỷ lệ rời bỏ (sức khỏe OA)
  try { handleZaloUnfollow(req.body); } catch (err) { console.error('[zalo-webhook] unfollow lỗi:', err?.message || err); }
});

// --- Xác thực domain với Zalo (nếu Console đòi) ---
// Cách 1 (file): Zalo phát file zalo_verifierXXX.html → dán NỘI DUNG file vào env
//   ZALO_VERIFIER_CONTENT là route này phục vụ đúng file đó.
// Cách 2 (meta tag): dán mã vào env ZALO_SITE_VERIFICATION → nhúng vào trang chủ bên dưới.
app.get(/^\/zalo[\w.-]*\.html$/i, (_req, res) => {
  const content = process.env.ZALO_VERIFIER_CONTENT;
  if (!content) return res.status(404).send('chưa cấu hình ZALO_VERIFIER_CONTENT');
  res.status(200).type('html').send(content);
});

/**
 * Trích thông tin tin nhắn từ payload webhook Pancake.
 * Payload Pancake có nhiều biến thể → cố gắng đọc linh hoạt nhiều khóa.
 * Trả về null nếu không phải tin của KHÁCH (vd page/bot tự gửi) → bỏ qua tránh loop.
 */
// Bỏ thẻ HTML + giải mã entity cơ bản (Pancake gửi message bọc <div>...</div>).
function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Trích thông tin tin nhắn từ payload webhook Pancake (messaging event).
 * Cấu trúc THẬT (đã xác minh qua log): { data: { conversation: {...}, message: {...} } }
 *  - data.message.conversation_id / data.conversation.id  → conversation_id
 *  - data.message.page_id                                  → page_id
 *  - data.message.message                                  → nội dung (bọc <div>)
 *  - data.message.from.id / .name                          → người gửi (khách hay page)
 * Trả về null nếu tin do PAGE/bot gửi (from.id === page_id) → tránh loop.
 */
// Quét ĐỆ QUY mọi field trong payload (card liên hệ/attachment) tìm SĐT VN hợp lệ (đúng 10 số, đầu 03/05/07/08/09).
// Dùng cho card liên hệ Zalo chứa số. Trả về số chuẩn hoá hoặc null.
function findPhoneInPayload(obj, depth = 0) {
  if (obj == null || depth > 6) return null;
  if (typeof obj === 'string' || typeof obj === 'number') {
    const digits = String(obj).replace(/[^\d]/g, '');
    // thử các cụm 10-11 số trong chuỗi
    const m = String(obj).match(/(?:\+?84|0)[\d .\-()]{8,13}\d/g) || [];
    for (const cand of [...m, digits]) {
      let s = String(cand).replace(/[^\d]/g, '');
      if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
      if (/^0(3|5|7|8|9)\d{8}$/.test(s)) return s;
    }
    return null;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) { const r = findPhoneInPayload(x, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) { const r = findPhoneInPayload(obj[k], depth + 1); if (r) return r; }
  }
  return null;
}

// Trích DẤU NGUỒN quảng cáo từ payload webhook: khách bấm QC Messenger → Meta gắn referral
// {ad_id, ref, source:'ADS'}; Pancake chuyển tiếp ở vị trí khác nhau tuỳ kênh/sự kiện.
// Quét đệ quy tìm ad_id / ref / post_id — best-effort, thiếu thì thôi, KHÔNG chặn luồng chính.
// Telesale cần dòng này để biết khách đến từ camp nào (yêu cầu anh Trình 09/07).
function findNguonInPayload(obj, out = {}, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  if (Array.isArray(obj)) {
    for (const x of obj) findNguonInPayload(x, out, depth + 1);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (!out.adId && /^ads?_id$/.test(k) && (typeof v === 'string' || typeof v === 'number') && String(v).length >= 8) {
      out.adId = String(v);
    }
    if (!out.adId && k === 'ad_ids' && Array.isArray(v) && v.length > 0) out.adId = String(v[0]);
    if (!out.ref && k === 'ref' && typeof v === 'string' && v.trim()) out.ref = v.trim().slice(0, 80);
    if (!out.postId && k === 'post_id' && typeof v === 'string' && /^\d+_\d+$/.test(v)) out.postId = v;
    if (v && typeof v === 'object') findNguonInPayload(v, out, depth + 1);
  }
  return out;
}

function parsePancakeWebhook(body) {
  if (!body || typeof body !== 'object') return null;

  const data = (body.data && typeof body.data === 'object') ? body.data : body;
  const msg = (data.message && typeof data.message === 'object') ? data.message : data;
  const conv = (data.conversation && typeof data.conversation === 'object') ? data.conversation : {};

  const pageId =
    msg.page_id || data.page_id || body.page_id || null;
  const conversationId =
    msg.conversation_id || conv.id || data.conversation_id || null;

  const fromObj = msg.from || conv.from || {};
  const senderId = fromObj.id || null;
  const customerName = fromObj.name || conv.customer_name || null;

  // Nội dung: data.message.message (bọc HTML) — strip ra text sạch.
  const rawText =
    (typeof msg.message === 'string' ? msg.message : null) ||
    msg.text || conv.snippet || null;
  let messageText = stripHtml(rawText);

  // Khách KHÔNG gõ chữ mà gửi ẢNH/STICKER/FILE/VOICE/CARD LIÊN HỆ.
  // ⚠️ KÊNH ZALO: khách hay gửi "danh thiếp/card liên hệ" chứa SĐT thay vì gõ — phải BẮT số đó,
  // nếu không bot xin số lại hoài (lỗi đã thấy: card "097 845 1211" bot không nhận). Quét SĐT trong
  // toàn bộ payload attachment; thấy số VN hợp lệ → đưa thành text để extractPhone chốt lead.
  let attachmentOnly = false; // tin CHỈ có ảnh/tệp, không chữ (để handlePageMessage khỏi nhầm là telesale)
  if (!messageText) {
    const att = msg.attachments || msg.attachment || conv.attachments || data.attachments;
    const hasAttachment = Array.isArray(att) ? att.length > 0 : Boolean(att);
    if (hasAttachment) {
      const phoneInAtt = findPhoneInPayload(att);
      // STICKER ≠ ẢNH BỆNH (ca Minh Trang 07/07: khách gửi sticker "Yes Sir", bot tưởng
      // ảnh X-quang → "Bác sĩ cần xem trực tiếp..." sai trọng tâm). Nhận diện qua payload
      // (type "sticker"/emoticon/đường dẫn sticker) → placeholder riêng cho Gemini đáp nhẹ.
      const laSticker = /sticker|emoticon/i.test(JSON.stringify(att) || '');
      messageText = phoneInAtt
        ? `Số điện thoại của tôi là ${phoneInAtt}`   // card liên hệ → đưa số vào để bot chốt
        : (laSticker ? '[khách gửi sticker cảm xúc]' : '[khách vừa gửi một hình ảnh/tệp]');
      attachmentOnly = !phoneInAtt;
    }
  }
  // CARD liên hệ đôi khi VẪN có messageText (tên) + số nằm trong attachment → vẫn cố vớt số.
  else {
    const att = msg.attachments || msg.attachment || conv.attachments || data.attachments;
    if (att && !/\d{9,}/.test(messageText)) {
      const phoneInAtt = findPhoneInPayload(att);
      if (phoneInAtt) messageText = `${messageText} (số: ${phoneInAtt})`;
    }
  }

  if (!conversationId || !pageId || !messageText) return null;

  // Tin TỪ PAGE (người gửi = page_id): có thể là BOT tự gửi HOẶC telesale gõ tay.
  // Không bỏ qua nữa — trả về kèm cờ để handler phân biệt (phục vụ "người vào, bot lui").
  const fromPage = !!(senderId && pageId && String(senderId) === String(pageId));

  // DEBUG tạm (kênh Zalo): in from.id vs page_id để biết Pancake gắn vai khách Zalo thế nào.
  // (admin OA nhắn → Pancake có thể set from=page → fromPage=true → bot bỏ luồng tư vấn). Gỡ sau khi rõ.
  if (String(pageId).startsWith('zl_') || String(conversationId).startsWith('zl_')) {
    console.log(`[zalo-debug] from.id=${senderId} | page_id=${pageId} | fromPage=${fromPage} | name=${customerName} | text="${String(messageText).slice(0,30)}"`);
  }

  // Dấu nguồn QC (ad_id/ref/post_id) — handler lưu kv lần đầu để dòng "Nguồn" báo telesale.
  const nguonRaw = findNguonInPayload(data);
  const nguon = (nguonRaw.adId || nguonRaw.ref || nguonRaw.postId) ? nguonRaw : null;

  return {
    pageId: String(pageId),
    conversationId: String(conversationId),
    customerId: senderId ? String(senderId) : null,
    customerName,
    messageText,
    fromPage,
    attachmentOnly,
    aiGenerated: fromObj.ai_generated === true,
    nguon,
  };
}

// --- Webhook nhận tin từ Pancake ---
// GET cho nút "Kích hoạt"/verify của Pancake: nó gọi kiểm tra endpoint trước khi bật webhook,
// dính 404 là từ chối bật (webhook page 1 từng bị tắt vì "tỉ lệ lỗi >80%" mà không bật lại được).
// Cùng bài với GET /zalo/webhook cho validator Zalo Console.
app.get('/webhook', (_req, res) => res.status(200).json({ ok: true }));

app.post('/webhook', (req, res) => {
  // Trả 200 NGAY để Pancake không retry; xử lý bất đồng bộ sau.
  res.status(200).json({ received: true });

  try {
    // COMMENT dưới bài → BỎ QUA HẲN. Việc rep comment + kéo vào inbox đã do
    // META BUSINESS SUITE (Automation "Bình luận để nhắn tin") lo. Bot Gemini KHÔNG đụng
    // comment nữa để tránh TRÙNG + tránh lỗi sai tham số Pancake (action private_replies /
    // thiếu message_id — đã thấy hụt trong log 29/06). comment.js giữ lại làm dự phòng,
    // chỉ KHÔNG gọi. Vẫn phải nhận diện để comment không rơi xuống parse như tin inbox.
    if (isCommentEvent(req.body)) {
      return; // Meta lo comment; bot chỉ xử inbox
    }

    const ev = parsePancakeWebhook(req.body);
    if (!ev) {
      // DEBUG tạm (gỡ sau khi đấu xong Zalo): log gọn payload không parse được để bắt format Zalo.
      try {
        const b = req.body?.data || req.body || {};
        const pid = b.message?.page_id || b.page_id || b.conversation?.page_id;
        if (pid) console.log(`[webhook][raw] không parse được — page_id=${pid} keys=${Object.keys(b).join(',')}`);
      } catch {}
      return; // payload không đủ → bỏ qua
    }
    if (!isPageEnabled(ev.pageId)) {
      console.log(`[webhook] page ${ev.pageId} chưa bật bot → bỏ qua`);
      return;
    }
    // Tin TỪ PAGE: nếu là telesale gõ tay → đánh dấu "người tiếp quản" (bot lui).
    // Nếu là bot tự gửi / tin hệ thống → bỏ qua.
    if (ev.fromPage) {
      handlePageMessage(ev); // không await
      return;
    }
    console.log(`[webhook] tin từ ${ev.customerName || ev.customerId} (conv ${ev.conversationId}): ${ev.messageText.slice(0, 80)}`);
    handleIncoming(ev); // không await — chạy nền
  } catch (err) {
    console.error('[webhook] lỗi parse:', err?.message || err);
  }
});

// --- Cron NHẮC LỊCH HẸN cho khách (anh duyệt 14/07): T-1 ngày + T-2 giờ, mỗi 10' lệch 3' ---
cron.schedule('3,13,23,33,43,53 * * * *', async () => {
  try { await bookingNhacTick(); }
  catch (err) { console.error('[cron] lỗi nhắc lịch hẹn:', err?.message || err); }
});

// --- Cron retouch mỗi 10 phút ---
// Nhịp dập "nóng vừa" (im ~24' → dập): cron 10' để độ trễ bám mốc còn ≤10' thay vì ~15'.
cron.schedule('*/10 * * * *', async () => {
  try {
    const holdHours = parseFloat(process.env.HUMAN_HOLD_HOURS || '6');
    const targets = store.findRetouchTargets(config.retouch.minIdleHours, config.retouch.maxCount, holdHours);
    if (targets.length === 0) return;
    console.log(`[cron] ${targets.length} hội thoại cần chạm lại`);
    for (const conv of targets) {
      // chỉ chạm lại trang đang bật bot
      if (!isPageEnabled(conv.page_id)) continue;
      await handleRetouch(conv);
    }
  } catch (err) {
    console.error('[cron] lỗi retouch:', err?.message || err);
  }
});

// --- Cron ENGINE 7 CHẠM (gom từ nhac-7cham local) mỗi 15 phút, lệch 5' với retouch ---
// QUÉT Pancake các page → tính mốc chạm theo inserted_at (48h) → rẽ nhánh:
//   • Chạm 3/4/6 (giá trị): bot tự gửi.  • Chạm 2/5/7: có SĐT → báo telesale gọi; chưa SĐT → bot tự nhắn xin số.
// Báo Telegram LỌC KỸ (chỉ ca có số / muốn đặt lịch chưa số / đặc biệt). Chống trùng qua touch_done.
cron.schedule('5,20,35,50 * * * *', async () => {
  try {
    await runSevenTouch();
  } catch (err) {
    console.error('[cron-cham] lỗi engine 7 chạm:', err?.message || err);
  }
});

// --- Cron VỚT LEAD BỎ RƠI mỗi 5 phút — vá lỗ webhook rớt (bot chết tạm lúc deploy / Pancake không gửi lại) ---
// Quét Pancake: ca KHÁCH nhắn cuối + chưa rep + quá 3 phút → đẩy vào handleIncoming như webhook thật.
// Chạy DÀY (5') để cứu lead sớm, đặc biệt lead ĐÃ CHO SỐ mà tin rớt lúc deploy.
cron.schedule('*/5 * * * *', async () => {
  try {
    await runRescueLead();
  } catch (err) {
    console.error('[cron-rescue] lỗi engine vớt lead:', err?.message || err);
  }
});

// --- Cron CHUỖI CHẠM CA RA BILL (bước 5) + TÁI BILL theo nhóm (bước 6) ---
// Chạy mỗi giờ (phút 10). Engine tự lọc theo mốc + chống trùng → an toàn khi chạy lặp.
// Giờ VN = UTC+7; tin chăm vẫn rơi giờ hợp lý vì engine lọc theo NGÀY, không gửi đêm khuya quá vì
// cron chạy theo giờ máy (Render UTC) — nếu cần chặn khung giờ, đặt CARE_SEND_HOURS sau.
cron.schedule('10 * * * *', async () => {
  try {
    const n1 = await runBillTouches();      // bước 5: ngày 0→7 ca ra bill
    const n2 = await runGroupTouches();     // bước 6: tái bill 4 nhóm + liệu trình
    if (n1 || n2) console.log(`[cron-care] gửi ${n1} chạm bill + ${n2} chạm tái bill`);
  } catch (err) {
    console.error('[cron-care] lỗi engine chăm sóc bill/tái bill:', err?.message || err);
  }
});

// --- Cron CÚ CHẠM 2: NHẮC VOUCHER CHƯA DÙNG (anh Trình chốt 15/07) ---
// Mỗi ngày 09:00 giờ VN (= 02:00 UTC trên Render). Quét sổ voucher, ai nhận ≥N ngày
// chưa tới dùng → đẩy DANH SÁCH GỌI vào Telegram team để telesale gọi nhắc + đặt lịch.
// Chỉ đọc sổ + đẩy Telegram nội bộ (reversible). KHÔNG tự nhắn/gọi khách.
cron.schedule('0 2 * * *', async () => {
  try {
    const r = await runVoucherFollowup();
    if (r.canNhac) console.log(`[cron-voucher-followup] đẩy ${r.canNhac} ca cần gọi nhắc`);
  } catch (err) {
    console.error('[cron-voucher-followup] lỗi:', err?.message || err);
  }
});

// --- Cron TỰ NẠP CA RA BILL TỪ POS (B6) — mỗi 30 phút, phút 25/55 (lệch các cron khác) ---
// Quét đơn Pancake POS đã khám + có thuốc/tiêm → enrich MEDi → nạp chuỗi chạm D-BIS.
cron.schedule('25,55 * * * *', async () => {
  try {
    await runPosIngest();
    await flushRatingCho(); // xả hàng đợi form đánh giá (ca thanh toán tối muộn → bắn khung 7h-21h)
  } catch (err) {
    console.error('[cron-pos] lỗi tự nạp ca từ POS:', err?.message || err);
  }
});

// --- Cron BÁO CÁO TUẦN ZALO (B7) — thứ 2 08:00 giờ VN về Telegram ---
cron.schedule('0 8 * * 1', async () => {
  try {
    await baoCaoTuanZalo();
  } catch (err) {
    console.error('[cron-baocao] lỗi báo cáo tuần Zalo:', err?.message || err);
  }
}, { timezone: 'Asia/Ho_Chi_Minh' });

// --- Cron BROADCAST 4 TIN TRUYỀN THÔNG/THÁNG theo tag bệnh (Đòn 1 — kênh MIỄN PHÍ chạm cả tệp) ---
// Mỗi tuần 1 lần (thứ 4, 09:00 VN — giữa tuần, trong giờ vàng). Nội dung xoay theo tuần trong tháng:
// tuần1 giáo dục · tuần2 nhắc tái khám · tuần3 ưu đãi CT1 150k · tuần4 CT2 300k.
// broadcastTag tự dedup (1 tin/ngày/người, trần 4/tháng/người) + chốt giờ vàng → an toàn quota.
// Bật/tắt bằng BROADCAST_CRON_ENABLED (mặc định BẬT; tắt khẩn =0). Cần ZALO_OPENAPI_ENABLED=1.
const BROADCAST_CRON_ENABLED = !/^(0|false|no|off)$/i.test(process.env.BROADCAST_CRON_ENABLED || '1');
cron.schedule('0 9 * * 3', async () => {
  if (!BROADCAST_CRON_ENABLED) return;
  try {
    const jobs = broadcastJobsForNow();
    let tongGui = 0, tongBoQua = 0, tongLoi = 0, chay = 0;
    for (const job of jobs) {
      const kq = await broadcastTag({ tagKey: job.tagKey, header: job.header, text: job.text });
      if (kq?.ly_do === 'openapi_tat') {
        console.warn('[cron-broadcast] ZALO_OPENAPI_ENABLED chưa bật → không broadcast được. Bỏ lượt.');
        notifyText('⚠️ <b>Broadcast tuần bỏ lượt</b>: ZALO_OPENAPI_ENABLED chưa bật trên Render.').catch(() => {});
        return;
      }
      if (kq?.ly_do === 'ngoai_gio_vang') { console.warn('[cron-broadcast] ngoài giờ vàng → bỏ lượt.'); return; }
      if (kq?.ok) { tongGui += kq.da_gui || 0; tongBoQua += kq.bo_qua || 0; tongLoi += kq.loi?.length || 0; chay++; }
      await new Promise((r) => setTimeout(r, 1500)); // giãn giữa các tag, nương rate-limit Zalo
    }
    console.log(`[cron-broadcast] tuần ${tuanTrongThang()}: ${chay} tag, gửi ${tongGui}, bỏ qua ${tongBoQua}, lỗi ${tongLoi}`);
    if (tongGui) {
      notifyText(`📣 <b>Broadcast tuần ${tuanTrongThang()}</b>: gửi ${tongGui} tin qua ${chay} tag bệnh, bỏ qua ${tongBoQua} (đã nhận/hết quota tháng), lỗi ${tongLoi}.`).catch(() => {});
    }
  } catch (err) {
    console.error('[cron-broadcast] lỗi broadcast tuần:', err?.message || err);
  }
}, { timezone: 'Asia/Ho_Chi_Minh' });

// --- Cron ĐÁNH THỨC BN NGỦ (tệp MEDi cũ) — 1 lần/ngày lúc 02:15 UTC = 09:15 giờ VN ---
cron.schedule('15 2 * * *', async () => {
  try {
    const { sent, listed } = await runWakeup();
    if (sent || listed) console.log(`[cron-wakeup] ${sent} tự nhắc OA + ${listed} đẩy telesale`);
  } catch (err) {
    console.error('[cron-wakeup] lỗi engine đánh thức BN ngủ:', err?.message || err);
  }
});

// --- Khởi động ---
app.listen(config.port, () => {
  console.log(`🚀 Bot Gemini Hiệp Lợi chạy ở cổng ${config.port}`);
  console.log(`   Webhook: POST /webhook | Health: GET /health`);
});
