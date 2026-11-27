const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { RUNS, STATE, readJSON, writeJSON, assertAllowedPath } = require('../core/util')
const { loadRecipe } = require('../recipes/runner')

const validRunId = id => typeof id === 'string' && /^repair-[a-f0-9-]{36}$/.test(id)
const newRunId = () => 'repair-' + randomUUID()
const modes = ['inspect', 'rules', 'model', 'hybrid']

function profileConfig (filename, defaults) {
  const file = path.resolve(filename)
  const at = value => path.resolve(path.dirname(file), value)
  const profile = readJSON(file)
  if (typeof profile.local !== 'string' || !Array.isArray(profile.recipes) || !profile.recipes.length ||
      profile.recipes.length > 20 || new Set(profile.recipes).size !== profile.recipes.length) throw Error('등록된 로컬 프로젝트와 고유한 화면 레시피가 필요합니다')
  const local = fs.realpathSync(assertAllowedPath(at(profile.local), defaults))
  const recipes = profile.recipes.map(loadRecipe)
  const design = Object.fromEntries(recipes.map(recipe => {
    const input = profile.designs?.[recipe.id]
    const { designFile } = require('../core/design')
    const selected = typeof input === 'string'
      ? designFile(input.startsWith('library:') ? input.slice(8) : at(input), defaults)
      : recipe.design && designFile(path.resolve(path.dirname(recipe._file), recipe.design), defaults)
    const spec = selected && readJSON(selected, null)
    if (!spec?.frame?.id || !Array.isArray(spec.nodes)) throw Error(`Figma 프레임 파일이 필요합니다: ${recipe.id}`)
    const expected = profile.frame_ids?.[recipe.id]
    if (expected && spec.frame.id !== expected) throw Error(`등록한 Figma 프레임과 일치하지 않습니다: ${recipe.id}`)
    const png = path.join(path.dirname(selected), 'design.png')
    if (!fs.existsSync(png)) throw Error(`Figma 프레임 PNG가 필요합니다: ${recipe.id}`)
    if (selected.includes(',') || selected.includes('=')) throw Error('시안 파일 경로에 쉼표 또는 등호를 사용할 수 없습니다')
    return [recipe.id, selected]
  }))
  const o = profile.ollama || {}
  const url = new URL(o.url || 'http://127.0.0.1:11434')
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.href !== url.origin + '/' || url.username || url.password) throw Error('Ollama 주소는 이 컴퓨터의 루프백 HTTP 서버여야 합니다')
  if (!/^[a-z0-9][a-z0-9._:/-]{0,100}$/i.test(o.model || '') || /[:\/-]cloud(?:$|[:\/-])/i.test(o.model)) throw Error('로컬에 설치한 Ollama 모델 이름이 필요합니다')
  const cfg = {
    ...defaults, local_snapshots: path.join(STATE, 'repair-snapshots'), mac_mini: null,
    fix: { ...defaults.fix, scratch: path.join(STATE, 'repair-scratch') },
    ollama: { ...defaults.ollama, url: url.origin, model: o.model, local_only: true, num_ctx: o.num_ctx, repair_images: !!o.images, unload_after: false }
  }
  const { parseSizes } = require('../core/run')
  for (const recipe of recipes) {
    for (const selector of Object.values(recipe.runtime_text || {})) {
      if (!recipe.journeys?.some(journey => journey.steps.some(step => step.expect?.selector === selector && (step.expect.text !== undefined || step.expect.contains !== undefined)))) {
        throw Error(`런타임 글자 연결에 값 검증 시나리오가 필요합니다: ${recipe.id} ${selector}`)
      }
    }
  }
  if (recipes.some(recipe => !parseSizes(profile.widths, recipe, cfg).length)) throw Error('각 레시피에 유효한 화면 크기가 필요합니다')
  return { cfg, local, recipes, design, widths: profile.widths }
}

function status (id) {
  if (!validRunId(id)) throw Error('실행 ID가 올바르지 않습니다')
  const dir = path.join(RUNS, id)
  const job = readJSON(path.join(dir, 'local-repair.json'), null)
  if (!job) throw Error('등록된 로컬 수정 실행을 찾지 못했습니다')
  if (!['queued', 'checking', 'repairing'].includes(job.state)) return job
  const log = path.join(dir, 'events.jsonl')
  let last
  if (fs.existsSync(log)) {
    const row = fs.readFileSync(log, 'utf8').trimEnd().split('\n').at(-1)
    try { const e = JSON.parse(row); last = { stage: e.stage, at: e.t } } catch {}
  }
  if (job.pid) {
    try { process.kill(job.pid, 0) } catch (e) {
      if (e.code === 'ESRCH') return { ...job, state: 'interrupted', last }
    }
  }
  return { ...job, last }
}

