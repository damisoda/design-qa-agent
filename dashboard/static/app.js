/* 로봇 데이터 에이전트 대시보드 — 화면 스크립트
   원칙: 화면의 모든 수치는 서버 API(실제 파일·실제 실행)에서 온다. 없으면 없다고 보여 준다.
   외부 라이브러리 없음. 서버에서 온 글자는 textContent/텍스트 노드로만 넣는다(innerHTML 사용 안 함). */
'use strict';

/* ════════════════ 1. 공용 도구 ════════════════ */

const $ = (sel, root = document) => root.querySelector(sel);
const SVGNS = 'http://www.w3.org/2000/svg';

function appendKids(node, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    node.append(k instanceof Node ? k : String(k));
  }
  return node;
}

/** 안전한 DOM 생성기. text/문자열 자식은 항상 텍스트 노드가 된다. */
function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = String(v);
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  return appendKids(node, kids);
}

function svg(tag, attrs, ...kids) {
  const node = document.createElementNS(SVGNS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
      else if (k === 'text') node.textContent = String(v);
      else node.setAttribute(k, String(v));
    }
  }
  return appendKids(node, kids);
}

function icon(name, cls) {
  return svg('svg', { class: 'ic' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', focusable: 'false' },
    svg('use', { href: '#i-' + name }));
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** 0.88 → "88", 0.885 → "88.5". 값이 없으면 null */
function pctText(rate) {
  if (!isNum(rate)) return null;
  const p = Math.round(rate * 1000) / 10;
  return Number.isInteger(p) ? String(p) : p.toFixed(1);
}

function fmtDuration(sec) {
  if (!isNum(sec)) return null;
  if (sec < 60) return `${(Math.round(sec * 10) / 10).toFixed(1)}초`;
  const total = Math.round(sec);
  const m = Math.floor(total / 60), s = total % 60;
  if (m < 60) return s ? `${m}분 ${s}초` : `${m}분`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}

/** 서버의 MB는 바이트 ÷ 1,000,000(십진) 기준이므로 GB도 ÷ 1000으로 맞춘다 */
function fmtMem(mb) {
  if (!isNum(mb)) return null;
  return mb >= 1000 ? [(mb / 1000).toFixed(2), 'GB'] : [String(Math.round(mb)), 'MB'];
}

function fmtInt(n) { return isNum(n) ? n.toLocaleString('ko-KR') : null; }

/** ISO 문자열, 초/밀리초 숫자, "YYYYMMDDHHMMSS"를 모두 Date로 */
function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v);
  const str = String(v).trim();
  if (/^\d{14}$/.test(str)) {
    return new Date(+str.slice(0, 4), +str.slice(4, 6) - 1, +str.slice(6, 8), +str.slice(8, 10), +str.slice(10, 12), +str.slice(12, 14));
  }
  if (/^\d+(\.\d+)?$/.test(str)) return toDate(Number(str));
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad2 = (n) => String(n).padStart(2, '0');
function fmtClock(d, withSec) {
  if (!d) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}${withSec ? ':' + pad2(d.getSeconds()) : ''}`;
}
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtDay(d) {
  if (!d) return '';
  const now = new Date();
  if (sameDay(d, now)) return '오늘';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return '어제';
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}월 ${d.getDate()}일` : `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
function fmtWhen(v) {
  const d = toDate(v);
  return d ? `${fmtDay(d)} ${fmtClock(d)}` : null;
}

/** 답변 글을 안전하게 그린다: 줄바꿈 유지, **굵게**와 `코드`만 해석, 나머지는 글자 그대로. */
function renderRichText(container, text) {
  container.replaceChildren();
  const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\s+$/g, '').split('\n');
  for (let line of lines) {
    let cls = null;
    const h = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
    if (h) line = `**${h[1]}**`;
    const li = line.match(/^\s*(?:[*\-•]|\d+\.)\s+(.*)$/);
    if (li && !/^\s*\*\*/.test(line)) {
      const num = line.match(/^\s*(\d+\.)\s+/);
      line = (num ? num[1] + ' ' : '• ') + li[1];
      cls = 'li';
    }
    const p = el('p', cls ? { class: cls } : null);
    appendInline(p, line);
    container.append(p);
  }
}

function appendInline(parent, raw) {
  const text = raw.replace(/\\([_*#`[\]()>~|.-])/g, '$1');
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    if (m[1] !== undefined) parent.append(el('strong', { text: m[1] }));
    else parent.append(el('code', { text: m[2] }));
    last = re.lastIndex;
  }
  if (last < text.length) parent.append(text.slice(last));
}

function emptyBox(title, detail, kind) {
  const cls = kind === 'offline' ? ' is-offline' : kind ? ' is-error' : '';
  return el('div', { class: 'empty' + cls },
    el('strong', { text: title }),
    detail ? el('span', { text: detail }) : null);
}

/** 서버에 아예 닿지 않으면 카드마다 긴 설명을 반복하지 않고 짧게(자세한 안내는 맨 위 입력창 아래), 그 밖의 오류는 서버 메시지를 그대로 */
function errorBox(title, err) {
  if (err && err.offline) return emptyBox(title, '대시보드 서버에 연결되지 않았습니다.', 'offline');
  return emptyBox(title, err ? err.message || String(err) : '응답 없음', true);
}

function badge(text, kind, iconName) {
  return el('span', { class: 'badge' + (kind ? ' is-' + kind : '') }, iconName ? icon(iconName) : null, text);
}

/* 떠 있는 설명 상자(차트 위에 마우스를 올렸을 때) */
const tip = {
  node: null,
  show(evt, rows) {
    if (!this.node) this.node = $('#tooltip');
    const n = this.node;
    n.replaceChildren(...rows.map(([k, v], i) => el('div', null, k ? el('span', { text: k + ' ' }) : null, v)));
    n.hidden = false;
    const pad = 14;
    const { innerWidth: W, innerHeight: H } = window;
    const r = n.getBoundingClientRect();
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + r.width > W - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > H - 8) y = evt.clientY - r.height - pad;
    n.style.left = Math.max(8, x) + 'px';
    n.style.top = Math.max(8, y) + 'px';
  },
  hide() { if (this.node) this.node.hidden = true; },
};

/* ════════════════ 2. API ════════════════ */

class ApiError extends Error {
  /** offline: 대시보드 서버 자체에 닿지 못함(연결 실패, 또는 API가 없는 곳에서 연 화면) */
  constructor(message, status, offline) { super(message); this.status = status; this.offline = !!offline; }
}

async function api(path, opts = {}) {
  const init = { cache: 'no-store', headers: { Accept: 'application/json' }, ...opts };
  if (opts.body) init.headers = { ...init.headers, 'Content-Type': 'application/json' };
  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    throw new ApiError('대시보드 서버(127.0.0.1:8780)에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.', 0, true);
  }
  let data = null;
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    try { data = await res.json(); } catch (e) { data = null; }
  }
  if (!res.ok) {
    let msg = data && typeof data.error === 'string' ? data.error : null;
    if (!msg) {
      msg = res.status === 404
        ? '이 주소에 대시보드 API가 없습니다(HTTP 404). 대시보드 서버(server.py)로 연 화면인지 확인하세요.'
        : `서버가 요청을 처리하지 못했습니다(HTTP ${res.status}).`;
    }
    throw new ApiError(msg, res.status, res.status === 404 && data === null);
  }
  if (data === null) throw new ApiError('서버 응답을 읽을 수 없습니다(JSON 형식이 아님).', res.status, true);
  return data;
}

/* ════════════════ 3. 상태 ════════════════ */

const state = {
  autoRefresh: true,
  status: null, statusErr: null, statusLoaded: false,
  runs: [], runsErr: null, runsLoaded: false, selectedRun: null,
  asks: [], asksErr: null, asksLoaded: false, askFilter: '',
  view: null,            // 'live' 또는 질문 기록 id
  live: null,            // 지금 대시보드에서 실행 중(또는 방금 끝난) 질문
  experiments: [], expErr: null, expLoaded: false, confirmExp: null, expMsg: null,
  datasets: [], dataErr: null, dataLoaded: false,
  checkpoints: [], ckptErr: null, ckptLoaded: false,
  activity: [], actErr: null, actLoaded: false,
  viewer: { stats: null, err: null, userStarted: false, gotFrame: false, fastTimer: null },
  expanded: new Set(),   // 펼친 도구 요약
  lastLiveId: null,      // 이 화면에서 방금 실행해 끝난 질문 id('방금 실행'과 '저장된 기록'을 구분)
  expPastOpen: false,    // 승인 대기열의 '지난 제안' 펼침 여부
  showAll: { history: false, activity: false }, // 좁은 화면에서 '더 보기'를 누른 목록
  askAutoFocused: false,
};

/** 서버에 닿았는지(성공했거나, 서버가 오류로라도 응답했는지). '마지막 갱신' 표시에 쓴다. */
const reached = (err) => !err || !err.offline;

/* 좁은 화면(≤900px)에서는 목록 안쪽 스크롤 대신 앞 5개만 보이고 '더 보기'로 펼친다 */
const NARROW_MQ = window.matchMedia('(max-width: 900px)');
const LIST_LIMIT = 5;
function limitRows(key, rows, rerender) {
  if (!NARROW_MQ.matches || state.showAll[key]) return rows;
  const isItem = (r) => !r.classList.contains('act-day');
  const items = rows.filter(isItem);
  if (items.length <= LIST_LIMIT) return rows;
  const cut = rows.indexOf(items[LIST_LIMIT]);
  const hidden = items.length - LIST_LIMIT;
  return [...rows.slice(0, cut), el('li', { class: 'more-row' },
    el('button', { class: 'btn btn-sm more-btn', type: 'button', on: { click: () => { state.showAll[key] = true; rerender(); } } }, `${hidden}건 더 보기`))];
}

/** 안쪽 스크롤 목록 아래에 더 있는 내용이 있으면 끝을 흐리게 해서 알려 준다 */
function watchScrollFade(node) {
  if (!node) return;
  const upd = () => node.classList.toggle('has-more', node.scrollHeight - node.scrollTop - node.clientHeight > 4);
  node.addEventListener('scroll', upd, { passive: true });
  if (window.ResizeObserver) new ResizeObserver(upd).observe(node);
  new MutationObserver(upd).observe(node, { childList: true, subtree: true });
  upd();
}

/* 사람이 읽는 이름표 */
const LABEL = {
  subset: { full: '전체', p50: '50%', p20: '20%' },
  filterKeyOf: { full: 'train', p50: '50_percent_train', p20: '20_percent_train' },
  source: { ph: '숙련자 1명', mh: '여러 명', mg: '기계 생성', paired: '짝 데이터' },
  fileType: { low_dim: '숫자(위치) 데이터', image: '영상 데이터', all: '전체 파일', depth: '깊이 영상', raw: '원본' },
  obs: { low_dim: '숫자(위치) 데이터', image: '영상 데이터' },
  tool: { get_dataset_info: '데이터셋 정보 조회', kb_search: '논문·자료 검색' },
  arg: { task: '작업', source: '수집', file_type: '파일 종류', query: '검색어', dataset_name: '데이터셋', file_path: '경로', top_k: '가져올 개수' },
  errorType: { not_found: '자료 없음', network_error: '네트워크 오류', timeout: '시간 초과', invalid_input: '잘못된 입력', tool_error: '도구 오류' },
  nodeType: { start: '시작', end: '끝', agent: '에이전트', llm: '언어 모델', tool: '도구', answer: '답변', code: '코드', 'if-else': '조건 분기', 'knowledge-retrieval': '지식 검색', 'http-request': '외부 요청', 'template-transform': '글 틀 변환' },
  askSource: { dashboard: '대시보드', '4주차 기록': '4주차 기록' },
  askTag: { demo: '의도적 실패 시연', test: '시험 기록' },
  algo: { bc: '시연 따라 하기 학습(BC)' },
  datasetSource: { ph: '숙련자 1명 데이터(PH)', mh: '여러 명 데이터(MH)', mg: '기계 생성 데이터(MG)' },
  expStatus: { pending: '승인 대기', queued: '순서 대기', running: '학습 중', done: '완료', failed: '실패', rejected: '거절됨', cancelled: '중단됨' },
  phase: { load: '데이터와 설정을 불러오는 중', train: '학습 중', rollout: '평가 중(시뮬레이터에서 실제 실행)', done: '마무리 중' },
  activityKind: { ask: '질문', tool_call: '도구 호출', experiment: '실험', train: '학습', training: '학습', viewer: '로봇 뷰어', system: '시스템', server: '서버', dify: '에이전트', error: '오류', approve: '승인', reject: '거절', cancel: '중단' },
};

