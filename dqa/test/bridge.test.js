// Dify 보고서 에이전트 다리 시험: LLM 답 꺼내기, 숫자·근거 검증과 저장(지어낸 숫자·근거 ID는 저장하지 않는다)
const { test, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { RUNS } = require('../core/util')
const { parseAnswer, judgeSave, factsFor } = require('../dify/bridge')

const id = `test-bridge-${process.pid}`
const dir = path.join(RUNS, id)
after(() => fs.rmSync(dir, { recursive: true, force: true }))
const cfg = { dify: { llm_model: 'test-model', facts_max: 3, unload_after: false }, serve: { port: 8792 }, ollama: { url: 'http://127.0.0.1:1' } }
const defect = (did, rule, extra) => ({ id: did, rule, rule_name: '색 다름', severity: '중간', screen: 'local/home', kind: 'design', labels: ['신청하기'], widths: [{ w: 375, h: 812, px: 26, text: '배경색: 시안 #3D5AFE, 구현 #3366FF', shot: 'shots/a.png' }], evidence: [{ id: 'M1', text: '배경색: 시안 #3D5AFE, 구현 #3366FF' }], design: { node: { name: 'CTA' }, values: [{ prop: 'background-color', design: '#3D5AFE', impl: '#3366FF' }] }, ...extra })

test('LLM 답 꺼내기: 코드 울타리·앞뒤 말·{items:[…]}', () => {
  assert.deepStrictEqual(parseAnswer('여기 있습니다\n```json\n[{"id":"a"}]\n```'), [{ id: 'a' }])
  assert.deepStrictEqual(parseAnswer('{"items":[{"id":"b"}]}'), [{ id: 'b' }])
  assert.strictEqual(parseAnswer('JSON 없음'), null)
})

test('검증과 저장: 사실에 있는 숫자·검색된 근거 ID·측정 번호만 통과, 지어낸 숫자는 거부', async () => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'defects.json'), JSON.stringify([defect('d-1', 'D2'), defect('d-2', 'D2', { labels: ['다음'] })]))
  const f = factsFor(id, cfg)
  assert.deepStrictEqual(f.ids, ['d-1', 'd-2']); assert.match(f.facts, /시안 #3D5AFE/); assert.strictEqual(f.shots.length, 2)
  const answer = JSON.stringify([
    { id: 'd-1', verdict: '결함', problem: '버튼 배경이 #3366FF로 시안 #3D5AFE와 다르다', expected: '시안 토큰 색을 쓴다', reason: '색 차이', basis: ['M1', '[P02-004]', '[O12-002]', '측정 375x812'] },
    { id: 'd-2', verdict: '결함', problem: '버튼이 48px 높이다', expected: '시안대로', reason: '높이', basis: [] }
  ])
  const r = await judgeSave({ run_id: id, answer, context: '[P02-004] 색 토큰 대응표' }, cfg)
  assert.strictEqual(r.saved, 1)
  assert.deepStrictEqual(r.items[0].basis, ['측정 M1', '[P02-004]', '측정 375x812'])
  assert.deepStrictEqual(r.rejected.map((x) => x.id), ['d-2']); assert.match(r.rejected[0].why, /48/)
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'defects.json'), 'utf8'))
  assert.strictEqual(saved[0].judge.source, 'dify'); assert.strictEqual(saved[0].judge.status, 'ok'); assert.strictEqual(saved[1].judge.status, 'fallback')
})