async function localRepair (args, defaults) {
  const id = args['run-id'] || newRunId()
  const mode = args.mode || 'hybrid'
  if (!validRunId(id) || typeof args.profile !== 'string' || !modes.includes(mode)) throw Error('local-repair --profile <JSON> [--mode inspect|rules|model|hybrid]')
  const { cfg, local, recipes, design, widths } = profileConfig(args.profile, defaults)
  const dir = path.join(RUNS, id)
  const output = path.join(dir, 'local-repair.json')
  fs.mkdirSync(dir, { recursive: true })
  const lock = path.join(STATE, 'local-repair.lock')
  let owner
  try { owner = fs.openSync(lock, 'wx') } catch (err) {
    if (err.code === 'EEXIST') throw Error('다른 로컬 수정이 진행 중입니다. 이전 실행 상태를 확인하세요')
    throw err
  }
  fs.writeFileSync(owner, JSON.stringify({ pid: process.pid, run_id: id }))
  const release = () => {
    fs.closeSync(owner)
    fs.unlinkSync(lock)
  }
  const onInterrupt = () => { release(); process.exit(130) }
  const onTerminate = () => { release(); process.exit(143) }
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)
  const job = { run_id: id, state: 'checking', mode, pid: process.pid, started_at: new Date().toISOString(), frames: recipes.map(r => r.id) }
  const save = state => { job.state = state; job.updated_at = new Date().toISOString(); writeJSON(output, job) }
  try {
    const previous = fs.existsSync(path.join(dir, 'manifest.json'))
    if (previous) throw Error('이미 사용한 실행 ID입니다')
    save('checking')
    if (mode === 'model' || mode === 'hybrid') {
      const model = await require('../judge/ollama').preflight(cfg)
      if (!model.ok) throw Error(model.reason)
    }
    const checked = await require('../core/run').check({
      local, base: 'none', recipe: recipes.map(r => r.id).join(','), widths,
      design: Object.entries(design).map(([k, v]) => `${k}=${v}`).join(','),
      'run-id': id, llm: 'off'
    }, cfg)
    const manifest = readJSON(path.join(dir, 'manifest.json'))
    const defects = readJSON(path.join(dir, 'defects.json'), [])
    const targets = defects.filter(d => !d.accepted && d.rule !== 'R5')
    job.before = targets.length
    job.figma_frames = Object.values(manifest.design || {}).map(d => ({ frame_id: d.frame_id, frame: d.frame, base: d.base, file_key: d.figma?.file_key, exported_at: d.exported_at }))
    job.journeys = { before: (manifest.journeys || []).filter(j => j.ok).length, total: manifest.journeys?.length || 0 }
    if (checked.exit_code === 2 || manifest.status !== 'done' || job.figma_frames.length !== recipes.length) throw Error('시안과 브라우저 검사가 모두 끝나지 않았습니다')
    if (mode === 'inspect' || !targets.length) { save(targets.length ? 'inspected' : 'clean'); return job }
    save('repairing')
    const result = await require('../fix/fix').fixRun({ run: id, llm: mode === 'rules' ? 'off' : 'auto', 'repair-mode': mode === 'model' ? 'model-only' : 'auto' }, cfg)
    if (mode !== 'rules' && result.llm.status !== 'ok') throw Error(result.llm.reason)
    const combined = result.combined
    job.model = result.llm.model || null
    job.candidate_fixed = combined?.fixed?.length ?? 0
    job.fixed = combined?.ok ? combined.fixed.length : 0
    job.regressions = combined?.regress?.length ?? null
    job.model_repairs = result.items.filter(item => item.verified !== null && item.attempts[item.verified].source === 'llm').length
    job.rule_repairs = result.items.filter(item => item.verified !== null && item.attempts[item.verified].source === 'rule').length
    job.journeys.after = combined?.journeys?.filter(j => j.ok).length ?? null
    job.artifacts = { check: 'report.html', verification: 'fix/comparison.json', decisions: 'fix/fixes.json', patch: combined?.ok ? 'fix/fix_all.patch' : null }
    save(combined?.ok && result.app_plan.status === 'complete' ? 'verified' : 'unresolved')
    return job
  } catch (err) {
    job.error = err.message
    if (fs.existsSync(output) && readJSON(output, {}).pid === process.pid) save('failed')
    throw err
  } finally {
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onTerminate)
    release()
  }
}

module.exports = { localRepair, status, newRunId, profileConfig, modes, validRunId }
