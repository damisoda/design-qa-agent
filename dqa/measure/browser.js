// 브라우저 실행과 측정용 컨텍스트. 앱 출처(와 레시피가 명시한 호스트) 밖 요청은 막고 기록한다.
const { chromium } = require('playwright-core')
const { findChrome } = require('../core/util')
const { dqaLayoutSig, dqaFonts } = require('./inpage')

async function launch () {
  const exe = findChrome()
  if (!exe) throw new Error('Playwright 크롬을 찾지 못했다(~/Library/Caches/ms-playwright). DQA_CHROME으로 경로를 줄 수 있다')
  return chromium.launch({ executablePath: exe })
}

// 응답 대역(stub): 백엔드 없이 화면을 띄우려고 레시피가 정한 API 응답을 브라우저 안에서 돌려준다(네트워크로 나가지 않는다).
// 경로(pathname)가 path로 끝나거나 re에 맞으면 쓴다. json 안의 "$body.키|기본값"은 요청 본문 값으로 바꾼다.
function stubFor (stubs, req) {
  if (!stubs || !stubs.length) return null
  let p; try { p = new URL(req.url()).pathname } catch (e) { return null }
  // 교차 출처 사전 요청(OPTIONS)은 방법과 상관없이 같은 경로의 대역이 받는다
  const pre = req.method() === 'OPTIONS'
  return stubs.find((s) => (pre || !s.method || s.method.toUpperCase() === req.method()) && (s.re ? new RegExp(s.re).test(p) : !!s.path && p.endsWith(s.path))) || null
}
function fillBody (v, body) {
  if (typeof v === 'string') return v.replace(/\$body\.(\w+)(?:\|([^"\s]*))?/g, (_, k, d) => (body && body[k] !== undefined ? body[k] : (d || '')))
  if (Array.isArray(v)) return v.map((x) => fillBody(x, body))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillBody(x, body)]))
  return v
}

async function newContext (browser, { origin, width, height, allowHosts, blocked, stubs, stubbed, writes }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: true, isMobile: true, locale: 'ko-KR' })
  const allow = new Set([origin, ...(allowHosts || []).map((h) => (h.startsWith('http') ? h : `https://${h}`))].map((u) => new URL(u).origin))
  // Freeze wall time only: animations, timeouts and performance.now keep advancing.
  // The same timestamp is used for baseline, candidates and all browser contexts.
  await ctx.addInitScript(({ epoch }) => {
    const NativeDate = Date
    function FixedDate (...args) {
      if (!new.target) return new NativeDate(epoch).toString()
      return Reflect.construct(NativeDate, args.length ? args : [epoch], new.target)
    }
    Object.setPrototypeOf(FixedDate, NativeDate); FixedDate.prototype = NativeDate.prototype
    FixedDate.now = () => epoch
    globalThis.Date = FixedDate
  }, { epoch: Date.parse('2026-01-01T00:41:00.000Z') })
  await ctx.route('**/*', (route) => {
    const req = route.request()
    const url = req.url()
    const st = stubFor(stubs, req)
    if (st) {
      // 앱이 다른 출처(옛 커밋의 절대 주소 API)를 부를 때도 받도록 CORS 머리글을 붙인다
      const cors = { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': req.headers()['access-control-request-headers'] || 'content-type,authorization' }
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' })
      let body = {}; try { body = JSON.parse(req.postData() || '{}') } catch (e) {}
      if (stubbed) stubbed.push({ method: req.method(), url: url.slice(0, 200), stub: st.path || st.re })
      return route.fulfill({ status: st.status || 200, headers: cors, contentType: 'application/json', body: JSON.stringify(fillBody(st.json === undefined ? {} : st.json, body)) })
    }
    // 모든 검사 단계에서 쓰기 요청은 대역으로만 처리한다(팝업에도 같은 컨텍스트 규칙이 적용된다).
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      if (writes) writes.push({ method: req.method(), url: url.slice(0, 200) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    }
    let requestOrigin; try { requestOrigin = new URL(url).origin } catch (e) {}
    if (url.startsWith('data:') || url.startsWith('blob:') || allow.has(requestOrigin)) return route.continue()
    if (blocked) blocked.push({ url: url.slice(0, 200), type: route.request().resourceType() })
    return route.abort()
  })
  // WebSocket은 HTTP route를 거치지 않는다. 읽기와 쓰기를 구분할 수 없어 검사 중 모두 막는다.
  await ctx.routeWebSocket('**/*', (socket) => {
    if (blocked) blocked.push({ url: socket.url().slice(0, 200), type: 'websocket' })
    socket.close()
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

module.exports = { launch, newContext, settle, fonts, fillBody, stubFor }
