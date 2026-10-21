(function (root) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  let timer = null; let active = null
  const chosen = (st, designs) => (designs || []).find(d => d.name === (st.designs || {})[''])
  function html (st, designs) {
    const d = chosen(st, designs)
    return `<section class="figma-connect" aria-label="Figma 시안 연결"><h2 class="h2">비교할 Figma 시안</h2>
      <div id="figma-status" role="status" aria-live="polite"></div><div id="figma-files"></div>
      <div id="figma-chosen">${d ? preview(d) : ''}</div>
      <details><summary>다른 시안 선택 · 연결 도움말</summary>
      <label class="field">Figma 파일·프레임 링크<input id="figma-url" type="url" value="${esc(st.figmaUrl || '')}" placeholder="https://www.figma.com/design/…"></label>
      <button class="btn" type="button" id="figma-open">Figma 앱 열기</button>
      <p class="hint">Figma에서 프레임을 선택하고 ‘dqa 시안 내보내기’ 플러그인을 실행하면, 이 화면에서 바로 가져올 수 있습니다.</p>
      <label class="field">최근 가져온 시안<select data-design=""><option value="">선택하세요</option>${(designs || []).map(d => `<option value="${esc(d.name)}" ${d.name === (st.designs || {})[''] ? 'selected' : ''}>${esc(d.file || d.group || 'Figma 내보내기')} / ${esc(d.frame)} (${esc(d.base || '')})</option>`).join('')}</select></label>
      <p class="hint">최초 한 번: Figma의 Plugins → Development → Import plugin from manifest에서 프로젝트의 figma-plugin/manifest.json을 등록하세요.</p></details>
    </section>`
  }

  function preview (d) {
    return `<div class="connected-design">${d.png ? `<img src="/api/designs/${encodeURIComponent(d.name)}/design.png" alt="${esc(d.frame)} 시안 미리보기">` : ''}<div><span class="chip ok">시안 연결됨</span><h3>${esc(d.frame)}</h3><p>${esc(d.file || 'Figma 내보내기')}${d.page ? ` / ${esc(d.page)}` : ''}</p><p class="hint">${esc((d.base || '').replace('x', '×'))} · 가져온 시각 ${esc(d.saved_at ? new Date(d.saved_at).toLocaleString('ko-KR') : '기록 없음')}</p><button class="btn sm" type="button" id="figma-clear">시안 연결 해제</button></div></div>`
  }
  function close () { clearInterval(timer); timer = null; active = null }
  function mount (st, api, getDesigns, setDesigns, rerender, toast) {
    close(); active = st; let busy = false; let signature = ''; let lastReady = ''
    const status = message => { const e = document.getElementById('figma-status'); if (e && active === st) e.textContent = message }
    const wireClear = () => { const b = document.getElementById('figma-clear'); if (b) b.onclick = () => { st.designs = {}; st.figmaSaved = ''; rerender() } }
    wireClear()
    document.getElementById('figma-url').oninput = e => { st.figmaUrl = e.target.value }
    document.getElementById('figma-open').onclick = async () => {
      const b = document.getElementById('figma-open'); b.disabled = true; status('Figma 앱을 여는 중입니다')
      try { const j = await api('/api/figma/open', { url: st.figmaUrl || '' }); st.figmaSession = j.session.id; lastReady = ''; status('앱에서 파일을 열고 dqa 플러그인을 실행한 뒤 프레임을 선택하세요.'); await tick() }
      catch (e) { status(e.message) } finally { b.disabled = false }
    }
    async function tick () {
      if (busy || active !== st || !document.getElementById('figma-files')) return
      busy = true
      try {
        const j = await api('/api/figma/session')
        if (active !== st) return
        const session = st.figmaSession && j.session?.id === st.figmaSession ? j.session : {state:'waiting', saved:[]} 
        const files = j.files || []
        status(chosen(st,getDesigns()) ? '' : session.state === 'exporting' ? '선택한 실제 프레임을 가져오고 있습니다' : session.state === 'error' ? session.error : session.state === 'ready' ? '실제 Figma 프레임을 가져왔습니다.' : files.length ? 'Figma에서 선택한 프레임을 가져오세요.' : 'Figma에서 프레임을 선택하고 dqa 플러그인을 실행하세요. 아래 연결 도움말에서 앱을 열 수 있습니다.')
        const sig = JSON.stringify({ chosen: chosen(st,getDesigns())?.name, state: session.state, files: files.map(f => ({ id: f.id, file: f.file, page: f.page, frames: f.frames })) })
        if (sig !== signature) {
          signature = sig
          document.getElementById('figma-files').innerHTML = chosen(st,getDesigns()) ? '' : files.map(f => `<div class="figma-file"><b>${esc(f.file)}</b><p class="hint">${esc(f.page)} · ${f.frames.length ? `${f.frames.length}개 프레임 선택됨` : 'Figma에서 비교할 프레임을 선택하세요'}</p>${f.frames.map(x => `<p class="small">${esc(x.name)} · ${x.w}×${x.h}</p>`).join('')}<button class="btn primary" type="button" data-figma-import="${esc(f.id)}" ${!f.frames.length || session.state === 'exporting' ? 'disabled' : ''}>가져오기</button></div>`).join('')
          document.querySelectorAll('[data-figma-import]').forEach(b => { b.onclick = async () => { b.disabled = true; try { const imported = await api('/api/figma/import', { session_id: st.figmaSession, client_id: b.dataset.figmaImport }); st.figmaSession = imported.session.id; lastReady = ''; status('선택한 실제 프레임을 가져오고 있습니다') } catch (e) { status(e.message); b.disabled = false } } })
        }
        if (session.state === 'ready' && session.saved.length && lastReady !== JSON.stringify(session.saved)) {
          lastReady = JSON.stringify(session.saved)
          const list = (await api('/api/designs')).designs || []; setDesigns(list)
          if (!st.figmaSaved || !session.saved.some(x => x.name === st.figmaSaved)) st.figmaSaved = session.saved[0].name
          st.designs = { ...(st.designs || {}), '': st.figmaSaved }
          const d = chosen(st, list)
          document.getElementById('figma-chosen').innerHTML = `${session.saved.length > 1 ? `<label class="field">이번에 가져온 프레임<select id="imported-frame">${session.saved.map(x => `<option value="${esc(x.name)}">${esc(x.frame)}</option>`).join('')}</select></label>` : ''}${d ? preview(d) : ''}`
          wireClear()
          const select = document.getElementById('imported-frame'); if (select) { select.value = st.figmaSaved; select.onchange = () => { st.figmaSaved = select.value; st.designs[''] = select.value; rerender() } }
          toast('Figma 시안이 연결됐습니다')
        }
      } catch (e) { status('Figma 연결 상태를 다시 확인하고 있습니다.') }
      finally { busy = false }
    }
    timer = setInterval(tick, 1000); tick()
  }
  const value = { html, mount, close, chosen, preview }
  if (typeof module !== 'undefined') module.exports = value
  else root.DqaFigma = value
})(typeof window !== 'undefined' ? window : null)
