"""후보 묶음 1(11-12, 기획서 B-2): 규칙·시안 비교로는 잡기 어려운 결함의 정답 세트 첫 묶음.
- 종류: C1 화면 글자의 뜻 이상(빈 값·배열 그대로·NaN·시간대·숫자 형식·서버 원문·개수 불일치·음수 시간), C2 버튼 목적지·동작(목적지 틀림·두 탭 같은 화면·문구와 다른 동작).
- 블라인드 6처럼 시안을 먼저 쓰고(design_model.py) 구현은 따로 짠다. 화면 글자는 목 데이터(DATA)를 JS로 그린다. 결함은 그리는 코드나 링크 한 곳에만 넣는다.
- 버튼의 시안 연결(reactions)과 도착 화면(제목 h1)을 함께 만든다. 정답의 확인 방법(confirm)은 pattern·data·prototype·interact 중 하나.
- 앱 5종(도서 대출, 주차 정산, 반려식물, 공연 예매, 중고거래 알림)은 팀 앱·이전 묶음과 겹치지 않게 골랐다.
사용: python3 eval/synth/make_cand1.py → eval/synth/cand1/{screens,cases.json}
"""
import json
import subprocess
from pathlib import Path
from design_model import F, T, V, build
from make_blind6 import page, head, head_model, HEAD_CSS, frozen_sha1

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent / "cand1"
OUT = HERE / "screens"
SIZES = ["375x812"]


def nav(dest_id, dest_name):
    return [{"trigger": "ON_CLICK", "actions": [{"type": "NODE", "navigation": "NAVIGATE", "dest": dest_id, "dest_name": dest_name, "url": None}]}]


def btn_model(label, dest_id, dest_name, fill, tok, color="#FFFFFF", ctok="color/bg"):
    return F(label, [T(label, 16, 700, 24, color, ctok)], dir="H", align="CENTER", justify="CENTER", pad=(12, 16, 12, 16), fill=fill, ftoken=tok, radius=12, reactions=nav(dest_id, dest_name))


BTN_CSS = ".cta{display:flex;justify-content:center;margin:24px 20px 0;padding:12px 16px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;line-height:24px;font-weight:700;text-decoration:none}"
ROW_CSS = """.row{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line)}
.row span{font-size:14px;line-height:20px;color:var(--muted)}.row b{font-size:15px;line-height:22px;font-weight:600}"""


def row_model(k, v, mtok="color/muted", ttok="color/text", muted="#6B7280", text="#111827"):
    return F(f"row {k}", [T(k, 14, 400, 20, muted, mtok), T(v, 15, 600, 22, text, ttok, name=f"val {k}")], dir="H", justify="SPACE_BETWEEN", align="CENTER", pad=(14, 20, 14, 20), stroke="#E5E7EB", stoken="color/line")


# ── 1. 도서 대출 ─────────────────────────────────────
LB_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#111827", "muted": "#6B7280", "line": "#E5E7EB", "brand": "#0F766E"}
LB_TOK = {"color/brand": "#0F766E", "color/text": "#111827", "color/muted": "#6B7280", "color/line": "#E5E7EB", "color/bg": "#FFFFFF"}
LB_DATA = {"user": {"name": "김하늘"}, "loans": [{"title": "느린 산책의 기술", "due": "11월 20일"}, {"title": "바다를 건너는 법", "due": "11월 24일"}]}


def lb_model():
    books = [F(f"book {b['title']}", [T(b["title"], 15, 600, 22, "#111827", "color/text"), T(f"{b['due']}까지 반납", 13, 400, 18, "#6B7280", "color/muted")], gap=2, pad=(14, 20, 14, 20), stroke="#E5E7EB", stoken="color/line") for b in LB_DATA["loans"]]
    body = F("body", [head_model("내 서재", "#111827"),
                      F("greet", [T("김하늘 님, 대출 중인 책 2권", 18, 700, 26, "#111827", "color/text", name="greeting")], pad=(8, 20, 12, 20)),
                      F("books", books), btn_model("대출 내역 보기", "8:1", "대출 내역", "#0F766E", "color/brand")])
    return build("내 서재", body, tokens=LB_TOK)


