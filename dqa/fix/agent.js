// 코드 에이전트: 결함 하나를 고치려고 코드를 읽고·찾고·고쳐 보는 루프. 고치면 도구가 사본에 적용해 다시 빌드·재측정하고 결과를 돌려준다.
// 다음 행동은 관찰(읽은 코드, 검색 결과, 검증 결과)에 따라 모델이 정한다. 행동과 횟수는 좁게 묶는다(작은 모델 보호).
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { facts, askJSON, numbersOk } = require('../judge/ollama')

const ACTION = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['read', 'search', 'edit', 'give_up'] },
    file: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' },
    text: { type: 'string' },
    find: { type: 'string' }, replace: { type: 'string' }, why: { type: 'string' },
    reason: { type: 'string' }
  },
  required: ['action']
}

const SYSTEM = `너는 디자인 결함을 고치는 코드 에이전트다. 측정 도구가 결함을 쟀고, 너는 소스를 읽고 가장 작은 수정을 만들어 검증받는다.
행동은 JSON 하나로 한다.
- {"action":"read","file":"경로","start":줄,"end":줄} 파일의 줄 범위를 읽는다(한 번에 40줄까지).
- {"action":"search","text":"찾을 글자"} 소스에서 글자를 찾는다.
- {"action":"edit","file":"경로","find":"바꿀 한 줄 그대로","replace":"고친 한 줄","why":"왜 이 수정으로 결함이 사라지는지 한두 문장"} 도구가 사본에 적용해 다시 빌드하고 같은 크기로 재서 결과를 알려 준다.
- {"action":"give_up","reason":"..."} 더 할 수 있는 것이 없을 때.
규칙:
1. find는 읽은 코드의 한 줄을 줄 번호 없이 글자 그대로 복사한다. 파일에 정확히 한 번 있어야 한다.
2. 수정은 작게: 속성 하나를 더하거나 값 하나를 바꾼다. 없는 속성·함수를 지어내지 않는다.
3. 검증 결과가 "결함 남음"이면 원인을 다시 찾는다. "다른 결함 악화"면 그 수정은 되돌려졌으니 다른 방법을 찾는다.
4. [진단 사실]과 [지식]을 먼저 본다. why에 쓰는 숫자는 사실·코드에 있는 것만.`

function inside (srcRoot, srcDir, rel) {
  const abs = path.resolve(srcRoot, rel || '')
  return abs.startsWith(path.resolve(srcRoot, srcDir) + path.sep) ? abs : null
}
const fileErr = (srcRoot, srcDir, rel) => {
  const abs = inside(srcRoot, srcDir, rel)
  if (!abs) return `${rel}는 소스 폴더(${srcDir}) 밖이다`
  if (!fs.existsSync(abs)) return `${rel} 파일이 없다. 컴포넌트는 다른 파일 안에 정의돼 있을 수 있다. search로 "function 이름"을 찾는다`
  return null
}

function observeRead (srcRoot, srcDir, a) {
  const err = fileErr(srcRoot, srcDir, a.file)
  if (err) return `읽기 실패: ${err}`
  const abs = inside(srcRoot, srcDir, a.file)
  const lines = fs.readFileSync(abs, 'utf8').split('\n')
  let s = Math.max(1, a.start || 1); let e = Math.min(lines.length, a.end || s + 39)
  if (e - s > 39) e = s + 39
  return `${a.file} ${s}~${e}줄(전체 ${lines.length}줄):\n` + lines.slice(s - 1, e).map((t, i) => `${s + i}: ${t.slice(0, 180)}`).join('\n')
}

function observeSearch (srcRoot, srcDir, a) {
  if (!a.text || a.text.length < 2) return '검색 실패: 두 글자 이상 넣는다'
  try {
    const out = execFileSync('rg', ['-n', '--no-heading', '-F', '--max-count', '5', '--glob', '*.{ts,tsx,js,jsx}', '--', a.text, path.join(srcRoot, srcDir)], { encoding: 'utf8', timeout: 15000 })
    const rows = out.split('\n').filter(Boolean).slice(0, 20).map((l) => path.relative(srcRoot, l).slice(0, 200))
    return rows.length ? `"${a.text}" 검색 결과 ${rows.length}줄:\n${rows.join('\n')}` : `"${a.text}" 검색 결과 없음`
  } catch (e) { return `"${a.text}" 검색 결과 없음` }
}

const brief = (r) => r.ok ? '검증 통과: 결함이 사라졌고 다른 결함은 생기거나 커지지 않았다'
  : r.build_ok === false ? `빌드 실패: ${(r.build_log || '').split('\n').filter((l) => /error/i.test(l)).slice(-3).join(' / ').slice(0, 300)}`
    : `${r.still && r.still.length ? '결함 남음' : '결함은 사라짐'}${r.regress && r.regress.length ? `, 다른 결함 악화·생김: ${r.regress.map((g) => `${g.rule} ${g.labels.join('·')} ${g.status === 'new' ? '새로 생김' : `${g.px}px로 커짐`}`).join(', ')}` : ''}. 이 수정은 되돌렸다`

