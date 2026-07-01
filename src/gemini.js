// Gemini client: nạp system prompt (bộ não), ép trả JSON, hỗ trợ mode retouch.
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config, SYSTEM_PROMPT, SYSTEM_PROMPT_ZALO } from './config.js';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey || 'MISSING_KEY');

const GEN_CONFIG = {
  responseMimeType: 'application/json', // ép JSON để parse chắc chắn
  temperature: 0.8,
  // gemini-2.5-flash là model "thinking" — phần suy luận ngốn token.
  // Tắt thinking + nâng token để JSON câu trả lời không bị cắt giữa chừng.
  maxOutputTokens: 2048,
  thinkingConfig: { thinkingBudget: 0 },
};

// Model DỰ PHÒNG khi model chính bị 503 (Google quá tải). Khác model để né điểm nghẽn.
// ⚠️ 01/07: gemini-2.0-flash bị Google KHAI TỬ (404 "no longer available") → fallback chết theo,
// bot câm mỗi khi model chính 503. Đổi sang 2.5-flash-lite (còn sống, nhẹ, khác nhánh 2.5-flash).
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.5-flash-lite';

// Hai "bộ não" — Facebook (mặc định) và Zalo OA (chăm sóc sâu). Chọn theo channel.
// Mỗi bộ não có model CHÍNH + model DỰ PHÒNG (cùng system prompt).
const model = genAI.getGenerativeModel({
  model: config.gemini.model,
  systemInstruction: SYSTEM_PROMPT,
  generationConfig: GEN_CONFIG,
});
const modelZalo = genAI.getGenerativeModel({
  model: config.gemini.model,
  systemInstruction: SYSTEM_PROMPT_ZALO,
  generationConfig: GEN_CONFIG,
});
const modelFb2 = genAI.getGenerativeModel({
  model: FALLBACK_MODEL, systemInstruction: SYSTEM_PROMPT, generationConfig: GEN_CONFIG,
});
const modelZalo2 = genAI.getGenerativeModel({
  model: FALLBACK_MODEL, systemInstruction: SYSTEM_PROMPT_ZALO, generationConfig: GEN_CONFIG,
});
function pickModel(channel) {
  return String(channel || '').toLowerCase() === 'zalo' ? modelZalo : model;
}
function pickFallbackModel(channel) {
  return String(channel || '').toLowerCase() === 'zalo' ? modelZalo2 : modelFb2;
}

// Phản hồi an toàn khi Gemini lỗi/timeout — không crash, không im lặng.
const FALLBACK = {
  messages: ['Dạ anh/chị chờ em chút xíu nha ạ 😊'],
  name: null,
  phone: null,
  phone_captured: false,
  condition: 'unknown',
  customer_type: 'chua_ro',
  summary: null,
  booking_intent: false,
  handover: false,
  handover_reason: null,
  opt_out: false,
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
  out.booking_intent = Boolean(out.booking_intent);
  out.handover = Boolean(out.handover);
  out.opt_out = Boolean(out.opt_out);
  return out;
}

// Dựng thẻ ngày giờ THẬT theo giờ VN (UTC+7) cho bot: hôm nay là thứ mấy, ngày nào; mai/mốt là thứ mấy.
// Bot dùng để chốt lịch hẹn ĐÚNG (không được tự suy "mai là Thứ Bảy" sai). Không cấp giờ khám cụ thể
// (bot không giữ lịch trống thật) → hướng bot XÁC NHẬN ngày + gợi buổi, rồi ĐỂ TELESALE chốt giờ chính xác.
const THU_VN = { Sunday: 'Chủ Nhật', Monday: 'Thứ Hai', Tuesday: 'Thứ Ba', Wednesday: 'Thứ Tư', Thursday: 'Thứ Năm', Friday: 'Thứ Sáu', Saturday: 'Thứ Bảy' };
// Format 1 mốc theo GIỜ VN chuẩn qua Intl (đúng cả khi server chạy UTC như Render). Tự cộng offset dễ sai.
function fmtVN(d) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(d)) p[x.type] = x.value;
  return `${THU_VN[p.weekday]}, ngày ${p.day}/${p.month}/${p.year}`;
}
function gioVN(d) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)) p[x.type] = x.value;
  return `${p.hour}:${p.minute}`;
}
function buildDateContext() {
  const now = new Date();
  const mai = new Date(now.getTime() + 86400000);
  const mot = new Date(now.getTime() + 2 * 86400000);
  return `NGÀY GIỜ THẬT (giờ VN, tin cậy tuyệt đối — KHÔNG được tự bịa thứ/ngày khác): HÔM NAY là ${fmtVN(now)}, hiện ${gioVN(now)}. Ngày mai là ${fmtVN(mai)}. Ngày mốt là ${fmtVN(mot)}. Khi khách nói "mai"/"mốt"/"thứ X" hãy quy đổi theo đúng mốc này. ` +
    `CHỐT LỊCH: bot chỉ XÁC NHẬN NGÀY + hỏi buổi (sáng/chiều) khách muốn, KHÔNG tự khẳng định giờ trống cụ thể (bot không giữ lịch thật). Nói rõ "em xin số để trợ lý Bác sĩ gọi xác nhận giờ chính xác + giữ suất cho mình nha" — việc chốt giờ do telesale.`;
}

