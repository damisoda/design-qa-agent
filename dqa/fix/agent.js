// 코드 에이전트: 결함 하나를 고치려고 코드를 읽고·찾고·고쳐 보는 루프. 고치면 도구가 사본에 적용해 다시 빌드·재측정하고 결과를 돌려준다.
// 다음 행동은 관찰(읽은 코드, 검색 결과, 검증 결과)에 따라 모델이 정한다. 행동과 횟수는 좁게 묶는다(작은 모델 보호).
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { facts, askJSON, numbersOk } = require('../judge/ollama')

const ACTION = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['read', 'search', 'replan', 'style', 'rn_style', 'jsx_prop', 'edit', 'give_up'] },
    file: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' },
    selector: { type: 'string' }, property: { type: 'string' }, value: { type: 'string' }, text: { type: 'string' }, scope: { type: 'string' },
    find: { type: 'string' }, replace: { type: 'string' }, why: { type: 'string' },
    reason: { type: 'string' }
  },
  required: ['action']
}

const SYSTEM = `너는 디자인 결함을 고치는 코드 에이전트다. 측정 도구가 결함을 쟀고, 너는 소스를 읽고 가장 작은 수정을 만들어 검증받는다.
행동은 JSON 하나로 한다.
- {"action":"read","file":"경로","start":줄,"end":줄} 파일의 줄 범위를 읽는다(한 번에 40줄까지).
- {"action":"search","text":"찾을 글자"} 소스에서 글자를 찾는다.
- {"action":"style","file":"CSS 파일","selector":"실제 클래스 선택자","property":"CSS 속성","value":"시안 값","why":"근거"} 공통 스타일 회귀에는 이 도구를 우선 사용한다. 실제 소스에 있는 클래스 조합에만 규칙을 추가/수정한다. 예시는 답이 아니며 실제 화면 계약과 클래스를 선택한다.
- {"action":"edit","file":"경로","start":find가실제로시작하는줄,"find":"바꿀 코드 블록 그대로","replace":"고친 코드 블록","why":"왜 이 수정으로 결함이 사라지는지 한두 문장"} 도구가 사본에 적용해 다시 빌드하고 같은 크기로 재서 결과를 알려 준다.
- {"action":"rn_style","file":"실제 TSX 파일","selector":"StyleSheet.create 안의 스타일 키","property":"color 등 RN 속성","value":"시안 값"} React Native 스타일을 바꾼다. CSS 전용 style은 RN에 사용하지 않는다.
- {"action":"jsx_prop","file":"실제 TSX 파일","selector":"실제 JSX 컴포넌트 이름","property":"color 등 속성","value":"시안 값","start":선택적시작줄} JSX 속성을 수정한다. start를 비우면 이 파일의 같은 컴포넌트 사용처 전부를 수정·검증한다.
- {"action":"replan","scope":"수정할 선택자/컴포넌트 범위","reason":"직전 검증이 실패한 이유와 새 접근"} 실패한 수정 뒤 검증 근거로 계획을 다시 정한다. reason은 두 문장 이내로 쓴다.
- {"action":"give_up","reason":"..."} 더 할 수 있는 것이 없을 때.
규칙:
1. find는 읽은 코드의 바꿀 부분을 줄 번호 없이 그대로 복사한다. start는 read 범위의 시작이 아니라 find가 실제로 시작하는 줄 번호이다. 예를 들어 read 1~20 중 8번째 줄을 바꾸면 start는 8이다. 고유한 find라면 start를 생략해도 된다. 중복이면 실제 start 줄을 지정한다. 파서가 변경 결과 문법을 검사한다.
2. 수정은 원인 범위로 제한한다. 표시 누락은 이미 존재하는 데이터가 JSX까지 전달되는지 확인하고 표시 로직을 수정할 수 있다. 시안 예시 문구를 하드코딩하거나 데이터 파일의 값을 바꿔 검사를 통과시키지 않는다. 읽지 않은 속성·함수는 추측하지 않는다.
3. 검증 결과가 "결함 남음"이면 원인을 다시 찾는다. "다른 결함 악화"면 그 수정은 되돌려졌으니 다른 방법을 찾는다.
4. 원인이 확정되지 않아도 읽은 코드와 측정 근거로 수정 가설을 만들어 사본에서 시험할 수 있다. 시안 목적지 글자를 현재 화면에 덧붙이거나 요소를 숨겨 검사를 통과시키지 않는다. 이미 읽은 같은 범위를 반복해서 읽지 말고, 관련 이벤트 핸들러가 범위 밖이면 그 부분을 읽는다.
5. I4의 목적지 화면 문구는 도착 확인 기준이지 현재 버튼의 라벨이 아니다. 버튼 문구를 목적지 제목으로 바꾸거나 현재 화면에 덧붙여 통과시키지 않는다. 가려짐 근거가 없으면 이동 실패를 CSS 문제로 가정하지 말고 클릭 핸들러와 실제 이동 주소를 확인한다. 화면 이름으로 파일 경로를 만들지 않는다. 이동 수정은 기대 화면 문구를 소스에서 검색해 실제 존재하는 목적지 파일을 확인하고 사용한다.
6. 공통 CSS 회귀가 발생한 상태에서는 edit 행동이 잠긴다. replan 후 반드시 style 행동을 사용한다. 공통 CSS 값을 바꿔 다른 변형이 깨졌다면 같은 전역 선언을 다시 edit하지 않는다. style로 실제 코드에 존재하는 변형 클래스 조합을 선택해 필요한 범위에만 시안 값을 적용한다.
7. 다른 화면 회귀가 생기면 반드시 replan을 한 뒤 edit한다. [앱 시안 계약]에서 화면별 의도 차이를 확인한다. 공통 스타일 수정이 모든 변형을 같은 값으로 만들면 안 된다.
8. [진단 사실]과 [지식]을 먼저 본다. why에 쓰는 숫자는 사실·코드에 있는 것만.`

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
  return `${a.file} ${s}~${e}줄(전체 ${lines.length}줄):\n` + lines.slice(s - 1, e).map((t, i) => `${s + i}: ${t.slice(0, 6000)}`).join('\n')
}

