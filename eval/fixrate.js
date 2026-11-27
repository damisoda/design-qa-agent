#!/usr/bin/env node
// 수정 성공률 측정(11-18, 사용자 "Measure it first"): 합성 블라인드 묶음의 결함 변형마다
//   1) dqa check(맞게 만든 구현 ok를 비교 기준으로) → 심은 결함을 찾았는지
//   2) dqa fix(--llm auto, 기본 = 규칙 먼저·모델 보조 / --mode model-only = 모델만) → 검증된 수정이 있는지, 규칙이 고쳤는지 모델이 고쳤는지
//   3) fix_all.patch를 결함 변형 사본에 적용하고 dqa와 따로 만든 오라클(verify_synth.js 측정)로 정답 크기에서 결함이 사라졌는지
// 사용: node eval/fixrate.js --tag fr-auto [--mode model-only] [--sets blind,blind2,...] [--only id,id]
// 결과: eval/results/fixrate-<tag>.json (사례별) + 요약 출력. 규칙과 사례는 바꾸지 않는다.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync, execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const CLI = path.join(ROOT, 'dqa', 'cli.js')
const RUNS = path.join(ROOT, 'dqa', 'runs')
const argv = process.argv.slice(2)
const opt = (k, d) => argv.includes(k) ? argv[argv.indexOf(k) + 1] : d
const TAG = opt('--tag'); const MODE = opt('--mode', 'auto')
const SETS = opt('--sets', 'blind,blind2,blind3,blind4,blind5').split(',')
const ONLY = argv.includes('--only') ? new Set(opt('--only').split(',')) : null
if (!TAG) { console.error('--tag 필요'); process.exit(2) }
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'dqa/config/default.json'), 'utf8'))

// 오라클: verify_synth.js의 run()을 main 없이 불러온다(같은 폴더에 사본을 두어 상대 경로 유지)
const ORA = path.join(ROOT, 'eval/synth/.oracle_fixrate.js')
fs.writeFileSync(ORA, fs.readFileSync(path.join(ROOT, 'eval/synth/verify_synth.js'), 'utf8').replace(/\nmain\(\)\.catch[^\n]*\n?$/, '\nmodule.exports = { run }\n'))
const { run: oracle } = require(ORA)
const { launch } = require(path.join(ROOT, 'dqa/measure/browser'))

const norm = (s) => String(s || '').replace(/\s+/g, '')
const otherLabels = (d) => d.rule === 'R3' ? (d.elements || []).map((e) => e.other && (e.other.label || (e.other.info && e.other.info.label))).filter(Boolean) : []
const EQUIV = { S4: ['D2', 'D5'] }
const matches = (d, c) => (d.rule === c.code || (EQUIV[c.code] || []).includes(d.rule)) && (!c.hint.length || c.hint.some((h) => norm([...(d.labels || []), ...(d.elements || []).map((e) => e.label), ...otherLabels(d)].join('|')).includes(norm(h))))

// 맥미니에 다른 모델이 올라가 있으면 dqa가 LLM을 건너뛴다(5주차 시험 T1). 측정이 규칙 쪽으로 치우치지 않게 비워질 때까지 기다린다(최대 10분)
function waitModelFree () {
  for (let i = 0; i < 40; i++) {
    try {
      const ps = JSON.parse(execFileSync('curl', ['-s', '-m', '5', `${cfg.ollama.url}/api/ps`], { encoding: 'utf8' }))
      if (!(ps.models || []).some((m) => m.name !== cfg.ollama.model)) return true
    } catch (e) {}
    spawnSync('sleep', ['15'])
  }
  return false
}

