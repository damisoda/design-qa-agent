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
const statusChip = (st) => ({ new: 'new', worsened: 'new', none: 'warn', resolved: 'ok' }[st] || 'plain')
const KNOW = { flex_min_auto: 'P02-4', narrow_box_squeezed: 'P02-4', narrow_box: 'P02-2', fake_home_indicator: 'P02-5 · P01-6', bottom_fixed_occlusion: 'P02-5' }

let OPT = null; let DOC = null; let ACCEPT = []; let timer = null
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
      const pt = $('#ptitle'); if (pt && pt.textContent === '시작하는 중' && j.events && j.events[0]) pt.textContent = j.events[0].msg
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
          ${shown.map((r) => `<tr><td>${runBadge(r)}</td><td><a class="t" href="#/runs/${esc(r.id)}">${esc(r.head || r.title)}</a><div class="muted small">${esc(r.base ? `대 ${r.base}` : (r.kind === 'url' ? '실행 중인 주소' : r.kind === 'repo' ? '저장소' : '빌드'))}</div></td><td>${esc((r.screens || []).join(' · '))}</td><td class="mono small">${r.sizes ? `${r.sizes}개` : ''}</td><td class="mono small">${dur(r.total_sec)}</td><td class="muted">${esc(when(r.started_at))}</td></tr>`).join('')}
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
  return { step: 1, kind: cloneOk ? 'repo' : 'dist', ref: 'develop', base: '', url: 'http://127.0.0.1:8780/', baseUrl: '', src: '', dist: OPT.dists[0] ? OPT.dists[0].name : '', baseDist: '', recipes: new Set(report ? [report.id] : []), profile: OPT.default_profile, llm: true, autofix: false, err: '' }
}
function nsBody () {
  const b = { kind: NS.kind, recipes: [...NS.recipes], widths: NS.profile, llm: NS.llm ? 'auto' : 'off', autofix: NS.autofix && NS.kind !== 'url' }
  if (NS.kind === 'repo') { const v = NS.ref.trim(); if (/^#?\d+$/.test(v)) b.pr = v.replace('#', ''); else b.ref = v; if (NS.base.trim() && !b.pr) b.base = NS.base.trim(); b.repo = OPT.repos[0] ? OPT.repos[0].name : 'cbh' }
  if (NS.kind === 'url') Object.assign(b, { url: NS.url, base_url: NS.baseUrl || undefined, src: NS.src || undefined })
  if (NS.kind === 'dist') Object.assign(b, { dist: NS.dist, base_dist: NS.baseDist || undefined })
  return b
}
function nsCommand () {
  const b = nsBody(); const a = ['node dqa/cli.js check']
  if (b.kind === 'repo') a.push(`--repo ${b.repo}`, b.pr ? `--pr ${b.pr}` : `--ref ${b.ref}`, ...(b.base ? [`--base ${b.base}`] : []))
  if (b.kind === 'url') a.push(`--url ${b.url}`, ...(b.base_url ? [`--base-url ${b.base_url}`] : []), ...(b.src ? [`--src ${b.src}`] : []))
  if (b.kind === 'dist') a.push(`--dist ${b.dist}`, ...(b.base_dist ? [`--base-dist ${b.base_dist}`] : []))
  a.push(`--recipe ${b.recipes.join(',') || '(화면)'}`, `--widths ${b.widths}`, ...(b.llm === 'off' ? ['--llm off'] : []))
  return a.join(' ') + (b.autofix ? '\nnode dqa/cli.js fix --run <실행 ID>' : '')
}
function nsSummary () {
  const target = NS.kind === 'repo' ? (NS.ref || '(브랜치)') : NS.kind === 'url' ? NS.url : NS.dist
  const base = NS.kind === 'repo' ? (/^#?\d+$/.test(NS.ref.trim()) ? 'PR 병합 전(자동)' : NS.base || '없음') : NS.kind === 'url' ? (NS.baseUrl || '없음') : (NS.baseDist || '없음')
  const prof = OPT.profiles.find((p) => p.name === NS.profile)
  const titles = OPT.recipes.filter((r) => NS.recipes.has(r.id)).map((r) => r.title)
  $('#sum').innerHTML = `<h2 class="h2">실행할 내용</h2>
    <dl class="sum"><dt>대상</dt><dd>${esc(target)}</dd><dt>비교 기준</dt><dd>${esc(base)}</dd><dt>화면</dt><dd>${esc(titles.join(', ') || '고르지 않음')}</dd><dt>크기</dt><dd>${prof ? `${prof.sizes.length}개(${esc(prof.sizes.join(', '))})` : ''}</dd><dt>예상 시간</dt><dd>${base === '없음' ? '약 20~30초' : '약 40초~1분'}${NS.llm ? ' + 문제 정의 약 40초' : ''}${NS.autofix && NS.kind !== 'url' ? ' + 수정 2~4분' : ''}</dd></dl>
    <div class="cmd">${esc(nsCommand())}</div>
    <p class="hint">측정 결과와 캡처는 이 컴퓨터에만 남습니다. 앱 밖으로 나가는 요청은 모두 막습니다.</p>`
}
function viewNew () {
  if (!NS) NS = nsInit()
  const st = NS
  const stepBtn = (n, label) => `<li><button type="button" data-step="${n}" class="${st.step === n ? 'on' : st.step > n ? 'done' : ''}" aria-current="${st.step === n ? 'step' : 'false'}"><span class="mono">${n}</span> ${label}</button></li>`
  const kinds = [['repo', '브랜치 · PR', '저장소에서 자동으로 빌드하고 변경 전과 비교'], ['url', '실행 중인 주소', '지금 띄워 둔 개발 서버를 바로 검사'], ['dist', '빌드 폴더', '이미 만든 웹 빌드를 검사']]
  const distOpts = (sel, withNone) => `${withNone ? '<option value="">없음</option>' : ''}${OPT.dists.map((d) => `<option value="${esc(d.name)}" ${sel === d.name ? 'selected' : ''}>${esc(d.name)} — ${esc(d.note)}</option>`).join('')}`
  const prof = OPT.profiles.find((p) => p.name === st.profile) || OPT.profiles[0]
  const step1 = `<fieldset><legend>무엇을 검사할까요?</legend>
    <div class="kinds">${kinds.map(([k, t, d]) => `<button type="button" data-kind="${k}" class="${st.kind === k ? 'on' : ''}" aria-pressed="${st.kind === k}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
    ${st.kind === 'repo' ? `<div class="grid2"><label class="field">검사할 브랜치·커밋 또는 PR 번호<input data-k="ref" type="text" value="${esc(st.ref)}" placeholder="develop 또는 #221"></label><label class="field">비교 기준(변경 전)<input data-k="base" type="text" value="${esc(st.base)}" placeholder="없음 또는 develop"></label></div>
      <p class="hint">PR 번호를 넣으면 병합 전과 PR 머리를 자동으로 빌드해 비교합니다. 같은 커밋은 다시 빌드하지 않습니다. 저장소: ${esc(OPT.repos.map((r) => r.title).join(', '))}</p>` : ''}
    ${st.kind === 'url' ? `<div class="grid2"><label class="field">실행 중인 주소<input data-k="url" type="url" value="${esc(st.url)}"></label><label class="field">비교 기준 주소(선택)<input data-k="baseUrl" type="url" value="${esc(st.baseUrl)}" placeholder="없음"></label></div>
      <label class="field">소스 폴더(선택, 원인 파일 찾기용)<input data-k="src" type="text" value="${esc(st.src)}" placeholder="/Users/.../my-app"></label>
      <p class="hint">localhost와 127.0.0.1만 받습니다. 사본을 만들 수 없어 코드 에이전트 수정은 하지 않습니다.</p>` : ''}
    ${st.kind === 'dist' ? `<div class="grid2"><label class="field">검사할 빌드<select data-k="dist">${distOpts(st.dist)}</select></label><label class="field">비교 기준(변경 전)<select data-k="baseDist">${distOpts(st.baseDist, true)}</select></label></div>` : ''}
  </fieldset>`
  const step2 = `<fieldset><legend>어느 화면을 볼까요?</legend>
    ${OPT.recipes.map((r) => `<label class="checkrow"><input type="checkbox" data-recipe="${esc(r.id)}" ${st.recipes.has(r.id) ? 'checked' : ''}><span style="flex:1;min-width:0"><b>${esc(r.title)}</b> <span class="muted small mono">${esc(r.id)}</span></span><span class="muted small">${esc(r.app)}</span></label>`).join('')}
    <p class="hint">화면에 들어가는 방법은 레시피에 적혀 있습니다. 새 화면은 <a href="#/recipes">화면 레시피</a>에서 확인하세요.</p></fieldset>`
  const step3 = `<fieldset><legend>어떤 크기로, 무엇까지 할까요?</legend>
    <div class="profiles" role="group" aria-label="크기 묶음">${OPT.profiles.map((p) => `<button type="button" data-prof="${esc(p.name)}" class="${st.profile === p.name ? 'on' : ''}" aria-pressed="${st.profile === p.name}">${esc(p.name)} · ${p.sizes.length}개</button>`).join('')}</div>
    <div class="sizes">${prof.sizes.map((s) => { const [w, h] = s.split('x').map(Number); const k = w > 800 ? 10 : 6; return `<figure><div class="ph" style="width:${Math.round(w / k)}px;height:${Math.round(h / k)}px"></div><figcaption>${esc(s.replace('x', '×'))}</figcaption></figure>` }).join('')}</div>
    <label class="optrow"><input type="checkbox" data-opt="llm" ${st.llm ? 'checked' : ''}><span><b>보고서 에이전트가 문제를 정의</b><br><span class="hint">결함마다 무엇이 문제인지, 원본은 어떠해야 하는지 씁니다. 로컬 모델 ${esc(OPT.model)}, 약 40초.</span></span></label>
    <label class="optrow ${st.kind === 'url' ? 'off' : ''}"><input type="checkbox" data-opt="autofix" ${st.autofix && st.kind !== 'url' ? 'checked' : ''} ${st.kind === 'url' ? 'disabled' : ''}><span><b>끝나면 코드 에이전트가 바로 고쳐 보기</b><br><span class="hint">수정마다 다시 빌드하고 재측정합니다. 2~4분. PR은 따로 확인을 받습니다.</span></span></label>
  </fieldset>`
  $('#app').innerHTML = `${topbar(null, '<a class="btn" href="#/">취소</a>')}
  <div class="wrap">
    <div><h1>새 검사</h1><p class="muted" style="margin:4px 0 0">무엇을, 어떤 화면을, 어떤 크기로 볼지 고르면 나머지는 dqa가 합니다.</p></div>
    <ol class="steps" aria-label="단계">${stepBtn(1, '대상')}${stepBtn(2, '화면')}${stepBtn(3, '크기 · 옵션')}</ol>
    <div class="split">
      <form class="card form" id="nf" novalidate>
        ${st.step === 1 ? step1 : st.step === 2 ? step2 : step3}
        <p class="err" id="nerr">${esc(st.err)}</p>
        <div class="formfoot"><button type="button" class="btn big" id="back" ${st.step === 1 ? 'disabled' : ''}>이전</button>${st.step < 3 ? '<button type="submit" class="btn primary big">다음</button>' : '<button type="submit" class="btn primary big">검사 시작</button>'}</div>
      </form>
      <aside class="card" id="sum" aria-label="실행할 내용"></aside>
    </div>
  </div>`
  nsSummary()
  $$('[data-step]').forEach((b) => { b.onclick = () => { NS.step = Number(b.dataset.step); NS.err = ''; viewNew() } })
  $$('[data-kind]').forEach((b) => { b.onclick = () => { NS.kind = b.dataset.kind; viewNew() } })
  $$('[data-k]').forEach((i) => { i.oninput = i.onchange = () => { NS[i.dataset.k] = i.value; nsSummary() } })
  $$('[data-recipe]').forEach((i) => { i.onchange = () => { if (i.checked) NS.recipes.add(i.dataset.recipe); else NS.recipes.delete(i.dataset.recipe); nsSummary() } })
  $$('[data-prof]').forEach((b) => { b.onclick = () => { NS.profile = b.dataset.prof; viewNew() } })
  $$('[data-opt]').forEach((i) => { i.onchange = () => { NS[i.dataset.opt] = i.checked; nsSummary() } })
  $('#back').onclick = () => { NS.step = Math.max(1, NS.step - 1); NS.err = ''; viewNew() }
  $('#nf').onsubmit = async (e) => {
    e.preventDefault()
    if (NS.step === 1 && NS.kind === 'repo' && !NS.ref.trim()) { NS.err = '브랜치나 PR 번호를 넣으세요'; return viewNew() }
    if (NS.step === 2 && !NS.recipes.size) { NS.err = '화면을 하나 이상 고르세요'; return viewNew() }
    if (NS.step < 3) { NS.step++; NS.err = ''; return viewNew() }
    try { const r = await api('/api/check', nsBody()); NS = null; location.hash = `#/runs/${r.run_id}` } catch (err) { NS.err = err.message; viewNew() }
  }
}

// ── 검토 ────────────────────────────────────────────────
const isAccepted = (d) => ACCEPT.some((a) => a.screen === d.screen && a.rule === d.rule && a.fps.some((f) => d.fps.includes(f)))
const stOf = (d) => (isAccepted(d) ? 'accepted' : d.diff ? d.diff.status : 'none')
const ORDER = { new: 0, worsened: 1, none: 2, improved: 3, unchanged: 4, accepted: 9 }
const SEV = { 높음: 0, 중간: 1, '사람 확인 필요': 2, 낮음: 3 }
const sizeKey = (s) => Array.isArray(s) ? s.join('x') : s

async function viewReview (id) {
  const [j, acc] = await Promise.all([api(`/api/runs/${id}`), api('/api/accept')])
  ACCEPT = acc
  const m = j.manifest
  if (!m) { $('#app').innerHTML = `${topbar()}<div class="empty">실행을 찾지 못했습니다.</div>`; return }
  if (j.running && m.status === 'running') {
    const ev = await api(`/api/runs/${id}/events`)
    $('#app').innerHTML = progressView(id, m.title, ev.events, 'check')
    $('#stop').onclick = async () => { if (confirm('검사를 중지할까요?')) await api('/api/stop', {}) }
    watch(id, () => viewReview(id), (events) => { const el = $('#ev'); if (el) { el.innerHTML = eventsHtml(events); el.scrollTop = 1e9 } })
    return
  }
  const defects = [...(j.defects || [])].sort((a, b) => (ORDER[stOf(a)] - ORDER[stOf(b)]) || ((SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9)) || b.max_px - a.max_px)
  const rv = RV[id] || (RV[id] = { sel: 0, mode: 'side', size: null, alpha: 50 })
  if (rv.sel >= defects.length) rv.sel = 0
  const cur = defects[rv.sel]
  const sizes = (m.sizes || []).map(sizeKey)
  if (cur && (!rv.size || !sizes.includes(rv.size))) { const first = sizes.find((s) => cur.widths.some((w) => `${w.w}x${w.h}` === s)); rv.size = first || sizes[0] }
  const live = defects.filter((d) => ['new', 'worsened', 'none'].includes(stOf(d)))
  const canFix = m.targets.head.kind !== 'url'
  const fixOf = (d) => j.fix && j.fix.items && j.fix.items.find((x) => x.defect_id === d.id)
  const header = `<div class="headrow"><a class="iconbtn" href="#/" aria-label="검사 기록으로">${ICON.back}</a><div style="min-width:0"><div style="font-weight:600">${esc(m.title)}</div><div class="muted small">크기 ${(m.sizes || []).length}개 · ${esc(dur(m.total_sec))} · 외부 요청 0건(막은 요청 ${esc(m.blocked_total || 0)}건) · ${m.llm && m.llm.status === 'ok' ? `보고서 에이전트 ${esc(m.llm.model)}` : '보고서 에이전트 사용 안 함'}</div></div></div>`
  const headRight = `<span class="mono small muted">결함 ${defects.length}건</span>${j.fix ? `<a class="btn" href="#/runs/${esc(id)}/fix">수정 · PR 보기</a>` : ''}${canFix && live.length && !j.running ? '<button class="btn primary" id="fixall">결함 모두 코드 에이전트에 맡기기</button>' : ''}`
  const banner = j.running ? `<div class="banner" role="status"><span id="bmsg">코드 에이전트가 수정하고 검증하는 중</span><a class="btn sm" href="#/runs/${esc(id)}/fix">진행 보기</a></div>` : ''
  if (!defects.length) {
    $('#app').innerHTML = `${topbar(header, headRight)}${banner}<div class="wrap"><div class="card pad stack"><h2 class="h2">결함이 없습니다</h2><p class="muted" style="margin:0">크기 ${(m.sizes || []).length}개에서 규칙에 걸린 것이 없습니다.${(j.diff.resolved || []).length ? ` 변경 전에 있던 결함 ${j.diff.resolved.length}건이 해결됐습니다.` : ''}</p></div>${moreHtml(id, j, m)}</div>`
    wireMore(j); return
  }
  const shotsFor = (side, d, size) => {
    const steps = (((j.shots || {})[side] || {})[d.screen] || {})[size] || []
    const wd = d.widths.find((w) => `${w.w}x${w.h}` === size)
    const k = wd ? wd.step || 0 : 0
    const s = steps[k] || steps[0] || {}
    return { clean: s.shot || (wd && side === 'head' ? wd.clean : null), marked: side === 'head' && wd ? (wd.shot || s.marked) : null }
  }
  const after = shotsFor('head', cur, rv.size); const before = j.shots && j.shots.base ? shotsFor('base', cur, rv.size) : {}
  const hasBase = !!(m.targets.base && before.clean)
  const afterSrc = after.marked || after.clean
  const fig = (cap, src, alt) => src ? `<figure><figcaption>${esc(cap)}</figcaption><button type="button" class="shotbox" data-zoom="${esc(file(id, src))}" aria-label="${esc(alt)} 크게 보기"><img src="${esc(file(id, src))}" alt="${esc(alt)}"></button></figure>` : `<figure><figcaption>${esc(cap)}</figcaption><div class="noshot">이 크기의 캡처가 없습니다</div></figure>`
  let stage
  if (rv.mode === 'side' || !hasBase) {
    stage = `${hasBase ? fig(`변경 전 · ${m.targets.base.ref}`, before.clean, '변경 전 화면') : (m.targets.base ? '' : '<figure><figcaption>변경 전</figcaption><div class="noshot">비교 기준 없이 검사했습니다</div></figure>')}${fig(`${hasBase ? '변경 후 · ' : ''}${m.targets.head.ref}${after.marked ? ' (결함 표시)' : ''}`, afterSrc, '변경 후 화면')}`
  } else if (rv.mode === 'overlay') {
    stage = `<figure><figcaption>변경 전 위에 변경 후를 겹침</figcaption><div class="shotbox" style="cursor:default"><img src="${esc(file(id, before.clean))}" alt="변경 전 화면"><div class="top" style="opacity:${rv.alpha / 100}"><img src="${esc(file(id, after.clean || afterSrc))}" alt="변경 후 화면"></div></div>
      <label class="slider">변경 전<input type="range" min="0" max="100" value="${rv.alpha}" id="alpha" aria-label="변경 후 투명도">변경 후</label></figure>`
  } else {
    stage = '<figure><figcaption>달라진 픽셀만 · <span id="diffpct">계산 중</span></figcaption><div class="shotbox" style="cursor:default"><canvas id="diffc" aria-label="달라진 부분"></canvas></div></figure>'
  }
  const hit = (s) => cur.widths.some((w) => `${w.w}x${w.h}` === s)
  const j0 = cur.judge || {}
  const basis = [cur.diff ? (cur.diff.status === 'new' ? '변경 전에는 이 결함이 없었음' : cur.diff.status === 'worsened' ? `변경 전에는 ${cur.diff.base_px}` : '변경 전에도 있었음') : null, `판정 기준 ${cur.rule}`, ...(cur.diag || []).map((g) => KNOW[g.code] ? `지식 ${KNOW[g.code]}` : null)].filter(Boolean)
  const fx = fixOf(cur)
  const fxChip = fx ? (fx.verified !== null ? '<span class="chip ok">검증된 수정 있음</span>' : fx.resolved_by_combined ? '<span class="chip ok">다른 수정과 함께 사라짐</span>' : fx.skipped ? '<span class="chip plain">고치지 않음</span>' : '<span class="chip warn">수정 못 함 · 사람 확인</span>') : ''
  $('#app').innerHTML = `${topbar(header, headRight)}${banner}
  <div class="review">
    <nav class="queue" aria-label="결함 대기열">
      <div class="qhead"><h2 class="h2">결함 ${defects.length}건</h2><span class="muted small">새로 생긴 것 먼저</span></div>
      ${defects.map((d, i) => `<button type="button" class="qitem ${i === rv.sel ? 'on' : ''}" data-sel="${i}" aria-current="${i === rv.sel}">
        <span class="meta"><span class="chip ${statusChip(stOf(d))}">${esc(STATUS[stOf(d)])}</span><span class="mono small muted">${esc(d.rule)} ${esc(d.rule_name)}</span></span>
        <b>${esc(d.labels.slice(0, 3).join(', '))}${d.labels.length > 3 ? ' 등' : ''}</b>
        <span class="muted small">${d.only_at ? `${esc(d.only_at.join(', '))}에서만` : `${d.widths.length}개 크기`} · ${esc(d.screen_title || d.screen)}</span>
      </button>`).join('')}
      <div class="keys" aria-label="단축키"><kbd>J / K</kbd><span>다음 · 이전 결함</span><kbd>1 2 3</kbd><span>나란히 · 겹쳐 · 차이만</span>${canFix ? '<kbd>F</kbd><span>코드 에이전트에 맡기기</span>' : ''}<kbd>I</kbd><span>의도된 디자인으로 무시</span></div>
    </nav>
    <section class="card viewer" aria-label="화면 비교">
      <div class="vtools">
        <div class="seg" role="group" aria-label="보기">${[['side', '나란히'], ['overlay', '겹쳐'], ['diff', '차이만']].map(([k, l]) => `<button type="button" data-mode="${k}" class="${rv.mode === k ? 'on' : ''}" ${k !== 'side' && !hasBase ? 'disabled title="비교 기준이 있어야 합니다"' : ''} aria-pressed="${rv.mode === k}">${l}</button>`).join('')}</div>
        <div class="sizetabs" role="group" aria-label="화면 크기">${sizes.map((s) => `<button type="button" data-size="${s}" class="${rv.size === s ? 'on' : ''}" aria-pressed="${rv.size === s}">${esc(s.replace('x', '×'))}${hit(s) ? '<span class="hit" aria-label="결함 있음"></span>' : ''}</button>`).join('')}</div>
      </div>
      <div class="stage">${stage}</div>
      <p class="legend">${after.marked ? '분홍 실선은 결함 요소, 검은 점선은 겹치거나 가린 요소입니다. ' : ''}${hit(rv.size) ? '' : '이 크기에서는 이 결함이 나오지 않았습니다. '}숫자는 모두 도구가 잰 값입니다. 그림을 누르면 크게 봅니다.</p>
    </section>
    <aside class="side" aria-label="문제 정의와 원인">
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 class="h2" style="font-size:15px">${esc(cur.rule)} ${esc(cur.rule_name)} · ${esc(cur.labels.slice(0, 3).join(', '))}</h2><span class="muted small" style="flex:0 0 auto">보고서 에이전트</span></div>
        ${j0.status === 'ok' ? `<div><div class="label">문제</div><p>${esc(j0.problem)}</p></div><div><div class="label">원본(기대)</div><p>${esc(j0.expected)}</p><p class="muted small">근거: ${esc(basis.join(' · '))}</p></div>`
          : `<div><div class="label">요약(규칙)</div><p>${esc(cur.rule_text ? `${cur.rule_text.cause} ${cur.rule_text.fix}` : '')}</p><p class="muted small">LLM 문제 정의 없음${j0.reason ? ` — ${esc(j0.reason)}` : ''} · 근거: ${esc(basis.join(' · '))}</p></div>`}
        <div class="pills">${j0.status === 'ok' ? `<span class="chip ${j0.verdict === '결함' ? 'warn' : 'plain'}" title="${esc(j0.reason)}">${esc(j0.verdict)}</span>` : ''}<span class="chip plain" title="${esc(((cur.confidence || {}).basis || []).join(', '))}">신뢰도 ${esc((cur.confidence || {}).level || '—')}</span>${cur.remeasured ? '<span class="chip plain">재측정 일치</span>' : ''}${fxChip}</div>
      </section>
      <section class="card"><h2 class="h2" style="font-size:13px">측정과 진단</h2>
        ${cur.widths.map((w) => `<div class="fact"><span class="id">${esc(`${w.w}×${w.h}`)}</span><span>${esc(w.text || '')}${w.canvas_px !== w.px && /px$/.test(w.metric || '') ? ` (시안 ${esc(w.canvas_px)}px)` : ''}</span></div>`).slice(0, 5).join('')}
        ${(cur.diag || []).map((g) => `<div class="fact"><span class="id">진단</span><span>${esc(g.text)}</span></div>`).join('')}
      </section>
      <section class="card"><h2 class="h2" style="font-size:13px">원인 후보</h2>
        ${((cur.causes || {}).candidates || []).map((c) => `<div class="cause"><div class="row"><code>${esc(c.file)}:${esc(c.line)}</code><button type="button" class="btn sm" data-copy="${esc(c.file)}:${esc(c.line)}" aria-label="${esc(c.file)} 경로 복사">복사</button></div><span class="muted small">${esc(c.why.join(' · '))}</span></div>`).join('') || `<p class="muted small">${esc((cur.causes || {}).note || '찾지 못했습니다')}</p>`}
      </section>
      <div class="actions">
        ${canFix ? (fx && (fx.verified !== null || fx.resolved_by_combined) ? `<a class="btn primary big" href="#/runs/${esc(id)}/fix">수정안과 PR 보기</a>` : `<button type="button" class="btn primary big" id="fixone" ${j.running || stOf(cur) === 'accepted' ? 'disabled' : ''}>결함 맞음 · 코드 에이전트에 맡기기</button>`) : '<p class="muted small" style="margin:0">로컬 주소 대상은 사본을 만들 수 없어 코드 에이전트 수정을 하지 않습니다. 원인 파일을 직접 고치세요.</p>'}
        <div class="two">${stOf(cur) === 'accepted' ? '<button type="button" class="btn big" id="unaccept">무시 해제</button>' : '<button type="button" class="btn big" id="accept">의도된 디자인 · 무시</button>'}<button type="button" class="btn big" id="nextd">다음 결함</button></div>
      </div>
    </aside>
  </div>
  <div class="more">${moreHtml(id, j, m)}</div>`

  const go = (i) => { rv.sel = (i + defects.length) % defects.length; rv.size = null; viewReview(id) }
  $$('[data-sel]').forEach((b) => { b.onclick = () => go(Number(b.dataset.sel)) })
  $$('[data-mode]').forEach((b) => { b.onclick = () => { rv.mode = b.dataset.mode; viewReview(id) } })
  $$('[data-size]').forEach((b) => { b.onclick = () => { rv.size = b.dataset.size; viewReview(id) } })
  $$('[data-zoom]').forEach((b) => { b.onclick = () => { const lb = $('#lightbox'); $('img', lb).src = b.dataset.zoom; lb.hidden = false } })
  $$('[data-copy]').forEach((b) => { b.onclick = () => copy(b.dataset.copy) })
  const al = $('#alpha'); if (al) al.oninput = () => { rv.alpha = Number(al.value); $('.top').style.opacity = rv.alpha / 100 }
  if (rv.mode === 'diff' && hasBase) drawDiff(file(id, before.clean), file(id, after.clean || afterSrc))
  const startFix = async (defect) => { try { await api('/api/fix', { run_id: id, defect, llm: m.llm && m.llm.mode === 'off' ? 'off' : 'auto' }); location.hash = `#/runs/${id}/fix` } catch (err) { toast(err.message) } }
  if ($('#fixall')) $('#fixall').onclick = () => startFix(null)
  if ($('#fixone')) $('#fixone').onclick = () => startFix(cur.id)
  const ignore = async () => { const note = prompt('무시하는 이유(예: 의도된 디자인, 오탐). 다음 검사부터 이 결함은 접힙니다.', '의도된 디자인'); if (note === null) return; await api('/api/accept', { run_id: id, defect_id: cur.id, note }); go(rv.sel + 1) }
  if ($('#accept')) $('#accept').onclick = ignore
  if ($('#unaccept')) $('#unaccept').onclick = async () => { await api('/api/unaccept', { run_id: id, defect_id: cur.id }); viewReview(id) }
  $('#nextd').onclick = () => go(rv.sel + 1)
  wireMore(j)
  document.onkeydown = (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName) || e.metaKey || e.ctrlKey || !$('#lightbox').hidden) return
    const k = e.key.toLowerCase()
    if (k === 'j') go(rv.sel + 1); else if (k === 'k') go(rv.sel - 1)
    else if (k === '1' || ((k === '2' || k === '3') && hasBase)) { rv.mode = { 1: 'side', 2: 'overlay', 3: 'diff' }[k]; viewReview(id) }
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
    <details class="card"><summary>보고서 파일 · PR 댓글 초안</summary><div class="stack"><div class="pills"><a class="btn sm" href="${esc(file(id, 'report.html'))}" target="_blank" rel="noopener">보고서(HTML)</a><a class="btn sm" href="${esc(file(id, 'report.md'))}" target="_blank" rel="noopener">보고서(MD)</a><button class="btn sm" type="button" id="copypc">PR 댓글 초안 복사</button></div><textarea class="copy" readonly aria-label="PR 댓글 초안">${esc(j.pr_comment)}</textarea><p class="hint">PR 댓글은 자동으로 올리지 않습니다.</p></div></details>`
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
const FIXSEL = {}
const kindOf = (txt) => /남음|악화|실패|생김|되돌/.test(txt) ? 'warn' : /통과|사라짐|사라졌/.test(txt) ? 'ok' : 'plain'
async function viewFix (id) {
  const j = await api(`/api/runs/${id}`)
  const m = j.manifest
  if (!m) { $('#app').innerHTML = `${topbar()}<div class="empty">실행을 찾지 못했습니다.</div>`; return }
  const f = j.fix; const s = (f && f.summary) || {}
  const header = `<div class="headrow"><a class="iconbtn" href="#/runs/${esc(id)}" aria-label="검토로 돌아가기">${ICON.back}</a><div style="min-width:0"><div style="font-weight:600">수정 · PR — ${esc(m.title)}</div><div class="muted small">수정은 모두 평가용 사본에서 다시 빌드하고 재측정해 검증합니다. 원본 소스와 작업본은 바꾸지 않습니다.</div></div></div>`
  const right = f && f.summary ? `<span class="chip ok">검증된 수정 ${s.verified}개</span>${f.combined ? `<span class="chip ok">함께 적용 시 ${s.combined_fixed}건 사라짐</span><span class="chip plain">다른 결함 생김 ${s.combined_regress}건</span>` : ''}` : ''
  if (j.running) {
    const ev = await api(`/api/runs/${id}/events`)
    const mine = (ev.events || []).filter((e) => e.stage === 'fix' || e.stage === 'pr')
    $('#app').innerHTML = progressView(id, `수정 · PR — ${m.title}`, mine, 'fix')
    $('#stop').onclick = async () => { if (confirm('작업을 중지할까요?')) await api('/api/stop', {}) }
    watch(id, () => viewFix(id), (events) => { const el = $('#ev'); if (el) { el.innerHTML = eventsHtml(events.filter((e) => e.stage === 'fix' || e.stage === 'pr')); el.scrollTop = 1e9 } })
    return
  }
  if (!f || !f.items) {
    const canFix = m.targets.head.kind !== 'url'
    $('#app').innerHTML = `${topbar(header, '')}<div class="wrap"><div class="card pad stack"><h2 class="h2">아직 수정안을 만들지 않았습니다</h2>
      <p class="muted" style="margin:0">코드 에이전트가 보고서 에이전트의 문제 정의서를 받아 규칙 수정안부터 해 보고, 안 되면 코드를 읽고·찾고·고쳐 봅니다. 수정마다 사본에서 다시 빌드하고 같은 크기로 재서, 결함이 사라지고 다른 결함이 생기지 않은 것만 남깁니다. 2~4분 걸립니다.</p>
      ${canFix ? '<div><button class="btn primary big" id="startfix">수정안 만들고 검증</button></div>' : '<p class="err">로컬 주소 대상은 사본을 만들 수 없어 수정하지 않습니다.</p>'}</div></div>`
    if ($('#startfix')) $('#startfix').onclick = async () => { try { await api('/api/fix', { run_id: id, llm: m.llm && m.llm.mode === 'off' ? 'off' : 'auto' }); viewFix(id) } catch (err) { toast(err.message) } }
    return
  }
  const items = f.items
  const sel = Math.min(FIXSEL[id] || 0, Math.max(0, items.length - 1))
  const it = items[sel] || { attempts: [], trail: [], labels: [] }
  const d = (j.defects || []).find((x) => x.id === it.defect_id) || { widths: [] }
  const resultOf = (x) => x.skipped ? ['plain', '고치지 않음'] : x.verified !== null ? ['ok', '검증됨'] : x.resolved_by_combined ? ['ok', '함께 사라짐'] : ['warn', '사람 확인']
  const afterList = (f.combined && f.combined.after) || []
  const unit = (w) => w.metric === 'lines' ? '줄' : w.metric === 'height_ratio' ? '배' : 'px'
  const afterOf = (w) => {
    if (!f.combined) return '—'
    const a = afterList.find((x) => x.id === d.id)
    const zero = w.metric === 'lines' ? '1줄' : '0px'
    if (!a) return zero
    const hitw = (a.widths || []).find((sz) => sz.startsWith(`${w.w}x${w.h}:`))
    return hitw ? `${hitw.split(':')[1]}${unit(w)}` : zero
  }
  const patch = (j.fix_patch || '').split('\n').map((l) => l.startsWith('+') && !l.startsWith('+++') ? `<span class="add">${esc(l)}</span>` : l.startsWith('-') && !l.startsWith('---') ? `<span class="del">${esc(l)}</span>` : l.startsWith('@@') ? `<span class="hunk">${esc(l)}</span>` : esc(l)).join('\n')
  const pr = j.pr
  const isRepo = m.targets.head.kind === 'repo'
  const checks = pr ? [['수정 브랜치 만들기', pr.branch, true], ['패치 적용', '검증된 수정 전부', !!pr.commit], ...(pr.checks || []).map((k) => [k.name, k.ok ? '통과' : k.note, k.ok]), ['커밋', pr.commit ? `${pr.commit.slice(0, 8)} · ${pr.title || ''}` : '아직', !!pr.commit]] : []
  const ready = !!(pr && pr.commit && (pr.checks || []).every((k) => k.ok) && !pr.pushed)
  $('#app').innerHTML = `${topbar(header, right)}
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
        ${d.widths.map((w) => `<tr><td class="mono">${esc(`${w.w}×${w.h}`)}</td><td class="mono" style="color:var(--new-ink)">${esc(w.px)}${unit(w)}</td><td class="mono" style="color:var(--ok-ink);font-weight:600">${esc(afterOf(w))}</td><td class="muted">${f.combined && (f.combined.regress || []).length ? esc(f.combined.regress.map((g) => `${g.rule} ${g.labels.join('·')}`).join(', ')) : '없음'}</td></tr>`).join('')}
        </tbody></table></div></section>
      <section class="card pad stack">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 class="h2">패치</h2><div class="pills">${j.fix_patch ? `<button class="btn sm" type="button" id="copypatch">복사</button><a class="btn sm" href="${esc(file(id, 'fix/fix_all.patch'))}" download>내려받기</a>` : ''}<a class="btn sm" href="${esc(file(id, 'fix/fix_report.md'))}" target="_blank" rel="noopener">수정 보고서</a></div></div>
        ${j.fix_patch ? `<pre class="patch">${patch}</pre><p class="hint">직접 적용할 때: <code>git apply fix_all.patch</code></p>` : '<p class="muted" style="margin:0">검증을 통과한 수정이 없습니다.</p>'}
      </section>
    </main>
    <aside class="prside" aria-labelledby="pr-h">
      <section class="card pad stack">
        <h2 id="pr-h" class="h2" style="font-size:15px">초안 PR</h2>
        ${!isRepo ? '<p class="muted" style="margin:0">빌드 이름으로 검사한 실행이라 어느 브랜치로 보낼지 모릅니다. 패치를 내려받아 적용하거나, 브랜치·PR로 다시 검사하세요.</p>' : !j.fix_patch ? '<p class="muted" style="margin:0">검증된 수정이 있어야 PR을 준비할 수 있습니다.</p>' : `
          ${pr ? `<ol class="checklist">${checks.map(([l, n, ok]) => `<li><span class="mark ${ok ? 'ok' : 'bad'}" aria-hidden="true">${ok ? '✓' : '!'}</span><span><span style="font-weight:500">${esc(l)}</span><span class="muted small" style="display:block">${esc(n)}</span></span></li>`).join('')}</ol>` : '<p class="muted" style="margin:0">독립 클론 안에 수정 브랜치를 만들고, 패치를 적용하고, 타입 검사·테스트를 돌린 뒤 커밋합니다. 아직 아무것도 올리지 않습니다.</p>'}
          <label class="field">PR이 향할 브랜치<input id="onto" type="text" value="${esc((pr && pr.base) || (m.build && m.build.ref_name) || '')}" placeholder="예: develop"></label>
          <button class="btn big" type="button" id="prep">${pr ? 'PR 다시 준비' : 'PR 준비(로컬)'}</button>
          ${j.pr_body ? `<details><summary class="muted">PR 본문 미리 보기(팀 PR 양식)</summary><textarea class="copy" readonly aria-label="PR 본문">${esc(j.pr_body)}</textarea></details>` : ''}`}
      </section>
      ${isRepo && pr && pr.commit ? (pr.pushed ? `<section class="confirm done"><h2 class="h2">초안 PR을 올렸습니다</h2><p style="margin:0">${esc(pr.branch)} → ${esc(pr.base)}${pr.url ? ` · <a href="${esc(pr.url)}" target="_blank" rel="noopener">${esc(pr.url)}</a>` : ''}</p><p class="small" style="margin:0">리뷰어 지정과 병합은 팀 규칙대로 직접 합니다.</p></section>`
        : `<section class="confirm"><h2 class="h2">팀 저장소에 올리기</h2><p style="margin:0;font-size:13px;color:var(--ink-2)">수정 브랜치를 올리고 초안 PR을 만듭니다. 병합은 하지 않습니다. 진행하려면 아래 칸에 <b>PR 올리기</b>를 그대로 입력하세요.</p>
          <label class="field" style="font-size:13px">확인 문구<input id="confirmtxt" type="text" placeholder="PR 올리기" autocomplete="off"></label>
          <button class="btn primary big" type="button" id="push" disabled>초안 PR 올리기</button>${ready ? '' : '<p class="err">프로젝트 검사가 실패해 올릴 수 없습니다.</p>'}</section>`) : ''}
    </aside>
  </div>`
  $$('[data-tab]').forEach((b) => { b.onclick = () => { FIXSEL[id] = Number(b.dataset.tab); viewFix(id) } })
  if ($('#copypatch')) $('#copypatch').onclick = () => copy(j.fix_patch)
  if ($('#prep')) $('#prep').onclick = async () => { try { await api('/api/pr', { run_id: id, onto: $('#onto').value.trim() || undefined }); viewFix(id) } catch (err) { toast(err.message) } }
  const ct = $('#confirmtxt'); const pb = $('#push')
  if (ct && pb) {
    ct.oninput = () => { pb.disabled = !(ready && ct.value.trim() === 'PR 올리기') }
    pb.onclick = async () => { try { await api('/api/pr', { run_id: id, onto: $('#onto').value.trim() || undefined, push: true, confirm: ct.value.trim() }); viewFix(id) } catch (err) { toast(err.message) } }
  }
}

// ── 라우터 ──────────────────────────────────────────────
async function route () {
  clearInterval(timer); document.onkeydown = null
  const h = location.hash || '#/'
  let m
  try {
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
