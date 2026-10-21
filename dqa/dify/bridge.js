const { unsupportedClaims } = require('../judge/grounding')
// Dify 작업 앱의 보고서 에이전트(Dify LLM 노드 + 3주차 지식 검색)를 위한 다리.
// 1) llm_ready: 맥미니를 부를 수 있는지(연결, 모델, 다른 모델 적재, 여유 메모리 20%) — 안 되면 Dify가 LLM을 건너뛴다
// 2) facts: 실행의 결함 중 새로 생김·악화·상태 없음을 심각도 순으로 몇 개 골라, LLM에 줄 측정 사실과 검색어·차트 수치·캡처 주소를 만든다
// 3) judge: Dify LLM이 쓴 문제 정의서(JSON)를 받아 숫자와 근거 ID를 검증하고, 통과한 것만 결함 레코드에 저장한다(웹 화면·코드 에이전트가 쓴다)
// 숫자는 dqa가 잰 사실과 검색된 근거 문서에 있는 것만 허용한다. 끝나면 맥미니 모델을 내린다.
const fs = require('fs')
const path = require('path')
const { RUNS, readJSON, writeJSON } = require('../core/util')
const { preflight, numbersOk, expectedFacts, criteriaFor, http } = require('../judge/ollama')

const SEV = { 높음: 0, 중간: 1, '사람 확인 필요': 2, 낮음: 3 }
const live = (d) => !d.accepted && (!d.diff || ['new', 'worsened'].includes(d.diff.status))

async function llmReady (cfg) {
  const model = cfg.dify.llm_model
  // Dify LLM 노드는 생각 끔 중계기(18435)를 거친다. 꺼져 있으면 LLM 노드가 실패하니 미리 건너뛴다
  if (!(await require('../ops/doctor').portOpen(18435))) return { ok: false, reason: '생각 끔 중계기(127.0.0.1:18435)가 꺼져 있다. node dqa/cli.js up으로 띄운다', free_pct: null, model }
  const r = await preflight({ ...cfg, ollama: { ...cfg.ollama, model } })
  return { ok: !!r.ok, reason: r.ok ? `맥미니 여유 ${r.free === null || r.free === undefined ? '확인 불가' : r.free + '%'}, 모델 ${model}` : r.reason, free_pct: r.free === undefined ? null : r.free, model }
}

// LLM에 줄 짧은 사실(코드 조각은 빼고 수치·시안 값·원인 위치만)
function shortFacts (d) {
  const L = [`[결함 ${d.id}] ${d.rule} ${d.rule_name} · ${d.screen_title || d.screen}`]
  const c = criteriaFor(d); if (c) L.push(`[판정 기준(P03)] ${c}`)
  L.push(`[요소] ${(d.labels || []).slice(0, 4).join(', ')}`)
  for (const w of (d.widths || []).slice(0, 3)) L.push(`[측정 ${w.w}x${w.h}] ${w.text || w.px}`)
  for (const e of (d.evidence || []).slice(0, 3)) L.push(`[근거 ${e.id}] ${e.text}`)
  if (d.diff) L.push(`[변경 비교] ${d.diff.status}`)
  for (const g of d.diag || []) L.push(`[진단] ${g.text}`)
  L.push(...expectedFacts(d))
  for (const x of ((d.causes && d.causes.candidates) || []).slice(0, 2)) L.push(`[원인 후보] ${x.file}:${x.line} — ${(x.why || []).slice(0, 2).join(', ')}`)
  return L.join('\n')
}

// 지식 검색어: 규칙 이름과 진단·시안 속성을 한국어로(3주차 검색어 확장 노드가 영어 용어를 덧붙인다)
const WORD = { R1: '넘침', R2: '잘림', R3: '겹침', R4: '가려짐 탭바 안전영역', R5: '화면 폭 줄바꿈', R6: '줄바꿈', R7: '모달 넘침', A1: '터치 영역', A2: '글자 대비 색', D2: '색 토큰', D3: '글꼴 타이포', D4: '그림 비율', D5: '모서리 테두리', L1: '정렬', L2: '간격 패딩', F1: 'Fill 고정 너비', T1: '문구', M1: '빠진 글자', M2: '그림', I1: '눌림 상태 반응', I2: '눌림 오류', I3: '이동 화면', I4: '프로토타입 이동 목적지', G1: '아이콘 기호 글자 글꼴 깨짐' }
function queryOf (ds) {
  return [...new Set(ds.map((d) => `${d.rule} ${d.rule_name} ${WORD[d.rule] || ''}`.trim()))].join(' · ') + ' 판정 기준 대응'
}

