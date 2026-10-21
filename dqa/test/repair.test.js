const { test } = require('node:test')
const assert = require('node:assert/strict')
const { comparison, coverage } = require('../fix/comparison')
function result (offset=0) {
  const ds=[]
  ds.measurements=[{screen:'home',w:375,h:812,ok:true,steps:[{y:offset,shot:'image.png',issues:0,leaves:8}]}]
  ds.designs={home:{matched:8}}
  ds.interactions=[{screen:'home',size:'320x568',clicked:2}]
  return ds
}
test('repair evidence never pairs different scroll offsets or substitutes the before image',()=>{
  const c=comparison(result(),result(100),{design:{home:{png:'figma.png',base:'375x812'}}},{ok:true})
  assert.equal(c.frames[0].after,null)
  assert.equal(c.frames[0].paired,false)
})
test('repair rejects removed elements, missing adaptive interactions and lost Figma mappings',()=>{
  const a=result();a.measurements[0].steps[0].leaves=0;a.designs.home.matched=0;a.interactions=[]
  assert.equal(coverage(result(),a).length,3)
  assert.deepEqual(coverage(result(),result()),[])
})
test('comparison reports remaining problems and does not imply full success for a partial repair',()=>{
  const before=result();before.push({id:'a',rule:'R1',labels:['A']},{id:'b',rule:'I1',labels:['B']})
  const after=result();after.push(before[1])
  const c=comparison(before,after,{}, {ok:true,fixed:['a'],regress:[]})
  assert.equal(c.after_count,1);assert.equal(c.remaining[0].rule,'I1');assert.equal(c.before_count,2)
})

const { setDecls } = require('../fix/fix')
test('CSS shorthand repair updates the winning important declaration, instead of appending an ineffective longhand', () => {
  assert.equal(setDecls('background:#C23B67!important', 'background-color:var(--brand)'), 'background:var(--brand)!important')
  assert.equal(setDecls('font-size:28px!important', 'font-size:24px'), 'font-size:24px!important')
})

test('measured ancestor gap is used instead of changing a child margin', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const { cssRuleEdits } = require('../fix/fix')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-ancestor-'))
  try {
    fs.writeFileSync(path.join(dir, 'style.css'), '.fields{gap:28px!important}.email{gap:8px}.unrelated{gap:28px}')
    const edits = cssRuleEdits({ kind:'design',rule:'L2',design:{values:[{prop:'margin-top',design:16,impl:28}]},elements:[{tag:'p',cls:['email-label'],pcls:['email'],ancestors:[{cls:['email'],rowGap:'8px'},{cls:['fields'],rowGap:'28px'}]}] },dir)
    assert.ok(edits.some(e=>e.find.includes('.fields') && e.replace.includes('gap:16px!important')))
    assert.ok(edits.every(e=>!e.find.includes('.unrelated')))
  } finally { fs.rmSync(dir,{recursive:true,force:true}) }
})

test('a defect left at one width is not fixed, and a new failing width is a regression',()=>{
  const { judgeAfter }=require('../fix/fix')
  const d=(widths)=>({id:'a',screen:'home',rule:'I4',fps:['a'],labels:['button'],max_px:1,widths:widths.map(w=>({w,h:812}))})
  assert.equal(judgeAfter([d([375]),d([320])],[d([320])],['a']).ok,false)
  assert.equal(judgeAfter([d([375])],[d([375,320])],[]).ok,false)
})

test('wrapping moves content between scroll positions without deletion; hidden duplicates still fail',()=>{
 const b=result(),a=result();b.measurements[0].content=['P|Title','BUTTON|Buy','BUTTON|Buy'];a.measurements[0].content=[...b.measurements[0].content];a.measurements[0].steps[0].leaves=4;
 assert.deepEqual(coverage(b,a),[]);a.measurements[0].content.pop();assert.match(coverage(b,a)[0],/콘텐츠 1개/)
})
