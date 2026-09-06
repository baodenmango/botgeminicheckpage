#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bộ thước NGHIỆM THU bản vá não chốt số (dựng 06/09/2026, bổ sung THƯỚC ƯU ĐÃI cùng ngày).

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

# ---- THƯỚC PHÁC ĐỒ SALE 5 BƯỚC (thêm 06/09/2026, sau khi anh Trình cấp bảng giá) ----
# ⚠️ Bộ dò THÔ bằng từ khoá trên chữ đã bỏ dấu (kd): "300.000đ" -> "300.000d", "5 triệu" -> "5 trieu".
GIA_300   = re.compile(r"300\s*k|300[.\s]?000")
GIA_TIEM  = re.compile(r"5\s*trieu|5[.\s]?000[.\s]?000|600\s*k|600[.\s]?000")
CO_CHU_TU = re.compile(r"\btu\s+(5|600)")
KH_HOI_GIA = re.compile(r"bao nhieu tien|gia bao nhieu|chi phi|may tien|bn tien|bao nhieu|gia the nao|gia sao")
# câu KHAI THÁC của bot (bước ①): hỏi vị trí / thời gian / đã chữa gì / ảnh hưởng sinh hoạt
KHAI_THAC = re.compile(r"dau (o dau|cho nao|ben nao)|(bi|dau) (lau chua|bao lau)|bao lau roi|"
                       r"da (di )?kham|chup phim|da chua|uong thuoc gi|"
                       r"dau (goi|lung|vai|co|got)|di lai|sinh hoat|ngu duoc khong|te tay")
# ===== ƯU ĐÃI — anh Trình DUYỆT 06/09/2026, đổi hẳn cách đo =====
# ⚠️ Bản trước của file này coi MỌI chữ "giảm/tặng/điện xung" là bot BỊA và bắt phải = 0. Từ 06/09
# có 2 ưu đãi THẬT (giảm 50% phí khám 300k→150k cho BHYT/HS-SV/CNVC/trên-60 · tặng 1 lần điện xung
# 400k) ⇒ để nguyên bộ dò cũ thì mỗi lần bot làm ĐÚNG việc lại bị đếm thành LỖI NẶNG. Tách làm 3:
#   HOP_LE  = đúng 2 khoản đã duyệt      (đo TẦN SUẤT DÙNG — càng đúng chỗ càng tốt)
#   BIA     = khoản NGOÀI 2 cái đó       (cổng an toàn, BẮT BUỘC = 0)
#   HAN_BIA = bịa hạn chót/số suất       (2 ưu đãi này KHÔNG có hạn ⇒ mọi hạn đều là bịa)
UU_DAI_HOP_LE = re.compile(r"150\s*k|150[.\s]?000|giam 50|giam nua (phi|tien) kham|"
                           r"dien xung|400\s*k|400[.\s]?000")
UU_DAI_BIA = re.compile(r"voucher|khuyen mai|combo|giam cho khach quen|qua tang|tang kem|"
                        r"tang (chup )?x[- ]?quang|tang phim|mien phi kham|kham mien phi|"
                        r"di 2 nguoi|hai nguoi.{0,15}giam|giam them|tang goi")
HAN_BIA = re.compile(r"chi (hom nay|trong hom nay|con hom nay)|hom nay thoi|"
                     r"con \d+ suat|con \d+ cho|het (hom nay|trong ngay)|"
                     r"tuan nay thoi|den het (hom nay|ngay mai)|uu dai.{0,20}den ngay|"
                     r"dang ky (trong )?hom nay|hom nay (duoc|se) (tang|giam)|nhanh tay")
# Khách NÊU RÀO CẢN GIÁ — đây mới là ô khoá mà ưu đãi được phép mở (💰 BẢNG GIÁ ④ luật ②)
RAO_CAN_GIA = re.compile(r"mac qua|dat qua|dat vay|mac vay|(?<!bao )nhieu tien qua|gia cao qua|"
                         r"de suy nghi|suy nghi da|de tinh lai|tinh lai da|de xem lai|"
                         r"hoi y (con|chong|vo|me|ba|nguoi nha)|hoi (con|chong|vo) da|"
                         r"co giam|giam duoc khong|bot duoc khong|khong du tien|khong co dieu kien")
