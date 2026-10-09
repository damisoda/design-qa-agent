// 저장소 대상: PR 번호나 ref를 커밋으로 바꾸고, 커밋마다 worktree → node_modules(lock 해시가 같은 것을 APFS 복제) → 목 모드 웹 빌드.
// 빌드는 커밋 단위로 캐시한다(~/design-qa-cases/builds/<sha12>). 클론은 GitHub 독립 클론만 쓴다(사용자 작업본과 연결 금지).
// 새 lock 해시면 npm ci가 필요하다(다운로드). --allow-install 없이는 거부한다.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync, spawn } = require('child_process')
const { home, assertAllowedPath, writeJSON, readJSON } = require('../core/util')
const { serveDist } = require('./static')

const CASES = home('~/design-qa-cases')
const git = (clone, args, opts = {}) => execFileSync('git', ['-C', clone, ...args], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20, ...opts }).trim()
const h12 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12)

function checkClone (clone, cfg) {
  if (!fs.existsSync(path.join(clone, '.git'))) throw new Error(`저장소 클론이 없다: ${clone}. dqa doctor의 안내대로 GitHub에서 독립 클론을 만든다(승인 필요)`)
  const alt = path.join(clone, '.git/objects/info/alternates')
  const remote = git(clone, ['remote', 'get-url', 'origin'])
  const bad = (cfg.forbidden_paths || []).map(home).some((f) => remote.includes(f) || (fs.existsSync(alt) && fs.readFileSync(alt, 'utf8').includes(f)))
  if (bad) throw new Error('이 클론은 사용자 작업본을 원격이나 객체 저장소로 쓴다. 쓰지 않는다')
}

// PR이나 ref → { head, base, note }
function resolveRefs (args, rc, clone) {
  if (args.pr) {
    const pr = JSON.parse(execFileSync('gh', ['pr', 'view', String(args.pr), '-R', rc.github, '--json', 'number,title,state,mergeCommit,baseRefName,headRefOid,headRefName'], { encoding: 'utf8', timeout: 30000 }))
    if (pr.state === 'MERGED' && pr.mergeCommit) {
      const head = pr.mergeCommit.oid
      try { git(clone, ['cat-file', '-e', head]) } catch (e) { git(clone, ['fetch', 'origin', head]) }
      const base = git(clone, ['rev-parse', `${head}^1`])
      return { head, base, note: `PR #${pr.number} ${pr.title}`, kind: '병합된 PR(병합 커밋 대 첫 부모)', ref_name: null }
    }
    try { git(clone, ['cat-file', '-e', pr.headRefOid]) } catch (e) { git(clone, ['fetch', 'origin', `pull/${pr.number}/head`]) }
    const base = git(clone, ['merge-base', `origin/${pr.baseRefName}`, pr.headRefOid])
    return { head: pr.headRefOid, base, note: `PR #${pr.number} ${pr.title}`, kind: `열린 PR(머리 대 ${pr.baseRefName}과의 공통 조상)`, ref_name: pr.headRefName }
  }
  const rev = (r) => { for (const c of [`origin/${r}`, r]) { try { return git(clone, ['rev-parse', '--verify', `${c}^{commit}`]) } catch (e) {} } throw new Error(`커밋을 찾지 못했다: ${r}`) }
  let isBranch = false; try { git(clone, ['rev-parse', '--verify', `origin/${args.ref}^{commit}`]); isBranch = true } catch (e) {}
  const head = rev(args.ref)
  const base = args.base ? rev(args.base) : null
  return { head, base, note: `${args.ref}${args.base ? ` (기준 ${args.base})` : ''}`, kind: 'ref', ref_name: isBranch ? args.ref : null }
}

function lockKey (clone, sha, rc) {
  const lock = git(clone, ['show', `${sha}:${rc.lock}`])
  let patches = ''; try { patches = git(clone, ['ls-tree', '-r', sha, rc.patches]) } catch (e) {}
  return { key: h12(lock + '\n' + patches), lockHash: h12(lock) }
}

function seedFor (rc, key, clone) {
  // 씨앗 node_modules: 그 옆 package-lock.json(과 patches)의 해시가 같아야 쓴다
  for (const s of rc.seed_node_modules || []) {
    const nm = home(s); const app = path.dirname(nm)
    if (!fs.existsSync(nm)) continue
    try {
      const lock = fs.readFileSync(path.join(app, 'package-lock.json'), 'utf8').trimEnd()
      // 씨앗은 worktree이므로 patches 목록은 같은 저장소의 해당 커밋에서 확인하지 않고, 파일 목록으로 비교한다
      const pdir = path.join(app, 'patches')
      const listing = fs.existsSync(pdir) ? fs.readdirSync(pdir).sort().join('\n') : ''
      const want = git(clone, ['ls-tree', '-r', '--name-only', 'HEAD', rc.patches]).split('\n').map((p) => path.basename(p)).sort().join('\n')
      if (h12(lock + '\n') === key.lockHash || h12(lock) === key.lockHash) { if (listing === want || !want) return nm }
    } catch (e) {}
  }
  return null
}

