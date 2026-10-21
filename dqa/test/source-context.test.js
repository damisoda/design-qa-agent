const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path')
const {sourceContext}=require('../code/source-context'),{findCauses}=require('../code/cause')
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'dqa-context-'));fs.mkdirSync(path.join(root,'src'));return {root,close:()=>fs.rmSync(root,{recursive:true,force:true})}}
test('missing data maps to current JSX consumer without copying expected literal into UI',()=>{const f=fixture();try{
 fs.writeFileSync(path.join(f.root,'src/data.ts'),'export const row={features:["Blue jacket"]};')
 fs.writeFileSync(path.join(f.root,'src/Details.tsx'),'export function Details({row}) { const subset=row.features.filter(x=>x.includes("other")); return <div>{subset}</div> }')
 fs.writeFileSync(path.join(f.root,'src/Other.tsx'),'export const Other=({row})=><p>{row.features}</p>;')
 const d={rule:'M1',labels:['Blue jacket'],elements:[{label:'Blue jacket'}],causes:{candidates:[{file:'src/data.ts',line:1}]}}
 const opts={srcRoot:f.root,srcDir:path.join(f.root,'src'),hints:['src/Details.tsx']}
 const x=sourceContext(d,opts);assert.equal(x.candidates[0].file,'src/Details.tsx');assert.equal(x.data[0].property,'features');assert.ok(x.candidates[0].snippet.includes('row.features'));assert.ok(!x.candidates[0].snippet.includes('Blue jacket'))
 const cause=findCauses(d,opts);assert.equal(cause.candidates[0].file,'src/Details.tsx');assert.ok(cause.source_context.data.length)
}finally{f.close()}})
test('unrelated hint is not promoted and comments are not literal data evidence',()=>{const f=fixture();try{
 fs.writeFileSync(path.join(f.root,'src/data.ts'),'// Blue jacket\nexport const row={name:"Blue jacket"};')
 fs.writeFileSync(path.join(f.root,'src/Unrelated.tsx'),'export const Unrelated=()=> <p>hello</p>;')
 const d={rule:'M1',labels:['Blue jacket'],elements:[{label:'Blue jacket'}],causes:{candidates:[{file:'src/data.ts',line:2}]}}
 assert.equal(sourceContext(d,{srcRoot:f.root,srcDir:'src',hints:['src/Unrelated.tsx']}).candidates.length,0)
}finally{f.close()}})
test('source context rejects symlink escape and source path traversal',()=>{const f=fixture(),outside=fs.mkdtempSync(path.join(os.tmpdir(),'dqa-outside-'));try{
 fs.writeFileSync(path.join(outside,'secret.ts'),'export const x={features:["hidden"]};');fs.symlinkSync(path.join(outside,'secret.ts'),path.join(f.root,'src/link.ts'))
 const d={labels:['hidden'],causes:{candidates:[{file:'src/link.ts'},{file:path.join(outside,'secret.ts')}]}}
 assert.deepEqual(sourceContext(d,{srcRoot:f.root,srcDir:'src'}).data,[])
}finally{f.close();fs.rmSync(outside,{recursive:true,force:true})}})

test('data-backed missing content rejects fixture literals but permits actual data binding',()=>{
 const {assertDataBackedChanges}=require('../code/source-context')
 const defect={rule:'M1',causes:{source_context:{data:[{label:'Blue jacket'}]}}}
 const before='export const Details=({row})=><p>pending</p>;'
 assert.throws(()=>assertDataBackedChanges(new Map([['src/Details.tsx',{before,after:'export const Details=()=> <p>Blue jacket</p>;'}]]),[defect],{}),/하드코딩/)
 assert.throws(()=>assertDataBackedChanges(new Map([['src/Details.tsx',{before,after:'export const Details=()=> <p>{"Bluejacket"}</p>;'}]]),[defect],{}),/하드코딩/)
 assert.throws(()=>assertDataBackedChanges(new Map([['src/Details.tsx',{before,after:'export const Details=()=> <p>{`Blue jacket`}</p>;'}]]),[defect],{}),/하드코딩/)
 assert.doesNotThrow(()=>assertDataBackedChanges(new Map([['src/Details.tsx',{before,after:'export const Details=({row})=> <p>{row.features.join(", ")}</p>;'}]]),[defect],{}))
 assert.doesNotThrow(()=>assertDataBackedChanges(new Map([['src/Details.tsx',{before,after:'export const Details=()=> <p>Blue jacket</p>;'}]]),[{rule:'M1',causes:{source_context:{data:[]}}}],{}))
})
test('explicit line anchor tolerates omitted leading indent but never searches other lines',()=>{const f=fixture();try{
 const {anchoredEdit,applyRanges}=require('../fix/source-edit');const file='src/A.tsx',source='const A=()=> {\n  const items = [1];\n  return <p>{items}</p>;\n};';fs.writeFileSync(path.join(f.root,file),source);const ctx={srcRoot:f.root,srcDir:'src'}
 const e=anchoredEdit({file,start:2,find:'const items = [1];',replace:'const items = [2];'},ctx);assert.ok(applyRanges(source,[e]).includes('\n  const items = [2];'))
 assert.throws(()=>anchoredEdit({file,start:1,find:'const items = [1];',replace:'const items = [2];'},ctx),/일치/)
 assert.throws(()=>anchoredEdit({file,start:0,find:'const items = [1];',replace:'const items = [2];'},ctx),/줄 번호/)
}finally{f.close()}})

// A rejected anchor reports source position, never silently applies elsewhere.
test('rejected edit anchor reports unique actual line without modifying source',()=>{const f=fixture();try{
 const {anchoredEdit}=require('../fix/source-edit');const file='src/Nav.js',source='const target = "orders";\nconst enabled = true;\nlocation.assign(target);';fs.writeFileSync(path.join(f.root,file),source);const ctx={srcRoot:f.root,srcDir:'src'};
 assert.throws(()=>anchoredEdit({file,start:1,find:'location.assign(target);',replace:'location.assign("cart");'},ctx),/현재 파일의 3줄/);
 assert.equal(fs.readFileSync(path.join(f.root,file),'utf8'),source);
}finally{f.close()}})
