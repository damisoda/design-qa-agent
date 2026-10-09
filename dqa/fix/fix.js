// dqa fix: 결함마다 수정안을 만들고, 평가용 사본에 적용해 다시 빌드·재측정해서 검증한다.
// 채택 조건: 그 결함이 사라지고, 다른 결함이 새로 생기거나 커지지 않는다. 원본 소스·사용자 작업본에는 쓰지 않는다.
// 수정은 코드 에이전트(fix/agent.js)가 한다: (1) 진단이 분명한 유형은 규칙 수정안(flex 최소 폭 → minWidth: 0, 눌린 라벨 → flexShrink: 0)
// (2) 안 되면 보고서 에이전트의 문제 정의서를 받아 코드 읽기·검색·수정 루프. 수정마다 사본에서 빌드·재측정으로 검증한다.
const fs = require('fs')
const path = require('path')
const { execFileSync, spawn } = require('child_process')
const { RUNS, home, readJSON, writeJSON, assertAllowedPath, createRun } = require('../core/util')
const { launch } = require('../measure/browser')
const { sweep } = require('../measure/sweep')
const { buildDefects, crossWidth } = require('../measure/cluster')
const { loadRecipe } = require('../recipes/runner')
const { serveDist } = require('../targets/static')
const { compare } = require('../diff/compare')
const { preflight, unload } = require('../judge/ollama')
const { codeAgent } = require('./agent')

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

// ── 사본·빌드·재측정 ─────────────────────────────────────────
function makeScratch (srcRoot, dir, cfg) {
  assertAllowedPath(srcRoot, cfg); assertAllowedPath(dir, cfg)
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.dirname(dir), { recursive: true })
  execFileSync('cp', ['-c', '-R', srcRoot, dir], { timeout: 180000 })
  const g = path.join(dir, '.git'); if (fs.existsSync(g) && fs.statSync(g).isFile()) fs.rmSync(g) // worktree 연결 파일은 지운다(사본에서 git이 원본을 건드리지 않게)
}

function build (appDir, repoCfg, outDir, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now(); let log = ''
    const child = spawn('npx', [...repoCfg.build_args, '--output-dir', outDir], { cwd: appDir, env: { ...process.env, ...repoCfg.build_env } })
    child.stdout.on('data', (c) => { log += c }); child.stderr.on('data', (c) => { log += c })
    const tm = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.on('exit', (code) => { clearTimeout(tm); resolve({ ok: code === 0 && fs.existsSync(path.join(appDir, outDir, 'index.html')), ms: Date.now() - t0, log: log.slice(-3000) }) })
  })
}

async function measureBuild (browser, distDir, recipes, sizes, run, cfg, side) {
  const s = await serveDist(distDir)
  try {
    const out = []
    for (const r of recipes) {
      const res = await sweep(browser, { origin: s.origin, recipe: r, sizes, side, run, cfg })
      const ds = buildDefects(res, { screen: r.id, side, ref: side })
      out.push(...ds, ...crossWidth(res, ds, { screen: r.id, side, ref: side }))
      if (res.some((x) => !x.ok)) out.failed = (out.failed || 0) + res.filter((x) => !x.ok).length
    }
    return out
  } finally { s.close() }
}

function judgeAfter (original, after, targetIds) {
  const orig = JSON.parse(JSON.stringify(original)); const aft = JSON.parse(JSON.stringify(after))
  const { resolved } = compare(orig, aft) // orig = 수정 전(기준), aft = 수정 후
  const fixed = resolved.map((d) => d.id)
  const regress = aft.filter((d) => d.diff && (d.diff.status === 'new' || d.diff.status === 'worsened')).map((d) => ({ id: d.id, rule: d.rule, labels: d.labels.slice(0, 3), status: d.diff.status, px: d.max_px }))
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
  for (const e of edits) {
    const f = path.join(srcRoot, e.file)
    const cur = byFile.has(e.file) ? byFile.get(e.file).after : fs.readFileSync(f, 'utf8')
    if (!byFile.has(e.file)) byFile.set(e.file, { before: cur, after: cur })
    const st = byFile.get(e.file)
    if (st.after.split(e.find).length - 1 !== 1) throw new Error(`적용 실패: ${e.file}에서 찾을 줄이 한 번이 아니다`)
    st.after = st.after.replace(e.find, e.replace)
  }
  return byFile
}

