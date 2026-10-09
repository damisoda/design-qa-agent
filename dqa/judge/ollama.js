// 판정자: 맥미니 Ollama(gemma4:e4b-16k)를 직접 부른다. 생각하기 끔(think:false), 온도 0, JSON 스키마 출력.
// 측정은 도구가 이미 했다. 모델은 주어진 사실만으로 판정·원인 고르기·수정 제안을 쓰고, 코드가 숫자를 검증한다.
// 맥미니 보호: 다른 모델이 올라가 있거나 여유 메모리가 기준 미만이면 부르지 않는다. 이미지는 보내지 않는다.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { KNOWLEDGE } = require('../core/util')
const { knowledgeFor } = require('./knowledge')

async function http (url, body, timeoutMs) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(t) }
}

function macFree (cfg) {
  try {
    const out = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', cfg.mac_mini.ssh, 'memory_pressure | tail -1'], { encoding: 'utf8', timeout: 20000 })
    const m = out.match(/(\d+)%/); return m ? Number(m[1]) : null
  } catch (e) { return null }
}

// 부를 수 있는지: 연결, 모델 존재, 다른 모델 적재 여부, 맥미니 여유 메모리
async function preflight (cfg) {
  const o = cfg.ollama
  try {
    const tags = await http(`${o.url}/api/tags`, null, 4000)
    if (!(tags.models || []).some((m) => m.name === o.model || m.model === o.model)) return { ok: false, reason: `모델 ${o.model}이 Ollama에 없다` }
    const ps = await http(`${o.url}/api/ps`, null, 4000)
    const others = (ps.models || []).map((m) => m.name).filter((n) => n !== o.model)
    if (others.length) return { ok: false, reason: `다른 모델이 올라가 있다(${others.join(', ')}). 맥미니 보호를 위해 건너뜀` }
    const free = macFree(cfg)
    if (free !== null && free < o.min_free_pct) return { ok: false, reason: `맥미니 여유 메모리 ${free}% < ${o.min_free_pct}%` }
    return { ok: true, free, loaded: (ps.models || []).length > 0 }
  } catch (e) { return { ok: false, reason: `Ollama 연결 없음(${o.url}): ${e.name === 'AbortError' ? '시간 초과' : e.message}. 터널은 dqa up으로 연다` } }
}

// 판정 기준: P03의 해당 규칙 행(결함 유형표)
let P03 = null
function criteria (rule) {
  if (P03 === null) { try { P03 = fs.readFileSync(path.join(KNOWLEDGE, 'P03_결함_유형과_측정_방법.md'), 'utf8') } catch (e) { P03 = '' } }
  const row = P03.split('\n').find((l) => l.startsWith(`| ${rule} |`))
  return row ? row.replace(/\s+/g, ' ').trim() : ''
}

// 보고서 에이전트(문제 정의): 결함마다 "무엇이 문제인가 · 원본(기대)은 어떠해야 하는가 · 진짜 결함인가"를 쓴다.
// 이 문제 정의서가 코드 에이전트(fix/agent.js)의 입력이 된다. 숫자는 측정 사실에 있는 것만 쓴다(코드가 검사).
const SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['결함', '의도된 디자인일 수 있음', '결함 아님'] },
    problem: { type: 'string' },
    expected: { type: 'string' },
    reason: { type: 'string' }
  },
  required: ['verdict', 'problem', 'expected', 'reason']
}

const SYSTEM = `너는 디자인 검수의 보고서 에이전트다. 측정은 도구가 이미 했다. 너는 결함 하나의 문제 정의서를 쓴다. 이 정의서를 받아 코드 에이전트가 코드를 고친다.
쓸 것:
- problem: 무엇이 문제인가. 어느 화면·요소가 어떤 크기에서 어떻게 깨지는지 한두 문장.
- expected: 원본(기대)은 어떠해야 하는가. [원본·기대] 사실(변경 전 상태, 판정 기준, 지식의 대응)을 근거로 한두 문장.
- verdict: "결함"(판정 기준에 맞고 깨져 보임) / "의도된 디자인일 수 있음"(말줄임·줄 수 제한처럼 일부러 자른 것, 특정 크기에서만 생겨 의도가 모호함) / "결함 아님"(측정이 잘못 잡은 것이 분명함).
- reason: verdict의 이유 한 문장.
규칙: 숫자는 사실에 있는 것만 쓴다. 코드를 어떻게 고칠지는 쓰지 않는다(코드 에이전트의 일). 한국어로 짧게.`

