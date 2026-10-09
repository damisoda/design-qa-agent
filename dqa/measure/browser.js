// 브라우저 실행과 측정용 컨텍스트. 앱 출처(와 레시피가 명시한 호스트) 밖 요청은 막고 기록한다.
const { chromium } = require('playwright-core')
const { findChrome } = require('../core/util')
const { dqaLayoutSig, dqaFonts } = require('./inpage')

async function launch () {
  const exe = findChrome()
  if (!exe) throw new Error('Playwright 크롬을 찾지 못했다(~/Library/Caches/ms-playwright). DQA_CHROME으로 경로를 줄 수 있다')
  return chromium.launch({ executablePath: exe })
}

async function newContext (browser, { origin, width, height, allowHosts, blocked }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: true, isMobile: true, locale: 'ko-KR' })
  const allow = [origin, ...(allowHosts || []).map((h) => (h.startsWith('http') ? h : `https://${h}`))]
  await ctx.route('**/*', (route) => {
    const url = route.request().url()
    if (url.startsWith('data:') || url.startsWith('blob:') || allow.some((a) => url.startsWith(a))) return route.continue()
    if (blocked) blocked.push({ url: url.slice(0, 200), type: route.request().resourceType() })
    return route.abort()
  })
  return ctx
}

// 고정 대기 대신: 네트워크 한산 → 글꼴 준비 → 배치가 stable_ms 동안 그대로일 때까지
async function settle (page, { stableMs = 300, timeoutMs = 4000 } = {}) {
  try { await page.waitForLoadState('networkidle', { timeout: Math.min(5000, timeoutMs) }) } catch (e) {}
  try { await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)) } catch (e) {}
  const t0 = Date.now(); let last = null; let since = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    let sig
    try { sig = await page.evaluate(dqaLayoutSig) } catch (e) { sig = null }
    if (sig !== null && sig === last) { if (Date.now() - since >= stableMs) return { settled: true, ms: Date.now() - t0 } } else { last = sig; since = Date.now() }
    await page.waitForTimeout(100)
  }
  return { settled: false, ms: Date.now() - t0 }
}

const fonts = (page) => page.evaluate(dqaFonts).catch(() => ({ status: 'unknown', loaded: [] }))

module.exports = { launch, newContext, settle, fonts }
