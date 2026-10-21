const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path'); const os = require('os')
const { loadConfig, RUNS, readJSON } = require('../core/util')
const { serveDist } = require('../targets/static')
const measure = require('../measure/sweep'); const sweep = measure.sweep
// 실제 측정 후 한 크기의 실패를 주입해, 누락된 결함을 해결로 판정하지 않는지 검증한다.
measure.sweep = async (...args) => {
  const out = await sweep(...args)
  if (args[1].side === 'head') { const r = out.find((r) => r.w === 320); r.ok = false; r.error = 'test: one failed viewport' }
  return out
}
const { check } = require('../core/run')
const id = `test-incomplete-${process.pid}`
after(() => fs.rmSync(path.join(RUNS, id), { recursive: true, force: true }))
test('부분 측정 실패: 종료 코드 2·incomplete, 변경 전 결함의 해결 판정 보류', async () => {
  const srv = await serveDist(path.join(__dirname, 'fixtures')); const cfg = loadConfig(); cfg.timeouts.width_ms = 10000
  try {
    const out = await check({ url: srv.origin, 'base-url': srv.origin + '/r1_page.html', recipe: 'local/home', llm: 'off', widths: 'mobile5', 'run-id': id }, cfg)
    const m = readJSON(path.join(RUNS, id, 'manifest.json'))
    assert.equal(out.exit_code, 2); assert.equal(m.status, 'incomplete'); assert.equal(m.summary.failed_sizes, 1)
    assert.equal(m.comparison_incomplete, true); assert.deepEqual(readJSON(path.join(RUNS, id, 'diff.json')).resolved, [])
  } finally { srv.close() }
})