# Bot DẶN MANG GIẤY TỜ (luật ⑤ — thiếu là khách tới quầy không được giảm)
GIAY_TO = re.compile(r"the bhyt|mang (theo )?the|dem (theo )?the|cam theo the|"
                     r"the sinh vien|the hoc sinh|the (nhan vien|cong chuc)|"
                     r"cccd|can cuoc|giay to")

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

    # ================= PHÁC ĐỒ SALE 5 BƯỚC (anh Trình giao 06/09/2026) =================
    print("\n== PHÁC ĐỒ SALE 5 BƯỚC — nghiệm thu bảng giá + khai thác ==")

    # (a) nhóm HỎI GIÁ (gộp cả giá chung lẫn giá mũi tiêm) — nền 2,5% ở nhóm giá chung
    hoi_gia = [d for d in co_noi if KH_HOI_GIA.search(kd(" ".join(m["txt"] for m in d["kh"])))]
    sg = sum(1 for d in hoi_gia if d["sdt"])
    print("  ① ra SĐT nhóm HỎI GIÁ (gộp) : %d/%d = %.1f%%   (mốc CHÍNH SCRIPT NÀY 30/08→05/09: 5/62 = 8,1%% · đích ≥15%%)"
          % (sg, len(hoi_gia), sg * 100.0 / max(len(hoi_gia), 1)))
    print("     ^ ⚠️ ĐỪNG so với con số 2,5% trong VA-NAO-CHOT-SO mục 5 — đó là bộ phân nhóm ĐỌC TAY,")
    print("       chặt hơn bộ dò từ khoá ở đây (nó tách 'giá chung' khỏi 'giá mũi tiêm'). Khác thước, cấm so chéo.")

    # (b) khách hỏi giá → bot có cho mốc 300k không
    co_300 = sum(1 for d in hoi_gia if any(GIA_300.search(kd(m["txt"])) for m in d["pk"]))
    print("  ② cho mốc 300k khi khách hỏi giá : %d/%d = %.1f%%   (mốc script này: 44/62 = 71,0%% · đích ≥85%%)"
          % (co_300, len(hoi_gia), co_300 * 100.0 / max(len(hoi_gia), 1)))

    # (c) đã đi bước ① KHAI THÁC trước khi báo giá chưa
    du_b1 = thieu_b1 = 0
    for d in D:
        idx = next((i for i, m in enumerate(d["pk"])
                    if GIA_300.search(kd(m["txt"])) or GIA_TIEM.search(kd(m["txt"]))), None)
        if idx is None: continue
        if any(KHAI_THAC.search(kd(m["txt"])) for m in d["pk"][:idx]): du_b1 += 1
        else: thieu_b1 += 1
    tong_bg = du_b1 + thieu_b1
    print("  ③ đi đủ bước ① KHAI THÁC trước khi báo giá : %d/%d = %.1f%%   (mốc script này: 54/122 = 44,3%% · đích ≥70%%)"
          % (du_b1, tong_bg, du_b1 * 100.0 / max(tong_bg, 1)))

    # (d) CỔNG AN TOÀN — phải bằng 0
    # ⚠️ CHỈ đếm ô của BOT — d["pk"] gồm CẢ người thật gõ tay, mà người thật thì được phép
    # nói giá theo cách của họ. Tính lẫn vào sẽ báo động giả (mốc 30/08→05/09: 1 ô, là của NGƯỜI).
    o_bot = [m for d in D for m in d["M"] if m["who"] == "BOT" and m["txt"]]
    bo_tu = sum(1 for m in o_bot
                if GIA_TIEM.search(kd(m["txt"])) and not CO_CHU_TU.search(kd(m["txt"])))
    bia_ud = sum(1 for m in o_bot if UU_DAI_BIA.search(kd(m["txt"])))
    han_bia = sum(1 for m in o_bot if HAN_BIA.search(kd(m["txt"])))
    print("  🚨 ô BOT nêu giá tiêm mà BỎ chữ \"từ\" : %d ô   (mốc script này: 1 · đích = 0)" % bo_tu)
    print("     ^ mốc 1 ô đó là bot NHẠI LẠI con số của chính khách (\"BS bảo một mũi tới 5 triệu\"),")
    print("       conv 28395877553400809. Vẫn tính là lỗi: đúng kiểu câu nay bị cấm — phải nói \"TỪ 5 triệu\".")
    print("  🚨 ô BOT hứa ƯU ĐÃI NGOÀI 2 khoản đã duyệt : %d ô   (mốc 0 · BẮT BUỘC = 0)" % bia_ud)
    print("  🚨 ô BOT bịa HẠN CHÓT / SỐ SUẤT ưu đãi     : %d ô   (mốc 0 · BẮT BUỘC = 0)" % han_bia)
    print("     ^ ba dòng trên >0 là LỖI NẶNG: bot hứa thứ phòng khám không cam kết. Tắt bot, sửa ngay.")
    print("       (2 ưu đãi đã duyệt KHÔNG có hạn thời gian ⇒ mọi câu nói hạn đều là bịa.)")

    # ============ THƯỚC ƯU ĐÃI — anh Trình duyệt 06/09/2026 ============
    # Ưu đãi là ĐÒN BẨY GỠ PHẢN ĐỐI GIÁ, không phải câu chào. Ba thước dưới đo đúng ba luật
    # dễ sai nhất trong 7 luật ở 💰 BẢNG GIÁ ④: dùng ĐÚNG LÚC (②) · dặn GIẤY TỜ (⑤) · không chào SỚM (①).
    # ⚠️ CHỈ tính ô của BOT — người thật gõ tay được linh hoạt, tính lẫn vào là báo động giả.
    print("\n== THƯỚC ƯU ĐÃI (mốc 30/08→05/09 đều = 0 vì lúc đó CHƯA CÓ ưu đãi nào; đây là nền GỐC) ==")
    co_raocan = co_chao = dung_luc = co_giayto = chao_som = 0
    for d in D:
        M = d["M"]
        i_rao  = next((i for i, m in enumerate(M)
                       if m["who"] == "KH" and RAO_CAN_GIA.search(kd(m["txt"]))), None)
        i_chao = next((i for i, m in enumerate(M)
                       if m["who"] == "BOT" and UU_DAI_HOP_LE.search(kd(m["txt"]))), None)
        if i_rao is not None:
            co_raocan += 1
            if i_chao is not None: dung_luc += 1
        if i_chao is None: continue
        co_chao += 1
        # ⑤ dặn giấy tờ: tính từ ô chào trở đi (dặn ở lượt sau vẫn kịp, dặn trước thì vô nghĩa)
        if any(m["who"] == "BOT" and GIAY_TO.search(kd(m["txt"])) for m in M[i_chao:]):
            co_giayto += 1
        # ① chào SỚM = chào khi khách CHƯA hề nêu rào cản giá, hoặc chào TRƯỚC lúc khách nêu
        if i_rao is None or i_chao < i_rao:
            chao_som += 1
    print("  ① khách NÊU RÀO CẢN GIÁ mà bot CÓ tung ưu đãi : %d/%d = %.1f%%   (nền 0/%d · đích ≥60%%)"
          % (dung_luc, co_raocan, dung_luc * 100.0 / max(co_raocan, 1), co_raocan))
    print("  ② đã chào ưu đãi thì CÓ dặn mang giấy tờ      : %d/%d = %.1f%%   (đích ≥90%%)"
          % (co_giayto, co_chao, co_giayto * 100.0 / max(co_chao, 1)))
    print("  🚨 ③ chào ưu đãi SỚM (khách CHƯA vướng giá)   : %d/%d = %.1f%%   (CÀNG THẤP CÀNG TỐT · đích ≤15%%)"
          % (chao_som, co_chao, chao_som * 100.0 / max(co_chao, 1)))
    print("     ^ chào sớm hỏng hai đường: khách hiểu 300k là giá ảo, VÀ mình tiêu mất quân bài")
    print("       duy nhất còn lại cho đúng lúc khách sắp bỏ đi. Thước này quan trọng hơn ①.")
    print("  (tham chiếu) hội thoại bot có nhắc ưu đãi hợp lệ: %d/%d" % (co_chao, len(D)))

if __name__ == "__main__":
    main()
