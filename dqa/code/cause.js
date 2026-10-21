// 원인 후보 찾기: 결함 요소의 라벨·aria 글자를 소스에서 찾고(rg), 컴포넌트 정의, 상위 후보가 가져오는 스타일 모듈,
// (비교 모드라면) 이번 변경 위치로 순위를 매긴다. 소스는 읽기만 한다.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const GLOB = ['--glob', '*.{ts,tsx,js,jsx,html,vue,svelte}', '--glob', '!**/node_modules/**', '--glob', '!**/dist*/**']
const CSS_GLOB = ['--glob', '*.{css,scss,sass,less,html,vue,svelte}', '--glob', '!**/node_modules/**', '--glob', '!**/dist*/**']

function rg (pattern, dir, fixed = true, globs = GLOB) {
  try {
    const out = execFileSync('rg', ['-n', '--no-heading', '--max-count', '20', ...(fixed ? ['-F'] : []), ...globs, '--', pattern, dir], { encoding: 'utf8', timeout: 15000, maxBuffer: 4 << 20 })
    return out.split('\n').filter(Boolean).slice(0, 400).map((l) => { const m = l.match(/^(.*?):(\d+):(.*)$/); return m ? { file: m[1], line: Number(m[2]), text: m[3] } : null }).filter(Boolean)
  } catch (e) { return [] }
}

function rgFiles (pattern, dir) {
  try { return execFileSync('rg', ['-l', ...GLOB, '--', pattern, dir], { encoding: 'utf8', timeout: 15000 }).split('\n').filter(Boolean).length } catch (e) { return 0 }
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 선택자의 마지막 겹(.info p라면 p)에 이 클래스가 있는 규칙만(자손 규칙은 이 요소의 스타일이 아니다)
const lastHas = (text, cls) => String(text).split('{')[0].split(',').some((part) => { const t = part.trim().split(/[\s>+~]+/); return new RegExp(`\\.${esc(cls)}(?![\\w-])`).test(t[t.length - 1] || '') })

function snippet (file, line, around = 3) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    const a = Math.max(0, line - 1 - around); const b = Math.min(lines.length, line + around)
    return lines.slice(a, b).map((t, i) => `${a + i + 1}: ${t.slice(0, 160)}`).join('\n')
  } catch (e) { return '' }
}

// 1위 후보 줄에 쓰인 컴포넌트의 정의(같은 파일)와, 그 정의가 쓰는 styles.키의 스타일 줄을 모은다.
// 라벨이 있는 줄만으로는 배치를 정하는 속성(minWidth·flex 등)이 보이지 않기 때문이다.
function componentContext (file, line, maxLines = 60) {
  let lines
  try { lines = fs.readFileSync(file, 'utf8').split('\n') } catch (e) { return '' }
  const around = lines.slice(Math.max(0, line - 3), line + 2).join('\n')
  const BASIC = /^(View|Text|TextInput|Pressable|ScrollView|Image|TouchableOpacity|SafeAreaView|KeyboardAvoidingView|FlatList|Fragment)$/
  // 후보 줄 자체의 컴포넌트를 먼저, 그다음 앞뒤 줄. 기본 컴포넌트는 뺀다
  const names = [...new Set([...(lines[line - 1] || '').matchAll(/<([A-Z]\w+)/g), ...around.matchAll(/<([A-Z]\w+)/g)].map((m) => m[1]).filter((n) => !BASIC.test(n)))].slice(0, 2)
  const picked = new Set()
  const keys = new Set([...around.matchAll(/styles\.(\w+)/g)].map((m) => m[1]))
  for (const n of names) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?(default\\s+)?(function\\s+${n}\\b|const\\s+${n}\\s*[=:])`).test(l))
    if (i < 0) continue
    for (let k = i; k < Math.min(lines.length, i + 30); k++) { picked.add(k); for (const m of lines[k].matchAll(/styles\.(\w+)/g)) keys.add(m[1]); if (k > i && /^\}\s*;?\s*$/.test(lines[k])) break }
  }
  for (const key of keys) { const i = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*:`).test(l)); if (i >= 0) picked.add(i) }
  const out = [...picked].sort((a, b) => a - b).slice(0, maxLines).map((k) => `${k + 1}: ${lines[k].slice(0, 200)}`)
  return out.join('\n')
}