// 원본·기대: 코드가 아는 사실(변경 전 상태, 판정 기준, 지식의 대응). Figma 원본 값은 2단계에서 붙는다.
function expectedFacts (d) {
  const L = []
  const row = criteria(d.rule)
  const cols = row.split('|').map((x) => x.trim())
  if (cols.length > 4 && cols[4]) L.push(`[원본·기대(판정 기준 P03)] 이렇게 되면 결함이다: ${cols[4]}`)
  if (d.diff) {
    if (d.diff.status === 'new') L.push('[원본·기대(변경 전)] 변경 전 커밋에서는 이 결함이 없었다')
    else if (d.diff.status === 'worsened') L.push(`[원본·기대(변경 전)] 변경 전에는 ${d.diff.base_px}였다`)
    else L.push('[원본·기대(변경 전)] 변경 전에도 같은 결함이 있었다(기존 결함)')
  }
  for (const k of knowledgeFor(d.diag)) { const fix = k.text.split('\n').find((l) => l.includes('대응')); if (fix) L.push(`[원본·기대(지식 ${k.id})] ${fix.replace(/^[-*\s]+/, '').replace(/\*\*/g, '')}`) }
  L.push('[원본·기대(Figma)] 아직 없음(2단계에서 Figma 플러그인 값으로 채운다)')
  return L
}

function facts (d, screenTitle) {
  const lines = []
  lines.push(`[규칙] ${d.rule} ${d.rule_name}`)
  const c = criteria(d.rule); if (c) lines.push(`[판정 기준(P03)] ${c}`)
  lines.push(`[화면] ${screenTitle || d.screen}`)
  lines.push(`[요소] ${d.labels.slice(0, 6).join(', ')}`)
  for (const w of d.widths) lines.push(`[측정 ${w.w}x${w.h}] ${w.text || ''}${w.scale && w.scale !== 1 ? ` (화면 배율 ${w.scale}, 시안 기준 ${w.canvas_px})` : ''}`)
  for (const e of d.evidence.slice(0, 4)) lines.push(`[근거 ${e.id}] ${e.text}`)
  if (d.only_at) lines.push(`[크기] 이 크기에서만 나타남: ${d.only_at.join(', ')}`)
  if (d.diff) lines.push(`[변경 비교] ${d.diff.status}${d.diff.base_px !== null && d.diff.base_px !== undefined ? ` (변경 전 ${d.diff.base_px})` : ''}`)
  for (const g of d.diag || []) lines.push(`[진단 사실(도구가 계산 스타일로 확인)] ${g.text}`)
  for (const k of knowledgeFor(d.diag)) lines.push(`[지식 ${k.id}]\n${k.text}`)
  lines.push(...expectedFacts(d))
  const el = d.elements[0]
  if (el && el.style) lines.push(`[계산 스타일: ${el.label}] ${Object.entries(el.style).filter(([k, v]) => v && !/color/i.test(k)).map(([k, v]) => `${k}=${v}`).join('; ').slice(0, 400)}`)
  const cands = (d.causes && d.causes.candidates) || []
  cands.forEach((x) => {
    lines.push(`[원인 후보 ${x.rank}] ${x.file}:${x.line} — ${x.why.join(', ')}`)
    if (x.snippet) lines.push(x.snippet)
    if (x.context) lines.push(`[원인 후보 ${x.rank}의 컴포넌트 정의와 스타일]`, x.context)
  })
  return lines.join('\n')
}

// 답에 나온 숫자가 모두 사실 안에 있는지(score_bench.py의 정직성 검사와 같은 생각). 9 이하 정수(개수 등)는 허용
function numbersOk (texts, factText) {
  const allowed = new Set(factText.match(/\d+(\.\d+)?/g) || [])
  const used = [].concat(texts).join(' ').match(/\d+(\.\d+)?/g) || []
  const bad = used.filter((n) => !allowed.has(n) && !(Number(n) <= 9 && Number.isInteger(Number(n))))
  return { ok: bad.length === 0, bad }
}

async function askJSON (cfg, schema, msgs) {
  const o = cfg.ollama
  const r = await http(`${o.url}/api/chat`, { model: o.model, stream: false, think: false, format: schema, options: { temperature: 0 }, messages: msgs }, o.timeout_ms)
  let ans = null; try { ans = JSON.parse(r.message && r.message.content) } catch (e) {}
  return { ans, raw: r.message && r.message.content, eval_count: r.eval_count, prompt_eval_count: r.prompt_eval_count }
}

