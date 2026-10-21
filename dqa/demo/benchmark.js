// Repeat the public UI's Dify check -> model-only repair path. Never applies the patch.
// node demo/benchmark.js --local /absolute/frontend --design DESIGN_NAME --label before --count 3 --out /tmp/benchmark
const fs = require('fs'), path = require('path')
const { readJSON, writeJSON, RUNS } = require('../core/util')
const { sourceDigest } = require('../fix/performance')
const args = Object.fromEntries(process.argv.slice(2).reduce((rows, word, i, all) => word.startsWith('--') ? [...rows, [word.slice(2), all[i + 1]]] : rows, []))
const base = args.server || 'http://127.0.0.1:8792'
const server = new URL(base)
if (!['127.0.0.1', 'localhost'].includes(server.hostname)) throw new Error('Benchmark server must be local')
if (!args.local || !path.isAbsolute(args.local) || !args.design || !/^[\w.-]+$/.test(args.label || '')) throw new Error('--local (absolute path), --design and --label are required')
const count = Number(args.count || 3)
if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error('--count must be 1..10')
const request = { kind: 'local', local: args.local, base: 'none', design: args.design, interact: true, widths: 'mobile5', llm: 'off', repair_llm: 'auto', repair_mode: 'model-only', autofix: true }
const out = path.resolve(args.out || './benchmark-results', args.label + '.json')
const results = []
const digest = sourceDigest(args.local)
if (!digest) throw new Error('Benchmark fixture must be self-contained (no symlinks or node_modules)')
async function main () {
  for (let i = 0; i < count; i++) {
    const response = await fetch(base + '/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DQA': '1' }, body: JSON.stringify(request), signal: AbortSignal.timeout(15000) })
    const started = await response.json()
    if (!response.ok || !started.run_id) throw new Error(started.error || 'Check did not start')
    const id = started.run_id, dir = path.join(RUNS, id), deadline = Date.now() + 1_200_000
    console.log(`${args.label} ${i + 1}/${count}: ${id}`)
    let check, repair
    while (true) {
      check = readJSON(path.join(dir, 'pipeline.json'), {})
      repair = readJSON(path.join(dir, 'fix/pipeline.json'), {})
      const error = readJSON(path.join(dir, 'task_error.json'), null)
      if (error || [check, repair].some(p => ['failed', 'cancelled'].includes(p.state))) throw new Error(JSON.stringify(error || { check, repair }))
      if (check.state === 'succeeded' && repair.state === 'succeeded') break
      if (Date.now() > deadline) throw new Error('Benchmark timeout; inspect the active run before retrying')
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    const fix = readJSON(path.join(dir, 'fix/fixes.json')), manifest = readJSON(path.join(dir, 'manifest.json'))
    require('../fix/validation').assertVerifiedCombined(fix.combined)
    if (check.source !== 'dify' || repair.source !== 'dify' || fix.repair_mode !== 'model-only') throw new Error('Dify/model-only invariant failed')
    if (sourceDigest(args.local) !== digest) throw new Error('Original fixture changed')
    const row = { run_id: id, check_sec: check.total_sec, fix_sec: repair.total_sec, total_sec: +(check.total_sec + repair.total_sec).toFixed(1), workflows: [check.workflow_run_id, repair.workflow_run_id], sizes: manifest.sizes, fixed: fix.combined.fixed, regressions: fix.combined.regress, timings: fix.timings, original_preserved: true }
    results.push(row); writeJSON(out, { label: args.label, source_sha256: digest, design: args.design, results }); console.log(JSON.stringify(row))
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
