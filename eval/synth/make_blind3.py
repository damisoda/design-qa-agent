"""블라인드 합성 예제 3묶음(10-10). 블라인드 2에서 드러난 빈틈을 고친 뒤의 일반화를 잰다.
dqa 규칙 파일을 고정(cases.json의 frozen_rules_sha1)한 채, 앞선 18개 앱과 겹치지 않는 새 앱 6종에 결함을 하나씩 심는다. 한 번만 잰다.
결함은 바이브코딩에서 흔한 실수에서 골랐다. 규칙 밖 종류(크기 방식, 정렬 2, 글자 크기, 간격, 모서리)도 섞는다.
맞게 만든 화면에도 실제 앱에서 흔한 구성(그림 위에 얹은 글자, 겹쳐 쌓은 아바타, 가로 스크롤, 열린 드롭다운, 아이콘이 섞인 버튼, 반투명 카드)을 넣어 오탐을 잰다.
화면: recipe(레시피), todo(할 일), lecture(동영상 강의), estate(부동산 매물), weather(날씨), kanban(데스크톱 칸반)
사용: python3 eval/synth/make_blind3.py  → eval/synth/blind3/screens/<화면>/<변형>/index.html, eval/synth/blind3/cases.json
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw
from make_synth import page, M5, W4, N3

HERE = Path(__file__).resolve().parent / "blind3"
OUT = HERE / "screens"
M5T = M5 + ["768x1024"]  # 태블릿 폭에서는 폰 크기 앱 틀(430)이 가운데에 놓인다


def ic(kind, color="#222222"):
    paths = {
        "back": '<path d="M15 5l-7 7 7 7"/>',
        "share": '<path d="M12 3v12M7 8l5-5 5 5M5 14v5h14v-5"/>',
        "heart": '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
        "filter": '<path d="M4 6h16M7 12h10M10 18h4"/>',
        "download": '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
        "phone": '<path d="M6 3h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
        "chev": '<path d="M6 9l6 6 6-6"/>',
        "refresh": '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/>',
        "plus": '<path d="M12 5v14M5 12h14"/>',
        "sun": '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
        "cloud": '<path d="M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 2A3 3 0 0 0 7 18z"/>',
    }
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{paths[kind]}</svg>'


# ── 1. 레시피 ────────────────────────────────────────────
RC_PAL = {"bg": "#FFFFFF", "page": "#EFEDEA", "text": "#1C1A17", "muted": "#615B53", "line": "#E7E3DD", "brand": "#C2410C"}
RC_CSS = """
.body{flex:1;overflow-y:auto;padding-bottom:150px}
.hero{position:relative}.food{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}
.hero .time{position:absolute;left:12px;bottom:12px;background:rgba(0,0,0,.62);color:#fff;font-size:13px;line-height:18px;font-weight:700;padding:4px 10px;border-radius:12px}
.head{padding:16px 20px 8px}.head h1{margin:0;font-size:22px;line-height:30px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.chips span{font-size:13px;line-height:18px;padding:4px 10px;border-radius:12px;background:#F5F1EC;color:var(--muted)}
.serv{display:flex;align-items:center;gap:12px;margin:8px 20px 4px;padding:10px 14px;border:1px solid var(--line);border-radius:12px}
.serv .l{flex:1;font-size:15px;font-weight:600}
.serv button{width:36px;height:36px;border-radius:18px;border:1px solid var(--line);background:#fff;font-size:18px;color:var(--text);flex:none}
.serv b{min-width:40px;text-align:center;font-size:16px;white-space:nowrap}
.body h2{margin:20px 20px 8px;font-size:17px}
.ing{list-style:none;margin:0;padding:0 20px}
.ing li{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line);font-size:15px;line-height:21px}
.ing li span{flex:1;min-width:0}.ing li b{flex:none;font-weight:600}
.steps{list-style:none;margin:0;padding:0 20px}
.steps li{display:flex;gap:12px;padding:10px 0}
.steps i{flex:none;width:28px;height:28px;border-radius:14px;background:var(--brand);color:#fff;font-style:normal;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center}
.steps p{margin:3px 0 0;font-size:15px;line-height:23px}
.timer{position:absolute;left:16px;right:16px;bottom:84px;height:48px;border-radius:24px;background:#1C1A17;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 6px 0 18px;font-size:14px}
.timer button{height:36px;padding:0 14px;border-radius:18px;background:#fff;color:#1C1A17;font-size:14px;font-weight:700}
.bar{position:absolute;left:0;right:0;bottom:0;height:72px;display:flex;align-items:center;gap:10px;padding:0 16px;background:#fff;border-top:1px solid var(--line)}
.bar .like{width:48px;height:48px;border-radius:12px;border:1px solid var(--line);background:#fff;flex:none;display:flex;align-items:center;justify-content:center}.bar .like svg{width:22px;height:22px}
.bar .start{flex:1;height:48px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700}
"""
RC_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{ic('back')}</button><span class="ttl">레시피</span><button class="icon" aria-label="공유">{ic('share')}</button></div>
<div class="body"><div class="hero"><img class="food" src="pasta.png" alt="바질 토마토 파스타 사진"><span class="time">20분</span></div>
<div class="head"><h1>바질 토마토 파스타</h1><div class="chips"><span>2인분 기준</span><span>난이도 쉬움</span><span>냄비 하나</span></div></div>
<div class="serv"><span class="l">인분</span><button aria-label="1인분 줄이기">−</button><b>2인분</b><button aria-label="1인분 늘리기">+</button></div>
<h2>재료</h2><ul class="ing"><li><span>스파게티면</span><b>200g</b></li><li><span>방울토마토</span><b>12개</b></li><li><span>마늘</span><b>4쪽</b></li><li><span>엑스트라 버진 올리브유(없으면 카놀라유나 포도씨유)</span><b>3큰술</b></li><li><span>생 바질</span><b>한 줌</b></li><li><span>파르메산 치즈</span><b>30g</b></li></ul>
<h2>만드는 법</h2><ol class="steps"><li><i>1</i><p>냄비에 물을 끓이고 소금을 한 숟갈 넣은 뒤 면을 8분 삶아요.</p></li><li><i>2</i><p>마늘을 얇게 썰어 올리브유에 약한 불로 볶아요.</p></li><li><i>3</i><p>방울토마토를 반으로 잘라 넣고 살짝 으깨질 때까지 볶아요.</p></li><li><i>4</i><p>삶은 면과 면수 반 컵을 넣고 섞은 뒤 바질과 치즈를 올려요.</p></li></ol></div>
<div class="timer"><span>다음 단계까지 03:12</span><button>일시정지</button></div>
<div class="bar"><button class="like" aria-label="찜하기">{ic('heart')}</button><button class="start">요리 시작</button></div>"""

# ── 2. 할 일 ─────────────────────────────────────────────
TD_PAL = {"bg": "#FFFFFF", "page": "#EEF0F3", "text": "#15181C", "muted": "#5A616B", "line": "#E2E5E9", "brand": "#4F46E5"}
TD_CSS = """
.top .flt{display:flex;align-items:center;gap:6px;height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:#fff;font-size:14px;color:var(--text);flex:none}.top .flt svg{width:16px;height:16px;flex:none}
.prog{flex:none;margin:12px 16px 8px;padding:14px 16px;border-radius:14px;background:#EEF2FF}
.prog p{margin:0 0 8px;font-size:14px;line-height:20px;color:#3730A3}.prog p b{font-size:16px}
.pbar{height:6px;border-radius:3px;background:#C7D2FE;position:relative}.pbar i{position:absolute;left:0;top:0;bottom:0;width:40%;border-radius:3px;background:var(--brand)}
.filters{flex:none;display:flex;gap:6px;padding:0 16px 8px;overflow-x:auto}
.filters button{flex:none;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--line);background:#fff;font-size:14px;color:var(--text);white-space:nowrap}.filters .on{background:var(--text);color:#fff;border-color:var(--text)}
.list{flex:1;overflow-y:auto;padding:0 16px 96px}
.list h2{margin:12px 0 6px;font-size:14px;line-height:20px;color:var(--muted)}
.it{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 12px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;background:#fff}
.it input{width:20px;height:20px;margin:0;flex:none;accent-color:var(--brand)}
.it .t{flex:1;min-width:0;font-size:15px;line-height:21px}
.it .due{flex:none;font-size:12px;line-height:16px;color:var(--muted)}
.it.done .t{text-decoration:line-through;color:var(--muted)}
.pri{flex:none;font-size:11px;line-height:16px;font-weight:700;padding:2px 6px;border-radius:6px;background:#FEE2E2;color:#991B1B}
.fab{position:absolute;right:16px;bottom:20px;width:56px;height:56px;border-radius:28px;background:var(--brand);color:#fff;font-size:26px;box-shadow:0 4px 12px rgba(0,0,0,.2)}
"""


def it(title, due, done=False, pri=None):
    return f'<label class="it{" done" if done else ""}"><input type="checkbox" aria-label="완료 표시"{" checked" if done else ""}><span class="t">{title}</span>{f"<span class=pri>{pri}</span>" if pri else ""}<span class="due">{due}</span></label>'


TD_OK = f"""<div class="top"><span class="ttl">오늘 할 일</span><button class="flt">{ic('filter')}필터</button></div>
<div class="prog"><p><b>5개</b> 중 2개 완료</p><div class="pbar"><i></i></div></div>
<div class="filters"><button class="on">전체</button><button>업무</button><button>개인</button><button>장보기</button><button>운동</button><button>공부</button><button>가족</button><button>취미</button></div>
<div class="list"><h2>오전</h2>{it('아침 스트레칭 10분', '오전 7시', True)}{it('분기 보고서 초안을 팀장님께 보내고 피드백 반영 일정 잡기', '오전 11시', pri='높음')}
<h2>오후</h2>{it('장보기: 우유, 달걀, 방울토마토', '오후 6시')}{it('헬스장 PT 예약 확인', '오후 7시')}{it('치과 예약 변경 전화', '오후 2시', True)}</div>
<button class="fab" aria-label="할 일 추가">+</button>"""

# ── 3. 동영상 강의 ───────────────────────────────────────
LC_PAL = {"bg": "#FFFFFF", "page": "#ECEEF1", "text": "#14171C", "muted": "#5B6370", "line": "#E2E5EA", "brand": "#0F766E"}
LC_CSS = """
.body{flex:1;overflow-y:auto;padding-bottom:88px}
.player{position:relative;background:#000}.poster{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}
.play{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:32px;background:rgba(255,255,255,.92);font-size:22px;color:#111}
.chap{position:absolute;left:12px;top:10px;font-size:13px;line-height:18px;font-weight:700;color:#fff;padding:4px 10px;border-radius:6px;background:rgba(0,0,0,.55)}
.dur{position:absolute;right:8px;bottom:12px;font-size:12px;line-height:16px;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.72);color:#fff}
.prog{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.35)}.prog i{position:absolute;left:0;top:0;bottom:0;width:35%;background:var(--brand)}
.info{padding:14px 20px 4px}.info h1{margin:0;font-size:20px;line-height:28px}
.who{display:flex;align-items:center;gap:10px;margin-top:12px}.who img{width:36px;height:36px;border-radius:18px;flex:none}
.who .nm{flex:1;min-width:0}.who b{display:block;font-size:14px;line-height:20px}.who span{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.who .follow{flex:none;height:34px;padding:0 14px;border-radius:17px;background:var(--brand);color:#fff;font-size:13px;font-weight:700}
.tabs{display:flex;border-bottom:1px solid var(--line);margin-top:12px;padding:0 8px}.tabs a{flex:1;text-align:center;padding:12px 0;font-size:14px;color:var(--muted);text-decoration:none}.tabs .on{color:var(--text);font-weight:700;box-shadow:inset 0 -2px 0 var(--text)}
.desc{margin:12px 20px 0;font-size:14px;line-height:22px}
.files{display:flex;align-items:center;gap:8px;margin:12px 20px 0;padding:6px 6px 6px 12px;border:1px solid var(--line);border-radius:10px;font-size:14px}.files span{flex:1;min-width:0}
.files a{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex:none}.files a svg{width:20px;height:20px}
.chs{margin:12px 0 0}
.ch{display:flex;align-items:center;gap:12px;padding:12px 20px;border-top:1px solid var(--line);color:var(--text);text-decoration:none}
.ch .no{flex:none;width:28px;font-size:13px;font-weight:700;color:var(--muted)}.ch .nm{flex:1;min-width:0;font-size:14px;line-height:20px}.ch time{flex:none;font-size:12px;line-height:16px;color:var(--muted);white-space:nowrap}
.ch.cur{background:#F0FDFA}.ch.cur .nm{font-weight:700}
.next{position:absolute;left:0;right:0;bottom:0;height:72px;display:flex;align-items:center;padding:0 16px;background:#fff;border-top:1px solid var(--line)}.next button{flex:1;height:48px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700}
"""


def ch(no, name, t, cur=False):
    return f'<a class="ch{" cur" if cur else ""}" href="#"><span class="no">{no}</span><span class="nm">{name}</span><time>{t}</time></a>'


LC_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{ic('back')}</button><span class="ttl">강의</span></div>
<div class="body"><div class="player"><img class="poster" src="poster.png" alt="강의 표지: 피그마로 시작하는 UI 디자인"><button class="play" aria-label="재생">▶</button><span class="chap">1강 · 강의 소개</span><span class="dur">12:34</span><div class="prog"><i></i></div></div>
<div class="info"><h1>피그마로 시작하는 UI 디자인 기초</h1><div class="who"><img src="teacher.png" alt="강사 사진"><div class="nm"><b>김하늘 · 前 카카오 프로덕트 디자이너 · 10년 차</b><span>수강생 12,480명</span></div><button class="follow">팔로우</button></div></div>
<nav class="tabs"><a class="on" href="#">개요</a><a href="#">목차</a><a href="#">자료</a></nav>
<p class="desc">버튼, 카드, 목록 같은 기본 화면 요소를 직접 만들며 오토 레이아웃과 컴포넌트를 익혀요. 마지막 강의에서는 작은 앱 화면 하나를 처음부터 끝까지 완성합니다.</p>
<div class="files"><span>강의 자료 모음.zip · 24MB</span><a href="#" aria-label="자료 받기">{ic('download')}</a></div>
<div class="chs">{ch('01', '강의 소개와 준비물', '04:12', True)}{ch('02', '프레임과 오토 레이아웃', '12:34')}{ch('03', '컴포넌트와 변형 만들기', '15:02')}{ch('04', '작은 앱 화면 완성하기', '18:47')}</div></div>
<div class="next"><button>다음 강의 보기</button></div>"""

# ── 4. 부동산 매물 ───────────────────────────────────────
ES_PAL = {"bg": "#FFFFFF", "page": "#EDEFF2", "text": "#121417", "muted": "#5A6069", "line": "#E3E6EA", "brand": "#2563EB"}
ES_CSS = """
.body{flex:1;overflow-y:auto;padding-bottom:calc(110px + env(safe-area-inset-bottom,0px))}
.gal{position:relative}.photo{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}
.gal .nav{position:absolute;left:0;right:0;top:calc(10px + env(safe-area-inset-top,0px));display:flex;justify-content:space-between;padding:0 12px}
.gal .nav button{width:40px;height:40px;border-radius:20px;background:rgba(255,255,255,.92);display:flex;align-items:center;justify-content:center}.gal .nav svg{width:20px;height:20px}
.cnt{position:absolute;right:12px;bottom:12px;font-size:12px;line-height:16px;padding:3px 8px;border-radius:10px;background:rgba(0,0,0,.6);color:#fff}
.info{position:relative;padding:16px 20px 4px}
.info h1{margin:0;padding-right:52px;font-size:22px;line-height:30px}
.info .addr{margin:4px 0 0;font-size:14px;line-height:20px;color:var(--muted)}
.info .heart{position:absolute;right:16px;top:12px;width:44px;height:44px;border-radius:22px;border:1px solid var(--line);background:#fff;display:flex;align-items:center;justify-content:center}.info .heart svg{width:20px;height:20px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:12px 20px 0}.tags span{font-size:12px;line-height:16px;padding:4px 10px;border-radius:12px;background:#EFF6FF;color:#1E40AF;white-space:nowrap}
.spec{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:16px 20px 0}
.spec div{padding:12px;border-radius:12px;background:#F6F7F9}.spec span{display:block;font-size:12px;line-height:16px;color:var(--muted)}.spec b{display:block;margin-top:2px;font-size:15px;line-height:21px}
.desc{margin:16px 20px 0;font-size:14px;line-height:22px}
.mapimg{display:block;width:calc(100% - 40px);margin:16px 20px 0;aspect-ratio:2/1;object-fit:cover;border-radius:12px}
.agent{display:flex;align-items:center;gap:10px;margin:16px 20px 0}.agent img{width:40px;height:40px;border-radius:20px;flex:none}.agent b{display:block;font-size:14px;line-height:20px}.agent span{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.cta{position:absolute;left:0;right:0;bottom:0;display:flex;gap:8px;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));background:#fff;border-top:1px solid var(--line)}
.cta .call{width:52px;height:48px;border-radius:12px;border:1px solid var(--line);background:#fff;display:flex;align-items:center;justify-content:center;flex:none}.cta .call svg{width:22px;height:22px}
.cta .ask{flex:1;height:48px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700}
"""
ES_OK = f"""<div class="body"><div class="gal"><img class="photo" src="room.png" alt="거실 사진"><div class="nav"><button aria-label="뒤로">{ic('back')}</button><button aria-label="공유">{ic('share')}</button></div><span class="cnt">1 / 12</span></div>
<div class="info"><h1>월세 1,000 / 65 · 관리비 8만 원 별도</h1><p class="addr">서울 마포구 성산동 · 망원역 도보 7분</p><button class="heart" aria-label="찜하기">{ic('heart')}</button></div>
<div class="tags"><span>풀옵션</span><span>역세권</span><span>반려동물 가능</span><span>엘리베이터</span><span>주차 1대</span></div>
<div class="spec"><div><span>전용면적</span><b>33㎡ (10평)</b></div><div><span>층수</span><b>3층 / 15층</b></div><div><span>방 · 욕실</span><b>1개 · 1개</b></div><div><span>관리비</span><b>월 8만 원</b></div></div>
<p class="desc">남향이라 햇빛이 잘 들고, 작년에 도배와 장판을 새로 했어요. 망원시장과 한강공원이 가까워요.</p>
<img class="mapimg" src="map.png" alt="매물 위치 지도">
<div class="agent"><img src="agent.png" alt="중개사 사진"><div><b>박서준 공인중개사</b><span>망원역 바른부동산 · 응답률 98%</span></div></div></div>
<div class="cta"><button class="call" aria-label="전화하기">{ic('phone')}</button><button class="ask">문의하기</button></div>"""

# ── 5. 날씨 ──────────────────────────────────────────────
WT_PAL = {"bg": "#0F3D6E", "page": "#0A2540", "text": "#FFFFFF", "muted": "#C3D0DF", "line": "rgba(255,255,255,.18)", "brand": "#FBBF24"}
WT_CSS = """
.top{border-bottom:0}
.loc{flex:1;display:flex;align-items:center;gap:4px;height:44px;background:transparent;color:var(--text);font-size:17px;font-weight:700;padding:0}.loc svg{width:16px;height:16px;flex:none}
.top .rf{width:44px;height:44px;border-radius:22px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;flex:none}.top .rf svg{width:20px;height:20px}
.body{flex:1;overflow-y:auto;padding:0 16px 24px}
.now{text-align:center;padding:12px 0 20px}
.now .tmp{display:block;font-size:88px;line-height:96px;font-weight:300;letter-spacing:-2px}
.now .cond{display:block;font-size:15px;line-height:22px;color:var(--muted)}
.card{background:rgba(255,255,255,.1);border-radius:16px;padding:12px;margin-bottom:12px}
.hourly{display:flex;gap:6px;overflow-x:auto;scroll-snap-type:x mandatory}
.hr{flex:none;width:56px;scroll-snap-align:start;text-align:center;padding:6px 0}
.hr span{display:block;font-size:12px;line-height:16px;color:var(--muted)}.hr svg{width:24px;height:24px;margin:6px auto;display:block}.hr b{display:block;font-size:15px;line-height:20px}
.wk{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line)}.wk:first-child{border-top:0}
.wk .d{flex:none;width:40px;font-size:15px;line-height:20px}
.wk svg{flex:none;width:22px;height:22px}
.wk .lo{flex:none;width:34px;text-align:right;font-size:15px;line-height:20px;color:var(--muted)}
.wk .rg{flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,.2);position:relative}.wk .rg i{position:absolute;top:0;bottom:0;border-radius:2px;background:linear-gradient(90deg,#60A5FA,#FBBF24)}
.wk .hi{flex:none;width:34px;font-size:15px;line-height:20px;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.dc{background:rgba(255,255,255,.1);border-radius:16px;padding:12px}
.dc span{display:block;font-size:12px;line-height:16px;color:var(--muted)}.dc b{display:block;margin-top:4px;font-size:20px;line-height:26px}.dc p{margin:2px 0 0;font-size:13px;line-height:18px;color:var(--muted)}
"""
W = "#FFFFFF"
HOURS = [("지금", "18°", "cloud"), ("오후 3시", "19°", "sun"), ("4시", "20°", "sun"), ("5시", "19°", "cloud"), ("6시", "17°", "cloud"), ("7시", "16°", "cloud"), ("8시", "15°", "cloud"), ("9시", "14°", "cloud")]
WEEK = [("오늘", 12, 21, "cloud"), ("내일", 13, 22, "sun"), ("수", 11, 19, "cloud"), ("목", 14, 23, "sun"), ("금", 15, 24, "sun"), ("토", 13, 20, "cloud"), ("일", 12, 21, "cloud")]
WT_OK = f"""<div class="top"><button class="loc">서울 마포구{ic('chev', W)}</button><button class="rf" aria-label="새로고침">{ic('refresh', W)}</button></div>
<div class="body"><div class="now"><span class="tmp">18°</span><span class="cond">구름 많음 · 최고 21° 최저 12°</span></div>
<div class="card"><div class="hourly">{"".join(f'<div class="hr"><span>{h}</span>{ic(k, W)}<b>{t}</b></div>' for h, t, k in HOURS)}</div></div>
<div class="card">{"".join(f'<div class="wk"><span class="d">{d}</span>{ic(k, W)}<span class="lo">{lo}°</span><div class="rg"><i style="left:{(lo - 10) * 6}%;right:{(25 - hi) * 6}%"></i></div><span class="hi">{hi}°</span></div>' for d, lo, hi, k in WEEK)}</div>
<div class="grid"><div class="dc"><span>미세먼지</span><b>좋음</b><p>18㎍/㎥</p></div><div class="dc"><span>자외선</span><b>보통</b><p>지수 4</p></div><div class="dc"><span>습도</span><b>62%</b><p>이슬점 10°</p></div><div class="dc"><span>바람</span><b>3m/s</b><p>북서풍</p></div></div></div>"""

# ── 6. 데스크톱 칸반 ─────────────────────────────────────
KB_PAL = {"bg": "#FFFFFF", "page": "#F1F3F6", "text": "#16181D", "muted": "#5B626D", "line": "#E2E5EA", "brand": "#7C3AED"}
KB_CSS = """
.app{max-width:none}
.hd{flex:none;display:flex;align-items:center;gap:12px;height:64px;padding:0 24px;border-bottom:1px solid var(--line)}
.hd h1{margin:0;font-size:18px;line-height:24px;white-space:nowrap}
.mem{display:flex;align-items:center}.mem img{width:32px;height:32px;border-radius:16px;border:2px solid #fff;margin-left:-8px}.mem img:first-child{margin-left:0}
.mem span{margin-left:-8px;width:32px;height:32px;border-radius:16px;border:2px solid #fff;background:#EDE9FE;color:#5B21B6;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.sp{flex:1}
.hd input{width:240px;min-width:0;height:40px;border:1px solid var(--line);border-radius:10px;padding:0 12px;font-size:14px;font-family:inherit}
.hd .new{display:flex;align-items:center;gap:6px;height:40px;padding:0 14px;border-radius:10px;background:var(--brand);color:#fff;font-size:14px;font-weight:700;white-space:nowrap;flex:none}.hd .new svg{width:16px;height:16px}
.board{flex:1;display:flex;gap:16px;padding:16px 24px;overflow-x:auto;align-items:flex-start}
.col{flex:none;width:272px;background:#F6F7F9;border-radius:14px;padding:10px}
.ch{display:flex;align-items:center;gap:8px;padding:4px 4px 10px}.ch b{font-size:14px;line-height:20px;white-space:nowrap}
.ch .n{font-size:12px;line-height:16px;padding:1px 7px;border-radius:9px;background:#E4E7EC;color:#3F4652}
.ch .add{margin-left:auto;width:32px;height:32px;border-radius:8px;background:transparent;font-size:18px;color:var(--text)}
.cd{position:relative;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:8px}
.cd h3{margin:0 0 8px;padding-right:56px;font-size:14px;line-height:20px;font-weight:600}
.cd .pr{position:absolute;right:10px;top:10px;font-size:11px;line-height:16px;font-weight:700;padding:2px 6px;border-radius:6px}
.p-h{background:#FEE2E2;color:#991B1B}.p-m{background:#FEF3C7;color:#92400E}.p-l{background:#E0F2FE;color:#075985}
.tg{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px}.tg span{font-size:11px;line-height:16px;padding:2px 8px;border-radius:8px;font-weight:600}
.t-d{background:#EDE9FE;color:#5B21B6}.t-f{background:#DCFCE7;color:#166534}.t-q{background:#FEF9C3;color:#854D0E}
.ft{display:flex;align-items:center;gap:10px;font-size:12px;line-height:16px;color:var(--muted)}.ft img{width:24px;height:24px;border-radius:12px;margin-left:auto}
.menu{position:absolute;right:8px;top:36px;z-index:3;width:140px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:4px;margin:0;list-style:none}.menu li{padding:8px 10px;font-size:13px;line-height:18px;border-radius:6px}
"""
TAGN = {"d": "디자인", "f": "프론트", "q": "QA"}
PRN = {"h": "높음", "m": "보통", "l": "낮음"}


def cd(title, pr, tags, date, cm, av, menu=False):
    m = '<ul class="menu"><li>수정</li><li>담당자 바꾸기</li><li>삭제</li></ul>' if menu else ""
    return f'<div class="cd"><span class="pr p-{pr}">{PRN[pr]}</span><h3>{title}</h3><div class="tg">{"".join(f"<span class=t-{t}>{TAGN[t]}</span>" for t in tags)}</div><div class="ft"><span>{date}</span><span>댓글 {cm}</span><img src="m{av}.png" alt="담당자"></div>{m}</div>'


def col(name, cards):
    return f'<section class="col"><div class="ch"><b>{name}</b><span class="n">{len(cards)}</span><button class="add" aria-label="작업 추가">+</button></div>{"".join(cards)}</section>'


KB_OK = f"""<header class="hd"><h1>모바일 앱 리뉴얼</h1><div class="mem"><img src="m1.png" alt="김하늘"><img src="m2.png" alt="박서준"><img src="m3.png" alt="이수민"><img src="m4.png" alt="정다은"><span>+3</span></div><div class="sp"></div><input placeholder="작업 검색"><button class="new">{ic('plus', '#FFFFFF')}새 작업</button></header>
<main class="board">{col('할 일', [cd('로그인 화면 오류 문구와 빈 상태 안내 정리', 'h', 'dq', '10월 14일', 3, 1), cd('온보딩 설문 단계 이름과 진행 표시 확정', 'm', 'd', '10월 16일', 1, 2), cd('아이콘 세트 정리', 'l', 'd', '10월 20일', 0, 3)])}
{col('진행 중', [cd('홈 화면 카드 컴포넌트를 새 디자인으로 교체', 'h', 'fd', '10월 13일', 5, 4, menu=True), cd('결제 화면 접근성 점검과 대비 수정 목록 작성', 'm', 'q', '10월 15일', 2, 1)])}
{col('검토', [cd('다크 모드 색 토큰', 'm', 'df', '10월 12일', 4, 2)])}
{col('완료', [cd('알림 설정 화면', 'l', 'f', '10월 8일', 1, 3), cd('검색 결과 빈 화면', 'l', 'dq', '10월 7일', 0, 4)])}</main>"""

SCREENS = {
    "recipe": ("레시피", RC_PAL, RC_CSS, RC_OK, M5T),
    "todo": ("오늘 할 일", TD_PAL, TD_CSS, TD_OK, M5),
    "lecture": ("강의", LC_PAL, LC_CSS, LC_OK, M5),
    "estate": ("매물 상세", ES_PAL, ES_CSS, ES_OK, M5),
    "weather": ("날씨", WT_PAL, WT_CSS, WT_OK, M5),
    "kanban": ("모바일 앱 리뉴얼", KB_PAL, KB_CSS, KB_OK, W4),
}

STEP_HINT = ["냄비에 물", "마늘을 얇게", "방울토마토를 반", "삶은 면과"]
KB_TITLES = ["로그인 화면 오류", "온보딩 설문", "아이콘 세트", "홈 화면 카드", "결제 화면", "다크 모드", "알림 설정 화면", "검색 결과"]
# (화면, 변형, 유형, 설명, 추가 CSS, 마크업 바꾸기[(앞, 뒤) 또는 (앞, 뒤, 'all')], 확인 크기, 정답 측정, 글자 힌트)
# 유형: R1~R7·A1·A2·D4는 dqa에 규칙이 있는 종류. F1(크기 방식)·L1(정렬)·D3(글자 크기)·L2(간격)·D5(모서리)는 규칙 밖
V = [
    ("recipe", "r7-timer", "R7", "타이머 막대를 화면 기준 고정(position:fixed)으로 바꿔 태블릿 폭에서 폰 크기 앱 틀 밖으로 늘어남", ".timer{position:fixed}", [], M5T, {"type": "frame_escape", "sel": ".timer", "frame": ".app"}, ["다음 단계까지", "일시정지"]),
    ("recipe", "r1-ing", "R1", "재료 이름의 줄바꿈을 막고 줄어들지 않게 해 긴 재료 이름이 양을 화면 밖으로 밀어냄", ".ing li span{flex:none;white-space:nowrap}", [], M5T, {"type": "overflow", "sel": ".ing li"}, ["엑스트라 버진", "3큰술"]),
    ("recipe", "a2-chip", "A2", "요약 칩 글자를 #ABA49B로 옅게 함", ".chips span{color:#ABA49B}", [], M5T, {"type": "contrast", "sel": ".chips span", "min": 4.5}, ["2인분 기준", "난이도", "냄비 하나"]),
    ("recipe", "r6-serv", "R6", "인분 표시 칸을 28px로 고정하고 글자 끊기를 허용해 '2인분'이 꺾임", ".serv b{min-width:0;width:28px;white-space:normal;word-break:break-all}", [], M5T, {"type": "lines", "sel": ".serv b"}, ["2인분"]),
    ("recipe", "d4-hero", "D4", "대표 사진 경로를 루트 기준(/images/)으로 잘못 적어 그림이 깨짐", "", [('src="pasta.png"', 'src="/images/pasta.png"')], M5T, {"type": "img_broken", "sel": ".food"}, ["파스타 사진"]),
    ("recipe", "r3-step", "R3", "단계 번호를 절대 위치로 옮기면서 설명 글자 왼쪽 여백을 안 줘 번호 원 위에 글자가 겹침", ".steps li{display:block;position:relative}.steps i{position:absolute;left:0;top:10px}", [], M5T, {"type": "overlap_text", "sel": ".steps p", "other": ".steps i"}, STEP_HINT),
    ("recipe", "f1-start", "F1", "'요리 시작' 버튼을 시안의 Fill 대신 고정 폭 200px로 씀", ".bar .start{flex:none;width:200px}", [], ["375x812"], {"type": "style", "sel": ".bar .start", "prop": "flex-grow", "value": "1"}, []),
    ("todo", "r2-filters", "R2", "분류 칩 줄의 가로 스크롤을 넘침 숨김으로 바꿔 뒤쪽 칩이 잘려 안 보임", ".filters{overflow:hidden}", [], M5, {"type": "clipped_parent", "sel": ".filters button"}, ["취미", "가족", "공부", "운동", "장보기"]),
    ("todo", "a1-check", "A1", "항목을 label 대신 div로 감싸고 체크박스를 16px로 줄여 누를 곳이 작음", ".it input{width:16px;height:16px}", [('<label class="it', '<div class="it', 'all'), ('</label>', '</div>', 'all')], M5, {"type": "target", "sel": ".it input", "min": 24, "label": True}, ["완료 표시"]),
    ("todo", "r3-due", "R3", "마감 시각을 시안 좌표 그대로 절대 위치(left:200px)에 박아 긴 할 일 제목과 겹침", ".it{position:relative}.it .due{position:absolute;left:200px;top:18px}", [], M5, {"type": "overlap_text", "sel": ".it .t", "other": ".it .due"}, ["분기 보고서", "오전 11시", "장보기", "오후 6시", "헬스장", "오후 7시", "치과 예약", "오후 2시", "아침 스트레칭", "오전 7시"]),
    ("todo", "a2-done", "A2", "완료한 할 일 글자를 #B9BEC6로 옅게 함", ".it.done .t{color:#B9BEC6}", [], M5, {"type": "contrast", "sel": ".it.done .t", "min": 4.5}, ["아침 스트레칭", "치과 예약"]),
    ("todo", "r4-fab", "R4", "목록 아래 여백을 16px로 줄여 끝까지 내려도 마지막 항목의 마감 시각이 추가 버튼에 가려짐", ".list{padding-bottom:16px}", [], M5, {"type": "covered", "sel": ".list > .it:last-child .due", "scroll": ".list"}, ["오후 2시", "치과 예약"]),
    ("todo", "l1-icon", "L1", "필터 버튼의 세로 가운데 맞춤을 빼 아이콘이 글자보다 위로 붙음", ".top .flt{align-items:flex-start;padding-top:6px}", [], ["375x812"], {"type": "style", "sel": ".top .flt", "prop": "align-items", "value": "center"}, []),
    ("lecture", "r3-dur", "R3", "재생 시간 배지를 표지 맨 아래(bottom:0)로 내려 진행 막대와 겹침", ".dur{bottom:0}", [], M5, {"type": "overlap_text", "sel": ".dur", "other": ".prog"}, ["12:34"]),
    ("lecture", "a2-chap", "A2", "표지 위 강의 이름의 반투명 배경을 빼 밝은 표지 위 흰 글자가 안 읽힘", ".chap{background:none}", [], M5, {"type": "contrast_img", "sel": ".chap", "img": ".poster", "min": 4.5}, ["1강"]),
    ("lecture", "a1-file", "A1", "자료 받기 버튼을 아이콘 크기 18px로 줄임", ".files a{width:18px;height:18px}.files a svg{width:14px;height:14px}", [], M5, {"type": "target", "sel": ".files a", "min": 24}, ["자료 받기"]),
    ("lecture", "r1-name", "R1", "강사 이름 칸이 줄어들지 않게 하고 줄바꿈을 막아 팔로우 버튼이 화면 밖으로 밀림", ".who .nm{flex:none}.who b{white-space:nowrap}", [], M5, {"type": "overflow", "sel": ".who"}, ["김하늘", "팔로우"]),
    ("lecture", "r2-desc", "R2", "강의 설명에 최대 높이 56px와 넘침 숨김을 걸어 세 번째 줄이 반쯤 잘림", ".desc{max-height:56px;overflow:hidden}", [], M5, {"type": "clipped_text", "sel": ".desc"}, ["버튼, 카드"]),
    ("lecture", "r6-time", "R6", "목차 재생 시간 칸을 24px로 고정하고 글자 끊기를 허용해 '04:12'가 꺾임", ".ch time{width:24px;white-space:normal;word-break:break-all}", [], M5, {"type": "lines", "sel": ".ch time"}, ["04:12", "12:34", "15:02", "18:47"]),
    ("lecture", "d3-title", "D3", "강의 제목 글자 크기를 시안 20px 대신 18px로 씀", ".info h1{font-size:18px}", [], ["375x812"], {"type": "style", "sel": ".info h1", "prop": "font-size", "value": "20px"}, []),
    ("estate", "r4-safe", "R4", "사진 위 뒤로·공유 버튼의 안전영역 여백을 빼 노치 아래로 들어감", ".gal .nav{top:10px}", [], N3, {"type": "safe_top", "sel": ".gal .nav button"}, ["뒤로", "공유"]),
    ("estate", "r1-tags", "R1", "특징 태그 줄의 줄바꿈을 막아 좁은 화면에서 태그가 화면 밖으로 넘침", ".tags{flex-wrap:nowrap}", [], M5, {"type": "overflow", "sel": ".tags"}, ["주차 1대", "엘리베이터", "반려동물"]),
    ("estate", "r3-heart", "R3", "가격 제목의 오른쪽 여백을 빼 긴 가격이 찜 버튼 아래로 들어감", ".info h1{padding-right:0}", [], M5, {"type": "overlap_text", "sel": ".info h1", "other": ".info .heart"}, ["월세", "찜하기"]),
    ("estate", "a2-addr", "A2", "주소 글자를 #A9AFB8로 옅게 함", ".info .addr{color:#A9AFB8}", [], M5, {"type": "contrast", "sel": ".info .addr", "min": 4.5}, ["성산동"]),
    ("estate", "d4-map", "D4", "위치 지도 높이를 110px로 고정하고 object-fit을 fill로 둬 지도가 눌림", ".mapimg{aspect-ratio:auto;height:110px;object-fit:fill}", [], M5, {"type": "img_ratio", "sel": ".mapimg"}, ["매물 위치"]),
    ("estate", "l2-spec", "L2", "정보 칸 사이 간격을 시안 8px 대신 3px로 씀", ".spec{gap:3px}", [], ["375x812"], {"type": "style", "sel": ".spec", "prop": "row-gap", "value": "8px"}, []),
    ("weather", "r3-temp", "R3", "현재 기온과 날씨 설명 사이를 좁히려고 음수 여백을 줘 설명이 큰 숫자 위로 올라감", ".now .cond{margin-top:-40px}", [], M5, {"type": "overlap_text", "sel": ".now .cond", "other": ".now .tmp"}, ["구름 많음", "18°"]),
    ("weather", "r1-hourly", "R1", "시간별 예보 줄의 가로 스크롤을 빼 뒤쪽 시간이 화면 밖으로 넘침", ".hourly{overflow:visible;scroll-snap-type:none}", [], M5, {"type": "overflow", "sel": ".hourly", "allow_scroll": True}, ["오후 3시", "4시", "5시", "6시", "7시", "8시", "9시", "16°", "15°", "14°", "17°"]),
    ("weather", "a2-lo", "A2", "최저 기온 글자를 #7A8FA8로 어둡게 해 짙은 배경에서 안 읽힘", ".wk .lo{color:#7A8FA8}", [], M5, {"type": "contrast", "sel": ".wk .lo", "min": 4.5}, ["12°", "13°", "11°", "14°", "15°"]),
    ("weather", "r6-day", "R6", "요일 칸을 20px로 고정해 '오늘'·'내일'이 두 줄로 꺾임", ".wk .d{width:20px}", [], M5, {"type": "lines", "sel": ".wk .d"}, ["오늘", "내일"]),
    ("weather", "a1-rf", "A1", "새로고침 버튼을 아이콘 크기 20px로 줄임", ".top .rf{width:20px;height:20px}.top .rf svg{width:14px;height:14px}", [], M5, {"type": "target", "sel": ".top .rf", "min": 24}, ["새로고침"]),
    ("weather", "d5-radius", "D5", "상세 카드 모서리를 시안 16px 대신 4px로 씀", ".dc{border-radius:4px}", [], ["375x812"], {"type": "style", "sel": ".dc", "prop": "border-top-left-radius", "value": "16px"}, []),
    ("kanban", "r3-title", "R3", "카드 제목의 오른쪽 여백을 빼 긴 제목이 우선순위 배지 밑으로 들어감", ".cd h3{padding-right:0}", [], W4, {"type": "overlap_text", "sel": ".cd h3", "other": ".cd .pr"}, KB_TITLES),
    ("kanban", "r1-search", "R1", "검색칸을 400px로 고정하고 제목이 줄어들지 않게 해 좁은 창에서 머리글이 넘침", ".hd input{width:400px;flex:none}.hd h1{flex:none}", [], W4, {"type": "overflow", "sel": ".hd"}, ["새 작업", "작업 검색"]),
    ("kanban", "a2-tag", "A2", "QA 태그를 노란 바탕(#FACC15)에 흰 글자로 바꿈", ".t-q{background:#FACC15;color:#FFFFFF}", [], W4, {"type": "contrast", "sel": ".t-q", "min": 4.5}, ["QA"]),
    ("kanban", "r2-menu", "R2", "카드에 넘침 숨김을 걸어 열린 메뉴의 아래 항목이 카드 밖에서 잘림", ".cd{overflow:hidden}", [], W4, {"type": "clipped_parent", "sel": ".menu li"}, ["삭제", "담당자"]),
    ("kanban", "a1-add", "A1", "열마다 있는 작업 추가 버튼을 18px로 줄임", ".ch .add{width:18px;height:18px;font-size:14px}", [], W4, {"type": "target", "sel": ".ch .add", "min": 24}, ["작업 추가"]),
    ("kanban", "l1-foot", "L1", "카드 아래 줄의 세로 가운데 맞춤을 빼 날짜·댓글 글자가 담당자 사진 위쪽에 붙음", ".ft{align-items:flex-start}", [], ["1280x800"], {"type": "style", "sel": ".ft", "prop": "align-items", "value": "center"}, []),
]


def images(d, screen):
    def img(name, w, h, c1, c2, kind):
        im = Image.new("RGB", (w, h), c1); dr = ImageDraw.Draw(im)
        if kind == "photo":
            dr.rectangle([0, h * 0.6, w, h], fill=c2); dr.ellipse([w * 0.6, h * 0.15, w * 0.8, h * 0.15 + w * 0.2], fill="#F6C343")
        elif kind == "plate":
            dr.ellipse([w * 0.18, h * 0.12, w * 0.82, h * 0.98], fill="#F4EFE6"); dr.ellipse([w * 0.3, h * 0.28, w * 0.7, h * 0.82], fill=c2)
        elif kind == "poster":
            dr.rectangle([w * 0.55, h * 0.25, w * 0.9, h * 0.75], fill=c2); dr.rectangle([w * 0.62, h * 0.35, w * 0.83, h * 0.45], fill="#FFFFFF")
        elif kind == "room":
            dr.rectangle([0, h * 0.7, w, h], fill="#C8A27C"); dr.rectangle([w * 0.1, h * 0.15, w * 0.45, h * 0.55], fill="#BFE3F5"); dr.rectangle([w * 0.55, h * 0.45, w * 0.95, h * 0.72], fill=c2)
        elif kind == "map":
            for x in range(0, w, 40): dr.line([x, 0, x, h], fill="#D6DCE3", width=2)
            for y in range(0, h, 40): dr.line([0, y, w, y], fill="#D6DCE3", width=2)
            dr.ellipse([w / 2 - 14, h / 2 - 14, w / 2 + 14, h / 2 + 14], fill=c2)
        else:
            dr.ellipse([w * 0.15, h * 0.15, w * 0.85, h * 0.85], fill=c2)
        im.save(d / name)
    if screen == "recipe": img("pasta.png", 800, 600, "#8C5A3C", "#C0392B", "plate")
    if screen == "lecture": img("poster.png", 960, 540, "#E6F4F1", "#0F766E", "poster"); img("teacher.png", 72, 72, "#FDE2E4", "#E5989B", "dot")
    if screen == "estate": img("room.png", 800, 600, "#F3EFE8", "#6B7280", "room"); img("map.png", 600, 300, "#EEF2F6", "#2563EB", "map"); img("agent.png", 80, 80, "#E0E7FF", "#4338CA", "dot")
    if screen == "kanban":
        for i, (a, b) in enumerate([("#FDE68A", "#D97706"), ("#BFDBFE", "#2563EB"), ("#FBCFE8", "#DB2777"), ("#BBF7D0", "#16A34A")], 1): img(f"m{i}.png", 64, 64, a, b, "dot")


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
        cases.append({"id": f"blind3-{scr}-ok", "screen": scr, "variant": "ok", "code": None, "defect": "맞게 만든 구현", "dir": f"eval/synth/blind3/screens/{scr}/ok", "sizes": sizes, "check": None, "hint": []})
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
        cases.append({"id": f"blind3-{scr}-{var}", "screen": scr, "variant": var, "code": code, "defect": desc, "dir": f"eval/synth/blind3/screens/{scr}/{var}", "sizes": sizes, "check": check, "hint": hint})
    (HERE / "cases.json").write_text(json.dumps({"note": "블라인드 합성 예제 3묶음(10-10). 블라인드 2의 빈틈을 고친 규칙을 고정하고 한 번만 잰다. 규칙 밖 유형: F1 크기 방식, L1 정렬, D3 글자 크기, L2 간격, D5 모서리.", "frozen_rules_sha1": rules_sha1(), "cases": cases}, ensure_ascii=False, indent=1) + "\n")
    print(f"화면 {len(SCREENS)}개, 결함 {len(V)}개, 유형 {sorted({v[2] for v in V})}, 규칙 해시 {rules_sha1()[:10]}")


if __name__ == "__main__":
    main()
