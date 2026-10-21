const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const os = require('os')

test('Figma 플러그인 내보내기: 목적지 프레임의 보이는 글자까지 포함', async () => {
  const target = { type: 'FRAME', name: '완료', children: [{ type: 'TEXT', characters: '저장 완료' }, { type: 'TEXT', characters: '숨김', visible: false }] }
  const source = { type: 'FRAME', id: 'button', name: '다음', visible: true, absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 48 }, fills: [], reactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: 'right', navigation: 'NAVIGATE' }] }], children: [] }
  const frame = { type: 'FRAME', id: 'home', name: '시작', width: 375, height: 812, absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 812 }, fills: [], children: [source], exportAsync: async () => new Uint8Array([1]) }
  const figma = { mixed: Symbol('mixed'), showUI: () => {}, currentPage: { name: '페이지', selection: [frame] }, root: { name: '파일' }, on: () => {}, ui: { postMessage: () => {} }, getNodeByIdAsync: async (id) => id === 'right' ? target : null, base64Encode: () => 'AA==' }
  const context = vm.createContext({ figma, __html__: '' })
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../figma-plugin/code.js'), 'utf8'), context)
  const out = JSON.parse(JSON.stringify(await context.exportFrame(frame)))
  assert.deepEqual(out.spec.prototype_targets.right, { name: '완료', texts: ['저장 완료'] })
  assert.equal(out.spec.nodes[0].reactions[0].actions[0].dest_name, '완료')
})

test('Figma REST 가져오기: 연결 목적지 노드도 받아 시안 라이브러리에 보존', async (t) => {
  const prevFetch = global.fetch; const prevToken = process.env.FIGMA_TOKEN; const prevDir = process.env.DQA_DESIGNS_DIR
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-rest-'))
  process.env.FIGMA_TOKEN = 'fixture-token'; process.env.DQA_DESIGNS_DIR = dir
  t.after(() => { global.fetch = prevFetch; if (prevToken === undefined) delete process.env.FIGMA_TOKEN; else process.env.FIGMA_TOKEN = prevToken; if (prevDir === undefined) delete process.env.DQA_DESIGNS_DIR; else process.env.DQA_DESIGNS_DIR = prevDir; fs.rmSync(dir, { recursive: true, force: true }) })
  const calls = []
  global.fetch = async (url) => {
    calls.push(String(url)); const u = new URL(url); const ids = u.searchParams.get('ids')
    const document = { id: 'home', type: 'FRAME', name: '시작', absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 812 }, children: [{ id: 'button', name: '다음', type: 'FRAME', absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 48 }, interactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: 'right', navigation: 'NAVIGATE' }] }] }] }
    return { ok: true, json: async () => u.pathname.includes('/images/') ? { images: {} } : ids === '1:1' ? { name: '테스트', nodes: { '1:1': { document } } } : { nodes: { right: { document: { name: '완료', children: [{ type: 'TEXT', characters: '저장 완료' }] } } } } }
  }
  const { pull } = require('../design/figma_rest')
  const out = await pull({ url: 'https://www.figma.com/design/AbC123?node-id=1-1' })
  const spec = JSON.parse(fs.readFileSync(path.join(dir, out.name, 'design.json')))
  assert.deepEqual(spec.prototype_targets.right, { name: '완료', texts: ['저장 완료'] })
  assert.equal(calls.length, 3); assert.ok(calls.some((u) => new URL(u).searchParams.get('ids') === 'right'))
})


test('composite vector artwork exports as one image instead of matching vector fills to surrounding cards', async () => {
 const v={type:'VECTOR',id:'vector',name:'part',visible:true,absoluteBoundingBox:{x:0,y:0,width:100,height:100},fills:[]}
 const art={type:'FRAME',id:'art',name:'Artwork',width:120,height:120,visible:true,absoluteBoundingBox:{x:0,y:0,width:120,height:120},fills:[],cornerRadius:10,children:[v]}
 const frame={type:'FRAME',id:'f',name:'Page',width:375,height:812,absoluteBoundingBox:{x:0,y:0,width:375,height:812},fills:[],children:[art],exportAsync:async()=>new Uint8Array([1])}
 const figma={mixed:Symbol(),showUI:()=>{},currentPage:{name:'Page',selection:[frame]},root:{name:'File'},on:()=>{},ui:{postMessage:()=>{}},base64Encode:()=>''}
 const ctx=vm.createContext({figma,__html__:''});vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../figma-plugin/code.js'),'utf8'),ctx)
 const out=await ctx.exportFrame(frame);assert.equal(out.spec.nodes[0].type,'IMAGE');assert.equal(out.spec.nodes[0].children,undefined)
})
