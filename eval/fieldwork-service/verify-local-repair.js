// Independent checks for a verified local repair, using fresh prices and browser actions.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { RUNS, readJSON, writeJSON, sha1 } = require('../../dqa/core/util')
const { serveDist } = require('../../dqa/targets/static')
const { launch, newContext } = require('../../dqa/measure/browser')
const { assertVerifiedCombined } = require('../../dqa/fix/validation')
const { sourceDigest } = require('../../dqa/fix/performance')
const { validRunId } = require('../../dqa/workflow/local-repair')

async function verify (id) {
  if (!validRunId(id)) throw Error('Pass the locally verified repair run ID')
  const run = path.join(RUNS, id)
  const manifest = readJSON(path.join(run, 'manifest.json'))
  const job = readJSON(path.join(run, 'local-repair.json'))
  assert.equal(job.state, 'verified')
  const { combined } = readJSON(path.join(run, 'fix/fixes.json'))
  assertVerifiedCombined(combined)
  const source = manifest.targets.head.src
  const original = manifest.local.project
  const baseline = sourceDigest(source)
  assert.ok(baseline)
  assert.equal(sourceDigest(original), baseline, 'Original changed after inspection')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-fieldwork-replay-'))
  const candidate = path.join(temp, 'candidate')
  let site
  let browser
  try {
    fs.cpSync(source, candidate, { recursive: true })
    for (const [rel, digest] of Object.entries(combined.before_sha1)) {
      const file = path.resolve(candidate, rel)
      assert.ok(file.startsWith(candidate + path.sep))
      assert.equal(sha1(fs.readFileSync(file, 'utf8')), digest)
      fs.copyFileSync(path.join(run, 'fix/source', rel), file)
    }
    site = await serveDist(candidate)
    browser = await launch()
    const results = []
    for (const [width, height] of [[320, 700], [768, 900], [1024, 900]]) {
      for (const price of [49170, 86240]) {
        const stubbed = []
        const ctx = await newContext(browser, {
          origin: site.origin, width, height, stubbed,
          stubs: [{ path: '/api/visit-price', method: 'GET', json: { price } }]
        })
        try {
          const page = await ctx.newPage()
          page.setDefaultTimeout(4000)
          await page.goto(site.origin + '/index.html')
          await page.locator('[data-action="filter:Nature"]').click()
          await page.getByText('1 experiences', { exact: true }).waitFor()
          await page.locator('#search').fill('xyz123')
          await page.getByText(/No experiences match/).waitFor()
          await page.locator('#search').clear()
          await page.locator('[data-action="filter:All"]').click()
          await page.getByText('4 experiences', { exact: true }).waitFor()
          await page.locator('[data-action="product.html?item=coffee"]').click()
          await page.waitForURL('**/product.html?item=coffee')
          const formatted = 'KRW ' + price.toLocaleString('en-US') + ' / guest'
          await page.getByText(formatted, { exact: true }).waitFor()
          assert.ok(stubbed.some(row => new URL(row.url).searchParams.get('item') === 'coffee'))
          const title = await page.locator('.product-title').evaluate(el => ({
            text: el.textContent, font: getComputedStyle(el).fontSize,
            width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth
          }))
          assert.match(title.text, /coffee tasting/)
          assert.equal(title.font, '26px')
          assert.equal(title.width, title.scrollWidth, 'Horizontal overflow')
          const shot = width === 768 ? `fix/price-${price}.png` : null
          if (shot) await page.locator('.booking-action').screenshot({ path: path.join(run, shot), animations: 'disabled' })
          results.push({ width, height, price, title, ok: true, shot })
        } finally { await ctx.close() }
      }
    }
    assert.equal(sourceDigest(original), baseline)
    const preview = path.join(run, 'fix', 'verified-preview')
    if (!fs.existsSync(preview)) {
      const staged = fs.mkdtempSync(path.join(run, 'fix', '.preview-'))
      try {
        fs.cpSync(candidate, staged, { recursive: true })
        fs.renameSync(staged, preview)
      } finally { fs.rmSync(staged, { recursive: true, force: true }) }
    }
    const report = { run_id: id, cases: results.length, passed: results.length, original_sha256: baseline, preview: 'fix/verified-preview', results }
    writeJSON(path.join(run, 'fix/holdout.json'), report)
    console.log(JSON.stringify(report, null, 2))
  } finally {
    if (browser) await browser.close()
    site?.close()
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

verify(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1 })