LB_CSS = HEAD_CSS + ROW_CSS + BTN_CSS + """.greet{margin:8px 20px 12px;font-size:18px;line-height:26px;font-weight:700}
.book{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:2px}.book b{font-size:15px;line-height:22px;font-weight:600}.book span{font-size:13px;line-height:18px;color:var(--muted)}"""
LB_JS = """<script>const DATA = __DATA__;
document.getElementById('greet').textContent = `${DATA.user.name} 님, 대출 중인 책 ${DATA.loans.length}권`;
document.getElementById('books').innerHTML = DATA.loans.map((b) => `<div class="book"><b>${b.title}</b><span>${b.due}까지 반납</span></div>`).join('');
</script>"""


def lb_html():
    return (head("내 서재", LB_PAL) + '<div class="scroll"><p class="greet" id="greet"></p><div id="books"></div><a class="cta" id="cta" href="history.html">대출 내역 보기</a></div>'
            + LB_JS.replace("__DATA__", json.dumps(LB_DATA, ensure_ascii=False)))


# ── 2. 주차 정산 ─────────────────────────────────────
PK_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#1E293B", "muted": "#64748B", "line": "#E2E8F0", "brand": "#2563EB"}
PK_TOK = {"color/brand": "#2563EB", "color/text": "#1E293B", "color/muted": "#64748B", "color/line": "#E2E8F0", "color/bg": "#FFFFFF"}
# 입차 시각은 서버 원문(UTC). 화면에는 한국 시간으로 보여야 한다(14:30)
PK_DATA = {"plate": "12가 3456", "entered": "2026-11-12T05:30:00Z", "now": "2026-11-12T07:40:00Z", "fee": 4500, "posted": "2026-11-12T07:37:00Z"}


def pk_model():
    rows = [row_model("차량 번호", "12가 3456", muted="#64748B", text="#1E293B"), row_model("입차 시각", "14:30", muted="#64748B", text="#1E293B"),
            row_model("주차 시간", "2시간 10분", muted="#64748B", text="#1E293B"), row_model("정산 요금", "4,500원", muted="#64748B", text="#1E293B")]
    body = F("body", [head_model("주차 정산", "#1E293B"), F("rows", rows),
                      F("note", [T("요금표 갱신 3분 전", 12, 400, 16, "#64748B", "color/muted", name="posted")], pad=(12, 20, 0, 20)),
                      btn_model("정산하기", "8:2", "결제", "#2563EB", "color/brand")])
    return build("주차 정산", body, tokens=PK_TOK)


PK_CSS = HEAD_CSS + ROW_CSS + BTN_CSS + ".note{margin:12px 20px 0;font-size:12px;line-height:16px;color:var(--muted)}"
PK_JS = """<script>const DATA = __DATA__;
const kst = (iso) => { const d = new Date(new Date(iso).getTime() + 9 * 3600e3); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') };
const mins = Math.round((new Date(DATA.now) - new Date(DATA.entered)) / 60000);
const ago = Math.round((new Date(DATA.now) - new Date(DATA.posted)) / 60000);
const rows = [['차량 번호', DATA.plate], ['입차 시각', kst(DATA.entered)], ['주차 시간', `${Math.floor(mins / 60)}시간 ${mins % 60}분`], ['정산 요금', `${DATA.fee.toLocaleString('ko-KR')}원`]];
document.getElementById('rows').innerHTML = rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');
document.getElementById('note').textContent = `요금표 갱신 ${ago}분 전`;
</script>"""


def pk_html():
    return (head("주차 정산", PK_PAL) + '<div class="scroll"><div id="rows"></div><p class="note" id="note"></p><a class="cta" href="pay.html">정산하기</a></div>'
            + PK_JS.replace("__DATA__", json.dumps(PK_DATA, ensure_ascii=False)))


# ── 3. 반려식물 ─────────────────────────────────────
PT_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#14532D", "muted": "#4B5563", "line": "#E5E7EB", "brand": "#16A34A", "chip": "#DCFCE7"}
PT_TOK = {"color/brand": "#16A34A", "color/text": "#14532D", "color/muted": "#4B5563", "color/line": "#E5E7EB", "color/chip": "#DCFCE7", "color/bg": "#FFFFFF"}
PT_DATA = {"plants": [{"name": "몬스테라", "tags": ["반그늘", "주 1회"], "days": 4, "cycle": 7}]}