// 스타일·테마 모듈: theme/·styles/ 폴더 안이거나, 이름이 스타일을 뜻하는 모듈(컴포넌트는 제외)
const isStyleMod = (spec) => /(^|\/)(theme|themes|styles?)\//i.test(spec) || /^(styles?|tokens|theme|layout|metrics|spacing|typography|colors?)$|Styles?$/i.test(path.basename(spec))

function importsOf (file) {
  try {
    const src = fs.readFileSync(file, 'utf8')
    const out = []
    for (const m of src.matchAll(/import\s+[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const base = path.resolve(path.dirname(file), m[1])
      for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) { if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) { out.push({ spec: m[1], file: base + ext }); break } }
    }
    return out
  } catch (e) { return [] }
}

// defect: { elements[{label, aria, components}], rule } / opts: { srcRoot, srcDir, hints[], changed: Map(relFile → [[a,b]]) | null, minified }
function findCauses (defect, opts) {
  const { srcRoot, srcDir } = opts
  if (!srcRoot || !fs.existsSync(srcDir || srcRoot)) return { candidates: [], note: '소스 경로가 없어 원인 후보를 찾지 않았다' }
  const dir = srcDir || srcRoot
  const rel = (f) => path.relative(srcRoot, f)
  const cand = new Map() // file → { file, line, score, why[], raw }
  // score는 가중 점수(합산), raw는 그 파일에서 가장 강한 근거의 원래 강도(0.5·0.4·0.35·0.15·0.05). 대표 줄은 raw가 가장 큰 줄이다.
  const add = (file, line, score, why, raw = score) => {
    const c = cand.get(file) || { file, line, score: 0, why: [], raw: -1 }
    if (raw > c.raw) { c.raw = raw; c.line = line }
    c.score += score
    if (!c.why.includes(why)) c.why.push(why)
    cand.set(file, c)
  }
  // 라벨마다 파일별 가장 강한 일치(접근성 라벨 0.5 > 문자열 0.4 > 화면 글자 0.35 > 포함 0.15 > 주석 0.05)를 구하고,
  // 여러 파일에 흔히 나오는 라벨은 1/√(강한 일치 파일 수)로 낮춘다. 파일 점수는 라벨 평균이다.
  const labels = [...new Set(defect.elements.flatMap((e) => [e.aria, e.label]).filter((s) => s && s.length >= 2 && s.length <= 40))].slice(0, 4)
  for (const lab of labels) {
    const best = new Map()
    for (const h of rg(lab, dir)) {
      const t = h.text
      const q = new RegExp(`(['"\`])${esc(lab)}\\1`)
      let s = 0.15; let why = `글자 "${lab}" 포함`
      if (/^\s*(\/\/|\*|\/\*)/.test(t)) { s = 0.05; why = `주석에 "${lab}"` } else if (/accessibilityLabel|aria-label|placeholder/.test(t) && q.test(t)) { s = 0.5; why = `접근성 라벨 "${lab}" 일치` } else if (q.test(t)) { s = 0.4; why = `문자열 "${lab}" 일치` } else if (new RegExp(`>\\s*${esc(lab)}\\s*<`).test(t)) { s = 0.35; why = `화면 글자 "${lab}" 일치` }
      const cur = best.get(h.file)
      if (!cur || s > cur.s) best.set(h.file, { s, line: h.line, why })
    }
    const strong = [...best.values()].filter((x) => x.s >= 0.35).length
    const idf = 1 / Math.sqrt(Math.max(1, strong))
    for (const [file, x] of best) add(file, x.line, (x.s * idf) / labels.length, `${x.why}(${path.basename(file)}:${x.line}${strong > 1 && x.s >= 0.35 ? `, ${strong}개 파일에 있음` : ''})`, x.s)
  }
  // 클래스 이름으로 스타일 규칙 위치(CSS·HTML <style>·Vue·Svelte). 색·글자·모서리·크기 같은 스타일 결함이면 강한 근거.
  // 자동 생성 클래스(react-native-web의 css-·r-)는 뺀다
  const styleDefect = !['T1', 'M1', 'M2', 'I1', 'I2', 'I3'].includes(defect.rule)
  // 넘침의 원인이 바깥 상자(고정 폭 등)면 그 상자의 스타일 규칙을 먼저, 더 크게 본다(안쪽 글자 규칙보다 앞서게)
  const wideCls = [...new Set(defect.elements.flatMap((e) => (e.other && e.other.kind === 'wide' && e.other.cls) || []))].filter((c) => /^[A-Za-z_][\w-]*$/.test(c)).slice(0, 2)
  for (const c of wideCls) {
    for (const h of rg(`\\.${esc(c)}([^\\w-][^{};]*)?\\{`, dir, false, CSS_GLOB).filter((h) => !/^\s*(\/\/|\*|\/\*)/.test(h.text) && lastHas(h.text, c)).slice(0, 2)) {
      add(h.file, h.line, 0.6 / wideCls.length, `넘친 글자들을 감싼 바깥 상자 .${c}의 규칙(${path.basename(h.file)}:${h.line}) — 이 상자가 부모보다 넓다`, 0.6)
    }
  }
  const clsList = [...new Set(defect.elements.flatMap((e) => e.cls || []))].filter((c) => /^[A-Za-z_][\w-]*$/.test(c) && !/^(css-|r-)/.test(c)).slice(0, 3)
  for (const c of clsList) {
    for (const h of rg(`\\.${esc(c)}([^\\w-][^{};]*)?\\{`, dir, false, CSS_GLOB).filter((h) => !/^\s*(\/\/|\*|\/\*)/.test(h.text) && lastHas(h.text, c)).slice(0, 2)) {
      const w = styleDefect ? 0.45 : 0.1
      add(h.file, h.line, w / Math.max(1, clsList.length), `스타일 규칙 .${c}(${path.basename(h.file)}:${h.line})`, w)
    }
  }
  // 압축하지 않은 빌드면 fiber 컴포넌트 이름으로 정의 위치를 찾는다. 이미 라벨 근거가 있는 파일이면 대표 줄은 그대로 두고 근거만 더한다
  const comps = opts.minified ? [] : [...new Set(defect.elements.flatMap((e) => e.components || []))].slice(0, 4)
  // 요소에서 가까운 컴포넌트일수록 크게(첫째 0.3, 둘째 0.15, 셋째 0.1): 바깥 화면 컴포넌트가 실제 원인 컴포넌트를 앞서지 않게
  const compW = [0.3, 0.15, 0.1, 0.05]
  comps.forEach((name, i) => {
    for (const h of rg(`(function|class)\\s+${esc(name)}\\b|const\\s+${esc(name)}\\s*[=:]`, dir, false).slice(0, 3)) {
      const why = `컴포넌트 ${name} 정의(${path.basename(h.file)}:${h.line})`
      const c = cand.get(h.file); const w = compW[i] || 0.05
      if (c) { c.score += w; if (!c.why.includes(why)) c.why.push(why) } else add(h.file, h.line, w, why, w)
    }
  })
  // 소스 힌트는 강한 근거(라벨·문자열 일치, raw ≥ 0.35)가 있는 후보에만 더한다(주석·부분 일치를 끌어올리지 않게)
  for (const c of cand.values()) if (c.raw >= 0.35 && (opts.hints || []).some((hnt) => rel(c.file).startsWith(hnt))) { c.score += 0.15; c.why.push('레시피의 소스 힌트') }
  // 상위 3개 후보가 가져오는 스타일·테마 모듈(한 단계). 여러 후보가 함께 쓰는 모듈일수록 공통 원인일 가능성이 크고,
  // 소스 전체에서 흔히 쓰이는 모듈(예: tokens)은 1/√(가져오는 파일 수)로 낮춘다.
  const tops = [...cand.values()].sort((a, b) => b.score - a.score).slice(0, 3)
  const mods = new Map()
  for (const t of tops) {
    for (const im of importsOf(t.file)) {
      if (!isStyleMod(im.spec) || cand.has(im.file)) continue
      const m = mods.get(im.file) || { file: im.file, spec: im.spec, sum: 0, by: [] }
      m.sum += t.score * 0.5; m.by.push(path.basename(t.file)); mods.set(im.file, m)
    }
  }
  for (const m of mods.values()) {
    const base = path.basename(m.file).replace(/\.(tsx?|jsx?)$/, '')
    const g = Math.max(1, rgFiles(`from ['"][^'"]*/${esc(base)}['"]`, dir))
    cand.set(m.file, { file: m.file, line: 1, score: Math.round((m.sum / Math.sqrt(g)) * 100) / 100, why: [`${m.by.join('·')}가 ${m.by.length > 1 ? '함께 ' : ''}가져오는 스타일·테마 모듈(${m.spec}, 소스 전체 ${g}개 파일이 사용)`], raw: 0, shared: m.by.length, g })
  }
  // 비교 모드: 이번 변경에서 바뀐 파일·줄. 강한 근거가 있는 후보와 스타일 모듈에만 곱해서 더한다(근거 없는 변경 파일은 넣지 않는다)
  if (opts.changed) {
    for (const c of cand.values()) {
      const hunks = opts.changed.get(rel(c.file))
      if (!hunks || !(c.raw >= 0.35 || c.shared !== undefined)) continue
      c.score *= 1.3; c.why.push('이번 변경에서 바뀐 파일')
      if (hunks.some(([a, b]) => c.line >= a - 5 && c.line <= b + 5)) { c.score *= 1.2; c.why.push('바뀐 줄 근처') }
    }
  }
  let sourceContext = null
  if (defect.rule === 'M1') {
    sourceContext = require('./source-context').sourceContext(defect, {...opts, candidates: [...cand.values()].sort((a,b)=>b.score-a.score).slice(0,3).map(c=>({...c,file:rel(c.file)}))})
    for (const c of sourceContext.candidates.filter(c=>c.hinted)) add(path.resolve(srcRoot,c.file),c.line,c.score,c.why.join(' · '),c.score)
  }
  let list = [...cand.values()].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
  // 표시 규칙: 상위 후보 2개 이상이 함께 쓰는 공통 스타일 모듈(소스 10개 파일 이하에서 사용)은 세 자리 안에 넣는다
  const shared = list.find((c) => c.shared >= 2 && c.g <= 10)
  list = list.slice(0, 3)
  if (shared && !list.includes(shared)) { list[2] = shared; shared.why.push('공통 스타일 모듈이라 후보에 포함') }
  return { source_context: sourceContext, candidates: list.map((c, i) => ({ rank: i + 1, file: rel(c.file), line: c.line, score: Math.min(1, Math.round(c.score * 100) / 100), why: c.why.slice(0, 4), snippet: i < 2 ? snippet(c.file, c.line) : '', context: i === 0 ? componentContext(c.file, c.line) : '' })) }
}

