#!/usr/bin/env node
/**
 * 🩺 MÁY CANH SỨC KHOẺ BOT — dựng 06/09/2026 (anh Trình: "trường hợp nào cũng không được lỗi").
 *
 * CHỈ ĐỌC. Không gửi tin cho khách, không sửa file bot, không đụng git, không đổi env.
 * Thứ duy nhất nó GHI: 1 file trạng thái JSON (chống spam) + 1 tin Telegram vào group điều hành.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ VÌ SAO KHÔNG `import { notifyText } from '../src/telegram.js'` (dù đề bài gợi ý):
 *   `src/telegram.js` kéo theo `config.js` + `store.js` + `pancake.js` + `fb.js`.
 *   ⇒ (a) nó MỞ SQLite, (b) nó NẠP BỘ NÃO — và sau bản vá 06/09, thiếu/cụt `system-prompt.md`
 *   là CHẾT CÓ CHỦ Ý. Tức máy canh sẽ chết đúng bởi sự cố mà nó có nhiệm vụ đi báo.
 *   Máy canh phải sống độc lập với thứ nó canh ⇒ tự bắn Telegram bằng ~10 dòng fetch.
 *   Đây là lựa chọn CÓ CHỦ Ý, không phải quên tái sử dụng.
 *
 * ⚠️ KHÔNG THÊM THƯ VIỆN NÀO: chỉ dùng Node built-in (fetch có sẵn từ Node 18; repo chạy Node 20.x).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CANH NHỮNG GÌ (mỗi mục ghi rõ CẦN GÌ MỚI ĐO ĐƯỢC):
 *   ① BOT CÒN SỐNG          — GET /health. Không cần bí mật gì. LUÔN chạy.
 *   ② RESTART BẤT THƯỜNG    — so `bootedAt` với lần chạy trước. Bắt được vòng lặp crash
 *                             (ca `system-prompt.md` thiếu/cụt) và ca hết RAM. Không cần bí mật.
 *   ③ LỆCH PHIÊN BẢN        — `commit` đang chạy khác cái mình mong đợi (env BOT_COMMIT_MONG_DOI).
 *                             Bắt ca "tưởng đã deploy mà chưa", và ca Render tự rollback.
 *   ④ BOT IM LẶNG           — có tin khách vào mà không có tin bot ra. ⚠️ CẦN token Pancake còn sống.
 *   ⑤ ĐẾM LỖI Gemini/PC/Zalo — ⚠️ CẦN RENDER_API_KEY + RENDER_SERVICE_ID (đọc log Render).
 *   ⑥ HẠN MỨC RENDER        — ⚠️ CẦN RENDER_API_KEY.
 *
 * 🚨 FAIL-CLOSED: mục nào THIẾU CHÌA KHOÁ thì in dưới cờ đỏ "CHƯA CANH ĐƯỢC", coi như
 *    CÒN VIỆC CHƯA THẤY — tuyệt đối không im lặng bỏ qua rồi báo "mọi thứ ổn".
 *    (Đúng luật gác cổng của CLAUDE.md: hòm nào đọc lỗi thì in dưới cờ đỏ.)
 *
 * CHỐNG SPAM (3 tầng):
 *   - GỘP: mỗi lần chạy bắn TỐI ĐA 1 tin Telegram, gom mọi cảnh báo vào đó.
 *   - NGƯỠNG LIÊN TIẾP: phải hỏng `LAN_LIEN_TIEP` lần liền (mặc định 2) mới kêu → nuốt nhiễu mạng.
 *   - KHOẢNG LẶNG: mỗi loại cảnh báo chỉ kêu lại sau `COOLDOWN_PHUT` (mặc định 60').
 *     Hết hỏng thì bắn đúng 1 tin "đã lành" rồi im.
 *
 * CHẠY:
 *   node scripts/canh-suc-khoe-bot.mjs           # chạy thật (có thể bắn Telegram)
 *   node scripts/canh-suc-khoe-bot.mjs --thu     # CHẠY KHÔ: in ra màn hình, KHÔNG bắn Telegram
 *   node scripts/canh-suc-khoe-bot.mjs --reset   # xoá trạng thái, coi như chạy lần đầu
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOC = path.join(__dirname, '..');

// --- nạp .env thủ công (không dùng dotenv để khỏi phụ thuộc node_modules) ---
function napEnv() {
  for (const ten of ['.env', '.env.canh']) {
    const p = path.join(GOC, ten);
    if (!fs.existsSync(p)) continue;
    for (const dong of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = dong.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim().replace(/^["']|["']$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
}
napEnv();

const THU = process.argv.includes('--thu');
const RESET = process.argv.includes('--reset');

const URL_BOT = process.env.BOT_URL || 'https://botgeminicheckpage.onrender.com';
const COOLDOWN_PHUT = parseInt(process.env.CANH_COOLDOWN_PHUT || '60', 10);
const LAN_LIEN_TIEP = parseInt(process.env.CANH_LAN_LIEN_TIEP || '2', 10);
const F_TRANG_THAI = path.join(GOC, 'data', 'canh-suc-khoe.json');

// ---------- trạng thái (chống spam + so mốc lần trước) ----------
function docTrangThai() {
  if (RESET) return {};
  try { return JSON.parse(fs.readFileSync(F_TRANG_THAI, 'utf8')); } catch { return {}; }
}
function ghiTrangThai(tt) {
  if (THU) return;
  try {
    fs.mkdirSync(path.dirname(F_TRANG_THAI), { recursive: true });
    fs.writeFileSync(F_TRANG_THAI, JSON.stringify(tt, null, 2));
  } catch (e) {
    console.error('[canh] không ghi được trạng thái:', e.message);
  }
}

// ---------- Telegram: tự bắn, không import src/telegram.js (xem lý do ở đầu file) ----------
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
async function banTelegram(text) {
  const tok = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_ADS_CHAT || process.env.TELEGRAM_CHAT_ID;
  if (!tok || !chat) {
    console.error('🔴 [canh] thiếu TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID → KHÔNG bắn được cảnh báo.');
    return false;
  }
  // Telegram chặn cứng 4096 ký tự — cắt chủ động, thà mất phần đuôi còn hơn mất CẢ TIN (HTTP 400).
  let t = text;
  if (t.length > 3900) t = t.slice(0, 3880) + '\n…(cắt bớt)';
  try {
    const c = new AbortController();
    const h = setTimeout(() => c.abort(), 15000);
    const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: t, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: c.signal,
    });
    clearTimeout(h);
    if (!r.ok) {
      console.error('🔴 [canh] Telegram từ chối:', r.status, (await r.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error('🔴 [canh] bắn Telegram lỗi:', e.message);
    return false;
  }
}

async function layJson(url, ms = 20000) {
  const c = new AbortController();
  const h = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* không phải JSON */ }
    return { ok: r.ok, status: r.status, data, text };
  } catch (e) {
    return { ok: false, status: null, data: null, loi: e.name === 'AbortError' ? 'quá hạn chờ' : e.message };
  } finally {
    clearTimeout(h);
  }
}

