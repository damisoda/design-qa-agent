(function (root) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const GROUP = { I1: '동작', I2: '동작', I3: '동작', I4: '동작', A1: '접근성', A2: '접근성', M1: '내용', M2: '내용', T1: '내용', R1: '배치', R2: '배치', R3: '배치', R4: '배치', R6: '배치', R7: '배치', F1: '배치', L1: '배치', L2: '배치' }
  const TITLES = { I1: '눌러도 반응이 없습니다', I2: '누르면 오류가 발생합니다', I3: '이동한 화면이 비어 있습니다', I4: '시안과 다른 곳으로 이동합니다', R1: '요소가 화면이나 부모 영역을 넘습니다', R2: '내용이 잘려 보입니다', R3: '요소끼리 겹쳐 있습니다', R4: '다른 요소에 가려져 있습니다', R6: '글자가 의도치 않게 꺾입니다', R7: '화면 틀을 벗어났습니다', A1: '누를 수 있는 영역이 작습니다', A2: '글자가 배경과 구별되기 어렵습니다', D2: '시안과 색이 다릅니다', D3: '시안과 글자 스타일이 다릅니다', D4: '그림 표시를 확인해야 합니다', D5: '시안과 모서리·테두리가 다릅니다', F1: '시안과 크기 방식이 다릅니다', L1: '시안과 정렬이 다릅니다', L2: '시안과 간격이 다릅니다', T1: '시안과 문구가 다릅니다', M1: '시안의 글자가 없습니다', M2: '시안의 그림이 없습니다', G1: '기호 아이콘이 기기에서 깨질 수 있습니다' }
  const PROPS = { 'background-color': '배경색', color: '글자색', width: '너비', height: '높이', 'font-size': '글자 크기', 'font-weight': '글자 굵기', 'font-family': '글꼴', 'line-height': '줄 높이', 'border-radius': '모서리', gap: '간격' }
  const active = status => ['new', 'worsened', 'none'].includes(status)
  const group = d => GROUP[d.rule] || '모양'
  const title = d => TITLES[d.rule] || d.rule_name || '확인할 차이가 있습니다'
  const status = d => d.diff && d.diff.status || 'none'
  function compare (a, b, statusOf = status) {
    const bucket = d => active(statusOf(d)) ? 0 : statusOf(d) === 'accepted' ? 2 : 1
    const severity = d => ({ 높음: 0, 중간: 1, '사람 확인 필요': 2, 낮음: 3 }[d.severity] ?? 2)
    const kind = d => ({ 동작: 0, 접근성: 1, 내용: 2, 배치: 3, 모양: 4 }[group(d)] ?? 5)
    // px, 색 차이, 대비 수치를 서로 비교하지 않는다. 도구의 심각도와 검사 종류만 사용한다.
    return bucket(a) - bucket(b) || severity(a) - severity(b) || kind(a) - kind(b) || (statusOf(a) === 'worsened' ? -1 : 0) - (statusOf(b) === 'worsened' ? -1 : 0) || String(a.id).localeCompare(String(b.id))
  }
  function summarize (ds, statusOf = status) {
    const open = ds.filter(d => active(statusOf(d))).sort((a, b) => compare(a, b, statusOf))
    return { open, urgent: open.filter(d => d.severity === '높음').length, groups: [...new Set(open.map(group))].map(name => ({ name, count: open.filter(d => group(d) === name).length })), accepted: ds.filter(d => statusOf(d) === 'accepted').length, existing: ds.filter(d => !active(statusOf(d)) && statusOf(d) !== 'accepted').length }
  }
  function fact (d, size) {
    const widths = d.widths || []; const w = size ? widths.find(v => `${v.w}x${v.h}` === size) : widths[0]
    if (size && !w) return '이 크기에서는 이 항목을 측정하지 않았습니다'
    const value = d.design && d.design.values && d.design.values.find(v => v.at !== 'alt')
    if (value) return `${PROPS[value.prop] || value.prop || '값'}: ${value.design === 'FILL' ? '부모 너비 채움' : value.design} → ${value.impl}`
    return w && w.text || (d.evidence || [])[0]?.text || '측정 근거를 확인하세요'
  }
  function priority (d) {
    return { label: d.severity === '높음' ? '먼저 확인' : d.severity === '낮음' ? '낮음' : d.severity === '중간' ? '다음 확인' : '사람 확인', tone: d.severity === '높음' ? 'urgent' : 'normal', reason: `도구 심각도 ${d.severity || '확인 필요'} · ${group(d)} 검사` }
  }
  function overview (ds, options = {}, statusOf = status) {
    const s = summarize(ds, statusOf)
    const headline = options.incomplete ? '아직 확인하지 못한 범위가 있습니다' : s.urgent ? `먼저 확인할 문제 ${s.urgent}건` : s.open.length ? `확인할 차이 ${s.open.length}건` : options.running ? '문제가 있는 위치를 찾고 있습니다' : '검사한 범위에서 발견한 문제 없음'
    return `<section class="triage-overview ${s.urgent ? 'has-urgent' : ''}" aria-label="문제 우선순위"><div><h1>${esc(headline)}</h1><p>${options.running ? '완료한 측정부터 보여 드립니다. 최종 결과는 달라질 수 있습니다.' : options.incomplete ? '완료된 범위의 결과입니다. 미측정을 정상으로 판정하지 않습니다.' : s.open.length ? `전체 ${s.open.length}건을 심각도와 검사 종류에 따라 정렬했습니다.` : '실기기·미측정 상태까지 정상임을 뜻하지는 않습니다.'}</p></div><div class="issue-categories">${s.groups.map(g => `<span><b>${g.count}</b>${esc(g.name)}</span>`).join('')}</div></section>`
  }
  function outcomes (d, size) {
    if (!(d.widths || []).some(w => `${w.w}x${w.h}` === size)) return []
    if (d.kind === 'interact') {
      const actions = d.interact?.expected?.actions || []
      const targets = actions.map(a => a.dest_name || a.url).filter(Boolean)
      return [{ label: '시안에서 기대한 반응', value: targets.length ? targets.join(', ') + '로 이동' : '이 항목에 연결된 시안 동작 정보 없음' }, { label: '실제로 관찰한 반응', value: (d.evidence || []).find(e => e.metric === d.rule)?.text || fact(d, size) }]
    }
    const v = d.design?.values?.find(v => v.at !== 'alt')
    if (v) {
      const expected = v.design === 'FILL' ? `부모 너비 채움${Number.isFinite(d.design.node?.box?.w) ? ` (${d.design.node.box.w}px)` : ''}` : String(v.design)
      return [{ label: `시안 ${PROPS[v.prop] || v.prop}`, value: expected }, { label: `구현 ${PROPS[v.prop] || v.prop}`, value: String(v.impl) }]
    }
    return []
  }
  const normalBox = b => b && ({ x: b.left ?? b.x, y: b.top ?? b.y, w: b.width ?? b.w, h: b.height ?? b.h })
  function focusRect (boxes, width, height) {
    const valid = boxes.map(normalBox).filter(b => b && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0 && b.x < width && b.y < height && b.x + b.w > 0 && b.y + b.h > 0)
    if (!valid.length || !(width > 0 && height > 0)) return null
    const left = Math.max(0, Math.min(...valid.map(b => b.x)) - 24); const right = Math.min(width, Math.max(...valid.map(b => b.x + b.w)) + 24)
    const cy = (Math.min(...valid.map(b => b.y)) + Math.max(...valid.map(b => b.y + b.h))) / 2
    const h = Math.min(height, Math.max(160, Math.max(...valid.map(b => b.y + b.h)) - Math.min(...valid.map(b => b.y)) + 72))
    const y = Math.max(0, Math.min(height - h, cy - h / 2))
    return { x: left, y, w: right - left, h }
  }
  function spotlight (src, box, rect, width, height, label, variant, number = 1) {
    const b = normalBox(box); if (!src || !rect) return ''
    const x = b && Math.max(rect.x, b.x); const y = b && Math.max(rect.y, b.y)
    const right = b && Math.min(rect.x + rect.w, b.x + b.w); const bottom = b && Math.min(rect.y + rect.h, b.y + b.h)
    const outline = b && right > x && bottom > y ? `<span class="spot-outline ${variant || ''}" style="left:${(x - rect.x) / rect.w * 100}%;top:${(y - rect.y) / rect.h * 100}%;width:${(right - x) / rect.w * 100}%;height:${(bottom - y) / rect.h * 100}%"><span class="annotation-index">${esc(number)}</span></span>` : ''
    return `<figure class="spot-figure"><figcaption>${esc(label)}</figcaption><div class="spot-crop" style="aspect-ratio:${rect.w}/${rect.h}"><img src="${esc(src)}" alt="${esc(label)}의 실제 캡처 부분" style="width:${width / rect.w * 100}%;height:${height / rect.h * 100}%;left:${-rect.x / rect.w * 100}%;top:${-rect.y / rect.h * 100}%">${outline}</div></figure>`
  }
  function recordFor (d, rows, size) {
    const paths = (d.elements || []).map(e => e.path)
    return rows.filter(r => r.side === 'head' && r.screen === d.screen && r.size === size && r.phase === 'design' && r.test === 'design-final' && (d.design && d.design.node ? r.figma?.id === d.design.node.id : paths.includes(r.element?.path))).at(-1) || null
  }
  function inspectionFor (d, rows) {
    const phase = d.kind === 'design' ? 'design' : d.kind === 'interact' ? 'interact' : 'measure'
    const first = (d.widths || [])[0]; const size = first && `${first.w}x${first.h}`
    const all = rows.filter(r => r.side === 'head' && r.screen === d.screen && (d.design && d.design.node ? r.figma && r.figma.id === d.design.node.id : (d.elements || []).some(e => e.path === r.element?.path)))
    const phased = all.filter(r => r.phase === phase)
    const tested = phased.filter(r => phase === 'measure' ? r.test.split('-')[0] === d.rule : phase === 'design' ? r.test === 'design-final' : r.test === 'click')
    const sameSize = tested.filter(r => r.size === size)
    return (sameSize.length ? sameSize : tested.length ? tested : phased.length ? phased : all).sort((a, b) => (a.scroll_step || 0) - (b.scroll_step || 0) || b.seq - a.seq)[0] || null
  }
  const value = { compare, summarize, title, group, fact, priority, overview, focusRect, spotlight, recordFor, active, outcomes, inspectionFor }
  if (typeof module !== 'undefined') module.exports = value; else root.DqaTriage = value
})(typeof window !== 'undefined' ? window : null)
