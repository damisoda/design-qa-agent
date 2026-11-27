// Journeys run independently in fresh browser contexts using trusted recipe fixtures.
const path = require('node:path')
const fs = require('node:fs')
const { newContext } = require('../measure/browser')
const { pool, sha1, writeJSON } = require('../core/util')
const { configureContext } = require('./runner')

function observation (expected) {
  if (expected.path) return location.pathname
  const nodes = [...document.querySelectorAll(expected.selector)]
  const visible = el => el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  if (expected.count !== undefined) return nodes.filter(visible).length
  const el = nodes[0]
  if (!el || !visible(el)) return null
  if (expected.disabled !== undefined) return el.disabled
  return (el.innerText || '').trim()
}

async function runJourneys (browser, { origin, recipe, sizes, run, side }) {
  const ordered = [...sizes].sort((a, b) => a[0] - b[0])
  const widths = [...new Map([ordered[0], ordered.at(-1)].filter(Boolean).map(s => [s.slice(0, 2).join('x'), s])).values()]
  const cases = (recipe.journeys || []).flatMap(journey => widths.map(([width, height]) => ({ journey, width, height })))
  return pool(cases, 3, async ({ journey, width, height }) => {
    const size = `${width}x${height}`
    run.event?.('journey', `${side} ${recipe.id} ${size}: ${journey.id} 시작`)
    const stubbed = []
    const ctx = await newContext(browser, { origin, width, height, stubs: [...(journey.stubs || []), ...(recipe._stubs || [])], stubbed })
    const row = { id: journey.id, screen: recipe.id, size, ok: false, checks: [], assertions: [], failed_step: null, error: null }
    try {
      await configureContext(ctx, recipe, origin)
      const page = await ctx.newPage()
      page.setDefaultTimeout(4000)
      let step = 0
      let current
      let lastInput
      try {
        for (const action of journey.steps) {
          current = action
          step++
          if (action.goto) {
            const url = new URL(action.goto, origin)
            if (!action.goto.startsWith('/') || url.origin !== origin) throw Error('journey paths must stay inside the app')
            await page.goto(url.href, { waitUntil: 'domcontentloaded' })
          } else if (action.click) await page.locator(action.click).click()
          else if (action.fill) await page.locator(action.fill).fill(action.value)
          else if (action.check) await page.locator(action.check).check()
          else if (action.reload) await page.reload({ waitUntil: 'domcontentloaded' })
          else if (action.expect) {
            const expected = action.expect
            const assertion = { expected, trigger: lastInput }
            row.assertions.push(assertion)
            if (expected.request) {
              const request = await page.waitForFunction(url => performance.getEntriesByType('resource').some(e => new URL(e.name).pathname === url), expected.request, { timeout: 4000 })
              await request.dispose()
              const called = stubbed.some(s => new URL(s.url).pathname === expected.request)
              assertion.observed = called
              if (!called) throw Error('expected stubbed API request was not recorded')
            } else {
              const until = Date.now() + 4000
              while (true) {
                const value = await page.evaluate(observation, expected)
                assertion.observed = value
                const pass = expected.path ? value === expected.path
                  : expected.count !== undefined ? value === expected.count
                    : expected.disabled !== undefined ? value === expected.disabled
                      : expected.text !== undefined ? value === expected.text : typeof value === 'string' && value.includes(expected.contains)
                if (pass) break
                if (Date.now() >= until) { row.observed = value; throw Error('visible browser state differed from expectation') }
                await page.waitForTimeout(80)
              }
            }
            row.checks.push(action.name || JSON.stringify(expected))
          } else throw Error('unknown journey step')
          if (!action.expect) lastInput = action
        }
        row.ok = true
      } catch (err) {
        row.failed_step = step
        row.step = current
        row.trigger = lastInput
        row.error = `${journey.id} ${size}, step ${step}: ${err.message.slice(0, 420)}`
      }
      const key = sha1(JSON.stringify([recipe.id, journey.id])).slice(0, 12)
      const file = `journeys/${side}/${key}_${size}.json`
      if (!row.ok) {
        const shot = file.replace(/\.json$/, '.png')
        fs.mkdirSync(path.dirname(run.file(shot)), { recursive: true })
        if (await page.screenshot({ path: run.file(shot) }).then(() => true, () => false)) row.shot = shot
      }
      row.stubbed = stubbed.map(s => ({ method: s.method, path: new URL(s.url).pathname }))
      writeJSON(run.file(file), row)
      run.event?.('journey', `${side} ${recipe.id} ${size}: ${journey.id} ${row.ok ? '통과' : '실패'}`)
      return row
    } finally { await ctx.close() }
  })
}

function journeyDefects (rows, recipe) {
  const defects = new Map()
  for (const row of rows.filter(row => !row.ok)) {
    const rule = 'J1'
    const fp = `journey|${row.id}`
    const id = sha1(`${recipe.id}|${fp}`).slice(0, 12)
    const [w, h] = row.size.split('x').map(Number)
    const selector = row.step?.expect?.selector || row.step?.click || row.step?.fill
    const trigger = row.trigger ? `직전 브라우저 동작 ${JSON.stringify(row.trigger)}. ` : ''
    const text = `${row.error}. ${trigger}기대 ${JSON.stringify(row.step)}. 화면 관측 ${JSON.stringify(row.observed ?? null)}.`
    const record = defects.get(id) || {
      id, kind: 'journey', rule, rule_name: '사용자 흐름 실패', severity: '높음', screen: recipe.id,
      screen_title: recipe.title, labels: [row.id], fps: [fp], max_px: 0,
      widths: [], evidence: [], journey: { id: row.id, selector }, elements: selector ? [{ path: selector, label: row.id }] : [], diag: []
    }
    record.widths.push({ w, h, px: 0, text, shot: row.shot })
    record.evidence.push({ id: 'J' + record.widths.length, text, shot: row.shot })
    defects.set(id, record)
  }
  return [...defects.values()]
}

function relatedJourneyEvidence (defect, rows) {
  const selector = defect.journey?.selector
  if (!selector) return []
  const evidence = new Map()
  for (const row of rows.filter(r => r.screen === defect.screen)) {
    const assertion = (row.assertions || []).find(a => a.expected.selector === selector)
    if (!assertion || evidence.has(row.id)) continue
    evidence.set(row.id, { scenario: row.id, request: row.stubbed, ...assertion })
  }
  return [...evidence.values()].slice(0, 8)
}

function journeyRegressions (before = [], after = [], final = false) {
  const errors = []
  const key = j => `${j.screen}|${j.id}|${j.size}`
  for (const b of before) {
    const a = after.find(x => key(x) === key(b))
    if (!a) { errors.push(key(b) + ' 사용자 흐름 검사 누락'); continue }
    if (!a.ok && (final || b.ok || !a.failed_step || !b.failed_step || a.failed_step < b.failed_step)) errors.push(a.error || key(a) + ' 사용자 흐름 실패')
  }
  for (const a of after) if (!a.ok && !before.some(b => key(b) === key(a))) errors.push(a.error || key(a) + ' 새 사용자 흐름 실패')
  return errors
}
module.exports = { runJourneys, journeyDefects, journeyRegressions, relatedJourneyEvidence }
