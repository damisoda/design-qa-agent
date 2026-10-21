/* Whole-screen evidence, with the existing monochrome numbered outline. */
(function (root) {
  function render ({ id, comparison: c, selected, defect, defects, number, pipeline }, esc, file) {
    if (!c) return ''
    const index = Math.min(selected || 0, Math.max(0, c.frames.length - 1))
    const f = c.frames[index]
    if (!f) return ''
    defect = (defects || []).find(d => d.screen === f.screen) || defect
    const [w, h] = f.size.split('x').map(Number)
    const evidence = (defect?.widths || []).find(x => `${x.w}x${x.h}` === f.size && (x.scroll_y || 0) === f.scroll_y)
    const marker = (box, width=w, height=h) => {
      if (!box || !width || !height || box.width <= 0 || box.height <= 0) return ''
      const x=Math.max(0,box.left), y=Math.max(0,box.top)
      const right=Math.min(width,box.left+box.width), bottom=Math.min(height,box.top+box.height)
      if(right<=x || bottom<=y) return ''
      return `<span class="whole-highlight actual" style="left:${x/width*100}%;top:${y/height*100}%;width:${(right-x)/width*100}%;height:${(bottom-y)/height*100}%" aria-hidden="true"><span>${number}</span></span>`
    }
    const designBox = defect?.elements?.[0]?.design?.box
    const designMarker = f.figma_same_size && designBox ? marker({left:designBox.x,top:designBox.y,width:designBox.w,height:designBox.h}) : ''
    const figure = (label, src, outline = '') => `<figure><figcaption>${esc(label)}</figcaption><div class="repair-image">${src ? `<img src="${esc(file(id,src))}" alt="${esc(label)}">${outline}` : '<p class="muted">같은 위치의 캡처 없음</p>'}</div></figure>`
    const clicks = (c.interactions || []).filter(x => x.screen === f.screen && x.size === f.size)
    const clickEvidence = clicks.map(check => {
      const previous = (c.before_interactions || []).find(x => x.screen === check.screen && x.size === check.size)
      return `<details class="repair-clicks"><summary>버튼 재검증 · ${check.clicked}개 누름 · 수정 전 문제 ${previous?.defects ?? '—'}건 → 수정 후 ${check.defects}건</summary>${(check.actions || []).map(action => {
        const old = previous?.actions?.find(x => x.path === action.path && x.label === action.label)
        return `<p>${esc(action.label || '버튼')} · ${esc(old?.landing || '이동 없음')} → ${esc(action.landing || '이동 없음')} · ${action.prototype === 'matched' ? 'Figma 목적지 일치' : action.prototype === 'mismatch' ? 'Figma 목적지 불일치' : '목적지 확인 범위 밖'}</p><div class="repair-click-pair">${figure('수정 전 버튼을 누른 결과', old?.after_shot)}${figure('수정 후 버튼을 누른 결과', action.after_shot)}</div>`
      }).join('')}</details>`
    }).join('')
    return `<section class="repair-review" aria-label="전체 화면 수정 전후 비교">
      <div class="repair-heading"><div><h2>화면이 어떻게 달라졌나요?</h2><p>${c.before_count}건 발견 · ${c.fixed.length}건 해결 · ${c.after_count === null ? c.before_count : c.after_count}건 남음 · 새로 생김·악화 ${c.regress.length}건</p></div>
      <label>화면 · 크기<select id="repair-frame">${c.frames.map((x,i)=>`<option value="${i}" ${i===index?'selected':''}>${esc(x.title || x.screen)} · ${esc(x.size)} · 스크롤 ${x.scroll_y}px</option>`).join('')}</select></label></div>
      <p class="small muted">${pipeline ? `Dify를 통한 수정·재검증 ${pipeline.state === 'succeeded' ? '완료' : pipeline.state === 'running' ? '진행 중' : '실패'}` : 'Dify 실행 기록 없음'}${!f.figma_same_size && f.figma ? ` · Figma는 ${esc(f.figma_base)} 기준이며, 선택한 크기·위치의 별도 시안은 없습니다.` : ''}</p>
      ${!c.verified ? '<p class="err" role="alert">검증을 통과한 수정 묶음이 없습니다. 적용할 수 없습니다.</p>' : ''}
      <div class="repair-triptych">${figure('Figma 기준', f.figma, designMarker)}${figure('수정 전 · '+f.size.replace('x','×'), f.before, marker(f.before_targets?.[defect?.id]))}${figure('수정 후 · '+f.size.replace('x','×'), f.after, marker(f.after_targets?.[defect?.id]))}</div>
      <p class="small muted">${esc(c.note)}${!f.paired ? ' 같은 스크롤 위치의 전후 비교는 확인되지 않았습니다.' : ''}</p>
      ${clickEvidence}
      ${pipeline?.workflow_run_id ? `<details><summary>실행 근거</summary><p class="small">Dify 실행 ${esc(pipeline.workflow_run_id)}</p></details>` : ''}
      ${c.remaining.length ? `<details><summary>남은 문제 ${c.remaining.length}건</summary><ul>${c.remaining.map(d=>`<li>${esc(d.rule)} · ${esc(d.labels.join(', '))}</li>`).join('')}</ul></details>` : ''}
    </section>`
  }
  if (typeof module !== 'undefined') module.exports = { render }
  else root.DqaRepair = { render }
})(typeof window === 'undefined' ? globalThis : window)
