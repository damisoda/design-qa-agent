const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const { serve } = require('../server/http')
const { RUNS, writeJSON, readJSON, loadConfig } = require('../core/util')

test('Dify unavailable: repair fails closed, never starts local editing, and preserves scan evidence', async () => {
  const id = `test-repair-dify-${process.pid}`, dir = path.join(RUNS, id)
  fs.mkdirSync(dir, { recursive: true })
  writeJSON(path.join(dir, 'manifest.json'), { status: 'done', failures: [], targets: { head: { kind: 'local', src: dir } }, local: { repoCfg: { name: 'static' } } })
  writeJSON(path.join(dir, 'pipeline.json'), { source: 'dify', state: 'succeeded', workflow_run_id: 'original-check' })
  const cfg = loadConfig(); cfg.dify = { ...cfg.dify, python: '/usr/bin/false' }
  const server = await serve({ port: '0' }, cfg)
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    const response = await fetch(origin + '/api/fix', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DQA': '1' }, body: JSON.stringify({ run_id: id }) })
    assert.equal(response.status, 200)
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && readJSON(path.join(dir, 'fix/pipeline.json'), {}).state !== 'failed') await new Promise(r => setTimeout(r, 30))
    assert.equal(readJSON(path.join(dir, 'fix/pipeline.json')).state, 'failed')
    assert.equal(readJSON(path.join(dir, 'pipeline.json')).workflow_run_id, 'original-check')
    assert.equal(fs.existsSync(path.join(dir, 'fix/fixes.json')), false)
    assert.equal((await (await fetch(origin + '/health')).json()).running, null)
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }) }
})