function subsetLabel(key) {
  const m = String(key).match(/^(\d+)_percent(?:_(train|valid))?$/);
  if (m) return `${m[2] === 'valid' ? '검증용 ' : m[2] === 'train' ? '학습용 ' : '전체 중 '}${m[1]}%`;
  return { train: '학습용', valid: '검증용', test: '시험용' }[key] || key;
}

/* ════════════════ 4. 시스템 상태 (상단 알약 + 카드 + 질문 가능 여부) ════════════════ */

async function loadStatus() {
  try {
    state.status = await api('/api/status');
    state.statusErr = null;
  } catch (e) {
    state.statusErr = e;
  }
  state.statusLoaded = true;
  renderStatus();
  renderAskAvailability();
  if (!state.statusErr) renderAnswersMeta();
  const runningId = state.status && state.status.dify ? state.status.dify.ask_id : null;
  if (runningId && !(state.live && state.live.id === String(runningId))) loadAsks();
  return reached(state.statusErr);
}

/** 모델 터널: 연결 + 에이전트가 쓰는 모델이 목록에 있어야 ok. 연결만 되고 모델이 없으면 '모델 없음' */
function tunnelState(tunnel) {
  if (tunnel.ok) return { kind: 'ok', pill: '모델 터널 연결됨', short: '연결됨' };
  if (tunnel.connected) return { kind: 'bad', pill: '모델 없음', short: '모델 없음' };
  return { kind: 'bad', pill: '모델 터널 끊김', short: '끊김' };
}

function renderStatus() {
  const pills = $('#status-pills');
  const body = $('#system-body');
  const st = state.status;

  if (state.statusErr || !st) {
    pills.replaceChildren(el('li', { class: 'pill is-bad', title: state.statusErr ? state.statusErr.message : '' }, el('span', { class: 'dot' }), '서버 연결 안 됨'));
    body.replaceChildren(errorBox('상태를 불러오지 못했습니다', state.statusErr));
    $('#system-meta').textContent = '';
    return;
  }

  const dify = st.dify || {}, tunnel = st.tunnel || {}, cont = st.dify_container || {}, training = st.training || {}, viewer = st.viewer || {};
  const difyKind = dify.busy ? 'busy' : dify.ok ? 'ok' : 'bad';
  const difyText = dify.busy ? '에이전트 질문 처리 중' : dify.ok ? '에이전트 준비됨' : '에이전트 사용 불가';
  const tun = tunnelState(tunnel);
  pills.replaceChildren(
    el('li', { class: `pill is-${difyKind}`, title: `에이전트 실행기(Dify): ${dify.detail || ''}` }, el('span', { class: 'dot' }), difyText),
    el('li', { class: `pill is-${tun.kind}`, title: tunnel.detail || '' }, el('span', { class: 'dot' }), tun.pill),
    el('li', { class: `pill ${training.busy ? 'is-busy' : ''}`, title: training.run_name || '' }, el('span', { class: 'dot' }), training.busy ? '학습 중' : '학습 쉬는 중'),
  );

  const row = (kind, name, detail, stateText) => el('div', { class: `sys-row is-${kind}` },
    el('span', { class: 'dot' }),
    el('div', null, el('div', { class: 'sys-name', text: name }), detail ? el('div', { class: 'sys-detail', text: detail }) : null),
    el('span', { class: 'sys-state', text: stateText }));

  const viewerStatus = viewer.status || '기록 없음';
  const k = st.kernel || {};
  const kernelChips = ['python', 'torch', 'robosuite', 'mujoco', 'robomimic']
    .map((key) => el('span', { class: 'arg' }, el('span', { text: key }), k[key] ? String(k[key]) : '확인 안 됨'));

  body.replaceChildren(
    el('div', { class: 'sys' },
      row(difyKind, '에이전트 실행기(Dify)', dify.detail, dify.busy ? '질문 처리 중' : dify.ok ? '준비됨' : '사용 불가'),
      row(tun.kind, '모델 서버 터널', [st.model ? `모델 ${st.model}${st.model_source === 'workflow' ? '(워크플로에서 확인)' : '(기본 설정값, 워커 준비 전)'}` : null, tunnel.detail].filter(Boolean).join(', '), tun.short),
      row(cont.ok ? 'ok' : 'bad', 'Dify 컨테이너', cont.detail, cont.ok ? '실행 중' : '꺼짐'),
      row(training.busy ? 'busy' : 'idle', '학습', training.busy ? [training.run_name, training.experiment_id ? `실험 ${training.experiment_id}` : null].filter(Boolean).join(', ') : '진행 중인 학습이 없습니다', training.busy ? '학습 중' : '쉬는 중'),
      row('idle', '로봇 뷰어', null, viewerStatus),
    ),
    el('div', { class: 'kernel' }, el('div', { class: 'kernel-title', text: '실험 커널 버전' }), kernelChips),
  );
  $('#system-meta').textContent = `${fmtClock(new Date(), true)} 확인`;
}

function askBlockReason() {
  if (!state.statusLoaded) return { text: '연결 상태를 확인하는 중입니다.', hard: true };
  if (state.statusErr || !state.status) {
    const why = state.statusErr ? state.statusErr.message : '상태 응답이 비어 있습니다.';
    return { text: `질문할 수 없습니다. ${why}`, hard: true };
  }
  const st = state.status;
  if (st.tunnel && !st.tunnel.ok && st.tunnel.connected) {
    return { text: `모델 서버에는 연결되었지만 에이전트가 쓰는 모델(${st.model || '이름 확인 안 됨'})이 목록에 없어 질문할 수 없습니다. 맥미니 Ollama에 모델을 올린 뒤 다시 시도하세요.`, hard: true };
  }
  if (!st.tunnel || !st.tunnel.ok) {
    return { text: '모델 서버로 가는 연결(SSH 터널, 127.0.0.1:18434)이 끊겨 있어 질문할 수 없습니다. 터널을 다시 연결하면 몇 초 안에 입력창이 다시 켜집니다.', hard: true };
  }
  if (!st.dify || !st.dify.ok) {
    return { text: `에이전트 실행기(Dify)가 준비되지 않아 질문할 수 없습니다. ${st.dify && st.dify.detail ? st.dify.detail : ''}`.trim(), hard: true };
  }
  const liveRunning = state.live && state.live.status === 'running';
  if (liveRunning) return { text: '에이전트가 답을 만드는 중입니다. 아래 실행 추적에서 진행 상황을 볼 수 있습니다.', hard: false, running: true };
  if (st.dify.busy) return { text: '다른 질문을 실행 중입니다. 끝나면 다시 질문할 수 있습니다.', hard: false };
  return null;
}

function renderAskAvailability() {
  const form = $('#ask-form'), input = $('#ask-input'), note = $('#ask-note'), send = $('#ask-send');
  const block = askBlockReason();
  const hard = !!(block && block.hard);
  form.classList.toggle('is-blocked', hard);
  input.disabled = hard;
  note.textContent = block ? block.text : '';
  note.classList.toggle('is-warn', !!block && !block.running);
  const len = input.value.trim().length;
  send.disabled = !!block || len < 1 || len > 1000;
  send.querySelector('span').textContent = block && block.running ? '실행 중' : '질문하기';
  // 처음 입력창이 켜질 때 한 번, 마우스를 쓰는 화면이면 바로 입력할 수 있게 초점을 준다(깜박이는 커서와 실제 상태를 맞춤)
  if (!hard && !state.askAutoFocused) {
    state.askAutoFocused = true;
    const idle = !document.activeElement || document.activeElement === document.body;
    if (idle && window.matchMedia('(pointer: fine)').matches && window.scrollY < 200) input.focus({ preventScroll: true });
  }
}

/* ════════════════ 5. 질문하기 + 실시간 추적 ════════════════ */

function initAsk() {
  const input = $('#ask-input'), form = $('#ask-form'), field = input.closest('.ask-field');
  const sync = () => {
    field.classList.toggle('has-text', input.value.length > 0);
    $('#ask-count').textContent = `${input.value.length} / 1000`;
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
    renderAskAvailability();
  };
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || q.length > 1000 || askBlockReason()) return;
    submitAsk(q).then((ok) => { if (ok) { input.value = ''; sync(); } });
  });
  const fit = () => { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; };
  window.addEventListener('resize', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  sync();
}

async function submitAsk(query) {
  const note = $('#ask-note'), send = $('#ask-send');
  send.disabled = true;
  try {
    const d = await api('/api/ask', { method: 'POST', body: JSON.stringify({ query }) });
    if (!d || !d.id) throw new ApiError('서버가 질문 번호를 돌려주지 않았습니다.', 0);
    startLive(String(d.id), query);
    return true;
  } catch (e) {
    note.textContent = e.status === 409 ? '다른 질문을 실행 중입니다. 끝난 뒤 다시 질문하세요.' : e.message;
    note.classList.add('is-warn');
    send.disabled = false;
    return false;
  }
}

