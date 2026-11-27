"""블라인드 합성 예제 2묶음(10-10). 블라인드 1에서 드러난 빈틈을 고친 뒤의 일반화를 잰다.
dqa 규칙 파일을 고정(cases.json의 frozen_rules_sha1)한 채, 앞선 12개 앱과 겹치지 않는 새 앱 6종에 결함을 하나씩 심는다. 한 번만 잰다.
결함은 바이브코딩에서 흔한 실수에서 골랐다. 규칙 밖 종류(색 토큰, 간격, 글자 굵기, 크기 방식, 선택 상태, 정렬)도 섞는다.
화면: music(음악 플레이어), workout(운동 기록), article(뉴스 기사), survey(설문 온보딩), profile(마이페이지), inbox(데스크톱 메일함)
사용: python3 eval/synth/make_blind2.py  → eval/synth/blind2/screens/<화면>/<변형>/index.html, eval/synth/blind2/cases.json
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw
from make_synth import page, svg, M5, W4

HERE = Path(__file__).resolve().parent / "blind2"
OUT = HERE / "screens"

# ── 1. 음악 플레이어 ─────────────────────────────────────
MUSIC_PAL = {"bg": "#FFFFFF", "page": "#ECEDEF", "text": "#15171C", "muted": "#5D6370", "line": "#E3E5E8", "brand": "#6D28D9"}
MUSIC_CSS = """
.np{flex:1;overflow-y:auto;padding:16px 24px 24px;display:flex;flex-direction:column;gap:16px}
.art{display:block;width:100%;aspect-ratio:1/1;border-radius:16px;object-fit:cover}
.meta{display:flex;align-items:center;gap:12px}.meta .t{flex:1;min-width:0}
.meta h1{margin:0;font-size:22px;line-height:28px;font-weight:800}
.meta p{margin:2px 0 0;font-size:15px;line-height:20px;color:var(--muted)}
.hq{display:inline-block;margin-top:4px;font-style:normal;font-size:11px;line-height:16px;font-weight:700;padding:1px 6px;border-radius:4px;background:#EDE9FE;color:#5B21B6}
.like{width:44px;height:44px;border-radius:22px;background:#F3F0FF;flex:none;display:flex;align-items:center;justify-content:center}.like svg{width:22px;height:22px}
.bar{height:4px;border-radius:2px;background:var(--line);position:relative}.bar i{position:absolute;left:0;top:0;bottom:0;width:38%;background:var(--brand);border-radius:2px}
.times{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:6px}
.ctl{display:flex;align-items:center;justify-content:space-between}
.ctl button{width:48px;height:48px;border-radius:24px;background:transparent;font-size:20px;color:var(--text)}
.ctl .play{width:64px;height:64px;border-radius:32px;background:var(--brand);color:#fff;font-size:24px}
.add{height:40px;padding:0 16px;border-radius:20px;border:1px solid var(--line);background:#fff;font-size:14px;font-weight:600;align-self:flex-start;white-space:nowrap}
.q h2{margin:8px 0;font-size:16px}
.qi{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--line)}
.qi img{width:44px;height:44px;border-radius:8px;object-fit:cover;flex:none}
.qi .t{flex:1;min-width:0}.qi b{display:block;font-size:15px;line-height:20px}.qi span{display:block;font-size:13px;line-height:18px;color:var(--muted)}
.qi .more{width:44px;height:44px;border-radius:10px;background:transparent;font-size:18px;flex:none;color:var(--muted)}
"""


def qi(i, title, artist):
    return f'<div class="qi"><img src="q{i}.png" alt="{title} 표지"><div class="t"><b>{title}</b><span>{artist}</span></div><button class="more" aria-label="더보기">⋮</button></div>'


MUSIC_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{svg('back')}</button><span class="ttl">지금 재생 중</span></div>
<div class="np"><img class="art" src="cover.png" alt="앨범 표지: 새벽 세 시의 도시">
<div class="meta"><div class="t"><h1>새벽 세 시의 도시</h1><p>모노레일 · 정규 2집</p><em class="hq">무손실</em></div><button class="like" aria-label="좋아요">{svg('heart')}</button></div>
<div><div class="bar"><i></i></div><div class="times"><span>1:24</span><span>3:52</span></div></div>
<div class="ctl"><button aria-label="셔플">⇄</button><button aria-label="이전 곡">⏮</button><button class="play" aria-label="재생">▶</button><button aria-label="다음 곡">⏭</button><button aria-label="반복">↻</button></div>
<button class="add">재생목록에 추가</button>
<div class="q"><h2>다음 곡</h2>{qi(1, '여름 끝의 버스', '모노레일')}{qi(2, '빛나는 계단', '하루살이')}{qi(3, '오래된 라디오', '모노레일')}{qi(4, '첫 차', '구름다리')}</div></div>"""

# ── 2. 운동 기록 ─────────────────────────────────────────
WK_PAL = {"bg": "#FFFFFF", "page": "#EEF0F2", "text": "#14171A", "muted": "#5B636D", "line": "#E1E4E8", "brand": "#1F8A4C"}
WK_CSS = """
.seg{flex:none;display:flex;gap:4px;margin:12px 16px;padding:4px;background:#F1F3F5;border-radius:12px}
.seg button{flex:1;height:36px;border-radius:9px;background:transparent;font-size:14px;font-weight:600;color:var(--muted)}.seg .on{background:#fff;color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.08)}
.body{flex:1;overflow-y:auto;padding:0 16px 24px}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:16px}
.st{background:#F7F8FA;border-radius:12px;padding:12px 10px}.st b{display:block;font-size:20px;line-height:26px;font-weight:800;white-space:nowrap}.st span{display:block;font-size:12px;line-height:16px;color:var(--muted)}
.chart{display:flex;align-items:flex-end;gap:8px;height:120px;padding-top:8px;border-bottom:1px solid var(--line)}
.chart div{flex:1;background:var(--brand);border-radius:4px 4px 0 0}
.axis{display:flex;gap:8px;margin:6px 0 16px}.axis span{flex:1;text-align:center;font-size:12px;line-height:16px;color:var(--muted)}
.wk{border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:10px}
.wk h3{margin:0 0 4px;font-size:16px;line-height:22px}.wk p{margin:0;font-size:13px;line-height:18px;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.chips span{font-size:12px;line-height:16px;padding:4px 8px;border-radius:8px;background:#EEF6F0;color:#1F6B3A}
.tabbar{flex:none;height:60px;display:flex;border-top:1px solid var(--line);background:#fff}.tabbar a{flex:1;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--muted);text-decoration:none}.tabbar .on{color:var(--text);font-weight:700}
"""


def wk(title, meta, chips):
    return f'<div class="wk"><h3>{title}</h3><p>{meta}</p><div class="chips">{"".join(f"<span>{c}</span>" for c in chips)}</div></div>'


WK_OK = f"""<div class="top"><span class="ttl">운동 기록</span></div>
<div class="seg"><button>일</button><button class="on">주</button><button>월</button><button>연</button></div>
<div class="body"><div class="stats"><div class="st"><b>12,480</b><span>걸음</span></div><div class="st"><b>1,284</b><span>kcal</span></div><div class="st"><b>8.4km</b><span>거리</span></div></div>
<div class="chart"><div style="height:40%"></div><div style="height:72%"></div><div style="height:55%"></div><div style="height:90%"></div><div style="height:30%"></div><div style="height:64%"></div><div style="height:48%"></div></div>
<div class="axis"><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span><span>일</span></div>
{wk('아침 러닝', '45분 · 6.2km · 412kcal', ['페이스 7:15', '심박 142'])}{wk('하체 근력', '50분 · 380kcal', ['스쿼트', '런지', '레그프레스'])}{wk('저녁 요가', '30분 · 120kcal', ['스트레칭'])}{wk('주말 등산', '3시간 10분 · 8.9km · 1,120kcal', ['북한산', '고도 836m'])}</div>
<div class="tabbar"><a href="#">홈</a><a class="on" href="#">기록</a><a href="#">챌린지</a><a href="#">내 정보</a></div>"""

# ── 3. 뉴스 기사 ─────────────────────────────────────────
NEWS_PAL = {"bg": "#FFFFFF", "page": "#EDEDED", "text": "#121212", "muted": "#5F6368", "line": "#E3E3E3", "brand": "#B4232C"}
NEWS_CSS = """
.art{flex:1;overflow-y:auto;padding:0 0 88px}
.kick{margin:16px 20px 6px;font-size:13px;line-height:18px;font-weight:700;color:var(--brand)}
.art h1{margin:0 20px;font-size:24px;line-height:32px;font-weight:800;letter-spacing:-0.3px}
.by{display:flex;align-items:center;gap:8px;margin:12px 20px 16px}.by img{width:28px;height:28px;border-radius:14px;flex:none}.by span{font-size:13px;line-height:18px;color:var(--muted)}
figure{margin:0 0 16px}figure img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}figcaption{padding:6px 20px 0;font-size:12px;line-height:18px;color:var(--muted)}
figure.c{margin:0 20px 16px}figure .fig2{display:block;width:auto;max-width:100%;height:auto;aspect-ratio:auto;object-fit:contain}
.art p.t{margin:0 20px 14px;font-size:16px;line-height:27px}
.rel{margin:24px 20px 0;border-top:1px solid var(--line);padding-top:16px}.rel h2{margin:0 0 6px;font-size:16px}
.ri{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}.ri img{width:72px;height:54px;border-radius:6px;object-fit:cover;flex:none}.ri b{display:block;font-size:14px;line-height:20px;font-weight:600}
.more{display:block;width:100%;height:44px;margin-top:12px;border-radius:10px;border:1px solid var(--line);background:#fff;font-size:14px;font-weight:600}
.share{position:absolute;left:0;right:0;bottom:0;height:64px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#fff;border-top:1px solid var(--line)}
.share button{flex:1;height:44px;border-radius:10px;background:#F3F4F6;font-size:14px;font-weight:600}
"""
NEWS_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{svg('back')}</button><span class="ttl">경제</span></div>
<div class="art"><p class="kick">물가</p><h1>장바구니 물가 석 달째 하락, 채소값은 여전히 높아</h1>
<div class="by"><img src="by.png" alt="정다은 기자"><span>정다은 기자 · 2026.10.10 07:30</span></div>
<figure><img src="photo.png" alt="대형마트 채소 코너"><figcaption>9일 서울의 한 대형마트 채소 코너. 사진 연합</figcaption></figure>
<p class="t">통계청이 발표한 9월 소비자물가 동향에 따르면 식료품 가격 상승률이 석 달 연속 낮아졌다. 다만 배추와 무 같은 채소는 여름 폭염의 영향으로 지난해보다 20% 넘게 비싸다.</p>
<figure class="c"><img class="fig2" src="chart.png" width="400" height="200" alt="월별 식료품 물가 상승률 그래프"></figure>
<p class="t">정부는 다음 달까지 배추 비축 물량을 풀고 할인 지원을 늘리기로 했다. 전문가들은 연말까지 채소값이 점차 안정될 것으로 본다.</p>
<div class="rel"><h2>관련 기사</h2>
<div class="ri"><img src="rel1.png" alt=""><b>배추 한 포기 6천 원대, 김장철 앞두고 걱정 커져</b></div>
<div class="ri"><img src="rel2.png" alt=""><b>대형마트 3사, 이번 주 채소 할인 행사 시작</b></div>
<div class="ri"><img src="rel3.png" alt=""><b>폭염 지나자 과일값은 내림세로 돌아서</b></div>
<button class="more">다른 기사 더 보기</button></div></div>
<div class="share"><button>공유하기</button><button>저장</button><button>글자 크기</button></div>"""

# ── 4. 설문 온보딩 ───────────────────────────────────────
SV_PAL = {"bg": "#FFFFFF", "page": "#EEF1F5", "text": "#111827", "muted": "#5B6472", "line": "#DDE2E8", "brand": "#2F5BD3"}
SV_CSS = """
.top .skip{height:44px;padding:0 4px;background:transparent;font-size:14px;color:var(--muted)}
.steps{flex:none;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:12px 16px 8px}
.steps div{font-size:12px;line-height:16px;color:var(--muted);text-align:center;padding-top:8px;border-top:3px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.steps .on{color:var(--text);font-weight:700;border-top-color:var(--brand)}
.qa{flex:1;overflow-y:auto;padding:16px 20px 24px}
.qa h1{margin:0 0 6px;font-size:22px;line-height:30px}.qa .sub{margin:0 0 18px;font-size:14px;line-height:21px;color:var(--muted)}
.opt{display:flex;align-items:center;gap:12px;min-height:56px;padding:0 16px;border:1px solid var(--line);border-radius:14px;margin-bottom:10px;font-size:15px}
.opt input{width:22px;height:22px;margin:0;accent-color:var(--brand);flex:none}
.opt.sel{border-color:var(--brand);background:#F0F5FF}
.qa h2{margin:22px 0 4px;font-size:17px;line-height:24px}
.scale{display:flex;gap:6px;margin-top:8px}.scale button{flex:1;min-width:0;height:56px;border-radius:10px;border:1px solid var(--line);background:#fff;font-size:13px;line-height:17px;padding:0 2px;color:var(--text)}
.foot{flex:none;padding:12px 20px 16px;border-top:1px solid var(--line);background:#fff}
.next{display:block;width:100%;height:52px;border-radius:12px;background:var(--brand);color:#fff;font-size:16px;font-weight:700}
.toast{position:absolute;left:16px;right:16px;bottom:96px;height:44px;border-radius:10px;background:#1F2937;color:#fff;font-size:14px;display:flex;align-items:center;padding:0 14px}
"""
SV_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{svg('back')}</button><span class="ttl">맞춤 설정</span><button class="skip">건너뛰기</button></div>
<div class="steps"><div>기본 정보 입력</div><div class="on">관심 운동</div><div>알림 받을 시간</div><div>완료</div></div>
<div class="qa"><h1>어떤 운동을 좋아하세요?</h1><p class="sub">여러 개를 고를 수 있어요. 나중에 바꿀 수 있어요.</p>
<label class="opt sel"><input type="checkbox" checked>러닝</label><label class="opt"><input type="checkbox">요가 · 필라테스</label><label class="opt"><input type="checkbox">근력 운동</label><label class="opt"><input type="checkbox">등산</label>
<h2>운동 강도는 어느 정도가 좋나요?</h2>
<div class="scale"><button>가볍게</button><button>조금</button><button>보통</button><button>꽤</button><button>강하게</button></div></div>
<div class="foot"><button class="next">다음</button></div>
<div class="toast" role="status">임시 저장했어요</div>"""

# ── 5. 마이페이지 ────────────────────────────────────────
PF_PAL = {"bg": "#FFFFFF", "page": "#ECEEF1", "text": "#16191D", "muted": "#5C6470", "line": "#E2E5E9", "brand": "#0B5CAD"}
PF_CSS = """
.pf{flex:1;overflow-y:auto;padding-bottom:16px}
.cover{display:block;width:100%;height:120px;object-fit:cover;background:#DCE6F2}
.gear{position:absolute;right:12px;top:12px;width:44px;height:44px;border-radius:22px;background:rgba(255,255,255,.92);font-size:18px;color:var(--text)}
.who{display:flex;align-items:flex-end;gap:12px;padding:0 20px;margin-top:-36px}
.who img{width:80px;height:80px;border-radius:40px;border:4px solid #fff;object-fit:cover;flex:none;background:#fff}
.who .nm{flex:1;min-width:0;padding-bottom:6px}
.who h1{margin:0;font-size:20px;line-height:26px;display:flex;align-items:center;gap:6px}
.ver{font-style:normal;font-size:11px;line-height:16px;font-weight:700;color:var(--brand);background:#E6F0FB;padding:2px 6px;border-radius:6px;white-space:nowrap}
.who p{margin:2px 0 0;font-size:13px;line-height:18px;color:var(--muted)}
.bio{margin:12px 20px 0;font-size:14px;line-height:21px}
.nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:16px 20px;border:1px solid var(--line);border-radius:14px}
.nums div{padding:12px 0;text-align:center}.nums b{display:block;font-size:18px;line-height:24px}.nums span{font-size:12px;line-height:16px;color:var(--muted)}
.menu a{display:flex;align-items:center;justify-content:space-between;min-height:52px;padding:0 20px;border-top:1px solid var(--line);color:var(--text);text-decoration:none;font-size:15px}
.menu a .v{font-size:13px;color:var(--muted)}
"""
PF_OK = """<div class="pf"><img class="cover" src="cover.png" alt="프로필 배경 사진">
<div class="who"><img src="avatar.png" alt="프로필 사진"><div class="nm"><h1><span>김하늘별</span><em class="ver">인증</em></h1><p>@haneul.star · 서울</p></div></div>
<p class="bio">주말마다 산에 오르고, 평일엔 동네 빵집을 기록해요. 사진은 직접 찍어요.</p>
<div class="nums"><div><b>128</b><span>게시물</span></div><div><b>2,481</b><span>팔로워</span></div><div><b>312</b><span>팔로잉</span></div></div>
<nav class="menu"><a href="#"><span>저장한 글</span><span class="v">32개</span></a><a href="#"><span>알림 설정</span><span class="v">켜짐</span></a><a href="#"><span>결제 수단</span><span class="v">카드 1개</span></a><a href="#"><span>고객센터</span><span class="v">평일 9~18시</span></a></nav></div>
<button class="gear" aria-label="설정">⚙</button>"""

# ── 6. 데스크톱 메일함 ───────────────────────────────────
IN_PAL = {"bg": "#FFFFFF", "page": "#E9ECF0", "text": "#15181D", "muted": "#59616C", "line": "#E1E4E8", "brand": "#1D4ED8"}
IN_CSS = """
.app{max-width:none;flex-direction:row}
.side{flex:none;width:200px;border-right:1px solid var(--line);padding:16px 12px;display:flex;flex-direction:column;gap:4px;background:#FAFBFC}
.compose{height:44px;border-radius:12px;background:var(--brand);color:#fff;font-size:15px;font-weight:700;margin-bottom:12px}
.fd{display:flex;align-items:center;gap:8px;min-height:40px;padding:0 12px;border-radius:10px;font-size:14px;color:var(--text);text-decoration:none;position:relative}.fd.on{background:#E8EEFC;font-weight:700}
.fd .l{white-space:nowrap}.fd .n{margin-left:auto;font-size:12px;font-weight:700;color:#1E40AF}
.list{flex:none;width:320px;border-right:1px solid var(--line);overflow-y:auto}
.tb{display:flex;align-items:center;gap:4px;height:52px;padding:0 12px;border-bottom:1px solid var(--line)}.tb button{width:40px;height:40px;border-radius:10px;background:transparent;font-size:16px;color:var(--text)}
.ml{display:block;padding:12px 16px;border-bottom:1px solid var(--line);color:var(--text);text-decoration:none}
.ml .r1{display:flex;gap:8px;align-items:baseline}.ml b{flex:1;min-width:0;font-size:14px;line-height:20px}.ml time{flex:none;font-size:12px;line-height:16px;color:var(--muted);white-space:nowrap}
.ml .s{display:block;font-size:14px;line-height:20px;margin-top:2px;overflow-wrap:anywhere}.ml .p{display:block;font-size:13px;line-height:18px;color:var(--muted);margin-top:2px}
.read{flex:1;min-width:0;overflow-y:auto;padding:24px 32px}
.read h1{margin:0 0 8px;font-size:22px;line-height:30px}.read .from{font-size:13px;line-height:18px;color:var(--muted);margin:0 0 20px}
.read p{font-size:15px;line-height:25px;margin:0 0 14px}
.att{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.att a{display:flex;align-items:center;gap:8px;height:44px;padding:0 14px;border:1px solid var(--line);border-radius:10px;font-size:13px;color:var(--text);text-decoration:none;white-space:nowrap}
"""


def ml(who, date, subj, prev):
    return f'<a class="ml" href="#"><span class="r1"><b>{who}</b><time>{date}</time></span><span class="s">{subj}</span><span class="p">{prev}</span></a>'


IN_OK = f"""<aside class="side"><button class="compose">메일 쓰기</button>
<a class="fd on" href="#"><span class="l">받은편지함</span><span class="n">12</span></a><a class="fd" href="#"><span class="l">별표 편지함</span></a><a class="fd" href="#"><span class="l">보낸편지함</span></a><a class="fd" href="#"><span class="l">임시보관함</span><span class="n">3</span></a><a class="fd" href="#"><span class="l">협업 프로젝트 공유함</span><span class="n">128</span></a></aside>
<section class="list"><div class="tb"><button aria-label="새로고침">↻</button><button aria-label="보관">▤</button><button aria-label="삭제">✕</button><button aria-label="읽음 표시">✓</button></div>
{ml('박서준', '오전 9:12', '4분기 디자인 시스템 개편 일정 공유', '다음 주 월요일까지 컴포넌트 목록을 정리해 주세요.')}
{ml('운영팀', '2026.10.09', '서버 점검 안내(10월 12일 일요일 새벽 2시~4시, 관리자 화면 접속 불가)', '점검 시간에는 관리자 화면에 접속할 수 없습니다.')}
{ml('이수민', '2026.10.08', '회의록: 온보딩 개선 회의', '결정 사항 세 가지와 담당자를 정리했습니다.')}
{ml('채용팀', '2026.10.07', '면접 일정 확인 부탁드립니다', '지원자 두 명의 면접 시간을 확정해 주세요.')}</section>
<article class="read"><h1>4분기 디자인 시스템 개편 일정 공유</h1><p class="from">박서준 &lt;seojun.park@example.com&gt; · 오전 9:12</p>
<p>안녕하세요. 4분기 디자인 시스템 개편 일정을 공유드립니다. 1단계는 색과 글자 토큰 정리, 2단계는 버튼·입력칸·카드 컴포넌트 교체입니다.</p>
<p>각 팀은 다음 주 월요일까지 현재 쓰는 컴포넌트 목록을 첨부한 시트에 적어 주세요. 질문은 이 메일에 회신해 주시면 됩니다.</p>
<div class="att"><a href="#">일정표_4분기.pdf</a><a href="#">컴포넌트_목록.xlsx</a><a href="#">토큰_정리안_v3.fig</a></div></article>"""

SCREENS = {
    "music": ("지금 재생 중", MUSIC_PAL, MUSIC_CSS, MUSIC_OK, M5),
    "workout": ("운동 기록", WK_PAL, WK_CSS, WK_OK, M5),
    "article": ("뉴스 기사", NEWS_PAL, NEWS_CSS, NEWS_OK, M5),
    "survey": ("맞춤 설정", SV_PAL, SV_CSS, SV_OK, M5),
    "profile": ("마이페이지", PF_PAL, PF_CSS, PF_OK, M5),
    "inbox": ("메일함", IN_PAL, IN_CSS, IN_OK, W4),
}

# (화면, 변형, 유형, 설명, 추가 CSS, 마크업 바꾸기, 확인 크기, 정답 측정, 글자 힌트)
# 유형: R1~R7·A1·A2·D4는 dqa에 규칙이 있는 종류. D2(색 토큰)·L2(간격)·D3(글자 스타일)·F1(크기 방식)·S4(선택 상태)·L1(정렬)은 규칙 밖
V = [
    ("music", "r2-add", "R2", "'재생목록에 추가' 버튼 폭을 96px로 고정하고 넘침을 숨겨 글자 끝이 잘림", ".add{width:96px;overflow:hidden;padding:0 12px}", [], M5, {"type": "clipped_text", "sel": ".add"}, ["재생목록에 추가"]),
    ("music", "r3-hq", "R3", "'무손실' 배지를 절대 위치(left:84px)로 옮겨 가수·앨범 줄 위에 얹힘", ".meta .t{position:relative}.hq{position:absolute;left:84px;top:30px;margin:0}", [], M5, {"type": "overlap_text", "sel": ".meta p", "other": ".hq"}, ["모노레일", "무손실"]),
    ("music", "d4-cover", "D4", "앨범 표지 높이를 240px로 고정하고 object-fit을 빼 정사각형 그림이 늘어남", ".art{aspect-ratio:auto;height:240px;object-fit:fill}", [], M5, {"type": "img_ratio", "sel": ".art"}, ["앨범 표지"]),
    ("music", "a1-more", "A1", "다음 곡 목록의 더보기 버튼 폭을 16px로 줄임", ".qi .more{width:16px;height:32px}", [], M5, {"type": "target", "sel": ".qi .more", "min": 24}, ["더보기"]),
    ("music", "d2-play", "D2", "재생 버튼 색을 토큰(#6D28D9) 대신 비슷한 #7C3AED로 직접 씀", ".ctl .play{background:#7C3AED}", [], ["375x812"], {"type": "style", "sel": ".ctl .play", "prop": "background-color", "value": "rgb(109, 40, 217)"}, []),
    ("workout", "r6-steps", "R6", "통계 숫자 크기를 24px로 키우면서 줄바꿈 금지를 빼 '12,480'이 꺾임", ".st b{font-size:24px;white-space:normal;word-break:break-all}", [], M5, {"type": "lines", "sel": ".st b"}, ["12,480", "1,284"]),
    ("workout", "r1-seg", "R1", "기간 탭 버튼에 시안 폭 96px를 고정해 탭 줄이 화면 밖으로 넘침", ".seg button{flex:none;width:96px}", [], M5, {"type": "overflow", "sel": ".seg"}, ["연", "월"]),
    ("workout", "r4-head", "R4", "기간 탭을 고정 위치로 바꾸면서 아래 내용에 그만큼 위 여백을 안 줘 첫 통계 칸이 가려짐", ".seg{position:absolute;top:52px;left:0;right:0;z-index:2;margin:0;border-radius:0;padding:8px 20px}", [], M5, {"type": "covered", "sel": ".st"}, ["12,480", "걸음"]),
    ("workout", "a2-axis", "A2", "그래프 요일 글자를 #BFC5CC로 옅게 함", ".axis span{color:#BFC5CC}", [], M5, {"type": "contrast", "sel": ".axis span", "min": 4.5}, ["월", "화", "수", "목", "금", "토", "일"]),
    ("workout", "l2-gap", "L2", "운동 카드 사이 간격을 시안 10px 대신 4px로 씀", ".wk{margin-bottom:4px}", [], ["375x812"], {"type": "style", "sel": ".wk", "prop": "margin-bottom", "value": "10px"}, []),
    ("article", "r1-img", "R1", "본문 그래프 그림의 max-width를 빼 폭 400px 그림이 좁은 화면 밖으로 넘침", "figure .fig2{max-width:none}", [], M5, {"type": "overflow", "sel": "figure.c"}, ["그래프"]),
    ("article", "r4-share", "R4", "본문 아래 여백을 없애 끝까지 내려도 '다른 기사 더 보기'가 공유 막대에 가려짐", ".art{padding-bottom:0}", [], M5, {"type": "covered", "sel": ".more", "scroll": ".art"}, ["더 보기"]),
    ("article", "a2-by", "A2", "기자 이름·시각을 #A3A9B3로 옅게 함", ".by span{color:#A3A9B3}", [], M5, {"type": "contrast", "sel": ".by span", "min": 4.5}, ["정다은"]),
    ("article", "r2-rel", "R2", "관련 기사 제목 칸 높이를 한 줄(20px)로 고정하고 넘침을 숨겨 두 번째 줄이 잘림", ".ri b{height:20px;overflow:hidden}", [], M5, {"type": "clipped_text", "sel": ".ri b"}, ["배추 한 포기", "대형마트 3사", "폭염 지나자"]),
    ("article", "r3-cap", "R3", "사진 설명을 음수 여백으로 끌어올려 사진 위에 글자가 얹힘", "figcaption{margin-top:-26px;position:relative}", [], M5, {"type": "overlap_text", "sel": "figcaption", "other": "figure img"}, ["사진 연합", "채소 코너"]),
    ("article", "d3-head", "D3", "기사 제목 굵기를 시안 800 대신 500으로 씀", ".art h1{font-weight:500}", [], ["375x812"], {"type": "style", "sel": ".art h1", "prop": "font-weight", "value": "800"}, []),
    ("survey", "r4-toast", "R4", "'임시 저장' 알림을 화면 아래 16px에 띄워 '다음' 버튼을 덮음", ".toast{bottom:16px}", [], M5, {"type": "covered", "sel": ".next"}, ["다음"]),
    ("survey", "r3-steps", "R3", "단계 이름의 말줄임을 빼고 글자를 키워 좁은 화면에서 옆 단계 이름과 겹침", ".steps div{overflow:visible;text-overflow:clip;font-size:15px;font-weight:700}", [], M5, {"type": "overlap_text", "sel": ".steps div", "other": ".steps div"}, ["알림 받을 시간", "관심 운동", "기본 정보"]),
    ("survey", "a1-skip", "A1", "'건너뛰기' 버튼 높이를 글자 높이(14px)만 남김", ".top .skip{height:auto;padding:0;font-size:12px;line-height:14px}", [], M5, {"type": "target", "sel": ".skip", "min": 24}, ["건너뛰기"]),
    ("survey", "r6-scale", "R6", "강도 버튼 글자를 16px로 키우고 안쪽 여백을 늘려 좁은 화면에서 '강하게'가 꺾임", ".scale button{font-size:16px;line-height:20px;padding:0 6px}", [], M5, {"type": "lines", "sel": ".scale button"}, ["강하게", "가볍게"]),
    ("survey", "f1-next", "F1", "'다음' 버튼을 시안의 Fill 대신 고정 240px로 씀", ".next{width:240px;margin:0 auto}", [], ["375x812", "430x932"], {"type": "fill_width", "sel": ".next"}, []),
    ("survey", "s4-sel", "S4", "고른 항목의 선택 상태 배경·테두리를 빼 무엇을 골랐는지 안 보임", ".opt.sel{border-color:var(--line);background:#fff}", [], ["375x812"], {"type": "style", "sel": ".opt.sel", "prop": "background-color", "value": "rgb(240, 245, 255)"}, []),
    ("profile", "r3-ver", "R3", "'인증' 배지를 이름 옆 절대 위치(left:56px)로 고정해 네 글자 이름과 겹침", ".who h1{display:block;position:relative}.ver{position:absolute;left:56px;top:3px}", [], M5, {"type": "overlap_text", "sel": ".who h1 span", "other": ".ver"}, ["김하늘별", "인증"]),
    ("profile", "d4-cover", "D4", "배경 사진 경로 확장자를 잘못 적어(cover.jpg) 그림이 깨짐", "", [('src="cover.png"', 'src="cover.jpg"')], M5, {"type": "img_broken", "sel": ".cover"}, ["프로필 배경"]),
    ("profile", "a1-gear", "A1", "설정 버튼을 아이콘 크기 20px로 줄임", ".gear{width:20px;height:20px;right:16px;top:16px;font-size:12px}", [], M5, {"type": "target", "sel": ".gear", "min": 24}, ["설정"]),
    ("profile", "r1-nums", "R1", "숫자 칸 세 개를 시안 폭 120px로 고정해 좁은 화면에서 표가 밖으로 넘침", ".nums{grid-template-columns:repeat(3,120px)}", [], M5, {"type": "overflow", "sel": ".nums"}, ["팔로잉", "312"]),
    ("profile", "a2-menu", "A2", "메뉴 오른쪽 값 글자를 #B5BBC4로 옅게 함", ".menu a .v{color:#B5BBC4}", [], M5, {"type": "contrast", "sel": ".menu a .v", "min": 4.5}, ["32개", "켜짐", "카드 1개", "평일"]),
    ("profile", "l1-who", "L1", "프로필 사진과 이름 줄의 아래 맞춤(flex-end)을 위 맞춤으로 바꿔 이름이 사진 위쪽에 붙음", ".who{align-items:flex-start}", [], ["375x812"], {"type": "style", "sel": ".who", "prop": "align-items", "value": "flex-end"}, []),
    ("inbox", "r1-subject", "R1", "메일 제목의 단어 끊기를 빼 긴 제목이 목록 칸 밖으로 넘침", ".ml .s{overflow-wrap:normal;white-space:nowrap}", [], W4, {"type": "overflow_text", "sel": ".ml .s"}, ["서버 점검 안내", "디자인 시스템"]),
    ("inbox", "r3-badge", "R3", "편지함 안 읽은 수를 절대 위치(left:112px)로 고정해 긴 편지함 이름과 겹침", ".fd .n{position:absolute;left:112px;margin:0}", [], W4, {"type": "overlap_text", "sel": ".fd .l", "other": ".fd .n"}, ["협업 프로젝트"]),
    ("inbox", "r6-date", "R6", "날짜 칸 폭을 56px로 고정하고 글자 끊기를 허용해 '2026.10.09'가 꺾임", ".ml time{width:56px;white-space:normal;word-break:break-all}", [], W4, {"type": "lines", "sel": ".ml time"}, ["2026.10"]),
    ("inbox", "a2-preview", "A2", "미리보기 글자를 #B4B9C2로 옅게 함", ".ml .p{color:#B4B9C2}", [], W4, {"type": "contrast", "sel": ".ml .p", "min": 4.5}, ["다음 주", "점검 시간", "결정 사항", "지원자"]),
    ("inbox", "r2-att", "R2", "첨부 줄 높이를 한 줄(44px)로 고정하고 넘침을 숨겨 좁은 창에서 두 번째 줄 첨부가 사라짐", ".att{height:44px;overflow:hidden}", [], W4, {"type": "clipped_parent", "sel": ".att a"}, ["토큰_정리안", "컴포넌트_목록"]),
    ("inbox", "l1-toolbar", "L1", "목록 도구 막대의 세로 가운데 맞춤을 빼 버튼이 위로 붙음", ".tb{align-items:flex-start}", [], ["1280x800"], {"type": "style", "sel": ".tb", "prop": "align-items", "value": "center"}, []),
]


def images(d, screen):
    def img(name, w, h, c1, c2, kind):
        im = Image.new("RGB", (w, h), c1); dr = ImageDraw.Draw(im)
        if kind == "photo":
            dr.rectangle([0, h * 0.6, w, h], fill=c2); dr.ellipse([w * 0.6, h * 0.15, w * 0.8, h * 0.15 + w * 0.2], fill="#F6C343")
        elif kind == "chart":
            for k, v in enumerate([0.5, 0.62, 0.48, 0.4, 0.33, 0.28, 0.25]):
                x = 30 + k * 50; dr.rectangle([x, h - 20 - (h - 40) * v, x + 30, h - 20], fill=c2)
            dr.line([20, h - 20, w - 10, h - 20], fill="#333333", width=2)
        elif kind == "disc":
            dr.ellipse([w * 0.1, h * 0.1, w * 0.9, h * 0.9], fill=c2); dr.ellipse([w * 0.42, h * 0.42, w * 0.58, h * 0.58], fill=c1)
        else:
            dr.ellipse([w * 0.15, h * 0.15, w * 0.85, h * 0.85], fill=c2)
        im.save(d / name)
    if screen == "music":
        img("cover.png", 600, 600, "#2E1065", "#A78BFA", "disc")
        for i, (a, b) in enumerate([("#FDE68A", "#D97706"), ("#BFDBFE", "#2563EB"), ("#FBCFE8", "#DB2777"), ("#BBF7D0", "#16A34A")], 1): img(f"q{i}.png", 88, 88, a, b, "dot")
    if screen == "article":
        img("by.png", 56, 56, "#E5E7EB", "#6B7280", "dot"); img("photo.png", 960, 540, "#DCFCE7", "#15803D", "photo"); img("chart.png", 400, 200, "#FFFFFF", "#B4232C", "chart")
        for i, (a, b) in enumerate([("#FEF3C7", "#B45309"), ("#E0E7FF", "#4338CA"), ("#FCE7F3", "#BE185D")], 1): img(f"rel{i}.png", 144, 108, a, b, "photo")
    if screen == "profile":
        img("cover.png", 860, 240, "#DCE6F2", "#7FA6CF", "photo"); img("avatar.png", 160, 160, "#FDE2E4", "#E5989B", "dot")


def rules_sha1():
    """고정 기준: dqa 측정 규칙 파일(inpage.js·cluster.js)의 내용 해시. 커밋 전에도 고정 상태를 확인할 수 있다"""
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
        cases.append({"id": f"blind2-{scr}-ok", "screen": scr, "variant": "ok", "code": None, "defect": "맞게 만든 구현", "dir": f"eval/synth/blind2/screens/{scr}/ok", "sizes": sizes, "check": None, "hint": []})
    for scr, var, code, desc, extra, subs, sizes, check, hint in V:
        title, pal, css, ok, _ = SCREENS[scr]
        html = ok
        for a, b in subs:
            assert html.count(a) == 1, (scr, var, a)
            html = html.replace(a, b)
        d = OUT / scr / var; d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(f"{title} · {var}", pal, css + extra, html)); images(d, scr)
        cases.append({"id": f"blind2-{scr}-{var}", "screen": scr, "variant": var, "code": code, "defect": desc, "dir": f"eval/synth/blind2/screens/{scr}/{var}", "sizes": sizes, "check": check, "hint": hint})
    (HERE / "cases.json").write_text(json.dumps({"note": "블라인드 합성 예제 2묶음(10-10). 블라인드 1의 빈틈을 고친 규칙을 고정하고 한 번만 잰다. 규칙 밖 유형: D2 색 토큰, L2 간격, D3 글자 스타일, F1 크기 방식, S4 선택 상태, L1 정렬.", "frozen_rules_sha1": rules_sha1(), "cases": cases}, ensure_ascii=False, indent=1) + "\n")
    print(f"화면 {len(SCREENS)}개, 결함 {len(V)}개, 유형 {sorted({v[2] for v in V})}, 규칙 해시 {rules_sha1()[:10]}")


if __name__ == "__main__":
    main()