async function judgeOne (d, cfg, screenTitle, saveDir) {
  const fact = facts(d, screenTitle)
  const msgs = [{ role: 'system', content: SYSTEM }, { role: 'user', content: `${fact}\n\n위 사실로 문제 정의서 JSON을 써라.` }]
  const t0 = Date.now(); let tries = 0; let last = null
  while (tries < 2) {
    tries++
    const r = await askJSON(cfg, SCHEMA, msgs)
    if (!r.ans) { msgs.push({ role: 'assistant', content: String(r.raw).slice(0, 2000) }, { role: 'user', content: 'JSON 형식이 아니다. 스키마대로 다시 써라.' }); continue }
    const n = numbersOk([r.ans.problem, r.ans.expected, r.ans.reason], fact)
    last = { ...r, n }
    if (n.ok) break
    msgs.push({ role: 'assistant', content: r.raw }, { role: 'user', content: `사실에 없는 숫자(${n.bad.join(', ')})를 썼다. 사실에 있는 숫자만 쓰거나 숫자를 빼고 다시 써라.` })
  }
  const ms = Date.now() - t0
  if (saveDir) { fs.mkdirSync(saveDir, { recursive: true }); fs.writeFileSync(path.join(saveDir, `${d.id}.json`), JSON.stringify({ facts: fact, messages: msgs, last, ms }, null, 1)) }
  if (last && last.n.ok) return { status: 'ok', model: cfg.ollama.model, verdict: last.ans.verdict, problem: last.ans.problem, expected: last.ans.expected, reason: last.ans.reason, numbers_verified: true, tries, ms, out_tokens: last.eval_count, in_tokens: last.prompt_eval_count }
  return { status: 'fallback', model: cfg.ollama.model, reason: last ? `검증 실패: 사실에 없는 숫자 ${last.n.bad.join(', ')}` : 'JSON 아님', tries, ms }
}

// 보고자의 한눈 요약(LLM 1회). 숫자 검증에 실패하면 템플릿 문장을 쓴다.
const SUMMARY_SCHEMA = { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] }
async function summarizeRun (m, defects, resolved, cfg) {
  const L = []
  const s = m.summary
  L.push(`[화면] ${m.recipes.map((r) => r.title).join(', ')} · 크기 ${m.sizes.length}개 · ${m.targets.base ? '변경 전과 비교함' : '비교 기준 없음'}`)
  L.push(`[개수] 새로 생김 ${s.new}, 악화 ${s.worsened}, 기존 ${s.unchanged + s.improved}, 상태 없음 ${s.no_base}, 해결 ${s.resolved}, 무시 ${s.accepted}`)
  for (const d of defects.filter((x) => !x.accepted).slice(0, 5)) {
    const w = d.widths[0]; const c = d.causes && d.causes.candidates[0]
    L.push(`[결함] ${d.rule} ${d.rule_name} · ${d.labels.slice(0, 3).join(', ')} · ${d.diff ? d.diff.status : '상태 없음'} · ${w ? `${w.w}x${w.h}에서 ${w.px}` : ''} · 분류 ${d.judge && d.judge.status === 'ok' ? d.judge.verdict : '없음'}${c ? ` · 원인 후보 ${c.file}` : ''}`)
  }
  for (const d of resolved.slice(0, 3)) L.push(`[해결] ${d.rule} ${d.rule_name} · ${d.labels.slice(0, 3).join(', ')}`)
  const fact = L.join('\n')
  const template = `새로 생긴 결함 ${s.new}건, 악화 ${s.worsened}건, 해결 ${s.resolved}건.` + (defects[0] ? ` 가장 먼저 볼 것: ${defects[0].rule} ${defects[0].rule_name}(${defects[0].labels.slice(0, 2).join(', ')}).` : '')
  try {
    const r = await askJSON(cfg, SUMMARY_SCHEMA, [{ role: 'system', content: '너는 디자인 검수 보고서의 한눈 요약을 쓴다. 사실만으로 2~3문장. 가장 먼저 고칠 것과 이유를 말한다. 숫자는 사실에 있는 것만 쓴다. 한국어.' }, { role: 'user', content: fact }])
    const n = r.ans ? numbersOk([r.ans.summary], fact) : { ok: false, bad: [] }
    if (r.ans && n.ok) return { status: 'ok', text: r.ans.summary, model: cfg.ollama.model }
    return { status: 'fallback', text: template, reason: r.ans ? `사실에 없는 숫자 ${n.bad.join(', ')}` : 'JSON 아님' }
  } catch (e) { return { status: 'fallback', text: template, reason: e.message } }
}

// 규칙만으로 쓰는 문장(LLM을 못 쓰거나 검증에 실패했을 때)
function ruleSentence (d) {
  const w = d.widths[0]; const c = d.causes && d.causes.candidates && d.causes.candidates[0]
  return {
    cause: `${d.labels.slice(0, 3).join('·')}${d.labels.length > 3 ? ' 등' : ''}에서 ${d.rule_name}: ${w ? w.text : ''}${d.widths.length > 1 ? ` 외 ${d.widths.length - 1}개 크기` : ''}.`,
    fix: c ? `${c.file}:${c.line} 부근을 먼저 확인한다(${c.why[0]}).` : '원인 후보를 찾지 못했다. 소스 경로(--src)를 주면 찾는다.'
  }
}

async function unload (cfg) {
  try { await http(`${cfg.ollama.url}/api/generate`, { model: cfg.ollama.model, keep_alive: 0 }, 15000); return true } catch (e) { return false }
}

module.exports = { preflight, judgeOne, ruleSentence, facts, numbersOk, unload, askJSON, summarizeRun, expectedFacts }
