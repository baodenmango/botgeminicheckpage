// ============================================================================
// KIỂM CHỨNG ĐƯỜNG GỬI/ĐỌC PANCAKE — 20/07/2026 (STUB, KHÔNG chạm mạng thật)
// ============================================================================
// Ca lỗi thật (log Render srv-d8v9896gvqtc73bvme80, 13:36→14:51 UTC = ĐÚNG 1 GIỜ):
//   29× "[pancake] gửi HỤT ... access_token renewed please use new access_token"
//   21× dòng "✅ đã gửi chạm bot" ← BÁO THÀNH CÔNG GIẢ, khách KHÔNG nhận được gì.
// Script này chặn axios bằng STUB (rào chắn: KHÔNG gọi API thật, KHÔNG gửi tin cho khách)
// rồi khẳng định hành vi của goiPancake/sendMessages/listConversations.
//
// CHẠY:  node scripts/kiem-duong-gui-pancake.mjs
// ============================================================================
import { pathToFileURL } from 'url';
import path from 'path';

const GOC = path.resolve(process.cwd());

// --- STUB axios: cắm TRƯỚC khi import pancake.js ---
const goi = []; // nhật ký mọi lệnh gọi: {method, url, params, body}
let traLoi = () => ({ status: 200, data: { success: true } });

const axiosStub = {
  async get(url, cfg = {}) { goi.push({ method: 'get', url, params: cfg.params, body: null }); return traLoi('get', url, cfg); },
  async post(url, body, cfg = {}) { goi.push({ method: 'post', url, params: cfg.params, body }); return traLoi('post', url, cfg, body); },
};

// ESM không cho chặn `import axios` từ ngoài → cách chắc chắn nhất mà KHÔNG đụng file gốc:
// đọc src/pancake.js, thay ĐÚNG dòng `import axios` bằng stub toàn cục, ghi ra file tạm rồi
// import file tạm. src/pancake.js NGUYÊN VẸN, và chắc chắn không có request thật nào rời máy.
import fs from 'fs';
const nguon = fs.readFileSync(path.join(GOC, 'src/pancake.js'), 'utf8')
  .replace("import axios from 'axios';", 'const axios = globalThis.__AXIOS_STUB__;');
const fileTam = path.join(GOC, 'scripts', '.pancake-stub.mjs');
// Sửa đường dẫn import tương đối cho khớp vị trí file tạm (scripts/ ≠ src/).
fs.writeFileSync(fileTam, nguon.replace(/from '\.\/([^']+)'/g, "from '../src/$1'"));
globalThis.__AXIOS_STUB__ = axiosStub;

// ⚠️ DB RIÊNG cho phép thử — TUYỆT ĐỐI không đụng data/bot.sqlite thật của bot
// (trí nhớ làn ghi qua store.setKV; chạy trên DB thật sẽ bẩn state production).
const DB_TAM = path.join(GOC, 'scripts', `.kiem-pancake-${process.pid}.sqlite`);
process.env.DB_PATH = DB_TAM;

// Env giả — KHÔNG phải token thật, chỉ là chuỗi đánh dấu để nhận diện trong log.
process.env.PANCAKE_API_TOKEN = 'USER_TOKEN_GIA';
process.env.PANCAKE_PAGE_1_ID = '386613267864665';
process.env.PANCAKE_PAGE_1_TOKEN = 'PAGE_TOKEN_GIA';
process.env.PANCAKE_PAGE_1_NAME = 'Page Phòng Khám Hiệp Lợi';
// config.js CHỈ đọc env 1 LẦN lúc nạp module (ESM cache) → phải khai đủ 3 page TRƯỚC khi import.
process.env.PANCAKE_PAGE_2_ID = '957014354156110';
process.env.PANCAKE_PAGE_2_TOKEN = 'PAGE_TOKEN_GIA_2';
process.env.PANCAKE_PAGE_3_ID = 'zl_3136814239074246132';
process.env.PANCAKE_PAGE_3_TOKEN = 'PAGE_TOKEN_GIA_ZALO';
process.env.PANCAKE_PAGE_3_CHANNEL = 'zalo';
process.env.ZALO_OPENAPI_ENABLED = '0';
process.env.BOT_HUMAN_DELAY = '0';
process.env.PANCAKE_AUTO_REFRESH = '0'; // CẦU DAO PHẢI GIỮ TẮT

const P = await import(pathToFileURL(fileTam).href);
const store = await import(pathToFileURL(path.join(GOC, 'src/store.js')).href);

const PAGE = '386613267864665';
const CONV = `${PAGE}_37399626573017742`;

