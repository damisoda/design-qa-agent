// 보고서: report.md(사람용), pr_comment.md(PR 댓글 초안 — 게시하지 않는다).
const STATUS = { new: '새로 생김', worsened: '악화', unchanged: '기존', improved: '줄어듦', resolved: '해결', none: '—' }
const ORDER = { new: 0, worsened: 1, improved: 2, unchanged: 3, none: 4, resolved: 5 }

const st = (d) => (d.diff ? d.diff.status : 'none')
const px = (w) => (w.metric === 'lines' ? `${w.px}줄` : w.metric === 'height_ratio' ? `${w.px}배` : `${w.px}px`)
const sizeCell = (d) => d.widths.map((w) => `${w.w}x${w.h}: ${px(w)}${w.canvas_px !== w.px && w.metric !== 'lines' && w.metric !== 'height_ratio' ? `(시안 ${w.canvas_px})` : ''}`).join('<br>')

function sortDefects (list) {
  const sev = { 높음: 0, 중간: 1, '사람 확인 필요': 2, 낮음: 3 }
  return [...list].sort((a, b) => (!!a.accepted - !!b.accepted) || (ORDER[st(a)] - ORDER[st(b)]) || (sev[a.severity] - sev[b.severity]) || b.max_px - a.max_px)
}

function defectBlock (d, i) {
  const L = []
  L.push(`### ${i}. [${d.rule} ${d.rule_name}] ${d.labels.slice(0, 4).join(', ')}${d.labels.length > 4 ? ' 등' : ''}`)
  L.push('')
  L.push(`- 화면: ${d.screen_title || d.screen} · 상태: ${STATUS[st(d)]}${d.diff && d.diff.base_px != null ? `(변경 전 ${d.diff.base_px})` : ''} · 심각도: ${d.severity} · 신뢰도: ${d.confidence ? d.confidence.level : '—'}${d.accepted ? ' · **무시로 분류됨**' : ''}`)
  if (d.only_at) L.push(`- 이 크기에서만: ${d.only_at.join(', ')}`)
  L.push(`- 측정: ${d.widths.map((w) => `${w.w}x${w.h} ${px(w)}`).join(' / ')}`)
  for (const e of d.evidence.slice(0, 3)) L.push(`  - ${e.id} ${e.text}`)
  for (const g of d.diag || []) L.push(`- 진단(도구): ${g.text}`)
  const kn = require('../judge/knowledge').knowledgeFor(d.diag)
  if (kn.length) L.push(`- 관련 지식: ${kn.map((k) => k.id).join(', ')} (지식 문서 P01~P03)`)
  if (d.shots && d.shots.crop) L.push(`- 캡처: ![${d.id}](${d.shots.crop})`)
  const cands = (d.causes && d.causes.candidates) || []
  if (cands.length) {
    L.push('- 원인 후보:')
    for (const c of cands) L.push(`  ${c.rank}. \`${c.file}:${c.line}\` (${c.score}) — ${c.why.join(', ')}`)
  } else if (d.causes && d.causes.note) L.push(`- 원인 후보: ${d.causes.note}`)
  if (d.rule_text) L.push(`- 설명(규칙): ${d.rule_text.cause} ${d.rule_text.fix}`)
  const j = d.judge
  if (j && j.status === 'ok') { L.push(`- 문제(보고서 에이전트, ${j.model}, 숫자 검증 통과): ${j.problem}`); L.push(`- 원본(기대): ${j.expected}`); L.push(`- 판정: **${j.verdict}** — ${j.reason}`) } else if (j) L.push(`- 문제 정의(LLM): 없음 — ${j.reason}`)
  L.push(`- 결함 ID: \`${d.id}\``)
  return L.join('\n')
}

