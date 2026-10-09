// 공통: 설정, 경로, 크롬 찾기, 금지 경로 검사, 실행 폴더, 진행 기록, 작은 동시 실행 풀.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const DQA = path.resolve(__dirname, '..')
const ROOT = path.resolve(DQA, '..') // design_qa/ 또는 최종 프로젝트 저장소 뿌리
// 판정 기준·지식 문서(P01~P04): 최종 프로젝트 저장소는 knowledge/, 수업 저장소는 w3/docs/
const KNOWLEDGE = [path.join(ROOT, 'knowledge'), path.join(ROOT, 'w3/docs')].find((d) => fs.existsSync(d)) || path.join(ROOT, 'knowledge')
const RUNS = path.join(DQA, 'runs')
const STATE = path.join(DQA, 'state')

const home = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p)
const readJSON = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { if (dflt !== undefined) return dflt; throw e } }
const writeJSON = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 1)) }
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')

function loadConfig () {
  const cfg = readJSON(path.join(DQA, 'config', 'default.json'))
  cfg.repos = readJSON(path.join(DQA, 'config', 'repos.json'), {})
  return cfg
}

// 사용자 작업본(예: ~/Come-back-home) 안의 경로는 읽지도 쓰지도 않는다. 심볼릭 링크도 풀어서 본다.
function assertAllowedPath (p, cfg) {
  if (!p) return p
  const abs = path.resolve(home(p))
  let real = abs
  try { real = fs.realpathSync(abs) } catch (e) {}
  for (const f of cfg.forbidden_paths || []) {
    const fb = path.resolve(home(f))
    if ([abs, real].some((x) => x === fb || x.startsWith(fb + path.sep))) throw new Error(`금지 경로라 쓰지 않는다: ${p} (사용자 작업본 ${f})`)
  }
  return abs
}

// 캐시된 Playwright 크롬(headless shell 우선)을 찾는다. DQA_CHROME으로 덮어쓸 수 있다.
function findChrome () {
  if (process.env.DQA_CHROME && fs.existsSync(process.env.DQA_CHROME)) return process.env.DQA_CHROME
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright')
  const cands = []
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    const m = d.match(/^chromium(_headless_shell)?-(\d+)$/)
    if (!m) continue
    const exe = m[1]
      ? path.join(base, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')
      : path.join(base, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (fs.existsSync(exe)) cands.push({ exe, rev: Number(m[2]), shell: !!m[1] })
  }
  cands.sort((a, b) => (b.shell - a.shell) || (b.rev - a.rev))
  return cands.length ? cands[0].exe : null
}

function stamp () {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// 실행 폴더와 진행 기록(events.jsonl). 웹 화면이 이 기록을 읽어 진행 상황을 보여 준다.
function createRun (slug, runId) {
  const id = runId || `${stamp()}_${String(slug).replace(/[^\w.-]+/g, '-').slice(0, 40)}`
  const dir = path.join(RUNS, id)
  fs.mkdirSync(dir, { recursive: true })
  const evf = path.join(dir, 'events.jsonl')
  const t0 = Date.now()
  const event = (stage, msg, extra) => {
    const e = { t: new Date().toISOString(), sec: Math.round((Date.now() - t0) / 100) / 10, stage, msg, ...(extra || {}) }
    fs.appendFileSync(evf, JSON.stringify(e) + '\n')
    if (!process.env.DQA_QUIET) console.log(`[${e.sec}s] ${stage}: ${msg}`)
  }
  return { id, dir, event, t0, file: (rel) => path.join(dir, rel) }
}

async function pool (items, n, fn) {
  const out = new Array(items.length); let i = 0
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) } }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

module.exports = { DQA, ROOT, KNOWLEDGE, RUNS, STATE, home, readJSON, writeJSON, sha1, loadConfig, assertAllowedPath, findChrome, createRun, pool, stamp }