const run = (cmd, args, cwd, env, timeoutMs) => new Promise((resolve) => {
  const t0 = Date.now(); let log = ''
  const c = spawn(cmd, args, { cwd, env: { ...process.env, ...(env || {}) } })
  c.stdout.on('data', (d) => { log += d }); c.stderr.on('data', (d) => { log += d })
  const tm = setTimeout(() => c.kill('SIGTERM'), timeoutMs)
  c.on('exit', (code) => { clearTimeout(tm); resolve({ code, ms: Date.now() - t0, log: log.slice(-4000) }) })
})

async function ensureBuild (sha, rc, clone, args, cfg, say) {
  const s12 = sha.slice(0, 12)
  const out = path.join(CASES, 'builds', s12)
  const wt = path.join(CASES, 'wt', s12)
  assertAllowedPath(out, cfg); assertAllowedPath(wt, cfg)
  const meta = readJSON(path.join(out, 'build.json'), null)
  if (meta && fs.existsSync(path.join(out, 'dist', 'index.html')) && fs.existsSync(wt)) { say(`${s12}: 빌드 캐시 사용`); return { dist: path.join(out, 'dist'), src: wt, sha, cache: true, ms: 0 } }
  if (!fs.existsSync(wt)) { say(`${s12}: worktree 만드는 중`); git(clone, ['worktree', 'add', '--detach', wt, sha]) }
  const app = path.join(wt, rc.app_dir)
  const key = lockKey(clone, sha, rc)
  const nmCache = path.join(CASES, 'nm', key.key, 'node_modules')
  if (!fs.existsSync(nmCache)) {
    const seed = seedFor(rc, key, clone)
    if (seed) { say(`${s12}: node_modules 씨앗 복제(lock ${key.lockHash})`); fs.mkdirSync(path.dirname(nmCache), { recursive: true }); execFileSync('cp', ['-c', '-R', seed, nmCache], { timeout: 300000 }) } else if (args['allow-install']) {
      say(`${s12}: 새 lock 해시(${key.lockHash}) — npm ci로 설치(다운로드)`)
      const r = await run('npm', ['ci', '--no-audit', '--no-fund'], app, {}, 900000)
      if (r.code !== 0) throw new Error(`npm ci 실패: ${r.log.slice(-500)}`)
      fs.mkdirSync(path.dirname(nmCache), { recursive: true }); execFileSync('cp', ['-c', '-R', path.join(app, 'node_modules'), nmCache], { timeout: 300000 })
    } else throw Object.assign(new Error(`커밋 ${s12}의 package-lock.json(해시 ${key.lockHash})에 맞는 node_modules가 없다. npm ci로 받아야 한다(다운로드 약 400MB, 승인 후 --allow-install)`), { code: 'needs_install' })
  }
  if (!fs.existsSync(path.join(app, 'node_modules'))) execFileSync('cp', ['-c', '-R', nmCache, path.join(app, 'node_modules')], { timeout: 300000 })
  say(`${s12}: 목 모드 웹 빌드 중`)
  const b = await run('npx', [...rc.build_args, '--output-dir', 'dist-dqa'], app, rc.build_env, 600000)
  if (b.code !== 0 || !fs.existsSync(path.join(app, 'dist-dqa', 'index.html'))) throw new Error(`빌드 실패(${s12}): ${b.log.slice(-600)}`)
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true })
  fs.renameSync(path.join(app, 'dist-dqa'), path.join(out, 'dist'))
  fs.writeFileSync(path.join(out, 'build.log'), b.log)
  writeJSON(path.join(out, 'build.json'), { sha, lock: key.lockHash, nm_key: key.key, ms: b.ms, flags: rc.build_args.join(' '), env: rc.build_env, at: new Date().toISOString() })
  say(`${s12}: 빌드 ${(b.ms / 1000).toFixed(1)}초`)
  return { dist: path.join(out, 'dist'), src: wt, sha, cache: false, ms: b.ms }
}

async function openRepo (args, cfg) {
  const rc = cfg.repos[args.repo]
  if (!rc) throw new Error(`설정에 없는 저장소: ${args.repo}`)
  const clone = assertAllowedPath(rc.clone, cfg)
  checkClone(clone, cfg)
  const say = (m) => { if (!process.env.DQA_QUIET) console.log(`[build] ${m}`) }
  const refs = resolveRefs(args, rc, clone)
  const head = await ensureBuild(refs.head, rc, clone, args, cfg, say)
  const base = refs.base ? await ensureBuild(refs.base, rc, clone, args, cfg, say) : null
  const open = async (b, side) => {
    const s = await serveDist(b.dist)
    return { kind: 'repo', origin: s.origin, src: b.src, dir: b.dist, ref: b.sha.slice(0, 12), note: `${refs.note} — ${side} ${b.sha.slice(0, 8)}`, repo: args.repo, close: s.close }
  }
  return {
    head: await open(head, '변경 후'),
    base: base ? await open(base, '변경 전') : null,
    repoCfg: { ...rc, name: args.repo },
    recipes: rc.recipes,
    build: { kind: refs.kind, ref_name: refs.ref_name, head: { sha: head.sha, cache: head.cache, ms: head.ms }, base: base ? { sha: base.sha, cache: base.cache, ms: base.ms } : null }
  }
}

module.exports = { openRepo, resolveRefs, ensureBuild }
