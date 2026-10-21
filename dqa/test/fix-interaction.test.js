const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { launch } = require('../measure/browser')
const { loadConfig, createRun, RUNS } = require('../core/util')
const { measureBuild, judgeAfter } = require('../fix/fix')

test('수정 재검증: 배치가 같아도 CSS가 버튼 클릭을 막으면 동작 회귀로 거부', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-fix-click-'))
  const id = `test-fix-click-${process.pid}`; const run = createRun('test', id); const cfg = loadConfig()
  const recipe = { id: 'local/home', start: { path: '/' }, steps: [], ready: { stable_ms: 100 }, allow_hosts: [], scan: { root: 'body', scroll: 'none', ignore: [] } }
  const page = (blocked) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:20px}button{width:335px;height:48px;border:0;background:#2459D3;color:white;}${blocked ? '@media(max-width:330px){button{pointer-events:none}}' : ''}</style><button onclick="document.querySelector('p').textContent='Done'">Continue</button><p>Ready</p>`
  const browser = await launch()
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), page(false))
    const before = await measureBuild(browser, dir, [recipe], [[375, 812]], run, cfg, 'before', null, { 'local/home': { size: '375x812' }, 'local/home@320x568': { size: '320x568' } })
    assert.equal(before.filter(d => d.kind === 'interact').length, 0)
    fs.writeFileSync(path.join(dir, 'index.html'), page(true))
    const after = await measureBuild(browser, dir, [recipe], [[375, 812]], run, cfg, 'after', null, { 'local/home': { size: '375x812' }, 'local/home@320x568': { size: '320x568' } })
    assert.ok(after.some(d => d.kind === 'interact' && d.rule === 'I1' && d.widths[0].w === 320))
    assert.equal(after.interactions.length, 2)
    assert.ok(after.interactions.every(i => i.clicked === 1))
    const verdict = judgeAfter(before, after, [])
    assert.equal(verdict.ok, false); assert.ok(verdict.regress.some(d => d.rule === 'I1'))
  } finally { await browser.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(path.join(RUNS, id), { recursive: true, force: true }) }
})

test('repair captures the actual destination after cross-document navigation', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dqa-fix-destination-'))
  const id=`test-fix-destination-${process.pid}`, run=createRun('test',id), cfg=loadConfig()
  const recipe={id:'local/home',start:{path:'/'},steps:[],ready:{stable_ms:100},allow_hosts:[],scan:{root:'body',scroll:'none',ignore:[]}}
  fs.writeFileSync(path.join(dir,'index.html'), '<button style="width:200px;height:48px" onclick="location.href=\'done.html\'">Continue</button>')
  fs.writeFileSync(path.join(dir,'done.html'),'<h1>Reservation confirmed</h1>')
  const browser=await launch()
  try {
    const ds=await measureBuild(browser,dir,[recipe],[[375,812]],run,cfg,'fix-test',null,{'local/home':{size:'375x812'}})
    const action=ds.interactions[0].actions[0]
    assert.equal(action.landing,'/done.html');assert.ok(action.after_shot)
    assert.ok(fs.statSync(run.file(action.after_shot)).size>100)
  } finally {await browser.close();fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(path.join(RUNS,id),{recursive:true,force:true})}
})
