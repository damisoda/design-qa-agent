// Declarative browser journeys live in trusted recipes, outside editable application sources.
const path=require('path');const fs=require('fs');const {newContext}=require('../measure/browser');const {writeJSON}=require('../core/util');const {configureContext}=require('./runner');
async function runJourneys(browser,{origin,recipe,sizes,run,side}){
 const output=[];const ordered=[...sizes].sort((a,b)=>a[0]-b[0]);const widths=[ordered[0],ordered.at(-1)].filter((s,i,a)=>s&&a.findIndex(x=>x[0]===s[0]&&x[1]===s[1])===i);
 for(const journey of recipe.journeys||[])for(const [width,height]of widths){
  run.event?.('journey',`${side} ${recipe.id} ${width}x${height}: 사용자 흐름 ${journey.id} 시작`);
  const ctx=await newContext(browser,{origin,width,height,allowHosts:[],blocked:[],writes:[],stubs:recipe._stubs});await configureContext(ctx,recipe,origin);const p=await ctx.newPage();p.setDefaultTimeout(4000);let step=0;const checks=[];let error=null;
  try{
   for(const s of journey.steps){step++;if(s.goto){if(!s.goto.startsWith('/')||s.goto.startsWith('//'))throw Error('journey paths must stay inside the app');await p.goto(origin+s.goto)}
    else if(s.click)await p.locator(s.click).click();else if(s.fill)await p.locator(s.fill).fill(s.value);else if(s.check)await p.locator(s.check).check();else if(s.reload)await p.reload();
    else if(s.expect){const e=s.expect;await p.waitForFunction(e=>{
      if(e.path)return location.pathname.endsWith(e.path);
      const els=[...document.querySelectorAll(e.selector)];
      if(e.count!==undefined)return els.filter(x=>x.getBoundingClientRect().width&&x.getBoundingClientRect().height).length===e.count;
      const el=els[0];if(!el)return false;
      if(e.disabled!==undefined)return el.disabled===e.disabled;
      const value=(el.innerText||'').trim();return e.text!==undefined?value===e.text:e.contains!==undefined?value.includes(e.contains):false
     },e,{timeout:4000});checks.push(s.name||JSON.stringify(e))}
    else throw Error('unknown journey step')
   }
  }catch(e){error=`${journey.id} ${width}x${height}, step ${step}: ${e.message.slice(0,1200)}`}
  const row={id:journey.id,screen:recipe.id,size:`${width}x${height}`,ok:!error,checks,failed_step:error?step:null,error};output.push(row);
  run.event?.('journey',`${side} ${journey.id} ${width}x${height}: ${row.ok?'통과':'실패'} · 확인 ${checks.length}개${row.failed_step?' · 단계 '+row.failed_step:''}`);
  try{const file=`journeys/${side}/${journey.id.replace(/[^\w-]/g,'_')}_${width}x${height}.json`;if(error){const shot=file.replace(/\.json$/,'.png');fs.mkdirSync(path.dirname(run.file(shot)),{recursive:true});await p.screenshot({path:run.file(shot),fullPage:true}).catch(()=>{});row.shot=shot}writeJSON(run.file(file),row)}finally{await ctx.close()}
 }
 return output
}
function journeyRegressions(before=[],after=[],final=false){
 const errors=[];const key=j=>`${j.screen}|${j.id}|${j.size}`;
 for(const b of before){const a=after.find(x=>key(x)===key(b));if(!a){errors.push(key(b)+' 사용자 흐름 검사 누락');continue}
  if(!a.ok&&(final||b.ok||!a.failed_step||!b.failed_step||a.failed_step<b.failed_step))errors.push(a.error||key(a)+' 사용자 흐름 실패')
 }
 for(const a of after)if(!a.ok&&!before.some(b=>key(b)===key(a)))errors.push(a.error||key(a)+' 새 사용자 흐름 실패')
 return errors;
}
module.exports={runJourneys,journeyRegressions}
