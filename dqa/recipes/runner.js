// 화면 진입 레시피 실행기. 레시피는 recipes/<id>.json이다(예: cbh/report).
// 단계 문법은 tools/explore.js와 호환된다: "글자"는 그 글자를 누르고, "type:선택자::값"은 입력한다.
// 클릭 대상은 항상 "보이고 맨 위에 있는" 요소만 고른다(뒤에 깔린 스택 화면을 누르지 않기 위해).
const fs = require('fs')
const path = require('path')
const { readJSON } = require('../core/util')
const { settle } = require('../measure/browser')
const { dqaIsTop } = require('../measure/inpage')

const DIR = __dirname

function loadRecipe (id) {
  const auto = /^auto\/[a-f0-9]{16}$/.test(id)
  const f = auto ? path.join(process.env.DQA_SCREEN_STATE_DIR || path.join(require('../core/util').STATE, 'screen-recipes'), id.slice(5) + '.json') : path.join(DIR, `${id}.json`)
  if (!/^[\w-]+(\/[\w-]+)*$/.test(id) || !fs.existsSync(f)) throw new Error(`레시피가 없다: ${id}`)
  const r = readJSON(f)
  r._file = f
  r._fixtures = r.fixtures ? readJSON(path.resolve(path.dirname(f), r.fixtures), {}) : {}
  // 응답 대역: 배열이거나 레시피 옆 파일 이름({ "stubs": [...] })
  r._stubs = Array.isArray(r.stubs) ? r.stubs : r.stubs ? (readJSON(path.resolve(path.dirname(f), r.stubs), {}).stubs || []) : []
  return r
}

function listRecipes () {
  const out = []
  const walk = (d, pre) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n)
      if (fs.statSync(p).isDirectory()) walk(p, pre + n + '/')
      else if (n.endsWith('.json') && n !== 'schema.json') {
        const r = readJSON(p, {})
        if (r.steps && !r.macro) out.push({ id: pre + n.replace(/\.json$/, ''), title: r.title || '', app: r.app || '', widths: r.widths || null })
      }
    }
  }
  walk(DIR, '')
  const generated = process.env.DQA_SCREEN_STATE_DIR || path.join(require('../core/util').STATE, 'screen-recipes')
  if (fs.existsSync(generated)) for (const n of fs.readdirSync(generated)) {
    if (!/^[a-f0-9]{16}\.json$/.test(n)) continue
    const r = readJSON(path.join(generated, n), {})
    if (r.id === 'auto/' + n.slice(0, -5) && r._project) out.push({id:r.id,title:r.title,app:r.app,widths:r.widths})
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

const subst = (v, fx) => (typeof v === 'string' ? v.replace(/\$fixture\.(\w+)/g, (_, k) => (fx[k] !== undefined ? fx[k] : '')) : v)

function normTarget (t) {
  if (typeof t === 'string') return { text: t }
  return t
}

function locatorFor (page, t) {
  if (t.selector) return page.locator(t.selector)
  if (t.aria) return page.locator(`[aria-label="${String(t.aria).replace(/"/g, '\\"')}"]`)
  if (t.role) return page.getByRole(t.role, t.name ? { name: t.name, exact: !!t.exact } : {})
  if (t.text) return page.getByText(t.text, { exact: !!t.exact })
  throw new Error(`알 수 없는 대상: ${JSON.stringify(t)}`)
}

// 대상 중 보이고 맨 위에 있는 첫 요소. one_of면 차례로 시도한다. 시간 안에 못 찾으면 null.
async function findTop (page, target, timeoutMs, allowOffscreen = false) {
  const t = normTarget(target)
  const alts = t.one_of ? t.one_of.map(normTarget) : [t]
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    for (const a of alts) {
      const loc = locatorFor(page, a)
      const n = Math.min(await loc.count().catch(() => 0), 25)
      for (let i = 0; i < n; i++) {
        const el = loc.nth(i)
        if (!(await el.isVisible().catch(() => false))) continue
        if (await el.evaluate(dqaIsTop, allowOffscreen).catch(() => false)) return el
        // 화면 밖(아래·옆)에 있으면 사람이 스크롤하듯 보이게 한 뒤 다시 본다
        if (!allowOffscreen && await el.evaluate((e) => { const r = e.getBoundingClientRect(); return r.bottom > innerHeight || r.top < 0 || r.right > innerWidth || r.left < 0 }).catch(() => false)) {
          await el.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {})
          if (await el.evaluate(dqaIsTop, false).catch(() => false)) return el
        }
      }
    }
    await page.waitForTimeout(150)
  }
  return null
}

const desc = (t) => { t = normTarget(t); return t.one_of ? t.one_of.map(desc).join(' 또는 ') : (t.text || t.aria || t.selector || `${t.role}:${t.name || ''}`) }

