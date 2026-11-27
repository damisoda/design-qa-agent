#!/usr/bin/env node
// 합성 예제 채점: 변형마다 dqa를 단독으로 돌려(레시피 local/home, LLM 끔) 심은 결함을 정답 크기에서 찾는지 본다.
//   - 규칙 범위(R1~R7) 결함: 탐지 여부, 크기별 탐지
//   - 디자인 범위(D1~D5) 결함: Figma 비교가 생기기 전이라 규칙으로는 못 잡는 것이 정상이다. 잡힌 것이 있으면 따로 적는다
//   - 맞게 만든 구현(ok): 보고가 나오면 오탐이다
// 사용: node eval/synth/grade_synth.js --tag synth-b2  → eval/results/<tag>.json
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../..')
const CLI = path.join(ROOT, 'dqa', 'cli.js')
const RUNS = path.join(ROOT, 'dqa', 'runs')
const norm = (s) => String(s || '').replace(/\s+/g, '')
const sizesOf = (d) => (d.widths || []).map((w) => `${w.w}x${w.h}`)
// 겹침(R3)은 두 요소의 짝이므로 상대 쪽 라벨도 본다(10-10 블라인드 3 뒤 정함, 블라인드 4부터 적용)
const otherLabels = (d) => d.rule === 'R3' ? (d.elements || []).map((e) => e.other && (e.other.label || (e.other.info && e.other.info.label))).filter(Boolean) : []
// 상태 결함(S4 선택 상태)은 시안 비교에서 색 차이(D2)·테두리 차이(D5)로 드러난다(10-12 시안 비교 추가 때 정함)
const EQUIV = { S4: ['D2', 'D5'] }
const matches = (d, c) => (d.rule === c.code || (EQUIV[c.code] || []).includes(d.rule)) && (!c.hint.length || c.hint.some((h) => norm([...(d.labels || []), ...(d.elements || []).map((e) => e.label), ...otherLabels(d)].join('|')).includes(norm(h))))

function main () {
  const argv = process.argv.slice(2)
  const tag = argv[argv.indexOf('--tag') + 1]
  if (!tag || argv.indexOf('--tag') < 0) { console.error('--tag 필요'); process.exit(2) }
  const SET = argv.includes('--set') ? argv[argv.indexOf('--set') + 1] : ''
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, SET, 'cases.json'), 'utf8'))
  const results = []
  // --only a,b: 고친 것을 빨리 확인할 때 일부 사례만(전체 수치는 전체 실행으로만 적는다)
  const only = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null
  for (const c of data.cases.filter((x) => !only || only.has(x.id))) {
    const runId = `${tag}-${c.id}`
    fs.rmSync(path.join(RUNS, runId), { recursive: true, force: true })
    const plain = c.sizes.filter((s) => !s.includes('@')); const notch = c.sizes.filter((s) => s.includes('@'))
    const useNotch = c.code && notch.length && !plain.length
    const sizes = (useNotch ? notch : plain).map((s) => s.split('@')[0])
    const args = [CLI, 'check', '--dist', path.join(ROOT, c.dir), '--recipe', 'local/home', '--widths', sizes.join(','), '--llm', 'off', '--run-id', runId]
    if (useNotch) args.push('--safe', notch[0].split('@')[1])
    if (data.interact) args.push('--interact') // 눌러 보기까지 재는 묶음(블라인드 6~)
    const r = spawnSync('node', args, { encoding: 'utf8', env: { ...process.env, DQA_QUIET: '1' }, timeout: 600000 })
    const dir = path.join(RUNS, runId)
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
    const ds = JSON.parse(fs.readFileSync(path.join(dir, 'defects.json'), 'utf8'))
    // 오라클이 없는 사례(문구·눌러 보기)는 심은 크기 전부를 기대 크기로 본다
    const want = ((c.verified && c.verified.expected_sizes) || (c.code ? c.sizes : [])).map((s) => s.split('@')[0])
    const hit = c.code ? ds.filter((d) => matches(d, c)) : []
    const found = [...new Set(hit.flatMap(sizesOf))].filter((s) => want.includes(s))
    // G1(글자 기호 아이콘)은 기기 글꼴에 따라 깨질 수 있다는 위험 경고라, 이전 묶음과 비교할 수 있게 그 밖 보고와 따로 센다(10-13 추가)
    const other = ds.filter((d) => !hit.includes(d) && d.rule !== 'G1').map((d) => ({ rule: d.rule, label: (d.labels || [])[0] || '', sizes: sizesOf(d) }))
    const g1 = ds.filter((d) => !hit.includes(d) && d.rule === 'G1').map((d) => (d.labels || [])[0] || '')
    // 규칙 범위: dqa에 규칙이 있는 종류(R1~R7, A1, A2, D4). 그 밖(디자인 비교 D1~D3·D5, 상태 S, 크기 방식 F, 정렬 L)은 규칙 밖
    const scope = !c.code ? 'ok' : /^(R[1-7]|A[12]|D4)$/.test(c.code) ? 'rules' : 'outside'
    const row = { id: c.id, code: c.code, scope, expected_sizes: want, found_sizes: found, detected: found.length > 0, size_recall: want.length ? found.length / want.length : null, other, g1, sec: m.total_sec, exit: r.status }
    results.push(row)
    console.log(`${c.id.padEnd(22)} ${String(c.code || 'ok').padEnd(3)} ${scope.padEnd(6)} ${c.code ? `탐지 ${row.detected ? '예' : '아니오'} (${found.length}/${want.length} 크기)` : '맞게 만든 구현'} | 그 밖 보고 ${other.length}${other.length ? ' ' + other.map((o) => `${o.rule}:${o.label.slice(0, 12)}@${o.sizes.join('/')}`).join(', ') : ''} | ${m.total_sec}초`)
  }
  const rules = results.filter((x) => x.scope === 'rules'); const design = results.filter((x) => x.scope === 'outside'); const ok = results.filter((x) => x.scope === 'ok')
  const summary = {
    tag, rules_cases: rules.length, rules_detected: rules.filter((x) => x.detected).length,
    rules_size_recall: rules.reduce((a, x) => a + x.found_sizes.length, 0) / rules.reduce((a, x) => a + x.expected_sizes.length, 0),
    design_cases: design.length, design_detected_by_rules: design.filter((x) => x.detected).length,
    ok_pages: ok.length, ok_reports: ok.reduce((a, x) => a + x.other.length, 0),
    other_on_defect_pages: [...rules, ...design].reduce((a, x) => a + x.other.length, 0),
    g1_reports: results.reduce((a, x) => a + (x.g1 || []).length, 0), g1_on_ok_pages: ok.reduce((a, x) => a + (x.g1 || []).length, 0),
    sec_total: Math.round(results.reduce((a, x) => a + (x.sec || 0), 0))
  }
  fs.mkdirSync(path.join(ROOT, 'eval', 'results'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'eval', 'results', `${tag}.json`), JSON.stringify({ at: new Date().toISOString(), summary, results }, null, 1))
  console.log('\n요약', JSON.stringify(summary, null, 1))
}
main()
