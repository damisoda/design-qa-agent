// 실제 작업 이벤트와 먼저 발견된 항목. 최종 결함·변경 판정과 분리한다.
const { writeJSON } = require('./util')
function createLive (run) {
  const state = { started_at: new Date(run.t0).toISOString(), phase: 'prepare', stages: {}, tasks: {}, preview: null }
  const inspections = require('./inspection').inspectionStore(run, state)
  const inspect = (context, payload) => inspections.record(context, payload)
  const save = () => { state.updated_at = new Date().toISOString(); writeJSON(run.file('progress.json'), state) }
  const stage = (name, status, message) => {
    state.phase = name; state.stages[name] = { status, message }; save()
    run.event('phase', message, { phase: name, status })
  }
  const task = (key, patch) => { state.tasks[key] = { ...(state.tasks[key] || {}), ...patch }; save() }
  const preview = (info) => { state.preview = { ...info, at: new Date().toISOString() }; save() }
  const publish = (defects) => writeJSON(run.file('preview.json'), { provisional: true, updated_at: new Date().toISOString(), defects })
  save()
  return { state, stage, task, preview, publish, inspect }
}
module.exports = { createLive }
