// 웹 검사는 항상 Dify가 진입점이다. 실제 Dify 노드 이벤트를 진행 기록에 붙인다.
const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process')
const { RUNS, DQA, readJSON, writeJSON } = require('../core/util')
const { refreshReports } = require('../report/refresh')
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'timeout'])
const PHASES = {
  inventory: ['search','추가로 검사할 화면 구조와 CSS 경계를 읽고 있습니다'],
  probe_search: ['search','Dify에서 적용 가능한 검사 방법을 검색하고 있습니다'],
  adaptive: ['measure','검색한 검사 방법으로 화면과 버튼을 추가 측정하고 있습니다'],
  issue_search: ['search','Dify에서 결함별 근거를 검색하고 재정렬하고 있습니다'],
  ready: ['ready', '로컬 모델을 사용할 수 있는지 확인하고 있습니다'],
  kr_docs: ['search', '결함과 관련된 문서 근거를 검색하고 있습니다'],
  kr_cases: ['search', '비슷한 과거 사례를 검색하고 있습니다'],
  llm: ['model', 'Gemma에 문제 설명을 요청했습니다'],
  judge: ['validate', '설명의 숫자와 근거를 검증하고 있습니다']
}
function startPipeline (id, inputs, cfg, onDone) {
  const dir = path.join(RUNS, id); fs.mkdirSync(dir, { recursive: true })
  const state = { report_enabled: cfg.ui_report_enabled !== false, source: 'dify', app_id: cfg.dify.app_id, state: 'running', phase: 'connect', message: 'Dify 워크플로를 시작하고 있습니다', started_at: new Date().toISOString() }
  const repair = inputs.action === '수정 시작'
  state.kind = repair ? 'fix' : 'check'
  const save = () => writeJSON(path.join(dir, repair ? 'fix/pipeline.json' : 'pipeline.json'), state)
  const event = (msg, extra = {}) => fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ t: new Date().toISOString(), sec: Math.round((Date.now() - Date.parse(state.started_at)) / 100) / 10, stage: 'dify', msg, ...extra }) + '\n')
  save(); event(state.message)
  let child; let finished = false; let buffer = ''; let stderr = ''; let watchdog; let monitor; let stopping = false
  const command = (mode, payload) => spawn(cfg.dify.python || 'python3', [path.join(DQA, 'dify', 'stream.py'), mode, cfg.dify.app_id, payload], { cwd: DQA, stdio: ['ignore', 'pipe', 'pipe'] })
  const stopRemote = () => { if (state.task_id) { const c = command('stop', state.task_id); c.on('error', () => {}); c.stdout.resume(); c.stderr.resume() } }
  const finish = (status, error) => {
    if (finished) return
    finished = true; clearTimeout(watchdog); clearInterval(monitor)
    state.state = status; state.finished_at = new Date().toISOString(); state.total_sec = Math.round((Date.now() - Date.parse(state.started_at)) / 100) / 10
    if (error) state.error = String(error).slice(0, 600)
    state.message = status === 'succeeded' ? (repair ? 'Dify 수정·재검증이 끝났습니다' : 'Dify 검사가 끝났습니다') : status === 'cancelled' ? '검사를 중지했습니다. 완료한 측정은 남아 있습니다' : status === 'timeout' ? '검사 대기 시간이 초과됐습니다. 완료한 측정은 남아 있습니다' : 'Dify 검사를 완료하지 못했습니다. 완료한 측정은 남아 있습니다'
    save(); event(state.message)
    try { if (status === 'succeeded' && !repair) refreshReports(id) } catch (e) { state.report_error = e.message; save() } finally { onDone(state) }
  }
  const receive = (e) => {
    if (finished) { if (e.task_id && !state.task_id) { state.task_id = e.task_id; stopRemote() } return }
    if (e.task_id) state.task_id = e.task_id
    if (e.workflow_run_id) state.workflow_run_id = e.workflow_run_id
    if (e.event === 'node_started' && e.node === 'dqa') { state.phase = repair ? 'fix' : 'measure'; state.message = repair ? 'Dify에서 사본 코드 수정과 재검증을 시작합니다' : 'Dify에서 화면 측정을 시작합니다'; event(state.message) }
    if (!repair && e.event === 'node_started' && PHASES[e.node]) {
      [state.phase, state.message] = PHASES[e.node]; state.node_started_at = new Date().toISOString(); event(state.message)
    }
    if (e.ready) { state.ready = e.ready; if (e.ready.ok !== 1) { state.report = 'skipped'; state.reason = e.ready.reason } }
    if (e.event === 'node_finished' && e.node === 'llm') { state.model_loaded = undefined }
    if (e.judge) { state.report = e.judge.ok && e.judge.saved > 0 ? 'saved' : 'rejected'; state.saved = e.judge.saved || 0; state.rejected = (e.judge.rejected || []).length }
    save()
    if (e.event === 'workflow_finished') {
      state.workflow_status = e.status
      const m = readJSON(path.join(dir, 'manifest.json'), {})
      const fx = readJSON(path.join(dir, 'fix/fixes.json'), {})
      const taskError = readJSON(path.join(dir, 'task_error.json'), null)
      if (repair) state.repair_summary = fx.summary || null
      if (repair && e.status === 'succeeded' && (taskError || !fx.finished_at || Date.parse(fx.started_at) < Date.parse(state.started_at))) finish('failed', taskError?.error || '수정 재검증 완료 결과가 없습니다')
      else if (e.status === 'succeeded' && m.status === 'running') { stopRemote(); finish('timeout', '측정 완료 대기 한도를 넘었습니다') }
      else if (e.status === 'succeeded' && m.exit_code === 2) finish('failed', m.error || '일부 화면 검사를 완료하지 못했습니다')
      else finish(e.status === 'succeeded' ? 'succeeded' : 'failed', e.error)
    }
    else if (e.event === 'error') finish('failed', e.error || 'Dify 실행 오류')
  }
  try {
    if (!cfg.dify.app_id) throw new Error('Dify app_id를 설정하세요')
    child = command('run', JSON.stringify(inputs))
    child.stdout.on('data', c => { buffer += c; const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) { try { receive(JSON.parse(line)) } catch (e) {} } })
    child.stderr.on('data', c => { stderr = (stderr + c).slice(-2000) })
    child.on('error', e => finish('failed', e.message))
    child.on('close', code => { if (!finished) finish('failed', code ? stderr.split('\n').filter(Boolean).at(-1) || `Dify 연결 실패(${code})` : 'Dify 완료 이벤트를 받지 못했습니다') })
    watchdog = setTimeout(() => { stopping = true; stopRemote(); finish('timeout', 'Dify 전체 대기 시간 초과'); child.kill('SIGTERM') }, cfg.dify.timeout_ms || 900000)
    // ps는 모델을 로드하지 않는다. 노드 진입 후 실제 적재 여부만 확인한다.
    let checking = false
    monitor = setInterval(async () => {
      if (finished || state.phase !== 'model' || checking) return
      checking = true
      try {
        const r = await fetch(cfg.ollama.url + '/api/ps', { signal: AbortSignal.timeout(2500) }); const j = await r.json()
        if (!finished && state.phase === 'model') { state.model_loaded = (j.models || []).some(m => m.name === cfg.dify.llm_model || m.model === cfg.dify.llm_model); save() }
      } catch (e) {} finally { checking = false }
    }, 2000)
  } catch (e) { setImmediate(() => finish('failed', e.message)) }
  return { state, cancel: () => { if (finished || stopping) return; stopping = true; stopRemote(); finish('cancelled'); if (child) child.kill('SIGTERM') } }
}
function isTerminal (p) { return !!p && terminal.has(p.state) }
module.exports = { startPipeline, isTerminal }
