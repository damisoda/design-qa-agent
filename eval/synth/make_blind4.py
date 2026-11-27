"""블라인드 합성 예제 4묶음(10-10). 블라인드 3에서 드러난 빈틈을 고친 뒤의 일반화를 잰다.
dqa 규칙 파일을 고정(cases.json의 frozen_rules_sha1)한 채, 앞선 24개 앱과 겹치지 않는 새 앱 6종에 결함을 하나씩 심는다. 한 번만 잰다.
결함은 바이브코딩에서 흔한 실수에서 골랐다. 규칙 밖 종류(색 토큰, 글자 굵기, 선택 상태, 크기 방식, 정렬, 범례 색)도 섞는다.
맞게 만든 화면에도 실제 앱에서 흔한 구성(가로 스크롤 날짜, 위로 걸친 배지, 도넛 차트, 지도 위 칩, 단계 표시 선, 스위치, 입력칸 안 버튼, 나란히 놓인 겹친 일정, 끈끈한 머리글)을 넣어 오탐을 잰다.
화면: flight(항공편 검색), budget(가계부), tracking(배달 추적), meds(복약 알림), address(배송지 입력), calendar(데스크톱 주간 일정)
사용: python3 eval/synth/make_blind4.py  → eval/synth/blind4/screens/<화면>/<변형>/index.html, eval/synth/blind4/cases.json
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw
from make_synth import page, M5, W4

HERE = Path(__file__).resolve().parent / "blind4"
OUT = HERE / "screens"


def ic(kind, color="#222222"):
    paths = {
        "back": '<path d="M15 5l-7 7 7 7"/>', "next": '<path d="M9 5l7 7-7 7"/>',
        "chat": '<path d="M4 5h16v11H9l-5 4z"/>',
        "phone": '<path d="M6 3h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
        "plus": '<path d="M12 5v14M5 12h14"/>', "x": '<path d="M6 6l12 12M18 6L6 18"/>',
        "info": '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
    }
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{paths[kind]}</svg>'


# ── 1. 항공편 검색 ───────────────────────────────────────
FL_PAL = {"bg": "#FFFFFF", "page": "#EEF1F5", "text": "#101828", "muted": "#5B6474", "line": "#E4E7EC", "brand": "#1D4ED8"}
FL_CSS = """
.top .tt{flex:1;min-width:0}.top .tt b{display:block;font-size:16px;line-height:22px}.top .tt span{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.dates{flex:none;display:flex;gap:6px;overflow-x:auto;padding:10px 16px;border-bottom:1px solid var(--line)}
.dates button{flex:none;width:68px;height:52px;border-radius:10px;border:1px solid var(--line);background:#fff;font-size:12px;line-height:16px;color:var(--text)}
.dates button b{display:block;font-size:13px}.dates .on{border-color:var(--brand);background:#EFF4FF}
.chips{flex:none;display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px 0}.chips span{font-size:13px;line-height:18px;padding:5px 10px;border-radius:14px;border:1px solid var(--line)}
.list{flex:1;overflow-y:auto;padding:4px 16px 88px}
.fl{position:relative;border:1px solid var(--line);border-radius:14px;padding:14px;margin:16px 0 10px;background:#fff}
.fl .best{position:absolute;left:12px;top:-10px;font-size:11px;line-height:16px;font-weight:700;padding:2px 8px;border-radius:8px;background:var(--brand);color:#fff}
.fl .air{display:flex;align-items:center;gap:8px;font-size:13px;line-height:18px;color:var(--muted)}.fl .air img{width:42px;height:14px;object-fit:contain}
.fl .air .price{margin-left:auto;font-size:17px;line-height:22px;font-weight:800;color:#BE123C}
.fl .row{display:flex;align-items:center;gap:10px;margin-top:10px}
.fl .t{flex:none;min-width:56px}.fl .t b{display:block;font-size:20px;line-height:26px}.fl .t span{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.fl .t.r{text-align:right}
.fl .dur{flex:1;min-width:0;text-align:center;font-size:12px;line-height:16px;color:var(--muted)}.fl .dur i{display:block;height:1px;background:#C9CED6;margin:4px 0}
.fl .left{margin:8px 0 0;font-size:12px;line-height:16px;color:#B42318}
.sort{position:absolute;left:0;right:0;bottom:0;height:64px;display:flex;gap:8px;padding:10px 16px;background:#fff;border-top:1px solid var(--line)}
.sort button{flex:1;height:44px;border-radius:10px;border:1px solid var(--line);background:#fff;font-size:14px;font-weight:600;color:var(--text)}
"""
DATES = [("10.16 목", "72,400"), ("10.17 금", "81,900"), ("10.18 토", "68,900"), ("10.19 일", "95,000"), ("10.20 월", "61,200"), ("10.21 화", "59,800")]


def fl(logo, air, price, dep, arr, best=False, left=None):
    return f'''<div class="fl">{'<span class="best">최저가</span>' if best else ''}<div class="air"><img src="{logo}.png" alt="{air} 로고"><span>{air}</span><span class="price">{price}</span></div>
<div class="row"><div class="t"><b>{dep}</b><span>GMP</span></div><div class="dur">1시간 10분 · 직항 · 기내 수하물 10kg<i></i></div><div class="t r"><b>{arr}</b><span>CJU</span></div></div>{f'<p class="left">{left}</p>' if left else ''}</div>'''


FL_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{ic('back')}</button><div class="tt"><b>서울(김포) → 제주</b><span>10월 18일(토) · 성인 1명 · 일반석</span></div></div>
<div class="dates">{"".join(f'<button{" class=on" if d.startswith("10.18") else ""}>{d}<b>{p}</b></button>' for d, p in DATES)}</div>
<div class="chips"><span>직항만</span><span>오전 출발</span><span>수하물 포함</span><span>환불 가능</span></div>
<div class="list">{fl('logo1', '하늘항공', '68,900원', '07:05', '08:15', best=True, left='잔여 3석')}{fl('logo2', '바다항공', '74,200원', '09:30', '10:40')}{fl('logo3', '구름항공', '81,000원', '12:15', '13:25', left='잔여 5석')}{fl('logo1', '하늘항공', '92,500원', '18:40', '19:50')}</div>
<div class="sort"><button>정렬: 가격 낮은 순</button><button>필터 2</button></div>"""

# ── 2. 가계부 ────────────────────────────────────────────
BG_PAL = {"bg": "#FFFFFF", "page": "#F0F2F5", "text": "#111827", "muted": "#5B6472", "line": "#E5E7EB", "brand": "#0E7490"}
BG_CSS = """
.mon{flex:none;display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 16px}
.mon button{width:40px;height:40px;border-radius:20px;background:#F3F4F6;display:flex;align-items:center;justify-content:center}.mon button svg{width:18px;height:18px}
.mon b{font-size:17px;min-width:120px;text-align:center}
.body{flex:1;overflow-y:auto;padding:0 16px 24px}
.sum{padding:16px;border-radius:16px;background:#F8FAFC;margin-bottom:12px}
.sum span{display:block;font-size:13px;line-height:18px;color:var(--muted)}.sum strong{display:block;font-size:28px;line-height:36px;margin-top:2px}
.sum p{margin:6px 0 0;font-size:13px;line-height:18px;color:#047857}
.donut{position:relative;width:200px;height:200px;margin:8px auto 12px}
.donut svg{display:block;width:200px;height:200px;transform:rotate(-90deg)}
.donut .c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.donut .c b{font-size:22px;line-height:28px}.donut .c span{font-size:12px;line-height:16px;color:var(--muted)}
.cat{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line)}
.cat i{flex:none;width:10px;height:10px;border-radius:5px}
.cat .n{flex:none;width:44px;font-size:14px;line-height:20px}
.cat .bar{flex:1;height:6px;border-radius:3px;background:#EEF0F3;position:relative}.cat .bar s{position:absolute;left:0;top:0;bottom:0;border-radius:3px}
.cat .amt{flex:none;width:84px;text-align:right;font-size:14px;line-height:20px;font-weight:600;white-space:nowrap}
.cat .pct{flex:none;width:34px;text-align:right;font-size:12px;line-height:16px;color:var(--muted)}
.body h2{margin:20px 0 6px;font-size:16px}
.tx{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.tx .ic{flex:none;width:36px;height:36px;border-radius:18px;background:#EEF2FF;color:#3730A3;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center}
.tx .tt{flex:1;min-width:0}.tx b{display:block;font-size:14px;line-height:20px;font-weight:600}.tx span{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.tx .m{flex:none;font-size:14px;line-height:20px;font-weight:600}
"""
CATS = [("식비", 32, "411,000원", "#F97316"), ("교통", 18, "231,000원", "#0EA5E9"), ("쇼핑", 22, "282,600원", "#A855F7"), ("주거", 20, "256,900원", "#22C55E"), ("기타", 8, "103,000원", "#94A3B8")]
C = 502.65


def donut():
    out = []; start = 0.0
    for _, p, _, col in CATS:
        ln = C * p / 100
        out.append(f'<circle cx="100" cy="100" r="80" fill="none" stroke="{col}" stroke-width="24" stroke-dasharray="{ln:.2f} {C:.2f}" stroke-dashoffset="{-start:.2f}"/>')
        start += ln
    return f'<svg viewBox="0 0 200 200" aria-hidden="true">{"".join(out)}</svg>'


TXS = [("스", "스타벅스 망원점", "10월 9일 · 카드", "-6,500원"), ("G", "GS25 망원한강공원 리버뷰점 (24시 편의점)", "10월 9일 · 카드", "-12,300원"), ("교", "서울교통공사", "10월 8일 · 교통카드", "-1,550원"), ("월", "월세 이체", "10월 5일 · 계좌", "-650,000원")]
BG_OK = f"""<div class="top"><span class="ttl">가계부</span></div>
<div class="mon"><button aria-label="이전 달">{ic('back')}</button><b>2026년 10월</b><button aria-label="다음 달">{ic('next')}</button></div>
<div class="body"><div class="sum"><span>이번 달 지출</span><strong>1,284,500원</strong><p>지난달보다 82,000원 적게 썼어요</p></div>
<div class="donut">{donut()}<div class="c"><b>식비 32%</b><span>가장 많이 쓴 곳</span></div></div>
{"".join(f'<div class="cat"><i style="background:{col}"></i><span class="n">{n}</span><div class="bar"><s style="width:{p * 3}%;background:{col}"></s></div><span class="amt">{a}</span><span class="pct">{p}%</span></div>' for n, p, a, col in CATS)}
<h2>최근 내역</h2>{"".join(f'<div class="tx"><span class="ic">{i}</span><div class="tt"><b>{t}</b><span>{s}</span></div><span class="m">{m}</span></div>' for i, t, s, m in TXS)}</div>"""

# ── 3. 배달 추적 ─────────────────────────────────────────
TR_PAL = {"bg": "#FFFFFF", "page": "#EEF0F2", "text": "#14171A", "muted": "#5B636D", "line": "#E3E6EA", "brand": "#C2410C"}
TR_CSS = """
.map{position:relative;flex:none;height:38%}
.map img{display:block;width:100%;height:100%;object-fit:cover}
.map .back{position:absolute;left:12px;top:calc(10px + env(safe-area-inset-top,0px));width:40px;height:40px;border-radius:20px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.2)}.map .back svg{width:20px;height:20px}
.map .eta{position:absolute;right:12px;bottom:12px;font-size:13px;line-height:18px;font-weight:700;padding:6px 10px;border-radius:10px;background:rgba(255,255,255,.94);color:var(--text)}
.panel{flex:1;overflow-y:auto;padding:16px 20px 96px}
.panel h1{margin:0;font-size:22px;line-height:30px;font-weight:800}.panel .sub{margin:2px 0 0;font-size:13px;line-height:18px;color:var(--muted)}
.steps{position:relative;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:20px 0 8px}
.steps .ln{position:absolute;left:12.5%;right:12.5%;top:9px;height:3px;background:#E5E7EB}.steps .ln i{position:absolute;left:0;top:0;bottom:0;width:66%;background:var(--brand)}
.steps .s{position:relative;text-align:center}
.steps .s em{display:block;width:20px;height:20px;margin:0 auto;border-radius:10px;background:#E5E7EB;border:3px solid #fff}.steps .s.on em{background:var(--brand)}
.steps .s span{display:block;margin-top:6px;font-size:12px;line-height:16px;color:var(--muted)}.steps .s.on span{color:var(--text);font-weight:700}
.rider{display:flex;align-items:center;gap:12px;margin-top:16px;padding:12px;border:1px solid var(--line);border-radius:14px}
.rider img{width:44px;height:44px;border-radius:22px;flex:none}.rider .w{flex:1;min-width:0}.rider b{display:block;font-size:15px;line-height:20px}.rider span{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.rider button{width:44px;height:44px;border-radius:22px;border:1px solid var(--line);background:#fff;display:flex;align-items:center;justify-content:center;flex:none}.rider button svg{width:20px;height:20px}
.items{margin-top:16px;padding:12px 14px;border-radius:14px;background:#F8FAFC}
.items h2{margin:0 0 6px;font-size:14px;line-height:20px}.items ul{list-style:none;margin:0;padding:0}.items li{display:flex;justify-content:space-between;font-size:13px;line-height:20px;padding:4px 0}
.cancel{display:block;margin:16px auto 0;height:44px;padding:0 16px;background:transparent;color:var(--muted);font-size:14px;text-decoration:underline}
.foot{position:absolute;left:0;right:0;bottom:0;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));background:#fff;border-top:1px solid var(--line)}
.foot button{display:block;width:100%;height:48px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700}
"""
TR_OK = f"""<div class="map"><img src="map.png" alt="배달 경로 지도"><button class="back" aria-label="뒤로">{ic('back')}</button><span class="eta">도착 예정 12:40</span></div>
<div class="panel"><h1>약 18분 후 도착해요</h1><p class="sub">가게에서 출발했어요 · 2.4km 남음</p>
<div class="steps"><div class="ln"><i></i></div><div class="s on"><em></em><span>주문 접수</span></div><div class="s on"><em></em><span>조리 중</span></div><div class="s on"><em></em><span>배달 중</span></div><div class="s"><em></em><span>도착</span></div></div>
<div class="rider"><img src="rider.png" alt="배달원 사진"><div class="w"><b>김라이더</b><span>오토바이 · 서울12가 3456</span></div><button aria-label="채팅">{ic('chat')}</button><button aria-label="전화">{ic('phone')}</button></div>
<div class="items"><h2>주문 내역 (3개)</h2><ul><li><span>마르게리타 피자 L</span><span>21,900원</span></li><li><span>콜라 1.25L</span><span>2,500원</span></li><li><span>갈릭 디핑 소스</span><span>500원</span></li></ul></div>
<button class="cancel">주문 취소</button></div>
<div class="foot"><button>주문 상세 보기</button></div>"""

# ── 4. 복약 알림 ─────────────────────────────────────────
MD_PAL = {"bg": "#FFFFFF", "page": "#EFF1F4", "text": "#141820", "muted": "#5A6170", "line": "#E3E6EB", "brand": "#7C3AED"}
MD_CSS = """
.top .add{display:flex;align-items:center;gap:4px;height:40px;padding:0 12px;border-radius:10px;background:#F5F3FF;color:#5B21B6;font-size:14px;font-weight:700;flex:none}.top .add svg{width:16px;height:16px}
.days{flex:none;display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--line)}
.days button{width:40px;height:52px;border-radius:12px;background:transparent;font-size:12px;line-height:16px;color:var(--muted);display:flex;flex-direction:column;align-items:center;justify-content:center}
.days button b{font-size:15px;line-height:20px;color:var(--text)}.days .on{background:var(--brand);color:#fff}.days .on b{color:#fff}
.body{flex:1;overflow-y:auto;padding:12px 16px 24px}
.note{display:flex;gap:10px;padding:12px;border-radius:12px;background:#FEF3C7;color:#78350F;font-size:13px;line-height:19px;margin-bottom:12px}.note svg{flex:none;width:18px;height:18px}
.md{display:flex;gap:12px;padding:14px;border:1px solid var(--line);border-radius:14px;margin-bottom:10px}
.md img{flex:none;width:44px;height:44px;border-radius:12px;object-fit:cover}
.md .w{flex:1;min-width:0}.md .nm{margin:0;font-size:16px;line-height:22px;font-weight:700}.md .ds{margin:2px 0 8px;font-size:13px;line-height:18px;color:var(--muted)}
.tm{display:flex;flex-wrap:wrap;gap:6px}.tm span{font-size:12px;line-height:16px;padding:4px 10px;border-radius:12px;background:#F3F4F6;color:var(--text)}.tm .done{background:#EDE9FE;color:#5B21B6;font-weight:700}
.md [role=switch]{flex:none;width:44px;height:26px;border-radius:13px;background:var(--brand);position:relative;align-self:flex-start}
.md [role=switch]::after{content:"";position:absolute;right:3px;top:3px;width:20px;height:20px;border-radius:10px;background:#fff}
.md [role=switch][aria-checked=false]{background:#CBD5E1}.md [role=switch][aria-checked=false]::after{right:auto;left:3px}
"""
DAYS = [("월", 13), ("화", 14), ("수", 15), ("목", 16), ("금", 17), ("토", 18), ("일", 19)]


def md(i, name, dose, times, on=True):
    return f'<div class="md"><img src="pill{i}.png" alt="{name.split("(")[0].strip()} 사진"><div class="w"><p class="nm">{name}</p><p class="ds">{dose}</p><div class="tm">{"".join(f"<span class=done>{t} 복용</span>" if d else f"<span>{t}</span>" for t, d in times)}</div></div><button role="switch" aria-checked="{"true" if on else "false"}" aria-label="{name.split("(")[0].strip()} 알림"></button></div>'


MD_OK = f"""<div class="top"><span class="ttl">복약 알림</span><button class="add">{ic('plus', '#5B21B6')}약 추가</button></div>
<div class="days">{"".join(f'<button{" class=on" if d == "수" else ""}>{d}<b>{n}</b></button>' for d, n in DAYS)}</div>
<div class="body"><div class="note">{ic('info', '#78350F')}<span>식후 30분 안에 먹는 약은 알림이 식사 기록 뒤에 울려요. 약을 거르면 다음 알림에서 알려 드려요.</span></div>
{md(1, '오메가3 1000mg', '1캡슐 · 아침 식후', [('08:00', True), ('20:00', False)])}{md(2, '비타민D 2000IU (주 1회, 일요일 아침)', '1정 · 아침 식후', [('08:00', False)])}{md(3, '유산균', '1포 · 공복', [('07:30', True)], on=False)}{md(4, '혈압약 암로디핀 5mg (저녁 식후 30분)', '1정 · 저녁 식후', [('19:00', False)])}</div>"""

# ── 5. 배송지 입력 ───────────────────────────────────────
AD_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#15181D", "muted": "#5A616C", "line": "#D9DEE5", "brand": "#1D4ED8"}
AD_CSS = """
.form{flex:1;overflow-y:auto;padding:16px 20px 100px;display:flex;flex-direction:column;gap:16px}
.f label{display:block;font-size:14px;line-height:20px;font-weight:600;margin-bottom:6px}
.f .req{color:#B91C1C;margin-left:2px}
.f input,.f select{display:block;width:100%;height:48px;border:1px solid var(--line);border-radius:10px;padding:0 14px;font-size:15px;font-family:inherit;background:#fff;color:var(--text)}
.f input::placeholder{color:#6B7280}
.f .row{display:flex;gap:8px}.f .row input{flex:1;min-width:0}
.f .row button{flex:none;height:48px;padding:0 14px;border-radius:10px;border:1px solid var(--brand);background:#fff;color:var(--brand);font-size:14px;font-weight:700;white-space:nowrap}
.f .box{position:relative}.f .box input{padding-right:44px}
.f .clear{position:absolute;right:4px;top:4px;width:40px;height:40px;border-radius:20px;background:transparent;display:flex;align-items:center;justify-content:center}.f .clear svg{width:16px;height:16px}
.f .err{margin:6px 0 0;font-size:13px;line-height:18px;color:#B91C1C}
.f .help{margin:6px 0 0;font-size:13px;line-height:18px;color:var(--muted)}
.chk{display:flex;align-items:center;gap:10px;min-height:44px;font-size:15px}.chk input{width:22px;height:22px;margin:0;accent-color:var(--brand)}
.save{position:absolute;left:0;right:0;bottom:0;padding:12px 16px;background:#fff;border-top:1px solid var(--line)}
.save button{display:block;width:100%;height:52px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700}
"""
AD_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{ic('back')}</button><span class="ttl">배송지 입력</span></div>
<div class="form">
<div class="f"><label for="nm">받는 분<span class="req">*</span></label><div class="box"><input id="nm" value="김하늘"><button class="clear" aria-label="이름 지우기">{ic('x', '#6B7280')}</button></div></div>
<div class="f"><label for="ph">연락처<span class="req">*</span></label><div class="row"><input id="ph" placeholder="010-0000-0000" value="010-1234-56"><button>인증번호 받기</button></div><p class="err">휴대폰 번호 형식이 맞지 않아요. 010으로 시작하는 11자리 숫자를 넣어 주세요.</p></div>
<div class="f"><label for="ad">주소<span class="req">*</span></label><div class="row"><input id="ad" value="서울 마포구 망원로 12길 34" readonly><button>주소 찾기</button></div></div>
<div class="f"><label for="ad2">상세 주소</label><input id="ad2" placeholder="동, 호수까지 적어 주세요"></div>
<div class="f"><label for="rq">배송 요청사항</label><select id="rq"><option>문 앞에 놓아 주세요</option><option>경비실에 맡겨 주세요</option><option>직접 받을게요</option></select></div>
<div class="f"><label for="pw">공동현관 비밀번호</label><input id="pw" placeholder="예: #1234*"><p class="help">배송 기사님께만 보여요. 저장한 비밀번호는 30일 뒤에 지워져요.</p></div>
<label class="chk"><input type="checkbox" checked>기본 배송지로 저장</label></div>
<div class="save"><button>저장하기</button></div>"""

# ── 6. 데스크톱 주간 일정 ────────────────────────────────
CA_PAL = {"bg": "#FFFFFF", "page": "#F1F3F6", "text": "#14171C", "muted": "#5B6370", "line": "#E3E6EA", "brand": "#2563EB"}
CA_CSS = """
.app{max-width:none}
.hd{flex:none;display:flex;align-items:center;gap:10px;height:60px;padding:0 20px;border-bottom:1px solid var(--line)}
.hd h1{margin:0 8px 0 0;font-size:18px;line-height:24px;white-space:nowrap}
.hd .nav{width:36px;height:36px;border-radius:10px;border:1px solid var(--line);background:#fff;display:flex;align-items:center;justify-content:center;flex:none}.hd .nav svg{width:16px;height:16px}
.hd .today{height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:#fff;font-size:14px;flex:none}
.hd .sp{flex:1}
.hd input{flex:0 1 200px;min-width:0;height:36px;border:1px solid var(--line);border-radius:10px;padding:0 12px;font-size:14px;font-family:inherit}
.seg{display:flex;padding:3px;border-radius:10px;background:#F1F3F5;flex:none}.seg button{height:30px;padding:0 12px;border-radius:8px;background:transparent;font-size:13px;color:var(--muted)}.seg .on{background:#fff;color:var(--text);font-weight:700}
.hd .new{height:36px;padding:0 14px;border-radius:10px;background:var(--brand);color:#fff;font-size:14px;font-weight:700;white-space:nowrap;flex:none}
.cal{flex:1;overflow:auto;display:grid;grid-template-columns:56px repeat(5,minmax(0,1fr));grid-template-rows:52px 540px}
.dh{position:sticky;top:0;z-index:2;background:#fff;border-bottom:1px solid var(--line);display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:12px;line-height:16px;color:var(--muted)}.dh b{font-size:18px;line-height:22px;color:var(--text)}
.tc{position:relative;border-right:1px solid var(--line)}
.tc span{position:absolute;right:8px;font-size:11px;line-height:14px;color:var(--muted);transform:translateY(-7px)}
.day{position:relative;border-right:1px solid var(--line);background:repeating-linear-gradient(#fff 0 59px,#EEF0F3 59px 60px)}
.ev{position:absolute;left:4px;right:4px;border-radius:8px;padding:4px 8px;overflow:hidden;font-size:12px;line-height:16px;border-left:3px solid}
.ev b{display:block;font-size:13px;line-height:17px}.ev span{display:block}
.ev.short span{display:none}
.ev.a{background:#EFF6FF;color:#1E3A8A;border-color:#2563EB}.ev.b{background:#ECFDF5;color:#065F46;border-color:#10B981}.ev.c{background:#FEF3C7;color:#78350F;border-color:#F59E0B}.ev.d{background:#F5F3FF;color:#4C1D95;border-color:#7C3AED}
.ev.half{right:auto;width:calc(50% - 6px)}.ev.half2{left:calc(50% + 2px)}
.ev.past{opacity:.85}
"""
DAYS5 = [("월", 13), ("화", 14), ("수", 15), ("목", 16), ("금", 17)]


def ev(cls, title, start, end, where):
    sh, sm = map(int, start.split(":")); eh, em = map(int, end.split(":"))
    top = (sh - 9) * 60 + sm; h = (eh - 9) * 60 + em - top
    return f'<div class="ev {cls}" style="top:{top}px;height:{h}px"><b>{title}</b><span>{start}–{end} · {where}</span></div>'


EVS = {
    "월": [ev("a past", "주간 회의", "10:00", "11:00", "회의실 A"), ev("d past", "디자인 리뷰", "14:00", "15:30", "온라인")],
    "화": [ev("b half", "1:1 면담", "10:00", "11:00", "회의실 B"), ev("c half half2", "고객 인터뷰", "10:30", "12:00", "카페")],
    "수": [ev("c", "점심 약속", "12:00", "13:00", "망원동"), ev("a", "스프린트 계획", "15:00", "17:00", "회의실 A")],
    "목": [ev("b", "채용 면접", "11:00", "12:00", "회의실 C"), ev("d short", "짧은 확인", "16:00", "16:30", "메신저")],
    "금": [ev("b", "배포", "10:00", "11:00", "온라인"), ev("a", "회고", "16:00", "17:00", "회의실 A")],
}
CA_OK = f"""<header class="hd"><h1>2026년 10월 2주차</h1><button class="nav" aria-label="이전 주">{ic('back')}</button><button class="nav" aria-label="다음 주">{ic('next')}</button><button class="today">오늘</button><div class="sp"></div><input placeholder="일정 검색"><div class="seg"><button>일</button><button class="on">주</button><button>월</button></div><button class="new">새 일정</button></header>
<main class="cal"><div class="dh"></div>{"".join(f'<div class="dh">{d}<b>{n}</b></div>' for d, n in DAYS5)}
<div class="tc">{"".join(f'<span style="top:{(h - 9) * 60}px">{h:02d}:00</span>' for h in range(10, 18))}</div>{"".join(f'<div class="day">{"".join(EVS[d])}</div>' for d, _ in DAYS5)}</main>"""

SCREENS = {
    "flight": ("항공편 검색", FL_PAL, FL_CSS, FL_OK, M5),
    "budget": ("가계부", BG_PAL, BG_CSS, BG_OK, M5),
    "tracking": ("배달 추적", TR_PAL, TR_CSS, TR_OK, M5),
    "meds": ("복약 알림", MD_PAL, MD_CSS, MD_OK, M5),
    "address": ("배송지 입력", AD_PAL, AD_CSS, AD_OK, M5),
    "calendar": ("주간 일정", CA_PAL, CA_CSS, CA_OK, W4),
}

# (화면, 변형, 유형, 설명, 추가 CSS, 마크업 바꾸기[(앞, 뒤) 또는 (앞, 뒤, 'all')], 확인 크기, 정답 측정, 글자 힌트)
# 유형: R1~R7·A1·A2·D4는 dqa에 규칙이 있는 종류. D2(색 토큰)·D3(글자 굵기)·S4(선택 상태)·F1(크기 방식)·L1(정렬)은 규칙 밖
V = [
    ("flight", "r3-left", "R3", "'잔여 좌석' 안내를 카드 오른쪽 위 절대 위치로 옮겨 가격 글자 위에 얹힘", ".fl .left{position:absolute;right:14px;top:12px;margin:0}", [], M5, {"type": "overlap_text", "sel": ".fl .left", "other": ".fl .price"}, ["잔여 3석", "잔여 5석", "68,900원", "81,000원"]),
    ("flight", "r1-dur", "R1", "소요 시간 칸이 줄어들지 않게 하고 줄바꿈을 막아 도착 시각이 카드 밖으로 밀림", ".fl .dur{flex:none;white-space:nowrap}", [], M5, {"type": "overflow", "sel": ".fl .row"}, ["08:15", "10:40", "13:25", "19:50", "CJU", "1시간 10분"]),
    ("flight", "a2-code", "A2", "공항 코드 글자를 #A0A7B1로 옅게 함", ".fl .t span{color:#A0A7B1}", [], M5, {"type": "contrast", "sel": ".fl .t span", "min": 4.5}, ["GMP", "CJU"]),
    ("flight", "d4-logo", "D4", "가로로 긴 항공사 로고를 아이콘 칸(24×24)에 object-fit 없이 넣어 찌그러짐", ".fl .air img{width:24px;height:24px;object-fit:fill}", [], M5, {"type": "img_ratio", "sel": ".fl .air img"}, ["하늘항공 로고", "바다항공 로고", "구름항공 로고"]),
    ("flight", "r4-sort", "R4", "목록 아래 여백을 8px로 줄여 끝까지 내려도 마지막 항공편이 정렬 막대에 가려짐", ".list{padding-bottom:8px}", [], M5, {"type": "covered", "sel": ".list > .fl:last-child .t.r", "scroll": ".list"}, ["19:50", "CJU", "18:40", "GMP"]),
    ("flight", "d2-price", "D2", "가격 색을 토큰(#BE123C) 대신 비슷한 #E11D48로 직접 씀", ".fl .air .price{color:#E11D48}", [], ["375x812"], {"type": "style", "sel": ".fl .air .price", "prop": "color", "value": "rgb(190, 18, 60)"}, []),
    ("budget", "r6-amt", "R6", "금액 칸을 48px로 줄이고 글자 끊기를 허용해 '411,000원'이 꺾임", ".cat .amt{width:48px;white-space:normal;word-break:break-all}", [], M5, {"type": "lines", "sel": ".cat .amt"}, ["411,000원", "231,000원", "282,600원", "256,900원", "103,000원"]),
    ("budget", "r3-center", "R3", "도넛 가운데 글자를 40px로 키워 글자가 링 위로 넘어감", ".donut .c b{font-size:40px;line-height:46px}", [], M5, {"type": "text_in_circle", "sel": ".donut .c b", "circle": ".donut svg", "r": 68}, ["식비 32%"]),
    ("budget", "a2-sub", "A2", "지난달 비교 문구를 밝은 초록(#34D399)으로 바꿈", ".sum p{color:#34D399}", [], M5, {"type": "contrast", "sel": ".sum p", "min": 4.5}, ["지난달보다"]),
    ("budget", "r1-tx", "R1", "내역 이름 칸이 줄어들지 않게 하고 줄바꿈을 막아 긴 가게 이름이 금액을 화면 밖으로 밀어냄", ".tx .tt{flex:none}.tx b{white-space:nowrap}", [], M5, {"type": "overflow", "sel": ".tx"}, ["GS25 망원한강공원", "-12,300원"]),
    ("budget", "a1-mon", "A1", "이전·다음 달 버튼을 20px로 줄임", ".mon button{width:20px;height:20px}.mon button svg{width:12px;height:12px}", [], M5, {"type": "target", "sel": ".mon button", "min": 24}, ["이전 달", "다음 달"]),
    ("budget", "d2-dot", "D2", "범례의 식비 점 색을 도넛 색(#F97316)과 다른 #F59E0B로 씀", ".donut + .cat i{background:#F59E0B !important}", [], ["375x812"], {"type": "style", "sel": ".cat i", "prop": "background-color", "value": "rgb(249, 115, 22)"}, []),
    ("tracking", "r3-steps", "R3", "단계 이름을 동그라미 옆에 두려고 절대 위치로 올렸다가 단계 선 위에 겹침", ".steps .s span{position:absolute;left:0;right:0;top:2px;margin:0}", [], M5, {"type": "overlap_text", "sel": ".steps .s span", "other": ".steps .ln"}, ["주문 접수", "조리 중", "배달 중", "도착"]),
    ("tracking", "r4-panel", "R4", "아래 패널의 스크롤을 넘침 숨김으로 바꿔 작은 화면에서 '주문 취소'에 닿을 수 없음", ".panel{overflow:hidden}", [], M5, {"type": "offscreen", "sel": ".cancel"}, ["주문 취소"]),
    ("tracking", "a1-chat", "A1", "채팅 버튼을 22px로 줄임", ".rider button:first-of-type{width:22px;height:22px}", [], M5, {"type": "target", "sel": ".rider button", "min": 24}, ["채팅"]),
    ("tracking", "a2-eta", "A2", "지도 위 도착 예정 칩의 배경을 반투명(55%)으로 하고 글자를 #8A94A3로 옅게 함", ".map .eta{background:rgba(255,255,255,.55);color:#8A94A3}", [], M5, {"type": "contrast_img", "sel": ".map .eta", "img": ".map img", "min": 4.5}, ["도착 예정"]),
    ("tracking", "r2-items", "R2", "주문 내역 목록 높이를 48px로 고정하고 넘침을 숨겨 세 번째 항목이 잘림", ".items ul{height:48px;overflow:hidden}", [], M5, {"type": "clipped_parent", "sel": ".items li"}, ["갈릭 디핑 소스", "500원"]),
    ("tracking", "d3-h1", "D3", "도착 안내 제목 굵기를 시안 800 대신 500으로 씀", ".panel h1{font-weight:500}", [], ["375x812"], {"type": "style", "sel": ".panel h1", "prop": "font-weight", "value": "800"}, []),
    ("meds", "a1-switch", "A1", "알림 스위치를 28×16px로 줄임", ".md [role=switch]{width:28px;height:16px}.md [role=switch]::after{width:12px;height:12px;top:2px;right:2px}", [], M5, {"type": "target", "sel": ".md [role=switch]", "min": 24}, ["알림"]),
    ("meds", "r3-lines", "R3", "약 이름 줄 높이를 10px로 잘못 넣어 두 줄로 감긴 이름의 줄끼리 겹침", ".md .nm{line-height:10px}", [], M5, {"type": "line_overlap", "sel": ".md .nm"}, ["비타민D", "혈압약", "암로디핀"]),
    ("meds", "r2-note", "R2", "안내 상자 높이를 38px로 고정하고 넘침을 숨겨 두 번째 줄이 잘림", ".note{height:38px;overflow:hidden}", [], M5, {"type": "clipped_parent", "sel": ".note span"}, ["식후 30분"]),
    ("meds", "a2-time", "A2", "아직 안 먹은 시간 칩 글자를 #A3AAB5로 옅게 함", ".tm span{color:#A3AAB5}", [], M5, {"type": "contrast", "sel": ".tm span:not(.done)", "min": 4.5}, ["20:00", "08:00", "19:00"]),
    ("meds", "d4-pill", "D4", "약 사진 확장자를 잘못 적어(.webp) 첫 약 사진이 깨짐", "", [('src="pill1.png"', 'src="pill1.webp"')], M5, {"type": "img_broken", "sel": ".md img"}, ["오메가3"]),
    ("meds", "s4-done", "S4", "먹은 시간 칩의 완료 표시(배경·굵기)를 빼 먹었는지 안 보임", ".tm .done{background:#F3F4F6;color:var(--text);font-weight:400}", [], ["375x812"], {"type": "style", "sel": ".tm .done", "prop": "background-color", "value": "rgb(237, 233, 254)"}, []),
    ("address", "r1-phone", "R1", "입력칸 폭을 시안 값 240px로 고정해 '인증번호 받기'·'주소 찾기' 버튼이 화면 밖으로 밀림", ".f .row input{flex:none;width:240px}", [], M5, {"type": "overflow", "sel": ".f .row"}, ["인증번호 받기", "주소 찾기", "010-0000-0000"]),
    ("address", "a2-ph", "A2", "입력칸 안내 글자(placeholder)를 #C4C9D0로 옅게 함", ".f input::placeholder{color:#C4C9D0}", [], M5, {"type": "contrast_placeholder", "sel": ".f input", "min": 4.5}, ["동, 호수", "예: #1234"]),
    ("address", "r4-save", "R4", "폼 아래 여백을 16px로 줄여 끝까지 내려도 '기본 배송지로 저장'이 저장 버튼 막대에 가려짐", ".form{padding-bottom:16px}", [], M5, {"type": "covered", "sel": ".chk", "scroll": ".form"}, ["기본 배송지로 저장"]),
    ("address", "a1-clear", "A1", "이름 지우기 버튼을 16px로 줄임", ".f .clear{width:16px;height:16px;top:16px;right:12px}", [], M5, {"type": "target", "sel": ".f .clear", "min": 24}, ["이름 지우기"]),
    ("address", "r2-err", "R2", "오류 문구 높이를 한 줄(18px)로 고정하고 넘침을 숨겨 두 번째 줄이 잘림", ".f .err{height:18px;overflow:hidden}", [], M5, {"type": "clipped_text", "sel": ".f .err"}, ["휴대폰 번호 형식"]),
    ("address", "f1-save", "F1", "저장 버튼을 시안의 Fill 대신 고정 240px로 씀", ".save button{width:240px;margin:0 auto}", [], ["375x812"], {"type": "fill_width", "sel": ".save button"}, []),
    ("calendar", "r3-ev", "R3", "같은 시간에 겹친 일정을 반으로 나누지 않아 두 일정이 서로 덮음", ".ev.half{right:4px;width:auto}.ev.half2{left:4px}", [], W4, {"type": "overlap_text", "sel": ".ev.half span", "other": ".ev.half2"}, ["1:1 면담", "고객 인터뷰"]),
    ("calendar", "r2-short", "R2", "30분짜리 일정에도 시간 줄을 보여 높이 30px 칸에서 시간 글자가 잘림", ".ev.short span{display:block}", [], W4, {"type": "clipped_parent", "sel": ".ev.short span"}, ["16:00–16:30", "짧은 확인"]),
    ("calendar", "a2-past", "A2", "지난 일정을 투명도 40%로 흐리게 해 글자가 안 읽힘", ".ev.past{opacity:.4}", [], W4, {"type": "contrast_opacity", "sel": ".ev.past b", "min": 4.5}, ["주간 회의", "디자인 리뷰"]),
    ("calendar", "r1-hd", "R1", "검색칸을 280px로 고정해 좁은 창에서 머리글이 넘침", ".hd input{flex:none;width:280px}", [], W4, {"type": "overflow", "sel": ".hd"}, ["새 일정", "일정 검색"]),
    ("calendar", "a1-nav", "A1", "이전·다음 주 버튼을 20px로 줄임", ".hd .nav{width:20px;height:20px}.hd .nav svg{width:12px;height:12px}", [], W4, {"type": "target", "sel": ".hd .nav", "min": 24}, ["이전 주", "다음 주"]),
    ("calendar", "l1-time", "L1", "시간 라벨의 위치 보정(-7px)을 빼 라벨이 격자선보다 아래로 내려감", ".tc span{transform:none}", [], ["1280x800"], {"type": "style", "sel": ".tc span", "prop": "transform", "value": "matrix(1, 0, 0, 1, 0, -7)"}, []),
]


def images(d, screen):
    def img(name, w, h, c1, c2, kind, text=None):
        im = Image.new("RGB", (w, h), c1); dr = ImageDraw.Draw(im)
        if kind == "logo":
            dr.rounded_rectangle([0, 0, w - 1, h - 1], radius=h // 4, fill=c2); dr.ellipse([h * 0.2, h * 0.2, h * 0.8, h * 0.8], fill="#FFFFFF")
        elif kind == "map":
            for x in range(0, w, 50): dr.line([x, 0, x, h], fill="#D7DDE4", width=3)
            for y in range(0, h, 50): dr.line([0, y, w, y], fill="#D7DDE4", width=3)
            dr.line([w * 0.2, h * 0.8, w * 0.45, h * 0.5, w * 0.8, h * 0.3], fill=c2, width=10)
            dr.ellipse([w * 0.78, h * 0.27, w * 0.84, h * 0.27 + w * 0.06], fill=c2)
        elif kind == "pill":
            dr.rounded_rectangle([w * 0.2, h * 0.35, w * 0.8, h * 0.65], radius=h // 6, fill=c2)
        else:
            dr.ellipse([w * 0.15, h * 0.15, w * 0.85, h * 0.85], fill=c2)
        im.save(d / name)
    if screen == "flight":
        for i, c in enumerate(["#1D4ED8", "#0E7490", "#7C3AED"], 1): img(f"logo{i}.png", 120, 40, "#FFFFFF", c, "logo")
    if screen == "tracking": img("map.png", 800, 500, "#EEF2EE", "#C2410C", "map"); img("rider.png", 88, 88, "#FFEDD5", "#C2410C", "dot")
    if screen == "meds":
        for i, (a, b) in enumerate([("#FEF3C7", "#D97706"), ("#E0F2FE", "#0284C7"), ("#DCFCE7", "#16A34A"), ("#FCE7F3", "#DB2777")], 1): img(f"pill{i}.png", 88, 88, a, b, "pill")


def rules_sha1():
    """고정 기준: dqa 측정 규칙 파일(inpage.js·cluster.js)의 내용 해시"""
    import hashlib
    root = Path(__file__).resolve().parents[2] / "dqa" / "measure"
    h = hashlib.sha1()
    for f in ("inpage.js", "cluster.js"): h.update((root / f).read_bytes())
    return h.hexdigest()


def main():
    cases = []
    for scr, (title, pal, css, ok, sizes) in SCREENS.items():
        d = OUT / scr / "ok"; d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(f"{title} · ok", pal, css, ok)); images(d, scr)
        cases.append({"id": f"blind4-{scr}-ok", "screen": scr, "variant": "ok", "code": None, "defect": "맞게 만든 구현", "dir": f"eval/synth/blind4/screens/{scr}/ok", "sizes": sizes, "check": None, "hint": []})
    for scr, var, code, desc, extra, subs, sizes, check, hint in V:
        title, pal, css, ok, _ = SCREENS[scr]
        html = ok
        for sub in subs:
            a, b = sub[0], sub[1]
            if len(sub) > 2 and sub[2] == "all":
                assert html.count(a) >= 1, (scr, var, a); html = html.replace(a, b)
            else:
                assert html.count(a) == 1, (scr, var, a); html = html.replace(a, b)
        d = OUT / scr / var; d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(f"{title} · {var}", pal, css + extra, html)); images(d, scr)
        cases.append({"id": f"blind4-{scr}-{var}", "screen": scr, "variant": var, "code": code, "defect": desc, "dir": f"eval/synth/blind4/screens/{scr}/{var}", "sizes": sizes, "check": check, "hint": hint})
    (HERE / "cases.json").write_text(json.dumps({"note": "블라인드 합성 예제 4묶음(10-10). 블라인드 3의 빈틈을 고친 규칙을 고정하고 한 번만 잰다. 규칙 밖 유형: D2 색 토큰(2), D3 글자 굵기, S4 선택 상태, F1 크기 방식, L1 정렬. 채점은 R3를 짝 기준으로 본다(상대 쪽 라벨도 힌트로 인정).", "frozen_rules_sha1": rules_sha1(), "cases": cases}, ensure_ascii=False, indent=1) + "\n")
    print(f"화면 {len(SCREENS)}개, 결함 {len(V)}개, 유형 {sorted({v[2] for v in V})}, 규칙 해시 {rules_sha1()[:10]}")


if __name__ == "__main__":
    main()
