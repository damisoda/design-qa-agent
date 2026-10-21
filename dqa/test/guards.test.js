const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path'); const os = require('os'); const http = require('http')
const { RUNS, writeJSON, sha1, loadConfig } = require('../core/util')
const { launch, newContext } = require('../measure/browser')
const { numbersOk } = require('../judge/ollama')
const { applyFix } = require('../fix/apply')
const { makePr } = require('../fix/pr')
const { judgeSave } = require('../dify/bridge')
const { checkDestination } = require('../interact/expected')
const { parseSizes } = require('../core/run')
const cleanup = []
after(() => cleanup.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-guard-')); cleanup.push(d); return d }
const fixture = (suffix, combined) => {
  const id = `test-guard-${process.pid}-${suffix}`; const dir = path.join(RUNS, id); cleanup.push(dir)
  const project = tmp(); fs.writeFileSync(path.join(project, 'style.css'), 'red')
  writeJSON(path.join(dir, 'manifest.json'), { run_id: id, local: { project }, targets: { head: { kind: 'repo' } } })
  writeJSON(path.join(dir, 'fix', 'fixes.json'), { items: [], combined })
  fs.writeFileSync(path.join(dir, 'fix', 'fix_all.patch'), 'test patch')
  return { id, dir, project }
}
const combined = () => ({ ok: true, build_ok: true, failed_sizes: 0, regress: [], fixed_count: 1, edits: [{ file: 'style.css', find: 'red', replace: 'blue' }], before_sha1: { 'style.css': sha1('red') } })

test('근거 없는 작은 숫자도 검증을 통과하지 않는다', () => {
  assert.equal(numbersOk(['9px'], '26px').ok, false)
  assert.equal(numbersOk(['0px'], '26px').ok, false)
  assert.equal(numbersOk(['26px'], '26px').ok, true)
})
test('Dify 저장도 근거 없는 9px을 거부한다', async () => {
  const id = `test-guard-${process.pid}-number`; const dir = path.join(RUNS, id); cleanup.push(dir)
  writeJSON(path.join(dir, 'defects.json'), [{ id: 'd', rule: 'R1', rule_name: '넘침', screen: 'local/home', labels: ['요소'], widths: [{ w: 375, h: 812, px: 26, text: '26px 넘침' }], evidence: [{ id: 'M1', text: '26px 넘침' }] }])
  const out = await judgeSave({ run_id: id, context: '', answer: JSON.stringify([{ id: 'd', verdict: '결함', problem: '9px 넘침', expected: '넘침을 없앤다', reason: '측정', basis: ['M1'] }]) }, { dify: { llm_model: 'test', facts_max: 3, unload_after: false }, serve: { port: 8792 } })
  assert.equal(out.saved, 0); assert.match(out.rejected[0].why, /9/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'defects.json')))[0].judge.status, 'fallback')
})
for (const [name, change] of Object.entries({ '실패': { ok: false }, '빌드 실패': { build_ok: false }, '부분 측정 실패': { failed_sizes: 1 }, '회귀': { regress: [{ id: 'new' }] }, '해결 없음': { fixed_count: 0 } })) {
  test(`적용·PR: ${name} 묶음은 확인 문구 전에 거부`, async () => {
    const f = fixture(name, { ...combined(), ...change })
    assert.throws(() => applyFix({ run: f.id }, { forbidden_paths: [] }), /검증이 성공하지/)
    await assert.rejects(makePr({ run: f.id }, { forbidden_paths: [] }), /검증이 성공하지/)
    assert.equal(fs.readFileSync(path.join(f.project, 'style.css'), 'utf8'), 'red')
    assert.equal(fs.existsSync(path.join(f.dir, 'fix', 'backup')), false)
  })
}
test('성공한 묶음도 확인 문구 없이는 미리보기만, 이후 바뀐 파일은 거부', () => {
  const f = fixture('valid', combined()); const out = applyFix({ run: f.id }, { forbidden_paths: [] })
  assert.equal(out.applied, false); assert.equal(out.plan.length, 1)
  assert.equal(fs.readFileSync(path.join(f.project, 'style.css'), 'utf8'), 'red')
  fs.writeFileSync(path.join(f.project, 'style.css'), 'red /* user change */')
  assert.throws(() => applyFix({ run: f.id }, { forbidden_paths: [] }), /바뀐 파일/)
})
test('요청 허용은 정확한 출처로 비교하고 POST는 같은 출처에서도 대역 처리', async () => {
  let route; const fake = { newContext: async () => ({ addInitScript: async () => {}, route: async (_, fn) => { route = fn }, routeWebSocket: async () => {} }) }
  await newContext(fake, { origin: 'http://127.0.0.1:8792', width: 375, height: 812, allowHosts: ['https://fonts.example.test'] })
  const decide = async (url, method = 'GET') => {
    let result
    await route({ request: () => ({ url: () => url, method: () => method, resourceType: () => 'fetch' }), continue: () => { result = 'continue' }, abort: () => { result = 'abort' }, fulfill: () => { result = 'stub' } })
    return result
  }
  assert.equal(await decide('http://127.0.0.1:87920/leak'), 'abort')
  assert.equal(await decide('https://fonts.example.test.attacker.test/leak'), 'abort')
  assert.equal(await decide('https://fonts.example.test/font.woff2'), 'continue')
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(await decide('http://127.0.0.1:8792/write', m), 'stub')
})
test('실제 크롬: 초기 화면의 쓰기 요청은 서버에 도달하지 않고 GET·stub은 유지', async () => {
  let received = 0
  const srv = http.createServer((req, res) => {
    if (req.method !== 'GET') received++
    res.setHeader('Content-Type', 'text/html')
    res.end(`<meta name="viewport" content="width=device-width"><script>window.results=Promise.all(['POST','PUT','PATCH','DELETE'].map(method=>fetch('/write',{method}).then(r=>r.json()))).then(r=>window.done=true)</script>화면`)
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const browser = await launch(); const writes = []; const origin = `http://127.0.0.1:${srv.address().port}`
  try {
    const ctx = await newContext(browser, { origin, width: 375, height: 812, writes })
    const page = await ctx.newPage(); await page.goto(origin); await page.waitForFunction(() => window.done)
    assert.equal(received, 0); assert.equal(writes.length, 4)
    await ctx.close()
  } finally { await browser.close(); await new Promise((r) => srv.close(r)) }
})
test('로컬 기본 크기는 소개한 mobile5와 일치한다', () => {
  const cfg = loadConfig()
  assert.deepEqual(parseSizes(null, require('../recipes/local/home.json'), cfg), [[375, 812], [390, 844], [430, 932], [375, 667], [320, 568]])
})
test('프로토타입: 경로·주소·목적지 글자를 비교하고 정보가 없으면 확인 불가', () => {
  const obs = { before_url: 'http://127.0.0.1:3000/', url: 'http://127.0.0.1:3000/wrong', body_text: '엉뚱한 화면' }
  assert.equal(checkDestination([{ type: 'NODE', dest: 'right' }], { prototype_targets: { right: { name: '완료', route: '/right' } } }, obs).status, 'mismatch')
  assert.equal(checkDestination([{ type: 'URL', url: '/right' }], {}, obs).status, 'mismatch')
  const spec = { nodes: [{ text: { content: '공통 메뉴' } }], prototype_targets: { right: { name: '완료', texts: ['공통 메뉴', '주문이 완료되었습니다'] } } }
  assert.equal(checkDestination([{ type: 'NODE', dest: 'right' }], spec, obs).status, 'mismatch')
  assert.equal(checkDestination([{ type: 'NODE', dest: 'right' }], spec, { ...obs, body_text: '공통 메뉴 주문이 완료되었습니다' }).status, 'matched')
  assert.equal(checkDestination([{ type: 'NODE', dest: 'right' }], {}, obs).status, 'unverified')
})

test('Dify 상태: 불완전한 검사는 ok=false와 실패 상태를 전달', () => {
  const id = `test-guard-${process.pid}-status`; const dir = path.join(RUNS, id); cleanup.push(dir)
  writeJSON(path.join(dir, 'manifest.json'), { status: 'incomplete' })
  writeJSON(path.join(dir, 'summary.json'), { exit_code: 2, summary: { failed_sizes: 1 }, defects: [] })
  const { runStatus } = require('../server/http')
  const out = runStatus(id, { serve: { port: 8792 } })
  assert.equal(out.ok, false); assert.equal(out.error_type, 'incomplete'); assert.equal(out.check.status, 'incomplete')
  assert.equal(out.check.exit_code, 2); assert.equal(out.check.summary.failed_sizes, 1)
})

test('Dify 저장: 무반응에 대한 가림 추측은 버리고 관측 사실 설명만 보존', async () => {
  const id = `test-guard-${process.pid}-occlusion`; const dir = path.join(RUNS, id); cleanup.push(dir)
  writeJSON(path.join(dir, 'defects.json'), [{ id: 'd', rule: 'I1', rule_name: '눌러도 반응 없음', screen: 'local/home', labels: ['다음'], interact: { covered_by: null }, widths: [{ w: 375, h: 812, px: 1, text: '눌러도 아무 반응이 없다' }], evidence: [{ id: 'M1', text: '주소·화면 변화 없음' }] }])
  const cfg = { dify: { llm_model: 'test', facts_max: 3, unload_after: false }, serve: { port: 8792 } }
  const answer = { id: 'd', verdict: '결함', problem: '다른 요소에 의해 가려져 눌리지 않는 상황입니다', expected: '누르면 화면이 바뀌어야 한다', reason: '무반응', basis: ['M1'] }
  const rejected = await judgeSave({ run_id: id, context: '', answer: JSON.stringify([answer]) }, cfg)
  assert.equal(rejected.saved, 0); assert.match(rejected.rejected[0].why, /가림/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'defects.json')))[0].judge.status, 'fallback')
  answer.problem = '눌러도 주소와 화면에 변화가 없습니다'
  const accepted = await judgeSave({ run_id: id, context: '', answer: JSON.stringify([answer]) }, cfg)
  assert.equal(accepted.saved, 1); assert.equal(accepted.rejected.length, 0)
})
