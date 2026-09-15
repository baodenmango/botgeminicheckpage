// ===== LỚP 2 CỦA KIẾN TRÚC "REGEX ĐỀ CỬ — MODEL PHÊ DUYỆT" (đại tu 15/09/2026) =====
// Vì sao tồn tại: 4 ca match oan chết người cùng một gốc bệnh regex-bỏ-dấu tự quyết hành động
// VĨNH VIỄN ("khong nhanh"→"khong nhan" 07/08 · "giơ"→"gởi" 15/08 · "sao đâu"→"o dau" 13/09 ·
// "gối nữa"→"gọi nữa" 14/09 — ca cuối tắt chăm vĩnh viễn với lead đang kể bệnh, anh Trình bắt tận tay).
// Từ nay: regex chỉ ĐỀ CỬ. Mọi hành động vĩnh viễn (setOptOut, setHandover, markTouchDone,
// template xin lỗi cứng) phải được model ĐỌC NGỮ CẢNH 6 tin cuối và PHÊ DUYỆT mới chạy.
// Model lỗi/timeout → NGHIÊNG VỀ KHÔNG HÀNH ĐỘNG VĨNH VIỄN (nhắn dư 1 tin < giết oan 1 lead).
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config.js';

// Não classifier RIÊNG cho từng loại nghi vấn — ngắn, lạnh, không dùng não bán hàng 640 dòng.
const NAO_PHE_DUYET = {
  xin_ngung:
    'Bạn đọc các tin cuối của một hội thoại tư vấn phòng khám xương khớp. Máy dò thô NGHI câu cuối của khách là ' +
    '"khách yêu cầu NGỪNG nhận tin nhắn". Máy dò hay bắt oan câu kể bệnh vì tiếng Việt bỏ dấu đồng âm ' +
    '("đau gối nữa" bị đọc thành "đừng gọi nữa"). Trả lời xac_nhan=true CHỈ KHI khách thật sự muốn dừng bị ' +
    'nhắn tin/gọi điện, hoặc tuyên bố bỏ ý định khám chữa. Khách đang kể bệnh, trả lời câu hỏi, than không ' +
    'gọi được cho phòng khám, hỏi tiếp chuyện khám/giá/địa chỉ, hoặc nói kiểu "tôi đang cần tư vấn" → ' +
    'xac_nhan=false. KHÔNG CHẮC → false.',
  nan_lieu_trinh:
    'Bạn đọc các tin cuối của một hội thoại chăm sóc bệnh nhân phòng khám xương khớp. Máy dò thô NGHI câu cuối ' +
    'là "bệnh nhân NẢN, muốn BỎ liệu trình đang điều trị TẠI PHÒNG KHÁM NÀY, hoặc chê trải nghiệm chăm sóc của ' +
    'CHÍNH phòng khám này". Trả lời xac_nhan=true CHỈ KHI đúng như vậy. Khách kể xấu PHÒNG KHÁM KHÁC/chỗ chữa cũ, ' +
    'báo tin vui đã đỡ, hỏi kiến thức về liệu trình, hay than chuyện không liên quan → xac_nhan=false. KHÔNG CHẮC → false.',
  doi_bac_si:
    'Bạn đọc các tin cuối của một hội thoại tư vấn phòng khám. Máy dò thô NGHI câu cuối là "khách đòi ĐÍCH DANH ' +
    'Bác sĩ trả lời/xác nhận qua tin nhắn" (thường về y lệnh riêng: loại thuốc, loại đai, số buổi). Trả lời ' +
    'xac_nhan=true CHỈ KHI đúng vậy. Khách muốn GẶP bác sĩ để ĐẾN KHÁM (= muốn đặt lịch), hoặc chỉ nói lịch sự ' +
    '"nhờ bác sĩ tư vấn giúp" khi hỏi bệnh → xac_nhan=false. KHÔNG CHẮC → false.',
  bao_on:
    'Bạn đọc các tin cuối của một hội thoại tư vấn phòng khám xương khớp. Máy dò thô NGHI khách đang "báo mình ỔN, ' +
    'KHÔNG có bệnh/không có nhu cầu khám" (nếu đúng, hệ thống sẽ ngừng hỏi thăm để không đeo bám). Trả lời ' +
    'xac_nhan=true CHỈ KHI khách thật sự nói mình không sao/không có nhu cầu. Khách vẫn kể triệu chứng ở vế sau ' +
    '("không sao nhưng cái gối vẫn nhức"), vẫn đặt câu hỏi, hay chỉ nói khách sáo giữa chừng câu chuyện đang hỏi ' +
    'bệnh → xac_nhan=false. KHÔNG CHẮC → false.',
};