async function runSteps (page, steps, ctx) {
  const stepMs = ctx.stepMs || 8000
  for (let s of steps) {
    if (typeof s === 'string') {
      if (s.startsWith('type:')) { const [sel, val] = s.slice(5).split('::'); s = { fill: { selector: sel }, value: val } } else s = { click: { text: s } }
    }
    ctx.trail.push(s)
    if (s.use) {
      const sub = loadRecipe(s.use)
      await runSteps(page, sub.steps, { ...ctx, fixtures: { ...ctx.fixtures, ...sub._fixtures } })
    } else if (s.wait_text) {
      const el = await findTop(page, { text: s.wait_text, exact: !!s.exact }, s.timeout || stepMs, true)
      if (!el) throw new Error(`글자가 나타나지 않았다: ${s.wait_text}`)
    } else if (s.wait_text_gone) {
      const t0 = Date.now()
      while (Date.now() - t0 < (s.timeout || stepMs)) { if (!(await findTop(page, { text: s.wait_text_gone, exact: true }, 1))) break; await page.waitForTimeout(150) }
    } else if (s.click) {
      const el = await findTop(page, s.click, s.timeout || stepMs)
      if (!el) throw new Error(`누를 대상을 찾지 못했다: ${desc(s.click)}`)
      await el.click({ timeout: stepMs })
      await settle(page, { stableMs: 250, timeoutMs: 3000 })
      if (s.expect_text) { const ok = await findTop(page, { text: s.expect_text }, s.timeout || stepMs, true); if (!ok) throw new Error(`누른 뒤 기대한 글자가 없다: ${s.expect_text}`) }
    } else if (s.fill) {
      const el = await findTop(page, s.fill, s.timeout || stepMs)
      if (!el) throw new Error(`입력칸을 찾지 못했다: ${desc(s.fill)}`)
      await el.fill(String(subst(s.value, ctx.fixtures)), { timeout: stepMs })
    } else if (s.press) {
      await page.keyboard.press(s.press)
      await settle(page, { stableMs: 200, timeoutMs: 2000 })
    } else if (s.goto) {
      await page.goto(ctx.origin + s.goto, { waitUntil: 'domcontentloaded', timeout: ctx.gotoMs || 30000 })
      await settle(page, { stableMs: 300, timeoutMs: 4000 })
    } else if (s.if_visible) {
      const el = await findTop(page, s.if_visible, s.timeout || 1500)
      await runSteps(page, el ? (s.then || []) : (s.else || []), ctx)
    } else if (s.sleep) {
      await page.waitForTimeout(Math.min(Number(s.sleep) || 0, 5000))
    } else {
      throw new Error(`알 수 없는 단계: ${JSON.stringify(s)}`)
    }
  }
}

// Trusted recipe fixture: supply a reproducible GPS position without editing app code.
async function configureContext (ctx, recipe, origin) {
  const geo = recipe.geolocation
  if (!geo) return
  if (!Number.isFinite(geo.latitude) || Math.abs(geo.latitude) > 90 || !Number.isFinite(geo.longitude) || Math.abs(geo.longitude) > 180) throw new Error('invalid recipe geolocation')
  await ctx.setGeolocation(geo)
  await ctx.grantPermissions(['geolocation'], { origin })
}

// 레시피 처음부터 끝까지: 시작 주소 → 단계 → 준비 조건
async function enterScreen (page, recipe, { origin, stepMs, gotoMs, settleMs }) {
  await configureContext(page.context(), recipe, origin)
  const trail = []
  const start = recipe.start || { path: '/' }
  if (recipe.set_storage) await page.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)) }, recipe.set_storage)
  await page.goto(start.url || origin + (start.path || '/'), { waitUntil: 'domcontentloaded', timeout: gotoMs || 30000 })
  await settle(page, { stableMs: 300, timeoutMs: settleMs || 4000 })
  await runSteps(page, recipe.steps || [], { origin, stepMs, gotoMs, fixtures: recipe._fixtures, trail })
  const ready = recipe.ready || {}
  if (ready.text) { const el = await findTop(page, { text: ready.text }, stepMs || 8000, true); if (!el) throw new Error(`화면 준비 글자가 없다: ${ready.text}`) }
  const st = await settle(page, { stableMs: ready.stable_ms || 300, timeoutMs: settleMs || 4000 })
  return { trail: trail.length, settled: st.settled, settle_ms: st.ms }
}

// 실패했을 때 사람이 고칠 수 있게: 지금 보이는 글자와 입력칸
async function dumpVisible (page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight }
    const texts = [...document.querySelectorAll('div,span,a,button,p,h1,h2,h3,label')].filter((e) => e.children.length === 0 && e.textContent.trim() && vis(e)).map((e) => e.textContent.trim().slice(0, 30))
    const inputs = [...document.querySelectorAll('input,textarea')].filter(vis).map((e) => ({ type: e.type, aria: e.getAttribute('aria-label'), ph: e.placeholder }))
    return { texts: [...new Set(texts)].slice(0, 60), inputs }
  }).catch(() => ({ texts: [], inputs: [] }))
}

module.exports = { loadRecipe, listRecipes, enterScreen, dumpVisible, runSteps, configureContext }
