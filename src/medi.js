// ============================================================
//  MEDi EMR LOOKUP — tra hồ sơ bệnh nhân theo SỐ ĐIỆN THOẠI.
//  Nguồn: Google Sheet "medi-export" (script medi-export đổ data EMR vào — 1200 BN:
//  tên, bệnh lý, toa thuốc, liệu trình, lần khám). Ghép theo mobilePhone. (memory: medi-emr-data)
//
//  ⚠️ TRẠNG THÁI (anh Trình 30/06): Sheets API MEDi CHƯA bật → đây là KHUNG fail-open:
//   - Chưa cấu hình nguồn (thiếu env) → lookupMedi() trả null → handler coi là BN MỚI.
//     Toàn hệ vẫn chạy, chỉ thiếu nhận diện BN cũ. Khi bật Sheet, điền env là dùng được NGAY.
//   - KHÔNG bao giờ throw làm chết luồng chăm khách (mọi lỗi → null).
//
//  CÁCH ĐẤU NGUỒN (chọn 1, điền env tương ứng):
//   A) Sheet CÔNG KHAI (link "ai có link xem được") → MEDI_SHEET_CSV_URL = link CSV export
//      (vd https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=<GID>). Đọc thẳng, không key.
//   B) Sheet RIÊNG TƯ → MEDI_SHEET_ID + MEDI_SHEET_RANGE (vd 'DATA!A:Z') + GOOGLE_SA_JSON
//      (service account JSON, base64 — giống bot-nut-bam). Đọc qua Sheets REST API.
//
//  CỘT KỲ VỌNG (map theo TÊN cột, không theo vị trí — script medi-export đặt header):
//   mobilePhone | fullName | diagnosis(bệnh lý) | lastVisit(lần khám cuối) |
//   treatmentPlan(liệu trình) | sessionsDone | sessionsTotal | lastPrescription(toa gần nhất)
//   → Tên cột có thể khác; chỉnh COL_MAP bên dưới cho khớp header thật khi đấu data.
import axios from 'axios';
import crypto from 'node:crypto';

// Map "khóa chuẩn nội bộ" → các tên header CÓ THỂ gặp trong Sheet (khớp không phân biệt hoa thường, bỏ dấu).
const COL_MAP = {
  phone:        ['mobilephone', 'phone', 'sodienthoai', 'sdt', 'dienthoai'],
  name:         ['fullname', 'name', 'hoten', 'tenbenhnhan', 'patientname'],
  diagnosis:    ['diagnosis', 'benhly', 'chandoan', 'benh'],
  lastVisit:    ['lastvisit', 'lankhamcuoi', 'ngaykhamcuoi', 'ngaykham'],
  treatment:    ['treatmentplan', 'lieutrinh', 'phacdo'],
  sessionsDone: ['sessionsdone', 'buoidalam', 'sobuoidalam', 'daxong'],
  sessionsTotal:['sessionstotal', 'tongbuoi', 'sobuoi', 'tongsobuoi'],
  prescription: ['lastprescription', 'toagannhat', 'toathuoc', 'donthuoc'],
};

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// SĐT về dạng so sánh (10 số, bỏ +84/84 → 0).
function normPhone(p) {
  let s = String(p || '').replace(/[^\d]/g, '');
  if (s.startsWith('84') && s.length >= 11) s = '0' + s.slice(2);
  if (!s.startsWith('0') && s.length === 9) s = '0' + s;
  return s;
}

// ---------- Đọc Sheet RIÊNG TƯ qua Sheets REST API (service account) ----------
let saAccessToken = null;
let saTokenExp = 0;

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SA_JSON;
  if (!raw) return null;
  try {
    // GOOGLE_SA_JSON có thể là JSON thô hoặc base64 (như bot-nut-bam) — thử cả 2.
    const txt = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(txt);
  } catch (e) {
    console.warn('[medi] GOOGLE_SA_JSON không parse được:', e?.message);
    return null;
  }
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Tạo OAuth access token từ service account (JWT grant) — không cần thư viện googleapis.
async function getSheetsToken() {
  if (saAccessToken && Date.now() < saTokenExp - 60000) return saAccessToken;
  const sa = loadServiceAccount();
  if (!sa?.client_email || !sa?.private_key) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = base64url(signer.sign(sa.private_key));
  const jwt = `${header}.${claim}.${sig}`;
  try {
    const res = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );
    saAccessToken = res.data?.access_token || null;
    saTokenExp = Date.now() + (res.data?.expires_in || 3600) * 1000;
    return saAccessToken;
  } catch (e) {
    console.error('[medi] lấy Sheets token lỗi:', e?.response?.data || e.message);
    return null;
  }
}

