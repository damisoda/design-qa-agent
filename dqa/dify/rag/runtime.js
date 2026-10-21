const fs = require('fs'); const path = require('path')
const { RUNS, DQA, readJSON, writeJSON, createRun } = require('../../core/util')
const { launch, newContext, settle } = require('../../measure/browser')
const { serveDist } = require('../../targets/static')
const { loadRecipe, enterScreen } = require('../../recipes/runner')
const { collectInventory, boundarySizes, queriesFor } = require('./inventory')
async function retrievalHealth (cfg, request = fetch) {
  try {
    const response=await request(cfg.dify.embedding_url || 'http://127.0.0.1:18080/v1/embeddings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:cfg.dify.embedding_model || 'qwen3-embedding',input:'design inspection retrieval health'}),signal:AbortSignal.timeout(8000)})
    const value=await response.json()
    if(!response.ok || !Array.isArray(value.data?.[0]?.embedding) || !value.data[0].embedding.length)throw new Error('임베딩 응답이 없습니다')
    return {ok:true,source:'local-embedding-endpoint',at:new Date().toISOString()}
  } catch(e) {throw new Error('Dify 임베딩 연결을 확인하지 못했습니다. dqa up으로 터널을 복구한 뒤 다시 검사해 주세요: '+e.message)}
}
async function inventoryFor (id, cfg, interact) {
  const dir=path.join(RUNS,id); const file=path.join(dir,'rag_inventory.json')
  if (fs.existsSync(file)) return readJSON(file)
  const m=readJSON(path.join(dir,'manifest.json')); const target=m.targets.head
  if (!target.dist || m.exit_code===2) return { queries:[], screens:[], skipped:'측정 가능한 로컬 빌드가 없습니다' }
  const host=await serveDist(target.dist);const browser=await launch();const screens=[]
  try {
    for (const r of m.recipes.slice(0,4)) {
      const recipe=loadRecipe(r.id);const [w,h]=m.sizes[0];const ctx=await newContext(browser,{origin:host.origin,width:w,height:h,allowHosts:recipe.allow_hosts,stubs:recipe._stubs,blocked:[],writes:[],stubbed:[]})
      try { const page=await ctx.newPage();await enterScreen(page,recipe,{origin:host.origin,stepMs:cfg.timeouts.step_ms,gotoMs:cfg.timeouts.goto_ms,settleMs:cfg.timeouts.settle_ms});await settle(page,{stableMs:150,timeoutMs:1500});const facts=await page.evaluate(collectInventory);screens.push({screen:r.id,...facts}) } finally {await ctx.close()}
    }
  } finally {await browser.close();host.close()}
  const queries=screens.flatMap(s=>queriesFor(s.screen,s,m.sizes,interact)).slice(0,8)
  const health=queries.length ? await retrievalHealth(cfg) : {ok:true,skipped:'추가 검사 후보 없음'}
  const out={queries:queries.map(q=>JSON.stringify(q)),screens,interact,health,source:'browser-cssom'};writeJSON(file,out);return out
}
function approvedSizes (plan, inventory, manifest) {
  const size=[];const click=[];const valid=new Set(inventory.queries.map(s=>JSON.parse(s)).map(q=>q.id+'|'+q.recipe))
  for (const p of plan) {
    if (!valid.has(p.id+'|'+p.recipe) || !/^\[Q0[12]-001\]$/.test(p.basis||'') || !p.document_id) throw new Error('검색 근거와 검사 대상이 일치하지 않습니다')
    const screen=inventory.screens.find(s=>p.id===s.screen+'/viewport'||p.id===s.screen+'/click'); if(!screen)throw new Error('검사 화면이 없습니다')
    if(p.recipe==='viewport-boundary')size.push(...boundarySizes(screen.media,manifest.sizes))
    if(p.recipe==='interaction-width' && inventory.interact) {
      const sorted=[...manifest.sizes].sort((a,b)=>a[0]-b[0]);click.push(sorted[0],sorted.at(-1))
    }
  }
  const unique=xs=>[...new Map(xs.map(s=>[s.slice(0,2).join('x'),s.slice(0,2)])).values()]
  return { sizes:unique(size).slice(0,4), clicks:unique(click).slice(0,2) }
}
function validateCoverage (plan, inventory) {
  const got=new Set(plan.map(p=>p.id+'|'+p.recipe))
  const missing=inventory.queries.map(s=>JSON.parse(s)).filter(q=>!got.has(q.id+'|'+q.recipe))
  if(missing.length)throw new Error(`추가 검사 ${missing.length}개에 맞는 Dify 지식 근거를 찾지 못했습니다. 해당 조건 검사는 미완료입니다`)
}
async function adaptive (body, cfg, job, startAndWait, runStatus) {
  const dir=path.join(RUNS,body.run_id); const m=readJSON(path.join(dir,'manifest.json'));const inv=readJSON(path.join(dir,'rag_inventory.json'),{queries:[],screens:[]})
  let plan;try{plan=JSON.parse(body.plan||'[]')}catch(e){throw new Error('검사 계획 JSON이 아닙니다')}
  if(!Array.isArray(plan)||plan.length>8)throw new Error('검사 계획 상한을 넘었습니다')
  if(job.adapted)throw new Error('추가 검사는 한 번만 실행합니다')
  if(inv.queries.length) {await retrievalHealth(cfg);validateCoverage(plan,inv)}
  job.adapted=true
  const selected=approvedSizes(plan,inv,m);const audit={version:6,source:'dify',plan,selected,inventory_queries:inv.queries.length,status:'running',started_at:new Date().toISOString()}
  writeJSON(path.join(dir,'rag_plan.json'),audit)
  if(!selected.sizes.length&&!selected.clicks.length){audit.status='skipped';writeJSON(path.join(dir,'rag_plan.json'),audit);return {...runStatus(body.run_id,cfg),report_enabled:job.body.llm!=='off'}}
  // Scan the frozen build produced by the first pass; never reread a changing working directory.
  const host=await serveDist(m.targets.head.dist);const base=m.targets.base&&m.targets.base.dist?await serveDist(m.targets.base.dist):null
  fs.mkdirSync(path.join(dir,'before-adaptive'),{recursive:true});for(const name of ['manifest.json','defects.json','summary.json'])fs.copyFileSync(path.join(dir,name),path.join(dir,'before-adaptive',name))
  const sizes=[...new Map([...m.sizes,...selected.sizes].map(s=>[s.slice(0,2).join('x'),s.slice(0,2)])).values()]
  const args=['check','--url',host.origin,'--src',m.targets.head.src||m.targets.head.dist,'--recipe',m.recipes.map(r=>r.id).join(','),'--widths',sizes.map(s=>s.join('x')).join(','),'--llm','off','--title',m.title]
  if(base)args.push('--base-url',base.origin,'--base-src',m.targets.base.src||m.targets.base.dist)
  if(m.design)args.push('--design',Object.entries(m.design).map(([k,d])=>k+'='+path.join(dir,d.json)).join(','))
  if(inv.interact)args.push('--interact')
  if(selected.clicks.length)args.push('--interact-widths',selected.clicks.map(s=>s.join('x')).join(','))
  job.adaptivePending = { m, audit, host, base }
  try {
    const r = await startAndWait(args,null,3000,body.run_id)
    if (r.done) finishAdaptive(job, cfg, r.code)
    return {...runStatus(body.run_id,cfg),report_enabled:job.body.llm!=='off'}
  } catch (e) { releaseAdaptive(job); throw e }
}
function releaseAdaptive (job) {
  const pending = job?.adaptivePending
  if (!pending) return
  pending.host.close(); if (pending.base) pending.base.close()
  job.adaptivePending = null
}
function finishAdaptive (job, cfg, code) {
  const pending = job.adaptivePending
  if (!pending) return
  const { m, audit } = pending; const dir = path.join(RUNS, job.id)
  try {
    const next = readJSON(path.join(dir, 'manifest.json'))
    next.targets=m.targets;next.local=m.local;next.repo=m.repo;next.build=m.build;next.design=m.design
    audit.status=code===null || code===2 || next.status!=='done' ? 'failed' : 'done'
    audit.finished_at=new Date().toISOString();audit.total_sec=Math.round((Date.parse(audit.finished_at)-Date.parse(audit.started_at))/100)/10
    next.adaptive={source:'dify',extra_sizes:audit.selected.sizes,interaction_sizes:audit.selected.clicks,basis:audit.plan.map(p=>p.basis),status:audit.status}
    writeJSON(path.join(dir,'manifest.json'),next);writeJSON(path.join(dir,'rag_plan.json'),audit)
  } finally { releaseAdaptive(job) }
}

module.exports={inventoryFor,approvedSizes,adaptive,retrievalHealth,validateCoverage,finishAdaptive,releaseAdaptive}
