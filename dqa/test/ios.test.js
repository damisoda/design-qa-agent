// 아이폰 사파리 측정 결과 → dqa 결함 변환(시뮬레이터 없이 도는 순수 함수 시험)
const test = require('node:test')
const assert = require('node:assert')
const { iosDefects, IOS_RULES } = require('../measure/ios')

const res = {
  device: 'iPhone 17 Pro', viewport: { w: 402, h: 714 },
  issues: [
    { source: 'scan', rule: 'R3', text: '설정' }, // 크롬에서 이미 재는 규칙은 넣지 않는다
    { source: 'ios', rule: 'K1', text: '메모', hidden_px: 75, keyboard_px: 233, shot: 'focus_1.png' },
    { source: 'ios', rule: 'Z1', text: '이름', font_px: 11, zoom: 1.455, shot: 'focus_2.png' },
    { source: 'ios', rule: 'Z1', text: '이름', font_px: 11, zoom: 1.455 }, // 같은 결함은 한 번만
    { source: 'ios', rule: 'G2', text: '◉', char: '◉', code: 'U+25C9' }
  ]
}

test('아이폰 결함: 폰 전용 규칙만 kind ios 결함으로, 같은 것은 하나로', () => {
  const ds = iosDefects(res, { screen: 'demo/form', side: 'head', ref: 'post', outRel: 'ios/head_demo_form' })
  assert.deepStrictEqual(ds.map((d) => d.rule), ['K1', 'Z1', 'G2'])
  for (const d of ds) { assert.strictEqual(d.kind, 'ios'); assert.ok(IOS_RULES[d.rule]); assert.match(d.id, /^demo-form-ios-/) }
  const k1 = ds[0]
  assert.strictEqual(k1.max_px, 75)
  assert.strictEqual(k1.widths[0].shot, 'ios/head_demo_form/focus_1.png')
  assert.match(k1.widths[0].text, /75px 가린다/)
  assert.match(ds[2].widths[0].shot, /screen\.png$/) // 캡처가 없으면 화면 전체 캡처
})

test('아이폰 결함 ID: 쪽(변경 전·후)이 달라도 같은 결함은 같은 ID라 비교가 된다', () => {
  const a = iosDefects(res, { screen: 'demo/form', side: 'base', ref: 'pre', outRel: 'x' })
  const b = iosDefects(res, { screen: 'demo/form', side: 'head', ref: 'post', outRel: 'y' })
  assert.deepStrictEqual(a.map((d) => d.id), b.map((d) => d.id))
})
