// Independent end-to-end check of the generated, verified app copy. No repair oracle is supplied to the agent.
const fs = require('fs'); const path = require('path'); const assert = require('node:assert/strict')
const { launch, newContext } = require('../measure/browser')
const { ROOT, RUNS, readJSON, writeJSON, sha1 } = require('../core/util')
async function verify (id, origin = 'http://127.0.0.1:8792') {
  if (!/^[\w.-]+$/.test(id || '')) throw new Error('run ID required')
  const dir = path.join(RUNS, id), base = path.join(ROOT, 'eval/app-demo-20261016')
  const m = readJSON(path.join(dir, 'manifest.json')), fix = readJSON(path.join(dir, 'fix/fixes.json'))
  const plan = fix.app_plan, check = readJSON(path.join(dir, 'pipeline.json')), repair = readJSON(path.join(dir, 'fix/pipeline.json'))
  assert.equal(check.source, 'dify'); assert.equal(repair.source, 'dify')
  assert.equal(check.state, 'succeeded'); assert.equal(repair.state, 'succeeded')
  assert.equal(plan.status, 'complete'); assert.equal(plan.screens.length, 4)
  assert.ok(plan.tasks.some(t => t.target_ids.length >= 3))
  assert.ok(plan.tasks.some(t => t.attempts.some(a => !a.ok && a.regress.some(g => g.screen === 'atelier/confirmation'))))
  assert.ok(plan.tasks.some(t => t.decisions.some(a => a.action === 'replan' && a.scope && a.reason)))
  assert.ok(fix.items.some(t => t.attempts.some(a => a.source === 'llm' && a.ok)))
  assert.equal(fix.combined.regress.length, 0); assert.equal(fix.combined.fixed_count, 3)
  for (const [rel, hash] of Object.entries(fix.combined.before_sha1)) assert.equal(sha1(fs.readFileSync(path.join(m.local.project, rel), 'utf8')), hash, 'original must remain unchanged')
  const res = await fetch(origin + '/api/demo/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DQA': '1' }, body: JSON.stringify({ run_id: id, app: 'atelier' }) })
  assert.equal(res.ok, true); const preview = await res.json()
  const app = readJSON(path.join(base, 'app-manifest.json')), results = [], shots = path.join(base, 'evidence', id)
  fs.mkdirSync(shots, { recursive: true }); const browser = await launch()
  try {
    for (const [w,h] of [[375,812],[390,844],[430,932],[375,667],[320,568]]) {
      const ctx = await newContext(browser, { origin, width:w, height:h, allowHosts:[], blocked:[], writes:[] })
      try {
        const page = await ctx.newPage(); await page.goto(origin + preview.url)
        for (let i=0;i<app.screens.length;i++) {
          const screen = app.screens[i], spec = readJSON(path.join(dir,m.design[screen.id].json))
          const expected = spec.nodes.find(n => n.reactions?.length)
          const label = expected.children.find(n => n.text).text.content
          const button = page.getByRole('button', { name:label, exact:true })
          await button.waitFor(); await page.evaluate(() => document.fonts.ready)
          assert.equal(new URL(page.url()).pathname.endsWith(screen.path), true)
          const color = await button.evaluate(el => getComputedStyle(el).backgroundColor)
          const hex = expected.fill.hex; const rgb = 'rgb(' + [1,3,5].map(x=>parseInt(hex.slice(x,x+2),16)).join(', ') + ')'
          assert.equal(color, rgb, screen.id+' color')
          await button.scrollIntoViewIfNeeded()
          await page.screenshot({path:path.join(shots,screen.id.split('/')[1]+'-'+w+'x'+h+'.png'),fullPage:true})
          await button.click(); await page.waitForURL('**'+app.screens[(i+1)%4].path)
          results.push({screen:screen.id,size:`${w}x${h}`,color,expected:hex,landing:new URL(page.url()).pathname,ok:true})
        }
        assert.equal(await page.evaluate(()=>sessionStorage.getItem('atelier-reservation')),'A1042')
      } finally { await ctx.close() }
    }
  } finally { await browser.close() }
  const report = { status:'passed', run_id:id, at:new Date().toISOString(), dify_check:check.workflow_run_id, dify_repair:repair.workflow_run_id, original_unchanged:true, grouped_tasks:plan.tasks.length, replan_count:plan.tasks.flatMap(t=>t.decisions).filter(a=>a.action==='replan').length, screens:4, viewports:5, journey_transitions:results.length, results }
  writeJSON(path.join(base, 'e2e-result.json'), report)
  writeJSON(path.join(shots, 'e2e-result.json'), report)
  const rejected = plan.tasks.flatMap(t=>t.attempts).filter(a=>!a.ok).length
  const lines = ['# Atelier 실제 E2E 검증 결과', '', `실행: ${id}`, '', '| 항목 | 결과 |', '|---|---|',
    `| Figma / 로컬 앱 | 실제 Figma 4프레임 / 예약 앱 4화면 |`,
    `| 발견 → 해결 후 | ${readJSON(path.join(dir,'defects.json')).length}건 → ${fix.combined.after.length}건 |`,
    `| 공통 수정 작업 | ${plan.tasks.length}개 |`, `| 거부된 후보 / 모델 재계획 | ${rejected}개 / ${report.replan_count}회 |`,
    `| 최종 회귀 | ${fix.combined.regress.length}건 |`, `| 독립 예약 경로 | ${results.length}개 화면 이동 통과 (4화면 × 5크기) |`,
    `| 원본 파일 | 해시 동일, 수정하지 않음 |`, `| Dify 검사 / 수정 시간 | ${check.total_sec}초 / ${repair.total_sec}초 |`, '',
    '## 실행 근거', '', `- Dify 검사: ${check.workflow_run_id}`, `- Dify 수정: ${repair.workflow_run_id}`,
    `- 전체 전후 비교: http://127.0.0.1:8792/#/runs/${id}/fix`, `- 에이전트 계획·후보·실패: ../../dqa/runs/${id}/fix/app-plan.json`,
    '- 실제 Figma: https://www.figma.com/design/Yz8NzeU2wjqmzuYkRvvSfm', '', '## 실제 채택 코드', '', '```diff',fs.readFileSync(path.join(dir,'fix/fix_all.patch'),'utf8').trim(),'```','',
    '## 해석 범위', '', '동일한 공통 버튼 색 오류가 세 화면에 나타나는 통제된 개발용 사례다. 정상인 완료 화면의 다른 변형을 깨뜨리는 후보를 실제 측정으로 거부한 뒤, 모델이 범위를 좁혀 수정했는지 확인했다. 일반 앱의 자동 수정 성공률이나 모든 상태의 품질 보장은 아니다.', '',
    'Figma 수치 비교는 시안 크기와 보조 폭에서 수행하며, 레이아웃 규칙은 모바일 5크기, 버튼 회귀는 기본·최소·최대 폭에서 수행한다. 위 독립 E2E는 별도로 5크기 모두에서 색상·페이지 이동·예약 상태를 확인한다.', '']
  fs.writeFileSync(path.join(base, 'RESULTS.md'), lines.join('\n'))
  console.log(JSON.stringify(report,null,2)); return report
}
if (require.main === module) verify(process.argv[2]).catch(e=>{console.error(e);process.exitCode=1})
module.exports = { verify }
