const {test,after}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const {execFileSync}=require('child_process')
const {boundarySizes,queriesFor}=require('../dify/rag/inventory');const {approvedSizes}=require('../dify/rag/runtime');const {RUNS,createRun,writeJSON,readJSON}=require('../core/util')
const ids=[];after(()=>ids.forEach(id=>fs.rmSync(path.join(RUNS,id),{recursive:true,force:true})))
function py(code){return JSON.parse(execFileSync('python3',['-c',`import sys,json\nsys.path.insert(0,${JSON.stringify(path.resolve(__dirname,'../dify'))})\n${code}`],{encoding:'utf8'}))}
test('RAG: CSS 경계의 관측값만 사용하고 기본 크기·중복·범위 밖·무한 개수는 제외',()=>{
 const sizes=[[375,812],[390,844],[430,932],[375,667],[320,568]]
 assert.deepEqual(boundarySizes(['(min-width:361px) and (max-width:369px)'],sizes)[0],[361,812])
 assert.equal(boundarySizes(['(min-width:900px)'],sizes).length,0)
 assert.equal(boundarySizes(Array.from({length:100},(_,i)=>`(min-width:${321+i}px)`),sizes).length,4)
 assert.equal(queriesFor('home',{media:[],clickables:[{}]},sizes,false).length,0)
 assert.equal(queriesFor('home',{media:[],clickables:[{}]},sizes,true).length,1)
})
test('RAG: 검색된 검사 방법만 승인하며 크기·선택자·코드 실행을 검색 결과가 주입하지 못함',()=>{
 const m={sizes:[[375,812],[320,568],[430,932]]};const inv={interact:true,screens:[{screen:'home',media:['(min-width:361px)'],clickables:[{}]}],queries:[JSON.stringify({id:'home/viewport',recipe:'viewport-boundary'})]}
 const p={id:'home/viewport',recipe:'viewport-boundary',basis:'[Q01-001]',document_id:'doc',sizes:[[9999,9999]],code:'evil'}
 assert.deepEqual(approvedSizes([p],inv,m).sizes[0],[361,812]);assert.throws(()=>approvedSizes([{...p,recipe:'eval'}],inv,m));assert.throws(()=>approvedSizes([{...p,basis:'[FAKE]'}],inv,m))
})
test('Dify 재정렬: 웹/규칙 적용 조건을 우선하고 다른 규칙·RN 사례와 중복은 제외',()=>{
 const x=py(`from rag.nodes import rank\nitem=json.dumps({'id':'d','rule':'F1','kind':'rule','query':'Fill'})\ndef row(cid,meta,score):return {'content':'['+cid+']\\nDQA_META: '+json.dumps(meta),'metadata':{'score':score}}\nrows=[row('K01-001',{'platform':'web','scope':'generic','rule':'F1'},0.2),row('K02-001',{'platform':'web','scope':'generic','rule':'D2'},0.99),row('K03-001',{'platform':'rn','scope':'generic','rule':'F1'},1)]\nprint(json.dumps(rank(item,rows,rows)))`)
 assert.equal(x.result.selected.length,1);assert.equal(x.result.selected[0].id,'[K01-001]')
})
test('Dify 검사 계획: 근거 없음이면 추가 검사를 만들지 않음',()=>{
 const x=py(`from rag.nodes import plan\nprint(json.dumps(plan([{'id':'x','recipe':'viewport-boundary','selected':[]}])) )`)
 assert.deepEqual(JSON.parse(x.plan),[])
})
test('Dify v6: 정상 화면도 검사 방법을 검색하고 LLM 분기 전에 측정, 근거는 결함별 반복',()=>{
 const x=py(`from act_v6 import build\ng=build('p',[])['workflow']['graph'];print(json.dumps({'nodes':{n['id']:n['data'] for n in g['nodes']},'edges':g['edges']}))`)
 assert.equal(x.nodes.probe_search.type,'iteration');assert.equal(x.nodes.issue_search.type,'iteration')
 assert.equal(x.nodes.probe_search_docs.type,'knowledge-retrieval');assert.equal(x.nodes.issue_search_docs.multiple_retrieval_config.reranking_enable,true)
 assert.equal(x.nodes.probe_search_docs.metadata_filtering_mode,'manual');assert.equal(x.nodes.adaptive.tool_name,'dqa_adaptive')
 assert.ok(!x.edges.some(e=>e.source==='adaptive'&&e.target==='gate'));
 for(let i=0;i<12;i++){ const prev=i?'adaptive_wait_'+(i-1):'adaptive';const cur='adaptive_wait_'+i; assert.equal(x.nodes[cur].tool_name,'dqa_wait');assert.equal(x.nodes[cur].tool_parameters.text.value,'{{#'+prev+'.text#}}');assert.ok(x.edges.some(e=>e.source===prev&&e.target===cur)) }
 assert.ok(x.edges.some(e=>e.source==='adaptive_wait_11'&&e.target==='gate'));assert.deepEqual(x.nodes.gate.variables[0].value_selector,['adaptive_wait_11','text']);assert.equal(x.nodes.judge.tool_parameters.contexts.value,'{{#issue_context.contexts#}}')
})
test('결함별 근거: 다른 결함의 문서에만 존재하는 숫자·ID는 저장 근거가 될 수 없음',async()=>{
 const id='test-rag-'+process.pid;ids.push(id);const run=createRun('test',id)
 writeJSON(run.file('defects.json'),[{id:'a',rule:'R1',labels:[],widths:[],evidence:[]},{id:'b',rule:'R1',labels:[],widths:[],evidence:[]}])
 const cfg={serve:{port:8792},dify:{facts_max:3,llm_model:'test',unload_after:false}}
 const out=await require('../dify/bridge').judgeSave({run_id:id,context:'[K01-001] 999px',contexts:JSON.stringify({a:'[K02-001] generic',b:'[K01-001] 999px'}),answer:JSON.stringify([{id:'a',verdict:'결함',problem:'999px 넘침',expected:'영역 안에 표시',reason:'측정',basis:['[K01-001]']}])},cfg)
 assert.equal(out.saved,0);assert.equal(out.rejected.length,1)
})

