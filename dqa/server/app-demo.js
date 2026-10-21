const fs = require('fs'); const path = require('path')
const { ROOT, RUNS, STATE, readJSON, writeJSON, sha1 } = require('../core/util')
const APPS = { atelier: 'eval/app-demo-20261016', fieldwork: 'eval/fieldwork-service', overflow: "../Desktop/\u1109\u1165\u1100\u1161\u11bc\u1103\u1162\u1112\u1161\u11a8\u1100\u116d/6\u1112\u1161\u11a8\u1100\u1175/AI\u110b\u1166\u110b\u1175\u110c\u1165\u11ab\u1110\u1173/outputs/dqa_overflow_live_demo" }
function config (app = 'fieldwork') {
  if (!Object.hasOwn(APPS, app)) throw new Error('등록되지 않은 데모입니다')
  const base = path.join(ROOT, APPS[app])
  return { app, base, local: path.join(base, 'frontend'), state: path.join(STATE, app === 'atelier' ? 'app-demo.json' : app + '-demo.json') }
}
function matchingApp (local) {
  if (typeof local !== 'string' || !path.isAbsolute(local)) return null
  let target; try { target = fs.statSync(local) } catch { return null }
  if (!target.isDirectory()) return null
  for (const app of Object.keys(APPS)) {
    try { const candidate = fs.statSync(config(app).local); if (candidate.dev === target.dev && candidate.ino === target.ino) return app } catch {}
  }
  return null
}
function liveUrl (body, id) {
  const app = body.kind === 'local' && body.autofix ? matchingApp(body.local) : null
  return app ? `/demo?app=${encodeURIComponent(app)}&compact=1&run=${encodeURIComponent(id)}` : `/#/runs/${encodeURIComponent(id)}`
}
const LOCAL = config('atelier').local
function info (app) { const c=config(app); return { ...readJSON(path.join(c.base, 'app-manifest.json')), ...readJSON(c.state, {}), app:c.app } }
function remember (id, app) { writeJSON(config(app).state, { run_id: id, at: new Date().toISOString() }) }
function preview (id, app) {
  const c=config(app), BASE=c.base, LOCAL=c.local
  if (!/^[\w.-]+$/.test(id || '')) throw new Error('실행 ID 형식이 이상합니다')
  const dir = path.join(RUNS, id), m = readJSON(path.join(dir, 'manifest.json'))
  if (!m.local?.project || fs.statSync(m.local.project).dev !== fs.statSync(LOCAL).dev || fs.statSync(m.local.project).ino !== fs.statSync(LOCAL).ino) throw new Error('선택한 데모의 실행만 미리 볼 수 있습니다')
  const f = readJSON(path.join(dir, 'fix/fixes.json'))
  require('../fix/validation').assertVerifiedCombined(f.combined)
  for (const name of ['pipeline.json', 'fix/pipeline.json']) if (readJSON(path.join(dir, name), {}).state !== 'succeeded') throw new Error('Dify 검사와 수정이 모두 완료되어야 합니다')
  const dest = path.join(BASE, 'previews', id)
  const marker = path.join(dest, '.verified.json')
  if (!fs.existsSync(marker)) {
    const src = m.targets.head.src
    for (const [rel, hash] of Object.entries(f.combined.before_sha1)) if (sha1(fs.readFileSync(path.join(src, rel), 'utf8')) !== hash) throw new Error('검사 기준 소스가 변경되었습니다. 다시 검사하세요')
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.cpSync(src, dest, { recursive: true })
    for (const rel of Object.keys(f.combined.before_sha1)) {
      const target = path.resolve(dest, rel)
      if (!target.startsWith(dest + path.sep)) throw new Error('사본 밖 경로입니다')
      fs.copyFileSync(path.join(dir, 'fix/source', rel), target)
    }
    writeJSON(marker, { run_id: id, status: 'verified-copy', at: new Date().toISOString() })
  }
  return { url: `/demo/${c.app}/after/${id}/index.html`, path: dest }
}
function asset (pathname) {
  const match=pathname.match(/^\/demo\/(atelier|fieldwork|overflow)\/(before|after|design)\/(.*)$/)
  if(!match) return null
  const c=config(match[1]); let root,rel
  if(match[2]==='design') {root=path.join(c.base,'designs');rel=match[3]}
  else if(match[2]==='before') {root=c.local;rel=match[3]}
  else {const m=match[3].match(/^([\w.-]+)\/(.*)$/);if(!m)return null;root=path.join(c.base,'previews',m[1]);rel=m[2];if(!fs.existsSync(path.join(root,'.verified.json')))return null}
  rel=decodeURIComponent(rel||'index.html')
  if(!/\.(html|css|js|ttf|png|svg)$/.test(rel))return null
  const f=path.resolve(root,rel)
  return f.startsWith(root+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile()?f:null
}
module.exports = { LOCAL, config, info, remember, preview, asset, matchingApp, liveUrl }