def pt_model():
    chips = [F(f"chip {t}", [T(t, 13, 500, 18, "#14532D", "color/text")], dir="H", pad=(6, 12, 6, 12), w="HUG", fill="#DCFCE7", ftoken="color/chip", radius=15) for t in ["반그늘", "주 1회"]]
    card = F("plant card", [T("몬스테라", 18, 700, 26, "#14532D", "color/text"), F("chips", chips, dir="H", gap=8),
                            T("물 준 지 4일 · 물 주기 57%", 14, 400, 20, "#4B5563", "color/muted", name="status"),
                            F("물 줬어요", [T("물 줬어요", 15, 700, 22, "#FFFFFF", "color/bg")], dir="H", justify="CENTER", pad=(10, 16, 10, 16), fill="#16A34A", ftoken="color/brand", radius=10)],
              gap=10, pad=(16, 16, 16, 16), stroke="#E5E7EB", stoken="color/line", radius=16)
    body = F("body", [head_model("내 식물", "#14532D"), F("card wrap", [card], pad=(8, 20, 0, 20)),
                      btn_model("식물 정보", "8:3", "식물 정보", "#16A34A", "color/brand")])
    return build("내 식물", body, tokens=PT_TOK)


PT_CSS = HEAD_CSS + BTN_CSS + """.card{margin:8px 20px 0;padding:16px;border:1px solid var(--line);border-radius:16px;display:flex;flex-direction:column;gap:10px}
.card h2{margin:0;font-size:18px;line-height:26px;font-weight:700}.chips{display:flex;gap:8px}.chips span{padding:6px 12px;border-radius:15px;background:var(--chip);font-size:13px;line-height:18px;font-weight:500}
.card p{margin:0;font-size:14px;line-height:20px;color:var(--muted)}.water{padding:10px 16px;border-radius:10px;background:var(--brand);color:#fff;font-size:15px;line-height:22px;font-weight:700}"""
PT_JS = """<script>const DATA = __DATA__;
function render() {
  document.getElementById('plants').innerHTML = DATA.plants.map((p, i) => `<div class="card" data-plant="${i}"><h2>${p.name}</h2><div class="chips">${p.tags.map((t) => `<span>${t}</span>`).join('')}</div>`
    + `<p>물 준 지 ${p.days}일 · 물 주기 ${Math.round(p.days / p.cycle * 100)}%</p><button class="water" data-water="${i}">물 줬어요</button></div>`).join('');
  document.querySelectorAll('[data-water]').forEach((b) => b.addEventListener('click', () => { DATA.plants[+b.dataset.water].days = 0; render() }));
}
render();
</script>"""


def pt_html():
    return (head("내 식물", PT_PAL) + '<div class="scroll"><div id="plants"></div><a class="cta" href="info.html">식물 정보</a></div>'
            + PT_JS.replace("__DATA__", json.dumps(PT_DATA, ensure_ascii=False)))


# ── 4. 공연 예매 ─────────────────────────────────────
TK_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#1F1B2E", "muted": "#6B6880", "line": "#E7E5EE", "brand": "#7C3AED"}
TK_TOK = {"color/brand": "#7C3AED", "color/text": "#1F1B2E", "color/muted": "#6B6880", "color/line": "#E7E5EE", "color/bg": "#FFFFFF"}
TK_DATA = {"show": "뮤지컬 〈별의 정원〉", "when": "11월 23일(일) 오후 2시", "seat": {"grade": "R", "row": 12, "no": 7}}


def tk_model():
    rows = [row_model("일시", "11월 23일(일) 오후 2시", muted="#6B6880", text="#1F1B2E"), row_model("좌석", "R석 12열 7번", muted="#6B6880", text="#1F1B2E")]
    tabs = F("tabs", [F("예매 내역", [T("예매 내역", 14, 600, 20, "#7C3AED", "color/brand")], dir="H", justify="CENTER", pad=(14, 0, 14, 0), reactions=nav("8:4", "예매 내역")),
                      F("관심 공연", [T("관심 공연", 14, 600, 20, "#6B6880", "color/muted")], dir="H", justify="CENTER", pad=(14, 0, 14, 0), reactions=nav("8:5", "관심 공연"))],
             dir="H", h=48, stroke="#E7E5EE", stoken="color/line", fill="#FFFFFF", ftoken="color/bg")
    body = F("body", [head_model("예매 확인", "#1F1B2E"), F("show", [T("뮤지컬 〈별의 정원〉", 20, 700, 28, "#1F1B2E", "color/text")], pad=(8, 20, 8, 20)), F("rows", rows)])
    return build("예매 확인", body, tokens=TK_TOK, bottom=tabs)