/** attachStartedAt: 다른 탭에서 시작했거나 화면을 새로 연 뒤 이어 보는 질문이면 서버 기록의 시작 시각 */
function startLive(id, query, attachStartedAt) {
  if (state.live) { if (state.live.es) state.live.es.close(); clearInterval(state.live.timer); }
  const began = toDate(attachStartedAt);
  const startedAt = began ? performance.now() - Math.max(0, Date.now() - began.getTime()) : performance.now();
  state.live = {
    id, query, status: 'running', startedAt, retries: 0, es: null, attached: !!began,
    items: [], nodes: {}, nodeKind: {}, texts: { with: '', without: '' }, final: null, elapsedSec: null, timer: null,
  };
  state.view = 'live';
  state.expanded.clear();
  openStream();
  state.live.timer = setInterval(renderTraceMeta, 100);
  renderAskAvailability();
  renderAgentView();
  renderHistory();
  if (began) return; // 이어 보기는 화면을 움직이지 않는다
  const card = $('.card-trace');
  const r = card.getBoundingClientRect();
  if (r.top > window.innerHeight * 0.8 || r.bottom < 0) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 대시보드에서 실행 중인 질문이 있는데 이 화면이 보고 있지 않으면(새로 고침, 다른 탭) 실시간 추적에 다시 붙는다. */
function maybeAttachRunningAsk() {
  const run = state.asks.find((a) => a.status === 'running' && a.source === 'dashboard');
  if (!run) return false;
  if (state.live && state.live.id === String(run.id)) return false;
  if (state.live && state.live.status === 'running') return false;
  startLive(String(run.id), run.query, run.started_at);
  return true;
}

function resetLiveEvents(live) {
  live.items = []; live.nodes = {}; live.nodeKind = {}; live.texts = { with: '', without: '' };
}

function openStream() {
  const live = state.live;
  if (!live) return;
  // 서버는 연결될 때마다 쌓인 이벤트를 처음부터 다시 보낸다 → 다시 연결하면 목록을 비우고 받는다.
  resetLiveEvents(live);
  const es = new EventSource(`/api/ask/${encodeURIComponent(live.id)}/events`);
  live.es = es;
  es.onmessage = (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch (e) { return; }
    if (state.live !== live) return;
    handleAskEvent(live, data);
  };
  es.onerror = () => {
    es.close();
    if (state.live !== live || live.status !== 'running') return;
    if (live.retries < 3) {
      live.retries += 1;
      live.items.push({ kind: 'status', message: `이벤트 연결이 끊겨 다시 연결합니다(${live.retries}/3).` });
      scheduleAgentRender();
      setTimeout(() => { if (state.live === live && live.status === 'running') openStream(); }, 1500);
    } else {
      live.status = 'error';
      live.items.push({ kind: 'error', message: '이벤트 연결이 여러 번 끊겼습니다. 잠시 뒤 질문 기록에서 결과를 확인하세요.' });
      finishLive(live);
    }
  };
}

function handleAskEvent(live, ev) {
  switch (ev.type) {
    case 'ping':
      return;
    case 'status':
      live.items.push({ kind: 'status', message: ev.message || '' });
      break;
    case 'node_started': {
      const item = { kind: 'node', node_id: ev.node_id, title: ev.title, node_type: ev.node_type, state: 'running', elapsed: null };
      live.nodes[ev.node_id] = item;
      live.items.push(item);
      if (ev.node_type === 'agent') live.nodeKind[ev.node_id] = 'with';
      else if (ev.node_type === 'llm') live.nodeKind[ev.node_id] = 'without';
      break;
    }
    case 'node_finished': {
      let item = live.nodes[ev.node_id];
      if (!item) {
        item = { kind: 'node', node_id: ev.node_id, title: ev.title, node_type: ev.node_type };
        live.nodes[ev.node_id] = item;
        live.items.push(item);
      }
      item.state = ev.status && ev.status !== 'succeeded' ? 'failed' : 'done';
      item.status = ev.status;
      item.elapsed = ev.elapsed;
      break;
    }
    case 'tool_call':
      live.items.push({ kind: 'tool', round: ev.round, tool: ev.tool, input: ev.input, ok: ev.ok, error_type: ev.error_type, summary: ev.summary });
      break;
    case 'text': {
      const k = live.nodeKind[ev.node_id];
      if (k && typeof ev.chunk === 'string') live.texts[k] += ev.chunk;
      break;
    }
    case 'final':
      live.final = ev;
      live.elapsedSec = isNum(ev.elapsed_sec) ? ev.elapsed_sec : (performance.now() - live.startedAt) / 1000;
      live.status = 'done';
      state.lastLiveId = live.id;
      live.items.push({ kind: 'final', elapsed: live.elapsedSec });
      if (live.es) live.es.close();
      finishLive(live);
      return;
    case 'error':
      live.status = 'error';
      live.elapsedSec = (performance.now() - live.startedAt) / 1000;
      state.lastLiveId = live.id;
      live.items.push({ kind: 'error', message: ev.message || '알 수 없는 오류' });
      if (live.es) live.es.close();
      finishLive(live);
      return;
    default:
      return;
  }
  scheduleAgentRender();
}

function finishLive(live) {
  clearInterval(live.timer);
  live.timer = null;
  renderAskAvailability();
  renderAgentView();
  loadAsks();
  loadStatus();
  loadActivity();
}

let agentRenderPending = false;
function scheduleAgentRender() {
  if (agentRenderPending) return;
  agentRenderPending = true;
  requestAnimationFrame(() => { agentRenderPending = false; renderAgentView(); });
}

/** 카드 1·2에 보여 줄 내용을 한 형태로 모은다(실시간 또는 기록). */
function currentView() {
  if (state.view === 'live' && state.live) {
    const L = state.live;
    return {
      live: true, id: L.id, query: L.query, status: L.status, source: 'dashboard', items: L.items,
      withTools: L.final ? L.final.with_tools : L.texts.with,
      withoutTools: L.final ? L.final.without_tools : L.texts.without,
      streaming: L.status === 'running',
      toolCount: L.items.filter((i) => i.kind === 'tool').length,
    };
  }
  const ask = state.asks.find((a) => String(a.id) === String(state.view));
  if (!ask) return null;
  const tools = (ask.tool_calls || []).map((t) => ({ kind: 'tool', ...t }));
  const nodes = Array.isArray(ask.nodes) ? ask.nodes : [];
  const items = [];
  let toolsPlaced = false;
  for (const n of nodes) {
    items.push({
      kind: 'node', node_id: n.node_id, title: n.title, node_type: n.node_type,
      state: n.status && n.status !== 'succeeded' ? (n.status === 'running' ? 'running' : 'failed') : 'done',
      status: n.status, elapsed: n.elapsed,
    });
    if (n.node_type === 'agent' && !toolsPlaced) { items.push(...tools); toolsPlaced = true; }
  }
  if (!toolsPlaced) items.push(...tools);
  if (ask.status === 'done') items.push({ kind: 'final', elapsed: ask.elapsed_sec });
  else if (ask.status === 'error') items.push({ kind: 'error', message: ask.error || '오류로 끝났습니다.' });
  else if (ask.status === 'running') items.push({ kind: 'status', message: '아직 실행 중인 질문입니다. 끝나면 결과가 채워집니다.' });
  return {
    live: false, id: ask.id, query: ask.query, status: ask.status, source: ask.source, items, ask,
    withTools: ask.with_tools, withoutTools: ask.without_tools, streaming: false,
    toolCount: (ask.tool_calls || []).length,
  };
}

function renderAgentView() {
  renderTrace();
  renderAnswers();
}

function renderTraceMeta() {
  const meta = $('#trace-meta');
  const v = currentView();
  meta.classList.remove('is-live');
  if (!v) { meta.textContent = '대기 중'; return; }
  if (v.live) {
    const L = state.live;
    if (L.status === 'running') {
      meta.textContent = `진행 ${((performance.now() - L.startedAt) / 1000).toFixed(1)}초`;
      meta.classList.add('is-live');
    } else {
      meta.textContent = isNum(L.elapsedSec) ? `방금 실행 · ${L.elapsedSec.toFixed(1)}초 걸림` : '방금 실행';
    }
    return;
  }
  const sec = v.ask && isNum(v.ask.elapsed_sec) ? v.ask.elapsed_sec.toFixed(1) : null;
  if (state.lastLiveId && String(v.id) === state.lastLiveId) meta.textContent = sec ? `방금 실행 · ${sec}초 걸림` : '방금 실행';
  else meta.textContent = sec ? `저장된 기록 · ${sec}초` : '저장된 기록';
}

function renderTrace() {
  const list = $('#trace-list'), qBox = $('#trace-query');
  renderTraceMeta();
  const v = currentView();
  if (!v) {
    qBox.replaceChildren();
    let msg;
    if (state.asksErr) msg = errorBox('질문 기록을 불러오지 못했습니다', state.asksErr);
    else msg = emptyBox('아직 실행한 질문이 없습니다', '위 입력창에 질문하면 에이전트가 어떤 도구를 어떤 값으로 부르는지 여기에 차례로 나타납니다.');
    list.replaceChildren(el('li', null, msg));
    return;
  }

  const statusBadge = v.status === 'running' ? badge('진행 중', 'live')
    : v.status === 'error' ? badge('오류', 'bad') : v.status === 'done' ? badge('완료', 'ok') : null;
  const tag = v.ask && v.ask.tag ? badge(LABEL.askTag[v.ask.tag] || v.ask.tag, 'note') : null;
  qBox.replaceChildren(...[
    el('div', { text: v.query || '(질문 내용 없음)' }),
    el('div', { class: 'sub' }, badge(LABEL.askSource[v.source] || v.source || '출처 모름'), statusBadge, tag),
    v.ask && v.ask.note ? el('p', { class: 'trace-note', text: v.ask.note }) : null,
  ].filter(Boolean));

  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const rows = v.items.map((it, idx) => traceItem(it, idx, v));
  if (!rows.length) {
    rows.push(el('li', { class: 'tl-item is-running' }, el('span', { class: 'tl-mark' }),
      el('div', { class: 'tl-body' }, el('div', { class: 'tl-note', text: v.live ? '에이전트 실행기에 질문을 보냈습니다. 첫 신호를 기다리는 중입니다.' : '이 질문에는 도구 호출 기록이 없습니다.' }))));
  }
  list.replaceChildren(...rows);
  if (v.live && (nearBottom || v.streaming)) list.scrollTop = list.scrollHeight;
}

function traceItem(it, idx, v) {
  const key = `${v.id}:${idx}`;
  if (it.kind === 'status') {
    return el('li', { class: 'tl-item' }, el('span', { class: 'tl-mark' }),
      el('div', { class: 'tl-body' }, el('div', { class: 'tl-note', text: it.message })));
  }
  if (it.kind === 'node') {
    const cls = it.state === 'running' ? 'is-running' : it.state === 'failed' ? 'is-error' : 'is-done';
    const typeLabel = LABEL.nodeType[it.node_type] || it.node_type || '';
    const time = it.state === 'running' ? '진행 중' : isNum(it.elapsed) ? `${it.elapsed.toFixed(1)}초` : '';
    return el('li', { class: `tl-item ${cls}` },
      el('span', { class: 'tl-mark' }, it.state === 'done' ? icon('check') : it.state === 'failed' ? icon('x') : null),
      el('div', { class: 'tl-body' },
        el('div', { class: 'tl-line' },
          el('strong', { text: it.title || it.node_id || '단계' }),
          typeLabel ? el('span', { class: 'code', text: typeLabel }) : null,
          it.state === 'failed' ? badge(`실패${it.status ? ' (' + it.status + ')' : ''}`, 'bad') : null,
          el('span', { class: 'tl-time', text: time }))));
  }
  if (it.kind === 'tool') {
    const failed = it.ok === false;
    const okBadge = it.ok === true ? badge('성공', 'ok', 'check')
      : failed ? badge(`실패${it.error_type ? ': ' + (LABEL.errorType[it.error_type] || it.error_type) : ''}`, 'bad', 'x')
        : badge('결과 모름');
    const open = state.expanded.has(key);
    const summary = it.summary ? el('button', {
      type: 'button',
      class: 'tool-summary' + (open ? ' is-open' : ''),
      'aria-expanded': String(open),
      title: '눌러서 펼치거나 접기',
      on: {
        click: (e) => {
          const b = e.currentTarget;
          const now = !state.expanded.has(key);
          if (now) state.expanded.add(key); else state.expanded.delete(key);
          b.classList.toggle('is-open', now);
          b.setAttribute('aria-expanded', String(now));
        },
      },
    }, it.summary) : null;
    const chips = argChips(it.input);
    return el('li', { class: `tl-item is-tool${failed ? ' is-fail' : ''}` },
      el('span', { class: 'tl-mark' }, icon('tool')),
      el('div', { class: 'tl-body' },
        el('div', { class: 'tl-line' },
          el('strong', { text: LABEL.tool[it.tool] || it.tool || '도구' }),
          el('span', { class: 'code', text: it.tool || '' }),
          okBadge,
          isNum(it.round) ? el('span', { class: 'tl-time', text: `${it.round}회차` }) : null),
        chips.length ? el('div', { class: 'args' }, chips) : null,
        summary));
  }
  if (it.kind === 'final') {
    return el('li', { class: 'tl-item is-final' }, el('span', { class: 'tl-mark' }, icon('check')),
      el('div', { class: 'tl-body' }, el('div', { class: 'tl-line' },
        el('strong', { text: '답변 완료' }),
        el('span', { class: 'tl-time', text: isNum(it.elapsed) ? `총 ${it.elapsed.toFixed(1)}초` : '' }))));
  }
  if (it.kind === 'error') {
    return el('li', { class: 'tl-item is-error' }, el('span', { class: 'tl-mark' }, icon('x')),
      el('div', { class: 'tl-body' }, el('div', { class: 'tl-line' }, el('strong', { text: '오류로 멈춤' })),
        el('div', { class: 'tl-err', text: it.message })));
  }
  return null;
}

function argChips(input) {
  if (!input || typeof input !== 'object') return [];
  return Object.entries(input).map(([k, raw]) => {
    let val;
    if (k === 'source' && LABEL.source[raw]) val = `${LABEL.source[raw]}(${raw})`;
    else if (k === 'file_type' && LABEL.fileType[raw]) val = `${LABEL.fileType[raw]}(${raw})`;
    else if (k === 'query') val = `“${raw}”`;
    else if (raw !== null && typeof raw === 'object') val = JSON.stringify(raw);
    else val = String(raw);
    if (val.length > 160) val = val.slice(0, 160) + '…';
    return el('span', { class: 'arg' }, el('span', { text: LABEL.arg[k] || k }), val);
  });
}

function renderAnswers() {
  const box = $('#answers');
  const v = currentView();
  if (!v) {
    box.replaceChildren(answerCol(true, null, '질문하면 도구를 쓴 답이 여기에 나옵니다.', null),
      answerCol(false, null, '같은 질문에 도구 없이 한 답이 여기에 나옵니다.', null));
    renderAnswersMeta();
    return;
  }
  const waiting = v.streaming ? '답변을 만드는 중입니다.' : '답변 없음';
  const toolsMeta = v.streaming ? (v.withTools ? '작성 중' : `도구 ${v.toolCount}회 호출 중`) : `도구 ${v.toolCount}회 호출`;
  box.replaceChildren(
    answerCol(true, v.withTools, waiting, toolsMeta),
    answerCol(false, v.withoutTools, waiting, v.streaming && v.withoutTools ? '작성 중' : '도구 없음'),
  );
  renderAnswersMeta();
}

/** 카드 부제는 고정(무엇을 비교하는지), 뒤에 지금 보는 것이 실시간·방금 실행·저장된 기록 중 무엇인지 붙인다.
 *  '같은 모델'은 워커가 워크플로에서 읽은 두 노드의 모델 이름이 같을 때만 쓴다. */
function renderAnswersMeta() {
  const nodes = state.status && Array.isArray(state.status.model_nodes) ? state.status.model_nodes : [];
  const agentM = nodes.find((n) => n.type === 'agent'), llmM = nodes.find((n) => n.type === 'llm');
  const base = agentM && llmM && agentM.model === llmM.model ? '같은 모델, 도구 사용 여부만 다름' : '같은 질문, 도구 사용 여부만 다름';
  const v = currentView();
  let tail = '';
  if (v) {
    if (v.live) tail = v.streaming ? '실시간' : '방금 실행';
    else tail = state.lastLiveId && String(v.id) === state.lastLiveId ? '방금 실행' : '저장된 기록';
  }
  const meta = $('#answers-meta');
  meta.textContent = tail ? `${base} · ${tail}` : base;
  meta.title = agentM && llmM ? `도구 사용 에이전트: ${agentM.model}, 기준선(도구 없음): ${llmM.model}` : '';
}

function answerCol(withTools, text, emptyText, meta) {
  const body = el('div', { class: 'answer-text' });
  if (typeof text === 'string' && text.trim()) renderRichText(body, text);
  else { body.classList.add('is-empty'); body.textContent = emptyText; }
  return el('section', { class: 'answer' + (withTools ? ' is-tools' : '') },
    el('div', { class: 'answer-head' },
      el('span', { class: 'sw' }),
      el('h3', { text: withTools ? '도구를 쓴 답' : '도구 없이 한 답' }),
      meta ? badge(meta, withTools && meta !== '작성 중' && !/호출 중$/.test(meta) ? 'accent' : null) : null),
    body);
}

/* ════════════════ 6. 질문 기록 ════════════════ */

const asksSig = () => [
  state.asks.map((a) => [a.id, a.status, (a.tool_calls || []).length, a.elapsed_sec].join(':')).join('|'),
  state.asksErr ? state.asksErr.message : '', String(state.view),
].join('#');

async function loadAsks() {
  const before = state.asksLoaded ? asksSig() : null;
  try {
    const d = await api('/api/asks');
    state.asks = Array.isArray(d.asks) ? d.asks : [];
    state.asksErr = null;
  } catch (e) {
    state.asksErr = e;
  }
  state.asksLoaded = true;
  if (!state.asksErr && maybeAttachRunningAsk()) { renderSuggestions(); return true; }
  if (state.live && state.live.status !== 'running' && state.view === 'live' && state.asks.some((a) => String(a.id) === state.live.id)) {
    state.view = state.live.id; // 끝난 실시간 질문은 저장된 기록으로 이어 보여 준다
  }
  if (state.view === null && state.asks.length) state.view = String(state.asks[0].id);
  // 바뀐 것이 없으면 다시 그리지 않는다(주기적 갱신 중 누르던 버튼이 바뀌어 클릭이 사라지는 일을 막음)
  if (before !== null && before === asksSig()) return reached(state.asksErr);
  renderHistory();
  renderSuggestions();
  renderAgentView();
  return reached(state.asksErr);
}

function renderHistory() {
  const list = $('#history'), meta = $('#history-meta');
  if (state.asksErr) {
    list.replaceChildren(el('li', null, errorBox('질문 기록을 불러오지 못했습니다', state.asksErr)));
    meta.textContent = '';
    return;
  }
  if (!state.asksLoaded) { list.replaceChildren(el('li', null, emptyBox('불러오는 중', null))); return; }
  const f = state.askFilter.trim().toLowerCase();
  const asks = f ? state.asks.filter((a) => String(a.query || '').toLowerCase().includes(f)) : state.asks;
  meta.textContent = f ? `${asks.length} / ${state.asks.length}건` : `${state.asks.length}건`;
  if (!state.asks.length) {
    list.replaceChildren(el('li', null, emptyBox('기록 없음', '대시보드에서 질문하면 여기에 쌓입니다.')));
    return;
  }
  if (!asks.length) {
    list.replaceChildren(el('li', null, emptyBox('검색 결과 없음', `“${state.askFilter}”가 들어간 질문이 없습니다.`)));
    return;
  }
  const liveId = state.live ? state.live.id : null;
  const rows = asks.map((a) => {
    const id = String(a.id);
    const current = state.view === id || (state.view === 'live' && liveId === id);
    const tools = Array.isArray(a.tool_calls) ? a.tool_calls.length : 0;
    const status = a.status === 'running' ? badge('진행 중', 'live') : a.status === 'error' ? badge('오류', 'bad') : null;
    const when = fmtWhen(a.started_at);
    return el('li', null, el('button', {
      class: 'hist-btn', type: 'button', 'aria-current': current ? 'true' : 'false', title: a.note || null,
      on: { click: () => selectAsk(id) },
    },
    el('span', { class: 'hist-q', text: a.query || '(질문 내용 없음)' }),
    el('span', { class: 'hist-meta' },
      badge(LABEL.askSource[a.source] || a.source || '출처 모름', a.source === 'dashboard' ? 'accent' : null),
      status,
      a.tag ? badge(LABEL.askTag[a.tag] || a.tag, 'note') : null,
      el('span', { text: `도구 ${tools}회` }),
      isNum(a.elapsed_sec) ? el('span', { text: `${a.elapsed_sec.toFixed(1)}초` }) : null,
      // 4주차 기록의 시작 시각은 파일 저장 시각에서 실행 시간을 뺀 추정값이다(서버 started_at_note)
      when ? el('span', { text: a.started_at_note ? `추정 ${when}` : when, title: a.started_at_note || null }) : null)));
  });
  list.replaceChildren(...limitRows('history', rows, renderHistory));
}

function selectAsk(id) {
  if (state.live && state.live.id === id && state.live.status === 'running') state.view = 'live';
  else state.view = id;
  state.expanded.clear();
  renderHistory();
  renderAgentView();
  if (window.matchMedia('(max-width: 900px)').matches) $('.card-trace').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSuggestions() {
  const box = $('#suggest');
  const seen = new Set(), picks = [];
  for (const a of state.asks) {
    const q = String(a.query || '').trim();
    if (!q || seen.has(q)) continue;
    seen.add(q); picks.push(q);
    if (picks.length >= 4) break;
  }
  box.replaceChildren(...picks.map((q) => el('button', {
    class: 'suggest-chip', type: 'button', title: q,
    on: { click: () => { const input = $('#ask-input'); if (input.disabled) return; input.value = q; input.dispatchEvent(new Event('input')); input.focus(); } },
  }, q.length > 40 ? q.slice(0, 40) + '…' : q)));
}

/* ════════════════ 7. 실험 결과 ════════════════ */

const runsSig = (runs) => runs.map((r) => [r.run_name, r.status, r.cancelled, r.success_rate, (r.loss_curve || []).length, r.wall_sec].join(':')).join('|');

/** 실행의 부분집합에 들어 있는 시연 수: 데이터셋 카드와 같은 hdf5의 filter_keys에서 찾는다(없으면 null) */
function runDemoCount(r) {
  if (!r || !r.filter_key || !r.dataset) return null;
  const ds = state.datasets.find((d) => d.filter_keys && String(d.path || '').includes(`/${r.dataset}/`) && (!r.obs || d.obs === r.obs));
  const n = ds ? ds.filter_keys[r.filter_key] : null;
  return isNum(n) ? { n, total: isNum(ds.num_demos) ? ds.num_demos : null } : null;
}

function runStatusLabel(r) {
  if (r.status === 'running') return '학습 중';
  if (r.cancelled) return '중단됨';
  if (r.status === 'failed') return '실패';
  return null;
}

async function loadRuns() {
  const before = runsSig(state.runs);
  try {
    const d = await api('/api/runs');
    state.runs = Array.isArray(d.runs) ? d.runs : [];
    state.runsErr = null;
  } catch (e) {
    state.runsErr = e;
  }
  state.runsLoaded = true;
  const after = runsSig(state.runs);
  if (before !== after || !$('#runs-body').childElementCount) {
    renderRuns();
    updateEstimate();
    if (state.ckptLoaded) renderCheckpoints(); // 모델 목록의 쉬운 이름은 실행 설정(runs)에서 만든다
  }
  if (before && before !== after) loadCheckpoints();
  return reached(state.runsErr);
}

function renderRuns() {
  const body = $('#runs-body'), meta = $('#runs-meta');
  if (state.runsErr) { body.replaceChildren(errorBox('실행 기록을 불러오지 못했습니다', state.runsErr)); meta.textContent = ''; return; }
  if (!state.runsLoaded) { body.replaceChildren(emptyBox('불러오는 중', null)); return; }
  const runs = state.runs;
  meta.textContent = `실행 ${runs.length}건`;
  if (!runs.length) {
    body.replaceChildren(emptyBox('아직 학습 실행 기록이 없습니다', '오른쪽 승인 대기열에서 실험을 제안하고 승인하면 결과가 여기에 쌓입니다.'));
    return;
  }
  let sel = runs.find((r) => r.run_name === state.selectedRun);
  if (!sel) { sel = runs[0]; state.selectedRun = sel.run_name; }

  const rate = pctText(sel.success_rate);
  const successN = isNum(sel.success_rate) && isNum(sel.rollouts) ? Math.round(sel.success_rate * sel.rollouts) : null;
  const stLabel = runStatusLabel(sel);
  const statusBadge = stLabel ? badge(stLabel, sel.status === 'running' ? 'live' : sel.cancelled ? null : 'bad') : null;

  // 실행 설정을 쉬운 말로: 작업 · 학습 방식 · 데이터 출처 · 관측 종류 (모두 config.json·로그에서 읽은 값)
  const srcKey = sel.dataset ? String(sel.dataset).split('/').pop() : null;
  const about = [
    sel.task ? `${sel.task} 작업` : null,
    sel.algo ? `학습 방식 ${LABEL.algo[sel.algo] || sel.algo}` : null,
    srcKey ? (LABEL.datasetSource[srcKey] || srcKey) : null,
    sel.obs ? (LABEL.obs[sel.obs] ? `${LABEL.obs[sel.obs]}(${sel.obs})` : sel.obs) : null,
  ].filter(Boolean).join(' · ');

  const bigBox = el('div', null,
    rate !== null
      ? el('div', { class: 'big is-accent' }, rate, el('small', { text: '%' }))
      : el('div', { class: 'big' }, '–'),
    el('p', { class: 'big-cap' },
      rate !== null
        ? (successN !== null ? `성공률, 평가 ${sel.rollouts}회 중 ${successN}회 성공` : '성공률(평가 횟수 기록 없음)')
        : sel.status === 'running' ? '학습이 끝나면 성공률이 나옵니다' : sel.cancelled ? '중단한 실행이라 평가 기록이 없습니다' : '평가 기록 없음'),
    el('p', { class: 'big-cap' }, el('code', { class: 'run-id', text: sel.run_name }), ' ', statusBadge));
  const aboutBox = about || (sel.error && sel.status !== 'done') ? el('div', { class: 'run-about' },
    about ? el('p', { text: about }) : null,
    sel.error && sel.status !== 'done' ? el('p', { class: 'is-err', text: sel.error }) : null) : null;

  const mem = fmtMem(sel.peak_mem_mb);
  const fact = (k, v, unit, title) => el('div', { class: 'fact', title }, el('dt', { text: k }), el('dd', null, v === null || v === undefined ? '기록 없음' : v, v !== null && v !== undefined && unit ? el('small', { text: unit }) : null));
  const subset = LABEL.subset[sel.subset] || sel.subset;
  const demos = runDemoCount(sel);
  const subsetTitle = [sel.filter_key ? `필터 키 ${sel.filter_key}` : null,
    demos ? `학습에 쓴 시연 ${demos.n}개${demos.total !== null ? `(전체 ${demos.total}개 중)` : ''}` : null].filter(Boolean).join(', ') || null;
  const facts = el('dl', { class: 'facts' },
    fact('데이터 비율', subset || null, demos ? `시연 ${demos.n}개` : null, subsetTitle),
    fact('에폭(학습 반복 횟수)', isNum(sel.epochs) ? String(sel.epochs) : null, '회'),
    fact('시드(무작위 배치 번호)', sel.seed !== null && sel.seed !== undefined ? String(sel.seed) : null, '번'),
    fact('걸린 시간', fmtDuration(sel.wall_sec)),
    fact('최대 메모리', mem ? mem[0] : null, mem ? mem[1] : null),
    fact('평가 1회 평균 스텝', isNum(sel.avg_horizon) ? sel.avg_horizon.toFixed(1) : null, '스텝',
      '평가 한 번에 걸린 스텝 수의 평균입니다. 성공하면 그 자리에서 끝나므로 실패가 많을수록 길어집니다. 데이터셋 카드의 "시연 평균 길이"와는 다른 값입니다.'));

  const barBox = el('div', { class: 'chart chart-bars' },
    el('div', { class: 'chart-head' }, el('h3', { text: '실행별 성공률' }), el('span', { text: '막대를 눌러 선택' })),
    el('div', { class: 'chart-canvas', id: 'bars-canvas' }));
  const lossBox = el('div', { class: 'chart chart-loss' },
    el('div', { class: 'chart-head' }, el('h3', { text: '학습 손실' }), el('span', { text: '에폭마다, 낮을수록 시연에 가깝게 따라 함' })),
    el('div', { class: 'chart-canvas', id: 'loss-canvas' }));

  body.replaceChildren(...[el('div', { class: 'runs-top' }, bigBox, facts), aboutBox, el('div', { class: 'charts' }, barBox, lossBox)].filter(Boolean));
  drawBars();
  drawLoss();
}

function chartWidth(node, fallback) {
  const w = node.clientWidth;
  return w > 40 ? w : fallback;
}

function drawBars() {
  const box = $('#bars-canvas');
  if (!box) return;
  const runs = state.runs.slice(0, 12).reverse(); // 오래된 것 → 최근 순서로 왼쪽부터
  const W = chartWidth(box, 300), H = 190;
  const m = { t: 20, r: 6, b: 38, l: 30 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const band = pw / runs.length;
  const bw = Math.max(10, Math.min(40, band * 0.56));
  const y = (r) => m.t + ph * (1 - r);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': '실행별 성공률 막대 그래프' });
  for (const g of [0, 0.5, 1]) {
    root.append(svg('line', { class: g === 0 ? 'axis' : 'grid', x1: m.l, x2: W - m.r, y1: y(g), y2: y(g) }));
    root.append(svg('text', { class: 'lbl', x: m.l - 6, y: y(g) + 4, 'text-anchor': 'end', text: `${g * 100}` }));
  }
  runs.forEach((r, i) => {
    const cx = m.l + band * i + band / 2;
    const selected = r.run_name === state.selectedRun;
    const g = svg('g', { class: 'bar-group' });
    const has = isNum(r.success_rate);
    const hitAttrs = {
      class: 'bar-hit', x: cx - band / 2, y: m.t, width: band, height: ph + m.b - 4, tabindex: 0, role: 'button',
      'aria-label': `${LABEL.subset[r.subset] || r.subset || '데이터 비율 모름'} 데이터, ${r.epochs ?? '?'}에폭, 시드 ${r.seed ?? '?'}, 성공률 ${has ? pctText(r.success_rate) + '%' : (runStatusLabel(r) || '기록 없음')}`,
      on: {
        click: () => { state.selectedRun = r.run_name; renderRuns(); },
        keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.selectedRun = r.run_name; renderRuns(); } },
        pointermove: (e) => tip.show(e, [[null, r.run_name], ['성공률', has ? pctText(r.success_rate) + '%' : (runStatusLabel(r) || '기록 없음')], ['데이터 비율', LABEL.subset[r.subset] || r.subset || '기록 없음'], ['에폭(학습 반복 횟수)', String(r.epochs ?? '기록 없음')], ['시드(무작위 배치 번호)', String(r.seed ?? '기록 없음')]]),
        pointerleave: () => tip.hide(),
      },
    };
    g.append(svg('rect', hitAttrs));
    if (has) {
      const top = y(Math.max(0, Math.min(1, r.success_rate)));
      const h = Math.max(2, m.t + ph - top);
      const rad = Math.min(4, bw / 2, h);
      // 윗모서리만 둥근 막대(바닥은 기준선에 붙임)
      const x0 = cx - bw / 2, x1 = cx + bw / 2, yb = m.t + ph;
      const d = `M${x0},${yb} V${top + rad} Q${x0},${top} ${x0 + rad},${top} H${x1 - rad} Q${x1},${top} ${x1},${top + rad} V${yb} Z`;
      g.append(svg('path', { class: 'bar' + (selected ? ' is-sel' : ''), d }));
      g.append(svg('text', { class: 'val' + (selected ? ' is-sel' : ''), x: cx, y: top - 6, 'text-anchor': 'middle', text: pctText(r.success_rate) }));
    } else {
      g.append(svg('rect', { class: 'bar-none', x: cx - bw / 2, y: m.t + ph - 14, width: bw, height: 14, rx: 3 }));
      g.append(svg('text', { class: 'val', x: cx, y: m.t + ph - 20, 'text-anchor': 'middle', text: runStatusLabel(r) || '없음' }));
    }
    const lab = svg('text', { class: 'lbl', x: cx, y: H - m.b + 16, 'text-anchor': 'middle' });
    lab.append(svg('tspan', { x: cx, text: LABEL.subset[r.subset] || r.subset || '?' }));
    lab.append(svg('tspan', { x: cx, dy: 13, text: `${r.epochs ?? '?'}에폭·시드${r.seed ?? '?'}` }));
    g.append(lab);
    root.append(g);
  });
  box.replaceChildren(root);
}

function drawLoss() {
  const box = $('#loss-canvas');
  if (!box) return;
  const sel = state.runs.find((r) => r.run_name === state.selectedRun);
  const pts = (sel && Array.isArray(sel.loss_curve) ? sel.loss_curve : []).filter((p) => isNum(p.epoch) && isNum(p.loss));
  if (pts.length < 2) {
    box.replaceChildren(el('p', { class: 'chart-empty', text: sel && sel.status === 'running' ? '학습이 진행되면 손실 곡선이 그려집니다.' : '이 실행에는 손실 기록이 없습니다.' }));
    return;
  }
  const W = chartWidth(box, 340), H = 190;
  const m = { t: 14, r: 10, b: 38, l: 46 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const e0 = pts[0].epoch, e1 = pts[pts.length - 1].epoch;
  let lo = Math.min(...pts.map((p) => p.loss)), hi = Math.max(...pts.map((p) => p.loss));
  if (hi === lo) { hi += 1; lo -= 1; }
  const padY = (hi - lo) * 0.06;
  lo -= padY; hi += padY;
  const x = (e) => m.l + (e1 === e0 ? pw / 2 : ((e - e0) / (e1 - e0)) * pw);
  const y = (v) => m.t + ph * (1 - (v - lo) / (hi - lo));
  const fmt = (v) => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2);

  const first = pts[0], last = pts[pts.length - 1];
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `학습 손실 곡선: 에폭 ${first.epoch} ${fmt(first.loss)}에서 에폭 ${last.epoch} ${fmt(last.loss)}로` });
  root.append(svg('defs', null, svg('linearGradient', { id: 'lossFill', x1: 0, y1: 0, x2: 0, y2: 1 },
    svg('stop', { offset: '0%', 'stop-color': '#ff7a1f', 'stop-opacity': 0.22 }),
    svg('stop', { offset: '100%', 'stop-color': '#ff7a1f', 'stop-opacity': 0 }))));
  const top = hi - padY, bot = lo + padY;
  for (const v of [top, (top + bot) / 2, bot]) {
    root.append(svg('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    root.append(svg('text', { class: 'lbl', x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end', text: fmt(v) }));
  }
  root.append(svg('line', { class: 'axis', x1: m.l, x2: W - m.r, y1: m.t + ph, y2: m.t + ph }));
  root.append(svg('text', { class: 'lbl', x: m.l, y: H - m.b + 18, 'text-anchor': 'start', text: `에폭 ${e0}` }));
  root.append(svg('text', { class: 'lbl', x: W - m.r, y: H - m.b + 18, 'text-anchor': 'end', text: `에폭 ${e1}` }));

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.epoch).toFixed(1)},${y(p.loss).toFixed(1)}`).join(' ');
  root.append(svg('path', { class: 'area', d: `${line} L${x(e1).toFixed(1)},${m.t + ph} L${x(e0).toFixed(1)},${m.t + ph} Z` }));
  root.append(svg('path', { class: 'line', d: line }));

  const cross = svg('line', { class: 'cross', y1: m.t, y2: m.t + ph, x1: -10, x2: -10, visibility: 'hidden' });
  const dot = svg('circle', { class: 'pt', r: 4.5, cx: -10, cy: -10, visibility: 'hidden' });
  root.append(cross, dot);
  root.append(svg('rect', {
    x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent',
    on: {
      pointermove: (e) => {
        const rect = root.getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * W;
        let best = pts[0];
        for (const p of pts) if (Math.abs(x(p.epoch) - px) < Math.abs(x(best.epoch) - px)) best = p;
        cross.setAttribute('x1', x(best.epoch)); cross.setAttribute('x2', x(best.epoch));
        dot.setAttribute('cx', x(best.epoch)); dot.setAttribute('cy', y(best.loss));
        cross.setAttribute('visibility', 'visible'); dot.setAttribute('visibility', 'visible');
        tip.show(e, [['에폭', String(best.epoch)], ['손실', fmt(best.loss)]]);
      },
      pointerleave: () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hide(); },
    },
  }));
  box.replaceChildren(root);
}

/* ════════════════ 8. 실험 승인 대기열 ════════════════ */

// 계약서 1·4장의 추정식(kernel_api.py EST_* 상수와 같은 값). 서버는 제안된 실험마다 estimate_sec를 따로 돌려준다.
const EST = { perEpoch: 0.45, rollout: 60, load: 40 };

/** 제안 폼의 예상 시간: 추정식 값 + 같은 에폭 수의 실제 완료 기록(runs/*.time.log)을 나란히 보여 준다 */
function updateEstimate() {
  const est = $('#exp-estimate');
  if (!est) return;
  const epochs = Number($('#exp-epochs').value);
  const sec = epochs * EST.perEpoch + EST.rollout + EST.load;
  const actual = state.runs.filter((r) => r.status === 'done' && r.epochs === epochs && isNum(r.wall_sec)).map((r) => r.wall_sec).sort((a, b) => a - b);
  let text = `추정 약 ${fmtDuration(sec)}`;
  let title = `추정식(에폭×0.45초 + 평가 60초 + 불러오기 40초)으로 계산한 값입니다.`;
  if (actual.length) {
    const lo = actual[0], hi = actual[actual.length - 1];
    const range = lo === hi ? fmtDuration(lo) : `${fmtDuration(lo)}~${fmtDuration(hi)}`;
    text += `, 실제 ${epochs}에폭 기록 ${range}`;
    title += hi < sec ? ` 실제 ${epochs}에폭 실행 ${actual.length}건(${range})보다 넉넉하게 잡혀 있습니다.` : ` 실제 ${epochs}에폭 실행 ${actual.length}건: ${range}.`;
  } else {
    title += ` 아직 ${epochs}에폭으로 끝난 실행 기록이 없어 실제 시간과 비교할 수 없습니다.`;
  }
  est.textContent = text;
  est.title = title;
}

function initExperiments() {
  const form = $('#exp-form');
  form.addEventListener('change', updateEstimate);
  updateEstimate();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#exp-msg'), btn = $('#exp-submit');
    const body = { subset: $('#exp-subset').value, epochs: Number($('#exp-epochs').value), seed: Number($('#exp-seed').value) };
    btn.disabled = true;
    msg.className = 'form-msg';
    msg.textContent = '제안하는 중입니다.';
    try {
      const exp = await api('/api/experiments', { method: 'POST', body: JSON.stringify(body) });
      msg.classList.add('is-ok');
      msg.textContent = `실험을 제안했습니다(${exp.run_name || exp.id}). 아래 목록에서 승인해야 학습이 시작됩니다.`;
      await loadExperiments();
      loadActivity();
    } catch (err) {
      msg.classList.add('is-error');
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
  $('#btn-new-exp').addEventListener('click', () => {
    $('#experiments').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('#exp-subset').focus({ preventScroll: true }), 450);
  });
}

function updateSubsetOptions() {
  const ds = state.datasets.find((d) => d.filter_keys && /lift\/ph/.test(d.path || '')) || state.datasets.find((d) => d.filter_keys);
  const sel = $('#exp-subset');
  for (const opt of sel.options) {
    const base = LABEL.subset[opt.value];
    const n = ds ? ds.filter_keys[LABEL.filterKeyOf[opt.value]] : undefined;
    opt.textContent = isNum(n) ? `${base} (시연 ${n}개)` : base;
  }
}

const expSig = () => JSON.stringify([state.experiments, state.expErr ? state.expErr.message : '', state.confirmExp, state.expMsg]);

async function loadExperiments() {
  const before = state.expLoaded ? expSig() : null;
  const wasActive = new Set(state.experiments.filter((x) => ['running', 'queued'].includes(x.status)).map((x) => x.id));
  try {
    const d = await api('/api/experiments');
    state.experiments = Array.isArray(d.experiments) ? d.experiments : [];
    state.expErr = null;
  } catch (e) {
    state.expErr = e;
  }
  state.expLoaded = true;
  if (before === null || before !== expSig()) renderExperiments();
  // 학습이 끝난 실험이 있으면 결과·체크포인트를 새로 읽는다
  if (state.experiments.some((x) => wasActive.has(x.id) && !['running', 'queued'].includes(x.status))) {
    loadRuns(); loadCheckpoints(); loadStatus();
  }
  return reached(state.expErr);
}

function expActive() { return state.experiments.some((x) => x.status === 'running' || x.status === 'queued'); }

function renderExperiments() {
  const list = $('#exp-list'), meta = $('#queue-meta');
  if (state.expErr) { list.replaceChildren(el('li', null, errorBox('실험 목록을 불러오지 못했습니다', state.expErr))); meta.textContent = ''; return; }
  if (!state.expLoaded) { list.replaceChildren(el('li', null, emptyBox('불러오는 중', null))); return; }
  const exps = state.experiments;
  const ACTIVE = ['pending', 'queued', 'running'];
  const pending = exps.filter((x) => x.status === 'pending').length;
  const running = exps.filter((x) => x.status === 'running').length;
  const queued = exps.filter((x) => x.status === 'queued').length;
  meta.textContent = exps.length
    ? [`승인 대기 ${pending}건`, running ? `학습 중 ${running}건` : null, queued ? `순서 대기 ${queued}건` : null, `전체 ${exps.length}건`].filter(Boolean).join(' · ')
    : '';
  if (!exps.length) {
    list.replaceChildren(el('li', null, emptyBox('제안된 실험이 없습니다', '위에서 데이터 비율, 에폭, 시드를 골라 실험을 제안하세요. 제안만으로는 학습이 시작되지 않습니다.')));
    return;
  }
  // 승인·진행 중인 것을 먼저, 끝난 제안(완료·실패·거절·중단)은 접어 둔다
  const order = { running: 0, queued: 1, pending: 2 };
  const active = exps.filter((x) => ACTIVE.includes(x.status)).sort((a, b) => order[a.status] - order[b.status]);
  const past = exps.filter((x) => !ACTIVE.includes(x.status));
  const rows = active.map(expItem);
  if (!active.length) rows.push(el('li', null, emptyBox('승인을 기다리는 실험이 없습니다', '위에서 제안하면 여기에 나타나고, 승인해야 학습이 시작됩니다.')));
  if (past.length) {
    const det = el('details', { class: 'exp-past', open: state.expPastOpen },
      el('summary', null, `지난 제안 ${past.length}건`, el('span', { class: 'exp-past-sub', text: '완료·실패·거절·중단' })),
      el('ul', { class: 'exp-past-list' }, past.map(expItem)));
    det.addEventListener('toggle', () => { state.expPastOpen = det.open; });
    rows.push(el('li', null, det));
  }
  list.replaceChildren(...rows);
}

function expItem(x) {
  const p = x.params || {};
  const statusKind = { pending: 'accent', queued: null, running: 'live', done: 'ok', failed: 'bad', rejected: null, cancelled: null }[x.status];
  const est = fmtDuration(x.estimate_sec);
  const info = el('div', { class: 'exp-info' },
    est ? el('span', null, '추정 ', el('strong', { text: est })) : null,
    fmtWhen(x.created_at) ? el('span', { text: `제안 ${fmtWhen(x.created_at)}` }) : null,
    fmtWhen(x.approved_at) ? el('span', { text: `승인 ${fmtWhen(x.approved_at)}` }) : null,
    fmtWhen(x.finished_at) ? el('span', { text: `끝남 ${fmtWhen(x.finished_at)}` }) : null);

  let progress = null;
  if (x.status === 'running') {
    const pr = x.progress || {};
    const epochs = isNum(pr.epochs) ? pr.epochs : p.epochs;
    const ep = isNum(pr.epoch) ? pr.epoch : 0;
    const phase = pr.phase || 'load';
    const rTotal = isNum(pr.rollout_total) && pr.rollout_total > 0 ? pr.rollout_total : null;
    const rDone = rTotal !== null && isNum(pr.rollout_done) ? Math.min(pr.rollout_done, rTotal) : null;
    let ratio = 0;
    if (phase === 'train' && isNum(epochs) && epochs > 0) ratio = Math.min(1, ep / epochs);
    else if (phase === 'rollout' && rDone !== null) ratio = rDone / rTotal;
    else if (phase === 'rollout' || phase === 'done') ratio = 1;
    const indeterminate = phase === 'load' || (phase === 'rollout' && rDone === null);
    let right = isNum(epochs) ? `에폭 ${ep} / ${epochs}` : '';
    if (phase === 'rollout' && rTotal !== null) right = `평가 ${rDone !== null ? rDone : 0} / ${rTotal}회`;
    else if (phase === 'train' && isNum(pr.last_loss)) right += `, 손실 ${pr.last_loss.toPrecision(3)}`;
    progress = el('div', { class: 'progress' },
      el('div', { class: 'progress-label' },
        el('span', { text: LABEL.phase[phase] || phase }),
        el('span', { text: right })),
      el('div', { class: 'progress-track' + (indeterminate ? ' is-indeterminate' : ''), role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(ratio * 100) },
        el('div', { class: 'progress-fill', style: `width:${(ratio * 100).toFixed(1)}%` })));
  }

  let result = null;
  if (x.result) {
    const r = pctText(x.result.success_rate);
    result = el('div', { class: 'exp-info' },
      el('span', null, '성공률 ', r !== null ? el('span', { class: 'hi', text: `${r}%` }) : el('strong', { text: '기록 없음' })),
      fmtDuration(x.result.wall_sec) ? el('span', null, '실제 걸린 시간 ', el('strong', { text: fmtDuration(x.result.wall_sec) })) : null);
  }

  const actions = el('div', { class: 'exp-actions' });
  if (x.status === 'pending') {
    if (state.confirmExp === x.id) {
      actions.append(el('div', { class: 'exp-confirm' },
        el('span', { text: `승인하면 이 컴퓨터에서 실제 학습이 시작됩니다${est ? `(추정 ${est})` : ''}. 다른 학습이 돌고 있으면 순서를 기다립니다. 시작할까요?` }),
        el('div', { class: 'exp-actions' },
          el('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: () => expAction(x.id, 'approve') } }, icon('play'), '학습 시작'),
          el('button', { class: 'btn btn-sm', type: 'button', on: { click: () => { state.confirmExp = null; renderExperiments(); } } }, '취소'))));
    } else {
      actions.append(
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', on: { click: () => { state.confirmExp = x.id; renderExperiments(); } } }, icon('check'), '승인'),
        el('button', { class: 'btn btn-sm', type: 'button', on: { click: () => expAction(x.id, 'reject') } }, icon('x'), '거절'));
    }
  } else if (x.status === 'running' || x.status === 'queued') {
    actions.append(el('button', { class: 'btn btn-danger btn-sm', type: 'button', on: { click: () => expAction(x.id, 'cancel') } }, icon('stop'), x.status === 'running' ? '학습 중단' : '대기 취소'));
  }
  const msg = state.expMsg && state.expMsg.id === x.id
    ? el('p', { class: 'form-msg ' + (state.expMsg.error ? 'is-error' : 'is-ok'), text: state.expMsg.text }) : null;

  const chip = (k, v) => el('span', { class: 'arg' }, el('span', { text: k }), v);
  const title = `${LABEL.subset[p.subset] || p.subset || '?'} 데이터 · ${p.epochs ?? '?'}에폭 · 시드 ${p.seed ?? '?'}`;
  return el('li', { class: 'exp' + (x.status === 'running' ? ' is-running' : '') },
    el('div', { class: 'exp-top' },
      el('div', { class: 'exp-title' },
        el('span', { class: 'exp-name', text: title }),
        x.run_name ? el('code', { class: 'exp-run', text: x.run_name, title: x.filter_key ? `필터 키 ${x.filter_key}` : null }) : null),
      badge(LABEL.expStatus[x.status] || x.status, statusKind),
      x.source === 'verification' ? badge('검증용 제안') : null),
    isNum(x.num_demos) ? el('div', { class: 'exp-params' }, chip('학습에 쓰는 시연', `${x.num_demos}개`)) : null,
    info, progress, result,
    x.error ? el('p', { class: 'exp-err', text: x.error }) : null,
    x.archived_to ? el('p', { class: 'exp-note', text: `이전 시도 기록은 runs/${x.archived_to}/ 에 보관했습니다. 같은 설정을 다시 제안할 수 있습니다.` }) : null,
    actions.childElementCount ? actions : null,
    msg);
}

async function expAction(id, action) {
  const done = { approve: '승인했습니다.', reject: '거절했습니다.', cancel: '중단을 요청했습니다.' }[action];
  state.confirmExp = null;
  try {
    const x = await api(`/api/experiments/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: '{}' });
    const extra = action === 'approve' ? (x.status === 'queued' ? ' 앞 학습이 끝나면 자동으로 시작됩니다.' : ' 학습이 시작되었습니다.') : '';
    state.expMsg = { id, text: done + extra, error: false };
  } catch (e) {
    state.expMsg = { id, text: e.message, error: true };
  }
  await loadExperiments();
  loadStatus();
  loadActivity();
}

