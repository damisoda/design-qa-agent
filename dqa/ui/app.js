// dqa 웹 화면(로컬). 서버(dqa serve)의 /api만 부른다. 화면 구성은 디자인 시안(홈 · 새 검사 · 검토 · 코드 에이전트·PR)을 따른다.
const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const api = async (path, body) => {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DQA': '1' }, body: JSON.stringify(body) } : {})
  const j = await r.json().catch(() => ({}))
  if (!r.ok && j && j.error) throw new Error(j.error)
  return j
}
const file = (id, p) => `/api/runs/${encodeURIComponent(id)}/file/${p}`
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true }, 2200) }
const copy = (text) => navigator.clipboard.writeText(text).then(() => toast('복사했습니다'), () => toast('복사하지 못했습니다'))
const when = (iso) => {
  if (!iso) return ''
  const d = new Date(iso); const s = (Date.now() - d) / 1000
  if (s < 90) return '방금'; if (s < 3600) return `${Math.round(s / 60)}분 전`; if (s < 86400) return `${Math.round(s / 3600)}시간 전`
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const dur = (sec) => sec == null ? '' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
const ICON = {
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
}
const STATUS = { new: '새로 생김', worsened: '악화', unchanged: '기존', improved: '줄어듦', none: '결함', accepted: '무시', resolved: '해결' }
const swatch = (v) => /^#[0-9a-f]{6}$/i.test(String(v)) ? `<span class="sw" style="background:${v}" aria-hidden="true"></span>` : ''
const statusChip = (st) => ({ new: 'new', worsened: 'new', none: 'warn', resolved: 'ok' }[st] || 'plain')
const KNOW = { flex_min_auto: 'P02-4', narrow_box_squeezed: 'P02-4', narrow_box: 'P02-2', fake_home_indicator: 'P02-5 · P01-6', bottom_fixed_occlusion: 'P02-5' }

let OPT = null; let DOC = null; let ACCEPT = []; let timer = null; let DESIGNS = null
let inspectionView = null
let reviewRequest = 0
const inspectionCache = new Map(); const measureCache = new Map()
const inspectionRecords = id => { if (!inspectionCache.has(id)) inspectionCache.set(id, api(`/api/runs/${id}/inspections`).then(j => j.items || []).catch(() => [])); return inspectionCache.get(id) }
async function measuredBox (id, d, size) {
  const w = (d.widths || []).find(v => `${v.w}x${v.h}` === size); if (!w) return null
  if (d.kind === 'design' || d.kind === 'interact') return d.elements && d.elements[0] && d.elements[0].box
  const name = `measure/head/${d.screen.replace(/\//g, '_')}_${size}.json`; const key = id + name
  if (!measureCache.has(key)) measureCache.set(key, api(file(id, name)).catch(() => ({})))
  const data = await measureCache.get(key)
  return (data.issues || []).find(i => i.rule === d.rule && i.metric === w.metric && i.step === (w.step || 0) && ((d.fps || []).includes(i.el?.fp) || (d.elements || []).some(e => e.path === i.el?.path)))?.el?.box || null
}
async function focusIssueInFigma (id, d, rows, size) {
  const row = DqaTriage.recordFor(d, rows, size)
  if (!row || !row.figma) return toast('해당 크기에 대응하는 Figma 요소 기록이 없습니다. 요소 검사 기록에서 확인하세요.')
  try {
    const j = await api('/api/figma/focus', { run_id: id, inspection_id: row.id })
    for (let i = 0; i < 16; i++) { const r = await api('/api/figma/result/' + j.request_id); if (r.result) { if (!r.result.ok) throw new Error(r.result.error); return toast(`${r.result.name}을 Figma에서 선택했습니다`) } await new Promise(resolve => setTimeout(resolve, 500)) }
    toast('Figma에서 선택 확인이 도착하지 않았습니다. 해당 파일의 dqa 플러그인을 확인하세요.')
  } catch (e) { toast(e.message) }
}
const RV = {} // 실행별 검토 상태 { sel, mode, size, alpha }

// ── 공통 조각 ────────────────────────────────────────────
function envPills () {
  if (!DOC) return '<span class="pill">상태 확인 중</span>'
  const row = (k) => DOC.find((r) => r.name.startsWith(k))
  const tunnel = row('맥미니 터널'); const model = row('판정 모델'); const clone = row('저장소 클론')
  const llmOk = tunnel && tunnel.ok && model && model.ok
  return `<span class="pill" title="${esc(tunnel ? tunnel.detail : '')}"><span class="dot ${llmOk ? 'ok' : 'bad'}"></span>${llmOk ? '로컬 모델 연결됨' : '로컬 모델 끊김(dqa up)'}</span>
    ${clone ? `<span class="pill" title="${esc(clone.detail)}"><span class="dot ${clone.ok ? 'ok' : 'bad'}"></span>${clone.ok ? '저장소 클론 준비됨' : '저장소 클론 없음'}</span>` : ''}
    <span class="pill muted">이 컴퓨터에서만 열림</span>`
}
function topbar (left, right) {
  return `<header class="topbar">${left || '<a class="brand" href="#/"><b>dqa</b><span>디자인 검수</span></a>'}<div class="pills">${right == null ? envPills() : right}</div></header>`
}
function runBadge (r) {
  if (r.status === 'running') return `<span class="chip run">${r.job === 'fix' ? '수정 중' : r.job === 'pr' ? 'PR 준비 중' : '측정 중'}</span>`
  if (DqaState.incomplete(r)) return '<span class="chip warn">검사 불완전</span>'
  if (r.status === 'error' || !r.summary) return '<span class="chip plain">실패</span>'
  const s = r.summary
  if (s.new + s.worsened) return `<span class="chip new">새로 생김 ${s.new + s.worsened}</span>`
  if (s.no_base) return `<span class="chip warn">결함 ${s.no_base}</span>`
  if (s.failed_sizes) return `<span class="chip plain">측정 실패 ${s.failed_sizes}</span>`
  if (s.resolved) return `<span class="chip ok">해결 ${s.resolved}</span>`
  return '<span class="chip ok">새 결함 없음</span>'
}
const liveCount = (r) => r && r.summary ? r.summary.new + r.summary.worsened + r.summary.no_base : 0
const isOpen = (r) => r.status === 'running' || liveCount(r) > 0 || (r.summary && r.summary.failed_sizes) || r.status === 'error'

function progressView (id, title, events, kind) {
  return `${topbar(`<div class="headrow"><a class="iconbtn" href="#/" aria-label="검사 기록으로">${ICON.back}</a><div><div style="font-weight:600" id="ptitle">${esc(title || id)}</div><div class="muted small">${kind === 'fix' ? '코드 에이전트가 수정하고 검증하는 중' : kind === 'pr' ? 'PR 준비 중' : '검사 중'}</div></div></div>`, '')}
    <div class="progress"><div class="bar"><i></i></div><div class="card pad"><ol class="events" id="ev">${eventsHtml(events)}</ol></div>
    <div><button class="btn" id="stop">중지</button></div></div>`
}
const eventsHtml = (ev) => (ev || []).map((e) => `<li><span class="sec">${esc(e.sec)}초</span><span>${esc(e.msg)}</span></li>`).join('') || '<li><span class="sec"></span><span class="muted">시작하는 중</span></li>'

function watch (id, onDone, onTick) {
  clearInterval(timer)
  timer = setInterval(async () => {
    try {
      const j = await api(`/api/runs/${id}/events`)
      const pt = $('#ptitle'); if (pt && pt.textContent === '시작하는 중' && j.events && j.events[0]) pt.textContent = (j.events.find((e) => !['design', 'interact'].includes(e.stage)) || j.events[0]).msg
      if (onTick) onTick(j.events)
      if (!j.running) { clearInterval(timer); onDone() }
    } catch (e) {}
  }, 1500)
}

// ── 홈 ──────────────────────────────────────────────────
let HOME_FILTER = 'all'
async function viewHome () {
  const { runs } = await api('/api/runs')
  const featured = runs.find((r) => r.status === 'done' && liveCount(r) > 0)
  const fd = featured ? await api(`/api/runs/${featured.id}`) : null
  const latest = runs.find((r) => r.status === 'done')
  const row = (k) => (DOC || []).find((r) => r.name.startsWith(k))
  const env = [['로컬 모델', row('판정 모델') ? row('판정 모델').detail : '확인 중'], ['모델 서버 여유', row('맥미니 여유 메모리') ? row('맥미니 여유 메모리').detail.split(' ')[0] : '확인 중'], ['실행 기록', `${runs.length}개`], ['외부로 나간 요청', latest ? `${latest.blocked}건 막음 · 0건 허용` : '—']]
  const shown = runs.filter((r) => HOME_FILTER === 'all' || (HOME_FILTER === 'open' ? isOpen(r) : !isOpen(r)))
  const thumb = fd && fd.defects[0] && fd.defects[0].shots && fd.defects[0].shots.crop ? `<img src="${esc(file(featured.id, fd.defects[0].shots.crop))}" alt="">` : '<span class="muted small">캡처 없음</span>'
  const cmd = (featured || latest) ? `node dqa/cli.js ${String((featured || latest).command || '').replace(/\s*--run-id\s+\S+/, '')}` : 'node dqa/cli.js check --repo cbh --ref develop'
  $('#app').innerHTML = `${topbar()}
  <div class="home">
    <nav class="sidenav" aria-label="주 메뉴">
      <a class="btn primary big" href="#/new">${ICON.plus}새 검사</a>
      <div style="height:12px"></div>
      <a class="navlink on" href="#/">검사 기록</a>
      <a class="navlink" href="${featured ? `#/runs/${esc(featured.id)}` : '#/'}">검토할 결함 ${featured ? `<span class="count">${liveCount(featured)}</span>` : ''}</a>
      <a class="navlink" href="${featured ? `#/runs/${esc(featured.id)}/fix` : '#/'}">수정 · PR</a>
      <a class="navlink" href="#/recipes">화면 레시피</a>
      <section class="card env" aria-labelledby="env-h"><h2 id="env-h" class="label" style="margin:0">실행 환경</h2>${env.map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</section>
    </nav>
    <main class="homemain">
      <div class="titlerow">
        <div><h1>검사 기록</h1><p class="muted" style="margin:4px 0 0">화면을 여러 크기로 실제로 열어 재고, 변경 전과 비교해 새로 생긴 결함만 보여 줍니다.</p></div>
        <div class="filters" role="group" aria-label="기록 거르기">${[['all', '전체'], ['open', '확인 필요'], ['clean', '깨끗함']].map(([k, l]) => `<button type="button" data-f="${k}" class="${HOME_FILTER === k ? 'on' : ''}" aria-pressed="${HOME_FILTER === k}">${l}</button>`).join('')}</div>
      </div>
      ${featured ? `<section class="card featured" aria-labelledby="now-h">
        <div class="thumb" aria-hidden="true">${thumb}</div>
        <div class="body">
          <h2 id="now-h" class="label" style="margin:0">지금 볼 것</h2>
          <div style="font-size:18px;font-weight:600">${esc(featured.screens.join(' · '))} · ${esc(featured.head)}${featured.base ? ` <span class="muted" style="font-weight:400">대</span> ${esc(featured.base)}` : ''}</div>
          <div class="pills">${runBadge(featured)}${featured.summary.unchanged + featured.summary.improved ? `<span class="chip plain">기존 ${featured.summary.unchanged + featured.summary.improved}</span>` : ''}<span class="chip plain">크기 ${featured.sizes}개</span><span class="chip plain">외부 요청 0건</span>${featured.fix ? `<span class="chip ok">검증된 수정 ${featured.fix.verified}개</span>` : ''}</div>
          <p style="margin:0;color:var(--ink-2)">${esc(featured.overview || `결함 ${liveCount(featured)}건이 있습니다. 검토에서 하나씩 확인하세요.`)}</p>
        </div>
        <div class="cta"><a class="btn primary big" href="#/runs/${esc(featured.id)}">검토 시작</a><a class="btn big" href="#/runs/${esc(featured.id)}/fix">${featured.fix ? '수정안 보기' : '코드 에이전트'}</a></div>
      </section>` : ''}
      <section class="card" aria-labelledby="runs-h" style="overflow:hidden">
        <h2 id="runs-h" class="h2" style="padding:14px 18px;border-bottom:1px solid var(--line)">최근 검사 <span class="muted" style="font-weight:400">${shown.length}건</span></h2>
        ${shown.length ? `<div class="tablewrap"><table class="runs"><thead><tr><th scope="col">결과</th><th scope="col">대상</th><th scope="col">화면</th><th scope="col">크기</th><th scope="col">걸린 시간</th><th scope="col">시작</th></tr></thead><tbody>
          ${shown.map((r) => `<tr><td>${runBadge(r)}</td><td><a class="t" href="#/runs/${esc(r.id)}">${esc(r.head || r.title)}</a><div class="muted small">${esc(r.base ? `대 ${r.base}` : (r.kind === 'url' ? '실행 중인 주소' : r.kind === 'repo' ? '저장소' : r.kind === 'local' ? '작업 폴더' : '빌드'))}</div></td><td>${esc((r.screens || []).join(' · '))}</td><td class="mono small">${r.sizes ? `${r.sizes}개` : ''}</td><td class="mono small">${dur(r.total_sec)}</td><td class="muted">${esc(when(r.started_at))}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">해당하는 기록이 없습니다.</div>'}
      </section>
      <section class="clibox"><div style="min-width:0"><h2 class="h2" style="margin-bottom:4px">터미널에서 같은 검사</h2><code>${esc(cmd)}</code></div><button class="btn" type="button" id="copycmd">명령 복사</button></section>
    </main>
  </div>`
  $$('[data-f]').forEach((b) => { b.onclick = () => { HOME_FILTER = b.dataset.f; viewHome() } })
  $('#copycmd').onclick = () => copy(cmd)
  if (runs.some((r) => r.status === 'running')) { clearInterval(timer); timer = setInterval(() => { if (location.hash === '' || location.hash === '#/') viewHome(); else clearInterval(timer) }, 4000) }
}

async function viewRecipes () {
  $('#app').innerHTML = `${topbar()}<div class="wrap"><div class="titlerow"><div><h1>화면 레시피</h1><p class="muted" style="margin:4px 0 0">화면에 들어가는 방법(누를 글자, 입력, 기다릴 글자)을 적은 파일입니다. <code>dqa/recipes/</code>에 JSON으로 있습니다.</p></div><a class="btn" href="#/">검사 기록</a></div>
    <section class="card"><table class="t" style="margin:8px"><thead><tr><th>ID</th><th>화면</th><th>앱</th><th>기본 크기</th></tr></thead><tbody>${OPT.recipes.map((r) => `<tr><td class="mono">${esc(r.id)}</td><td>${esc(r.title)}</td><td>${esc(r.app)}</td><td class="mono small">${esc(r.widths || '')}</td></tr>`).join('')}</tbody></table></section>
    <p class="hint">새 레시피는 파일을 만든 뒤 <code>node dqa/cli.js recipe test --dist &lt;빌드&gt; --recipe &lt;id&gt;</code>로 들어가지는지 확인합니다.</p></div>`
}

// ── 새 검사 ──────────────────────────────────────────────
let NS = null
function nsInit () {
  const cloneOk = (DOC || []).some((r) => r.name.startsWith('저장소 클론') && r.ok)
  const report = OPT.recipes.find((r) => r.id.endsWith('/report'))
  let lastLocal = ''; try { lastLocal = localStorage.getItem('dqa.local') || '' } catch (e) {}
  return { step: 1, kind: 'local', local: lastLocal, localBase: 'none', ref: 'develop', base: '', url: '', baseUrl: '', src: '', dist: OPT.dists[0] ? OPT.dists[0].name : '', baseDist: '', recipes: new Set(), profile: OPT.default_profile, llm: false, interact: true, autofix: true, repairMode: 'model-only', err: '' }
}
function nsBody () {
  const b = { kind: NS.kind, recipes: [...NS.recipes], widths: NS.profile, llm: NS.llm ? 'auto' : 'off', autofix: NS.autofix && NS.kind !== 'url', interact: !!NS.interact }
  if (b.autofix) { b.repair_mode = 'model-only'; b.repair_llm = 'auto' }
  if (NS.kind === 'repo') { const v = NS.ref.trim(); if (/^#?\d+$/.test(v)) b.pr = v.replace('#', ''); else b.ref = v; if (NS.base.trim() && !b.pr) b.base = NS.base.trim(); b.repo = OPT.repos[0] ? OPT.repos[0].name : 'cbh' }
  if (NS.kind === 'url') Object.assign(b, { url: NS.url, base_url: NS.baseUrl || undefined, src: NS.src || undefined })
  if (NS.kind === 'dist') Object.assign(b, { dist: NS.dist, base_dist: NS.baseDist || undefined })
  if (NS.kind === 'local') Object.assign(b, { local: NS.local.trim(), base: NS.localBase })
  // 시안: 화면을 고르지 않은 작업 폴더 검사는 한 시안, 아니면 화면별
  const ds = Object.entries(NS.designs || {}).filter(([k, v]) => v && (k === '' ? !NS.recipes.size : NS.recipes.has(k)))
  if (NS.designs?.[''] && NS.recipes.size === 1) b.design = { [[...NS.recipes][0]]: NS.designs[''] }
  else if (ds.length) b.design = ds.length === 1 && ds[0][0] === '' ? ds[0][1] : Object.fromEntries(ds)
  return b
}
function nsCommand () {
  const b = nsBody(); const a = ['node dqa/cli.js check']
  if (b.kind === 'repo') a.push(`--repo ${b.repo}`, b.pr ? `--pr ${b.pr}` : `--ref ${b.ref}`, ...(b.base ? [`--base ${b.base}`] : []))
  if (b.kind === 'url') a.push(`--url ${b.url}`, ...(b.base_url ? [`--base-url ${b.base_url}`] : []), ...(b.src ? [`--src ${b.src}`] : []))
  if (b.kind === 'dist') a.push(`--dist ${b.dist}`, ...(b.base_dist ? [`--base-dist ${b.base_dist}`] : []))
  if (b.kind === 'local') a.push(`--local ${b.local || '(작업 폴더)'}`, ...(b.base !== 'HEAD' ? [`--base ${b.base}`] : []))
  a.push(...(b.recipes.length || b.kind !== 'local' ? [`--recipe ${b.recipes.join(',') || '(화면)'}`] : []), ...(b.design ? [`--design ${typeof b.design === 'string' ? b.design : Object.entries(b.design).map(([k, v]) => `${k}=${v}`).join(',')}`] : []), ...(b.interact ? ['--interact'] : []), `--widths ${b.widths}`, ...(b.llm === 'off' ? ['--llm off'] : []))
  return a.join(' ') + (b.autofix ? '\nnode dqa/cli.js fix --run <실행 ID>' + (b.repair_mode === 'model-only' ? ' --repair-mode model-only' : '') : '')
}
function nsSummary () {
  const target = NS.kind === 'local' ? (NS.local || '(작업 폴더)') : NS.kind === 'repo' ? (NS.ref || '(브랜치)') : NS.kind === 'url' ? NS.url : NS.dist
  const base = NS.kind === 'local' ? (NS.localBase === 'HEAD' ? '커밋 전 상태(HEAD), 커밋 안 된 변경이 있을 때' : '없음') : NS.kind === 'repo' ? (/^#?\d+$/.test(NS.ref.trim()) ? 'PR 병합 전(자동)' : NS.base || '없음') : NS.kind === 'url' ? (NS.baseUrl || '없음') : (NS.baseDist || '없음')
  const prof = OPT.profiles.find((p) => p.name === NS.profile)
  const titles = OPT.recipes.filter((r) => NS.recipes.has(r.id)).map((r) => r.title)
  $('#sum').innerHTML = `<h2 class="h2">실행할 내용</h2>
    <dl class="sum"><dt>대상</dt><dd>${esc(target)}</dd><dt>비교 기준</dt><dd>${esc(base)}</dd><dt>화면</dt><dd>${esc(titles.join(', ') || (NS.kind === 'local' ? '폴더의 기본 화면(.dqa.json, 없으면 첫 화면)' : '고르지 않음'))}</dd><dt>크기</dt><dd>${prof ? `${prof.sizes.length}개(${esc(prof.sizes.join(', '))})` : ''}</dd><dt>시안</dt><dd>${esc(nsBody().design ? (typeof nsBody().design === 'string' ? nsBody().design : Object.entries(nsBody().design).map(([k, v]) => `${k} → ${v}`).join(', ')) : '고르지 않음(폴더의 design.json이 있으면 그것)')}</dd><dt>예상 시간</dt><dd>${base === '없음' ? '약 20~30초' : '약 40초~1분'}${nsBody().design ? ' + 시안 비교 약 5초' : ''}${NS.interact ? ' + 눌러 보기 20초~1분' : ''}${NS.llm ? ' + 문제 정의 약 40초' : ''}${NS.autofix && NS.kind !== 'url' ? ' + 수정 2~4분' : ''}</dd></dl>
    <div class="cmd">${esc(nsCommand())}</div>
    <p class="hint">측정 결과와 캡처는 이 컴퓨터에만 남습니다. 앱 밖으로 나가는 요청은 모두 막습니다.</p>`
}
// 3단계의 시안 고르기: Figma 플러그인으로 넣은 시안 목록에서 화면마다 하나
function designPick (st) {
  if (!DESIGNS) return '<p class="hint">시안 목록을 읽는 중</p>'
  const opts = (sel) => `<option value="">시안 없이</option>${DESIGNS.map((d) => `<option value="${esc(d.name)}" ${sel === d.name ? 'selected' : ''}>${esc(d.frame)} · ${esc(d.base || '')}${d.group ? ` · ${esc(d.group)}` : ''}</option>`).join('')}`
  const screens = st.recipes.size ? OPT.recipes.filter((r) => st.recipes.has(r.id)).map((r) => [r.id, r.title]) : [['', '기본 화면']]
  return `<div class="field"><b>Figma 시안과 비교(선택)</b>${DESIGNS.length ? screens.map(([k, t]) => `<label class="grid2" style="align-items:center"><span class="small">${esc(t)}</span><select data-design="${esc(k)}">${opts((st.designs || {})[k])}</select></label>`).join('') : '<p class="hint" style="margin:0">아직 시안이 없습니다. Figma에서 dqa 플러그인으로 프레임을 보내면 여기에 나옵니다(figma-plugin/README.md).</p>'}
    <p class="hint" style="margin:0">고르면 시안 프레임 크기로 한 번 더 열어 색·글자·간격·정렬·크기 방식·문구를 시안 값과 비교합니다.</p></div>`
}
function viewNew () {
  if (!NS) NS = nsInit()
  if (!DESIGNS) api('/api/designs').then(j => { DESIGNS = j.designs || []; if (location.hash === '#/new') viewNew() }).catch(() => { DESIGNS = [] })
  const st = NS
  const kinds = [['local', '작업 폴더'], ['repo', '브랜치 · PR'], ['url', '실행 중인 주소'], ['dist', '빌드 폴더']]
  const target = st.kind === 'local' ? `<label class="field">프런트 프로젝트 폴더<input data-k="local" value="${esc(st.local)}" placeholder="/Users/.../my-app" autocomplete="off" required><span class="hint">폴더의 전체 경로를 넣으세요. 사본에서 빌드하고 검사합니다.</span></label>`
    : st.kind === 'repo' ? `<label class="field">검사할 브랜치·커밋 또는 PR 번호<input data-k="ref" value="${esc(st.ref)}" placeholder="develop 또는 #221" required></label>`
      : st.kind === 'url' ? `<label class="field">실행 중인 주소<input data-k="url" type="url" value="${esc(st.url)}" placeholder="http://127.0.0.1:3000/" required></label>`
        : `<label class="field">빌드 폴더<select data-k="dist">${OPT.dists.map(d => `<option value="${esc(d.name)}" ${st.dist === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>`
  const base = st.kind === 'local' ? `<label class="field">이전 코드와 비교<select data-k="localBase"><option value="HEAD" ${st.localBase === 'HEAD' ? 'selected' : ''}>커밋 전 상태(HEAD)</option><option value="none" ${st.localBase === 'none' ? 'selected' : ''}>단독 검사</option></select></label>`
    : st.kind === 'repo' ? `<label class="field">비교 기준<input data-k="base" value="${esc(st.base)}" placeholder="선택 사항"></label>`
      : st.kind === 'url' ? `<label class="field">비교 기준 주소<input data-k="baseUrl" value="${esc(st.baseUrl)}" placeholder="선택 사항"></label><label class="field">원인 파일을 찾을 소스 폴더<input data-k="src" value="${esc(st.src)}" placeholder="선택 사항"></label>`
        : `<label class="field">비교할 빌드<select data-k="baseDist"><option value="">없음</option>${OPT.dists.map(d => `<option value="${esc(d.name)}" ${st.baseDist === d.name ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>`
  $('#app').innerHTML = `${topbar(null, '<a class="btn" href="#/">검사 기록</a>')}
    <main class="wrap new-simple"><div class="import-heading"><span class="page-kicker">새 검사</span><h1>어떤 화면을 비교할까요?</h1><p class="muted">Figma 시안과 로컬 화면을 연결하면, 문제를 찾아 사본에서 수정하고 다시 검증합니다.</p></div>
    <form class="card form" id="nf">
      <div class="comparison-pair">${DqaFigma.html(st, DESIGNS)}<section class="local-target"><div class="section-heading"><span class="step-number">02</span><div><h2>로컬 화면 연결</h2><p class="hint">프로젝트를 선택하고 시안에 대응하는 화면을 고르세요.</p></div></div><div class="project-location">${target}</div><div id="local-target">${DqaTarget.card(st, DESIGNS || [])}</div></section></div><section id="comparison-summary" class="comparison-summary">${DqaTarget.summary(st, DESIGNS)}</section>
      <div class="check-defaults"><span class="step-number">03</span><div><b>연결한 화면으로 검사 시작</b><p class="hint">Dify 검사 → 모델의 코드 수정 → 재검증. 원본 적용은 결과를 확인한 뒤 승인합니다.</p></div></div>
      <p class="err" id="nerr" role="alert">${esc(st.err)}</p><div class="formfoot"><span class="hint">검사 중인 화면 · 발견한 문제 · 실행 로그를 함께 확인하세요.</span><button type="submit" class="btn primary big">검사 시작</button></div>
    </form></main>`
  $$('[data-k]').forEach(i => { i.oninput = i.onchange = () => { st[i.dataset.k] = i.value } })
  $$('[data-opt]').forEach(i => { i.onchange = () => { st[i.dataset.opt] = i.checked } })
  $$('[data-design]').forEach(i => { i.onchange = () => { st.designs = { ...(st.designs || {}), [i.dataset.design]: i.value }; viewNew() } })
  $$('[data-kind]').forEach(b => { b.onclick = () => { st.kind = b.dataset.kind; st.recipes = new Set(); st.designs = {}; st.advanced = true; viewNew() } })
  $$('[data-recipe]').forEach(i => { i.onchange = () => { st.recipesTouched = true; if (i.checked) st.recipes.add(i.dataset.recipe); else st.recipes.delete(i.dataset.recipe); viewNew() } })
  DqaFigma.mount(st, api, () => DESIGNS, list => { DESIGNS = list }, viewNew, toast)
  DqaTarget.mount(st, api, viewNew, DESIGNS || [])
  $('#nf').onsubmit = async e => {
    e.preventDefault()
    if (st.kind === 'local' && !st.local.trim()) { st.err = '프런트 프로젝트 폴더의 전체 경로를 넣으세요'; return viewNew() }
    if (st.kind === 'local' && !st.local.trim().startsWith('/')) { st.err = '폴더의 전체 경로는 /로 시작해야 합니다'; return viewNew() }
    if (!st.recipes.size && st.kind !== 'local') { st.err = '추가 설정에서 검사할 화면을 골라 주세요'; st.advanced = true; return viewNew() }
    if (st.kind === 'local' && !DqaTarget.selected(st)) { st.err = '프로젝트 폴더와 검사할 화면을 먼저 확인해 주세요'; return viewNew() }
    if (st.kind !== 'local' && !DqaFigma.chosen(st, DESIGNS)) { st.err = '비교할 Figma 시안을 먼저 가져오거나 선택해 주세요'; return viewNew() }
    if (st.figmaImporting) { st.err = '시안을 가져오는 중입니다. 완료된 뒤 검사해 주세요'; return viewNew() }
    const btn = $('button[type="submit"]', $('#nf')); btn.disabled = true; btn.textContent = '검사 시작 중'
    try { const body = nsBody(); if (st.kind === 'local') { const connected = await api('/api/local/connect', DqaTarget.payload(st, DESIGNS)); Object.assign(body, {local:connected.local, recipes:connected.recipes, design:connected.design}) } const r = await api('/api/check', body); if (st.kind === 'local') { try { localStorage.setItem('dqa.local', st.local.trim()) } catch (e) {} } NS = null; location.assign(r.live_url || `/#/runs/${r.run_id}`) }
    catch (err) { st.err = err.message; viewNew() }
  }
}

function liveCards (id, j) {
  return (j.defects || []).map(d => `<details class="finding"><summary><span class="chip warn">${esc(d.rule)}</span><b>${esc(d.rule_name || d.rule)}</b><span>${esc((d.labels || []).slice(0, 2).join(', '))}</span></summary><div><p class="small muted">${esc((d.widths || []).map(w => `${w.w}×${w.h}: ${w.px} ${w.metric || ''}`).join(' / '))}</p>${(d.evidence || []).slice(0, 3).map(e => `<p class="small">${esc(e.text)}</p>`).join('')}${d.judge && d.judge.status === 'ok' ? `<p>${esc(d.judge.problem)}</p><p class="hint">기대: ${esc(d.judge.expected)}</p>` : `<p class="hint">${d.judge && d.judge.status === 'fallback' ? esc(d.judge.reason) : j.running ? '문제 설명은 검사 후 덧붙입니다.' : '측정 근거로 항목을 확인하세요.'}</p>`}</div></details>`).join('') || `<div class="empty compact">${j.running ? '측정이 끝난 범위부터 발견한 항목이 나타납니다.' : '완료한 측정 범위에 발견된 항목이 없습니다.'}</div>`
}
async function viewLive (id, initial) {
  let inFlight = false; const hash = location.hash; const openCards = new Set()
  $('#app').innerHTML = `${topbar(`<div class="headrow"><a class="iconbtn" href="#/" aria-label="검사 기록으로">${ICON.back}</a><b>검사 진행</b></div>`, '<span class="pill">Dify 검사</span>')}
    <main class="wrap live-wrap"><section class="live-heading"><div><h1 id="live-title">화면을 확인하고 있습니다</h1><p id="live-message" role="status" aria-live="polite"></p></div><div class="live-controls"><span class="muted" id="live-count"></span><span class="muted" id="live-elapsed"></span><button class="btn" id="live-stop">검사 중지</button><button class="btn primary" id="see-results" hidden>검사 결과 정리 보기</button><a class="btn" href="#/">검사 기록</a></div></section>
    ${DqaPresentation.html()}<ol class="live-stages" id="live-stages" aria-label="검사 단계"></ol><div id="live-warning" role="status"></div><div id="live-repair-status" class="repair-progress-note" hidden></div>
    <div class="live-workbench"><div id="present-evidence" hidden></div>${DqaInspection.html()}<aside class="activity-panel" aria-label="실행 로그"><div class="activity-heading"><h2>실행 로그</h2><span class="activity-indicator" id="live-sync">연결 중</span></div><p class="hint">서버에 기록된 작업을 순서대로 보여줍니다.</p><label class="log-follow"><input type="checkbox" id="live-log-follow" checked> 최신 기록 따라가기</label><ol class="events" id="ev"></ol><details id="live-model-panel" open hidden><summary>모델 도구 호출</summary><pre id="live-model-actions"></pre></details></aside></div><section id="live-priority" class="live-priority" aria-label="먼저 확인할 문제"></section><section class="live-findings"><div class="titlerow"><h2 class="h2" id="live-findings-title">발견한 항목</h2><span class="chip warn" id="live-found"></span></div><p class="hint" id="live-provisional"></p><div id="live-cards"></div></section>
    </main>`
  if (inspectionView) inspectionView.close()
  inspectionView = DqaInspection.mount(id, api, file, toast)
  const presentationView = DqaPresentation.mount(id, esc, file, inspectionView)
  $('#see-results').onclick = () => { inspectionView.close(); inspectionView = null; clearInterval(timer); viewReview(id) }
  const update = j => {
    if (location.hash !== hash || !$('#live-message')) return
    const info = DqaState.progress(j); const p = j.pipeline || {}; inspectionView.update(j)
    $('#live-title').textContent = j.manifest && j.manifest.title || '검사 준비 중'
    const repair = j.repair
    $('#live-repair-status').hidden = !repair?.fix_pipeline
    $('#live-repair-status').textContent = repair?.fix_pipeline ? '코드 수정 · 재검증 — ' + ({ running: '진행 중', succeeded: '완료', failed: '실패', cancelled: '중단' }[repair.fix_pipeline.state] || '상태 확인 중') : ''
    $('#live-message').textContent = repair?.fix_pipeline?.message || info.message
    $('#live-model-panel').hidden = !repair?.fix?.app_plan
    const modelLog = $('#live-model-actions')
    const decisions = (repair?.fix?.app_plan?.tasks || []).flatMap(t => t.decisions || [])
    const modelText = decisions.map(d => JSON.stringify(d, null, 2)).join('\n\n')
    if (modelLog.textContent !== modelText) { const previous = modelLog.scrollTop; modelLog.textContent = modelText; modelLog.scrollTop = $('#live-log-follow').checked ? modelLog.scrollHeight : previous }
    if (repair?.fix_pipeline) { $('#see-results').textContent = '수정 결과와 전후 비교'; $('#see-results').onclick = () => { location.hash = '#/runs/' + id + '/fix' } }

    const checkSeconds = j.pipeline?.finished_at ? (Date.parse(j.pipeline.finished_at) - Date.parse(j.pipeline.started_at)) / 1000 : info.elapsed
    const rp = repair?.fix_pipeline
    const repairSeconds = rp?.started_at ? ((rp.finished_at ? Date.parse(rp.finished_at) : Date.now()) - Date.parse(rp.started_at)) / 1000 : null
    $('#live-elapsed').textContent = `검사 ${dur(checkSeconds)}${repairSeconds === null ? '' : ' · 수정 ' + dur(repairSeconds)}`
    $('#live-stages').innerHTML = info.stages.map(v => `<li class="${esc(v.status)}"><span class="stage-dot" aria-hidden="true"></span><b>${esc(v.label)}</b><span class="small">${esc(v.text)}</span></li>`).join('')
    $('#live-count').textContent = info.total ? `크기 측정 ${info.done}/${info.total}${info.failed ? ` · 실패 ${info.failed}` : ''}` : '크기 확인 중'
    $('#see-results').hidden = j.running || !j.manifest.summary
    const ordered = [...(j.defects || [])].sort((a, b) => DqaTriage.compare(a, b))
    const priorityHtml = ordered.length ? `<div class="live-priority-heading"><h2>${repair?.fix_pipeline ? '수정 전에 발견한 문제' : '먼저 확인할 문제'}</h2><span>${j.provisional ? '측정 중 발견' : '측정 완료'} · ${ordered.length}건</span></div><div class="live-priority-list">${ordered.slice(0, 3).map(d => `<button type="button" data-live-issue="${esc(d.id)}"><span class="priority-tag ${DqaTriage.priority(d).tone}">${esc(DqaTriage.priority(d).label)}</span><strong>${esc((d.labels || []).slice(0, 2).join(', '))}</strong><b>${esc(DqaTriage.title(d))}</b><span>${esc(DqaTriage.fact(d))}</span></button>`).join('')}</div>` : '<p class="hint">발견한 문제가 생기면 이곳에 심각도 순으로 표시됩니다.</p>'
    const priorityEl = $('#live-priority'); if (priorityEl.dataset.html !== priorityHtml) { priorityEl.innerHTML = priorityHtml; priorityEl.dataset.html = priorityHtml; $$('[data-live-issue]').forEach(b => { b.onclick = () => { const d = ordered.find(d => d.id === b.dataset.liveIssue); if (d && inspectionView.selectDefect(d)) $('.element-inspector').scrollIntoView({ block: 'start', behavior: 'auto' }); else toast('해당 요소의 기록을 준비하고 있습니다.') } }) }
    $('#live-found').textContent = `${(j.defects || []).length}건`
    $('#live-provisional').textContent = j.provisional ? '검사 중인 항목입니다. 묶기·재측정·이전 코드와 비교한 뒤 개수와 판정이 달라질 수 있습니다.' : j.running ? '화면 측정이 끝났습니다. 설명을 기다리는 동안 측정 근거를 확인할 수 있습니다.' : '검사가 끝났습니다. 요소별 측정 근거와 정리된 결과를 확인하세요.'
    const cards = $('#live-cards'); const html = liveCards(id, j)
    if (cards.dataset.content !== html) {
      $$('details', cards).forEach((d, i) => { if (d.open) openCards.add(i); else openCards.delete(i) })
      cards.innerHTML = html; cards.dataset.content = html; $$('details', cards).forEach((d, i) => { d.open = openCards.has(i) })
    }
    presentationView.update(j)
    const terminal = !j.running
    $('#live-stop').hidden = terminal
    const failed = terminal && (!j.manifest.summary || p.state !== 'succeeded' || (repair?.fix_pipeline && repair.fix_pipeline.state !== 'succeeded'))
    $('#live-warning').innerHTML = failed ? `<div class="banner">${esc(repair?.fix_pipeline?.error || p.error || j.manifest.error || info.message)}<span>완료한 측정은 아래에 남아 있습니다.</span><a class="btn sm" href="#/new">다시 검사</a></div>` : ''
    const log = $('#ev'); const previousTop = log.scrollTop; const logHtml = eventsHtml(j.events)
    if (log.innerHTML !== logHtml) { log.innerHTML = logHtml; log.scrollTop = $('#live-log-follow').checked ? log.scrollHeight : previousTop }
    $('#live-sync').textContent = j.running ? '수신 중 · ' + new Date().toLocaleTimeString('ko-KR', { hour12: false }) : '저장된 실행 기록'
    $('#live-sync').classList.toggle('is-live', !!j.running)
    if (terminal) {
      clearInterval(timer)
      $('#live-title').textContent = (j.manifest.title || '검사').replace('(작업 중)', '(로컬 사본)') + (!failed ? ' · 완료' : ' · 일부 결과')
    }
  }
  $('#live-log-follow').onchange = () => { if ($('#live-log-follow').checked) $('#ev').scrollTop = $('#ev').scrollHeight; if ($('#live-model-actions')) $('#live-model-actions').scrollTop = $('#live-model-actions').scrollHeight }
  $('#live-stop').onclick = async () => { const b = $('#live-stop'); b.disabled = true; b.textContent = '중지 요청 중'; try { await api('/api/stop', { run_id: id }) } catch (e) { toast(e.message); b.disabled = false } }
  const tick = async () => { if (inFlight || location.hash !== hash) return; inFlight = true; try { const j = await api(`/api/runs/${id}/live`); if (j.pipeline?.state === 'succeeded') j.repair = await api(`/api/runs/${id}`); update(j) } catch (e) { if ($('#live-warning')) $('#live-warning').textContent = '연결이 잠시 끊겼습니다. 마지막으로 받은 결과를 표시하며 다시 연결합니다.'; if ($('#live-sync')) { $('#live-sync').textContent = '재연결 중'; $('#live-sync').classList.remove('is-live') } } finally { inFlight = false } }
  clearInterval(timer); timer = setInterval(tick, 1000); await tick()
}

function wireReportRetry (id) { const b = $('#retry-report'); if (b) b.onclick = async () => { b.disabled = true; try { await api('/api/report', { run_id: id }); viewReview(id) } catch (e) { toast(e.message); b.disabled = false } } }

// ── 검토 ────────────────────────────────────────────────
const isAccepted = (d) => ACCEPT.some((a) => a.screen === d.screen && a.rule === d.rule && a.fps.some((f) => d.fps.includes(f)))
const stOf = (d) => (isAccepted(d) ? 'accepted' : d.diff ? d.diff.status : 'none')
const ORDER = { new: 0, worsened: 1, none: 2, improved: 3, unchanged: 4, accepted: 9 }
const SEV = { 높음: 0, 중간: 1, '사람 확인 필요': 2, 낮음: 3 }
const sizeKey = (s) => Array.isArray(s) ? s.join('x') : s

async function viewReview (id) {
  const request = ++reviewRequest
  const [j, acc] = await Promise.all([api(`/api/runs/${id}`), api('/api/accept')])
  if (request !== reviewRequest) return
  ACCEPT = acc
  const m = j.manifest
  if (!m) { $('#app').innerHTML = `${topbar()}<div class="empty">실행을 찾지 못했습니다.</div>`; return }
  if ((j.running && (!j.manifest.pipeline || j.manifest.pipeline.state === 'running') && !['fix', 'pr'].includes(j.job)) || (!m.summary && m.pipeline)) return viewLive(id, j)
  const defects = [...(j.defects || [])].sort((a, b) => DqaTriage.compare(a, b, stOf))
  const rv = RV[id] || (RV[id] = { sel: 0, mode: 'side', size: null, alpha: 50, focus: false, filter: 'open' })
  if (rv.sel >= defects.length) rv.sel = 0
  const summary = DqaTriage.summarize(defects, stOf)
  if (!summary.open.length && rv.filter === 'open') rv.filter = 'all'
  const shown = defects.map((d, i) => ({ d, i })).filter(({ d }) => rv.filter === 'all' || (rv.filter === 'open' ? DqaTriage.active(stOf(d)) : stOf(d) === 'accepted'))
  if (shown.length && !shown.some(x => x.i === rv.sel)) rv.sel = shown[0].i
  const cur = shown.length ? defects[rv.sel] : null
  const sizes = (m.sizes || []).map(sizeKey)
  if (cur && (!rv.size || !sizes.includes(rv.size))) { const first = sizes.find((s) => cur.widths.some((w) => `${w.w}x${w.h}` === s)); rv.size = first || sizes[0] }
  const live = defects.filter((d) => ['new', 'worsened', 'none'].includes(stOf(d)))
  const canFix = !DqaState.incomplete(m) && (j.fixable ? j.fixable.ok : m.targets.head.kind !== 'url')
  const fixOf = (d) => j.fix && j.fix.items && j.fix.items.find((x) => x.defect_id === d.id || x.target_ids?.includes(d.id))
  const header = `<div class="headrow"><a class="iconbtn" href="#/" aria-label="검사 기록으로">${ICON.back}</a><div style="min-width:0"><div style="font-weight:600">${esc(m.title)}</div><div class="muted small">크기 ${(m.sizes || []).length}개 · ${esc(dur(m.pipeline && m.pipeline.total_sec != null ? m.pipeline.total_sec : m.total_sec))} · ${DqaState.incomplete(m) ? '일부 미측정' : '검사 완료'}</div></div></div>`
  const headRight = `<a class="btn" href="#/runs/${esc(id)}/inspect">요소 검사 기록</a><span class="mono small muted">결함 ${defects.length}건</span>${j.fix ? `<a class="btn" href="#/runs/${esc(id)}/fix">수정 · PR 보기</a>` : ''}${canFix && live.length && !j.running ? '<button class="btn" id="fixall">코드 수정·재검증</button>' : ''}`
  const pipelineNote = m.pipeline && ['failed', 'timeout', 'cancelled'].includes(m.pipeline.state) ? `<div class="banner" role="status">문제 설명을 완료하지 못했습니다. 화면 측정 결과는 확인할 수 있습니다. ${esc(m.pipeline.error || '')}<button class="btn sm" id="retry-report">Dify에서 설명 다시 요청</button></div>` : m.pipeline && m.pipeline.report === 'skipped' ? `<div class="banner">문제 설명 생성은 생략했습니다. ${esc(m.pipeline.reason || '')}<button class="btn sm" id="retry-report">Dify에서 설명 다시 요청</button></div>` : ''
  const banner = pipelineNote + (DqaState.incomplete(m) ? `<div class="banner" role="alert">검사 불완전: 측정 실패가 있어 결함 없음·해결 여부를 확정하지 않습니다. 실패 내용을 확인하고 다시 검사하세요.</div>` : j.running ? `<div class="banner" role="status"><span id="bmsg">코드 에이전트가 수정하고 검증하는 중</span><a class="btn sm" href="#/runs/${esc(id)}/fix">진행 보기</a></div>` : '')
  if (!cur && defects.length) { rv.filter = 'all'; rv.sel = 0; return viewReview(id) }
  if (!defects.length) {
    $('#app').innerHTML = `${topbar(header, headRight)}${banner}<div class="wrap">${DqaTriage.overview(defects, { incomplete: DqaState.incomplete(m) }, stOf)}<div class="card pad stack"><h2 class="h2">${DqaState.incomplete(m) ? '검사를 완료하지 못했습니다' : '확인한 규칙에서 발견한 문제 없음'}</h2><p class="muted" style="margin:0">${DqaState.incomplete(m) ? '완료된 측정 범위에서만 결과를 확인할 수 있습니다.' : ''} 크기 ${(m.sizes || []).length}개에서 규칙에 걸린 것이 없습니다.${(j.diff.resolved || []).length ? ` 변경 전에 있던 결함 ${j.diff.resolved.length}건이 해결됐습니다.` : ''}</p></div>${moreHtml(id, j, m)}</div>`
    wireReportRetry(id); wireMore(j); return
  }
  const shotsFor = (side, d, size) => {
    const steps = (((j.shots || {})[side] || {})[d.screen] || {})[size] || []
    const wd = d.widths.find((w) => `${w.w}x${w.h}` === size)
    const k = wd ? wd.step || 0 : 0
    const s = steps[k] || steps[0] || {}
    return { clean: (wd && side === 'head' ? wd.clean : null) || s.shot, marked: side === 'head' && wd ? (wd.shot || s.marked) : null }
  }
  const after = shotsFor('head', cur, rv.size); const before = j.shots && j.shots.base ? shotsFor('base', cur, rv.size) : {}
  const hasBase = !!(m.targets.base && before.clean)
  const afterSrc = after.clean || after.marked
  // 비교 기준: Figma 시안이 있으면 시안, 없으면 변경 전 빌드. 시안은 한 크기(보통 375×812)라 겹쳐·차이만은 그 크기에서만 된다
  const des = m.design && m.design[cur.screen] && m.design[cur.screen].png ? m.design[cur.screen] : null
  const sameSize = !!des && des.base === rv.size
  const ref = des ? { cap: `시안(Figma) · ${des.frame || '프레임'} · ${String(des.base).replace('x', '×')}${sameSize ? '' : ' 기준(이 크기 시안 없음)'}`, src: des.png, alt: 'Figma 시안' } : hasBase ? { cap: `변경 전 · ${m.targets.base.ref}`, src: before.clean, alt: '변경 전 화면' } : null
  const canCompare = des ? sameSize : hasBase
  if (!canCompare) rv.mode = 'side'
  const noRef = '<figure><figcaption>비교 기준</figcaption><div class="noshot">비교할 시안이 없습니다.<br><span class="small">검사할 때 <code>--design</code>으로 Figma 내보내기(design.json·design.png)를 주거나, 빌드·작업 폴더에 design.json을 두면 여기에 시안이 나옵니다.</span></div></figure>'
  // 시안 비교 결함이면 시안 그림 위에 해당 노드 상자를 그린다(프레임 크기에 대한 비율)
  const dn = cur.kind === 'design' && cur.design ? cur.design.node : null
  const fsz = des ? (des.frame_size || String(des.base).split('x').map(Number)) : null
  const hl = dn && dn.box && fsz && fsz[0] ? `<span class="hl" style="left:${dn.box.x / fsz[0] * 100}%;top:${dn.box.y / fsz[1] * 100}%;width:${Math.max(dn.box.w, 2) / fsz[0] * 100}%;height:${Math.max(dn.box.h, 2) / fsz[1] * 100}%" aria-hidden="true"></span>` : ''
  const fig = (cap, src, alt, extra) => src ? `<figure><figcaption>${esc(cap)}</figcaption><button type="button" class="shotbox" data-zoom="${esc(file(id, src))}" aria-label="${esc(alt)} 크게 보기"><img src="${esc(file(id, src))}" alt="${esc(alt)}">${extra || ''}</button></figure>` : `<figure><figcaption>${esc(cap)}</figcaption><div class="noshot">이 크기의 캡처가 없습니다</div></figure>`
  let stage
  if (rv.mode === 'side' || !canCompare) {
    // 시안 비교 결함은 깨끗한 구현 캡처 위에 이 결함의 요소만 표시한다(결함 표시 캡처에는 시안 차이 전부가 그려져 있다)
    const eb = cur.kind === 'design' && sameSize && cur.elements[0] && cur.elements[0].box
    const [sw, sh] = String(rv.size || '').split('x').map(Number)
    const implHl = eb && after.clean && sw ? `<span class="hl" style="left:${eb.left / sw * 100}%;top:${eb.top / sh * 100}%;width:${Math.max(eb.width, 2) / sw * 100}%;height:${Math.max(eb.height, 2) / sh * 100}%" aria-hidden="true"></span>` : ''
    const impl = implHl ? fig(`구현 · ${m.targets.head.ref} (이 결함 요소)`, after.clean, '구현 화면', implHl) : fig(`구현 · ${m.targets.head.ref}${after.marked ? ' (결함 표시)' : ''}`, afterSrc, '구현 화면')
    const refFig = ref ? fig(dn ? `${ref.cap} · 노드 "${dn.name || ''}"` : ref.cap, ref.src, ref.alt, des ? hl : '') : noRef
    stage = des && hasBase ? `${refFig}${fig(`변경 전 · ${m.targets.base.ref}`, before.clean, '변경 전 화면')}${impl}` : `${refFig}${impl}`
  } else if (rv.mode === 'overlay') {
    const refName = des ? '시안' : '변경 전'
    stage = `<figure><figcaption>${refName} 위에 구현을 겹침</figcaption><div class="shotbox" style="cursor:default"><img src="${esc(file(id, ref.src))}" alt="${refName}"><div class="top" style="opacity:${rv.alpha / 100}"><img src="${esc(file(id, after.clean || afterSrc))}" alt="구현 화면"></div></div>
      <label class="slider">${refName}<input type="range" min="0" max="100" value="${rv.alpha}" id="alpha" aria-label="구현 투명도">구현</label></figure>`
  } else {
    stage = '<figure><figcaption>달라진 픽셀만 · <span id="diffpct">계산 중</span></figcaption><div class="shotbox" style="cursor:default"><canvas id="diffc" aria-label="달라진 부분"></canvas></div></figure>'
  }
  const records = await inspectionRecords(id)
  const box = await measuredBox(id, cur, rv.size)
  if (request !== reviewRequest || !location.hash.startsWith(`#/runs/${id}`)) return
  const pair = DqaTriage.recordFor(cur, records, rv.size)
  const [vw, vh] = String(rv.size).split('x').map(Number)
  const widthEvidence = cur.widths.find(w => `${w.w}x${w.h}` === rv.size)
  const paired = sameSize && pair && !widthEvidence?.scroll_y
  const rect = DqaTriage.focusRect([box, paired && pair.figma.box], vw, vh)
  const focusAvailable = !!(rect && box && after.clean)
  const wholeFigure = (caption, src, targetBox, width, height, variant) => {
    const mark = DqaInspection.rectPercent(targetBox, width, height)
    const outline = mark ? `<span class="whole-highlight ${variant}" style="left:${mark.left}%;top:${mark.top}%;width:${mark.width}%;height:${mark.height}%" aria-hidden="true"><span>${rv.sel + 1}</span></span>` : ''
    return fig(caption, src, variant === 'reference' ? 'Figma 시안' : '구현 화면', outline)
  }
  if (rv.mode === 'side' && box && after.clean) {
    const reference = ref ? des ? wholeFigure(ref.cap, ref.src, sameSize ? pair?.figma?.box || dn?.box : null, ...(fsz || [vw, vh]), 'reference') : fig(ref.cap, ref.src, ref.alt) : noRef
    stage = reference + (des && hasBase ? fig(`변경 전 · ${m.targets.base.ref}`, before.clean, '변경 전 화면') : '') + wholeFigure(`현재 구현 · ${rv.size.replace('x', '×')}`, after.clean, box, vw, vh, 'actual')
  }
  if (rv.focus && focusAvailable && rv.mode === 'side') {
    stage = (paired ? DqaTriage.spotlight(file(id, des.png), pair.figma.box, rect, vw, vh, 'Figma 기준', 'reference', rv.sel + 1) : '') + DqaTriage.spotlight(file(id, after.clean), box, rect, vw, vh, '현재 구현', 'actual', rv.sel + 1)
  }
  const hit = (s) => cur.widths.some((w) => `${w.w}x${w.h}` === s)
  const j0 = cur.judge || {}
  const basis = [cur.diff ? (cur.diff.status === 'new' ? '변경 전에는 이 결함이 없었음' : cur.diff.status === 'worsened' ? `변경 전에는 ${cur.diff.base_px}` : '변경 전에도 있었음') : null, `판정 기준 ${cur.rule}`, ...(cur.diag || []).map((g) => KNOW[g.code] ? `지식 ${KNOW[g.code]}` : null)].filter(Boolean)
  const fx = fixOf(cur)
  const fxChip = fx ? (fx.verified !== null ? '<span class="chip ok">검증된 수정 있음</span>' : fx.resolved_by_combined ? '<span class="chip ok">다른 수정과 함께 사라짐</span>' : fx.skipped ? '<span class="chip plain">고치지 않음</span>' : '<span class="chip warn">수정 못 함 · 사람 확인</span>') : ''
  $('#app').innerHTML = `${topbar(header, headRight)}${banner}<div class="priority-intro">${DqaTriage.overview(defects, { incomplete: DqaState.incomplete(m) }, stOf)}</div>
  <div class="review priority-review">
    <nav class="queue" aria-label="결함 대기열">
      <div class="qhead"><h2 class="h2">확인할 문제</h2><span class="muted small">${shown.length}건</span></div>
      <div class="queue-filters" role="group" aria-label="문제 범위">${[['open', '우선 확인'], ['all', '전체'], ...(summary.accepted ? [['accepted', '제외한 항목']] : [])].map(([k, text]) => `<button type="button" data-queue-filter="${k}" aria-pressed="${rv.filter === k}">${text}</button>`).join('')}</div>
      <p class="hint queue-order">심각도 높은 문제부터 · 같은 심각도에서는 동작 먼저</p>
      ${shown.map(({ d, i }) => `<button type="button" class="qitem ${i === rv.sel ? 'on' : ''}" data-sel="${i}" aria-current="${i === rv.sel}">
        <span class="meta"><span class="issue-index">${i + 1}</span><span class="priority-tag ${DqaTriage.priority(d).tone}">${esc(DqaTriage.priority(d).label)}</span><span class="small muted">${esc(DqaTriage.group(d))} · ${esc(STATUS[stOf(d)])}</span></span>
        <b>${esc((d.labels || []).slice(0, 2).join(', '))}</b><span class="queue-problem">${esc(DqaTriage.title(d))}</span>
        <span class="muted small">${(d.widths || []).length}개 크기에서 발견</span>
      </button>`).join('')}
      <div class="keys" aria-label="단축키"><kbd>J / K</kbd><span>다음 · 이전 결함</span><kbd>1 2 3</kbd><span>나란히 · 겹쳐 · 차이만</span>${canFix ? '<kbd>F</kbd><span>사본에서 수정안 검증</span>' : ''}<kbd>I</kbd><span>의도된 차이로 제외</span></div>
    </nav>
    <section class="card viewer" aria-label="화면 비교">
      <div class="selected-issue"><div class="selected-meta"><span class="issue-index">${rv.sel + 1}</span><span class="priority-tag ${DqaTriage.priority(cur).tone}">${esc(DqaTriage.priority(cur).label)}</span><span>${esc((cur.labels || []).join(', '))}</span></div><h2>${esc(DqaTriage.title(cur))}</h2>${DqaTriage.outcomes(cur, rv.size).length ? '' : `<p>${esc(DqaTriage.fact(cur, rv.size))}</p>`}</div>

      <div class="evidence-toolbar"><div class="seg" role="group" aria-label="비교 범위"><button type="button" id="show-focus" aria-pressed="${rv.focus && rv.mode === 'side'}" ${focusAvailable ? '' : 'disabled'}>문제 부분 확대</button><button type="button" id="show-context" aria-pressed="${!rv.focus || rv.mode !== 'side'}">전체 화면</button></div>${pair ? '<button class="btn sm" type="button" id="review-figma-focus">Figma에서 요소 보기</button>' : ''}</div>
      <div class="vtools">
        <div class="seg" role="group" aria-label="보기">${[['side', '나란히'], ['overlay', '겹쳐'], ['diff', '차이만']].map(([k, l]) => `<button type="button" data-mode="${k}" class="${rv.mode === k ? 'on' : ''}" ${k !== 'side' && !canCompare ? `disabled title="${des ? `시안과 같은 크기(${esc(des.base)})에서만 됩니다` : '시안이나 변경 전 빌드가 있어야 합니다'}"` : ''} aria-pressed="${rv.mode === k}">${l}</button>`).join('')}</div>
        <div class="sizetabs" role="group" aria-label="화면 크기">${sizes.map((s) => `<button type="button" data-size="${s}" class="${rv.size === s ? 'on' : ''}" aria-pressed="${rv.size === s}">${esc(s.replace('x', '×'))}${hit(s) ? '<span class="hit" aria-label="결함 있음"></span>' : ''}</button>`).join('')}</div>
      </div>
      <div class="stage ${rv.focus && focusAvailable && rv.mode === 'side' ? 'is-focused' : ''}">${stage}</div>
      ${DqaTriage.outcomes(cur, rv.size).length ? `<div class="observed-outcomes">${DqaTriage.outcomes(cur, rv.size).map((o, i) => `<div class="${i ? 'actual' : 'reference'}"><span>${esc(o.label)}</span><strong>${swatch(o.value)}${esc(o.value)}</strong></div>`).join('')}</div>` : ''}
      <p class="legend">${rv.focus && focusAvailable && rv.mode === 'side' ? '실제 캡처에서 측정 요소 주변을 확대했습니다. 같은 번호는 대응 요소입니다. ' : box && after.clean && rv.mode === 'side' ? '전체 화면에서 선택한 문제를 검은 테두리로 표시했습니다. 같은 번호는 대응 요소입니다. ' : after.marked ? '선택한 요소의 측정 위치를 표시합니다. ' : ''}${esc(DqaState.coverage(cur, rv.size))}${paired ? '같은 크기와 배율로 비교합니다.' : '전체 화면에서 주변 맥락을 확인할 수 있습니다.'}</p>
    </section>
    <aside class="side" aria-label="문제 정의와 원인">
      <div class="actions">
        ${cur.brief ? `<div class="brief"><button type="button" class="btn primary big" id="copybrief" title="${esc(cur.brief)}">이 문제의 수정 요청 복사</button><span class="muted small">요소·시안 값·제안 CSS·원인 파일을 한 덩어리로 복사합니다. Cursor·Claude Code 같은 도구에 그대로 붙여 넣으세요.</span></div>` : ''}
        ${canFix ? (fx && (fx.verified !== null || fx.resolved_by_combined) ? `<a class="btn primary big" href="#/runs/${esc(id)}/fix">수정안과 PR 보기</a>` : `<button type="button" class="btn big" id="fixone" ${j.running || stOf(cur) === 'accepted' ? 'disabled' : ''}>사본에서 수정안 검증</button>`) : `<p class="muted small" style="margin:0">${esc((j.fixable && j.fixable.reason) || '로컬 주소 대상은 사본을 만들 수 없어 코드 에이전트 수정을 하지 않습니다. 원인 파일을 직접 고치세요.')}</p>`}
        <div class="two">${stOf(cur) === 'accepted' ? '<button type="button" class="btn big" id="unaccept">무시 해제</button>' : '<button type="button" class="btn big" id="accept">의도된 차이로 제외</button>'}<button type="button" class="btn big" id="nextd">다음 결함</button></div>
      </div>


      ${cur.kind === 'design' && cur.design ? `<section class="card"><h2 class="h2" style="font-size:13px">시안과 구현 값</h2>
        <div class="tablewrap"><table class="t vals"><thead><tr><th>속성</th><th>시안</th><th>구현</th></tr></thead><tbody>${cur.design.values.map((v) => `<tr><td class="mono small">${esc(v.prop || '')}${v.at === 'alt' ? ' <span class="muted">(넓힌 화면)</span>' : ''}</td><td class="mono">${swatch(v.design)}${esc(v.design)}</td><td class="mono">${swatch(v.impl)}${esc(v.impl)}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted small" style="margin:6px 0 0">시안 노드 ${esc(cur.design.node.name || '')}(${esc(cur.design.node.type || '')}, ${esc(cur.design.node.id || '')}) · ${esc(`${cur.design.node.box.w}×${cur.design.node.box.h}`)}</p>
      </section>` : ''}
      <section class="card"><h2 class="h2" style="font-size:13px">측정과 진단</h2>
        ${cur.widths.map((w) => `<div class="fact"><span class="id">${esc(`${w.w}×${w.h}`)}</span><span>${esc(w.text || '')}${w.canvas_px !== w.px && /px$/.test(w.metric || '') ? ` (시안 ${esc(w.canvas_px)}px)` : ''}</span></div>`).slice(0, 5).join('')}
        ${(cur.diag || []).map((g) => `<div class="fact"><span class="id">진단</span><span>${esc(g.text)}</span></div>`).join('')}
      </section>
      <section class="card"><h2 class="h2" style="font-size:13px">원인 후보</h2>
        ${((cur.causes || {}).candidates || []).map((c) => `<div class="cause"><div class="row"><code>${esc(c.file)}:${esc(c.line)}</code><button type="button" class="btn sm" data-copy="${esc(c.file)}:${esc(c.line)}" aria-label="${esc(c.file)} 경로 복사">복사</button></div><span class="muted small">${esc(c.why.join(' · '))}</span></div>`).join('') || `<p class="muted small">${esc((cur.causes || {}).note || '찾지 못했습니다')}</p>`}
      </section>

      <details class="card report-explanation"><summary>Dify 문제 설명·검색 근거</summary><div class="report-content">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 class="h2" style="font-size:15px">${esc(cur.rule)} ${esc(cur.rule_name)} · ${esc(cur.labels.slice(0, 3).join(', '))}</h2><span class="muted small" style="flex:0 0 auto">심각도 ${esc(cur.severity)}</span></div>
        ${j0.status === 'ok' ? `<div><div class="label">왜 확인해야 하나요?</div><p>${esc(j0.problem)}</p></div><div><div class="label">어떻게 보여야 하나요?</div><p>${esc(j0.expected)}</p><p class="muted small">근거: ${esc([...basis, ...(j0.basis || []).map((b) => `모델 인용 ${b}`), ...(j0.related || []).map((x) => `검색 ${x.id} ${x.title}`)].join(' · '))}${j0.source === 'dify' ? ` · ${esc(j0.model || '')}, 숫자 검증 통과${j0.rag_status === 'retrieved_not_cited' ? ' · 검색 문서가 제공됐지만 모델은 측정 근거만 인용했습니다' : j0.rag_status === 'cited' ? ' · 검색 문서 인용 있음(내용의 정확성은 별도 확인)' : j0.rag_status === 'no_evidence' ? ' · 검색 근거 없음' : ''}` : ''}</p></div>`
          : `<div><div class="label">측정으로 확인한 문제</div><p>${esc(cur.rule_text ? `${cur.rule_text.cause} ${cur.rule_text.fix}` : '')}</p><p class="muted small">LLM 문제 정의 없음${j0.reason ? ` — ${esc(j0.reason)}` : ''} · 근거: ${esc(basis.join(' · '))}</p></div>`}
        <div class="pills">${j0.status === 'ok' ? `<span class="chip ${j0.verdict === '결함' ? 'warn' : 'plain'}" title="${esc(j0.reason)}">${esc(j0.verdict)}</span>` : ''}<span class="chip plain" title="${esc(((cur.confidence || {}).basis || []).join(', '))}">신뢰도 ${esc((cur.confidence || {}).level || '—')}</span>${cur.remeasured ? '<span class="chip plain">재측정 일치</span>' : ''}${fxChip}</div>
      </div></details>
    </aside>
  </div>
  <div class="more">${moreHtml(id, j, m)}</div>`

  const go = (i) => { const allowed = shown.map(x => x.i); rv.sel = allowed.includes(i) ? i : i < rv.sel ? [...allowed].reverse().find(n => n <= i) ?? allowed.at(-1) ?? 0 : allowed.find(n => n >= i) ?? allowed[0] ?? 0; rv.size = null; viewReview(id) }
  $$('[data-queue-filter]').forEach(b => { b.onclick = () => { rv.filter = b.dataset.queueFilter; rv.sel = 0; rv.size = null; viewReview(id) } })
  $('#show-focus').onclick = () => { rv.focus = true; rv.mode = 'side'; viewReview(id) }
  $('#show-context').onclick = () => { rv.focus = false; viewReview(id) }
  if ($('#review-figma-focus')) $('#review-figma-focus').onclick = async () => { const b = $('#review-figma-focus'); b.disabled = true; await focusIssueInFigma(id, cur, records, rv.size); b.disabled = false }
  $$('[data-sel]').forEach((b) => { b.onclick = () => go(Number(b.dataset.sel)) })
  $$('[data-mode]').forEach((b) => { b.onclick = () => { rv.mode = b.dataset.mode; viewReview(id) } })
  $$('[data-size]').forEach((b) => { b.onclick = () => { rv.size = b.dataset.size; viewReview(id) } })
  $$('[data-zoom]').forEach((b) => { b.onclick = () => { const lb = $('#lightbox'); $('img', lb).src = b.dataset.zoom; lb.hidden = false } })
  $$('[data-copy]').forEach((b) => { b.onclick = () => copy(b.dataset.copy) })
  if ($('#copybrief')) $('#copybrief').onclick = () => copy(cur.brief)
  const al = $('#alpha'); if (al) al.oninput = () => { rv.alpha = Number(al.value); $('.top').style.opacity = rv.alpha / 100 }
  if (rv.mode === 'diff' && canCompare) drawDiff(file(id, ref.src), file(id, after.clean || afterSrc))
  const startFix = async (defect) => { try { await api('/api/fix', { run_id: id, defect, llm: m.llm && m.llm.mode === 'off' ? 'off' : 'auto' }); location.hash = `#/runs/${id}/fix` } catch (err) { toast(err.message) } }
  if ($('#fixall')) $('#fixall').onclick = () => startFix(null)
  if ($('#fixone')) $('#fixone').onclick = () => startFix(cur.id)
  const ignore = async () => { const note = prompt('무시하는 이유(예: 의도된 디자인, 오탐). 다음 검사부터 이 결함은 접힙니다.', '의도된 디자인'); if (note === null) return; await api('/api/accept', { run_id: id, defect_id: cur.id, note }); go(rv.sel + 1) }
  if ($('#accept')) $('#accept').onclick = ignore
  if ($('#unaccept')) $('#unaccept').onclick = async () => { await api('/api/unaccept', { run_id: id, defect_id: cur.id }); viewReview(id) }
  $('#nextd').onclick = () => go(rv.sel + 1)
  wireReportRetry(id); wireMore(j)
  document.onkeydown = (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName) || e.metaKey || e.ctrlKey || !$('#lightbox').hidden) return
    const k = e.key.toLowerCase()
    if (k === 'j') go(rv.sel + 1); else if (k === 'k') go(rv.sel - 1)
    else if (k === '1' || ((k === '2' || k === '3') && canCompare)) { rv.mode = { 1: 'side', 2: 'overlay', 3: 'diff' }[k]; viewReview(id) }
    else if (k === 'f' && $('#fixone') && !$('#fixone').disabled) startFix(cur.id)
    else if (k === 'i' && $('#accept')) ignore()
  }
  if (j.running) watch(id, () => viewReview(id), (events) => { const last = events[events.length - 1]; const b = $('#bmsg'); if (b && last) b.textContent = last.msg })
}

function moreHtml (id, j, m) {
  const res = (j.diff && j.diff.resolved) || []
  return `${res.length ? `<details class="card"><summary>해결된 결함 ${res.length}건(변경 전에만 있음)</summary><div><ul>${res.map((d) => `<li><span class="chip ok">해결</span> ${esc(d.rule)} ${esc(d.rule_name)} — ${esc(d.labels.slice(0, 4).join(', '))} <span class="muted">(변경 전 ${d.widths.map((w) => `${w.w}×${w.h} ${w.px}`).join(', ')})</span></li>`).join('')}</ul></div></details>` : ''}
    ${(j.code_findings || []).length ? `<details class="card"><summary>코드 검사: 이번 변경에서 새로 쓴 색 값 ${j.code_findings.length}건</summary><div><div class="tablewrap"><table class="t" style="min-width:460px"><thead><tr><th>파일:줄</th><th>값</th><th>같은 값의 토큰</th></tr></thead><tbody>${j.code_findings.map((f) => `<tr><td class="mono small">${esc(f.file)}:${esc(f.line)}</td><td class="mono">${esc(f.hex)}</td><td>${esc(f.token || '없음(토큰 밖 값)')}</td></tr>`).join('')}</tbody></table></div></div></details>` : ''}
    ${(m.failures || []).length ? `<details class="card" open><summary>측정 실패 ${m.failures.length}건</summary><div><ul>${m.failures.map((f) => `<li>${esc(f.side)} ${esc(f.screen)} ${esc(f.size)}: ${esc(f.error)}</li>`).join('')}</ul></div></details>` : ''}
    <details class="card"><summary>보고서 파일 · PR 댓글 초안</summary><div class="stack"><div class="pills"><a class="btn sm" href="${esc(file(id, 'report.html'))}" target="_blank" rel="noopener">보고서(HTML)</a><a class="btn sm" href="${esc(file(id, 'report.md'))}" target="_blank" rel="noopener">보고서(MD)</a><button class="btn sm" type="button" id="copypc">PR 댓글 초안 복사</button><a class="btn sm" href="${esc(file(id, 'brief.md'))}" target="_blank" rel="noopener">수정 요청문 전체(MD)</a></div><textarea class="copy" readonly aria-label="PR 댓글 초안">${esc(j.pr_comment)}</textarea><p class="hint">PR 댓글은 자동으로 올리지 않습니다.</p></div></details>`
}
function wireMore (j) { const b = $('#copypc'); if (b) b.onclick = () => copy(j.pr_comment || '') }

// 차이만: 두 캡처를 같은 크기로 그려 픽셀마다 비교하고, 달라진 곳을 주황으로 칠한다(나머지는 흐리게)
function drawDiff (srcA, srcB) {
  const load = (src) => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = src })
  Promise.all([load(srcA), load(srcB)]).then(([a, b]) => {
    const c = $('#diffc'); if (!c) return
    const w = Math.min(a.naturalWidth, b.naturalWidth); const h = Math.min(a.naturalHeight, b.naturalHeight)
    c.width = w; c.height = h
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(a, 0, 0); const A = ctx.getImageData(0, 0, w, h)
    ctx.clearRect(0, 0, w, h); ctx.drawImage(b, 0, 0); const B = ctx.getImageData(0, 0, w, h)
    const out = ctx.createImageData(w, h); let changed = 0
    for (let i = 0; i < A.data.length; i += 4) {
      const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2])
      if (d > 48) { out.data[i] = 224; out.data[i + 1] = 92; out.data[i + 2] = 32; out.data[i + 3] = 255; changed++ } else { const g = (B.data[i] + B.data[i + 1] + B.data[i + 2]) / 3; const v = 255 - (255 - g) * 0.22; out.data[i] = out.data[i + 1] = out.data[i + 2] = v; out.data[i + 3] = 255 }
    }
    ctx.putImageData(out, 0, 0)
    const p = $('#diffpct'); if (p) p.textContent = `화면의 ${(changed / (w * h) * 100).toFixed(1)}%가 달라짐`
  }).catch(() => { const p = $('#diffpct'); if (p) p.textContent = '캡처를 읽지 못했습니다' })
}

