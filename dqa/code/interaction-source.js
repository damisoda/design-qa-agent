// Bounded static source evidence for an interaction failure. This does not choose a patch.
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const norm=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
function inside(root,dir,rel){try{const base=fs.realpathSync(path.resolve(root,dir||'.')),file=fs.realpathSync(path.resolve(root,rel));return file.startsWith(base+path.sep)&&fs.statSync(file).isFile()&&fs.statSync(file).size<350000?file:null}catch{return null}}
function interactionContext(d,ctx){
 if(!/^I[1-4]$/.test(d.rule||'')||!ctx.srcRoot)return {pages:[],scripts:[]};
 const root=fs.realpathSync(path.resolve(ctx.srcRoot)),dir=ctx.srcDir||'.',labels=(d.labels||[]).map(norm).filter(x=>x.length>1);let files=[];
 try{files=execFileSync('rg',['--files','--glob','*.html','--glob','!**/node_modules/**','--glob','!**/dist*/**',path.resolve(root,dir)],{encoding:'utf8',timeout:5000,maxBuffer:1<<20}).trim().split('\n').slice(0,40)}catch{return {pages:[],scripts:[]}}
 const pages=[],scripts=new Map();
 for(const file of files){const rel=path.relative(root,file),abs=inside(root,dir,rel);if(!abs)continue;const source=fs.readFileSync(abs,'utf8');if(!labels.some(x=>norm(source).includes(x)))continue;
  const refs=[];for(const m of source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)){
   const src=m[1].split(/[?#]/)[0];if(!src||/^(?:[a-z]+:|\/\/)/i.test(src))continue;
   const target=src.startsWith('/')?path.resolve(root,'.'+src):path.resolve(path.dirname(abs),src),key=path.relative(root,target);const js=inside(root,dir,key);if(!js||!/\.(?:[cm]?js|ts)$/.test(js))continue;
   refs.push(key);if(scripts.has(key))continue;
   const text=fs.readFileSync(js,'utf8'),lines=text.split('\n'),at=lines.findIndex(x=>/addEventListener|\.onclick\s*=|location\.|history\.|navigate\(/.test(x));const start=Math.max(1,(at<0?0:at)-10+1),end=Math.min(lines.length,start+39);
   scripts.set(key,{file:key,line:at<0?1:at+1,start,end,snippet:lines.slice(start-1,end).map((l,i)=>`${start+i}: ${l}`).join('\n'),why:'클릭 대상 문구가 있는 HTML에서 직접 불러오는 로컬 스크립트. 정적 연결이며 원인 확정 아님'});
  }
  pages.push({file:rel,scripts:refs});
 }
 return {method:'html-local-script-reference',pages:pages.slice(0,6),scripts:[...scripts.values()].slice(0,3)};
}
module.exports={interactionContext};