/* ════════════════ 9. 로봇 뷰어 ════════════════ */

function initViewer() {
  const trials = $('#viewer-trials');
  for (let i = 1; i <= 10; i++) trials.append(el('option', { value: i, text: `${i}회`, selected: i === 3 }));
  const img = $('#viewer-img');
  img.addEventListener('load', () => { state.viewer.gotFrame = true; $('#viewer-empty').hidden = true; });
  img.addEventListener('error', () => {
    if (!state.viewer.userStarted || state.viewer.gotFrame) return;
    img.removeAttribute('src');
    $('#viewer-empty').hidden = false;
    viewerMsg('시뮬레이터 화면을 열 수 없습니다. 다른 실행이 진행 중이거나 대시보드 서버가 꺼져 있습니다.', true);
    state.viewer.userStarted = false;
    $('#viewer-go').disabled = false;
  });
  $('#viewer-form').addEventListener('submit', (e) => { e.preventDefault(); startViewer(); });
  drawGauge(null, 0, 0);
}

function viewerMsg(text, isError) {
  const m = $('#viewer-msg');
  m.className = 'form-msg field-wide' + (text ? (isError ? ' is-error' : '') : '');
  m.textContent = text || '';
}

async function loadCheckpoints() {
  try {
    const d = await api('/api/viewer/checkpoints');
    state.checkpoints = Array.isArray(d.checkpoints) ? d.checkpoints : [];
    state.ckptErr = null;
  } catch (e) {
    state.ckptErr = e;
  }
  state.ckptLoaded = true;
  renderCheckpoints();
  return reached(state.ckptErr);
}

