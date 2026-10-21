// 브라우저 안에서 실행되는 함수들(page.evaluate로 넘긴다). 바깥 변수를 쓰지 않는다.
// dqaScan은 tools/lib/app_layout.js의 R1·R2·R3·R6 규칙을 그대로 옮기고, 요소 정보와 R4·R7을 더했다.

async function dqaScan (opt) {
  opt = opt || {}
  const VW = innerWidth; const VH = innerHeight
  // 기기 폭: 모바일에서 내용이 화면보다 넓으면 브라우저가 레이아웃 폭(innerWidth)을 늘리고 축소해 보여 준다. 그때는 screen.width가 실제 화면 폭이다
  const DW = screen.width && screen.width < VW - 1 ? screen.width : VW
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
    return { fp: `${kind}|${lab || selector(el)}`, tag: el.tagName.toLowerCase(), cls: [...el.classList].slice(0, 6), pcls: el.parentElement ? [...el.parentElement.classList].slice(0, 4) : [], label: lab, aria: el.getAttribute('aria-label'), role: el.getAttribute('role'), selector: selector(el), path: domPath(el), components: comps(el), box: box(el.getBoundingClientRect()), style }
  }

  // 검사 대상: 글자를 직접 품은 모든 요소(태그를 가리지 않는다), 입력칸, 그림.
  // 태그 목록으로 고르면 <footer>·<time>처럼 빠진 태그의 글자를 못 보고, 아이콘과 글자가 섞인 버튼의 글자도 못 본다
  const NONTEXT = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TITLE|HEAD|META|LINK|OPTION|OPTGROUP|DATALIST|IFRAME|OBJECT|CANVAS|VIDEO|AUDIO|PICTURE|SOURCE|TRACK|MAP|AREA)$/
  const ownNodes = (el) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())
  const ownText = (el) => (el.children.length ? ownNodes(el).map((n) => n.textContent).join(' ') : el.textContent).trim().replace(/\s+/g, ' ')
  const leaves = [...document.body.querySelectorAll('*')].filter((el) => {
    if (NONTEXT.test(el.tagName) || ignored(el)) return false
    if (el.closest('svg') && el.tagName !== 'svg') return false
    const leaf = isField(el) || el.tagName === 'IMG' || el.tagName === 'svg' || ownNodes(el).length > 0
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
  // 일부러 만든 가로 스크롤(한 줄 카드 목록, 스냅, 표 감싸개)만 넘침 검사에서 뺀다.
  // 세로 스크롤 영역은 CSS 규칙상 가로도 auto로 계산되므로, 그것만으로는 의도된 가로 스크롤이 아니다
  const intentionalH = (a) => {
    const s = css(a)
    if (!/(auto|scroll)/.test(s.overflowX) || a.scrollWidth <= a.clientWidth + 1) return false
    if (/(hidden|clip)/.test(s.overflowY) || (s.scrollSnapType && s.scrollSnapType !== 'none')) return true
    const row = (e) => { if (!e) return false; const c = css(e); return /flex/.test(c.display) && /row/.test(c.flexDirection) && c.flexWrap === 'nowrap' && e.children.length >= 2 }
    if (row(a) || (a.children.length === 1 && row(a.children[0]))) return true
    return !!a.querySelector(':scope > table, :scope > * > table')
  }
  const hScroller = (from, to) => { for (let a = from; a && a !== to; a = a.parentElement) { if (intentionalH(a)) return true } return false }
  // 스크롤·잘라내기 조상과 화면에 잘려 실제로 보이는 부분(겹침 계산용)
  // 자기 자신이 넘침을 숨기면(max-height + overflow:hidden) 숨긴 줄도 안 보이므로 자기부터 본다
  const clipOf = (el, r) => {
    let l = Math.max(r.left, 0); let t = Math.max(r.top, 0); let rt = Math.min(r.right, VW); let bt = Math.min(r.bottom, VH)
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const s = css(a); if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
      const ab = a.getBoundingClientRect()
      if (s.overflowX !== 'visible') { l = Math.max(l, ab.left); rt = Math.min(rt, ab.right) }
      if (s.overflowY !== 'visible') { t = Math.max(t, ab.top); bt = Math.min(bt, ab.bottom) }
    }
    return { left: l, top: t, right: rt, bottom: bt, width: Math.max(0, rt - l), height: Math.max(0, bt - t) }
  }
  // 글자가 실제로 차지한 영역(Range). 상자가 넓어도 글자만 본다
  // 자식 요소가 섞인 요소(아이콘+글자 버튼, "총 <b>3</b>건")는 자기 글자 노드만 잰다
  // 줄 높이를 글자 크기보다 작게 준 큰 글자(88px 숫자 등)는 Range 사각형이 줄 상자보다 위아래로 크다. 획은 줄 상자 안이므로 줄 높이로 줄인다
  // 단, 글자 크기(em 상자)보다 작게는 줄이지 않는다. 줄 높이가 글자보다 작으면 획이 줄 상자 밖으로 나가 실제로 겹친다
  const clampLine = (el, q) => { const s = css(el); const lh = Math.max(parseFloat(s.lineHeight), parseFloat(s.fontSize)); if (!(lh > 0) || q.height <= lh + 1) return q; const c = (q.top + q.bottom) / 2; return { left: q.left, right: q.right, width: q.width, top: c - lh / 2, bottom: c + lh / 2, height: lh } }
  const ownRects = (el) => { const out = []; const rg = document.createRange(); for (const n of ownNodes(el)) { rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.width >= 0.5 && q.height >= 0.5) out.push(clampLine(el, q)) } return out }
  const unionRect = (qs) => { const l = Math.min(...qs.map((q) => q.left)); const t = Math.min(...qs.map((q) => q.top)); const r = Math.max(...qs.map((q) => q.right)); const b = Math.max(...qs.map((q) => q.bottom)); return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t } }
  const textRect = (el) => {
    if (el.children.length) { const qs = ownRects(el); if (qs.length) return unionRect(qs) }
    const rg = document.createRange(); rg.selectNodeContents(el); const qs = [...rg.getClientRects()].filter((q) => q.width >= 0.5 && q.height >= 0.5).map((q) => clampLine(el, q))
    return qs.length ? unionRect(qs) : el.getBoundingClientRect()
  }
  // 여러 줄로 감긴 글자는 바깥 상자 안에 빈 곳이 많다. 겹침은 줄마다의 사각형으로 잰다
  const lineRects = (el) => {
    if (el.children.length) { const qs = ownRects(el); if (qs.length) return qs }
    const rg = document.createRange(); rg.selectNodeContents(el); const qs = [...rg.getClientRects()].filter((q) => q.width >= 0.5 && q.height >= 0.5).map((q) => clampLine(el, q)); return qs.length ? qs : [textRect(el)]
  }
  const isMedia = (el) => el.tagName === 'IMG' || el.tagName === 'svg'

  async function * inspectRows (test, rows, elementOf = x => x, variant = '') {
    const items = [...rows]
    const binding = opt.trace && window[opt.trace]
    if (typeof binding !== 'function') { yield * items; return }
    const total = items.filter(x => { const e = elementOf(x); return e && visible(e) }).length
    let ordinal = 0
    for (const item of items) {
      const el = elementOf(item)
      if (!el || !visible(el)) { yield item; continue }
      const element = info(el)
      if (variant === 'placeholder') { const s = getComputedStyle(el, '::placeholder'); element.style = { ...element.style, color: s.color, fontSize: s.fontSize }; element.label = el.placeholder || element.label }
      const common = { test, ordinal: ++ordinal, total, element, variant }
      await binding({ ...common, status: 'checking' })
      let completed = false
      try { yield item; completed = true } finally {
        await binding({ ...common, status: completed ? 'checked' : 'interrupted', findings: issues.filter(x => x.rule === test.split('-')[0] && x.el.path === element.path).map(x => ({ rule: x.rule, text: x.text, metric: x.metric, value: x.value, threshold: x.threshold })).slice(0, 6) })
      }
    }
  }

  // R1 넘침: 화면 오른쪽 밖, 또는 자신을 품은 가장 가까운 "더 좁은" 조상의 오른쪽 끝을 2px 넘게 넘어감.
  // 가로 스크롤 영역 안의 요소는 의도된 넘침이라 뺀다.
  for await (const el of inspectRows('R1', leaves)) {
    const b = el.getBoundingClientRect()
    if (hScroller(el.parentElement, document.body)) continue
    if (b.right > VW + 2) push('R1', el, 'viewport_overflow_px', b.right - VW, 2, `화면 오른쪽(${VW}) 밖으로 ${R(b.right - VW)}px`, { diag: flexMinAuto(el, root) })
    let a = el.parentElement
    while (a && a !== document.body) {
      const ab = a.getBoundingClientRect()
      if (ab.width > 0 && ab.width < b.width + 400 && b.right > ab.right + 2 && b.left >= ab.left - 2) {
        // 안쪽 글자가 넘치는 진짜 원인이 바깥 상자(고정 폭 등)면, 그 상자를 함께 적어 같은 상자의 넘침을 한 묶음으로 만든다
        let wide = null
        for (let e = el.parentElement; e && e !== a; e = e.parentElement) if (e.getBoundingClientRect().right > ab.right + 2) wide = e
        const wb = wide && wide.getBoundingClientRect()
        const wcls = wide ? [...wide.classList].filter((c) => !/^(css-|r-)/.test(c)) : []
        const wn = wide ? (wide.id ? `#${wide.id}` : wcls.length ? `.${wcls[0]}` : selector(wide)) : ''
        push('R1', el, 'overflow_px', b.right - ab.right, 2, `부모 오른쪽 끝(${R(ab.right)})보다 ${R(b.right - ab.right)}px 넘침${wide ? ` — 바깥 상자 ${wn}(폭 ${R(wb.width)}px)가 부모(${R(ab.width)}px)보다 넓다` : ''}`, { container: box(ab), diag: wide ? { code: 'wide_ancestor', text: `바깥 상자 ${wn}의 폭 ${R(wb.width)}px가 부모 폭 ${R(ab.width)}px보다 넓어 안쪽 글자가 함께 넘친다(고정 폭인지 확인)` } : flexMinAuto(el, a), ...(wide ? { other: { kind: 'wide', box: box(wb), selector: selector(wide), name: wn, cls: wcls.slice(0, 4), label: label(wide).slice(0, 30) } } : {}) })
        break
      }
      a = a.parentElement
    }
    // 글자가 자기 상자 밖으로 넘침(줄바꿈되지 않는 긴 글자·링크). 상자 자체는 멀쩡해 위 검사로는 안 보인다
    if (!isField(el) && !isMedia(el) && css(el).overflowX === 'visible') {
      const tr = textRect(el)
      if (tr.right > b.right + 2) { const s = css(el); push('R1', el, 'text_overflow_px', tr.right - b.right, 2, `글자가 자기 상자 오른쪽(${R(b.right)})보다 ${R(tr.right - b.right)}px 넘침(줄바꿈되지 않음)`, { container: box(b), diag: { code: 'text_no_wrap', text: `글자가 줄바꿈되지 않아 상자 밖으로 나간다(white-space ${s.whiteSpace}, overflow-wrap ${s.overflowWrap}, word-break ${s.wordBreak})` } }) }
    }
  }
  // R1 화면 가로 넘침: 내용이 기기 폭보다 넓어 브라우저가 화면을 늘렸다(가로로 밀리거나 축소돼 보임). 가장 오른쪽까지 나간 글자 하나로 보고한다
  const pageOver = Math.max(document.documentElement.scrollWidth, VW) - DW
  if (pageOver > 2) {
    const far = leaves.filter((el) => !hScroller(el.parentElement, document.body)).map((el) => ({ el, r: el.getBoundingClientRect().right })).sort((a, b) => b.r - a.r)[0]
    if (far) push('R1', far.el, 'page_overflow_px', pageOver, 2, `화면 폭(${DW})보다 내용이 ${R(pageOver)}px 넓어 화면이 늘어남(레이아웃 폭 ${VW})`, { container: { left: 0, top: 0, right: DW, bottom: VH, width: DW, height: VH } })
  }
  // R2 잘림: 글자 내용이 상자보다 커서 숨겨짐(말줄임표는 의도일 수 있어 따로 표시)
  for await (const el of inspectRows('R2', leaves)) {
    if (isField(el) || el.tagName === 'IMG' || el.tagName === 'svg') continue
    const s = css(el)
    const overW = el.scrollWidth - el.clientWidth; const overH = el.scrollHeight - el.clientHeight
    if ((overW > 1 || overH > 1) && (s.overflow === 'hidden' || s.overflowX === 'hidden' || s.overflowY === 'hidden' || s.textOverflow === 'ellipsis')) {
      const clamp = s.webkitLineClamp && s.webkitLineClamp !== 'none' && s.webkitLineClamp !== '0'
      push('R2', el, 'clipped_px', Math.max(overW, overH), 1, `내용 ${el.scrollWidth}×${el.scrollHeight} > 상자 ${el.clientWidth}×${el.clientHeight}${clamp ? `(줄 수 제한 ${s.webkitLineClamp})` : ''}`, { intent: s.textOverflow === 'ellipsis' || clamp ? 'ellipsis' : null })
    }
  }
  // R2 부모가 잘라냄: 글자는 제 상자에 맞지만, 작은 부모(버튼·탭·칩·카드)가 overflow:hidden으로 잘라 일부가 안 보임
  for await (const el of inspectRows('R2-parent', leaves)) {
    if (isField(el) || isMedia(el)) continue
    const tr = textRect(el)
    for (let a = el.parentElement, n = 0; a && a !== document.body && n < 4; a = a.parentElement, n++) {
      const s = css(a); const hy = /(hidden|clip)/.test(s.overflowY); const hx = /(hidden|clip)/.test(s.overflowX)
      if (!hy && !hx) continue
      const ab = a.getBoundingClientRect(); if (ab.width * ab.height > VW * VH * 0.25) break
      const cut = Math.max(hy ? Math.max(tr.bottom - ab.bottom, ab.top - tr.top) : 0, hx ? Math.max(tr.right - ab.right, ab.left - tr.left) : 0)
      if (cut > 1 && s.textOverflow !== 'ellipsis') push('R2', el, 'clipped_by_parent_px', cut, 1, `글자가 잘라내는 부모 상자(${R(ab.width)}×${R(ab.height)}px)보다 ${R(cut)}px 커서 일부가 안 보임`, { container: box(ab) })
      break
    }
  }
  // R3 겹침: 글자끼리, 또는 글자와 얇은 막대(높이 6px 이하) 겹침
  const texts = leaves.filter((el) => !isField(el) && !isMedia(el)).map((el) => ({ el, b: el.getBoundingClientRect(), t: clipOf(el, textRect(el)), rs: lineRects(el).map((q) => clipOf(el, q)) }))
  const bars = [...document.querySelectorAll('div')].filter((e) => { const b = e.getBoundingClientRect(); return visible(e) && !ignored(e) && b.height > 0 && b.height <= 6 && b.width >= 40 && css(e).backgroundColor !== 'rgba(0, 0, 0, 0)' })
  const ov = (p, q) => ({ x: Math.min(p.right, q.right) - Math.max(p.left, q.left), y: Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) })
  const inter = (p, q) => { const o = ov(p, q); return o.x > 1 && o.y > 1 }
  const area = (b) => b.width * b.height
  // 줄 사각형 목록끼리(또는 한 사각형과) 가장 크게 겹친 곳. 없으면 null
  const ovLines = (As, Bs) => { let best = null; for (const a of As) for (const b of Bs) { const o = ov(a, b); if (o.x > 1 && o.y > 1 && (!best || Math.min(o.x, o.y) > Math.min(best.x, best.y))) best = { ...o, a, b } } return best }
  for await (const bar of inspectRows('R3-bar', bars)) {
    const bb = clipOf(bar, bar.getBoundingClientRect()); if (bb.width < 1 || bb.height < 1) continue
    for (const t of texts) {
      const tb = t.el.children.length ? t.t : clipOf(t.el, t.b)
      if (inter(tb, bb) && !t.el.contains(bar) && !bar.contains(t.el)) push('R3', t.el, 'overlap_px', ov(tb, bb).y, 1, `글자(${R(tb.top)}~${R(tb.bottom)})가 막대(${R(bb.top)}~${R(bb.bottom)})와 ${R(ov(tb, bb).y)}px 겹침`, { other: { kind: 'bar', box: box(bb), selector: selector(bar) }, diag: fakeIndicator(bar) })
    }
  }
  // 화면 위·아래 끝에 붙은 고정 막대(탭바·구매 막대·입력창). 그 아래로 들어간 내용은 겹침이 아니라 가려짐(R4)으로 본다
  const barOf = (e) => { for (let a = e; a && a !== document.body; a = a.parentElement) { const p = css(a).position; if (p === 'fixed' || p === 'sticky' || p === 'absolute') { const b = a.getBoundingClientRect(); if (b.width >= VW * 0.8 && b.height < VH * 0.5 && (b.top <= 2 || b.bottom >= VH - 2)) return a } } return null }
  const underBar = (x, y) => { const bx = barOf(x); return !!bx && !bx.contains(y) }
  // 떠 있는 작은 층(글쓰기 버튼 같은 FAB, 미니 플레이어): 스크롤되는 내용은 그 아래로 지나간다. 겹침이 아니고, 스크롤 끝에서도 가리면 R4로 본다
  const docScrolls = () => { const se = document.scrollingElement || document.documentElement; return se.scrollHeight > VH + 1 }
  const scrollerOf = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const s = css(a); if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight + 1) return a } return null }
  const floatsOver = (f, c) => {
    for (let a = f; a && a !== document.body; a = a.parentElement) {
      const p = css(a).position; if (p !== 'fixed' && p !== 'absolute' && p !== 'sticky') continue
      if (a.contains(c)) return false
      const b = a.getBoundingClientRect(); if (b.width * b.height > VW * VH * 0.4) return false
      const sc = scrollerOf(c)
      return sc ? !sc.contains(a) : (p === 'fixed' && docScrolls())
    }
    return false
  }
  // 잠깐 떴다 사라지는 알림(위치를 띄운 role=status·alert, aria-live 영역)이 내용을 덮는 것은 겹침이 아니다. 누를 요소를 덮으면 R4에서 본다
  const liveLayer = (e) => { const l = e.closest('[role=status], [role=alert], [aria-live=polite], [aria-live=assertive]'); return l && /(fixed|absolute)/.test(css(l).position) ? l : null }
  const layered = (x, y) => underBar(x, y) || underBar(y, x) || floatsOver(x, y) || floatsOver(y, x) || liveLayer(x) !== liveLayer(y)
  // 겹친 곳 가운데에서 맨 위 요소가 한 글자 쪽이고, 그 글자와 다른 글자 사이에 큰 불투명 층(시트·카드·메뉴, 화면의 15% 넘게)이 있으면 다른 글자는 덮여 안 보인다.
  // 배지·칩처럼 작은 불투명 상자가 글자를 덮는 것은 가린 것이 아니라 겹친 것이다
  const opaque = (e) => { const c = css(e).backgroundColor; const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return false; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return v.length < 4 || v[3] >= 0.95 }
  const hiddenUnder = (A, B, qa, qb) => {
    qa = qa || A.t; qb = qb || B.t
    const o = { x: (Math.max(qa.left, qb.left) + Math.min(qa.right, qb.right)) / 2, y: (Math.max(qa.top, qb.top) + Math.min(qa.bottom, qb.bottom)) / 2 }
    const hit = document.elementFromPoint(o.x, o.y); if (!hit) return false
    const [top, under] = A.el.contains(hit) || hit.contains(A.el) || hit === A.el ? [A.el, B.el] : B.el.contains(hit) || hit === B.el ? [B.el, A.el] : [null, null]
    if (!top) return false
    for (let a = top; a && !a.contains(under); a = a.parentElement) if (opaque(a) && area(a.getBoundingClientRect()) > VW * VH * 0.15) return true
    return false
  }
  for await (const [i] of inspectRows('R3-text', texts.map((t, i) => [i, t.el]), x => x[1])) {
    for (let j = i + 1; j < texts.length; j++) {
      const A = texts[i]; const B = texts[j]
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue
      if (!inter(A.t, B.t)) continue
      const o = ovLines(A.rs, B.rs)
      if (o && !hiddenUnder(A, B, o.a, o.b) && !layered(A.el, B.el)) push('R3', A.el, 'overlap_px', Math.min(o.x, o.y), 1, `"${label(A.el)}"와 "${label(B.el)}" 글자가 ${R(o.x)}×${R(o.y)}px 겹침`, { other: { kind: 'text', box: box(B.t), info: info(B.el) } })
    }
  }
  // 글자와 상자(스위치·버튼·카드·배지처럼 배경이나 테두리가 있는 요소)의 겹침. 글자를 품은 조상과 글자가 품은 요소, 그림은 뺀다
  const boxes = [...document.querySelectorAll('div, span, button, a, input, [role=switch], [role=checkbox]')].filter((e) => {
    if (ignored(e) || !visible(e) || e.closest('svg')) return false
    const b = e.getBoundingClientRect(); if (b.width < 12 || b.height < 12 || b.width * b.height > VW * VH * 0.2) return false
    const s = css(e)
    const bg = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent'
    const border = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none'
    return bg || border || /^(switch|checkbox)$/.test(e.getAttribute('role') || '')
  })
  const boxSet = new Set(boxes)
  // 아이콘·아바타 위 배지처럼, 글자 없는 상대 요소를 품은 작은 틀(상대 넓이의 4배 이하)에 절대 위치로 얹은 장식은 겹침이 아니다
  const decoration = (x, other) => {
    if (/[\p{L}\p{N}]/u.test(other.textContent)) return false // 글자를 덮는 배지는 장식이 아니라 겹침이다
    for (let a = x; a && a !== document.body; a = a.parentElement) {
      const p = css(a).position; if (p !== 'absolute' && p !== 'fixed') continue
      const cb = a.offsetParent; if (!cb || !cb.contains(other)) return false
      return area(cb.getBoundingClientRect()) <= area(other.getBoundingClientRect()) * 4
    }
    return false
  }
  // 글자 쪽 층(시트·덮개처럼 불투명하거나 어둡게 덮는 조상)이 겹친 지점을 덮으면, 그 아래 상자는 가려진 것이지 겹친 것이 아니다
  const coverAlpha = (e) => { const c = css(e).backgroundColor; const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 0; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return v.length < 4 ? 1 : v[3] }
  // 그 층이 실제로 위에 있을 때만이다(겹친 지점의 맨 위 요소가 상자 쪽이면 글자가 상자 아래로 들어간 겹침이다)
  const layerHides = (txt, bx, x, y) => {
    const hit = document.elementFromPoint(x, y)
    if (hit && (bx.contains(hit) || hit === bx)) return false
    for (let a = txt.parentElement; a && a !== document.body && !a.contains(bx); a = a.parentElement) {
      if (coverAlpha(a) < 0.3) continue
      const r = a.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
    }
    return false
  }
  const reported = new Set() // 이미 보고한 (글자를 품은 상자, 상대 상자) 짝. 상자끼리 겹침에서 다시 보고하지 않는다
  const boxIdx = new Map(boxes.map((b, i) => [b, i]))
  const pairKey = (a, b) => { const i = boxIdx.get(a); const j = boxIdx.get(b); return i < j ? `${i}:${j}` : `${j}:${i}` }
  for (const t of texts) {
    if (t.t.width < 1 || t.t.height < 1) continue
    for (const bx of boxes) {
      if (bx.contains(t.el) || t.el.contains(bx) || layered(bx, t.el) || decoration(t.el, bx) || decoration(bx, t.el)) continue
      const bb = clipOf(bx, bx.getBoundingClientRect()); if (!inter(t.t, bb)) continue
      const ol = ovLines(t.rs, [bb]); if (!ol || ol.x <= 2 || ol.y <= 2) continue
      const q = ol.a
      if (layerHides(t.el, bx, (Math.max(q.left, bb.left) + Math.min(q.right, bb.right)) / 2, (Math.max(q.top, bb.top) + Math.min(q.bottom, bb.bottom)) / 2)) continue
      for (let a = t.el; a && a !== document.body; a = a.parentElement) if (boxSet.has(a)) reported.add(pairKey(a, bx))
      push('R3', t.el, 'overlap_px', Math.min(ol.x, ol.y), 2, `글자 "${label(t.el)}"와 ${bx.getAttribute('role') || bx.tagName.toLowerCase()} 상자${label(bx) ? ` "${label(bx).slice(0, 20)}"` : ''}가 ${R(ol.x)}×${R(ol.y)}px 겹침`, { other: { kind: 'box', box: box(bb), selector: selector(bx), label: label(bx).slice(0, 30) } })
    }
  }
  // 상자끼리 겹침(글자를 품은 칩·카드·버튼): 글자 획은 닿지 않아도 칩이나 카드 상자가 다른 버튼·카드 위로 올라간 경우.
  // 아이콘 위 배지처럼 작은 틀 안에 일부러 얹은 장식, 떠 있는 층 아래로 스크롤되는 내용, 다른 요소에 덮여 안 보이는 곳은 뺀다
  const CTRL_BOX = /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/
  const boxCands = boxes.filter((e) => CTRL_BOX.test(e.tagName) || /^(button|switch|checkbox|tab|link)$/.test(e.getAttribute('role') || '') || /[\p{L}\p{N}]/u.test(e.textContent))
  for (let i = 0; i < boxCands.length; i++) {
    for (let j = i + 1; j < boxCands.length; j++) {
      const P = boxCands[i]; const Q = boxCands[j]
      if (P.contains(Q) || Q.contains(P) || reported.has(pairKey(P, Q))) continue
      const pb = clipOf(P, P.getBoundingClientRect()); const qb = clipOf(Q, Q.getBoundingClientRect()); const o = ov(pb, qb)
      if (o.x <= 2 || o.y <= 2) continue
      if (layered(P, Q) || decoration(P, Q) || decoration(Q, P)) continue
      const hit = document.elementFromPoint((Math.max(pb.left, qb.left) + Math.min(pb.right, qb.right)) / 2, (Math.max(pb.top, qb.top) + Math.min(pb.bottom, qb.bottom)) / 2)
      if (!hit) continue
      const onP = P.contains(hit); const onQ = Q.contains(hit)
      if (!onP && !onQ) continue
      const under = onP ? Q : P; const over = onP ? P : Q
      // 위 상자가 대화상자 안이거나, 시트처럼 큰 불투명 층·고정 층에 속하면 아래 상자는 그 층에 덮인 것이다(겹침이 아님)
      const cx = (Math.max(pb.left, qb.left) + Math.min(pb.right, qb.right)) / 2; const cy = (Math.max(pb.top, qb.top) + Math.min(pb.bottom, qb.bottom)) / 2
      let sheet = !!over.closest('[role=dialog], [aria-modal=true], dialog') && !under.closest('[role=dialog], [aria-modal=true], dialog')
      for (let a = over; !sheet && a && a !== document.body && !a.contains(under); a = a.parentElement) {
        const r = a.getBoundingClientRect(); if (area(r) <= VW * VH * 0.25 || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) continue
        const pos = css(a).position
        if ((a !== over && coverAlpha(a) >= 0.3) || pos === 'fixed' || pos === 'absolute') sheet = true
      }
      if (sheet) continue
      reported.add(pairKey(P, Q))
      push('R3', under, 'box_overlap_px', Math.min(o.x, o.y), 2, `"${label(under).slice(0, 20)}" 상자 위로 "${label(over).slice(0, 20)}" 상자가 ${R(o.x)}×${R(o.y)}px 겹쳐 올라감`, { other: { kind: 'box', box: box(over === P ? pb : qb), selector: selector(over), label: label(over).slice(0, 30) } })
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
  // 자식 요소가 섞인 요소는 자기 글자 노드만으로 센다. 일부러 다른 줄에 놓은 자식(위아래로 쌓은 '월'과 '13')은 꺾인 것이 아니다
  const ownLines = (el) => { const tops = []; for (const q of ownRects(el)) { if (!tops.some((y) => Math.abs(y - q.top) < Math.max(2, q.height * 0.4))) tops.push(q.top) } return Math.max(1, tops.length) }
  const shortLabel = (s) => s.length > 0 && (s.length <= 4 || (s.length <= 20 && !/\s/.test(s)))
  for await (const t of inspectRows('R6', texts, x => x.el)) {
    const mixed = t.el.children.length > 0
    const s = mixed ? ownText(t.el) : t.el.textContent.trim()
    const word = s.length > 4 && s.length <= 20 && !/\s/.test(s)
    if (!(s.length > 0 && (s.length <= 4 || word))) continue
    const n = mixed ? ownLines(t.el) : textLines(t.el)
    if (n >= 2) push('R6', t.el, 'lines', n, 2, word ? `띄어쓰기 없는 '${s}'(${s.length}자)가 ${n}줄로 끊겨 그려짐` : `${s.length}글자 라벨이 ${n}줄로 그려짐(높이 ${R(t.b.height / scale)}px, 시안 기준)`, { diag: narrowBox(t.el) })
  }
  // R3 SVG 도형 위 글자: 도형 위에 일부러 얹은 글자(절대 위치 층, 도넛 가운데 수치)가 도형의 칠·선 가장자리에 걸치면 겹침이다.
  // 글자 전체가 한 도형 안에 있으면(막대 안 수치) 일부러 얹은 라벨이라 뺀다. 도형 뒤로 흐름 속 글자가 지나가는 장식 배경도 뺀다
  const svgRoots = [...document.querySelectorAll('svg')].filter((sv) => !ignored(sv) && visible(sv) && !(sv.parentElement && sv.parentElement.closest('svg')) && area(sv.getBoundingClientRect()) >= 2500)
  for await (const sv of inspectRows('R3-svg', svgRoots)) {
    const sb = clipOf(sv, sv.getBoundingClientRect())
    const shapes = [...sv.querySelectorAll('circle, ellipse, rect, path, line, polyline, polygon')].filter((sh) => { const st = css(sh); return (st.fill !== 'none' && st.fillOpacity !== '0') || (st.stroke !== 'none' && parseFloat(st.strokeWidth) > 0) })
    if (!shapes.length) continue
    const painted = (x, y) => {
      for (const sh of shapes) {
        const m = sh.getScreenCTM(); if (!m) continue
        const pt = new DOMPoint(x, y).matrixTransform(m.inverse()); const st = css(sh)
        try { if ((st.fill !== 'none' && sh.isPointInFill(pt)) || (st.stroke !== 'none' && sh.isPointInStroke(pt))) return true } catch (e) {}
      }
      return false
    }
    for (const t of texts) {
      if (sv.contains(t.el) || t.el.contains(sv) || !inter(t.t, sb)) continue
      // 글자 쪽에 불투명 판(차트 말풍선 등)이 있으면 도형은 그 판 아래로 가려진다(겹침 아님)
      let lifted = false; let plate = false
      for (let a = t.el; a && a !== document.body && !a.contains(sv); a = a.parentElement) { if (coverAlpha(a) >= 0.95) plate = true; const ps = css(a).position; if (ps === 'absolute' || ps === 'fixed') lifted = true }
      if (!lifted || plate) continue
      let hits = 0; let n = 0
      for (const q of t.rs) {
        const x0 = Math.max(q.left, sb.left); const x1 = Math.min(q.right, sb.right); const y0 = Math.max(q.top, sb.top); const y1 = Math.min(q.bottom, sb.bottom)
        if (x1 - x0 < 2 || y1 - y0 < 2) continue
        for (let i = 0; i <= 6; i++) for (let j = 0; j <= 2; j++) { n++; if (painted(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * j / 2)) hits++ }
      }
      if (n && hits >= 2 && hits < n) push('R3', t.el, 'svg_overlap_px', hits, 2, `도형 위에 얹은 글자 "${label(t.el).slice(0, 20)}"가 그림(SVG) 도형의 가장자리에 걸쳐 겹침(표본 ${n}점 중 ${hits}점이 도형 위)`, { other: { kind: 'svg', box: box(sb), selector: selector(sv) } })
    }
  }
  // R3 줄끼리 겹침: 한 요소 안에서 줄 간격(줄 높이)이 글자 크기의 0.8배보다 작아 위아래 줄 글자가 겹침(줄 높이 단위 실수)
  for (const t of texts) {
    if (t.el.children.length) continue
    const fs = parseFloat(css(t.el).fontSize); if (!(fs > 0)) continue
    const rg = document.createRange(); rg.selectNodeContents(t.el)
    const tops = [...new Set([...rg.getClientRects()].filter((q) => q.width >= 0.5).map((q) => Math.round(q.top)))].sort((a, b) => a - b)
    let pitch = Infinity; for (let i = 1; i < tops.length; i++) { const d = tops[i] - tops[i - 1]; if (d > 1) pitch = Math.min(pitch, d) }
    if (isFinite(pitch) && pitch < fs * 0.8) push('R3', t.el, 'line_overlap_px', fs - pitch, 2, `줄 간격 ${R(pitch)}px가 글자 크기 ${R(fs)}px보다 작아 위아래 줄 글자가 ${R(fs - pitch)}px 겹침`, { diag: { code: 'line_height_small', text: `line-height(${css(t.el).lineHeight})가 글자 크기보다 작다. 단위를 잘못 넣었을 수 있다(예: 10px 대신 1.0)` } })
  }
  // R4 가려짐: 스크롤을 끝까지 내린 상태에서도, 누르거나 읽을 요소가 화면보다 작은 고정·절대 위치 요소에 가려짐.
  // 얇은 막대(높이 6px 이하)와의 겹침은 R3에서 본다. 화면 전체를 덮는 요소(뒤에 깔린 스택 화면)는 가려짐으로 보지 않는다.
  if (opt.final || opt.first) {
    const cands = [...document.body.querySelectorAll('*')]
      .filter((el) => !NONTEXT.test(el.tagName) && !el.closest('svg') && !ignored(el) && visible(el) && (isField(el) || el.getAttribute('role') === 'button' || el.tagName === 'BUTTON' || ownNodes(el).length > 0))
    const ctrlEl = (el) => isField(el) || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || (el.tagName === 'A' && el.hasAttribute('href'))
    const positioned = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { const p = css(a).position; if (p === 'fixed' || p === 'sticky' || p === 'absolute') return a } return null }
    const seen = new Set()
    for await (const el of inspectRows('R4', cands)) {
      const b = el.getBoundingClientRect()
      const pts = [[0.5, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]].map(([fx, fy]) => [b.left + b.width * fx, b.top + b.height * fy]).filter(([x, y]) => x >= 0 && y >= 0 && x < VW && y < VH)
      if (pts.length < 3) continue
      let covered = 0; let cover = null
      for (const [x, y] of pts) {
        const hit = document.elementFromPoint(x, y)
        if (!hit || related(hit, el)) continue
        const p = positioned(hit); if (!p || related(p, el)) continue
        const pb = p.getBoundingClientRect()
        if (pb.height <= 6 || pb.height >= VH * 0.85) continue // 얇은 막대(R3)와 화면 전체를 덮는 층(뒤에 깔린 스택 화면·덮개)
        // 큰 시트(화면의 40% 넘게)는 그 아래 누를 요소를 가릴 때만 본다. 모달 대화상자는 일부러 덮으므로 뺀다
        const big = pb.width * pb.height > VW * VH * 0.4
        if (big && (!ctrlEl(el) || p.closest('[role=dialog], [aria-modal=true], dialog'))) continue
        // 화면 아래에 붙은 요소는 스크롤 끝에서, 위에 붙은 요소는 스크롤 맨 위에서만 본다(그 밖은 스크롤하면 드러난다)
        // 떠 있는 하단 탭바(바닥에서 조금 띄운 것)도 포함하려고 바닥·천장에서 40px 이내를 붙은 것으로 본다
        if (liveLayer(p) && !ctrlEl(el)) continue
        // 머리글 아래에 고정한 넓은 막대(기간 탭·공지 띠)도 위쪽 덮개다
        const bottomBar = pb.bottom >= VH - 40 && pb.top > VH * (big ? 0.15 : 0.5); const topBar = (pb.top <= 40 || (pb.top < VH * 0.2 && pb.width >= VW * 0.8)) && pb.bottom < VH * (big ? 0.85 : 0.5)
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
  // R4 닿을 수 없음: 누를 요소가 화면 높이로 고정된 틀 밖으로 밀려 있고, 스크롤로도 보이게 할 수 없음
  // (접힌 아코디언처럼 작은 부모가 숨긴 것은 빼려고, 화면 높이의 절반 이상인 틀이 자른 경우만 본다)
  if (opt.first) {
    const se = document.scrollingElement || document.documentElement
    const docScroll = se.scrollHeight > VH + 1
    const ctrls = [...document.querySelectorAll('button, a[href], input, textarea, select, [role=button]')].filter((e) => { if (ignored(e)) return false; const s = css(e); const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' })
    for (const e of ctrls) {
      const b = e.getBoundingClientRect()
      let clipB = docScroll ? Infinity : VH; let scrollable = false
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = css(a)
        if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight + 1) { scrollable = true; break }
        if (/(hidden|clip)/.test(s.overflowY)) { const ab = a.getBoundingClientRect(); if (ab.height >= VH * 0.5) clipB = Math.min(clipB, ab.bottom) }
      }
      if (scrollable || !isFinite(clipB)) continue
      const hidden = Math.max(0, b.bottom - clipB)
      if (hidden > b.height * 0.5) push('R4', e, 'unreachable_px', hidden, 1, `누를 요소가 보이는 영역(아래끝 ${R(clipB)}) 밖으로 ${R(hidden)}px 밀려 스크롤로도 닿을 수 없음`, { diag: { code: 'offscreen_no_scroll', text: '높이를 화면에 고정한 틀에서 내용이 넘쳐 아래 요소가 잘리고, 스크롤할 곳도 없다' } })
    }
  }
  // R4 안전영역 침범: 노치·상태바·홈 인디케이터 자리(안전영역)가 있을 때 글자나 누를 요소가 그 자리에 들어감
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)'
  document.body.appendChild(probe)
  const SA = { top: parseFloat(css(probe).paddingTop) || 0, bottom: parseFloat(css(probe).paddingBottom) || 0 }
  probe.remove()
  if (opt.first && (SA.top > 0 || SA.bottom > 0)) {
    const inScroll = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const s = css(a); if (/(auto|scroll)/.test(s.overflowY) && a.scrollHeight > a.clientHeight + 1) return true } return false }
    // 글자 요소와 누를 요소(아이콘만 있는 버튼 포함). 같은 버튼과 그 안 글자를 두 번 보고하지 않는다
    const saCtrls = [...document.querySelectorAll('button, a[href], [role=button], input, select, textarea')].filter((e) => !ignored(e) && visible(e))
    const saCands = [...new Set([...saCtrls, ...leaves.filter((el) => !isMedia(el))])]
    const saDone = []
    for (const el of saCands) {
      if (saDone.some((x) => related(x, el))) continue
      const b = el.getBoundingClientRect()
      const inTop = SA.top > 0 && b.top < SA.top - 1 && b.bottom > 0
      const inBot = SA.bottom > 0 && b.bottom > VH - SA.bottom + 1 && b.top < VH && !inScroll(el)
      if (!inTop && !inBot) continue
      const px = inTop ? SA.top - b.top : b.bottom - (VH - SA.bottom)
      saDone.push(el)
      push('R4', el, 'safe_area_px', px, 1, `${inTop ? `위 안전영역(${SA.top}px, 노치·상태바)` : `아래 안전영역(${SA.bottom}px, 홈 인디케이터)`}에 ${R(px)}px 들어감`, { diag: { code: 'safe_area', text: `viewport-fit=cover로 화면 끝까지 그리면서 env(safe-area-inset-${inTop ? 'top' : 'bottom'}) 여백을 주지 않았다` } })
    }
  }
  // A1 작은 터치 영역: 누를 요소가 24×24 CSS px 미만(WCAG 2.2 목표 크기 최소). 글 속 링크와, 더 큰 누를 요소 안에 든 것은 뺀다
  const CTRL = 'button, a[href], [role=button], [role=switch], [role=checkbox], [role=tab], [role=link], input[type=checkbox], input[type=radio], select'
  for await (const e of inspectRows('A1', document.querySelectorAll(CTRL))) {
    if (ignored(e) || !visible(e)) continue
    const b = e.getBoundingClientRect(); if (Math.min(b.width, b.height) >= 24) continue
    const big = e.parentElement && e.parentElement.closest(CTRL + ', label')
    if (big) { const bb = big.getBoundingClientRect(); if (Math.min(bb.width, bb.height) >= 24) continue }
    const par = e.parentElement
    if (e.tagName === 'A' && e.textContent.trim() && par && /^(P|SPAN|LI|TD|DIV)$/.test(par.tagName) && par.textContent.trim().length > e.textContent.trim().length + 5) continue
    if (!onTop(e)) continue
    push('A1', e, 'target_px', Math.min(b.width, b.height), 24, `누를 영역이 ${R(b.width)}×${R(b.height)}px로 기준(24×24px, WCAG 2.2) 미만`, {})
  }
  // 그림 위에 그려진 글자(글자 면적의 절반 넘게 그림과 겹침)는 뒤 배경이 그림이다. A2는 조상 배경으로 재면 틀리므로 건너뛰고, 아래 "그림 위 글자"에서 그림 픽셀로 잰다
  const imgs = [...document.querySelectorAll('img')].filter((im) => !ignored(im) && visible(im) && im.complete && im.naturalWidth > 0 && area(im.getBoundingClientRect()) >= 900)
  // A2 낮은 글자 대비: 글자색과 뒤 배경의 명도 대비가 4.5:1(큰 글자는 3:1) 미만(WCAG 1.4.3). 그림·그라데이션 위 글자와 비활성 요소는 뺀다
  const rgba = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 } }
  const lin = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  // 뒤 배경: 가장 가까운 불투명 배경 위에, 그 사이 반투명 배경(유리 카드 등)을 차례로 섞은 색. 그림·그라데이션 배경이면 모른다(null)
  const bgBehind = (el) => {
    const layers = []; let base = { r: 255, g: 255, b: 255, a: 1 }
    for (let a = el; a; a = a.parentElement) {
      const s = css(a); if (s.backgroundImage && s.backgroundImage !== 'none') return null
      const c = rgba(s.backgroundColor); if (c && c.a >= 0.95) { base = c; break }
      if (c && c.a > 0.05) layers.push(c)
    }
    for (let i = layers.length - 1; i >= 0; i--) { const l = layers[i]; base = { r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a), a: 1 } }
    return base
  }
  // 글자에서 그림을 품은 조상 직전까지의 글자 쪽 판: 불투명 판(opaque), 읽기 처리(글자 그림자·배경 그림, treated), 반투명 판 색(tl, 가까운 것부터)
  const ownLayers = (el, im) => {
    const out = { opaque: false, treated: false, tl: [] }
    for (let a = el; a && a !== document.body && !a.contains(im); a = a.parentElement) {
      const st = css(a)
      if ((st.backgroundImage && st.backgroundImage !== 'none') || (st.textShadow && st.textShadow !== 'none')) { out.treated = true; break }
      const c = rgba(st.backgroundColor); if (c && c.a >= 0.95) { out.opaque = true; break }
      if (c && c.a > 0.05) out.tl.push(c)
    }
    return out
  }
  // 그림 위 글자(글자 면적의 절반 넘게 그림과 겹치고, 글자 쪽에 불투명 판이 없음)는 아래 "그림 위 글자"에서 그림 픽셀로 잰다
  const overImage = (t) => {
    const ta = t.rs.reduce((a, q) => a + area(q), 0); if (!ta) return false
    return imgs.some((im) => { const ib = clipOf(im, im.getBoundingClientRect()); const cov = t.rs.reduce((a, q) => { const o = ov(q, ib); return a + (o.x > 0 && o.y > 0 ? o.x * o.y : 0) }, 0); return cov > ta * 0.5 && !ownLayers(t.el, im).opaque })
  }
  // 흐린 글자: 요소와 조상의 opacity를 곱한 값만큼, 글자와 배경을 흐린 묶음 바깥의 바탕색에 섞는다
  const fade = (el) => { let op = 1; let top = null; for (let a = el; a && a !== document.documentElement; a = a.parentElement) { const o = Number(css(a).opacity); if (o < 0.995) { op *= o; top = a } } return { op, top } }
  const mixc = (c, base, k) => ({ r: c.r * k + base.r * (1 - k), g: c.g * k + base.g * (1 - k), b: c.b * k + base.b * (1 - k) })
  const ratioOf = (a, b) => { const L1 = lum(a); const L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) }
  for await (const t of inspectRows('A2', texts, x => x.el)) {
    const el = t.el; if (el.closest('[aria-disabled=true], :disabled') || overImage(t)) continue
    if (!/[\p{L}\p{N}]/u.test(ownText(el))) continue // 글자·숫자가 없는 기호(›, ×)는 아이콘이라 글자 대비 대상이 아니다
    const s = css(el); const fg = rgba(s.color); const bg = bgBehind(el)
    if (!fg || !bg || fg.a < 0.05) continue
    let f = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) }
    let b2 = bg
    const fd = fade(el)
    if (fd.top) { const base = (fd.top.parentElement && bgBehind(fd.top.parentElement)) || { r: 255, g: 255, b: 255 }; f = mixc(f, base, fd.op); b2 = mixc(bg, base, fd.op) }
    const ratio = ratioOf(f, b2)
    const size = parseFloat(s.fontSize) / scale; const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700)
    const need = large ? 3 : 4.5
    if (ratio < need) push('A2', el, 'contrast_x100', ratio * 100, need * 100, `글자 대비 ${ratio.toFixed(2)}:1로 기준(${need}:1${large ? ', 큰 글자' : ''}) 미만(글자 ${s.color}, 배경 rgb(${R(bg.r)}, ${R(bg.g)}, ${R(bg.b)})${fd.top ? `, 투명도 ${R(fd.op * 100)}%` : ''})`, {})
  }
  // A2 입력칸 안내 글자: 비어 있는 입력칸의 placeholder 글자도 글자다(WCAG 1.4.3)
  for await (const e of inspectRows('A2', document.querySelectorAll('input, textarea'), x => x, 'placeholder')) {
    if (ignored(e) || !visible(e) || e.value || !e.placeholder || e.disabled || e.type === 'hidden') continue
    const pc = rgba(getComputedStyle(e, '::placeholder').color); const bg = bgBehind(e); if (!pc || !bg) continue
    const f = { r: pc.r * pc.a + bg.r * (1 - pc.a), g: pc.g * pc.a + bg.g * (1 - pc.a), b: pc.b * pc.a + bg.b * (1 - pc.a) }
    const ratio = ratioOf(f, bg); const size = parseFloat(css(e).fontSize) / scale; const need = size >= 24 ? 3 : 4.5
    if (ratio < need) push('A2', e, 'placeholder_contrast_x100', ratio * 100, need * 100, `입력칸 안내 글자(placeholder) 대비 ${ratio.toFixed(2)}:1로 기준(${need}:1) 미만(글자 ${getComputedStyle(e, '::placeholder').color})`, {})
  }
  // 그림 위 글자: 글자가 <img> 위에 그려지면 뒤 배경은 그림 픽셀이다. 위 A2는 조상 배경만 보므로 그림 픽셀과의 대비를 따로 잰다.
  // 흐름 속 글자(사진 설명·제목)가 그림 위로 밀려 올라갔으면 겹침(R3, 기준 3:1), 일부러 얹은 글자(절대 위치)면 대비 부족(A2)으로 본다.
  // 글자 쪽에 자기 배경(칩·반투명 막)이나 글자 그림자가 있으면 읽기를 챙긴 것이라 뺀다. 다른 출처 그림(픽셀을 읽을 수 없음)도 뺀다
  const imgPix = new Map()
  const pixOf = (im) => {
    if (imgPix.has(im)) return imgPix.get(im)
    let d = null
    try {
      const W = Math.min(im.naturalWidth, 320); const H = Math.max(1, Math.round(im.naturalHeight * W / im.naturalWidth))
      const c = document.createElement('canvas'); c.width = W; c.height = H
      const g = c.getContext('2d'); g.drawImage(im, 0, 0, W, H); d = { W, H, k: im.naturalWidth / W, px: g.getImageData(0, 0, W, H).data }
    } catch (e) { d = null }
    imgPix.set(im, d); return d
  }
  // 화면 좌표 → 그림 픽셀(object-fit: fill·cover·contain·none·scale-down, 가운데 맞춤)
  const pixAt = (im, d, x, y) => {
    const r = im.getBoundingClientRect(); const fit = css(im).objectFit
    let sx = r.width / d.W; let sy = r.height / d.H; let ox = 0; let oy = 0
    if (fit !== 'fill') {
      const cover = Math.max(sx, sy); const contain = Math.min(sx, sy); const none = d.k * scale
      const s2 = fit === 'cover' ? cover : fit === 'contain' ? contain : fit === 'none' ? none : Math.min(contain, none)
      sx = sy = s2; ox = (r.width - d.W * s2) / 2; oy = (r.height - d.H * s2) / 2
    }
    const ix = Math.floor((x - r.left - ox) / sx); const iy = Math.floor((y - r.top - oy) / sy)
    if (ix < 0 || iy < 0 || ix >= d.W || iy >= d.H) return null
    const k = (iy * d.W + ix) * 4; return { r: d.px[k], g: d.px[k + 1], b: d.px[k + 2], a: d.px[k + 3] / 255 }
  }
  for (const im of imgs) {
    const ib = clipOf(im, im.getBoundingClientRect())
    for (const t of texts) {
      if (!inter(t.t, ib)) continue
      const ol = ovLines(t.rs, [ib]); if (!ol || ol.x <= 2 || ol.y <= 2) continue
      const x0 = Math.max(ol.a.left, ib.left); const x1 = Math.min(ol.a.right, ib.right); const y0 = Math.max(ol.a.top, ib.top); const y1 = Math.min(ol.a.bottom, ib.bottom)
      const hit = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2)
      if (!hit || !(hit === t.el || t.el.contains(hit) || hit.contains(t.el))) continue // 글자가 그림 위에 보일 때만
      if (!/[\p{L}\p{N}]/u.test(ownText(t.el))) continue
      // 글자 쪽 불투명 판(칩)이 있으면 위 A2가 잰다. 글자 그림자·배경 그림은 읽기를 챙긴 것이라 뺀다. 반투명 판은 그림 픽셀에 섞어 잰다
      const L = ownLayers(t.el, im); if (L.opaque || L.treated) continue
      let overlay = false
      for (let a = t.el; a && a !== document.body && !a.contains(im); a = a.parentElement) { const ps = css(a).position; if (ps === 'absolute' || ps === 'fixed') overlay = true }
      const d = pixOf(im); if (!d) continue
      const fg = rgba(css(t.el).color); if (!fg || fg.a < 0.05) continue
      const ratios = []
      for (let i = 1; i <= 5; i++) {
        for (let j = 1; j <= 3; j++) {
          const p0 = pixAt(im, d, x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * j / 4); if (!p0 || p0.a < 0.5) continue
          let p = p0; for (let k = L.tl.length - 1; k >= 0; k--) p = mixc(L.tl[k], p, L.tl[k].a)
          const f = { r: fg.r * fg.a + p.r * (1 - fg.a), g: fg.g * fg.a + p.g * (1 - fg.a), b: fg.b * fg.a + p.b * (1 - fg.a) }
          ratios.push(ratioOf(f, p))
        }
      }
      if (ratios.length < 5) continue
      ratios.sort((a, b) => a - b); const med = ratios[Math.floor(ratios.length / 2)]
      const ts = css(t.el); const size = parseFloat(ts.fontSize) / scale; const large = size >= 24 || (size >= 18.66 && Number(ts.fontWeight) >= 700)
      const need = overlay ? (large ? 3 : 4.5) : 3
      if (med >= need) continue
      const other = { kind: 'image', box: box(ib), selector: selector(im), label: (im.getAttribute('alt') || '').slice(0, 30) }
      if (L.tl.length) overlay = true // 반투명 판을 깐 글자는 일부러 얹은 것이다
      if (overlay) push('A2', t.el, 'contrast_x100', med * 100, need * 100, `그림 위 글자 대비 ${med.toFixed(2)}:1로 기준(${need}:1${large ? ', 큰 글자' : ''}) 미만(글자 ${ts.color}, 뒤 그림 픽셀 기준)`, { other })
      else push('R3', t.el, 'image_overlap_px', Math.min(ol.x, ol.y), 2, `글자 "${label(t.el).slice(0, 20)}"가 그림 위로 ${R(ol.x)}×${R(ol.y)}px 겹쳐 그림과의 대비가 ${med.toFixed(2)}:1(기준 3:1)`, { other })
    }
  }
  // D4 그림 결함: 불러오지 못한 그림(깨짐), 원본 비율과 다르게 늘어난 그림(object-fit: fill)
  for await (const img of inspectRows('D4', document.querySelectorAll('img'))) {
    if (ignored(img)) continue
    const b = img.getBoundingClientRect(); const s = css(img)
    if (!visible(img)) continue // 투명한 그림(react-native-web이 접근성용으로 깔아 두는 img 등)은 뺀다
    if (img.complete && img.naturalWidth === 0) { push('D4', img, 'broken_image', 1, 1, `그림을 불러오지 못해 깨진 그림이 보임(${(img.getAttribute('src') || '').slice(0, 60)})`, { diag: { code: 'broken_image', text: '그림 주소가 틀렸거나 파일이 없다' } }); continue }
    if (!img.naturalWidth || b.width * b.height < 144 || Math.min(b.width, b.height) < 12) continue // 아이콘·로고 크기(12px 이상)도 본다
    if (s.objectFit === 'fill' || !s.objectFit) {
      const nat = img.naturalWidth / img.naturalHeight; const shown = b.width / b.height; const d = Math.abs(shown / nat - 1)
      if (d > 0.05) push('D4', img, 'distortion_pct', d * 100, 5, `그림 비율이 원본 ${nat.toFixed(2)}에서 ${shown.toFixed(2)}로 ${R(d * 100)}% 바뀌어 늘어나 보임(object-fit ${s.objectFit})`, { diag: { code: 'image_distorted', text: '폭과 높이를 따로 고정하고 object-fit을 fill(기본값)로 둬 원본 비율이 깨졌다. cover나 contain, 또는 aspect-ratio를 쓴다' } })
    }
  }
  // G1 글자 기호 아이콘: 아이콘 자리(혼자 선 1~2글자, 글자 앞·뒤에 띄어 붙인 기호)에 기호 글자(◉ ⌖ ✎ ▶ ☰, 아이콘 글꼴의 사용자 영역 글자)를 썼다.
  // 앱 글꼴에 그 기호가 없으면 기기의 대체 글꼴에 기대는데, 폰에 그 글꼴이 없으면 □로 깨지고 기기마다 모양·크기가 다르다.
  // 거의 모든 기기 글꼴에 있는 기호(• › → ✓ × ※ 등)와 이모지(색 글꼴로 그려진다)는 뺀다. 앱 글꼴이 그 기호를 직접 그리면(아이콘 글꼴 포함) 뺀다.
  {
    const SAFE = '•·‧…‹›«»←↑→↓×÷°±※✓'
    const risky = (ch) => {
      if (!ch || SAFE.includes(ch) || /\p{Emoji_Presentation}/u.test(ch)) return false
      const c = ch.codePointAt(0)
      return (c >= 0x2190 && c <= 0x21FF) || (c >= 0x2300 && c <= 0x23FF) || (c >= 0x25A0 && c <= 0x25FF) || (c >= 0x2600 && c <= 0x27BF) || (c >= 0x2900 && c <= 0x297F) || (c >= 0x2B00 && c <= 0x2BFF) || (c >= 0xE000 && c <= 0xF8FF)
    }
    const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|math|emoji|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont)$/i
    const cv = document.createElement('canvas').getContext('2d')
    const wOf = (font, s) => { cv.font = font; return cv.measureText(s).width }
    // 첫 글꼴이 이 글자를 직접 그리는지: 못 그리면 뒤 글꼴로 넘어가 '없는 글꼴'과 폭이 같다(serif·monospace 두 번 확인)
    const draws = (q, s, size) => [' serif', ' monospace'].some((g) => Math.abs(wOf(`${size}px ${q},${g}`, s) - wOf(`${size}px "__dqa_none__",${g}`, s)) >= 0.01)
    // 페이지가 직접 불러온 글꼴(웹 글꼴)만 폰에도 같이 간다. 이 컴퓨터에 설치된 글꼴에 기호가 있다는 것은 폰과 상관없다
    const webfonts = new Set([...(document.fonts || [])].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '').trim().toLowerCase()))
    for await (const el of inspectRows('G1', leaves)) {
      if (isField(el) || isMedia(el) || ignored(el) || el.closest('code,pre,kbd,samp')) continue
      const raw = (el.children.length ? ownText(el) : el.textContent).replace(/[\uFE0E]/g, '').trim()
      if (!raw || raw.length > 60) continue
      if (/\uFE0F/.test(raw)) continue // 이모지 표시 선택자가 붙은 기호는 색 글꼴로 그려진다
      const cs = [...raw]; let pos = null; let ch = null
      if (cs.length <= 2 && cs.every(risky)) { pos = 'alone'; ch = cs[0] } else if (risky(cs[0]) && /\s/.test(cs[1] || '')) { pos = 'prefix'; ch = cs[0] } else if (risky(cs[cs.length - 1]) && /\s/.test(cs[cs.length - 2] || '')) { pos = 'suffix'; ch = cs[cs.length - 1] }
      if (!pos) continue
      const s = css(el); const fam = s.fontFamily.split(',')[0].trim().replace(/["']/g, ''); const size = parseFloat(s.fontSize) || 14
      const q = GENERIC.test(fam) ? null : `"${fam.replace(/"/g, '')}"`
      const isWeb = !!q && webfonts.has(fam.toLowerCase())
      const famThere = q ? draws(q, 'a가', size) : null // 글꼴 자체가 이 화면에 있는지(없으면 확인 불가)
      const inFont = isWeb ? draws(q, ch, size) : null
      if (inFont) continue // 앱이 넣은 글꼴(아이콘 글꼴 포함)이 이 기호를 직접 그린다
      const code = 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')
      const where = pos === 'alone' ? '아이콘 자리' : `글자 ${pos === 'prefix' ? '앞' : '뒤'}`
      const why = inFont === false ? `앱 글꼴 ${fam}에 이 기호가 없어 기기의 대체 글꼴로 그려진다` : q && !famThere ? `글꼴 ${fam}이 이 화면에 없어 확인하지 못했다` : `앱에 넣은 글꼴이 아니라 기기 글꼴(${fam})에 맡긴다`
      push('G1', el, 'glyph_icon', 1, 1, `${where}에 기호 글자 '${ch}'(${code})를 썼다. ${why}. 폰 글꼴에 이 기호가 없으면 □로 깨진다`, { glyph: { ch, code, pos, font: fam, in_font: inFont }, diag: { code: 'glyph_icon', text: `'${ch}'를 SVG 아이콘(또는 앱에 넣은 아이콘 글꼴)으로 바꾼다. ${why}` } })
    }
  }
  // R7 화면 틀 이탈: 앱 틀이 화면보다 좁을 때, 모달·시트가 틀 밖으로 벗어남.
  // 앱 틀은 root가 화면보다 좁으면 root, 아니면 root 안의 폰 크기 틀(폭 320~500, 가운데, 화면 높이의 80% 이상) 중 가장 넓은 것
  let frame = rb.width < VW - 4 ? rb : null
  if (!frame) {
    for (const el of root.querySelectorAll('div')) {
      const b = el.getBoundingClientRect()
      if (b.width >= 320 && b.width <= 500 && b.width < VW - 4 && b.height >= VH * 0.8 && Math.abs((b.left + b.right) / 2 - VW / 2) <= 4 && (!frame || b.width > frame.width)) frame = b
    }
  }
  if (frame) {
    const rb = frame
    const mods = [...document.querySelectorAll('[role=dialog], [aria-modal=true], div')].filter((el) => {
      if (ignored(el) || !visible(el)) return false
      const p = css(el).position; const b = el.getBoundingClientRect()
      return (el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true' || p === 'fixed') && b.width >= 80 && b.height >= 24
    })
    for await (const el of inspectRows('R7', mods)) {
      const b = el.getBoundingClientRect(); const out = Math.max(rb.left - b.left, b.right - rb.right)
      if (out > 2 && onTop(el)) push('R7', el, 'frame_escape_px', out, 2, `앱 틀(${R(rb.left)}~${R(rb.right)}) 밖으로 ${R(out)}px 벗어남`, { container: box(rb) })
    }
  }
  // 크기별 비교(R5)용: 짧은 글자의 줄 수
  // 크기별 비교(R5)는 R6와 같은 짧은 라벨(4자 이하, 띄어쓰기 없는 20자 이하)만 본다. 띄어쓰기가 있는 제목이 좁은 칸에서 줄을 바꾸는 것은 정상이다
  const lines = texts.filter((t) => shortLabel(t.el.children.length ? ownText(t.el) : t.el.textContent.trim())).map((t) => ({ fp: info(t.el).fp, lines: t.el.children.length ? ownLines(t.el) : textLines(t.el) }))
  return {
    viewport: { width: VW, height: VH },
    root: box(rb),
    scale,
    page_horizontal_overflow_px: Math.max(0, Math.max(document.documentElement.scrollWidth, VW) - DW),
    leaves: leaves.length,
    content: [...document.body.querySelectorAll('*')].filter(el => {
      if (NONTEXT.test(el.tagName) || ignored(el) || (el.closest('svg') && el.tagName !== 'svg')) return false
      if (!(isField(el) || el.tagName === 'IMG' || el.tagName === 'svg' || ownNodes(el).length)) return false
      const b=el.getBoundingClientRect(); if (!(b.width>0 && b.height>0)) return false
      for(let a=el;a;a=a.parentElement){const s=css(a);if(s.visibility==='hidden'||s.display==='none'||Number(s.opacity)<=0.01)return false}
      return true
    }).map(el=>[el.tagName,el.getAttribute('role')||'',label(el)].join('|')).sort(),
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
