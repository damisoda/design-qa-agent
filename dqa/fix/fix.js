// dqa fix: 결함마다 수정안을 만들고, 평가용 사본에 적용해 다시 빌드·재측정해서 검증한다.
// 채택 조건: 그 결함이 사라지고, 다른 결함이 새로 생기거나 커지지 않는다. 원본 소스·사용자 작업본에는 쓰지 않는다.
// 수정은 코드 에이전트(fix/agent.js)가 한다: (1) 진단이 분명한 유형은 규칙 수정안(flex 최소 폭 → minWidth: 0, 눌린 라벨 → flexShrink: 0)
// (2) 안 되면 보고서 에이전트의 문제 정의서를 받아 코드 읽기·검색·수정 루프. 수정마다 사본에서 빌드·재측정으로 검증한다.
const fs = require('fs')
const path = require('path')
const { execFileSync, spawn } = require('child_process')
const { RUNS, home, readJSON, writeJSON, assertAllowedPath, createRun, sha1 } = require('../core/util')
const { launch, newContext, settle } = require('../measure/browser')
const { sweep } = require('../measure/sweep')
const { buildDefects, crossWidth } = require('../measure/cluster')
const { loadRecipe } = require('../recipes/runner')
const { serveDist } = require('../targets/static')
const { compare } = require('../diff/compare')
const { preflight, unload } = require('../judge/ollama')
const { codeAgent } = require('./agent')
const { designPass } = require('../design/pass')
const { interactPass } = require('../interact/probe')
const { designCss, textEdits } = require('../design/suggest')
const sizeEq = (a, b) => String(Array.isArray(a) ? a.join('x') : a).split('@')[0] === String(Array.isArray(b) ? b.join('x') : b).split('@')[0]

// ── 스타일 키 찾기 ─────────────────────────────────────────────
const BASIC = /^(View|Text|TextInput|Pressable|ScrollView|Image|TouchableOpacity|SafeAreaView|KeyboardAvoidingView|FlatList|Fragment)$/
const styleKeysIn = (line) => [...line.matchAll(/styles\.(\w+)/g)].map((m) => m[1])

function componentBody (lines, name) {
  const i = lines.findIndex((l) => new RegExp(`^\\s*(export\\s+)?(default\\s+)?(function\\s+${name}\\b|const\\s+${name}\\s*[=:])`).test(l))
  if (i < 0) return null
  let j = i; while (j < lines.length - 1 && j - i < 80 && !(j > i && /^\}\s*;?\s*$/.test(lines[j]))) j++
  return { start: i, end: j }
}

// 결함 요소(field/text)의 스타일 키: 후보 줄에 직접 있거나, 후보 줄의 사용자 컴포넌트 정의 안에서 찾는다
function findStyleKey (lines, anchorIdx, el) {
  const isField = el.fp.startsWith('field|')
  const anchor = lines[anchorIdx] || ''
  if (isField && /<TextInput\b/.test(anchor) && styleKeysIn(anchor).length) return { key: styleKeysIn(anchor)[0], via: `${anchorIdx + 1}줄 TextInput` }
  // 후보 줄의 사용자 컴포넌트 + 측정에서 얻은 소유 컴포넌트 이름(압축하지 않은 빌드)
  const comps = [...new Set([...[...anchor.matchAll(/<([A-Z]\w+)/g)].map((m) => m[1]), ...(el.components || [])])].filter((n) => !BASIC.test(n))
  for (const c of comps) {
    const b = componentBody(lines, c)
    if (!b) continue
    const body = lines.slice(b.start, b.end + 1)
    if (isField) {
      const k = body.findIndex((l) => /<TextInput\b/.test(l) && styleKeysIn(l).length)
      if (k >= 0) return { key: styleKeysIn(body[k])[0], via: `${c} 정의(${b.start + k + 1}줄) TextInput` }
    } else {
      // 후보 줄에서 이 글자를 값으로 받는 속성 이름(예: label="상의") → 정의 안에서 {label}을 그리는 줄
      const prop = [...anchor.matchAll(/(\w+)=["']([^"']+)["']/g)].find((m) => m[2] === el.label)
      if (prop) {
        const k = body.findIndex((l) => l.includes(`{${prop[1]}}`) && styleKeysIn(l).length)
        if (k >= 0) return { key: styleKeysIn(body[k])[0], via: `${c} 정의(${b.start + k + 1}줄) {${prop[1]}}` }
      }
    }
  }
  return null
}

