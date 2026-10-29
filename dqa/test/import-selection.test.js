const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const os = require('os'); const path = require('path')
const { createFigmaConnection } = require('../design/connection')
const { inspect } = require('../server/local-selection')

test('refresh exports original frame even if another frame is selected; same library name survives rename', () => {
  const c = createFigmaConnection(async () => {})
  const client = { client_id: 'original-client', file: 'Design', frames: [{ id:'2:99', name:'Other', w:375,h:812 }] }
  c.poll(client)
  const spec = { file:'Design', frame:{id:'2:23',name:'Discover'}, figma:{client_id:client.client_id,file_key:'File123'} }
  const r = c.refresh('original-library-entry', spec)
  const cmd = c.poll(client).command
  assert.deepEqual(cmd.frame_ids, ['2:23'])
  const body = { client_id:client.client_id, session_id:r.session.id, request_id:cmd.id }
  const renamed = {spec:{...spec,frame:{id:'2:23',name:'Renamed'}}}
  assert.equal(c.decorate(body,renamed).name, 'original-library-entry')
  assert.throws(() => c.decorate(body,{spec:{...spec,frame:{id:'2:99'}}}))
  assert.throws(() => c.decorate(body,{spec:{...spec,figma:{file_key:'Wrong'}}}))
  c.imported(body,[{name:'original-library-entry'}])
  assert.equal(c.snapshot().session.state,'ready')
  const next = c.refresh('original-library-entry',spec)
  assert.notEqual(next.session.request_id, r.session.request_id)
})

test('refresh refuses disconnected or different file instead of guessing by file name', () => {
  const c=createFigmaConnection(async()=>{})
  const spec={file:'Design',frame:{id:'2:23'},figma:{client_id:'original-client'}}
  c.poll({client_id:'new-client-123',file:'Design',frames:[]})
  assert.throws(()=>c.refresh('entry',spec),/연결이 끝났습니다/)
  c.poll({client_id:'original-client',file:'Different',frames:[]})
  assert.throws(()=>c.refresh('entry',spec),/연결이 끝났습니다/)
})

test('project inspection reads configured screens and respects forbidden paths without building', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dqa-selection-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  fs.writeFileSync(path.join(dir,'index.html'),'<h1>Test</h1>')
  assert.deepEqual(inspect(dir,{}).screens.map(s=>s.path),['/'])
  fs.writeFileSync(path.join(dir,'.dqa.json'),JSON.stringify({recipes:['atelier/discover','atelier/exhibition']}))
  const result=inspect(dir,{})
  assert.deepEqual(result.screens.map(s=>s.id),['atelier/discover','atelier/exhibition'])
  assert.throws(()=>inspect(dir,{forbidden_paths:[dir]}),/금지 경로/)
  assert.throws(()=>inspect('relative',{}),/전체 경로/)
  assert.deepEqual(fs.readdirSync(dir).sort(),['.dqa.json','index.html'])
})


test('refresh timeout releases command and refuses a late export', () => {
  const c = createFigmaConnection(async()=>{})
  const client={client_id:'timeout-client',file:'Design',frames:[]}
  c.poll(client)
  const spec={file:'Design',frame:{id:'2:23'},figma:{client_id:client.client_id}}
  const request=c.refresh('entry',spec); const cmd=c.poll(client).command
  const now=Date.now; const time=now(); Date.now=()=>time+61000
  try {
    assert.equal(c.snapshot().session.state,'error')
    assert.throws(()=>c.decorate({client_id:client.client_id,session_id:request.session.id,request_id:cmd.id},{spec}),/応答|응답/)
    assert.equal(c.poll(client).command,null)
    assert.equal(c.refresh('entry',spec).session.state,'exporting')
  } finally { Date.now=now }
})


test('Figma app launch failure is not replaced by polling hints, and retry preserves imported bindings', async () => {
  const ui=require('../ui/figma')
  const st={figmaSelecting:true,figmaOpening:false,figmaError:'Figma 앱을 열지 못했습니다',designs:{'':'saved',screen:'saved'}}
  assert.equal(ui.connectionMessage(st,[],true),st.figmaError)
  assert.equal(ui.connectionMessage(st,[{frames:[{id:'1:2'}]}],true),st.figmaError)
  assert.match(ui.html(st,[{name:'saved',frame:'Saved'}]),/Saved/)
  const c=createFigmaConnection(async()=>{throw new Error('launch failed')})
  await assert.rejects(c.connect({}),/launch failed/)
  assert.equal(c.snapshot().session,null)
})
test('Figma connection distinguishes launch request, plugin connection and selected frame', () => {
  const ui=require('../ui/figma'); const st={figmaSelecting:true,figmaOpenRequested:true}
  assert.match(ui.connectionMessage(st,[],true),/아직 dqa 플러그인/)
  assert.match(ui.guide(st,[]),/플러그인 → 개발 → dqa 시안 내보내기/)
  assert.match(ui.connectionMessage(st,[{frames:[]}],true),/프레임을 선택/)
  assert.match(ui.connectionMessage(st,[{frames:[{id:'2:23'}]}],true),/아래 이름을 확인/)
  assert.equal(ui.connectionMessage({figmaSelecting:false},[],true),'')
})
