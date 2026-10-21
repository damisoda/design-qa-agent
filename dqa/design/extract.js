// 시안 비교용 DOM 추출(page.evaluate로 넘기는 함수, 바깥 변수를 쓰지 않는다).
// 글자를 직접 품은 요소(글자), 배경·테두리가 있는 요소(상자), 그림을 문서 좌표(스크롤 0 기준)로 적는다.
// 요소마다 data-dqa-i 번호를 붙여, 다른 크기에서 다시 잴 때와 캡처에 윤곽선을 그릴 때 같은 요소를 찾는다.

function dqaDesignDom (opt) {
  opt = opt || {}
  const css = (e) => getComputedStyle(e)
  const sx = scrollX; const sy = scrollY
  const R = (v) => Math.round(v * 10) / 10
  const box = (r) => ({ left: R(r.left + sx), top: R(r.top + sy), right: R(r.right + sx), bottom: R(r.bottom + sy), width: R(r.width), height: R(r.height) })
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = css(e); return r.width > 0 && r.height > 0 && [...(function * () { for (let a=e; a; a=a.parentElement) yield a })()].every(a => {const q=css(a); return q.visibility !== 'hidden' && q.display !== 'none' && Number(q.opacity)>0.01}) }
  const NONTEXT = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TITLE|HEAD|META|LINK|OPTION|OPTGROUP|DATALIST|IFRAME|OBJECT|CANVAS|VIDEO|AUDIO|PICTURE|SOURCE|TRACK|MAP|AREA|BR|WBR)$/
  const ownNodes = (el) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())
  const rgba = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 } }
  const hex = (c) => c ? '#' + [c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase() : null
  const mix = (c, b, a) => ({ r: c.r * a + b.r * (1 - a), g: c.g * a + b.g * (1 - a), b: c.b * a + b.b * (1 - a) })
  // 뒤 배경: 가까운 불투명 배경 위에 반투명 배경을 섞은 색. 그림·그라데이션이면 null
  const bgOf = (el) => {
    const layers = []; let base = { r: 255, g: 255, b: 255 }
    for (let a = el; a; a = a.parentElement) {
      const s = css(a); if (s.backgroundImage && s.backgroundImage !== 'none') return null
      const c = rgba(s.backgroundColor); if (c && c.a >= 0.95) { base = c; break }
      if (c && c.a > 0.05) layers.push(c)
    }
    for (let i = layers.length - 1; i >= 0; i--) base = mix(layers[i], base, layers[i].a)
    return base
  }
  // 글꼴이 이 브라우저에 실제로 있는지(없으면 대체 글꼴로 그려진다): 대체 글꼴만 쓸 때와 폭이 같으면 없는 것
  const famCache = {}
  const avail = (fam) => {
    if (fam in famCache) return famCache[fam]
    if (!fam || /^(serif|sans-serif|monospace|system-ui|cursive|fantasy|-apple-system|blinkmacsystemfont|ui-sans-serif|ui-serif|inherit)$/i.test(fam)) return (famCache[fam] = true)
    const c = document.createElement('canvas').getContext('2d'); const t = 'mmmmmmmmmmlli WQ@ 1234567'
    const w = (f) => { c.font = `72px ${f}`; return c.measureText(t).width }
    return (famCache[fam] = w(`"${fam}", monospace`) !== w('monospace') || w(`"${fam}", serif`) !== w('serif'))
  }
  const label = (el) => (el.getAttribute('aria-label') || el.placeholder || el.getAttribute('alt') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
  const domPath = (el) => {
    const parts = []
    for (let e = el; e && e !== document.body && parts.length < 8; e = e.parentElement) {
      const p = e.parentElement; const same = p ? [...p.children].filter((c) => c.tagName === e.tagName) : []
      parts.unshift(e.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : ''))
    }
    return parts.join('>')
  }
  // 글자 줄 상자: 자기 글자 노드의 줄 사각형을 줄 높이로 맞춰 합친 것(Figma 글자 상자와 같은 뜻)
  const lineBox = (el) => {
    const s = css(el); const lh = parseFloat(s.lineHeight); const rg = document.createRange(); const qs = []
    const nodes = el.children.length ? ownNodes(el) : [el]
    for (const n of nodes) { rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.width >= 0.5 && q.height >= 0.5) qs.push(q) }
    if (!qs.length) return null
    const adj = qs.map((q) => { if (!(lh > 0)) return q; const c = (q.top + q.bottom) / 2; return { left: q.left, right: q.right, top: c - lh / 2, bottom: c + lh / 2 } })
    const l = Math.min(...adj.map((q) => q.left)); const t = Math.min(...adj.map((q) => q.top)); const r = Math.max(...adj.map((q) => q.right)); const b = Math.max(...adj.map((q) => q.bottom))
    const tops = []; for (const q of qs) if (!tops.some((y) => Math.abs(y - q.top) < Math.max(2, q.height * 0.4))) tops.push(q.top)
    return { ...box({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t }), lines: tops.length }
  }
  const all = [...document.body.querySelectorAll('*')].filter((el) => !NONTEXT.test(el.tagName) && !(el.closest('svg') && el.tagName.toLowerCase() !== 'svg'))
  const ids = new Map(); all.forEach((el, i) => { ids.set(el, i); el.setAttribute('data-dqa-i', String(i)) })
  const anc = (el) => { const out = []; for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (ids.has(a)) out.push(ids.get(a)); return out }
  const components = el => { const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$')); const out=[]; let f=el[key],count=0;while(f&&count++<50){const t=f.type,n=t&&(t.displayName||t.name||t.render?.displayName||t.render?.name);if(n&&!out.includes(n))out.push(n);f=f.return}return out.slice(0,12) }
  const meta = (el) => ({ i: ids.get(el), components: components(el), tag: el.tagName.toLowerCase(), cls: [...el.classList].slice(0, 6), pcls: el.parentElement ? [...el.parentElement.classList].slice(0, 4) : [], label: label(el), path: domPath(el), anc: anc(el) })
  const out = { vw: innerWidth, vh: innerHeight, doc_h: document.documentElement.scrollHeight, texts: [], boxes: [], imgs: [] }
  for (const el of all) {
    if (!visible(el)) continue
    const s = css(el); const r = el.getBoundingClientRect()
    const own = ownNodes(el)
    // Outlined glyphs and raster logos can carry semantic labels without DOM text.
    // Only rendered assets qualify; an empty aria-label wrapper is not proof of content.
    const semantic = norm(el.getAttribute('aria-label') || el.getAttribute('alt'))
    const assets = [...el.querySelectorAll('svg, img')]
    const paintedImage = assets.some(a=>a.tagName==='IMG'&&a.complete&&a.naturalWidth>0) && [el,...el.querySelectorAll('*')].some(a=>visible(a)&&/url\(/.test(css(a).backgroundImage))
    if (semantic && (el.tagName.toLowerCase() === 'svg' || el.tagName === 'IMG' || assets.length) &&
        (el.tagName !== 'IMG' || (el.complete && el.naturalWidth > 0)) &&
        !el.closest('[hidden]') && (!assets.length || assets.some(visible) || paintedImage)) {
      const paths = [...el.querySelectorAll('path, polygon, rect, circle, ellipse, text')].filter(visible)
      const paints = [...new Set(paths.map(p => hex(rgba(css(p).fill))).filter(Boolean))]
      out.texts.push({ ...meta(el), full: semantic + (own.length && /^[\p{Extended_Pictographic}\uFE0F\s]+$/u.test(norm(el.textContent)) && !semantic.includes(norm(el.textContent)) ? ' '+norm(el.textContent) : ''), own: semantic, mixed: false,
        representation: paths.length ? 'outlined-text' : 'image-label',
        paintColors: paints, box: box(r), line: null, display: s.display,
        style: { color: paints.length === 1 ? paints[0] : null, fontSize: null, fontWeight: null,
          lineHeight: null, letterSpacing: null, fontFamily: null },
        unmeasured: ['font-size','font-weight','font-family','line-height','letter-spacing'] })
    }
    if (own.length && el.tagName !== 'svg') {
      const bg = bgOf(el); const fg = rgba(s.color)
      const color = fg ? (fg.a < 0.99 && bg ? mix(fg, bg, fg.a) : fg) : null
      let op = 1; for (let a = el; a && a !== document.documentElement; a = a.parentElement) op *= Number(css(a).opacity)
      out.texts.push({
        ...meta(el), full: norm(el.textContent), own: norm(own.map((n) => n.textContent).join(' ')), mixed: el.children.length > 0,
        box: box(r), line: lineBox(el),
        style: { fontSize: parseFloat(s.fontSize), fontWeight: Number(s.fontWeight), lineHeight: parseFloat(s.lineHeight) || null, letterSpacing: parseFloat(s.letterSpacing) || 0, fontFamily: s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), fontStack: s.fontFamily, fontAvail: avail(s.fontFamily.split(',')[0].replace(/["']/g, '').trim()), color: hex(color), textAlign: s.textAlign, opacity: R(op) },
        bg: hex(bg), display: s.display
      })
    }
    const bg = rgba(s.backgroundColor); const bw = parseFloat(s.borderTopWidth); const hasBorder = bw > 0 && s.borderTopStyle !== 'none'
    const isCtrl = /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.getAttribute('role') === 'button'
    if (((bg && bg.a > 0.05) || hasBorder || isCtrl || (s.backgroundImage && s.backgroundImage !== 'none')) && r.width >= 8 && r.height >= 8) {
      out.boxes.push({ ...meta(el), box: box(r), ph: /^(INPUT|TEXTAREA)$/.test(el.tagName) ? norm(el.placeholder || el.value) || null : null, fill: bg && bg.a > 0.05 ? hex(bgOf(el)) : null, raw: bg && bg.a > 0.05 ? { hex: hex(bg), a: Math.round(bg.a * 100) / 100 } : null, gradient: !!(s.backgroundImage && s.backgroundImage !== 'none' && /gradient/.test(s.backgroundImage)), border: hasBorder ? { w: bw, color: hex(rgba(s.borderTopColor)) } : null, radius: parseFloat(s.borderTopLeftRadius) || 0, display: s.display, bgimg: !!(s.backgroundImage && s.backgroundImage !== 'none' && !/gradient/.test(s.backgroundImage)) })
    }
    if (el.tagName === 'IMG') out.imgs.push({ ...meta(el), box: box(r), radius: parseFloat(s.borderTopLeftRadius) || 0, border: hasBorder ? { w: bw, color: hex(rgba(s.borderTopColor)) } : null, fit: s.objectFit, natural: [el.naturalWidth, el.naturalHeight], src: (el.getAttribute('src') || '').slice(0, 80) })
  }
  // 크기 방식 비교용: 모든 요소의 폭(다른 크기에서 같은 요소를 data-dqa-i로 찾는다)
  // 화면 확대 배율: 375 캔버스를 transform으로 키우는 앱은 넓은 화면에서 모든 요소가 같은 비율로 커진다(크기 방식 비교에서 나눈다)
  const ratios = all.filter((el) => el.offsetWidth >= 50 && visible(el)).map((el) => el.getBoundingClientRect().width / el.offsetWidth).sort((a, b) => a - b)
  out.scale = ratios.length ? Math.round(ratios[Math.floor(ratios.length / 2)] * 1000) / 1000 : 1
  if (opt.widths) out.widths = Object.fromEntries(all.filter((el) => visible(el)).map((el) => [ids.get(el), R(el.getBoundingClientRect().width)]))
  // 부모 안 위치 비교용: 보이는 모든 요소의 상자(왼쪽·위·폭·높이, 문서 좌표)
  out.rects = Object.fromEntries(all.filter((el) => visible(el)).map((el) => { const q = el.getBoundingClientRect(); return [ids.get(el), [R(q.left + sx), R(q.top + sy), R(q.width), R(q.height)]] }))
  return out
}

// 캡처에 시안 비교 결과 윤곽선을 그린다(번호로 요소를 찾는다)
function dqaDesignOutline (items) {
  document.querySelectorAll('.__dqa_dz').forEach((n) => n.remove())
  for (const it of items) {
    const el = document.querySelector(`[data-dqa-i="${it.i}"]`); if (!el) continue
    const r = el.getBoundingClientRect(); const d = document.createElement('div'); d.className = '__dqa_dz'
    Object.assign(d.style, { position: 'absolute', left: (r.left + scrollX - 2) + 'px', top: (r.top + scrollY - 2) + 'px', width: (r.width + 4) + 'px', height: (r.height + 4) + 'px', border: '2px solid #D21F3C', borderRadius: '3px', zIndex: 2147483647, pointerEvents: 'none', boxSizing: 'border-box' })
    document.body.appendChild(d)
  }
}

module.exports = { dqaDesignDom, dqaDesignOutline }
