// Bounded static discovery. Never execute project JavaScript or guess authentication steps.
const fs = require('fs'); const path = require('path'); const { createHash } = require('crypto')
const { parse } = require('@babel/parser')
const skip = new Set(['node_modules','.git','.next','.expo','dist','build','coverage','vendor','.turbo','test','tests','__tests__'])
const hash = s => createHash('sha256').update(s).digest('hex').slice(0,16)
function routePath (raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.length > 500 || /[\\\s\x00-\x1f]/.test(raw)) return null
  let decoded; try { decoded = decodeURIComponent(raw) } catch { return null }
  if (decoded.startsWith('//') || /[\\\x00-\x1f]/.test(decoded) || decoded.split(/[/?#]/).some(x => x === '..' || x === '.')) return null
  return raw
}
const dynamic = p => /(^|\/)[:*]|\[/.test(p)
function join (base, child) { return child.startsWith('/') ? child : (base.replace(/\/$/,'') + '/' + child).replace(/\/{2,}/g,'/') }
function discover (dir) {
  let expoRouter=false
  try { const p=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8')); expoRouter=!!(p.dependencies?.['expo-router'] || p.devDependencies?.['expo-router']) } catch {}
  const files=[]; const warnings=[]; let visited=0; let bytes=0; let limited=false
  function walk (folder, depth=0) {
    if(depth>12) {limited=true;return}
    for(const e of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if(++visited>5000) {limited=true;return}
      if(e.isSymbolicLink() || e.name.startsWith('.') || skip.has(e.name)) continue
      const f=path.join(folder,e.name)
      if(e.isDirectory()) walk(f,depth+1)
      else if(/\.(html?|[cm]?[jt]sx?|vue)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) {
        const size=fs.statSync(f).size
        if(size>512000 || bytes+size>8e6) {limited=true;continue}
        bytes+=size; files.push({file:path.relative(dir,f).split(path.sep).join('/'),text:fs.readFileSync(f,'utf8')})
      }
      if(visited>5000) return
    }
  }
  walk(dir)
  const routes=new Map()
  const add=(raw,file,via,title)=>{
    const p=routePath(raw); if(!p) return
    const entry=routes.get(p) || {id:'found-'+hash(p),path:p,title:title||p,source:file,via,dynamic:dynamic(p),steps:0}
    routes.set(p,entry)
  }
  for(const {file,text} of files) {
    if(/\.html?$/.test(file) && !file.startsWith('public/')) {
      const p=file==='index.html'?'/':'/'+file
      add(p,file,'HTML 페이지',(text.match(/<title[^>]*>([^<]+)<\/title>/i)||[])[1]?.trim())
      for(const m of text.matchAll(/\bhref\s*=\s*["'](\/[^"']*)["']/g)) if(!/\.(css|js|png|jpe?g|svg|pdf)([?#]|$)/i.test(m[1])) add(m[1],file,'페이지 링크')
    }
    // Next app/pages and Nuxt pages conventions (not arbitrary component files).
    const page=file.match(/^(?:src\/)?pages\/(.+)\.(?:[jt]sx?|vue)$/)
    const app=file.match(/^(?:src\/)?app\/(.+)\.[jt]sx?$/)
    if(page && !page[1].startsWith('api/') && !page[1].split('/').some(x=>x.startsWith('_'))) {
      add('/'+page[1].replace(/(^|\/)index$/,'').replace(/\/$/,''),file,'페이지 파일')
    }
    if(expoRouter && app) {
      const segments=app[1].split('/').filter(x=>!/^\(.*\)$/.test(x))
      if(!segments.some(x=>x.startsWith('_')||x.startsWith('+')||x.startsWith('@')) && segments.length) {
        if(segments.at(-1)==='index')segments.pop()
        add('/'+segments.join('/'),file,'Expo 화면 파일')
      }
    }
    if(!expoRouter && app && /(?:^|\/)page$/.test(app[1])) {
      const segments=app[1].split('/').slice(0,-1).filter(x=>!/^\(.*\)$/.test(x))
      if(!segments.some(x=>x.startsWith('@')||x.startsWith('_')||x.startsWith('('))) add('/'+segments.join('/'),file,'페이지 파일')
    }
    if(!/\.[cm]?[jt]sx?$/.test(file) || !/(?:react-router|createBrowserRouter|createHashRouter|<Route\b|createRouter)/.test(text)) continue
    let ast
    try { ast=parse(text,{sourceType:'unambiguous',plugins:['jsx','typescript'],errorRecovery:true}) } catch {warnings.push(`${file}: 라우터 코드를 읽지 못했습니다.`);continue}
    const hashMode=/<HashRouter\b|createHashRouter\s*\(/.test(text)
    const literal=n=>n?.type==='StringLiteral'?n.value:null
    function jsx(n,parent='/') {
      if(!n || typeof n!=='object')return
      if(n.type==='JSXElement' && n.openingElement.name?.name==='Route') {
        const attrs=n.openingElement.attributes||[]
        const attr=attrs.find(a=>a.name?.name==='path')
        const raw=literal(attr?.value?.type==='JSXExpressionContainer'?attr.value.expression:attr?.value)
        const idx=attrs.some(a=>a.name?.name==='index')
        if(attr && raw===null){warnings.push(`${file}: 계산된 경로는 자동으로 확정하지 않았습니다.`);return}
        const dest=raw===null?parent:join(parent,raw)
        if(raw!==null||idx) add(hashMode?'/#'+dest:dest,file,'라우터 코드')
        for(const child of n.children||[]) jsx(child,dest)
        return
      }
      for(const [key,value] of Object.entries(n)) if(!['loc','start','end'].includes(key)) {if(Array.isArray(value))for(const x of value)jsx(x,parent);else if(value&&typeof value==='object')jsx(value,parent)}
    }
    jsx(ast)
    const variables=new Map()
    function collect(n){if(!n||typeof n!=='object')return;if(n.type==='VariableDeclarator'&&n.id?.type==='Identifier')variables.set(n.id.name,n.init);for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')collect(v)}}
    collect(ast)
    function array(n,base='/',seen=new Set()) {
      if(n?.type==='Identifier'){if(seen.has(n.name))return;seen.add(n.name);return array(variables.get(n.name),base,seen)}
      if(n?.type!=='ArrayExpression') {warnings.push(`${file}: 외부에서 조합한 경로는 직접 확인이 필요합니다.`);return}
      for(const e of n.elements||[]) {
        if(e?.type!=='ObjectExpression')continue
        const props=Object.fromEntries(e.properties.filter(p=>p.type==='ObjectProperty').map(p=>[p.key.name||p.key.value,p.value]))
        const raw=literal(props.path)
        if(props.path&&raw===null){warnings.push(`${file}: 계산된 경로는 자동으로 확정하지 않았습니다.`);continue}
        const dest=raw===null?base:join(base,raw)
        if(raw!==null||props.index?.value===true) add(hashMode?'/#'+dest:dest,file,'라우터 코드')
        if(props.children)array(props.children,dest,new Set(seen))
      }
    }
    function calls(n){if(!n||typeof n!=='object')return
      if(n.type==='CallExpression') {
        const name=n.callee?.name
        if(['createBrowserRouter','createHashRouter'].includes(name))array(n.arguments[0])
        if(name==='createRouter'&&n.arguments[0]?.type==='ObjectExpression') {const p=n.arguments[0].properties.find(p=>p.key?.name==='routes');if(p)array(p.value)}
      }
      for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(calls);else if(v&&typeof v==='object')calls(v)}
    }
    calls(ast)
  }
  if(limited)warnings.push('큰 파일·제외 폴더·탐색 한도를 넘는 파일은 생략했습니다. 목록이 앱 전체를 뜻하지는 않습니다.')
  if(!routes.size)warnings.push('화면 경로를 찾지 못했습니다. 아래에서 직접 경로를 추가할 수 있습니다.')
  return {screens:[...routes.values()].sort((a,b)=>a.path.localeCompare(b.path)),warnings:[...new Set(warnings)],scanned_files:files.length}
}
module.exports={discover,routePath,dynamic,hash}