function renderCheckpoints() {
  const sel = $('#viewer-ckpt');
  const prev = sel.value;
  if (state.ckptErr) {
    sel.replaceChildren(el('option', { value: '', text: '모델 목록을 불러오지 못함' }));
    sel.disabled = true;
    viewerMsg(state.ckptErr.offline ? '' : state.ckptErr.message, true);
  } else if (!state.checkpoints.length) {
    sel.replaceChildren(el('option', { value: '', text: '학습된 모델 없음' }));
    sel.disabled = true;
  } else {
    sel.disabled = false;
    sel.replaceChildren(...state.checkpoints.map((c) => {
      // 쉬운 이름: "<데이터 비율> 데이터 · <에폭>에폭 · 평가 <성공률>%" (실행 설정은 실험 결과 목록에서 찾는다)
      const run = state.runs.find((r) => r.run_name === c.run_name);
      const parts = [];
      if (run && run.subset) parts.push(`${LABEL.subset[run.subset] || run.subset} 데이터`);
      if (isNum(c.epoch)) parts.push(`${c.epoch}에폭`);
      else if (run && isNum(run.epochs)) parts.push(`${run.epochs}에폭`);
      if (run && run.seed !== null && run.seed !== undefined) parts.push(`시드 ${run.seed}`);
      const r = pctText(c.success_rate);
      parts.push(r !== null ? `평가 ${r}%` : '평가 기록 없음');
      const label = run && run.subset ? parts.join(' · ') : (c.label || c.run_name || c.id);
      return el('option', { value: c.id, text: label, title: `${c.run_name || ''} (${c.id})` });
    }));
    if (prev && state.checkpoints.some((c) => c.id === prev)) sel.value = prev;
    if ($('#viewer-msg').classList.contains('is-error') && !state.viewer.err) viewerMsg('');
  }
  syncViewerButton();
}

