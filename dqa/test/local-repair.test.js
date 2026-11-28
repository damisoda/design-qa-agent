const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { compareDesign } = require('../design/compare')
const { applyRanges, lineEdit } = require('../fix/source-edit')
const { journeyDefects } = require('../recipes/journeys')
const { loadConfig } = require('../core/util')
const { profileConfig } = require('../workflow/local-repair')

test('런타임 문구는 연결한 노드의 스타일을 비교하며 누락된 요소를 통과시키지 않는다', () => {
  const node = { id: '1:1', type: 'TEXT', name: 'Price', x: 0, y: 0, w: 120, h: 24, text: { content: '₩58,000', fontSize: 16 } }
  const spec = { frame: { width: 375, height: 812 }, nodes: [node] }
  const box = { left: 0, top: 0, right: 120, bottom: 24, width: 120, height: 24 }
  const t = { i: 1, full: '₩73,500', label: '₩73,500', box, path: 'p', style: { fontSize: 24 } }
  const dom = { vw: 375, texts: [t], boxes: [], imgs: [], runtime_text: { '1:1': 1 } }
  const fixed = compareDesign(spec, dom, null).issues
  assert.equal(fixed.some(i => i.rule === 'T1' || i.rule === 'M1'), false)
  assert.equal(fixed.some(i => i.rule === 'D3' && i.prop === 'font-size'), true)
  assert.equal(compareDesign(spec, { ...dom, runtime_text: { '1:1': null } }, null).issues.some(i => i.rule === 'M1'), true)
})

test('두 크기에서 재현되는 동일 동작 실패는 하나의 수정 대상으로 정리한다', () => {
  const recipe = { id: 'shop/catalog', title: 'Catalog' }
  const common = { id: 'filter', ok: false, error: 'filter changed nothing', step: { expect: { selector: '.count', text: '2' } }, observed: '4' }
  const rows = journeyDefects([{ ...common, size: '320x700' }, { ...common, size: '1024x900' }], recipe)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].widths.length, 2)
  assert.match(rows[0].evidence[0].text, /"2".*"4"/)
})

test('줄 범위 수정은 원본이 바뀌거나 새 코드 문법이 잘못된 경우 거부한다', (t) => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-line-edit-'))
  t.after(() => fs.rmSync(srcRoot, { recursive: true, force: true }))
  const text = 'let a = 0;\nlet b = 0;\n'
  fs.writeFileSync(path.join(srcRoot, 'app.js'), text)
  const args = { file: 'app.js', start: 2, end: 2, replace: 'let b = 1;' }
  const ctx = { srcRoot, srcDir: '.' }
  const edit = lineEdit(args, ctx)
  assert.equal(applyRanges(text, [edit]), 'let a = 0;\nlet b = 1;\n')
  assert.throws(() => applyRanges(text.replace('a = 0', 'a = 2'), [edit]), /바뀌었습니다/)
  assert.throws(() => lineEdit({ ...args, replace: 'let = ;' }, ctx))
})

test('로컬 수정 프로필은 외부 Ollama 주소를 거부한다', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-profile-'))
  t.after(() => fs.rmSync(out, { recursive: true, force: true }))
  const f = path.join(out, 'profile.json')
  fs.writeFileSync(f, JSON.stringify({ local: out, recipes: ['fieldwork-repair/catalog'], ollama: { url: 'https://example.org', model: 'qwen3.5:4b' } }))
  assert.throws(() => profileConfig(f, loadConfig()), /루프백/)
})

test('코드 에이전트가 직접 읽은 줄로 실제 수정 후보를 전달한다', async (t) => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-agent-lines-'))
  t.after(() => fs.rmSync(srcRoot, { recursive: true, force: true }))
  fs.writeFileSync(path.join(srcRoot, 'app.js'), 'let filter = "All";\n')
  const ollama = require('../judge/ollama')
  const previous = ollama.askJSON
  const modulePath = require.resolve('../fix/agent')
  const actions = [
    { action: 'read', file: 'app.js', start: 1, end: 1 },
    { action: 'edit_lines', file: 'app.js', start: 1, end: 1, replace: 'let filter = "Craft";' }
  ]
  ollama.askJSON = async () => ({ ans: actions.shift() })
  delete require.cache[modulePath]
  const { codeAgent } = require(modulePath)
  ollama.askJSON = previous
  delete require.cache[modulePath]
  const defect = { id: 'filter', rule: 'J1', kind: 'journey', screen: 'shop', labels: ['filter'], widths: [], evidence: [], elements: [], causes: { candidates: [] } }
  const result = await codeAgent(defect, {
    cfg: { ollama: {}, fix: {} }, srcRoot, srcDir: '.', llm: true, modelOnly: true, say: () => {},
    tryEdits: async ([edit]) => {
      assert.equal(edit.find, 'let filter = "All";')
      assert.equal(edit.replace, 'let filter = "Craft";')
      return { ok: true, fixed: ['filter'] }
    }
  })
  assert.equal(result.verified, 0)
  assert.equal(result.attempts[0].source, 'llm')
})

test('수정 모델에 같은 런타임 요소의 서로 다른 응답과 정상 사례를 함께 제공한다', () => {
  const { relatedJourneyEvidence } = require('../recipes/journeys')
  const d = { screen: 'shop/detail', journey: { selector: '.price' } }
  const make = (id, expected, observed) => ({
    id, screen: d.screen, stubbed: [{ method: 'GET', path: '/api/price' }],
    assertions: [{ expected: { selector: '.price', text: expected }, observed }]
  })
  const cases = [make('a', '20', '10'), make('a', '20', '10'), make('b', '30', '10'), make('c', '10', '10')]
  assert.deepEqual(relatedJourneyEvidence(d, cases).map(r => [r.scenario, r.request[0].path, r.expected.text, r.observed]), [
    ['a', '/api/price', '20', '10'], ['b', '/api/price', '30', '10'], ['c', '/api/price', '10', '10']
  ])
})

test('줄 번호보다 교체 코드에 포함된 유일한 문맥이 명확하면 읽은 범위 안에서 다시 맞춘다', (t) => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-context-edit-'))
  t.after(() => fs.rmSync(srcRoot, { recursive: true, force: true }))
  const text = [
    'async function load() {', '  const response = await getQuote();',
    '  const quote = await response.json();', '  if (!quote) return;',
    '  field.textContent = money(mock.price);', '}', 'load();'
  ].join('\n')
  fs.writeFileSync(path.join(srcRoot, 'app.js'), text)
  const changed = text.replace('money(mock.price)', 'money(quote.price)')
  const replace = changed.split('\n').slice(0, 6).join('\n')
  const edit = lineEdit({ file: 'app.js', start: 2, end: 5, replace }, { srcRoot, srcDir: '.', readRanges: [[1, 7]] })
  assert.equal(edit.line, 1)
  assert.equal(applyRanges(text, [edit]), changed)
})