/**
 * Gọi Gemini sinh phản hồi.
 * @param {Array<{role:'user'|'model', text:string}>} history - lịch sử hội thoại
 * @param {'reply'|'retouch'} mode
 * @param {string} customerName - tên Facebook của khách (để đoán xưng hô)
 * @param {string} gender - giới tính từ Pancake ('male'|'female'|null) — chính xác hơn đoán
 * @param {object} opts - { channel:'facebook'|'zalo', contextTag:string } — chọn bộ não + thẻ ngữ cảnh MEDi
 * @returns {Promise<object>} object theo định dạng brief
 */
export async function generateReply(history, mode = 'reply', customerName = null, gender = null, opts = {}) {
  const { channel = 'facebook', contextTag = null } = opts || {};
  try {
    // Build contents từ history (Gemini dùng role 'user'/'model')
    const contents = history.map((h) => ({
      role: h.role === 'model' ? 'model' : 'user',
      parts: [{ text: h.text }],
    }));

    // ⚠️ NGÀY GIỜ THẬT (giờ VN) — nếu KHÔNG cấp, bot BỊA thứ/ngày sai (đã thấy: nói "mai là Thứ Bảy"
    // trong khi mai là Thứ Tư → chốt lịch hẹn SAI, hỏng booking). Chèn ĐẦU mọi lượt để bot tính đúng.
    contents.unshift({ role: 'user', parts: [{ text: `[HỆ THỐNG] ${buildDateContext()}` }] });

    // THẺ NGỮ CẢNH MEDi (kênh Zalo) — gắn ĐẦU để bộ não Zalo biết BN cũ/mới (mục 2 prompt Zalo).
    if (contextTag) {
      contents.unshift({ role: 'user', parts: [{ text: `[HỆ THỐNG] ${contextTag}` }] });
    }

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

    // mode care: khách ĐÃ cho SĐT mà vẫn nhắn tiếp — CHĂM SÓC, không buông, KHÔNG xin lại số.
    if (mode === 'care') {
      contents.push({
        role: 'user',
        parts: [{ text: 'MODE: CARE — Khách NÀY ĐÃ cho số điện thoại rồi (telesale sẽ/đang gọi). TUYỆT ĐỐI không xin lại số. Nhiệm vụ bây giờ: giải đáp tiếp điều khách hỏi cho tận tình, trấn an "Bác sĩ/trợ lý sẽ gọi sớm, mình để ý điện thoại nha", và nhẹ nhàng thúc đẩy ĐẶT LỊCH/đến khám (gợi ý sắp xếp thời gian qua khám, nhắc ưu đãi/giữ suất). Giữ giọng ấm, quan tâm như đang chăm sóc một người đã tin tưởng mình. Đặt phone_captured=false, handover=false trừ khi khách khiếu nại.' }],
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

    // Gọi Gemini có RETRY cho lỗi tạm thời (429 quá tải / timeout / 5xx).
    // 3 lần: lần 1-2 model CHÍNH (chờ tăng dần); lần 3 đổi sang model DỰ PHÒNG (né 503 model chính).
    let result;
    const mainModel = pickModel(channel);
    const fbModel = pickFallbackModel(channel);
    const MAX = 3;
    for (let attempt = 1; attempt <= MAX; attempt++) {
      const useModel = attempt < MAX ? mainModel : fbModel; // lần cuối → model dự phòng
      try {
        result = await useModel.generateContent({ contents });
        if (attempt === MAX) console.log(`[gemini] ✅ model dự phòng (${FALLBACK_MODEL}) cứu được lượt này`);
        break;
      } catch (e) {
        const code = e?.status || e?.code || (e?.message || '').match(/\b(429|500|503)\b/)?.[1];
        const retriable = ['429', '500', '503', 429, 500, 503].includes(code) ||
          /quota|overload|rate|timeout|deadline|unavailable/i.test(e?.message || '');
        if (attempt < MAX && retriable) {
          console.warn(`[gemini] lỗi tạm (${code || e?.message?.slice(0,40)}) → thử lại lần ${attempt + 1}${attempt + 1 === MAX ? ' (model dự phòng)' : ''}`);
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }
        throw e; // lỗi không retriable, hoặc đã hết lượt → ném ra catch ngoài
      }
    }
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
