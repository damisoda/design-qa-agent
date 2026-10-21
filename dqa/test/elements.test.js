const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const os = require('os'); const path = require('path'); const vm = require('vm')
const { figmaLink, createFigmaConnection } = require('../design/connection')
const { inspectionStore, readInspections } = require('../core/inspection')
const { rectPercent, groupRows } = require('../ui/inspection')
const { launch, newContext } = require('../measure/browser')
const { serveDist } = require('../targets/static')
const { dqaScan } = require('../measure/inpage')
const { dqaDesignDom } = require('../design/extract')
const { compareDesign, compareDesignLive } = require('../design/compare')
const root = path.resolve(__dirname, '../../eval/fresh-20261014')
let browser; let srv
before(async () => { browser = await launch(); srv = await serveDist(path.join(root, 'screens/atelier/bad')) })
after(async () => { await browser.close(); srv.close() })
test('앱 링크: Figma만 열고 추적 쿼리·다른 호스트·명령 입력을 거부한다', () => {
  const link = figmaLink('https://www.figma.com/design/AbCd123/Screen?node-id=5-21&t=secret')
  assert.equal(link.node_id, '5:21'); assert.equal(link.desktop, 'figma://file/AbCd123?node-id=5-21'); assert.ok(!link.url.includes('secret'))
  for (const url of ['https://figma.com.evil.test/design/AbCd123', 'file:///tmp/a.fig', 'https://user:pass@figma.com/design/AbCd123', 'https://figma.com/design/AbCd123?node-id=$(open)']) assert.throws(() => figmaLink(url))
})
test('프레임 가져오기: 실제 선택·파일·요청 ID가 일치해야 하고 재전송도 같은 이름이다', async () => {
  const c = createFigmaConnection(async () => {}); const j = await c.connect({ url: '' })
  const client = { client_id: 'test-client-01', file: '실제 파일', page: 'Page 1', frames: [{ id: '5:21', name: 'Atelier', w: 375, h: 812 }] }
  c.poll(client); assert.throws(() => c.importSelection({ session_id: 'wrong', client_id: client.client_id }))
  c.importSelection({ session_id: j.session.id, client_id: client.client_id })
  const command = c.poll(client).command
  const body = { session_id: j.session.id, client_id: client.client_id, request_id: command.id }
  const item = { spec: { file: client.file, frame: { id: '5:21', name: 'Atelier' }, figma: {} } }
  assert.throws(() => c.decorate({ ...body, request_id: 'wrong' }, item))
  assert.throws(() => c.decorate(body, { spec: { ...item.spec, frame: { id: '5:44', name: 'Shelf' } } }))
  const out = c.decorate(body, item); c.imported(body, [{ name: out.name }])
  assert.equal(c.snapshot().session.state, 'ready'); assert.equal(c.decorate(body, item).name, out.name)
  assert.equal(out.spec.figma.link_verified, false)
  c.poll({ ...client, file: '다른 파일' }); await assert.rejects(() => c.focus(out.spec, '5:38'))
})
test('플러그인 실패 응답: 가져오기 성공으로 표시하지 않고 실패 원인을 보존한다', async () => {
  const c = createFigmaConnection(async () => {}); const j = await c.connect({}); const client = { client_id: 'test-client-02', file: '파일', frames: [{ id: '5:21', w: 375, h: 812 }] }
  c.poll(client); c.importSelection({ session_id: j.session.id, client_id: client.client_id }); const command = c.poll(client).command
  c.poll({ ...client, ack: { id: command.id, ok: false, error: '내보내기 실패' } })
  assert.equal(c.snapshot().session.state, 'error'); assert.equal(c.snapshot().session.error, '내보내기 실패')
})
test('초기 연결: UUID API가 없는 Figma iframe에서도 선택 요청과 실제 폴링을 시작한다', async () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../figma-plugin/ui.html'), 'utf8')
  const elements = {}; const messages = []; const calls = []
  const context = vm.createContext({ document: { getElementById: id => elements[id] || (elements[id] = { value: 'http://localhost:8792' }) }, parent: { postMessage: m => messages.push(m) }, setInterval: () => {}, fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true }) } }, console })
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context); await new Promise(resolve => setImmediate(resolve))
  assert.equal(messages[0].pluginMessage.type, 'selection'); assert.equal(calls.length, 1); assert.match(calls[0].body.client_id, /^dqa-/)
})
test('요소 기록: 실제 시작·완료를 같은 요소로 묶고 불완전한 마지막 줄은 무시한다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-inspect-')); const run = { file: p => path.join(dir, p) }; const state = {}; const store = inspectionStore(run, state)
  try {
    const ctx = { phase: 'measure', side: 'head', screen: 'home', size: '375x812' }; const row = { test: 'A2', ordinal: 1, element: { path: 'input' } }
    store.record(ctx, { ...row, status: 'checking' }); store.record(ctx, { ...row, status: 'checked' }); store.record(ctx, { ...row, variant: 'placeholder', status: 'checked' })
    fs.appendFileSync(run.file('inspections.jsonl'), '{unfinished')
    const records = readInspections(run.file('inspections.jsonl')); assert.equal(records.length, 2); assert.equal(records[0].status, 'checked'); assert.equal(records[1].seq, 3)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
test('강조 영역: 화면 밖 좌표는 잘라 표시하고 검사하지 않은 크기에 기록을 복사하지 않는다', () => {
  assert.deepEqual(rectPercent({ left: -10, top: 10, width: 30, height: 20 }, 100, 100), { left: 0, top: 10, width: 20, height: 20 })
  assert.equal(rectPercent({ left: 120, top: 10, width: 10, height: 10 }, 100, 100), null)
  assert.equal(rectPercent({ left: NaN, top: 10, width: 10, height: 10 }, 100, 100), null)
  const rows = [{ phase: 'design', side: 'head', size: '375x812', seq: 1, figma: { id: '5:38' } }]
  assert.equal(groupRows(rows, '320x568', 'design').length, 0); assert.equal(groupRows(rows, '375x812', 'design').length, 1)
})
test('실제 Chrome: 이벤트 표시를 켜도 넘침·대비 등 측정 판정은 동일하다', async () => {
  const ctx = await newContext(browser, { origin: srv.origin, width: 375, height: 812 }); const page = await ctx.newPage(); const events = []
  try {
    await page.goto(srv.origin); await page.evaluate(() => document.fonts.ready)
    const plain = await page.evaluate(dqaScan, { root: '#root', first: true, final: true })
    await page.exposeBinding('__trace', (_, row) => events.push(row))
    const traced = await page.evaluate(dqaScan, { root: '#root', first: true, final: true, trace: '__trace' })
    assert.deepEqual(traced, plain); assert.ok(events.some(e => e.test === 'G1'))
    assert.ok(events.some(e => e.status === 'checking')); assert.ok(events.some(e => e.status === 'checked' && e.element.box.width > 0))
    assert.equal(events.filter(e => e.status === 'checking').length, events.filter(e => e.status === 'checked').length)
  } finally { await ctx.close() }
})
test('실제 Figma 내보내기 + 로컬 Chrome: 진행 콜백 전후 시안 비교 판정과 노드 ID가 동일하다', async () => {
  const ctx = await newContext(browser, { origin: srv.origin, width: 375, height: 812 }); const page = await ctx.newPage()
  try {
    await page.goto(srv.origin); await page.evaluate(() => document.fonts.ready)
    const dom = await page.evaluate(dqaDesignDom, { widths: true }); const spec = JSON.parse(fs.readFileSync(path.join(root, 'actual-figma/atelier/design.json')))
    const plain = compareDesign(spec, dom, null); const events = []; const live = await compareDesignLive(spec, dom, null, {}, null, async row => events.push(row))
    assert.deepEqual(live, plain)
    const cta = events.find(e => e.test === 'design-final' && e.figma.name === 'CTA')
    assert.ok(cta); assert.equal(cta.figma.id, '5:38'); assert.equal(cta.figma.box.width, 335); assert.equal(cta.element.box.width, 220)
    assert.ok(cta.findings.some(f => f.rule === 'D2')); assert.ok(events.some(e => e.status === 'checking'))
  } finally { await ctx.close() }
})

test('미측정·중단 문구: 완료 후 다른 크기의 기록을 기다린다고 표시하지 않는다', () => {
  const { emptyMessage, statusLabel } = require('../ui/inspection')
  const rows = [{ side: 'head', phase: 'design', size: '375x812' }]
  assert.match(emptyMessage(rows, '320x568', 'design', false), /실행하지 않았습니다/)
  assert.match(emptyMessage([], '320x568', 'design', false), /기록이 없습니다/)
  assert.match(emptyMessage([], '320x568', 'design', true), /기다리고/)
  assert.equal(statusLabel({ status: 'checking' }, false, 0), '완료 여부 확인 안됨')
  assert.equal(statusLabel({ status: 'interrupted' }, false, 0), '검사 중단')
})

test('요소 보기: Figma 앱을 앞으로 열고 플러그인의 실제 선택 확인을 받는다', async () => {
  const opens = []; const c = createFigmaConnection(async link => opens.push(link))
  await c.connect({}); const client = { client_id: 'test-client-03', file: '파일', frames: [] }; c.poll(client)
  const result = await c.focus({ file: client.file, figma: { client_id: client.client_id } }, '5:38')
  assert.deepEqual(opens, [null, null]); assert.equal(c.poll(client).command.node_id, '5:38')
  c.poll({ ...client, ack: { id: result.request_id, ok: true, node_id: '5:38', name: 'CTA' } })
  assert.equal(c.result(result.request_id).name, 'CTA'); assert.equal(c.poll(client).command, null)
})

test('actual Chrome content inventory survives wrapping and scrolling but detects parent hiding',async()=>{
 const ctx=await browser.newContext({viewport:{width:320,height:220}});const p=await ctx.newPage();
 try{await p.setContent('<style>p{width:180px;white-space:nowrap;font:24px/32px sans-serif}section{margin-top:300px}</style><p>A long product title which needs several lines</p><section><button>Buy</button><button>Buy</button></section>');
 const before=await p.evaluate(dqaScan,{});await p.addStyleTag({content:'p{white-space:normal}'});const wrapped=await p.evaluate(dqaScan,{});assert.deepEqual(wrapped.content,before.content);
 await p.evaluate(()=>scrollTo(0,document.body.scrollHeight));assert.deepEqual((await p.evaluate(dqaScan,{})).content,before.content);
 await p.addStyleTag({content:'section{opacity:0}'});const hidden=await p.evaluate(dqaScan,{});assert.equal(hidden.content.length,before.content.length-2);
 }finally{await ctx.close()}
})
