// dqa serve: 로컬 웹 화면 + API(127.0.0.1에서만 연다).
// 웹 화면: 검사 시작 · 진행 상황 · 실행 목록 · 보고서 · 결함 분류(무시). Dify용: POST /check(빠른 모드, 동기), GET /openapi.json.
// 안전장치: 대상은 설정의 빌드 이름·로컬 주소·레시피만, 검사는 한 번에 하나, 브라우저 요청은 X-DQA 머리글 필수(다른 사이트가 몰래 부르지 못하게).
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { RUNS, DQA, readJSON, writeJSON, stamp, assertAllowedPath } = require('../core/util')
const { resolveDesign } = require('../core/design')
const { listRecipes } = require('../recipes/runner')
const { addAccept, removeAccept, loadAccept } = require('../diff/compare')
const { checks } = require('../ops/doctor')

const figmaConnection = require('../design/connection').createFigmaConnection()
const UI = path.join(DQA, 'ui')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json; charset=utf-8' }
let webJob = null
const { randomUUID } = require('crypto')
const { startPipeline } = require('../dify/pipeline')
const { stopChild } = require('./process')
let current = null // { id, child, started }
const lastExit = new Map() // 작업 ID → { code, kind, error }. Dify 응답이 실패를 성공으로 말하지 않게 종료 코드를 남긴다

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)) }
const sendFile = (res, file) => {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { ok: false, error: '없는 파일' })
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}
const safeRunDir = (id) => { if (!/^[\w.-]+$/.test(id || '')) return null; const d = path.join(RUNS, id); return fs.existsSync(d) ? d : null }
// 시안을 붙이기 전에 돌린 실행: 열 때 한 번 시안을 찾아 붙인다(빌드 폴더·작업 폴더 기준). 못 찾으면 null로 적어 다시 찾지 않는다
function attachDesign (dir, cfg) {
  const f = path.join(dir, 'manifest.json')
  const m = readJSON(f, null)
  if (!m || 'design' in m || m.status === 'running') return m
  const h = (m.targets && m.targets.head) || {}
  const t = { head: { dir: h.dist || null }, local: m.local || null }
  const run = { file: (p) => path.join(dir, p) }
  try { m.design = resolveDesign({}, t, m.recipes || [], run, cfg) } catch (e) { m.design = null }
  writeJSON(f, m)
  return m
}
const readBody = (req, limit = 20000) => new Promise((resolve, reject) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > limit) { reject(new Error('본문이 너무 크다')); req.destroy() } }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}) } catch (e) { reject(new Error('JSON이 아니다')) } }) })
// Figma 플러그인 창(출처 null)만 시안을 보낼 수 있게 CORS를 연다. 다른 웹사이트(실제 출처가 있음)는 막힌다
const figmaCors = (req, res) => { if (req.headers.origin === 'null') { res.setHeader('Access-Control-Allow-Origin', 'null'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DQA'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS') } }

function runSummary (id) {
  const d = path.join(RUNS, id)
  const m = readJSON(path.join(d, 'manifest.json'), null)
  if (!m) return null
  const fx = readJSON(path.join(d, 'fix', 'fixes.json'), null)
  const t = m.targets || {}; const pipeline = readJSON(path.join(d, 'pipeline.json'), null)
  return { id, title: m.title, status: (current && current.id === id) || (webJob && webJob.id === id) ? 'running' : m.status, job: current && current.id === id ? current.kind : null, started_at: m.started_at, total_sec: pipeline && pipeline.total_sec != null ? pipeline.total_sec : m.total_sec, exit_code: m.exit_code, summary: m.summary || null,
    head: t.head && t.head.ref, head_note: t.head && t.head.note, kind: t.head && t.head.kind, base: t.base && t.base.ref, base_note: t.base && t.base.note, llm: m.llm && m.llm.status,
    screens: (m.recipes || []).map((r) => r.title), sizes: (m.sizes || []).length, blocked: m.blocked_total || 0, command: m.command, overview: m.overview ? m.overview.text : null, fix: fx && fx.summary ? fx.summary : null }
}

function listRuns () {
  if (!fs.existsSync(RUNS)) return []
  return fs.readdirSync(RUNS).filter((n) => fs.existsSync(path.join(RUNS, n, 'manifest.json')) && !n.includes('recipe-test')).sort().reverse().slice(0, 60).map(runSummary).filter(Boolean)
}

// 검사 요청을 CLI 인자로 바꾼다. 허용 목록 밖의 값은 거부한다.
function toArgs (body, cfg) {
  const a = ['check']
  const recipes = (body.recipes || []).filter(Boolean)
  const known = new Set(listRecipes().map((r) => r.id))
  // 작업 폴더는 화면을 안 고르면 폴더의 .dqa.json 기본 화면(없으면 첫 화면)을 쓴다
  if ((!recipes.length && body.kind !== 'local') || !recipes.every((r) => known.has(r))) throw new Error('화면 레시피를 하나 이상 골라야 한다(목록에 있는 것만)')
  require('./local-selection').validateScope(recipes, body.kind === 'local' ? body.local : null)
  if (recipes.length) a.push('--recipe', recipes.join(','))
  if (body.kind === 'dist') {
    if (!cfg.dists[body.dist]) throw new Error('목록에 있는 빌드만 고를 수 있다')
    a.push('--dist', body.dist)
    if (body.base_dist) { if (!cfg.dists[body.base_dist]) throw new Error('비교 기준 빌드가 목록에 없다'); a.push('--base-dist', body.base_dist) }
  } else if (body.kind === 'url') {
    const u = new URL(String(body.url || ''))
    if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('로컬 주소(127.0.0.1, localhost)만 검사한다')
    a.push('--url', u.href)
    if (body.base_url) { const b = new URL(String(body.base_url)); if (!['127.0.0.1', 'localhost'].includes(b.hostname)) throw new Error('비교 기준도 로컬 주소만'); a.push('--base-url', b.href) }
    if (body.src) a.push('--src', String(body.src))
  } else if (body.kind === 'repo') {
    if (!cfg.repos[body.repo]) throw new Error('설정에 없는 저장소')
    a.push('--repo', body.repo)
    if (body.pr) { if (!/^\d+$/.test(String(body.pr))) throw new Error('PR 번호는 숫자'); a.push('--pr', String(body.pr)) } else if (body.ref) { if (!/^[\w./-]{1,80}$/.test(body.ref)) throw new Error('ref 형식이 이상하다'); a.push('--ref', body.ref) } else throw new Error('PR 번호나 ref가 필요하다')
    if (body.base) { if (!/^[\w./-]{1,80}$/.test(body.base)) throw new Error('base 형식이 이상하다'); a.push('--base', body.base) }
  } else if (body.kind === 'local') {
    const dir = assertAllowedPath(String(body.local || '').trim(), cfg)
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('작업 폴더가 없다')
    a.push('--local', dir)
    const base = String(body.base || 'HEAD')
    if (base !== 'HEAD') { if (base !== 'none' && !/^[\w./-]{1,80}$/.test(base)) throw new Error('비교 기준 형식이 이상하다'); a.push('--base', base) }
  } else throw new Error('대상 종류는 local, dist, url, repo 중 하나')
  // 시안: 시안 목록의 이름 하나(모든 화면) 또는 화면별 {화면: 이름}
  if (body.design) {
    const names = new Set(require('../design/library').list().map((x) => x.name))
    const map = typeof body.design === 'string' ? { '': body.design } : body.design
    for (const v of Object.values(map)) if (!names.has(v)) throw new Error(`시안 목록에 없는 시안: ${v}`)
    for (const k of Object.keys(map)) if (k && !/^[\w./-]{1,80}$/.test(k)) throw new Error('화면 이름 형식이 이상하다')
    a.push('--design', typeof body.design === 'string' ? body.design : Object.entries(map).map(([k, v]) => `${k}=${v}`).join(','))
  }
  const w = String(body.widths || '')
  if (w) { if (!cfg.profiles[w] && !/^(\d{3,4}x\d{3,4})(,\d{3,4}x\d{3,4}){0,7}$/.test(w)) throw new Error('크기는 프로필 이름이나 375x812,390x844 형식'); a.push('--widths', w) }
  if (typeof body.design === 'string') { const design = require('../design/library').list().find(d => d.name === body.design); if (design && design.frame) a.push('--title', design.frame + ' 검수') }
  a.push('--llm', body.llm === 'off' ? 'off' : 'auto')
  if (body.interact === true || body.interact === 'on') a.push('--interact')
  return a
}

