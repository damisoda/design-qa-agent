// dqa doctor: 검수에 필요한 것들이 준비됐는지 표로 보여 준다(바꾸는 것 없음).
// dqa up: 맥미니 터널(18434 Ollama, 18080 임베딩)이 닫혀 있으면 열고, Dify 보고서 에이전트용 생각 끔 중계기(18435)를 띄운다.
const fs = require('fs')
const net = require('net')
const { execFileSync, spawnSync } = require('child_process')
const { findChrome, home, RUNS } = require('../core/util')

const portOpen = (port) => new Promise((resolve) => { const s = net.connect({ port, host: '127.0.0.1' }); s.setTimeout(1500); s.on('connect', () => { s.destroy(); resolve(true) }); s.on('error', () => resolve(false)); s.on('timeout', () => { s.destroy(); resolve(false) }) })
async function getJSON (url, ms = 3000) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); try { const r = await fetch(url, { signal: c.signal }); return r.ok ? await r.json() : null } catch (e) { return null } finally { clearTimeout(t) } }
const sh = (cmd, args, ms = 15000) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: ms, stdio: ['ignore', 'pipe', 'pipe'] }).trim() } catch (e) { return null } }

async function checks (cfg) {
  const rows = []
  const add = (name, ok, detail, fix) => rows.push({ name, ok, detail, fix: ok ? '' : (fix || '') })
  add('Node', Number(process.versions.node.split('.')[0]) >= 18, process.version, 'Node 18 이상 필요')
  const chrome = findChrome()
  add('크롬(Playwright 캐시)', !!chrome, chrome || '없음', 'npx playwright install chromium-headless-shell (다운로드라 승인 필요)')
  let pw = null; try { pw = require('playwright-core/package.json').version } catch (e) {}
  add('playwright-core', !!pw, pw || '없음', 'dqa/node_modules가 필요하다(tools/node_modules를 cp -c로 복제)')
  add('rg(원인 찾기)', !!sh('rg', ['--version']), (sh('rg', ['--version']) || '없음').split('\n')[0], 'brew install ripgrep')
  const o = cfg.ollama
  const tunnel = await portOpen(Number(new URL(o.url).port))
  add('맥미니 터널(Ollama)', tunnel, `${o.url} ${tunnel ? '열림' : '닫힘'}`, 'dqa up')
  if (tunnel) {
    const tags = await getJSON(`${o.url}/api/tags`)
    const has = tags && (tags.models || []).some((m) => m.name === o.model)
    add('판정 모델', !!has, has ? o.model : `${o.model} 없음`, `맥미니에서 ollama 태그 확인`)
    const ps = await getJSON(`${o.url}/api/ps`)
    add('맥미니에 올라간 모델', true, ps ? ((ps.models || []).map((m) => `${m.name} ${(m.size / 1e9).toFixed(1)}GB`).join(', ') || '없음') : '확인 불가')
    const ver = await getJSON(`${o.url}/api/version`)
    add('Ollama 버전', true, ver ? ver.version : '확인 불가')
  }
  const free = sh('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', cfg.mac_mini.ssh, 'memory_pressure | tail -1'], 15000)
  const pct = free && free.match(/(\d+)%/)
  add('맥미니 여유 메모리', !!pct && Number(pct[1]) >= o.min_free_pct, pct ? `${pct[1]}% (LLM 호출 기준 ${o.min_free_pct}%)` : 'SSH 확인 불가', pct ? '다른 모델이나 작업을 먼저 내린다' : 'Tailscale·SSH 연결 확인')
  const gh = sh('gh', ['auth', 'status'])
  add('GitHub(gh) 로그인', gh !== null, gh !== null ? '로그인됨' : '로그인 안 됨 또는 gh 없음', 'gh auth login (PR 모드에만 필요)')
  for (const [name, r] of Object.entries(cfg.repos || {})) {
    const dir = home(r.clone)
    const exists = fs.existsSync(dir)
    let detail = exists ? dir : `${dir} 없음`
    let ok = exists
    if (exists) {
      const remote = sh('git', ['-C', dir, 'remote', 'get-url', 'origin'])
      const alt = fs.existsSync(`${dir}/.git/objects/info/alternates`) ? fs.readFileSync(`${dir}/.git/objects/info/alternates`, 'utf8') : ''
      const bad = (cfg.forbidden_paths || []).some((f) => (remote || '').includes(home(f)) || alt.includes(home(f)))
      ok = !bad; detail = `${dir} (origin ${remote || '?'})${bad ? ' — 사용자 작업본을 가리킨다' : ''}`
    }
    add(`저장소 클론: ${name}`, ok, detail, exists ? '독립 클론을 다시 만든다' : `PR 모드 전에 GitHub에서 클론(승인 필요): gh repo clone ${r.github} ${r.clone}`)
  }
  for (const [name, d] of Object.entries(cfg.dists || {})) add(`빌드: ${name}`, fs.existsSync(home(d.dir) + '/index.html'), home(d.dir), '빌드가 없다')
  const df = sh('df', ['-g', home('~/design-qa-cases')])
  const avail = df && df.split('\n')[1] && Number(df.split('\n')[1].split(/\s+/)[3])
  add('디스크 여유(빌드 캐시)', !avail || avail >= 10, avail ? `${avail}GB` : '확인 불가', '빌드 캐시를 정리한다')
  add('생각 끔 중계기(Dify LLM용 :18435)', await portOpen(18435), (await portOpen(18435)) ? '열림' : '닫힘', 'dqa up')
  add('도구 서버(4주차 Dify용 :8791)', await portOpen(8791), (await portOpen(8791)) ? '열림' : '닫힘(4주차 앱을 쓸 때만 필요)')
  add('dqa 웹 화면(:' + cfg.serve.port + ')', await portOpen(cfg.serve.port), (await portOpen(cfg.serve.port)) ? `http://127.0.0.1:${cfg.serve.port}` : '닫힘(dqa serve)')
  add('실행 기록', true, fs.existsSync(RUNS) ? `${fs.readdirSync(RUNS).length}개 (${RUNS})` : '없음')
  return rows
}