function pickRun (runId) {
  const dir = path.join(RUNS, String(runId || ''))
  if (!runId || !/^[\w.-]+$/.test(runId) || !fs.existsSync(path.join(dir, 'defects.json'))) throw new Error(`결함 기록이 없는 실행: ${runId}`)
  return dir
}

function factsFor (runId, cfg) {
  const dir = pickRun(runId)
  const all = readJSON(path.join(dir, 'defects.json'), [])
  const ds = all.filter(live).sort((a, b) => ((SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9)) || (b.max_px || 0) - (a.max_px || 0)).slice(0, cfg.dify.facts_max)
  const manifest = readJSON(path.join(dir, 'manifest.json'), {})
  const project = manifest.repo === 'cbh' ? 'cbh' : 'generic'
  const count = (key) => all.reduce((m, d) => { const k = key(d); m[k] = (m[k] || 0) + 1; return m }, {})
  const base = `http://127.0.0.1:${cfg.serve.port}`
  return {
    ok: true, run_id: runId, total: all.length, live: all.filter(live).length,
    ids: ds.map((d) => d.id),
    facts: ds.map(shortFacts).join('\n\n'),
    query: ds.length ? queryOf(ds) : '',
    queries: ds.map(d => JSON.stringify({ id:d.id, rule:d.rule, kind:'rule', project, query:`web ${d.rule} ${d.rule_name} ${WORD[d.rule]||''} ${(d.diag||[]).map(x=>x.code).join(' ')} ${d.design ? (d.design.values||[]).map(x=>x.prop).join(' ') : ''} 판정 기준 대응` })),
    by_rule: count((d) => d.rule), by_status: count((d) => (d.accepted ? 'accepted' : d.diff ? d.diff.status : 'none')), by_kind: count((d) => d.kind || 'rule'),
    shots: ds.map((d) => { const w = (d.widths || [])[0] || {}; const f = w.shot || w.clean; return f ? { id: d.id, label: `${d.rule} ${d.rule_name} · ${(d.labels || [])[0] || ''}`.slice(0, 60), url: `${base}/api/runs/${encodeURIComponent(runId)}/file/${f}` } : null }).filter(Boolean),
    design: ds.filter((d) => d.kind === 'design' && d.design).map((d) => ({ id: d.id, rule: d.rule, label: (d.labels || [])[0] || '', values: (d.design.values || []).map((v) => ({ prop: v.prop, design: v.design, impl: v.impl })) })),
    view_url: `${base}/#/runs/${runId}`
  }
}

