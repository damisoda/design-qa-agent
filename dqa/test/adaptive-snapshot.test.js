const {test}=require('node:test')
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path')
const {createRun,writeJSON,readJSON}=require('../core/util')
const {validateCheckScope}=require('../server/local-selection')
const {finishAdaptive}=require('../dify/rag/runtime')

test('frozen adaptive recheck retains project binding and rejects another source or screen',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dqa-snapshot-'))
 const old=process.env.DQA_SCREEN_STATE_DIR;process.env.DQA_SCREEN_STATE_DIR=path.join(root,'recipes');fs.mkdirSync(process.env.DQA_SCREEN_STATE_DIR)
 const project=path.join(root,'project'),src=path.join(root,'snapshot');fs.mkdirSync(project);fs.mkdirSync(src)
 const recipe='auto/1234567890abcdef';writeJSON(path.join(process.env.DQA_SCREEN_STATE_DIR,'1234567890abcdef.json'),{id:recipe,_project:fs.realpathSync(project),start:{path:'/'}})
 const run=createRun('test','test-snapshot-'+process.pid)
 t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(run.dir,{recursive:true,force:true});if(old===undefined)delete process.env.DQA_SCREEN_STATE_DIR;else process.env.DQA_SCREEN_STATE_DIR=old})
 writeJSON(run.file('manifest.json'),{status:'done',local:{project},targets:{head:{src,dist:src}},recipes:[{id:recipe}]})
 const args={'run-id':run.id,'snapshot-run':run.id,url:'http://127.0.0.1:12345',src}
 assert.doesNotThrow(()=>validateCheckScope([recipe],args))
 assert.throws(()=>validateCheckScope([recipe],{...args,src:project}),/일치/)
 assert.throws(()=>validateCheckScope(['different'],args),/일치/)
 assert.throws(()=>validateCheckScope([recipe],{...args,'snapshot-run':'../other'}),/유효/)
 assert.throws(()=>validateCheckScope([recipe],{url:args.url,src}),/다른 프로젝트/)
})

test('failed recheck cannot reuse successful initial measurements as overall success',t=>{
 const run=createRun('test','test-adaptive-failure-'+process.pid);t.after(()=>fs.rmSync(run.dir,{recursive:true,force:true}))
 const m={status:'done',exit_code:1,targets:{head:{}},recipes:[]};writeJSON(run.file('manifest.json'),m);writeJSON(run.file('summary.json'),{exit_code:1})
 let released=false;const job={id:run.id,adaptivePending:{m,audit:{selected:{sizes:[],clicks:[[320,568]]},plan:[],started_at:new Date().toISOString()},host:{close(){released=true}},base:null}}
 finishAdaptive(job,{},2,'project scope rejected')
 assert.equal(readJSON(run.file('manifest.json')).status,'incomplete')
 assert.equal(readJSON(run.file('manifest.json')).exit_code,2)
 assert.equal(readJSON(run.file('summary.json')).exit_code,2)
 assert.equal(readJSON(run.file('rag_plan.json')).error,'project scope rejected')
 assert.equal(released,true);assert.equal(job.adaptivePending,null)
})

test('frozen design recheck retains the run-scoped JSON and PNG',t=>{
 const run=createRun('test','test-adaptive-design-'+process.pid);t.after(()=>fs.rmSync(run.dir,{recursive:true,force:true}))
 const id='home';writeJSON(run.file('design/home.json'),{file:'Figma',frame:{id:'1:2',name:'Home',width:375,height:812},nodes:[]});fs.writeFileSync(run.file('design/home.png'),'original PNG bytes')
 const out=require('../core/design').resolveDesign({'snapshot-run':run.id,design:'home='+run.file('design/home.json')},{head:{}},[{id}],run,{forbidden_paths:[]})
 assert.equal(out.home.png,'design/home.png');assert.equal(fs.readFileSync(run.file(out.home.png),'utf8'),'original PNG bytes')
})