function reportMd (m, defects, resolved, codeFindings) {
  const L = []
  const head = m.targets.head; const base = m.targets.base
  L.push(`# 디자인 검수 보고서 — ${m.title}`)
  L.push('')
  L.push(`- 실행: ${m.run_id} · ${m.finished_at || ''} · 소요 ${m.total_sec}초`)
  L.push(`- 대상: ${head.note || head.ref}${base ? ` · 비교 기준(변경 전): ${base.note || base.ref}` : ''}`)
  L.push(`- 화면: ${m.recipes.map((r) => `${r.title}(${r.id})`).join(', ')} · 크기 ${m.sizes.length}개(${m.sizes.map((s) => s.join('x')).join(', ')})`)
  L.push(`- LLM(분류·한눈 요약): ${m.llm.status === 'ok' ? `${m.llm.model}, ${m.llm.calls}회 호출` : `사용 안 함 — ${m.llm.reason}`}`)
  L.push(`- 외부로 나간 요청: 0건(앱 출처 밖 요청 ${m.blocked_total}건은 모두 막음)`)
  const s = m.summary
  if (m.overview) { L.push(''); L.push(`> ${m.overview.text}${m.overview.status === 'ok' ? ` (한눈 요약: ${m.overview.model}, 숫자 검증 통과)` : ' (템플릿 요약)'}`) }
  L.push('')
  L.push(`## 요약`)
  L.push('')
  L.push(`| 새로 생김 | 악화 | 기존 | 해결 | 무시로 분류 | 측정 실패 |`)
  L.push(`|---|---|---|---|---|---|`)
  L.push(`| ${s.new} | ${s.worsened} | ${s.unchanged + s.improved} | ${s.resolved} | ${s.accepted} | ${s.failed_sizes} |`)
  if (!base) L.push('\n비교 기준이 없어 모든 결함을 "—"(상태 없음)로 보고한다.')
  L.push('')
  L.push(`## 결함 표`)
  L.push('')
  L.push(`| # | 상태 | 규칙 | 요소 | 크기별 측정 | 원인 1위 |`)
  L.push(`|---|---|---|---|---|---|`)
  const list = sortDefects(defects)
  list.forEach((d, i) => { const c = d.causes && d.causes.candidates && d.causes.candidates[0]; L.push(`| ${i + 1} | ${d.accepted ? '무시' : STATUS[st(d)]} | ${d.rule} ${d.rule_name} | ${d.labels.slice(0, 3).join(', ')} | ${sizeCell(d)} | ${c ? `\`${c.file}:${c.line}\`` : '—'} |`) })
  if (!list.length) L.push('| — | — | — | 결함 없음 | — | — |')
  L.push('')
  L.push(`## 결함 상세`)
  L.push('')
  list.forEach((d, i) => { L.push(defectBlock(d, i + 1)); L.push('') })
  if (resolved.length) {
    L.push(`## 해결된 결함(변경 전에만 있음)`)
    L.push('')
    for (const d of resolved) L.push(`- [${d.rule} ${d.rule_name}] ${d.labels.slice(0, 4).join(', ')} — 변경 전 ${d.widths.map((w) => `${w.w}x${w.h} ${px(w)}`).join(', ')}`)
    L.push('')
  }
  if (codeFindings && codeFindings.length) {
    L.push(`## 코드 검사: 이번 변경에서 새로 쓴 색 값`)
    L.push('')
    L.push(`| 파일:줄 | 값 | 토큰 | 판정 |`)
    L.push(`|---|---|---|---|`)
    for (const f of codeFindings) L.push(`| \`${f.file}:${f.line}\` | ${f.hex} | ${f.token || '없음'} | ${f.token ? 'D1 토큰 미사용(같은 값의 토큰이 있다)' : 'D2 토큰 밖 값(사람 확인 필요)'} |`)
    L.push('')
  }
  if (m.failures.length) {
    L.push(`## 측정 실패`)
    L.push('')
    for (const f of m.failures) L.push(`- ${f.side} ${f.screen} ${f.size}: ${f.error}${f.fail_shot ? ` (캡처 ${f.fail_shot})` : ''}`)
    L.push('')
  }
  L.push(`## 방법`)
  L.push('')
  L.push(`- 크기마다 새 브라우저 컨텍스트로 화면에 들어가(레시피), 배치가 멈출 때까지 기다린 뒤 스크롤 단계마다 규칙(R1 넘침·R2 잘림·R3 겹침·R4 가려짐·R6 줄바꿈·R7 틀 이탈)을 적용했다. R5는 크기 사이 비교다.`)
  L.push(`- 수치·진단·원인 후보는 모두 코드가 만들었다. LLM은 결함인지 의도된 디자인인지 분류하고 한눈 요약만 쓴다. 답에 측정 사실에 없는 숫자가 나오면 버린다.`)
  L.push(`- 수정은 코드 에이전트가 한다(dqa fix): 규칙 수정안 → 코드 읽기·검색·수정 루프, 사본에 적용해 다시 빌드·재측정해서 통과한 것만 패치로 낸다.`)
  L.push(`- 신뢰도는 코드가 계산한다(재현된 크기 수, 재측정 일치, 원인 후보 점수).`)
  return L.join('\n')
}

function prComment (m, defects, resolved) {
  const live = defects.filter((d) => !d.accepted && (!d.diff || d.diff.status === 'new' || d.diff.status === 'worsened'))
  const L = [`### 디자인 검수(dqa) — ${m.recipes.map((r) => r.title).join(', ')}`, '']
  if (!live.length) L.push(`새로 생기거나 악화된 배치 결함이 없습니다. 크기 ${m.sizes.length}개에서 확인했습니다.${resolved.length ? ` 해결된 결함 ${resolved.length}건.` : ''}`)
  else {
    L.push(`새로 생기거나 악화된 결함 ${live.length}건:`)
    for (const d of sortDefects(live)) { const c = d.causes && d.causes.candidates && d.causes.candidates[0]; L.push(`- [${d.rule} ${d.rule_name}] ${d.labels.slice(0, 3).join(', ')} — ${d.widths.map((w) => `${w.w}px ${px(w)}`).join(', ')}${c ? ` · 원인 후보 \`${c.file}:${c.line}\`` : ''}`) }
  }
  L.push('', '<sub>로컬 측정 결과입니다. 이 초안은 자동으로 게시되지 않습니다.</sub>')
  return L.join('\n')
}

module.exports = { reportMd, prComment, sortDefects, STATUS }
