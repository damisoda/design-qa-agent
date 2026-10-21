const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'), os = require('os'), path = require('path')
const { sourceDigest, reusable, quickTarget } = require('../fix/performance')
const { timer } = require('../core/timing')

test('validation reuse requires identical source/context and full successful coverage', () => {
  const good = { key: 'source-and-context', verdict: { ok: true, build_ok: true, regress: [], coverage_errors: [] }, after: { measurements: [{ ok: true }], journeys: [{ ok: true }] } }
  assert.equal(reusable(good, good.key), true)
  assert.equal(reusable(good, 'different-source'), false)
  for (const mutate of [x => { x.verdict.ok = false }, x => { x.verdict.regress = [{}] }, x => { x.verdict.coverage_errors = ['missing screen'] }, x => { x.after.failed = 1 }, x => { x.after.measurements[0].ok = false }, x => { x.after.journeys[0].ok = false }]) {
    const bad = structuredClone(good); mutate(bad); assert.equal(reusable(bad, good.key), false)
  }
})

test('source digest changes for untouched assets too and refuses external symlinks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-digest-'))
  try {
    fs.writeFileSync(path.join(dir, 'index.html'), 'hello')
    fs.writeFileSync(path.join(dir, 'style.css'), 'p{color:red}')
    const first = sourceDigest(dir)
    fs.writeFileSync(path.join(dir, 'style.css'), 'p{color:blue}')
    assert.notEqual(sourceDigest(dir), first)
    fs.symlinkSync('.', path.join(dir, 'dist-dqa-fix1'))
    assert.ok(sourceDigest(dir))
    fs.symlinkSync('/tmp', path.join(dir, 'external'))
    assert.equal(sourceDigest(dir), null)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('quick probe selects a measured overflow size, never design/click/cross-width targets', () => {
  const recipes = [{ id: 'a' }], sizes = [[375, 812], [320, 568]]
  const d = { id: 'overflow', screen: 'a', rule: 'R1', widths: [{ w: 375, h: 812, px: 20 }, { w: 320, h: 568, px: 70 }] }
  assert.deepEqual(quickTarget([d], [d.id], recipes, sizes).size, [320, 568])
  for (const rule of ['I1', 'D3', 'R5']) assert.equal(quickTarget([{ ...d, rule }], [d.id], recipes, sizes), null)
  assert.equal(quickTarget([d], [d.id], recipes, [[430, 932]]), null)
})

test('stage timings preserve exceptions and successful return values', async () => {
  const rows = []; const timed = timer(rows)
  assert.equal(await timed('ok', async () => 42), 42)
  await assert.rejects(timed('failed', async () => { throw new Error('original error') }), /original error/)
  assert.deepEqual(rows.map(r => [r.stage, r.ok]), [['ok', true], ['failed', false]])
  assert.ok(rows.every(r => r.ms >= 0))
})