test('RAG 임베딩 장애: 빈 검색 성공으로 숨기지 않고 실제 응답·벡터를 확인',async()=>{
 const {retrievalHealth}=require('../dify/rag/runtime');const cfg={dify:{}}
 await assert.rejects(retrievalHealth(cfg,async()=>{throw new Error('connection refused')}),/터널/)
 await assert.rejects(retrievalHealth(cfg,async()=>({ok:true,json:async()=>({data:[]})})),/임베딩 응답/)
 const mock=async()=>{ return {ok:true,json:async()=>{ return {data:[{embedding:[0.1,0.2]}]} }} }
 const ready=await retrievalHealth(cfg,mock);assert.equal(ready.ok,true)
})

test('RAG 근거 누락: 모델 연결이 살아 있어도 계획이 빠진 조건은 완료로 표시하지 않음',()=>{
 const {validateCoverage}=require('../dify/rag/runtime');const inventory={queries:[JSON.stringify({id:'home/click',recipe:'interaction-width'})]}
 assert.throws(()=>validateCoverage([],inventory),/미완료/)
 assert.doesNotThrow(()=>validateCoverage([{id:'home/click',recipe:'interaction-width'}],inventory))
})

test('RAG 규칙 범위: 구현된 24개 코드 모두 카드가 있고 역사적 코드 의미를 혼동하지 않음',()=>{
 const cards=require('../dify/rag/corpus.json');const rules=cards.filter(c=>c.meta.kind==='rule')
 const implemented=new Set([...Object.keys(require('../measure/cluster').RULE_NAME),...Object.keys(require('../design/compare').RULE_NAME),'I1','I2','I3','I4'])
 assert.deepEqual(new Set(rules.map(c=>c.meta.rule)),implemented)
 assert.match(rules.find(c=>c.meta.rule==='R5').text,/과거 P03/);assert.match(rules.find(c=>c.meta.rule==='G1').text,/가능성/)
})
test('RAG 프로젝트 범위: 팀 토큰은 해당 프로젝트에서만 근거 후보가 됨',()=>{
 const x=py(`from rag.nodes import rank\nr={'content':'[C01-001] cbh color tokens','metadata':{'score':1}}\nbase={'id':'d','rule':'D2','kind':'rule','query':'color'}\nprint(json.dumps([rank(json.dumps(base),[r],[]),rank(json.dumps(dict(base,project='cbh')),[r],[])]))`)
 assert.equal(x[0].result.selected.length,0);assert.equal(x[1].result.selected.length,1)
})