async function fixRun (args, cfg) {
  const runId = args.run
  const runDir = path.join(RUNS, String(runId || ''))
  if (!runId || !fs.existsSync(path.join(runDir, 'manifest.json'))) throw new Error('--run <실행 ID>가 필요하다')
  const m = readJSON(path.join(runDir, 'manifest.json'))
  const original = readJSON(path.join(runDir, 'defects.json'), [])
  const head = m.targets.head
  if (head.kind === 'url') throw new Error('로컬 주소 대상은 사본을 만들 수 없어 수정 검증을 하지 않는다(빌드·저장소 대상만)')
  const repoCfg = cfg.repos[m.repo || head.repo || (cfg.dists[head.ref] && cfg.dists[head.ref].repo)]
  if (!head.src || !repoCfg) throw new Error('소스 위치나 빌드 설정(repos.json)이 없어 다시 빌드할 수 없다')
  const srcRoot = assertAllowedPath(head.src, cfg)
  const ev = createRun('fix', runId) // 같은 실행 폴더의 events.jsonl에 이어 쓴다
  const say = (msg) => ev.event('fix', msg)
  const targets = original.filter((d) => !d.accepted && (!d.diff || ['new', 'worsened'].includes(d.diff.status)) && d.rule !== 'R5' && (!args.defect || d.id === args.defect)).slice(0, cfg.fix.max_defects)
  const fixDir = path.join(runDir, 'fix'); fs.mkdirSync(fixDir, { recursive: true })
  const result = { started_at: new Date().toISOString(), run_id: runId, items: [], combined: null, llm: null }
  const save = () => writeJSON(path.join(fixDir, 'fixes.json'), result)
  if (!targets.length) { result.note = '고칠 결함이 없다(새로 생김·악화·상태 없음 결함만 대상)'; save(); say(result.note); return result }
  const recipes = m.recipes.map((r) => loadRecipe(r.id))
  const sizes = m.sizes
  const scratch = path.join(home(cfg.fix.scratch), runId)
  say(`사본 만드는 중: ${srcRoot} → ${scratch}`)
  makeScratch(srcRoot, scratch, cfg)
  const appDir = path.join(scratch, repoCfg.app_dir)
  const llmOk = args.llm !== 'off' ? await preflight(cfg) : { ok: false, reason: '--llm off' }
  result.llm = llmOk.ok ? { status: 'ok', model: cfg.ollama.model } : { status: 'skipped', reason: llmOk.reason }
  const browser = await launch()
  const tmp = path.join(fixDir, '.tmp'); fs.mkdirSync(tmp, { recursive: true })
  let attemptNo = 0
  try {
    const tryEdits = async (edits, label, targetIds) => {
      attemptNo++
      let changed
      try { changed = applyEdits(srcRoot, edits) } catch (e) { return { ok: false, error: e.message } }
      for (const [rel, st] of changed) fs.writeFileSync(path.join(scratch, rel), st.after)
      const outDir = `dist-dqa-fix${attemptNo}`
      say(`${label}: 빌드 중`)
      const b = await build(appDir, repoCfg, outDir, cfg.fix.build_timeout_ms)
      let verdict = { ok: false }
      if (b.ok) {
        say(`${label}: 빌드 ${(b.ms / 1000).toFixed(1)}초, 재측정 중`)
        const after = await measureBuild(browser, path.join(appDir, outDir), recipes, sizes, ev, cfg, `fix${attemptNo}`)
        verdict = { ...judgeAfter(original.filter((d) => d.rule !== 'R5'), after.filter((d) => d.rule !== 'R5'), targetIds), after: after.map((d) => ({ id: d.id, rule: d.rule, labels: d.labels.slice(0, 3), widths: d.widths.map((w) => `${w.w}x${w.h}:${w.px}`) })), failed_sizes: after.failed || 0 }
        if (after.failed) verdict.ok = false
      }
      for (const [rel, st] of changed) fs.writeFileSync(path.join(scratch, rel), st.before) // 사본을 원래대로
      fs.rmSync(path.join(appDir, outDir), { recursive: true, force: true })
      const patch = [...changed].map(([rel, st]) => unifiedDiff(rel, st.before, st.after, tmp)).join('\n')
      return { ...verdict, build_ok: b.ok, build_ms: b.ms, build_log: b.ok ? undefined : b.log, patch }
    }

    for (const d of targets) {
      const item = { defect_id: d.id, rule: d.rule, labels: d.labels.slice(0, 4), problem: d.judge && d.judge.status === 'ok' ? { problem: d.judge.problem, expected: d.judge.expected } : null, attempts: [], trail: [], verified: null }
      result.items.push(item)
      if (d.judge && d.judge.status === 'ok' && d.judge.verdict !== '결함') { item.skipped = `보고서 에이전트 판정이 "${d.judge.verdict}"라 고치지 않는다`; say(`${d.rule} ${d.labels.slice(0, 2).join(',')}: ${item.skipped}`); save(); continue }
      const r = await codeAgent(d, { cfg, srcRoot, srcDir: repoCfg.src_dir, tryEdits, say, firstEdits: ruleEdits(d, srcRoot), llm: llmOk.ok })
      Object.assign(item, { attempts: r.attempts, trail: r.trail, verified: r.verified })
      save()
    }
    // 검증된 수정을 모두 함께 적용해 한 번 더 확인
    const verified = result.items.filter((x) => x.verified !== null).map((x) => x.attempts[x.verified])
    if (verified.length) {
      const edits = verified.flatMap((a) => a.edits)
      const uniq = [...new Map(edits.map((e) => [`${e.file}|${e.find}|${e.replace}`, e])).values()]
      const r = await tryEdits(uniq, `검증된 수정 ${verified.length}개 함께 적용`, [])
      result.combined = { edits: uniq, ...r, fixed_count: r.fixed ? r.fixed.length : 0 }
      fs.writeFileSync(path.join(fixDir, 'fix_all.patch'), r.patch)
      say(`함께 적용: 결함 ${r.fixed ? r.fixed.length : 0}건 사라짐, 다른 결함 생김·악화 ${r.regress ? r.regress.length : '?'}건`)
    }
    for (const x of result.items) {
      if (x.verified !== null) fs.writeFileSync(path.join(fixDir, `${x.defect_id}.patch`), x.attempts[x.verified].patch)
      x.resolved_by_combined = !!(result.combined && result.combined.ok !== undefined && (result.combined.fixed || []).includes(x.defect_id))
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

module.exports = { fixRun, ruleEdits, findStyleKey, addStyleProp, fixReport }
