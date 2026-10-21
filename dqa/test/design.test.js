// 시안 비교 단위 시험: Figma REST 변환, 시안 목록, 값 비교(색·크기 방식·간격), 고칠 값과 수정 요청문
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
process.env.DQA_DESIGNS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-designs-'))
const { parseUrl, toSpec } = require('../design/figma_rest')
const library = require('../design/library')
const { compareDesign } = require('../design/compare')
const { designCss, textEdits, brief } = require('../design/suggest')
const { cssRuleEdits } = require('../fix/fix')

// Figma REST /v1/files/:key/nodes 응답의 document 모양(필요한 필드만)
const solid = (r, g, b, opacity) => ({ type: 'SOLID', visible: true, color: { r, g, b, a: 1 }, ...(opacity !== undefined ? { opacity } : {}) })
const restDoc = {
  id: '1:1', name: '설정', type: 'FRAME', absoluteBoundingBox: { x: 100, y: 100, width: 375, height: 812 }, fills: [solid(1, 1, 1)],
  children: [
    { id: '1:2', name: 'Status Bar', type: 'FRAME', absoluteBoundingBox: { x: 100, y: 100, width: 375, height: 44 }, fills: [] },
    { id: '1:3', name: '제목', type: 'TEXT', absoluteBoundingBox: { x: 120, y: 160, width: 335, height: 30 }, characters: '알림 설정', styles: { fill: 'S:1' }, style: { fontFamily: 'Pretendard', fontWeight: 700, fontSize: 22, lineHeightPx: 30.8, letterSpacing: -0.22, textAlignHorizontal: 'LEFT', textAutoResize: 'HEIGHT' }, fills: [solid(0.067, 0.094, 0.153)], layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'HUG' },
    { id: '1:4', name: 'Button', type: 'INSTANCE', absoluteBoundingBox: { x: 120, y: 700, width: 335, height: 52 }, layoutMode: 'HORIZONTAL', itemSpacing: 8, paddingTop: 14, paddingRight: 16, paddingBottom: 14, paddingLeft: 16, primaryAxisAlignItems: 'CENTER', counterAxisAlignItems: 'CENTER', layoutSizingHorizontal: 'FILL', layoutSizingVertical: 'FIXED', fills: [solid(0.184, 0.357, 0.827)], styles: { fill: 'S:2' }, cornerRadius: 12, interactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: '2:1', navigation: 'NAVIGATE' }] }],
      children: [{ id: '1:5', name: '저장', type: 'TEXT', absoluteBoundingBox: { x: 270, y: 714, width: 34, height: 24 }, characters: '저장', style: { fontFamily: 'Pretendard', fontWeight: 700, fontSize: 16, lineHeightPx: 24, letterSpacing: 0, textAutoResize: 'WIDTH_AND_HEIGHT' }, fills: [solid(1, 1, 1)] }] },
    { id: '1:6', name: 'hidden', type: 'RECTANGLE', visible: false, absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 } }
  ]
}

test('Figma 링크: 파일 키와 노드 ID(12-34 → 12:34)', () => {
  assert.deepStrictEqual(parseUrl('https://www.figma.com/design/AbC123xyz/App?node-id=12-34&t=x'), { key: 'AbC123xyz', id: '12:34' })
  assert.deepStrictEqual(parseUrl('https://www.figma.com/file/K9/x'), { key: 'K9', id: null })
  assert.throws(() => parseUrl('https://example.com/a'))
})

test('Figma REST 변환: 프레임 기준 좌표, 크기 방식, 스타일 이름 토큰, 프로토타입 연결, 숨긴 노드 제외', () => {
  const spec = toSpec(restDoc, { fileName: '앱', styles: { 'S:1': { name: 'text/primary' }, 'S:2': { name: 'color/brand' } } })
  assert.strictEqual(spec.base, '375x812')
  assert.strictEqual(spec.nodes.length, 3)
  const [, title, btn] = spec.nodes
  assert.deepStrictEqual([title.x, title.y, title.w], [20, 60, 335])
  assert.strictEqual(title.text.color.token, 'text/primary')
  assert.strictEqual(title.text.lineHeight, 30.8)
  assert.deepStrictEqual(btn.sizing, { h: 'FILL', v: 'FIXED' })
  assert.strictEqual(btn.fill.hex, '#2F5BD3'); assert.strictEqual(btn.fill.token, 'color/brand')
  assert.strictEqual(spec.tokens['color/brand'], '#2F5BD3')
  assert.strictEqual(btn.reactions[0].actions[0].dest, '2:1')
  assert.strictEqual(btn.children[0].text.wrap, 'NONE')
})