test('RAG 인용: 제목을 덧붙인 실제 청크 ID는 정규화하고 알 수 없는 ID만 있으면 거부',async()=>{
 const id='test-rag-citation-'+process.pid;ids.push(id);const run=createRun('test',id)
 writeJSON(run.file('defects.json'),[{id:'a',rule:'R1',labels:[],widths:[],evidence:[]}])
 const cfg={serve:{port:8792},dify:{facts_max:3,llm_model:'test',unload_after:false}};const base={id:'a',verdict:'결함',problem:'부모 밖으로 넘침',expected:'부모 안에 표시',reason:'관측한 상자 비교'}
 const {judgeSave}=require('../dify/bridge')
 const ok=await judgeSave({run_id:id,contexts:JSON.stringify({a:'[K01-001] 기준'}),answer:JSON.stringify([{...base,basis:['[K01-001] R1 웹 측정 기준']}])},cfg)
 assert.equal(ok.saved,1);assert.deepEqual(readJSON(run.file('defects.json'))[0].judge.basis,['[K01-001]'])
 assert.deepEqual(readJSON(run.file('defects.json'))[0].judge.dropped_basis,[]);assert.equal(readJSON(run.file('defects.json'))[0].judge.rag_status,'cited')
 const bad=await judgeSave({run_id:id,contexts:JSON.stringify({a:'[K01-001] 기준'}),answer:JSON.stringify([{...base,basis:['[K99-001] 가짜']}])},cfg)
 assert.equal(bad.saved,0)
})

test('RAG 과거 기준 대응: 무반응만으로 가림 전용 P03 S4 기준을 붙이지 않음',()=>{
 const {criteriaFor}=require('../judge/ollama')
 assert.equal(criteriaFor({kind:'interact',rule:'I1',interact:{covered_by:null}}),'')
 assert.match(criteriaFor({kind:'interact',rule:'I1',interact:{covered_by:'overlay'}}),/S4/)
})

// Dify routes iteration starts through a dedicated canvas renderer.
test('Dify 편집기: 반복 시작 노드는 전용 렌더러와 부모 시작점·연결을 사용',()=>{
 const g=py(`from act_v6 import build\nprint(json.dumps(build('p',[])['workflow']['graph']))`)
 const iterations=g.nodes.filter(n=>n.data.type==='iteration')
 assert.equal(iterations.length,2)
 for(const iteration of iterations){
  const starts=g.nodes.filter(n=>n.parentId===iteration.id&&n.data.type==='iteration-start')
  assert.equal(starts.length,1)
  const start=starts[0]
  assert.equal(start.type,'custom-iteration-start')
  assert.equal(iteration.data.start_node_id,start.id)
  assert.ok(g.edges.some(e=>e.source===start.id&&e.data.iteration_id===iteration.id))
 }
})

test('retrieval availability is separate from actual model citations',async()=>{
 const id='test-rag-usage-'+process.pid;ids.push(id);const run=createRun('test',id)
 writeJSON(run.file('defects.json'),[{id:'a',rule:'R1',labels:[],widths:[],evidence:[{id:'M1',text:'넘침 관측'}]}])
 const cfg={serve:{port:8792},dify:{facts_max:3,llm_model:'test',unload_after:false}}
 const out=await require('../dify/bridge').judgeSave({run_id:id,contexts:JSON.stringify({a:'[K01-001] 범위 기준'}),answer:JSON.stringify([{id:'a',verdict:'결함',problem:'넘침 관측',expected:'범위 안에 표시',reason:'측정 확인',basis:['측정 M1']}])},cfg)
 assert.equal(out.saved,1);const j=readJSON(run.file('defects.json'))[0].judge;assert.equal(j.rag_status,'retrieved_not_cited');assert.deepEqual(j.retrieval_cited,[]);assert.deepEqual(j.retrieval_available,['[K01-001]'])
})
