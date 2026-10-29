const {test}=require('node:test')
const assert=require('node:assert/strict')
const {evidence,panel}=require('../ui/presentation')
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const show=(step,j,renderer=()=>'<div>verified comparison</div>')=>panel(step,j,'run',esc,()=>'',renderer)
function complete(){return {pipeline:{state:'succeeded',workflow_run_id:'check-id'},manifest:{adaptive:{status:'done'}},repair:{fix_pipeline:{state:'succeeded',workflow_run_id:'fix-id'},fix_comparison:{verified:true,frames:[{screen:'home',size:'375x812'},{screen:'home',size:'320x568'}]},fix:{app_plan:{tasks:[]}}}}}
test('pending steps do not invent file reads, edits or verification',()=>{
 const j={running:true,pipeline:{state:'running'}}
 assert.equal(evidence(j).complete,false)
 assert.match(show(1,j),/파일을 읽으면/)
 assert.match(show(2,j),/수정 방법을 선택/)
 assert.match(show(3,j),/결과를 기다리고/)
 assert.doesNotMatch(show(3,j),/verified comparison/)
})
test('Dify or adaptive failure never displays verified comparison',()=>{
 for(const alter of [j=>j.pipeline.state='failed',j=>j.repair.fix_pipeline.state='running',j=>j.manifest.adaptive.status='failed',j=>j.repair.fix_comparison.verified=false]){
  const j=complete();alter(j);assert.equal(evidence(j).complete,false);assert.doesNotMatch(show(3,j),/verified comparison/)
 }
})
test('read and edit evidence preserves actual text while escaping source markup',()=>{
 const j=complete();j.repair.fix.app_plan.tasks=[{observations:[{action:'read',file:'index.html',at:'2026-10-23T00:19:44Z',content:'<script>test</script>'}],decisions:[{action:'edit',file:'style.css',start:4,find:'white-space:nowrap',replace:'white-space:normal'}]}]
 assert.match(show(1,j),/&lt;script&gt;test&lt;\/script&gt;/);assert.doesNotMatch(show(1,j),/<script>/)
 assert.match(show(2,j),/white-space:nowrap/);assert.match(show(2,j),/white-space:normal/)
})
test('completed view counts measured screens and sizes and shows both Dify run ids',()=>{
 const html=show(3,complete());assert.match(html,/1개 화면 · 2개 크기/);assert.match(html,/check-id/);assert.match(html,/fix-id/);assert.match(html,/verified comparison/)
})
