// Read-only, bounded static evidence. Property-name matches are candidates, not proven runtime data flow.
const fs = require('fs'), path = require('path'), parser = require('@babel/parser')
const {execFileSync} = require('child_process')
function walk(n, fn, parents=[]) {
 if (!n || typeof n !== 'object') return
 if (n.type) fn(n, parents)
 for (const [k,v] of Object.entries(n)) {
  if (['loc','tokens','comments','errors'].includes(k)) continue
  if (Array.isArray(v)) for(const x of v) walk(x,fn,[...parents,n])
  else if(v && typeof v==='object') walk(v,fn,[...parents,n])
 }
}
function safe(root, dir, file) {
 try {const base=fs.realpathSync(path.resolve(root,dir||'.')), abs=fs.realpathSync(path.resolve(root,file));return abs.startsWith(base+path.sep)&&fs.statSync(abs).isFile()?abs:null}catch{return null}
}
function read(root, dir, file) {
 const abs=safe(root,dir,file);if(!abs || fs.statSync(abs).size>350000)return null
 try {const source=fs.readFileSync(abs,'utf8');return {file,source,ast:parser.parse(source,{sourceType:'unambiguous',plugins:['jsx','typescript']})}}catch{return null}
}
const key = n => n?.type==='Identifier'?n.name:n?.type==='StringLiteral'?n.value:null
function sourceContext(defect, opts) {
 const root=opts.srcRoot, dir=opts.srcDir||'.';if(!root)return {candidates:[],data:[]}
 const labels=new Set([...(defect.labels||[]),...(defect.elements||[]).flatMap(e=>[e.label,e.aria])].filter(Boolean))
 const data=[];const keys=new Set()
 for(const c of (defect.causes?.candidates||opts.candidates||[]).slice(0,3)) {
  const x=read(root,dir,c.file);if(!x)continue
  walk(x.ast,(n,parents)=>{
   if(n.type!=='StringLiteral'||!labels.has(n.value))return
   const prop=parents.slice().reverse().find(p=>p.type==='ObjectProperty'&&p.value && n.start>=p.value.start&&n.end<=p.value.end)
   const name=key(prop?.key);if(!name || ['label','name','title','text','description'].includes(name))return
   keys.add(name);data.push({file:c.file,line:n.loc.start.line,property:name,label:n.value})
  })
 }
 if(!keys.size)return {candidates:[],data}
 let files=[];try{files=execFileSync('rg',['--files','--glob','*.{tsx,jsx,ts,js}','--glob','!**/node_modules/**','--glob','!**/dist*/**',path.resolve(root,dir)],{encoding:'utf8',timeout:5000,maxBuffer:2<<20}).trim().split('\n').map(f=>path.relative(root,f)).slice(0,600)}catch{}
 const hints=(opts.hints||[]).filter(f=>safe(root,dir,f))
 const candidates=[]
 for(const file of [...new Set([...hints,...files])]) {
  const x=read(root,dir,file);if(!x)continue
  let jsx=false;const uses=[],ranges=[]
  walk(x.ast,(n)=>{
   if(n.type==='JSXElement')jsx=true
   if(['MemberExpression','OptionalMemberExpression'].includes(n.type) && (!n.computed||n.property.type==='StringLiteral') && keys.has(key(n.property))) uses.push({offset:n.start,line:n.loc.start.line,property:key(n.property),expression:x.source.slice(n.start,n.end)})
   if(['FunctionDeclaration','ArrowFunctionExpression','FunctionExpression'].includes(n.type))ranges.push(n)
  })
  if(!jsx||!uses.length)continue
  const hinted=hints.includes(file),line=uses[0].line
  const fn=ranges.filter(n=>n.start<=uses[0].offset&&n.end>=uses[0].offset).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]
  const start=fn?fn.loc.start.line:Math.max(1,line-8),end=Math.min(fn?fn.loc.end.line:line+24,start+79)
  const lines=x.source.split('\n')
  candidates.push({file,line,score:hinted?0.9-Math.min(hints.indexOf(file),4)*0.05:0.32,hinted,uses:uses.slice(0,8),why:[`측정된 누락 문자열의 속성 ${[...new Set(uses.map(u=>u.property))].join(', ')}을 읽는 JSX 파일`,...(hinted?['현재 화면 레시피의 소스 힌트와 일치']:[]),'정적 후보이며 실제 데이터 흐름·원인은 미확정'],start,end,snippet:lines.slice(start-1,end).map((l,i)=>`${start+i}: ${l}`).join('\n')})
 }
 candidates.sort((a,b)=>b.score-a.score||a.file.localeCompare(b.file))
 return {version:1,method:'literal-property-to-jsx-consumer',data,candidates:candidates.slice(0,3)}
}

// Do not repair a missing dynamic value by pasting the Figma example into the UI.
// This guard only claims to catch newly introduced literal copies, not arbitrary semantic cheating.
function assertDataBackedChanges(changed, defects, opts) {
 const norm=s=>String(s).replace(/\s+/g,'')
 for(const d of defects.filter(d=>d.rule==='M1')) {
  const evidence=d.causes?.source_context || sourceContext(d,opts)
  const labels=[...new Set((evidence.data||[]).map(x=>norm(x.label)).filter(Boolean))]
  if(!labels.length)continue
  for(const [file,st] of changed) {
   if(!/\.[jt]sx?$/.test(file))continue
   const counts=source=>{const out=new Map(labels.map(l=>[l,0]));walk(parser.parse(source,{sourceType:'unambiguous',plugins:['jsx','typescript']}),n=>{if(!['StringLiteral','JSXText','TemplateElement'].includes(n.type))return;const value=norm(n.type==='TemplateElement' ? n.value.cooked : n.value);for(const l of labels)if(value.includes(l))out.set(l,out.get(l)+1)});return out}
   const before=counts(st.before),after=counts(st.after)
   if(labels.some(l=>after.get(l)>before.get(l)))throw Error('기존 데이터의 누락 값을 시안 문구로 하드코딩하는 수정은 허용하지 않습니다. 이미 있는 데이터 속성을 표시 코드에 연결한 뒤 재검증하세요')
  }
 }
}
module.exports={sourceContext,safe,assertDataBackedChanges}