// tryEdits(edits, label, targetIds) → 검증 결과. 반환: { attempts[], verified }
async function codeAgent (d, ctx) {
  const { cfg, srcRoot, srcDir, tryEdits, say, firstEdits } = ctx
  const attempts = []
  const trail = []
  // 1) 규칙 수정안이 있으면 먼저(진단이 분명한 유형)
  for (const e of firstEdits || []) {
    if (e.skipped) { attempts.push({ source: 'rule', skipped: e.skipped }); continue }
    const r = await tryEdits([e], `${d.rule} 규칙 수정안`, [d.id])
    attempts.push({ source: 'rule', edits: [e], ...r })
    trail.push({ step: trail.length + 1, action: 'edit(규칙)', detail: `${e.file}:${e.line}`, result: brief(r) })
    say(`${d.rule} ${d.labels.slice(0, 2).join(',')} 규칙 수정안: ${r.ok ? '검증 통과' : brief(r).slice(0, 80)}`)
    if (r.ok) return { attempts, trail, verified: attempts.length - 1 }
  }
  if (!ctx.llm) return { attempts, trail, verified: null }
  // 2) LLM 루프
  // 입력: 보고서 에이전트의 문제 정의서(있으면) + 측정·진단·지식·원본 사실
  const j = d.judge || {}
  const spec = j.status === 'ok' ? `[문제 정의(보고서 에이전트)]\n문제: ${j.problem}\n원본(기대): ${j.expected}\n판정: ${j.verdict} — ${j.reason}\n\n` : ''
  const fact = spec + facts(d, d.screen_title)
  const prior = attempts.filter((a) => a.edits).map((a) => `- 규칙 수정안 ${a.edits[0].file}:${a.edits[0].line} "${a.edits[0].replace.trim().slice(0, 120)}" → ${brief(a)}`).join('\n')
  const msgs = [{ role: 'system', content: SYSTEM }, { role: 'user', content: `${fact}${prior ? `\n\n[이미 해 본 수정]\n${prior}` : ''}\n\n첫 행동을 JSON으로 써라.` }]
  let reads = 0; let edits = 0; const maxSteps = 8; const tried = new Set(attempts.filter((a) => a.edits).map((a) => a.edits[0].replace.replace(/\s+/g, ' ').trim()))
  for (let step = 0; step < maxSteps; step++) {
    // 문맥 보호: 오래된 관찰은 첫 줄만 남긴다
    const view = msgs.map((m, i) => (m.role === 'user' && i > 1 && i < msgs.length - 4) ? { ...m, content: m.content.split('\n')[0] + ' …(줄임)' } : m)
    let r
    try { r = await askJSON(cfg, ACTION, view) } catch (e) { trail.push({ step: trail.length + 1, action: '오류', result: e.message }); break }
    const a = r.ans
    if (!a) { msgs.push({ role: 'assistant', content: String(r.raw).slice(0, 500) }, { role: 'user', content: 'JSON 행동 하나만 써라.' }); continue }
    msgs.push({ role: 'assistant', content: JSON.stringify(a) })
    let obs
    if (a.action === 'read') {
      if (reads >= 5) obs = '읽기·검색 횟수를 다 썼다. 이제 edit나 give_up을 한다'
      else { obs = observeRead(srcRoot, srcDir, a); if (!obs.startsWith('읽기 실패')) reads++ } // 실패한 읽기는 세지 않는다
      trail.push({ step: trail.length + 1, action: 'read', detail: `${a.file} ${a.start || 1}~${a.end || ''}`, result: obs.split('\n')[0] })
    } else if (a.action === 'search') {
      if (reads >= 5) obs = '읽기·검색 횟수를 다 썼다. 이제 edit나 give_up을 한다'
      else { obs = observeSearch(srcRoot, srcDir, a); reads++ }
      trail.push({ step: trail.length + 1, action: 'search', detail: a.text, result: obs.split('\n')[0] })
    } else if (a.action === 'edit') {
      const abs = inside(srcRoot, srcDir, a.file)
      const find = String(a.find || '').replace(/^\s*\d+:\s?/, '')
      const norm = String(a.replace || '').replace(/\s+/g, ' ').trim()
      let why = ''
      if (fileErr(srcRoot, srcDir, a.file)) obs = `수정 실패: ${fileErr(srcRoot, srcDir, a.file)}`
      else if (tried.has(norm)) obs = '이미 해 본 수정과 같다. 다른 수정을 한다'
      else {
        const text = fs.readFileSync(abs, 'utf8'); const n = find.trim() ? text.split(find).length - 1 : 0
        if (n !== 1) obs = `수정 실패: 찾을 줄이 파일에 ${n}번 있다(정확히 한 번이어야 한다). read로 줄을 확인하고 그대로 복사한다`
        else if (find === a.replace) obs = '바뀌는 것이 없다'
        else {
          const nc = numbersOk([a.why || ''], fact + '\n' + text)
          why = nc.ok ? (a.why || '') : `${a.why || ''} (사실에 없는 숫자 ${nc.bad.join(', ')} 포함)`
          const e = { source: 'llm', file: a.file, line: text.slice(0, text.indexOf(find)).split('\n').length, find, replace: a.replace, why }
          edits++; tried.add(norm)
          const res = await tryEdits([e], `${d.rule} 코드 에이전트 수정 ${edits}`, [d.id])
          attempts.push({ source: 'llm', edits: [e], ...res })
          obs = `검증 결과: ${brief(res)}`
          say(`${d.rule} ${d.labels.slice(0, 2).join(',')} 코드 에이전트 수정 ${edits}: ${res.ok ? '검증 통과' : brief(res).slice(0, 80)}`)
          trail.push({ step: trail.length + 1, action: 'edit', detail: `${a.file}:${e.line}`, result: brief(res) })
          if (res.ok) return { attempts, trail, verified: attempts.length - 1 }
          if (edits >= 3) { trail.push({ step: trail.length + 1, action: '중단', result: '수정 3번을 모두 썼다' }); break }
        }
      }
      if (!obs.startsWith('검증 결과')) trail.push({ step: trail.length + 1, action: 'edit', detail: a.file, result: obs })
    } else {
      trail.push({ step: trail.length + 1, action: 'give_up', result: a.reason || '' })
      break
    }
    msgs.push({ role: 'user', content: `${obs}\n\n다음 행동을 JSON으로 써라.` })
  }
  return { attempts, trail, verified: null }
}

module.exports = { codeAgent }