// 작업 하나를 자식 프로세스로 돌린다. next(id)가 있으면 끝난 뒤 같은 실행 ID로 이어서 돌린다(검사 → 자동 수정)
function startCheck (args, existingId, next, reservedId) {
  if (webJob && webJob.id !== reservedId) throw Object.assign(new Error('Dify 검사가 진행 중입니다. 완료하거나 중지한 뒤 시작하세요'), { code: 409 })
  if (current) throw Object.assign(new Error(`이미 작업이 돌고 있다(${current.id}). 끝난 뒤에 시작한다`), { code: 409 })
  const id = existingId || reservedId || `${stamp()}_ui`
  const child = spawn(process.execPath, [path.join(DQA, 'cli.js'), ...args, ...(existingId ? [] : ['--run-id', id])], { cwd: DQA, env: { ...process.env, DQA_QUIET: '1' }, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''
  child.stderr.on('data', (c) => { err += c })
  current = { id, child, started: Date.now(), kind: args[0] }
  // 기존 실행에 붙는 작업(수정·PR)이 실패하면 이유를 실행 폴더에 남긴다. 화면이 이것을 보여 준다(남기지 않으면 버튼이 아무 일도 안 한 것처럼 보인다)
  const errFile = path.join(RUNS, id, 'task_error.json')
  if (existingId) fs.rmSync(errFile, { force: true })
  child.on('exit', (code) => {
    const msg = err.split('\n').map((l) => l.replace(/^dqa 실패:\s*/, '').trim()).filter(Boolean).slice(-3).join(' ') || `종료 코드 ${code}`
    lastExit.set(id, { code, kind: args[0], error: code === 2 ? msg.slice(0, 600) : null })
    if (existingId && code !== 0 && !(args[0] === 'fix' && code === 1) && fs.existsSync(path.join(RUNS, id))) fs.writeFileSync(errFile, JSON.stringify({ kind: args[0], error: msg.slice(0, 600), code, at: new Date().toISOString() }))
    if (code === 2 && !fs.existsSync(path.join(RUNS, id, 'manifest.json'))) { fs.mkdirSync(path.join(RUNS, id), { recursive: true }); fs.writeFileSync(path.join(RUNS, id, 'manifest.json'), JSON.stringify({ run_id: id, title: '실행 실패', status: 'error', error: err.slice(0, 500), started_at: new Date().toISOString() })) }
    if (code === 2 && args[0] === 'check' && fs.existsSync(path.join(RUNS, id, 'manifest.json'))) { const m = readJSON(path.join(RUNS, id, 'manifest.json'), {}); if (m.status === 'running') { m.status = 'error'; m.exit_code = 2; m.error = msg.slice(0, 600); writeJSON(path.join(RUNS, id, 'manifest.json'), m) } }
    current = null
    if (code === null && fs.existsSync(path.join(RUNS, id))) { const m = readJSON(path.join(RUNS, id, 'manifest.json'), {}); if (m.status === 'running') { m.status = 'cancelled'; m.exit_code = 2; m.error = '사용자가 검사를 중지했습니다'; writeJSON(path.join(RUNS, id, 'manifest.json'), m) } }
    if (next && code !== null && code !== 2 && fs.existsSync(path.join(RUNS, id, 'defects.json'))) { try { startCheck(next(id), id) } catch (e) {} }
  })
  return id
}

// Dify용 빠른 검사: 한 화면, 크기 5개 이하, LLM 없이, 끝날 때까지 기다려 요약을 돌려준다
async function difyCheck (body, cfg) {
  try {
    if (!cfg.dists[body.dist]) throw new Error(`dist는 ${Object.keys(cfg.dists).join(', ')} 중 하나여야 한다`)
    if (body.base_dist && !cfg.dists[body.base_dist]) throw new Error('비교 기준 빌드가 목록에 없다')
    const args = toArgs({ kind: 'dist', dist: body.dist, base_dist: body.base_dist, recipes: [body.recipe], widths: 'mobile5', llm: 'off' }, cfg)
    const r = await startAndWait(args, null, 50000)
    const summary = readJSON(path.join(RUNS, r.id, 'summary.json'), null)
    if (r.done && (!summary || r.code === 2)) return { ok: false, error_type: 'incomplete', run_id: r.id, message: r.error || '검사가 일부 실패했다. 실패를 해결한 뒤 다시 검사한다', ...(summary || {}) }
    return { ok: true, ...(summary || {}), run_id: r.id, running: !r.done, note: r.done ? '검사 끝' : '진행 중. 상태 작업으로 결과를 확인한다', report_url: `http://127.0.0.1:${cfg.serve.port}/#/runs/${r.id}` }
  } catch (e) { return { ok: false, error_type: e.code === 409 ? 'busy' : 'invalid_argument', message: e.message } }
}

const { CONFIRM } = require('../fix/pr')
function prArgs (body) {
  if (!safeRunDir(body.run_id)) throw new Error('없는 실행')
  const a = ['pr', '--run', body.run_id]
  if (body.onto) { if (!/^[\w./-]{1,80}$/.test(body.onto)) throw new Error('브랜치 이름 형식이 이상하다'); a.push('--onto', body.onto) }
  if (body.push) { if (body.confirm !== CONFIRM) throw new Error(`올리려면 확인 문구 "${CONFIRM}"가 필요하다`); a.push('--push', '--confirm', CONFIRM) }
  return a
}

// 작업을 시작하고 최대 waitMs까지 기다린다. 그 안에 끝나지 않으면 "진행 중"으로 돌려준다(Dify 도구 제한 60초)
function startAndWait (args, existingId, waitMs, reservedId) {
  return new Promise((resolve, reject) => {
    let id
    try { id = startCheck(args, existingId, null, reservedId) } catch (e) { return reject(e) }
    const t0 = Date.now()
    lastExit.delete(id)
    const timer = setInterval(() => { if (current && current.id === id && Date.now() - t0 < waitMs) return; clearInterval(timer); const done = !(current && current.id === id); const ex = done ? lastExit.get(id) : null; resolve({ id, done, code: ex ? ex.code : null, error: ex ? ex.error : null }) }, 1000)
  })
}

function runStatus (id, cfg) {
  const dir = safeRunDir(id)
  if (!dir) return { ok: false, error_type: 'not_found', message: `없는 실행: ${id}` }
  const s = readJSON(path.join(dir, 'summary.json'), null)
  const fx = readJSON(path.join(dir, 'fix', 'fixes.json'), null)
  const pr = readJSON(path.join(dir, 'fix', 'pr.json'), null)
  const m = readJSON(path.join(dir, 'manifest.json'), {})
  const briefs = readJSON(path.join(dir, 'defects.json'), []).filter((d) => d.brief && !d.accepted && (!d.diff || ['new', 'worsened'].includes(d.diff.status))).slice(0, 5).map((d) => d.brief.slice(0, 700))
  const ap = readJSON(path.join(dir, 'fix', 'apply.json'), null)
  return { ok: !(s && s.exit_code === 2), ...(s && s.exit_code === 2 ? { error_type: 'incomplete', message: '검사가 일부 실패했다. 실패를 해결한 뒤 다시 검사한다' } : {}), run_id: id, running: !!(current && current.id === id), check: s ? { status: m.status, exit_code: s.exit_code, summary: s.summary, defects: s.defects } : null, design: m.design_summary || null, interact: m.interact_summary || null, briefs, applied: ap ? { label: ap.label, files: ap.files.map((f) => f.file), undone: !!ap.undone } : null, fix: fx ? { summary: fx.summary || null, items: fx.items.map((x) => ({ rule: x.rule, labels: x.labels, verified: x.verified !== null, together: !!x.resolved_by_combined, skipped: x.skipped || null })) } : null, pr: pr ? { branch: pr.branch, base: pr.base, commit: pr.commit || null, checks: pr.checks, pushed: pr.pushed, url: pr.url || null } : null, view_url: `http://127.0.0.1:${cfg.serve.port}/#/runs/${id}` }
}

// 가장 최근에 끝난 검사(Dify에서 run_id를 비웠을 때). 웹 화면·Dify에서 시작한 실행(_ui)만 고른다(평가·명령줄 실행과 섞이지 않게).
// 적용·되돌리기는 작업 폴더 실행만
function latestRun (localOnly) {
  if (!fs.existsSync(RUNS)) return null
  const xs = fs.readdirSync(RUNS).filter((n) => /_ui$/.test(n)).map((n) => ({ n, f: path.join(RUNS, n, 'summary.json') })).filter((x) => fs.existsSync(x.f))
    .filter((x) => !localOnly || readJSON(path.join(RUNS, x.n, 'manifest.json'), {}).local).map((x) => ({ n: x.n, t: fs.statSync(x.f).mtimeMs }))
  return xs.length ? xs.sort((a, b) => b.t - a.t)[0].n : null
}

async function difyAct (body, cfg) {
  try {
    const action = String(body.action || '')
    if (body.ui_request) {
      const job = webJob
      if (!job || job.token !== body.ui_request || job.pipeline.state.state !== 'running') throw new Error('중지됐거나 만료된 웹 검사 요청입니다')
      if (action === '수정 시작' && job.kind === 'fix') {
        if (job.started) throw new Error('이미 시작된 수정 요청입니다')
        job.started = true
        await startAndWait(job.args, job.id, 3000, job.id)
        return { ...runStatus(job.id, cfg), report_enabled: false }
      }
      if (action === '검사') {
        if (job.started) throw new Error('이미 시작된 검사 요청입니다')
        job.started = true
        const r = await startAndWait(job.args, null, 50000, job.id)
        return { ...runStatus(job.id, cfg), report_enabled: job.body.llm !== 'off', note: r.done ? '화면 측정 완료' : '화면 측정 진행 중' }
      }
      if (action === '상태') return { ...runStatus(job.id, cfg), report_enabled: job.body.llm !== 'off' }
      throw new Error('웹 요청에 허용되지 않은 작업입니다')
    }
    if (action === '시안 목록') return { ok: true, designs: require('../design/library').list().map((d) => ({ name: d.name, frame: d.frame, base: d.base, source: d.source, saved_at: d.saved_at })) }
    if (action === '검사') {
      const known = new Set(listRecipes().map((r) => r.id))
      if (!(body.local && !body.recipe) && !known.has(body.recipe)) throw new Error(`recipe는 ${[...known].join(', ')} 중 하나`)
      if (body.design && !require('../design/library').list().some((d) => d.name === body.design)) throw new Error(`시안 목록에 없는 시안: ${body.design}("시안 목록"으로 이름 확인)`)
      const design = [...(body.design ? ['--design', body.design] : []), ...(body.interact === 'on' ? ['--interact'] : [])]
      let args
      if (body.local) {
        if (body.base && body.base !== 'none' && !/^[\w./-]{1,80}$/.test(body.base)) throw new Error('비교 기준 형식이 이상하다')
        // 작업 폴더: 읽기만 하고 사본에서 빌드, 커밋 전(HEAD)과 비교
        const dir = assertAllowedPath(String(body.local).trim(), cfg)
        if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('작업 폴더가 없다')
        args = ['check', '--local', dir, ...(body.base ? ['--base', String(body.base)] : []), ...(body.recipe ? ['--recipe', body.recipe] : []), ...design, '--widths', 'mobile5', '--llm', body.llm === 'on' ? 'auto' : 'off']
      } else if (body.ref) {
        if (!/^[\w./-]{1,80}$/.test(body.ref) || (body.base && !/^[\w./-]{1,80}$/.test(body.base))) throw new Error('ref·base 형식이 이상하다')
        args = ['check', '--repo', 'cbh', '--ref', body.ref, ...(body.base ? ['--base', body.base] : []), '--recipe', body.recipe, ...design, '--widths', 'mobile5', '--llm', body.llm === 'on' ? 'auto' : 'off']
      } else {
        if (!cfg.dists[body.dist]) throw new Error(`dist는 ${Object.keys(cfg.dists).join(', ')} 중 하나이거나 ref를 준다`)
        args = ['check', '--dist', body.dist, ...(body.base_dist && cfg.dists[body.base_dist] ? ['--base-dist', body.base_dist] : []), '--recipe', body.recipe, ...design, '--widths', 'mobile5', '--llm', body.llm === 'on' ? 'auto' : 'off']
      }
      const r = await startAndWait(args, null, 50000)
      if (r.code === 2) return { ok: false, error_type: 'failed', run_id: r.id, message: `검사 실패: ${r.error}` }
      return { ...runStatus(r.id, cfg), note: r.done ? '검사 끝' : '아직 진행 중. "상태"로 다시 확인한다' }
    }
    // run_id를 비우면 가장 최근 검사로 한다(단계마다 복사해 넣지 않아도 되게). 쓴 run_id는 답에 그대로 나온다
    if (!body.run_id) body.run_id = latestRun(action === '적용' || action === '되돌리기')
    if (!safeRunDir(body.run_id)) throw new Error('run_id가 필요하다(검사 결과의 run_id)')
    if (action === '상태') return runStatus(body.run_id, cfg)
    if (action === '적용' || action === '되돌리기') {
      // 로컬 작업 폴더에 검증된 수정을 넣거나 되돌린다. 확인 문구가 없으면 바꿀 내용만 돌려준다
      const { applyFix } = require('../fix/apply')
      const r = applyFix({ run: body.run_id, defect: body.defect || undefined, undo: action === '되돌리기', confirm: body.confirm }, cfg)
      const done = action === '적용' ? r.applied : r.undone
      const st = runStatus(body.run_id, cfg)
      return { ...st, apply: { action, done: !!done, files: (r.files || r.plan || (st.applied ? st.applied.files : []) || []).map((f) => f.file || f), note: done ? `${action} 했다` : `아직 바꾸지 않았다. 사람이 확인 문구 "${action}"을 넣어야 한다` } }
    }
    if (action === '수정 시작') {
      const m = readJSON(path.join(RUNS, body.run_id, 'manifest.json'), {})
      if (!m.targets || m.targets.head.kind === 'url') throw new Error('로컬 주소 대상은 수정 검증을 하지 않는다')
      const r = await startAndWait(['fix', '--run', body.run_id, '--llm', 'auto'], body.run_id, 3000)
      if (r.code === 2) return { ok: false, error_type: 'failed', run_id: body.run_id, message: `수정 시작 실패: ${r.error}` }
      return { ...runStatus(body.run_id, cfg), note: '코드 에이전트가 수정·검증을 시작했다(몇 분). "상태"로 확인한다' }
    }
    if (action === 'PR 준비' || action === 'PR 올리기') {
      const r = await startAndWait(prArgs({ run_id: body.run_id, onto: body.onto, push: action === 'PR 올리기', confirm: body.confirm }), body.run_id, 55000)
      if (r.code === 2) return { ok: false, error_type: 'failed', run_id: body.run_id, message: `${action} 실패: ${r.error}` }
      return { ...runStatus(body.run_id, cfg), note: r.done ? (action === 'PR 올리기' ? 'GitHub에 초안 PR을 올렸다(실패했으면 pr.checks·오류 확인)' : '로컬에 수정 브랜치·커밋·PR 본문을 준비했다. 올리려면 "PR 올리기"와 확인 문구') : '아직 진행 중. "상태"로 다시 확인한다' }
    }
    throw new Error('action은 검사, 상태, 수정 시작, PR 준비, PR 올리기, 적용, 되돌리기, 시안 목록 중 하나')
  } catch (e) { return { ok: false, error_type: e.code === 409 ? 'busy' : 'invalid_argument', message: e.message } }
}

const OPENAPI = (cfg) => ({
  openapi: '3.1.0',
  info: { title: 'dqa 디자인 검수', version: '0.1.0', description: '로컬 디자인 검수 도구. 빌드 이름과 화면을 주면 여러 크기로 열어 재고 결함 요약을 돌려준다.' },
  servers: [{ url: `http://host.docker.internal:${cfg.serve.port}` }],
  paths: {
    '/act': {
      post: {
        operationId: 'dqa_act',
        summary: '사람이 고른 작업을 한다: 검사(작업 폴더·빌드·브랜치, 시안 선택) · 상태 · 수정 시작(코드 에이전트) · 적용·되돌리기(작업 폴더, 확인 문구 필요) · PR 준비 · PR 올리기(확인 문구 필요) · 시안 목록',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['action'], properties: {
          ui_request: { type: 'string', description: '웹 검사에서만 발급하는 일회성 실행 요청 ID' },
          action: { type: 'string', enum: ['검사', '상태', '수정 시작', 'PR 준비', 'PR 올리기', '적용', '되돌리기', '시안 목록'] },
          local: { type: 'string', description: '검사: 로컬 작업 폴더 경로(주면 dist·ref 대신, 커밋 전과 비교)' }, design: { type: 'string', description: '검사: 시안 목록의 시안 이름(Figma 플러그인으로 넣은 것)' }, defect: { type: 'string', description: '적용: 결함 ID 하나만(없으면 검증된 묶음)' }, interact: { type: 'string', enum: ['on', 'off'], description: '검사: 버튼·링크를 눌러 반응 없음·오류·빈 화면 확인' },
          dist: { type: 'string', description: '검사: 빌드 이름' }, base_dist: { type: 'string' }, ref: { type: 'string', description: '검사: 저장소 브랜치나 커밋(주면 dist 대신)' }, base: { type: 'string' },
          recipe: { type: 'string', description: '검사: 화면 레시피' }, llm: { type: 'string', enum: ['on', 'off'] },
          run_id: { type: 'string', description: '상태·수정·PR·적용: 검사 결과의 run_id(비우면 가장 최근 검사)' }, onto: { type: 'string', description: 'PR이 향할 브랜치(검사한 브랜치를 모를 때)' }, confirm: { type: 'string', description: 'PR 올리기·적용·되돌리기: 사람이 입력한 확인 문구' } } } } } },
        responses: { 200: { description: '작업 결과와 상태', content: { 'application/json': { schema: { type: 'object' } } } } }
      }
    },
    '/dify/wait': {
      post: { operationId: 'dqa_wait', summary: '웹 검사 측정 완료를 최대 45초 기다린다. 다른 호출은 결과를 그대로 전달한다',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { ui_request: { type: 'string' }, text: { type: 'string' } } } } } },
        responses: { 200: { description: '측정 상태', content: { 'application/json': { schema: { type: 'object' } } } } } }
    },
    '/dify/llm_ready': {
      post: {
        operationId: 'dqa_llm_ready',
        summary: '보고서 에이전트 LLM을 부를 수 있는지 확인한다(맥미니 연결, 모델, 다른 모델 적재, 여유 메모리 20% 이상). 안 되면 LLM 단계를 건너뛴다',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { note: { type: 'string', description: '비워 둔다' } } } } } },
        responses: { 200: { description: '{ok, reason, free_pct, model}', content: { 'application/json': { schema: { type: 'object' } } } } }
      }
    },
    '/dify/facts': {
      post: {
        operationId: 'dqa_facts',
        summary: '검사 결과에서 새로 생긴 결함을 심각도 순으로 골라, LLM에 줄 측정 사실·지식 검색어·차트 수치·캡처 주소를 돌려준다',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { run_id: { type: 'string', description: '검사 결과의 run_id(비우면 가장 최근 검사)' } } } } } },
        responses: { 200: { description: '{ids, facts, query, by_rule, by_status, shots, design}', content: { 'application/json': { schema: { type: 'object' } } } } }
      }
    },
    '/dify/judge': {
      post: {
        operationId: 'dqa_judge',
        summary: 'LLM이 쓴 문제 정의서(JSON 배열)를 받아 숫자·근거 ID를 측정 사실과 검색 근거로 검증하고, 통과한 것만 결함 기록에 저장한다. 끝나면 맥미니 모델을 내린다',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['answer'], properties: { run_id: { type: 'string' }, ui_request: { type: 'string' }, answer: { type: 'string', description: 'LLM 답(JSON 배열)' }, context: { type: 'string', description: 'LLM에 준 검색 근거(숫자·근거 ID 검증에 쓴다)' }, contexts: {type:'string',description:'결함별 검색 근거 JSON'}, related: { type: 'string', description: '결함별로 자동 연결한 검색 근거(JSON)' } } } } } },
        responses: { 200: { description: '{saved, rejected, items}', content: { 'application/json': { schema: { type: 'object' } } } } }
      }
    },

    ...Object.fromEntries([
      ['inventory','dqa_inventory',{run_id:{type:'string'},ui_request:{type:'string'}}],
      ['adaptive','dqa_adaptive',{run_id:{type:'string'},ui_request:{type:'string'},plan:{type:'string'},audit:{type:'string'},text:{type:'string'}}],
      ['retrieval','dqa_retrieval',{run_id:{type:'string'},ui_request:{type:'string'},audit:{type:'string'}}]
    ].map(([route,operationId,properties]) => [
      '/dify/'+route,
      {post:{operationId,summary:operationId,requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties}}}},responses:{200:{description:'Dify RAG result'}}}}
    ])),
    '/check': {
      post: {
        operationId: 'dqa_check',
        summary: '빌드 하나(와 비교 기준)를 한 화면, 크기 5개로 검사해 결함 요약을 돌려준다(LLM 없이, 수십 초)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['dist', 'recipe'], properties: { dist: { type: 'string', enum: Object.keys(cfg.dists), description: '검사할 빌드' }, base_dist: { type: 'string', enum: Object.keys(cfg.dists), description: '비교 기준 빌드(선택). 주면 새로 생긴 결함만 따로 센다' }, recipe: { type: 'string', enum: listRecipes().map((r) => r.id), description: '화면' } } } } } },
        responses: { 200: { description: '결함 요약(summary.json)', content: { 'application/json': { schema: { type: 'object' } } } } }
      }
    }
  }
})

