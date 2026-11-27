"""합성 Figma-HTML 예제 생성기(10-10, 2판). 팀 앱과 다른 여러 종류의 앱 화면에 여러 종류의 결함을 하나씩 심는다.
화면 6개: shop(상품 상세), cart(배달 장바구니), transfer(송금), settings(설정), chat(채팅), dash(데스크톱 대시보드)
변형은 맞게 만든 구현(ok)과 CSS 한 줄이나 마크업 한 군데만 다르다. 정답 확인은 verify_synth.js가 선택자 기반 측정으로 한다.
사용: python3 eval/synth/make_synth.py  → screens/<화면>/<변형>/index.html(+그림), cases.json
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
OUT = HERE / "screens"

M5 = ["375x812", "390x844", "430x932", "375x667", "320x568"]
W4 = ["1280x800", "1024x768", "768x1024"]
N3 = ["375x812@47,34", "390x844@47,34", "430x932@59,34"]  # 노치·홈 인디케이터가 있는 기기(안전영역 위·아래)

BASE = """*{box-sizing:border-box}html,body{margin:0;font-family:"Apple SD Gothic Neo","Noto Sans KR",sans-serif;color:var(--text);background:var(--page)}
button{font-family:inherit;border:0;cursor:pointer}
#root{min-height:100vh;display:flex;justify-content:center}
.app{width:100%;max-width:430px;height:100vh;background:var(--bg);position:relative;display:flex;flex-direction:column;overflow:hidden}
.top{flex:none;height:52px;display:flex;align-items:center;gap:12px;padding:0 16px;border-bottom:1px solid var(--line);background:var(--bg)}
.top .ttl{font-size:17px;font-weight:700;flex:1}
.icon{width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:transparent;flex:none}
.icon svg{width:22px;height:22px}
.scroll{flex:1;overflow-y:auto}
"""


def svg(kind):
    return {"back": '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="#222" stroke-width="2"/></svg>',
            "cart": '<svg viewBox="0 0 24 24"><path d="M3 4h2l2 11h11l2-8H6" fill="none" stroke="#222" stroke-width="2"/></svg>',
            "heart": '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" fill="none" stroke="#222" stroke-width="2"/></svg>',
            "plus": '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="#222" stroke-width="2"/></svg>',
            "send": '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2-6z" fill="#fff"/></svg>'}[kind]


def page(title, palette, css, body):
    root = ":root{" + ";".join(f"--{k}:{v}" for k, v in palette.items()) + "}"
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>{title}</title>
<style>{root}{BASE}{css}</style></head><body><div id="root"><div class="app">{body}</div></div></body></html>
"""


