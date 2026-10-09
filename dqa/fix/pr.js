// 코드 에이전트의 마지막 단계: 검증된 패치로 수정 브랜치를 만들고, 프로젝트 검사(타입 검사·테스트)를 돌리고, 커밋하고, PR 본문을 쓴다.
// 기본은 로컬 준비만 한다(독립 클론 안의 브랜치·커밋). GitHub에 올리기(push + 초안 PR)는 --push와 확인 문구가 함께 있을 때만 한다.
// 병합은 하지 않는다. 사용자 작업본(~/Come-back-home)은 쓰지 않는다.
const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const { RUNS, home, readJSON, writeJSON, assertAllowedPath, createRun } = require('../core/util')

const CONFIRM = 'PR 올리기'
const sh = (cmd, args, cwd, timeout = 300000) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 32 << 20 })

function prBody (m, fixes, defects, checks, branch, base) {
  const ver = fixes.items.filter((x) => x.verified !== null || x.resolved_by_combined)
  const L = ['# PR 개요', '', `디자인 검수(dqa)가 찾은 배치 결함 ${ver.length}건을 고칩니다. 수정은 평가용 사본에 적용해 다시 빌드하고 같은 화면 크기로 재측정해서, 결함이 사라지고 다른 결함이 생기거나 커지지 않은 것만 담았습니다.`, '', '## 작업 내용', '']
  for (const x of ver) {
    const d = defects.find((o) => o.id === x.defect_id) || {}
    const a = x.verified !== null ? x.attempts[x.verified] : null
    L.push(`- **[${x.rule} ${d.rule_name || ''}] ${x.labels.join(', ')}**`)
    if (x.problem) { L.push(`  - 문제: ${x.problem.problem}`); L.push(`  - 원본(기대): ${x.problem.expected}`) }
    L.push(`  - 측정(수정 전): ${(d.widths || []).map((w) => `${w.w}x${w.h} ${w.px}${w.metric === 'lines' ? '줄' : 'px'}`).join(', ')}`)
    if (a) { const e = a.edits[0]; L.push(`  - 수정: \`${e.file}:${e.line}\` — ${e.why || ''}`) } else L.push('  - 수정: 다른 결함의 수정을 함께 적용하면 사라짐(별도 변경 없음)')
  }
  const left = fixes.items.filter((x) => x.verified === null && !x.resolved_by_combined)
  if (left.length) { L.push('', '고치지 못한 결함(사람 확인 필요):'); for (const x of left) L.push(`- [${x.rule}] ${x.labels.join(', ')}${x.skipped ? ` — ${x.skipped}` : ''}`) }
  L.push('', '## 변경 유형', '', '- [x] 버그 수정 (fix)', '', '## 테스트', '')
  const c = fixes.combined || {}
  L.push(`- [x] 재측정: 화면 ${m.recipes.map((r) => r.title).join(', ')} · 크기 ${m.sizes.map((s) => s.join('x')).join(', ')}에서 결함 ${c.fixed_count || 0}건 사라짐, 다른 결함 생김·악화 ${(c.regress || []).length}건`)
  for (const k of checks) L.push(`- [${k.ok ? 'x' : ' '}] ${k.name}: ${k.ok ? '통과' : `실패 — ${k.note}`}`)
  L.push('- [ ] 실제 기기(iOS Safari·Android)에서 화면 확인(사람)')
  L.push('', '## 리뷰 포인트', '', '- 측정은 목 모드 웹 빌드(react-native-web)에서 했습니다. 네이티브 화면과 다를 수 있습니다.', '- 수정은 코드 에이전트(로컬 모델)와 규칙이 만들었고, 재측정으로만 검증했습니다. 디자인 의도와 맞는지 확인해 주세요.')
  L.push('', '## 관련 이슈 / 문서', '', `- dqa 실행 ${m.run_id} (로컬 보고서), 대상 커밋 ${m.build && m.build.head ? m.build.head.sha.slice(0, 8) : m.targets.head.ref}, 브랜치 ${branch} → ${base}`)
  return L.join('\n')
}