function startWebCheck (body, cfg, reportOnly) {
  if (current || webJob) throw Object.assign(new Error('이미 검사가 진행 중입니다. 완료하거나 중지한 뒤 시작하세요'), { code: 409 })
  const args = reportOnly ? null : toArgs({ ...body, llm: 'off' }, cfg)
  const id = reportOnly || `${stamp()}_${randomUUID().slice(0, 6)}_ui`
  const token = randomUUID(); const dir = path.join(RUNS, id); fs.mkdirSync(dir, { recursive: true })
  if (!reportOnly) writeJSON(path.join(dir, 'manifest.json'), { run_id: id, title: body.local || '새 검사', started_at: new Date().toISOString(), status: 'running', failures: [], llm: { mode: 'off' }, ...(body.kind === 'local' ? { local: { project: path.resolve(body.local.trim()) } } : {}) })
  webJob = { id, token, args, body, started: !!reportOnly, pipeline: null }
  const job = webJob; job.reportOnly=!!reportOnly
  job.pipeline = startPipeline(id, { action: reportOnly ? '상태' : '검사', run_id: id, ui_request: token }, { ...cfg, ui_report_enabled: body.llm !== 'off' }, state => {
    if (current && current.id === id && state.state !== 'succeeded') stopChild(current.child)
    if (state.state !== 'succeeded') {
      const m = readJSON(path.join(dir, 'manifest.json'), {})
      if (!m.summary && m.status === 'running') { m.status = state.state === 'cancelled' ? 'cancelled' : 'error'; m.exit_code = 2; m.error = state.error || state.message; writeJSON(path.join(dir, 'manifest.json'), m) }
    }
    require('../dify/rag/runtime').releaseAdaptive(job)
    if (webJob === job) webJob = null
    if (!reportOnly && state.state === 'succeeded' && body.autofix && body.kind !== 'url') {
      const m = readJSON(path.join(dir, 'manifest.json'), {})
      if (m.status === 'done') { try { startWebFix({ run_id: id, llm: body.repair_llm || body.llm, repair_mode: body.repair_mode }, cfg) } catch (e) { writeJSON(path.join(dir, 'task_error.json'), { kind: 'fix', error: e.message }) } }
    }
  })
  return id
}