// Trả về mảng-các-dòng [ [c1,c2,...], ... ] từ Sheet (header ở dòng 1). null nếu không đọc được.
async function fetchRows() {
  // Đường A: CSV công khai
  const csvUrl = process.env.MEDI_SHEET_CSV_URL;
  if (csvUrl) {
    try {
      const res = await axios.get(csvUrl, { timeout: 20000, responseType: 'text' });
      return parseCsv(res.data);
    } catch (e) {
      console.warn('[medi] đọc CSV lỗi:', e?.message);
      return null;
    }
  }
  // Đường B: Sheets REST API (riêng tư)
  const sheetId = process.env.MEDI_SHEET_ID;
  const range = process.env.MEDI_SHEET_RANGE || 'A:Z';
  if (sheetId) {
    const token = await getSheetsToken();
    if (!token) return null;
    try {
      const res = await axios.get(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
      );
      return res.data?.values || null;
    } catch (e) {
      console.error('[medi] đọc Sheets API lỗi:', e?.response?.data || e.message);
      return null;
    }
  }
  return null; // chưa cấu hình nguồn → fail-open
}

// Parse CSV tối giản (đủ cho data MEDi — không dùng để parse CSV phức tạp có xuống dòng trong ô).
function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.length);
  return lines.map((line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

// Cache toàn bộ bảng (đọc 1 lần / TTL) — tránh tải Sheet mỗi tin khách.
let cacheRows = null;
let cacheAt = 0;
const CACHE_TTL_MS = parseInt(process.env.MEDI_CACHE_TTL_MS || '600000', 10); // 10 phút

async function getTable() {
  if (cacheRows && Date.now() - cacheAt < CACHE_TTL_MS) return cacheRows;
  const rows = await fetchRows();
  if (!rows || rows.length < 2) { cacheRows = null; return null; }
  const header = rows[0].map((h) => norm(h));
  // map khóa chuẩn → index cột
  const idx = {};
  for (const [key, aliases] of Object.entries(COL_MAP)) {
    idx[key] = header.findIndex((h) => aliases.includes(h));
  }
  if (idx.phone < 0) {
    console.warn('[medi] Sheet không có cột SĐT (mobilePhone) → bỏ qua. Header:', header.join(','));
    cacheRows = null; return null;
  }
  // dựng map phone → record
  const byPhone = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const phone = normPhone(row[idx.phone]);
    if (!phone || phone.length < 9) continue;
    const get = (k) => (idx[k] >= 0 ? (row[idx[k]] || '').trim() : '');
    byPhone.set(phone, {
      name: get('name'),
      diagnosis: get('diagnosis'),
      lastVisit: get('lastVisit'),
      treatment: get('treatment'),
      sessionsDone: get('sessionsDone'),
      sessionsTotal: get('sessionsTotal'),
      prescription: get('prescription'),
    });
  }
  cacheRows = byPhone;
  cacheAt = Date.now();
  console.log(`[medi] đã nạp ${byPhone.size} hồ sơ BN từ Sheet`);
  return cacheRows;
}

/**
 * Tra hồ sơ BN theo SĐT.
 * @param {string} phone
 * @returns {Promise<object|null>} record { name, diagnosis, lastVisit, treatment, sessionsDone, sessionsTotal, prescription }
 *          hoặc null nếu KHÔNG có hồ sơ (= bệnh nhân MỚI) / nguồn chưa cấu hình.
 */
export async function lookupMedi(phone) {
  try {
    const p = normPhone(phone);
    if (!p || p.length < 9) return null;
    const table = await getTable();
    if (!table) return null; // nguồn chưa sẵn → fail-open (BN mới)
    return table.get(p) || null;
  } catch (e) {
    console.error('[medi] lookupMedi lỗi:', e?.message);
    return null; // không bao giờ làm chết luồng chăm khách
  }
}

// Nguồn MEDi đã được cấu hình chưa (để engine biết có nên enrich không / log rõ).
export function isMediConfigured() {
  return Boolean(process.env.MEDI_SHEET_CSV_URL || process.env.MEDI_SHEET_ID);
}

/**
 * Lấy TOÀN BỘ hồ sơ BN (Map phone→record) — cho engine "đánh thức BN ngủ" quét tệp 1200 BN.
 * Trả về [] nếu nguồn chưa cấu hình (fail-open). Mỗi phần tử: { phone, ...record }.
 */
export async function getAllMediRecords() {
  try {
    const table = await getTable();
    if (!table) return [];
    return [...table.entries()].map(([phone, rec]) => ({ phone, ...rec }));
  } catch (e) {
    console.error('[medi] getAllMediRecords lỗi:', e?.message);
    return [];
  }
}

// Parse ngày khám cuối (lastVisit) từ nhiều định dạng → epoch giây. null nếu không đọc được.
export function parseVisitDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  // dd/mm/yyyy hoặc dd-mm-yyyy
  let m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    return isNaN(dt) ? null : Math.floor(dt.getTime() / 1000);
  }
  // yyyy-mm-dd (ISO)
  const dt = new Date(t);
  return isNaN(dt) ? null : Math.floor(dt.getTime() / 1000);
}