async function doctor (args, cfg) {
  const rows = await checks(cfg)
  if (args.json) { console.log(JSON.stringify(rows, null, 1)); return 0 }
  const w = Math.max(...rows.map((r) => r.name.length))
  for (const r of rows) console.log(`${r.ok ? '정상' : '확인'}  ${r.name.padEnd(w)}  ${r.detail}${r.fix ? `  → ${r.fix}` : ''}`)
  const bad = rows.filter((r) => !r.ok)
  console.log(bad.length ? `\n확인할 것 ${bad.length}개. LLM 없이도 측정·보고서는 동작한다(--llm off).` : '\n모두 정상')
  return 0
}

async function up (args, cfg) {
  const port = Number(new URL(cfg.ollama.url).port)
  let ok = await portOpen(port)
  if (ok) console.log(`터널이 이미 열려 있다(${port})`)
  else {
    const fw = cfg.mac_mini.forwards.flatMap((f) => ['-L', f])
    const r = spawnSync('ssh', ['-fN', '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes', ...fw, cfg.mac_mini.ssh], { encoding: 'utf8', timeout: 30000 })
    ok = await portOpen(port)
    console.log(ok ? `터널을 열었다(${cfg.mac_mini.forwards.join(', ')})` : `터널을 열지 못했다: ${(r.stderr || '').trim() || '원인 불명'}`)
  }
  // Dify LLM 노드가 생각하기를 끄도록 거치는 중계기(모델 이름 끝 -nothink). 이미 떠 있으면 그대로 둔다
  if (await portOpen(18435)) console.log('생각 끔 중계기가 이미 떠 있다(18435)')
  else {
    const child = require('child_process').spawn('python3', [require('path').join(__dirname, 'nothink_proxy.py')], { detached: true, stdio: 'ignore' })
    child.unref()
    await new Promise((r) => setTimeout(r, 800))
    console.log((await portOpen(18435)) ? '생각 끔 중계기를 띄웠다(127.0.0.1:18435 → 18434)' : '생각 끔 중계기를 띄우지 못했다')
  }
  return ok ? 0 : 2
}

module.exports = { doctor, up, checks, portOpen }