// LLM 답에서 JSON 배열(또는 {items:[…]})을 꺼낸다. 코드 울타리·앞뒤 말은 무시
function parseAnswer (text) {
  const t = String(text || '').replace(/```(json)?/g, '')
  const a = t.indexOf('['); const b = t.lastIndexOf(']')
  for (const cand of [a >= 0 && b > a ? t.slice(a, b + 1) : null, t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)]) {
    if (!cand) continue
    try { const v = JSON.parse(cand); return Array.isArray(v) ? v : Array.isArray(v.items) ? v.items : [v] } catch (e) {}
  }
  return null
}

async function judgeSave (body, cfg) {
  const dir = pickRun(body.run_id)
  const pipeline = readJSON(path.join(dir, 'pipeline.json'), null)
  if (pipeline && ['cancelled', 'timeout', 'failed'].includes(pipeline.state)) return { ok: false, run_id: body.run_id, saved: 0, reason: '중지되거나 실패한 검사에는 설명을 저장하지 않습니다' }
  const f = factsFor(body.run_id, cfg)
  const all = readJSON(path.join(dir, 'defects.json'), [])
  const items = parseAnswer(body.answer)
  const context = String(body.context || '')
  let contexts = null
  if(body.contexts) { try { contexts=JSON.parse(body.contexts); if(!contexts || Array.isArray(contexts) || typeof contexts!=='object')throw new Error() } catch(e) {return {ok:false,saved:0,reason:'결함별 근거 JSON이 아닙니다'}} }
  const out = { ok: true, run_id: body.run_id, model: cfg.dify.llm_model, saved: 0, rejected: [], items: [] }
  if (!items) { out.ok = false; out.reason = 'LLM 답이 JSON이 아니다'; }
  const known = new Set((context.match(/\[[A-Z]\d{1,2}-\d{3}\]/g) || []))
  // 3주차 검색이 결함마다 자동으로 붙인 관련 근거(모델 인용과 따로 저장한다)
  let related = {}; try { related = JSON.parse(body.related || '{}') || {} } catch (e) {}
  for (const [k, it] of (items || []).entries()) {
    // 결함 ID가 틀리면 사실을 준 순서로 맞춘다
    if(contexts && !f.ids.includes(it.id)) {out.rejected.push({id:it.id,why:'측정 사실에 없는 결함 ID'});continue}
    const id = f.ids.includes(it.id) ? it.id : f.ids[k]
    const d = all.find((x) => x.id === id); if (!d) continue
    const fact = shortFacts(d)
    const itemContext = contexts ? String(contexts[id] || '') : context
    const itemKnown = new Set((itemContext.match(/\[[A-Z]\d{1,2}-\d{3}\]/g) || []))
    const n = numbersOk([it.problem, it.expected, it.reason].filter(Boolean), `${fact}\n${itemContext}`)
    const unsupported = unsupportedClaims(it, d)
    // 근거: 검색된 청크의 머리글 ID, 측정 근거 번호(측정 M1), 이 결함에 준 판정 기준(P03 행)만 남긴다. 지어낸 ID는 버린다
    const basis = [].concat(it.basis || []).map((b) => String(b).trim())
    const norm = (b) => { const citation=b.match(/^(\[[A-Z]\d{1,2}-\d{3}\])(?:\s+.*)?$/); if(citation) return citation[1]; const m = b.match(/^\[?(?:근거|측정)?\s*(M\d+)\]?$/); const z = b.match(/^\[?측정\s*(\d{3,4})\s*[x×]\s*(\d{3,4})\]?$/); return m ? `측정 ${m[1]}` : z ? `측정 ${z[1]}x${z[2]}` : b }
    const ev = new Set([...(d.evidence || []).map((e) => e.id), ...(d.widths || []).map((w) => `${w.w}x${w.h}`)])
    const p03 = (fact.match(/\[판정 기준\(P03\)\] \| ([A-Z]\d) \|/) || [])[1]
    const goodBasis = [...new Set(basis.map(norm).filter((b) => itemKnown.has(b) || (/^측정 /.test(b) && ev.has(b.slice(3))) || (p03 && new RegExp(`^P03\\s*${p03}$`).test(b))))]
    const verdictOk = ['결함', '의도된 디자인일 수 있음', '결함 아님'].includes(it.verdict)
    if (n.ok && unsupported.length === 0 && verdictOk && it.problem && it.expected && (!contexts || goodBasis.length > 0)) {
      const rel = (related[id] || []).filter((x) => x && itemKnown.has(x.id))
      d.judge = { status: 'ok', source: 'dify', model: cfg.dify.llm_model, verdict: it.verdict, problem: String(it.problem), expected: String(it.expected), reason: String(it.reason || ''), basis: goodBasis, dropped_basis: basis.filter((b) => !goodBasis.includes(norm(b))), retrieval_available: [...itemKnown], retrieval_cited: goodBasis.filter(b => itemKnown.has(b)), rag_status: itemKnown.size ? (goodBasis.some(b => itemKnown.has(b)) ? 'cited' : 'retrieved_not_cited') : 'no_evidence', related: rel, numbers_verified: true, at: new Date().toISOString() }
      out.saved++
      out.items.push({ id, rule: d.rule, label: (d.labels || [])[0] || '', verdict: it.verdict, problem: d.judge.problem, expected: d.judge.expected, basis: goodBasis, related: rel, verified: true })
    } else {
      const why = contexts && goodBasis.length === 0 ? '이 결함의 측정·검색 근거에 유효한 인용이 없다' : unsupported.length ? unsupported.join(', ') : !verdictOk ? `판정 값이 이상하다(${it.verdict})` : !n.ok ? `사실·근거에 없는 숫자 ${n.bad.join(', ')}` : '문제·기대가 비었다'
      d.judge = { status: 'fallback', source: 'dify', model: cfg.dify.llm_model, reason: `검증 실패: ${why}` }
      out.rejected.push({ id, rule: d.rule, label: (d.labels || [])[0] || '', why })
    }
  }
  writeJSON(path.join(dir, 'defects.json'), all)
  fs.mkdirSync(path.join(dir, 'judge'), { recursive: true })
  writeJSON(path.join(dir, 'judge', `dify_${Date.now()}.json`), { answer: String(body.answer || '').slice(0, 20000), context_ids: [...known], result: out })
  // 맥미니 보호: 끝나면 모델을 내린다
  if (cfg.dify.unload_after !== false) { try { await http(`${cfg.ollama.url}/api/generate`, { model: cfg.dify.llm_model, keep_alive: 0 }, 15000); out.unloaded = true } catch (e) { out.unloaded = false } }
  return out
}

module.exports = { llmReady, factsFor, judgeSave, parseAnswer, shortFacts, queryOf }
