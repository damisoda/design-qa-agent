// dqa serve: 로컬 웹 화면 + API(127.0.0.1에서만 연다).
// 웹 화면: 검사 시작 · 진행 상황 · 실행 목록 · 보고서 · 결함 분류(무시). Dify용: POST /check(빠른 모드, 동기), GET /openapi.json.
// 안전장치: 대상은 설정의 빌드 이름·로컬 주소·레시피만, 검사는 한 번에 하나, 브라우저 요청은 X-DQA 머리글 필수(다른 사이트가 몰래 부르지 못하게).
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { RUNS, DQA, readJSON, stamp } = require('../core/util')
const { listRecipes } = require('../recipes/runner')
const { addAccept, removeAccept, loadAccept } = require('../diff/compare')
const { checks } = require('../ops/doctor')

const UI = path.join(DQA, 'ui')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json; charset=utf-8' }
let current = null // { id, child, started }

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)) }
const sendFile = (res, file) => {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { ok: false, error: '없는 파일' })
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
}
const safeRunDir = (id) => { if (!/^[\w.-]+$/.test(id || '')) return null; const d = path.join(RUNS, id); return fs.existsSync(d) ? d : null }
const readBody = (req) => new Promise((resolve, reject) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 20000) { reject(new Error('본문이 너무 크다')); req.destroy() } }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}) } catch (e) { reject(new Error('JSON이 아니다')) } }) })

function runSummary (id) {
  const d = path.join(RUNS, id)
  const m = readJSON(path.join(d, 'manifest.json'), null)
  if (!m) return null
  const fx = readJSON(path.join(d, 'fix', 'fixes.json'), null)
  const t = m.targets || {}
  return { id, title: m.title, status: current && current.id === id ? 'running' : m.status, job: current && current.id === id ? current.kind : null, started_at: m.started_at, total_sec: m.total_sec, exit_code: m.exit_code, summary: m.summary || null,
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
  if (!recipes.length || !recipes.every((r) => known.has(r))) throw new Error('화면 레시피를 하나 이상 골라야 한다(목록에 있는 것만)')
  a.push('--recipe', recipes.join(','))
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
  } else throw new Error('대상 종류는 dist, url, repo 중 하나')
  const w = String(body.widths || '')
  if (w) { if (!cfg.profiles[w] && !/^(\d{3,4}x\d{3,4})(,\d{3,4}x\d{3,4}){0,7}$/.test(w)) throw new Error('크기는 프로필 이름이나 375x812,390x844 형식'); a.push('--widths', w) }
  a.push('--llm', body.llm === 'off' ? 'off' : 'auto')
  return a
}