/* 서버의 phase: loading_lib, loading_model, idle, queued, running, done, error, fatal */
const VIEWER_BUSY = new Set(['queued', 'loading_model', 'running']);
function viewerRunning(st) {
  if (!st) return false;
  if (st.phase) return VIEWER_BUSY.has(st.phase);
  const s = String(st.status || '');
  return /실행|불러오/.test(s) && !/완료|오류|대기/.test(s);
}
function viewerUnavailable(st) {
  return !!st && (st.phase === 'loading_lib' || st.phase === 'fatal');
}

function syncViewerButton() {
  const st = state.viewer.stats;
  const running = viewerRunning(st) || state.viewer.userStarted;
  const btn = $('#viewer-go');
  btn.disabled = running || viewerUnavailable(st) || !state.checkpoints.length || !!state.ckptErr;
  btn.querySelector('span').textContent = running ? '실행 중' : st && st.phase === 'loading_lib' ? '준비 중' : '실행';
}

async function startViewer() {
  const ckpt = $('#viewer-ckpt').value;
  const trials = Number($('#viewer-trials').value);
  const seedRaw = $('#viewer-seed').value.trim();
  if (!ckpt || !state.checkpoints.some((c) => c.id === ckpt)) { viewerMsg('실행할 모델을 고르세요.', true); return; }
  if (!/^\d{1,5}$/.test(seedRaw)) { viewerMsg('시드는 0 이상 99999 이하의 정수로 입력하세요.', true); return; }
  // 이미 실행 중인지 먼저 확인(스트림 409는 이미지 요소에서 구분이 어렵다)
  try {
    const st = await api('/api/viewer/stats');
    if (viewerRunning(st)) { viewerMsg('이미 실행 중인 시뮬레이션이 있습니다. 끝난 뒤 다시 실행하세요.', true); state.viewer.stats = st; renderViewerStats(); return; }
  } catch (e) {
    viewerMsg(e.message, true);
    return;
  }
  viewerMsg('모델과 시뮬레이터를 준비하는 중입니다. 처음에는 몇십 초 걸릴 수 있습니다.');
  state.viewer.userStarted = true;
  state.viewer.gotFrame = false;
  syncViewerButton();
  const q = new URLSearchParams({ ckpt, trials: String(trials), seed: seedRaw, t: String(Date.now()) });
  $('#viewer-img').src = `/viewer/stream?${q}`;
  startViewerFastPoll();
}

