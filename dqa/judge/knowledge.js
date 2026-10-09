// 진단 코드 → 지식 문서(knowledge/, 수업 저장소에서는 w3/docs)의 해당 단락. 임베딩 검색 대신 진단이 고른다(맥미니 임베딩 서버 불필요).
const fs = require('fs')
const path = require('path')
const { KNOWLEDGE } = require('../core/util')

const DOCS = KNOWLEDGE
const cache = {}
function doc (prefix) {
  if (cache[prefix] !== undefined) return cache[prefix]
  const f = fs.existsSync(DOCS) ? fs.readdirSync(DOCS).find((n) => n.startsWith(prefix)) : null
  cache[prefix] = f ? fs.readFileSync(path.join(DOCS, f), 'utf8') : ''
  return cache[prefix]
}
function section (prefix, num) {
  const lines = doc(prefix).split('\n')
  const i = lines.findIndex((l) => l.startsWith(`## ${num}.`))
  if (i < 0) return ''
  const out = []
  for (let k = i; k < lines.length; k++) { if (k > i && lines[k].startsWith('## ')) break; if (lines[k].trim()) out.push(lines[k]) }
  return out.join('\n')
}
function lineOf (prefix, startsWith) { return doc(prefix).split('\n').find((l) => l.trim().startsWith(startsWith)) || '' }
function rows (prefix, keys) { return doc(prefix).split('\n').filter((l) => keys.some((k) => l.startsWith(`| ${k}`))).join('\n') }

const MAP = {
  flex_min_auto: () => [{ id: 'K:P02-4', text: section('P02', 4) }],
  fake_home_indicator: () => [{ id: 'K:P02-5', text: section('P02', 5) }, { id: 'K:P01-6', text: lineOf('P01', '6.') }],
  bottom_fixed_occlusion: () => [{ id: 'K:P02-5', text: section('P02', 5) }],
  narrow_box_squeezed: () => [{ id: 'K:P02-4', text: section('P02', 4) }, { id: 'K:P02-2', text: rows('P02', ['Fixed', 'Hug', 'Min / Max']) }],
  narrow_box: () => [{ id: 'K:P02-2', text: rows('P02', ['Fixed', 'Hug', 'Min / Max']) }, { id: 'K:P01-3', text: lineOf('P01', '3.') }],
  ellipsis: () => [{ id: 'K:P01-3', text: lineOf('P01', '3.') }]
}

function knowledgeFor (diag) {
  const seen = new Set(); const out = []
  for (const g of diag || []) for (const k of (MAP[g.code] ? MAP[g.code]() : [])) if (k.text && !seen.has(k.id)) { seen.add(k.id); out.push(k) }
  return out
}

module.exports = { knowledgeFor }
