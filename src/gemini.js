// Gemini client: nạp system prompt (bộ não), ép trả JSON, hỗ trợ mode retouch.
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config, SYSTEM_PROMPT } from './config.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey || 'MISSING_KEY');

const model = genAI.getGenerativeModel({
  model: config.gemini.model,
  systemInstruction: SYSTEM_PROMPT,
  generationConfig: {
    responseMimeType: 'application/json', // ép JSON để parse chắc chắn
    temperature: 0.8,
    // gemini-2.5-flash là model "thinking" — phần suy luận ngốn token.
    // Tắt thinking + nâng token để JSON câu trả lời không bị cắt giữa chừng.
    maxOutputTokens: 2048,
    thinkingConfig: { thinkingBudget: 0 },
  },
});

// Phản hồi an toàn khi Gemini lỗi/timeout — không crash, không im lặng.
const FALLBACK = {
  messages: ['Dạ anh/chị chờ em chút xíu nha ạ 😊'],
  name: null,
  phone: null,
  phone_captured: false,
  condition: 'unknown',
  customer_type: 'chua_ro',
  summary: null,
  handover: false,
  handover_reason: null,
};

// Làm sạch & ràng buộc output theo đúng định dạng brief (mục 5, 8).
function sanitize(obj) {
  const out = { ...FALLBACK, ...(obj || {}) };
  // messages: mảng 1–4 chuỗi, mỗi ô < 300 ký tự
  let msgs = Array.isArray(out.messages) ? out.messages : [String(out.messages || '')];
  msgs = msgs
    .filter((m) => typeof m === 'string' && m.trim().length > 0)
    .slice(0, 4)
    .map((m) => (m.length > 300 ? m.slice(0, 297) + '…' : m));
  if (msgs.length === 0) msgs = FALLBACK.messages;
  out.messages = msgs;
  out.phone_captured = Boolean(out.phone_captured);
  out.handover = Boolean(out.handover);
  return out;
}

/**
 * Gọi Gemini sinh phản hồi.
 * @param {Array<{role:'user'|'model', text:string}>} history - lịch sử hội thoại
 * @param {'reply'|'retouch'} mode
 * @param {string} customerName - tên Facebook của khách (để đoán xưng hô)
 * @param {string} gender - giới tính từ Pancake ('male'|'female'|null) — chính xác hơn đoán
 * @returns {Promise<object>} object theo định dạng brief
 */
export async function generateReply(history, mode = 'reply', customerName = null, gender = null) {
  try {
    // Build contents từ history (Gemini dùng role 'user'/'model')
    const contents = history.map((h) => ({
      role: h.role === 'model' ? 'model' : 'user',
      parts: [{ text: h.text }],
    }));

    // Chèn TÊN + GIỚI TÍNH khách làm context đầu để bộ não xưng hô chuẩn.
    if (customerName || gender) {
      const gt = gender === 'male' ? 'NAM (gọi anh/chú/bác)'
        : gender === 'female' ? 'NỮ (gọi chị/cô/bác)'
        : 'chưa rõ (đoán từ tên, không chắc thì anh/chị)';
      contents.unshift({
        role: 'user',
        parts: [{ text: `[HỆ THỐNG] Tên Facebook khách: "${customerName || '(ẩn)'}". Giới tính: ${gt}. Hãy gọi tên riêng + đúng giới tính/vai vế cho tự nhiên (xem mục xưng hô trong system prompt). KHÔNG bao giờ chỉ gọi trống tên (vd "Bình") — phải kèm anh/chị/cô/chú.` }],
      });
    }

    // mode retouch: chèn tín hiệu vào lượt cuối để bộ não biết đây là chạm lại
    if (mode === 'retouch') {
      contents.push({
        role: 'user',
        parts: [{ text: 'MODE: RETOUCH — khách im lâu chưa cho SĐT, hãy nhắn lại nhẹ nhàng 1–2 tin.' }],
      });
    }

    // mode recover: VỚT LEAD bị bỏ rơi — đọc lại đúng câu khách hỏi/băn khoăn còn dang dở,
    // trả lời thẳng cái đó, rồi LÌ ĐÒN xin SĐT có duyên (bắt buộc kết bằng xin số).
    if (mode === 'recover') {
      contents.push({
        role: 'user',
        parts: [{ text: 'MODE: RECOVER — Đây là khách quan tâm nhưng hội thoại bị bỏ lửng, CHƯA lấy được SĐT. Hãy: (1) đọc lại đúng điều khách hỏi/băn khoăn gần nhất và trả lời thẳng cho thỏa đáng; (2) khơi lại nỗi đau/mong muốn của họ ngắn gọn; (3) BẮT BUỘC kết thúc bằng câu xin số điện thoại có lý do thuyết phục (Bác sĩ gọi tư vấn miễn phí / giữ suất / báo chi phí cụ thể). Lì đòn nhưng lịch sự, KHÔNG ép lộ liễu, KHÔNG spam. Nếu khách đã từ chối thẳng ("không có nhu cầu") thì lùi nhẹ, để lại thiện cảm, vẫn mở đường để lại số khi cần.' }],
      });
    }

    const result = await model.generateContent({ contents });
    const text = result.response.text();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // đôi khi model bọc trong ```json ... ``` → bóc ra
      const m = text.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    }
    if (!parsed) {
      console.error('[gemini] JSON parse fail. Raw:', text?.slice(0, 200));
      return FALLBACK;
    }
    return sanitize(parsed);
  } catch (err) {
    console.error('[gemini] lỗi gọi API:', err?.message || err);
    return FALLBACK;
  }
}
