// ============================================================================
// STUB VERIFY 20/07/2026 — "Xoá sạch báo ✅ giả khi tin chưa tới khách"
//
// Ca lỗi thật (log Render srv-d8v9896gvqtc73bvme80, 13:36→14:51 UTC):
//   29× "[pancake] gửi HỤT ... access_token renewed please use new access_token"
//   NHƯNG vẫn in 21 dòng "✅ đã gửi" → bot trả lời vào khoảng không, khách hỏi
//   giá tiêm không nhận được gì, mà không ai biết để chăm lại.
//
// Cách kiểm: bắt TẦNG MẠNG (axios.post + global.fetch) trả đúng body lỗi thật,
// rồi chạy CODE THẬT của repo. Không gọi API thật, không gửi tin cho khách.
// Khẳng định: gửi hụt ⇒ 0 dòng ✅, có ❌ kèm convId/uid, hàm trả FALSE.
// ============================================================================
import { pathToFileURL } from 'node:url';
import axios from 'axios';

const REPO = '/Users/mac/Claude/Projects/Phòng khám Hiệp Lợi - Marketing & Vận hành/bot-gemini-checkpage';
const U = (p) => pathToFileURL(`${REPO}/${p}`).href;

// --- env tối thiểu để module nạp được (toàn giá trị giả, không phải token thật) ---
process.env.PANCAKE_PAGE_1_ID = '386613267864665';
process.env.PANCAKE_PAGE_1_TOKEN = 'STUB_TOKEN_KHONG_THAT';
process.env.PANCAKE_PAGE_1_CHANNEL = 'facebook';
process.env.PANCAKE_AUTO_REFRESH = '0';        // GIỮ CẦU DAO TẮT (rào chắn 3)
process.env.GEMINI_API_KEY = 'STUB';
process.env.ZALO_OPENAPI_ENABLED = '1';
process.env.ZALO_ACCESS_TOKEN = 'STUB';
// Mở khung giờ gửi để test chạm ĐƯỜNG GỬI THẬT. Nếu để mặc định 8-21, chạy stub lúc 22h
// sẽ bị guard khung giờ chặn trước và ta không kiểm được nhánh gửi hụt (guard trả false là
// hành vi ĐÚNG — hoãn, không phải hụt — nên phải mở ra mới soi được cái cần soi).
process.env.CARE_SEND_HOURS = '0-24';

// --- CẤM MẠNG THẬT: mọi lối ra ngoài đều bị chặn / trả lỗi mô phỏng ---
const BODY_LOI_THAT = { success: false, message: 'access_token renewed please use new access_token', error_code: 105 };
axios.post = async () => ({ status: 200, data: BODY_LOI_THAT });
axios.get = async () => ({ status: 200, data: BODY_LOI_THAT });
axios.request = axios.post;
// Zalo OpenAPI đi bằng fetch → trả error ≠ 0 = gửi hụt
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ error: -118, message: 'Zalo account not existed' }), text: async () => '{"error":-118}' });

const logs = [];
for (const m of ['log', 'warn', 'error']) {
  const goc = console[m].bind(console);
  console[m] = (...a) => { logs.push(a.map(String).join(' ')); goc('    |', ...a); };
}
const co = (re) => logs.some((l) => re.test(l));
const reset = () => { logs.length = 0; };

const ket = [];
const cham = (ten, ok) => { ket.push([ten, ok]); console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${ten}`); };

// ---------------------------------------------------------------------------
console.log('\n=== A. src/pancake.js sendMessages — Pancake trả success=false (ĐÚNG body ca 20/07) ===');
const pancake = await import(U('src/pancake.js'));
reset();
const kqA = await pancake.sendMessages('386613267864665', 'conv_STUB_001', ['thử tin 1', 'thử tin 2']);
console.log(`  → sendMessages trả về: ${JSON.stringify(kqA)}`);
cham('trả FALSE (không phải undefined — bug gốc là hàm thiếu return)', kqA === false);
cham('KHÔNG in dòng ✅ nào', !co(/✅/));
cham('CÓ log hụt kèm convId để truy vết', co(/conv_STUB_001/));

// ---------------------------------------------------------------------------
console.log('\n=== B. src/care-send.js — hụt thì KHÔNG trừ quota, KHÔNG tính là đã chăm ===');
const careSend = await import(U('src/care-send.js'));
reset();
const okB = await careSend.sendCareMessages(
  { conversation_id: 'conv_STUB_002', page_id: '386613267864665', phone: '0900000000' },
  ['tin chăm sau khám thử'], { code: 'd1' },
);
console.log(`  → sendCareMessages trả về: ${JSON.stringify(okB)}`);
cham('trả FALSE (trước vá HARDCODE ok = true)', okB === false);
cham('KHÔNG in ✅', !co(/✅/));
cham('CÓ dòng ❌ GỬI HỤT + convId + ghi rõ KHÔNG trừ quota', co(/❌ GỬI HỤT/) && co(/conv_STUB_002/) && co(/KHÔNG trừ quota/));

// ---------------------------------------------------------------------------
console.log('\n=== C. src/follow.js — VÁ MỚI HÔM NAY: sendTexts hụt thì không báo "đã giao PDF" ===');
const follow = await import(U('src/follow.js'));
reset();
await follow.handleZaloFollow({ event_name: 'follow', follower: { id: 'uid_STUB_003' } });
cham('KHÔNG in ✅ "đã giao PDF + N clip"', !co(/✅/));
cham('CÓ dòng ❌ GỬI HỤT kèm uid', co(/❌ GỬI HỤT/) && co(/uid_STUB_003/));
cham('nói rõ khách CHƯA nhận gì', co(/chưa nhận gì|KHÔNG tính là đã chăm/));

// ---------------------------------------------------------------------------
console.log('\n=== D. ĐỐI CHỨNG — khi gửi THÀNH CÔNG thì ✅ phải xuất hiện trở lại ===');
axios.post = async () => ({ status: 200, data: { success: true } });
reset();
const kqD = await pancake.sendMessages('386613267864665', 'conv_STUB_004', ['tin đi được']);
console.log(`  → sendMessages trả về: ${JSON.stringify(kqD)}`);
cham('trả TRUE khi Pancake nhận thật (không bịt nhầm đường thành công)', kqD === true);
cham('KHÔNG có ❌ GỬI HỤT ở ca thành công', !co(/❌/));

// ---------------------------------------------------------------------------
console.log('\n\n================ TỔNG KẾT ================');
const fail = ket.filter(([, v]) => !v);
console.log(`${ket.length - fail.length}/${ket.length} PASS`);
if (fail.length) { fail.forEach(([t]) => console.log('  FAIL:', t)); process.exit(1); }
console.log('TẤT CẢ PASS — gửi hụt = 0 dòng ✅, có ❌ truy vết được, không đóng dấu xong.');