function startWebFix (body, cfg) {
  if (current || webJob) throw Object.assign(new Error('이미 작업이 진행 중입니다'), { code: 409 })
  const id = body.run_id; const dir = safeRunDir(id)
  if (!dir) throw new Error('없는 실행입니다')
  const check = require('../fix/fix').fixability(readJSON(path.join(dir, 'manifest.json'), {}), cfg)
  if (!check.ok) throw new Error(check.reason)
  if (body.defect && !/^[\w.-]+$/.test(body.defect)) throw new Error('결함 ID 형식이 이상합니다')
  const token = randomUUID()
  const args = ['fix', '--run', id, '--llm', body.llm === 'off' ? 'off' : 'auto', ...(body.defect ? ['--defect', body.defect] : []), ...(body.repair_mode === 'model-only' ? ['--repair-mode','model-only'] : [])]
  const job = { id, token, kind: 'fix', args, body: { ...body, llm: 'off' }, started: false, pipeline: null }
  webJob = job
  fs.rmSync(path.join(dir, 'task_error.json'), { force: true })
  job.pipeline = startPipeline(id, { action: '수정 시작', run_id: id, ui_request: token }, { ...cfg, ui_report_enabled: false }, state => {
    if (state.state !== 'succeeded') {
      if (current && current.id === id) stopChild(current.child)
      writeJSON(path.join(dir, 'task_error.json'), { kind: 'fix', error: state.error || state.message, at: new Date().toISOString() })
    }
    require('../dify/rag/runtime').releaseAdaptive(job)
    if (webJob === job) webJob = null
  })
  return id
}