// 작업 하나를 자식 프로세스로 돌린다. next(id)가 있으면 끝난 뒤 같은 실행 ID로 이어서 돌린다(검사 → 자동 수정)
function startCheck (args, existingId, next) {
  if (current) throw Object.assign(new Error(`이미 작업이 돌고 있다(${current.id}). 끝난 뒤에 시작한다`), { code: 409 })
  const id = existingId || `${stamp()}_ui`
  const child = spawn(process.execPath, [path.join(DQA, 'cli.js'), ...args, ...(existingId ? [] : ['--run-id', id])], { cwd: DQA, env: { ...process.env, DQA_QUIET: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''
  child.stderr.on('data', (c) => { err += c })
  current = { id, child, started: Date.now(), kind: args[0] }
  child.on('exit', (code) => {
    if (code === 2 && !fs.existsSync(path.join(RUNS, id, 'manifest.json'))) { fs.mkdirSync(path.join(RUNS, id), { recursive: true }); fs.writeFileSync(path.join(RUNS, id, 'manifest.json'), JSON.stringify({ run_id: id, title: '실행 실패', status: 'error', error: err.slice(0, 500), started_at: new Date().toISOString() })) }
    current = null
    if (next && fs.existsSync(path.join(RUNS, id, 'defects.json'))) { try { startCheck(next(id), id) } catch (e) {} }
  })
  return id
}

// Dify용 빠른 검사: 한 화면, 크기 3개 이하, LLM 없이, 끝날 때까지 기다려 요약을 돌려준다
function difyCheck (body, cfg) {
  return new Promise((resolve) => {
    let args
    try {
      if (!cfg.dists[body.dist]) throw new Error(`dist는 ${Object.keys(cfg.dists).join(', ')} 중 하나여야 한다`)
      if (body.base_dist && !cfg.dists[body.base_dist]) throw new Error(`base_dist는 ${Object.keys(cfg.dists).join(', ')} 중 하나여야 한다`)
      const known = new Set(listRecipes().map((r) => r.id))
      if (!known.has(body.recipe)) throw new Error(`recipe는 ${[...known].join(', ')} 중 하나여야 한다`)
      args = ['check', '--dist', body.dist, '--recipe', body.recipe, '--widths', 'mobile3', '--llm', 'off', ...(body.base_dist ? ['--base-dist', body.base_dist] : [])]
    } catch (e) { return resolve({ ok: false, error_type: 'invalid_argument', message: e.message }) }
    let id
    try { id = startCheck(args) } catch (e) { return resolve({ ok: false, error_type: 'busy', message: e.message }) }
    const t0 = Date.now()
    const timer = setInterval(() => {
      if (current && current.id === id && Date.now() - t0 < 240000) return
      clearInterval(timer)
      const s = readJSON(path.join(RUNS, id, 'summary.json'), null)
      if (!s) return resolve({ ok: false, error_type: 'timeout', message: '240초 안에 끝나지 않았거나 실패했다', run_id: id })
      resolve({ ok: true, ...s, report_url: `http://127.0.0.1:${cfg.serve.port}/#/runs/${id}` })
    }, 1000)
  })
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
function startAndWait (args, existingId, waitMs) {
  return new Promise((resolve, reject) => {
    let id
    try { id = startCheck(args, existingId) } catch (e) { return reject(e) }
    const t0 = Date.now()
    const timer = setInterval(() => { if (current && current.id === id && Date.now() - t0 < waitMs) return; clearInterval(timer); resolve({ id, done: !(current && current.id === id) }) }, 1000)
  })
}

function runStatus (id, cfg) {
  const dir = safeRunDir(id)
  if (!dir) return { ok: false, error_type: 'not_found', message: `없는 실행: ${id}` }
  const s = readJSON(path.join(dir, 'summary.json'), null)
  const fx = readJSON(path.join(dir, 'fix', 'fixes.json'), null)
  const pr = readJSON(path.join(dir, 'fix', 'pr.json'), null)
  return { ok: true, run_id: id, running: !!(current && current.id === id), check: s ? { exit_code: s.exit_code, summary: s.summary, defects: s.defects } : null, fix: fx ? { summary: fx.summary || null, items: fx.items.map((x) => ({ rule: x.rule, labels: x.labels, verified: x.verified !== null, together: !!x.resolved_by_combined, skipped: x.skipped || null })) } : null, pr: pr ? { branch: pr.branch, base: pr.base, commit: pr.commit || null, checks: pr.checks, pushed: pr.pushed, url: pr.url || null } : null, view_url: `http://127.0.0.1:${cfg.serve.port}/#/runs/${id}` }
}

async function difyAct (body, cfg) {
  try {
    const action = String(body.action || '')
    if (action === '검사') {
      const known = new Set(listRecipes().map((r) => r.id))
      if (!known.has(body.recipe)) throw new Error(`recipe는 ${[...known].join(', ')} 중 하나`)
      let args
      if (body.ref) {
        if (!/^[\w./-]{1,80}$/.test(body.ref) || (body.base && !/^[\w./-]{1,80}$/.test(body.base))) throw new Error('ref·base 형식이 이상하다')
        args = ['check', '--repo', 'cbh', '--ref', body.ref, ...(body.base ? ['--base', body.base] : []), '--recipe', body.recipe, '--widths', 'mobile3', '--llm', body.llm === 'on' ? 'auto' : 'off']
      } else {
        if (!cfg.dists[body.dist]) throw new Error(`dist는 ${Object.keys(cfg.dists).join(', ')} 중 하나이거나 ref를 준다`)
        args = ['check', '--dist', body.dist, ...(body.base_dist && cfg.dists[body.base_dist] ? ['--base-dist', body.base_dist] : []), '--recipe', body.recipe, '--widths', 'mobile3', '--llm', body.llm === 'on' ? 'auto' : 'off']
      }
      const r = await startAndWait(args, null, 50000)
      return { ...runStatus(r.id, cfg), note: r.done ? '검사 끝' : '아직 진행 중. "상태"로 다시 확인한다' }
    }
    if (!safeRunDir(body.run_id)) throw new Error('run_id가 필요하다(검사 결과의 run_id)')
    if (action === '상태') return runStatus(body.run_id, cfg)
    if (action === '수정 시작') {
      const m = readJSON(path.join(RUNS, body.run_id, 'manifest.json'), {})
      if (!m.targets || m.targets.head.kind === 'url') throw new Error('로컬 주소 대상은 수정 검증을 하지 않는다')
      await startAndWait(['fix', '--run', body.run_id, '--llm', 'auto'], body.run_id, 3000)
      return { ...runStatus(body.run_id, cfg), note: '코드 에이전트가 수정·검증을 시작했다(몇 분). "상태"로 확인한다' }
    }
    if (action === 'PR 준비' || action === 'PR 올리기') {
      const r = await startAndWait(prArgs({ run_id: body.run_id, onto: body.onto, push: action === 'PR 올리기', confirm: body.confirm }), body.run_id, 55000)
      return { ...runStatus(body.run_id, cfg), note: r.done ? (action === 'PR 올리기' ? 'GitHub에 초안 PR을 올렸다(실패했으면 pr.checks·오류 확인)' : '로컬에 수정 브랜치·커밋·PR 본문을 준비했다. 올리려면 "PR 올리기"와 확인 문구') : '아직 진행 중. "상태"로 다시 확인한다' }
    }
    throw new Error('action은 검사, 상태, 수정 시작, PR 준비, PR 올리기 중 하나')
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
        summary: '사람이 고른 작업을 한다: 검사(빌드나 브랜치) · 상태 · 수정 시작(코드 에이전트) · PR 준비(로컬 브랜치·커밋) · PR 올리기(확인 문구 필요, 초안 PR)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['action'], properties: {
          action: { type: 'string', enum: ['검사', '상태', '수정 시작', 'PR 준비', 'PR 올리기'] },
          dist: { type: 'string', description: '검사: 빌드 이름' }, base_dist: { type: 'string' }, ref: { type: 'string', description: '검사: 저장소 브랜치나 커밋(주면 dist 대신)' }, base: { type: 'string' },
          recipe: { type: 'string', description: '검사: 화면 레시피' }, llm: { type: 'string', enum: ['on', 'off'] },
          run_id: { type: 'string', description: '상태·수정·PR: 검사 결과의 run_id' }, onto: { type: 'string', description: 'PR이 향할 브랜치(검사한 브랜치를 모를 때)' }, confirm: { type: 'string', description: 'PR 올리기: 사람이 입력한 확인 문구' } } } } } },
        responses: { 200: { description: '작업 결과와 상태', content: { 'application/json': { schema: { type: 'object' } } } } }
      }
    },
    '/check': {
      post: {
        operationId: 'dqa_check',
        summary: '빌드 하나(와 비교 기준)를 한 화면, 크기 3개로 검사해 결함 요약을 돌려준다(LLM 없이, 수십 초)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['dist', 'recipe'], properties: { dist: { type: 'string', enum: Object.keys(cfg.dists), description: '검사할 빌드' }, base_dist: { type: 'string', enum: Object.keys(cfg.dists), description: '비교 기준 빌드(선택). 주면 새로 생긴 결함만 따로 센다' }, recipe: { type: 'string', enum: listRecipes().map((r) => r.id), description: '화면' } } } } } },
        responses: { 200: { description: '결함 요약(summary.json)', content: { 'application/json': { schema: { type: 'object' } } } } }
      }
    }
  }
})

