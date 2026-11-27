"""블라인드 합성 예제(10-10). dqa 규칙을 3fae9f3으로 고정한 채 새로 만든 앱 6종에 결함을 하나씩 심는다. 한 번만 잰다.
결함은 규칙 목록에서 고르지 않고 바이브코딩에서 흔한 결함에서 골랐다. 규칙이 아직 없는 종류(포커스 표시, 글자 굵기, 크기 방식, 정렬)도 섞는다.
화면: login(로그인), feed(SNS 피드), map(지도 검색), booking(예약 캘린더), receipt(결제 영수증), landing(데스크톱 랜딩)
사용: python3 eval/synth/make_blind.py  → eval/synth/blind/screens/<화면>/<변형>/index.html, eval/synth/blind/cases.json
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw
from make_synth import page, svg, M5, W4, N3

HERE = Path(__file__).resolve().parent / "blind"
OUT = HERE / "screens"

# ── 1. 로그인 ───────────────────────────────────────────
LOGIN_PAL = {"bg": "#FFFFFF", "page": "#F4F5F7", "text": "#16181D", "muted": "#5E6470", "line": "#DCDFE4", "brand": "#2453D6", "accent": "#B42318"}
LOGIN_CSS = """
.wrap{flex:1;overflow-y:auto;padding:40px 24px 24px;display:flex;flex-direction:column;gap:14px}
.logo{margin:0;font-size:30px;font-weight:800;letter-spacing:-0.5px}.lead{margin:0 0 10px;font-size:15px;line-height:22px;color:var(--muted)}
.f label{display:block;font-size:14px;font-weight:600;margin-bottom:6px}
.f .box{position:relative}.f input{width:100%;height:48px;border:1px solid var(--line);border-radius:10px;padding:0 48px 0 14px;font-size:16px;font-family:inherit;outline:none}
.f input:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(36,83,214,.25)}
.eye{position:absolute;right:4px;top:4px;width:40px;height:40px;border-radius:8px;background:transparent;display:flex;align-items:center;justify-content:center}
.eye i{width:18px;height:12px;border:2px solid #555;border-radius:50%;display:block}
.err{margin:0;font-size:13px;line-height:19px;color:var(--accent)}
.go{height:52px;border-radius:12px;background:var(--brand);color:#fff;font-size:17px;font-weight:700}
.links{display:flex;justify-content:center;gap:12px;font-size:14px;color:var(--muted)}.links a{color:var(--muted);text-decoration:underline;min-height:24px;display:inline-flex;align-items:center}
.social{display:flex;flex-direction:column;gap:8px}.social button{height:48px;border-radius:12px;border:1px solid var(--line);background:#fff;font-size:15px;font-weight:600;padding:0 16px}
.terms{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--muted);text-align:center}
"""
LOGIN_OK = """<div class="wrap"><h1 class="logo">링크업</h1><p class="lead">동네 모임을 가장 쉽게 찾는 방법</p>
<div class="f"><label for="em">이메일</label><div class="box"><input id="em" type="email" placeholder="you@example.com"></div></div>
<div class="f"><label for="pw">비밀번호</label><div class="box"><input id="pw" type="password" placeholder="8자 이상"><button class="eye" aria-label="비밀번호 보기"><i></i></button></div></div>
<p class="err">이메일 또는 비밀번호가 맞지 않아요. 5번 틀리면 10분 동안 로그인할 수 없어요.</p>
<button class="go">로그인</button>
<div class="links"><a href="#">비밀번호 찾기</a><a href="#">회원가입</a></div>
<div class="social"><button>카카오로 시작하기</button><button>네이버로 시작하기</button><button>Apple로 시작하기</button></div>
<p class="terms">계속하면 이용약관과 개인정보 처리방침에 동의하게 됩니다.</p></div>"""

# ── 2. SNS 피드 ──────────────────────────────────────────
FEED_PAL = {"bg": "#FFFFFF", "page": "#EDEEF0", "text": "#111318", "muted": "#5C6270", "line": "#E4E6EA", "brand": "#D7263D"}
FEED_CSS = """
.list{flex:1;overflow-y:auto;padding-bottom:88px}
.post{border-bottom:8px solid #F3F4F6}
.ph{display:flex;align-items:center;gap:10px;padding:12px 16px}.av{width:36px;height:36px;border-radius:50%;object-fit:cover;flex:none}
.who{flex:1;min-width:0}.who b{display:block;font-size:15px;font-weight:700;line-height:20px}.who span{display:block;font-size:12px;color:var(--muted)}
.follow{height:32px;padding:0 12px;border-radius:16px;border:1px solid var(--line);background:#fff;font-size:13px;font-weight:600}
.pic{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}
.acts{display:flex;align-items:center;gap:16px;padding:10px 16px;font-size:14px;position:relative}.acts span{white-space:nowrap}.acts .share{margin-left:auto;padding:8px 6px}
.cap{margin:0;padding:0 16px 14px;font-size:14px;line-height:21px;overflow-wrap:anywhere}.cap em{font-style:normal;color:#1D4ED8}
.fab{position:absolute;right:16px;bottom:20px;width:56px;height:56px;border-radius:50%;background:var(--brand);color:#fff;font-size:26px;box-shadow:0 4px 12px rgba(0,0,0,.2)}
"""


def post(i, name, time, caption):
    return f"""<div class="post"><div class="ph"><img class="av" src="av{i}.png" alt="{name}"><div class="who"><b>{name}</b><span>{time}</span></div><button class="follow">팔로우</button></div>
<img class="pic" src="pic{i}.png" alt="{name}의 사진"><div class="acts"><span class="like">좋아요 1,284</span><span class="cmt">댓글 56</span><span class="share">공유</span></div><p class="cap">{caption}</p></div>"""


FEED_OK = f"""<div class="top"><span class="ttl">피드</span></div><div class="list">
{post(1, '산책하는곰', '1시간 전', '한강 노을 <em>#주말나들이추천코스서울근교당일치기여행지노을맛집총정리</em> <em>#노을</em>')}
{post(2, '오늘의빵', '3시간 전', '새로 나온 무화과 깜파뉴 <em>#빵스타그램</em>')}
{post(3, '하늘공방', '어제', '성수동 공방 투어 <em>#공방</em>')}</div>
<button class="fab" aria-label="글쓰기">+</button>"""

# ── 3. 지도 검색 ─────────────────────────────────────────
MAP_PAL = {"bg": "#FFFFFF", "page": "#E8EBEF", "text": "#1B1F24", "muted": "#59616B", "line": "#E2E5E9", "brand": "#03A84E"}
MAP_CSS = """
.search{flex:none;display:flex;gap:8px;padding:10px 12px;background:#fff;border-bottom:1px solid var(--line)}.search input{flex:1;min-width:0;height:44px;border-radius:10px;border:1px solid var(--line);padding:0 12px;font-size:15px;font-family:inherit}
.search button{height:44px;padding:0 10px;background:transparent;font-size:15px;color:var(--muted)}
.map{flex:1;position:relative;background:linear-gradient(90deg,rgba(0,0,0,.05) 1px,transparent 1px) 0 0/40px 40px,linear-gradient(rgba(0,0,0,.05) 1px,transparent 1px) 0 0/40px 40px,#EEF3EC}
.pin{position:absolute;display:flex;align-items:center;gap:6px}.pin i{width:14px;height:14px;border-radius:50%;background:var(--brand);border:3px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.pin span{font-size:12px;font-weight:700;background:#fff;padding:2px 6px;border-radius:6px;white-space:nowrap}
.fbtns{position:absolute;right:12px;bottom:calc(36% + 12px);display:flex;flex-direction:column;gap:8px}
.fbtns button{width:44px;height:44px;border-radius:12px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.2);font-size:20px}
.sheet{position:absolute;left:0;right:0;bottom:0;height:36%;background:#fff;border-radius:16px 16px 0 0;box-shadow:0 -2px 10px rgba(0,0,0,.12);display:flex;flex-direction:column}
.handle{width:36px;height:5px;border-radius:3px;background:#D5D9DE;margin:8px auto}
.places{flex:1;overflow-y:auto}.place{padding:10px 16px;border-bottom:1px solid var(--line)}
.place b{display:block;font-size:15px;line-height:21px}.place span{display:block;font-size:13px;line-height:18px;color:var(--muted)}
"""
MAP_OK = """<div class="search"><input placeholder="장소, 주소 검색" value="카페"><button>취소</button></div>
<div class="map"><div class="pin" style="left:24%;top:18%"><i></i><span>모모커피</span></div><div class="pin" style="left:30%;top:28%"><i></i><span>숲속로스터리 망원점</span></div><div class="pin" style="left:18%;top:42%"><i></i><span>카페 온</span></div>
<div class="fbtns"><button aria-label="확대">+</button><button aria-label="축소">−</button><button aria-label="내 위치">◎</button></div>
<div class="sheet"><div class="handle"></div><div class="places">
<div class="place"><b>숲속로스터리 망원점</b><span>카페 · 320m</span><span>서울 마포구 망원로 12길 34, 1층</span></div>
<div class="place"><b>모모커피</b><span>카페 · 450m</span><span>서울 마포구 포은로 8</span></div>
<div class="place"><b>카페 온</b><span>카페 · 610m</span><span>서울 마포구 성미산로 22</span></div></div></div></div>"""

# ── 4. 예약 캘린더 ───────────────────────────────────────
BOOK_PAL = {"bg": "#FFFFFF", "page": "#EEF0F4", "text": "#141A23", "muted": "#566070", "line": "#E1E5EB", "brand": "#5B3CC4"}
BOOK_CSS = """
.body{flex:1;min-height:0;overflow-y:auto;padding:12px 16px 0}
.mon{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.mon b{font-size:18px}.mon button{width:44px;height:44px;border-radius:10px;background:#F2F3F6;font-size:18px}
.cal{width:100%}.wk,.days{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}
.wk span{font-size:12px;color:var(--muted);padding:4px 0}
.days button{height:40px;border-radius:10px;background:#fff;font-size:15px;color:var(--text);min-width:0}.days button.on{background:var(--brand);color:#fff;font-weight:700}
.days button.past{color:#6B7280}
.slots{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}.slot{height:40px;padding:0 14px;border-radius:20px;border:1px solid var(--line);background:#fff;font-size:14px;white-space:nowrap}
.slot.on{border-color:var(--brand);color:var(--brand);font-weight:700}
.req{display:block;font-size:14px;font-weight:600;margin-bottom:12px}.req textarea{display:block;width:100%;height:88px;margin-top:6px;border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit;font-weight:400}
.sum{margin:0 0 12px;font-size:14px;color:var(--muted)}.sum b{color:var(--text)}
.ok{flex:none;margin:8px 16px 16px;height:54px;border-radius:14px;background:var(--brand);color:#fff;font-size:17px;font-weight:700}
"""
DAYS = "".join(f'<button class="{"past" if d < 10 else ""}{" on" if d == 17 else ""}">{d}</button>' for d in range(1, 32))
BOOK_OK = f"""<div class="top"><span class="ttl">예약</span></div><div class="body">
<div class="mon"><button aria-label="이전 달">‹</button><b>2026년 10월</b><button aria-label="다음 달">›</button></div>
<div class="cal"><div class="wk"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span></div><div class="days"><span></span><span></span><span></span><span></span>{DAYS}</div></div>
<div class="slots"><button class="slot">10:00</button><button class="slot on">10:30</button><button class="slot">11:00</button><button class="slot">11:30</button><button class="slot">13:30</button><button class="slot">14:00</button><button class="slot">15:00</button><button class="slot">16:30</button><button class="slot">17:00</button><button class="slot">18:30</button></div>
<label class="req">요청 사항<textarea placeholder="예: 앞머리만 다듬어 주세요"></textarea></label>
<p class="sum"><span class="sl">선택한 시간</span> <b>10월 17일(토) 10:30 · 디자이너 지수</b></p></div>
<button class="ok">예약 확정</button>"""

# ── 5. 결제 영수증 ───────────────────────────────────────
RC_PAL = {"bg": "#FFFFFF", "page": "#EDF0F2", "text": "#121417", "muted": "#59606B", "line": "#E5E8EB", "brand": "#0E7A4F"}
RC_CSS = """
.safe{flex:none;height:env(safe-area-inset-top,0px)}
.body{flex:1;min-height:0;overflow-y:auto;padding:24px 20px}
.head{position:relative;padding-right:84px}.head h1{margin:0;font-size:22px;line-height:30px}.badge{position:absolute;right:0;top:2px;height:26px;padding:0 10px;border-radius:13px;background:#E7F6EE;color:var(--brand);font-size:13px;font-weight:700;display:flex;align-items:center}
.amt{margin:12px 0 18px;font-size:34px;line-height:42px;font-weight:800;white-space:nowrap}
.rows{border-top:1px solid var(--line)}.r{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);font-size:14px}
.r span{color:var(--muted);flex:none}.r b{font-weight:600;text-align:right;min-width:0;overflow-wrap:anywhere}
.bar{display:block;width:100%;height:auto;aspect-ratio:4/1;object-fit:contain;margin:18px 0 6px}
.cap{margin:0;text-align:center;font-size:12px;color:var(--muted)}
.actions{flex:none;display:flex;gap:8px;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line)}
.actions button{flex:1;height:52px;border-radius:12px;font-size:16px;font-weight:700;background:#F1F3F5;color:var(--text)}.actions .main{background:var(--brand);color:#fff}
"""
RC_OK = """<div class="safe"></div><div class="top"><span class="ttl">결제 완료</span></div><div class="body">
<div class="head"><h1>결제가 정상적으로 완료되었어요</h1><span class="badge">결제 완료</span></div>
<div class="amt">₩1,234,000</div>
<div class="rows"><div class="r"><span>결제 수단</span><b>신한카드 (1234)</b></div><div class="r"><span>승인 번호</span><b>A00000000012345678902026101015420199</b></div><div class="r"><span>결제 일시</span><b>2026-10-10 15:42</b></div><div class="r"><span>가맹점</span><b>그린가전 홍대점</b></div></div>
<img class="bar" src="barcode.png" alt="영수증 바코드"><p class="cap">매장에서 바코드를 보여 주세요</p></div>
<div class="actions"><button>영수증 저장</button><button class="main">확인</button></div>"""

# ── 6. 데스크톱 랜딩 ─────────────────────────────────────
LAND_PAL = {"bg": "#FFFFFF", "page": "#FFFFFF", "text": "#0F172A", "muted": "#475569", "line": "#E2E8F0", "brand": "#2563EB", "surface": "#F8FAFC"}
LAND_CSS = """
.app{max-width:none;height:100vh;overflow-y:auto;display:block}
.nav{height:64px;display:flex;align-items:center;gap:24px;padding:0 40px;border-bottom:1px solid var(--line)}.nav b{font-size:20px;margin-right:auto}
.nav a{font-size:15px;color:var(--muted);text-decoration:none;min-height:44px;display:inline-flex;align-items:center}.nav button{height:40px;padding:0 16px;border-radius:10px;background:var(--brand);color:#fff;font-size:15px;font-weight:600}
.hero{padding:72px 40px 56px;text-align:center}.hero h1{margin:0 auto 16px;max-width:900px;font-size:48px;line-height:58px;letter-spacing:-1px}
.hero p{margin:0 auto 28px;max-width:640px;font-size:18px;line-height:28px;color:var(--muted)}.hero .cta{height:52px;padding:0 24px;border-radius:12px;background:var(--brand);color:#fff;font-size:17px;font-weight:700}
.feat{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px;padding:0 40px 56px}
.card{border:1px solid var(--line);border-radius:16px;padding:24px;background:#fff}.card i{display:block;width:40px;height:40px;border-radius:10px;background:#DBEAFE;margin-bottom:14px}
.card h3{margin:0 0 8px;font-size:18px}.card p{margin:0;font-size:15px;line-height:23px;color:var(--muted)}
.price{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;padding:0 40px 56px}
.plan{border:1px solid var(--line);border-radius:16px;padding:24px}.plan b{display:block;font-size:16px}.plan strong{display:block;font-size:30px;margin:8px 0 12px}
.plan ul{margin:0;padding-left:18px;font-size:14px;line-height:24px;color:var(--muted)}
.foot{background:var(--surface);padding:28px 40px;font-size:13px;line-height:20px;color:var(--muted)}
"""
LAND_OK = """<nav class="nav"><b>플로우보드</b><a href="#">기능</a><a href="#">요금제</a><a href="#">고객 사례</a><button>무료로 시작</button></nav>
<section class="hero"><h1>회의록부터 할 일까지, 팀의 흐름을 한 화면에서</h1><p>흩어진 문서와 메신저를 오가지 않아도 됩니다. 플로우보드가 결정과 할 일을 자동으로 정리합니다.</p><button class="cta">14일 무료 체험</button></section>
<section class="feat"><div class="card"><i></i><h3>회의 요약</h3><p>회의가 끝나면 결정 사항과 담당자를 자동으로 정리해요.</p></div><div class="card"><i></i><h3>할 일 연결</h3><p>메신저에서 나온 할 일을 보드로 바로 옮겨요.</p></div><div class="card"><i></i><h3>주간 보고</h3><p>한 주의 진행 상황을 한 장으로 만들어 공유해요.</p></div></section>
<section class="price"><div class="plan"><b>스타터</b><strong>무료</strong><ul><li>팀원 5명까지</li><li>보드 3개</li><li>회의 요약 월 10회</li></ul></div><div class="plan"><b>팀</b><strong>₩9,900</strong><ul><li>팀원 50명까지</li><li>보드 무제한</li><li>회의 요약 무제한</li><li>주간 보고 자동 생성</li></ul></div><div class="plan"><b>엔터프라이즈</b><strong>문의</strong><ul><li>SSO·감사 로그</li><li>전담 매니저</li></ul></div></section>
<footer class="foot">© 2026 플로우보드 · 서울특별시 마포구 · 사업자등록번호 000-00-00000 · 고객센터 1588-0000</footer>"""

SCREENS = {
    "login": ("로그인", LOGIN_PAL, LOGIN_CSS, LOGIN_OK, M5),
    "feed": ("피드", FEED_PAL, FEED_CSS, FEED_OK, M5),
    "map": ("지도 검색", MAP_PAL, MAP_CSS, MAP_OK, M5),
    "booking": ("예약", BOOK_PAL, BOOK_CSS, BOOK_OK, M5),
    "receipt": ("결제 완료", RC_PAL, RC_CSS, RC_OK, M5 + N3),
    "landing": ("플로우보드", LAND_PAL, LAND_CSS, LAND_OK, W4),
}

# (화면, 변형, 유형, 설명, 추가 CSS, 마크업 바꾸기, 확인 크기, 정답 측정, 글자 힌트)
# 유형: R1~R7·A1·A2·D4는 dqa에 규칙이 있는 종류, S3(포커스 표시)·D3(글자 스타일)·F1(크기 방식 Fill/Fixed)·L1(정렬)은 규칙 밖
V = [
    ("login", "r2-error", "R2", "오류 문구 칸 높이를 한 줄(20px)로 고정하고 넘침을 숨겨 두 번째 줄이 잘림", ".err{height:20px;overflow:hidden}", [], M5, {"type": "clipped_text", "sel": ".err"}, ["이메일 또는 비밀번호"]),
    ("login", "a1-eye", "A1", "비밀번호 보기 버튼을 아이콘 크기(18px)로 줄임", ".eye{width:18px;height:18px;top:15px;right:12px}.eye i{width:12px;height:8px}", [], M5, {"type": "target", "sel": ".eye", "min": 24}, ["비밀번호 보기"]),
    ("login", "r1-social", "R1", "간편 로그인 버튼 세 개를 한 줄로 바꾸면서 줄바꿈을 막아 좁은 화면에서 밖으로 넘침", ".social{flex-direction:row;flex-wrap:nowrap}.social button{flex:none}", [], M5, {"type": "overflow", "sel": ".social"}, ["Apple로", "네이버로", "카카오로"]),
    ("login", "a2-terms", "A2", "약관 안내 글자를 #BDBDBD로 옅게 함", ".terms{color:#BDBDBD}", [], M5, {"type": "contrast", "sel": ".terms", "min": 4.5}, ["계속하면"]),
    ("login", "s3-focus", "S3", "입력칸의 포커스 표시를 지워(outline:none만 남김) 키보드로 어디에 있는지 안 보임", ".f input:focus{border-color:var(--line);box-shadow:none}", [], ["375x812"], {"type": "focus_ring", "sel": "#em"}, ["이메일"]),
    ("feed", "d4-avatar", "D4", "프로필 사진 높이만 28px로 바꾸고 object-fit을 fill로 둬 찌그러짐", ".av{height:28px;object-fit:fill;border-radius:6px}", [], M5, {"type": "img_ratio", "sel": ".av"}, ["하늘공방", "오늘의빵", "산책하는곰"]),
    ("feed", "r1-tag", "R1", "본문에 word-break:keep-all을 주고 단어 끊기를 빼 긴 해시태그가 화면 밖으로 넘침", ".cap{overflow-wrap:normal;word-break:keep-all}", [], M5, {"type": "overflow_text", "sel": ".cap"}, ["주말나들이추천코스"]),
    ("feed", "r3-count", "R3", "좋아요 수를 절대 위치로 옮기면서 댓글 수 자리를 덜 비워 둘이 겹침", ".acts .like{position:absolute;left:16px}.acts .cmt{margin-left:40px}", [], M5, {"type": "overlap_text", "sel": ".acts .like", "other": ".acts .cmt"}, ["좋아요", "댓글"]),
    ("feed", "r4-fab", "R4", "목록 아래 여백을 없애 끝까지 내려도 마지막 글의 공유 버튼이 글쓰기 버튼에 가려짐", ".list{padding-bottom:0}", [], M5, {"type": "covered", "sel": ".post:last-child .share", "scroll": ".list"}, ["공유"]),
    ("feed", "d3-name", "D3", "작성자 이름을 시안의 굵게(700) 대신 보통(400)으로 씀", ".who b{font-weight:400}", [], ["375x812"], {"type": "style", "sel": ".who b", "prop": "font-weight", "value": "700"}, ["하늘공방"]),
    ("map", "a1-zoom", "A1", "지도 확대·축소 버튼을 20px로 줄임", ".fbtns button{width:20px;height:20px;font-size:12px;border-radius:5px}", [], M5, {"type": "target", "sel": ".fbtns button", "min": 24}, ["확대", "축소", "내 위치"]),
    ("map", "r2-place", "R2", "장소 항목 높이를 두 줄 몫(56px)으로 고정하고 넘침을 숨겨 주소 줄이 잘림", ".place{height:56px;overflow:hidden}", [], M5, {"type": "clipped_parent", "sel": ".place span:last-child"}, ["서울 마포구"]),
    ("map", "r3-pin", "R3", "긴 장소 이름 핀을 오른쪽에 두어 좁은 화면에서 지도 버튼과 겹침", "", [('style="left:30%;top:28%"', 'style="left:58%;top:62%"')], M5, {"type": "overlap_text", "sel": ".pin span", "other": ".fbtns button"}, ["숲속로스터리"]),
    ("map", "r4-sheet", "R4", "아래 시트를 60%로 키우면서 지도 버튼 위치를 안 옮겨 버튼이 시트에 가려짐", ".sheet{height:60%}", [], M5, {"type": "covered", "sel": ".fbtns button:last-child", "scroll": ".places"}, ["내 위치", "축소", "확대"]),
    ("booking", "r1-grid", "R1", "날짜 칸을 46px로 고정해 좁은 화면에서 달력이 밖으로 넘침", ".days{grid-template-columns:repeat(7,46px);gap:0}.wk{grid-template-columns:repeat(7,46px);gap:0}", [], M5, {"type": "overflow", "sel": ".days"}, ["31", "30", "토"]),
    ("booking", "r6-slot", "R6", "시간 칩 폭을 44px로 고정하고 글자 끊기를 허용해 '13:30'이 꺾임", ".slot{width:44px;padding:0 4px;white-space:normal;word-break:break-all;height:auto;min-height:40px}", [], M5, {"type": "lines", "sel": ".slot"}, ["10:00", "13:30"]),
    ("booking", "r4-confirm", "R4", "본문 스크롤을 빼(overflow:visible) 짧은 화면에서 예약 확정 버튼이 화면 밖으로 밀림", ".body{overflow:visible;flex:none}", [], M5, {"type": "offscreen", "sel": ".ok"}, ["예약 확정"]),
    ("booking", "a2-label", "A2", "'선택한 시간' 라벨을 #B8BEC7로 옅게 함", ".sum .sl{color:#B8BEC7}", [], M5, {"type": "contrast", "sel": ".sum .sl", "min": 4.5}, ["선택한 시간"]),
    ("booking", "f1-cal", "F1", "달력 폭을 시안의 Fill 대신 고정 343px로 써 큰 화면에서 오른쪽이 빔", ".cal{width:343px}", [], ["430x932", "390x844"], {"type": "fill_width", "sel": ".cal"}, []),
    ("receipt", "r4-safe", "R4", "아래 버튼 줄의 안전영역 여백을 빼 홈 인디케이터 자리에 버튼이 들어감", ".actions{padding-bottom:10px}", [], N3, {"type": "safe_bottom", "sel": ".actions button"}, ["확인", "영수증 저장"]),
    ("receipt", "d4-barcode", "D4", "바코드 그림 높이를 120px로 고정하고 object-fit을 fill로 둬 늘어남", ".bar{height:120px;aspect-ratio:auto;object-fit:fill}", [], M5, {"type": "img_ratio", "sel": ".bar"}, ["영수증 바코드"]),
    ("receipt", "r6-amount", "R6", "금액에 글자 끊기를 허용해 좁은 화면에서 '₩1,234,000'이 꺾임", ".amt{white-space:normal;word-break:break-all;font-size:58px;line-height:64px}", [], M5, {"type": "lines", "sel": ".amt"}, ["₩1,234,000"]),
    ("receipt", "r3-badge", "R3", "제목 오른쪽 여백을 빼 좁은 화면에서 제목이 '결제 완료' 배지와 겹침", ".head{padding-right:0}.head h1{white-space:nowrap}", [], M5, {"type": "overlap_text", "sel": ".head h1", "other": ".badge"}, ["결제가 완료"]),
    ("receipt", "r1-approval", "R1", "승인 번호의 단어 끊기를 빼 긴 번호가 화면 밖으로 넘침", ".r b{overflow-wrap:normal}.r span{flex:none}", [], M5, {"type": "overflow_text", "sel": ".r b"}, ["A0000000001234567890"]),
    ("landing", "r1-hero", "R1", "히어로 제목에 줄바꿈을 막아 좁은 창에서 화면 밖으로 넘침", ".hero h1{white-space:nowrap;max-width:none}", [], W4, {"type": "overflow_text", "sel": ".hero h1"}, ["회의록부터"]),
    ("landing", "r3-cards", "R3", "기능 카드에 시안 폭 400px를 고정해 좁은 창에서 3열 칸보다 넓어져 옆 카드와 겹침", ".feat{grid-template-columns:repeat(3,minmax(0,1fr))}.card{width:400px}", [], W4, {"type": "overlap_text", "sel": ".card h3, .card p", "other": ".card"}, ["회의 요약", "할 일 연결", "주간 보고"]),
    ("landing", "a2-foot", "A2", "바닥글 글자를 #A0A8B4로 옅게 함", ".foot{color:#A0A8B4}", [], W4, {"type": "contrast", "sel": ".foot", "min": 4.5}, ["플로우보드"]),
    ("landing", "r2-plan", "R2", "요금제 칸 높이를 고정하고 넘침을 숨겨 기능 목록 끝이 잘림", ".plan{height:150px;overflow:hidden}", [], W4, {"type": "clipped_parent", "sel": ".plan li"}, ["주간 보고 자동", "회의 요약 무제한"]),
    ("landing", "a1-nav", "A1", "위 메뉴 링크의 최소 높이를 지워 글자 높이(18px)만 남김", ".nav a{min-height:0;font-size:13px;line-height:16px}", [], W4, {"type": "target", "sel": ".nav a", "min": 24}, ["기능", "요금제", "고객 사례"]),
    ("landing", "l1-titles", "L1", "두 번째 기능 카드 아이콘 아래 여백만 22px로 달라 제목 줄이 8px 어긋남", ".card:nth-child(2) i{margin-bottom:22px}", [], ["1280x800"], {"type": "align_top", "sel": ".card h3"}, ["할 일 연결"]),
]


def images(d, screen):
    def img(name, w, h, c1, c2, kind):
        im = Image.new("RGB", (w, h), c1); dr = ImageDraw.Draw(im)
        if kind == "bars":
            x = 20
            for k in range(60): wv = 2 + (k * 7) % 5; dr.rectangle([x, 10, x + wv, h - 10], fill=c2); x += wv + 3 + (k * 3) % 4
        elif kind == "photo":
            dr.rectangle([0, h * 0.6, w, h], fill=c2); dr.ellipse([w * 0.6, h * 0.15, w * 0.8, h * 0.15 + w * 0.2], fill="#F6C343")
        else:
            dr.ellipse([w * 0.15, h * 0.15, w * 0.85, h * 0.85], fill=c2)
        im.save(d / name)
    if screen == "feed":
        for i, (a, b) in enumerate([("#FDE2E4", "#E5989B"), ("#E2ECE9", "#6B9080"), ("#E3E8F8", "#5C6BC0")], 1):
            img(f"av{i}.png", 96, 96, a, b, "dot"); img(f"pic{i}.png", 800, 600, a, b, "photo")
    if screen == "receipt": img("barcode.png", 600, 150, "#FFFFFF", "#111111", "bars")


def main():
    cases = []
    for scr, (title, pal, css, ok, sizes) in SCREENS.items():
        d = OUT / scr / "ok"; d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(f"{title} · ok", pal, css, ok)); images(d, scr)
        cases.append({"id": f"blind-{scr}-ok", "screen": scr, "variant": "ok", "code": None, "defect": "맞게 만든 구현", "dir": f"eval/synth/blind/screens/{scr}/ok", "sizes": sizes, "check": None, "hint": []})
    for scr, var, code, desc, extra, subs, sizes, check, hint in V:
        title, pal, css, ok, _ = SCREENS[scr]
        html = ok
        for a, b in subs:
            assert html.count(a) == 1, (scr, var, a)
            html = html.replace(a, b)
        d = OUT / scr / var; d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(f"{title} · {var}", pal, css + extra, html)); images(d, scr)
        cases.append({"id": f"blind-{scr}-{var}", "screen": scr, "variant": var, "code": code, "defect": desc, "dir": f"eval/synth/blind/screens/{scr}/{var}", "sizes": sizes, "check": check, "hint": hint})
    (HERE / "cases.json").write_text(json.dumps({"note": "블라인드 합성 예제(10-10). dqa 규칙 3fae9f3 고정, 한 번만 잰다. 규칙 밖 유형: S3 포커스 표시, D3 글자 스타일, F1 크기 방식, L1 정렬.", "frozen_rules_commit": "3fae9f3", "cases": cases}, ensure_ascii=False, indent=1) + "\n")
    print(f"화면 {len(SCREENS)}개, 결함 {len(V)}개, 유형 {sorted({v[2] for v in V})}")


if __name__ == "__main__":
    main()
