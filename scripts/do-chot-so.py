#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bộ thước NGHIỆM THU bản vá não chốt số (dựng 06/09/2026).

Chạy:  python3 scripts/do-chot-so.py 2026-09-07 2026-09-16

Đo trên pages.fm/api/v1 bằng USER token `poscake-hieploi` (page token đã chết — xem skill
`do-ra-sdt-va-cau-moi-gia`). CHỈ ĐỌC, không gửi tin, không đổi nhãn.

⚠️ BẪY ĐÃ DÍNH — đừng sửa mất:
 1. pages.fm sắp hội thoại theo `updated_at`, KHÔNG phải `inserted_at` ⇒ phải quét HẾT
    tới trần rồi mới lọc cửa sổ. Break sớm làm mẫu số hụt gần 4 lần.
 2. Con trỏ phân trang là `current_count`, KHÔNG phải `page` (pages.fm bỏ qua `page`).
 3. `limit` không được tôn trọng ⇒ cộng con trỏ bằng len() thật nhận được.
 4. Bỏ dấu phải có replace('đ','d') — thiếu nó thì "để lại số" trượt regex, bản đo đầu
    tiên đếm hụt lời-xin-số 45%.
 5. token hỏng thì PHẢI kêu (fail-closed), cấm báo 0%.