async function handle (req, res, cfg) {
  const u = new URL(req.url, 'http://127.0.0.1')
  const p = u.pathname
  if (req.method === 'GET') {
    if (p === '/' || p === '/index.html') return sendFile(res, path.join(UI, 'index.html'))
    if (p.startsWith('/ui/')) { const f = path.join(UI, path.normalize(p.slice(4))); if (!f.startsWith(UI)) return send(res, 403, {}); return sendFile(res, f) }
    if (p === '/openapi.json') return send(res, 200, OPENAPI(cfg))
    if (p === '/health') return send(res, 200, { ok: true, running: current ? current.id : null })
    if (p === '/api/options') return send(res, 200, { recipes: listRecipes(), dists: Object.entries(cfg.dists).map(([name, d]) => ({ name, note: d.note })), profiles: Object.entries(cfg.profiles).map(([name, s]) => ({ name, sizes: s.map((x) => x.join('x')) })), default_profile: cfg.default_profile, repos: Object.entries(cfg.repos).map(([name, r]) => ({ name, title: r.title })), model: cfg.ollama.model })
    if (p === '/api/doctor') return send(res, 200, await checks(cfg))
    if (p === '/api/runs') return send(res, 200, { running: current ? current.id : null, runs: listRuns() })
    if (p === '/api/accept') return send(res, 200, loadAccept())
    const m = p.match(/^\/api\/runs\/([\w.-]+)(\/(events|file)\/?(.*))?$/)
    if (m) {
      const dir = safeRunDir(m[1])
      if (!dir && current && current.id === m[1]) return send(res, 200, m[3] === 'events' ? { running: true, events: [] } : { running: true, manifest: { title: '시작하는 중', status: 'running' }, defects: [] })
      if (!dir) return send(res, 404, { ok: false, error: '없는 실행' })
      if (m[3] === 'events') { const f = path.join(dir, 'events.jsonl'); const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; return send(res, 200, { running: !!(current && current.id === m[1]), events: lines }) }
      if (m[3] === 'file') { const f = path.join(dir, path.normalize(decodeURIComponent(m[4] || ''))); if (!f.startsWith(dir + path.sep)) return send(res, 403, {}); return sendFile(res, f) }
      const fixAll = path.join(dir, 'fix', 'fix_all.patch')
      return send(res, 200, { running: !!(current && current.id === m[1]), manifest: readJSON(path.join(dir, 'manifest.json'), null), defects: readJSON(path.join(dir, 'defects.json'), []), diff: readJSON(path.join(dir, 'diff.json'), { resolved: [] }), code_findings: readJSON(path.join(dir, 'code_findings.json'), []), pr_comment: fs.existsSync(path.join(dir, 'pr_comment.md')) ? fs.readFileSync(path.join(dir, 'pr_comment.md'), 'utf8') : '', shots: readJSON(path.join(dir, 'shots.json'), {}), fix: readJSON(path.join(dir, 'fix', 'fixes.json'), null), fix_patch: fs.existsSync(fixAll) ? fs.readFileSync(fixAll, 'utf8') : '', pr: readJSON(path.join(dir, 'fix', 'pr.json'), null), pr_body: fs.existsSync(path.join(dir, 'fix', 'pr_body.md')) ? fs.readFileSync(path.join(dir, 'fix', 'pr_body.md'), 'utf8') : '' })
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
    if (req.headers['x-dqa'] !== '1') return send(res, 403, { ok: false, error: 'X-DQA 머리글이 없다' })
    try {
      const body = await readBody(req)
      if (p === '/api/check') return send(res, 200, { ok: true, run_id: startCheck(toArgs(body, cfg), null, body.autofix && body.kind !== 'url' ? (id) => ['fix', '--run', id, '--llm', body.llm === 'off' ? 'off' : 'auto'] : null) })
      if (p === '/api/fix') {
        const dir = safeRunDir(body.run_id); if (!dir) return send(res, 404, { ok: false, error: '없는 실행' })
        const m = readJSON(path.join(dir, 'manifest.json'), {})
        if (!m.targets || m.targets.head.kind === 'url') return send(res, 400, { ok: false, error: '로컬 주소 대상은 사본을 만들 수 없어 수정 검증을 하지 않는다' })
        if (body.defect && !/^[\w.-]+$/.test(body.defect)) return send(res, 400, { ok: false, error: '결함 ID 형식이 이상하다' })
        return send(res, 200, { ok: true, run_id: startCheck(['fix', '--run', body.run_id, '--llm', body.llm === 'off' ? 'off' : 'auto', ...(body.defect ? ['--defect', body.defect] : [])], body.run_id) })
      }
      if (p === '/api/pr') return send(res, 200, { ok: true, run_id: startCheck(prArgs(body), body.run_id) })
      if (p === '/api/accept' || p === '/api/unaccept') {
        const dir = safeRunDir(body.run_id); if (!dir) return send(res, 404, { ok: false, error: '없는 실행' })
        const d = readJSON(path.join(dir, 'defects.json'), []).find((x) => x.id === body.defect_id)
        if (!d) return send(res, 404, { ok: false, error: '없는 결함' })
        const entry = { screen: d.screen, rule: d.rule, fps: d.fps, labels: d.labels.slice(0, 4), note: String(body.note || '').slice(0, 200), from_run: body.run_id }
        return send(res, 200, { ok: true, count: p === '/api/accept' ? addAccept(entry) : removeAccept(entry) })
      }
      if (p === '/api/stop') { if (current) { current.child.kill('SIGTERM'); return send(res, 200, { ok: true }) } return send(res, 200, { ok: false, error: '돌고 있는 검사가 없다' }) }
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
  const stop = () => { if (current) current.child.kill('SIGTERM'); server.close(); process.exit(0) }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
  return server
}

module.exports = { serve, toArgs }