test('시안 목록: 저장 → 목록 → 이름으로 찾기', () => {
  const spec = toSpec(restDoc, {})
  const s = library.save({ name: '설정', spec, pngB64: Buffer.from('png').toString('base64'), group: 'v1', source: 'test' })
  assert.strictEqual(s.name, 'v1-설정')
  const l = library.list(); assert.strictEqual(l.length, 1); assert.strictEqual(l[0].png, true)
  assert.ok(library.find('v1-설정').endsWith('design.json'))
  assert.strictEqual(library.find('없는 시안'), null)
  assert.throws(() => library.save({ name: 'x', spec: {} }))
})

// 비교 시험용 DOM 추출 결과 만들기
const T = (i, text, box, style, extra = {}) => ({ i, tag: 'p', cls: [], pcls: [], label: text, path: `p${i}`, anc: extra.anc || [0], full: text, own: text, mixed: false, box, line: box, style: { fontSize: 16, fontWeight: 400, lineHeight: 24, letterSpacing: 0, color: '#111111', ...style }, display: extra.display || 'block' })
const B = (l, t, w, h) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h })

test('색 비교: 반투명 채움은 뒤 배경과 합성된 실제 색으로 비교한다', () => {
  const spec = { base: '375x812', frame: { width: 375, height: 812, fill: { hex: '#C9D8E6' } }, nodes: [
    { id: 'p', name: 'pill', type: 'FRAME', x: 100, y: 60, w: 140, h: 24, fill: { hex: '#000000', opacity: 0.18 }, radius: 12, children: [
      { id: 't', name: '날짜', type: 'TEXT', x: 110, y: 62, w: 120, h: 20, text: { content: '10월 10일', fontSize: 12, fontWeight: 400, color: { hex: '#FFFFFF' } } }] }] }
  // 구현 상자의 채움은 섞인 색(#C9D8E6 위 검정 18% ≈ #A5B1BD)
  const dom = { texts: [T(2, '10월 10일', B(110, 62, 120, 20), { fontSize: 12, color: '#FFFFFF', lineHeight: null }, { anc: [1, 0] })], boxes: [{ i: 1, tag: 'div', cls: ['pill'], pcls: [], label: '10월 10일', path: 'div1', anc: [0], box: B(100, 60, 140, 24), fill: '#A5B1BD', raw: { hex: '#000000', a: 0.18 }, gradient: false, border: null, radius: 12 }] }
  const r = compareDesign(spec, dom, null)
  assert.deepStrictEqual(r.issues.filter((x) => x.rule === 'D2'), [])
  // 불투명도가 다르면 잡는다(시안 18%, 구현 60%)
  dom.boxes[0].raw = { hex: '#000000', a: 0.6 }; dom.boxes[0].fill = '#50565C'
  assert.strictEqual(compareDesign(spec, dom, null).issues.filter((x) => x.rule === 'D2').length, 1)
})