// Map text chẩn đoán MEDi → mã bệnh nội bộ (dùng chung — engine đánh thức + follow).
export function mapDiagnosis(text) {
  const t = String(text || '').toLowerCase();
  if (/chóp xoay|chop xoay|rotator/.test(t)) return 'chopxoay';
  if (/ngón tay lò xo|ngon tay lo xo|bao gân gấp|cò súng|trigger finger/.test(t)) return 'ngontay';
  if (/de quervain|dequervain|gân duỗi ngón cái|quervain/.test(t)) return 'dequervain';
  if (/ống cổ tay|ong co tay|carpal|chèn ép thần kinh giữa|tê tay/.test(t)) return 'ongcotay';
  if (/khuỷu tay tennis|tennis elbow|viêm điểm bám gân khuỷu|mỏm trên lồi cầu/.test(t)) return 'tenniselbow';
  if (/cân gan chân|can gan chan|gai gót|gai got|viêm cân gan|đau gót/.test(t)) return 'gangotchan';
  if (/loãng xương|loang xuong|osteoporosis|mật độ xương|loãng x/.test(t)) return 'loangxuong';
  if (/lật sơ mi|lat so mi|bong gân cổ chân|bong gan co chan|cổ chân|co chan/.test(t)) return 'cochan';
  if (/hoại tử chỏm|hoai tu chom|chỏm xương đùi|chom xuong dui|avn/.test(t)) return 'chomdui';
  if (/khớp háng|khop hang|thoái hóa háng/.test(t)) return 'hang';
  if (/cột sống cổ|cot song co|đốt sống cổ|thoái hóa cổ/.test(t)) return 'csc';
  if (/thần kinh tọa|thoát vị|đĩa đệm/.test(t)) return 'tvdd';
  if (/cổ vai gáy|cổ - vai/.test(t)) return 'covaigay';
  if (/gối|thoái hóa gối/.test(t)) return 'goi';
  if (/gút|gout|acid uric/.test(t)) return 'gut';
  if (/quanh khớp vai|đau vai|khớp vai/.test(t)) return 'vai';
  if (/cột sống thắt lưng|thắt lưng|đau lưng/.test(t)) return 'lung';
  return 'unknown';
}

/**
 * Dựng "THẺ NGỮ CẢNH" gắn vào prompt Gemini (mục C2/C3 thiết kế).
 * record có → [BN_CŨ] ...; không có → [BN_MỚI] bệnh=...
 * @param {object|null} record  kết quả lookupMedi
 * @param {string} conditionVi  tên bệnh khách đang quan tâm (để dùng cho BN mới)
 */
export function buildContextTag(record, conditionVi) {
  if (record) {
    const parts = [];
    if (record.name) parts.push(`tên=${record.name}`);
    if (record.diagnosis) parts.push(`bệnh=${record.diagnosis}`);
    if (record.treatment) parts.push(`liệu trình=${record.treatment}`);
    if (record.sessionsDone || record.sessionsTotal) {
      parts.push(`buổi=${record.sessionsDone || '?'}/${record.sessionsTotal || '?'}`);
    }
    if (record.lastVisit) parts.push(`khám cuối=${record.lastVisit}`);
    if (record.prescription) parts.push(`toa gần nhất=${record.prescription}`);
    return `[BN_CŨ] ${parts.join(' • ')}`;
  }
  return `[BN_MỚI] bệnh quan tâm=${conditionVi || 'chưa rõ'}`;
}