// 스타일 정의에 속성을 더하는 수정. 정의가 여러 줄이어도 속성 유무는 객체 전체에서 보고, 수정은 첫 줄({ 바로 뒤)에만 한다.
function addStyleProp (lines, key, prop, value) {
  const i = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*:\\s*\\{`).test(l))
  if (i < 0) return { error: `스타일 ${key} 정의를 찾지 못했다` }
  let depth = 0; let whole = ''
  for (let k = i; k < Math.min(lines.length, i + 20); k++) {
    whole += lines[k] + '\n'
    for (const ch of lines[k]) { if (ch === '{') depth++; else if (ch === '}') depth-- }
    if (depth <= 0) break
  }
  const has = whole.match(new RegExp(`\\b${prop}\\s*:\\s*([^,}\\n]+)`))
  if (has) return { error: `${key}에 이미 ${prop}: ${has[1].trim()}가 있다` }
  const line = lines[i]
  const replace = line.replace(/\{\s*/, () => `{ ${prop}: ${value}, `)
  return { line: i + 1, find: line, replace }
}

function ruleEdits (d, srcRoot) {
  const c = d.causes && d.causes.candidates && d.causes.candidates[0]
  if (!c) return []
  const file = path.join(srcRoot, c.file)
  let lines; try { lines = fs.readFileSync(file, 'utf8').split('\n') } catch (e) { return [] }
  const codes = (d.diag || []).map((g) => g.code)
  const out = []; const seen = new Set()
  const want = codes.includes('flex_min_auto') ? { prop: 'minWidth', value: '0', kind: 'field', why: 'flex 항목의 min-width가 auto라 입력칸 고유 폭보다 줄지 못한다. 줄어들어야 하는 입력칸에 minWidth: 0(K:P02-4)' }
    : codes.includes('narrow_box_squeezed') ? { prop: 'flexShrink', value: '0', kind: 'text', why: '같은 줄의 다른 항목 때문에 라벨이 눌려 줄이 바뀐다. 라벨이 줄어들지 않게 flexShrink: 0' }
      : null
  if (!want) return []
  for (const el of d.elements) {
    if (want.kind === 'field' && !el.fp.startsWith('field|')) continue
    if (want.kind === 'text' && !el.fp.startsWith('text|')) continue
    const sk = findStyleKey(lines, c.line - 1, el)
    if (!sk || seen.has(sk.key)) continue
    seen.add(sk.key)
    const e = addStyleProp(lines, sk.key, want.prop, want.value)
    if (e.error) { out.push({ source: 'rule', file: c.file, skipped: e.error }); continue }
    out.push({ source: 'rule', file: c.file, line: e.line, find: e.find, replace: e.replace, why: `${want.why}. 대상 스타일 ${sk.key}(${sk.via})` })
  }
  return out
}

// 정적 사이트·CSS 규칙 수정안: 결함 요소의 클래스로 CSS 규칙(HTML <style> 또는 .css)을 찾아 선언 하나를 더한다.
// 진단이 분명한 유형만 고른다. 어느 수정이든 사본에서 다시 재서 결함이 사라지고 다른 결함이 안 생긴 것만 남는다
const CSS_FIX = {
  D4: (d, codes) => codes.includes('image_distorted') ? [['object-fit:cover', '그림이 원본 비율과 다르게 늘어났다. object-fit: cover로 비율을 지킨 채 칸을 채운다']] : [],
  R1: (d, codes) => codes.includes('text_no_wrap') ? [['overflow-wrap:anywhere;white-space:normal', '글자가 줄바꿈되지 않아 상자 밖으로 나간다. 긴 단어도 줄을 바꾸게 한다']]
    : [['min-width:0;max-width:100%', '요소가 부모보다 넓어 밖으로 나간다. 줄어들 수 있게 하고 부모 폭을 넘지 않게 한다'], ['flex-wrap:wrap', '한 줄에 다 들어가지 않는 항목을 다음 줄로 넘긴다']],
  R2: () => [['height:auto', '고정 높이 때문에 내용이 잘린다. 높이를 내용에 맞춘다'], ['max-height:none', '최대 높이 때문에 내용이 잘린다'], ['overflow:visible', '넘침 숨김 때문에 내용이 잘린다']],
  R6: () => [['white-space:nowrap', '짧은 라벨이 두 줄로 꺾인다. 한 줄로 둔다'], ['width:auto;white-space:nowrap', '고정 폭이 글자보다 좁아 라벨이 꺾인다. 폭을 글자에 맞추고 한 줄로 둔다']],
  A1: () => [['min-width:44px;min-height:44px', '누를 영역이 기준(24px)보다 작다. 손가락으로 누를 수 있는 44px로 키운다'], ['min-width:24px;min-height:24px', '누를 영역을 기준(24px)까지 키운다']],
  A2: (d, codes, vars) => ['--muted', '--text'].filter((v) => vars.has(v)).map((v) => [`color:var(${v})`, `글자 대비가 기준보다 낮다. 시안 토큰 ${v.slice(2)} 색으로 바꾼다`])
}
const cssFiles = (root) => {
  const out = []
  const walk = (dir, depth) => { for (const n of fs.readdirSync(dir, { withFileTypes: true })) { if (n.name.startsWith('.') || n.name === 'node_modules' || /^dist-dqa/.test(n.name)) continue; const f = path.join(dir, n.name); if (n.isDirectory() && depth < 3) walk(f, depth + 1); else if (/\.(html|css|scss)$/.test(n.name) && fs.statSync(f).size < 400000) out.push(f) } }
  try { walk(root, 0) } catch (e) {}
  return out.slice(0, 40)
}
// 간격 차이(시안 16px, 구현 24px)를 이 요소의 바깥 여백(margin-top·margin-left)으로 맞추는 선언. 여백이 없고 더 벌려야 할 때만 새로 넣는다
function gapDecls (body, d) {
  const out = []
  for (const v of (d.design && d.design.values) || []) {
    if (!['margin-top', 'margin-left'].includes(v.prop)) continue
    const delta = Number(v.impl) - Number(v.design); if (!Number.isFinite(delta) || !delta) continue
    const long = body.match(new RegExp(`(?:^|[;{\\s])${v.prop}\\s*:\\s*(-?[\\d.]+)px`))
    const sh = body.match(/(?:^|[;{\s])margin\s*:\s*([^;}]+)/)
    let cur = null
    if (long) cur = Number(long[1])
    else if (sh) { const t = sh[1].trim().split(/\s+/); const pick = v.prop === 'margin-top' ? t[0] : (t[3] || t[1] || t[0]); if (/^-?[\d.]+px$|^0$/.test(pick)) cur = parseFloat(pick) || 0 }
    if (cur === null && delta > 0) continue // 여백이 이 요소에 없는데 좁혀야 하면 이웃·부모 쪽 문제다
    const next = Math.max(0, Math.round(((cur || 0) - delta) * 10) / 10)
    out.push([`${v.prop}:${next}px`, `이웃과의 간격이 시안(${v.design}px)과 다르다(구현 ${v.impl}px). ${v.prop}를 ${cur === null ? 0 : cur}px에서 ${next}px로 맞춘다`])
  }
  return out
}

// 부모 gap 자체가 관측된 이웃 간격과 같은 경우만, 부모의 gap을 시안 값으로 맞춘다.
function parentGapDecls (body, d) {
  const out = []
  for (const v of (d.design && d.design.values) || []) {
    if (!['margin-left', 'margin-top'].includes(v.prop)) continue
    const prop = v.prop === 'margin-left' ? 'column-gap' : 'row-gap'
    for (const key of [prop, 'gap']) {
      const m = body.match(new RegExp(`(?:^|[;{\\s])${key}\\s*:\\s*([\\d.]+)px(?:\\s*!important)?\\s*(?=;|$)`))
      if (m && Math.abs(Number(m[1]) - Number(v.impl)) < 0.5 && Number.isFinite(Number(v.design)) && Number(v.design) >= 0) {
        out.push([`${key}:${v.design}px`, `부모의 ${key}(${v.impl}px)가 측정된 이웃 간격과 같다. 시안 간격 ${v.design}px로 맞춘다`]); break
      }
    }
  }
  return out
}

// 규칙 본문에 선언을 넣는다: 같은 속성이 있으면 값만 바꾸고(색 하나뿐인 background 줄임 속성도), 없으면 끝에 더한다. 원래 띄어쓰기를 따른다
function setDecls (body, decl) {
  let b = body
  const sp = /:\s/.test(body) ? ': ' : ':'
  for (const d of decl.split(';').map((x) => x.trim()).filter(Boolean)) {
    const i = d.indexOf(':'); const prop = d.slice(0, i).trim(); const val = d.slice(i + 1).trim()
    const re = new RegExp(`(^|[;{\\s])(${prop.replace(/[-]/g, '\\-')})(\\s*:\\s*)([^;}]*)`)
    const short = prop === 'background-color' ? /(^|[;{\s])(background)(\s*:\s*)(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|var\([^)]*\)|[a-z]+)(\s*!important)?(\s*)(?=;|$)/ : null
    if (re.test(b)) b = b.replace(re, (m, a, p, c, old) => `${a}${p}${c}${val}${/!important\s*$/.test(old) && !/!important/.test(val) ? '!important' : ''}`)
    else if (short && short.test(b)) b = b.replace(short, (m, a, p, c, v, priority, t) => `${a}${p}${c}${val}${priority || ''}${t}`)
    else { const t = b.match(/\s*$/)[0]; const core = b.slice(0, b.length - t.length).replace(/;\s*$/, ''); b = `${core}${core.trim() ? ';' : ''}${core.trim() ? ' ' : ''}${prop}${sp}${val};${t || ''}` }
  }
  return b
}
const specificity = (sel) => (sel.match(/#[\w-]+/g) || []).length * 100 + (sel.match(/[.:[][\w-]/g) || []).length * 10 + (sel.match(/(^|[\s>+~])[a-z][\w-]*/g) || []).length
function cssRuleEdits (d, srcRoot) {
  const codes = (d.diag || []).map((g) => g.code)
  const files = cssFiles(srcRoot).map((f) => ({ f, rel: path.relative(srcRoot, f), text: fs.readFileSync(f, 'utf8') }))
  if (!files.length) return []
  const vars = new Set(files.flatMap((x) => [...x.text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])))
  // 시안 비교 결함은 시안 값(색·글자·모서리·크기 방식)을 그대로 넣어 본다
  const decls = d.kind === 'design' ? designCss(d, vars) : (CSS_FIX[d.rule] || (() => []))(d, codes, vars)
  // 간격(L2)은 고칠 값이 규칙 본문(지금 margin)에 달려 있어, 규칙을 찾은 뒤 계산한다
  const gapFix = d.kind === 'design' && d.rule === 'L2'
  if (!decls.length && !gapFix) return []
  // 결함 요소의 클래스마다, 마지막 겹 선택자가 그 클래스를 가진 규칙 중 가장 구체적인(같으면 나중) 규칙
  const out = []; const seen = new Set()
  for (const el of (d.elements || []).slice(0, 3)) {
    // 클래스가 있으면 그 클래스로, 없으면 부모 클래스 + 태그(.serv b)로 규칙을 찾는다
    const keys = (el.cls && el.cls.length) ? el.cls.map((c) => ({ last: new RegExp(`\\.${c.replace(/[^\w-]/g, '')}(?![\\w-])`), parent: null }))
      : (el.pcls || []).map((c) => ({ last: new RegExp(`^${String(el.tag || '').replace(/[^\w-]/g, '')}$`), parent: new RegExp(`\\.${c.replace(/[^\w-]/g, '')}(?![\\w-])`) }))
    if (gapFix) keys.push(...[...(el.pcls || []), ...(el.ancestors || []).filter(a => (d.design?.values || []).some(v => Math.abs(parseFloat(v.prop === 'margin-top' ? a.rowGap : a.columnGap) - Number(v.impl)) < 0.5)).flatMap(a => a.cls)].map(c => ({ last: new RegExp(`\\.${c.replace(/[^\w-]/g, '')}(?![\\w-])`), parent: null, gapParent: true })))
    for (const key of el.tag || el.cls ? keys : []) {
      let best = null
      for (const x of files) {
        for (const m of x.text.matchAll(/([^{}<>]+)\{([^{}]*)\}/g)) {
          const sel = m[1].trim(); if (sel.startsWith('@') || sel.startsWith(':root')) continue
          const hit = sel.split(',').map((t) => t.trim()).filter((t) => { const parts = t.split(/[\s>+~]+/); return key.last.test(parts[parts.length - 1]) && (!key.parent || parts.slice(0, -1).some((q) => key.parent.test(q))) })
          if (!hit.length) continue
          const sp = Math.max(...hit.map(specificity))
          if (!best || sp >= best.sp) best = { x, sp, rule: m[0], at: m.index, body: m[2], hit, selector: sel }
        }
      }
      if (!best || seen.has(best.rule) || best.x.text.split(best.rule).length - 1 !== 1) continue
      seen.add(best.rule)
      const line = best.x.text.slice(0, best.at).split('\n').length
      for (const [decl, why] of (gapFix ? (key.gapParent ? parentGapDecls(best.body, d) : gapDecls(best.body, d)) : decls)) {
        const replacement = best.selector.includes(',') && best.hit.length < best.selector.split(',').length ? best.rule + '\n' + best.hit.join(', ') + '{' + decl + '}' : best.rule.replace(`{${best.body}}`, `{${setDecls(best.body, decl)}}`)
        out.push({ source: 'rule', file: best.x.rel, line, find: best.rule, replace: replacement, decl, why: `${why}. 대상 CSS 규칙 ${best.rule.split('{')[0].trim()}` })
      }
    }
  }
  return out.slice(0, 4)
}

// 빌드 결과 폴더만 준 검사라도, 번들 없이 index.html과 CSS로 된 정적 사이트면 그 폴더가 곧 소스다
function staticSource (head) {
  // 소스 경로가 따로 있는 실행(저장소·빌드 사본)은 빌드 설정이 있어야 한다. 빌드 결과를 소스로 잘못 보지 않는다
  if (head.kind !== 'dist' || head.src || !head.dist || !fs.existsSync(path.join(head.dist, 'index.html')) || fs.existsSync(path.join(head.dist, 'package.json'))) return null
  let bundle = fs.existsSync(path.join(head.dist, '_expo')) || fs.existsSync(path.join(head.dist, '_next'))
  const walk = (dir, depth) => { for (const n of fs.readdirSync(dir, { withFileTypes: true })) { if (bundle) return; const f = path.join(dir, n.name); if (n.isDirectory()) { if (depth < 8 && n.name !== 'node_modules') walk(f, depth + 1) } else if (/\.m?js$/.test(n.name) && fs.statSync(f).size > 150000) bundle = true } }
  walk(head.dist, 0)
  return bundle ? null : { srcRoot: head.dist, repoCfg: { name: 'static', app_dir: '.', src_dir: '.', build_args: null } }
}

// 클래스 이름이 기록되기 전에 잰 실행: 정적 소스를 한 번 띄워 결함 요소를 경로·라벨로 찾아 클래스를 채운다
async function fillClasses (browser, srcRoot, targets, sizes) {
  const need = targets.flatMap((d) => d.elements || []).filter((e) => !e.cls && e.path)
  if (!need.length) return
  const first = (sizes && sizes[0]) || [375, 812]
  const [w, h] = Array.isArray(first) ? first : String(first).split('@')[0].split('x').map(Number)
  const s = await serveDist(srcRoot)
  const ctx = await newContext(browser, { origin: s.origin, width: w, height: h, allowHosts: [], blocked: [] })
  try {
    const page = await ctx.newPage(); await page.goto(s.origin + '/'); await settle(page, { stableMs: 300, timeoutMs: 3000 })
    const found = await page.evaluate((els) => els.map((e) => {
      let list = []; try { list = [...document.querySelectorAll(e.path)] } catch (x) {}
      const lab = (n) => (n.getAttribute('aria-label') || n.placeholder || n.getAttribute('alt') || n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
      const hit = list.find((n) => !e.label || lab(n) === e.label) || list[0]
      return hit ? { cls: [...hit.classList].slice(0, 6), pcls: hit.parentElement ? [...hit.parentElement.classList].slice(0, 4) : [] } : { cls: [], pcls: [] }
    }), need.map((e) => ({ path: e.path, label: e.label })))
    need.forEach((e, i) => { e.cls = found[i].cls; e.pcls = found[i].pcls })
  } finally { await ctx.close(); s.close() }
}

// ── 사본·빌드·재측정 ─────────────────────────────────────────
function makeScratch (srcRoot, dir, cfg) {
  assertAllowedPath(srcRoot, cfg); assertAllowedPath(dir, cfg)
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.dirname(dir), { recursive: true })
  execFileSync('cp', ['-c', '-R', srcRoot, dir], { timeout: 180000 })
  const g = path.join(dir, '.git'); if (fs.existsSync(g) && fs.statSync(g).isFile()) fs.rmSync(g) // worktree 연결 파일은 지운다(사본에서 git이 원본을 건드리지 않게)
}

// 빌드 인자에 {out}이 있으면 그 자리에 출력 폴더를 넣고, 없으면 --output-dir을 붙인다(돌아오길 expo export).
// 빌드 인자가 없으면(정적 사이트) 사본 자체가 결과다. {out}을 받지 않는 도구는 build/·dist/를 옮긴다(react-scripts).
function build (appDir, repoCfg, outDir, timeoutMs) {
  if (!repoCfg.build_args) {
    fs.rmSync(path.join(appDir, outDir), { recursive: true, force: true })
    fs.symlinkSync('.', path.join(appDir, outDir)) // 사본 폴더 자체를 띄운다
    return Promise.resolve({ ok: fs.existsSync(path.join(appDir, 'index.html')), ms: 0, log: '' })
  }
  const hasOut = repoCfg.build_args.includes('{out}')
  const args = hasOut ? repoCfg.build_args.map((a) => (a === '{out}' ? outDir : a)) : repoCfg.name === 'local' ? repoCfg.build_args : [...repoCfg.build_args, '--output-dir', outDir]
  return new Promise((resolve) => {
    const t0 = Date.now(); let log = ''
    const child = spawn('npx', args, { cwd: appDir, env: { ...process.env, ...repoCfg.build_env } })
    child.stdout.on('data', (c) => { log += c }); child.stderr.on('data', (c) => { log += c })
    const tm = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.on('exit', (code) => {
      clearTimeout(tm)
      if (!hasOut && repoCfg.name === 'local') for (const d of ['build', 'dist']) { const p = path.join(appDir, d); if (code === 0 && fs.existsSync(path.join(p, 'index.html'))) { fs.rmSync(path.join(appDir, outDir), { recursive: true, force: true }); fs.renameSync(p, path.join(appDir, outDir)); break } }
      resolve({ ok: code === 0 && fs.existsSync(path.join(appDir, outDir, 'index.html')), ms: Date.now() - t0, log: log.slice(-3000) })
    })
  })
}

async function measureBuild (browser, distDir, recipes, sizes, run, cfg, side, designs, interactions) {
  const s = await serveDist(distDir)
  try {
    const out = []; out.measurements = []; out.interactions = []; out.designs = {}; out.journeys = []
    for (const r of recipes) {
      const res = await sweep(browser, { origin: s.origin, recipe: r, sizes, side, run, cfg })
      out.measurements.push(...res)
      const ds = buildDefects(res, { screen: r.id, side, ref: side })
      out.push(...ds, ...crossWidth(res, ds, { screen: r.id, side, ref: side }))
      if (res.some((x) => !x.ok)) out.failed = (out.failed || 0) + res.filter((x) => !x.ok).length
      // 시안이 있던 화면은 시안 비교도 다시 한다(시안 결함의 수정 확인, 규칙 수정이 시안과 멀어지게 했는지 확인)
      if (designs && designs[r.id]) {
        const widest = Math.max(...sizes.map((x) => (Array.isArray(x) ? x[0] : Number(String(x).split('x')[0]))))
        try { const dp = await designPass(browser, { origin: s.origin, recipe: r, spec: designs[r.id], side, ref: side, run, cfg, altWidth: widest }); out.push(...dp.defects); out.designs[r.id] = dp.summary } catch (e) { out.failed = (out.failed || 0) + 1 }
      }
      // 원래 눌러 보기까지 검사했다면 CSS 수정으로 버튼 동작이 깨지는지도 다시 확인한다.
      for (const [key, previous] of Object.entries(interactions || {}).filter(([key]) => key === r.id || key.startsWith(r.id + '@'))) {
        const size = String(previous.size).split('x').map(Number)
        try {
          const ip = await interactPass(browser, { origin: s.origin, recipe: r, side, ref: side, run, cfg, size, spec: designs && designs[r.id], max: 30 })
          out.push(...ip.defects)
          out.interactions.push({ screen: r.id, size: previous.size, clicked: ip.counters.clicked, defects: ip.defects.length, prototype_matched: ip.counters.prototype_matched, actions: ip.results.filter(x => !x.skip).map(x => ({ label: x.label, path: x.path, landing: x.landing?.url, verdict: x.verdict || null, prototype: x.prototype_check?.status, after_shot: x.after_shot || null })) })
        } catch (e) { out.failed = (out.failed || 0) + 1 }
      }
    }
    for (const r of recipes.filter(r=>r.journeys?.length)) {
      const journeys = await require('../recipes/journeys').runJourneys(browser,{origin:s.origin,recipe:r,sizes,run,side})
      out.journeys.push(...journeys)
    }
    const merged = new Map()
    for (const d of out) { const old = merged.get(d.id); if (old) { old.widths.push(...d.widths); old.max_px = Math.max(old.max_px || 0, d.max_px || 0) } else merged.set(d.id, d) }
    const rows = [...merged.values()]; rows.failed = out.failed; rows.measurements = out.measurements; rows.interactions = out.interactions; rows.designs = out.designs; rows.journeys = out.journeys
    return rows
  } finally { s.close() }
}

function judgeAfter (original, after, targetIds) {
  const orig = JSON.parse(JSON.stringify(original)); const aft = JSON.parse(JSON.stringify(after))
  const { resolved } = compare(orig, aft) // orig = 수정 전(기준), aft = 수정 후
  const fixed = [...new Set(resolved.filter(d => !aft.some(a => a.id === d.id)).map((d) => d.id))]
  const regress = aft.filter((d) => d.diff && (d.diff.status === 'new' || d.diff.status === 'worsened')).map((d) => ({ id: d.id, rule: d.rule, screen: d.screen, labels: d.labels.slice(0, 3), status: d.diff.status, px: d.max_px }))
  for (const d of aft) {
    const previous = orig.find(x => x.id === d.id)
    if (!previous || regress.some(x => x.id === d.id)) continue
    const added = (d.widths || []).filter(w => !(previous.widths || []).some(b => b.w === w.w && b.h === w.h))
    if (added.length) regress.push({ id: d.id, rule: d.rule, screen: d.screen, labels: d.labels.slice(0, 3), status: 'new', sizes: added.map(w => `${w.w}x${w.h}`), px: d.max_px })
  }
  const stillThere = targetIds.filter((id) => !fixed.includes(id))
  return { fixed, regress, ok: stillThere.length === 0 && regress.length === 0, still: stillThere }
}

function unifiedDiff (rel, before, after, tmp) {
  const a = path.join(tmp, 'a.txt'); const b = path.join(tmp, 'b.txt')
  fs.writeFileSync(a, before); fs.writeFileSync(b, after)
  let out = ''
  try { out = execFileSync('git', ['diff', '--no-index', '--no-color', '-U3', a, b], { encoding: 'utf8' }) } catch (e) { out = e.stdout || '' }
  return out.split('\n').map((l) => l.startsWith('diff --git') ? `diff --git a/${rel} b/${rel}` : l.startsWith('--- ') ? `--- a/${rel}` : l.startsWith('+++ ') ? `+++ b/${rel}` : l).filter((l) => !l.startsWith('index ')).join('\n')
}

// 여러 수정을 파일별로 합쳐 적용한 결과 문자열
function applyEdits (srcRoot, edits) {
  const byFile = new Map()
  const ranged=new Map()
  for(const e of edits.filter(e=>e.range)){if(!ranged.has(e.file))ranged.set(e.file,[]);ranged.get(e.file).push(e)}
  for(const [file,rs] of ranged){const before=fs.readFileSync(path.join(srcRoot,file),'utf8');const unique=[...new Map(rs.map(e=>[JSON.stringify(e.range)+e.replace,e])).values()];byFile.set(file,{before,after:require('./source-edit').applyRanges(before,unique)})}
  for (const e of edits.filter(e=>!e.range)) {
    const f = path.join(srcRoot, e.file)
    const cur = byFile.has(e.file) ? byFile.get(e.file).after : fs.readFileSync(f, 'utf8')
    if (!byFile.has(e.file)) byFile.set(e.file, { before: cur, after: cur })
    const st = byFile.get(e.file)
    st.moved = st.moved || new Map() // 원래 CSS 규칙 → 앞선 수정이 바꾼 지금 모양
    // 같은 CSS 규칙을 앞선 수정이 이미 바꿨으면, 지금 모양에 이 수정의 선언을 더한다(여러 결함이 한 규칙을 고칠 때)
    if (e.decl && st.after.split(e.find).length - 1 === 0 && st.moved.has(e.find)) {
      const cur = st.moved.get(e.find); const a = cur.indexOf('{'); const b = cur.lastIndexOf('}')
      const next = `${cur.slice(0, a + 1)}${setDecls(cur.slice(a + 1, b), e.decl)}${cur.slice(b)}`
      if (st.after.split(cur).length - 1 !== 1) throw new Error(`적용 실패: ${e.file}에서 합칠 규칙이 한 번이 아니다`)
      st.after = st.after.replace(cur, next); st.moved.set(e.find, next)
      continue
    }
    if (st.after.split(e.find).length - 1 !== 1) throw new Error(`적용 실패: ${e.file}에서 찾을 줄이 한 번이 아니다`)
    st.after = st.after.replace(e.find, e.replace)
    if (e.decl) st.moved.set(e.find, e.replace)
  }
  return byFile
}

// 수정 검증이 가능한 실행인지(화면이 버튼 대신 이유를 보여 주는 데 쓴다). fixRun의 전제 조건과 같다
function fixability (m, cfg) {
  if (m.status === 'incomplete' || m.error || (m.failures || []).length) return { ok: false, reason: '검사가 불완전합니다. 검사 실패를 해결한 뒤 다시 검사하세요.' }
  const head = (m.targets && m.targets.head) || {}
  if (head.kind === 'url') return { ok: false, reason: '로컬 주소 대상은 사본을 만들 수 없어 수정 검증을 하지 않습니다. 원인 파일을 직접 고치세요.' }
  const repoCfg = m.local ? m.local.repoCfg : cfg.repos[m.repo || head.repo || (cfg.dists[head.ref] && cfg.dists[head.ref].repo)]
  if (head.src && repoCfg) return { ok: true }
  if (staticSource(head)) return { ok: true, static: true }
  return { ok: false, reason: '이 실행은 번들된 빌드 결과 폴더만으로 검사해 소스와 빌드 방법을 모릅니다. 작업 폴더(dqa check --local)나 저장소(--repo, --pr)로 다시 검사하면 수정안을 만들 수 있습니다.' }
}

async function fixRun (args, cfg) {
  const runId = args.run
  const runDir = path.join(RUNS, String(runId || ''))
  if (!runId || !fs.existsSync(path.join(runDir, 'manifest.json'))) throw new Error('--run <실행 ID>가 필요하다')
  const m = readJSON(path.join(runDir, 'manifest.json'))
  if (m.status === 'incomplete' || m.error || (m.failures || []).length) throw new Error('검사가 불완전해 수정 검증을 시작하지 않는다. 검사 실패를 해결한 뒤 다시 검사한다')
  const original = readJSON(path.join(runDir, 'defects.json'), [])
  const head = m.targets.head
  if (head.kind === 'url') throw new Error('로컬 주소 대상은 사본을 만들 수 없어 수정 검증을 하지 않는다(빌드·저장소 대상만)')
  let repoCfg = m.local ? m.local.repoCfg : cfg.repos[m.repo || head.repo || (cfg.dists[head.ref] && cfg.dists[head.ref].repo)]
  let srcPath = head.src
  if (!srcPath || !repoCfg) { const st = staticSource(head); if (st) { srcPath = st.srcRoot; repoCfg = st.repoCfg } }
  if (!srcPath || !repoCfg) throw new Error('소스 위치나 빌드 설정이 없어 다시 빌드할 수 없다. 번들된 빌드 결과 폴더만 준 검사는 수정안을 만들 수 없다. 작업 폴더(dqa check --local)나 저장소(--repo)로 검사한 뒤 수정한다')
  const srcRoot = assertAllowedPath(srcPath, cfg)
  const ev = createRun('fix', runId) // 같은 실행 폴더의 events.jsonl에 이어 쓴다
  const say = (msg) => ev.event('fix', msg)
  // 모든 미승인 결함을 대상으로 한다. CSS 규칙을 먼저 시도하고, 동작 결함은 제한된 코드 에이전트 루프로 검증한다.
  const targets = original.filter((d) => !d.accepted && d.rule !== 'R5' && (!args.defect || d.id === args.defect))
  const judgeable = (ds) => ds.filter((d) => d.rule !== 'R5')
  const fixDir = path.join(runDir, 'fix'); fs.mkdirSync(fixDir, { recursive: true })
  fs.rmSync(path.join(fixDir, 'comparison.json'), { force: true }); fs.rmSync(path.join(fixDir, 'fix_all.patch'), { force: true }); fs.rmSync(path.join(fixDir, 'source'), { recursive: true, force: true })
  const result = { started_at: new Date().toISOString(), run_id: runId, items: [], combined: null, llm: null }
  const save = () => writeJSON(path.join(fixDir, 'fixes.json'), result)
  save()
  if (!targets.length) { result.note = '자동 수정 대상이 없습니다'; result.finished_at = new Date().toISOString(); result.summary = { targets: 0, verified: 0, combined_fixed: 0, combined_regress: 0 }; save(); say(result.note); return result }
  cfg = { ...cfg, repair_targets: Object.fromEntries(m.recipes.map(r => [r.id, original.filter(d => d.screen === r.id).map(d => ({ id: d.id, selector: d.elements?.[0]?.path || d.elements?.[0]?.selector })).filter(x => x.selector)])) }
  const recipes = m.recipes.map((r) => loadRecipe(r.id))
  // 기준 크기와 추가 검사 크기를 모두 다시 측정한다. 시안 비교와 겹쳐도 규칙 측정을 생략하지 않는다.
  const sizes = [...new Map(m.sizes.map(x => [Array.isArray(x) ? x.join('x') : x, x])).values()]
  const designs = m.design_summary ? Object.fromEntries(Object.entries(m.design || {}).map(([k, v]) => [k, readJSON(path.join(runDir, v.json), null)]).filter(([, v]) => v)) : null
  const scratch = path.join(home(cfg.fix.scratch), runId)
  say(`사본 만드는 중: ${srcRoot} → ${scratch}`)
  makeScratch(srcRoot, scratch, cfg)
  const appDir = path.join(scratch, repoCfg.app_dir)
  const modelOnly = args['repair-mode'] === 'model-only'
  if(args['repair-mode'] && !['auto','model-only'].includes(args['repair-mode'])) throw new Error('지원하지 않는 repair-mode')
  const llmOk = args.llm !== 'off' ? await preflight(cfg) : { ok: false, reason: '--llm off' }
  result.llm = llmOk.ok ? { status: 'ok', model: cfg.ollama.model } : { status: 'skipped', reason: llmOk.reason }
  result.repair_mode = modelOnly ? 'model-only' : 'auto'
  save()
  if(modelOnly && !llmOk.ok) throw new Error('모델 전용 수정 중단: '+llmOk.reason)
  if(modelOnly) say('모델 전용 수정: 규칙 패치 생략 · 모델이 파일을 읽고 수정안을 선택합니다')
  const browser = await launch()
  if (repoCfg.name === 'static') await fillClasses(browser, srcRoot, targets, sizes).catch(() => {})
  const tmp = path.join(fixDir, '.tmp'); fs.mkdirSync(tmp, { recursive: true })
  let attemptNo = 0
  try {
    // Fresh baseline provides paired screenshots and detects stale measurements before editing.
    const baselineBuild = await build(appDir, repoCfg, 'dist-dqa-baseline', cfg.fix.build_timeout_ms)
    if (!baselineBuild.ok) throw new Error('수정 전 사본 빌드 실패: ' + baselineBuild.log)
    say('수정 전 기준 화면과 버튼을 다시 확인합니다')
    const before = await measureBuild(browser, path.join(appDir, 'dist-dqa-baseline'), recipes, sizes, ev, cfg, 'fix-before', designs, m.interact_summary)
    fs.rmSync(path.join(appDir, 'dist-dqa-baseline'), { recursive: true, force: true })
    if (before.failed) throw new Error('수정 전 재측정 실패. 해결 판정을 중단합니다')
    if (before.journeys.some(j=>!j.ok)) say('수정 전 사용자 흐름 실패를 기록했습니다. 중간 후보는 악화 금지, 최종 사본은 모든 흐름 통과가 필요합니다')
    const drift = compare(JSON.parse(JSON.stringify(original)), JSON.parse(JSON.stringify(before)))
    if (drift.resolved.some(d => targets.some(t => t.id === d.id))) throw new Error('수정 전 결함이 재현되지 않습니다. 새 검사 후 수정하세요')
    for (const d of targets) {
      const size = d.widths?.[0]
      const measured = before.measurements.find(x => x.screen === d.screen && (!size || x.w === size.w && x.h === size.h))
      const box = measured?.steps?.find(x => (x.y || 0) === (size?.scroll_y || 0))?.targets?.[d.id]
      if (box && d.elements?.[0]) d.elements[0].ancestors = box.ancestors
    }
    writeJSON(path.join(fixDir, 'before-defects.json'), before)
    const proposals = new Map(targets.map(d => [d.id, [...require('./source-edit').svgColorEdits(d,srcRoot), ...ruleEdits(d, srcRoot), ...cssRuleEdits(d, srcRoot), ...textEdits(d, srcRoot)]]))
    const { groupTargets, designContracts, finalState, componentUsages } = require('./app-plan')
    const plan = { schema: 1, run_id: runId, status: 'running', policy: 'all-registered-screens', budgets: { tasks: cfg.fix.max_defects, model_steps_per_task: 12, edits_per_task: 3 }, screens: recipes.map(r => r.id), sizes, contracts: designContracts(designs), code_usage: componentUsages(srcRoot, recipes), tasks: require('./app-plan').prioritize(groupTargets(targets, proposals, recipes.map(r => r.id)), targets).slice(0, cfg.fix.max_defects), started_at: new Date().toISOString() }
    result.app_plan = plan
    const checkpoint = () => { plan.updated_at = new Date().toISOString(); writeJSON(path.join(fixDir, 'app-plan.json'), plan); save() }
    checkpoint()
    say(`앱 계획: 결함 ${targets.length}건 → 공통 원인 후보 ${plan.tasks.length}개 · 전체 ${plan.screens.length}화면 회귀검증`)
    let activeTask = null; const triedPatches = new Set()
    const tryEdits = async (edits, label, targetIds, final = false) => {
      attemptNo++
      let changed
      try { changed = applyEdits(srcRoot, edits); require('../code/source-context').assertDataBackedChanges(changed, targets.filter(d=>targetIds.includes(d.id)), {srcRoot,srcDir:repoCfg.src_dir}) } catch (e) { return { ok: false, error: e.message } }
      const fingerprint = sha1(JSON.stringify([...changed].map(([rel, st]) => [rel, st.after]).sort()))
      if (!final && triedPatches.has(fingerprint)) return { ok:false, error:'이미 시험한 것과 완전히 같은 코드 결과입니다. 실패했던 선택자 범위를 바꾸세요', still:targetIds, regress:[], duplicate:true }
      if (!final) triedPatches.add(fingerprint)
      for (const [rel, st] of changed) fs.writeFileSync(path.join(scratch, rel), st.after)
      const outDir = `dist-dqa-fix${attemptNo}`
      say(`${label}: 빌드 중`)
      const b = await build(appDir, repoCfg, outDir, cfg.fix.build_timeout_ms)
      let verdict = { ok: false }
      if (b.ok) {
        say(`${label}: 빌드 ${(b.ms / 1000).toFixed(1)}초, 재측정 중`)
        const after = await measureBuild(browser, path.join(appDir, outDir), recipes, sizes, ev, cfg, `fix${attemptNo}`, designs, m.interact_summary)
        verdict = { ...judgeAfter(judgeable(before), judgeable(after), targetIds), after: after.map((d) => ({ id: d.id, screen: d.screen, rule: d.rule, labels: d.labels.slice(0, 3), widths: d.widths.map((w) => `${w.w}x${w.h}:${w.px}`) })), failed_sizes: after.failed || 0 }
        verdict.coverage_errors = [...require('./comparison').coverage(before, after), ...require('../recipes/journeys').journeyRegressions(before.journeys,after.journeys,final)]
        verdict.journeys = after.journeys || []
        if (after.failed || verdict.coverage_errors.length) verdict.ok = false
        if (final) {
          const { comparison } = require('./comparison')
          const report = comparison(before, after, m, verdict)
          writeJSON(path.join(fixDir, 'comparison.json'), report)
          writeJSON(path.join(fixDir, 'after-defects.json'), after)
          verdict.comparison = 'fix/comparison.json'
          if (verdict.ok) for (const [rel, st] of changed) {
            const dest = path.join(fixDir, 'source', rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, st.after)
          }
        }
      }
      for (const [rel, st] of changed) fs.writeFileSync(path.join(scratch, rel), st.before) // 사본을 원래대로
      fs.rmSync(path.join(appDir, outDir), { recursive: true, force: true })
      const patch = [...changed].map(([rel, st]) => unifiedDiff(rel, st.before, st.after, tmp)).join('\n')
      const outcome = { ...verdict, build_ok: b.ok, build_ms: b.ms, build_log: b.ok ? undefined : b.log, patch }
      if (activeTask && !final) {
        activeTask.status = outcome.ok ? 'verified' : 'replanning'
        activeTask.attempts.push({ attempt: attemptNo, at: new Date().toISOString(), label, edits, ok: outcome.ok, fixed: outcome.fixed || [], regress: outcome.regress || [], coverage_errors: outcome.coverage_errors || [], build_ok: b.ok })
        checkpoint()
      }
      return outcome
    }

    for (const task of plan.tasks) {
      const covered = result.items.find(item => item.verified !== null && task.target_ids.every(id => (item.attempts[item.verified].fixed || []).includes(id)))
      if (covered) { task.status = 'verified'; task.resolved_by_task = covered.task_id; checkpoint(); say(`공통 수정으로 함께 해결된 작업 ${task.id}: 최종 묶음 검증에서 다시 확인합니다`); continue }
      activeTask = task; task.status = 'inspecting'; checkpoint()
      const d = targets.find(x => x.id === task.representative)
      const item = { defect_id: d.id, rule: d.rule, labels: d.labels.slice(0, 4), problem: d.judge && d.judge.status === 'ok' ? { problem: d.judge.problem, expected: d.judge.expected } : null, attempts: [], trail: [], verified: null }
      item.task_id = task.id; item.target_ids = task.target_ids; item.affected_screens = task.affected_screens
      result.items.push(item)
      if (d.judge && d.judge.status === 'ok' && d.judge.verdict !== '결함') { item.skipped = `보고서 에이전트 판정이 "${d.judge.verdict}"라 고치지 않는다`; say(`${d.rule} ${d.labels.slice(0, 2).join(',')}: ${item.skipped}`); save(); continue }
      const r = await codeAgent(d, { cfg, srcRoot, srcDir: repoCfg.src_dir, sourceHints: recipes.find(r=>r.id===d.screen)?.source_hints || [], tryEdits, say, modelOnly, firstEdits: modelOnly ? [] : proposals.get(d.id), targetIds: task.target_ids, taskTargets: targets.filter(x=>task.target_ids.includes(x.id)).map(x=>({id:x.id,screen:x.screen,rule:x.rule,labels:x.labels,values:x.design?.values})), appContracts: plan.contracts, appSources: plan.code_usage, onObservation: o => { (task.observations ||= []).push({at:new Date().toISOString(),...o}); checkpoint() }, onAction: a => { task.decisions.push({ at: new Date().toISOString(), ...a }); checkpoint() }, llm: llmOk.ok })
      Object.assign(item, { attempts: r.attempts, trail: r.trail, verified: r.verified })
      task.status = r.verified === null ? 'unresolved' : 'verified'; checkpoint()
    }
    // 검증된 수정을 모두 함께 적용해 한 번 더 확인
    const verified = result.items.filter((x) => x.verified !== null).map((x) => x.attempts[x.verified])
    if (verified.length) {
      const edits = verified.flatMap((a) => a.edits)
      const uniq = require('./source-edit').uniqueEdits(edits)
      const r = await tryEdits(uniq, `검증된 수정 ${verified.length}개 함께 적용`, result.items.filter((x) => x.verified !== null).flatMap((x) => x.target_ids || [x.defect_id]), true)
      // 적용(dqa apply) 때 작업 폴더 파일이 검사 뒤에 바뀌지 않았는지 보려고, 고칠 파일의 원래 내용 해시를 남긴다
      const beforeHash = Object.fromEntries([...applyEdits(srcRoot, uniq)].map(([rel, st]) => [rel, sha1(st.before)]))
      result.combined = { edits: uniq, ...r, fixed_count: r.fixed ? r.fixed.length : 0, before_sha1: beforeHash }
      fs.writeFileSync(path.join(fixDir, 'fix_all.patch'), r.patch)
      say(`함께 적용: 결함 ${r.fixed ? r.fixed.length : 0}건 사라짐, 다른 결함 생김·악화 ${r.regress ? r.regress.length : '?'}건`)
    }
    Object.assign(plan, finalState(original, result.combined), { finished_at: new Date().toISOString() }); checkpoint()
    if (!result.combined) writeJSON(path.join(fixDir, 'comparison.json'), require('./comparison').comparison(before, [], m, { ok: false, fixed: [], regress: [] }))
    for (const x of result.items) {
      if (x.verified !== null) {
        fs.writeFileSync(path.join(fixDir, `${x.defect_id}.patch`), x.attempts[x.verified].patch)
        x.before_sha1 = Object.fromEntries([...applyEdits(srcRoot, x.attempts[x.verified].edits)].map(([rel, st]) => [rel, sha1(st.before)]))
      }
      x.resolved_by_combined = !!(result.combined && result.combined.ok === true && (result.combined.fixed || []).includes(x.defect_id))
    }
  } finally {
    await browser.close().catch(() => {})
    if (llmOk.ok) await unload(cfg)
    fs.rmSync(tmp, { recursive: true, force: true })
    if (!args.keep) fs.rmSync(scratch, { recursive: true, force: true })
  }
  result.finished_at = new Date().toISOString()
  result.summary = { targets: targets.length, verified: result.items.filter((x) => x.verified !== null).length, combined_fixed: result.combined ? result.combined.fixed_count : 0, combined_regress: result.combined && result.combined.regress ? result.combined.regress.length : null }
  save()
  m.fix = result.summary; writeJSON(path.join(runDir, 'manifest.json'), m)
  fs.writeFileSync(path.join(fixDir, 'fix_report.md'), fixReport(result, original))
  say(`끝: 대상 ${result.summary.targets}건 중 검증된 수정 ${result.summary.verified}건${result.combined ? `, 함께 적용 시 ${result.summary.combined_fixed}건 사라짐` : ''}`)
  return result
}

function fixReport (r, original) {
  const L = ['## 수정 제안(사본에 적용·빌드·재측정으로 검증)', '']
  const s = r.summary || {}
  L.push(`- 대상 결함 ${s.targets}건 중 단독으로 검증된 수정 ${s.verified}건${r.combined ? ` · 검증된 수정을 함께 적용하면 결함 ${s.combined_fixed}건이 사라지고 다른 결함은 ${s.combined_regress}건 생기거나 커진다` : ''}`)
  L.push(`- 원본 소스와 사용자 작업본은 바꾸지 않았다. 적용은 \`git apply fix/fix_all.patch\`로 직접 한다.`)
  L.push(`- LLM: ${r.llm && r.llm.status === 'ok' ? r.llm.model : `사용 안 함(${r.llm && r.llm.reason})`}`)
  L.push('')
  for (const x of r.items) {
    const d = original.find((o) => o.id === x.defect_id) || {}
    const head = `### [${x.rule} ${d.rule_name || ''}] ${x.labels.join(', ')}`
    L.push(head, '')
    if (x.problem) { L.push(`- 문제(보고서 에이전트): ${x.problem.problem}`); L.push(`- 원본(기대): ${x.problem.expected}`) }
    if (x.skipped) { L.push(`- 결과: 고치지 않음 — ${x.skipped}`, ''); continue }
    if (x.verified !== null) L.push('- 결과: **검증된 수정 있음**')
    else if (x.resolved_by_combined) L.push('- 결과: 자체 수정안은 통과하지 못했지만, 다른 결함의 검증된 수정을 함께 적용하면 사라진다')
    else L.push('- 결과: 검증된 수정 없음(사람 확인 필요)')
    if (x.trail && x.trail.length) { L.push('- 코드 에이전트 행동:'); x.trail.forEach((s) => L.push(`  - ${s.step}. ${s.action}${s.detail ? ` \`${s.detail}\`` : ''} → ${s.result}`)) }
    L.push('- 검증한 수정:')
    x.attempts.forEach((a, i) => {
      if (!a.edits) { L.push(`  ${i + 1}. ${a.source === 'rule' ? '규칙' : 'LLM'}: 건너뜀 — ${a.skipped}`); return }
      const e = a.edits[0]
      const res = a.skipped ? `건너뜀 — ${a.skipped}` : a.ok ? '통과(결함 사라짐, 다른 결함 변화 없음)' : a.build_ok === false ? '빌드 실패' : `탈락 — ${a.still && a.still.length ? '결함이 남음' : '결함은 사라짐'}${a.regress && a.regress.length ? `, 다른 결함 ${a.regress.map((g) => `${g.rule} ${g.labels.join('·')} ${g.status === 'new' ? '새로 생김' : `악화(${g.px}px)`}`).join(', ')}` : ''}`
      L.push(`  ${i + 1}. ${a.source === 'rule' ? '규칙' : 'LLM'}: \`${e.file}:${e.line}\` — ${e.why || ''}`)
      L.push(`     - 바꾼 줄: \`${e.replace.trim().slice(0, 160)}\``)
      L.push(`     - 검증: ${res}`)
    })
    L.push('')
  }
  if (r.combined && r.combined.patch) L.push('### 함께 적용할 패치(fix/fix_all.patch)', '', '```diff', r.combined.patch.trim(), '```', '')
  return L.join('\n')
}

module.exports = { applyEdits, fixRun, fixability, ruleEdits, cssRuleEdits, setDecls, gapDecls, measureBuild, judgeAfter, staticSource, fillClasses, findStyleKey, addStyleProp, fixReport }
