// 로컬 작업 폴더 대상: 바이브코딩 중인 프로젝트를 그대로 검사한다.
// 작업 폴더는 읽기만 한다. 폴더를 APFS 복제(cp -c)로 떠서 그 사본에서 빌드하고, 커밋 전 상태(HEAD)는 git archive로 꺼내 따로 빌드한다.
// 작업 폴더에 쓰는 일은 `dqa apply --confirm "적용"`(fix/apply.js)만 한다.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync, spawn } = require('child_process')
const { home, assertAllowedPath, readJSON, writeJSON } = require('../core/util')
const { serveDist } = require('./static')

const LOCAL = home('~/design-qa-cases/local')
const h = (s, n = 12) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n)
const git = (cwd, args, opts = {}) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 120000, maxBuffer: 256 << 20, ...opts })
const tryGit = (cwd, args) => { try { return git(cwd, args).trim() } catch (e) { return null } }

// 프로젝트 종류와 웹 빌드 방법. 폴더의 .dqa.json이 있으면 그 값이 이긴다.
//   { "build": ["vite", "build", "--outDir", "{out}"], "src_dir": "src", "env": {}, "recipes": ["local/home"], "widths": "mobile5" }
function detectProject (dir) {
  const conf = readJSON(path.join(dir, '.dqa.json'), {})
  const pkg = readJSON(path.join(dir, 'package.json'), null)
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {}
  let kind; let build
  if (!pkg && fs.existsSync(path.join(dir, 'index.html'))) { kind = 'static'; build = null }
  else if (deps.expo) { kind = 'expo'; build = ['expo', 'export', '--platform', 'web', '--output-dir', '{out}'] }
  else if (deps.vite) { kind = 'vite'; build = ['vite', 'build', '--outDir', '{out}', '--emptyOutDir', '--base', '/'] }
  else if (deps['react-scripts']) { kind = 'cra'; build = ['react-scripts', 'build'] }
  else kind = 'unknown'
  if (conf.build) build = conf.build
  const srcDir = conf.src_dir || ['src', 'app', '.'].find((s) => fs.existsSync(path.join(dir, s)))
  if (kind === 'unknown' && !conf.build) throw new Error(`웹 빌드 방법을 모른다: ${dir}. .dqa.json에 "build": ["도구", "인자", "{out}"]를 적는다(정적 사이트면 index.html이 있는 폴더를 준다)`)
  return { kind, build, out_flag: build ? build.includes('{out}') : false, src_dir: srcDir, env: conf.env || {}, recipes: conf.recipes || null, widths: conf.widths || null, stubs: conf.stubs || null, design: conf.design || null, lock: ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].find((f) => fs.existsSync(path.join(dir, f))) || null, name: (pkg && pkg.name) || path.basename(dir) }
}

// git 정보: 작업 폴더가 저장소 안에 있으면 뿌리, 그 안의 상대 경로, HEAD, 커밋 안 된 변경
function gitInfo (dir) {
  const top = tryGit(dir, ['rev-parse', '--show-toplevel'])
  if (!top) return null
  const rel = path.relative(top, dir)
  const head = tryGit(dir, ['rev-parse', 'HEAD'])
  let status = ''; try { status = git(dir, ['status', '--porcelain', '--', '.']) } catch (e) {} // 앞 공백이 상태 칸이라 trim하지 않는다
  return { top, rel, head, dirty: status.split('\n').filter(Boolean).map((l) => l.slice(3)) }
}

function run (cmd, args, cwd, env, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now(); let log = ''
    const c = spawn(cmd, args, { cwd, env: { ...process.env, ...(env || {}) } })
    c.stdout.on('data', (d) => { log += d }); c.stderr.on('data', (d) => { log += d })
    const tm = setTimeout(() => c.kill('SIGTERM'), timeoutMs)
    c.on('exit', (code) => { clearTimeout(tm); resolve({ code, ms: Date.now() - t0, log: log.slice(-4000) }) })
  })
}

const nmHash = (dir, lock) => (lock && fs.existsSync(path.join(dir, lock)) ? h(fs.readFileSync(path.join(dir, lock), 'utf8')) : null)

// 사본에서 웹 빌드. 결과는 사본 밖 outDir에 둔다
async function buildSnapshot (snap, proj, outDir, timeoutMs) {
  if (proj.kind === 'static') return { ok: true, dist: snap, ms: 0 }
  fs.rmSync(outDir, { recursive: true, force: true })
  const args = proj.build.map((a) => (a === '{out}' ? outDir : a))
  const r = await run('npx', args, snap, { CI: '1', BROWSER: 'none', ...proj.env }, timeoutMs)
  // {out}을 받지 않는 도구(react-scripts 등)는 사본 안 build/dist를 옮긴다
  if (!proj.out_flag) for (const d of ['build', 'dist']) { const p = path.join(snap, d); if (r.code === 0 && fs.existsSync(path.join(p, 'index.html'))) { fs.renameSync(p, outDir); break } }
  const ok = r.code === 0 && fs.existsSync(path.join(outDir, 'index.html'))
  return { ok, dist: outDir, ms: r.ms, log: r.log }
}

// 작업 폴더 사본(커밋 안 된 변경 포함). .git은 사본에서 지운다
function snapshotWorking (dir, base) {
  const snap = path.join(base, `work-${Date.now().toString(36)}`)
  fs.mkdirSync(base, { recursive: true })
  execFileSync('cp', ['-c', '-R', dir, snap], { timeout: 300000 })
  fs.rmSync(path.join(snap, '.git'), { recursive: true, force: true })
  // 지난 작업 사본은 최근 3개만 남긴다(수정 검증이 사본을 쓴다)
  const old = fs.readdirSync(base).filter((n) => n.startsWith('work-')).sort().slice(0, -3)
  for (const n of old) fs.rmSync(path.join(base, n), { recursive: true, force: true })
  return snap
}