function observeSearch (srcRoot, srcDir, a) {
  if (!a.text || a.text.length < 2) return '검색 실패: 두 글자 이상 넣는다'
  try {
    const out = execFileSync('rg', ['-n', '--no-heading', '-F', '--max-count', '5', '--glob', '*.{ts,tsx,js,jsx,html,css,scss,vue,svelte}', '--', a.text, path.join(srcRoot, srcDir)], { encoding: 'utf8', timeout: 15000 })
    const rows = out.split('\n').filter(Boolean).slice(0, 20).map((l) => path.relative(srcRoot, l).slice(0, 200))
    return rows.length ? `"${a.text}" 검색 결과 ${rows.length}줄:\n${rows.join('\n')}` : `"${a.text}" 검색 결과 없음`
  } catch (e) { return `"${a.text}" 검색 결과 없음` }
}

const brief = (r) => r.ok ? '검증 통과: 결함이 사라졌고 다른 결함은 생기거나 커지지 않았다'
  : r.error ? r.error
  : r.build_ok === false ? `빌드 실패: ${(r.build_log || '').split('\n').filter((l) => /error/i.test(l)).slice(-3).join(' / ').slice(0, 300)}`
    : r.coverage_errors?.length ? '재검증 범위 누락: ' + r.coverage_errors.join(' / ')
    : `${r.still && r.still.length ? '결함 남음: ' + r.still.map(id => {const d=(r.after||[]).find(x=>x.id===id);return d?d.screen+' '+d.labels.join('·'):id}).join(', ') : '결함은 사라짐'}${r.regress && r.regress.length ? `, 다른 결함 악화·생김: ${r.regress.map((g) => `${g.screen || "화면 미상"} ${g.rule} ${g.labels.join('·')} ${g.status === 'new' ? '새로 생김' : `${g.px}px로 커짐`}`).join(', ')}` : ''}. 이 수정은 되돌렸다`

// tryEdits(edits, label, targetIds) → 검증 결과. 반환: { attempts[], verified }
function allowedActions (needsReplan, scopedOnly, reads = 0) {
  const actions = needsReplan ? ['replan', 'give_up'] : scopedOnly ? ['style', 'read', 'search', 'give_up'] : ACTION.properties.action.enum
  return reads >= 5 ? actions.filter(a=>a!=='read' && a!=='search') : actions
}

