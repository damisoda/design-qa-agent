// dqa 시안 내보내기(Figma 개발용 플러그인). 선택한 프레임을 dqa의 design.json 형식으로 바꿔 UI로 넘긴다.
// UI가 이 컴퓨터의 dqa 서버(127.0.0.1:8792)로 보내거나 파일로 내려받는다. 외부 서버로는 보내지 않는다.
// design.json: frame(이름·크기·채움), tokens(변수 이름 → 색), nodes(프레임 기준 x·y·w·h, 오토 레이아웃, 크기 방식, 채움·테두리·모서리,
// 글자 스타일, 그림 맞춤, 프로토타입 연결). 좌표는 프레임 왼쪽 위 기준이다.
figma.showUI(__html__, { width: 380, height: 510 })

const R = (v, k = 1) => Math.round(v * k) / k
const hex = (c) => '#' + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
const VECTORS = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'POLYGON']
const CONTAINERS = ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION']

function frames () {
  return figma.currentPage.selection.filter((n) => CONTAINERS.includes(n.type) && n.type !== 'GROUP')
}

async function tokenOf (paint, tokens) {
  const id = paint && paint.boundVariables && paint.boundVariables.color && paint.boundVariables.color.id
  if (!id) return null
  try {
    const v = await figma.variables.getVariableByIdAsync(id)
    if (!v) return null
    tokens[v.name] = hex(paint.color)
    return v.name
  } catch (e) { return null }
}

async function solid (paints, tokens) {
  if (!Array.isArray(paints)) return null
  const p = paints.find((f) => f.visible !== false && f.type === 'SOLID')
  if (!p) return null
  return { hex: hex(p.color), opacity: R(p.opacity === undefined ? 1 : p.opacity, 100), token: await tokenOf(p, tokens) }
}

const pick = (node, key, rangeFn) => (node[key] === figma.mixed ? node[rangeFn](0, 1) : node[key])

async function walk (node, fb, tokens) {
  if (node.visible === false) return null
  const bb = node.absoluteBoundingBox
  if (!bb) return null
  const imgFill = Array.isArray(node.fills) && node.fills.find((f) => f.visible !== false && f.type === 'IMAGE')
  const vectorOnly = n => VECTORS.includes(n.type) || ('children' in n && n.children.length > 0 && n.children.every(vectorOnly))
  const compositeArt = !imgFill && ['FRAME','GROUP'].includes(node.type) && node.width >= 64 && node.height >= 64 && vectorOnly(node)
  const type = node.type === 'TEXT' ? 'TEXT' : imgFill || compositeArt ? 'IMAGE' : VECTORS.includes(node.type) ? 'VECTOR' : 'FRAME'
  const d = { id: node.id, name: node.name, type, x: R(bb.x - fb.x), y: R(bb.y - fb.y), w: R(bb.width), h: R(bb.height) }
  if ('layoutMode' in node && node.layoutMode && node.layoutMode !== 'NONE') {
    d.layout = { mode: node.layoutMode, gap: node.itemSpacing, padding: [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft], align: node.counterAxisAlignItems, justify: node.primaryAxisAlignItems, wrap: node.layoutWrap === 'WRAP' }
  }
  if ('layoutSizingHorizontal' in node) { try { d.sizing = { h: node.layoutSizingHorizontal, v: node.layoutSizingVertical } } catch (e) {} }
  // 제약(오토 레이아웃 밖이나 절대 위치일 때만 뜻이 있다): 화면 크기가 바뀔 때 붙는 쪽(MIN 위·왼쪽, MAX 아래·오른쪽, STRETCH 양쪽, CENTER, SCALE)
  const free = node.parent && (!('layoutMode' in node.parent) || node.parent.layoutMode === 'NONE' || node.layoutPositioning === 'ABSOLUTE')
  if (free && node.constraints) d.constraints = { h: node.constraints.horizontal, v: node.constraints.vertical }
  if (node.type !== 'TEXT' && 'fills' in node && node.fills !== figma.mixed) { const f = await solid(node.fills, tokens); if (f) d.fill = f }
  if (imgFill) d.image = { fit: imgFill.scaleMode }
  if ('strokes' in node && Array.isArray(node.strokes) && node.strokes.length) {
    const s = await solid(node.strokes, tokens)
    if (s) d.stroke = { width: node.strokeWeight === figma.mixed ? node.strokeTopWeight : node.strokeWeight, ...s }
  }
  if ('cornerRadius' in node) { const r = node.cornerRadius === figma.mixed ? node.topLeftRadius : node.cornerRadius; if (r) d.radius = r }
  if ('opacity' in node && node.opacity < 1) d.opacity = R(node.opacity, 100)
  if (node.type === 'TEXT') {
    const fontName = pick(node, 'fontName', 'getRangeFontName')
    const fontSize = pick(node, 'fontSize', 'getRangeFontSize')
    const fontWeight = pick(node, 'fontWeight', 'getRangeFontWeight')
    const lh = pick(node, 'lineHeight', 'getRangeLineHeight')
    const ls = pick(node, 'letterSpacing', 'getRangeLetterSpacing')
    const fills = node.fills === figma.mixed ? node.getRangeFills(0, 1) : node.fills
    d.text = {
      content: node.characters, fontFamily: fontName.family, fontStyle: fontName.style, fontSize, fontWeight,
      lineHeight: lh.unit === 'PIXELS' ? R(lh.value, 10) : lh.unit === 'PERCENT' ? R(fontSize * lh.value / 100, 10) : null,
      letterSpacing: ls.unit === 'PIXELS' ? R(ls.value, 100) : R(fontSize * ls.value / 100, 100),
      color: await solid(fills, tokens), align: node.textAlignHorizontal,
      wrap: node.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'NONE' : 'WRAP'
    }
  }
  if ('reactions' in node && node.reactions && node.reactions.length) {
    // 이동할 프레임 이름도 적는다(dqa 눌러 보기 결과에 "시안에서는 '결제 완료'로 이동"처럼 쓴다)
    d.reactions = []
    for (const r of node.reactions) {
      const acts = []
      for (const a of (r.actions || (r.action ? [r.action] : [])).filter(Boolean)) {
        let destName = null
        if (a.destinationId) { try { const t = await figma.getNodeByIdAsync(a.destinationId); destName = t ? t.name : null } catch (e) {} }
        acts.push({ type: a.type, navigation: a.navigation || null, dest: a.destinationId || null, dest_name: destName, url: a.url || null })
      }
      d.reactions.push({ trigger: r.trigger ? r.trigger.type : null, actions: acts })
    }
  }
  if ('children' in node && type === 'FRAME') {
    const kids = []
    for (const c of node.children) { const k = await walk(c, fb, tokens); if (k) kids.push(k) }
    if (kids.length) d.children = kids
  }
  return d
}