const MODEL_PHE_DUYET = process.env.PHE_DUYET_MODEL || 'gemini-2.5-flash-lite';
const TIMEOUT_MS = parseInt(process.env.PHE_DUYET_TIMEOUT_MS || '6000', 10);

let _model = null;
function layModel() {
  if (!_model) {
    const genAI = new GoogleGenerativeAI(config.gemini.apiKey || 'MISSING_KEY');
    _model = genAI.getGenerativeModel({
      model: MODEL_PHE_DUYET,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: 200,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
  }
  return _model;
}

// Gọi model thô 1 lần, có timeout cứng. Tách riêng để test mock được (truyền override).
async function goiModel(prompt) {
  const model = layModel();
  return Promise.race([
    model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('pheduyet timeout')), TIMEOUT_MS)),
  ]);
}

/**
 * @param {object} p
 * @param {'xin_ngung'|'nan_lieu_trinh'|'doi_bac_si'|'bao_on'} p.loai
 * @param {string} p.cauNghi          tin khách vừa gửi (nguyên văn, còn dấu)
 * @param {Array<{role:string,text:string}>} p.tinGanNhat  ≤6 tin cuối history
 * @param {string} [p.tenKhach]
 * @param {Function} [goiModelOverride]  chỉ dùng trong test
 * @returns {Promise<{xacNhan:boolean, lyDo:string, degraded:boolean}>}
 *   degraded=true = model lỗi/timeout/JSON hỏng → caller KHÔNG được hành động vĩnh viễn.
 */
export async function pheDuyetYDinh(p, goiModelOverride) {
  // CẦU DAO: =0 → hành vi cũ (regex tự quyết), lui được từ điện thoại qua Render env.
  if (String(process.env.BOT_2LOP_PHE_DUYET ?? '1') === '0') {
    return { xacNhan: true, lyDo: 'cầu dao BOT_2LOP_PHE_DUYET=0 — regex tự quyết như cũ', degraded: false };
  }
  const nao = NAO_PHE_DUYET[p.loai];
  if (!nao) return { xacNhan: false, lyDo: `loại nghi vấn lạ "${p.loai}"`, degraded: true };

  const doanHoiThoai = (p.tinGanNhat || [])
    .map((h) => `${h.role === 'model' ? 'PHÒNG KHÁM' : 'KHÁCH'}: ${String(h.text || '').slice(0, 300)}`)
    .join('\n');
  const prompt =
    `${nao}\n\n--- CÁC TIN GẦN NHẤT${p.tenKhach ? ` (khách: ${p.tenKhach})` : ''} ---\n${doanHoiThoai}\n` +
    `--- CÂU BỊ NGHI (tin cuối của khách) ---\n"${String(p.cauNghi || '').slice(0, 400)}"\n\n` +
    'Trả về đúng JSON: {"xac_nhan": true|false, "ly_do": "<1 câu tiếng Việt>"}';

  const goi = goiModelOverride || goiModel;
  for (let lan = 1; lan <= 2; lan++) {
    try {
      const kq = await goi(prompt);
      const text = typeof kq === 'string' ? kq : kq?.response?.text?.();
      const d = JSON.parse(String(text || '').replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
      if (typeof d.xac_nhan !== 'boolean') throw new Error('JSON thiếu xac_nhan boolean');
      const out = { xacNhan: d.xac_nhan, lyDo: String(d.ly_do || '').slice(0, 200), degraded: false };
      console.log(`[pheduyet] ${p.loai} → ${out.xacNhan ? 'YES' : 'NO'} "${out.lyDo}"`);
      return out;
    } catch (e) {
      if (lan === 2) {
        console.warn(`[pheduyet] ${p.loai} DEGRADED (${e?.message?.slice(0, 60)}) → KHÔNG hành động vĩnh viễn`);
        return { xacNhan: false, lyDo: `model lỗi: ${e?.message?.slice(0, 80)}`, degraded: true };
      }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return { xacNhan: false, lyDo: 'không tới được đây', degraded: true };
}