function startViewerFastPoll() {
  clearTimeout(state.viewer.fastTimer);
  let sawRunning = false;
  const started = Date.now();
  const tick = async () => {
    await loadViewerStats();
    const running = viewerRunning(state.viewer.stats);
    if (running) sawRunning = true;
    if (state.viewer.stats && state.viewer.stats.phase === 'running' && $('#viewer-msg').textContent && !$('#viewer-msg').classList.contains('is-error')) viewerMsg('');
    const finished = sawRunning && !running;
    const gaveUp = !sawRunning && Date.now() - started > 120000;
    if (finished || gaveUp || state.viewer.err) {
      state.viewer.userStarted = false;
      if (finished) viewerMsg('');
      else if (gaveUp) viewerMsg('2분 동안 실행이 시작되지 않았습니다. 서버 기록을 확인하세요.', true);
      syncViewerButton();
      loadActivity();
      return;
    }
    state.viewer.fastTimer = setTimeout(tick, 400);
  };
  state.viewer.fastTimer = setTimeout(tick, 400);
}

async function loadViewerStats() {
  try {
    state.viewer.stats = await api('/api/viewer/stats');
    state.viewer.err = null;
  } catch (e) {
    state.viewer.err = e;
  }
  renderViewerStats();
  return reached(state.viewer.err);
}

function renderViewerStats() {
  const st = state.viewer.stats;
  const statusBox = $('#viewer-status'), hist = $('#viewer-history');
  if (state.viewer.err && !st) {
    statusBox.textContent = state.viewer.err.offline ? '시뮬레이터 상태를 불러오지 못했습니다(서버 연결 안 됨).' : `시뮬레이터 상태를 불러오지 못했습니다. ${state.viewer.err.message}`;
    drawGauge(null, 0, 0);
    hist.replaceChildren();
    syncViewerButton();
    return;
  }
  if (!st) { syncViewerButton(); return; }
  const s = String(st.status || '');
  const running = viewerRunning(st);
  // 이 화면에서 실행하지 않았고 지금 돌고 있지도 않으면, 보이는 수치는 '마지막 실행'의 결과다
  const isLast = !running && !state.viewer.userStarted;
  const parts = [s || '상태 없음'];
  if (isNum(st.trials) && st.trials > 0) parts.push(`시도 ${st.trial || 0}/${st.trials}`);
  if (running && isNum(st.step)) parts.push(`${st.step}스텝`);
  statusBox.textContent = (isLast && st.phase === 'done' ? '마지막 실행: ' : '') + parts.join(', ');
  const ck = st.ckpt ? state.checkpoints.find((c) => c.id === st.ckpt) : null;
  const ckName = st.ckpt ? (ck ? (ck.run_name || ck.label) : String(st.ckpt).split('/')[0]) : null;
  $('#viewer-meta').textContent = ckName ? (isLast ? `마지막 실행 모델 ${ckName}` : ckName) : '시뮬레이터에서 직접 실행';
  const done = isNum(st.done) ? st.done : 0;
  const success = isNum(st.success) ? st.success : 0;
  drawGauge(done > 0 ? success / done : null, success, done, isLast);
  $('#viewer-empty-text').textContent = isLast && st.phase === 'done' && !state.viewer.gotFrame
    ? '마지막 실행이 끝났습니다. 다시 보려면 모델을 고르고 실행을 누르세요.'
    : '실행하면 학습된 로봇이 큐브를 드는 장면이 여기에 실시간으로 나옵니다. 성공 여부는 시뮬레이터가 판정합니다.';
  const history = Array.isArray(st.history) ? st.history : [];
  hist.replaceChildren(...history.map((h) => el('li', {
    class: h.success ? 'is-o' : 'is-x',
    title: `${h.trial}번째 시도: ${h.success ? '성공' : '실패'}${isNum(h.steps) ? `, ${h.steps}스텝` : ''}`,
    'aria-label': `${h.trial}번째 시도 ${h.success ? '성공' : '실패'}`,
  }, h.success ? 'O' : 'X')));
  if (!viewerRunning(st) && !state.viewer.userStarted && !state.viewer.gotFrame) $('#viewer-empty').hidden = false;
  syncViewerButton();
}

/** 반원 눈금 게이지: 이번(또는 마지막) 실행의 성공률(성공 / 끝난 시도) */
function drawGauge(ratio, success, done, isLast) {
  const g = $('#viewer-gauge');
  const cx = 110, cy = 112, r0 = 78, r1 = 98, N = 41;
  const on = ratio === null ? 0 : Math.round(ratio * N);
  const kids = [];
  for (let i = 0; i < N; i++) {
    const a = Math.PI - (i * Math.PI) / (N - 1);
    const long = i % 10 === 0;
    const ri = long ? r0 - 5 : r0;
    kids.push(svg('line', {
      class: 'tick' + (i < on ? ' on' : ''),
      x1: (cx + ri * Math.cos(a)).toFixed(2), y1: (cy - ri * Math.sin(a)).toFixed(2),
      x2: (cx + r1 * Math.cos(a)).toFixed(2), y2: (cy - r1 * Math.sin(a)).toFixed(2),
    }));
  }
  const num = svg('text', { class: 'g-num', x: cx, y: cy - 8, 'text-anchor': 'middle' });
  if (ratio === null) num.append('–');
  else { num.append(pctText(ratio)); num.append(svg('tspan', { class: 'g-unit', dx: 3, text: '%' })); }
  kids.push(num);
  kids.push(svg('text', { class: 'g-end', x: cx - r1 + 10, y: cy + 14, 'text-anchor': 'middle', text: '0' }));
  kids.push(svg('text', { class: 'g-end', x: cx + r1 - 10, y: cy + 14, 'text-anchor': 'middle', text: '100' }));
  g.replaceChildren(...kids);
  const which = isLast ? '마지막 실행' : '이번 실행';
  g.setAttribute('aria-label', ratio === null ? `${which} 성공률: 아직 끝난 시도 없음` : `${which} 성공률 ${pctText(ratio)}퍼센트`);
  $('#viewer-caption').textContent = ratio === null
    ? '아직 끝난 시도가 없습니다'
    : isLast ? `마지막 실행 결과: ${done}번 중 ${success}번 성공` : `이번 실행 성공률, ${done}번 중 ${success}번 성공`;
}

