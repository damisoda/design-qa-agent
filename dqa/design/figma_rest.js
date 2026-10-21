// Figma REST로 시안 가져오기: 프레임 링크 → design.json(플러그인 내보내기와 같은 모양) + design.png → 시안 목록.
// 토큰은 환경 변수 FIGMA_TOKEN에서만 읽는다(파일·로그·실행 기록에 남기지 않는다). 받는 곳은 api.figma.com과 그림 주소뿐이다.
// 변수(토큰) 이름은 Enterprise 요금제의 변수 API가 필요해, 대신 채움·글자 스타일 이름을 토큰 이름으로 쓴다.
const R = (v, k = 1) => Math.round(v * k) / k
const hex = (c) => '#' + [c.r, c.g, c.b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
const VECTORS = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'REGULAR_POLYGON']

// https://www.figma.com/design/<key>/<이름>?node-id=12-34 → { key, id: '12:34' }
function parseUrl (u) {
  const m = String(u || '').match(/figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]+)/)
  if (!m) throw new Error('Figma 프레임 링크가 아니다(figma.com/design/<파일>/…?node-id=…)')
  const q = String(u).match(/[?&]node-id=([0-9]+[-:][0-9]+)/)
  return { key: m[1], id: q ? q[1].replace('-', ':') : null }
}

function solid (paints, tokens, styleName) {
  if (!Array.isArray(paints)) return null
  const p = paints.find((f) => f.visible !== false && f.type === 'SOLID')
  if (!p) return null
  const out = { hex: hex(p.color), opacity: R((p.opacity === undefined ? 1 : p.opacity) * (p.color.a === undefined ? 1 : p.color.a), 100), token: styleName || null }
  if (styleName) tokens[styleName] = out.hex
  return out
}

// REST 문서 노드 → design.json 노드(프레임 왼쪽 위 기준 좌표)
const CONS = { LEFT: 'MIN', TOP: 'MIN', RIGHT: 'MAX', BOTTOM: 'MAX', LEFT_RIGHT: 'STRETCH', TOP_BOTTOM: 'STRETCH', CENTER: 'CENTER', SCALE: 'SCALE' }
function toNode (n, fb, tokens, styles, freeParent = true) {
  if (n.visible === false || !n.absoluteBoundingBox) return null
  const bb = n.absoluteBoundingBox
  const imgFill = Array.isArray(n.fills) && n.fills.find((f) => f.visible !== false && f.type === 'IMAGE')
  const type = n.type === 'TEXT' ? 'TEXT' : imgFill ? 'IMAGE' : VECTORS.includes(n.type) ? 'VECTOR' : 'FRAME'
  const styleName = (k) => (n.styles && n.styles[k] && styles[n.styles[k]] ? styles[n.styles[k]].name : null)
  const d = { id: n.id, name: n.name, type, x: R(bb.x - fb.x), y: R(bb.y - fb.y), w: R(bb.width), h: R(bb.height) }
  if (n.layoutMode && n.layoutMode !== 'NONE') d.layout = { mode: n.layoutMode, gap: n.itemSpacing || 0, padding: [n.paddingTop || 0, n.paddingRight || 0, n.paddingBottom || 0, n.paddingLeft || 0], align: n.counterAxisAlignItems || 'MIN', justify: n.primaryAxisAlignItems || 'MIN', wrap: n.layoutWrap === 'WRAP' }
  if (n.layoutSizingHorizontal) d.sizing = { h: n.layoutSizingHorizontal, v: n.layoutSizingVertical }
  // 제약은 오토 레이아웃 밖(부모가 NONE)이거나 절대 위치일 때만 쓴다. REST 이름을 플러그인 이름으로 맞춘다
  if (n.constraints && (freeParent || n.layoutPositioning === 'ABSOLUTE')) d.constraints = { h: CONS[n.constraints.horizontal] || n.constraints.horizontal, v: CONS[n.constraints.vertical] || n.constraints.vertical }
  if (type !== 'TEXT') { const f = solid(n.fills, tokens, styleName('fill')); if (f) d.fill = f }
  if (imgFill) d.image = { fit: imgFill.scaleMode }
  if (Array.isArray(n.strokes) && n.strokes.length) { const s = solid(n.strokes, tokens, styleName('stroke')); if (s) d.stroke = { width: n.strokeWeight || (n.individualStrokeWeights ? n.individualStrokeWeights.top : 1), ...s } }
  const rad = n.cornerRadius || (n.rectangleCornerRadii ? n.rectangleCornerRadii[0] : 0); if (rad) d.radius = rad
  if (n.opacity !== undefined && n.opacity < 1) d.opacity = R(n.opacity, 100)
  if (n.type === 'TEXT') {
    const st = n.style || {}
    d.text = {
      content: n.characters, fontFamily: st.fontFamily, fontStyle: st.fontPostScriptName || null, fontSize: st.fontSize, fontWeight: st.fontWeight,
      lineHeight: st.lineHeightPx ? R(st.lineHeightPx, 10) : null, letterSpacing: st.letterSpacing !== undefined ? R(st.letterSpacing, 100) : 0,
      color: solid(n.fills, tokens, styleName('fill') || styleName('text')), align: st.textAlignHorizontal, wrap: st.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'NONE' : 'WRAP'
    }
  }
  const inter = n.interactions || []
  if (inter.length) d.reactions = inter.map((r) => ({ trigger: r.trigger ? r.trigger.type : null, actions: (r.actions || []).filter(Boolean).map((a) => ({ type: a.type, navigation: a.navigation || null, dest: a.destinationId || null, url: a.url || null })) }))
  else if (n.transitionNodeID) d.reactions = [{ trigger: 'ON_CLICK', actions: [{ type: 'NODE', navigation: 'NAVIGATE', dest: n.transitionNodeID, url: null }] }]
  if (type === 'FRAME' && Array.isArray(n.children)) { const kids = n.children.map((c) => toNode(c, fb, tokens, styles, !n.layoutMode || n.layoutMode === 'NONE')).filter(Boolean); if (kids.length) d.children = kids }
  return d
}

