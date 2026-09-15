// ===== TEST AD-CONTEXT (đại tu 15/09) — không gọi mạng =====
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-adctx-')), 'test.db');
const { layCaptionQuangCao, dungTheQuangCao, adContextBat } = await import('../src/adcontext.js');
const store = await import('../src/store.js');

test('cầu dao BOT_AD_CONTEXT=0 → tắt hẳn, không gọi API', async () => {
  process.env.BOT_AD_CONTEXT = '0';
  assert.equal(adContextBat(), false);
  assert.equal(await layCaptionQuangCao({ pageId: '1', postId: '1_2' }), null);
  delete process.env.BOT_AD_CONTEXT;
  assert.equal(adContextBat(), true);
});

test('cache hit → trả ngay không gọi mạng', async () => {
  store.setKV('adcap_post:99_88', JSON.stringify({ cap: 'Đau vai viêm chóp xoay', t: Date.now() }));
  const cap = await layCaptionQuangCao({ pageId: '99', postId: '99_88' });
  assert.equal(cap, 'Đau vai viêm chóp xoay');
});

test('không token page → trả null, không throw', async () => {
  const cap = await layCaptionQuangCao({ pageId: 'page_khong_ton_tai', postId: 'x_1' });
  assert.equal(cap, null);
});

test('thẻ CÓ caption: bám bệnh trong ad, cấm hỏi lại; thẻ KHÔNG caption: hỏi câu đóng', () => {
  const co = dungTheQuangCao('Đau nhức khớp vai, giơ tay khó khăn?');
  assert.ok(co.includes('QUẢNG CÁO KHÁCH VỪA BẤM'));
  assert.ok(co.includes('không hỏi lại'));
  const khong = dungTheQuangCao(null);
  assert.ok(khong.includes('chưa tra được nội dung'));
  assert.ok(khong.includes('câu') && khong.includes('ĐÓNG'), 'phải dạy hỏi câu đóng');
});

test('index.js trích ads_context_data.ad_title từ webhook', () => {
  const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.ok(src.includes('ads_context_data'));
  assert.ok(src.includes('adTitle'));
});
