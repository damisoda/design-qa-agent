// 검증된 수정을 로컬 작업 폴더에 적용한다(로컬 모드 실행만).
// - 확인 문구 "적용"이 없으면 무엇을 바꿀지만 보여 준다.
// - 검사 뒤에 고칠 파일이 바뀌었으면(내용 해시가 다르면) 적용하지 않는다.
// - 적용 전 원래 파일을 실행 폴더(fix/backup/)에 남기고, --undo --confirm "되돌리기"로 되돌린다.
const fs = require('fs')
const path = require('path')
const { RUNS, readJSON, writeJSON, assertAllowedPath, sha1 } = require('../core/util')
const { applyEdits } = require('./fix')

const { assertVerifiedCombined } = require('./validation')

const CONFIRM = '적용'
const CONFIRM_UNDO = '되돌리기'

function load (args) {
  const runDir = path.join(RUNS, String(args.run || ''))
  if (!args.run || !fs.existsSync(path.join(runDir, 'manifest.json'))) throw new Error('--run <실행 ID>가 필요하다')
  const m = readJSON(path.join(runDir, 'manifest.json'))
  if (!m.local) throw new Error('로컬 작업 폴더(--local) 실행만 적용할 수 있다. 저장소 대상은 dqa pr로 수정 브랜치를 만든다')
  const fx = readJSON(path.join(runDir, 'fix', 'fixes.json'), null)
  if (!fx) throw new Error('수정 검증 결과가 없다. 먼저 dqa fix --run <실행 ID>')
  return { runDir, m, fx }
}

// 적용할 수정: --defect가 있으면 그 결함의 검증된 수정, 없으면 함께 적용해 검증된 묶음
function pick (fx, defect) {
  if (defect) {
    const it = fx.items.find((x) => x.defect_id === defect)
    if (!it || it.verified === null || it.verified === undefined) throw new Error(`결함 ${defect}에 검증된 수정이 없다`)
    const attempt = it.attempts[it.verified]
    if (!attempt || attempt.ok !== true || attempt.build_ok !== true || attempt.failed_sizes || (attempt.regress || []).length) throw new Error('결함 수정 검증이 성공하지 않았다')
    return { edits: attempt.edits, before: it.before_sha1 || {}, label: `결함 ${defect}의 수정` }
  }
  const c = assertVerifiedCombined(fx.combined)
  return { edits: c.edits, before: c.before_sha1 || {}, label: `검증된 수정 ${c.edits.length}개 묶음(결함 ${c.fixed_count}건 사라짐)` }
}

function applyFix (args, cfg) {
  const { runDir, m, fx } = load(args)
  const project = assertAllowedPath(m.local.project, cfg)
  const backup = path.join(runDir, 'fix', 'backup')
  if (args.undo) return undo(args, runDir, project)
  const sel = pick(fx, args.defect)
  const files = [...new Set(sel.edits.map((e) => e.file))]
  const changedSince = files.filter((rel) => {
    const f = path.join(project, rel)
    return !fs.existsSync(f) || (sel.before[rel] && sha1(fs.readFileSync(f, 'utf8')) !== sel.before[rel])
  })
  if (changedSince.length) throw new Error(`검사한 뒤에 바뀐 파일이 있어 적용하지 않는다: ${changedSince.join(', ')}. 다시 검사(dqa check --local)한 뒤 수정한다`)
  const next = applyEdits(project, sel.edits)
  const plan = [...next].map(([rel, st]) => ({ file: rel, lines: st.after.split('\n').length - st.before.split('\n').length, before_sha1: sha1(st.before), after_sha1: sha1(st.after) }))
  console.log(`${sel.label} → ${project}`)
  for (const e of sel.edits) console.log(`  ${e.file}: ${String(e.find).trim().slice(0, 60)} → ${String(e.replace).trim().slice(0, 60)}`)
  if (args.confirm !== CONFIRM) {
    console.log(`\n아직 바꾸지 않았다. 적용하려면 --confirm "${CONFIRM}"`)
    return { applied: false, plan }
  }
  fs.mkdirSync(backup, { recursive: true })
  for (const [rel, st] of next) {
    const b = path.join(backup, rel); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.writeFileSync(b, st.before)
    fs.writeFileSync(path.join(project, rel), st.after)
  }
  const rec = { at: new Date().toISOString(), project, label: sel.label, defect: args.defect || null, files: plan }
  writeJSON(path.join(runDir, 'fix', 'apply.json'), rec)
  console.log(`\n적용했다: 파일 ${plan.length}개. 되돌리기: dqa apply --run ${m.run_id} --undo --confirm "${CONFIRM_UNDO}"`)
  return { applied: true, ...rec }
}

// 적용을 되돌린다. 적용 뒤에 사용자가 그 파일을 또 고쳤으면 되돌리지 않는다
function undo (args, runDir, project) {
  const rec = readJSON(path.join(runDir, 'fix', 'apply.json'), null)
  if (!rec || rec.undone) throw new Error('되돌릴 적용 기록이 없다')
  const touched = rec.files.filter((f) => sha1(fs.readFileSync(path.join(project, f.file), 'utf8')) !== f.after_sha1)
  if (touched.length) throw new Error(`적용 뒤에 다시 바뀐 파일이 있어 되돌리지 않는다: ${touched.map((f) => f.file).join(', ')}`)
  if (args.confirm !== CONFIRM_UNDO) { console.log(`되돌릴 파일: ${rec.files.map((f) => f.file).join(', ')}\n되돌리려면 --confirm "${CONFIRM_UNDO}"`); return { undone: false } }
  for (const f of rec.files) fs.writeFileSync(path.join(project, f.file), fs.readFileSync(path.join(runDir, 'fix', 'backup', f.file), 'utf8'))
  rec.undone = new Date().toISOString(); writeJSON(path.join(runDir, 'fix', 'apply.json'), rec)
  console.log(`되돌렸다: 파일 ${rec.files.length}개`)
  return { undone: true }
}

module.exports = { applyFix, CONFIRM, CONFIRM_UNDO }
