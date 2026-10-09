// 측정 규칙 단위 시험: 결함을 심은 페이지에서 해당 규칙이 잡히고, 깨끗한 페이지에서는 아무것도 안 잡히는지.
const { test, before, after } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { launch, newContext } = require('../measure/browser')
const { serveDist } = require('../targets/static')
const { dqaScan } = require('../measure/inpage')

let browser; let srv
before(async () => { browser = await launch(); srv = await serveDist(path.join(__dirname, 'fixtures')) })
after(async () => { await browser.close(); srv.close() })

async function scan (page, w = 375, h = 812) {
  const ctx = await newContext(browser, { origin: srv.origin, width: w, height: h })
  const p = await ctx.newPage()
  await p.goto(`${srv.origin}/${page}`)
  const out = await p.evaluate(dqaScan, { root: '#root', final: true })
  await ctx.close()
  return out
}
const rules = (out) => [...new Set(out.issues.map((i) => i.rule))]

test('깨끗한 페이지에서는 결함 0건', async () => {
  const out = await scan('index.html')
  assert.deepStrictEqual(out.issues.map((i) => `${i.rule} ${i.text}`), [])
})
test('R1 넘침: min-width auto 입력칸 3개가 300px 줄을 넘침 + 진단', async () => {
  const out = await scan('r1.html')
  assert.ok(rules(out).includes('R1'), JSON.stringify(rules(out)))
  assert.ok(out.issues.some((i) => i.rule === 'R1' && i.diag && i.diag.code === 'flex_min_auto'))
})
test('R2 잘림: overflow hidden 상자 안의 긴 글', async () => {
  assert.ok(rules(await scan('r2.html')).includes('R2'))
})
test('R3 겹침: 글자끼리, 글자와 얇은 막대', async () => {
  const out = await scan('r3.html')
  assert.ok(out.issues.some((i) => i.rule === 'R3' && i.other && i.other.kind === 'text'))
  assert.ok(out.issues.some((i) => i.rule === 'R3' && i.other && i.other.kind === 'bar'))
})
test('R4 가려짐: 화면 아래 고정 탭바가 버튼을 덮음', async () => {
  const out = await scan('r4.html')
  assert.ok(out.issues.some((i) => i.rule === 'R4' && i.el.label.includes('신고 접수하기')), JSON.stringify(rules(out)))
})
test('R6 줄바꿈: 좁은 상자의 두 글자 라벨', async () => {
  const out = await scan('r6.html')
  assert.ok(out.issues.some((i) => i.rule === 'R6' && i.diag && i.diag.code.startsWith('narrow_box')))
})
test('R7 틀 이탈: 430 화면에서 375 앱 틀 밖으로 나간 시트', async () => {
  assert.ok(rules(await scan('r7.html', 430, 932)).includes('R7'))
})
