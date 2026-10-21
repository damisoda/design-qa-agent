// 검사를 지연시키지 않고 실제 요소 순회 이벤트를 기록한다. 최종 결함 판정과는 별개다.
const fs = require('fs'); const { writeJSON } = require('./util')
function inspectionStore (run, state) {
  let seq = 0; let lastSave = 0
  const record = (context, payload) => {
    const row = { ...context, ...payload, seq: ++seq, at: new Date().toISOString() }
    row.id = `${context.phase}/${context.side}/${context.screen}/${context.size}/${context.scroll_step || 0}/${payload.test}/${payload.variant || ""}/${payload.ordinal}`
    fs.appendFileSync(run.file('inspections.jsonl'), JSON.stringify(row) + '\n')
    state.inspection = row
    if (Date.now() - lastSave >= 100 || payload.status === 'interrupted') { lastSave = Date.now(); writeJSON(run.file('progress.json'), { ...state, updated_at: row.at }) }
    return row
  }
  return { record }
}
function readInspections (file) {
  if (!fs.existsSync(file)) return []
  const rows = new Map()
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    try { const row = JSON.parse(line); rows.set(row.id, row) } catch (e) {}
  }
  return [...rows.values()].sort((a, b) => a.seq - b.seq)
}
module.exports = { inspectionStore, readInspections }
