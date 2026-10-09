// 변경 전(base)과 후(head)의 결함 비교. 같은 화면·같은 규칙이고 요소 지문이 하나라도 겹치면 같은 결함으로 본다.
// 상태: new(새로 생김) / worsened(2px 넘게 커짐) / unchanged(그대로) / improved(줄었지만 남음) / resolved(사라짐)
const path = require('path')
const { STATE, readJSON, writeJSON } = require('../core/util')

const same = (a, b) => a.screen === b.screen && a.rule === b.rule && a.fps.some((f) => b.fps.includes(f))

function compare (baseDefects, headDefects) {
  const used = new Set()
  for (const h of headDefects) {
    const i = baseDefects.findIndex((b, k) => !used.has(k) && same(b, h))
    if (i < 0) { h.diff = { status: 'new', base_px: null }; continue }
    used.add(i)
    const b = baseDefects[i]
    const d = h.max_px - b.max_px
    h.diff = { status: d > 2 ? 'worsened' : d < -2 ? 'improved' : 'unchanged', base_px: b.max_px, base_id: b.id }
  }
  const resolved = baseDefects.filter((b, k) => !used.has(k)).map((b) => ({ ...b, diff: { status: 'resolved', base_px: b.max_px } }))
  return { resolved }
}

// 사용자가 "무시(오탐)"로 분류한 결함. 같은 화면·규칙·지문이면 다음 실행에서 접는다.
const ACCEPT = path.join(STATE, 'accept.json')
const loadAccept = () => readJSON(ACCEPT, [])
function addAccept (entry) {
  const list = loadAccept()
  if (!list.some((a) => a.screen === entry.screen && a.rule === entry.rule && a.fps.join('|') === entry.fps.join('|'))) list.push({ ...entry, at: new Date().toISOString() })
  writeJSON(ACCEPT, list)
  return list.length
}
function removeAccept (entry) {
  const list = loadAccept().filter((a) => !(a.screen === entry.screen && a.rule === entry.rule && a.fps.some((f) => entry.fps.includes(f))))
  writeJSON(ACCEPT, list)
  return list.length
}
function applyAccept (defects) {
  const list = loadAccept()
  for (const d of defects) { const a = list.find((x) => same(x, d)); if (a) d.accepted = { note: a.note || '', at: a.at } }
}

module.exports = { compare, loadAccept, addAccept, removeAccept, applyAccept, ACCEPT }
