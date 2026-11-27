"""블라인드 합성 예제 6묶음(10-12): 시안 비교·눌러 보기를 정직하게 재는 첫 묶음.
앞선 묶음과 달리 시안을 먼저 쓴다(design_model.py로 오토 레이아웃 시안 → design.json). 구현(HTML·CSS)은 그 시안 값을 보고 따로 짰다.
그래서 맞게 만든 화면에도 브라우저와 시안 계산의 실제 차이(글자 상자, 테두리 두께 등)가 남아, 오탐을 낙관하지 않고 잴 수 있다.
모든 버튼·링크가 실제로 동작하게 만들어(눌러 보기 오탐 측정), 묶음 전체를 --interact로 잰다.
dqa의 비교·측정 코드(design/compare.js·extract.js, measure/inpage.js·cluster.js, interact/)를 내용 해시로 고정하고 한 번만 잰다.
화면: playlist(음악 재생 목록), transfer(송금 확인), health(오늘의 기록), stay(숙소 상세), alerts(알림 설정)
사용: python3 eval/synth/make_blind6.py
"""
import hashlib
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw
from design_model import F, T, I, V, build

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent / "blind6"
OUT = HERE / "screens"
SIZES = ["375x812", "390x844", "430x932"]

BASE = """*{box-sizing:border-box}html,body{margin:0;font-family:"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:var(--text);background:var(--page)}
button{font:inherit;color:inherit;border:0;background:none;cursor:pointer;padding:0}
#root{min-height:100vh;display:flex;justify-content:center}
.app{width:100%;max-width:430px;height:100vh;background:var(--bg);position:relative;display:flex;flex-direction:column;overflow:hidden;padding-top:44px}
.scroll{flex:1;overflow-y:auto}
.sheet{position:absolute;left:0;right:0;bottom:0;padding:20px;background:#fff;border-radius:16px 16px 0 0;box-shadow:0 -8px 24px rgba(0,0,0,.15);z-index:5}
.sheet[hidden]{display:none}
"""
# 시트를 열고 닫는 공통 동작(구현에서 버튼이 실제로 반응하게)
JS = """<script>
document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => { const s = document.getElementById('sheet'); s.querySelector('p').textContent = b.getAttribute('data-sheet'); s.hidden = false }))
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { document.getElementById('sheet').hidden = true }))
document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => { b.classList.toggle('on'); b.setAttribute('aria-checked', b.classList.contains('on')) }))
</script>"""
SHEET = '<div class="sheet" id="sheet" hidden><p style="margin:0 0 12px;font-size:16px;font-weight:700"></p><button data-close style="width:100%;height:44px;border-radius:12px;background:#111;color:#fff">닫기</button></div>'