function actionSchema(d,scopes,needsReplan,scopedOnly,reads){
 const properties={...ACTION.properties,action:{type:'string',enum:allowedActions(needsReplan,scopedOnly,reads)}};
 const color=(d.design?.values||[]).find(v=>v.prop==='background-color'&&/^#[0-9a-f]{6}$/i.test(v.design));
 if(scopedOnly&&color){
  const selectors=scopes.filter(s=>!s.conflicting&&s.covers_all_target_screens!==false&&s.expected_fills.length&&s.expected_fills.every(v=>v.toUpperCase()===color.design.toUpperCase())).map(s=>s.selector);
  if(selectors.length){properties.selector={type:'string',enum:selectors};properties.property={type:'string',enum:[color.prop]};properties.value={type:'string',enum:[color.design]}}
 }
 return {...ACTION,properties};
}

async function codeAgent (d, ctx) {
  const { cfg, srcRoot, srcDir, tryEdits, say, firstEdits } = ctx
  const attempts = []
  const targetIds = ctx.targetIds || [d.id]
  let needsReplan = false; let scopedOnly = false
  const trail = []
  // 1) 규칙 수정안이 있으면 먼저(진단이 분명한 유형)
  for (const e of ctx.modelOnly ? [] : firstEdits || []) {
    if (e.skipped) { attempts.push({ source: 'rule', skipped: e.skipped }); continue }
    const changes=e.edits||[e]
    const r = await tryEdits(changes, `${d.rule} 규칙 수정안`, targetIds)
    attempts.push({ source: 'rule', edits: changes, ...r }); if (!r.ok) needsReplan = true; if (r.regress?.length && /\.css$/.test(e.file) && ctx.appSources?.length) scopedOnly = true
    trail.push({ step: trail.length + 1, action: 'edit(규칙)', detail: `${e.file}:${e.line}`, result: brief(r) })
    say(`${d.rule} ${d.labels.slice(0, 2).join(',')} 규칙 수정안: ${r.ok ? '검증 통과' : brief(r).slice(0, 80)}`)
    if (r.ok) return { attempts, trail, verified: attempts.length - 1 }
  }
  if (!ctx.llm) return { attempts, trail, verified: null }
  // 2) LLM 루프
  // 입력: 보고서 에이전트의 문제 정의서(있으면) + 측정·진단·지식·원본 사실
  const j = d.judge || {}
  const spec = j.status === 'ok' ? `[문제 정의(보고서 에이전트)]\n문제: ${j.problem}\n원본(기대): ${j.expected}\n판정: ${j.verdict} — ${j.reason}\n\n` : ''
  let sourceFiles = ''
  try { sourceFiles = execFileSync('rg', ['--files', '--glob', '*.{html,css,scss,js,jsx,ts,tsx,vue,svelte}', '--glob', '!node_modules/**', '--glob', '!dist*/**'], { cwd: srcRoot, encoding: 'utf8', timeout: 5000 }).split('\n').slice(0, 60).join('\n') } catch (e) {}
  const mapping = require('../code/source-context').sourceContext(d,{srcRoot,srcDir,hints:ctx.sourceHints||[]})
  const consumer = mapping.candidates[0]
  const consumerEvidence = consumer ? '[데이터가 있는 위치와 표시 코드 후보 — 정적 연결, 원인 미확정]\n'+JSON.stringify(mapping.data)+'\n'+consumer.file+'\n'+consumer.snippet : ''
  const interaction = require('../code/interaction-source').interactionContext(d,{srcRoot,srcDir})
  const interactionFacts = interaction.scripts.length ? '[클릭 대상 HTML에서 실제로 불러오는 로컬 동작 코드 — 정적 연결, 원인 미확정]\n'+JSON.stringify(interaction) : ''
  const inputDefect = interaction.scripts.length ? {...d,causes:{...d.causes,candidates:interaction.scripts.map((x,i)=>({...x,rank:i+1,why:[x.why]}))}} : d
  const anchors = (inputDefect.causes?.candidates || []).slice(0, 2).map(c => observeRead(srcRoot, srcDir, { file: c.file, start: Math.max(1, c.line - 8), end: c.line + 20 })).join('\n\n')
  const routeEvidence = (d.interact?.expected?.actions || []).filter(a => a.dest_name).map(a => observeSearch(srcRoot, srcDir, { text: a.dest_name })).join('\n')
  const grouped = '[이번 공통 작업에서 함께 해결해야 하는 모든 결함]\n'+JSON.stringify(ctx.taskTargets||[{id:d.id,screen:d.screen,labels:d.labels}])+'\n하나의 대표 요소만 고치면 성공이 아니다. 이 목록의 모든 화면 결함을 해결하고 다른 화면의 정상 변형은 보존한다.'
  const fact = grouped + '\n' + interactionFacts + '\n' + consumerEvidence + '\n' + spec + facts(inputDefect, d.screen_title) + '\n[앱 시안 계약: 고장 나지 않은 화면도 보존]\n' + JSON.stringify(ctx.appContracts || []) + '\n[등록 화면의 실제 버튼 소스: 변경 전]\n' + JSON.stringify(ctx.appSources || []) + '\n[실제 소스 파일 목록]\n' + sourceFiles + '\n[도구로 미리 읽은 원인 후보 주변 코드]\n' + anchors + '\n[시안 목적지 문구의 실제 소스 검색]\n' + routeEvidence
  const prior = attempts.filter((a) => a.edits).map((a) => `- 규칙 수정안 ${a.edits[0].file}:${a.edits[0].line} "${a.edits[0].replace.trim().slice(0, 120)}" → ${brief(a)}`).join('\n')
  const msgs = [{ role: 'system', content: SYSTEM }, { role: 'user', content: `${fact}${prior ? `\n\n[이미 해 본 수정]\n${prior}` : ''}\n\n첫 행동을 JSON으로 써라.` }]
  const readFiles = new Set();
  let reads = 0; let edits = 0; const maxSteps = 12; const tried = new Set(attempts.filter((a) => a.edits).map((a) => a.edits[0].replace.replace(/\s+/g, ' ').trim()))
  const scopes = require('./scoped-style').scopeEvidence(ctx)
  const failedActions = new Map()
  for (let step = 0; step < maxSteps; step++) {
    // 문맥 보호: 오래된 관찰은 첫 줄만 남긴다
    const view = msgs.map((m, i) => (m.role === 'user' && i > 1 && i < msgs.length - 4) ? { ...m, content: m.content.split('\n')[0] + ' …(줄임)' } : m)
    if (scopedOnly) view.push({role:'user',content:'[소스와 Figma에서 계산한 선택자 영향 범위]\n'+JSON.stringify(scopes)+'\n'+grouped+'\nconflicting=true인 선택자는 화면별 시안 색이 달라 전체 변경할 수 없다. 대상 결함의 기대 색과 일치하며 covers_all_target_screens=true인 범위를 선택하라. 한 화면만 포함하는 선택자는 공통 작업을 해결하지 못한다. '+(needsReplan?'지금은 replan으로 실패 원인과 새 선택자 범위를 정한다.':'다음 style 행동에는 선택자 전체를 사용하라. 필요한 코드와 영향 범위는 이미 제공되어 있다.')})
    let r
    say(`${d.rule} ${d.labels.slice(0, 2).join(', ')}: 코드 에이전트가 다음 행동을 선택합니다 (${step + 1}/${maxSteps})`)
    try { r = await askJSON(cfg, readFiles.size || !ctx.modelOnly ? actionSchema(d,scopes,needsReplan,scopedOnly,reads) : {...ACTION,properties:{...ACTION.properties,action:{type:"string",enum:["read","search","give_up"]}}}, view) } catch (e) { trail.push({ step: trail.length + 1, action: '오류', result: e.message }); break }
    const a = r.ans
    if (!a) { msgs.push({ role: 'assistant', content: String(r.raw).slice(0, 500) }, { role: 'user', content: 'JSON 행동 하나만 써라.' }); continue }
    const actionKey=JSON.stringify(a, Object.keys(a).filter(k=>!['why','reason'].includes(k)).sort())
    if((failedActions.get(actionKey)||0)>=2){needsReplan=true;msgs.push({role:'user',content:'같은 실패 행동을 두 번 반복했습니다. 다른 도구나 범위를 선택하거나 give_up 하세요.'});continue}
    ctx.onAction?.(a)
    say(`모델 행동: ${a.action} ${a.file || a.text || a.scope || ''}${a.start ? ':'+a.start : ''}${a.why ? ' — '+a.why : ''}`)
    if(ctx.modelOnly && ['edit','style','rn_style','jsx_prop'].includes(a.action) && !readFiles.has(a.file)){msgs.push({role:'user',content:'수정 대상 파일을 먼저 read로 직접 읽으세요.'});continue}
    msgs.push({ role: 'assistant', content: JSON.stringify(a) })
    let obs
    if (a.action === 'read') {
      if (reads >= 5) obs = '읽기·검색 횟수를 다 썼다. 허용된 수정 행동 또는 give_up을 선택한다'
      else { obs = observeRead(srcRoot, srcDir, a); if (!obs.startsWith('읽기 실패')) { reads++; readFiles.add(a.file); ctx.onObservation?.({action:'read',file:a.file,content:obs}) } } // 실패한 읽기는 세지 않는다
      trail.push({ step: trail.length + 1, action: 'read', detail: `${a.file} ${a.start || 1}~${a.end || ''}`, result: obs.split('\n')[0] })
    } else if (a.action === 'search') {
      if (reads >= 5) obs = '읽기·검색 횟수를 다 썼다. 허용된 수정 행동 또는 give_up을 선택한다'
      else { obs = observeSearch(srcRoot, srcDir, a); reads++ }
      trail.push({ step: trail.length + 1, action: 'search', detail: a.text, result: obs.split('\n')[0] })
    } else if (a.action === 'replan') {
      if (!String(a.reason || '').trim() || !String(a.scope || '').trim()) obs = '재계획 실패: reason과 scope가 필요하다'
      else { needsReplan = false; obs = `새 수정 계획: ${a.scope} — ${a.reason}. 아직 검증되지 않았다`; trail.push({ step: trail.length + 1, action: 'replan', detail: a.scope, result: a.reason }) }
    } else if (a.action === 'style') {
      if (needsReplan) { msgs.push({role:'user',content:'직전 실패 근거에 따라 먼저 replan을 하라.'}); continue }
      try {
        const e = require('./scoped-style').scopedStyle(a, ctx)
        const res = await tryEdits([e], `${d.rule} 코드 에이전트 범위 수정 ${edits + 1}`, targetIds)
        edits++; attempts.push({source:'llm',edits:[e],...res}); needsReplan = !res.ok
        obs = '검증 결과: ' + brief(res)
        trail.push({step:trail.length+1,action:'style',detail:`${a.file} ${a.selector}`,result:brief(res)})
        if(res.ok){say('모델 수정 검증 통과: '+brief(res));return {attempts,trail,verified:attempts.length-1}}
        if(edits>=3) break
      } catch (e) { obs = '범위 수정 실패: ' + e.message }
    } else if (a.action === 'edit') {
      if (needsReplan) { msgs.push({ role: 'user', content: '직전 수정이 실패했다. 먼저 replan 행동으로 검증 근거와 새 수정 범위를 설명하라.' }); continue }

      try {
        const e=require('./source-edit').anchoredEdit(a,ctx),norm=JSON.stringify([e.file,e.range.start,e.replace])
        if(tried.has(norm))throw Error('이미 실패한 동일 수정입니다. 위치나 값을 반복하지 말고 새 근거로 재계획하세요')
        tried.add(norm);edits++
        const res=await tryEdits([e],`${d.rule} 코드 에이전트 수정 ${edits}`,targetIds)
        attempts.push({source:'llm',edits:[e],...res});needsReplan=!res.ok;obs='검증 결과: '+brief(res)
        trail.push({step:trail.length+1,action:'edit',detail:`${e.file}:${e.line}`,result:brief(res)})
        if(res.ok){say('모델 수정 검증 통과: '+brief(res));return {attempts,trail,verified:attempts.length-1}}
        if(edits>=3)break
      }catch(e){obs='수정 실패: '+e.message;needsReplan=true;trail.push({step:trail.length+1,action:'edit',detail:a.file,result:obs})}
    } else if (a.action === 'rn_style' || a.action === 'jsx_prop') {
      if(needsReplan){msgs.push({role:'user',content:'먼저 replan으로 실패 근거와 바꿀 접근을 정하세요'});continue}
      try{
        const es=require('./source-edit').structuredEdit(a,ctx),key=JSON.stringify(es.map(e=>[e.file,e.range.start,e.replace]))
        if(tried.has(key))throw Error('이미 실패한 동일 구조 수정입니다')
        tried.add(key);edits++
        const res=await tryEdits(es,`${d.rule} 구조 수정 ${edits}`,targetIds)
        attempts.push({source:'llm',edits:es,...res});needsReplan=!res.ok;obs='검증 결과: '+brief(res)
        trail.push({step:trail.length+1,action:a.action,detail:`${a.file} ${a.selector}`,result:brief(res)})
        if(res.ok){say('모델 수정 검증 통과: '+brief(res));return {attempts,trail,verified:attempts.length-1}}
        if(edits>=3)break
      }catch(e){obs='구조 수정 실패: '+e.message;needsReplan=true;trail.push({step:trail.length+1,action:a.action,result:obs})}
    } else {
      trail.push({ step: trail.length + 1, action: 'give_up', result: a.reason || '' })
      break
    }
    if(/실패|바뀌는 것이 없|이미 해 본/.test(String(obs))) failedActions.set(actionKey,(failedActions.get(actionKey)||0)+1)
    say(`${d.rule}: ${a.action} → ${String(obs).split('\n')[0].slice(0, 160)}`)
    msgs.push({ role: 'user', content: `${obs}\n\n다음 행동을 JSON으로 써라.` })
  }
  return { attempts, trail, verified: null }
}

module.exports = { codeAgent, allowedActions, actionSchema }