test('글꼴: 시안 글꼴이 목록에 없거나 브라우저에 없으면 화면에서 한 번만 보고한다', () => {
  const spec = { base: '375x812', frame: { width: 375, height: 812 }, nodes: [
    { id: 'a', name: '제목', type: 'TEXT', x: 20, y: 60, w: 200, h: 30, text: { content: '제목', fontFamily: 'Pretendard', fontSize: 16 } },
    { id: 'b', name: '본문', type: 'TEXT', x: 20, y: 100, w: 200, h: 30, text: { content: '본문', fontFamily: 'Pretendard', fontSize: 16 } }] }
  const st = { fontFamily: 'Pretendard', fontStack: '"Pretendard", sans-serif', fontAvail: false }
  const dom = { texts: [T(1, '제목', B(20, 60, 200, 30), st), T(2, '본문', B(20, 100, 200, 30), st)], boxes: [] }
  const f = compareDesign(spec, dom, null).issues.filter((x) => x.prop === 'font-family')
  assert.strictEqual(f.length, 1); assert.strictEqual(f[0].metric, 'font_missing'); assert.strictEqual(f[0].count, 2)
  dom.texts.forEach((t) => { t.style = { ...t.style, fontFamily: 'Apple SD Gothic Neo', fontStack: '"Apple SD Gothic Neo", sans-serif', fontAvail: true } })
  assert.deepStrictEqual(compareDesign(spec, dom, null).issues.filter((x) => x.prop === 'font-family').map((x) => x.metric), ['font-family_diff'])
  dom.texts.forEach((t) => { t.style = { ...t.style, fontFamily: 'Pretendard', fontStack: 'Pretendard, sans-serif', fontAvail: true } })
  assert.deepStrictEqual(compareDesign(spec, dom, null).issues.filter((x) => x.prop === 'font-family'), [])
})

test('그림 노드는 그림 요소와만 짝짓는다(겹친 하단 바와 짝짓지 않음)', () => {
  const spec = { base: '375x812', frame: { width: 375, height: 812 }, nodes: [
    { id: 'img', name: 'mapimg', type: 'IMAGE', x: 20, y: 677, w: 335, h: 168, radius: 12 },
    { id: 'bar', name: 'cta', type: 'FRAME', x: 0, y: 739, w: 375, h: 73, fill: { hex: '#FFFFFF' } }] }
  const dom = { texts: [], boxes: [{ i: 5, tag: 'div', cls: ['cta'], pcls: [], label: '', path: 'div5', anc: [0], box: B(0, 739, 375, 73), fill: '#FFFFFF', raw: { hex: '#FFFFFF', a: 1 }, gradient: false, border: null, radius: 0 }],
    imgs: [{ i: 4, tag: 'img', cls: ['mapimg'], pcls: [], label: '지도', path: 'img4', anc: [0], box: B(20, 677, 335, 168), radius: 12 }] }
  const r = compareDesign(spec, dom, null)
  assert.deepStrictEqual(r.issues.map((x) => `${x.rule} ${x.design.name}`), [])
})

test('크기 방식: 인라인 글자는 Fill 판정을 하지 않고, 넓힌 화면에서 늘지 않는 Fill 버튼은 잡는다', () => {
  const spec = { base: '375x812', frame: { width: 375, height: 812 }, nodes: [
    { id: 'c', name: 'col', type: 'FRAME', x: 0, y: 0, w: 375, h: 812, children: [
      { id: 'tag', name: 'tag', type: 'TEXT', x: 16, y: 100, w: 343, h: 40, sizing: { h: 'FILL' }, text: { content: '#아주긴해시태그 #노을', fontSize: 16 } },
      { id: 'btn', name: '다음', type: 'TEXT', x: 20, y: 700, w: 335, h: 52, sizing: { h: 'FILL' }, text: { content: '다음', fontSize: 16 } }] }] }
  const dom = { widths: { 0: 375, 3: 343, 4: 240 }, texts: [T(3, '#아주긴해시태그 #노을', B(16, 100, 343, 40), {}, { display: 'inline' }), T(4, '다음', B(67, 700, 240, 52), {})], boxes: [] }
  const alt = { widths: { 0: 430, 3: 330, 4: 240 } }
  const r = compareDesign(spec, dom, alt)
  const f1 = r.issues.filter((x) => x.rule === 'F1')
  assert.deepStrictEqual(f1.map((x) => [x.design.name, x.metric]), [['다음', 'fill_not_growing']])
})