TK_CSS = HEAD_CSS + ROW_CSS + """.show{margin:8px 20px;font-size:20px;line-height:28px;font-weight:700}
.tabs{position:absolute;left:0;right:0;bottom:0;height:48px;display:flex;background:#fff;box-shadow:inset 0 1px 0 var(--line)}
.tabs a{flex:1;display:flex;justify-content:center;align-items:center;font-size:14px;line-height:20px;font-weight:600;color:var(--muted);text-decoration:none}.tabs a.on{color:var(--brand)}"""
TK_JS = """<script>const DATA = __DATA__;
document.getElementById('show').textContent = DATA.show;
const seat = (s) => `${s.grade}석 ${s.row}열 ${s.no}번`;
document.getElementById('rows').innerHTML = [['일시', DATA.when], ['좌석', seat(DATA.seat)]].map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');
</script>"""


def tk_html():
    return (head("예매 확인", TK_PAL) + '<div class="scroll"><p class="show" id="show"></p><div id="rows"></div></div>'
            + '<nav class="tabs"><a class="on" href="history.html">예매 내역</a><a href="likes.html">관심 공연</a></nav>'
            + TK_JS.replace("__DATA__", json.dumps(TK_DATA, ensure_ascii=False)))


# ── 5. 중고거래 알림 ─────────────────────────────────────
MK_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#292524", "muted": "#78716C", "line": "#E7E5E4", "brand": "#EA580C"}
MK_TOK = {"color/brand": "#EA580C", "color/text": "#292524", "color/muted": "#78716C", "color/line": "#E7E5E4", "color/bg": "#FFFFFF"}
MK_DATA = {"now": "2026-11-12T15:00:00+09:00", "read": [{"text": "지난주 거래 후기가 도착했어요"}],
           "unread": [{"text": "캠핑 의자에 새 댓글이 달렸어요", "at": "2026-11-12T12:00:00+09:00"},
                      {"text": "관심 상품 가격이 내려갔어요", "at": "2026-11-12T13:00:00+09:00"},
                      {"text": "판매자가 답장을 보냈어요", "at": "2026-11-12T14:00:00+09:00"}]}


def mk_model():
    items = [F(f"noti {t}", [T(t, 15, 500, 22, "#292524", "color/text"), T(a, 12, 400, 16, "#78716C", "color/muted")], gap=2, pad=(14, 20, 14, 20), stroke="#E7E5E4", stoken="color/line")
             for t, a in [("캠핑 의자에 새 댓글이 달렸어요", "3시간 전"), ("관심 상품 가격이 내려갔어요", "2시간 전"), ("판매자가 답장을 보냈어요", "1시간 전")]]
    body = F("body", [head_model("알림", "#292524"), F("count", [T("새 알림 3개", 16, 700, 24, "#292524", "color/text", name="count")], pad=(8, 20, 8, 20)),
                      F("list", items), btn_model("판매자 프로필", "8:6", "판매자 프로필", "#EA580C", "color/brand")])
    return build("알림", body, tokens=MK_TOK)


MK_CSS = HEAD_CSS + BTN_CSS + """.count{margin:8px 20px;font-size:16px;line-height:24px;font-weight:700}
.noti{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:2px}.noti b{font-size:15px;line-height:22px;font-weight:500}.noti span{font-size:12px;line-height:16px;color:var(--muted)}"""
MK_JS = """<script>const DATA = __DATA__;
const hours = (at) => Math.round((new Date(DATA.now) - new Date(at)) / 3600e3);
document.getElementById('count').textContent = `새 알림 ${DATA.unread.length}개`;
document.getElementById('list').innerHTML = DATA.unread.map((n) => `<div class="noti"><b>${n.text}</b><span>${hours(n.at)}시간 전</span></div>`).join('');
</script>"""


def mk_html():
    return (head("알림", MK_PAL) + '<div class="scroll"><p class="count" id="count"></p><div id="list"></div><a class="cta" href="profile.html">판매자 프로필</a></div>'
            + MK_JS.replace("__DATA__", json.dumps(MK_DATA, ensure_ascii=False)))


