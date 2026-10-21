// 시안(design.json)과 구현(dqaDesignDom 추출)의 값 비교.
// 1) 짝짓기: 시안 글자 노드 ↔ 같은 내용의 DOM 글자(가까운 것부터), 내용이 조금 다르면 문구 다름. 상자는 겹침 비율과 안의 글자로 짝짓는다.
// 2) 값 비교: 글자 스타일(D3), 색(D2), 모서리·테두리(D5), 이웃과의 간격(L2), 같은 줄·열 정렬(L1), Fill·고정 폭(F1), 문구(T1), 빠진 글자(M1).
// 위치는 전역 어긋남(상태 표시줄 등)을 빼고, 이웃 요소와의 상대 관계로만 본다(한 군데 간격 차이가 아래 전부로 번지지 않게).
const { sha1 } = require('../core/util')

const RULE_NAME = { T1: '문구 다름', M1: '시안 글자 없음', M2: '시안 그림 없음', D2: '색 다름', D3: '글자 스타일 다름', D5: '모서리·테두리 다름', L1: '정렬 어긋남', L2: '간격 다름', F1: '크기 방식 다름', G1: '글자 기호 아이콘' }
const SEVERITY = { T1: '높음', M1: '높음', M2: '중간', D2: '중간', D3: '중간', D5: '낮음', L1: '중간', L2: '중간', F1: '중간', G1: '중간' }
const TOL = { color: 10, fontSize: 1, weight: 100, lineHeight: 2, letter: 0.5, radius: 2, gap: 3, align: 3, size: 4, grow: 10, pin: 8, fuzzy: 0.6 }
const SKIP_NAME = /^(status ?bar|statusbar|home ?indicator|상태 ?표시줄|홈 ?인디케이터)$/i

const norm = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim()
// 글꼴 이름의 굵기 낱말(42dotSans-SemiBold → 600)과, 굵기를 뗀 글꼴 이름이 같은지(42dot Sans ≈ Dot42-Bold)
const WEIGHT_WORDS = [['extralight', 200], ['ultralight', 200], ['semibold', 600], ['demibold', 600], ['extrabold', 800], ['ultrabold', 800], ['thin', 100], ['light', 300], ['regular', 400], ['normal', 400], ['book', 400], ['medium', 500], ['bold', 700], ['black', 900], ['heavy', 900]]
const famFlat = (f) => String(f || '').toLowerCase().replace(/["'\s_-]|variable|std/g, '')
const nameWeight = (f) => { const s = famFlat(String(f || '').split(',')[0]); const w = WEIGHT_WORDS.find(([k]) => s.endsWith(k) && s.length > k.length); return w ? w[1] : null }
const famBase = (f) => { const s = famFlat(f); const w = WEIGHT_WORDS.find(([k]) => s.endsWith(k) && s.length > k.length); return w ? s.slice(0, -w[0].length) : s }
const sameFamily = (a, b) => {
  const A = famBase(a); const B = famBase(b); if (!A || !B) return false
  if (A.startsWith(B) || B.startsWith(A)) return true
  // 글자·숫자 덩어리 순서만 다른 표기(42dot ↔ Dot42): 짧은 쪽 덩어리가 모두 긴 쪽에 들어 있으면 같은 글꼴
  const [s, l] = A.length <= B.length ? [A, B] : [B, A]; const toks = s.match(/[a-z]+|\d+/g) || []
  return toks.length >= 2 && s.length >= 4 && toks.every((t) => l.includes(t))
}
const hexRgb = (h) => { const m = String(h || '').replace('#', '').match(/^([0-9a-f]{6})/i); if (!m) return null; const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 } }
const cdist = (a, b) => { const x = hexRgb(a); const y = hexRgb(b); if (!x || !y) return 0; return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b)) }
const lev = (a, b) => {
  a = a.slice(0, 200); b = b.slice(0, 200)
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t } }
  return d[b.length]
}
// 비슷한 정도: 편집 거리 비율. 한쪽이 다른 쪽을 통째로 품으면(신청하기 ↔ 참가 신청하기) 문구가 바뀐 것으로 본다
const sim = (a, b) => { if (!a || !b) return 0; if (a === b) return 1; const s = 1 - lev(a, b) / Math.max(a.length, b.length); const short = a.length < b.length ? a : b; return short.length >= 2 && (a.includes(b) || b.includes(a)) ? Math.max(s, 0.75) : s }
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
const R = Math.round
const dbox = (n) => ({ left: n.x, top: n.y, right: n.x + n.w, bottom: n.y + n.h, width: n.w, height: n.h })
const center = (b) => [(b.left + b.right) / 2, (b.top + b.bottom) / 2]
const iou = (a, b) => { const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w <= 0 || h <= 0) return 0; const i = w * h; return i / (a.width * a.height + b.width * b.height - i) }
const shift = (b, dx, dy) => ({ left: b.left - dx, top: b.top - dy, right: b.right - dx, bottom: b.bottom - dy, width: b.width, height: b.height })

// 시안 노드를 평평하게(부모 번호와 함께). 숨긴 노드·상태 표시줄 같은 기기 장식은 뺀다
function flatten (spec) {
  const out = []
  const walk = (ns, parent) => {
    for (const n of ns || []) {
      if (n.visible === false || n.opacity === 0 || SKIP_NAME.test(String(n.name || '').trim())) continue
      const me = { ...n, parent, idx: out.length }
      out.push(me)
      walk(n.children, me.idx)
    }
  }
  walk(spec.nodes, null)
  return out
}

// DOM 쪽 상자 고르기: 요소 상자와 글자 줄 상자 중 시안 노드 크기에 더 가까운 것(합성 시안은 요소 상자, Figma 글자 노드는 줄 상자)
function pickBox (dn, t) {
  // A label can contain an input. Its own text range excludes that child control.
  if (dn.type === 'TEXT' && t.mixed && t.line) return t.line
  const cands = [t.box, t.line].filter(Boolean)
  return cands.sort((a, b) => (Math.abs(a.width - dn.w) + Math.abs(a.height - dn.h)) - (Math.abs(b.width - dn.w) + Math.abs(b.height - dn.h)))[0]
}