async function waitWebResult (body, cfg) {
  if (!body.ui_request) {
    let previous
    try { previous = JSON.parse(body.text) } catch (e) { return { ok: false, message: '결과를 읽지 못했습니다' } }
    if (!previous.running || !previous.run_id || !safeRunDir(previous.run_id)) return previous
    const t0 = Date.now()
    while (current && current.id === previous.run_id && Date.now() - t0 < 45000) await new Promise(resolve => setTimeout(resolve, 500))
    return runStatus(previous.run_id, cfg)
  }
  const job = webJob
  if (!job || job.token !== body.ui_request) return { ok: false, error_type: 'cancelled', message: '웹 검사가 중지되거나 만료됐습니다' }
  const t0 = Date.now()
  while (webJob === job && current && current.id === job.id && Date.now() - t0 < 45000) await new Promise(resolve => setTimeout(resolve, 500))
  if (webJob !== job) return { ok: false, error_type: 'cancelled', message: '검사가 중지됐습니다', run_id: job.id }
  if (!current && job.adaptivePending) require('../dify/rag/runtime').finishAdaptive(job, cfg, lastExit.get(job.id)?.code, lastExit.get(job.id)?.error)
  return { ...runStatus(job.id, cfg), report_enabled: job.body.llm !== 'off' }
}