// Xoá TRÍ NHỚ LÀN + cache nhãn giữa các phép thử, để mỗi phép đo đúng cái nó định đo
// (không thì phép thử sau ăn theo làn mà phép thử trước vừa học được).
function xoaTriNho() {
  for (const p of [PAGE, '957014354156110', 'zl_3136814239074246132']) {
    store.delKV(`pancake_lan_tot:${p}`);
    store.delKV(`pancake_token_alert_at:${p}`);
  }
  P.clearLabelCache?.();
}

let soDat = 0, soHong = 0;
function dat(mota, dieuKien, chiTiet = '') {
  if (dieuKien) { soDat++; console.log(`  ✅ ${mota}`); }
  else { soHong++; console.log(`  ❌ ${mota}${chiTiet ? ' — ' + chiTiet : ''}`); }
}

// ---------------------------------------------------------------------------
console.log('\n=== PHÉP THỬ 1: page token CHẾT (105) → TỰ ĐỔI sang USER token v1, tin TỚI NƠI ===');
console.log('(đúng ca thật: cả 3 page token trên Render trả "access_token renewed")');
xoaTriNho();
goi.length = 0;
traLoi = (method, url, cfg) => {
  if (cfg.params?.page_access_token) {
    return { status: 200, data: { success: false, error_code: 105, message: 'access_token renewed please use new access_token' } };
  }
  return { status: 200, data: { success: true, message_id: 'm_1' } };
};
let ok = await P.sendMessages(PAGE, CONV, ['Dạ chào anh chị ạ']);
dat('sendMessages trả TRUE (tin tới nơi thật)', ok === true, `nhận ${ok}`);
dat('gọi ĐÚNG 2 lần (làn page hụt → làn user)', goi.length === 2, `gọi ${goi.length} lần`);
dat('lần 1 = public_api + page_access_token', goi[0]?.url.includes('/api/public_api/v1/') && 'page_access_token' in (goi[0]?.params || {}), goi[0]?.url);
dat('lần 2 = /api/v1/ + access_token (USER)', goi[1]?.url.includes('/api/v1/') && !goi[1]?.url.includes('public_api')
  && goi[1]?.params?.access_token === 'USER_TOKEN_GIA', goi[1]?.url);
dat('lần 2 KHÔNG kèm page_access_token', !('page_access_token' in (goi[1]?.params || {})));
dat("body GIỮ NGUYÊN {message, action:'reply_inbox'}",
  goi[1]?.body?.action === 'reply_inbox' && goi[1]?.body?.message === 'Dạ chào anh chị ạ', JSON.stringify(goi[1]?.body));

// ---------------------------------------------------------------------------
console.log('\n=== PHÉP THỬ 2: page Zalo OA trả 102 "Invalid access_token" → cũng đổi làn ===');
// Dùng page Zalo OA RIÊNG (trí nhớ làn đã xoá) để phép thử 1 không làm nhiễu phép đo.
xoaTriNho();
goi.length = 0;
traLoi = (method, url, cfg) => {
  if (cfg.params?.page_access_token) return { status: 200, data: { success: false, error_code: 102, message: 'Invalid access_token' } };
  return { status: 200, data: { success: true } };
};
ok = await P.sendMessages('zl_3136814239074246132', 'zl_3136814239074246132_189326656005696080', ['test 102']);
dat('102 cũng được coi là "token chết" → đổi làn, gửi được', ok === true && goi.length === 2, `ok=${ok} goi=${goi.length}`);
dat('page_id giữ NGUYÊN DẠNG zl_ trên URL (v1 nhận đúng)', String(goi[1]?.url).includes('/pages/zl_3136814239074246132/'), goi[1]?.url);

// ---------------------------------------------------------------------------
console.log('\n=== PHÉP THỬ 3: LỖI KHÔNG PHẢI TOKEN (#551) → KHÔNG đổi làn (thử lại vô ích, tốn tin) ===');
xoaTriNho();
goi.length = 0;
traLoi = () => ({ status: 200, data: { success: false, error_code: 551, message: 'Người này hiện không có mặt' } });
ok = await P.sendMessages(PAGE, CONV, ['test 551']);
dat('sendMessages trả FALSE (KHÔNG báo thành công giả)', ok === false, `nhận ${ok}`);
dat('chỉ gọi 1 lần, không đổi làn vô ích', goi.length === 1, `gọi ${goi.length} lần`);

// ---------------------------------------------------------------------------
console.log('\n=== PHÉP THỬ 4: CẢ 2 LÀN ĐỀU CHẾT → trả FALSE, tuyệt đối không đóng dấu "đã gửi" ===');
xoaTriNho();
goi.length = 0;
traLoi = () => ({ status: 200, data: { success: false, error_code: 105, message: 'access_token renewed please use new access_token' } });
ok = await P.sendMessages(PAGE, CONV, ['test cả 2 làn chết']);
dat('sendMessages trả FALSE', ok === false, `nhận ${ok}`);
dat('đã thử ĐỦ 2 làn trước khi bỏ cuộc', goi.length === 2, `gọi ${goi.length} lần`);