// ── 코드 에이전트 · PR ─────────────────────────────────────
const FIXFRAME = {}
const FIXSEL = {}
const kindOf = (txt) => /남음|악화|실패|생김|되돌/.test(txt) ? 'warn' : /통과|사라짐|사라졌/.test(txt) ? 'ok' : 'plain'
async function viewFix (id) {
  const j = await api(`/api/runs/${id}`)
  const m = j.manifest
  if (!m) { $('#app').innerHTML = `${topbar()}<div class="empty">실행을 찾지 못했습니다.</div>`; return }
  const f = j.fix; const s = (f && f.summary) || {}
  const header = `<div class="headrow"><a class="iconbtn" href="#/runs/${esc(id)}" aria-label="검토로 돌아가기">${ICON.back}</a><div style="min-width:0"><div style="font-weight:600">수정 · PR — ${esc(m.title)}</div><div class="muted small">수정은 모두 사본에서 다시 빌드하고 재측정해 검증합니다. ${m.local ? '작업 폴더에는 확인 문구를 넣어 적용할 때만 씁니다.' : '원본 소스와 작업본은 바꾸지 않습니다.'}</div></div></div>`
  const right = f && f.summary ? `<span class="chip ok">검증된 수정 ${s.verified}개</span>${f.combined ? `<span class="chip ok">함께 적용 시 ${s.combined_fixed}건 사라짐</span><span class="chip plain">다른 결함 생김 ${s.combined_regress}건</span>` : ''}` : ''
  if (j.running) {
    const ev = await api(`/api/runs/${id}/events`)
    const mine = (ev.events || []).filter((e) => e.stage === 'fix' || e.stage === 'pr' || e.stage === 'dify')
    $('#app').innerHTML = progressView(id, `수정 · PR — ${m.title}`, mine, 'fix')
    $('#stop').onclick = async () => { if (confirm('작업을 중지할까요?')) await api('/api/stop', {}) }
    watch(id, () => viewFix(id), (events) => { const el = $('#ev'); if (el) { el.innerHTML = eventsHtml(events.filter((e) => e.stage === 'fix' || e.stage === 'pr' || e.stage === 'dify')); el.scrollTop = 1e9 } })
    return
  }
  if (!f || !f.items) {
    const canFix = !DqaState.incomplete(m) && (j.fixable ? j.fixable.ok : m.targets.head.kind !== 'url')
    $('#app').innerHTML = `${topbar(header, '')}<div class="wrap"><div class="card pad stack"><h2 class="h2">아직 수정안을 만들지 않았습니다</h2>
      <p class="muted" style="margin:0">코드 에이전트가 보고서 에이전트의 문제 정의서를 받아 규칙 수정안부터 해 보고, 안 되면 코드를 읽고·찾고·고쳐 봅니다. 수정마다 사본에서 다시 빌드하고 같은 크기로 재서, 결함이 사라지고 다른 결함이 생기지 않은 것만 남깁니다. 2~4분 걸립니다.</p>
      ${j.task_error && j.task_error.kind === 'fix' ? `<p class="err" role="alert" style="margin:0">지난 수정 시도가 실패했습니다: ${esc(j.task_error.error)}</p>` : ''}
      ${canFix ? '<div><button class="btn primary big" id="startfix">수정안 만들고 검증</button></div>' : `<p class="err">${esc((j.fixable && j.fixable.reason) || '로컬 주소 대상은 사본을 만들 수 없어 수정하지 않습니다.')}</p>`}</div></div>`
    if ($('#startfix')) {
      $('#startfix').onclick = async (e) => {
        const b = e.currentTarget; b.disabled = true; b.textContent = '시작하는 중…'
        try { await api('/api/fix', { run_id: id, llm: m.llm && m.llm.mode === 'off' ? 'off' : 'auto' }); await new Promise((r) => setTimeout(r, 600)); viewFix(id) } catch (err) { toast(err.message); b.disabled = false; b.textContent = '수정안 만들고 검증' }
      }
    }
    return
  }
  const items = f.items
  const sel = Math.min(FIXSEL[id] || 0, Math.max(0, items.length - 1))
  const it = items[sel] || { attempts: [], trail: [], labels: [] }
  const d = (j.defects || []).find((x) => x.id === it.defect_id) || { widths: [] }
  const resultOf = (x) => x.skipped ? ['plain', '고치지 않음'] : x.verified !== null ? ['ok', '검증됨'] : x.resolved_by_combined ? ['ok', '함께 사라짐'] : ['warn', '사람 확인']
  const verifiedCombined = DqaState.validCombined(f.combined)
  const afterList = (verifiedCombined && f.combined.after) || []
  const unit = (w) => w.metric === 'lines' ? '줄' : w.metric === 'height_ratio' ? '배' : /_pct$/.test(w.metric || '') ? '%' : 'px'
  const afterOf = (w) => {
    if (!verifiedCombined) return '—'
    const a = afterList.find((x) => x.id === d.id)
    const zero = w.metric === 'lines' ? '1줄' : `0${unit(w)}`
    if (!a) return '미검출'
    const hitw = (a.widths || []).find((sz) => sz.startsWith(`${w.w}x${w.h}:`))
    return hitw ? `${hitw.split(':')[1]}${unit(w)}` : '미검출'
  }
  const patch = (j.fix_patch || '').split('\n').map((l) => l.startsWith('+') && !l.startsWith('+++') ? `<span class="add">${esc(l)}</span>` : l.startsWith('-') && !l.startsWith('---') ? `<span class="del">${esc(l)}</span>` : l.startsWith('@@') ? `<span class="hunk">${esc(l)}</span>` : esc(l)).join('\n')
  const pr = j.pr
  const isRepo = m.targets.head.kind === 'repo'
  const isLocal = !!m.local
  const ap = j.apply
  const checks = pr ? [['수정 브랜치 만들기', pr.branch, true], ['패치 적용', '검증된 수정 전부', !!pr.commit], ...(pr.checks || []).map((k) => [k.name, k.ok ? '통과' : k.note, k.ok]), ['커밋', pr.commit ? `${pr.commit.slice(0, 8)} · ${pr.title || ''}` : '아직', !!pr.commit]] : []
  const ready = !!(pr && pr.commit && (pr.checks || []).every((k) => k.ok) && !pr.pushed)
  $('#app').innerHTML = `${topbar(header, right)}
  ${j.task_error?.kind === 'fix' ? `<div class="banner" role="alert">최근 수정 실행 실패: ${esc(j.task_error.error)}</div>` : ''}
  ${f.combined && !verifiedCombined ? '<div class="banner" role="alert">수정 묶음 검증이 통과하지 않았습니다. 이 패치는 적용할 수 없습니다.</div>' : ''}
  ${f.app_plan ? `<section class="card pad"><h2>앱 공통 컴포넌트 수정</h2><p>${f.app_plan.tasks.length}개 공통 작업 · ${f.app_plan.screens.length}화면 회귀검증 · ${f.app_plan.status === 'complete' ? '전체 완료' : '진행 중 또는 일부 완료'}</p><a href="${file(id, 'fix/app-plan.json')}" target="_blank">재계획·회귀검증 기록</a></section>` : ''}
  ${DqaRepair.render({ id, comparison: j.fix_comparison, selected: FIXFRAME[id], defect: d, defects: (j.defects || []).filter(x => (it.target_ids || [it.defect_id]).includes(x.id)), number: sel + 1, pipeline: j.fix_pipeline }, esc, file)}
  <div class="fixpage">
    <main class="fixmain">
      <div class="tabs" role="tablist" aria-label="결함">${items.map((x, i) => { const [k, l] = resultOf(x); return `<button type="button" role="tab" data-tab="${i}" class="${i === sel ? 'on' : ''}" aria-selected="${i === sel}">${esc(x.rule)} ${esc(x.labels.slice(0, 2).join(', '))} <span class="chip ${k}">${l}</span></button>` }).join('')}</div>
      <section class="card pad stack">
        <div><div class="label">받은 문제 정의(보고서 에이전트)</div><p style="margin:2px 0 0">${it.problem ? `${esc(it.problem.problem)} <span class="muted">원본(기대): ${esc(it.problem.expected)}</span>` : '<span class="muted">문제 정의 없이 측정·진단 사실만 받았습니다.</span>'}</p></div>
        ${it.skipped ? `<p class="muted" style="margin:0">${esc(it.skipped)}</p>` : ''}
        <h2 class="h2">에이전트 행동</h2>
        <ol class="timeline">${(it.trail || []).map((t) => `<li><span class="n">${esc(t.step)}</span><b>${esc(t.action)}</b><span style="min-width:0">${t.detail ? `<code>${esc(t.detail)}</code>` : ''}<span class="note">${esc(t.result)}</span></span><span class="chip ${kindOf(t.result)}">${kindOf(t.result) === 'ok' ? '통과' : kindOf(t.result) === 'warn' ? '되돌림' : '확인'}</span></li>`).join('') || '<li><span></span><span class="muted">행동 기록 없음</span></li>'}</ol>
        ${it.verified !== null && it.attempts && it.attempts[it.verified] ? `<div><div class="label">채택된 수정의 이유</div><p style="margin:2px 0 0">${esc(it.attempts[it.verified].edits[0].why || '')}</p></div>` : ''}
      </section>
      <section class="card pad stack"><h2 class="h2">수정 전 · 후 측정 <span class="muted" style="font-weight:400">${f.combined ? '검증된 수정을 함께 적용한 결과' : ''}</span></h2>
        <div class="tablewrap"><table class="t" style="min-width:480px"><thead><tr><th>크기</th><th>수정 전</th><th>수정 후</th><th>다른 결함</th></tr></thead><tbody>
        ${d.widths.map((w) => `<tr><td class="mono">${esc(`${w.w}×${w.h}`)}</td><td class="mono" style="color:var(--new-ink)">${d.kind ? esc(w.text) : esc(w.px) + unit(w)}</td><td class="mono" style="color:var(--ok-ink);font-weight:600">${esc(afterOf(w))}</td><td class="muted">${f.combined && (f.combined.regress || []).length ? esc(f.combined.regress.map((g) => `${g.rule} ${g.labels.join('·')}`).join(', ')) : '없음'}</td></tr>`).join('')}
        </tbody></table></div></section>
      <section class="card pad stack">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 class="h2">수정 코드</h2><div class="pills">${j.fix_patch ? `<button class="btn sm" type="button" id="copypatch">복사</button><a class="btn sm" href="${esc(file(id, 'fix/fix_all.patch'))}" download>내려받기</a>` : ''}<a class="btn sm" href="${esc(file(id, 'fix/fix_report.md'))}" target="_blank" rel="noopener">수정 보고서</a></div></div>
        ${verifiedCombined ? `<p class="small">검증된 수정 파일: ${[...new Set(f.combined.edits.map(e => e.file))].map(rel => `<a href="${esc(file(id, 'fix/source/' + rel))}" download>${esc(rel)}</a>`).join(' · ')}</p>` : ''}
        ${j.fix_patch ? `<pre class="patch">${patch}</pre><p class="hint">직접 적용할 때: <code>git apply fix_all.patch</code></p>` : '<p class="muted" style="margin:0">검증을 통과한 수정이 없습니다.</p>'}
      </section>
    </main>
    <aside class="prside" aria-labelledby="pr-h">
      ${isLocal ? `<section class="card pad stack">
        <h2 id="pr-h" class="h2" style="font-size:15px">작업 폴더에 적용</h2>
        <p class="muted small" style="margin:0;word-break:break-all">${esc(m.local.project)}</p>
        ${!j.fix_patch ? '<p class="muted" style="margin:0">검증된 수정이 있어야 적용할 수 있습니다.</p>' : ap && !ap.undone ? `<p style="margin:0">${esc(ap.label)}을 적용했습니다(${esc(new Date(ap.at).toLocaleString('ko-KR', { hour12: false }))}). 파일 ${ap.files.length}개: ${esc(ap.files.map((x) => x.file).join(', '))}</p>
          <p class="hint">변경 내용은 작업 폴더에서 <code>git diff</code>로 확인하세요. 적용 뒤 다시 검사하면 결함이 사라졌는지 볼 수 있습니다.</p>
          <label class="field" style="font-size:13px">되돌리려면 확인 문구<input id="undotxt" type="text" placeholder="되돌리기" autocomplete="off"></label>
          <button class="btn big" type="button" id="undo" disabled>적용 되돌리기</button>` : `<p class="muted" style="margin:0">검증된 수정을 작업 폴더의 파일에 그대로 넣습니다. 검사한 뒤에 그 파일을 고쳤다면 적용하지 않습니다. 원래 파일은 실행 기록에 남겨 되돌릴 수 있습니다.</p>
          ${ap && ap.undone ? '<p class="hint">이전 적용은 되돌렸습니다.</p>' : ''}
          <label class="field" style="font-size:13px">확인 문구<input id="applytxt" type="text" placeholder="적용" autocomplete="off"></label>
          <button class="btn primary big" type="button" id="apply" disabled>작업 폴더에 적용</button>`}
      </section>` : `<section class="card pad stack">
        <h2 id="pr-h" class="h2" style="font-size:15px">초안 PR</h2>
        ${!isRepo ? '<p class="muted" style="margin:0">빌드 이름으로 검사한 실행이라 어느 브랜치로 보낼지 모릅니다. 패치를 내려받아 적용하거나, 브랜치·PR로 다시 검사하세요.</p>' : !j.fix_patch ? '<p class="muted" style="margin:0">검증된 수정이 있어야 PR을 준비할 수 있습니다.</p>' : `
          ${pr ? `<ol class="checklist">${checks.map(([l, n, ok]) => `<li><span class="mark ${ok ? 'ok' : 'bad'}" aria-hidden="true">${ok ? '✓' : '!'}</span><span><span style="font-weight:500">${esc(l)}</span><span class="muted small" style="display:block">${esc(n)}</span></span></li>`).join('')}</ol>` : '<p class="muted" style="margin:0">독립 클론 안에 수정 브랜치를 만들고, 패치를 적용하고, 타입 검사·테스트를 돌린 뒤 커밋합니다. 아직 아무것도 올리지 않습니다.</p>'}
          <label class="field">PR이 향할 브랜치<input id="onto" type="text" value="${esc((pr && pr.base) || (m.build && m.build.ref_name) || '')}" placeholder="예: develop"></label>
          <button class="btn big" type="button" id="prep">${pr ? 'PR 다시 준비' : 'PR 준비(로컬)'}</button>
          ${j.pr_body ? `<details><summary class="muted">PR 본문 미리 보기(팀 PR 양식)</summary><textarea class="copy" readonly aria-label="PR 본문">${esc(j.pr_body)}</textarea></details>` : ''}`}
      </section>`}
      ${!isLocal && isRepo && pr && pr.commit ? (pr.pushed ? `<section class="confirm done"><h2 class="h2">초안 PR을 올렸습니다</h2><p style="margin:0">${esc(pr.branch)} → ${esc(pr.base)}${pr.url ? ` · <a href="${esc(pr.url)}" target="_blank" rel="noopener">${esc(pr.url)}</a>` : ''}</p><p class="small" style="margin:0">리뷰어 지정과 병합은 팀 규칙대로 직접 합니다.</p></section>`
        : `<section class="confirm"><h2 class="h2">팀 저장소에 올리기</h2><p style="margin:0;font-size:13px;color:var(--ink-2)">수정 브랜치를 올리고 초안 PR을 만듭니다. 병합은 하지 않습니다. 진행하려면 아래 칸에 <b>PR 올리기</b>를 그대로 입력하세요.</p>
          <label class="field" style="font-size:13px">확인 문구<input id="confirmtxt" type="text" placeholder="PR 올리기" autocomplete="off"></label>
          <button class="btn primary big" type="button" id="push" disabled>초안 PR 올리기</button>${ready ? '' : '<p class="err">프로젝트 검사가 실패해 올릴 수 없습니다.</p>'}</section>`) : ''}
    </aside>
  </div>`
  $$('[data-tab]').forEach((b) => { b.onclick = () => { FIXSEL[id] = Number(b.dataset.tab)
    const selected = items[FIXSEL[id]]; const issue = j.defects.find(d => d.id === selected?.defect_id)
    const at = (j.fix_comparison?.frames || []).findIndex(frame => frame.screen === issue?.screen && issue.widths.some(w => `${w.w}x${w.h}` === frame.size && (w.scroll_y || 0) === frame.scroll_y))
    if (at >= 0) FIXFRAME[id] = at
    viewFix(id) } })
  if ($('#repair-frame')) $('#repair-frame').onchange = e => { FIXFRAME[id] = Number(e.target.value); viewFix(id) }
  if ($('#copypatch')) $('#copypatch').onclick = () => copy(j.fix_patch)
  if ($('#prep')) $('#prep').onclick = async () => { try { await api('/api/pr', { run_id: id, onto: $('#onto').value.trim() || undefined }); viewFix(id) } catch (err) { toast(err.message) } }
  const at = $('#applytxt'); const ab = $('#apply')
  if (at && ab) {
    at.oninput = () => { ab.disabled = !verifiedCombined || at.value.trim() !== '적용' }
    ab.onclick = async () => { try { const r = await api('/api/apply', { run_id: id, confirm: at.value.trim() }); toast(r.applied ? `적용했습니다: 파일 ${r.files.length}개` : '적용하지 않았습니다'); viewFix(id) } catch (err) { toast(err.message) } }
  }
  const ut = $('#undotxt'); const ub = $('#undo')
  if (ut && ub) {
    ut.oninput = () => { ub.disabled = ut.value.trim() !== '되돌리기' }
    ub.onclick = async () => { try { await api('/api/apply', { run_id: id, undo: true, confirm: ut.value.trim() }); toast('되돌렸습니다'); viewFix(id) } catch (err) { toast(err.message) } }
  }
  const ct = $('#confirmtxt'); const pb = $('#push')
  if (ct && pb) {
    ct.oninput = () => { pb.disabled = !(ready && ct.value.trim() === 'PR 올리기') }
    pb.onclick = async () => { try { await api('/api/pr', { run_id: id, onto: $('#onto').value.trim() || undefined, push: true, confirm: ct.value.trim() }); viewFix(id) } catch (err) { toast(err.message) } }
  }
}

