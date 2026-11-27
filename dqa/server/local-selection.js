// Read-only discovery; user connections live in dqa state, never in the project.
const fs = require('fs'); const path = require('path')
const { assertAllowedPath, STATE, RUNS, readJSON, writeJSON } = require('../core/util')
const { detectProject } = require('../targets/local')
const { loadRecipe } = require('../recipes/runner')
const { discover, routePath, dynamic, hash } = require('../targets/discover')
const stateDir = () => process.env.DQA_SCREEN_STATE_DIR || path.join(STATE, 'screen-recipes')
function projectDir (local, cfg) {
  if (typeof local !== 'string' || !path.isAbsolute(local.trim())) throw new Error('프로젝트 폴더의 전체 경로를 넣어 주세요.')
  const dir = assertAllowedPath(local.trim(), cfg)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('프로젝트 폴더를 찾을 수 없습니다. 경로를 확인해 주세요.')
  return fs.realpathSync(dir)
}
function inspect (local, cfg) {
  const dir = projectDir(local, cfg)
  let project; let buildError = ''
  try { project = detectProject(dir) } catch (e) {
    // Discover unsupported projects too, but never imply they can be built.
    buildError = '화면은 찾았지만 이 프로젝트의 빌드 방식은 아직 자동으로 지원하지 않습니다.'
    project = { name: path.basename(dir), kind: 'unsupported' }
  }
  const found = project.recipes?.length ? { screens: project.recipes.map(id => {
    const r = loadRecipe(id)
    return { id, title:r.title || id, path:r.start?.path || '/', steps:(r.steps || []).length, registered:true, via:'등록된 검사 절차', dynamic:false }
  }), warnings:[], scanned_files:0 } : discover(dir)
  const saved = readJSON(path.join(stateDir(), hash(dir) + '.connections.json'), {})
  if (saved.local === dir) for (const row of saved.screens || []) {
    if (row.manual && routePath(row.path) && !found.screens.some(s => s.id === row.id)) found.screens.push({id:row.id, title:row.path, path:row.path, manual:true, steps:0, via:'직접 추가한 경로'})
  }
  const bindings = saved.local === dir ? (saved.screens || []) : []
  return { ok:true, local:dir, input_local:local.trim(), name:project.name, kind:project.kind, build_error:buildError, ...found, bindings, saved_at:saved.saved_at || null }
}
function connect (body, cfg) {
  const info = inspect(body.local, cfg)
  if (info.build_error) throw new Error(info.build_error)
  if (!Array.isArray(body.screens) || !body.screens.length || body.screens.length > 50) throw new Error('연결할 화면을 1~50개 선택해 주세요.')
  const names = new Set(require('../design/library').list().map(d => d.name))
  const rows=[]; const recipes=[]; const design={}; const generated=[]; const seen=new Set()
  for (const input of body.screens) {
    if (!input || typeof input.id !== 'string' || seen.has(input.id)) throw new Error('화면 선택이 중복되었거나 올바르지 않습니다.')
    seen.add(input.id)
    let screen = info.screens.find(s => s.id === input.id)
    if (!screen && input.manual && /^manual-[a-f0-9]{16}$/.test(input.id)) screen={id:input.id,title:input.path,path:input.path,manual:true,steps:0}
    if (!screen) throw new Error('화면 목록이 바뀌었습니다. 폴더를 다시 확인해 주세요.')
    const p = routePath(input.path || screen.path)
    if (!p || dynamic(p)) throw new Error('실제로 열 주소를 넣어 주세요. 예: /products/123 (외부 주소와 :id 같은 자리표시는 사용할 수 없습니다.)')
    if (screen.registered && p !== screen.path) throw new Error('등록된 진입 절차의 시작 주소는 변경할 수 없습니다.')
    if (!names.has(input.design)) throw new Error('각 화면에 비교할 Figma 프레임을 연결해 주세요.')
    let id=screen.id
    if (!screen.registered) {
      id='auto/'+hash(info.local+'\n'+screen.id+'\n'+p)
      generated.push({id,version:1,title:screen.title || p,app:info.name,_project:info.local,start:{path:p},steps:[],ready:{stable_ms:400},scan:{root:'body',scroll:'auto',ignore:[]},widths:'mobile5'})
    }
    recipes.push(id); design[id]=input.design
    rows.push({id:screen.id,path:p,design:input.design,manual:!!screen.manual})
  }
  // Validate every row before writing anything. Recipe IDs are immutable for each path.
  fs.mkdirSync(stateDir(),{recursive:true})
  for (const r of generated) writeJSON(path.join(stateDir(),r.id.slice(5)+'.json'),r)
  writeJSON(path.join(stateDir(),hash(info.local)+'.connections.json'),{local:info.local,screens:rows,saved_at:new Date().toISOString()})
  return {ok:true,local:info.local,recipes,design}
}
function validateScope (ids, local) {
  for (const id of ids) if (id.startsWith('auto/')) {
    const r=loadRecipe(id)
    if (!local || r._project !== fs.realpathSync(local)) throw new Error('다른 프로젝트에서 연결한 화면은 사용할 수 없습니다. 폴더에서 화면을 다시 선택해 주세요.')
  }
}
// A frozen recheck inherits the original project's scope, never the scratch folder's identity.
function validateCheckScope (ids, args) {
  if (!args['snapshot-run']) return validateScope(ids, args.local)
  const id = args['snapshot-run']
  if (!/^[\w.-]+$/.test(id) || id !== args['run-id'] || !args.url || args.local || args.repo || args.dist) throw new Error('유효한 사본 재검사 요청이 아닙니다')
  const m = readJSON(path.join(RUNS, id, 'manifest.json'), null)
  const same = (a,b) => !!a && !!b && fs.realpathSync(a) === fs.realpathSync(b)
  if (!m || m.status !== 'done' || !same(args.src, m.targets?.head?.src) || ids.some(id => !m.recipes.some(r => r.id === id))) throw new Error('원래 검사한 사본과 화면 범위가 일치하지 않습니다')
  if (m.targets.base && (!args['base-url'] || !same(args['base-src'], m.targets.base.src))) throw new Error('비교 기준 사본이 일치하지 않습니다')
  validateScope(ids, m.local?.project)
}
module.exports={inspect,connect,validateScope,validateCheckScope,stateDir}
