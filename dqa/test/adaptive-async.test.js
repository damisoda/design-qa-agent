const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'); const path = require('node:path')
const { RUNS, writeJSON, readJSON } = require('../core/util')
const { finishAdaptive, releaseAdaptive } = require('../dify/rag/runtime')
test('async adaptive completion restores frozen local target and records all evidence before closing servers', () => {
  const id='test-adaptive-async-'+process.pid, dir=path.join(RUNS,id); let closed=0
  const original={targets:{head:{kind:'local',src:'/frozen'}},local:{project:'/original'},design:{home:{json:'design/home.json'}}}
  const job={id,adaptivePending:{m:original,audit:{selected:{sizes:[],clicks:[[320,568],[430,932]]},plan:[{basis:'[Q02-001]'}],started_at:new Date().toISOString()},host:{close(){closed++}},base:{close(){closed++}}}}
  try {
    writeJSON(path.join(dir,'manifest.json'),{status:'done',targets:{head:{kind:'url'}},exit_code:1})
    finishAdaptive(job,{},1)
    const m=readJSON(path.join(dir,'manifest.json'))
    assert.equal(m.targets.head.kind,'local');assert.equal(m.local.project,'/original')
    assert.equal(m.adaptive.status,'done');assert.equal(m.adaptive.interaction_sizes.length,2)
    assert.equal(closed,2);assert.equal(job.adaptivePending,null)
    finishAdaptive(job,{},1);assert.equal(closed,2)
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
})
test('cancellation releases held servers without claiming success', () => {
  let closed=0;const job={adaptivePending:{host:{close(){closed++}}}}
  releaseAdaptive(job);releaseAdaptive(job)
  assert.equal(closed,1);assert.equal(job.adaptivePending,null)
})
