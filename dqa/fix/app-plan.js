// App repair state is evidence, not a model verdict. Every candidate is measured on all registered screens.
const { sha1 } = require('../core/util')
function groupTargets (targets, proposals, screens) {
  const groups = new Map()
  for (const d of targets) {
    const e = (proposals.get(d.id) || []).find(x => !x.skipped && ((x.find && x.replace) || x.edits?.length))
    // Identical source edit AND intended value; merely sharing a class is insufficient.
    const key = e ? JSON.stringify([d.rule, e.file, e.edits || [e.find, e.replace]]) : d.id
    if (!groups.has(key)) groups.set(key, { id: sha1(key).slice(0, 12), representative: d.id, target_ids: [], affected_screens: [], regression_screens: [...screens], source: e ? { file: e.file, line: e.line } : null, status: 'pending', attempts: [], decisions: [] })
    const g = groups.get(key); g.target_ids.push(d.id)
    if (!g.affected_screens.includes(d.screen)) g.affected_screens.push(d.screen)
  }
  return [...groups.values()]
}
function designContracts (designs) {
  const out = []
  function walk (nodes, screen) {
    for (const n of nodes || []) {
      if (n.reactions?.length || (n.fill?.hex && n.children?.some(c => c.text?.content))) out.push({ screen, component: n.name, text: (n.children || []).filter(c => c.text).map(c => c.text.content), expected_fill: n.fill?.hex, figma_node: n.id })
      walk(n.children, screen)
    }
  }
  for (const [screen, spec] of Object.entries(designs || {})) walk(spec.nodes, screen)
  return out.slice(0, 80)
}
function finalState (original, combined) {
  const required = original.filter(d => !d.accepted && d.rule !== 'R5').map(d => d.id)
  const remaining = required.filter(id => !(combined?.fixed || []).includes(id))
  return { status: combined?.ok && !remaining.length ? 'complete' : 'partial', remaining_ids: remaining }
}
function componentUsages (srcRoot, recipes) {
  const fs = require('fs'), path = require('path'); const rows = []
  for (const recipe of recipes) {
    const rel = String(recipe.start?.path || '/').replace(/^\//, '') || 'index.html'
    const file = path.resolve(srcRoot, rel)
    if (!file.startsWith(path.resolve(srcRoot) + path.sep) || !/\.html$/.test(file) || !fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(/<(button|a)\b[^>]*>[\s\S]*?<\/\1>/gi)) rows.push({ screen: recipe.id, file: rel, source: m[0].slice(0, 800) })
  }
  return rows.slice(0, 40)
}
module.exports = { groupTargets, designContracts, finalState, componentUsages }

function prioritize(tasks,targets){
 const byId=new Map(targets.map(d=>[d.id,d]));
 const score=t=>{const ds=t.target_ids.map(id=>byId.get(id));return (t.source?200:0)+(ds.some(d=>d.kind==='design')?100:0)+(ds.some(d=>/^I/.test(d.rule))?80:0)+(ds.some(d=>(d.evidence||[]).some(e=>e.metric==='text_overflow_px'))?40:0)+t.affected_screens.length*10+t.target_ids.length}
 return [...tasks].sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id)).map(t=>({...t,priority_score:score(t),priority_reason:t.target_ids.some(id=>(byId.get(id)?.evidence||[]).some(e=>e.metric==='text_overflow_px'))?'direct text overflow evidence before aggregate page overflow':t.source?'source-anchored shared repair':byId.get(t.representative)?.kind==='design'?'design discrepancy':'measured layout or interaction'}))
}
module.exports.prioritize=prioritize
