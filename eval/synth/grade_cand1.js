#!/usr/bin/env node
// 후보 묶음 1: 지금 dqa(규칙 + 시안 비교 + 눌러 보기, LLM 끔)가 C1·C2 결함을 이미 보고하는지 잰다.
//   결함 화면 보고 중 같은 화면 ok에 없는 것(규칙+라벨 기준)만 "새 보고"로 보고, 새 보고의 라벨에 정답 단서(결함 글자·버튼 문구·기대 글자)가 있으면 "잡음"으로 친다.
//   어떤 규칙이 잡았는지(rule)도 적는다. 규칙 이름이 결함 뜻과 다를 수 있다(예: 글자 뜻 이상을 T1 문구 차이로).
// 사용: node eval/synth/grade_cand1.js --tag cand1-base → eval/results/<tag>.json
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const ROOT = path.resolve(__dirname, '../..')
const CLI = path.join(ROOT, 'dqa', 'cli.js')
const RUNS = path.join(ROOT, 'dqa', 'runs')
const norm = (s) => String(s || '').replace(/\s+/g, '')
const labelsOf = (d) => [...(d.labels || []), ...(d.elements || []).map((e) => e.label), d.message, d.title, d.detail && JSON.stringify(d.detail)].filter(Boolean).join('|')

function run (c, tag) {
  const runId = `${tag}-${c.id}`
  fs.rmSync(path.join(RUNS, runId), { recursive: true, force: true })
  const args = [CLI, 'check', '--dist', path.join(ROOT, c.dir), '--recipe', 'local/home', '--widths', c.sizes.join(','), '--llm', 'off', '--run-id', runId, '--interact']
  const r = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, DQA_QUIET: '1' }, timeout: 600000 })
  const dir = path.join(RUNS, runId)
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  const ds = JSON.parse(fs.readFileSync(path.join(dir, 'defects.json'), 'utf8'))
  return { ds, sec: m.total_sec, exit: r.status, design: !!(m.design || m.design_path || fs.existsSync(path.join(dir, 'design.json'))) }
}

function main () {
  const argv = process.argv.slice(2)
  const tag = argv[argv.indexOf('--tag') + 1]
  if (argv.indexOf('--tag') < 0 || !tag) { console.error('--tag 필요'); process.exit(2) }
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'cand1', 'cases.json'), 'utf8'))
  const okRuns = {}; const rows = []
  for (const c of data.cases.filter((x) => !x.truth)) {
    okRuns[c.screen] = run(c, tag)
    const o = okRuns[c.screen]
    console.log(`${c.id.padEnd(26)} ok   보고 ${o.ds.length}${o.ds.length ? ' ' + o.ds.map((d) => `${d.rule}:${((d.labels || [])[0] || '').slice(0, 14)}`).join(', ') : ''} | 시안 ${o.design ? '붙음' : '없음'} | ${o.sec}초`)
    rows.push({ id: c.id, ok: true, reports: o.ds.map((d) => ({ rule: d.rule, label: (d.labels || [])[0] || '' })), sec: o.sec })
  }
  for (const c of data.cases.filter((x) => x.truth)) {
    if (!c.verified) { console.log(`${c.id} 정답 미확인, 건너뜀`); continue }
    const r = run(c, tag); const base = okRuns[c.screen]
    const key = (d) => d.rule + '|' + norm((d.labels || [])[0])
    const okKeys = new Set(base.ds.map(key))
    const fresh = r.ds.filter((d) => !okKeys.has(key(d)))
    const clues = [c.truth.actual, c.truth.label, c.truth.expected].filter(Boolean).map(norm)
    const hit = fresh.filter((d) => clues.some((h) => norm(labelsOf(d)).includes(h)))
    const row = { id: c.id, code: c.code, family: c.truth.family, confirm: c.truth.confirm, detected: hit.length > 0, by: [...new Set(hit.map((d) => d.rule))], fresh: fresh.map((d) => ({ rule: d.rule, label: (d.labels || [])[0] || '' })), sec: r.sec }
    rows.push(row)
    console.log(`${c.id.padEnd(26)} ${c.code}   ${row.detected ? '잡음(' + row.by.join(',') + ')' : '못 잡음'} | ${c.truth.family} | 새 보고 ${fresh.length}${fresh.length ? ' ' + fresh.map((d) => `${d.rule}:${((d.labels || [])[0] || '').slice(0, 14)}`).join(', ') : ''} | ${r.sec}초`)
  }
  const def = rows.filter((x) => !x.ok)
  const summary = { tag, defects: def.length, detected: def.filter((x) => x.detected).length,
    by_family: Object.fromEntries([...new Set(def.map((x) => x.family))].map((f) => [f, `${def.filter((x) => x.family === f && x.detected).length}/${def.filter((x) => x.family === f).length}`])),
    ok_reports: rows.filter((x) => x.ok).reduce((a, x) => a + x.reports.length, 0) }
  fs.mkdirSync(path.join(ROOT, 'eval', 'results'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'eval', 'results', `${tag}.json`), JSON.stringify({ summary, rows, frozen_rules_sha1: data.frozen_rules_sha1 }, null, 1) + '\n')
  console.log(JSON.stringify(summary))
}
main()
