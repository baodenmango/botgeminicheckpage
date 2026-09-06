#!/usr/bin/env node
// ============================================================================
//  ĐỔ ZALO UID TỪ POS SANG BOT — dựng 06/09/2026 (anh Trình giao).
//
//  BỆNH: POS biết Zalo uid của khách, bot thì không. Ca thật — NGUYỄN VĂN CƯ
//  (52.200.000đ, bill 28/08): POS giữ uid `4715791318785423489`, bảng nối kênh của
//  bot trống ⇒ mọi chuỗi chăm sau bán rơi vào "mù kênh", ca 52 triệu không ai chạm.
//
//  VIỆC: quét POS lấy cặp SĐT ↔ Zalo uid rồi ghi vào bảng nối kênh của bot:
//     · KV `phone_zalo:<sdt>` — chính khoá mà care-send.js và /admin/noi-lai-kenh đọc
//     · cột conversations.zalo_user_id (chỉ VÁ chỗ trống, dùng store.setChannel/COALESCE)
//
//  🔴 MẶC ĐỊNH CHẠY KHÔ. Phải tự tay thêm --that mới ghi.
//  🔴 KHÔNG GHI ĐÈ uid đã có mà khác — chỉ in cảnh báo để người xem quyết.
//  🔴 KHÔNG gửi một tin nào cho khách. Chỉ đọc POS + ghi DB nội bộ.
//
//  ⚠️ GHI VÀO DB NÀO: store.js mở DB theo env DB_PATH (mặc định ./data/bot.sqlite).
//  Chạy trên máy local là ghi vào DB LOCAL — KHÔNG phải DB production trên đĩa Render.
//  Muốn đổ vào bot thật thì chạy script này TRÊN RENDER (shell của service), hoặc
//  xuất ra JSON bằng --json rồi nạp qua route admin.
//
//  CÁCH CHẠY
//    node scripts/do-zalo-uid-tu-pos.mjs                     # chạy khô, in số
//    node scripts/do-zalo-uid-tu-pos.mjs --json /tmp/uid.json # chạy khô + xuất cặp
//    node scripts/do-zalo-uid-tu-pos.mjs --that              # GHI THẬT vào DB bot
//
//  TOKEN: POS_API_TOKEN hoặc PANCAKE_API_TOKEN (POS Pancake xác thực bằng chính
//  token này, truyền qua query `access_token`). Thiếu token thì DỪNG và nói rõ —
//  KHÔNG được đoán số. Token trong .env local từng bị xoay vòng (error_code 105);
//  gặp 105/401 thì báo thẳng "token hết hạn", đừng in ra bảng số trống rồi coi là kết quả.
// ============================================================================
import axios from 'axios';
import fs from 'node:fs';
import * as store from '../src/store.js';

const ARGS = process.argv.slice(2);
const co = (c) => ARGS.includes(c);
const lay = (c, mac) => { const i = ARGS.indexOf(c); return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : mac; };

const THAT = co('--that');
const FILE_JSON = lay('--json', null);
const TOKEN = process.env.POS_API_TOKEN || process.env.PANCAKE_API_TOKEN || lay('--token', null);
const SHOP = process.env.POS_SHOP_ID || '714976321';
const BASE = process.env.POS_API_BASE || 'https://pos.pancake.vn/api/v1';
// Zalo OA THẬT của bot (khớp PANCAKE_PAGE_3_ID / ZALO_OA_ID). Chỉ uid của trang này
// mới gửi được qua Zalo OpenAPI / Pancake của bot.
const OA = process.env.ZALO_OA_PAGE_ID || `zl_${process.env.ZALO_OA_ID || '3136814239074246132'}`;
// Zalo CÁ NHÂN (khác OA) — đếm để báo cáo, TUYỆT ĐỐI KHÔNG ghi vào bảng nối kênh:
// uid của Zalo cá nhân nằm ở không gian tên khác, bot gửi bằng nó là gửi vào hư không.
const PZL = process.env.POS_PZL_PAGE_ID || 'pzl_858145769483882540';