async function handle (req, res, cfg) {
  const u = new URL(req.url, 'http://127.0.0.1')
  const p = u.pathname
  if (['/api/designs', '/api/figma/plugin'].includes(p) && (req.method === 'POST' || req.method === 'OPTIONS')) figmaCors(req, res) // 플러그인은 보내기만 한다. 목록 읽기는 열지 않는다
  if (req.method === 'OPTIONS') { if (['/api/designs', '/api/figma/plugin'].includes(p) && req.headers.origin === 'null') { res.writeHead(204); return res.end() } return send(res, 403, { ok: false }) }
  if (req.method === 'GET') {
    if (p === '/demo' || p === '/demo/') return sendFile(res, path.join(UI, 'demo.html'))
    if (p === '/api/demo') return send(res, 200, require('./app-demo').info(u.searchParams.get('app') || 'fieldwork'))
    if (p.startsWith('/demo/')) { const f = require('./app-demo').asset(p); return f ? sendFile(res, f) : send(res, 404, { error: '검증된 데모 파일이 없습니다' }) }
    if (p === '/' || p === '/index.html') return sendFile(res, path.join(UI, 'index.html'))
    if (p.startsWith('/ui/')) { const f = path.join(UI, path.normalize(p.slice(4))); if (!f.startsWith(UI)) return send(res, 403, {}); return sendFile(res, f) }
    if (p === '/openapi.json') return send(res, 200, OPENAPI(cfg))
    if (p === '/health') return send(res, 200, { ok: true, running: current ? current.id : webJob ? webJob.id : null })
    if (p === '/api/options') return send(res, 200, { recipes: listRecipes(), dists: Object.entries(cfg.dists).map(([name, d]) => ({ name, note: d.note })), profiles: Object.entries(cfg.profiles).map(([name, s]) => ({ name, sizes: s.map((x) => x.join('x')) })), default_profile: cfg.default_profile, repos: Object.entries(cfg.repos).map(([name, r]) => ({ name, title: r.title })), model: cfg.dify.llm_model, reporter: 'dify', facts_max: cfg.dify.facts_max })
    if (p === '/api/doctor') return send(res, 200, await checks(cfg))
    if (p === '/api/runs') return send(res, 200, { running: current ? current.id : webJob ? webJob.id : null, runs: listRuns() })
    if (p === '/api/accept') return send(res, 200, loadAccept())
    if (p === '/api/figma/session') return send(res, 200, figmaConnection.snapshot())
    if (p.startsWith('/api/figma/result/')) return send(res, 200, { result: figmaConnection.result(p.slice('/api/figma/result/'.length)) })
    if (p === '/api/designs') return send(res, 200, { designs: require('../design/library').list() })
    const dm = p.match(/^\/api\/designs\/([^/]+)\/(design\.png|design\.json)$/)
    if (dm) { const lib = require('../design/library'); const f = lib.find(decodeURIComponent(dm[1])); if (!f) return send(res, 404, { ok: false, error: '없는 시안' }); return sendFile(res, path.join(path.dirname(f), dm[2])) }
    const m = p.match(/^\/api\/runs\/([\w.-]+)(\/(events|live|file|inspection-stream|inspections)\/?(.*))?$/)
    if (m) {
      const dir = safeRunDir(m[1])
      if (!dir && current && current.id === m[1]) return send(res, 200, m[3] === 'events' ? { running: true, events: [] } : { running: true, manifest: { title: '시작하는 중', status: 'running' }, defects: [] })
      if (!dir) return send(res, 404, { ok: false, error: '없는 실행' })
      if (m[3] === 'inspections') return send(res, 200, { items: require('../core/inspection').readInspections(path.join(dir, 'inspections.jsonl')) })
      if (m[3] === 'inspection-stream') {
        const f = path.join(dir, 'inspections.jsonl'); const decoder = new (require('string_decoder').StringDecoder)('utf8'); let offset = 0; let pending = ''; let closed = false
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
        const emit = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
        if (fs.existsSync(f)) offset = fs.statSync(f).size
        const initial = require('../core/inspection').readInspections(f)
        emit('snapshot', { items: initial })
        const tick = () => {
          if (closed) return
          if (fs.existsSync(f)) {
            const size = fs.statSync(f).size
            if (size < offset) offset = 0
            if (size > offset) {
              const fd = fs.openSync(f, 'r'); const buffer = Buffer.alloc(Math.min(size - offset, 1024 * 1024)); const n = fs.readSync(fd, buffer, 0, buffer.length, offset); fs.closeSync(fd); offset += n
              pending += decoder.write(buffer.subarray(0, n)); const lines = pending.split('\n'); pending = lines.pop()
              for (const line of lines) { try { emit('inspect', JSON.parse(line)) } catch (e) {} }
            }
          }
          if (!((current && current.id === m[1]) || (webJob && webJob.id === m[1]))) { emit('complete', {}); clearInterval(poll); res.end() }
        }
        const poll = setInterval(tick, 100); req.on('close', () => { closed = true; clearInterval(poll) }); tick()
        return
      }
      if (m[3] === 'live') return send(res, 200, { running: !!((current && current.id === m[1]) || (webJob && webJob.id === m[1])), progress: readJSON(path.join(dir, 'progress.json'), null), pipeline: readJSON(path.join(dir, 'pipeline.json'), null), manifest: readJSON(path.join(dir, 'manifest.json'), {}), defects: readJSON(path.join(dir, 'defects.json'), readJSON(path.join(dir, 'preview.json'), {}).defects || []), provisional: !fs.existsSync(path.join(dir, 'summary.json')), events: fs.existsSync(path.join(dir, 'events.jsonl')) ? fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch (e) { return [] } }) : [] })
      if (m[3] === 'events') { const f = path.join(dir, 'events.jsonl'); const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; return send(res, 200, { running: !!((current && current.id === m[1]) || (webJob && webJob.id === m[1])), events: lines }) }
      if (m[3] === 'file') { const f = path.join(dir, path.normalize(decodeURIComponent(m[4] || ''))); if (!f.startsWith(dir + path.sep)) return send(res, 403, {}); return sendFile(res, f) }
      const fixAll = path.join(dir, 'fix', 'fix_all.patch')
      return send(res, 200, { job: current && current.id === m[1] ? current.kind : webJob && webJob.id === m[1] ? webJob.kind || 'check' : null, running: !!((current && current.id === m[1]) || (webJob && webJob.id === m[1])), manifest: { ...attachDesign(dir, cfg), pipeline: readJSON(path.join(dir, 'pipeline.json'), null) }, defects: readJSON(path.join(dir, 'defects.json'), []), diff: readJSON(path.join(dir, 'diff.json'), { resolved: [] }), code_findings: readJSON(path.join(dir, 'code_findings.json'), []), pr_comment: fs.existsSync(path.join(dir, 'pr_comment.md')) ? fs.readFileSync(path.join(dir, 'pr_comment.md'), 'utf8') : '', shots: readJSON(path.join(dir, 'shots.json'), {}), fix: readJSON(path.join(dir, 'fix', 'fixes.json'), null), fix_pipeline: readJSON(path.join(dir, 'fix/pipeline.json'), null), fix_comparison: readJSON(path.join(dir, 'fix/comparison.json'), null), fix_patch: fs.existsSync(fixAll) ? fs.readFileSync(fixAll, 'utf8') : '', pr: readJSON(path.join(dir, 'fix', 'pr.json'), null), apply: readJSON(path.join(dir, 'fix', 'apply.json'), null), task_error: readJSON(path.join(dir, 'task_error.json'), null), fixable: (() => { try { return require('../fix/fix').fixability(readJSON(path.join(dir, 'manifest.json'), {}), cfg) } catch (e) { return { ok: true } } })(), pr_body: fs.existsSync(path.join(dir, 'fix', 'pr_body.md')) ? fs.readFileSync(path.join(dir, 'fix', 'pr_body.md'), 'utf8') : '' })
    }
    return send(res, 404, { ok: false, error: '없는 경로' })
  }
  if (req.method === 'POST') {
    if (p === '/act') { // Dify(서버 간 호출): 사람이 고른 작업을 나눠 처리한다. LLM이 작업을 고르지 않는다
      if (!/application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { ok: false, error: 'application/json만 받는다' })
      return send(res, 200, await difyAct(await readBody(req), cfg))
    }
    if (p === '/check') { // Dify(서버 간 호출)
      if (!/application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { ok: false, error: 'application/json만 받는다' })
      return send(res, 200, await difyCheck(await readBody(req), cfg))
    }
    if (['/dify/inventory','/dify/adaptive','/dify/retrieval'].includes(p)) {
      if (!/application\/json/.test(req.headers['content-type'] || '')) return send(res,415,{ok:false,error:'application/json만 받습니다'})
      const body=await readBody(req,200000);const job=webJob
      try {
        // Non-web/status paths stay read-only. A web call must belong to its active pipeline.
        if (!body.ui_request) return send(res,200,p==='/dify/inventory'?{queries:[]}:body.text?JSON.parse(body.text):runStatus(body.run_id || latestRun(false),cfg))
        if(!job || job.id!==body.run_id || job.token!==body.ui_request || job.pipeline.state.state!=='running')throw new Error('만료되거나 중지된 RAG 요청입니다')
        if(job.kind==='fix') return send(res,200,p==='/dify/inventory'?{queries:[]}:{...runStatus(job.id,cfg),report_enabled:false})
        if(p==='/dify/retrieval') {const audit=JSON.parse(body.audit||'[]');writeJSON(path.join(RUNS,job.id,'retrieval.json'),{version:6,source:'dify',items:audit});return send(res,200,{ok:true,items:audit.length})}
        if(p==='/dify/inventory') { const rag=require('../dify/rag/runtime'); if(job.reportOnly) { await rag.retrievalHealth(cfg); return send(res,200,{queries:[]}) } return send(res,200,await rag.inventoryFor(job.id,cfg,job.body.interact === true || job.body.interact === 'on')) }
        if(job.reportOnly)return send(res,200,{...runStatus(job.id,cfg),report_enabled:job.body.llm!=='off'})
        const audit=JSON.parse(body.audit||'[]');writeJSON(path.join(RUNS,job.id,'probe_retrieval.json'),{version:6,source:'dify',items:audit})
        return send(res,200,await require('../dify/rag/runtime').adaptive(body,cfg,job,startAndWait,runStatus))
      } catch(e) {
        if(job && job.id===body.run_id && job.token===body.ui_request && job.pipeline.state.state==='running') {
          if(current && current.id===job.id) stopChild(current.child)
          const f=path.join(RUNS,job.id,'manifest.json');const m=readJSON(f,{})
          m.failures=[...(m.failures||[]),{side:'head',screen:'rag',size:'adaptive',error:e.message}];m.status='incomplete';m.exit_code=2;m.error=e.message
          if(m.summary)m.summary.failed_sizes=m.failures.length
          writeJSON(f,m)
        }
        return send(res,200,{ok:false,error_type:'rag_failed',message:e.message})
      }
    }
    if (p === '/dify/wait') return send(res, 200, await waitWebResult(await readBody(req, 200000), cfg))
    // Dify 보고서 에이전트(LLM 노드) 다리: 준비 확인 · 측정 사실 · 답 검증과 저장. 실행 ID를 비우면 웹 화면·Dify에서 시작한 최근 검사
    if (p === '/dify/llm_ready' || p === '/dify/facts' || p === '/dify/judge') {
      if (!/application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { ok: false, error: 'application/json만 받는다' })
      const bridge = require('../dify/bridge')
      const body = await readBody(req, 200000)
      try {
        if (p === '/dify/llm_ready') return send(res, 200, await bridge.llmReady(cfg))
        const runId = body.run_id || latestRun(false)
        if (p === '/dify/judge' && body.ui_request && (!webJob || webJob.token !== body.ui_request || webJob.id !== runId)) return send(res, 200, { ok: false, saved: 0, reason: '중지되거나 만료된 설명 요청입니다' })
        if (p === '/dify/facts') return send(res, 200, bridge.factsFor(runId, cfg))
        return send(res, 200, await bridge.judgeSave({ ...body, run_id: runId }, cfg))
      } catch (e) { return send(res, 200, { ok: false, error_type: 'invalid_argument', message: e.message }) }
    }
    if (req.headers['x-dqa'] !== '1') return send(res, 403, { ok: false, error: 'X-DQA 머리글이 없다' })
    if (p === '/api/designs') { // Figma 플러그인이 보낸 시안(여러 프레임)
      try {
        const body = await readBody(req, 40 * 1024 * 1024)
        const lib = require('../design/library')
        if (body.session_id && (!body.items || !body.items.length)) throw new Error('내보낸 프레임이 없습니다. Figma 선택을 확인해 주세요')
        const items = (body.items || []).slice(0, 30).map(it => body.session_id ? figmaConnection.decorate(body, it) : it)
        const saved = items.map(it => lib.save({ name: it.name, spec: it.spec, pngB64: it.png, group: body.session_id ? null : body.group || null, source: 'figma-plugin' }))
        if (body.session_id) figmaConnection.imported(body, saved)
        return send(res, 200, { ok: true, saved })
      } catch (e) { return send(res, 400, { ok: false, error: e.message }) }
    }
    try {
      const body = await readBody(req)
      if (p === '/api/figma/watch') return send(res, 200, { ok: true, ...await figmaConnection.watch() })
      if (p === '/api/figma/open') return send(res, 200, { ok: true, ...await figmaConnection.connect(body) })
      if (p === '/api/local/connect') return send(res, 200, require('./local-selection').connect(body, cfg))
      if (p === '/api/local/inspect') return send(res, 200, require('./local-selection').inspect(body.local, cfg))
      if (p === '/api/figma/refresh') {
        const lib = require('../design/library'); const f = lib.find(body.design)
        if (!f) throw new Error('가져온 시안을 찾을 수 없습니다')
        return send(res, 200, { ok: true, ...figmaConnection.refresh(path.basename(path.dirname(f)), readJSON(f)) })
      }
      if (p === '/api/figma/import') return send(res, 200, { ok: true, ...figmaConnection.importSelection(body) })
      if (p === '/api/figma/plugin') return send(res, 200, { ok: true, ...figmaConnection.poll(body) })
      if (p === '/api/figma/focus') {
        const dir = safeRunDir(body.run_id); if (!dir) throw new Error('검사 기록이 없습니다')
        const row = require('../core/inspection').readInspections(path.join(dir, 'inspections.jsonl')).find(x => x.id === body.inspection_id)
        if (!row || !row.figma || !row.figma.id) throw new Error('이 요소에 대응하는 Figma 노드가 없습니다')
        const manifest = readJSON(path.join(dir, 'manifest.json'), {}); const design = manifest.design && manifest.design[row.screen]
        if (!design) throw new Error('연결된 시안이 없습니다')
        const spec = readJSON(path.join(dir, design.json), {})
        const known = require('../design/compare').flatten(spec).some(n => n.id === row.figma.id)
        if (!known) throw new Error('실제 내보낸 시안에 없는 노드입니다')
        return send(res, 200, await figmaConnection.focus(spec, row.figma.id))
      }
      if (p === '/api/demo/start') { const demo = require('./app-demo'); const id = startWebCheck({ kind: 'local', local: demo.config(body.app).local, base: 'none', interact: body.app === 'atelier' ? 'on' : false, llm: body.app === 'overflow' ? 'off' : 'auto', repair_llm:'auto', repair_mode:body.app === 'overflow' ? 'model-only' : 'auto', autofix: true }, cfg); demo.remember(id,body.app); return send(res, 200, { ok: true, run_id: id }) }
      if (p === '/api/demo/preview') return send(res, 200, require('./app-demo').preview(body.run_id,body.app))
      if (p === '/api/check') { const id = startWebCheck(body, cfg); return send(res, 200, { ok: true, run_id: id, live_url: require('./app-demo').liveUrl(body, id) }) }
      if (p === '/api/report') {
        const dir = safeRunDir(body.run_id); if (!dir || !readJSON(path.join(dir, 'manifest.json'), {}).summary) throw new Error('완료된 측정 결과가 필요합니다')
        return send(res, 200, { ok: true, run_id: startWebCheck({ llm: 'auto' }, cfg, body.run_id) })
      }
      if (p === '/api/fix') {
        const dir = safeRunDir(body.run_id); if (!dir) return send(res, 404, { ok: false, error: '없는 실행' })
        const m = readJSON(path.join(dir, 'manifest.json'), {})
        if (!m.targets || m.targets.head.kind === 'url') return send(res, 400, { ok: false, error: '로컬 주소 대상은 사본을 만들 수 없어 수정 검증을 하지 않는다' })
        if (body.defect && !/^[\w.-]+$/.test(body.defect)) return send(res, 400, { ok: false, error: '결함 ID 형식이 이상하다' })
        return send(res, 200, { ok: true, run_id: startWebFix(body, cfg) })
      }
      if (p === '/api/pr') return send(res, 200, { ok: true, run_id: startCheck(prArgs(body), body.run_id) })
      if (p === '/api/apply') {
        if (current) throw Object.assign(new Error(`작업이 돌고 있다(${current.id}). 끝난 뒤에 적용한다`), { code: 409 })
        const { applyFix } = require('../fix/apply')
        const args = { run: String(body.run_id || ''), defect: body.defect || undefined, undo: !!body.undo, confirm: body.confirm ? String(body.confirm) : undefined }
        const log = []; const orig = console.log; console.log = (...x) => log.push(x.join(' '))
        try { const r = applyFix(args, cfg); return send(res, 200, { ok: true, ...r, log }) } finally { console.log = orig }
      }
      if (p === '/api/accept' || p === '/api/unaccept') {
        const dir = safeRunDir(body.run_id); if (!dir) return send(res, 404, { ok: false, error: '없는 실행' })
        const d = readJSON(path.join(dir, 'defects.json'), []).find((x) => x.id === body.defect_id)
        if (!d) return send(res, 404, { ok: false, error: '없는 결함' })
        const entry = { screen: d.screen, rule: d.rule, fps: d.fps, labels: d.labels.slice(0, 4), note: String(body.note || '').slice(0, 200), from_run: body.run_id }
        return send(res, 200, { ok: true, count: p === '/api/accept' ? addAccept(entry) : removeAccept(entry) })
      }
      if (p === '/api/stop') { if (body.run_id && ![current?.id, webJob?.id].includes(body.run_id)) throw new Error('이 검사는 실행 중이 아닙니다'); if (current) stopChild(current.child); if (webJob) webJob.pipeline.cancel(); return send(res, 200, { ok: true }) }
    } catch (e) { return send(res, e.code === 409 ? 409 : 400, { ok: false, error: e.message }) }
    return send(res, 404, { ok: false, error: '없는 경로' })
  }
  return send(res, 405, { ok: false })
}

async function serve (args, cfg) {
  const port = Number(args.port || cfg.serve.port)
  const server = http.createServer((req, res) => { handle(req, res, cfg).catch((e) => send(res, 500, { ok: false, error: e.message })) })
  await new Promise((resolve, reject) => { server.on('error', reject); server.listen(port, '127.0.0.1', resolve) })
  console.log(`dqa 웹 화면: http://127.0.0.1:${port}`)
  const stop = () => { if (current) stopChild(current.child); if (webJob) webJob.pipeline.cancel(); server.close(); process.exit(0) }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
  return server
}

module.exports = { serve, toArgs, difyAct, runStatus, OPENAPI, waitWebResult }
