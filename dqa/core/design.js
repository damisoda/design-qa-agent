// 시안(디자인 기준) 찾기. 검토 화면은 이것을 기준으로 구현과 나란히·겹쳐·차이만 보여 준다.
// 찾는 순서: --design 경로 → 레시피의 design → 로컬 작업 폴더의 .dqa.json design → 작업 폴더의 design.json
//          → 빌드 폴더(또는 그 위 폴더)의 design.json. design.json 옆의 design.png를 시안 그림으로 쓴다.
// design.json은 Figma 플러그인 내보내기 모양이다(frame, tokens, nodes). 찾은 것은 실행 폴더 design/에 복사한다.
const fs = require('fs')
const path = require('path')
const { home, readJSON, assertAllowedPath } = require('./util')

function designFile (p, cfg) {
  if (!p) return null
  const lib = require('../design/library').find(String(p)) // 시안 목록의 이름이면 그 시안
  if (lib && !/[/\\]/.test(String(p))) return lib
  let f = path.resolve(home(String(p)))
  try { assertAllowedPath(f, cfg) } catch (e) { return null }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'design.json')
  return fs.existsSync(f) ? f : null
}

const countNodes = (ns) => (ns || []).reduce((a, n) => a + 1 + countNodes(n.children), 0)

function resolveDesign (args, t, recipes, run, cfg) {
  const out = {}
  for (const r of recipes) {
    const local = t.local || null
    // --design "화면=시안,화면2=시안2"이면 화면별로, 아니면 모든 화면에 같은 시안
    const map = String(args.design || '').includes('=') ? Object.fromEntries(String(args.design).split(',').map((x) => x.split('=').map((y) => y.trim()))) : null
    const cands = [
      map ? map[r.id] : args.design,
      r.design && r._file ? path.resolve(path.dirname(r._file), r.design) : null,
      local && local.design ? path.resolve(local.project, local.design) : null,
      local ? path.join(local.project, 'design.json') : null,
      t.head && t.head.dir ? path.join(t.head.dir, 'design.json') : null,
      t.head && t.head.dir ? path.join(path.dirname(t.head.dir), 'design.json') : null
    ]
    const f = cands.map((c) => designFile(c, cfg)).find(Boolean)
    if (!f) continue
    const spec = readJSON(f, null)
    if (!spec || !(spec.frame || spec.nodes)) continue
    const safe = r.id.replace(/[^\w.-]+/g, '_')
    fs.mkdirSync(run.file('design'), { recursive: true })
    fs.copyFileSync(f, run.file(`design/${safe}.json`))
    const png = path.join(path.dirname(f), 'design.png')
    const hasPng = fs.existsSync(png)
    if (hasPng) fs.copyFileSync(png, run.file(`design/${safe}.png`))
    out[r.id] = {
      source: f, file: spec.file || null, page: spec.page || null, figma: spec.figma || null, frame_id: spec.frame && spec.frame.id, page_id: spec.page_id || null,
      frame: spec.frame ? spec.frame.name : null,
      base: spec.base || (spec.frame ? `${spec.frame.width}x${spec.frame.height}` : null),
      frame_size: spec.frame && spec.frame.width ? [spec.frame.width, spec.frame.height] : null,
      json: `design/${safe}.json`,
      png: hasPng ? `design/${safe}.png` : null,
      nodes: countNodes(spec.nodes),
      tokens: spec.tokens ? Object.keys(spec.tokens).length : 0
    }
  }
  return Object.keys(out).length ? out : null
}

module.exports = { resolveDesign }
