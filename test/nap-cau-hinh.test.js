// Nạp cấu hình (src/config.js) — thiếu file phụ thì CẢNH BÁO, KHÔNG CRASH.
//
// Vì sao phải chạy trong TIẾN TRÌNH CON: config.js đọc file lúc nạp module, và Node cache
// module — không thể "nạp lại với file bị xoá" trong cùng tiến trình. Cách duy nhất đo thật
// là dựng một bản sao repo trong thư mục tạm, bỏ đúng file muốn thử, rồi cho node nạp.
//
// Bài học nền: 20/07/2026 rụng 1/3 page mà log vẫn in "✅ OK — 2 trang". Bot thiếu mảnh não
// thì DỐT đi nhưng vẫn phải CHẠY (bot câm = mất toàn bộ lead); còn thiếu NÃO GỐC thì phải
// CHẾT CÓ TIẾNG (bot vô luật tư vấn y khoa cho bệnh nhân thật thì hỏng giấy phép phòng khám).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOC = path.join(__dirname, '..');

// 3 file phụ: mất thì bot dốt đi nhưng VẪN CHẠY. `system-prompt.md` là não GỐC, bắt buộc.
const FILE_PHU = ['gia-va-uu-dai.md', 'ky-nang-ban-hang.md', 'system-prompt-zalo.md'];

/** Dựng bản sao tối thiểu của repo trong thư mục tạm, bỏ các file nêu trong `bo`. */
function dungSanTam(bo = []) {
  const tam = fs.mkdtempSync(path.join(os.tmpdir(), 'conggac-cfg-'));
  fs.mkdirSync(path.join(tam, 'src'));
  fs.copyFileSync(path.join(GOC, 'src', 'config.js'), path.join(tam, 'src', 'config.js'));
  for (const f of ['system-prompt.md', ...FILE_PHU]) {
    if (bo.includes(f)) continue;
    const nguon = path.join(GOC, f);
    if (fs.existsSync(nguon)) fs.copyFileSync(nguon, path.join(tam, f));
  }
  return tam;
}

/** Nạp config.js trong tiến trình con. Trả { ma, out } — ma = mã thoát. */
function napTrongTienTrinhCon(tam, env = {}) {
  const kichBan =
    `import { checkConfig, SYSTEM_PROMPT, SYSTEM_PROMPT_ZALO } from ${JSON.stringify(path.join(tam, 'src', 'config.js'))};\n` +
    'checkConfig();\n' +
    'console.log("NAP_XONG len_fb=" + SYSTEM_PROMPT.length + " len_zalo=" + SYSTEM_PROMPT_ZALO.length);\n';
  const fileKB = path.join(tam, 'chay.mjs');
  fs.writeFileSync(fileKB, kichBan);
  // ⚠️ PHẢI GOM CẢ stdout LẪN stderr: mọi cảnh báo thiếu file đi bằng console.warn/console.error
  // = stderr. Bản đầu chỉ đọc stdout nên test báo "không có cảnh báo" trong khi cảnh báo vẫn in
  // ra đều — đúng kiểu đo hụt một nguồn rồi kết luận sai.
  const kq = spawnSync(process.execPath, [fileKB], {
    encoding: 'utf8', timeout: 30000, env: { ...process.env, ...env },
  });
  return { ma: kq.status ?? -1, out: `${kq.stdout || ''}${kq.stderr || ''}` };
}

test('đủ file → nạp được, ghép đủ 3 mảnh não', () => {
  const tam = dungSanTam();
  const kq = napTrongTienTrinhCon(tam);
  assert.equal(kq.ma, 0, `phải nạp được. Log:\n${kq.out}`);
  assert.match(kq.out, /NAP_XONG/);
  fs.rmSync(tam, { recursive: true, force: true });
});

for (const f of FILE_PHU) {
  test(`THIẾU ${f} → cảnh báo, KHÔNG crash, bot vẫn chạy`, () => {
    const tam = dungSanTam([f]);
    const kq = napTrongTienTrinhCon(tam);
    assert.equal(kq.ma, 0, `thiếu ${f} thì TUYỆT ĐỐI không được crash. Log:\n${kq.out}`);
    assert.match(kq.out, /NAP_XONG/, 'phải nạp xong và trả về prompt dùng được');
    assert.match(kq.out, /thi[ếe]u|THI[ẾE]U/i, `phải CẢNH BÁO là đang thiếu ${f}`);
    assert.match(kq.out, new RegExp(f.replace('.', '\\.')), `cảnh báo phải nêu tên file ${f}`);
    fs.rmSync(tam, { recursive: true, force: true });
  });
}

test('THIẾU CẢ 3 file phụ cùng lúc → vẫn chạy được bằng não gốc', () => {
  const tam = dungSanTam(FILE_PHU);
  const kq = napTrongTienTrinhCon(tam);
  assert.equal(kq.ma, 0, `mất cả 3 mảnh phụ vẫn phải chạy. Log:\n${kq.out}`);
  assert.match(kq.out, /NAP_XONG len_fb=\d{4,}/, 'não FB phải còn nội dung thật');
  fs.rmSync(tam, { recursive: true, force: true });
});

test('THIẾU NÃO GỐC system-prompt.md → DỪNG CÓ TIẾNG (đây là hành vi ĐÚNG)', () => {
  const tam = dungSanTam(['system-prompt.md']);
  const kq = napTrongTienTrinhCon(tam);
  assert.notEqual(kq.ma, 0, 'mất não gốc mà vẫn chạy = bot vô luật tư vấn bệnh nhân thật');
  assert.match(kq.out, /system-prompt\.md/, 'log phải nói rõ thiếu file nào để sửa được ngay');
  fs.rmSync(tam, { recursive: true, force: true });
});

test('cầu dao BOT_TAT_BANG_GIA=1 → não ngắn lại, vẫn không crash', () => {
  const tam = dungSanTam();
  const bat = napTrongTienTrinhCon(tam);
  const tat = napTrongTienTrinhCon(tam, { BOT_TAT_BANG_GIA: '1' });
  assert.equal(tat.ma, 0, `cầu dao không được làm crash. Log:\n${tat.out}`);
  const doDai = (s) => parseInt((s.match(/len_fb=(\d+)/) || [])[1] || '0', 10);
  assert.ok(doDai(tat.out) < doDai(bat.out), 'tắt bảng giá thì não phải ngắn lại');
  fs.rmSync(tam, { recursive: true, force: true });
});

test('cầu dao ghi SAI giá trị → FAIL-SAFE giữ lớp BẬT, không crash', () => {
  const tam = dungSanTam();
  const bat = napTrongTienTrinhCon(tam);
  const bay = napTrongTienTrinhCon(tam, { BOT_TAT_BANG_GIA: 'khong-hieu-gi-ca' });
  assert.equal(bay.ma, 0, 'biến gõ nhầm không được làm chết bot');
  const doDai = (s) => parseInt((s.match(/len_fb=(\d+)/) || [])[1] || '0', 10);
  assert.equal(doDai(bay.out), doDai(bat.out), 'giá trị lạ ⇒ giữ NGUYÊN hành vi hiện tại');
  fs.rmSync(tam, { recursive: true, force: true });
});