// 두 소스 폴더(변경 전·후)의 차이: 파일별 바뀐 줄 범위(변경 후 기준)와 새로 들어간 hex 색.
// baseRoot·headRoot는 저장소 뿌리, sub는 비교할 하위 폴더(예: frontend/src). 결과 경로는 저장소 뿌리 기준이다.
function changedHunks (baseRoot, headRoot, sub) {
  const parent = commonParent(baseRoot, headRoot)
  const relHead = path.relative(parent, headRoot)
  const a = path.join(path.relative(parent, baseRoot), sub || ''); const b = path.join(relHead, sub || '')
  let out = ''
  try { out = execFileSync('git', ['diff', '--no-index', '-U0', '--no-color', a, b], { cwd: parent, encoding: 'utf8', maxBuffer: 32 << 20, timeout: 30000 }) } catch (e) { out = e.stdout || '' }
  const map = new Map(); const added = []
  let file = null; let lineNo = 0
  for (const l of out.split('\n')) {
    let m
    if ((m = l.match(/^\+\+\+ (.*)$/))) { const p = m[1].replace(/^b\//, ''); file = p === '/dev/null' ? null : path.relative(relHead, p); continue }
    if ((m = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/))) { lineNo = Number(m[1]); const n = m[2] === undefined ? 1 : Number(m[2]); if (file && n > 0) { if (!map.has(file)) map.set(file, []); map.get(file).push([lineNo, lineNo + n - 1]) } continue }
    if (file && l.startsWith('+') && !l.startsWith('+++')) { for (const h of l.matchAll(/#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g)) added.push({ file, line: lineNo, hex: h[0].toUpperCase(), text: l.slice(1).trim().slice(0, 120) }); lineNo++ }
  }
  return { changed: map, addedHex: added }
}

function commonParent (a, b) {
  const pa = path.resolve(a).split(path.sep); const pb = path.resolve(b).split(path.sep)
  let i = 0; while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++
  return pa.slice(0, i).join(path.sep) || path.sep
}

// 토큰 파일의 hex 값 → 이름
function tokenHex (tokensFile) {
  const map = new Map()
  try {
    for (const l of fs.readFileSync(tokensFile, 'utf8').split('\n')) {
      const m = l.match(/(\w+)\s*:\s*['"](#[0-9A-Fa-f]{3,8})['"]/)
      if (m) map.set(m[2].toUpperCase(), m[1])
    }
  } catch (e) {}
  return map
}

// 누르면 오류(I2)의 원인: 스택 맨 위 번들 위치(파일:줄:칸)의 코드 조각에서 줄여 쓰지 않은 이름(filled_keys 같은 속성·함수 이름)을 뽑아
// 소스에서 같은 표현이 있는 줄을 찾는다(소스 맵 없이). 압축된 한두 글자 이름은 쓰지 않는다
function stackCauses (stack, { distDir, srcDir, srcRoot }) {
  const m = String(stack || '').match(/(\/[^\s:()]+\.m?js):(\d+):(\d+)/)
  if (!m || !distDir || !srcDir) return []
  const f = path.join(distDir, m[1])
  if (!f.startsWith(distDir) || !fs.existsSync(f)) return []
  const line = fs.readFileSync(f, 'utf8').split('\n')[Number(m[2]) - 1] || ''
  const col = Number(m[3])
  const snip = line.slice(Math.max(0, col - 160), col + 40)
  // 오류 칸에 가장 가까운 속성 접근(?.a.b, .a.b)부터: 긴 이름 순서로
  const props = [...snip.matchAll(/\??\.([A-Za-z_$][\w$]{3,})/g)].map((x) => ({ name: x[1], d: Math.abs(x.index - (col - Math.max(0, col - 160))) })).sort((a, b) => a.d - b.d)
  const names = [...new Set(props.map((p) => p.name))].filter((n) => !/^(length|then|call|apply|default|current|value|style|props|jsx|jsxs|createElement)$/.test(n)).slice(0, 4)
  const out = []
  for (const n of names) {
    const hits = rg(n, srcDir).filter((h) => !/^\s*(\/\/|\*)/.test(h.text) && !/:\s*[\w[\]<>|]+;\s*$/.test(h.text)) // 타입 선언 줄은 뺀다
    if (!hits.length || hits.length > 6) continue
    // 오류 조각에 같이 나온 다른 이름이 같은 줄에 있으면 더 강하게
    for (const h of hits) out.push({ file: h.file, line: h.line, score: 0.5 + (names.some((o) => o !== n && h.text.includes(o)) ? 0.2 : 0) + (/\.length|\?\./.test(h.text) ? 0.1 : 0), why: [`오류 위치의 코드(${snip.slice(Math.max(0, snip.indexOf(n) - 20), snip.indexOf(n) + n.length + 12).trim()})와 같은 이름 ${n}(${path.basename(h.file)}:${h.line})`], raw: 0.5 })
    if (out.length) break
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3).map((c) => ({ ...c, file: path.relative(srcRoot, c.file) }))
}

module.exports = { findCauses, changedHunks, tokenHex, snippet, stackCauses }
