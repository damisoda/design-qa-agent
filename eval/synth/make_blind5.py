"""블라인드 합성 예제 5묶음(10-10). 블라인드 4에서 드러난 빈틈을 고친 뒤의 일반화를 잰다.
dqa 규칙 파일을 고정(cases.json의 frozen_rules_sha1)한 채, 앞선 30개 앱과 겹치지 않는 새 앱 6종에 결함을 하나씩 심는다. 한 번만 잰다.
결함은 바이브코딩에서 흔한 실수에서 골랐다. 규칙 밖 종류(색 토큰 2, 선택 상태 2, 정렬, 간격)도 섞는다.
맞게 만든 화면에도 실제 앱에서 흔한 구성(좌석 격자, 화면 막대, 글 속 링크가 섞인 본문, 대댓글 들여쓰기, 그라데이션 카드, SVG 다이얼, 차트 말풍선, 코드 블록 가로 스크롤, 도구 막대 가로 스크롤, 화면 폭에 따라 숨는 패널)을 넣어 오탐을 잰다.
화면: cinema(영화 좌석), community(커뮤니티 글), smarthome(스마트홈), stocks(주식), quiz(온라인 퀴즈), notes(데스크톱 노트)
사용: python3 eval/synth/make_blind5.py  → eval/synth/blind5/screens/<화면>/<변형>/index.html, eval/synth/blind5/cases.json
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw
from make_synth import page, M5, W4

HERE = Path(__file__).resolve().parent / "blind5"
OUT = HERE / "screens"


def ic(kind, color="#222222"):
    paths = {
        "back": '<path d="M15 5l-7 7 7 7"/>', "heart": '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
        "chat": '<path d="M4 5h16v11H9l-5 4z"/>', "share": '<path d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5"/>',
        "pause": '<path d="M9 6v12M15 6v12"/>', "bulb": '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5V16h8v-2.5A6 6 0 0 0 12 3z"/>',
        "fan": '<circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 1-7 4-7M14 12c4 0 7 1 7 4M12 14c0 4-1 7-4 7M10 12c-4 0-7-1-7-4"/>',
        "lock": '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
        "robot": '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h0M15 13h0"/>',
    }
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{paths[kind]}</svg>'


# ── 1. 영화 좌석 ─────────────────────────────────────────
CN_PAL = {"bg": "#FFFFFF", "page": "#ECEEF2", "text": "#121418", "muted": "#5C6370", "line": "#E3E6EA", "brand": "#DC2626"}
CN_CSS = """
.mv{flex:none;display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)}
.mv img{width:48px;height:68px;border-radius:6px;object-fit:cover;flex:none}
.mv b{display:block;font-size:16px;line-height:22px}.mv span{display:block;font-size:13px;line-height:18px;color:var(--muted)}
.hall{flex:1;overflow-y:auto;padding:16px 16px 120px}
.screen{height:6px;margin:0 24px 6px;border-radius:3px;background:#C7CCD4}
.scr{margin:0 0 16px;text-align:center;font-size:12px;line-height:16px;color:var(--muted)}
.seats{display:grid;grid-template-columns:14px repeat(8,minmax(0,1fr));gap:4px;align-items:center}
.seats .rw{font-size:11px;line-height:14px;color:var(--muted);text-align:center}
.seats button{aspect-ratio:1/1;min-width:24px;border-radius:6px;background:#E5E7EB;font-size:10px;line-height:12px;color:#4B5563}
.seats .sel{background:var(--brand);color:#fff}.seats .taken{background:#9CA3AF;color:#F3F4F6}
.legend{display:flex;justify-content:center;gap:16px;margin-top:16px;font-size:12px;line-height:16px;color:var(--muted)}
.legend span{display:flex;align-items:center;gap:6px}.legend i{width:14px;height:14px;border-radius:4px;background:#E5E7EB}.legend .s i{background:var(--brand)}.legend .t i{background:#9CA3AF}
.pay{position:absolute;left:0;right:0;bottom:0;padding:12px 16px;background:#fff;border-top:1px solid var(--line)}
.pay .sum{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px}
.pay .sum span{font-size:13px;line-height:18px;color:var(--muted)}.pay .sum b{font-size:18px;line-height:24px;white-space:nowrap}
.pay button{display:block;width:100%;height:48px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700}
"""
TAKEN = {"A1", "A2", "B5", "C3", "C4", "F7", "G1", "H8"}
SEL = {"E4", "E5"}


def seat_rows():
    out = []
    for r in "ABCDEFGH":
        out.append(f'<span class="rw">{r}</span>')
        for n in range(1, 9):
            k = f"{r}{n}"; cls = ' class="sel"' if k in SEL else ' class="taken" disabled' if k in TAKEN else ''
            out.append(f'<button{cls} aria-label="{r}열 {n}번">{n}</button>')
    return "".join(out)


CN_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{ic('back')}</button><span class="ttl">좌석 선택</span></div>
<div class="mv"><img src="poster.png" alt="영화 포스터"><div><b>한강의 밤</b><span>10월 18일(토) 19:30 · 3관 · 2D</span><span>15세 관람가 · 118분</span></div></div>
<div class="hall"><div class="screen"></div><p class="scr">SCREEN</p><div class="seats">{seat_rows()}</div>
<div class="legend"><span><i></i>선택 가능</span><span class="s"><i></i>선택한 좌석</span><span class="t"><i></i>예매 완료</span></div></div>
<div class="pay"><div class="sum"><span>선택한 좌석 E4, E5 · 성인 2</span><b>30,000원</b></div><button>결제하기</button></div>"""

# ── 2. 커뮤니티 글 ───────────────────────────────────────
CM_PAL = {"bg": "#FFFFFF", "page": "#EDEFF2", "text": "#131619", "muted": "#5D646E", "line": "#E4E7EB", "brand": "#2563EB"}
CM_CSS = """
.body{flex:1;overflow-y:auto;padding:0 0 84px}
.post{padding:16px}
.au{display:flex;align-items:center;gap:10px}.au img{width:40px;height:40px;border-radius:20px;flex:none}
.au .w{flex:1;min-width:0}.au b{display:block;font-size:15px;line-height:20px}.au span{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.au button{flex:none;height:32px;padding:0 12px;border-radius:16px;border:1px solid var(--line);background:#fff;font-size:13px;font-weight:600;color:var(--text)}
.post h1{margin:14px 0 6px;font-size:19px;line-height:27px}
.post .tx{margin:0;font-size:15px;line-height:24px}.post .tx a{color:#1D4ED8}
.pics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:12px}.pics img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px}
.acts{display:flex;align-items:center;gap:4px;margin-top:10px}.acts button{display:flex;align-items:center;gap:4px;height:40px;padding:0 10px;border-radius:20px;background:transparent;font-size:13px;color:var(--muted)}.acts button svg{width:18px;height:18px;flex:none}
.cmts{border-top:8px solid #F3F4F6;padding:8px 16px}
.cm{display:flex;gap:10px;padding:10px 0}.cm img{width:32px;height:32px;border-radius:16px;flex:none}
.cm .w{flex:1;min-width:0}.cm .h{display:flex;align-items:center;gap:6px}.cm .h b{font-size:13px;line-height:18px}
.cm .h em{font-style:normal;font-size:11px;line-height:14px;padding:1px 6px;border-radius:6px;background:#DBEAFE;color:#1E40AF}.cm .h span{font-size:12px;line-height:16px;color:var(--muted)}
.cm p{margin:2px 0 0;font-size:14px;line-height:21px}
.cm.re{padding-left:42px}
.reply{position:absolute;left:0;right:0;bottom:0;display:flex;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid var(--line)}
.reply input{flex:1;min-width:0;height:44px;border-radius:22px;border:1px solid var(--line);padding:0 16px;font-size:14px;font-family:inherit}
.reply button{flex:none;height:44px;padding:0 16px;border-radius:22px;background:var(--brand);color:#fff;font-size:14px;font-weight:700}
"""


def cm(av, name, time, text, re=False, author=False):
    return f'<div class="cm{" re" if re else ""}"><img src="a{av}.png" alt="{name} 사진"><div class="w"><div class="h"><b>{name}</b>{"<em>작성자</em>" if author else ""}<span>{time}</span></div><p>{text}</p></div></div>'


CM_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{ic('back')}</button><span class="ttl">동네생활</span></div>
<div class="body"><div class="post"><div class="au"><img src="a1.png" alt="작성자 사진"><div class="w"><b>망원동산책러</b><span>3시간 전 · 망원동</span></div><button>팔로우</button></div>
<h1>망원한강공원 노을 명당 정리해 봤어요</h1>
<p class="tx">주말마다 다니면서 찾은 노을 잘 보이는 자리 세 곳이에요. 자세한 위치는 <a href="#">지도 링크</a>에 모아 뒀어요. 해 지기 30분 전에 가면 자리 잡기 좋아요. 돗자리는 꼭 챙기세요.</p>
<div class="pics"><img src="p1.png" alt="노을 사진 1"><img src="p2.png" alt="노을 사진 2"></div>
<div class="acts"><button>{ic('heart', '#5D646E')}좋아요 128</button><button>{ic('chat', '#5D646E')}댓글 12</button><button aria-label="공유">{ic('share', '#5D646E')}</button></div></div>
<div class="cmts">{cm(2, '한강러버', '2시간 전', '두 번째 자리 진짜 좋아요! 지난주에 다녀왔어요.')}{cm(1, '망원동산책러', '1시간 전', '감사해요. 다음엔 일출 명당도 올릴게요.', re=True, author=True)}{cm(3, '자전거타는곰', '30분 전', '주차는 어디에 하셨나요?')}{cm(4, '노을수집가', '10분 전', '사진 색감이 너무 좋네요. 어떤 카메라 쓰세요?')}</div></div>
<div class="reply"><input placeholder="댓글을 남겨 주세요"><button>등록</button></div>"""

# ── 3. 스마트홈 ──────────────────────────────────────────
SH_PAL = {"bg": "#FFFFFF", "page": "#EEF1F4", "text": "#111827", "muted": "#5B6472", "line": "#E5E7EB", "brand": "#0F766E"}
SH_CSS = """
.rooms{flex:none;display:flex;gap:8px;overflow-x:auto;padding:10px 16px}
.rooms button{flex:none;height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--line);background:#fff;font-size:14px;color:var(--text);white-space:nowrap}.rooms .on{background:var(--text);color:#fff;border-color:var(--text)}
.body{flex:1;overflow-y:auto;padding:4px 16px 24px}
.thermo{position:relative;border-radius:20px;padding:16px;background:linear-gradient(135deg,#FEF3C7,#FFE4E6);margin-bottom:14px}
.thermo .lb{display:block;font-size:14px;line-height:20px;font-weight:600;color:#1F2937}.thermo .sub{display:block;font-size:12px;line-height:16px;color:#4B5563}
.dial{position:relative;width:180px;height:180px;margin:6px auto 0}.dial svg{display:block;width:180px;height:180px}
.dial .v{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.dial .v b{font-size:36px;line-height:42px;color:#111827;white-space:nowrap}.dial .v span{font-size:12px;line-height:16px;color:#4B5563}
.ctl{display:flex;justify-content:center;gap:16px;margin-top:4px}.ctl button{width:44px;height:44px;border-radius:22px;background:#fff;font-size:20px;color:#111827}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.dv{position:relative;border:1px solid var(--line);border-radius:16px;padding:12px;min-height:104px}
.dv svg{display:block;width:24px;height:24px}
.dv .nm{margin:8px 0 0;font-size:14px;line-height:20px;font-weight:600}
.dv .st{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.dv [role=switch]{position:absolute;right:10px;top:10px;width:40px;height:24px;border-radius:12px;background:#CBD5E1}
.dv [role=switch]::after{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:9px;background:#fff}
.dv.on{background:#F0FDFA;border-color:#99F6E4}.dv.on [role=switch]{background:var(--brand)}.dv.on [role=switch]::after{left:auto;right:3px}
.scenes{display:flex;gap:8px;margin-top:14px}.scenes button{flex:1;height:44px;border-radius:12px;background:#F3F4F6;font-size:13px;font-weight:600;color:var(--text)}
"""


def dv(icon, name, state, on):
    return f'<div class="dv{" on" if on else ""}">{ic(icon, "#0F766E" if on else "#5B6472")}<p class="nm">{name}</p><span class="st">{state}</span><button role="switch" aria-checked="{"true" if on else "false"}" aria-label="{name} 켜고 끄기"></button></div>'


DIAL = ('<svg viewBox="0 0 180 180" aria-hidden="true"><circle cx="90" cy="90" r="78" fill="none" stroke="#FFFFFF" stroke-width="14"/>'
        '<circle cx="90" cy="90" r="78" fill="none" stroke="#0F766E" stroke-width="14" stroke-linecap="round" stroke-dasharray="300 490" transform="rotate(135 90 90)"/></svg>')
SH_OK = f"""<div class="top"><span class="ttl">우리 집</span></div>
<div class="rooms"><button class="on">거실</button><button>안방</button><button>작은방</button><button>주방</button><button>욕실</button><button>현관</button></div>
<div class="body"><div class="thermo"><span class="lb">거실 온도</span><span class="sub">난방 중 · 목표 24°</span><div class="dial">{DIAL}<div class="v"><b>23.5°</b><span>습도 42%</span></div></div><div class="ctl"><button aria-label="온도 내리기">−</button><button aria-label="온도 올리기">+</button></div></div>
<div class="grid">{dv('bulb', '거실 조명', '켜짐', True)}{dv('fan', '에어컨', '꺼짐', False)}{dv('fan', '공기청정기', '켜짐', True)}{dv('bulb', '거실 스탠드 조명 (창가 쪽)', '꺼짐', False)}{dv('robot', '로봇청소기', '대기', False)}{dv('lock', '현관 도어락', '잠김', True)}</div>
<div class="scenes"><button>외출 모드</button><button>취침 모드</button><button>영화 모드</button></div></div>"""

# ── 4. 주식 ──────────────────────────────────────────────
ST_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#0F172A", "muted": "#5B6474", "line": "#E2E8F0", "brand": "#DC2626"}
ST_CSS = """
.body{flex:1;overflow-y:auto;padding:12px 16px 24px}
.tot span{display:block;font-size:13px;line-height:18px;color:var(--muted)}.tot strong{display:block;font-size:30px;line-height:38px}
.tot .chg{display:block;font-size:14px;line-height:20px;font-weight:600;color:#DC2626}
.chart{position:relative;margin-top:12px;height:180px}
.chart svg{display:block;width:100%;height:180px}
.chart .yl{position:absolute;left:0;top:0;bottom:0;display:flex;flex-direction:column;justify-content:space-between;font-size:11px;line-height:14px;color:var(--muted)}
.chart .tip{position:absolute;right:12px;top:6px;font-size:12px;line-height:16px;padding:4px 8px;border-radius:8px;background:#111827;color:#fff}
.per{display:flex;gap:6px;margin:10px 0 14px}.per button{flex:1;height:34px;border-radius:10px;background:#F1F5F9;font-size:13px;color:var(--muted)}.per .on{background:var(--text);color:#fff}
.body h2{margin:6px 0 4px;font-size:16px}
.hd{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.hd img{flex:none;width:36px;height:36px;border-radius:18px}
.hd .w{flex:1;min-width:0}.hd .w b{display:block;font-size:15px;line-height:20px}.hd .w span{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.hd .v{flex:none;text-align:right}.hd .v b{display:block;font-size:15px;line-height:20px}
.hd .v .up{display:block;color:#DC2626;font-size:12px;line-height:16px;white-space:nowrap}.hd .v .dn{display:block;color:#2563EB;font-size:12px;line-height:16px;white-space:nowrap}
"""
CHART = ('<svg viewBox="0 0 343 180" preserveAspectRatio="none" aria-hidden="true">'
         '<polygon points="56,150 100,120 140,128 180,96 220,104 260,70 300,58 343,40 343,180 56,180" fill="#FEE2E2"/>'
         '<polyline points="56,150 100,120 140,128 180,96 220,104 260,70 300,58 343,40" fill="none" stroke="#DC2626" stroke-width="2.5"/></svg>')
HOLD = [("logo_sam", "삼성전자", "42주 · 평균 68,200원", "3,024,000원", "+4.12%", True), ("logo_skh", "SK하이닉스", "8주 · 평균 172,000원", "1,512,000원", "+12.48%", True),
        ("logo_kai", "한국항공우주산업(KAI) 보통주", "15주 · 평균 54,300원", "742,500원", "-8.84%", False), ("logo_nav", "NAVER", "6주 · 평균 201,500원", "1,173,000원", "-2.97%", False)]
ST_OK = f"""<div class="top"><span class="ttl">내 투자</span></div>
<div class="body"><div class="tot"><span>총 평가금액</span><strong>6,451,500원</strong><span class="chg">+312,400원 (+5.09%) 오늘</span></div>
<div class="chart">{CHART}<div class="yl"><span>6.6백만</span><span>6.3백만</span><span>6.0백만</span></div><span class="tip">10월 10일 6,451,500원</span></div>
<div class="per"><button>1일</button><button class="on">1주</button><button>1달</button><button>1년</button></div>
<h2>보유 종목</h2>{"".join(f'<div class="hd"><img src="{lg}.png" alt="{nm} 로고"><div class="w"><b>{nm}</b><span>{q}</span></div><div class="v"><b>{v}</b><span class="{"up" if up else "dn"}">{p}</span></div></div>' for lg, nm, q, v, p, up in HOLD)}</div>"""

# ── 5. 온라인 퀴즈 ───────────────────────────────────────
QZ_PAL = {"bg": "#FFFFFF", "page": "#EEF0F4", "text": "#111827", "muted": "#5B6472", "line": "#E2E5EA", "brand": "#4F46E5"}
QZ_CSS = """
.qh{flex:none;display:flex;align-items:center;gap:10px;padding:10px 16px}
.qh .bar{flex:1;height:6px;border-radius:3px;background:#E5E7EB;position:relative}.qh .bar i{position:absolute;left:0;top:0;bottom:0;width:30%;background:var(--brand);border-radius:3px}
.qh .cnt{font-size:13px;line-height:18px;color:var(--muted);flex:none}
.qh .tm{display:flex;align-items:center;gap:6px;flex:none;height:32px;padding:0 4px 0 10px;border-radius:16px;background:#FEF2F2;color:#B91C1C;font-size:13px;font-weight:700}
.qh .tm button{width:28px;height:28px;border-radius:14px;background:#fff;display:flex;align-items:center;justify-content:center}.qh .tm svg{width:14px;height:14px}
.body{flex:1;overflow-y:auto;padding:8px 16px 100px}
.no{margin:8px 0 4px;font-size:13px;line-height:18px;font-weight:700;color:var(--brand)}
.q{margin:0 0 10px;font-size:18px;line-height:27px;font-weight:700}
pre{margin:0 0 14px;padding:12px;border-radius:10px;background:#0F172A;color:#E2E8F0;font-size:13px;line-height:20px;overflow-x:auto}
.ch{display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;font-size:15px;line-height:21px}
.ch input{width:20px;height:20px;margin:0;flex:none;accent-color:var(--brand)}
.ch.sel{border-color:var(--brand);background:#EEF2FF}
.ex{margin-top:6px;padding:12px;border-radius:12px;background:#F0FDF4;color:#14532D;font-size:14px;line-height:21px}
.next{position:absolute;left:0;right:0;bottom:0;padding:12px 16px;background:#fff;border-top:1px solid var(--line)}.next button{display:block;width:100%;height:50px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700}
"""
CODE = "const nums = [1, 2, 3];\nconsole.log(nums.map((n) =&gt; n * 2).filter((n) =&gt; n &gt; 2).join(', '));"
QZ_OK = f"""<div class="qh"><div class="bar"><i></i></div><span class="cnt">3 / 10</span><span class="tm">04:12<button aria-label="일시정지">{ic('pause', '#B91C1C')}</button></span></div>
<div class="body"><p class="no">문제 3</p><p class="q">다음 코드를 실행하면 콘솔에 무엇이 찍힐까요?</p>
<pre>{CODE}</pre>
<label class="ch"><input type="radio" name="a">[2, 4, 6]</label><label class="ch sel"><input type="radio" name="a" checked>4, 6</label><label class="ch"><input type="radio" name="a">[4, 6]</label><label class="ch"><input type="radio" name="a">undefined</label>
<div class="ex">map으로 [2, 4, 6]이 되고, filter로 2보다 큰 값만 남아 [4, 6]이 됩니다. join(', ')은 이를 문자열 4, 6으로 만듭니다.</div></div>
<div class="next"><button>다음 문제</button></div>"""

# ── 6. 데스크톱 노트 ─────────────────────────────────────
NT_PAL = {"bg": "#FFFFFF", "page": "#F1F3F6", "text": "#16181D", "muted": "#5B626D", "line": "#E3E6EA", "brand": "#7C3AED"}
NT_CSS = """
.app{max-width:none;flex-direction:row}
.side{flex:none;width:200px;border-right:1px solid var(--line);padding:14px 10px;background:#FAFAFB;display:flex;flex-direction:column;gap:2px}
.side h2{margin:0 8px 10px;font-size:15px;line-height:20px}
.side a{display:flex;align-items:center;gap:8px;min-height:36px;padding:0 10px;border-radius:8px;font-size:14px;color:var(--text);text-decoration:none}.side a.on{background:#EDE9FE;font-weight:700}
.side a .n{margin-left:auto;font-size:12px;color:var(--muted)}
.list{flex:none;width:240px;border-right:1px solid var(--line);overflow-y:auto}
.nt{display:block;padding:12px 14px;border-bottom:1px solid var(--line);color:var(--text);text-decoration:none}.nt.on{background:#F5F3FF}
.nt b{display:block;font-size:14px;line-height:20px}.nt span{display:block;margin-top:2px;font-size:12px;line-height:16px;color:var(--muted)}
.ed{flex:1;min-width:0;display:flex;flex-direction:column}
.tb{flex:none;display:flex;align-items:center;gap:2px;height:48px;padding:0 12px;border-bottom:1px solid var(--line);overflow-x:auto}
.tb button{flex:none;width:36px;height:36px;border-radius:8px;background:transparent;font-size:13px;font-weight:700;color:var(--text)}
.doc{flex:1;overflow-y:auto;padding:20px 28px}
.doc h1{margin:0 0 6px;font-size:24px;line-height:32px}
.doc .meta{margin:0 0 16px;font-size:12px;line-height:16px;color:var(--muted)}
.doc p{margin:0 0 12px;font-size:15px;line-height:25px}
.ck{display:flex;align-items:flex-start;gap:10px;margin:6px 0;font-size:15px;line-height:22px}.ck input{width:18px;height:18px;margin:2px 0 0;flex:none}
.cm{flex:none;width:220px;border-left:1px solid var(--line);padding:14px;overflow-y:auto;background:#FCFCFD}
.cm h2{margin:0 0 10px;font-size:14px;line-height:20px}
.c{padding:10px;border-radius:10px;background:#fff;border:1px solid var(--line);margin-bottom:8px}.c b{display:block;font-size:13px;line-height:18px}.c p{margin:4px 0 0;font-size:13px;line-height:19px}.c span{display:block;margin-top:4px;font-size:11px;line-height:14px;color:var(--muted)}
@media (max-width:900px){.cm{display:none}.list{width:220px}}
"""
TOOLS = ["B", "I", "U", "H1", "H2", "목록", "할 일", "링크", "그림", "표", "코드", "인용"]
NOTES = [("4분기 회고 준비", "10월 10일 · 회의"), ("디자인 시스템 개편 일정과 담당자 정리 (초안)", "10월 9일 · 업무"), ("주말 장보기", "10월 8일 · 개인"), ("읽을 책: 사용자 인터뷰 방법과 질문 목록 만들기", "10월 6일 · 공부")]
NT_OK = f"""<aside class="side"><h2>내 노트</h2><a class="on" href="#">전체 노트<span class="n">42</span></a><a href="#">업무<span class="n">18</span></a><a href="#">개인<span class="n">11</span></a><a href="#">공부<span class="n">9</span></a><a href="#">휴지통<span class="n">4</span></a></aside>
<section class="list">{"".join(f'<a class="nt{" on" if i == 0 else ""}" href="#"><b>{t}</b><span>{m}</span></a>' for i, (t, m) in enumerate(NOTES))}</section>
<main class="ed"><div class="tb">{"".join(f'<button aria-label="{t} 서식">{t}</button>' for t in TOOLS)}</div>
<div class="doc"><h1>4분기 회고 준비</h1><p class="meta">마지막 수정 10월 10일 오후 3:12 · 김하늘</p>
<p>이번 분기에는 온보딩 개선과 디자인 시스템 개편을 함께 진행했다. 회고에서는 잘된 점, 아쉬운 점, 다음 분기에 바꿀 점을 하나씩 정리한다.</p>
<label class="ck"><input type="checkbox" checked>회고 일정 공지하기</label><label class="ck"><input type="checkbox">팀별 지표 모으기(가입 전환율, 이탈률)</label><label class="ck"><input type="checkbox">지난 회고에서 정한 할 일 확인하기</label></div></main>
<aside class="cm"><h2>댓글 2</h2><div class="c"><b>박서준</b><p>지표는 대시보드 링크로 붙이면 좋겠어요.</p><span>오후 2:40</span></div><div class="c"><b>이수민</b><p>회고 템플릿은 지난번 것을 쓸게요.</p><span>오후 3:05</span></div></aside>"""

SCREENS = {
    "cinema": ("좌석 선택", CN_PAL, CN_CSS, CN_OK, M5),
    "community": ("동네생활", CM_PAL, CM_CSS, CM_OK, M5),
    "smarthome": ("우리 집", SH_PAL, SH_CSS, SH_OK, M5),
    "stocks": ("내 투자", ST_PAL, ST_CSS, ST_OK, M5),
    "quiz": ("퀴즈", QZ_PAL, QZ_CSS, QZ_OK, M5),
    "notes": ("내 노트", NT_PAL, NT_CSS, NT_OK, W4),
}

DEV_HINT = ["거실 조명", "에어컨", "공기청정기", "거실 스탠드", "로봇청소기", "현관 도어락"]
# (화면, 변형, 유형, 설명, 추가 CSS, 마크업 바꾸기, 확인 크기, 정답 측정, 글자 힌트)
# 유형: R1~R7·A1·A2·D4는 dqa에 규칙이 있는 종류. D2(색 토큰)·S4(선택 상태)·L1(정렬)·L2(간격)는 규칙 밖
V = [
    ("cinema", "a1-seat", "A1", "좌석 칸을 18px로 고정해 누를 곳이 작음", ".seats{grid-template-columns:14px repeat(8,18px);justify-content:center}.seats button{min-width:0}", [], M5, {"type": "target", "sel": ".seats button", "min": 24}, ["열"]),
    ("cinema", "r1-grid", "R1", "좌석 칸을 시안 값 40px로 고정해 좁은 화면에서 좌석 격자가 밖으로 넘침", ".seats{grid-template-columns:14px repeat(8,40px)}", [], M5, {"type": "overflow", "sel": ".seats"}, ["열"]),
    ("cinema", "a2-legend", "A2", "범례 글자를 #B0B7C3로 옅게 함", ".legend{color:#B0B7C3}", [], M5, {"type": "contrast", "sel": ".legend span", "min": 4.5}, ["선택 가능", "선택한 좌석", "예매 완료"]),
    ("cinema", "r4-pay", "R4", "좌석 영역 아래 여백을 16px로 줄여 끝까지 내려도 범례가 결제 막대에 가려짐", ".hall{padding-bottom:16px}", [], M5, {"type": "covered", "sel": ".legend span:last-child", "scroll": ".hall"}, ["예매 완료", "선택 가능", "선택한 좌석"]),
    ("cinema", "r3-price", "R3", "합계 금액을 결제 막대 왼쪽 위 절대 위치로 옮겨 선택한 좌석 글자 위에 얹힘", ".pay .sum b{position:absolute;left:16px;top:12px}", [], M5, {"type": "overlap_text", "sel": ".pay .sum span", "other": ".pay .sum b"}, ["30,000원", "선택한 좌석"]),
    ("cinema", "d2-sel", "D2", "선택한 좌석 색을 토큰(#DC2626) 대신 #EF4444로 직접 씀", ".seats .sel{background:#EF4444}", [], ["375x812"], {"type": "style", "sel": ".seats .sel", "prop": "background-color", "value": "rgb(220, 38, 38)"}, []),
    ("community", "r1-pics", "R1", "사진 두 장의 칸을 시안 값 200px로 고정해 좁은 화면에서 밖으로 넘침", ".pics{grid-template-columns:repeat(2,200px)}", [], M5, {"type": "overflow", "sel": ".pics"}, ["노을 사진"]),
    ("community", "r2-tx", "R2", "본문을 세 줄로 자르고 '더보기'를 두지 않아 내용이 잘림", ".post .tx{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}", [], M5, {"type": "clipped_text", "sel": ".post .tx"}, ["주말마다"]),
    ("community", "r3-badge", "R3", "'작성자' 배지를 절대 위치로 옮겨 대댓글 작성자 이름 위에 얹힘", ".cm .h{position:relative}.cm .h em{position:absolute;left:30px;top:2px}", [], M5, {"type": "overlap_text", "sel": ".cm.re .h b", "other": ".cm .h em"}, ["작성자", "망원동산책러"]),
    ("community", "a1-share", "A1", "공유 버튼을 아이콘 크기 18px로 줄임", ".acts button[aria-label]{width:18px;height:18px;padding:0}", [], M5, {"type": "target", "sel": ".acts button[aria-label]", "min": 24}, ["공유"]),
    ("community", "r4-reply", "R4", "본문 아래 여백을 없애 끝까지 내려도 마지막 댓글이 입력 막대에 가려짐", ".body{padding-bottom:0}", [], M5, {"type": "covered", "sel": ".cmts .cm:last-child p", "scroll": ".body"}, ["어떤 카메라", "노을수집가"]),
    ("community", "a2-time", "A2", "글·댓글 시각 글자를 #B8BEC6로 옅게 함", ".au span,.cm .h span{color:#B8BEC6}", [], M5, {"type": "contrast", "sel": ".cm .h span", "min": 4.5}, ["시간 전", "분 전"]),
    ("community", "l1-au", "L1", "작성자 줄의 세로 가운데 맞춤을 빼 이름이 사진 위쪽에 붙음", ".au{align-items:flex-start}", [], ["375x812"], {"type": "style", "sel": ".au", "prop": "align-items", "value": "center"}, []),
    ("smarthome", "r3-dial", "R3", "다이얼 가운데 온도 글자를 56px로 키워 링 위로 넘어감", ".dial .v b{font-size:56px;line-height:60px}", [], M5, {"type": "text_in_circle", "sel": ".dial .v b", "circle": ".dial svg", "r": 71}, ["23.5°"]),
    ("smarthome", "a2-grad", "A2", "그라데이션 온도 카드 글자를 흰색으로 바꿔 밝은 배경에서 안 읽힘", ".thermo .lb,.thermo .sub{color:#FFFFFF}", [], M5, {"type": "contrast", "sel": ".thermo .lb, .thermo .sub", "min": 4.5}, ["거실 온도", "난방 중"]),
    ("smarthome", "r6-st", "R6", "기기 상태 칸을 20px로 고정해 '켜짐'·'꺼짐'이 꺾임", ".dv .st{width:20px}", [], M5, {"type": "lines", "sel": ".dv .st"}, ["켜짐", "꺼짐", "대기", "잠김"]),
    ("smarthome", "r2-nm", "R2", "기기 이름 높이를 한 줄(20px)로 고정하고 넘침을 숨겨 긴 이름이 잘림", ".dv .nm{height:20px;overflow:hidden}", [], M5, {"type": "clipped_text", "sel": ".dv .nm"}, ["거실 스탠드"]),
    ("smarthome", "a1-sw", "A1", "기기 스위치를 30×16px로 줄임", ".dv [role=switch]{width:30px;height:16px}.dv [role=switch]::after{width:12px;height:12px;top:2px}", [], M5, {"type": "target", "sel": ".dv [role=switch]", "min": 24}, ["켜고 끄기"]),
    ("smarthome", "s4-on", "S4", "켜진 기기 칸의 켜짐 표시(배경·테두리)를 빼 무엇이 켜졌는지 안 보임", ".dv.on{background:#fff;border-color:var(--line)}", [], ["375x812"], {"type": "style", "sel": ".dv.on", "prop": "background-color", "value": "rgb(240, 253, 250)"}, []),
    ("stocks", "r3-tip", "R3", "차트 말풍선을 왼쪽 끝(left:0)에 고정해 세로축 글자 위에 얹힘", ".chart .tip{left:0;right:auto}", [], M5, {"type": "overlap_text", "sel": ".chart .yl span", "other": ".chart .tip"}, ["6.6백만", "10월 10일"]),
    ("stocks", "a2-dn", "A2", "하락 수익률 글자를 #93C5FD로 옅게 함", ".hd .v .dn{color:#93C5FD}", [], M5, {"type": "contrast", "sel": ".hd .v .dn", "min": 4.5}, ["-8.84%", "-2.97%"]),
    ("stocks", "r1-name", "R1", "종목 이름 칸이 줄어들지 않게 하고 줄바꿈을 막아 평가금액이 화면 밖으로 밀림", ".hd .w{flex:none}.hd .w b{white-space:nowrap}", [], M5, {"type": "overflow", "sel": ".hd"}, ["한국항공우주산업", "742,500원", "-8.84%"]),
    ("stocks", "d4-logo", "D4", "종목 로고 경로를 잘못 적어 SK하이닉스 로고가 깨짐", "", [('src="logo_skh.png"', 'src="logos/logo_skh.png"')], M5, {"type": "img_broken", "sel": ".hd img[alt^=\"SK\"]"}, ["SK하이닉스 로고"]),
    ("stocks", "r6-pct", "R6", "수익률 칸을 36px로 고정하고 글자 끊기를 허용해 '+12.48%'가 꺾임", ".hd .v .up,.hd .v .dn{width:36px;margin-left:auto;white-space:normal;word-break:break-all}", [], M5, {"type": "lines", "sel": ".hd .v .up, .hd .v .dn"}, ["+12.48%", "+4.12%", "-8.84%", "-2.97%"]),
    ("stocks", "d2-up", "D2", "오늘 수익 색을 토큰(#DC2626) 대신 #EF4444로 직접 씀", ".tot .chg{color:#EF4444}", [], ["375x812"], {"type": "style", "sel": ".tot .chg", "prop": "color", "value": "rgb(220, 38, 38)"}, []),
    ("quiz", "r1-code", "R1", "코드 블록의 가로 스크롤을 빼 긴 줄이 화면 밖으로 넘침", "pre{overflow-x:visible}", [], M5, {"type": "overflow_text", "sel": "pre", "allow_scroll": True}, ["console.log", "const nums"]),
    ("quiz", "a1-pause", "A1", "일시정지 버튼을 18px로 줄임", ".qh .tm button{width:18px;height:18px}", [], M5, {"type": "target", "sel": ".qh .tm button", "min": 24}, ["일시정지"]),
    ("quiz", "r4-next", "R4", "본문 아래 여백을 16px로 줄여 끝까지 내려도 해설이 '다음 문제' 막대에 가려짐", ".body{padding-bottom:16px}", [], M5, {"type": "covered", "sel": ".ex", "scroll": ".body"}, ["map으로", "filter"]),
    ("quiz", "r2-ex", "R2", "해설 상자 높이를 42px로 고정하고 넘침을 숨겨 해설이 잘림", ".ex{height:42px;overflow:hidden}", [], M5, {"type": "clipped_text", "sel": ".ex"}, ["map으로"]),
    ("quiz", "a2-cnt", "A2", "진행 숫자(3 / 10)를 #B6BCC6로 옅게 함", ".qh .cnt{color:#B6BCC6}", [], M5, {"type": "contrast", "sel": ".qh .cnt", "min": 4.5}, ["3 / 10"]),
    ("quiz", "r3-timer", "R3", "타이머 칩을 절대 위치로 옮겨 문제 번호·문제 글자 위에 얹힘", ".qh .tm{position:absolute;right:16px;top:70px}", [], M5, {"type": "overlap_text", "sel": ".q, .no", "other": ".qh .tm"}, ["다음 코드를", "04:12", "문제 3"]),
    ("quiz", "s4-sel", "S4", "고른 보기의 선택 표시(테두리·배경)를 빼 무엇을 골랐는지 안 보임", ".ch.sel{border-color:var(--line);background:#fff}", [], ["375x812"], {"type": "style", "sel": ".ch.sel", "prop": "background-color", "value": "rgb(238, 242, 255)"}, []),
    ("notes", "r1-tb", "R1", "서식 도구 막대의 가로 스크롤을 빼 좁은 창에서 버튼이 편집 영역 밖으로 넘침", ".tb{overflow:visible}", [], W4, {"type": "overflow", "sel": ".tb", "allow_scroll": True}, ["인용", "코드", "표", "그림", "링크"]),
    ("notes", "r3-cm", "R3", "댓글 패널을 시안 좌표(left:900px) 절대 위치로 고정해 편집 글자 위에 얹힘", ".cm{position:absolute;left:900px;top:0;bottom:0}", [], ["1280x800", "1024x768"], {"type": "overlap_text", "sel": ".doc p, .doc .ck", "other": ".cm"}, ["이번 분기", "팀별 지표", "회고 일정", "지난 회고", "박서준", "이수민"]),
    ("notes", "a2-meta", "A2", "노트 목록의 날짜·분류 글자를 #B5BBC4로 옅게 함", ".nt span{color:#B5BBC4}", [], W4, {"type": "contrast", "sel": ".nt span", "min": 4.5}, ["10월 10일", "10월 9일", "10월 8일", "10월 6일"]),
    ("notes", "r2-title", "R2", "노트 목록 제목 높이를 한 줄(20px)로 고정하고 넘침을 숨겨 긴 제목이 잘림", ".nt b{height:20px;overflow:hidden}", [], W4, {"type": "clipped_text", "sel": ".nt b"}, ["디자인 시스템", "읽을 책"]),
    ("notes", "a1-tb", "A1", "서식 버튼을 20px로 줄임", ".tb button{width:20px;height:20px;font-size:10px}", [], W4, {"type": "target", "sel": ".tb button", "min": 24}, ["서식"]),
    ("notes", "l2-side", "L2", "왼쪽 메뉴 항목 간격을 시안 2px 대신 10px로 씀", ".side{gap:10px}", [], ["1280x800"], {"type": "style", "sel": ".side", "prop": "row-gap", "value": "2px"}, []),
]


def images(d, screen):
    def img(name, w, h, c1, c2, kind):
        im = Image.new("RGB", (w, h), c1); dr = ImageDraw.Draw(im)
        if kind == "photo":
            dr.rectangle([0, h * 0.6, w, h], fill=c2); dr.ellipse([w * 0.55, h * 0.2, w * 0.8, h * 0.2 + w * 0.25], fill="#FDBA74")
        elif kind == "poster":
            dr.rectangle([0, h * 0.55, w, h], fill=c2); dr.ellipse([w * 0.3, h * 0.2, w * 0.7, h * 0.2 + w * 0.4], fill="#FDE68A")
        else:
            dr.ellipse([w * 0.15, h * 0.15, w * 0.85, h * 0.85], fill=c2)
        im.save(d / name)
    if screen == "cinema": img("poster.png", 96, 136, "#1E293B", "#334155", "poster")
    if screen == "community":
        for i, (a, b) in enumerate([("#FDE2E4", "#E5989B"), ("#DBEAFE", "#3B82F6"), ("#DCFCE7", "#16A34A"), ("#FEF3C7", "#D97706")], 1): img(f"a{i}.png", 64, 64, a, b, "dot")
        img("p1.png", 400, 400, "#FDBA74", "#7C2D12", "photo"); img("p2.png", 400, 400, "#FCA5A5", "#1E3A8A", "photo")
    if screen == "stocks":
        for n, (a, b) in {"logo_sam": ("#DBEAFE", "#1D4ED8"), "logo_skh": ("#FEE2E2", "#DC2626"), "logo_kai": ("#E0F2FE", "#0369A1"), "logo_nav": ("#DCFCE7", "#16A34A")}.items(): img(f"{n}.png", 72, 72, a, b, "dot")


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
        cases.append({"id": f"blind5-{scr}-ok", "screen": scr, "variant": "ok", "code": None, "defect": "맞게 만든 구현", "dir": f"eval/synth/blind5/screens/{scr}/ok", "sizes": sizes, "check": None, "hint": []})
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
        cases.append({"id": f"blind5-{scr}-{var}", "screen": scr, "variant": var, "code": code, "defect": desc, "dir": f"eval/synth/blind5/screens/{scr}/{var}", "sizes": sizes, "check": check, "hint": hint})
    (HERE / "cases.json").write_text(json.dumps({"note": "블라인드 합성 예제 5묶음(10-10). 블라인드 4의 빈틈을 고친 규칙을 고정하고 한 번만 잰다. 규칙 밖 유형: D2 색 토큰(2), S4 선택 상태(2), L1 정렬, L2 간격. 채점은 R3를 짝 기준으로 본다.", "frozen_rules_sha1": rules_sha1(), "cases": cases}, ensure_ascii=False, indent=1) + "\n")
    print(f"화면 {len(SCREENS)}개, 결함 {len(V)}개, 유형 {sorted({v[2] for v in V})}, 규칙 해시 {rules_sha1()[:10]}")


if __name__ == "__main__":
    main()
