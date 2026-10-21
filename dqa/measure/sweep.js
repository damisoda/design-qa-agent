// 한 화면을 여러 크기로 연다: 크기마다 새 컨텍스트 → 레시피로 진입 → 스크롤 단계별 스캔 → 결함 캡처.
const path = require('path')
const fs = require('fs')
const { newContext, settle, fonts } = require('./browser')
const { enterScreen, dumpVisible } = require('../recipes/runner')
const { dqaScan, dqaFindScroller, dqaScrollTo, dqaOutline } = require('./inpage')
const { bandClusters } = require('./cluster')
const { pool, writeJSON } = require('../core/util')

const unionBox = (boxes) => ({ left: Math.min(...boxes.map((b) => b.left)), top: Math.min(...boxes.map((b) => b.top)), right: Math.max(...boxes.map((b) => b.right)), bottom: Math.max(...boxes.map((b) => b.bottom)) })

async function measureOne (browser, { origin, recipe, width, height, safe, side, run, cfg, shots = true }) {
  const blocked = []
  const stubbed = []; const writes = []
  const res = { side, screen: recipe.id, w: width, h: height, ok: false }
  const t0 = Date.now()
  const ctx = await newContext(browser, { origin, width, height, allowHosts: recipe.allow_hosts, blocked, stubs: recipe._stubs, stubbed, writes })
  const page = await ctx.newPage()
  // 안전영역(노치·홈 인디케이터) 흉내: env(safe-area-inset-*)를 기기처럼 준다
  if (safe) { const s = await ctx.newCDPSession(page); await s.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: safe[0], bottom: safe[1], left: 0, right: 0 } }); res.safe = { top: safe[0], bottom: safe[1] } }
  let scanContext = null
  const traceName = shots && side !== 'verify' && run.live ? '__dqaInspection' : null
  if (traceName) await page.exposeBinding(traceName, (source, payload) => {
    if (source.frame === page.mainFrame() && scanContext) run.live.inspect(scanContext, payload)
  })
  const consoleErr = []
  page.on('pageerror', (e) => consoleErr.push(String(e.message).slice(0, 200)))
  const tag = `${side}/${recipe.id.replace(/\//g, '_')}_${width}x${height}`
  try {
    const job = (async () => {
      const ent = await enterScreen(page, recipe, { origin, stepMs: cfg.timeouts.step_ms, gotoMs: cfg.timeouts.goto_ms, settleMs: cfg.timeouts.settle_ms })
      res.enter = ent
      if (side !== 'verify') run.live?.task(`${side}/${recipe.id}/${width}x${height}`,  { status: 'running', waiting: '글꼴과 화면이 안정되기를 기다리고 있습니다' })
      res.fonts = await fonts(page)
      const scan = recipe.scan || {}
      const sc = scan.scroll === 'none' ? { kind: 'none', max: 0 } : await page.evaluate(dqaFindScroller, scan.root || null)
      const stepPx = Math.max(100, Math.round((sc.clientHeight || height) * cfg.scroll.step_ratio))
      const ys = [0]
      while (ys[ys.length - 1] < sc.max && ys.length < cfg.scroll.max_steps) ys.push(Math.min(sc.max, ys[ys.length - 1] + stepPx))
      res.scroll = { kind: sc.kind, max: sc.max || 0, steps: ys.length, truncated: ys[ys.length - 1] < (sc.max || 0) }
      res.issues = []; res.lines = []; res.steps = []
      for (let k = 0; k < ys.length; k++) {
        const y = ys[k]
        const actualY = k === 0 ? 0 : await page.evaluate(dqaScrollTo, y)
        if (k > 0) await settle(page, { stableMs: 150, timeoutMs: 1500 })
        const final = k === ys.length - 1
        let scanShot = null
        if (traceName) {
          scanShot = path.join('shots', `${tag}_s${k}_scan.png`)
          fs.mkdirSync(path.dirname(run.file(scanShot)), { recursive: true })
          await page.screenshot({ path: run.file(scanShot) })
          scanContext = { phase: 'measure', side, screen: recipe.id, title: recipe.title, size: `${width}x${height}`, width, height, scroll_step: k + 1, scroll_y: actualY, shot: scanShot }
          run.live.preview({ ...scanContext, label: '실제 요소 검사 화면' })
        }
        const out = await page.evaluate(dqaScan, { root: scan.root, ignore: scan.ignore || [], final, first: k === 0, trace: traceName })
        if (k === 0) { res.content = out.content; res.viewport = out.viewport; res.root = out.root; res.scale = out.scale; res.minified = out.minified; res.page_horizontal_overflow_px = out.page_horizontal_overflow_px }
        if (side !== 'verify') run.live?.task(`${side}/${recipe.id}/${width}x${height}`,  { waiting: '요소 상자와 스타일을 측정했습니다', elements: out.leaves, scroll_step: k + 1 })
        const targets = cfg.repair_targets?.[recipe.id] ? await page.evaluate(items => Object.fromEntries(items.map(item => {
          let el; try { el = document.querySelector(item.selector) } catch (e) {}
          if (!el) return [item.id, null]
          const b = el.getBoundingClientRect()
          const ancestors = []; let parent = el.parentElement
          for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
            const style = getComputedStyle(parent)
            ancestors.push({ cls: [...parent.classList], rowGap: style.rowGap, columnGap: style.columnGap })
          }
          return [item.id, { left: b.left, top: b.top, width: b.width, height: b.height, ancestors }]
        })), cfg.repair_targets[recipe.id]) : undefined
        res.steps.push({ y: actualY, leaves: out.leaves, issues: out.issues.length, targets })
        // 스크롤 값은 요소 좌표(배율 전)라, 묶기에 쓰는 페이지 좌표는 화면 배율을 곱한다
        const sy = Math.round(actualY * (out.scale || 1))
        for (const it of out.issues) res.issues.push({ ...it, scroll_y: sy, step: k })
        for (const l of out.lines) if (!res.lines.find((x) => x.fp === l.fp)) res.lines.push(l)
        // 비교 보기용 원본 캡처: 첫 단계와 결함이 있는 단계는 윤곽선 없이 찍는다(변경 전·후를 나란히·겹쳐·차이만 보기)
        let clean = null
        if (shots && (k === 0 || out.issues.length || side.startsWith('fix'))) {
          clean = path.join('shots', `${tag}_s${k}.png`)
          fs.mkdirSync(path.dirname(run.file(clean)), { recursive: true })
          await page.screenshot({ path: run.file(clean) })
          res.steps[res.steps.length - 1].shot = clean
        }
        // 결함이 있는 단계는 윤곽선을 그려 한 번 더 찍는다(전체 화면 + 묶음별 조각)
        if (shots && out.issues.length) {
          const boxes = out.issues.flatMap((it) => [it.el.box, ...(it.other && it.other.box ? [{ ...it.other.box, dashed: true }] : [])])
          await page.evaluate(dqaOutline, boxes)
          const full = path.join('shots', `${tag}_s${k}_marked.png`)
          await page.screenshot({ path: run.file(full) })
          res.steps[res.steps.length - 1].marked = full
          for (const c of bandClusters(out.issues.map((it) => ({ ...it, scroll_y: sy })))) {
            await page.evaluate(dqaOutline, c.items.flatMap((it) => [it.el.box, ...(it.other && it.other.box ? [{ ...it.other.box, dashed: true }] : [])]))
            const u = unionBox(c.items.flatMap((it) => [it.el.box, ...(it.other && it.other.box ? [it.other.box] : [])]))
            const pad = 24
            // 자를 영역은 화면 안으로 제한한다(내용이 넘쳐 레이아웃 폭이 늘어나면 상자가 화면 밖에 있을 수 있다)
            const x0 = Math.min(Math.max(0, u.left - pad), width - 10); const y0 = Math.min(Math.max(0, u.top - pad), height - 10)
            const clip = { x: x0, y: y0, width: Math.max(10, Math.min(width, u.right + pad) - x0), height: Math.max(10, Math.min(height, u.bottom + pad) - y0) }
            let crop = path.join('crops', `${tag}_s${k}_${c.key}.png`)
            fs.mkdirSync(path.dirname(run.file(crop)), { recursive: true })
            try { await page.screenshot({ path: run.file(crop), clip }) } catch (e) { crop = null } // 조각을 못 찍어도 측정은 살린다
            for (const it of c.items) { const orig = res.issues.find((x) => x.step === k && x.rule === it.rule && x.el.fp === it.el.fp && x.metric === it.metric); if (orig) { orig.crop = crop; orig.shot = full; orig.clean = clean } }
          }
          await page.evaluate(dqaOutline, [])
        }
        if (clean) run.live?.preview({ phase: 'measure', side, screen: recipe.id, title: recipe.title, size: `${width}x${height}`, shot: res.steps.at(-1).marked || clean, label: '요소 상자·스타일 측정 캡처', elements: out.leaves, scroll_step: k + 1 })
      }
      scanContext = null
      res.ok = true
    })()
    let timer
    try { await Promise.race([job, new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error(`시간 초과(${cfg.timeouts.width_ms / 1000}초)`)), cfg.timeouts.width_ms) })]) } finally { clearTimeout(timer) }
  } catch (e) {
    res.error = String(e.message).split('\n')[0]
    res.visible = await dumpVisible(page)
    try { const f = path.join('shots', `${tag}_fail.png`); fs.mkdirSync(path.dirname(run.file(f)), { recursive: true }); await page.screenshot({ path: run.file(f) }); res.fail_shot = f } catch (e2) {}
  } finally {
    res.blocked = blocked; res.stubbed = stubbed; res.writes = writes; res.page_errors = consoleErr; res.ms = Date.now() - t0
    await ctx.close().catch(() => {}) // 시간 초과여도 컨텍스트를 닫아 작업을 멈춘다
  }
  writeJSON(run.file(path.join('measure', `${tag}.json`)), res)
  return res
}

async function sweep (browser, { origin, recipe, sizes, side, run, cfg }) {
  run.event('measure', `${side} ${recipe.id}: 크기 ${sizes.length}개 측정 시작`)
  const results = await pool(sizes, cfg.concurrency || 3, async ([w, h, st, sb]) => {
    const key = `${side}/${recipe.id}/${w}x${h}`
    run.live?.task(key, { status: 'running', waiting: '화면을 열고 있습니다' })
    const r = await measureOne(browser, { origin, recipe, width: w, height: h, safe: st !== undefined ? [st, sb || 0] : null, side, run, cfg })
    run.live?.task(key, { status: r.ok ? 'done' : 'failed', waiting: r.ok ? '측정 완료' : r.error, issues: r.ok ? r.issues.length : null })
    if (run.onMeasured) run.onMeasured(r)
    run.event('measure', `${side} ${recipe.id} ${w}x${h}: ${r.ok ? `이슈 ${r.issues.length}건, 스크롤 ${r.scroll.steps}단계, ${(r.ms / 1000).toFixed(1)}초` : `실패 — ${r.error}`}`)
    return r
  })
  return results
}

module.exports = { sweep, measureOne }