function * compareSteps (spec, dom, alt, opt = {}, tall = null) {
  const nodes = flatten(spec)
  const issues = []; const unmeasured = []
  const add = (rule, metric, value, threshold, text, unit, extra) => issues.push({ rule, metric, value: R(value * 10) / 10, threshold, text, dom: unit.t ? pick(unit.t, unit.b) : null, design: { id: unit.n.id, name: unit.n.name, type: unit.n.type, box: { x: unit.n.x, y: unit.n.y, w: unit.n.w, h: unit.n.h }, text: unit.n.text ? unit.n.text.content : null }, ...(extra || {}) })
  const pick = (t, b) => ({ i: t.i, tag: t.tag, cls: t.cls, pcls: t.pcls, label: t.label, path: t.path, representation: t.representation || null, components: t.components || [], box: b || t.box })
  const tokenOf = (hex) => { if (!hex) return null; const k = Object.keys(spec.tokens || {}).find((k) => String(spec.tokens[k]).toUpperCase() === String(hex).toUpperCase()); return k || null }
  const named = (hex, tok) => `${hex}${tok ? `(${tok})` : tokenOf(hex) ? `(${tokenOf(hex)})` : ''}`

  // 1) 글자 짝짓기
  const dTexts = nodes.filter((n) => n.text && norm(n.text.content))
  const used = new Set(); const units = []
  const cand = []
  for (const n of dTexts) {
    const want = norm(n.text.content)
    for (const t of dom.texts) {
      const decoration = norm(t.full).slice(want.length).trim(); const arrowLabel = norm(t.full).startsWith(want) && /^[〉›»→‹〈]$/.test(decoration) && nodes.some(v=>v.type==='VECTOR'&&v.w<=32&&v.h<=32&&v.x>=n.x+n.w-2&&v.x<n.x+n.w+40&&Math.abs(v.y-n.y)<n.h);
      const exact = norm(t.full) === want || (t.mixed && norm(t.own) === want) || arrowLabel
      if (!exact) continue
      const b = pickBox(n, t); const [dx, dy] = center(dbox(n)); const [ix, iy] = center(b)
      cand.push({ n, t, b, dist: Math.hypot(ix - dx, iy - dy) })
    }
  }
  cand.sort((a, b) => a.dist - b.dist)
  const doneN = new Set()
  for (const c of cand) { if (doneN.has(c.n.idx) || used.has(c.t.i)) continue; doneN.add(c.n.idx); used.add(c.t.i); units.push({ n: c.n, t: c.t, b: c.b, exact: true }) }
  // 전역 어긋남(가운데 값): 시안에만 있는 상태 표시줄 등으로 전체가 밀린 만큼
  const offX = median(units.map((u) => center(u.t.mixed ? u.t.box : u.b)[0] - center(dbox(u.n))[0]))
  const offY = median(units.map((u) => center(u.b)[1] - center(dbox(u.n))[1]))
  const ox = Math.abs(offX) >= 2 ? offX : 0; const oy = Math.abs(offY) >= 2 ? offY : 0
  // 내용이 조금 다른 글자(문구 다름)와 짝이 없는 글자(빠짐)
  for (const n of dTexts.filter((n) => !doneN.has(n.idx))) {
    const want = norm(n.text.content); let best = null
    for (const t of dom.texts) {
      if (used.has(t.i)) continue
      const s = Math.max(sim(norm(t.full), want), t.mixed ? sim(norm(t.own), want) : 0)
      if (s < TOL.fuzzy) continue
      const b = pickBox(n, t); const d = Math.hypot(center(shift(b, ox, oy))[0] - center(dbox(n))[0], center(shift(b, ox, oy))[1] - center(dbox(n))[1])
      if (d > 160) continue
      if (!best || s - d / 2000 > best.s - best.d / 2000) best = { t, b, s, d }
    }
    // 시안 글자가 입력칸의 안내 글자(placeholder) 그 자체로 구현돼 있으면 빠진 것이 아니다.
    // 포함 관계는 인정하지 않는다(라벨 4개를 안내 글자 하나에 몰아 쓴 것은 시안과 다른 구조다)
    const ph = !best && (dom.boxes || []).find((b) => b.ph && 1 - lev(b.ph, want) / Math.max(b.ph.length, want.length) >= 0.8 && Math.hypot(center(shift(b.box, ox, oy))[0] - center(dbox(n))[0], center(shift(b.box, ox, oy))[1] - center(dbox(n))[1]) <= 160)
    if (ph) { doneN.add(n.idx); continue }
    if (best) { used.add(best.t.i); doneN.add(n.idx); units.push({ n, t: best.t, b: best.b, exact: false, s: best.s }) } else {
      issues.push({ rule: 'M1', metric: 'missing', value: 1, threshold: 1, text: `시안의 글자 "${want.slice(0, 40)}"가 구현에 없다`, dom: null, design: { id: n.id, name: n.name, type: n.type, box: { x: n.x, y: n.y, w: n.w, h: n.h }, text: want } })
    }
  }
  function record (test, ordinal, total, input, status) {
    const n = input.n || input
    const unit = input.n ? input : units.find(u => u.n.idx === n.idx)
    const t = unit && unit.t
    const properties = []
    const prop = (name, design, impl) => { if (design !== undefined && design !== null && impl !== undefined && impl !== null) properties.push({ name, design, impl }) }
    if (t) {
      prop('문구', n.text && n.text.content, t.full || t.label)
      prop('너비', n.w, unit.b && unit.b.width); prop('높이', n.h, unit.b && unit.b.height)
      if (n.text && t.style) { prop('글자 크기', n.text.fontSize, t.style.fontSize); prop('글자 굵기', n.text.fontWeight, t.style.fontWeight); prop('줄 높이', n.text.lineHeight, t.style.lineHeight); prop('글자색', n.text.color && n.text.color.hex, t.style.color); prop('글꼴', n.text.fontFamily, t.style.fontFamily) }
      prop('배경색', n.fill && n.fill.hex, t.fill || (t.raw && t.raw.hex)); prop('모서리', n.radius || 0, t.radius)
    }
    return { test, ordinal, total, status, properties, element: t ? { ...pick(t, unit.b), style: t.style || {}, fp: t.path || String(t.i) } : null,
      figma: { id: n.id, name: n.name, type: n.type, box: dbox(n) }, findings: issues.filter(x => x.design && x.design.id === n.id).map(x => ({ rule: x.rule, text: x.text, metric: x.metric, value: x.value, threshold: x.threshold, prop: x.prop })).slice(0, 10) }
  }
  function * visit (test, items) {
    let ordinal = 0
    for (const item of items) {
      ordinal++
      yield { marker: record(test, ordinal, items.length, item, 'checking') }
      yield { item }
      yield { marker: record(test, ordinal, items.length, item, 'checked') }
    }
  }
  // 2) 상자 짝짓기: 채움·테두리·모서리가 있는 시안 노드 ↔ 배경·테두리가 있는 DOM 요소
  // 채움이 있으면 작은 점(범례 점 6px)까지, 테두리·모서리만 있으면 12px부터
  const paints = n => n.fill && (n.fill.opacity ?? 1) * (n.opacity ?? 1) > 0.01
  const descendantOf = (n, p) => { for(let i=n.parent; i!==null && i!==undefined; i=nodes[i].parent) if(i===p.idx)return true; return false }
  // A full-size, later opaque surface hides its ancestor/template paint. Keep an
  // explicit exclusion record rather than comparing both surfaces with one DOM box.
  const covered = new Set(nodes.filter(n => paints(n) && nodes.some(o => o!==n && !o.text && paints(o) &&
    (o.fill.opacity ?? 1)*(o.opacity ?? 1)>=0.99 && o.idx>n.idx &&
    /* DFS paint order includes foreground descendants of later siblings. */
    Math.abs(o.x-n.x)<=1 && Math.abs(o.y-n.y)<=1 && Math.abs(o.w-n.w)<=1 && Math.abs(o.h-n.h)<=1)).map(n=>n.idx))
  for (const n of nodes) if(covered.has(n.idx)) unmeasured.push({node:n.id,property:'covered-surface',reason:'later full-size opaque surface; compare foreground only'})
  const effectiveFill = n => {
    const chain=[];for(let a=n; a; a=a.parent===null ? null : nodes[a.parent]) if(paints(a))chain.unshift(a.fill)
    let c=hexRgb(spec.frame?.fill?.hex); if(!c && chain.some(f=>(f.opacity??1)<1))return null
    c=c||{r:255,g:255,b:255};for(const f of chain){const q=hexRgb(f.hex);if(!q)return null;const a=f.opacity??1;c={r:q.r*a+c.r*(1-a),g:q.g*a+c.g*(1-a),b:q.b*a+c.b*(1-a)}}
    return '#'+[c.r,c.g,c.b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('').toUpperCase()
  }
  const boxNodes = nodes.filter((n) => !covered.has(n.idx) && (paints(n) || n.stroke || (n.radius && n.type==='IMAGE')) && ((n.fill && n.w >= 6 && n.h >= 6) || (n.w >= 12 && n.h >= 12)))
  const textUnitOf = new Map(units.map((u) => [u.n.idx, u]))
  for (const step of visit('design-box', boxNodes)) {
    if (step.marker) { yield step.marker; continue }
    const n = step.item
    if (textUnitOf.has(n.idx) && !n.fill && !n.stroke) continue
    const db = dbox(n); let best = null
    // 시안 노드 안의 짝지은 글자들이 DOM에서 들어 있는 요소면 가산점
    const innerT = units.filter((u) => u.n.idx !== n.idx && inside(dbox(u.n), db)).map((u) => u.t.i)
    // 그림 노드는 그림 요소와만, 나머지는 배경·테두리가 있는 요소와만 짝짓는다(그림과 겹친 하단 바를 그림으로 보지 않게)
    const pool = n.type === 'IMAGE' ? [...(dom.imgs || []), ...dom.boxes.filter((b) => b.bgimg)].map((g) => ({ ...g, fill: null, raw: null, border: g.border || null, gradient: false })) : dom.boxes
    for (const b of pool) {
      const sb = shift(b.box, ox, oy); const o = iou(sb, db)
      const holds = innerT.length ? innerT.filter((i) => dom.texts.find((t) => t.i === i && (t.anc.includes(b.i) || t.i === b.i))).length / innerT.length : 0
      const look = (b.radius !== undefined && Math.abs((n.radius || 0) - (b.radius || 0)) < 1.5 ? 0.08 : 0) +
        (n.fill && n.fill.hex && (b.raw || b.fill) && cdist(n.fill.hex, (b.raw && b.raw.hex) || b.fill) < TOL.color ? 0.08 : 0) +
        (n.stroke && n.stroke.width && b.border && Math.abs(n.stroke.width - b.border.w) < 1 ? 0.06 : 0)
      const score = o + holds * 0.5 + look
      if (o < 0.35 && holds < 0.99) continue
      // 글자를 품기만 하고 훨씬 큰 요소(옆 메뉴 전체 등)는 이 노드가 아니다
      if (o < 0.35 && b.box.width * b.box.height > 3 * n.w * n.h) continue
      if (!best || score > best.score) best = { b, score }
    }
    if (!best) {
      // 시안의 그림(사진·일러스트)이 그 자리에 없다: 그림 요소도 배경 그림도 겹치지 않음
      if (n.type === 'IMAGE' && n.w >= 24 && n.h >= 24) issues.push({ rule: 'M2', metric: 'missing_image', value: 1, threshold: 1, text: `시안의 그림 "${n.name}"(${n.w}×${n.h})이 그 자리에 없다`, dom: null, design: { id: n.id, name: n.name, type: n.type, box: { x: n.x, y: n.y, w: n.w, h: n.h }, text: null } })
      continue
    }
    const u = textUnitOf.get(n.idx)
    const unit = { n, t: { ...best.b, label: best.b.label }, b: best.b.box, box: true }
    const visibleFill = paints(n) ? effectiveFill(n) : null
    if (visibleFill && best.b.fill && !best.b.gradient && cdist(visibleFill,best.b.fill)>=TOL.color)
      add('D2','fill_diff',cdist(visibleFill,best.b.fill),TOL.color,`배경색(합성 후): 시안 ${visibleFill}, 구현 ${best.b.fill}`,unit,{design_value:visibleFill,impl_value:best.b.fill,prop:'background-color',token:n.fill.token||tokenOf(n.fill.hex)})
    // 채움도 테두리도 없는 노드의 모서리는 보이지 않는다(그림 노드는 사진 모서리라 본다)
    if (n.type !== 'VECTOR' && (n.type !== 'TEXT' || n.radius) && (paints(n) || n.stroke || n.type === 'IMAGE')) {
      const rd = n.radius || 0
      if (Math.abs(rd - best.b.radius) >= TOL.radius) add('D5', 'radius_diff', Math.abs(rd - best.b.radius), TOL.radius, `모서리: 시안 ${rd}px, 구현 ${R(best.b.radius)}px`, unit, { design_value: rd, impl_value: best.b.radius, prop: 'border-radius' })
    }
    if (n.stroke && n.stroke.width) {
      const bw = best.b.border ? best.b.border.w : 0
      if (Math.abs(n.stroke.width - bw) >= 1) add('D5', 'border_diff', Math.abs(n.stroke.width - bw), 1, `테두리 두께: 시안 ${n.stroke.width}px, 구현 ${bw}px`, unit, { design_value: n.stroke.width, impl_value: bw, prop: 'border-width' })
      else if (n.stroke.hex && best.b.border && cdist(n.stroke.hex, best.b.border.color) >= TOL.color) add('D5', 'border_color_diff', cdist(n.stroke.hex, best.b.border.color), TOL.color, `테두리 색: 시안 ${named(n.stroke.hex, n.stroke.token)}, 구현 ${named(best.b.border.color)}`, unit, { design_value: n.stroke.hex, impl_value: best.b.border.color, prop: 'border-color', token: n.stroke.token || tokenOf(n.stroke.hex) })
    }
    if (!u) units.push({ ...unit, boxOnly: true })
  }
  // 3) 글자 값 비교
  for (const step of visit('design-text', units.filter((u) => u.n.text && !u.boxOnly))) {
    if (step.marker) { yield step.marker; continue }
    const u = step.item
    const ds = u.n.text; const st = u.t.style
    if(u.t.representation) unmeasured.push({node:u.n.id,representation:u.t.representation,properties:u.t.unmeasured||[],reason:'outlined or raster text does not expose typography'})
    if (!u.exact) add('T1', 'text_diff', R((1 - u.s) * 100), 0, `문구: 시안 "${norm(ds.content).slice(0, 40)}", 구현 "${norm(u.t.full).slice(0, 40)}"`, u, { design_value: norm(ds.content), impl_value: norm(u.t.full), prop: '문구' })
    const d3 = []
    if (st.fontSize !== null && ds.fontSize && Math.abs(ds.fontSize - st.fontSize) >= TOL.fontSize) d3.push(['font-size', `${ds.fontSize}px`, `${R(st.fontSize * 10) / 10}px`, Math.abs(ds.fontSize - st.fontSize)])
    // 굵기를 글꼴 이름에 담는 앱(…-SemiBold, …-Bold)은 계산된 굵기가 400이어도 실제 굵기는 이름의 굵기다
    const fw = st.fontWeight === 400 && nameWeight(st.fontFamily) ? nameWeight(st.fontFamily) : st.fontWeight
    if (fw !== null && ds.fontWeight && Math.abs(ds.fontWeight - fw) >= TOL.weight) d3.push(['font-weight', ds.fontWeight, fw, Math.abs(ds.fontWeight - fw) / 100])
    if (ds.lineHeight && st.lineHeight && Math.abs(ds.lineHeight - st.lineHeight) >= TOL.lineHeight) d3.push(['line-height', `${ds.lineHeight}px`, `${R(st.lineHeight)}px`, Math.abs(ds.lineHeight - st.lineHeight)])
    if (st.letterSpacing !== null && ds.letterSpacing !== undefined && ds.letterSpacing !== null && Math.abs((ds.letterSpacing || 0) - (st.letterSpacing || 0)) >= TOL.letter) d3.push(['letter-spacing', `${ds.letterSpacing}px`, `${st.letterSpacing}px`, Math.abs(ds.letterSpacing - st.letterSpacing)])
    for (const [prop, a, b, v] of d3) add('D3', `${prop}_diff`, v, prop === 'font-weight' ? 1 : TOL.fontSize, `글자 ${prop === 'font-size' ? '크기' : prop === 'font-weight' ? '굵기' : prop === 'line-height' ? '줄 높이' : '자간'}: 시안 ${a}, 구현 ${b}`, u, { design_value: a, impl_value: b, prop })
    if (ds.color && ds.color.hex && st.color && cdist(ds.color.hex, st.color) >= TOL.color) add('D2', 'color_diff', cdist(ds.color.hex, st.color), TOL.color, `글자색: 시안 ${named(ds.color.hex, ds.color.token)}, 구현 ${named(st.color)}`, u, { design_value: ds.color.hex, impl_value: st.color, prop: 'color', token: ds.color.token || tokenOf(ds.color.hex) })
  }
  // G1(시안): 시안은 벡터 아이콘인데 구현은 기호 글자(‹ × → ◉ 등) 1~2개로 그렸다. 글자는 시안 아이콘과 모양·크기·굵기가 다르고 기기 글꼴에 따라 달라진다.
  // 기기 글꼴에 없을 수 있는 기호(◉ ⌖ 등)는 측정 규칙 G1이 이미 보고하므로, 여기서는 흔한 기호(‹ › × → ✓ 등)만 본다
  const SYM = /^[\u2190-\u21FF\u2300-\u23FF\u25A0-\u25FF\u2600-\u27BF\u2B00-\u2BFF\u2039\u203A\u00AB\u00BB\u00D7\u2022\u2715\u2716\uE000-\uF8FF]{1,2}$/u
  const COMMON = '•·‧…‹›«»←↑→↓×÷°±※✓'
  const isIcon = (n) => n.type === 'VECTOR' || (n.type === 'FRAME' && n.w <= 48 && n.h <= 48 && /icon|arrow|chevron|back|close|menu|아이콘|화살표|뒤로|닫기/i.test(n.name))
  for (const t of dom.texts) {
    const s = norm(t.full); if (!SYM.test(s) || ![...s].every((c) => COMMON.includes(c))) continue
    const tb = shift(t.box, ox, oy); const tc = center(tb)
    const icon = nodes.filter((n) => isIcon(n) && n.w <= 64 && n.h <= 64).map((n) => ({ n, d: Math.hypot(center(dbox(n))[0] - tc[0], center(dbox(n))[1] - tc[1]) })).filter((x) => x.d <= Math.max(16, Math.max(x.n.w, x.n.h))).sort((a, b) => a.d - b.d)[0]
    if (!icon) continue
    add('G1', 'glyph_for_icon', 1, 1, `시안은 아이콘 "${icon.n.name}"(${icon.n.w}×${icon.n.h})인데 구현은 글자 기호 '${s}'로 그렸다(모양·크기·굵기가 시안 아이콘과 다르고, 기기 글꼴마다 달라진다)`, { n: icon.n, t, b: t.box }, { design_value: `아이콘 ${icon.n.name}`, impl_value: `글자 '${s}'`, prop: '아이콘' })
  }
  // 글꼴(D3 font-family): 시안 글꼴이 구현 글꼴 목록에 없거나, 있어도 이 브라우저에 없어 대체 글꼴로 그려지면. 같은 글꼴은 화면에서 한 번만
  const famKey = (f) => String(f || '').toLowerCase().replace(/["'\s]|variable|std/g, '')
  const famSeen = new Map()
  for (const u of units.filter((u) => u.n.text && !u.boxOnly && u.n.text.fontFamily && u.t.style && u.t.style.fontFamily)) {
    const d = famKey(u.n.text.fontFamily); const stack = String(u.t.style.fontStack || u.t.style.fontFamily).split(',')
    const kind = !stack.some((f) => sameFamily(f, u.n.text.fontFamily)) ? 'diff' : sameFamily(stack[0], u.n.text.fontFamily) && u.t.style.fontAvail === false ? 'missing' : null
    if (!kind) continue
    const k = `${kind}|${d}|${famKey(u.t.style.fontFamily)}`
    if (famSeen.has(k)) { famSeen.get(k).n++; continue }
    famSeen.set(k, { u, kind, n: 1 })
  }
  for (const { u, kind, n } of famSeen.values()) {
    const txt = kind === 'diff' ? `글꼴: 시안 ${u.n.text.fontFamily}, 구현 ${u.t.style.fontFamily}` : `글꼴: 시안 글꼴 ${u.n.text.fontFamily}가 이 화면에 없어 대체 글꼴로 그려진다(글꼴 파일을 불러오지 않음)`
    add('D3', kind === 'diff' ? 'font-family_diff' : 'font_missing', n, 1, `${txt} · 글자 ${n}개`, u, { design_value: u.n.text.fontFamily, impl_value: kind === 'diff' ? u.t.style.fontFamily : `${u.t.style.fontFamily}(없음)`, prop: 'font-family', count: n, font_kind: kind })
  }
  // 4) 크기 방식(F1): 시안의 Fill·고정을 기준 크기의 폭과 넓은 크기에서의 변화로 확인한다
  const widthAt = (d, i) => (d && d.widths ? d.widths[i] : undefined)
  for (const u of units) {
    const sz = u.n.sizing && u.n.sizing.h; if (!sz || sz === 'HUG') continue
    if (u.t.representation || u.t.display === 'inline') continue // 인라인 요소는 폭을 정할 수 없다(줄바꿈에 따라 상자 폭이 바뀐다)
    const el = u.t; const elW = (u.t.box || u.b).width // 글자 노드도 요소 상자 폭으로 본다(Fill 글자는 블록 요소의 폭이 부모를 채운다)
    // 기준 크기의 폭 차이는 넓힌 화면 측정이 없을 때만 본다(형제가 바뀌어 Fill 폭이 달라진 것까지 크기 방식 차이로 세지 않게)
    if (!alt || !dom.widths) { if (sz === 'FILL' && Math.abs(elW - u.n.w) >= TOL.size) add('F1', 'fill_width_diff', Math.abs(elW - u.n.w), TOL.size, `폭: 시안은 부모를 채움(Fill, ${u.n.w}px), 구현 ${R(elW)}px`, u, { design_value: 'FILL', impl_value: `${R(elW)}px`, prop: 'width' }); continue }
    // 캔버스를 통째로 키우는 앱이면 넓은 화면의 폭을 배율로 나눠 시안 좌표로 되돌린다
    const ks = (alt.scale || 1) / (dom.scale || 1)
    const baseW = widthAt(dom, el.i); const altW = widthAt(alt, el.i) === undefined ? undefined : widthAt(alt, el.i) / ks; const par = (el.anc || [])[0]
    const pBase = widthAt(dom, par); const pAlt = widthAt(alt, par) === undefined ? undefined : widthAt(alt, par) / ks
    if ([baseW, altW, pBase, pAlt].some((v) => v === undefined)) continue
    const grow = altW - baseW; const pGrow = pAlt - pBase
    // 같은 줄에 Fill 형제가 여럿이면 늘어난 폭을 나눠 갖는다(강도 버튼 5개 → 각자 1/5)
    const share = Math.max(1, nodes.filter((o) => o.parent === u.n.parent && o.sizing && o.sizing.h === 'FILL' && Math.min(o.y + o.h, u.n.y + u.n.h) - Math.max(o.y, u.n.y) > Math.min(o.h, u.n.h) * 0.5).length)
    // max-width 등으로 부모가 넓어지지 않아도, 기준 크기에서 Fill 폭이 잘못될 수 있다.
    // 부모 폭은 시안과 같고 가로 Fill 형제가 없는 경우만 비교한다(가로 간격·분배 변화는 L2로 본다).
    const pNode = u.n.parent === null ? spec.frame : nodes[u.n.parent]
    const designParentW = pNode && (pNode.w === undefined ? pNode.width : pNode.w)
    if (sz === 'FILL' && Math.abs(pGrow) < TOL.grow && share === 1 && pNode &&
        (!pNode.layout || pNode.layout.mode !== 'HORIZONTAL') && Math.abs(pBase - designParentW) < TOL.size &&
        Math.abs(baseW - u.n.w) >= TOL.size) {
      add('F1', 'fill_width_diff', Math.abs(baseW - u.n.w), TOL.size, `기준 크기 폭: 시안은 부모를 채움(Fill, ${u.n.w}px), 구현 ${R(baseW)}px(부모 폭 ${R(pBase)}px는 시안과 같음)`, u, { design_value: 'FILL', impl_value: `${R(baseW)}px`, prop: 'width' })
    }
    // 오토 레이아웃 밖 노드의 좌우 늘림 제약(STRETCH·SCALE)은 고정 폭이어도 화면을 따라 늘어나는 것이 시안이다
    const hc = u.n.constraints && u.n.constraints.h
    if (sz === 'FIXED' && (hc === 'STRETCH' || hc === 'SCALE')) {
      if (pGrow >= TOL.grow && grow < pGrow * 0.5) add('F1', 'stretch_not_growing', pGrow - grow, TOL.grow, `크기 방식: 시안은 좌우 늘림 제약(${hc})인데, 화면이 넓어질 때 부모는 ${R(pGrow)}px 늘고 요소는 ${R(grow)}px만 늘어남(고정 폭)`, u, { design_value: `${hc}(제약)`, impl_value: 'FIXED', prop: 'width', at: 'alt' })
      continue
    }
    if (sz === 'FILL' && pGrow >= TOL.grow && grow < (pGrow / share) * 0.5) add('F1', 'fill_not_growing', pGrow - grow, TOL.grow, `크기 방식: 시안은 Fill인데, 화면이 넓어질 때 부모는 ${R(pGrow)}px 늘고 요소는 ${R(grow)}px만 늘어남(고정 폭)`, u, { design_value: 'FILL', impl_value: 'FIXED', prop: 'width', at: 'alt' })
    if (sz === 'FIXED' && grow >= TOL.grow && pGrow >= TOL.grow) add('F1', 'fixed_growing', grow, TOL.grow, `크기 방식: 시안은 고정 폭(${u.n.w}px)인데, 화면이 넓어지면 ${R(grow)}px 늘어남`, u, { design_value: 'FIXED', impl_value: 'FILL', prop: 'width', at: 'alt' })
  }
  // 4-2) 세로 제약(F1): 화면을 더 길게 열었을 때 시안의 아래 고정(MAX)은 아래와의 거리를, 위아래 늘림(STRETCH)은 높이 변화를 본다
  if (tall && tall.rects && dom.rects && spec.frame) {
    const ts = (tall.scale || 1) / (dom.scale || 1)
    const fh = spec.frame.height; const vh = tall.vh_used / ts; const dh = vh - (dom.vh_used || fh)
    for (const u of units) {
      const vc = u.n.constraints && u.n.constraints.v; if (!vc || (vc !== 'MAX' && vc !== 'STRETCH')) continue
      if (u.t.representation) continue
      const parentUnit = u.n.parent === null ? null : units.find(p=>p.n.idx===u.n.parent && p.t.i!==u.t.i)
      if(u.n.parent !== null && !parentUnit) {unmeasured.push({node:u.n.id,property:'vertical-constraint',reason:'immediate design parent not mapped'});continue}
      const el = u.t; const rb = dom.rects[el.i]; const rt0 = tall.rects[el.i]; if (!rb || !rt0 || dh < TOL.grow) continue
      const rt = rt0.map((v) => v / ts)
      const pb = parentUnit ? dom.rects[parentUnit.t.i] : [0,0,dom.vw,dom.vh_used||fh]
      const pt0 = parentUnit ? tall.rects[parentUnit.t.i] : [0,0,tall.vw,tall.vh_used]
      if(!pb||!pt0)continue
      const pt=pt0.map(v=>v/ts), parentGrow=pt[3]-pb[3]
      if(parentGrow<TOL.grow)continue
      if (vc === 'MAX') {
        const pn=u.n.parent===null?{y:0,h:fh}:nodes[u.n.parent]; const want = R(pn.y+pn.h-(u.n.y+u.n.h)); const got=R(pt[1]+pt[3]-(rt[1]+rt[3]))
        if (Math.abs(got - want) >= TOL.pin) add('F1', 'pin_bottom_lost', Math.abs(got - want), TOL.pin, `위치 방식: 시안은 화면 아래에 붙는 제약(MAX, 아래와 ${want}px)인데, 화면이 ${R(dh)}px 길어지면 구현은 아래와 ${got}px 떨어진다(위 기준 위치)`, u, { design_value: `bottom ${want}px(제약 MAX)`, impl_value: `bottom ${got}px`, prop: 'bottom', at: 'tall' })
      } else if (rt[3] - rb[3] < parentGrow * 0.5) add('F1', 'stretch_v_not_growing', R(parentGrow - (rt[3] - rb[3])), TOL.grow, `크기 방식: 시안은 위아래 늘림 제약(STRETCH)인데, 화면이 ${R(dh)}px 길어질 때 구현은 ${R(rt[3] - rb[3])}px만 늘어남`, u, { design_value: 'STRETCH(제약)', impl_value: 'FIXED', prop: 'height', at: 'tall' })
    }
  }
  // 5) 간격(L2): 시안에서 바로 위(같은 열)·바로 왼쪽(같은 줄) 이웃과의 간격을 구현과 비교. 안에 든 관계(부모·자식)는 뺀다
  const U = units.filter(u=>!u.t.representation).map((u) => ({ ...u, d: dbox(u.n), i: shift(u.b, ox, oy) })).filter((u) => Math.hypot(u.n.type === 'TEXT' && u.t.mixed ? u.i.left - u.d.left : center(u.i)[0] - center(u.d)[0], center(u.i)[1] - center(u.d)[1]) <= 120)
  const contains = (a, b) => a.left <= b.left + 1 && a.top <= b.top + 1 && a.right >= b.right - 1 && a.bottom >= b.bottom - 1
  const related = (a, b) => contains(a.d, b.d) || contains(b.d, a.d)
  const xov = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const yov = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  const seenGap = new Set()
  for (const u of U) {
    let up = null; let left = null
    for (const v of U) {
      if (v === u || related(u, v)) continue
      if (v.d.bottom <= u.d.top + 1 && xov(u.d, v.d) > Math.min(u.d.width, v.d.width) * 0.3) { const g = u.d.top - v.d.bottom; if (!up || g < up.g) up = { v, g } }
      if (v.d.right <= u.d.left + 1 && yov(u.d, v.d) > Math.min(u.d.height, v.d.height) * 0.3) { const g = u.d.left - v.d.right; if (!left || g < left.g) left = { v, g } }
    }
    for (const [nb, axis] of [[up, 'y'], [left, 'x']]) {
      if (!nb || nb.g > 64) continue
      const gi = axis === 'y' ? u.i.top - nb.v.i.bottom : u.i.left - nb.v.i.right
      const key = [u.n.idx, nb.v.n.idx, axis].join(':'); if (seenGap.has(key)) continue; seenGap.add(key)
      if (Math.abs(gi - nb.g) >= TOL.gap) add('L2', 'gap_diff', Math.abs(gi - nb.g), TOL.gap, `${axis === 'y' ? '위' : '왼쪽'} 요소 "${(nb.v.n.text ? norm(nb.v.n.text.content) : nb.v.n.name).slice(0, 16)}"와 간격: 시안 ${R(nb.g)}px, 구현 ${R(gi)}px`, u, { design_value: R(nb.g), impl_value: R(gi), prop: axis === 'y' ? 'margin-top' : 'margin-left', neighbor: { name: nb.v.n.name, i: nb.v.t ? nb.v.t.i : null } })
    }
  }
  // 간격 차이가 같은 만큼(±간격 허용치)인 요소가 다른 보고 요소 안(시안 기준)에 들어 있으면 뺀다(묶음이 통째로 밀린 것은 바깥 하나)
  const gapIs = issues.filter((x) => x.rule === 'L2')
  const dup = new Set(gapIs.filter((a) => gapIs.some((b) => b !== a && b.prop === a.prop && Math.abs((b.impl_value - b.design_value) - (a.impl_value - a.design_value)) < TOL.gap &&
    inside(dbox({ x: a.design.box.x, y: a.design.box.y, w: a.design.box.w, h: a.design.box.h }), dbox({ x: b.design.box.x, y: b.design.box.y, w: b.design.box.w, h: b.design.box.h })) &&
    !(a.design.box.x === b.design.box.x && a.design.box.y === b.design.box.y && a.design.box.w === b.design.box.w && a.design.box.h === b.design.box.h))))
  for (let k = issues.length - 1; k >= 0; k--) if (dup.has(issues[k])) issues.splice(k, 1)
  // 6) 정렬(L1): 시안에서 왼쪽 끝이 같은 열·위쪽 끝이 같은 줄 묶음이 구현에서 흩어진 경우, 묶음 가운데 값에서 벗어난 요소
  const groups = (key, along) => {
    const gs = []
    for (const u of U) { const g = gs.find((g) => Math.abs(g.k - key(u.d)) <= 1); if (g) g.items.push(u); else gs.push({ k: key(u.d), items: [u] }) }
    return gs.filter((g) => g.items.length >= 2)
  }
  const resized = new Set(issues.filter((x) => x.rule === 'F1' && x.dom).map((x) => x.dom.i))
  // 같은 줄(세로로 겹치는) 요소끼리의 아래 끝·세로 가운데 맞춤도 본다(사진 옆 이름의 아래 맞춤, 아이콘과 글자의 가운데 맞춤)
  const rowOnly = (g) => ({ ...g, items: g.items.filter((u) => g.items.some((v) => v !== u && yov(u.d, v.d) > 0 && xov(u.d, v.d) <= 0)) })
  const cy = (b) => (b.top + b.bottom) / 2
  for (const [key, ikey, what, row] of [[(b) => b.left, (b) => b.left, '왼쪽 끝'], [(b) => b.top, (b) => b.top, '위쪽 끝'], [(b) => b.bottom, (b) => b.bottom, '아래쪽 끝', true], [cy, cy, '세로 가운데', true]]) {
    for (const g0 of groups(key)) {
      const g = row ? rowOnly(g0) : g0
      if (g.items.length < 2) continue
      // 둘뿐이면 기준을 상자(사진·버튼 바탕) 쪽으로 잡는다(글자가 움직인 쪽으로 보이게)
      const devs = g.items.map((u) => ikey(u.i) - key(u.d))
      const anchor = g.items.length === 2 && g.items.filter((u) => u.boxOnly).length === 1 ? devs[g.items.findIndex((u) => u.boxOnly)] : null
      const m = anchor !== null ? anchor : median(devs)
      g.items.forEach((u, k) => { const off = devs[k] - m; if (Math.abs(off) >= TOL.align && !(u.t && resized.has(u.t.i)) && !issues.some((x) => x.rule === 'L1' && x.dom && u.t && x.dom.i === u.t.i)) add('L1', 'align_diff', Math.abs(off), TOL.align, `시안에서 ${what}이 같은 요소 ${g.items.length}개 중 이 요소만 ${R(Math.abs(off))}px ${what === '왼쪽 끝' ? (off > 0 ? '오른쪽' : '왼쪽') : (off > 0 ? '아래' : '위')}으로 어긋남`, u, { design_value: R(key(u.d)), impl_value: R(ikey(u.i)), prop: what === '왼쪽 끝' ? 'left' : what === '위쪽 끝' ? 'top' : what === '아래쪽 끝' ? 'bottom' : 'align-items' }) })
    }
  }
  // 7) 부모 안 위치(L1): 오토 레이아웃 프레임의 자식들이 부모 안에서 시안과 같은 만큼 떨어져 있는지. 자식이 모두 같이 밀리면(가운데 맞춤이 빠짐 등)
  //    서로 비교로는 안 보여서 부모 기준으로 본다. 부모는 자식 DOM 요소들의 가장 가까운 공통 조상이고, 크기가 시안 부모와 같을 때만 비교한다
  if (dom.rects) {
    const byParent = new Map()
    for (const u of U) { if (u.n.parent === null || !u.t || u.t.i === undefined) continue; if (!byParent.has(u.n.parent)) byParent.set(u.n.parent, []); byParent.get(u.n.parent).push(u) }
    for (const [pi, kids] of byParent) {
      const pn = nodes[pi]; if (!pn || !pn.layout || kids.length < 2) continue
      const ancs = kids.map((u) => [u.t.i, ...(u.t.anc || [])])
      const lca = ancs[0].find((a) => ancs.every((l) => l.includes(a)) && !kids.some((u) => u.t.i === a))
      const pr = lca !== undefined && dom.rects[lca]; if (!pr) continue
      if (Math.abs(pr[2] - pn.w) > TOL.size || Math.abs(pr[3] - pn.h) > TOL.size) continue
      const dys = kids.map((u) => (u.b.top - pr[1]) - (u.n.y - pn.y)); const dxs = kids.map((u) => (u.b.left - pr[0]) - (u.n.x - pn.x))
      for (const [ds, axis] of [[dys, 'y'], [dxs, 'x']]) {
        const m = median(ds)
        if (Math.abs(m) < TOL.align || ds.filter((v) => Math.abs(v - m) < TOL.align).length < Math.ceil(kids.length * 0.75)) continue
        const u = kids[0]
        const how = axis === 'y' ? `${R(Math.abs(m))}px ${m < 0 ? '위' : '아래'}로` : `${R(Math.abs(m))}px ${m < 0 ? '왼쪽' : '오른쪽'}으로`
        add('L1', 'align_in_parent', Math.abs(m), TOL.align, `"${pn.name}" 안의 요소 ${kids.length}개가 부모 안에서 함께 ${how} 밀림(시안 정렬 ${axis === 'y' ? (pn.layout.mode === 'HORIZONTAL' ? pn.layout.align : pn.layout.justify) : (pn.layout.mode === 'HORIZONTAL' ? pn.layout.justify : pn.layout.align)}, 안쪽 여백 ${pn.layout.padding.join('/')})`, u, { design_value: R(axis === 'y' ? u.n.y - pn.y : u.n.x - pn.x), impl_value: R(axis === 'y' ? u.b.top - pr[1] : u.b.left - pr[0]), prop: axis === 'y' ? (pn.layout.mode === 'HORIZONTAL' ? 'align-items' : 'justify-content') : (pn.layout.mode === 'HORIZONTAL' ? 'justify-content' : 'align-items'), parent: pn.name, count: kids.length })
      }
    }
  }
  // 폭·제약·정렬까지 끝난 뒤 모든 실제 짝과 최종 근거를 공개한다.
  let ordinal = 0
  for (const u of units) yield record('design-final', ++ordinal, units.length, u, 'checked')
  return { issues, unmeasured, matched: units.filter((u) => u.n.text && !u.boxOnly).length, matched_boxes: units.filter((u) => u.boxOnly).length, design_texts: dTexts.length, offset: { x: R(ox), y: R(oy) } }
}
const inside = (a, b) => a.left >= b.left - 1 && a.top >= b.top - 1 && a.right <= b.right + 1 && a.bottom <= b.bottom + 1

// 이슈를 결함 레코드로(같은 요소·같은 규칙은 하나로). 형식은 measure/cluster.js의 결함과 같다
function compareDesign (spec, dom, alt, opt = {}, tall = null) {
  const steps = compareSteps(spec, dom, alt, opt, tall)
  for (;;) { const next = steps.next(); if (next.done) return next.value }
}
async function compareDesignLive (spec, dom, alt, opt, tall, inspect) {
  const steps = compareSteps(spec, dom, alt, opt, tall)
  for (;;) { const next = steps.next(); if (next.done) return next.value; await inspect(next.value) }
}

function designDefects (issues, { screen, side, ref, w, h, shot, marked }) {
  const groups = new Map()
  for (const it of issues) {
    // 결함 신원은 시안 노드로 정한다(구현의 DOM 경로는 감싸는 요소 하나만 더해도 바뀌어 같은 결함이 해결+새로 생김으로 갈린다)
    const k = it.prop === 'font-family' ? `${it.rule}|font|${it.design_value}|${it.font_kind}|${it.font_kind === 'diff' ? it.impl_value : ''}` : `${it.rule}|${it.design && it.design.id ? `d${it.design.id}` : `i${it.dom.path}`}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(it)
  }
  return [...groups.values()].map((items) => {
    const it = items[0]
    const font = it.prop === 'font-family'
    const label = font ? (it.font_kind === 'missing' || it.font_kind === 'blocked' ? `글꼴 ${it.design_value} ${it.font_kind === 'blocked' ? '확인 불가(외부 요청 막힘)' : '없음'} · 글자 ${it.count || 1}개` : `글꼴 ${it.impl_value} · ${(it.dom && it.dom.label) || ''}${it.count > 1 ? ` 등 ${it.count}개` : ''}`) : (it.dom && it.dom.label) || it.design.text || it.design.name || ''
    const fp = font ? `design|${it.rule}|font:${it.design_value}:${it.font_kind}:${it.font_kind === 'diff' ? it.impl_value : ''}` : `design|${it.rule}|${it.design && it.design.id ? `node:${it.design.id}` : it.dom.path}`
    return {
      id: `${screen.replace(/\//g, '-')}-${it.rule}-${sha1(fp).slice(0, 6)}`,
      rule: it.rule, rule_name: RULE_NAME[it.rule], severity: it.font_kind === 'blocked' || it.blocked ? '사람 확인 필요' : SEVERITY[it.rule], kind: 'design',
      screen, side, ref, fps: [fp], labels: [label.slice(0, 40)],
      elements: [{ fp, label: label.slice(0, 40), tag: it.dom ? it.dom.tag : null, cls: it.dom ? it.dom.cls : [], pcls: it.dom ? it.dom.pcls : [], path: it.dom ? it.dom.path : null, representation: it.dom?.representation || null, components: it.dom?.components || [], box: it.dom ? it.dom.box : null, design: it.design }],
      widths: [{ w, h, px: Math.max(...items.map((x) => x.value)), metric: it.metric, canvas_px: Math.max(...items.map((x) => x.value)), items: items.length, scroll_y: 0, step: 0, shot: marked || null, clean: shot || null, text: items.map((x) => x.text).join(' · ') }],
      max_px: Math.max(...items.map((x) => x.value)), only_at: null,
      evidence: items.map((x, k) => ({ id: `M${k + 1}`, metric: x.metric, value: x.value, threshold: x.threshold, text: x.text })),
      design: { node: it.design, values: items.map((x) => ({ prop: x.prop || null, design: x.design_value, impl: x.impl_value, at: x.at || 'base', ...(x.token ? { token: x.token } : {}), ...(x.opacity !== undefined ? { opacity: x.opacity } : {}), ...(x.font_kind ? { font_kind: x.font_kind } : {}) })) },
      diag: [], shots: { crop: null }
    }
  })
}

module.exports = { compareDesign, compareDesignLive, designDefects, flatten, RULE_NAME, SEVERITY, TOL }
