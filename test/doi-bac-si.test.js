// KHÁCH ĐÒI GẶP BÁC SĨ — siết regex 08/09/2026 (ca Thi Hong Lieu Nguyen):
//   "tôi bị tê tay nhờ bs tư vấn giúp" là CÂU HỎI BỆNH LỊCH SỰ, không phải đòi gặp BS.
//   Anh Trình: "Mấy câu này em xử lí thoải mái, đừng báo group mấy quả tào lao như thế."
//
// Test giữ 2 chiều — chỗ dễ vá lệch nhất:
//   ① Câu hỏi bệnh lịch sự ("nhờ bs tư vấn giúp", "bác sĩ cho em hỏi...") → PHẢI THẢ (bot tự trả lời).
//   ② Đòi đích danh thật (gặp BS, nói chuyện với BS, hỏi LẠI bác sĩ, trả lời TRỰC TIẾP)
//      → PHẢI CÒN BẮT. Thả nhầm mấy câu này là quay lại bệnh ca Duy Cường (bot vòng vo lộ dốt).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tamDB = fs.mkdtempSync(path.join(os.tmpdir(), 'doibs-db-'));
process.env.DB_PATH = path.join(tamDB, 'test.sqlite');

const { laTinDoiBacSi } = await import('../src/handler.js');

// ① PHẢI THẢ — hỏi bệnh bình thường, kể cả nhắc tới "bác sĩ" một cách lịch sự
const CAU_PHAI_THA = [
  'tôi bị tê tay nhờ bs tư vấn giúp.',            // ca thật 08/09 — báo group oan 17:15
  'nhờ bác sĩ tư vấn giúp em với',
  'bs tư vấn giúp em nha',
  'bác sĩ cho em hỏi đầu gối em kêu lụp cụp là sao',
  'nhờ bác sĩ xem giúp em phim x-quang này',       // nhờ xem = việc bot relay được, không báo group
  'hôm qua em tiêm xong thấy hơi đau',             // bẫy 'ho' trong "HÔM" (bài học 15/08)
  'chị ơi cho em hỏi giá khám',
  'bs ơi em muốn hỏi về bệnh gout',
  'em cần tư vấn giúp em bệnh cổ vai gáy',
];

// ② PHẢI BẮT — đòi đích danh bác sĩ thật
const CAU_PHAI_BAT = [
  'Chị hỏi bác sĩ lại giúp e nhá',                 // ca gốc Duy Cường 20/08
  'hỏi lại bác sĩ giúp em',
  'nhờ bs check lại giùm em',
  'em muốn gặp bác sĩ',
  'xin được gặp bs',
  'cho em gặp bác sĩ được không',
  'em muốn nói chuyện với bác sĩ',
  'cho tôi nói chuyện với bác sĩ',
  'bác sĩ trả lời trực tiếp giúp em được không',
  'bs tư vấn trực tiếp cho em nha',
];

test('THẢ câu hỏi bệnh lịch sự — bot tự trả lời, không báo group', () => {
  for (const cau of CAU_PHAI_THA) {
    assert.equal(laTinDoiBacSi(cau), false, `bắt oan: "${cau}"`);
  }
});

test('BẮT câu đòi đích danh bác sĩ — bot lui + báo người', () => {
  for (const cau of CAU_PHAI_BAT) {
    assert.equal(laTinDoiBacSi(cau), true, `thả lọt: "${cau}"`);
  }
});
