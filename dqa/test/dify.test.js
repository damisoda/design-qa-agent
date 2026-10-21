const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
test('Dify 선택 입력: 빈 값은 생략하고 불완전 검사에서는 LLM 경로를 막는다', () => {
  const out = JSON.parse(execFileSync('python3', ['-c', `import sys,json
sys.path.insert(0,${JSON.stringify(path.resolve(__dirname, '../dify'))})
from dify import normalize_inputs
from act_v5 import GATE_CODE
ns={};exec(GATE_CODE,ns)
r=ns['main'](json.dumps({'ok':True,'run_id':'r','check':{'exit_code':2,'summary':{'no_base':1,'failed_sizes':1}}}), '검사')
print(json.dumps({'inputs':normalize_inputs({'dist':'cbh-221-post','base_dist':'','recipe':None}), 'gate':r}))`], { encoding: 'utf8' }))
  assert.deepEqual(out.inputs, { dist: 'cbh-221-post' })
  assert.equal(out.gate.go, 0); assert.match(out.gate.base, /검사 불완전/)
})


test('무반응 보고서: 측정되지 않은 가림 원인은 숫자가 맞아도 거부', () => {
  const { unsupportedClaims } = require('../judge/grounding')
  const d = { rule: 'I1', interact: { covered_by: null } }
  assert.deepEqual(unsupportedClaims({ problem: '눌러도 아무 반응이 없다', reason: '주소와 화면 변화 없음' }, d), [])
  assert.equal(unsupportedClaims({ problem: '다른 요소에 의해 가려져 눌리지 않는 상황입니다' }, d).length, 1)
  assert.equal(unsupportedClaims({ problem: 'An overlay covered the button' }, d).length, 1)
  assert.deepEqual(unsupportedClaims({ problem: '다른 요소에 가려져 있다' }, { ...d, interact: { covered_by: 'overlay' } }), [])
})

 test('web interaction option accepts on/true and keeps off/false disabled', () => {
 const { toArgs } = require('../server/http')
 const cfg = {dists:{fixture:{}}, profiles:{}}
 for(const value of ['off',false,undefined]) assert.equal(toArgs({kind:'dist',dist:'fixture',recipes:['fieldwork/catalog'],interact:value},cfg).includes('--interact'),false)
 for(const value of ['on',true]) assert.equal(toArgs({kind:'dist',dist:'fixture',recipes:['fieldwork/catalog'],interact:value},cfg).includes('--interact'),true)
 })
