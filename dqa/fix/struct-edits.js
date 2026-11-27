// 구조 결함(R1 넘침·R2 잘림·R3 겹침·R4 가림·R6 꺾임·D4 깨진 그림) 규칙 수정안(11-19).
// 수정률 측정에서 규칙 수정안이 없거나(겹침·가림) 결함 요소 자신만 고쳐 실패한 사례가 많았다.
// 결함 요소뿐 아니라 겹친 상대·가린 요소·조상(스크롤 영역 포함)의 CSS 규칙에도 후보를 만든다.
// 후보는 많아도 된다: 모두 사본에 적용·재측정해 대상 결함이 사라지고 다른 결함이 생기지 않을 때만 통과한다.
const fs = require('fs')
const path = require('path')

const esc = (c) => String(c).replace(/[^\w-]/g, '')
const specificity = (sel) => (sel.match(/#[\w-]+/g) || []).length * 100 + (sel.match(/[.:[][\w-]/g) || []).length * 10 + (sel.match(/(^|[\s>+~])[a-z][\w-]*/g) || []).length

function cssFiles (root) {
  const out = []
  const walk = (dir, depth) => { for (const n of fs.readdirSync(dir, { withFileTypes: true })) { if (n.name.startsWith('.') || n.name === 'node_modules' || /^dist-dqa/.test(n.name)) continue; const f = path.join(dir, n.name); if (n.isDirectory() && depth < 3) walk(f, depth + 1); else if (/\.(html|css|scss)$/.test(n.name) && fs.statSync(f).size < 400000) out.push(f) } }
  try { walk(root, 0) } catch (e) {}
  return out.slice(0, 40).map((f) => ({ f, rel: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }))
}

// 마지막 겹 선택자가 이 클래스(또는 부모 클래스 + 태그)를 가진 규칙 중 가장 구체적인(같으면 나중) 규칙
function bestRule (files, { cls, tag, pcls }) {
  const keys = cls && cls.length ? cls.map((c) => ({ last: new RegExp(`\\.${esc(c)}(?![\\w-])`), parent: null }))
    : tag ? (pcls || []).map((c) => ({ last: new RegExp(`^${esc(tag)}$`), parent: new RegExp(`\\.${esc(c)}(?![\\w-])`) })) : []
  let best = null
  for (const key of keys) {
    for (const x of files) {
      for (const m of x.text.matchAll(/([^{}<>]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim(); if (sel.startsWith('@') || sel.startsWith(':root')) continue
        const hit = sel.split(',').map((t) => t.trim()).filter((t) => { const parts = t.split(/[\s>+~]+/); return key.last.test(parts[parts.length - 1].replace(/::?[\w-]+(\([^)]*\))?/g, '')) && (!key.parent || parts.slice(0, -1).some((q) => key.parent.test(q))) })
        if (!hit.length) continue
        const sp = Math.max(...hit.map(specificity))
        if (!best || sp >= best.sp) best = { x, sp, rule: m[0], at: m.index, body: m[2], hit, selector: sel }
      }
    }
  }
  if (!best || best.x.text.split(best.rule).length - 1 !== 1) return null
  return best
}

// 규칙 본문에 선언을 넣는다(같은 속성은 값만 바꾼다). fix.js의 setDecls를 받아 쓴다
function edit (best, decl, why, setDecls) {
  const line = best.x.text.slice(0, best.at).split('\n').length
  const replace = best.selector.includes(',') && best.hit.length < best.selector.split(',').length
    ? best.rule + '\n' + best.hit.join(', ') + '{' + decl + '}'
    : best.rule.replace(`{${best.body}}`, `{${setDecls(best.body, decl)}}`)
  return { source: 'rule', file: best.x.rel, line, find: best.rule, replace, decl, why: `${why}. 대상 CSS 규칙 ${best.rule.split('{')[0].trim()}` }
}

// 규칙 본문의 고정 px 칸 정의를 줄어들 수 있는 칸으로 바꾼다(grid-template-columns: 170px 170px → minmax(0,1fr) minmax(0,1fr))
function gridFix (body) {
  const m = body.match(/grid-template-columns\s*:\s*([^;}]*)/)
  if (!m || !/\d+px/.test(m[1])) return null
  const v = m[1].replace(/repeat\((\d+)\s*,\s*\d+(\.\d+)?px\)/g, 'repeat($1,minmax(0,1fr))').replace(/(^|[\s,(])\d+(\.\d+)?px(?=[\s,)]|$)/g, '$1minmax(0,1fr)')
  return v === m[1] ? null : `grid-template-columns:${v.trim()}`
}

const has = (body, re) => re.test(body || '')

// 대상별 후보 선언. body는 고칠 규칙의 현재 본문
const MENU = {
  R1: (role, body) => [
    gridFix(body) && [gridFix(body), '칸 폭이 고정 px라 좁은 화면에서 넘친다. 줄어들 수 있는 칸으로 바꾼다'],
    has(body, /white-space\s*:\s*nowrap/) && ['white-space:normal', '줄바꿈을 막아 글자가 밖으로 나간다. 줄을 바꾸게 한다'],
    has(body, /flex\s*:\s*none|flex-shrink\s*:\s*0/) && ['flex:1 1 auto;min-width:0', '줄어들지 않게 막아 이웃이 밖으로 밀린다. 남는 폭 안에서 줄어들게 한다'],
    has(body, /flex-wrap\s*:\s*nowrap/) && ['flex-wrap:wrap', '한 줄에 다 들어가지 않는 항목을 다음 줄로 넘긴다'],
    has(body, /(^|[;\s])width\s*:\s*\d+(\.\d+)?px/) && ['width:auto;max-width:100%', '고정 폭이 화면보다 넓다. 폭을 내용과 부모에 맞춘다'],
    has(body, /overflow(-x)?\s*:\s*visible/) && ['overflow-x:auto', '가로로 긴 영역의 스크롤을 되살린다'],
    role === 'self' && ['overflow-wrap:anywhere;min-width:0', '긴 글자가 상자 밖으로 나간다. 긴 단어도 줄을 바꾸게 한다'],
  ],
  R2: (role, body) => [
    has(body, /line-clamp/) && ['-webkit-line-clamp:unset;display:block;overflow:visible', '몇 줄로 잘라 내용이 잘린다. 줄 수 제한을 푼다'],
    has(body, /(^|[;\s])height\s*:\s*\d/) && ['height:auto;overflow:visible', '고정 높이와 넘침 숨김 때문에 내용이 잘린다. 높이를 내용에 맞춘다'],
    has(body, /max-height/) && ['max-height:none', '최대 높이 때문에 내용이 잘린다'],
    has(body, /text-overflow|white-space\s*:\s*nowrap/) && ['white-space:normal;text-overflow:clip;overflow:visible', '한 줄로 자르고 말줄임해 내용이 잘린다. 줄을 바꾸게 한다'],
  ],
  R3: (role, body) => [
    has(body, /position\s*:\s*(absolute|fixed)/) && ['position:static', '절대 위치로 옮겨 다른 글자 위에 얹힌다. 문서 흐름으로 되돌린다'],
    has(body, /position\s*:\s*relative/) && has(body, /(^|[;\s])(top|left|right|bottom)\s*:/) && ['top:auto;left:auto;right:auto;bottom:auto', '상대 위치로 끌어올려 다른 글자와 겹친다. 끌어올린 값을 푼다'],
    has(body, /transform/) && ['transform:none', '옮기는 변환 때문에 다른 요소와 겹친다'],
    has(body, /line-height\s*:\s*\d+(\.\d+)?px/) && ['line-height:normal', '줄 높이가 글자보다 작아 줄끼리 겹친다. 줄 높이를 글자에 맞춘다'],
    has(body, /margin(-top|-bottom)?\s*:\s*-/) && ['margin-top:0;margin-bottom:0', '음수 여백 때문에 이웃과 겹친다'],
  ],
  R6: (role, body) => role === 'self' ? [
    ['width:auto;white-space:nowrap;word-break:normal', '고정 폭이 글자보다 좁아 짧은 라벨이 꺾인다. 폭을 글자에 맞추고 한 줄로 둔다'],
    has(body, /word-break\s*:\s*break-all/) && ['word-break:keep-all', '글자 단위로 끊어 짧은 라벨이 꺾인다'],
  ] : [],
}

// 결함 하나의 고칠 대상: 자신 → (R3·R4) 상대 → 조상(가까운 순). R4는 스크롤 영역 조상을 앞에 둔다
function targetsOf (d) {
  const out = []
  for (const el of (d.elements || []).slice(0, 2)) {
    out.push({ role: 'self', cls: el.cls, tag: el.tag, pcls: el.pcls })
    const o = el.other
    if (o && (o.cls || []).length) out.push({ role: 'other', cls: o.cls, tag: o.tag, pcls: o.pcls, box: o.box, kind: o.kind })
    const anc = (el.ancestors || []).filter((a) => (a.cls || []).length)
    const scrollers = anc.filter((a) => /(auto|scroll)/.test(a.overflowY || ''))
    for (const a of d.rule === 'R4' ? [...scrollers, ...anc.filter((x) => !scrollers.includes(x))] : anc) out.push({ role: 'ancestor', cls: a.cls, scroller: /(auto|scroll)/.test(a.overflowY || ''), paddingBottom: a.paddingBottom })
    for (const a of (o && o.ancestors) || []) if ((a.cls || []).length) out.push({ role: 'other-ancestor', cls: a.cls })
  }
  const seen = new Set()
  return out.filter((t) => { const k = t.role[0] + (t.cls || []).join('.') + (t.tag || '') + (t.pcls || []).join('.'); if (seen.has(k)) return false; seen.add(k); return true })
}

function structEdits (d, srcRoot, setDecls) {
  if (!['R1', 'R2', 'R3', 'R4', 'R6', 'D4'].includes(d.rule)) return []
  if (d.rule === 'D4') return brokenImageEdits(d, srcRoot)
  const files = cssFiles(srcRoot); if (!files.length) return []
  const out = []; const seen = new Set()
  const push = (best, decl, why) => { const e = edit(best, decl, why, setDecls); const k = e.find + '→' + e.replace; if (!seen.has(k) && e.replace !== e.find) { seen.add(k); out.push(e) } }
  const occ = (d.elements || []).map((e) => e.other).find((o) => o && o.kind === 'occluder' && o.box)
  for (const t of targetsOf(d)) {
    const best = bestRule(files, t); if (!best) continue
    if (d.rule === 'R4') {
      // 끝까지 내려도 아래 막대에 가린다: 스크롤 영역 아래 여백을 가린 높이만큼 둔다
      if (t.role === 'ancestor' && t.scroller && occ) push(best, `padding-bottom:${Math.ceil(occ.box.height) + 16}px`, `아래 고정 막대(높이 ${Math.round(occ.box.height)}px)에 마지막 내용이 가린다. 스크롤 영역 아래 여백을 막대 높이만큼 둔다`)
      if (t.role === 'other' && has(best.body, /position\s*:\s*(absolute|fixed)/)) push(best, 'position:sticky;bottom:0', '가리는 막대가 내용 위에 떠 있다. 스크롤 끝에서는 내용 아래에 오게 한다')
      if (t.role === 'other' && has(best.body, /(^|[;\s])(height|min-height)\s*:\s*\d/)) push(best, 'height:auto;min-height:0', '가리는 판의 고정 높이가 커서 아래 내용을 덮는다. 높이를 내용에 맞춘다')
      continue
    }
    for (const c of (MENU[d.rule] || (() => []))(t.role, best.body).filter(Boolean)) push(best, c[0], c[1])
  }
  return out.slice(0, 8)
}

// 깨진 그림: 소스의 그림 경로가 없는 파일을 가리키고, 같은 이름의 파일이 소스에 하나뿐이면 그 경로로 고친다
function brokenImageEdits (d, srcRoot) {
  const out = []
  let all = []
  const walk = (dir, depth) => { for (const n of fs.readdirSync(dir, { withFileTypes: true })) { if (n.name.startsWith('.') || n.name === 'node_modules' || /^dist-dqa/.test(n.name)) continue; const f = path.join(dir, n.name); if (n.isDirectory() && depth < 4) walk(f, depth + 1); else all.push(f) } }
  try { walk(srcRoot, 0) } catch (e) { return [] }
  const imgs = all.filter((f) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(f))
  const labels = new Set([...(d.labels || []), ...(d.elements || []).map((e) => e.label)].filter(Boolean))
  for (const f of all.filter((x) => /\.(html|jsx?|tsx?|vue|css)$/.test(x))) {
    const text = fs.readFileSync(f, 'utf8')
    for (const m of text.matchAll(/(src=|url\()(["']?)([^"')\s>]+\.(?:png|jpe?g|gif|webp|svg|avif))\2/gi)) {
      const ref = m[3]; if (/^(https?:|data:)/.test(ref)) continue
      const abs = ref.startsWith('/') ? path.join(srcRoot, ref) : path.resolve(path.dirname(f), ref)
      if (fs.existsSync(abs)) continue
      let same = imgs.filter((x) => path.basename(x) === path.basename(ref))
      // 이름은 같고 확장자만 다른 파일(cover.jpg → cover.png)도 하나뿐이면 후보로 둔다
      if (!same.length) { const stem = path.basename(ref).replace(/\.[^.]+$/, ''); same = imgs.filter((x) => path.basename(x).replace(/\.[^.]+$/, '') === stem) }
      if (same.length !== 1) continue
      // 결함 그림과 이어진 경로만: 같은 태그의 alt가 결함 라벨이면 우선, 없어도 후보로 둔다
      const tagText = text.slice(Math.max(0, m.index - 200), m.index + 200)
      const fixed = path.relative(path.dirname(f), same[0]).split(path.sep).join('/')
      const line = text.slice(0, m.index).split('\n').length
      const e = { source: 'rule', file: path.relative(srcRoot, f), line, find: m[0], replace: `${m[1]}${m[2]}${fixed}${m[2]}`, why: `그림 경로 ${ref}에 파일이 없다. 같은 이름의 파일 ${fixed}로 고친다` }
      if (text.split(m[0]).length - 1 !== 1) continue
      if ([...labels].some((l) => tagText.includes(l))) out.unshift(e); else out.push(e)
    }
  }
  return out.slice(0, 3)
}

module.exports = { structEdits, brokenImageEdits, gridFix, targetsOf }
