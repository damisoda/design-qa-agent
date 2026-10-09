// 브라우저 안에서 실행되는 함수들(page.evaluate로 넘긴다). 바깥 변수를 쓰지 않는다.
// dqaScan은 tools/lib/app_layout.js의 R1·R2·R3·R6 규칙을 그대로 옮기고, 요소 정보와 R4·R7을 더했다.

function dqaScan (opt) {
  opt = opt || {}
  const VW = innerWidth; const VH = innerHeight
  const root = (opt.root && document.querySelector(opt.root)) || document.body
  const rb = root.getBoundingClientRect()
  const scale = root.offsetWidth ? Math.round((rb.width / root.offsetWidth) * 1000) / 1000 : 1
  const R = Math.round
  const box = (b) => ({ left: R(b.left), right: R(b.right), top: R(b.top), bottom: R(b.bottom), width: R(b.width), height: R(b.height) })
  const css = (el) => getComputedStyle(el)
  const ignored = (el) => (opt.ignore || []).some((s) => { try { return !!el.closest(s) } catch (e) { return false } })
  const visible = (el) => {
    const b = el.getBoundingClientRect(); const s = css(el)
    return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01 && b.bottom > 0 && b.top < VH
  }
  // 앞에 덮인 화면(내비게이션 스택)을 빼기 위해, 요소 중심점에서 실제로 맨 위에 있는 요소인지 본다
  const related = (a, b) => a === b || a.contains(b) || b.contains(a)
  // 다섯 점(가운데·네 귀퉁이 안쪽) 중 하나라도 이 요소가 맨 위에 보이면 대상으로 본다.
  // 가운데만 보면 다른 글자에 덮인 글자(겹침 결함)를 놓친다. 뒤에 깔린 스택 화면은 모든 점이 덮여 빠진다.
  const onTop = (el) => {
    const b = el.getBoundingClientRect()
    return [[0.5, 0.5], [0.2, 0.25], [0.8, 0.25], [0.2, 0.75], [0.8, 0.75]].some(([fx, fy]) => {
      const x = Math.min(Math.max(b.left + b.width * fx, 0), VW - 1); const y = Math.min(Math.max(b.top + b.height * fy, 0), VH - 1)
      const hit = document.elementFromPoint(x, y)
      return !!hit && related(hit, el)
    })
  }
  const label = (el) => (el.getAttribute('aria-label') || el.placeholder || el.getAttribute('alt') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
  const isField = (el) => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
  // React fiber에서 소유 컴포넌트 이름 사슬을 읽는다(압축 빌드면 짧은 이름이라 버린다)
  const BUILTIN = /^(View|Text|TextInput|Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|ScrollView|Image|Animated.*|SafeAreaView|KeyboardAvoidingView|FlatList|VirtualizedList|CellRenderer|Screen.*|Navigation.*|Route|Fragment|Suspense|Provider|Consumer|Context.*|ForwardRef|Memo|Svg|G|Path|Rect|Circle|Defs|ClipPath|Mask|LinearGradient|Stop)$|(Context|Provider|Consumer|Boundary|Container|Navigator)$/
  const comps = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
    if (!key) return []
    const out = []
    let f = el[key]; let guard = 0
    while (f && guard++ < 60 && out.length < 4) {
      const t = f.type
      const name = t && (typeof t === 'function' ? (t.displayName || t.name) : (t.displayName || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name))))
      if (name && typeof name === 'string' && name.length > 3 && !BUILTIN.test(name) && !out.includes(name)) out.push(name)
      f = f.return
    }
    return out
  }
  const domPath = (el) => {
    const parts = []
    for (let e = el; e && e !== document.body && parts.length < 6; e = e.parentElement) {
      const p = e.parentElement; const same = p ? [...p.children].filter((c) => c.tagName === e.tagName) : []
      parts.unshift(e.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : ''))
    }
    return parts.join('>')
  }
  const selector = (el) => {
    const a = el.getAttribute('aria-label')
    if (a) return `${el.tagName.toLowerCase()}[aria-label="${a.replace(/"/g, '\\"')}"]`
    if (el.id) return `#${el.id}`
    return domPath(el)
  }
  const STYLE_KEYS = ['width', 'minWidth', 'maxWidth', 'flexGrow', 'flexShrink', 'flexBasis', 'whiteSpace', 'overflow', 'textOverflow', 'fontSize', 'lineHeight', 'fontFamily', 'position', 'color', 'backgroundColor']
  const info = (el) => {
    const s = css(el); const style = {}
    for (const k of STYLE_KEYS) style[k] = s[k]
    const lab = label(el)
    const kind = isField(el) ? 'field' : (el.tagName === 'IMG' || el.tagName === 'svg' ? 'media' : 'text')
    return { fp: `${kind}|${lab || selector(el)}`, tag: el.tagName.toLowerCase(), label: lab, aria: el.getAttribute('aria-label'), role: el.getAttribute('role'), selector: selector(el), path: domPath(el), components: comps(el), box: box(el.getBoundingClientRect()), style }
  }

  const LEAF_SEL = 'input, textarea, select, [role=button], div, span, p, h1, h2, h3, h4, h5, h6, a, button, label, li, td, th, img, svg'
  const leaves = [...document.querySelectorAll(LEAF_SEL)].filter((el) => {
    if (ignored(el)) return false
    if (el.closest('svg') && el.tagName !== 'svg') return false
    const leaf = isField(el) || el.tagName === 'IMG' || el.tagName === 'svg' || (el.children.length === 0 && el.textContent.trim())
    return leaf && visible(el) && onTop(el)
  })
  // 진단 사실(코드가 계산 스타일로 확인하는 원인 패턴). 모델은 이 사실과 지식 문서로만 원인을 말한다.
  const flexMinAuto = (el, stopAt) => {
    const items = []
    for (let a = el; a && a !== stopAt && a !== document.body && items.length < 4; a = a.parentElement) {
      const p = a.parentElement; if (!p) break
      const ps = css(p); const s = css(a)
      if (/flex/.test(ps.display) && /row/.test(ps.flexDirection) && s.minWidth === 'auto') items.push({ tag: a.tagName.toLowerCase(), label: label(a).slice(0, 20), minWidth: s.minWidth, flex: `${s.flexGrow} ${s.flexShrink} ${s.flexBasis}`, width: R(a.getBoundingClientRect().width / scale) })
    }
    return items.length ? { code: 'flex_min_auto', text: `가로 flex 줄 안의 항목 ${items.length}개가 min-width: auto(기본값)라 내용·입력칸 고유 폭보다 작게 줄지 못한다: ${items.map((x) => `${x.tag}${x.label ? `"${x.label}"` : ''}(flex ${x.flex}, 폭 ${x.width}px)`).join(', ')}`, items } : null
  }
  const textNaturalWidth = (el) => {
    const s = css(el); const span = document.createElement('span')
    Object.assign(span.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', font: s.font, fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, letterSpacing: s.letterSpacing })
    span.textContent = el.textContent.trim(); document.body.appendChild(span)
    const w = span.getBoundingClientRect().width; span.remove(); return w
  }
  const narrowBox = (el) => {
    const boxW = el.getBoundingClientRect().width / scale; const textW = textNaturalWidth(el)
    if (!(textW > boxW + 0.5)) return null
    let text = `글자를 한 줄로 쓰면 폭 ${R(textW)}px인데 상자 폭이 ${R(boxW)}px라 줄이 바뀐다`
    // 같은 가로 flex 줄의 항목 폭 합이 줄 폭보다 크면, 줄어들 수 있는 이 항목이 눌린 것이다
    for (let a = el, n = 0; a && a.parentElement && n < 3; a = a.parentElement, n++) {
      const row = a.parentElement; const rs = css(row)
      if (!(/flex/.test(rs.display) && /row/.test(rs.flexDirection))) continue
      const sum = [...row.children].reduce((s, c) => s + c.getBoundingClientRect().width, 0) / scale
      const rw = row.getBoundingClientRect().width / scale
      if (sum > rw + 1) { text += `. 같은 가로 줄 항목들의 폭 합(${R(sum)}px)이 줄 폭(${R(rw)}px)보다 커서, 줄어들 수 있는(flex-shrink ${css(a).flexShrink}) 이 항목이 눌렸다`; return { code: 'narrow_box_squeezed', text, box_w: R(boxW), text_w: R(textW) } }
      break
    }
    return { code: 'narrow_box', text, box_w: R(boxW), text_w: R(textW) }
  }
  const fakeIndicator = (bar) => {
    const b = bar.getBoundingClientRect()
    return b.height >= 3 && b.height <= 6 && b.width >= 100 && b.width <= 160 && VH - b.bottom <= 30 && Math.abs((b.left + b.right) / 2 - VW / 2) <= 20
      ? { code: 'fake_home_indicator', text: `화면 아래 가운데의 막대(${R(b.width)}×${R(b.height)}px)는 홈 인디케이터 모양이다. 실제 기기가 그리는 요소를 앱이 그렸을 수 있다(시안 잔재)` } : null
  }

  const issues = []
  const push = (rule, el, metric, value, threshold, text, extra) => issues.push({ rule, metric, value: R(value), threshold, text, el: info(el), ...(extra || {}) })
  const hScroller = (from, to) => { for (let a = from; a && a !== to; a = a.parentElement) { if (/(auto|scroll)/.test(css(a).overflowX) && a.scrollWidth > a.clientWidth + 1) return true } return false }

  // R1 넘침: 화면 오른쪽 밖, 또는 자신을 품은 가장 가까운 "더 좁은" 조상의 오른쪽 끝을 2px 넘게 넘어감.
  // 가로 스크롤 영역 안의 요소는 의도된 넘침이라 뺀다.
  for (const el of leaves) {
    const b = el.getBoundingClientRect()
    if (hScroller(el.parentElement, document.body)) continue
    if (b.right > VW + 2) push('R1', el, 'viewport_overflow_px', b.right - VW, 2, `화면 오른쪽(${VW}) 밖으로 ${R(b.right - VW)}px`, { diag: flexMinAuto(el, root) })
    let a = el.parentElement
    while (a && a !== document.body) {
      const ab = a.getBoundingClientRect()
      if (ab.width > 0 && ab.width < b.width + 400 && b.right > ab.right + 2 && b.left >= ab.left - 2) {
        push('R1', el, 'overflow_px', b.right - ab.right, 2, `부모 오른쪽 끝(${R(ab.right)})보다 ${R(b.right - ab.right)}px 넘침`, { container: box(ab), diag: flexMinAuto(el, a) })
        break
      }
      a = a.parentElement
    }
  }
  // R2 잘림: 글자 내용이 상자보다 커서 숨겨짐(말줄임표는 의도일 수 있어 따로 표시)
  for (const el of leaves) {
    if (isField(el) || el.tagName === 'IMG' || el.tagName === 'svg') continue
    const s = css(el)
    const overW = el.scrollWidth - el.clientWidth; const overH = el.scrollHeight - el.clientHeight
    if ((overW > 1 || overH > 1) && (s.overflow === 'hidden' || s.overflowX === 'hidden' || s.overflowY === 'hidden' || s.textOverflow === 'ellipsis')) {
      const clamp = s.webkitLineClamp && s.webkitLineClamp !== 'none' && s.webkitLineClamp !== '0'
      push('R2', el, 'clipped_px', Math.max(overW, overH), 1, `내용 ${el.scrollWidth}×${el.scrollHeight} > 상자 ${el.clientWidth}×${el.clientHeight}${clamp ? `(줄 수 제한 ${s.webkitLineClamp})` : ''}`, { intent: s.textOverflow === 'ellipsis' || clamp ? 'ellipsis' : null })
    }
  }
  // R3 겹침: 글자끼리, 또는 글자와 얇은 막대(높이 6px 이하) 겹침
  const texts = leaves.filter((el) => !isField(el) && el.tagName !== 'IMG' && el.tagName !== 'svg').map((el) => ({ el, b: el.getBoundingClientRect() }))
  const bars = [...document.querySelectorAll('div')].filter((e) => { const b = e.getBoundingClientRect(); return visible(e) && !ignored(e) && b.height > 0 && b.height <= 6 && b.width >= 40 && css(e).backgroundColor !== 'rgba(0, 0, 0, 0)' })
  const ov = (p, q) => ({ x: Math.min(p.right, q.right) - Math.max(p.left, q.left), y: Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) })
  const inter = (p, q) => { const o = ov(p, q); return o.x > 1 && o.y > 1 }
  for (const bar of bars) {
    const bb = bar.getBoundingClientRect()
    for (const t of texts) {
      if (inter(t.b, bb) && !t.el.contains(bar) && !bar.contains(t.el)) push('R3', t.el, 'overlap_px', ov(t.b, bb).y, 1, `글자(${R(t.b.top)}~${R(t.b.bottom)})가 막대(${R(bb.top)}~${R(bb.bottom)})와 ${R(ov(t.b, bb).y)}px 겹침`, { other: { kind: 'bar', box: box(bb), selector: selector(bar) }, diag: fakeIndicator(bar) })
    }
  }
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const A = texts[i]; const B = texts[j]
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue
      if (inter(A.b, B.b)) { const o = ov(A.b, B.b); push('R3', A.el, 'overlap_px', Math.min(o.x, o.y), 1, `"${label(A.el)}"와 "${label(B.el)}" 글자 상자가 ${R(o.x)}×${R(o.y)}px 겹침`, { other: { kind: 'text', box: box(B.b), info: info(B.el) } }) }
    }
  }
  // R6 원치 않는 줄바꿈: 짧은 라벨(4자 이하)이 실제로 두 줄 이상에 걸쳐 그려짐.
  // 상자 높이는 안쪽 여백이 섞이므로 쓰지 않고, 글자가 차지한 줄 사각형(Range)의 서로 다른 줄 수를 센다.
  const textLines = (el) => {
    const r = document.createRange(); r.selectNodeContents(el)
    const tops = []
    for (const q of r.getClientRects()) { if (q.width < 0.5 || q.height < 0.5) continue; if (!tops.some((y) => Math.abs(y - q.top) < Math.max(2, q.height * 0.4))) tops.push(q.top) }
    return Math.max(1, tops.length)
  }
  for (const t of texts) {
    const s = t.el.textContent.trim()
    if (!(s.length > 0 && s.length <= 4)) continue
    const n = textLines(t.el)
    if (n >= 2) push('R6', t.el, 'lines', n, 2, `${s.length}글자 라벨이 ${n}줄로 그려짐(높이 ${R(t.b.height / scale)}px, 시안 기준)`, { diag: narrowBox(t.el) })
  }
  // R4 가려짐: 스크롤을 끝까지 내린 상태에서도, 누르거나 읽을 요소가 화면보다 작은 고정·절대 위치 요소에 가려짐.
  // 얇은 막대(높이 6px 이하)와의 겹침은 R3에서 본다. 화면 전체를 덮는 요소(뒤에 깔린 스택 화면)는 가려짐으로 보지 않는다.
  if (opt.final || opt.first) {
    const cands = [...document.querySelectorAll('input, textarea, [role=button], button, a, div, span')]
      .filter((el) => !ignored(el) && visible(el) && (isField(el) || el.getAttribute('role') === 'button' || el.tagName === 'BUTTON' || (el.children.length === 0 && el.textContent.trim())))
    const positioned = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { const p = css(a).position; if (p === 'fixed' || p === 'sticky' || p === 'absolute') return a } return null }
    const seen = new Set()
    for (const el of cands) {
      const b = el.getBoundingClientRect()
      const pts = [[0.5, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]].map(([fx, fy]) => [b.left + b.width * fx, b.top + b.height * fy]).filter(([x, y]) => x >= 0 && y >= 0 && x < VW && y < VH)
      if (pts.length < 3) continue
      let covered = 0; let cover = null
      for (const [x, y] of pts) {
        const hit = document.elementFromPoint(x, y)
        if (!hit || related(hit, el)) continue
        const p = positioned(hit); if (!p || related(p, el)) continue
        const pb = p.getBoundingClientRect()
        if (pb.width * pb.height > VW * VH * 0.4 || pb.height <= 6) continue
        // 화면 아래에 붙은 요소는 스크롤 끝에서, 위에 붙은 요소는 스크롤 맨 위에서만 본다(그 밖은 스크롤하면 드러난다)
        // 떠 있는 하단 탭바(바닥에서 조금 띄운 것)도 포함하려고 바닥·천장에서 40px 이내를 붙은 것으로 본다
        const bottomBar = pb.bottom >= VH - 40 && pb.top > VH * 0.5; const topBar = pb.top <= 40 && pb.bottom < VH * 0.5
        if (!((opt.final && bottomBar) || (opt.first && topBar))) continue
        covered++; cover = p
      }
      if (covered >= 2 && cover) {
        const key = label(el) + '|' + selector(cover); if (seen.has(key)) continue; seen.add(key)
        const cb = cover.getBoundingClientRect(); const o = ov(b, cb)
        push('R4', el, 'occluded_px', Math.max(0, o.y), 1, `${R(o.y)}px가 고정 요소(${R(cb.top)}~${R(cb.bottom)})에 가려짐`, { other: { kind: 'occluder', box: box(cb), selector: selector(cover), label: label(cover).slice(0, 30) }, diag: cb.bottom >= VH - 40 ? { code: 'bottom_fixed_occlusion', text: `화면 아래에 붙은 고정 요소(${R(cb.height)}px 높이)가 내용을 덮는다. 스크롤 끝에서도 가려지면 내용 아래 여백이 고정 요소 높이보다 작다` } : null })
      }
    }
  }
  // R7 화면 틀 이탈: 앱 틀(root)이 화면보다 좁을 때, 모달·시트가 틀 밖으로 벗어남
  if (rb.width < VW - 4) {
    const mods = [...document.querySelectorAll('[role=dialog], [aria-modal=true], div')].filter((el) => {
      if (ignored(el) || !visible(el)) return false
      const p = css(el).position; const b = el.getBoundingClientRect()
      return (el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true' || p === 'fixed') && b.width >= 80 && b.height >= 60
    })
    for (const el of mods) {
      const b = el.getBoundingClientRect(); const out = Math.max(rb.left - b.left, b.right - rb.right)
      if (out > 2 && onTop(el)) push('R7', el, 'frame_escape_px', out, 2, `앱 틀(${R(rb.left)}~${R(rb.right)}) 밖으로 ${R(out)}px 벗어남`, { container: box(rb) })
    }
  }
  // 크기별 비교(R5)용: 짧은 글자의 줄 수
  const lines = texts.filter((t) => { const s = t.el.textContent.trim(); return s.length > 0 && s.length <= 8 }).map((t) => ({ fp: info(t.el).fp, lines: textLines(t.el) }))
  return {
    viewport: { width: VW, height: VH },
    root: box(rb),
    scale,
    page_horizontal_overflow_px: Math.max(0, document.documentElement.scrollWidth - VW),
    leaves: leaves.length,
    issues,
    lines,
    minified: (() => { const names = leaves.slice(0, 40).flatMap((el) => comps(el)); return names.length === 0 })()
  }
}

