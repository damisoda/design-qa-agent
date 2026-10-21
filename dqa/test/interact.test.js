// 눌러 보기 검사 시험: 반응 없는 버튼(I1), 오류(I2), 없는 페이지로 이동(I3)만 잡고, 반응이 있는 것은 잡지 않는다
const { test, before, after } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { launch } = require('../measure/browser')
const { serveDist } = require('../targets/static')
const { interactPass, designReactions } = require('../interact/probe')

let browser; let srv
before(async () => { browser = await launch(); srv = await serveDist(path.join(__dirname, 'fixtures')) })
after(async () => { await browser.close(); srv.close() })

const cfg = { timeouts: { step_ms: 3000, goto_ms: 10000, settle_ms: 3000 } }
const tmpRun = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-int-')); return { dir, file: (p) => path.join(dir, p) } }

test('눌러 보기: 반응 없음·오류·없는 페이지만 결함, 이동·열기·요청·체크·알림·스크롤은 정상', async () => {
  const spec = { nodes: [{ id: '9:1', name: 'Button/Save', type: 'FRAME', reactions: [{ trigger: 'ON_CLICK', actions: [{ type: 'NODE', navigation: 'NAVIGATE', dest: '9:9' }] }], children: [{ id: '9:2', name: 'label', type: 'TEXT', text: { content: '저장하기' } }] }] }
  const out = await interactPass(browser, { origin: srv.origin, recipe: { id: 'test/interact', start: { path: '/interact.html' } }, side: 'head', ref: 'test', run: tmpRun(), cfg, size: [375, 812], spec })
  const by = Object.fromEntries(out.results.map((r) => [r.label, r]))
  const v = (l) => (by[l] ? by[l].verdict || (by[l].skip ? 'skip' : 'ok') : 'missing')
  assert.deepStrictEqual({
    홈: v('홈'), 추천: v('추천'), '다음 화면': v('다음 화면'), '메뉴 열기': v('메뉴 열기'), 저장하기: v('저장하기'), '카드 보기': v('카드 보기'), 공유: v('공유'), '신청 마감': v('신청 마감'),
    좋아요: v('좋아요'), 더보기: v('더보기'), 결제: v('결제'), '주문 내역': v('주문 내역'), 확인: v('확인'), 도움말: v('도움말'), '맨 위로': v('맨 위로')
  }, { 홈: 'ok', 추천: 'skip', '다음 화면': 'ok', '메뉴 열기': 'ok', 저장하기: 'I1', '카드 보기': 'I1', 공유: 'I2', '신청 마감': 'skip', 좋아요: 'ok', 더보기: 'I1', 결제: 'I3', '주문 내역': 'I3', 확인: 'I1', 도움말: 'ok', '맨 위로': 'ok' })
  assert.ok(out.results.some((r) => r.tag === 'input' && !r.verdict), '체크박스는 정상')
  const save = out.defects.find((d) => d.labels[0] === '저장하기')
  assert.strictEqual(save.severity, '높음'); assert.match(save.widths[0].text, /시안의 연결: "Button\/Save" 누름 → 화면 9:9 이동/)
  assert.strictEqual(out.defects.find((d) => d.labels[0] === '카드 보기').severity, '사람 확인 필요')
  assert.ok(by['확인'].covered_by, '덮인 요소를 알려 준다')
  assert.strictEqual(out.counters.writes, 1, '쓰기 요청은 가짜 응답으로 막는다')
})

test('시안 프로토타입 연결: 버튼 이름과 안의 글자로 찾는다', () => {
  const m = designReactions({ nodes: [{ name: 'CTA', reactions: [{ actions: [{ type: 'BACK' }] }], children: [{ name: 't', text: { content: '돌아가기' } }] }] })
  assert.ok(m.get('돌아가기')); assert.ok(m.get('CTA'))
})

test('시안 목적지 비교: 다른 화면으로 이동하면 I4, 목적지 경로가 맞으면 정상', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-prototype-'))
  fs.writeFileSync(path.join(dir, 'index.html'), '<meta name="viewport" content="width=device-width"><button onclick="location.href=\'/wrong.html\'">다음</button>')
  fs.writeFileSync(path.join(dir, 'wrong.html'), '<h1>다른 목적지 화면</h1>')
  const site = await serveDist(dir)
  const spec = { nodes: [{ name: '다음', reactions: [{ trigger: 'ON_CLICK', actions: [{ type: 'NODE', dest: 'right', navigation: 'NAVIGATE' }] }] }], prototype_targets: { right: { name: '원래 목적지', route: '/right.html' } } }
  try {
    const wrong = await interactPass(browser, { origin: site.origin, recipe: { id: 'test/prototype', start: { path: '/' } }, side: 'head', ref: 'test', run: tmpRun(), cfg, size: [375, 812], spec })
    assert.equal(wrong.defects[0].rule, 'I4'); assert.match(wrong.defects[0].evidence[0].text, /right.html/)
    spec.prototype_targets.right.route = '/wrong.html'
    const right = await interactPass(browser, { origin: site.origin, recipe: { id: 'test/prototype', start: { path: '/' } }, side: 'head', ref: 'test', run: tmpRun(), cfg, size: [375, 812], spec })
    assert.deepEqual(right.defects, []); assert.equal(right.counters.prototype_matched, 1)
    delete spec.prototype_targets
    const unknown = await interactPass(browser, { origin: site.origin, recipe: { id: 'test/prototype', start: { path: '/' } }, side: 'head', ref: 'test', run: tmpRun(), cfg, size: [375, 812], spec })
    assert.equal(unknown.counters.prototype_unverified, 1)
  } finally { site.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})


test('prototype text includes displayed native input text, excludes hidden and replaced placeholders', async () => {
  const p=await browser.newPage()
  try {
    await p.setContent('<h1>Search</h1><input placeholder="Find a studio"><input placeholder="Hidden hint" style="display:none"><input value="Jamie" placeholder="Your name"><input type="password" value="secret"><select><option selected>Seoul</option></select>')
    const text=await p.evaluate(require('../interact/expected').destinationText)
    assert.ok(text.includes('Find a studio'));assert.ok(text.includes('Jamie'));assert.ok(text.includes('Seoul'))
    assert.ok(!text.includes('Hidden hint'));assert.ok(!text.includes('Your name'));assert.ok(!text.includes('secret'))
  }finally{await p.close()}
})
