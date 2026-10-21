const { test } = require('node:test')
const assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path')
const { scopedStyle } = require('../fix/scoped-style')
test('model-selected observed class scope adds a shared variant rule without replacing base styles', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dqa-scope-'));const original='.action { background:#A83B60; min-height:48px; }\n'
  fs.writeFileSync(path.join(dir,'style.css'),original)
  const ctx={srcRoot:dir,srcDir:'.',appSources:[{screen:'home',source:'<button class="action primary">Next</button>'},{screen:'done',source:'<button class="action return">Back</button>'}],appContracts:[{screen:'home',text:['Next'],expected_fill:'#2459D3'},{screen:'done',text:['Back'],expected_fill:'#A83B60'}]}
  const a={file:'style.css',selector:'.action.primary',property:'background-color',value:'#2459D3'}
  try {
    const e=scopedStyle(a,ctx);const patched=original.replace(e.find,e.replace)
    assert.ok(patched.includes('.action { background:#A83B60; min-height:48px; }'))
    assert.ok(patched.includes('.action.primary { background-color: #2459D3; }'))
    assert.equal(fs.readFileSync(path.join(dir,'style.css'),'utf8'),original)
    assert.throws(()=>scopedStyle({...a,selector:'.action'},ctx),/범위 충돌/)
    assert.throws(()=>scopedStyle({...a,selector:'.action.invented'},ctx),/확인하지 못/)
    assert.throws(()=>scopedStyle({...a,value:'var(--invented)'},ctx),/정의되지/)
    assert.throws(()=>scopedStyle({...a,property:'display',value:'none'},ctx),/허용된/)
    assert.throws(()=>scopedStyle({...a,file:'../style.css'},ctx),/실제 소스/)
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
})

test('after a regression the model schema requires replanning, then exposes scoped style instead of raw global edit', () => {
  const { allowedActions } = require('../fix/agent')
  assert.ok(!allowedActions(true,true).includes('edit'))
  assert.ok(!allowedActions(true,true).includes('style'))
  assert.ok(allowedActions(true,true).includes('replan'))
  assert.ok(allowedActions(false,true).includes('style'))
  assert.ok(!allowedActions(false,true).includes('edit'))
  assert.ok(allowedActions(false,false).includes('edit'))
  assert.ok(!allowedActions(false,true,5).includes('read'))
  assert.ok(!allowedActions(false,false,5).includes('search'))
  assert.deepEqual(allowedActions(true,true),['replan','give_up'])
})

test('scope evidence derives variant impact from actual classes and healthy-screen contracts', () => {
  const {scopeEvidence}=require('../fix/scoped-style')
  const rows=scopeEvidence({appSources:[{screen:'one',source:'<button class="cta proceed">Continue</button>'},{screen:'two',source:'<button class="cta cancel">Cancel</button>'}],appContracts:[{screen:'one',text:['Continue'],expected_fill:'#112233'},{screen:'two',text:['Cancel'],expected_fill:'#445566'}]})
  assert.equal(rows.find(r=>r.selector==='.cta').conflicting,true)
  assert.deepEqual(rows.find(r=>r.selector==='.cta.proceed'),{selector:'.cta.proceed',screens:['one'],expected_fills:['#112233'],conflicting:false})
  assert.equal(rows.some(r=>r.selector==='.action.primary'),false)
})

test('grouped repair prompt includes every affected screen instead of only its representative',async()=>{
 const http=require('http'),{codeAgent}=require('../fix/agent');let messages;
 const srv=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;messages=JSON.parse(raw).messages;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:{content:JSON.stringify({action:'give_up',reason:'unit test'})}}))});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dqa-task-context-'));fs.writeFileSync(path.join(dir,'style.css'),'.cta{color:red}');
 try{await codeAgent({id:'one',screen:'product',rule:'D2',kind:'design',labels:['Add'],widths:[],evidence:[],elements:[],diag:[]},{cfg:{ollama:{url:'http://127.0.0.1:'+srv.address().port,model:'unit-test',timeout_ms:1000}},srcRoot:dir,srcDir:'.',llm:true,say:()=>{},firstEdits:[],taskTargets:[{id:'one',screen:'product',labels:['Add']},{id:'two',screen:'checkout',labels:['Confirm']}],tryEdits:()=>{throw Error('test must not edit')}});
 const prompt=messages.map(x=>x.content).join('\n');assert.match(prompt,/"screen":"checkout"/);assert.match(prompt,/대표 요소만 고치면 성공이 아니다/);
 }finally{await new Promise(r=>srv.close(r));fs.rmSync(dir,{recursive:true,force:true})}
})

test('scope evidence distinguishes one-page patches from shared task coverage',()=>{
 const {scopeEvidence}=require('../fix/scoped-style');const rows=scopeEvidence({taskTargets:[{screen:'product'},{screen:'cart'}],appSources:[{screen:'product',source:'<button class="cta primary first">Add</button>'},{screen:'cart',source:'<button class="cta primary second">Pay</button>'}]});
 assert.equal(rows.find(x=>x.selector==='.primary').covers_all_target_screens,true);assert.equal(rows.find(x=>x.selector==='.first').covers_all_target_screens,false)
})

test('color repair schema exposes only observed scopes covering the whole task and preserving healthy variants',()=>{
 const {scopeEvidence}=require('../fix/scoped-style'),{actionSchema}=require('../fix/agent');
 const ctx={taskTargets:[{screen:'one'},{screen:'two'}],appSources:[{screen:'one',source:'<button class="control proceed localA">Next</button>'},{screen:'two',source:'<button class="control proceed localB">Pay</button>'},{screen:'done',source:'<button class="control cancel">Cancel</button>'}],appContracts:[{screen:'one',text:['Next'],expected_fill:'#123456'},{screen:'two',text:['Pay'],expected_fill:'#123456'},{screen:'done',text:['Cancel'],expected_fill:'#654321'}]};
 const schema=actionSchema({design:{values:[{prop:'background-color',design:'#123456'}]}},scopeEvidence(ctx),false,true,0);
 assert.ok(schema.properties.selector.enum.includes('.control.proceed'));assert.ok(!schema.properties.selector.enum.includes('.control'));assert.ok(!schema.properties.selector.enum.includes('.localA'));assert.deepEqual(schema.properties.value.enum,['#123456']);
 assert.deepEqual(actionSchema({},[],false,false,0).properties.selector,{type:'string'});
})