async function makePr (args, cfg) {
  const runId = args.run
  const runDir = path.join(RUNS, String(runId || ''))
  const m = readJSON(path.join(runDir, 'manifest.json'), null)
  const fixes = readJSON(path.join(runDir, 'fix', 'fixes.json'), null)
  const patchFile = path.join(runDir, 'fix', 'fix_all.patch')
  if (!m || !fixes || !fs.existsSync(patchFile)) throw new Error('검증된 수정이 없다. 먼저 dqa fix --run <실행 ID>를 돌린다')
  if (!fixes.combined || (fixes.combined.regress || []).length) throw new Error('검증된 수정을 함께 적용했을 때 다른 결함이 생기거나 커졌다. PR을 만들지 않는다')
  if (m.targets.head.kind !== 'repo') throw new Error('PR은 저장소 대상(--repo)으로 검사한 실행에서만 만든다(빌드 이름·주소 대상은 브랜치를 모른다)')
  const rc = cfg.repos[m.repo]
  const clone = assertAllowedPath(rc.clone, cfg)
  const base = args.onto || (m.build && m.build.ref_name)
  if (!base) throw new Error('PR이 향할 브랜치를 모른다(커밋 해시로 검사했다). --onto <브랜치>로 정한다')
  const ev = createRun('pr', runId)
  const say = (s) => ev.event('pr', s)
  const headSha = m.build.head.sha
  const branch = args.branch || `dqa/fix-${runId.slice(0, 15)}`
  const wt = path.join(home('~/design-qa-cases'), 'wt-pr', runId)
  assertAllowedPath(wt, cfg)
  const out = { run_id: runId, branch, base, head_sha: headSha, checks: [], pushed: false, at: new Date().toISOString() }
  try {
    // 1. 브랜치 worktree(같은 이름이 있으면 지우고 다시)
    if (fs.existsSync(wt)) { sh('git', ['-C', clone, 'worktree', 'remove', '--force', wt]); fs.rmSync(wt, { recursive: true, force: true }) }
    sh('git', ['-C', clone, 'branch', '-D', branch])
    execFileSync('git', ['-C', clone, 'worktree', 'add', '-b', branch, wt, headSha], { encoding: 'utf8' })
    say(`브랜치 ${branch}를 ${headSha.slice(0, 8)}에서 만들었다`)
    // 2. 패치 적용
    const ap = sh('git', ['apply', '--whitespace=nowarn', patchFile], wt)
    if (ap.status !== 0) throw new Error(`패치 적용 실패: ${ap.stderr.slice(0, 300)}`)
    // 3. 프로젝트 검사: node_modules는 이 커밋 빌드에 쓴 것을 복제
    const app = path.join(wt, rc.app_dir)
    const built = path.join(home('~/design-qa-cases'), 'wt', headSha.slice(0, 12), rc.app_dir, 'node_modules')
    if (fs.existsSync(built)) execFileSync('cp', ['-c', '-R', built, path.join(app, 'node_modules')], { timeout: 300000 })
    if (fs.existsSync(path.join(app, 'tsconfig.json'))) {
      const r = sh('npx', ['tsc', '--noEmit', '-p', '.'], app)
      const errs = (r.stdout.match(/error TS/g) || []).length
      out.checks.push({ name: '타입 검사(tsc --noEmit)', ok: r.status === 0, note: r.status === 0 ? '' : `오류 ${errs}건: ${r.stdout.split('\n').find((l) => l.includes('error TS')) || ''}`.slice(0, 200) })
    }
    const tests = path.join(app, 'tests')
    if (fs.existsSync(tests)) {
      const files = fs.readdirSync(tests).filter((f) => /\.test\.(m?js|cjs)$/.test(f)).map((f) => path.join('tests', f))
      if (files.length) { const r = sh(process.execPath, ['--test', ...files], app); out.checks.push({ name: `테스트(node --test, ${files.length}개 파일)`, ok: r.status === 0, note: r.status === 0 ? '' : (r.stdout + r.stderr).split('\n').filter((l) => /fail|not ok|Error/.test(l)).slice(0, 2).join(' / ').slice(0, 200) }) }
    }
    if (!out.checks.length) out.checks.push({ name: '프로젝트 검사', ok: true, note: '타입 검사·테스트 설정이 없어 재측정만 했다' })
    fs.rmSync(path.join(app, 'node_modules'), { recursive: true, force: true })
    say(`검사: ${out.checks.map((k) => `${k.name} ${k.ok ? '통과' : '실패'}`).join(', ')}`)
    // 4. 커밋(브랜치 안에서만)
    const defects = readJSON(path.join(runDir, 'defects.json'), [])
    const rules = [...new Set(fixes.items.filter((x) => x.verified !== null || x.resolved_by_combined).map((x) => `${x.rule} ${(defects.find((d) => d.id === x.defect_id) || {}).rule_name || ''}`.trim()))]
    const title = `fix(frontend): ${m.recipes.map((r) => r.title).join('·')} ${rules.join('·')} 수정 (dqa 검증)`
    out.title = title
    sh('git', ['add', '-A', rc.app_dir], wt)
    const cm = sh('git', ['-c', 'user.name=dqa', '-c', 'user.email=dqa@localhost', 'commit', '-m', title, '-m', `dqa 실행 ${runId}에서 찾은 결함을 사본에서 다시 빌드·재측정해 검증한 수정이다.`], wt)
    if (cm.status !== 0) throw new Error(`커밋 실패: ${(cm.stdout + cm.stderr).slice(0, 300)}`)
    out.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim()
    out.diffstat = execFileSync('git', ['diff', '--stat', `${headSha}..HEAD`], { cwd: wt, encoding: 'utf8' }).trim()
    const body = prBody(m, fixes, defects, out.checks, branch, base)
    fs.writeFileSync(path.join(runDir, 'fix', 'pr_body.md'), body)
    say(`커밋 ${out.commit.slice(0, 8)} — ${title}`)
    // 5. 올리기: --push와 확인 문구가 함께 있어야 한다
    const allOk = out.checks.every((k) => k.ok)
    if (args.push) {
      if (args.confirm !== CONFIRM) throw new Error(`올리려면 확인 문구가 필요하다(--confirm "${CONFIRM}")`)
      if (!allOk) throw new Error('프로젝트 검사가 실패해 올리지 않는다')
      const p = sh('git', ['push', '-u', 'origin', branch], wt, 120000)
      if (p.status !== 0) throw new Error(`push 실패: ${p.stderr.slice(0, 300)}`)
      const pr = sh('gh', ['pr', 'create', '--draft', '-R', rc.github, '--base', base, '--head', branch, '--title', title, '--body-file', path.join(runDir, 'fix', 'pr_body.md')], wt, 120000)
      if (pr.status !== 0) throw new Error(`PR 생성 실패: ${pr.stderr.slice(0, 300)}`)
      out.pushed = true; out.url = pr.stdout.trim()
      say(`초안 PR을 올렸다: ${out.url}`)
    } else say(`로컬 준비만 했다(브랜치 ${branch}, 올리지 않음). 올리려면 --push --confirm "${CONFIRM}"`)
  } finally {
    writeJSON(path.join(runDir, 'fix', 'pr.json'), out)
  }
  return out
}

module.exports = { makePr, CONFIRM }