function toSpec (doc, { fileName, styles, url, targets = {} }) {
  const fb = doc.absoluteBoundingBox
  const tokens = {}
  const nodes = (doc.children || []).map((c) => toNode(c, fb, tokens, styles || {}, !doc.layoutMode || doc.layoutMode === 'NONE')).filter(Boolean)
  return {
    source: 'figma-rest', file: fileName || null, url: url || null,
    frame: { id: doc.id, name: doc.name, width: R(fb.width), height: R(fb.height), fill: solid(doc.fills, tokens, null) },
    base: `${R(fb.width)}x${R(fb.height)}`, tokens, nodes, prototype_targets: Object.fromEntries(Object.entries(targets).map(([id, n]) => [id, { name: n.name, texts: visibleTexts(n) }])), exported_at: new Date().toISOString()
  }
}

function visibleTexts (n) {
  if (!n || n.visible === false) return []
  return [...(n.type === 'TEXT' && n.characters ? [n.characters] : []), ...(n.children || []).flatMap(visibleTexts)]
}
function destinationIds (nodes) {
  return [...new Set((nodes || []).flatMap((n) => [...(n.reactions || []).filter((r) => !r.trigger || r.trigger === 'ON_CLICK').flatMap((r) => r.actions || []).filter((a) => a.type === 'NODE' && a.dest).map((a) => a.dest), ...destinationIds(n.children)]))]
}
async function getJson (u, token) {
  const r = await fetch(u, { headers: { 'X-Figma-Token': token } })
  if (r.status === 403) throw new Error('Figma가 거부했다(403). 토큰 권한이나 파일 접근 권한을 확인한다')
  if (r.status === 404) throw new Error('Figma에서 파일이나 노드를 찾지 못했다(404)')
  if (r.status === 429) throw new Error('Figma 요청 한도에 걸렸다(429). 잠시 뒤 다시 한다')
  if (!r.ok) throw new Error(`Figma 응답 ${r.status}`)
  return r.json()
}

// 링크 하나를 받아 시안 목록에 넣는다
async function pull ({ url, name, group, scale = 2 }) {
  const token = process.env.FIGMA_TOKEN
  if (!token) throw new Error('환경 변수 FIGMA_TOKEN이 없다. Figma 설정 → 보안 → 개인 액세스 토큰(파일 읽기 권한)을 만들어 이 셸에서만 export FIGMA_TOKEN=… 로 둔다(파일에 적지 않는다)')
  const { key, id } = parseUrl(url)
  if (!id) throw new Error('링크에 node-id가 없다. Figma에서 프레임을 고르고 "링크 복사"한 주소를 쓴다')
  const j = await getJson(`https://api.figma.com/v1/files/${key}/nodes?ids=${encodeURIComponent(id)}`, token)
  const nd = j.nodes && j.nodes[id]
  if (!nd || !nd.document) throw new Error('응답에 노드가 없다')
  if (!['FRAME', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(nd.document.type)) throw new Error(`프레임이 아니다(${nd.document.type}). 화면 프레임 링크를 쓴다`)
  const spec = toSpec(nd.document, { fileName: j.name, styles: nd.styles, url: `https://www.figma.com/design/${key}/?node-id=${id.replace(':', '-')}` })
  const dests = destinationIds(spec.nodes)
  for (let offset = 0; offset < dests.length; offset += 50) {
    const targets = await getJson(`https://api.figma.com/v1/files/${key}/nodes?ids=${encodeURIComponent(dests.slice(offset, offset + 50).join(','))}`, token)
    for (const [tid, v] of Object.entries(targets.nodes || {})) if (v && v.document) spec.prototype_targets[tid] = { name: v.document.name, texts: visibleTexts(v.document) }
  }
  const im = await getJson(`https://api.figma.com/v1/images/${key}?ids=${encodeURIComponent(id)}&format=png&scale=${scale}`, token)
  let pngB64 = null
  const src = im.images && im.images[id]
  if (src && /^https:\/\/[\w.-]+\.(amazonaws\.com|figma\.com)\//.test(src)) { const r = await fetch(src); if (r.ok) pngB64 = Buffer.from(await r.arrayBuffer()).toString('base64') }
  const saved = require('./library').save({ name: name || spec.frame.name, spec, pngB64, group, source: 'figma-rest' })
  return { ...saved, png: !!pngB64, nodes: JSON.stringify(spec.nodes).split('"id"').length - 1, tokens: Object.keys(spec.tokens).length }
}

module.exports = { parseUrl, toSpec, toNode, pull, visibleTexts, destinationIds }