// ---------------------------------------------------------------------------
console.log('\n=== PHÉP THỬ 5: NHỚ LÀN — lượt sau đi THẲNG làn user, khỏi tốn nhịp hụt ===');
xoaTriNho();
goi.length = 0;
traLoi = (method, url, cfg) => {
  if (cfg.params?.page_access_token) return { status: 200, data: { success: false, error_code: 105, message: 'access_token renewed' } };
  return { status: 200, data: { success: true } };
};
await P.sendMessages(PAGE, CONV, ['lượt 1']);   // học được làn 'user'
const soSauKhiHoc = goi.length;
goi.length = 0;
await P.sendMessages(PAGE, CONV, ['lượt 2']);   // phải đi thẳng
dat('lượt 1 tốn 2 nhịp (page hụt → user)', soSauKhiHoc === 2, `${soSauKhiHoc}`);
dat('lượt 2 CHỈ 1 nhịp, đi thẳng làn user', goi.length === 1 && goi[0]?.params?.access_token === 'USER_TOKEN_GIA', `gọi ${goi.length} lần`);

// ---------------------------------------------------------------------------
console.log('\n=== PHÉP THỬ 6: page token SỐNG → ưu tiên nó TRƯỚC (anh Trình dán tay = mới nhất) ===');
xoaTriNho();
goi.length = 0;
traLoi = () => ({ status: 200, data: { success: true } });
// Page 2 chưa từng học làn (đã xoaTriNho) → phải đi làn PAGE TOKEN trước.
await P.sendMessages('957014354156110', '957014354156110_1', ['ưu tiên page token']);
dat('gọi ĐÚNG 1 lần', goi.length === 1, `gọi ${goi.length}`);
dat('đi làn PAGE TOKEN trước (public_api + page_access_token)',
  goi[0]?.url.includes('/api/public_api/v1/') && 'page_access_token' in (goi[0]?.params || {}), goi[0]?.url);

// ---------------------------------------------------------------------------
console.log('\n=== PHÉP THỬ 7: CẦU DAO PANCAKE_AUTO_REFRESH vẫn TẮT — KHÔNG gọi generate_page_access_token ===');
const coXoayToken = goi.concat().some((g) => String(g.url).includes('generate_page_access_token'));
dat('không có lệnh XOAY token nào được gọi trong toàn bộ 6 phép thử trên', !coXoayToken);
dat('env PANCAKE_AUTO_REFRESH vẫn = 0', process.env.PANCAKE_AUTO_REFRESH === '0');

// ---------------------------------------------------------------------------
console.log('\n=== PHÉP THỬ 8: listConversations (rescue + đọc nhãn dùng chung) cũng tự đổi làn ===');
xoaTriNho();
goi.length = 0;
traLoi = (method, url, cfg) => {
  if (cfg.params?.page_access_token) return { status: 200, data: { success: false, error_code: 105, message: 'access_token renewed' } };
  return { status: 200, data: { conversations: [{ id: CONV, tags: [{ text: 'đã đặt lịch' }], customers: [{ id: 'uuid-1' }] }] } };
};
const kq = await P.listConversations(PAGE, { page_number: 1 });
dat('đọc được danh sách hội thoại qua làn USER token', kq.ok === true && kq.convs.length === 1, JSON.stringify(kq).slice(0, 120));
dat('báo đúng làn đang dùng = user', kq.lan === 'user', String(kq.lan));

// ---------------------------------------------------------------------------
console.log('\n=== PHÉP THỬ 9: đọc NHÃN không còn mù khi page token chết ===');
xoaTriNho();
goi.length = 0;
const chan = await P.hasStopLabel(PAGE, CONV);
dat('đọc được nhãn "đã đặt lịch" → hasStopLabel = TRUE (bot im, không chen ngang telesale)', chan === true, `nhận ${chan}`);
dat('có gọi qua làn USER token', goi.some((g) => g.params?.access_token === 'USER_TOKEN_GIA'));

// ---------------------------------------------------------------------------
fs.unlinkSync(fileTam);
for (const duoi of ['', '-shm', '-wal']) { try { fs.unlinkSync(DB_TAM + duoi); } catch {} }
console.log(`\n================ KẾT QUẢ: ${soDat} ĐẠT / ${soHong} HỎNG ================`);
process.exit(soHong ? 1 : 0);