# 화면: (제목, 팔레트, CSS, html, 시안, 도착 화면 {파일: 제목})
SCREENS = {
    "library": ("내 서재", LB_PAL, LB_CSS, lb_html, lb_model, {"history.html": "대출 내역", "settings.html": "설정", "list.html": "목록"}),
    "parking": ("주차 정산", PK_PAL, PK_CSS, pk_html, pk_model, {"pay.html": "결제", "list.html": "목록"}),
    "plant": ("내 식물", PT_PAL, PT_CSS, pt_html, pt_model, {"info.html": "식물 정보", "list.html": "목록"}),
    "ticket": ("예매 확인", TK_PAL, TK_CSS, tk_html, tk_model, {"history.html": "예매 내역", "likes.html": "관심 공연", "list.html": "목록"}),
    "market": ("알림", MK_PAL, MK_CSS, mk_html, mk_model, {"profile.html": "판매자 프로필", "chat.html": "채팅", "list.html": "목록"}),
}

# 변형: (화면, 이름, 코드, 설명, [(바꿀 글, 새 글)], 정답)
#   정답 kind=text: sel 요소의 글자가 expected(시안·데이터 기준) 대신 actual로 보인다
#   정답 kind=link: 버튼(label)이 시안 연결 dest_name 대신 다른 화면(actual)으로 간다
#   정답 kind=action: 버튼(label)을 누르면 시안·문구의 동작 대신 다른 일이 일어난다
VARIANTS = [
    ("library", "c1-undefined", "C1", "인사말이 없는 필드(nickname)를 읽어 'undefined 님'으로 보임", [("${DATA.user.name} 님", "${DATA.user.nickname} 님")],
     {"kind": "text", "sel": "#greet", "expected": "김하늘 님, 대출 중인 책 2권", "actual": "undefined 님, 대출 중인 책 2권", "confirm": "pattern", "family": "빈 값"}),
    ("library", "c2-dest", "C2", "'대출 내역 보기'가 시안 연결(대출 내역) 대신 설정 화면으로 감", [('id="cta" href="history.html"', 'id="cta" href="settings.html"')],
     {"kind": "link", "label": "대출 내역 보기", "expected": "대출 내역", "actual": "설정", "confirm": "prototype", "family": "목적지 틀림"}),
    ("parking", "c1-timezone", "C1", "입차 시각을 한국 시간으로 바꾸지 않아 9시간 이른 05:30으로 보임", ["(new Date(iso).getTime() + 9 * 3600e3)", "(new Date(iso).getTime())"],
     {"kind": "text", "sel": ".row:nth-child(2) b", "expected": "14:30", "actual": "05:30", "confirm": "data", "family": "시간대"}),
    ("parking", "c1-number", "C1", "요금에 자릿수 구분을 빠뜨려 '4500원'으로 보임", [("${DATA.fee.toLocaleString('ko-KR')}원", "${DATA.fee}원")],
     {"kind": "text", "sel": ".row:nth-child(4) b", "expected": "4,500원", "actual": "4500원", "confirm": "data", "family": "숫자 형식"}),
    ("parking", "c1-negative", "C1", "갱신 시각 차이를 거꾸로 빼 '-3분 전'으로 보임", ["(new Date(DATA.now) - new Date(DATA.posted))", "(new Date(DATA.posted) - new Date(DATA.now))"],
     {"kind": "text", "sel": "#note", "expected": "요금표 갱신 3분 전", "actual": "요금표 갱신 -3분 전", "confirm": "pattern", "family": "음수 시간"}),
    ("plant", "c1-array", "C1", "관리 태그 배열을 칩 하나에 그대로 넣어 '[\"반그늘\",\"주 1회\"]'로 보임", [("${p.tags.map((t) => `<span>${t}</span>`).join('')}", "<span>${JSON.stringify(p.tags)}</span>")],
     {"kind": "text", "sel": ".chips", "expected": "반그늘 주 1회", "actual": "[\"반그늘\",\"주 1회\"]", "confirm": "pattern", "family": "배열 그대로"}),
    ("plant", "c1-nan", "C1", "물 주기 비율에 없는 필드(cycleDays)를 써 'NaN%'로 보임", [("p.days / p.cycle * 100", "p.days / p.cycleDays * 100")],
     {"kind": "text", "sel": ".card p", "expected": "물 준 지 4일 · 물 주기 57%", "actual": "물 준 지 4일 · 물 주기 NaN%", "confirm": "pattern", "family": "NaN"}),
    ("plant", "c2-action", "C2", "'물 줬어요'를 누르면 기록을 0일로 되돌리는 대신 식물 카드를 지움", ["DATA.plants[+b.dataset.water].days = 0;", "DATA.plants.splice(+b.dataset.water, 1);"],
     {"kind": "action", "label": "물 줬어요", "expected": "물 준 지 0일", "actual": "카드가 사라짐", "confirm": "interact", "family": "문구와 다른 동작"}),
    ("ticket", "c1-raw", "C1", "좌석을 서버 원문 형식 'R-12-7'로 보임", ["`${s.grade}석 ${s.row}열 ${s.no}번`", "`${s.grade}-${s.row}-${s.no}`"],
     {"kind": "text", "sel": ".row:nth-child(2) b", "expected": "R석 12열 7번", "actual": "R-12-7", "confirm": "data", "family": "서버 원문"}),
    ("ticket", "c2-sametab", "C2", "'관심 공연' 탭이 '예매 내역'과 같은 화면으로 감", [('<a href="likes.html">관심 공연</a>', '<a href="history.html">관심 공연</a>')],
     {"kind": "link", "label": "관심 공연", "expected": "관심 공연", "actual": "예매 내역", "confirm": "prototype", "family": "두 탭 같은 화면"}),
    ("market", "c1-count", "C1", "새 알림 개수에 읽은 알림까지 더해 '새 알림 4개'로 보이지만 목록은 3개", ["${DATA.unread.length}개", "${DATA.unread.length + DATA.read.length}개"],
     {"kind": "text", "sel": "#count", "expected": "새 알림 3개", "actual": "새 알림 4개", "confirm": "data", "family": "개수 불일치"}),
    ("market", "c2-dest", "C2", "'판매자 프로필'이 시안 연결(판매자 프로필) 대신 채팅 화면으로 감", [('href="profile.html">판매자 프로필', 'href="chat.html">판매자 프로필')],
     {"kind": "link", "label": "판매자 프로필", "expected": "판매자 프로필", "actual": "채팅", "confirm": "prototype", "family": "목적지 틀림"}),
]