const gio = (d) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(d);

// ═══════════════════════════════════════════════════════════════════
async function main() {
  const tt = docTrangThai();
  const bay = { luc: Date.now() };
  const canhBao = [];   // {khoa, muc:'do'|'vang', dong}
  const chuaCanhDuoc = [];
  const binhThuong = [];

  // ── ① + ② + ③ : /health ─────────────────────────────────────────
  const h = await layJson(`${URL_BOT}/health`, 25000);
  if (!h.ok || !h.data?.ok) {
    // Render free ngủ dậy mất ~30-60s → thử lại 1 lần trước khi kết tội.
    const h2 = await layJson(`${URL_BOT}/health`, 60000);
    if (!h2.ok || !h2.data?.ok) {
      bay.hongHealth = (tt.hongHealth || 0) + 1;
      const lyDo = h2.loi || `HTTP ${h2.status}`;
      if (bay.hongHealth >= LAN_LIEN_TIEP) {
        canhBao.push({
          khoa: 'bot-chet', muc: 'do',
          dong: `🔴 <b>BOT KHÔNG TRẢ LỜI</b> — ${escapeHtml(lyDo)} (hỏng ${bay.hongHealth} lần liền)\n`
            + `   ${escapeHtml(URL_BOT)}/health\n`
            + '   ⇒ Khách nhắn vào KHÔNG AI TRẢ LỜI. Mở Render → service → Logs xem crash gì.',
        });
      } else {
        binhThuong.push(`⚠️ /health hụt lần ${bay.hongHealth}/${LAN_LIEN_TIEP} (${lyDo}) — chưa kêu, chờ lần sau xác nhận.`);
      }
    } else { Object.assign(h, h2); bay.hongHealth = 0; }
  } else bay.hongHealth = 0;

  if (h.ok && h.data?.ok) {
    const d = h.data;
    bay.bootedAt = d.bootedAt;
    bay.commit = d.commit;
    binhThuong.push(`🟢 Bot sống — commit <code>${escapeHtml(d.commit || '?')}</code>, khởi động lúc ${gio(new Date(d.bootedAt))}`);

    // ② restart bất thường
    if (tt.bootedAt && d.bootedAt && tt.bootedAt !== d.bootedAt) {
      const tuoiPhut = Math.round((Date.now() - new Date(d.bootedAt).getTime()) / 60000);
      bay.soLanRestart = (tt.soLanRestart || 0) + 1;
      const dauHieuLap = bay.soLanRestart >= 3;
      canhBao.push({
        khoa: dauHieuLap ? 'restart-lap' : 'restart',
        muc: dauHieuLap ? 'do' : 'vang',
        dong: `${dauHieuLap ? '🔴' : '🟡'} <b>BOT VỪA KHỞI ĐỘNG LẠI</b> — mới ${tuoiPhut} phút trước`
          + (dauHieuLap ? `\n   ⚠️ Đây là lần restart thứ ${bay.soLanRestart} máy canh thấy — <b>nghi VÒNG LẶP CRASH</b>.`
            + '\n   Hay gặp nhất: thiếu/cụt <code>system-prompt.md</code>, hoặc hết RAM.' : '')
          + '\n   Restart làm MẤT state trong RAM: hàng đợi tin khách, khoá chống trùng, mốc chống echo.',
      });
    } else if (tt.bootedAt === d.bootedAt) {
      bay.soLanRestart = 0;
    }

    // ③ lệch phiên bản
    const mongDoi = process.env.BOT_COMMIT_MONG_DOI;
    if (mongDoi && d.commit && !mongDoi.startsWith(d.commit) && !d.commit.startsWith(mongDoi)) {
      canhBao.push({
        khoa: 'lech-commit', muc: 'vang',
        dong: `🟡 <b>LỆCH PHIÊN BẢN</b> — đang chạy <code>${escapeHtml(d.commit)}</code>, mong đợi <code>${escapeHtml(mongDoi)}</code>\n`
          + '   ⇒ hoặc deploy chưa ăn, hoặc Render đã tự lui về bản cũ.',
      });
    }
  }

  // ── ④ BOT IM LẶNG — cần token Pancake còn sống ──────────────────
  // ĐO 06/09: token trong .env local đã bị xoay vòng (error_code 105) ⇒ máy canh KHÔNG đọc được
  // Pancake từ máy Mac. Đây là kiểu hỏng NGUY HIỂM NHẤT (bot còn sống, /health xanh, nhưng
  // không trả lời ai) nên KHÔNG được im lặng bỏ qua — phải nằm dưới cờ đỏ.
  const tokenUser = process.env.PANCAKE_API_TOKEN;
  if (!tokenUser) {
    chuaCanhDuoc.push('④ <b>BOT IM LẶNG</b> (có tin khách vào, không có tin bot ra) — thiếu <code>PANCAKE_API_TOKEN</code> '
      + '(USER token, còn sống). Token trang trong <code>.env</code> đã bị xoay vòng (error_code 105).');
  } else {
    const r = await docBotImLang(tokenUser);
    if (r.loi) {
      chuaCanhDuoc.push(`④ <b>BOT IM LẶNG</b> — đọc Pancake lỗi: ${escapeHtml(r.loi)}`);
    } else if (r.soImLang > 0) {
      const nguong = parseInt(process.env.CANH_NGUONG_IM_LANG || '3', 10);
      const muc = r.soImLang >= nguong ? 'do' : 'vang';
      canhBao.push({
        khoa: 'bot-im-lang', muc,
        dong: `${muc === 'do' ? '🔴' : '🟡'} <b>BOT IM LẶNG</b> — ${r.soImLang} hội thoại có tin khách `
          + `quá ${r.phut} phút mà KHÔNG có tin nào của page trả lời.\n`
          + '   ⇒ Đây là kiểu hỏng nguy hiểm nhất: /health vẫn xanh mà khách bị bỏ rơi.\n'
          + (r.viDu.length ? `   Ví dụ: ${escapeHtml(r.viDu.slice(0, 3).join(' · '))}` : ''),
      });
    } else {
      binhThuong.push(`🟢 Không thấy hội thoại nào bị bỏ rơi quá ${r.phut} phút.`);
    }
  }

  // ── ⑤ + ⑥ ĐẾM LỖI + HẠN MỨC RENDER — cần RENDER_API_KEY ─────────
  const rKey = process.env.RENDER_API_KEY;
  const rSid = process.env.RENDER_SERVICE_ID;
  if (!rKey || !rSid) {
    chuaCanhDuoc.push('⑤ <b>ĐẾM LỖI Gemini / Pancake / Zalo</b> và ⑥ <b>HẠN MỨC RENDER</b> — thiếu '
      + '<code>RENDER_API_KEY</code> + <code>RENDER_SERVICE_ID</code>. '
      + 'Lấy ở Render → Account Settings → API Keys. Không có thì mọi lỗi chỉ nằm trong log Render, KHÔNG AI ĐỌC.');
  } else {
    const r = await demLoiRender(rKey, rSid);
    if (r.loi) chuaCanhDuoc.push(`⑤⑥ đọc Render lỗi: ${escapeHtml(r.loi)}`);
    else {
      for (const [ten, so] of Object.entries(r.dem)) {
        const nguong = parseInt(process.env[`CANH_NGUONG_${ten.toUpperCase()}`] || '10', 10);
        if (so >= nguong) {
          canhBao.push({
            khoa: `loi-${ten}`, muc: so >= nguong * 3 ? 'do' : 'vang',
            dong: `${so >= nguong * 3 ? '🔴' : '🟡'} <b>LỖI ${ten.toUpperCase()}</b>: ${so} lần trong ${r.phut} phút (ngưỡng ${nguong}).`,
          });
        }
      }
      if (!canhBao.some((c) => c.khoa.startsWith('loi-'))) {
        binhThuong.push(`🟢 Lỗi trong ${r.phut}' qua: ${Object.entries(r.dem).map(([k, v]) => `${k} ${v}`).join(' · ') || 'không có'}`);
      }
    }
  }

  // ── GỘP + KHOẢNG LẶNG + BẮN ─────────────────────────────────────
  const nay = Date.now();
  const cd = tt.coolDown || {};
  bay.coolDown = { ...cd };
  const banDi = [];
  for (const c of canhBao) {
    const truoc = cd[c.khoa] || 0;
    if (nay - truoc < COOLDOWN_PHUT * 60000) {
      binhThuong.push(`🔇 (đang trong khoảng lặng ${COOLDOWN_PHUT}' — không kêu lại: ${c.khoa})`);
      continue;
    }
    banDi.push(c);
    bay.coolDown[c.khoa] = nay;
  }

  // "ĐÃ LÀNH": trước có kêu, nay hết → bắn đúng 1 tin rồi xoá mốc (không kêu mãi).
  const dangHong = new Set(canhBao.map((c) => c.khoa));
  const daLanh = Object.keys(bay.coolDown).filter((k) => !dangHong.has(k));
  for (const k of daLanh) delete bay.coolDown[k];

  let than = '';
  if (banDi.length) {
    const coDo = banDi.some((c) => c.muc === 'do');
    than = `${coDo ? '🚨' : '⚠️'} <b>MÁY CANH BOT</b> — ${gio(new Date())}\n\n`
      + banDi.map((c) => c.dong).join('\n\n');
    if (chuaCanhDuoc.length) {
      than += '\n\n🔴 <b>CHƯA CANH ĐƯỢC (coi như còn việc chưa thấy):</b>\n· ' + chuaCanhDuoc.join('\n· ');
    }
  } else if (daLanh.length) {
    than = `✅ <b>MÁY CANH BOT</b> — ${gio(new Date())}\nĐã lành: ${daLanh.join(', ')}. Bot hoạt động bình thường trở lại.`;
  }

  // In ra màn hình LUÔN LUÔN (để chạy tay / đọc log cron).
  console.log(`── MÁY CANH BOT ${gio(new Date())} ──`);
  for (const d of binhThuong) console.log('  ' + d.replace(/<[^>]+>/g, ''));
  for (const c of canhBao) console.log('  ' + c.dong.replace(/<[^>]+>/g, ''));
  if (chuaCanhDuoc.length) {
    console.log('  🔴 CHƯA CANH ĐƯỢC:');
    for (const d of chuaCanhDuoc) console.log('    · ' + d.replace(/<[^>]+>/g, ''));
  }

  if (than) {
    if (THU) console.log('\n[--thu] SẼ bắn Telegram nội dung sau (nhưng KHÔNG bắn):\n' + than.replace(/<[^>]+>/g, ''));
    else await banTelegram(than);
  } else {
    console.log('  (không có gì phải kêu)');
  }

  ghiTrangThai(bay);
}

