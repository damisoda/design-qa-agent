"""블라인드 합성 예제 7묶음(11-19): 수정 성공률 최종 평가용으로 잠가 두는 묶음.
수정률 측정(fixrate, 11-18~19) 뒤 규칙 수정안과 모델을 고치기 전에 먼저 만들고, 개선 작업 중에는 열지 않는다.
dqa 측정 규칙과 수정 코드(dqa/measure/inpage.js·cluster.js, dqa/fix/fix.js·agent.js)를 내용 해시로 고정해 둔다.
앞선 41개 앱과 겹치지 않는 새 앱 6종에 규칙 범위 결함(R1·R2·R3·R4·R6·A1·A2·D4)을 하나씩 심는다. 결함은 바이브코딩에서 흔한 실수에서 골랐다.
화면: food(배달 가게 메뉴), pet(반려동물 프로필), carshare(차량 공유 예약), podcast(팟캐스트 에피소드), job(채용 공고), laundry(세탁 주문)
사용: python3 eval/synth/make_blind7.py → node eval/synth/verify_synth.js --set blind7
"""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw
from make_synth import page, M5

HERE = Path(__file__).resolve().parent / "blind7"
OUT = HERE / "screens"


def ic(kind, color="#222222"):
    paths = {
        "back": '<path d="M15 5l-7 7 7 7"/>', "heart": '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
        "share": '<path d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5"/>', "plus": '<path d="M12 5v14M5 12h14"/>', "minus": '<path d="M5 12h14"/>',
        "play": '<path d="M8 5l11 7-11 7z"/>', "skip": '<path d="M5 12a7 7 0 1 0 2-5M5 4v4h4"/>', "pin": '<path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
        "bell": '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20h4"/>', "star": '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    }
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{paths[kind]}</svg>'


# ── 1. 배달 가게 메뉴 ─────────────────────────────────────
FD_PAL = {"bg": "#FFFFFF", "page": "#EEF0F2", "text": "#15171A", "muted": "#5E6570", "line": "#E5E8EC", "brand": "#EA580C"}
FD_CSS = """
.body{flex:1;overflow-y:auto;padding-bottom:96px}
.cover{display:block;width:100%;height:160px;object-fit:cover}
.shop{padding:14px 16px;border-bottom:8px solid #F3F4F6}
.shop h1{margin:0 0 4px;font-size:20px;line-height:28px}
.shop .meta{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:13px;line-height:18px;color:var(--muted)}
.cats{display:flex;gap:8px;padding:10px 16px;overflow-x:auto;border-bottom:1px solid var(--line)}
.cats button{flex:none;height:34px;padding:0 14px;border-radius:17px;background:#F3F4F6;font-size:14px;color:var(--text)}
.cats .on{background:var(--text);color:#fff}
.mn{display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line)}
.mn .w{flex:1;min-width:0}
.mn b{display:block;font-size:15px;line-height:21px}
.mn p{margin:2px 0 6px;font-size:13px;line-height:18px;color:var(--muted)}
.mn .pr{font-size:15px;font-weight:700}
.mn .ph{position:relative;flex:none;width:88px;height:88px}
.mn .ph img{width:88px;height:88px;border-radius:10px;object-fit:cover}
.mn .ph .add{position:absolute;right:4px;bottom:4px;width:32px;height:32px;border-radius:16px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center}
.mn .ph .add svg{width:18px;height:18px}
.best{display:inline-block;margin-left:6px;padding:0 6px;border-radius:4px;background:#FFEDD5;color:#9A3412;font-size:11px;line-height:18px;font-weight:700;vertical-align:2px}
.cartbar{position:absolute;left:12px;right:12px;bottom:12px;height:56px;padding:0 16px;border-radius:14px;background:var(--brand);color:#fff;display:flex;align-items:center;justify-content:space-between;font-size:16px;font-weight:700}
.cartbar span{font-size:14px;font-weight:600}
"""
FD_MENU = [("직화 제육 덮밥", "불향 가득한 제육과 계란 반숙", "9,500원", "m1", True), ("들기름 막국수", "메밀면에 들기름과 김가루를 듬뿍", "8,000원", "m2", False),
           ("수제 돈가스 정식", "등심 돈가스, 밥, 장국, 양배추 샐러드", "11,000원", "m3", False), ("차돌 된장찌개", "차돌박이와 두부를 넣고 끓인 된장찌개", "9,000원", "m4", False)]
FD_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{ic('back')}</button><span class="ttl">가게</span><button class="icon" aria-label="찜하기">{ic('heart')}</button></div>
<div class="body"><img class="cover" src="cover.png" alt="가게 대표 사진">
<div class="shop"><h1>성수동 한그릇 식당</h1><div class="meta"><span>★ 4.8 (1,204)</span><span>배달 25~35분</span><span>최소 주문 12,000원</span><span>배달팁 2,000원</span></div></div>
<div class="cats"><button class="on">대표 메뉴</button><button>덮밥</button><button>면</button><button>정식</button><button>찌개</button><button>음료</button></div>
{"".join(f'<div class="mn"><div class="w"><b>{n}{"<em class=best>인기</em>" if best else ""}</b><p>{d}</p><span class="pr">{p}</span></div><div class="ph"><img src="{i}.png" alt="{n} 사진"><button class="add" aria-label="{n} 담기">{ic("plus")}</button></div></div>' for n, d, p, i, best in FD_MENU)}
</div>
<button class="cartbar">장바구니 보기<span>2개 · 18,500원</span></button>"""

# ── 2. 반려동물 프로필 ───────────────────────────────────
PT_PAL = {"bg": "#FFFFFF", "page": "#EFF1EE", "text": "#141614", "muted": "#5B635C", "line": "#E3E7E2", "brand": "#16A34A"}
PT_CSS = """
.body{flex:1;overflow-y:auto;padding:0 0 24px}
.hd{display:flex;align-items:center;gap:14px;padding:18px 16px}
.hd img{width:72px;height:72px;border-radius:36px;object-fit:cover;flex:none}
.hd .w{flex:1;min-width:0}
.hd h1{margin:0;font-size:20px;line-height:28px}
.hd span{display:block;font-size:13px;line-height:18px;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 14px}
.chips span{height:28px;padding:0 10px;border-radius:14px;background:#F0FDF4;color:#166534;font-size:13px;line-height:28px}
.stat{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 16px 16px}
.stat div{padding:10px;border-radius:12px;background:#F7F8F7;text-align:center}
.stat b{display:block;font-size:18px;line-height:24px}.stat span{font-size:12px;line-height:16px;color:var(--muted)}
.sec{padding:14px 16px;border-top:8px solid #F3F4F3}
.sec h2{margin:0 0 10px;font-size:16px;line-height:22px}
.walk{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.walk .d{flex:none;width:44px;text-align:center;font-size:12px;line-height:16px;color:var(--muted)}
.walk .d b{display:block;font-size:17px;line-height:22px;color:var(--text)}
.walk .w{flex:1;min-width:0}.walk .w b{display:block;font-size:14px;line-height:20px}.walk .w span{font-size:12px;line-height:16px;color:var(--muted)}
.walk .km{flex:none;font-size:14px;font-weight:700}
.vac{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px;line-height:20px}
.vac span{color:var(--muted);white-space:nowrap}
.memo{margin:0;padding:12px;border-radius:12px;background:#F7F8F7;font-size:14px;line-height:22px}
"""
PT_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{ic('back')}</button><span class="ttl">반려동물</span><button class="icon" aria-label="알림">{ic('bell')}</button></div>
<div class="body"><div class="hd"><img src="dog.png" alt="보리 사진"><div class="w"><h1>보리</h1><span>웰시코기 · 수컷 · 3살 2개월</span><span>등록번호 410-0921-7733</span></div></div>
<div class="chips"><span>중성화 완료</span><span>닭고기 알레르기</span><span>산책 좋아함</span><span>낯가림 있음</span></div>
<div class="stat"><div><b>12.4kg</b><span>몸무게</span></div><div><b>5.2km</b><span>이번 주 산책</span></div><div><b>D-12</b><span>다음 접종</span></div></div>
<div class="sec"><h2>최근 산책</h2>
<div class="walk"><div class="d"><b>18</b>11월</div><div class="w"><b>서울숲 한 바퀴</b><span>오전 7:40 · 48분</span></div><span class="km">2.1km</span></div>
<div class="walk"><div class="d"><b>17</b>11월</div><div class="w"><b>동네 골목 산책</b><span>오후 6:10 · 22분</span></div><span class="km">1.0km</span></div>
<div class="walk"><div class="d"><b>16</b>11월</div><div class="w"><b>한강 뚝섬 공원 산책로</b><span>오후 4:30 · 61분</span></div><span class="km">3.4km</span></div></div>
<div class="sec"><h2>접종 기록</h2><div class="vac">종합백신(DHPPL) 5차<span>2026.06.02</span></div><div class="vac">광견병<span>2026.03.15</span></div><div class="vac">켄넬코프<span>2025.12.20</span></div></div>
<div class="sec"><h2>메모</h2><p class="memo">사료는 하루 두 번, 아침 8시와 저녁 7시에 90g씩. 산책 뒤에는 발을 꼭 닦아 주세요. 천둥 소리에 놀라면 담요를 덮어 주면 진정합니다.</p></div></div>"""

# ── 3. 차량 공유 예약 ────────────────────────────────────
CS_PAL = {"bg": "#FFFFFF", "page": "#ECEFF3", "text": "#11151A", "muted": "#5A6270", "line": "#E2E6EB", "brand": "#2563EB"}
CS_CSS = """
.map{position:relative;flex:none;height:220px;background:#DDE6EE;overflow:hidden}
.map img{display:block;width:100%;height:100%;object-fit:cover}
.map .pin{position:absolute;left:50%;top:50%;width:36px;height:36px;margin:-36px 0 0 -18px}
.map .zone{position:absolute;left:12px;top:12px;padding:6px 10px;border-radius:8px;background:#fff;font-size:12px;line-height:16px;box-shadow:0 1px 4px rgba(0,0,0,.15)}
.body{flex:1;overflow-y:auto;padding:16px 16px 104px}
.car{display:flex;gap:12px;align-items:center}
.car img{width:96px;height:60px;object-fit:contain;flex:none}
.car .w{flex:1;min-width:0}.car b{display:block;font-size:17px;line-height:24px}.car span{display:block;font-size:13px;line-height:18px;color:var(--muted)}
.tm{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:16px 0}
.tm div{padding:10px 12px;border:1px solid var(--line);border-radius:12px}
.tm span{display:block;font-size:12px;line-height:16px;color:var(--muted)}.tm b{font-size:15px;line-height:22px}
.opt{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
.opt .w{flex:1;min-width:0}.opt b{display:block;font-size:15px;line-height:21px}.opt span{font-size:12px;line-height:16px;color:var(--muted)}
.sw{position:relative;flex:none;width:48px;height:28px;border-radius:14px;background:#D1D5DB}
.sw::after{content:"";position:absolute;left:3px;top:3px;width:22px;height:22px;border-radius:11px;background:#fff}
.sw.on{background:var(--brand)}.sw.on::after{left:23px}
.fee{margin-top:14px}.fee div{display:flex;justify-content:space-between;font-size:14px;line-height:24px;color:var(--muted)}
.fee .t{margin-top:4px;color:var(--text);font-size:16px;font-weight:700}
.go{position:absolute;left:0;right:0;bottom:0;padding:12px 16px 16px;background:#fff;border-top:1px solid var(--line)}
.go button{display:block;width:100%;height:52px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700}
"""
CS_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{ic('back')}</button><span class="ttl">예약하기</span></div>
<div class="map"><img src="map.png" alt="대여 장소 지도"><span class="zone">성수역 3번 출구 공영주차장 B2</span><span class="pin">{ic('pin', '#2563EB')}</span></div>
<div class="body"><div class="car"><img src="car.png" alt="아이오닉 6"><div class="w"><b>아이오닉 6</b><span>전기차 · 5인승 · 배터리 82%</span><span>12가 3456</span></div></div>
<div class="tm"><div><span>대여</span><b>11.20(금) 10:00</b></div><div><span>반납</span><b>11.20(금) 16:00</b></div></div>
<div class="opt"><div class="w"><b>차량 손해 면책</b><span>사고 시 자기부담금 최대 30만원</span></div><button class="sw on" role="switch" aria-checked="true" aria-label="차량 손해 면책"></button></div>
<div class="opt"><div class="w"><b>왕복 대신 편도 반납</b><span>다른 존에 반납하면 추가 요금 15,000원</span></div><button class="sw" role="switch" aria-checked="false" aria-label="편도 반납"></button></div>
<div class="fee"><div><span>대여 요금(6시간)</span><span>42,000원</span></div><div><span>주행 요금(예상 40km)</span><span>8,000원</span></div><div><span>면책 상품</span><span>9,900원</span></div><div class="t"><span>결제 예정 금액</span><span>59,900원</span></div></div></div>
<div class="go"><button>59,900원 결제하고 예약</button></div>"""

# ── 4. 팟캐스트 에피소드 ─────────────────────────────────
PC_PAL = {"bg": "#FFFFFF", "page": "#EEEDF2", "text": "#16141C", "muted": "#615D6E", "line": "#E6E4EC", "brand": "#7C3AED"}
PC_CSS = """
.body{flex:1;overflow-y:auto;padding:0 0 100px}
.show{display:flex;gap:14px;padding:16px}
.show img{width:96px;height:96px;border-radius:12px;object-fit:cover;flex:none}
.show .w{flex:1;min-width:0}.show span{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.show h1{margin:4px 0;font-size:18px;line-height:25px}
.ctl{display:flex;align-items:center;gap:10px;padding:0 16px 14px}
.ctl .play{display:flex;align-items:center;gap:8px;height:44px;padding:0 18px;border-radius:22px;background:var(--brand);color:#fff;font-size:15px;font-weight:700}
.ctl .play svg{width:18px;height:18px}
.ctl .ib{width:44px;height:44px;border-radius:22px;background:#F3F1F8;display:flex;align-items:center;justify-content:center}.ctl .ib svg{width:20px;height:20px}
.ctl .len{margin-left:auto;font-size:13px;color:var(--muted)}
.desc{margin:0;padding:0 16px 16px;font-size:14px;line-height:22px}
.ch{padding:12px 16px;border-top:8px solid #F4F3F7}
.ch h2{margin:0 0 6px;font-size:16px;line-height:22px}
.ch div{display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px;line-height:20px}
.ch div span{flex:none;width:44px;color:var(--brand);font-variant-numeric:tabular-nums}
.ch div b{flex:1;min-width:0;font-weight:500}
.mini{position:absolute;left:8px;right:8px;bottom:8px;height:64px;padding:0 12px;border-radius:14px;background:#1F1B2E;color:#fff;display:flex;align-items:center;gap:10px}
.mini img{width:44px;height:44px;border-radius:8px;flex:none}
.mini .w{flex:1;min-width:0}.mini b{display:block;font-size:14px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mini span{font-size:12px;line-height:16px;color:#C4BFD6}
.mini button{width:44px;height:44px;flex:none;display:flex;align-items:center;justify-content:center}.mini button svg{width:22px;height:22px}
"""
PC_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{ic('back')}</button><span class="ttl">에피소드</span><button class="icon" aria-label="공유">{ic('share')}</button></div>
<div class="body"><div class="show"><img src="art.png" alt="방송 표지"><div class="w"><span>주간 개발 수다 · 142화</span><h1>타입스크립트 6 정리와 사이드 프로젝트 회고</h1><span>2026년 11월 17일 · 58분</span></div></div>
<div class="ctl"><button class="play">{ic('play', '#FFFFFF')}재생</button><button class="ib" aria-label="15초 뒤로">{ic('skip')}</button><button class="ib" aria-label="저장">{ic('heart')}</button><span class="len">58:12</span></div>
<p class="desc">이번 화에서는 타입스크립트 6에서 달라진 점을 살펴보고, 세 사람이 각자 주말마다 만든 사이드 프로젝트를 돌아봅니다. 배포하면서 겪은 실수와 다음에 바꿀 점도 이야기합니다.</p>
<div class="ch"><h2>챕터</h2><div><span>00:00</span><b>오프닝과 근황</b></div><div><span>06:40</span><b>타입스크립트 6에서 바뀐 것</b></div><div><span>24:15</span><b>사이드 프로젝트 회고: 가계부 앱</b></div><div><span>41:30</span><b>배포 실수 모음과 청취자 질문</b></div></div></div>
<div class="mini"><img src="art.png" alt=""><div class="w"><b>타입스크립트 6 정리와 사이드 프로젝트 회고</b><span>12:04 / 58:12</span></div><button aria-label="재생">{ic('play', '#FFFFFF')}</button></div>"""

# ── 5. 채용 공고 ─────────────────────────────────────────
JB_PAL = {"bg": "#FFFFFF", "page": "#EDEFF1", "text": "#121417", "muted": "#5C636D", "line": "#E3E6EA", "brand": "#0F766E"}
JB_CSS = """
.body{flex:1;overflow-y:auto;padding:16px 16px 100px}
.co{display:flex;align-items:center;gap:10px}
.co img{width:44px;height:44px;border-radius:10px;flex:none}
.co span{font-size:14px;line-height:20px;color:var(--muted)}
.body h1{margin:12px 0 8px;font-size:21px;line-height:29px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.tags span{padding:0 8px;border-radius:6px;background:#F0FDFA;color:#115E59;font-size:12px;line-height:24px}
.kv{display:grid;grid-template-columns:72px minmax(0,1fr);gap:8px 12px;padding:14px;border-radius:12px;background:#F7F8F9;font-size:14px;line-height:20px}
.kv dt{color:var(--muted)}.kv dd{margin:0}
.body h2{margin:20px 0 8px;font-size:16px;line-height:22px}
.body ul{margin:0;padding-left:18px;font-size:14px;line-height:22px}
.dl{display:flex;align-items:center;gap:6px;margin-top:16px;font-size:13px;color:#B91C1C;font-weight:600}
.apply{position:absolute;left:0;right:0;bottom:0;display:flex;gap:8px;padding:12px 16px 16px;background:#fff;border-top:1px solid var(--line)}
.apply .sv{width:52px;height:52px;flex:none;border-radius:12px;border:1px solid var(--line);background:#fff;display:flex;align-items:center;justify-content:center}.apply .sv svg{width:22px;height:22px}
.apply .ap{flex:1;height:52px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700}
"""
JB_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{ic('back')}</button><span class="ttl">채용 공고</span><button class="icon" aria-label="공유">{ic('share')}</button></div>
<div class="body"><div class="co"><img src="logo.png" alt="회사 로고"><span>그린필드 모빌리티 · 서울 성동구</span></div>
<h1>프런트엔드 엔지니어 (React Native, 3년 이상)</h1>
<div class="tags"><span>정규직</span><span>재택 주 2일</span><span>스톡옵션</span><span>점심 제공</span></div>
<dl class="kv"><dt>경력</dt><dd>3~7년</dd><dt>연봉</dt><dd>6,000만~8,500만원 (협의)</dd><dt>근무지</dt><dd>서울 성동구 성수이로 118 그린빌딩 7층 (성수역 4번 출구에서 도보 5분)</dd><dt>마감</dt><dd>2026.12.05(토) 23:59</dd></dl>
<h2>주요 업무</h2><ul><li>차량 공유 앱(iOS·Android) 신규 기능 개발</li><li>디자인 시스템 컴포넌트 설계와 유지보수</li><li>앱 성능 측정과 개선, 오류 모니터링</li></ul>
<h2>자격 요건</h2><ul><li>React Native 또는 React로 3년 이상 서비스 운영 경험</li><li>TypeScript와 상태 관리 라이브러리 사용 경험</li></ul>
<div class="dl">{ic('bell', '#B91C1C').replace('<svg', '<svg width="16" height="16"')}마감까지 16일 남았어요</div></div>
<div class="apply"><button class="sv" aria-label="공고 저장">{ic('star')}</button><button class="ap">지원하기</button></div>"""

# ── 6. 세탁 주문 ─────────────────────────────────────────
LD_PAL = {"bg": "#FFFFFF", "page": "#ECF0F3", "text": "#10161B", "muted": "#58636E", "line": "#E1E7EC", "brand": "#0284C7"}
LD_CSS = """
.body{flex:1;overflow-y:auto;padding:16px 16px 112px}
.addr{display:flex;align-items:center;gap:8px;padding:12px;border-radius:12px;background:#F0F9FF;font-size:14px;line-height:20px}
.addr svg{width:18px;height:18px;flex:none}.addr span{flex:1;min-width:0}
.body h2{margin:18px 0 8px;font-size:16px;line-height:22px}
.it{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.it img{width:40px;height:40px;flex:none}
.it .w{flex:1;min-width:0}.it b{display:block;font-size:15px;line-height:21px}.it span{font-size:12px;line-height:16px;color:var(--muted)}
.qty{display:flex;align-items:center;gap:4px;flex:none}
.qty button{width:32px;height:32px;border-radius:16px;border:1px solid var(--line);background:#fff;display:flex;align-items:center;justify-content:center}.qty button svg{width:16px;height:16px}
.qty em{width:24px;text-align:center;font-style:normal;font-size:15px;font-weight:700}
.slots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.slots button{height:56px;border-radius:10px;border:1px solid var(--line);background:#fff;font-size:13px;line-height:18px;color:var(--text)}
.slots .on{border-color:var(--brand);background:#F0F9FF;color:#075985;font-weight:700}
.req{width:100%;min-height:72px;margin-top:4px;padding:10px;border:1px solid var(--line);border-radius:10px;font:inherit;font-size:14px;line-height:20px;resize:none}
.sum{position:absolute;left:0;right:0;bottom:0;padding:12px 16px 16px;background:#fff;box-shadow:0 -4px 12px rgba(0,0,0,.06)}
.sum .r{display:flex;justify-content:space-between;margin-bottom:10px;font-size:14px;color:var(--muted)}.sum .r b{color:var(--text);font-size:17px}
.sum button{display:block;width:100%;height:50px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700}
"""
LD_ITEMS = [("셔츠·블라우스", "드라이 · 다림질 포함", "s1", 3), ("니트·스웨터", "울 전용 세탁", "s2", 1), ("이불(퀸 이상)", "대형 세탁 · 2일 소요", "s3", 1)]
LD_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{ic('back')}</button><span class="ttl">세탁 맡기기</span></div>
<div class="body"><div class="addr">{ic('pin', '#0284C7')}<span>서울 마포구 월드컵로 12길 34, 망원 한강뷰 오피스텔 202호 (경비실 옆 무인 보관함)</span></div>
<h2>맡길 옷</h2>
{"".join(f'<div class="it"><img src="{i}.png" alt=""><div class="w"><b>{n}</b><span>{d}</span></div><div class="qty"><button aria-label="{n} 빼기">{ic("minus")}</button><em>{q}</em><button aria-label="{n} 더하기">{ic("plus")}</button></div></div>' for n, d, i, q in LD_ITEMS)}
<h2>수거 시간</h2><div class="slots"><button>오늘<br>19~21시</button><button class="on">오늘<br>21~23시</button><button>내일<br>07~09시</button></div>
<h2>요청 사항</h2><textarea class="req" aria-label="요청 사항">셔츠 소매 얼룩 부탁드려요.</textarea></div>
<div class="sum"><div class="r"><span>예상 금액(5점)</span><b>27,500원</b></div><button>수거 신청하기</button></div>"""

SCREENS = {
    "food": ("가게", FD_PAL, FD_CSS, FD_OK, M5),
    "pet": ("반려동물", PT_PAL, PT_CSS, PT_OK, M5),
    "carshare": ("예약하기", CS_PAL, CS_CSS, CS_OK, M5),
    "podcast": ("에피소드", PC_PAL, PC_CSS, PC_OK, M5),
    "job": ("채용 공고", JB_PAL, JB_CSS, JB_OK, M5),
    "laundry": ("세탁 맡기기", LD_PAL, LD_CSS, LD_OK, M5),
}

# (화면, 변형, 유형, 설명, 추가 CSS, 마크업 바꾸기, 확인 크기, 정답 측정, 글자 힌트)
V = [
    ("food", "r1-meta", "R1", "가게 정보 줄의 줄바꿈을 막아 배달팁 글자가 화면 밖으로 밀림", ".shop .meta{flex-wrap:nowrap}.shop .meta span{flex:none}", [], M5, {"type": "overflow", "sel": ".shop .meta"}, ["배달팁", "최소 주문"]),
    ("food", "r3-best", "R3", "'인기' 배지를 절대 위치로 옮겨 메뉴 설명 글자 위에 얹힘", ".mn .w{position:relative}.best{position:absolute;left:0;top:18px;margin:0}", [], M5, {"type": "overlap_text", "sel": ".mn p", "other": ".best"}, ["인기", "불향 가득한"]),
    ("food", "a1-add", "A1", "메뉴 담기 버튼을 20px로 줄임", ".mn .ph .add{width:20px;height:20px}.mn .ph .add svg{width:12px;height:12px}", [], M5, {"type": "target", "sel": ".mn .ph .add", "min": 24}, ["담기"]),
    ("food", "r4-last", "R4", "본문 아래 여백을 없애 끝까지 내려도 마지막 메뉴가 장바구니 막대에 가려짐", ".body{padding-bottom:0}", [], M5, {"type": "covered", "sel": ".mn:last-child .pr", "scroll": ".body"}, ["차돌 된장찌개", "9,000원"]),
    ("food", "a2-desc", "A2", "메뉴 설명 글자를 #B9BFC8로 옅게 함", ".mn p{color:#B9BFC8}", [], M5, {"type": "contrast", "sel": ".mn p", "min": 4.5}, ["불향 가득한", "메밀면에"]),
    ("pet", "r2-memo", "R2", "메모 상자 높이를 44px로 고정하고 넘침을 숨겨 메모가 잘림", ".memo{height:44px;overflow:hidden}", [], M5, {"type": "clipped_text", "sel": ".memo"}, ["사료는 하루"]),
    ("pet", "r6-km", "R6", "산책 거리 칸을 28px로 고정해 '2.1km'가 두 줄로 꺾임", ".walk .km{width:28px;word-break:break-all}", [], M5, {"type": "lines", "sel": ".walk .km"}, ["2.1km", "1.0km", "3.4km"]),
    ("pet", "r3-stat", "R3", "숫자 아래 설명 글자를 위로 14px 끌어올려 숫자와 겹침", ".stat span{position:relative;top:-14px;display:block}", [], M5, {"type": "overlap_text", "sel": ".stat span", "other": ".stat b"}, ["12.4kg", "몸무게"]),
    ("pet", "d4-dog", "D4", "프로필 사진 경로를 잘못 적어 사진이 깨짐", "", [('src="dog.png"', 'src="img/dog.png"')], M5, {"type": "img_broken", "sel": ".hd img"}, ["보리 사진"]),
    ("pet", "a2-chip", "A2", "특징 칩 글자색을 #86EFAC로 바꿔 연한 배경에서 안 읽힘", ".chips span{color:#86EFAC}", [], M5, {"type": "contrast", "sel": ".chips span", "min": 4.5}, ["중성화 완료", "닭고기 알레르기"]),
    ("carshare", "r3-zone", "R3", "대여 장소 안내를 지도 가운데로 옮겨 위치 핀 위에 얹힘", ".map .zone{left:50%;top:50%;transform:translate(-50%,-50%)}", [], M5, {"type": "overlap_text", "sel": ".map .zone", "other": ".map .pin"}, ["성수역 3번 출구"]),
    ("carshare", "a1-sw", "A1", "옵션 스위치를 34×18px로 줄임", ".sw{width:34px;height:18px}.sw::after{width:14px;height:14px;top:2px;left:2px}.sw.on::after{left:18px}", [], M5, {"type": "target", "sel": ".sw", "min": 24}, ["차량 손해 면책", "편도 반납"]),
    ("carshare", "r1-tm", "R1", "대여·반납 칸을 시안 값 170px로 고정해 좁은 화면에서 밖으로 넘침", ".tm{grid-template-columns:170px 170px}", [], M5, {"type": "overflow", "sel": ".tm"}, ["반납", "16:00"]),
    ("carshare", "r4-fee", "R4", "본문 아래 여백을 줄여 끝까지 내려도 결제 예정 금액이 결제 막대에 가려짐", ".body{padding-bottom:24px}", [], M5, {"type": "covered", "sel": ".fee .t", "scroll": ".body"}, ["결제 예정 금액"]),
    ("carshare", "r2-car", "R2", "차량 정보 칸 높이를 40px로 고정하고 넘침을 숨겨 차량 번호가 잘림", ".car .w{height:40px;overflow:hidden}", [], M5, {"type": "clipped_text", "sel": ".car .w"}, ["12가 3456", "배터리"]),
    ("podcast", "r4-ch", "R4", "본문 아래 여백을 없애 끝까지 내려도 마지막 챕터가 미니 플레이어에 가려짐", ".body{padding-bottom:0}", [], M5, {"type": "covered", "sel": ".ch div:last-child b", "scroll": ".body"}, ["배포 실수 모음"]),
    ("podcast", "r1-ctl", "R1", "재생 버튼 줄의 버튼들이 줄어들지 않게 하고 재생 버튼 폭을 200px로 고정해 길이 표시가 화면 밖으로 밀림", ".ctl .play{width:240px;flex:none;justify-content:center}.ctl .len{flex:none}", [], M5, {"type": "overflow", "sel": ".ctl"}, ["58:12", "저장"]),
    ("podcast", "r6-ch", "R6", "챕터 시각 칸을 24px로 줄여 '00:00'이 두 줄로 꺾임", ".ch div span{width:24px;word-break:break-all}", [], M5, {"type": "lines", "sel": ".ch div span"}, ["00:00", "06:40", "24:15", "41:30"]),
    ("podcast", "a2-mini", "A2", "미니 플레이어 재생 시각 글자를 #4C4766로 바꿔 어두운 배경에서 안 읽힘", ".mini span{color:#4C4766}", [], M5, {"type": "contrast", "sel": ".mini span", "min": 4.5}, ["12:04 / 58:12"]),
    ("podcast", "r3-title", "R3", "에피소드 제목의 줄 높이를 14px로 줄여 두 줄 제목이 서로 겹치고 아래 날짜 줄에 닿음", ".show h1{line-height:14px;margin:4px 0 0}", [], M5, {"type": "overlap_text", "sel": ".show h1", "other": ".show .w span:last-child"}, ["타입스크립트 6", "2026년 11월 17일"]),
    ("job", "r1-kv", "R1", "회사 주소 칸이 줄바꿈되지 않게 해 긴 주소가 상자 밖으로 넘침", ".kv dd{white-space:nowrap}", [], M5, {"type": "overflow_text", "sel": ".kv dd"}, ["성수이로 118"]),
    ("job", "a1-save", "A1", "공고 저장 버튼을 22px로 줄임", ".apply .sv{width:22px;height:22px;align-self:center}.apply .sv svg{width:14px;height:14px}", [], M5, {"type": "target", "sel": ".apply .sv", "min": 24}, ["공고 저장"]),
    ("job", "r4-req", "R4", "본문 아래 여백을 16px로 줄여 끝까지 내려도 마감 안내가 지원 막대에 가려짐", ".body{padding-bottom:16px}", [], M5, {"type": "covered", "sel": ".dl", "scroll": ".body"}, ["마감까지 16일"]),
    ("job", "d4-logo", "D4", "회사 로고 경로를 잘못 적어 로고가 깨짐", "", [('src="logo.png"', 'src="/assets/logo.png"')], M5, {"type": "img_broken", "sel": ".co img"}, ["회사 로고"]),
    ("job", "r3-dl", "R3", "마감 안내를 본문 위쪽 고정 위치로 옮겨 공고 제목 위에 얹힘", ".body{position:relative}.dl{position:absolute;left:16px;top:66px;margin:0;background:#fff}", [], M5, {"type": "overlap_text", "sel": ".body h1", "other": ".dl"}, ["프런트엔드 엔지니어", "마감까지"]),
    ("laundry", "r6-sum", "R6", "예상 금액 칸을 40px로 고정해 '27,500원'이 두 줄로 꺾임", ".sum .r b{width:40px;word-break:break-all}", [], M5, {"type": "lines", "sel": ".sum .r b"}, ["27,500원"]),
    ("laundry", "a1-qty", "A1", "수량 버튼을 18px로 줄임", ".qty button{width:18px;height:18px}.qty button svg{width:10px;height:10px}", [], M5, {"type": "target", "sel": ".qty button", "min": 24}, ["빼기", "더하기"]),
    ("laundry", "r2-addr", "R2", "주소 줄 높이를 20px로 고정하고 넘침을 숨겨 두 줄 주소가 잘림", ".addr{height:44px;overflow:hidden}.addr span{height:20px;overflow:hidden}", [], M5, {"type": "clipped_text", "sel": ".addr span"}, ["월드컵로"]),
    ("laundry", "r4-req", "R4", "아래 합계 막대 높이만큼 여백을 두지 않아 끝까지 내려도 요청 사항 칸이 가려짐", ".body{padding-bottom:12px}", [], M5, {"type": "covered", "sel": ".req", "scroll": ".body"}, ["요청 사항"]),
    ("laundry", "r1-it", "R1", "옷 이름 칸 폭을 시안 값 260px로 고정해 수량 버튼이 화면 밖으로 밀림", ".it .w{flex:none;width:260px}", [], M5, {"type": "overflow", "sel": ".it"}, ["이불(퀸 이상)", "더하기"]),
]


def images(d, screen):
    def img(name, w, h, c1, c2, kind="dot"):
        im = Image.new("RGB", (w, h), c1); dr = ImageDraw.Draw(im)
        if kind == "photo":
            dr.rectangle([0, h * 0.6, w, h], fill=c2); dr.ellipse([w * 0.55, h * 0.2, w * 0.8, h * 0.2 + w * 0.25], fill="#FDBA74")
        elif kind == "map":
            for i in range(0, w, 40): dr.line([i, 0, i, h], fill=c2, width=6)
            for j in range(0, h, 50): dr.line([0, j, w, j], fill=c2, width=6)
        else:
            dr.ellipse([w * 0.15, h * 0.15, w * 0.85, h * 0.85], fill=c2)
        im.save(d / name)
    if screen == "food":
        img("cover.png", 860, 320, "#FED7AA", "#9A3412", "photo")
        for i, (a, b) in enumerate([("#FEE2E2", "#B91C1C"), ("#FEF3C7", "#92400E"), ("#FFEDD5", "#C2410C"), ("#ECFCCB", "#4D7C0F")], 1): img(f"m{i}.png", 176, 176, a, b, "photo")
    if screen == "pet": img("dog.png", 144, 144, "#FDE68A", "#B45309")
    if screen == "carshare": img("map.png", 860, 440, "#DDE6EE", "#FFFFFF", "map"); img("car.png", 192, 120, "#FFFFFF", "#94A3B8")
    if screen == "podcast": img("art.png", 192, 192, "#EDE9FE", "#6D28D9")
    if screen == "job": img("logo.png", 88, 88, "#CCFBF1", "#0F766E")
    if screen == "laundry":
        for i, (a, b) in enumerate([("#E0F2FE", "#0369A1"), ("#FCE7F3", "#BE185D"), ("#EDE9FE", "#6D28D9")], 1): img(f"s{i}.png", 80, 80, a, b)


def frozen_sha1():
    """고정 기준: dqa 측정 규칙과 수정 코드의 내용 해시(이 묶음을 만든 시점)"""
    root = Path(__file__).resolve().parents[2] / "dqa"
    h = hashlib.sha1()
    for f in ("measure/inpage.js", "measure/cluster.js", "fix/fix.js", "fix/agent.js"): h.update((root / f).read_bytes())
    return h.hexdigest()


def main():
    cases = []
    for scr, (title, pal, css, ok, sizes) in SCREENS.items():
        d = OUT / scr / "ok"; d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(f"{title} · ok", pal, css, ok)); images(d, scr)
        cases.append({"id": f"blind7-{scr}-ok", "screen": scr, "variant": "ok", "code": None, "defect": "맞게 만든 구현", "dir": f"eval/synth/blind7/screens/{scr}/ok", "sizes": sizes, "check": None, "hint": []})
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
        cases.append({"id": f"blind7-{scr}-{var}", "screen": scr, "variant": var, "code": code, "defect": desc, "dir": f"eval/synth/blind7/screens/{scr}/{var}", "sizes": sizes, "check": check, "hint": hint})
    (HERE / "cases.json").write_text(json.dumps({"note": "블라인드 합성 예제 7묶음(11-19). 수정 성공률 최종 평가용. 규칙 수정안·모델 개선 전에 만들어 잠근다. 개선 작업 중에는 열지 않는다.", "frozen_sha1": frozen_sha1(), "cases": cases}, ensure_ascii=False, indent=1) + "\n")
    print(f"화면 {len(SCREENS)}개, 결함 {len(V)}개, 유형 {sorted({v[2] for v in V})}, 고정 해시 {frozen_sha1()[:10]}")


if __name__ == "__main__":
    main()