test('간격: 한 묶음이 통째로 밀리면 바깥 요소 하나만 보고한다', () => {
  const spec = { base: '375x812', frame: { width: 375, height: 812 }, nodes: [
    { id: 'm', name: 'msg', type: 'TEXT', x: 16, y: 600, w: 200, h: 40, text: { content: '안녕하세요', fontSize: 16 } },
    { id: 'bar', name: 'composer', type: 'FRAME', x: 0, y: 652, w: 375, h: 60, fill: { hex: '#FFFFFF' }, children: [
      { id: 'a', name: '첨부', type: 'TEXT', x: 12, y: 664, w: 36, h: 36, text: { content: '첨부', fontSize: 14 } },
      { id: 'i', name: '입력', type: 'TEXT', x: 60, y: 664, w: 250, h: 36, text: { content: '메시지 입력', fontSize: 14 } }] }] }
  const dy = 40
  const dom = { texts: [T(1, '안녕하세요', B(16, 600, 200, 40), {}), T(3, '첨부', B(12, 664 + dy, 36, 36), { fontSize: 14 }, { anc: [2, 0] }), T(4, '메시지 입력', B(60, 664 + dy, 250, 36), { fontSize: 14 }, { anc: [2, 0] })],
    boxes: [{ i: 2, tag: 'div', cls: ['composer'], pcls: [], label: '첨부 메시지 입력', path: 'div2', anc: [0], box: B(0, 652 + dy, 375, 60), fill: '#FFFFFF', gradient: false, border: null, radius: 0 }] }
  const r = compareDesign(spec, dom, null)
  const l2 = r.issues.filter((x) => x.rule === 'L2')
  assert.deepStrictEqual(l2.map((x) => x.design.name), ['composer'])
})

test('고칠 값: 색은 같은 이름의 CSS 변수, Fill은 두 후보, 글자 스타일은 한 줄로', () => {
  const vars = new Set(['--brand', '--text'])
  const d2 = { kind: 'design', rule: 'D2', design: { node: { name: 'cta', box: { w: 335, h: 52 } }, values: [{ prop: 'background-color', design: '#2F5BD3', impl: '#3366FF', token: 'color/brand' }] } }
  assert.deepStrictEqual(designCss(d2, vars).map(([x]) => x), ['background-color:var(--brand)'])
  const f1 = { kind: 'design', rule: 'F1', design: { node: { box: { w: 335 } }, values: [{ prop: 'width', design: 'FILL', impl: 'FIXED' }] } }
  assert.strictEqual(designCss(f1, vars).length, 2)
  const d3 = { kind: 'design', rule: 'D3', design: { node: {}, values: [{ prop: 'font-size', design: '16px', impl: '14px' }, { prop: 'font-weight', design: 700, impl: 400 }] } }
  assert.deepStrictEqual(designCss(d3, vars).map(([x]) => x), ['font-size:16px;font-weight:700'])
  assert.deepStrictEqual(designCss({ kind: 'design', rule: 'L2', design: { values: [{ prop: 'margin-top', design: 8, impl: 16 }] } }, vars), [])
})

test('고칠 값: 시안 결함도 결함 요소의 CSS 규칙 끝에 넣는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-dz-'))
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><style>:root{--brand:#2F5BD3}\n.cta{height:52px;background:#3366ff}</style><button class="cta">저장</button>')
  const d = { kind: 'design', rule: 'D2', elements: [{ cls: ['cta'], tag: 'button' }], design: { node: { box: { w: 335 } }, values: [{ prop: 'background-color', design: '#2F5BD3', impl: '#3366FF', token: 'color/brand' }] } }
  const e = cssRuleEdits(d, dir)
  assert.strictEqual(e.length, 1)
  assert.strictEqual(e[0].replace.trim(), '.cta{height:52px;background:var(--brand)}')
})

test('문구 다름: 소스에서 한 번만 나오는 문구만 바꾼다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-t1-'))
  fs.mkdirSync(path.join(dir, 'src'))
  fs.writeFileSync(path.join(dir, 'src', 'App.jsx'), 'export default () => (\n  <button>다음으로</button>\n)\n')
  const d = { kind: 'design', rule: 'T1', design: { values: [{ design: '다음', impl: '다음으로' }] } }
  const e = textEdits(d, dir)
  assert.strictEqual(e.length, 1); assert.strictEqual(e[0].file, path.join('src', 'App.jsx')); assert.strictEqual(e[0].line, 2)
  assert.strictEqual(e[0].replace, '  <button>다음</button>')
  fs.writeFileSync(path.join(dir, 'src', 'B.jsx'), '<p>다음으로</p>')
  assert.deepStrictEqual(textEdits(d, dir), [])
})