// ---------- ④ đọc Pancake tìm hội thoại bị bỏ rơi ----------
async function docBotImLang(userToken) {
  const phut = parseInt(process.env.CANH_IM_LANG_PHUT || '20', 10);
  const ids = [];
  for (let n = 1; ; n++) {
    const id = process.env[`PANCAKE_PAGE_${n}_ID`];
    if (!id) break;
    const kenh = process.env[`PANCAKE_PAGE_${n}_CHANNEL`] || 'facebook';
    if (kenh === 'facebook') ids.push(id);
  }
  if (!ids.length) return { loi: 'không có PANCAKE_PAGE_*_ID nào trong .env' };

  const moc = Date.now() - phut * 60000;
  let soImLang = 0;
  const viDu = [];
  for (const pid of ids) {
    const u = new URL(`https://pages.fm/api/v1/pages/${pid}/conversations`);
    u.searchParams.set('access_token', userToken);
    u.searchParams.set('type', 'INBOX');
    const r = await layJson(u.toString(), 20000);
    const list = r.data?.conversations || r.data?.data;
    if (!Array.isArray(list)) {
      return { loi: `page ${pid}: ${r.data?.message || r.loi || 'shape lạ'}` };
    }
    for (const c of list) {
      const capNhat = new Date(c.updated_at || c.inserted_at || 0).getTime();
      if (!capNhat || capNhat > moc) continue;       // còn mới, chưa tới hạn xét
      if (capNhat < moc - 6 * 3600000) continue;      // quá cũ, không phải việc của nhịp này
      // `last_sent_by` rỗng/khách = lượt cuối KHÔNG phải page ⇒ chưa ai trả lời.
      const cuoiLaPage = c.last_sent_by && String(c.last_sent_by.id || '') === String(pid);
      if (cuoiLaPage) continue;
      soImLang++;
      if (viDu.length < 3) viDu.push(`${(c.customers?.[0]?.name || c.id || '?')}`);
    }
  }
  return { soImLang, phut, viDu };
}