def page(title, pal, css, body):
    root = ":root{" + ";".join(f"--{k}:{v}" for k, v in pal.items()) + "}"
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{title}</title>
<style>{root}{BASE}{css}</style></head><body><div id="root"><div class="app">{body}{SHEET}</div></div>{JS}</body></html>
"""


def ic(kind, color="#111111"):
    p = {"back": '<path d="M15 5l-7 7 7 7"/>', "more": '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
         "play": '<path d="M8 5v14l11-7z"/>', "shuffle": '<path d="M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3"/>', "star": '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
         "bell": '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4"/>'}[kind]
    fill = color if kind in ("play", "star") else "none"
    return f'<svg viewBox="0 0 24 24" width="100%" height="100%" fill="{fill}" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{p}</svg>'


def head(title, pal):
    # 머리 줄: 뒤로(목록으로 이동) · 제목 · 더보기(시트)
    return f'<header class="hd"><a class="hb" href="list.html" aria-label="뒤로">{ic("back")}</a><h1>{title}</h1><button class="hb" data-sheet="메뉴" aria-label="더보기">{ic("more")}</button></header>'


HEAD_CSS = """.hd{flex:none;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 8px}
.hd h1{margin:0;font-size:17px;line-height:24px;font-weight:700}.hb{width:40px;height:40px;padding:8px;display:flex}"""


def head_model(title, color, tok="color/text"):
    # 제목색은 그 화면의 본문 토큰 값(10-12 첫 측정 뒤 고침: 처음에는 #111111로 고정해 시안이 자기 토큰과 어긋났다)
    return F("Header", [V("뒤로", 40, 40), T(title, 17, 700, 24, color, tok), V("더보기", 40, 40)], dir="H", justify="SPACE_BETWEEN", align="CENTER", pad=(6, 8, 6, 8), h=52)


# ── 1. 음악 재생 목록 ─────────────────────────────────────
PL_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#111111", "muted": "#6B7280", "line": "#E5E7EB", "brand": "#E11D48", "dark": "#18181B"}
PL_TOK = {"color/brand": "#E11D48", "color/text": "#111111", "color/muted": "#6B7280", "color/line": "#E5E7EB", "color/dark": "#18181B", "color/bg": "#FFFFFF"}
SONGS = [("밤의 산책", "윤하늘"), ("여름 끝자락", "모래와 바람"), ("새벽 세 시", "김도윤 트리오"), ("우리가 걷던 길", "하루")]


def pl_model():
    rows = [F(f"song{i}", [I(f"cover{i}", 48, 48, 8), F("txt", [T(t, 15, 600, 22, "#111111", "color/text"), T(a, 13, 400, 18, "#6B7280", "color/muted")], gap=2, w="FILL"), V("곡 메뉴", 24, 24)],
              dir="H", gap=12, align="CENTER", pad=(8, 20, 8, 20)) for i, (t, a) in enumerate(SONGS, 1)]
    body = F("body", [head_model("재생 목록", "#111111"),
                      F("intro", [T("새벽 감성 모음", 22, 700, 30, "#111111", "color/text"), T("곡 4개 · 16분", 13, 400, 18, "#6B7280", "color/muted")], gap=4, pad=(8, 20, 0, 20)),
                      F("actions", [F("모두 재생", [T("모두 재생", 14, 700, 20, "#FFFFFF", "color/bg")], dir="H", align="CENTER", pad=(10, 18, 10, 18), w="HUG", fill="#E11D48", ftoken="color/brand", radius=20),
                                    F("셔플", [T("셔플", 14, 700, 20, "#111111", "color/text")], dir="H", align="CENTER", pad=(10, 18, 10, 18), w="HUG", stroke="#E5E7EB", stoken="color/line", radius=20)],
                        dir="H", gap=8, pad=(16, 20, 8, 20)),
                      F("list", rows, gap=0, pad=(8, 0, 0, 0))])
    bottom = F("mini player", [I("now cover", 40, 40, 6), F("now", [T("밤의 산책", 14, 600, 20, "#FFFFFF", "color/bg"), T("윤하늘", 12, 400, 16, "#A1A1AA")], gap=0, w="FILL"), V("재생", 28, 28)],
               dir="H", gap=12, align="CENTER", pad=(12, 20, 12, 20), fill="#18181B", ftoken="color/dark", h=64)
    return build("재생 목록", body, tokens=PL_TOK, bottom=bottom)


PL_CSS = HEAD_CSS + """
.intro{padding:8px 20px 0}.intro h2{margin:0;font-size:22px;line-height:30px;font-weight:700}.intro p{margin:4px 0 0;font-size:13px;line-height:18px;color:var(--muted)}
.acts{display:flex;gap:8px;padding:16px 20px 8px}
.acts button{height:40px;padding:0 18px;border-radius:20px;font-size:14px;line-height:20px;font-weight:700}
.acts .all{background:var(--brand);color:#fff}.acts .shuf{border:1px solid var(--line);height:40px}
.list{padding-top:8px}.song{display:flex;align-items:center;gap:12px;padding:8px 20px}
.song img{width:48px;height:48px;border-radius:8px;object-fit:cover;flex:none}
.song .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.song b{font-size:15px;line-height:22px;font-weight:600}.song span{font-size:13px;line-height:18px;color:var(--muted)}
.song .mb{width:24px;height:24px;flex:none;display:flex}
.mini{position:absolute;left:0;right:0;bottom:0;height:64px;display:flex;align-items:center;gap:12px;padding:12px 20px;background:var(--dark)}
.mini img{width:40px;height:40px;border-radius:6px;flex:none}.mini .t{flex:1;min-width:0;display:flex;flex-direction:column}
.mini b{font-size:14px;line-height:20px;font-weight:600;color:#fff}.mini span{font-size:12px;line-height:16px;color:#A1A1AA}.mini .pb{width:28px;height:28px;display:flex;flex:none}
"""


def pl_html():
    rows = "".join(f'<div class="song"><img src="c{i}.png" alt="{t} 표지"><div class="t"><b>{t}</b><span>{a}</span></div><button class="mb" data-sheet="{t} 메뉴" aria-label="{t} 메뉴">{ic("more", "#6B7280")}</button></div>' for i, (t, a) in enumerate(SONGS, 1))
    return (head("재생 목록", PL_PAL) + '<div class="scroll"><div class="intro"><h2>새벽 감성 모음</h2><p>곡 4개 · 16분</p></div>'
            + '<div class="acts"><button class="all" data-sheet="모두 재생">모두 재생</button><button class="shuf" data-sheet="셔플 재생">셔플</button></div>'
            + f'<div class="list">{rows}</div></div>'
            + f'<div class="mini"><img src="c1.png" alt="지금 재생 표지"><div class="t"><b>밤의 산책</b><span>윤하늘</span></div><button class="pb" data-toggle aria-label="재생">{ic("play", "#FFFFFF")}</button></div>')


# ── 2. 송금 확인 ─────────────────────────────────────────
TR_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#111827", "muted": "#6B7280", "line": "#E5E7EB", "brand": "#2563EB", "surface": "#F3F4F6"}
TR_TOK = {"color/brand": "#2563EB", "color/text": "#111827", "color/muted": "#6B7280", "color/surface": "#F3F4F6", "color/bg": "#FFFFFF"}
TR_ROWS = [("받는 분", "김지은"), ("받는 계좌", "국민 123456-01-789"), ("수수료", "면제"), ("보내는 날", "오늘 즉시")]


def tr_model():
    rows = [F(f"row{i}", [T(k, 14, 400, 20, "#6B7280", "color/muted"), T(v, 14, 600, 20, "#111827", "color/text")], dir="H", justify="SPACE_BETWEEN", align="CENTER") for i, (k, v) in enumerate(TR_ROWS, 1)]
    body = F("body", [head_model("송금 확인", "#111827"),
                      F("amount", [T("김지은님에게", 15, 400, 22, "#6B7280", "color/muted"), T("150,000원", 30, 700, 40, "#111827", "color/text"), T("을 보낼까요?", 15, 400, 22, "#6B7280", "color/muted")], gap=4, align="CENTER", pad=(32, 20, 28, 20)),
                      F("detail", [F("card", rows, gap=14, pad=(20, 20, 20, 20), fill="#F3F4F6", ftoken="color/surface", radius=16)], pad=(0, 20, 0, 20)),
                      F("note", [T("보낸 뒤에는 취소할 수 없어요. 받는 분 이름을 한 번 더 확인해 주세요.", 13, 400, 20, "#6B7280", "color/muted", w="FILL", lines=2)], pad=(16, 20, 0, 20))])
    bottom = F("bottom bar", [F("송금하기", [T("송금하기", 16, 700, 24, "#FFFFFF", "color/bg")], dir="H", align="CENTER", justify="CENTER", h=52, fill="#2563EB", ftoken="color/brand", radius=12,
                                reactions=[{"trigger": "ON_CLICK", "actions": [{"type": "NODE", "navigation": "NAVIGATE", "dest": "7:1", "dest_name": "송금 완료", "url": None}]}])],
               pad=(12, 20, 32, 20), h=96, fill="#FFFFFF", ftoken="color/bg")
    return build("송금 확인", body, tokens=TR_TOK, bottom=bottom)


TR_CSS = HEAD_CSS + """
.amt{display:flex;flex-direction:column;align-items:center;gap:4px;padding:32px 20px 28px}
.amt span{font-size:15px;line-height:22px;color:var(--muted)}.amt b{font-size:30px;line-height:40px;font-weight:700;color:var(--text)}
.card{margin:0 20px;padding:20px;border-radius:16px;background:var(--surface);display:flex;flex-direction:column;gap:14px}
.card div{display:flex;justify-content:space-between;align-items:center;font-size:14px;line-height:20px}.card dt{color:var(--muted)}.card dd{margin:0;font-weight:600}
.note{margin:16px 20px 0;font-size:13px;line-height:20px;color:var(--muted)}
.bb{position:absolute;left:0;right:0;bottom:0;height:96px;padding:12px 20px 32px;background:#fff}
.bb a{display:flex;align-items:center;justify-content:center;height:52px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;line-height:24px;font-weight:700;text-decoration:none}
"""


def tr_html():
    rows = "".join(f"<div><dt>{k}</dt><dd>{v}</dd></div>" for k, v in TR_ROWS)
    return (head("송금 확인", TR_PAL) + '<div class="scroll"><div class="amt"><span>김지은님에게</span><b>150,000원</b><span>을 보낼까요?</span></div>'
            + f'<dl class="card" style="margin-top:0;margin-bottom:0">{rows}</dl><p class="note">보낸 뒤에는 취소할 수 없어요. 받는 분 이름을 한 번 더 확인해 주세요.</p></div>'
            + '<div class="bb"><a href="done.html">송금하기</a></div>')


# ── 3. 오늘의 기록(건강) ─────────────────────────────────
HE_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#0F172A", "muted": "#64748B", "line": "#E2E8F0", "brand": "#059669", "surface": "#F1F5F9"}
HE_TOK = {"color/brand": "#059669", "color/text": "#0F172A", "color/muted": "#64748B", "color/surface": "#F1F5F9", "color/bg": "#FFFFFF"}
TILES = [("걸음", "8,214", "걸음"), ("거리", "6.1", "km"), ("소모 열량", "342", "kcal"), ("활동 시간", "54", "분")]


def tile(l, v, u):
    return F(f"tile {l}", [T(l, 13, 400, 18, "#64748B", "color/muted"), T(v, 24, 700, 32, "#0F172A", "color/text"), T(u, 12, 400, 16, "#64748B", "color/muted")], gap=4, pad=(16, 16, 16, 16), fill="#F1F5F9", ftoken="color/surface", radius=16, w="FILL")


def he_model():
    body = F("body", [head_model("오늘의 기록", "#0F172A"),
                      F("date", [T("10월 12일 일요일", 14, 600, 20, "#059669", "color/brand"), T("오늘도 잘 걷고 있어요", 22, 700, 30, "#0F172A", "color/text")], gap=4, pad=(8, 20, 0, 20)),
                      F("grid", [F("r1", [tile(*TILES[0]), tile(*TILES[1])], dir="H", gap=12), F("r2", [tile(*TILES[2]), tile(*TILES[3])], dir="H", gap=12)], gap=12, pad=(20, 20, 0, 20)),
                      F("goal", [F("goal head", [T("주간 목표", 16, 700, 24, "#0F172A", "color/text"), T("5/7일", 14, 600, 20, "#059669", "color/brand")], dir="H", justify="SPACE_BETWEEN", align="CENTER"),
                                 F("bar", [F("bar fill", w=239, h=8, fill="#059669", ftoken="color/brand", radius=4)], h=8, fill="#E2E8F0", radius=4)], gap=12, pad=(24, 20, 0, 20)),
                      F("tip", [T("어제보다 1,240걸음 더 걸었어요.", 14, 400, 20, "#64748B", "color/muted")], pad=(12, 20, 0, 20))])
    return build("오늘의 기록", body, tokens=HE_TOK)


HE_CSS = HEAD_CSS + """
.date{padding:8px 20px 0}.date span{display:block;font-size:14px;line-height:20px;font-weight:600;color:var(--brand)}.date h2{margin:4px 0 0;font-size:22px;line-height:30px;font-weight:700}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:20px 20px 0}
.tile{display:flex;flex-direction:column;gap:4px;padding:16px;border-radius:16px;background:var(--surface);text-align:left}
.tile span{font-size:13px;line-height:18px;color:var(--muted)}.tile b{font-size:24px;line-height:32px;font-weight:700}.tile i{font-style:normal;font-size:12px;line-height:16px;color:var(--muted)}
.goal{padding:24px 20px 0}.goal .gh{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.goal h3{margin:0;font-size:16px;line-height:24px;font-weight:700}.goal .gh span{font-size:14px;line-height:20px;font-weight:600;color:var(--brand)}
.bar{height:8px;border-radius:4px;background:var(--line)}.bar i{display:block;width:71.4%;height:8px;border-radius:4px;background:var(--brand)}
.tip{margin:12px 20px 0;font-size:14px;line-height:20px;color:var(--muted)}
"""


def he_html():
    tiles = "".join(f'<button class="tile" data-sheet="{l} 자세히"><span>{l}</span><b>{v}</b><i>{u}</i></button>' for l, v, u in TILES)
    return (head("오늘의 기록", HE_PAL) + '<div class="scroll"><div class="date"><span>10월 12일 일요일</span><h2>오늘도 잘 걷고 있어요</h2></div>'
            + f'<div class="grid">{tiles}</div>'
            + '<div class="goal"><div class="gh"><h3>주간 목표</h3><span>5/7일</span></div><div class="bar"><i></i></div></div><p class="tip">어제보다 1,240걸음 더 걸었어요.</p></div>')


# ── 4. 숙소 상세 ─────────────────────────────────────────
ST_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#1F2937", "muted": "#6B7280", "line": "#E5E7EB", "brand": "#F97316", "chip": "#F3F4F6"}
ST_TOK = {"color/brand": "#F97316", "color/text": "#1F2937", "color/muted": "#6B7280", "color/chip": "#F3F4F6", "color/bg": "#FFFFFF", "color/line": "#E5E7EB"}
CHIPS = ["오션뷰", "무료 주차", "조식 포함"]


def st_model():
    chips = [F(f"chip {c}", [T(c, 13, 500, 18, "#1F2937", "color/text")], dir="H", align="CENTER", pad=(6, 12, 6, 12), w="HUG", fill="#F3F4F6", ftoken="color/chip", radius=15) for c in CHIPS]
    body = F("body", [head_model("숙소 상세", "#1F2937"),
                      I("hero", "FILL", 220, 0),
                      F("info", [T("애월 바다 앞 독채 스테이", 20, 700, 28, "#1F2937", "color/text"),
                                 F("rating", [V("별", 16, 16), T("4.8", 14, 700, 20, "#1F2937", "color/text"), T("후기 213개 · 제주 애월읍", 14, 400, 20, "#6B7280", "color/muted")], dir="H", gap=4, align="CENTER"),
                                 F("chips", chips, dir="H", gap=8),
                                 T("창을 열면 바로 바다가 보이는 독채예요. 마당에서 노을을 보며 바비큐를 할 수 있어요.", 14, 400, 22, "#6B7280", "color/muted", w="FILL", lines=2)],
                        gap=12, pad=(20, 20, 0, 20))])
    bottom = F("bottom bar", [F("price", [T("189,000원", 18, 700, 26, "#1F2937", "color/text"), T("1박 · 세금 포함", 12, 400, 16, "#6B7280", "color/muted")], gap=0, w="HUG"),
                              F("예약하기", [T("예약하기", 16, 700, 24, "#FFFFFF", "color/bg")], dir="H", align="CENTER", pad=(12, 28, 12, 28), w="HUG", fill="#F97316", ftoken="color/brand", radius=12)],
               dir="H", justify="SPACE_BETWEEN", align="CENTER", pad=(12, 20, 32, 20), h=96, fill="#FFFFFF", ftoken="color/bg")
    return build("숙소 상세", body, tokens=ST_TOK, bottom=bottom)


ST_CSS = HEAD_CSS + """
.hero{display:block;width:100%;height:220px;object-fit:cover}
.info{display:flex;flex-direction:column;gap:12px;padding:20px 20px 0}
.info h2{margin:0;font-size:20px;line-height:28px;font-weight:700}
.rate{display:flex;align-items:center;gap:4px;font-size:14px;line-height:20px}.rate svg{width:16px;height:16px;flex:none}.rate b{font-weight:700}.rate span{color:var(--muted)}
.chips{display:flex;gap:8px}.chips button{padding:6px 12px;border-radius:15px;background:var(--chip);font-size:13px;line-height:18px;font-weight:500}
.desc{margin:0;font-size:14px;line-height:22px;color:var(--muted)}
.bb{position:absolute;left:0;right:0;bottom:0;height:96px;display:flex;justify-content:space-between;align-items:center;padding:12px 20px 32px;background:#fff;box-shadow:inset 0 1px 0 var(--line)}
.bb .pr b{display:block;font-size:18px;line-height:26px;font-weight:700}.bb .pr span{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.bb a{padding:12px 28px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;line-height:24px;font-weight:700;text-decoration:none}
"""


def st_html():
    chips = "".join(f'<button data-sheet="{c} 안내">{c}</button>' for c in CHIPS)
    return (head("숙소 상세", ST_PAL) + '<div class="scroll"><img class="hero" src="hero.png" alt="숙소 사진">'
            + f'<div class="info"><h2>애월 바다 앞 독채 스테이</h2><div class="rate">{ic("star", "#F59E0B")}<b>4.8</b><span>후기 213개 · 제주 애월읍</span></div><div class="chips">{chips}</div>'
            + '<p class="desc">창을 열면 바로 바다가 보이는 독채예요. 마당에서 노을을 보며 바비큐를 할 수 있어요.</p></div></div>'
            + '<div class="bb"><div class="pr"><b>189,000원</b><span>1박 · 세금 포함</span></div><a href="book.html">예약하기</a></div>')


# ── 5. 알림 설정 ─────────────────────────────────────────
AL_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#18181B", "muted": "#71717A", "line": "#E4E4E7", "brand": "#4F46E5", "off": "#D4D4D8"}
AL_TOK = {"color/brand": "#4F46E5", "color/text": "#18181B", "color/muted": "#71717A", "color/line": "#E4E4E7", "color/off": "#D4D4D8", "color/bg": "#FFFFFF"}
OPTS = [("새 메시지", "친구가 보낸 메시지를 바로 알려요", True), ("모임 일정", "참여한 모임의 하루 전 알림", True), ("이벤트·혜택", "할인과 새 소식을 알려요", False), ("야간 알림", "밤 9시부터 아침 8시까지", False)]


def al_model():
    rows = [F(f"opt {l}", [F("txt", [T(l, 15, 600, 22, "#18181B", "color/text"), T(d, 12, 400, 16, "#71717A", "color/muted")], gap=2, w="FILL"),
                          F(f"toggle {l}", [F("knob", w=20, h=20, fill="#FFFFFF", radius=10)], dir="H", align="CENTER", justify="MAX" if on else "MIN", pad=(3, 3, 3, 3), w=44, h=26, fill="#4F46E5" if on else "#D4D4D8", ftoken="color/brand" if on else "color/off", radius=13)],
              dir="H", gap=12, align="CENTER", pad=(14, 16, 14, 16)) for l, d, on in OPTS]
    body = F("body", [head_model("알림 설정", "#18181B"),
                      F("intro", [T("받고 싶은 알림만 켜 두세요", 14, 400, 20, "#71717A", "color/muted")], pad=(8, 20, 0, 20)),
                      F("group wrap", [F("group", rows, gap=0, stroke="#E4E4E7", stoken="color/line", radius=16)], pad=(16, 20, 0, 20)),
                      F("history", [T("알림 기록 보기", 14, 600, 20, "#4F46E5", "color/brand")], align="CENTER", pad=(20, 20, 0, 20))])
    return build("알림 설정", body, tokens=AL_TOK)


AL_CSS = HEAD_CSS + """
.intro{margin:8px 20px 0;font-size:14px;line-height:20px;color:var(--muted)}
.group{margin:16px 20px 0;border:1px solid var(--line);border-radius:16px}
.opt{display:flex;align-items:center;gap:12px;padding:14px 16px}
.opt .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.opt b{font-size:15px;line-height:22px;font-weight:600}.opt span{font-size:12px;line-height:16px;color:var(--muted)}
.tg{width:44px;height:26px;padding:3px;border-radius:13px;background:var(--off);display:flex;justify-content:flex-start;flex:none}
.tg i{width:20px;height:20px;border-radius:10px;background:#fff}.tg.on{background:var(--brand);justify-content:flex-end}
.hist{display:block;margin:20px auto 0;text-align:center;font-size:14px;line-height:20px;font-weight:600;color:var(--brand);text-decoration:none}
"""


def al_html():
    rows = "".join(f'<div class="opt"><div class="t"><b>{l}</b><span>{d}</span></div><button class="tg{" on" if on else ""}" role="switch" aria-checked="{"true" if on else "false"}" aria-label="{l}" data-toggle><i></i></button></div>' for l, d, on in OPTS)
    return (head("알림 설정", AL_PAL) + f'<div class="scroll"><p class="intro">받고 싶은 알림만 켜 두세요</p><div class="group">{rows}</div><a class="hist" href="history.html">알림 기록 보기</a></div>')


SCREENS = {
    "playlist": ("재생 목록", PL_PAL, PL_CSS, pl_html, pl_model),
    "transfer": ("송금 확인", TR_PAL, TR_CSS, tr_html, tr_model),
    "health": ("오늘의 기록", HE_PAL, HE_CSS, he_html, he_model),
    "stay": ("숙소 상세", ST_PAL, ST_CSS, st_html, st_model),
    "alerts": ("알림 설정", AL_PAL, AL_CSS, al_html, al_model),
}

# 변형: (화면, 이름, 코드, 설명, 더할 CSS, [(바꿀 글, 새 글)], 정답 확인, 채점 힌트)
VARIANTS = [
    ("playlist", "d3-title", "D3", "곡 제목 굵기를 시안 600 대신 기본 400으로 둠", ".song b{font-weight:400}", [], {"type": "style", "sel": ".song b", "prop": "font-weight", "value": "600"}, ["밤의 산책"]),
    ("playlist", "m2-cover", "M2", "두 번째 곡의 표지 그림을 조건 실수로 그리지 않음", "", [('<img src="c2.png" alt="여름 끝자락 표지">', "")], {"type": "style", "sel": ".song:nth-child(2) img", "prop": "display", "value": "block"}, ["cover2"]),
    ("transfer", "d2-amount", "D2", "금액 글자색을 시안의 본문색 대신 브랜드 파랑으로 씀", ".amt b{color:var(--brand)}", [], {"type": "style", "sel": ".amt b", "prop": "color", "value": "rgb(17, 24, 39)"}, ["150,000원"]),
    ("transfer", "t1-cta", "T1", "버튼 문구를 시안 '송금하기' 대신 '보내기'로 씀", "", [('<a href="done.html">송금하기</a>', '<a href="done.html">보내기</a>')], None, ["보내기", "송금하기"]),
    ("health", "f1-tiles", "F1", "기록 칸을 시안의 Fill 대신 150px 고정 폭으로 씀", ".grid{grid-template-columns:150px 150px}", [], {"type": "style", "sel": ".grid", "prop": "grid-template-columns", "value": "161.5px 161.5px"}, ["걸음", "거리"]),
    ("health", "l2-goal", "L2", "주간 목표 위 간격을 시안 24px 대신 40px로 씀", ".goal{padding-top:40px}", [], {"type": "style", "sel": ".goal", "prop": "padding-top", "value": "24px"}, ["주간 목표"]),
    ("stay", "d5-chip", "D5", "편의시설 칩 모서리를 시안 15px 대신 4px로 씀", ".chips button{border-radius:4px}", [], {"type": "style", "sel": ".chips button", "prop": "border-top-left-radius", "value": "15px"}, ["오션뷰"]),
    ("stay", "l1-price", "L1", "하단 바의 세로 가운데 맞춤을 빼 가격과 버튼이 위로 붙음", ".bb{align-items:flex-start}", [], {"type": "style", "sel": ".bb", "prop": "align-items", "value": "center"}, []),
    ("alerts", "i1-toggle", "I1", "야간 알림 스위치에 누름 처리를 빠뜨림(눌러도 켜지지 않음)", "", [('aria-label="야간 알림" data-toggle', 'aria-label="야간 알림"')], None, ["야간 알림"]),
    ("alerts", "d2-toggle", "D2", "켜진 스위치 색을 시안 브랜드색 대신 초록으로 씀", ".tg.on{background:#22C55E}", [], {"type": "style", "sel": ".tg.on", "prop": "background-color", "value": "rgb(79, 70, 229)"}, ["새 메시지", "모임 일정"]),
]


def images(d, scr):
    def img(name, w, h, a, b):
        im = Image.new("RGB", (w, h), a); dr = ImageDraw.Draw(im)
        dr.ellipse((w * 0.55, h * 0.15, w * 0.85, h * 0.45), fill=b); dr.rectangle((0, h * 0.7, w, h), fill=b)
        im.save(d / name)
    if scr == "playlist":
        for i, (a, b) in enumerate([("#FDE68A", "#B45309"), ("#BFDBFE", "#1D4ED8"), ("#DDD6FE", "#6D28D9"), ("#FBCFE8", "#BE185D")], 1): img(f"c{i}.png", 96, 96, a, b)
    if scr == "stay": img("hero.png", 750, 440, "#BAE6FD", "#0369A1")


def frozen_sha1():
    h = hashlib.sha1()
    for f in ("design/compare.js", "design/extract.js", "measure/inpage.js", "measure/cluster.js", "interact/inpage.js", "interact/probe.js"):
        h.update((ROOT / "dqa" / f).read_bytes())
    return h.hexdigest()


def main():
    cases = []
    for scr, (title, pal, css, html_fn, model_fn) in SCREENS.items():
        sd = OUT / scr; sd.mkdir(parents=True, exist_ok=True)
        spec = model_fn()
        (sd / "design.json").write_text(json.dumps(spec, ensure_ascii=False, indent=1) + "\n")
        subprocess.run(["node", str(ROOT / "dqa" / "design" / "render.js"), str(sd / "design.json"), str(sd / "design.png")], check=True, capture_output=True)
        ok = html_fn()
        d = sd / "ok"; d.mkdir(exist_ok=True)
        (d / "index.html").write_text(page(f"{title} · ok", pal, css, ok)); images(d, scr)
        cases.append({"id": f"blind6-{scr}-ok", "screen": scr, "variant": "ok", "code": None, "defect": "맞게 만든 구현", "dir": f"eval/synth/blind6/screens/{scr}/ok", "sizes": SIZES, "check": None, "hint": []})
    for scr, var, code, desc, extra, subs, check, hint in VARIANTS:
        title, pal, css, html_fn, _ = SCREENS[scr]
        html = html_fn()
        for a, b in subs:
            assert html.count(a) == 1, (scr, var, a); html = html.replace(a, b)
        d = OUT / scr / var; d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(f"{title} · {var}", pal, css + extra, html)); images(d, scr)
        cases.append({"id": f"blind6-{scr}-{var}", "screen": scr, "variant": var, "code": code, "defect": desc, "dir": f"eval/synth/blind6/screens/{scr}/{var}", "sizes": ["375x812"], "check": check, "hint": hint})
    (HERE / "cases.json").write_text(json.dumps({"note": "블라인드 합성 예제 6묶음(10-12). 시안을 먼저 쓰고(design_model.py) 구현을 따로 짰다. 시안 비교·눌러 보기 코드를 고정하고 한 번만 잰다. 묶음 전체를 --interact로 잰다.",
                                                 "interact": True, "frozen_rules_sha1": frozen_sha1(), "cases": cases}, ensure_ascii=False, indent=1) + "\n")
    print(f"화면 {len(SCREENS)}개, 결함 {len(VARIANTS)}개, 유형 {sorted({v[2] for v in VARIANTS})}, 고정 해시 {frozen_sha1()[:10]}")


if __name__ == "__main__":
    main()
