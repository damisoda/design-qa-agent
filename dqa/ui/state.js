// 웹 화면의 상태 표시는 실제 완료 상태·저장된 보고서·묶음 검증 결과를 따른다.
(function (root) {
  const incomplete = (m) => !!m && (['incomplete', 'cancelled'].includes(m.status) || m.exit_code === 2 || (m.failures || []).length > 0 || !!(m.summary && m.summary.failed_sizes))
  const reporter = (m, defects) => {
    const ds = (defects || []).filter(d => d.judge && d.judge.status === 'ok' && d.judge.source === 'dify')
    if (ds.length) return `보고서 에이전트 Dify · ${ds[0].judge.model || '로컬 모델'} · ${ds.length}건`
    if (m.pipeline && m.pipeline.source === 'dify') return m.pipeline.report_enabled === false ? 'Dify 검사 · 문제 설명 꺼짐' : m.pipeline.report === 'skipped' ? 'Dify 검사 · 문제 설명 생략' : 'Dify 검사 · 저장된 문제 설명 없음'
    return m.llm && m.llm.status === 'ok' ? `보고서 에이전트 ${m.llm.model}` : '보고서 에이전트 사용 안 함'
  }
  const validCombined = (c) => !!c && c.ok === true && c.build_ok === true && !(c.coverage_errors || []).length && c.failed_sizes === 0 && Array.isArray(c.regress) && c.regress.length === 0 && Array.isArray(c.edits) && c.edits.length > 0 && c.fixed_count > 0
  const coverage = (d, size) => {
    if ((d.widths || []).some(w => `${w.w}x${w.h}` === size)) return ''
    if (d.kind === 'design') return '이 크기에서는 시안 값 비교를 하지 않았습니다. 기준 시안 크기에서 확인하세요. '
    if (d.kind === 'interact') return '이 크기에서는 눌러 보기 검사를 하지 않았습니다. 검사한 크기에서 확인하세요. '
    return '이 크기에서는 이 결함이 나오지 않았습니다. '
  }
  const progress = (j, now = Date.now()) => {
    const p = j.progress || {}; const pipeline = j.pipeline || {}; const all = p.stages || {}; const tasks = Object.values(p.tasks || {}).filter(t => t.side !== 'verify' && typeof t.size === 'string').map(t => ({ ...t }))
    const labels = [['prepare', '준비'], ['measure', '화면 크기'], ['design', 'Figma 비교'], ['interact', '눌러 보기'], ['verify', '재측정 · 비교'], ['judge', '문제 설명']]
    if (!j.running) for (const t of tasks) if (['running', 'pending'].includes(t.status)) t.status = 'cancelled'
    const modelPhase = ['ready', 'search', 'model', 'validate'].includes(pipeline.phase)
    const stages = labels.map(([key, label]) => {
      let status = (all[key] || {}).status || 'pending'
      if (key === 'verify' && all.cause && all.cause.status === 'running') status = 'running'
      if (key === 'judge') status = pipeline.state === 'succeeded' ? (pipeline.report === 'skipped' || pipeline.report_enabled === false || ((j.manifest || {}).summary && !(j.manifest.summary.new + j.manifest.summary.worsened + j.manifest.summary.no_base)) ? 'skipped' : 'done') : modelPhase && pipeline.state === 'running' ? 'running' : ['failed', 'cancelled', 'timeout'].includes(pipeline.state) ? 'incomplete' : 'pending'
      if (!j.running && status === 'running') status = 'incomplete'
      return { key, label, status, text: { pending: j.running ? '대기' : '미실행', running: '진행 중', done: '완료', skipped: '생략', failed: '실패', incomplete: '미완료' }[status] || '대기' }
    })
    let message = modelPhase || pipeline.phase === 'connect' ? pipeline.message : (all[p.phase] || {}).message || pipeline.message || '검사를 준비하고 있습니다'
    if (pipeline.phase === 'model' && pipeline.state === 'running') message = pipeline.model_loaded === false ? '모델 노드 실행 중 · 모델을 메모리에 불러오거나 요청이 처리되기를 기다리고 있습니다' : pipeline.model_loaded === true ? 'Gemma가 측정 사실에 근거한 문제 설명을 작성하고 있습니다' : 'Gemma 응답을 기다리고 있습니다. 모델 적재 상태를 확인하고 있습니다'
    if (!j.running && pipeline.message) message = pipeline.message
    const start = Date.parse(pipeline.started_at || p.started_at || (j.manifest || {}).started_at)
    const end = !j.running && pipeline.finished_at ? Date.parse(pipeline.finished_at) : now
    return { stages, tasks, message, elapsed: Number.isFinite(start) ? Math.max(0, Math.round((end - start) / 1000)) : 0,
      total: tasks.length, done: tasks.filter(t => t.status === 'done').length, failed: tasks.filter(t => t.status === 'failed').length }
  }
  const state = { incomplete, reporter, validCombined, coverage, progress }
  if (typeof module !== 'undefined') module.exports = state
  else root.DqaState = state
})(typeof window !== 'undefined' ? window : null)