/* ════════════════ 10. 데이터셋 ════════════════ */

async function loadDatasets() {
  const keysSig = () => JSON.stringify(state.datasets.map((d) => [d.path, d.filter_keys, d.num_demos]));
  const before = keysSig();
  try {
    const d = await api('/api/datasets');
    state.datasets = Array.isArray(d.datasets) ? d.datasets : [];
    state.dataErr = null;
  } catch (e) {
    state.dataErr = e;
  }
  state.dataLoaded = true;
  renderDatasets();
  updateSubsetOptions();
  // 실행 결과의 '시연 N개'는 데이터셋 부분집합에서 읽으므로, 부분집합 정보가 바뀌었을 때만 다시 그린다
  if (before !== keysSig() && state.runsLoaded && !state.runsErr) renderRuns();
  return reached(state.dataErr);
}

function renderDatasets() {
  const body = $('#data-body'), meta = $('#data-meta');
  if (state.dataErr) { body.replaceChildren(errorBox('데이터셋 정보를 불러오지 못했습니다', state.dataErr)); meta.textContent = ''; return; }
  if (!state.datasets.length) { body.replaceChildren(emptyBox('데이터셋 없음', '커널의 datasets 폴더에서 읽은 파일이 없습니다.')); meta.textContent = ''; return; }
  meta.textContent = `파일 ${state.datasets.length}개`;
  body.replaceChildren(...state.datasets.map((d) => {
    const src = LABEL.source[d.source] ? `${LABEL.source[d.source]} 데이터(${d.source})` : (d.source || '출처 모름');
    const obs = LABEL.obs[d.obs] ? `${LABEL.obs[d.obs]}(${d.obs})` : d.obs;
    const mb = isNum(d.size_bytes) ? (d.size_bytes / 1e6).toFixed(1) : null;
    const stat = (v, unit, k) => el('div', { class: 'stat' },
      el('div', { class: 'v' }, v === null ? '–' : v, v !== null && unit ? el('small', { text: unit }) : null),
      el('div', { class: 'k', text: k }));
    const keys = d.filter_keys && typeof d.filter_keys === 'object' ? Object.entries(d.filter_keys).filter(([, n]) => isNum(n)) : [];
    keys.sort((a, b) => b[1] - a[1]);
    const max = keys.length ? Math.max(...keys.map(([, n]) => n)) : 1;
    const range = isNum(d.min_len) && isNum(d.max_len) ? `시연 평균 길이(${d.min_len}~${d.max_len})` : '시연 평균 길이';
    return el('div', { class: 'ds' },
      el('div', { class: 'ds-name', text: `${d.task || '작업 모름'} 작업, ${src}` }),
      el('div', { class: 'ds-sub', text: [obs, d.path].filter(Boolean).join(', ') }),
      el('div', { class: 'ds-stats' },
        stat(fmtInt(d.num_demos), '개', '시연 수'),
        stat(isNum(d.avg_len) ? d.avg_len.toFixed(1) : null, '스텝', range),
        stat(mb, 'MB', '파일 크기')),
      keys.length ? el('div', { class: 'subsets' },
        el('div', { class: 'subsets-head' }, el('span', { text: `부분집합 ${keys.length}개` }), el('span', { text: '시연 수' })),
        ...keys.map(([k, n]) => el('div', { class: 'subset', title: k },
          el('span', { class: 'subset-name', text: subsetLabel(k) }),
          el('span', { class: 'subset-bar' }, el('i', { style: `width:${((n / max) * 100).toFixed(1)}%` })),
          el('span', { class: 'subset-n', text: String(n) })))) : el('p', { class: 'ds-sub', text: '부분집합 기록 없음' }),
      d.sha256 ? el('p', { class: 'ds-hash', title: d.sha256, text: `sha256 ${String(d.sha256).slice(0, 16)}…` }) : null);
  }));
}

/* ════════════════ 11. 활동 기록 ════════════════ */

const actSig = () => [state.activity.length, state.activity.length ? state.activity[0].ts + state.activity[0].message : '',
  state.actErr ? state.actErr.message : '', fmtDay(new Date())].join('#');

async function loadActivity() {
  const before = state.actLoaded ? actSig() : null;
  try {
    const d = await api('/api/activity');
    state.activity = Array.isArray(d.activity) ? d.activity : [];
    state.actErr = null;
  } catch (e) {
    state.actErr = e;
  }
  state.actLoaded = true;
  if (before === null || before !== actSig()) renderActivity();
  return reached(state.actErr);
}

function renderActivity() {
  const list = $('#activity'), meta = $('#activity-meta');
  if (state.actErr) { list.replaceChildren(el('li', null, errorBox('활동 기록을 불러오지 못했습니다', state.actErr))); meta.textContent = ''; return; }
  if (!state.activity.length) { list.replaceChildren(el('li', null, emptyBox('기록 없음', '질문, 실험 제안·승인, 뷰어 실행이 여기에 시간순으로 남습니다.'))); meta.textContent = ''; return; }
  meta.textContent = `최근 ${state.activity.length}건`;
  const rows = [];
  let lastDay = null;
  for (const a of state.activity) {
    const d = toDate(a.ts);
    const day = d ? fmtDay(d) : '';
    if (day !== lastDay) { rows.push(el('li', { class: 'act-day', text: day || '시각 없음' })); lastDay = day; }
    rows.push(el('li', { class: 'act' },
      el('time', { datetime: a.ts || '', text: d ? fmtClock(d) : '' }),
      el('div', { class: 'act-body' },
        el('span', { class: 'act-msg', text: a.message || '' }),
        el('span', { class: 'act-kind', text: LABEL.activityKind[a.kind] || a.kind || '' }))));
  }
  list.replaceChildren(...limitRows('activity', rows, renderActivity));
}

/* ════════════════ 12. 다음 행동 결정(미구현 표시만) ════════════════ */

function renderDecide() {
  const actions = [
    ['checklist', '기존 시연 다시 고르기', '이미 모은 시연 중 학습에 쓸 것을 다시 고릅니다.'],
    ['plus', '데이터 더 모으자고 제안하기', '부족한 종류의 시연을 사람이 더 모으도록 제안합니다.'],
    ['search', '원인 더 조사하기', '성공률이 낮은 이유를 추가 분석으로 찾습니다.'],
    ['refresh', '다시 평가하기', '같은 모델을 다른 시드나 더 많은 횟수로 다시 평가합니다.'],
    ['stop', '그만두기', '더 해도 나아지지 않는다고 보고 실험을 멈춥니다.'],
  ];
  $('#decide').replaceChildren(...actions.map(([ic, name, desc]) => el('li', null,
    el('span', { class: 'tile' }, icon(ic)),
    el('div', null, el('strong', { text: name }), el('span', { class: 'd', text: desc })),
    el('span', { class: 'state', text: '미구현' }))));
}

/* ════════════════ 13. 화면 조작(왼쪽 막대, 도구 막대) ════════════════ */

function initRail() {
  const btns = [...document.querySelectorAll('.rail-btn')];
  const anchors = btns.map((b) => document.getElementById(b.dataset.section)).filter(Boolean);
  let pending = false;
  const update = () => {
    pending = false;
    const line = window.innerHeight * 0.35;
    // 같은 줄에 있는 구역(넓은 화면의 로봇 뷰어와 데이터셋)은 위치가 같으므로, 더 아래에 있을 때만 다음 구역으로 넘긴다.
    // 위치가 같으면 막대에서 누른 구역(주소의 #)을 고른다.
    const hash = decodeURIComponent(location.hash.slice(1));
    let current = anchors[0], curTop = -Infinity;
    for (const a of anchors) {
      const t = a.getBoundingClientRect().top;
      if (t > line) continue;
      if (t > curTop + 2 || (Math.abs(t - curTop) <= 2 && a.id === hash)) { current = a; curTop = t; }
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = anchors[anchors.length - 1];
    for (const b of btns) {
      const on = b.dataset.section === current.id;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    }
  };
  window.addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(update); } }, { passive: true });
  window.addEventListener('hashchange', update);
  update();
}

function initToolbar() {
  const auto = $('#btn-auto');
  auto.addEventListener('click', () => {
    state.autoRefresh = !state.autoRefresh;
    auto.setAttribute('aria-pressed', String(state.autoRefresh));
    const label = state.autoRefresh ? '자동 새로 고침 켜짐' : '자동 새로 고침 꺼짐';
    auto.querySelector('span').textContent = label;
    auto.setAttribute('aria-label', label);
    auto.title = label;
    auto.querySelector('use').setAttribute('href', state.autoRefresh ? '#i-pause' : '#i-play');
    if (state.autoRefresh) refreshAll();
  });
  $('#btn-refresh').addEventListener('click', refreshAll);
  $('#ask-search').addEventListener('input', (e) => { state.askFilter = e.target.value; renderHistory(); });
}

/** ok: 서버에 닿았으면 true, 닿지 못했으면 false(마지막으로 닿은 시각을 남긴다). 그 밖의 값은 무시 */
let lastReached = null;
function markUpdated(ok) {
  if (typeof ok !== 'boolean') return;
  const node = $('#last-updated');
  if (ok) {
    lastReached = new Date();
    node.textContent = `마지막 갱신 ${fmtClock(lastReached, true)}`;
    node.classList.remove('is-bad');
  } else {
    node.textContent = lastReached ? `연결 끊김 · 마지막 성공 ${fmtClock(lastReached, true)}` : '연결 끊김 · 아직 불러오지 못함';
    node.classList.add('is-bad');
  }
}

/* ════════════════ 14. 주기적 갱신 ════════════════ */

let refreshing = null;
function refreshAll() {
  if (refreshing) return refreshing;
  refreshing = Promise.allSettled([
    loadStatus(), loadAsks(), loadRuns(), loadExperiments(), loadDatasets(), loadCheckpoints(), loadActivity(), loadViewerStats(),
  ]).then((results) => {
    markUpdated(results.some((r) => r.status === 'fulfilled' && r.value === true));
    refreshing = null;
  });
  return refreshing;
}

function every(ms, fn) {
  const loop = async () => {
    if (state.autoRefresh && !document.hidden) {
      try { markUpdated(await fn()); } catch (e) { /* 각 load 함수가 오류를 화면에 표시한다 */ }
    }
    setTimeout(loop, typeof ms === 'function' ? ms() : ms);
  };
  setTimeout(loop, typeof ms === 'function' ? ms() : ms);
}

function redrawChartsOnResize() {
  let t = null;
  const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { drawBars(); drawLoss(); }, 120); });
  ro.observe($('#runs-body'));
}

function init() {
  initAsk();
  initToolbar();
  initRail();
  initExperiments();
  initViewer();
  renderDecide();
  renderAgentView();
  renderAskAvailability();
  refreshAll();
  every(5000, loadStatus);
  every(() => (expActive() ? 2500 : 10000), loadExperiments);
  every(15000, loadRuns);
  every(30000, loadAsks);
  every(6000, loadActivity);
  every(30000, loadCheckpoints);
  every(60000, loadDatasets);
  every(5000, () => (state.viewer.userStarted ? Promise.resolve() : loadViewerStats()));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.autoRefresh) refreshAll(); });
  redrawChartsOnResize();
  ['#trace-list', '#history', '#exp-list', '#activity'].forEach((s) => watchScrollFade($(s)));
  NARROW_MQ.addEventListener('change', () => { renderHistory(); renderActivity(); });
}

document.addEventListener('DOMContentLoaded', init);
