const { test } = require('node:test')
const assert = require('node:assert/strict')
const { incomplete, reporter, validCombined } = require('../ui/state')
test('웹 상태: 일부 실패와 Dify 외부 보고서 저장을 검사 상태에 반영', () => {
  assert.equal(incomplete({ status: 'incomplete', summary: { no_base: 2 } }), true)
  assert.equal(incomplete({ summary: { failed_sizes: 1, no_base: 0 } }), true)
  assert.equal(incomplete({ status: 'complete', exit_code: 0, summary: { failed_sizes: 0 } }), false)
  const d = { judge: { status: 'ok', source: 'dify', model: 'Gemma' } }
  assert.match(reporter({ llm: { mode: 'off', status: 'off' } }, [d]), /Dify.*Gemma.*1건/)
  assert.match(reporter({ llm: { status: 'off' } }, [{ judge: { status: 'fallback', source: 'dify' } }]), /사용 안 함/)
})
test('웹 적용: 실패·빌드 실패·측정 누락·회귀·빈 패치는 활성화 대상이 아니다', () => {
  const c = { ok: true, build_ok: true, failed_sizes: 0, regress: [], edits: [{ file: 'style.css' }], fixed_count: 1 }
  assert.equal(validCombined(c), true)
  for (const change of [{ ok: false }, { build_ok: false }, { failed_sizes: 1 }, { regress: [{}] }, { edits: [] }, { fixed_count: 0 }]) assert.equal(validCombined({ ...c, ...change }), false)
})


test('웹 크기별 설명: 시안·클릭 미측정을 결함 없음과 구분', () => {
  const { coverage } = require('../ui/state')
  const d = { kind: 'design', widths: [{ w: 375, h: 812 }] }
  assert.equal(coverage(d, '375x812'), '')
  assert.match(coverage(d, '320x568'), /비교를 하지 않았습니다/)
  assert.match(coverage({ ...d, kind: 'interact' }, '320x568'), /검사를 하지 않았습니다/)
  assert.match(coverage({ ...d, kind: 'rule' }, '320x568'), /나오지 않았습니다/)
})
