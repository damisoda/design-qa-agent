const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {launch}=require('../measure/browser'),{serveDist}=require('../targets/static'),{runJourneys}=require('../recipes/journeys');
test('functional journey rejects a visually unchanged broken price calculation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dqa-journey-'));const b=await launch();let site;
 try{
  fs.writeFileSync(path.join(dir,'index.html'),'<button onclick="document.querySelector(\'p\').textContent=\'Total 20\'">Add</button><p>Total 10</p>');site=await serveDist(dir);
  const recipe={id:'test/price',journeys:[{id:'price',steps:[{goto:'/index.html'},{click:'button'},{expect:{selector:'p',text:'Total 20'}}]}]};const args={origin:site.origin,recipe,sizes:[[320,568]],run:{file:p=>path.join(dir,p)},side:'before'};
  assert.equal((await runJourneys(b,args))[0].ok,true);
  fs.writeFileSync(path.join(dir,'index.html'),'<button onclick="this.dataset.clicked=1">Add</button><p>Total 10</p>');
  const failed=(await runJourneys(b,{...args,side:'after'}))[0];assert.equal(failed.ok,false);assert.match(failed.error,/step 3/);
 }finally{site?.close();await b.close();fs.rmSync(dir,{recursive:true,force:true})}
});

test('existing broken flows can improve incrementally, but final repair requires full pass',()=>{
 const {journeyRegressions}=require('../recipes/journeys');const before=[{screen:'shop',id:'checkout',size:'320x568',ok:false,failed_step:10,error:'old'}];
 const same=[{...before[0]}],earlier=[{...before[0],failed_step:4,error:'new'}],fixed=[{...before[0],ok:true,failed_step:null}];
 assert.deepEqual(journeyRegressions(before,same),[]);assert.deepEqual(journeyRegressions(before,same,true),['old']);assert.deepEqual(journeyRegressions(before,earlier),['new']);assert.deepEqual(journeyRegressions(before,[]),['shop|checkout|320x568 사용자 흐름 검사 누락']);assert.deepEqual(journeyRegressions(before,fixed,true),[]);assert.deepEqual(journeyRegressions(fixed,same),['old']);
})
