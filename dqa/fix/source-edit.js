// Parse source before editing; ranges are anchored to the original file hash.
const fs=require('fs'),path=require('path'),crypto=require('crypto')
const {parse}=require('@babel/parser')
const hash=s=>crypto.createHash('sha256').update(s).digest('hex')
const ast=s=>parse(s,{sourceType:'unambiguous',plugins:['jsx','typescript']})
function visit(n,fn,parents=[]){if(!n||typeof n!=='object')return;if(n.type)fn(n,parents);for(const [k,v] of Object.entries(n)){if(['loc','comments','tokens'].includes(k))continue;if(Array.isArray(v))v.forEach(x=>visit(x,fn,[n,...parents]));else if(v&&typeof v==='object')visit(v,fn,[n,...parents])}}
function fileIn(ctx,rel){const base=path.resolve(ctx.srcRoot,ctx.srcDir),file=path.resolve(ctx.srcRoot,rel||'');if(!file.startsWith(base+path.sep)||!fs.existsSync(file)||!fs.realpathSync(file).startsWith(fs.realpathSync(base)+path.sep))throw Error('실제 소스 폴더 안 파일만 편집할 수 있습니다');return file}
function rangeEdit(file,text,start,end,replace,why){const e={source:'structured',file,line:text.slice(0,start).split('\n').length,find:text.slice(start,end),replace,range:{start,end,sha256:hash(text)},why};return e}
function applyRanges(text,edits){const sorted=[...edits].sort((a,b)=>b.range.start-a.range.start||b.range.end-a.range.end);let boundary=text.length+1;for(const e of sorted){const {start,end,sha256}=e.range;if(sha256!==hash(text)||start<0||end<start||end>text.length||text.slice(start,end)!==e.find)throw Error('수정 기준 소스가 바뀌었습니다');if(end>boundary)throw Error('겹치는 구조 수정은 하나의 작업으로 합쳐야 합니다');boundary=start}let out=text;for(const e of sorted)out=out.slice(0,e.range.start)+e.replace+out.slice(e.range.end);return out}
function safeValue(v){if(typeof v==='number'||typeof v==='boolean')return JSON.stringify(v);const s=String(v);return /^-?\d+(\.\d+)?$/.test(s)?String(Number(s)):JSON.stringify(s)}
function jsxEdits(file,text,component,property,value,line){
 if(!/^(color|fill|stroke|width|height|opacity|accessible|accessibilityLabel|placeholderTextColor)$/.test(property))throw Error('지원하지 않는 JSX 속성입니다')
 const matches=[];visit(ast(text),n=>{if(n.type==='JSXOpeningElement'&&n.name.type==='JSXIdentifier'&&n.name.name===component&&(!line||n.loc.start.line===line))matches.push(n)})
 if(!matches.length)throw Error('실제 JSX 컴포넌트를 찾지 못했습니다')
 return matches.map(n=>{const old=n.attributes.find(a=>a.type==='JSXAttribute'&&a.name.name===property);const val=safeValue(value),attr=`${property}={${val}}`;if(old)return rangeEdit(file,text,old.start,old.end,attr,'관측된 컴포넌트 속성을 시안 값으로 수정');if(n.attributes.some(a=>a.type==='JSXSpreadAttribute'))throw Error('spread 속성이 있어 안전한 값 우선순위를 확인할 수 없습니다');return rangeEdit(file,text,n.name.end,n.name.end,' '+attr,'시안 값이 필요한 JSX 컴포넌트에 명시적 속성 전달')})
}
function structuredEdit(a,ctx){const abs=fileIn(ctx,a.file),text=fs.readFileSync(abs,'utf8');let edits;
 if(a.action==='jsx_prop')edits=jsxEdits(a.file,text,a.selector,a.property,a.value,a.start)
 else if(a.action==='rn_style'){
  if(!/^[a-z][A-Za-z0-9]*$/.test(a.property)||['constructor','prototype'].includes(a.property))throw Error('스타일 속성 형식이 잘못됐습니다')
  const found=[];visit(ast(text),(n,ps)=>{if(n.type==='ObjectProperty'&&(n.key.name||n.key.value)===a.selector&&n.value.type==='ObjectExpression'&&ps.some(p=>p.type==='CallExpression'&&p.callee.type==='MemberExpression'&&p.callee.object.name==='StyleSheet'&&p.callee.property.name==='create'))found.push(n.value)})
  if(found.length!==1)throw Error('StyleSheet.create 안에서 고유한 스타일 키가 필요합니다')
  const obj=found[0],prop=obj.properties.find(p=>p.type==='ObjectProperty'&&(p.key.name||p.key.value)===a.property),value=safeValue(a.value)
  edits=[prop?rangeEdit(a.file,text,prop.value.start,prop.value.end,value,'관측된 React Native 스타일 값 수정'):rangeEdit(a.file,text,obj.start+1,obj.start+1,` ${a.property}: ${value},`,'React Native 스타일 속성 추가')]
 }else throw Error('지원하지 않는 구조 수정')
 ast(applyRanges(text,edits));return edits
}
function anchoredEdit(a,ctx){const abs=fileIn(ctx,a.file),text=fs.readFileSync(abs,'utf8');const find=String(a.find||'').replace(/^\s*\d+:\s?/,'');if(!find.trim()||typeof a.replace!=='string')throw Error('find와 replace가 필요합니다');let start=text.indexOf(find);
 if(a.start!==undefined){const lines=text.split('\n');if(!Number.isInteger(a.start)||a.start<1||a.start>lines.length)throw Error('유효한 원본 줄 번호가 필요합니다');start=lines.slice(0,a.start-1).join('\n').length+(a.start>1?1:0);if(text.slice(start,start+find.length)!==find){const indent=(lines[a.start-1].match(/^[ \t]*/)||[''])[0].length;const candidate=start+indent;if(text.slice(candidate,candidate+find.length)===find)start=candidate;else {const actual=text.indexOf(find);const hint=actual>=0&&text.indexOf(find,actual+1)<0?' 해당 find는 현재 파일의 '+text.slice(0,actual).split('\n').length+'줄에 한 번 있습니다. start는 read 범위가 아닌 find의 첫 줄입니다.':' read로 실제 줄과 코드 블록을 다시 확인하세요.';throw Error('지정한 원본 줄과 find가 일치하지 않습니다.'+hint)}}}
 else if(start<0||text.indexOf(find,start+1)>=0)throw Error('문자열이 없거나 중복입니다. read에서 확인한 start 줄과 정확한 find 블록을 지정하세요')
 if(find===a.replace)throw Error('바뀌는 것이 없습니다');const e=rangeEdit(a.file,text,start,start+find.length,a.replace,a.why||'코드 에이전트 수정');if(/\.[jt]sx?$/.test(a.file))ast(applyRanges(text,[e]));return e
}
// Resolve currentColor back to source SVG paints and the local transformer config.
// No application names, labels, PRs or predetermined corrected source are used.
function svgColorEdits(d,srcRoot){
 const v=d.design?.values?.find(v=>v.prop==='color'&&/^#[0-9a-f]{6}$/i.test(v.design));if(!v||!d.elements?.some(e=>e.representation==='outlined-text'))return []
 const c=d.causes?.candidates?.[0];if(!c||!/[jt]sx?$/.test(c.file))return []
 const abs=path.join(srcRoot,c.file);let text,tree;try{text=fs.readFileSync(abs,'utf8');tree=ast(text)}catch{return []}
 let dir=path.dirname(abs),mapping=null;while(dir.startsWith(path.resolve(srcRoot))){const conf=path.join(dir,'.svgrrc');if(fs.existsSync(conf)){try{mapping=JSON.parse(fs.readFileSync(conf,'utf8')).replaceAttrValues}catch{};break}dir=path.dirname(dir)}
 if(!mapping||mapping[v.design]!=='currentColor')return []
 const edits=[];let targetMatched=false;const owners=(d.elements||[]).flatMap(e=>e.components||[]).map(n=>n.replace(/^Svg/,''));for(const n of tree.program.body){if(n.type!=='ImportDeclaration'||!n.source.value.endsWith('.svg'))continue;const asset=path.resolve(path.dirname(abs),n.source.value);if(!asset.startsWith(path.resolve(srcRoot)+path.sep)||!fs.existsSync(asset))continue
 const svg=fs.readFileSync(asset,'utf8'),colors=[...new Set([...svg.matchAll(/\bfill=["'](#[0-9a-f]{6})["']/gi)].map(m=>m[1].toUpperCase()))];if(colors.length!==1||colors[0]!==v.design.toUpperCase())continue
 const name=n.specifiers.find(s=>s.type==='ImportDefaultSpecifier')?.local.name;if(!name)continue
 if(owners.includes(name.replace(/^Svg/,'')))targetMatched=true
 try{const es=jsxEdits(c.file,text,name,'color',v.design);for(const e of es){if(e.find!==e.replace)edits.push(e)}}catch{}
 }
 if(!edits.length||!targetMatched)return [];ast(applyRanges(text,edits));return [{source:'rule',file:c.file,line:edits[0].line,edits,why:'실제 SVG 색이 currentColor로 치환되지만 사용하는 컴포넌트에 색이 없어 상속값이 달라집니다. 같은 원본 색 자산의 사용처에 시안 색을 전달합니다.'}]
}
function uniqueEdits(edits){return [...new Map(edits.map(e=>[JSON.stringify([e.file,e.range||e.line||null,e.find,e.replace]),e])).values()]}
module.exports={uniqueEdits,ast,visit,hash,applyRanges,structuredEdit,anchoredEdit,svgColorEdits}
