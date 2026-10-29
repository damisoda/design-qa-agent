(function (root) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  let timer = null; let active = null
  const chosen = (st, designs) => (designs || []).find(d => d.name === (st.designs || {})[''])
  function connectionMessage (st, files, hasDesign) {
    if (st.figmaError) return st.figmaError
    if (st.figmaOpening) return 'Figma 앱과 dqa 플러그인을 연결하고 있습니다…'
    if (st.figmaImporting) return '선택한 Figma 프레임을 가져오고 있습니다…'
    if (!st.figmaSelecting && hasDesign) return ''
    if (!files.length && st.figmaLaunch?.message) return st.figmaLaunch.message
    if (!files.length && st.figmaLaunch?.status === 'requested') return Date.now() - st.figmaLaunch.requested_at < 15000 ? '플러그인 실행을 요청했습니다. 실제 연결 응답을 기다리고 있습니다…' : '플러그인 연결이 끊겼습니다. Figma에서 비교할 파일을 열고 ‘Figma 연결하기’를 다시 누르세요.'
    if (!files.length) return st.figmaOpenRequested ? '앱 열기 요청을 보냈습니다. 아직 dqa 플러그인이 연결되지 않았습니다.' : 'Figma의 dqa 플러그인 연결을 기다리고 있습니다.'
    return files.some(f => f.frames.length) ? '프레임이 연결됐습니다. 아래 이름을 확인하고 가져오세요.' : '플러그인이 연결됐습니다. Figma 캔버스나 왼쪽 레이어에서 프레임을 선택하세요.'
  }
  function guide (st, files) {
    if (!st.figmaSelecting || files.length) return ''
    if (!files.length && (st.figmaOpening || (st.figmaLaunch?.status === 'requested' && Date.now() - st.figmaLaunch.requested_at < 15000))) return '<div class="figma-connection-guide"><b>Figma에서 비교할 파일을 열어 두세요</b><p class="hint">플러그인이 연결되면 Figma에서 선택한 프레임이 아래에 나타납니다.</p></div>'
    return `<div class="figma-connection-guide"><b>${files.length ? 'Figma에서 선택한 프레임을 가져옵니다' : '자동 연결이 안 될 때 직접 실행하는 방법'}</b>
      ${!files.length ? `<ol><li>Figma 앱에서 비교할 디자인 파일을 여세요.</li><li>상단 메뉴 <strong>플러그인 → 개발 → dqa 시안 내보내기</strong>를 실행하세요.</li><li>캔버스나 왼쪽 레이어에서 프레임을 선택하세요.</li></ol><p class="hint">플러그인 창을 열어 두면 이 화면에 선택한 프레임과 가져오기 버튼이 나타납니다. 앱이 보이지 않으면 Dock의 Figma 아이콘을 눌러 주세요.</p>` : '<p class="hint">Figma에서 선택을 바꾸면 아래 목록도 바뀝니다. 플러그인 창은 열어 두세요.</p>'}
      <p class="hint">자동 연결을 켜두면 다른 파일을 열 때도 플러그인을 연결합니다. 연결되지 않을 때만 ‘Figma 연결하기’를 눌러 다시 시도하세요.</p></div>`
  }
  function html (st, designs) {
    const d = chosen(st, designs)
    return `<section class="figma-connect" aria-label="Figma 시안 연결"><div class="section-heading"><span class="step-number">01</span><div><h2>Figma 시안 가져오기</h2><p class="hint">Figma에서 프레임을 선택한 뒤 가져오세요.</p></div></div><label class="hint"><input type="checkbox" id="figma-follow" ${st.figmaAuto !== false ? 'checked' : ''}> Figma 선택 자동 연결</label><p class="hint connection-note">이 페이지를 열어 두면 Figma의 선택을 따라갑니다. 시안 변경은 다시 가져와야 반영됩니다.</p><button class="btn" type="button" id="figma-open" ${st.figmaOpening ? 'disabled' : ''}>Figma 연결하기</button>
      <div id="figma-status" role="status" aria-live="polite">${esc(connectionMessage(st, st.figmaFiles || [], !!d))}</div><div id="figma-guide">${guide(st, st.figmaFiles || [])}</div><div id="figma-files"></div>
      <div id="figma-chosen">${d ? `${st.figmaBatch?.length > 1 ? `<label class="field">가져온 프레임<select id="imported-frame">${st.figmaBatch.map(x => `<option value="${esc(x.name)}" ${d.name === x.name ? 'selected' : ''}>${esc(x.frame)}</option>`).join('')}</select></label>` : ''}${preview(d)}` : ''}</div>
      <details id="figma-help"><summary>다른 시안 가져오기 · 연결 도움말</summary>
      <label class="field">Figma 파일·프레임 링크<input id="figma-url" type="url" value="${esc(st.figmaUrl || '')}" placeholder="https://www.figma.com/design/…"></label>
      <p class="hint">Figma에서 프레임을 선택하고 ‘dqa 시안 내보내기’ 플러그인을 실행하면, 이 화면에서 바로 가져올 수 있습니다.</p>
      <label class="field">최근 가져온 시안<select data-design=""><option value="">선택하세요</option>${(designs || []).map(d => `<option value="${esc(d.name)}" ${d.name === (st.designs || {})[''] ? 'selected' : ''}>${esc(d.file || d.group || 'Figma 내보내기')} / ${esc(d.frame)} (${esc(d.base || '')})</option>`).join('')}</select></label>
      <p class="hint">최초 한 번: Figma의 Plugins → Development → Import plugin from manifest에서 프로젝트의 figma-plugin/manifest.json을 등록하세요.</p></details>
    </section>`
  }

  function preview (d) {
    return `<div class="connected-design">${d.png ? `<img src="/api/designs/${encodeURIComponent(d.name)}/design.png?v=${encodeURIComponent(d.saved_at || '')}" alt="${esc(d.frame)} 시안 미리보기">` : ''}<div><span class="chip ok">가져온 시안</span><h3>${esc(d.frame)}</h3><p>${esc(d.file || 'Figma 내보내기')}${d.page ? ` / ${esc(d.page)}` : ''}</p><p class="hint">${esc((d.base || '').replace('x', '×'))} · 가져온 시각 ${esc(d.saved_at ? new Date(d.saved_at).toLocaleString('ko-KR') : '기록 없음')}</p><p class="hint">프레임 ID ${esc(d.frame_id || '기록 없음')} · 자동 동기화되지 않습니다.</p><div class="figma-actions"><button class="btn sm" type="button" id="figma-refresh">이 시안 다시 가져오기</button><button class="btn sm" type="button" id="figma-clear">다른 시안 선택</button></div></div></div>`
  }
  function close () { clearInterval(timer); timer = null; active = null }
  function mount (st, api, getDesigns, setDesigns, rerender, toast) {
    close(); active = st; let busy = false; let signature = ''; let lastReady = st.figmaReady || ''
    const status = message => { const e = document.getElementById('figma-status'); if (e && active === st) e.textContent = message }
    const wireClear = () => {
      const refresh = document.getElementById('figma-refresh')
      if (refresh) refresh.onclick = async () => {
        refresh.disabled = true; status('같은 Figma 프레임의 최신 값을 가져오고 있습니다…')
        try {
          const j = await api('/api/figma/refresh', { design: chosen(st, getDesigns()).name })
          st.figmaSession = j.session.id; st.figmaImporting = true; st.figmaError = ''; lastReady = ''; await tick()
        } catch (e) { st.figmaError = e.message; status(e.message); document.getElementById('figma-help').open = true; refresh.disabled = false }
      }
 const b = document.getElementById('figma-clear'); if (b) b.onclick = () => { st.figmaSelecting = true; st.figmaError = ''; rerender() } }
    wireClear()
    const importedFrame = document.getElementById('imported-frame')
    if (importedFrame) importedFrame.onchange = () => { st.figmaSaved = importedFrame.value; st.designs[''] = importedFrame.value; rerender() }
    document.getElementById('figma-follow').onchange = e => { st.figmaAuto = e.target.checked; st.figmaError = ''; rerender() }
    document.getElementById('figma-url').oninput = e => { st.figmaUrl = e.target.value }
    document.getElementById('figma-open').onclick = async () => {
      st.figmaSelecting = true; st.figmaOpening = true; st.figmaLaunch = null; st.figmaError = ''; rerender()
      try {
        const j = await api('/api/figma/open', { url: st.figmaUrl || '', launch_plugin: true })
        st.figmaSession = j.session.id; st.figmaLaunch = j.session.launch; st.figmaOpenRequested = true; st.figmaFiles = j.files || []
      } catch (e) { st.figmaError = e.message }
      finally { st.figmaOpening = false; rerender() }
    }
    async function tick () {
      if (busy || active !== st || !document.getElementById('figma-files')) return
      busy = true
      try {
        const j = st.figmaAuto !== false ? await api('/api/figma/watch', {}) : await api('/api/figma/session')
        if (j.session && st.figmaSession !== j.session.id) st.figmaSession = j.session.id
        if (active !== st) return
        const session = st.figmaSession && j.session?.id === st.figmaSession ? j.session : {state:'waiting', saved:[]} 
        const files = j.files || []; st.figmaFiles = files
        const selectionKey = JSON.stringify(files.map(f => [f.id,f.page,f.frames]))
        if (files.length && selectionKey !== st.figmaLastSelection && session.state !== 'exporting') {
          st.figmaSelecting = true; st.figmaError = ''
        }
        st.figmaLastSelection = selectionKey
        if (session.launch) st.figmaLaunch = session.launch
        st.figmaImporting = session.state === 'exporting'
        if (session.state === 'error') st.figmaError = session.error
        status(connectionMessage(st, files, !!chosen(st, getDesigns())))
        document.getElementById('figma-guide').innerHTML = guide(st, files)
        const refresh = document.getElementById('figma-refresh'); if (refresh) refresh.disabled = st.figmaImporting
        const sig = JSON.stringify({ selecting: st.figmaSelecting, chosen: chosen(st,getDesigns())?.name, state: session.state, files: files.map(f => ({ id: f.id, file: f.file, page: f.page, frames: f.frames })) })
        if (sig !== signature) {
          signature = sig
          document.getElementById('figma-files').innerHTML = chosen(st,getDesigns()) && !st.figmaSelecting ? '' : files.map(f => `<div class="figma-file"><span class="chip ok">Figma 앱에서 선택 중</span><p><b>${esc(f.file)}</b></p><p class="hint">${esc(f.page)} · ${f.frames.length ? `${f.frames.length}개 프레임 선택됨` : 'Figma에서 비교할 프레임을 선택하세요'}</p>${f.frames.map(x => `<p class="small">${esc(x.name)} · ${x.w}×${x.h}</p>`).join('')}<button class="btn primary" type="button" data-figma-import="${esc(f.id)}" ${!f.frames.length || session.state === 'exporting' ? 'disabled' : ''}>가져오기</button></div>`).join('')
          document.querySelectorAll('[data-figma-import]').forEach(b => { b.onclick = async () => { b.disabled = true; try { st.figmaBatch = null; const imported = await api('/api/figma/import', { session_id: st.figmaSession, client_id: b.dataset.figmaImport }); st.figmaSession = imported.session.id; st.figmaError = ''; st.figmaImporting = true; lastReady = ''; status('선택한 실제 프레임을 가져오고 있습니다') } catch (e) { status(e.message); b.disabled = false } } })
        }
        if (session.state === 'ready' && session.saved.length && lastReady !== session.request_id) {
          if (session.saved.length > 1) st.figmaBatch = session.saved
          lastReady = session.request_id; st.figmaReady = lastReady; st.figmaError = ''; st.figmaImporting = false; st.figmaSelecting = false
          const list = (await api('/api/designs')).designs || []; setDesigns(list)
          if (!st.figmaSaved || !session.saved.some(x => x.name === st.figmaSaved)) st.figmaSaved = session.saved[0].name
          st.designs = { ...(st.designs || {}), '': st.figmaSaved }
          const d = chosen(st, list)
          document.getElementById('figma-chosen').innerHTML = `${session.saved.length > 1 ? `<label class="field">이번에 가져온 프레임<select id="imported-frame">${session.saved.map(x => `<option value="${esc(x.name)}">${esc(x.frame)}</option>`).join('')}</select></label>` : ''}${d ? preview(d) : ''}`
          wireClear()
          const select = document.getElementById('imported-frame'); if (select) { select.value = st.figmaSaved; select.onchange = () => { st.figmaSaved = select.value; st.designs[''] = select.value; rerender() } }
          toast('Figma 시안을 가져왔습니다'); rerender()
        }
      } catch (e) { status('Figma 연결 상태를 다시 확인하고 있습니다.') }
      finally { busy = false }
    }
    timer = setInterval(tick, 1000); tick()
  }
  const value = { html, mount, close, chosen, preview, connectionMessage, guide }
  if (typeof module !== 'undefined') module.exports = value
  else root.DqaFigma = value
})(typeof window !== 'undefined' ? window : null)
