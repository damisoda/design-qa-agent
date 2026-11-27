const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('fs');const os=require('os');const path=require('path')
const {discover,routePath}=require('../targets/discover')
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dqa-screens-'))
process.env.DQA_SCREEN_STATE_DIR=path.join(tmp,'state')
process.env.DQA_DESIGNS_DIR=path.join(tmp,'designs')
const library=require('../design/library')
const {inspect,connect,validateScope}=require('../server/local-selection')
const {loadRecipe}=require('../recipes/runner')
const {toArgs}=require('../server/http')
const ui=require('../ui/target')
require('node:test').after(()=>fs.rmSync(tmp,{recursive:true,force:true}))
function project(name,files){const dir=path.join(tmp,name);for(const [p,s]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(dir,p)),{recursive:true});fs.writeFileSync(path.join(dir,p),s)}return dir}
function paths(dir){return discover(dir).screens.map(s=>s.path)}
const design=library.save({name:'real-shaped-fixture',spec:{frame:{id:'2:23',name:'Discover',width:375,height:812},nodes:[]}}).name

test('discovers nested JSX and index routes; ignores dependencies, tests and unrelated components',()=>{
 const dir=project('jsx',{'index.html':'<div id="root"></div>','src/routes.tsx':`import {Route} from 'react-router-dom'; const a=<Route path="/shop"><Route index element={<Home/>}/><Route path="products/:id" element={<Product/>}/></Route>`, 'src/Button.tsx':'const s={path:"/not-a-route"}', 'node_modules/large/routes.tsx':'<Route path="/dependency"/>','src/foo.test.tsx':'<Route path="/test"/>'})
 assert.deepEqual(paths(dir),['/','/shop','/shop/products/:id'])
 assert.equal(discover(dir).screens.find(s=>s.path.includes(':id')).dynamic,true)
})
test('route objects, hashes, Vue and computed paths have bounded honest discovery',()=>{
 const dir=project('objects',{'src/routes.ts':`const routes=[{path:'/book',children:[{path:'confirm'},{index:true}]}];createHashRouter(routes);`, 'src/vue.ts':`const routes=[{path:'/gallery'}];createRouter({routes});`, 'src/unknown.tsx':'const x=<Route path={getPath()}/>'})
 assert.deepEqual(paths(dir),['/#/book','/#/book/confirm','/gallery'])
 assert.match(discover(dir).warnings.join(' '),/계산된 경로/)
})
test('file routes omit APIs, layouts, route groups and parallel/intercepted routes',()=>{
 const dir=project('next',{'app/(shop)/page.tsx':'export default 1','app/(shop)/items/[id]/page.tsx':'export default 1','app/layout.tsx':'','app/@modal/page.tsx':'','app/(.)photo/page.tsx':'','pages/api/foo.ts':'','pages/_app.tsx':'','pages/book/index.tsx':'','pages/[...slug].tsx':''})
 assert.deepEqual(paths(dir),['/','/[...slug]','/book','/items/[id]'])
 const result=inspect(dir,{})
 assert.ok(result.build_error);assert.equal(result.screens.length,4)
})
test('new screens can be connected without writing project config; persisted and scoped by real path',()=>{
 const dir=project('static',{'index.html':'<title>Home</title>','booking.html':'<title>Book</title>'})
 const original=fs.readdirSync(dir)
 const found=inspect(dir,{})
 const body={local:dir,screens:found.screens.map(s=>({id:s.id,path:s.path,design}))}
 const result=connect(body,{})
 assert.equal(result.recipes.length,2);assert.ok(result.recipes.every(s=>s.startsWith('auto/')))
 assert.deepEqual(fs.readdirSync(dir),original)
 assert.equal(inspect(dir,{}).bindings.length,2)
 assert.equal(loadRecipe(result.recipes[1]).start.path,'/booking.html')
 assert.doesNotThrow(()=>validateScope(result.recipes,dir))
 const other=project('other',{'index.html':'other'})
 assert.equal(inspect(other,{}).bindings.length,0)
 assert.throws(()=>validateScope(result.recipes,other),/다른 프로젝트/)
 const args=toArgs({kind:'local',local:dir,base:'none',recipes:result.recipes,design:result.design},{profiles:{}})
 assert.ok(args.includes('--design'));assert.ok(args.includes(result.recipes.join(',')))
 assert.throws(()=>toArgs({kind:'local',local:other,recipes:result.recipes},{profiles:{}}),/다른 프로젝트/)
 const again=connect(body,{});assert.deepEqual(again.recipes,result.recipes)
})
test('dynamic URL is required and previous immutable recipe does not change when URL changes',()=>{
 const dir=project('dynamic',{'index.html':'test','route.jsx':'<Route path="/items/:id"/>'})
 const s=inspect(dir,{}).screens.find(s=>s.dynamic)
 assert.throws(()=>connect({local:dir,screens:[{id:s.id,path:s.path,design}]},{}),/실제로 열 주소/)
 const a=connect({local:dir,screens:[{id:s.id,path:'/items/123',design}]},{})
 const b=connect({local:dir,screens:[{id:s.id,path:'/items/456',design}]},{})
 assert.notEqual(a.recipes[0],b.recipes[0]);assert.equal(loadRecipe(a.recipes[0]).start.path,'/items/123')
})
test('unsafe URLs, stale screen IDs, duplicate rows and missing designs cannot be saved',()=>{
 for(const p of ['https://evil.test','//evil.test','/../secret','/%2e%2e/secret','/%2fexternal','/a\\b','/a b'])assert.equal(routePath(p),null,p)
 const dir=project('invalid',{'index.html':'test'});const s=inspect(dir,{}).screens[0]
 const row={id:s.id,path:'/',design}
 for(const rows of [[{...row,id:'stale'}],[row,row],[{...row,design:'missing'}],[{...row,path:'//evil.test'}]])assert.throws(()=>connect({local:dir,screens:rows},{}))
 assert.equal(inspect(dir,{}).bindings.length,0)
 assert.throws(()=>inspect(dir,{forbidden_paths:[dir]}),/금지 경로/)
})
test('configured procedures stay intact; added paths persist with project mappings',()=>{
 const dir=project('configured',{'index.html':'test','.dqa.json':JSON.stringify({recipes:['atelier/discover']})})
 const before=JSON.stringify(loadRecipe('atelier/discover'))
 const result=connect({local:dir,screens:[{id:'atelier/discover',path:'/index.html',design}]},{})
 assert.deepEqual(result.recipes,['atelier/discover']);assert.equal(JSON.stringify(loadRecipe(result.recipes[0])),before)
 assert.throws(()=>connect({local:dir,screens:[{id:'atelier/discover',path:'/changed',design}]},{}),/시작 주소/)
 const m={id:'manual-1234567890abcdef',manual:true,path:'/book/123',design}
 connect({local:dir,screens:[m]},{});assert.equal(inspect(dir,{}).screens.find(s=>s.id===m.id).path,m.path)
})
test('UI shows explicit mappings and rejects missing or cleared mappings instead of reusing preview',()=>{
 const st={local:'/app',localInfo:{local:'/app',screens:[{id:'one',path:'/',title:'Home'},{id:'two',path:'/book',title:'Booking'}]},recipes:new Set(['one','two']),designs:{'':design,one:design,two:design}}
 const ds=[{name:design,frame:'Discover',file:'Example'}]
 assert.equal(ui.payload(st,ds).screens.length,2)
 assert.match(ui.summary(st,ds),/2개 화면/)
 st.designs.two='';assert.throws(()=>ui.payload(st,ds),/연결해/)
 st.recipes=new Set(['two']);assert.equal(ui.binding(st,st.localInfo.screens[1]),'')
 st.local='/different';assert.equal(ui.selected(st),null)
})

test('Expo Router uses app screen conventions only when expo-router is declared',()=>{
 const dir=project('expo',{'package.json':JSON.stringify({dependencies:{expo:'~1', 'expo-router':'~1'}}),'app/(tabs)/index.tsx':'','app/_layout.tsx':'','app/+not-found.tsx':'','app/booking/[id].tsx':''})
 assert.deepEqual(paths(dir),['/','/booking/[id]'])
 assert.equal(inspect(dir,{}).kind,'expo')
})
