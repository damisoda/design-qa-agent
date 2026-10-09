// 한 화면을 여러 크기로 연다: 크기마다 새 컨텍스트 → 레시피로 진입 → 스크롤 단계별 스캔 → 결함 캡처.
const path = require('path')
const fs = require('fs')
const { newContext, settle, fonts } = require('./browser')
const { enterScreen, dumpVisible } = require('../recipes/runner')
const { dqaScan, dqaFindScroller, dqaScrollTo, dqaOutline } = require('./inpage')
const { bandClusters } = require('./cluster')
const { pool, writeJSON } = require('../core/util')

const unionBox = (boxes) => ({ left: Math.min(...boxes.map((b) => b.left)), top: Math.min(...boxes.map((b) => b.top)), right: Math.max(...boxes.map((b) => b.right)), bottom: Math.max(...boxes.map((b) => b.bottom)) })

async function measureOne (browser, { origin, recipe, width, height, side, run, cfg, shots = true }) {
  const blocked = []
  const res = { side, screen: recipe.id, w: width, h: height, ok: false }
  const t0 = Date.now()
  const ctx = await newContext(browser, { origin, width, height, allowHosts: recipe.allow_hosts, blocked })
  const page = await ctx.newPage()
  const consoleErr = []
  page.on('pageerror', (e) => consoleErr.push(String(e.message).slice(0, 200)))
  const tag = `${side}/${recipe.id.replace(/\//g, '_')}_${width}x${height}`
  try {
    const job = (async () => {
      const ent = await enterScreen(page, recipe, { origin, stepMs: cfg.timeouts.step_ms, gotoMs: cfg.timeouts.goto_ms, settleMs: cfg.timeouts.settle_ms })
      res.enter = ent
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
        const out = await page.evaluate(dqaScan, { root: scan.root, ignore: scan.ignore || [], final, first: k === 0 })
        if (k === 0) { res.viewport = out.viewport; res.root = out.root; res.scale = out.scale; res.minified = out.minified; res.page_horizontal_overflow_px = out.page_horizontal_overflow_px }
        res.steps.push({ y: actualY, leaves: out.leaves, issues: out.issues.length })
        // 스크롤 값은 요소 좌표(배율 전)라, 묶기에 쓰는 페이지 좌표는 화면 배율을 곱한다
        const sy = Math.round(actualY * (out.scale || 1))
        for (const it of out.issues) res.issues.push({ ...it, scroll_y: sy, step: k })
        for (const l of out.lines) if (!res.lines.find((x) => x.fp === l.fp)) res.lines.push(l)
        // 비교 보기용 원본 캡처: 첫 단계와 결함이 있는 단계는 윤곽선 없이 찍는다(변경 전·후를 나란히·겹쳐·차이만 보기)
        let clean = null
        if (shots && (k === 0 || out.issues.length)) {
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
            const clip = { x: Math.max(0, u.left - pad), y: Math.max(0, u.top - pad) }
            clip.width = Math.max(10, Math.min(width, u.right + pad) - clip.x); clip.height = Math.max(10, Math.min(height, u.bottom + pad) - clip.y)
            const crop = path.join('crops', `${tag}_s${k}_${c.key}.png`)
            fs.mkdirSync(path.dirname(run.file(crop)), { recursive: true })
            await page.screenshot({ path: run.file(crop), clip })
            for (const it of c.items) { const orig = res.issues.find((x) => x.step === k && x.rule === it.rule && x.el.fp === it.el.fp && x.metric === it.metric); if (orig) { orig.crop = crop; orig.shot = full; orig.clean = clean } }
          }
          await page.evaluate(dqaOutline, [])
        }
      }
      res.ok = true
    })()
    await Promise.race([job, new Promise((resolve, reject) => setTimeout(() => reject(new Error(`시간 초과(${cfg.timeouts.width_ms / 1000}초)`)), cfg.timeouts.width_ms))])
  } catch (e) {
    res.error = String(e.message).split('\n')[0]
    res.visible = await dumpVisible(page)
    try { const f = path.join('shots', `${tag}_fail.png`); fs.mkdirSync(path.dirname(run.file(f)), { recursive: true }); await page.screenshot({ path: run.file(f) }); res.fail_shot = f } catch (e2) {}
  } finally {
    res.blocked = blocked; res.page_errors = consoleErr; res.ms = Date.now() - t0
    await ctx.close().catch(() => {}) // 시간 초과여도 컨텍스트를 닫아 작업을 멈춘다
  }
  writeJSON(run.file(path.join('measure', `${tag}.json`)), res)
  return res
}

async function sweep (browser, { origin, recipe, sizes, side, run, cfg }) {
  run.event('measure', `${side} ${recipe.id}: 크기 ${sizes.length}개 측정 시작`)
  const results = await pool(sizes, cfg.concurrency || 3, async ([w, h]) => {
    const r = await measureOne(browser, { origin, recipe, width: w, height: h, side, run, cfg })
    run.event('measure', `${side} ${recipe.id} ${w}x${h}: ${r.ok ? `이슈 ${r.issues.length}건, 스크롤 ${r.scroll.steps}단계, ${(r.ms / 1000).toFixed(1)}초` : `실패 — ${r.error}`}`)
    return r
  })
  return results
}

module.exports = { sweep, measureOne }