function visibleTexts (n) {
  if (!n || n.visible === false) return []
  return [...(n.type === 'TEXT' && n.characters ? [n.characters] : []), ...('children' in n ? n.children.flatMap(visibleTexts) : [])]
}
function destinationIds (nodes) {
  return [...new Set((nodes || []).flatMap((n) => [...(n.reactions || []).filter((r) => !r.trigger || r.trigger === 'ON_CLICK').flatMap((r) => r.actions || []).filter((a) => a.type === 'NODE' && a.dest).map((a) => a.dest), ...destinationIds(n.children)]))]
}
async function exportFrame (frame) {
  const fb = frame.absoluteBoundingBox
  const tokens = {}
  const nodes = []
  for (const c of frame.children) { const k = await walk(c, fb, tokens); if (k) nodes.push(k) }
  const prototype_targets = {}
  for (const id of destinationIds(nodes)) {
    const target = await figma.getNodeByIdAsync(id)
    if (target) prototype_targets[id] = { name: target.name, texts: visibleTexts(target) }
  }
  const png = await frame.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } })
  let fileKey = null; try { fileKey = figma.fileKey || null } catch (e) {}
  const spec = {
    source: 'figma-plugin', file: figma.root.name, page: figma.currentPage.name, page_id: figma.currentPage.id, figma: { file_key: fileKey },
    frame: { id: frame.id, name: frame.name, width: R(fb.width), height: R(fb.height), fill: await solid(frame.fills, tokens) },
    base: `${R(fb.width)}x${R(fb.height)}`, tokens, nodes, prototype_targets, exported_at: new Date().toISOString()
  }
  return { name: frame.name, spec, png: figma.base64Encode(png) }
}

function sendSelection () {
  figma.ui.postMessage({ type: 'selection', frames: frames().map((f) => ({ id: f.id, name: f.name, w: R(f.width), h: R(f.height) })), file: figma.root.name, page: figma.currentPage.name })
}

figma.on('selectionchange', sendSelection)
figma.on('currentpagechange', sendSelection)
sendSelection()

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'selection') sendSelection()
  if (msg.type === 'export') {
    const list = msg.frame_ids ? (await Promise.all(msg.frame_ids.map(id => figma.getNodeByIdAsync(id)))).filter(n => n && CONTAINERS.includes(n.type)) : frames()
    if (!list.length) { figma.ui.postMessage({ type: 'error', request_id: msg.request_id, message: '프레임을 하나 이상 선택하세요' }); return }
    const out = []
    for (const f of list) {
      try { out.push(await exportFrame(f)) } catch (e) { figma.ui.postMessage({ type: 'error', message: `${f.name}: ${e.message}` }) }
    }
    figma.ui.postMessage({ type: 'exported', items: out, target: msg.target, request_id: msg.request_id, session_id: msg.session_id })
  }
  if (msg.type === 'focus') {
    try {
      const node = await figma.getNodeByIdAsync(msg.node_id)
      if (!node || node.type === 'DOCUMENT' || node.type === 'PAGE') throw new Error('이 파일에 검사한 요소가 없습니다')
      let page = node.parent; while (page && page.type !== 'PAGE') page = page.parent
      if (!page) throw new Error('요소의 페이지를 찾지 못했습니다')
      if (figma.currentPage.id !== page.id) await figma.setCurrentPageAsync(page)
      figma.currentPage.selection = [node]
      figma.viewport.scrollAndZoomIntoView([node])
      figma.ui.postMessage({ type: 'focused', request_id: msg.request_id, node_id: node.id, name: node.name, file: figma.root.name })
    } catch (e) { figma.ui.postMessage({ type: 'focus-error', request_id: msg.request_id, message: e.message }) }
  }
  if (msg.type === 'notify') figma.notify(msg.message)
  if (msg.type === 'close') figma.closePlugin()
}