"""
import json, re, sys, time, unicodedata, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

D1, D2 = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("2026-08-30", "2026-09-05")
TK = json.load(open("/Users/mac/Claude/Projects/HiepLoi-Ads/.mcp.json"))[
    "mcpServers"]["poscake-hieploi"]["env"]["PANCAKE_API_TOKEN"]
PAGES = {"386613267864665": "CXK", "957014354156110": "DrNT"}
BOT, NGUOI = "Public API", "Phan Nhật Trình"

def kd(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.replace("đ", "d").replace("Đ", "D").lower()

def strip(h):
    h = re.sub(r"<br[^>]*/?>", "\n", str(h or ""))
    return re.sub(r"<[^>]+>", "", h).strip()

def get(u):
    for i in range(4):
        try:
            return json.load(urllib.request.urlopen(u, timeout=60))
        except Exception:
            if i == 3: raise
            time.sleep(2 + i * 2)

def keo():
    convs = []
    for pid in PAGES:
        seen, cur = {}, 0
        while cur < 4200:                       # bẫy 1+2+3
            q = urllib.parse.urlencode({"access_token": TK, "limit": 100, "current_count": cur})
            r = get("https://pages.fm/api/v1/pages/%s/conversations?%s" % (pid, q))
            if r.get("success") is False:
                raise SystemExit("TOKEN HONG: %s" % r)   # bẫy 5
            cs = r.get("conversations") or []
            if not cs: break
            for c in cs: seen.setdefault(c["id"], c)
            cur += len(cs)
        for c in seen.values():
            if D1 <= (c.get("inserted_at") or "")[:10] <= D2 and c.get("type") == "INBOX":
                c["_pid"] = pid; convs.append(c)
    def lay(c):
        cid = (c.get("customers") or [{}])[0].get("id")
        if not cid: return None
        q = urllib.parse.urlencode({"access_token": TK, "customer_id": cid})
        try:
            ms = get("https://pages.fm/api/v1/pages/%s/conversations/%s/messages?%s"
                     % (c["_pid"], c["id"], q)).get("messages") or []
        except Exception:
            return None
        M = []
        for m in ms:
            adm = (m.get("from") or {}).get("admin_name")
            who = "KH" if (m.get("from") or {}).get("id") != c["_pid"] else \
                  ("BOT" if adm == BOT else ("NGUOI" if adm == NGUOI else "HT"))
            M.append({"who": who, "txt": strip(m.get("message"))})
        return {"id": c["id"], "sdt": bool(c.get("has_phone")), "M": M,
                "kh": [x for x in M if x["who"] == "KH" and x["txt"]],
                "pk": [x for x in M if x["who"] in ("BOT", "NGUOI") and x["txt"]]}
    with ThreadPoolExecutor(max_workers=8) as ex:
        return [r for r in ex.map(lay, convs) if r]

# ---- các cụm phải TIẾN VỀ 0 sau bản vá 06/09 ----
CAM = {
    'cụm "suất tư vấn"':            re.compile(r"suat tu van"),
    'cụm "không hợp thì thôi"':     re.compile(r"khong hop thi thoi"),
    'viện dẫn "Sở Y tế" né giá':    re.compile(r"so y te"),
    'ngõ cụt (4 câu phao cũ)':      re.compile(r"nhan em bat cu luc nao can|em day a, minh can em ho tro them|co gi minh cu hoi them nha|em van o day ne"),
    'nhận nhầm khách cũ':           re.compile(r"tin tuong ghe kham tai hiep loi|so dien thoai da dang ky luc kham"),
    '"miễn phí" làm lý do xin số':  re.compile(r"tu van (hoan toan )?mien phi|khong mat (phi|gi)"),
}
KHUNG_DATLICH = re.compile(r"giu (lich|cho|suat kham)|khoi (phai )?cho|do (phai )?cho|sap lich|len lich|xac nhan (gio|lich)|ghi vao (lich|so kham)")
XIN = re.compile(r"xin so dien thoai|cho em xin so|de lai so|gui em so")
NHOM = {
    "hỏi ĐỊA CHỈ/giờ": re.compile(r"dia chi|o dau|cho nao|kham o|may gio|gio nao|mo cua|duong nao|toi truc tiep"),
    "hỏi GIÁ MŨI TIÊM": re.compile(r"(bao nhieu|gia|chi phi|may tien|bn tien).{0,40}(tiem|chich|prp|dich nhay|dich nhon)|(tiem|chich|prp|dich nhay|dich nhon).{0,40}(bao nhieu|gia|chi phi|may tien|bn tien)"),
    "hỏi GIÁ chung":    re.compile(r"bao nhieu tien|gia bao nhieu|chi phi|may tien|bn tien"),
    "CHỮA NHIỀU NƠI":   re.compile(r"nhieu noi|kham nhieu|chua nhieu|uong (thuoc )?(hoai|mai)|khong (het|khoi|do)|ko (het|khoi|do)|van dau"),
    "LO BIẾN CHỨNG":    re.compile(r"teo co|liet|nang hon|bien chung|nguy hiem|co sao khong"),
    "ở XA":             re.compile(r"o xa|xa qua|xa lam|khong (len|vo|vao|di) duoc|ko (len|vo) duoc|o que|o tinh"),
}

def main():
    D = keo()
    co_noi = [d for d in D if d["kh"]]
    sdt = sum(1 for d in co_noi if d["sdt"])
    bot_don = [d for d in co_noi if not any(m["who"] == "NGUOI" for m in d["M"])]
    print("=== CỬA SỔ %s → %s | %d hội thoại INBOX | %d khách CÓ NÓI" % (D1, D2, len(D), len(co_noi)))
    print("RA SĐT nền khách-có-nói : %d/%d = %.1f%%   (mốc 30/08→05/09: 11,0%% · đích ≥15%%)"
          % (sdt, len(co_noi), sdt * 100.0 / max(len(co_noi), 1)))
    b = sum(1 for d in bot_don if d["sdt"])
    print("RA SĐT lane BOT ĐƠN ĐỘC : %d/%d = %.1f%%   (mốc 4,8%% · đích ≥7%%)"
          % (b, len(bot_don), b * 100.0 / max(len(bot_don), 1)))
    print("\n-- theo NHÓM KHÁCH (nhận bằng từ khoá, là bộ dò thô) --")
    for ten, p in NHOM.items():
        g = [d for d in co_noi if p.search(kd(" ".join(m["txt"] for m in d["kh"])))]
        s = sum(1 for d in g if d["sdt"])
        print("  %-18s n=%3d | SĐT %3d = %5.1f%%" % (ten, len(g), s, s * 100.0 / max(len(g), 1)))
    # ⚠️ ĐƠN VỊ: các dòng dưới đếm **Ô** (bong bóng), KHÔNG đếm hội thoại. Bảng trong
    # VA-NAO-CHOT-SO-2026-09-06.md mục 5 có vài dòng đếm theo HỘI THOẠI ở lượt-xin-đầu.
    # ⇒ CHỈ so số của script này với số của script này (mốc in kèm dưới đây).
    MOC_O = {'cụm "suất tư vấn"': "196", 'cụm "không hợp thì thôi"': "28",
             'viện dẫn "Sở Y tế" né giá': "3", 'ngõ cụt (4 câu phao cũ)': "514",
             'nhận nhầm khách cũ': "6", '"miễn phí" làm lý do xin số': "705"}
    print("\n-- CỤM PHẢI VỀ 0 — đếm Ô (mốc = chính script này chạy 30/08→05/09) --")
    for ten, p in CAM.items():
        c = sum(1 for d in D for m in d["pk"] if p.search(kd(m["txt"])))
        print("  %-32s %4d ô   (mốc %s)" % (ten, c, MOC_O.get(ten, "?")))
    dl = sum(1 for d in D for m in d["pk"] if XIN.search(kd(m["txt"])) and KHUNG_DATLICH.search(kd(m["txt"])))
    tong_xin = sum(1 for d in D for m in d["pk"] if XIN.search(kd(m["txt"])))
    print("\n-- KHUNG XIN SỐ --")
    print("  lượt xin số dùng khung ĐẶT LỊCH : %d / %d lượt xin = %.1f%%"
          % (dl, tong_xin, dl * 100.0 / max(tong_xin, 1)))
    print("     ^ mốc tự script này đo 30/08→05/09: 56/948 = 5,9% · đích ≥30%")
    NGOCUT = CAM['ngõ cụt (4 câu phao cũ)']
    ket = sum(1 for d in co_noi if d["pk"] and NGOCUT.search(kd(d["pk"][-1]["txt"])))
    print("  hội thoại KẾT THÚC bằng 1 trong 4 câu phao cũ: %d/%d = %.1f%%"
          % (ket, len(co_noi), ket * 100.0 / max(len(co_noi), 1)))
    print("     ^ mốc tự script này đo 30/08→05/09: 219/607 = 36,1% · đích ≤15%")
    do_dai = sorted(len(m["txt"]) for d in D for m in d["pk"])
    if do_dai:
        print("  độ dài ô bot, trung vị: %d ký tự  (mốc script này: 105 · đích ≤70)" % do_dai[len(do_dai)//2])

if __name__ == "__main__":
    main()