// 주 스크롤 컨테이너를 찾아 표시한다(RN-web은 문서가 아니라 ScrollView div 안에서 스크롤한다)
function dqaFindScroller (rootSel) {
  const VW = innerWidth; const VH = innerHeight
  document.querySelectorAll('[data-dqa-scroll]').forEach((e) => e.removeAttribute('data-dqa-scroll'))
  const onTop = (el) => {
    const b = el.getBoundingClientRect()
    const x = Math.min(Math.max(b.left + b.width / 2, 0), VW - 1); const y = Math.min(Math.max(b.top + b.height / 2, 0), VH - 1)
    const hit = document.elementFromPoint(x, y); return !!hit && (hit === el || el.contains(hit))
  }
  const cands = [...document.querySelectorAll((rootSel || 'body') + ' *')].filter((el) => {
    const s = getComputedStyle(el); const b = el.getBoundingClientRect()
    return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 100 && b.width > VW * 0.5 && onTop(el)
  }).sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))
  if (cands.length) {
    const el = cands[0]; el.setAttribute('data-dqa-scroll', '1')
    return { kind: 'element', scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, max: el.scrollHeight - el.clientHeight }
  }
  const se = document.scrollingElement || document.documentElement
  if (se.scrollHeight > innerHeight + 20) return { kind: 'document', scrollHeight: se.scrollHeight, clientHeight: innerHeight, max: se.scrollHeight - innerHeight }
  return { kind: 'none', max: 0 }
}

