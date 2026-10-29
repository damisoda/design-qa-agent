(function (root) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const TESTS = { R1: '넘침', R2: '잘림', R3: '겹침', R4: '가려짐', R6: '줄바꿈', R7: '화면 틀', A1: '터치 영역', A2: '글자 대비', D4: '그림', G1: '기호 아이콘', 'design-box': '시안 상자·색·모서리', 'design-text': '시안 글자·문구·색', 'design-final': '시안 크기·정렬·제약 확인', click: '버튼 반응', I1: '눌러도 반응 없음', I2: '누르면 오류', I3: '빈 도착 화면', I4: '시안 목적지와 다름', T1: '문구 다름', M1: '시안 글자 없음', M2: '시안 그림 없음', D2: '색 다름', D3: '글자 스타일 다름', D5: '모서리·테두리 다름', L1: '정렬 어긋남', L2: '간격 다름', F1: '크기 방식 다름' }
  const testName = test => TESTS[test] || TESTS[String(test).split('-')[0]] || test
  function rectPercent (box, width, height) {
    if (!box || !(width > 0 && height > 0)) return null
    const x = box.left ?? box.x; const y = box.top ?? box.y; const w = box.width ?? box.w; const h = box.height ?? box.h
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null
    const left = Math.max(0, x); const top = Math.max(0, y); const right = Math.min(width, x + w); const bottom = Math.min(height, y + h)
    if (right <= left || bottom <= top) return null
    return { left: left / width * 100, top: top / height * 100, width: (right - left) / width * 100, height: (bottom - top) / height * 100 }
  }
  const keyOf = row => `${row.phase}/${row.side}/${row.screen}/${row.size}/${row.scroll_step || 0}/${row.figma ? row.figma.id : row.element && (row.element.path || row.element.fp) || row.id}`
  function groupRows (rows, size, phase) {
    const groups = new Map()
    for (const row of rows) {
      if (row.size !== size || row.phase !== phase || row.side !== 'head') continue
      const key = keyOf(row); const old = groups.get(key) || { key, rows: [], latest: row }
      old.rows.push(row); if (row.seq >= old.latest.seq) old.latest = row
      groups.set(key, old)
    }
    return [...groups.values()].sort((a, b) => a.latest.seq - b.latest.seq)
  }
  function emptyMessage (rows, size, phase, running) {
    const name = { measure: '화면 검사', design: 'Figma 비교', interact: '버튼 반응 검사' }[phase] || '검사'
    if (rows.some(r => r.side === 'head' && r.phase === phase)) return `이 크기(${size.replace('x', '×')})에서는 ${name}를 실행하지 않았습니다.`
    return running ? `${name}의 실제 요소 기록을 기다리고 있습니다.` : `이 단계(${name})의 요소 기록이 없습니다.`
  }
  function statusLabel (row, running, findings) {
    if (row.status === 'interrupted') return '검사 중단'
    if (row.status === 'checking') return running ? '검사 중' : '완료 여부 확인 안됨'
    return findings ? '측정 차이 있음' : '확인한 요소'
  }
  function html () {
    return `<section class="element-inspector" aria-label="요소별 실제 검사"><div class="inspector-toolbar"><div><h2 class="h2">어디를 확인하고 있나요?</h2><p class="hint" id="element-state" role="status">실제 검사 요소를 기다리고 있습니다.</p></div><label>화면 크기 <select id="element-size" aria-label="요소 검사 화면 크기"></select></label><button class="btn sm" type="button" id="element-follow" aria-pressed="true">검사 요소 따라가기</button></div>
    <div class="inspection-tabs" role="group" aria-label="요소 검사 종류"><button type="button" data-inspection-phase="measure">화면 검사</button><button type="button" data-inspection-phase="design">Figma 비교</button><button type="button" data-inspection-phase="interact">버튼 반응</button></div>
    <div class="inspector-view-filter" role="group" aria-label="표시할 요소"><button type="button" id="element-problems" aria-pressed="false">차이 있는 요소</button><button type="button" id="element-all" aria-pressed="true">전체 요소</button></div><div class="element-workspace"><nav class="element-list" id="element-list" aria-label="확인한 요소 목록"></nav><div class="element-canvases" id="element-canvases"></div><aside class="element-detail" id="element-detail" aria-label="선택 요소의 측정 근거"></aside></div></section>`
  }
  function mount (id, api, file, toast) {
    const records = new Map(); let size = ''; let phase = 'measure'; let selected = ''; let follow = true; let context = null; let closed = false; let scheduled = false; let revealed = ''; let onlyProblems = false
    const stream = new EventSource(`/api/runs/${encodeURIComponent(id)}/inspection-stream`)
    const schedule = () => { if (scheduled || closed) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; render() }) }
    const receive = row => {
      if (!row || !row.id) return
      if (records.has(row.id) && records.get(row.id).seq >= row.seq) return
      records.set(row.id, row)
      if (!size) size = row.size
      if (follow && row.side === 'head') { size = row.size; phase = row.phase; selected = keyOf(row) }
      schedule()
    }
    stream.addEventListener('snapshot', e => { const j = JSON.parse(e.data); for (const row of j.items || []) receive(row) })
    stream.addEventListener('inspect', e => receive(JSON.parse(e.data)))
    stream.addEventListener('complete', () => stream.close())
    stream.onerror = () => { const e = document.getElementById('element-state'); if (e && records.size === 0) e.textContent = '요소 기록에 다시 연결하고 있습니다.' }
    document.getElementById('element-problems').onclick = () => { onlyProblems = true; follow = false; selected = ''; schedule() }
    document.getElementById('element-all').onclick = () => { onlyProblems = false; schedule() }
    const sizeSelect = document.getElementById('element-size')
    sizeSelect.onchange = () => { size = sizeSelect.value; selected = ''; follow = false; schedule() }
    document.querySelectorAll('[data-inspection-phase]').forEach(b => { b.onclick = () => { phase = b.dataset.inspectionPhase; selected = ''; follow = false; schedule() } })
    document.getElementById('element-follow').onclick = () => {
      follow = !follow
      if (follow) { onlyProblems = false; const last = [...records.values()].filter(r => r.side === 'head' && r.size === size).sort((a, b) => b.seq - a.seq)[0]; if (last) { phase = last.phase; selected = keyOf(last) } }
      schedule()
    }
    function figure (caption, shot, box, width, height, variant, number) {
      if (!shot) return `<figure class="element-figure"><figcaption>${esc(caption)}</figcaption><div class="element-no-image">${variant === 'figma' ? '이 검사에는 대응 시안 요소가 없습니다. Figma 비교 탭에서 실제 짝을 확인하세요.' : '해당 요소의 화면 캡처를 준비하고 있습니다.'}</div></figure>`
      const rect = rectPercent(box, width, height)
      return `<figure class="element-figure"><figcaption>${esc(caption)}</figcaption><div class="element-image"><img src="${esc(file(id, shot))}" alt="${esc(caption)}">${rect ? `<span class="element-outline ${variant === 'figma' ? 'figma' : ''}" style="left:${rect.left}%;top:${rect.top}%;width:${rect.width}%;height:${rect.height}%" aria-hidden="true"><span class="annotation-index">${esc(number)}</span></span>` : ''}</div></figure>`
    }
    function render () {
      if (closed || !document.getElementById('element-list')) return
      const all = [...records.values()]
      const sizes = [...new Set([...(context && context.manifest.sizes || []).map(v => v.join('x')), ...all.map(r => r.size)])]
      if (!size && sizes.length) size = sizes[0]
      const sizeHtml = sizes.map(s => `<option value="${esc(s)}" ${s === size ? 'selected' : ''}>${esc(s.replace('x', '×'))}</option>`).join('')
      if (sizeSelect.innerHTML !== sizeHtml) sizeSelect.innerHTML = sizeHtml
      const button = document.getElementById('element-follow'); button.setAttribute('aria-pressed', String(follow)); button.textContent = follow ? '자동 따라가기: 켜짐' : '자동 따라가기: 꺼짐'
      document.querySelectorAll('[data-inspection-phase]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.inspectionPhase === phase)); b.classList.toggle('on', b.dataset.inspectionPhase === phase) })
      const available = groupRows(all, size, phase)
      const differing = g => g.rows.some(r => r.findings && r.findings.length)
      // Following shows every observed element; filtering is an explicit user choice.
      const groups = onlyProblems ? available.filter(differing) : available
      document.getElementById('element-problems').setAttribute('aria-pressed', String(!!onlyProblems))
      document.getElementById('element-problems').textContent = `차이 있는 요소 ${available.filter(differing).length}`
      document.getElementById('element-all').setAttribute('aria-pressed', String(!onlyProblems))
      document.getElementById('element-all').textContent = `전체 요소 ${available.length}`
      let group = groups.find(g => g.key === selected)
      if (!group && groups.length) { group = groups.at(-1); selected = group.key }
      const list = document.getElementById('element-list')
      const focused = document.activeElement && document.activeElement.dataset.elementKey
      list.innerHTML = groups.map(g => {
        const row = g.latest; const label = row.figma ? row.figma.name : row.element && (row.element.label || row.element.tag) || '요소'
        const findings = g.rows.flatMap(r => r.findings || [])
        return `<button type="button" data-element-key="${esc(g.key)}" aria-pressed="${g.key === selected}"><b>${esc(label)}</b><span>${statusLabel(row, context && context.running, findings.length)} · ${esc(findings.length ? [...new Set(findings.map(f => testName(f.rule)))].join(' · ') : testName(row.test))}</span></button>`
      }).join('') || '<p class="hint">이 크기·단계에서 확인한 요소가 아직 없습니다. 시안 비교와 버튼 반응은 검사한 크기에서만 표시됩니다.</p>'
      list.querySelectorAll('[data-element-key]').forEach(b => { b.onclick = () => { selected = b.dataset.elementKey; follow = false; schedule() } })
      if (focused) { const b = [...list.querySelectorAll('[data-element-key]')].find(x => x.dataset.elementKey === focused); if (b) b.focus({ preventScroll: true }) }
      if (selected !== revealed) {
        const current = [...list.querySelectorAll('[data-element-key]')].find(b => b.dataset.elementKey === selected)
        if (current) { const box = current.getBoundingClientRect(); const area = list.getBoundingClientRect(); if (box.bottom > area.bottom) list.scrollTop += box.bottom - area.bottom; else if (box.top < area.top) list.scrollTop -= area.top - box.top }
        revealed = selected
      }
      const state = document.getElementById('element-state'); const canvases = document.getElementById('element-canvases'); const detail = document.getElementById('element-detail')
      if (!group) { state.textContent = onlyProblems && available.length ? '지금까지 이 단계에서 측정 차이가 나온 요소가 없습니다. 전체 요소에서 측정 기록을 확인하세요.' : emptyMessage(all, size, phase, context && context.running); canvases.innerHTML = `<div class="element-no-image">${esc(state.textContent)}</div>`; canvases.dataset.html = ''; detail.innerHTML = ''; return }
      const row = group.latest; const label = row.figma ? row.figma.name : row.element && (row.element.label || row.element.tag) || '요소'
      const ongoing = row.status === 'checking' && context && context.running && ['measure', 'design', 'interact'].includes(context.progress && context.progress.phase)
      const observedRules = [...new Set(group.rows.flatMap(r => r.findings || []).map(f => testName(f.rule)))]
      state.textContent = `${ongoing ? '현재 검사' : '확인한 요소'}: ${label} · ${observedRules.length && !ongoing ? observedRules.join(' · ') : testName(row.test)}${row.total ? ` (${row.ordinal}/${row.total})` : ''}`
      const matching = (context && context.defects || []).filter(d => (phase === 'design' ? d.kind === 'design' : phase === 'interact' ? d.kind === 'interact' : !['design', 'interact'].includes(d.kind)) && d.screen === row.screen && (d.design && d.design.node ? d.design.node.id === row.figma?.id : (d.elements || []).some(e => e.path === row.element?.path))).sort(DqaTriage.compare)
      const ordered = [...(context && context.defects || [])].sort(DqaTriage.compare)
      const marker = matching.length ? ordered.findIndex(d => d.id === matching[0].id) + 1 : available.indexOf(group) + 1
      const design = context && context.manifest.design && context.manifest.design[row.screen]
      const pair = figure(`구현 · ${row.size.replace('x', '×')}`, row.shot, row.element && row.element.box, row.width, row.height, 'impl', marker) +
        (phase === 'design' ? figure(`Figma · ${design && design.frame || '연결 시안'}`, row.figma_shot || design && design.png, row.figma && row.figma.box, row.figma_width || design && design.frame_size && design.frame_size[0], row.figma_height || design && design.frame_size && design.frame_size[1], 'figma', marker) : '')
      if (canvases.dataset.html !== pair) { canvases.innerHTML = pair; canvases.dataset.html = pair }
      const findings = [...new Map(group.rows.flatMap(r => r.findings || []).map(f => [f.rule + f.text, f])).values()]
      const completed = [...new Set(group.rows.filter(r => r.status === 'checked').map(r => testName(r.test)))]
      const style = row.element && row.element.style || {}
      const props = row.properties && row.properties.length ? row.properties : Object.entries({ '너비': row.element && row.element.box && row.element.box.width, '높이': row.element && row.element.box && row.element.box.height, '글자 크기': style.fontSize, '글자색': style.color, '넘침 처리': style.overflow, '줄바꿈': style.whiteSpace }).filter(([, v]) => v != null && v !== '').map(([name, impl]) => ({ name, impl }))
      const detailHtml = `<h3>${esc(label)}</h3><p class="hint">확인한 검사: ${esc(completed.join(', ') || '진행 중')}</p>${row.figma && row.figma.id ? '<button class="btn sm" type="button" id="focus-figma-node">Figma에서 이 요소 보기</button>' : ''}${findings.map(f => `<div class="observed-difference"><b>${esc(testName(f.rule))}</b><p>${esc(f.text)}</p></div>`).join('')}<table class="element-values"><thead><tr><th>측정 항목</th>${phase === 'design' ? '<th>시안</th>' : ''}<th>구현</th></tr></thead><tbody>${props.map(p => `<tr><td>${esc(p.name)}</td>${phase === 'design' ? `<td>${esc(p.design == null ? '—' : p.design)}</td>` : ''}<td>${esc(p.impl)}</td></tr>`).join('')}</tbody></table><p class="hint">${findings.length ? '실제 측정에서 나온 근거입니다. 최종 결함은 묶기·재측정 후 정리됩니다.' : '이 요소에서 확인한 측정값입니다. 다른 규칙과 다른 크기의 결과는 별도로 확인합니다.'}</p>`
      if (detail.dataset.html !== detailHtml) { detail.innerHTML = detailHtml; detail.dataset.html = detailHtml }
      const focus = document.getElementById('focus-figma-node')
      if (focus) focus.onclick = async () => {
        focus.disabled = true
        try {
          const j = await api('/api/figma/focus', { run_id: id, inspection_id: row.id }); toast('Figma에 요소 선택을 요청했습니다')
          let acknowledged = false
          for (let i = 0; i < 16; i++) { const r = await api('/api/figma/result/' + j.request_id); if (r.result) { if (!r.result.ok) throw new Error(r.result.error); acknowledged = true; toast(`${r.result.name}을 Figma에서 선택했습니다`); break } await new Promise(resolve => setTimeout(resolve, 500)) }
        if (!acknowledged) throw new Error('Figma의 선택 확인이 도착하지 않았습니다. 해당 파일에서 dqa 플러그인이 실행 중인지 확인하세요.')
        } catch (e) { toast(e.message) } finally { focus.disabled = false }
      }
    }
    return { selectDefect: d => {
      const row = DqaTriage.inspectionFor(d, [...records.values()])
      if (!row) return false
      size = row.size; phase = row.phase; selected = keyOf(row); follow = false; onlyProblems = false; schedule(); return true
    }, update: j => { context = j; schedule() }, close: () => { closed = true; stream.close() } }
  }
  const value = { html, mount, rectPercent, groupRows, keyOf, testName, emptyMessage, statusLabel }
  if (typeof module !== 'undefined') module.exports = value
  else root.DqaInspection = value
})(typeof window !== 'undefined' ? window : null)
