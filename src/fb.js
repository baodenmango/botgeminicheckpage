// Tra Graph API Facebook: ad_id → tên camp / nhóm QC / mẫu QC.
// Dùng cho dòng "📣 Nguồn" báo telesale (telegram.js) — biết khách bấm từ camp nào mà gọi cho trúng.
// Cần env FB_ADS_TOKEN (token có quyền ads_read trên TK quảng cáo). Thiếu token → trả null,
// dòng nguồn vẫn hiện ad_id thô, KHÔNG chặn luồng báo lead.
// Kết quả cache vĩnh viễn ở kv `ad_meta:<adId>` (tên camp không đổi, khỏi gọi lại).
import axios from 'axios';
import * as store from './store.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

export async function adMeta(adId) {
  if (!adId) return null;
  const key = `ad_meta:${adId}`;
  const cached = store.getKV(key);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* cache hỏng → tra lại */ }
  }
  const token = process.env.FB_ADS_TOKEN;
  if (!token) return null;
  try {
    const res = await axios.get(`${GRAPH}/${adId}`, {
      params: { fields: 'name,adset{name},campaign{name}', access_token: token },
      timeout: 8000,
    });
    const meta = {
      adName: res.data?.name || null,
      adsetName: res.data?.adset?.name || null,
      campaignName: res.data?.campaign?.name || null,
    };
    if (meta.campaignName || meta.adName) store.setKV(key, JSON.stringify(meta));
    return meta;
  } catch (err) {
    console.warn(`[fb] tra ad ${adId} lỗi:`, err?.response?.data?.error?.message || err?.message);
    return null;
  }
}
