/* Presentation controls show recorded evidence only; they never start or alter a run. */
(function(root){
  const labels=['문제 위치','모델이 읽은 코드','코드 변경','재검증 결과']
  function evidence(j){
    const r=j.repair||{},tasks=r.fix?.app_plan?.tasks||[]
    const reads=tasks.flatMap(t=>(t.observations||[]).filter(o=>o.action==='read'))
    const edits=tasks.flatMap(t=>(t.decisions||[]).filter(d=>['edit','style','rn_style','jsx_prop'].includes(d.action)))
    const c=r.fix_comparison
    const complete=j.pipeline?.state==='succeeded' && j.manifest?.adaptive?.status!=='failed' && r.fix_pipeline?.state==='succeeded' && c?.verified===true
    const failed=['failed','cancelled','timeout'].includes(j.pipeline?.state)||['failed','cancelled','timeout'].includes(r.fix_pipeline?.state)||j.manifest?.adaptive?.status==='failed'
    const issue=(j.defects||[]).find(d=>d.id===tasks[0]?.representative)||(j.defects||[])[0]
    return {r,reads,edits,c,complete,failed,issue}
  }
  function html(){return `<nav class="present-nav" aria-label="발표 순서"><span>발표 순서</span>${labels.map((s,i)=>`<button class="btn sm" type="button" data-present-step="${i}" aria-pressed="false">${i+1}. ${s}</button>`).join('')}<button class="btn sm" type="button" id="present-all">전체 검사 보기</button><span id="present-status" class="hint"></span></nav>`}
  function panel(step,j,id,esc,file,repairRender,selected=0){
    const e=evidence(j),waiting=s=>`<div class="present-wait" role="status"><h2>${labels[step]}</h2><p>${esc(s)}</p><p class="hint">이 실행에서 받은 기록만 표시합니다.</p></div>`
    if(step===0)return ''
    if(step===1){
      if(!e.reads.length)return waiting(e.failed?'실행이 중단되어 코드 읽기 기록이 없습니다.':'모델이 파일을 읽으면 이곳에 실제 읽은 내용이 나타납니다.')
      return `<section class="present-evidence"><span class="chip">모델 도구 호출 · read</span><h2>모델이 읽은 코드</h2><p class="hint">파일 읽기 도구가 모델에 돌려준 원문입니다.</p>${e.reads.map((o,i)=>`<details ${i===0?'open':''}><summary>${esc(o.file||'파일')} · ${esc(new Date(o.at).toLocaleTimeString('ko-KR'))}</summary><pre>${esc(o.content||'내용 기록 없음')}</pre></details>`).join('')}</section>`
    }
    if(step===2){
      if(!e.edits.length)return waiting(e.failed?'실행이 중단되어 수정 지시 기록이 없습니다.':'모델이 수정 방법을 선택하고 있습니다. 수정 지시를 받으면 표시합니다.')
      return `<section class="present-evidence"><span class="chip">모델 도구 호출 · 수정</span><h2>모델이 선택한 코드 변경</h2><p class="hint">${e.complete?'최종 수정 사본은 재검증을 통과했습니다. 아래는 모델이 낸 수정 지시입니다.':'모델의 수정 지시입니다. 재검증을 통과하기 전에는 성공으로 확정하지 않습니다.'}</p>${e.edits.map(d=>`<article><h3>${esc(d.file||d.action)}${d.start?' · '+esc(d.start)+'줄':''}</h3>${d.find!==undefined?`<div class="present-code-pair"><div><b>수정 전</b><pre>${esc(d.find)}</pre></div><div><b>수정 지시</b><pre>${esc(d.replace)}</pre></div></div>`:`<pre>${esc(JSON.stringify(d,null,2))}</pre>`}${d.why?`<p>${esc(d.why)}</p>`:''}<details><summary>원본 도구 호출 기록</summary><pre>${esc(JSON.stringify(d,null,2))}</pre></details></article>`).join('')}</section>`
    }
    if(!e.complete)return waiting(e.failed?'검증을 완료하지 못했습니다. 실행 로그에서 실패 원인을 확인하세요.':j.running?'수정·재검증 결과를 기다리고 있습니다. 완료되면 전후 화면과 검증 결과가 나타납니다.':'검증을 통과한 수정 결과가 없습니다.')
    const screens=new Set(e.c.frames.map(f=>f.screen)).size,sizes=new Set(e.c.frames.map(f=>f.size)).size
    return `<section class="present-evidence"><span class="chip ok">Dify 검사·수정 완료</span><h2>수정 후 다시 검사한 결과</h2><p>${screens}개 화면 · ${sizes}개 크기에서 확인 · 원본 적용은 별도 승인</p>${repairRender({id,comparison:e.c,selected,defect:e.issue,defects:e.issue?[e.issue]:[],number:1,pipeline:e.r.fix_pipeline},esc,file)}<details><summary>Dify 실행 기록</summary><p>검사: ${esc(j.pipeline.workflow_run_id)}</p><p>수정: ${esc(e.r.fix_pipeline.workflow_run_id)}</p></details></section>`
  }
  function mount(id,esc,file,inspection){
    let latest=null,step=-1,last='',selected=0,lastContent=''
    const nav=document.querySelector('.present-nav'),body=document.getElementById('present-evidence'),wrap=document.querySelector('.live-wrap')
    function render(){
      if(!latest)return
      wrap.dataset.present=step<0?'off':String(step)
      nav.querySelectorAll('[data-present-step]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.presentStep)===step)))
      document.getElementById('present-status').textContent=step<0?'버튼을 누르면 설명할 부분을 모아 보여줍니다.':latest.running?'실행 중 · 새 기록을 기다리는 단계도 선택할 수 있습니다.':'저장된 실제 실행 기록'
      const content=step<0?'':panel(step,latest,id,esc,file,root.DqaRepair.render,selected)
      if(lastContent!==content){body.innerHTML=content;lastContent=content}
      body.hidden=step<=0
      if(step===0){const issue=evidence(latest).issue;if(issue&&last!==issue.id&&inspection.selectDefect(issue))last=issue.id}
      wireFrame()
    }
    function wireFrame(){const frame=document.getElementById('repair-frame');if(frame)frame.onchange=()=>{selected=Number(frame.value);render()}}
    nav.querySelectorAll('[data-present-step]').forEach(b=>b.onclick=()=>{step=Number(b.dataset.presentStep);last='';render();nav.scrollIntoView({block:'start',behavior:'auto'})})
    document.getElementById('present-all').onclick=()=>{step=-1;render()}
    return {update:j=>{latest=j;render()}}
  }
  const exports={html,evidence,panel,mount};if(typeof module!=='undefined')module.exports=exports;else root.DqaPresentation=exports
})(typeof window==='undefined'?globalThis:window)