function dqaScrollTo (y) {
  const el = document.querySelector('[data-dqa-scroll]')
  if (el) { el.scrollTop = y; return el.scrollTop }
  const se = document.scrollingElement || document.documentElement
  se.scrollTop = y; return se.scrollTop
}

// 배치가 멈췄는지 보려고 보이는 요소들의 위치·크기를 하나의 수로 줄인다
function dqaLayoutSig () {
  const els = document.querySelectorAll('body *'); let h = els.length
  for (let i = 0; i < els.length && i < 1500; i++) { const b = els[i].getBoundingClientRect(); h = (h * 31 + Math.round(b.left) * 7 + Math.round(b.top) * 13 + Math.round(b.width) * 3 + Math.round(b.height)) % 1000000007 }
  return h
}

function dqaFonts () {
  if (!document.fonts) return { status: 'unsupported', loaded: [] }
  const all = [...document.fonts]
  return { status: document.fonts.status, loaded: [...new Set(all.filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')))], failed: [...new Set(all.filter((f) => f.status === 'error').map((f) => f.family.replace(/"/g, '')))] }
}

// 캡처용 윤곽선(검수 결과 표시). 측정이 끝난 뒤에만 그린다.
function dqaOutline (boxes) {
  document.querySelectorAll('[data-dqa-outline]').forEach((e) => e.remove())
  for (const b of boxes || []) {
    const d = document.createElement('div'); d.setAttribute('data-dqa-outline', '1')
    Object.assign(d.style, { position: 'fixed', left: (b.left - 2) + 'px', top: (b.top - 2) + 'px', width: (b.width + 4) + 'px', height: (b.height + 4) + 'px', border: b.dashed ? '2px dashed #111' : '2px solid #e0245e', zIndex: 2147483647, pointerEvents: 'none', boxSizing: 'border-box' })
    document.body.appendChild(d)
  }
  return (boxes || []).length
}

// 레시피 클릭 대상이 "보이고 맨 위에 있는" 요소인지(뒤에 깔린 화면을 잘못 누르지 않기 위해)
function dqaIsTop (el, presence) {
  const b = el.getBoundingClientRect()
  if (!(b.width > 0 && b.height > 0)) return false
  const hits = (x, y) => { const h = document.elementFromPoint(Math.min(Math.max(x, 0), innerWidth - 1), Math.min(Math.max(y, 0), innerHeight - 1)); return !!h && (h === el || el.contains(h) || h.contains(el)) }
  if (!presence) return hits(b.left + b.width / 2, b.top + b.height / 2)
  // 존재 확인용: 화면 밖(스크롤해야 보이는 곳)이면 있는 것으로 보고, 화면 안이면 다섯 점 중 하나라도 보이면 된다
  // (탭바 같은 고정 요소가 일부를 덮어도 있는 것이다. 뒤에 깔린 스택 화면은 모든 점이 덮여 있어 빠진다)
  if (b.top >= innerHeight || b.bottom <= 0 || b.left >= innerWidth || b.right <= 0) return true
  // 스크롤 영역의 보이는 범위 밖(스크롤하면 보이는 곳)에 가운데가 있으면 있는 것으로 본다
  const cy = b.top + b.height / 2
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a)
    if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight + 1) {
      // 앱이 캔버스를 transform으로 키우거나 줄일 수 있어, 보이는 높이는 화면 좌표(배율 적용)로 바꿔 비교한다
      const ab = a.getBoundingClientRect(); const k = a.offsetHeight ? ab.height / a.offsetHeight : 1
      if (cy >= ab.top + a.clientHeight * k || cy <= ab.top) return true
      break
    }
  }
  const smallOverlay = (x, y) => {
    const h = document.elementFromPoint(Math.min(Math.max(x, 0), innerWidth - 1), Math.min(Math.max(y, 0), innerHeight - 1))
    for (let a = h; a && a !== document.body; a = a.parentElement) {
      const p = getComputedStyle(a).position
      if (p === 'fixed' || p === 'sticky' || p === 'absolute') { const ab = a.getBoundingClientRect(); return ab.width * ab.height < innerWidth * innerHeight * 0.4 }
    }
    return false
  }
  const pts = [[0.5, 0.5], [0.2, 0.25], [0.8, 0.25], [0.2, 0.75], [0.8, 0.75]].map(([fx, fy]) => [b.left + b.width * fx, b.top + b.height * fy])
  return pts.some(([x, y]) => hits(x, y)) || pts.every(([x, y]) => smallOverlay(x, y))
}

module.exports = { dqaScan, dqaFindScroller, dqaScrollTo, dqaLayoutSig, dqaFonts, dqaOutline, dqaIsTop }