test('수정 요청문: 요소·시안 값·제안 CSS·원인 파일', () => {
  const d = { kind: 'design', rule: 'D2', rule_name: '색 다름', screen: 'local/home', labels: ['저장'], elements: [{ cls: ['cta'], tag: 'button', path: 'main>button' }], widths: [{ w: 375, h: 812 }], design: { node: { name: 'Button', id: '1:4', box: { w: 335, h: 52 } }, values: [{ prop: 'background-color', design: '#2F5BD3', impl: '#3366FF', token: 'color/brand' }] }, causes: { candidates: [{ file: 'src/App.css', line: 12, why: ['클래스 cta'] }] } }
  const t = brief(d, { title: '설정', vars: new Set(['--brand']) })
  assert.match(t, /시안 #2F5BD3 \/ 구현 #3366FF/)
  assert.match(t, /\.cta \{ background-color:var\(--brand\) \}/)
  assert.match(t, /src\/App\.css:12/)
})

test('Tailwind 요소는 CSS 규칙 대신 바꿀 클래스를 제안한다', () => {
  const { twSuggest } = require('../design/suggest')
  const d = { kind: 'design', rule: 'D2', elements: [{ cls: ['flex-1', 'h-12', 'rounded-xl', 'bg-blue-500', 'text-white', 'text-sm'], tag: 'button' }], design: { node: { box: { w: 335 } }, values: [{ prop: 'background-color', design: '#3D5AFE', token: 'color/brand' }, { prop: 'font-size', design: '16px' }, { prop: 'color', design: '#FFFFFF' }] } }
  assert.deepStrictEqual(twSuggest(d), ['bg-blue-500 → bg-[#3D5AFE] (color/brand)', 'text-sm → text-[16px]', 'text-white → text-[#FFFFFF]'])
  assert.strictEqual(twSuggest({ ...d, elements: [{ cls: ['cta'] }] }), null)
})

test('G1(시안): 시안의 벡터 아이콘 자리에 흔한 기호 글자(‹)가 있으면 잡고, 아이콘이 없는 자리의 ×는 두지 않는다', () => {
  const spec = { base: '375x812', frame: { width: 375, height: 812 }, nodes: [
    { id: 'back', name: 'Back Arrow Icon', type: 'FRAME', x: 12, y: 56, w: 24, h: 24, children: [{ id: 'arrow', name: 'Arrow', type: 'VECTOR', x: 19, y: 59, w: 10, h: 18 }] },
    { id: 'title', name: '제목', type: 'TEXT', x: 136, y: 57, w: 102, h: 22, text: { content: '긴급 신고', fontSize: 18 } }] }
  const st = { fontFamily: 'Arial', fontStack: 'Arial', fontAvail: true, fontSize: 18, fontWeight: 400, color: '#000000' }
  const dom = { texts: [T(1, '‹', B(16, 54, 14, 28), { ...st, fontSize: 36 }), T(2, '긴급 신고', B(136, 57, 102, 22), st), T(3, '×', B(330, 700, 20, 20), st)], boxes: [] }
  const g = compareDesign(spec, dom, null).issues.filter((x) => x.rule === 'G1')
  assert.deepStrictEqual(g.map((x) => [x.dom.label, x.impl_value]), [['‹', "글자 '‹'"]])
})


test('Figma 목적지 내보내기: 숨긴 글자는 빼고 연결 프레임의 글자를 보존', () => {
  const { destinationIds } = require('../design/figma_rest')
  const target = { name: '저장 완료', children: [{ type: 'TEXT', characters: '저장되었습니다' }, { type: 'TEXT', characters: '숨긴 값', visible: false }] }
  const spec = toSpec(restDoc, { targets: { '2:1': target } })
  assert.deepEqual(spec.prototype_targets['2:1'], { name: '저장 완료', texts: ['저장되었습니다'] })
  assert.deepEqual(destinationIds(spec.nodes), ['2:1'])
})


test('Fill: max-width 부모 안의 잘못된 고정 폭을 잡고 정상 폭·부모 변화·가로 분배는 제외', () => {
  const spec = { base: '375x812', frame: { width: 375, height: 812 }, nodes: [
    { id: 'btn', name: '다음', type: 'TEXT', x: 20, y: 100, w: 335, h: 48, sizing: { h: 'FILL' }, text: { content: '다음' } }
  ] }
  const dom = { widths: { 0: 375, 1: 220 }, texts: [T(1, '다음', B(20, 100, 220, 48), {})], boxes: [] }
  const alt = { widths: { 0: 375, 1: 220 } }
  assert.deepEqual(compareDesign(spec, dom, alt).issues.filter(x => x.rule === 'F1').map(x => [x.metric, x.value]), [['fill_width_diff', 115]])
  dom.widths[1] = alt.widths[1] = 335; dom.texts[0].box = dom.texts[0].line = B(20, 100, 335, 48)
  assert.equal(compareDesign(spec, dom, alt).issues.filter(x => x.rule === 'F1').length, 0)
  dom.widths[0] = alt.widths[0] = 260; dom.widths[1] = alt.widths[1] = 220
  assert.equal(compareDesign(spec, dom, alt).issues.filter(x => x.rule === 'F1').length, 0)
  const row = { ...spec, nodes: [{ id: 'row', name: 'row', type: 'FRAME', x: 0, y: 100, w: 375, h: 48, layout: { mode: 'HORIZONTAL', gap: 12 }, children: spec.nodes }] }
  dom.widths[0] = alt.widths[0] = 375
  assert.equal(compareDesign(row, dom, alt).issues.filter(x => x.rule === 'F1').length, 0)
})


test('간격 수정: 자식 margin이 없으면 관측 간격과 같은 부모 gap만 시안 값으로 제안', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-parent-gap-'))
  try {
    fs.writeFileSync(path.join(dir, 'style.css'), '.metrics{gap:32px!important}')
    const d = { kind: 'design', rule: 'L2', diag: [], elements: [{ tag: 'div', cls: ['projects'], pcls: ['metrics'] }], design: { values: [{ prop: 'margin-left', design: 12, impl: 32 }] } }
    const edits = cssRuleEdits(d, dir)
    assert.equal(edits.length, 1); assert.equal(edits[0].decl, 'gap:12px')
    fs.writeFileSync(path.join(dir, 'style.css'), '.metrics{gap:12px}')
    assert.deepEqual(cssRuleEdits(d, dir), []) // 실제 간격 차이가 다른 원인일 때 부모 gap을 바꾸지 않는다.
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('mixed label uses its own text range; input gap changes remain detectable', () => {
 const spec={frame:{width:375,height:812},nodes:[{id:'label',type:'TEXT',name:'Label',x:20,y:20,w:335,h:20,text:{content:'Full name',fontSize:14}},{id:'input',type:'FRAME',name:'Input',x:20,y:48,w:335,h:48,fill:{hex:'#FFFFFF'}}]}
 const make=(gap)=>({texts:[{...T(1,'Full name',B(20,20,335,68+gap),{fontSize:14}),mixed:true,own:'Full name',line:B(20,20,62,20)}],boxes:[{i:2,tag:'input',cls:[],anc:[1],label:'Name',box:B(20,40+gap,335,48),fill:'#FFFFFF',radius:0}]})
 assert.equal(compareDesign(spec,make(8),null).issues.filter(x=>x.rule==='L2').length,0)
 assert.ok(compareDesign(spec,make(24),null).issues.some(x=>x.rule==='L2'&&x.impl_value===24))
})

test('grouped CSS selectors only widen the measured control hit area', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dqa-grouped-'))
 try{fs.writeFileSync(path.join(dir,'style.css'),'.nav,.counter{font-weight:600}')
 const edits=cssRuleEdits({rule:'A1',elements:[{tag:'button',cls:['counter']}]},dir)
 assert.equal(edits[0].replace,'.nav,.counter{font-weight:600}\n.counter{min-width:44px;min-height:44px}')
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
