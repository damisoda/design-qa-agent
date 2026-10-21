const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process')
const { progress } = require('../ui/state')
const { createRun, RUNS, readJSON, writeJSON } = require('../core/util')
const ids = []; after(() => ids.forEach(id => fs.rmSync(path.join(RUNS, id), { recursive: true, force: true })))
test('진행: 기본 크기 완료·실패·재측정은 각각 구분하고 전체 퍼센트를 만들지 않는다', () => {
  const j = { running: true, progress: { tasks: { a: { side: 'head', size: '375x812', status: 'done' }, b: { side: 'head', size: '320x568', status: 'failed' }, v: { side: 'verify', status: 'running' } }, stages: { measure: { status: 'incomplete' } } }, pipeline: { phase: 'model', state: 'running', model_loaded: false } }
  const out = progress(j)
  assert.equal(out.total, 2); assert.equal(out.done, 1); assert.equal(out.failed, 1); assert.match(out.message, /메모리/)
  assert.equal(out.stages.find(x => x.key === 'judge').status, 'running')
  assert.equal('percent' in out, false)
  j.pipeline.state = 'succeeded'; j.pipeline.report_enabled = false
  assert.equal(progress(j).stages.find(x => x.key === 'judge').status, 'skipped')
})
test('진행: 종료된 실행의 경과 시간은 페이지를 다시 열어도 늘어나지 않는다', () => {
  const j = { running: false, pipeline: { state: 'cancelled', started_at: '2026-10-14T01:00:00Z', finished_at: '2026-10-14T01:00:12Z', message: '중지' } }
  assert.equal(progress(j, Date.parse('2026-10-14T02:00:00Z')).elapsed, 12)
  assert.equal(progress(j).stages.at(-1).status, 'incomplete')
})
test('초기 결함: 최종 결과 파일을 덮지 않고 실제 부분 측정을 공개한다', () => {
  const id = `test-progress-${process.pid}`; ids.push(id)
  const run = createRun('test', id); const live = require('../core/live').createLive(run)
  live.task('head/home/375x812', { side: 'head', size: '375x812', status: 'running' })
  live.publish([{ id: 'first', rule: 'R1' }]); live.preview({ shot: 'shots/first.png', size: '375x812' })
  assert.equal(fs.existsSync(run.file('defects.json')), false)
  assert.equal(readJSON(run.file('preview.json')).provisional, true)
  assert.equal(readJSON(run.file('progress.json')).preview.shot, 'shots/first.png')
})
test('Dify 취소: 늦게 도착한 정의서를 저장하지 않는다', async () => {
  const id = `test-cancel-report-${process.pid}`; ids.push(id); const run = createRun('test', id)
  const ds = [{ id: 'd', rule: 'I1', interact: { covered_by: null }, labels: [], widths: [], evidence: [] }]
  writeJSON(run.file('defects.json'), ds); writeJSON(run.file('pipeline.json'), { state: 'cancelled' })
  const out = await require('../dify/bridge').judgeSave({ run_id: id, answer: '[{"id":"d"}]' }, { dify: { facts_max: 3 } })
  assert.equal(out.ok, false); assert.equal(out.saved, 0); assert.deepEqual(readJSON(run.file('defects.json')), ds)
})
test('Dify 스트림: 프롬프트·검색 내용은 제외하고 실제 노드 이벤트만 전달한다', () => {
  const script = `import sys,json\nsys.path.insert(0,${JSON.stringify(path.resolve(__dirname, '../dify'))})\nfrom stream import decode_packets,public_event\npackets=decode_packets('data: '+json.dumps({'event':'node_started','task_id':'t','data':{'node_id':'llm','inputs':{'prompt':'PRIVATE'},'outputs':{'text':'PRIVATE'}}}))\nprint(json.dumps([public_event(packets[0]),public_event({'event':'text_chunk','data':{'text':'PRIVATE'}})]))`
  const out = JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }))
  assert.equal(out[0].node, 'llm'); assert.equal(out[1], null); assert.equal(JSON.stringify(out).includes('PRIVATE'), false)
})
test('Dify 전체 경유: 웹 예약 ID가 측정 도구와 저장 검증까지 이어진다', () => {
  const script = `import sys,json\nsys.path.insert(0,${JSON.stringify(path.resolve(__dirname, '../dify'))})\nfrom act_v5 import build,GATE_CODE\ndoc=build('provider',[]);nodes={n['id']:n['data'] for n in doc['workflow']['graph']['nodes']}\nns={};exec(GATE_CODE,ns)\nr=ns['main'](json.dumps({'ok':True,'report_enabled':False,'check':{'exit_code':1,'summary':{'no_base':1}}}),'검사')\nprint(json.dumps({'dqa':nodes['dqa']['tool_parameters'],'judge':nodes['judge']['tool_parameters'],'gate':r,'wait':nodes['wait_0']['tool_name']}))`
  const out = JSON.parse(execFileSync('python3', ['-c', script], { encoding: 'utf8' }))
  assert.equal(out.dqa.ui_request.value, '{{#start.ui_request#}}'); assert.equal(out.judge.ui_request.value, '{{#start.ui_request#}}'); assert.equal(out.gate.go, 0); assert.equal(out.wait, 'dqa_wait')
})