async function main () {
  const browser = await launch(); const out = []
  const file = path.join(ROOT, 'eval/results', `fixrate-${TAG}.json`)
  try {
    for (const set of SETS) {
      const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/synth', set, 'cases.json'), 'utf8'))
      for (const c of data.cases.filter((x) => x.code && (!ONLY || ONLY.has(x.id)))) {
        const t0 = Date.now()
        const ok = data.cases.find((x) => x.screen === c.screen && x.variant === 'ok')
        const plain = c.sizes.filter((s) => !s.includes('@')); const notch = c.sizes.filter((s) => s.includes('@'))
        const useNotch = notch.length && !plain.length
        const sizes = (useNotch ? notch : plain).map((s) => s.split('@')[0])
        const scope = /^(R[1-7]|A[12]|D4)$/.test(c.code) ? 'rules' : 'outside'
        const runId = `${TAG}-${c.id}`
        fs.rmSync(path.join(RUNS, runId), { recursive: true, force: true })
        const args = [CLI, 'check', '--dist', path.join(ROOT, c.dir), '--base-dist', path.join(ROOT, ok.dir), '--recipe', 'local/home', '--widths', sizes.join(','), '--llm', 'off', '--run-id', runId]
        if (useNotch) args.push('--safe', notch[0].split('@')[1])
        spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, DQA_QUIET: '1' }, timeout: 600000 })
        const row = { id: c.id, set, code: c.code, scope, detected: false, fixed_dqa: false, fixed_oracle: null, source: null, regress: null, llm: null, targets: 0 }
        let ds = []
        try { ds = JSON.parse(fs.readFileSync(path.join(RUNS, runId, 'defects.json'), 'utf8')) } catch (e) { row.error = 'check 실패' }
        const isNew = (d) => !d.diff || ['new', 'worsened'].includes(d.diff.status)
        const hit = ds.filter((d) => isNew(d) && matches(d, c))
        row.detected = hit.length > 0; row.other_reports = ds.filter(isNew).length - hit.length; row.targets = hit.length
        if (row.detected) {
          // 사람이 결함 목록에서 심은 결함만 골라 수정을 맡기는 상황: 나머지 보고는 '무시'로 표시한다(fix 작업 예산 8개가 다른 보고에 쓰이지 않게)
          for (const d of ds) if (!hit.includes(d)) d.accepted = true
          fs.writeFileSync(path.join(RUNS, runId, 'defects.json'), JSON.stringify(ds, null, 1))
          if (!waitModelFree()) row.llm_wait = 'timeout'
          const fa = [CLI, 'fix', '--run', runId, '--llm', 'auto']
          if (MODE === 'model-only') fa.push('--repair-mode', 'model-only')
          spawnSync('node', fa, { encoding: 'utf8', env: { ...process.env, DQA_QUIET: '1' }, timeout: 1800000 })
          let fx = null
          try { fx = JSON.parse(fs.readFileSync(path.join(RUNS, runId, 'fix', 'fixes.json'), 'utf8')) } catch (e) { row.error = 'fix 실패' }
          if (fx) {
            row.llm = fx.llm && fx.llm.status
            const ids = new Set(hit.map((d) => d.id))
            const items = (fx.items || []).filter((it) => (it.target_ids || [it.defect_id]).some((x) => ids.has(x)))
            const okAttempt = items.flatMap((it) => (it.attempts || []).filter((a) => a.ok))
            row.fixed_dqa = items.some((it) => it.verified > 0 || it.resolved_by_combined) && !((fx.combined || {}).regress || []).length
            row.source = okAttempt.length ? [...new Set(okAttempt.map((a) => a.source))].join('+') : (items.some((it) => it.resolved_by_combined) ? 'combined' : null)
            row.regress = ((fx.combined || {}).regress || []).length
            row.attempts = items.reduce((a, it) => a + (it.attempts || []).length, 0)
            const patch = path.join(RUNS, runId, 'fix', 'fix_all.patch')
            if (fs.existsSync(patch) && fs.statSync(patch).size > 0) {
              const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixrate-'))
              fs.cpSync(path.join(ROOT, c.dir), tmp, { recursive: true })
              const pr = spawnSync('patch', ['-p1', '-d', tmp, '-i', patch], { encoding: 'utf8' })
              const want = (c.verified && c.verified.expected_sizes) || []
              if (pr.status === 0 && c.check && want.length) {
                const res = []
                for (const s of want) res.push(await oracle(browser, tmp, s, c.check, null))
                row.fixed_oracle = res.every((r) => r && r.defect === false)
              } else row.fixed_oracle = pr.status === 0 ? null : false
              fs.rmSync(tmp, { recursive: true, force: true })
            } else row.fixed_oracle = false
          }
        }
        row.sec = Math.round((Date.now() - t0) / 1000)
        out.push(row)
        console.log(`${c.id.padEnd(26)} ${c.code.padEnd(3)} ${scope.padEnd(7)} 탐지 ${row.detected ? '예' : '아니오'} | dqa 검증 ${row.fixed_dqa ? '예' : '아니오'} | 오라클 ${row.fixed_oracle} | ${row.source || '-'} | 회귀 ${row.regress} | LLM ${row.llm} | ${row.sec}초`)
        fs.writeFileSync(file, JSON.stringify({ tag: TAG, mode: MODE, at: new Date().toISOString(), results: out }, null, 1))
      }
    }
  } finally { await browser.close(); fs.rmSync(ORA, { force: true }) }
  const R = out.filter((r) => r.scope === 'rules'); const D = R.filter((r) => r.detected)
  const both = D.filter((r) => r.fixed_dqa && r.fixed_oracle)
  const src = {}; for (const r of both) src[r.source] = (src[r.source] || 0) + 1
  const summary = { tag: TAG, mode: MODE, planted_rules: R.length, detected: D.length, fixed_dqa: D.filter((r) => r.fixed_dqa).length, fixed_dqa_and_oracle: both.length, dqa_yes_oracle_no: D.filter((r) => r.fixed_dqa && r.fixed_oracle === false).length, by_source: src, llm_skipped: D.filter((r) => r.llm && r.llm !== 'ok').length, outside_detected: out.filter((r) => r.scope === 'outside' && r.detected).length }
  fs.writeFileSync(file, JSON.stringify({ tag: TAG, mode: MODE, at: new Date().toISOString(), summary, results: out }, null, 1))
  console.log(JSON.stringify(summary, null, 1))
}
main().catch((e) => { console.error(e); process.exit(2) })
