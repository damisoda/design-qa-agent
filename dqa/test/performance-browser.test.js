const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'), os = require('os'), path = require('path')
const { launch } = require('../measure/browser')
const { loadConfig } = require('../core/util')
const { measureBuild } = require('../fix/fix')
const { coverage } = require('../fix/comparison')

test('parallel independent checks preserve measured defects, click coverage and page errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-parallel-'))
  const browser = await launch()
  const run = { event () {}, file: rel => path.join(dir, 'evidence', rel) }
  const sizes = [[375, 812], [320, 568]]
  const cfg = { ...loadConfig(), scroll: { max_steps: 1, step_ratio: 0.8 } }
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><style>body{margin:0}h1{font-size:28px;white-space:nowrap;width:200px}button{height:48px;width:200px}</style><h1>This heading is deliberately wider than its box</h1><button onclick="location.hash=\'done\'">Continue</button>')
  const recipe = { id: 'parallel-test', start: { path: '/index.html' }, steps: [], ready: { stable_ms: 100 }, scan: { scroll: 'none' } }
  const interactions = { 'parallel-test': { size: '375x812' }, 'parallel-test@320x568': { size: '320x568' } }
  try {
    const serial = await measureBuild(browser, dir, [recipe], sizes, run, { ...cfg, performance: { parallel_validation: false } }, 'serial', null, interactions)
    const parallel = await measureBuild(browser, dir, [recipe], sizes, run, { ...cfg, performance: { parallel_validation: true } }, 'parallel', null, interactions)
    assert.equal(serial.failed || 0, 0); assert.equal(parallel.failed || 0, 0)
    const norm = ds => ds.map(d => ({ id: d.id, rule: d.rule, widths: d.widths.map(w => [w.w, w.h, w.px]) })).sort((a, b) => a.id.localeCompare(b.id))
    assert.deepEqual(norm(parallel), norm(serial))
    assert.deepEqual(coverage(serial, parallel), [])
    const counts = xs => xs.map(x => [x.screen, x.size, x.clicked, x.defects, x.prototype_matched])
    assert.deepEqual(counts(parallel.interactions), counts(serial.interactions))
    assert.equal(parallel.interactions.length, 2)
  } finally { await browser.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