// 커밋 상태 사본: git archive(저장소에 쓰지 않는다). node_modules는 lock이 같으면 작업 폴더 것을 복제한다
function snapshotRef (dir, gi, ref, base, proj, allowInstall) {
  const sha = git(dir, ['rev-parse', `${ref}^{commit}`]).trim()
  const snap = path.join(base, `ref-${sha.slice(0, 12)}`)
  if (!fs.existsSync(path.join(snap, '.dqa-ok'))) {
    fs.rmSync(snap, { recursive: true, force: true }); fs.mkdirSync(snap, { recursive: true })
    const tree = gi.rel ? `${sha}:${gi.rel}` : sha
    const tar = execFileSync('git', ['-C', gi.top, 'archive', '--format=tar', tree], { maxBuffer: 1 << 30, timeout: 300000 })
    execFileSync('tar', ['-x', '-C', snap], { input: tar, maxBuffer: 1 << 30 })
    fs.writeFileSync(path.join(snap, '.dqa-ok'), sha)
  }
  if (proj.kind !== 'static' && !fs.existsSync(path.join(snap, 'node_modules'))) {
    const same = proj.lock && nmHash(dir, proj.lock) === nmHash(snap, proj.lock)
    if (same && fs.existsSync(path.join(dir, 'node_modules'))) execFileSync('cp', ['-c', '-R', path.join(dir, 'node_modules'), path.join(snap, 'node_modules')], { timeout: 300000 })
    else if (!allowInstall) throw Object.assign(new Error(`커밋 ${sha.slice(0, 12)}의 ${proj.lock || 'lock 파일'}이 작업 폴더와 달라 node_modules를 복제할 수 없다. npm ci가 필요하다(다운로드, 승인 후 --allow-install) 또는 --base none`), { code: 'needs_install' })
    else execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: snap, timeout: 900000, stdio: 'ignore' })
  }
  return { snap, sha }
}

async function openLocal (args, cfg) {
  const dir = assertAllowedPath(args.local, cfg)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`작업 폴더가 없다: ${args.local}`)
  const proj = detectProject(dir)
  const gi = gitInfo(dir)
  const base = path.join(LOCAL, `${String(proj.name).replace(/[^\w.-]+/g, '-').slice(0, 30)}-${h(dir, 8)}`)
  assertAllowedPath(base, cfg)
  const say = (m) => { if (!process.env.DQA_QUIET) console.log(`[local] ${m}`) }
  const timeout = (cfg.fix && cfg.fix.build_timeout_ms) || 600000

  say(`작업 폴더 사본 만드는 중(${proj.kind})`)
  const work = snapshotWorking(dir, base)
  const wb = await buildSnapshot(work, proj, path.join(base, 'dist-work'), timeout)
  if (!wb.ok) throw new Error(`작업 폴더 빌드 실패: ${(wb.log || '').slice(-600)}`)
  say(`작업 폴더 빌드 ${(wb.ms / 1000).toFixed(1)}초`)

  // 비교 기준: 기본은 HEAD(커밋 안 된 변경이 있을 때만). --base none이면 단독 검사, --base <ref>면 그 커밋
  const want = args.base === undefined || args.base === true ? 'HEAD' : String(args.base)
  let ref = null
  if (want !== 'none' && gi && gi.head) {
    if (want !== 'HEAD' || gi.dirty.length) {
      say(`${want} 사본 만드는 중`)
      const r = snapshotRef(dir, gi, want, base, proj, args['allow-install'])
      const rb = await buildSnapshot(r.snap, proj, path.join(base, `dist-ref-${r.sha.slice(0, 12)}`), timeout)
      if (!rb.ok) throw new Error(`${want} 빌드 실패: ${(rb.log || '').slice(-600)}`)
      ref = { ...r, dist: rb.dist, ms: rb.ms }
    } else say('커밋 안 된 변경이 없어 단독 검사한다')
  }

  const open = async (dist, src, refName, note) => { const s = await serveDist(dist); return { kind: 'local', origin: s.origin, src, dir: dist, ref: refName, note, close: s.close } }
  const label = path.basename(dir)
  const head = await open(wb.dist, work, `${label}(작업 중)`, `${dir} — 커밋 안 된 변경 ${gi ? gi.dirty.length : 0}개 포함`)
  const baseT = ref ? await open(ref.dist, ref.snap, `${label}@${ref.sha.slice(0, 8)}`, `${dir} — ${want} ${ref.sha.slice(0, 8)}`) : null
  const repoCfg = { name: 'local', app_dir: '.', src_dir: proj.src_dir === '.' ? '' : proj.src_dir, build_args: proj.build, build_env: { CI: '1', BROWSER: 'none', ...proj.env }, tokens: null }
  return {
    head, base: baseT, repoCfg,
    recipes: proj.recipes || ['local/home'],
    widths: proj.widths,
    local: { project: dir, kind: proj.kind, snapshot: work, design: proj.design, git: gi ? { top: gi.top, rel: gi.rel, head: gi.head, dirty: gi.dirty.slice(0, 50) } : null, base_ref: ref ? { ref: want, sha: ref.sha } : null, repoCfg }
  }
}

module.exports = { openLocal, detectProject, gitInfo }