function chuanHoaSdt(p) {
  let s = String(p ?? '').replace(/\D/g, '');
  if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
  if (!s.startsWith('0') && s.length === 9) s = '0' + s;
  return s.length === 10 ? s : '';
}
const tien = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';

async function quetTrang(pageId) {
  const ra = [];
  for (let p = 1; p <= 200; p++) {
    const { data } = await axios.get(`${BASE}/shops/${SHOP}/customers`, {
      params: { access_token: TOKEN, page_id: pageId, page_size: 100, page_number: p },
      timeout: 60000,
    });
    if (data?.error_code || data?.success === false) {
      throw new Error(`POS trả lỗi: ${JSON.stringify(data).slice(0, 200)}`);
    }
    const ds = data?.data || [];
    ra.push(...ds);
    if (!ds.length || p >= (data?.total_pages || 1)) break;
  }
  return ra;
}

function sdtCua(c) {
  const gop = [...(c.phone_numbers || []), ...((c.shop_customer || {}).phone_numbers || [])];
  return [...new Set(gop.map(chuanHoaSdt).filter(Boolean))];
}

async function main() {
  console.log('═'.repeat(78));
  console.log(`ĐỔ ZALO UID TỪ POS SANG BOT — ${THAT ? '⚠️  GHI THẬT (--that)' : 'CHẠY KHÔ (mặc định)'}`);
  console.log(`OA đích: ${OA}   ·   DB bot: ${process.env.DB_PATH || './data/bot.sqlite'}`);
  console.log('═'.repeat(78));
  if (!TOKEN) {
    console.error('❌ THIẾU TOKEN. Đặt POS_API_TOKEN (hoặc PANCAKE_API_TOKEN), hoặc truyền --token <tk>.');
    console.error('   KHÔNG chạy tiếp — thà không có số còn hơn in số bịa.');
    process.exit(2);
  }

  let khachOA; let khachPzl = [];
  try {
    khachOA = await quetTrang(OA);
  } catch (e) {
    console.error(`❌ Quét POS hụt: ${e.message}`);
    console.error('   Nếu là error_code 105 / 401 → TOKEN ĐÃ BỊ XOAY VÒNG, xin token mới rồi chạy lại.');
    process.exit(3);
  }
  try { khachPzl = await quetTrang(PZL); } catch { /* phụ, hụt cũng không sao */ }

  // ---- dựng cặp SĐT ↔ uid ----
  const cap = new Map();          // sdt -> uid
  let khongUid = 0; let khongSdt = 0; const xungDotNguon = [];
  for (const c of khachOA) {
    const fid = String(c.fb_id || c.psid || '');
    if (!fid.startsWith('zl_')) { khongUid++; continue; }   // bản ghi gộp: POS giấu uid Zalo
    const uid = fid.slice(3);
    const ds = sdtCua(c);
    if (!ds.length) { khongSdt++; continue; }
    for (const p of ds) {
      if (cap.has(p) && cap.get(p) !== uid) xungDotNguon.push({ sdt: p, uidA: cap.get(p), uidB: uid });
      else cap.set(p, uid);
    }
  }

  // ---- đối chiếu với bảng nối kênh của bot ----
  const ghiMoi = []; const daTrung = []; const lechUid = []; const vaConv = [];
  for (const [sdt, uid] of cap) {
    const cu = store.getKV(`phone_zalo:${sdt}`);
    let conv = null;
    try { conv = store.getZaloConvByPhone(sdt); } catch { /* DB chưa có bảng → coi như trống */ }
    if (cu && cu === uid) daTrung.push({ sdt, uid });
    else if (cu && cu !== uid) lechUid.push({ sdt, uidCu: cu, uidMoi: uid });
    else ghiMoi.push({ sdt, uid });
    if (conv && !conv.zalo_user_id) vaConv.push({ sdt, uid, conv: conv.conversation_id });
  }

  // ---- GHI (chỉ khi --that) ----
  let daGhiKv = 0; let daGhiConv = 0;
  if (THAT) {
    for (const { sdt, uid } of ghiMoi) {
      try { store.setKV(`phone_zalo:${sdt}`, uid); daGhiKv++; }
      catch (e) { console.error(`  ghi hụt phone_zalo:${sdt}:`, e.message); }
    }
    for (const { uid, conv } of vaConv) {
      // setChannel dùng COALESCE → chỉ điền chỗ TRỐNG, không đè uid sẵn có.
      try { store.setChannel(conv, 'zalo', uid); daGhiConv++; }
      catch (e) { console.error(`  vá conv ${conv} hụt:`, e.message); }
    }
  }

  // ---- BÁO CÁO ----
  const d = (n) => String(n).padStart(5);
  console.log('\n📊 QUÉT POS');
  console.log(`  ${d(khachOA.length)}  khách POS gắn Zalo OA ${OA}`);
  console.log(`  ${d(cap.size)}  cặp SĐT ↔ uid DÙNG ĐƯỢC`);
  console.log(`  ${d(khongUid)}  bản ghi POS KHÔNG lộ uid (fb_id là psid Facebook — khách gộp nhiều kênh)`);
  console.log(`  ${d(khongSdt)}  có uid nhưng KHÔNG có SĐT → không ghép được`);
  if (xungDotNguon.length) console.log(`  ${d(xungDotNguon.length)}  ⚠️ 1 SĐT ra NHIỀU uid ngay trong POS — giữ cái đầu, cần người soi`);

  console.log('\n📥 ĐỐI CHIẾU VỚI BẢNG NỐI KÊNH CỦA BOT');
  console.log(`  ${d(ghiMoi.length)}  CẦN GHI MỚI (bot chưa có)`);
  console.log(`  ${d(daTrung.length)}  đã có sẵn, trùng khớp → bỏ qua`);
  console.log(`  ${d(lechUid.length)}  ⚠️ đã có uid KHÁC → KHÔNG ghi đè, in ra dưới`);
  console.log(`  ${d(vaConv.length)}  hội thoại Zalo đang trống zalo_user_id → vá được`);
  console.log(`\n${THAT ? `✍️  ĐÃ GHI: ${daGhiKv} KV phone_zalo · ${daGhiConv} hội thoại được vá uid`
    : '🅳 CHẠY KHÔ — chưa ghi gì. Thêm --that để ghi thật.'}`);

  if (lechUid.length) {
    console.log('\n⚠️ LỆCH UID (bot đang giữ số khác POS — người quyết, máy không tự sửa):');
    for (const x of lechUid.slice(0, 20)) console.log(`   ${x.sdt}  bot=${x.uidCu}  pos=${x.uidMoi}`);
  }

  console.log(`\n🚧 ZALO CÁ NHÂN (${PZL}): ${khachPzl.length} khách trong POS.`);
  console.log('   KHÔNG ghi cặp nào từ đây — đó là tài khoản Zalo CÁ NHÂN, không phải OA của bot;');
  console.log('   uid khác không gian tên, bot gửi bằng nó là gửi vào hư không. Muốn chăm nhóm này');
  console.log('   thì phải mời họ bấm QUAN TÂM OA trước (ZNS mời OA), hoặc để người gõ tay.');

  if (FILE_JSON) {
    const out = {
      luc: new Date().toISOString(), oa: OA,
      cap: Object.fromEntries(cap), ghiMoi, lechUid, vaConv,
      thongKe: {
        khachOA: khachOA.length, capDungDuoc: cap.size, khongUid, khongSdt,
        canGhiMoi: ghiMoi.length, daTrung: daTrung.length, lechUid: lechUid.length,
        zaloCaNhanKhongDung: khachPzl.length,
      },
    };
    fs.writeFileSync(FILE_JSON, JSON.stringify(out, null, 2));
    console.log(`\n💾 Đã xuất ${cap.size} cặp ra ${FILE_JSON}`);
  }

  // Mẫu 5 cặp (che bớt số) để người đọc tin được là có data thật.
  console.log('\n🔎 MẪU 5 CẶP:');
  for (const { sdt, uid } of ghiMoi.slice(0, 5)) console.log(`   ${sdt.slice(0, 4)}***${sdt.slice(-3)} → ${uid}`);
  console.log('');
}

main().catch((e) => { console.error('❌ lỗi:', e?.message || e); process.exit(1); });