// ── 라우터 ──────────────────────────────────────────────
async function route () {
  reviewRequest++; clearInterval(timer); DqaFigma.close(); if (inspectionView) { inspectionView.close(); inspectionView = null } document.onkeydown = null
  const h = location.hash || '#/'
  let m
  try {
    if ((m = h.match(/^#\/runs\/([\w.-]+)\/inspect$/))) return await viewLive(m[1])
    if ((m = h.match(/^#\/runs\/([\w.-]+)\/fix$/))) return await viewFix(m[1])
    if ((m = h.match(/^#\/runs\/([\w.-]+)$/))) return await viewReview(m[1])
    if (h === '#/new') return viewNew()
    if (h === '#/recipes') return viewRecipes()
    return await viewHome()
  } catch (e) { $('#app').innerHTML = `${topbar()}<div class="empty">${esc(e.message)}</div>` }
}
$('#lightbox').onclick = () => { $('#lightbox').hidden = true }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#lightbox').hidden = true })
window.addEventListener('hashchange', () => { if (location.hash !== '#/new') NS = null; route() })
;(async () => {
  OPT = await api('/api/options')
  await route()
  DOC = await api('/api/doctor').catch(() => null)
  const pills = $('.topbar .pills'); if (pills && pills.textContent.includes('상태 확인 중')) pills.innerHTML = envPills()
  if ((location.hash || '#/') === '#/') viewHome()
})()
