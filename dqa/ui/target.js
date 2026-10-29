(function (root) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))
  let generation = 0
  const currentInfo = st => st.localInfo && [st.localInfo.local, st.localInfo.input_local].includes(st.local.trim())
  const selectedAll = st => currentInfo(st) ? st.localInfo.screens.filter(s => st.recipes.has(s.id)) : []
  const selected = st => selectedAll(st)[0] || null
  const binding = (st, s) => Object.prototype.hasOwnProperty.call(st.designs || {}, s.id) ? st.designs[s.id] : (selectedAll(st).length === 1 ? st.designs?.[''] || '' : '')
  function card (st, designs=[]) {
    const info = currentInfo(st) ? st.localInfo : null
    const chosen=selectedAll(st)
    return `<h3 class="h2">검사할 화면</h3>
      <div id="target-status" role="status">${esc(st.localError || '')}</div>
      ${info ? `<div class="screen-list-heading"><div><h3>${esc(info.name)}</h3><span class="hint">화면 후보 ${info.screens.length}개 · ${chosen.length}개 선택</span></div><button type="button" class="btn sm" id="rescan-screens">다시 찾기</button></div><details class="project-path"><summary>프로젝트 경로 확인</summary><p class="target-path">${esc(info.local)}</p></details>
      ${info.build_error ? `<p class="err">${esc(info.build_error)}</p>` : ''}
      <div class="screen-list">${info.screens.map(s => {
        const checked=st.recipes.has(s.id); const d=binding(st,s)
        return `<section class="screen-row ${checked?'is-selected':''}"><label class="screen-choice"><input type="checkbox" data-screen="${esc(s.id)}" ${checked?'checked':''}><span><b>${esc(s.title)}</b><code>${esc(s.path)}</code></span></label>
        <p class="hint screen-source">${esc(s.via || '')}${s.source?` · ${esc(s.source)}`:''}</p>
        ${checked ? `${!s.registered ? `<label class="field">${s.dynamic?'실제 주소 입력 · :id 등을 바꿔 주세요':'검사할 주소'}<input data-screen-path="${esc(s.id)}" value="${esc(st.screenPaths?.[s.id] || (s.dynamic?'':s.path))}" placeholder="${s.dynamic?'/products/123':s.path}" autocomplete="off"></label>` : ''}
        <label class="field">비교할 Figma 프레임<select data-screen-design="${esc(s.id)}"><option value="">프레임을 연결하세요</option>${designs.map(x=>`<option value="${esc(x.name)}" ${d===x.name?'selected':''}>${esc(x.frame)} · ${esc(x.file || x.group || x.base || '')}</option>`).join('')}</select></label>
        <p class="hint">${s.steps?`등록된 ${s.steps}개 동작을 거쳐 검사합니다.`:'이 주소를 직접 열어 검사합니다.'}</p>`:''}</section>`
      }).join('')}</div>
      <details class="manual-screen"><summary>목록에 없는 화면 추가</summary><p class="hint">앱에서 열 수 있는 주소를 입력하세요. 예: /booking/123</p><div class="manual-screen-input"><input id="manual-screen-path" placeholder="/booking/123" aria-label="추가할 화면 주소"><button class="btn sm" type="button" id="add-screen">추가</button></div></details>
      <p class="hint">주소 목록은 소스에서 찾은 후보입니다. 로그인이나 클릭 후 나타나는 화면은 진입 절차를 별도로 확인해야 합니다.</p>
      ${(info.warnings||[]).map(w=>`<p class="hint">${esc(w)}</p>`).join('')}` : '<p class="empty compact">프로젝트 폴더를 입력하면 화면 목록을 찾습니다.</p>'}`
  }
  function summary (st, designs=[]) {
    const screens=selectedAll(st)
    if(!screens.length)return '<b>검사할 화면을 선택하세요</b><p class="hint">Figma에서 프레임을 가져온 다음 각 로컬 화면에 연결하세요.</p>'
    return `<b>${screens.length}개 화면 비교</b><ul class="screen-connections">${screens.map(s=>{
      const d=designs.find(d=>d.name===binding(st,s))
      return `<li><code>${esc(st.screenPaths?.[s.id] || s.path)}</code><span>↔</span><b>${esc(d?d.frame:'Figma 연결 필요')}</b></li>`
    }).join('')}</ul><p class="hint">검사를 시작하면 이 프로젝트의 연결을 dqa에 저장합니다. 시안을 바꿨다면 다시 가져오세요.</p>`
  }
  function payload(st, designs=[]) {
    if(st.localInfo?.build_error)throw new Error(st.localInfo.build_error)
    const screens=selectedAll(st)
    if(!screens.length)throw new Error('검사할 화면을 하나 이상 선택해 주세요.')
    return {local:st.local.trim(),screens:screens.map(s=>{
      const d=binding(st,s)
      if(!designs.some(x=>x.name===d))throw new Error(`${s.title}: 비교할 Figma 프레임을 연결해 주세요.`)
      const p=st.screenPaths?.[s.id] || (s.dynamic?'':s.path)
      if(!p)throw new Error(`${s.title}: 실제로 열 주소를 입력해 주세요.`)
      return {id:s.id,path:p,design:d,manual:!!s.manual}
    })}
  }
  function mount (st, api, rerender, designs=[]) {
    const current = ++generation
    document.querySelectorAll('[data-screen]').forEach(el=>{el.onchange=()=>{
      // Pin an existing one-screen connection before adding another screen.
      for(const s of selectedAll(st)) if(binding(st,s))st.designs={...st.designs,[s.id]:binding(st,s)}
      if(el.checked)st.recipes.add(el.dataset.screen);else st.recipes.delete(el.dataset.screen)
      st.err='';rerender()
    }})
    document.querySelectorAll('[data-screen-design]').forEach(el=>{el.onchange=()=>{st.designs={...st.designs,[el.dataset.screenDesign]:el.value, '':el.value};st.err='';rerender()}})
    document.querySelectorAll('[data-screen-path]').forEach(el=>{el.oninput=()=>{st.screenPaths={...st.screenPaths,[el.dataset.screenPath]:el.value};document.getElementById('comparison-summary').innerHTML=summary(st,designs)}})
    const add=document.getElementById('add-screen')
    if(add)add.onclick=()=>{
      const p=document.getElementById('manual-screen-path').value.trim()
      if(!p.startsWith('/') || p.startsWith('//') || /[\\\s]/.test(p)){st.err='앱 안의 주소를 /로 시작해서 입력해 주세요.';return rerender()}
      const same=st.localInfo.screens.find(s=>s.path===p)
      const id=same?.id || 'manual-'+Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join('')
      for(const s of selectedAll(st))if(binding(st,s))st.designs={...st.designs,[s.id]:binding(st,s)}
      if(!same)st.localInfo.screens.push({id,path:p,title:p,manual:true,steps:0,via:'직접 추가한 경로'})
      st.recipes.add(id);st.err='';rerender()
    }
    const input = document.querySelector('[data-k="local"]')
    if (!input) return
    let timer
    const inspect = async (force=false) => {
      const local=st.local.trim()
      if(!local || (!force && currentInfo(st)))return
      const el=document.getElementById('target-status');if(el)el.textContent='폴더에서 화면을 찾고 있습니다…'
      try {
        const info=await api('/api/local/inspect',{local})
        if(current!==generation || st.local.trim()!==local || !document.getElementById('target-status'))return
        const old=force && currentInfo(st) ? {recipes:st.recipes,designs:st.designs,paths:st.screenPaths}:null
        st.localInfo=info;st.localError='';st.err='';st.screenPaths={};st.designs={'':st.designs?.[''] || ''}
        const saved=(info.bindings||[]).filter(b=>info.screens.some(s=>s.id===b.id))
        st.recipes=new Set(saved.length?saved.map(b=>b.id):info.screens.length===1?[info.screens[0].id]:[])
        for(const b of saved){st.designs[b.id]=b.design;st.screenPaths[b.id]=b.path}
        if(!st.designs[''] && saved.length)st.designs['']=saved[0].design
        if(old){st.recipes=new Set([...old.recipes].filter(id=>info.screens.some(s=>s.id===id)));st.designs=old.designs;st.screenPaths=old.paths}
      } catch(e) {
        if(current!==generation || st.local.trim()!==local || !document.getElementById('target-status'))return
        st.localError=e.message;st.localInfo=null;st.recipes=new Set()
      }
      rerender()
    }
    const rescan=document.getElementById('rescan-screens');if(rescan)rescan.onclick=()=>inspect(true)
    input.oninput=()=>{
      st.local=input.value;st.localInfo=null;st.localError='';st.recipes=new Set();st.screenPaths={};st.designs={'':st.designs?.[''] || ''}
      document.getElementById('local-target').innerHTML=card(st,designs)
      document.getElementById('comparison-summary').textContent='프로젝트 경로가 바뀌었습니다. 화면 목록을 찾고 있습니다.'
      clearTimeout(timer);timer=setTimeout(()=>inspect(),600)
    }
    input.onchange=()=>{clearTimeout(timer);inspect()}
    if(st.local.trim() && !st.localInfo && !st.localError)inspect()
  }
  const value={card,summary,selected,selectedAll,binding,payload,mount}
  if(typeof module!=='undefined')module.exports=value
  else root.DqaTarget=value
})(typeof window!=='undefined'?window:null)
