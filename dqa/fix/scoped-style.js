const fs = require('fs'); const path = require('path')
const PROPS = new Set(['background-color','color','border-color','border-radius','font-size','font-weight','line-height','gap','padding','min-width','max-width','min-height','width','height','flex-shrink','flex-grow','flex-wrap','white-space','overflow-wrap'])
// Report source-derived scopes, not a fixture-specific repair. A selector is
// ambiguous when it spans different Figma variant contracts.
function scopeEvidence (ctx) {
  const rows = (ctx.appSources || []).flatMap(u => [...u.source.matchAll(/class=["']([^"']+)["']/g)].map(m => ({
    screen:u.screen, classes:m[1].split(/\s+/).filter(c=>/^[\w-]+$/.test(c)),
    fills:[...new Set((ctx.appContracts || []).filter(c=>c.screen===u.screen && c.text?.some(t=>u.source.includes(t))).map(c=>c.expected_fill).filter(Boolean))]
  })))
  const selectors = [...new Set(rows.flatMap(r=>[...r.classes.map(c=>'.'+c),...r.classes.flatMap((a,i)=>r.classes.slice(i+1).map(b=>'.'+a+'.'+b)),'.'+r.classes.join('.')]))].filter(s=>s!=='.')
  return selectors.map(selector=>{
    const matched=rows.filter(r=>selector.slice(1).split('.').every(c=>r.classes.includes(c)))
    const fills=[...new Set(matched.flatMap(r=>r.fills))]
    const screens=[...new Set(matched.map(r=>r.screen))];const targetScreens=[...new Set((ctx.taskTargets||[]).map(t=>t.screen))];
    return {selector,screens,expected_fills:fills,conflicting:fills.length>1,...(targetScreens.length?{target_screens_covered:targetScreens.filter(s=>screens.includes(s)),covers_all_target_screens:targetScreens.every(s=>screens.includes(s))}:{})}
  })
}
function scopedStyle (a, ctx) {
  const file = path.resolve(ctx.srcRoot, a.file || '')
  if (!file.startsWith(path.resolve(ctx.srcRoot, ctx.srcDir) + path.sep) || !file.endsWith('.css') || !fs.existsSync(file)) throw new Error('실제 소스 폴더의 CSS 파일만 선택하세요')
  if (!/^\.[\w-]+(?:\.[\w-]+)*$/.test(a.selector || '')) throw new Error('관측한 같은 요소의 클래스 선택자만 사용하세요. 예: .button.primary')
  const classes = a.selector.slice(1).split('.')
  const usages = (ctx.appSources || []).flatMap(r => [...r.source.matchAll(/class=["']([^"']+)["']/g)].map(m => m[1].split(/\s+/)))
  if (!usages.some(row => classes.every(c => row.includes(c)))) throw new Error('선택자에 해당하는 실제 요소를 소스에서 확인하지 못했습니다')
  if (!PROPS.has(a.property) || !/^[#\w.,%() -]{1,80}$/.test(a.value || '') || /url|expression|important/i.test(a.value)) throw new Error('허용된 CSS 속성과 단순 값만 사용하세요')
  const text = fs.readFileSync(file, 'utf8')
  for (const m of a.value.matchAll(/var\((--[\w-]+)/g)) if (!text.includes(m[1]+':') && !new RegExp(m[1]+'\\s*:').test(text)) throw new Error('정의되지 않은 CSS 변수입니다: '+m[1])
  if (a.property === 'background-color' && /^#[0-9a-f]{6}$/i.test(a.value)) {
    for (const usage of ctx.appSources || []) {
      const sets = [...usage.source.matchAll(/class=["']([^"']+)["']/g)].map(m => m[1].split(/\s+/))
      if (!sets.some(row => classes.every(c => row.includes(c)))) continue
      for (const c of (ctx.appContracts || []).filter(c => c.screen === usage.screen && c.text?.some(label => usage.source.includes(label)))) {
        if (c.expected_fill && c.expected_fill.toUpperCase() !== a.value.toUpperCase()) throw new Error(`범위 충돌: ${a.selector}는 ${c.screen}에도 적용되며, 그 시안 색은 ${c.expected_fill}입니다. 실제 소스의 변형 클래스 조합으로 범위를 좁히세요`)
      }
    }
  }
  const rule = `${a.selector} { ${a.property}: ${a.value}; }`
  const matches = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].trim() === a.selector)
  if (matches.length > 1) throw new Error('동일 선택자가 여러 곳에 있습니다. 소스를 읽고 edit으로 범위를 좁히세요')
  let find, replace
  if (matches.length) {
    find = matches[0][0]; replace = find.replace('{'+matches[0][2]+'}', '{'+require('./fix').setDecls(matches[0][2], a.property+':'+a.value)+'}')
  } else { find = text.split('\n').filter(l=>l.trim()).at(-1); replace = find + '\n' + rule }
  if (!find || text.split(find).length !== 2) throw new Error('안전하게 삽입할 고유한 위치가 없습니다')
  return { source:'llm', file:a.file, line:text.slice(0,text.indexOf(find)).split('\n').length, find, replace, why:a.why || `${a.selector}의 ${a.property} 변경`, selector:a.selector }
}
module.exports = { scopedStyle, scopeEvidence }
