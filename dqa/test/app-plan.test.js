const { test } = require('node:test')
const assert = require('node:assert/strict')
const { groupTargets, finalState, designContracts } = require('../fix/app-plan')
const { judgeAfter } = require('../fix/fix')
const defect = (id, screen) => ({ id, screen, rule: 'D2', fps: ['button|Continue'], labels: ['Continue'], widths: [{ w: 375, h: 812 }], max_px: 132 })
test('same shared edit groups screens, but different expected values remain separate', () => {
  const ds = [defect('a', 'home'), defect('b', 'reserve'), defect('c', 'done')]
  const edit = { file: 'style.css', find: '.action{background:red}', replace: '.action{background:blue}' }
  const p = new Map([['a', [edit]], ['b', [edit]], ['c', [{ ...edit, replace: '.action{background:green}' }]]])
  const g = groupTargets(ds, p, ['home', 'reserve', 'done'])
  assert.equal(g.length, 2); assert.deepEqual(g[0].target_ids, ['a', 'b'])
  assert.deepEqual(g[0].regression_screens, ['home', 'reserve', 'done'])
})
test('fixing shared defects while breaking a previously correct screen is rejected with screen evidence', () => {
  const r = judgeAfter([defect('a', 'home'), defect('b', 'reserve')], [defect('c', 'done')], ['a', 'b'])
  assert.equal(r.ok, false); assert.equal(r.regress[0].screen, 'done')
  assert.deepEqual(r.fixed, ['a', 'b'])
})
test('full app success requires all unaccepted defects to resolve, not just selected task', () => {
  const ds = [defect('a','home'),defect('b','done')]
  assert.equal(finalState(ds,{ok:true,fixed:['a']}).status,'partial')
  assert.equal(finalState(ds,{ok:false,fixed:['a','b']}).status,'partial')
  assert.equal(finalState(ds,{ok:true,fixed:['a','b']}).status,'complete')
})
test('contracts include correct variant on non-defective screen', () => {
  const c = designContracts({done:{nodes:[{id:'1:2',name:'Action / Return',fill:{hex:'#A83B60'},reactions:[{}],children:[{text:{content:'Explore another visit'}}]}]}})
  assert.equal(c[0].screen,'done');assert.equal(c[0].expected_fill,'#A83B60')
})

test('non-navigation controls preserve Figma variant contracts', () => {
 const rows=designContracts({booking:{nodes:[{id:'danger',name:'Cancel',fill:{hex:'#A83B60'},children:[{text:{content:'Cancel booking'}}]}]}})
 assert.equal(rows[0].expected_fill,'#A83B60');assert.deepEqual(rows[0].text,['Cancel booking'])
})