// ---------- ⑤ đếm lỗi từ log Render ----------
async function demLoiRender(key, sid) {
  const phut = parseInt(process.env.CANH_LOI_PHUT || '30', 10);
  const tu = new Date(Date.now() - phut * 60000).toISOString();
  const u = new URL('https://api.render.com/v1/logs');
  u.searchParams.set('ownerId', process.env.RENDER_OWNER_ID || '');
  u.searchParams.set('resource', sid);
  u.searchParams.set('startTime', tu);
  u.searchParams.set('limit', '1000');
  try {
    const c = new AbortController();
    const h = setTimeout(() => c.abort(), 25000);
    const r = await fetch(u.toString(), { headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, signal: c.signal });
    clearTimeout(h);
    if (!r.ok) return { loi: `Render API HTTP ${r.status}` };
    const j = await r.json();
    const dong = (j.logs || j.data || []).map((x) => String(x.message || x.text || ''));
    const dem = { gemini: 0, pancake: 0, zalo: 0, zns: 0 };
    for (const d of dong) {
      if (/\[gemini\].*(❌|CHẾT|lỗi)/i.test(d)) dem.gemini++;
      if (/\[pancake\].*(🔴|HỤT|CHẾT|lỗi)/i.test(d)) dem.pancake++;
      if (/\[zalo\].*(lỗi|thất bại|refresh.*(hỏng|lỗi))/i.test(d)) dem.zalo++;
      if (/\[zns\].*(lỗi|-\d{3,4})/i.test(d)) dem.zns++;
    }
    return { dem, phut };
  } catch (e) {
    return { loi: e.name === 'AbortError' ? 'quá hạn chờ Render API' : e.message };
  }
}

main().catch((e) => {
  console.error('🔴 [canh] máy canh tự chết:', e);
  process.exit(1);
});