# ── 1. 쇼핑 상품 상세 ────────────────────────────────────
SHOP_PAL = {"bg": "#FFFFFF", "page": "#F2F2F2", "text": "#111111", "muted": "#6B6B6B", "line": "#EAEAEA", "brand": "#0B7DB5", "sale": "#C9302C"}
SHOP_CSS = """
.hero{background:#F7F7F7}.photo{display:block;width:100%;height:auto;aspect-ratio:4/3;object-fit:cover}
.info{padding:16px 16px 12px}.brand{margin:0;font-size:13px;color:var(--muted)}
.name{margin:4px 0 8px;font-size:18px;line-height:26px;font-weight:600}
.price{margin:0;display:flex;align-items:baseline;gap:8px}.price .pct{color:var(--sale);font-size:18px;font-weight:700}
.price b{font-size:22px;line-height:30px;white-space:nowrap}.price s{font-size:13px;color:var(--muted)}
.sec{padding:14px 16px;border-top:8px solid #F5F5F5}.lab{margin:0 0 10px;font-size:15px;font-weight:700}
.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{height:36px;padding:0 14px;border:1px solid var(--line);border-radius:18px;display:flex;align-items:center;font-size:14px}
.chip.on{border-color:var(--brand);color:var(--brand);font-weight:600}
.rev{margin:0 0 10px;font-size:14px;line-height:21px}.rev:last-child{margin-bottom:0}
.buybar{flex:none;display:flex;gap:8px;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line);background:var(--bg)}
.like{width:52px;height:52px;border-radius:10px;background:#fff;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;flex:none}
.like svg{width:22px;height:22px}
.buy{flex:1;height:52px;border-radius:10px;background:var(--brand);color:#fff;font-size:17px;font-weight:700}
"""
SHOP_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{svg('back')}</button><span class="ttl">상품 상세</span><button class="icon" aria-label="장바구니">{svg('cart')}</button></div>
<div class="scroll"><div class="hero"><img class="photo" src="photo.png" alt="원목 선반 사진"></div>
<div class="info"><p class="brand">우드랩 셀렉트</p><h1 class="name">북유럽 원목 3단 선반 화이트오크 조립식 수납장</h1><p class="price"><span class="pct">32%</span><b>39,900원</b><s>59,000원</s></p></div>
<div class="sec"><p class="lab">색상</p><div class="chips"><span class="chip on">화이트오크</span><span class="chip">월넛</span><span class="chip">블랙</span></div></div>
<div class="sec"><p class="lab">배송</p><p class="rev">내일(금) 도착 보장 · 무료배송</p></div>
<div class="sec reviews"><p class="lab">리뷰 128</p><p class="rev">조립이 쉬워요. 30분이면 끝납니다.</p><p class="rev">색이 사진보다 조금 밝아요.</p><p class="rev">튼튼하고 흔들림이 없어요.</p></div></div>
<div class="buybar"><button class="like" aria-label="찜하기">{svg('heart')}</button><button class="buy">구매하기</button></div>"""

# ── 2. 배달 장바구니 ─────────────────────────────────────
CART_PAL = {"bg": "#FFFFFF", "page": "#F0F0F0", "text": "#1A1A1A", "muted": "#6E6E6E", "line": "#EEEEEE", "brand": "#0F7C78", "point": "#C2410C"}
CART_CSS = """
.store{padding:14px 16px;font-size:16px;font-weight:700;border-bottom:1px solid var(--line)}
.item{display:flex;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);position:relative}
.thumb{width:64px;height:64px;border-radius:10px;flex:none;object-fit:cover}
.meta{flex:1;min-width:0}.meta b{display:block;font-size:15px;line-height:22px}.meta span{display:block;font-size:13px;line-height:19px;color:var(--muted)}
.meta .p{color:var(--text);font-weight:700;margin-top:4px}
.step{display:flex;align-items:center;border:1px solid var(--line);border-radius:8px;height:44px;align-self:flex-end;flex:none}
.step button{width:44px;height:44px;background:#fff;font-size:18px}.step i{font-style:normal;width:24px;text-align:center;font-size:15px}
.coupon{display:flex;gap:8px;padding:16px}.coupon input{flex:1;min-width:0;height:44px;border:1px solid var(--line);border-radius:10px;padding:0 12px;font-size:15px;font-family:inherit}
.coupon button{height:44px;padding:0 16px;border-radius:10px;background:#F4F4F4;font-size:15px;font-weight:600}
.sum{padding:8px 16px 16px}.sum p{display:flex;justify-content:space-between;margin:8px 0;font-size:15px}.sum .tot{font-size:17px;font-weight:700}.sum .tot em{font-style:normal;color:var(--text)}
.ctabar{flex:none;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line)}
.cta{width:100%;height:54px;border-radius:12px;background:var(--brand);color:#fff;font-size:17px;font-weight:700;white-space:nowrap}
"""


def cart_item(name, opt, price, img):
    return f"""<div class="item"><img class="thumb" src="{img}" alt=""><div class="meta"><b>{name}</b><span>{opt}</span><span class="p">{price}</span></div>
<div class="step"><button aria-label="빼기">−</button><i>1</i><button aria-label="더하기">+</button></div></div>"""


CART_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{svg('back')}</button><span class="ttl">장바구니</span></div>
<div class="scroll"><div class="store">버거하우스 서교점</div>
{cart_item('더블 치즈버거 세트', '감자튀김 L · 콜라 제로로 변경 · 피클 빼기', '12,900원', 'food1.png')}
{cart_item('치킨 텐더 4조각', '허니머스터드', '6,500원', 'food2.png')}
{cart_item('바닐라 쉐이크', '레귤러', '4,500원', 'food3.png')}
<div class="coupon"><input placeholder="쿠폰 코드 입력"><button>적용</button></div>
<div class="sum"><p><span>상품 금액</span><span>23,900원</span></p><p><span>배달팁</span><span>3,000원</span></p><p class="tot"><span>총 결제 금액</span><em>26,900원</em></p></div></div>
<div class="ctabar"><button class="cta">26,900원 결제하기</button></div>"""

# ── 3. 송금 ──────────────────────────────────────────────
TR_PAL = {"bg": "#FFFFFF", "page": "#E9ECF1", "text": "#191F28", "muted": "#5B6573", "line": "#E5E8EB", "brand": "#1B64DA"}
TR_CSS = """
.safe{flex:none;height:env(safe-area-inset-top,0px)}
.who{padding:20px 24px 0}.who p{margin:0;font-size:15px;color:var(--muted)}.who b{font-size:22px;line-height:32px;color:var(--text)}
.amt{padding:20px 24px 4px;font-size:40px;line-height:52px;font-weight:700;letter-spacing:-0.5px;white-space:nowrap}
.hint{padding:0 24px;margin:0;font-size:13px;line-height:18px;color:var(--muted)}
.quick{display:flex;gap:8px;padding:16px 24px}.quick button{flex:1;height:40px;border-radius:10px;background:#F2F4F6;font-size:14px;font-weight:600;color:#3D4752}
.pad{flex:1;display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:1fr;min-height:0;padding:0 8px}
.pad button{background:#fff;font-size:24px;font-weight:600;color:var(--text);min-height:0}
.next{flex:none;margin:8px 16px calc(12px + env(safe-area-inset-bottom,0px));height:56px;border-radius:14px;background:var(--brand);color:#fff;font-size:17px;font-weight:700}
"""
TR_OK = f"""<div class="safe"></div><div class="top"><button class="icon" aria-label="뒤로">{svg('back')}</button><span class="ttl">송금</span></div>
<div class="who"><p>받는 분</p><b>김민지 · 국민 123-45-6789</b></div>
<div class="amt" data-amt>1,250,000원</div><p class="hint">하루 최대 1,000만원까지 보낼 수 있어요</p>
<div class="quick"><button>+1만</button><button>+5만</button><button>+10만</button><button>전액</button></div>
<div class="pad">{''.join(f'<button>{k}</button>' for k in ['1','2','3','4','5','6','7','8','9','00','0','⌫'])}</div>
<button class="next">다음</button>"""

# ── 4. 설정 ──────────────────────────────────────────────
SET_PAL = {"bg": "#FFFFFF", "page": "#EFEFF4", "text": "#1C1C1E", "muted": "#6E6E73", "line": "#E5E5EA", "brand": "#34C759"}
SET_CSS = """
.scroll{background:#F2F2F7}
.grp{margin:24px 0 0}.gh{margin:0 16px 6px;font-size:13px;color:var(--muted)}
.rows{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.row{display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 16px;border-bottom:1px solid var(--line)}.row:last-child{border-bottom:0}
.txt{flex:1;min-width:0}.txt b{display:block;font-size:16px;line-height:22px;font-weight:500}.txt span{display:block;font-size:13px;line-height:18px;color:var(--muted)}
.sw{width:51px;height:31px;border-radius:16px;background:var(--brand);position:relative;flex:none}.sw::after{content:"";position:absolute;right:2px;top:2px;width:27px;height:27px;border-radius:50%;background:#fff}
.sw.off{background:#E9E9EA}.sw.off::after{right:auto;left:2px}
.chev{flex:none;color:#C4C4C7;font-size:20px}
.ver{font-size:15px;color:var(--muted);white-space:nowrap;flex:none}
"""
SET_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{svg('back')}</button><span class="ttl">설정</span></div>
<div class="scroll">
<div class="grp"><p class="gh">알림</p><div class="rows">
<div class="row"><div class="txt"><b>주문 · 배송 알림</b><span>주문 상태가 바뀌면 바로 알려 드려요</span></div><div class="sw" role="switch" aria-checked="true" aria-label="주문 배송 알림"></div></div>
<div class="row"><div class="txt"><b>혜택 · 이벤트 알림</b><span>쿠폰과 할인 소식을 받아요</span></div><div class="sw off" role="switch" aria-checked="false" aria-label="혜택 이벤트 알림"></div></div>
<div class="row"><div class="txt"><b>야간 알림 받기(21시~08시, 주말 포함)</b><span>밤에도 중요한 알림을 받아요</span></div><div class="sw off" role="switch" aria-checked="false" aria-label="야간 알림"></div></div></div></div>
<div class="grp"><p class="gh">계정</p><div class="rows">
<div class="row"><div class="txt"><b>개인정보 관리</b></div><span class="chev">›</span></div>
<div class="row"><div class="txt"><b>연결된 기기</b></div><span class="chev">›</span></div></div></div>
<div class="grp"><p class="gh">앱 정보</p><div class="rows"><div class="row"><div class="txt"><b>버전</b></div><span class="ver">3.2.1 (빌드 2026.10.10)</span></div></div></div>
</div>"""

# ── 5. 채팅 ──────────────────────────────────────────────
CHAT_PAL = {"bg": "#FFFFFF", "page": "#E3E6EA", "text": "#1E1E1E", "muted": "#6B6E73", "line": "#E6E6E6", "brand": "#4752C4", "chatbg": "#C9D8E6"}
CHAT_CSS = """
.top .av{width:32px;height:32px;border-radius:50%;flex:none;object-fit:cover;background:#ddd}
.scroll{background:var(--chatbg);padding:12px 12px 16px;display:flex;flex-direction:column;gap:10px}
.day{align-self:center;font-size:12px;color:#fff;background:rgba(0,0,0,.18);padding:4px 10px;border-radius:12px}
.msg{display:flex;gap:6px;align-items:flex-end;max-width:100%}.msg.me{flex-direction:row-reverse}
.bub{max-width:72%;padding:9px 12px;border-radius:16px;background:#fff;font-size:15px;line-height:21px;overflow-wrap:anywhere}
.me .bub{background:#FEE500}
.t{font-size:11px;color:#2F3A45;flex:none}
.composer{flex:none;display:flex;gap:8px;align-items:center;padding:8px 10px calc(8px + env(safe-area-inset-bottom,0px));background:#fff;border-top:1px solid var(--line)}
.composer .icon{background:#F2F3F5}
.composer textarea{flex:1;min-width:0;height:44px;border:1px solid var(--line);border-radius:22px;padding:11px 14px;font-size:15px;font-family:inherit;resize:none}
.sendb{width:44px;height:44px;border-radius:50%;background:var(--brand);display:flex;align-items:center;justify-content:center;flex:none}.sendb svg{width:20px;height:20px}
"""


def msg(text, t, me=False):
    return f'<div class="msg{" me" if me else ""}"><div class="bub">{text}</div><span class="t">{t}</span></div>'


CHAT_OK = f"""<div class="top"><button class="icon" aria-label="뒤로">{svg('back')}</button><img class="av" src="avatar.png" alt="디자인팀"><span class="ttl">디자인팀 단톡</span></div>
<div class="scroll"><span class="day">2026년 10월 10일 금요일</span>
{msg('시안 최종본 올렸어요. 확인 부탁드려요!', '오후 2:10')}
{msg('링크 여기요 https://www.figma.com/design/AbCdEfGh1234567890/checkout-flow-final-v12?node-id=1203-44871', '오후 2:11')}
{msg('네 볼게요. 결제 화면 버튼 색이 바뀐 거죠?', '오후 2:13', True)}
{msg('맞아요. 토큰도 같이 바꿨어요', '오후 2:14')}
{msg('간격도 16에서 20으로 늘었어요. 카드 사이요', '오후 2:14')}
{msg('아 그건 못 봤네요. 다시 확인할게요', '오후 2:15', True)}
{msg('아이콘은 그대로예요', '오후 2:16')}
{msg('네네 알겠습니다', '오후 2:16', True)}
{msg('내일 오전까지 한 번 보여 주실 수 있을까요?', '오후 2:17')}
{msg('좋아요, 구현 들어갈게요', '오후 2:15', True)}</div>
<div class="composer"><button class="icon" aria-label="첨부">{svg('plus')}</button><textarea placeholder="메시지 입력"></textarea><button class="sendb" aria-label="보내기">{svg('send')}</button></div>"""

# ── 6. 데스크톱 대시보드 ─────────────────────────────────
DASH_PAL = {"bg": "#FFFFFF", "page": "#F5F6F8", "text": "#101828", "muted": "#475467", "line": "#EAECF0", "brand": "#6941C6"}
DASH_CSS = """
.app{max-width:none;flex-direction:row;background:var(--page)}
.side{width:220px;flex:none;background:#fff;border-right:1px solid var(--line);padding:20px 12px}.side b{display:block;font-size:18px;margin:0 8px 20px}
.side a{display:block;padding:10px 12px;border-radius:8px;font-size:14px;color:var(--muted);text-decoration:none}.side a.on{background:#F4EBFF;color:var(--brand);font-weight:600}
.main{flex:1;min-width:0;overflow-y:auto;padding:24px}
.main h1{margin:0 0 4px;font-size:22px}.main .sub{margin:0 0 20px;font-size:14px;color:var(--muted)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;min-width:0}.kpi span{display:block;font-size:13px;color:var(--muted)}.kpi b{display:block;font-size:26px;line-height:34px;margin-top:6px}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}.card h2{margin:0;padding:16px;font-size:16px;border-bottom:1px solid var(--line)}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:12px 16px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:12px;color:var(--muted);font-weight:600;background:#F9FAFB}.st{display:inline-block;padding:2px 8px;border-radius:10px;background:#ECFDF3;color:#027A48;font-size:12px;font-weight:600}
"""
ROWS = [("#20481", "김하늘", "무선 이어폰 프로 2세대", "2026-10-10 14:02", "189,000원", "배송 준비 중"), ("#20480", "이도윤", "스탠딩 데스크 1400", "2026-10-10 13:47", "349,000원", "결제 완료"),
        ("#20479", "박서준", "기계식 키보드 저소음 적축", "2026-10-10 13:15", "129,000원", "배송 중"), ("#20478", "최유나", "모니터암 듀얼", "2026-10-10 12:58", "79,000원", "배송 완료")]
DASH_OK = """<nav class="side"><b>스토어 관리</b><a class="on">대시보드</a><a>주문</a><a>상품</a><a>고객</a><a>정산</a></nav>
<main class="main"><h1>대시보드</h1><p class="sub">오늘 10월 10일 기준</p>
<div class="kpis"><div class="kpi"><span>오늘 주문</span><b>128건</b></div><div class="kpi"><span>오늘 매출</span><b>12,480,000원</b></div><div class="kpi"><span>취소 요청</span><b>3건</b></div><div class="kpi"><span>배송 지연</span><b>1건</b></div></div>
<div class="card"><h2>최근 주문</h2><div class="tw"><table><thead><tr><th>주문번호</th><th>고객</th><th>상품</th><th>주문 시각</th><th>금액</th><th>상태</th></tr></thead><tbody>""" + "".join(
    f"<tr><td>{a}</td><td>{b}</td><td>{c}</td><td>{d}</td><td>{e}</td><td><span class=\"st\">{f}</span></td></tr>" for a, b, c, d, e, f in ROWS) + "</tbody></table></div></div></main>"

SCREENS = {
    "shop": ("상품 상세", SHOP_PAL, SHOP_CSS, SHOP_OK, M5),
    "cart": ("장바구니", CART_PAL, CART_CSS, CART_OK, M5),
    "transfer": ("송금", TR_PAL, TR_CSS, TR_OK, M5 + N3),
    "settings": ("설정", SET_PAL, SET_CSS, SET_OK, M5),
    "chat": ("채팅", CHAT_PAL, CHAT_CSS, CHAT_OK, M5),
    "dash": ("대시보드", DASH_PAL, DASH_CSS, DASH_OK, W4),
}

# (화면, 변형, 유형, 설명, 추가 CSS, 마크업 바꾸기[(찾을 것, 바꿀 것)], 확인 크기, 정답 측정, 글자 힌트)
V = [
    ("shop", "r1-name", "R1", "긴 상품명에 줄바꿈을 막아(nowrap) 화면 밖으로 넘침", ".name{white-space:nowrap}", [], M5, {"type": "overflow_text", "sel": ".name"}, ["북유럽 원목"]),
    ("shop", "d4-stretch", "D4", "상품 사진 높이를 고정하고 object-fit을 fill로 둬 4:3 사진이 세로로 늘어남", ".photo{height:420px;aspect-ratio:auto;object-fit:fill}", [], M5, {"type": "img_ratio", "sel": ".photo"}, ["원목 선반 사진"]),
    ("shop", "r4-buybar", "R4", "구매 막대를 화면 아래에 겹쳐 고정하면서 목록 아래 여백을 안 줘 마지막 리뷰가 가려짐", ".buybar{position:absolute;left:0;right:0;bottom:0}", [], M5, {"type": "covered", "sel": ".reviews .rev:last-child", "scroll": ".scroll"}, ["튼튼하고"]),
    ("shop", "a1-like", "A1", "찜 버튼을 20px로 줄여 누르기 어려움(터치 영역 기준 24px 미만, WCAG 2.2)", ".like{width:20px;height:20px;border:0}.like svg{width:16px;height:16px}", [], M5, {"type": "target", "sel": ".like", "min": 24}, ["찜하기"]),
    ("shop", "d2-brand", "D2", "구매 버튼 색을 토큰(#0B7DB5) 대신 비슷한 #1A86BD로 씀(토큰 밖 값)", ".buy{background:#1A86BD}", [], M5, {"type": "style", "sel": ".buy", "prop": "background-color", "value": "rgb(11, 125, 181)"}, ["구매하기"]),
    ("cart", "a1-step", "A1", "수량 버튼을 20px로 줄여 누르기 어려움", ".step{height:22px}.step button{width:20px;height:20px;font-size:13px}", [], M5, {"type": "target", "sel": ".step button", "min": 24}, ["빼기", "더하기"]),
    ("cart", "r2-cta", "R2", "결제 버튼 폭을 150px로 고정하고 넘침을 숨겨 금액 문구가 잘림", ".cta{width:150px;overflow:hidden;text-overflow:clip;font-size:19px;padding:0 12px}", [], M5, {"type": "clipped_text", "sel": ".cta"}, ["결제하기"]),
    ("cart", "r1-coupon", "R1", "쿠폰 입력칸에 글자 수 폭(size=34)을 주고 줄어들지 못하게 해 적용 버튼이 화면 밖으로 밀려남", ".coupon input{flex:none;min-width:auto}", [('placeholder="쿠폰 코드 입력"', 'placeholder="쿠폰 코드 입력" size="34"')], M5, {"type": "overflow", "sel": ".coupon"}, ["적용", "쿠폰 코드"]),
    ("cart", "r6-price", "R6", "가격 칸을 좁게 고정해 '12,900원'이 두 줄로 꺾임", ".meta .p{width:44px}", [], M5, {"type": "wrap", "sel": ".meta .p", "line": 19}, ["12,900원"]),
    ("transfer", "r4-offscreen", "R4", "키패드 줄 높이를 72px로 고정해 짧은 화면에서 '다음' 버튼이 화면 밖으로 밀려 누를 수 없음", ".pad{flex:none;grid-auto-rows:72px}", [], M5, {"type": "offscreen", "sel": ".next"}, ["다음"]),
    ("transfer", "a2-hint", "A2", "안내 문구 색을 #C9CDD2로 옅게 해 흰 배경과 대비가 기준(4.5:1) 미만", ".hint{color:#C9CDD2}", [], M5, {"type": "contrast", "sel": ".hint", "min": 4.5}, ["하루 최대"]),
    ("transfer", "r6-amount", "R6", "금액에 줄바꿈 허용을 넣어(단어 끊기) 좁은 화면에서 '1,250,000원'이 꺾임", ".amt{white-space:normal;word-break:break-all;font-size:56px;line-height:64px}", [], M5, {"type": "wrap", "sel": ".amt", "line": 64, "pad": 24}, ["1,250,000원"]),
    ("transfer", "r4-notch", "R4", "상단 안전영역 여백을 빼 노치 기기에서 제목줄이 상태바·노치 아래로 들어감", ".safe{display:none}", [], N3, {"type": "safe_top", "sel": ".top .ttl"}, ["송금"]),
    ("settings", "a2-desc", "A2", "설명 글자를 #C7C7CC로 옅게 해 대비가 기준 미만", ".txt span{color:#C7C7CC}", [], M5, {"type": "contrast", "sel": ".txt span", "min": 4.5}, ["주문 상태가", "쿠폰과 할인"]),
    ("settings", "r3-switch", "R3", "제목에 줄바꿈을 막고 줄어들지 않게 해 좁은 화면에서 긴 제목이 스위치와 겹침", ".txt{flex:none;min-width:auto}.txt b{white-space:nowrap}.sw{position:absolute;right:16px}.row{position:relative}", [], M5, {"type": "overlap_text", "sel": ".txt b", "other": ".sw"}, ["야간 알림"]),
    ("settings", "a1-switch", "A1", "스위치를 30×18px로 줄여 누르기 어려움", ".sw{width:30px;height:18px}.sw::after{width:14px;height:14px}", [], M5, {"type": "target", "sel": ".sw", "min": 24}, ["주문 배송 알림"]),
    ("settings", "r2-version", "R2", "버전 칸 폭을 고정하고 말줄임으로 잘라 빌드 날짜가 안 보임", ".ver{width:96px;overflow:hidden;text-overflow:ellipsis}", [], M5, {"type": "clipped_text", "sel": ".ver"}, ["3.2.1"]),
    ("chat", "r1-url", "R1", "말풍선의 단어 끊기(overflow-wrap)를 빼 긴 링크가 말풍선 밖으로 넘침", ".bub{overflow-wrap:normal}", [], M5, {"type": "overflow_text", "sel": ".bub"}, ["figma.com"]),
    ("chat", "d4-avatar", "D4", "프로필 그림 경로가 틀려 깨진 그림이 보임", "", [('src="avatar.png"', 'src="avatar@2x.png"')], M5, {"type": "img_broken", "sel": ".top .av"}, ["디자인팀"]),
    ("chat", "r4-composer", "R4", "입력창을 화면 아래에 겹쳐 고정하면서 대화 목록 아래 여백을 안 줘 마지막 메시지가 가려짐", ".composer{position:absolute;left:0;right:0;bottom:0}", [], M5, {"type": "covered", "sel": ".scroll .msg:last-child .bub", "scroll": ".scroll"}, ["구현 들어갈게요"]),
    ("chat", "a1-send", "A1", "보내기 버튼을 20px로 줄여 누르기 어려움", ".sendb{width:20px;height:20px}.sendb svg{width:12px;height:12px}", [], M5, {"type": "target", "sel": ".sendb", "min": 24}, ["보내기"]),
    ("dash", "r1-table", "R1", "표 감싸개의 가로 스크롤을 빼 좁은 창에서 표가 화면 밖으로 나가고 페이지가 가로로 밀림", ".tw{overflow-x:visible}.main{overflow:visible}.card{overflow:visible}.app{overflow:visible}", [], W4, {"type": "page_overflow"}, ["주문 시각", "상태", "배송"]),
    ("dash", "r3-kpi", "R3", "KPI 칸을 4열로 고정해 좁은 창에서 큰 숫자가 옆 칸으로 넘어가 겹침", ".kpis{grid-template-columns:repeat(4,1fr)}.kpi b{white-space:nowrap}.kpi{overflow:visible}", [], W4, {"type": "overlap_text", "sel": ".kpi b", "other": ".kpi"}, ["12,480,000원"]),
    ("dash", "a2-muted", "A2", "표 머리글 색을 #B0B7C3로 옅게 해 대비가 기준 미만", "th{color:#B0B7C3}", [], W4, {"type": "contrast", "sel": "th", "min": 4.5}, ["주문번호"]),
]


def images(d, screen):
    def img(name, w, h, c1, c2, shape):
        im = Image.new("RGB", (w, h), c1); dr = ImageDraw.Draw(im)
        if shape == "shelf":
            for k in range(3): dr.rectangle([w * 0.2, h * (0.25 + 0.22 * k), w * 0.8, h * (0.25 + 0.22 * k) + h * 0.04], fill=c2)
            dr.rectangle([w * 0.2, h * 0.2, w * 0.23, h * 0.85], fill=c2); dr.rectangle([w * 0.77, h * 0.2, w * 0.8, h * 0.85], fill=c2)
            dr.ellipse([w * 0.44, h * 0.30, w * 0.56, h * 0.46], fill="#6B8E6B")  # 동그란 화분: 늘어나면 타원이 된다
        else:
            dr.ellipse([w * 0.15, h * 0.15, w * 0.85, h * 0.85], fill=c2)
        im.save(d / name)
    if screen == "shop": img("photo.png", 800, 600, "#EFE7DC", "#B08A5B", "shelf")
    if screen == "cart":
        img("food1.png", 128, 128, "#FFE8CC", "#E8A33D", "dot"); img("food2.png", 128, 128, "#FFF1D6", "#D98E2B", "dot"); img("food3.png", 128, 128, "#F3F0FF", "#C8B6FF", "dot")
    if screen == "chat": img("avatar.png", 96, 96, "#CFE3FF", "#5865F2", "dot")


def main():
    cases = []
    for scr, (title, pal, css, ok, sizes) in SCREENS.items():
        d = OUT / scr / "ok"; d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(f"{title} · ok", pal, css, ok)); images(d, scr)
        cases.append({"id": f"synth-{scr}-ok", "screen": scr, "variant": "ok", "code": None, "defect": "맞게 만든 구현", "dir": f"eval/synth/screens/{scr}/ok", "sizes": sizes, "check": None, "hint": []})
    for scr, var, code, desc, extra, subs, sizes, check, hint in V:
        title, pal, css, ok, _ = SCREENS[scr]
        html = ok
        for a, b in subs:
            assert html.count(a) == 1, (scr, var, a)
            html = html.replace(a, b)
        d = OUT / scr / var; d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(page(f"{title} · {var}", pal, css + extra, html)); images(d, scr)
        cases.append({"id": f"synth-{scr}-{var}", "screen": scr, "variant": var, "code": code, "defect": desc, "dir": f"eval/synth/screens/{scr}/{var}", "sizes": sizes, "check": check, "hint": hint})
    (HERE / "cases.json").write_text(json.dumps({"note": "합성 예제 2판(10-10). 팀 앱과 다른 앱 6종, 결함 24개. 정답은 verify_synth.js가 확인해 verified에 적는다.", "cases": cases}, ensure_ascii=False, indent=1) + "\n")
    print(f"화면 {len(SCREENS)}개, 결함 변형 {len(V)}개, 유형 {sorted({v[2] for v in V})}")


if __name__ == "__main__":
    main()
