// 시안 목록(라이브러리): Figma 플러그인·REST·파일로 가져온 시안을 dqa/designs/<이름>/에 둔다.
// 각 폴더: design.json(시안 명세), design.png(시안 그림), meta.json(가져온 곳·시각). 팀 시안이 들어가므로 저장소에는 올리지 않는다(.gitignore).
const fs = require('fs')
const path = require('path')
const { DQA, readJSON, writeJSON } = require('../core/util')

const DIR = process.env.DQA_DESIGNS_DIR || path.join(DQA, 'designs') // 시험에서는 임시 폴더로 바꾼다
const slug = (s) => String(s || 'design').normalize('NFC').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'design'

function list () {
  if (!fs.existsSync(DIR)) return []
  return fs.readdirSync(DIR).filter((n) => fs.existsSync(path.join(DIR, n, 'design.json'))).map((n) => {
    const spec = readJSON(path.join(DIR, n, 'design.json'), {}); const meta = readJSON(path.join(DIR, n, 'meta.json'), {})
    return { name: n, frame: spec.frame ? spec.frame.name : n, base: spec.base || null, source: meta.source || spec.source || null, file: spec.file || null, page: spec.page || null, figma: spec.figma || null, frame_id: spec.frame && spec.frame.id, png: fs.existsSync(path.join(DIR, n, 'design.png')), saved_at: meta.saved_at || null, group: meta.group || null }
  }).sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)))
}

// 시안 하나를 넣는다(같은 이름이 있으면 덮어쓴다). pngB64는 base64 PNG
function save ({ name, spec, pngB64, group, source }) {
  if (!spec || !(spec.frame || spec.nodes)) throw new Error('design.json 형식이 아니다(frame·nodes가 필요)')
  const n = slug(group ? `${group}-${name || spec.frame.name}` : (name || (spec.frame && spec.frame.name)))
  const d = path.join(DIR, n)
  fs.mkdirSync(d, { recursive: true })
  writeJSON(path.join(d, 'design.json'), spec)
  if (pngB64) fs.writeFileSync(path.join(d, 'design.png'), Buffer.from(pngB64, 'base64'))
  writeJSON(path.join(d, 'meta.json'), { source: source || spec.source || null, group: group || null, saved_at: new Date().toISOString() })
  return { name: n, saved_at: readJSON(path.join(d, 'meta.json')).saved_at, base: spec.base || (spec.frame ? `${spec.frame.width}x${spec.frame.height}` : null), frame: spec.frame ? spec.frame.name : n }
}

// 이름으로 찾기(목록 안의 폴더). 없으면 null
function find (name) {
  if (!name) return null
  const d = path.join(DIR, slug(name))
  return fs.existsSync(path.join(d, 'design.json')) ? path.join(d, 'design.json') : null
}

module.exports = { list, save, find, DIR, slug }