def dest_pages(d, pal, dests):
    for f, t in dests.items():
        (d / f).write_text(page(t, pal, HEAD_CSS, head(t, pal) + '<div class="scroll"></div>').replace("<h1>", '<h1 id="title">', 1))


def main():
    cases = []
    for scr, (title, pal, css, html_fn, model_fn, dests) in SCREENS.items():
        sd = OUT / scr; sd.mkdir(parents=True, exist_ok=True)
        (sd / "design.json").write_text(json.dumps(model_fn(), ensure_ascii=False, indent=1) + "\n")
        subprocess.run(["node", str(ROOT / "dqa" / "design" / "render.js"), str(sd / "design.json"), str(sd / "design.png")], check=True, capture_output=True)
        d = sd / "ok"; d.mkdir(exist_ok=True)
        (d / "index.html").write_text(page(f"{title} · ok", pal, css, html_fn())); dest_pages(d, pal, dests)
        cases.append({"id": f"cand1-{scr}-ok", "screen": scr, "variant": "ok", "code": None, "defect": "맞게 만든 구현", "dir": f"eval/synth/cand1/screens/{scr}/ok", "sizes": SIZES, "truth": None, "hint": []})
    for scr, var, code, desc, subs, truth in VARIANTS:
        title, pal, css, html_fn, _, dests = SCREENS[scr]
        html = html_fn()
        if subs and isinstance(subs[0], str): subs = [tuple(subs)]
        for a, b in subs:
            assert html.count(a) == 1, (scr, var, a); html = html.replace(a, b)
        d = OUT / scr / var; d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(f"{title} · {var}", pal, css, html)); dest_pages(d, pal, dests)
        hint = [truth.get("label") or truth["actual"]]
        cases.append({"id": f"cand1-{scr}-{var}", "screen": scr, "variant": var, "code": code, "defect": desc, "dir": f"eval/synth/cand1/screens/{scr}/{var}", "sizes": SIZES, "truth": truth, "hint": hint})
    (HERE / "cases.json").write_text(json.dumps({"note": "후보 묶음 1(11-12). 규칙·시안 비교 밖 결함(C1 화면 글자 뜻, C2 버튼 목적지·동작)의 정답. 시안을 먼저 쓰고 구현을 따로 짰다. 화면 글자는 목 데이터를 JS로 그린다.",
                                                 "interact": True, "frozen_rules_sha1": frozen_sha1(), "cases": cases}, ensure_ascii=False, indent=1) + "\n")
    print(f"화면 {len(SCREENS)}개, 결함 {len(VARIANTS)}개, 종류 {sorted({v[5]['family'] for v in VARIANTS})}")


if __name__ == "__main__":
    main()
