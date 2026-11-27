// 아이폰 사파리 측정: iOS 시뮬레이터의 실제 사파리를 Appium(WebDriver)으로 조작해, 크롬과 같은 레시피로 화면에 들어가
// 같은 화면 안 측정(dqaScan)을 돌리고, 폰에서만 생기는 결함 세 가지를 더 잰다.
//   K1 키보드 가림: 입력칸을 실제로 눌러(네이티브 탭) 키보드를 띄운 뒤, 그 칸이 보이는 영역(visualViewport) 밖이면 결함
//   S1 안전영역 침범: 화면 아래 고정 요소의 글자·버튼이 하단 안전영역(env(safe-area-inset-bottom)) 안에 들어가면 결함
//   G2 글리프 없음: 1~2글자 기호가 이 기기 글꼴에 없어 빈 네모로 그려지면 결함(없는 글자와 픽셀이 같은지 캔버스로 비교)
// Appium 서버(기본 http://127.0.0.1:4723)와 부팅 가능한 시뮬레이터가 필요하다. 네트워크 대역(stub)은 사파리에서 걸 수 없다.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { loadRecipe } = require('../recipes/runner')
const { dqaScan } = require('./inpage')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const EL = 'element-6066-11e4-a52e-4f735466cecf'

async function wd (base, method, p, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`WebDriver ${method} ${p} ${r.status}: ${JSON.stringify(j.value && (j.value.message || j.value)).slice(0, 300)}`)
  return j.value
}

function udidOf (device) {
  const out = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' }))
  for (const list of Object.values(out.devices)) for (const d of list) if (d.name === device) return d.udid
  throw new Error(`시뮬레이터를 찾지 못했다: ${device}`)
}

class IOSPage {
  constructor (server, device) { this.server = server || 'http://127.0.0.1:4723'; this.device = device || 'iPhone 17 Pro' }
  async open () {
    // 이전 실행의 탭·확대 상태가 남지 않게 사파리를 끄고 시작한다
    try { execFileSync('xcrun', ['simctl', 'terminate', udidOf(this.device), 'com.apple.mobilesafari'], { stdio: 'ignore' }) } catch (e) {}
    const caps = { platformName: 'iOS', browserName: 'Safari', 'appium:automationName': 'XCUITest', 'appium:deviceName': this.device, 'appium:udid': udidOf(this.device),
      'appium:nativeWebTap': false, 'appium:newCommandTimeout': 600, 'appium:autoDismissAlerts': true, 'appium:showSafariConsoleLog': true, 'appium:noReset': true, 'appium:safariIgnoreFraudWarning': true }
    const v = await wd(this.server, 'POST', '/session', { capabilities: { alwaysMatch: caps } })
    this.sid = v.sessionId; this.base = `${this.server}/session/${this.sid}`
    return this
  }
  async close () { if (this.sid) await wd(this.server, 'DELETE', `/session/${this.sid}`).catch(() => {}); this.sid = null }
  goto (url) { return wd(this.base, 'POST', '/url', { url }) }
  url () { return wd(this.base, 'GET', '/url') }
  // 함수를 문자열로 넘겨 페이지 안에서 실행한다(Playwright evaluate와 같은 약속: 함수 하나 + 인자 하나)
  evaluate (fn, arg) { return wd(this.base, 'POST', '/execute/sync', { script: `return (${fn.toString()})(arguments[0])`, args: [arg === undefined ? null : arg] }) }
  async evaluateAsync (fn, arg) {
    const v = await wd(this.base, 'POST', '/execute/async', { script: `const done = arguments[arguments.length - 1]; Promise.resolve((${fn.toString()})(arguments[0])).then(done, (e) => done({ __dqa_error: String(e && e.stack || e) }))`, args: [arg === undefined ? null : arg] })
    if (v && v.__dqa_error) throw new Error(v.__dqa_error.slice(0, 300))
    return v
  }
  async screenshot (file) { const b64 = await wd(this.base, 'GET', '/screenshot'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(b64, 'base64')) }
  // 실제 손가락 탭: 요소 중심(페이지 좌표)을 웹뷰의 화면 위치로 바꿔 네이티브로 누른다(키보드가 실제로 올라온다).
  // 사파리 도구 막대가 스크롤에 따라 접히므로 누를 때마다 웹뷰 위치를 다시 읽는다
  // 요소의 화면(점 단위) 상자: 보이는 영역 왼쪽 위에 접근성 표지를 잠깐 놓고 네이티브 위치를 읽어 원점을 구한다
  // (iOS 26 사파리는 웹뷰가 상태 막대·도구 막대 밑까지 깔려 있고, 입력칸을 누르면 확대·끌어올림이 남는다)
  async screenBox (el, scroll = true) {
    const c = await wd(this.base, 'POST', '/execute/sync', { script: 'const e = arguments[0]; if (arguments[1]) e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); const v = window.visualViewport || { offsetLeft: 0, offsetTop: 0, width: innerWidth }; const sc = document.documentElement.clientWidth / (v.width || innerWidth); let m = document.getElementById("dqa-calib"); if (!m) { m = document.createElement("div"); m.id = "dqa-calib"; m.setAttribute("role", "button"); m.setAttribute("aria-label", "dqa-calib"); document.body.appendChild(m) } m.style.cssText = "position:fixed;left:" + v.offsetLeft + "px;top:" + v.offsetTop + "px;width:20px;height:20px;opacity:0.02;z-index:2147483647;pointer-events:none;background:#000"; return { l: (r.left - v.offsetLeft) * sc, t: (r.top - v.offsetTop) * sc, r: (r.right - v.offsetLeft) * sc, b: (r.bottom - v.offsetTop) * sc, zoom: sc }', args: [el, scroll] })
    const ctxs = await wd(this.base, 'GET', '/contexts'); const web = ctxs.find((x) => String(x.id || x).startsWith('WEBVIEW')); const webId = web && (web.id || web)
    await wd(this.base, 'POST', '/context', { name: 'NATIVE_APP' })
    try {
      let ox = 0; let oy = 0; let marker = false
      const m = await wd(this.base, 'POST', '/element', { using: 'accessibility id', value: 'dqa-calib' }).catch(() => null)
      if (m) { const mr = await wd(this.base, 'GET', `/element/${m[EL]}/rect`); ox = mr.x; oy = mr.y; marker = true }
      else { const wv = await wd(this.base, 'POST', '/element', { using: 'class name', value: 'XCUIElementTypeWebView' }); const r = await wd(this.base, 'GET', `/element/${wv[EL]}/rect`); ox = r.x; oy = r.y }
      const kb = await wd(this.base, 'POST', '/element', { using: 'class name', value: 'XCUIElementTypeKeyboard' }).catch(() => null)
      const kr = kb ? await wd(this.base, 'GET', `/element/${kb[EL]}/rect`).catch(() => null) : null
      return { left: ox + c.l, top: oy + c.t, right: ox + c.r, bottom: oy + c.b, zoom: c.zoom, marker, keyboard: kr && kr.height > 0 ? { top: kr.y, height: kr.height } : null }
    } finally {
      if (webId) await wd(this.base, 'POST', '/context', { name: webId })
      await wd(this.base, 'POST', '/execute/sync', { script: "const m = document.getElementById('dqa-calib'); if (m) m.remove(); return true", args: [] }).catch(() => {})
    }
  }
  // 실제 손가락 탭: 화면 상자 가운데를 네이티브로 누른다(키보드가 실제로 올라온다)
  async tap (el) {
    const b = await this.screenBox(el, true)
    this.lastCalib = { x: Math.round((b.left + b.right) / 2), y: Math.round((b.top + b.bottom) / 2), marker: b.marker, zoom: b.zoom }
    const ctxs = await wd(this.base, 'GET', '/contexts'); const web = ctxs.find((x) => String(x.id || x).startsWith('WEBVIEW')); const webId = web && (web.id || web)
    await wd(this.base, 'POST', '/context', { name: 'NATIVE_APP' })
    try { await wd(this.base, 'POST', '/execute/sync', { script: 'mobile: tap', args: [{ x: this.lastCalib.x, y: this.lastCalib.y }] }) } finally { if (webId) await wd(this.base, 'POST', '/context', { name: webId }) }
  }
  // 지금 키보드 초점을 가진 입력칸과 키보드의 화면 위치를 iOS 접근성 정보에서 직접 읽는다(페이지 좌표 계산 없이)
  async nativeFocus (label) {
    const ctxs = await wd(this.base, 'GET', '/contexts'); const web = ctxs.find((x) => String(x.id || x).startsWith('WEBVIEW')); const webId = web && (web.id || web)
    await wd(this.base, 'POST', '/context', { name: 'NATIVE_APP' })
    try {
      const types = "(type == 'XCUIElementTypeTextField' OR type == 'XCUIElementTypeTextView' OR type == 'XCUIElementTypeSecureTextField' OR type == 'XCUIElementTypeSearchField')"
      const q = String(label || '').replace(/'/g, "\\'")
      let f = await wd(this.base, 'POST', '/element', { using: '-ios predicate string', value: `${types} AND hasKeyboardFocus == 1` }).catch(() => null)
      // 초점 속성이 비면 이름(aria-label·안내 글자)으로 찾는다
      if (!f && q) f = await wd(this.base, 'POST', '/element', { using: '-ios predicate string', value: `${types} AND (label == '${q}' OR placeholderValue == '${q}' OR name == '${q}')` }).catch(() => null)
      const fr = f ? await wd(this.base, 'GET', `/element/${f[EL]}/rect`).catch(() => null) : null
      const kb = await wd(this.base, 'POST', '/element', { using: 'class name', value: 'XCUIElementTypeKeyboard' }).catch(() => null)
      const kr = kb ? await wd(this.base, 'GET', `/element/${kb[EL]}/rect`).catch(() => null) : null
      // 사파리 입력 보조 막대(위·아래·완료)는 키보드 바로 위에 붙어 있어 같이 가린다
      const bars = await wd(this.base, 'POST', '/elements', { using: '-ios predicate string', value: "type == 'XCUIElementTypeToolbar' OR (type == 'XCUIElementTypeButton' AND (label == '완료' OR label == 'Done'))" }).catch(() => [])
      let barTop = null
      for (const b of bars.slice(0, 6)) { const r = await wd(this.base, 'GET', `/element/${b[EL]}/rect`).catch(() => null); if (r && kr && r.y < kr.y && r.y > kr.y - 90) barTop = Math.min(barTop ?? r.y, r.y) }
      const win = await wd(this.base, 'GET', '/window/rect').catch(() => null)
      return { field: fr, keyboard: kr && kr.height > 0 ? kr : null, bar_top: barTop, screen_h: win && win.height }
    } finally { if (webId) await wd(this.base, 'POST', '/context', { name: webId }) }
  }
  type (el, text) { return wd(this.base, 'POST', `/element/${el[EL]}/value`, { text: String(text) }) }
  // 사파리·시스템 팝업(암호 저장, 사용 팁 말풍선 등)을 닫는다. 페이지 밖이라 네이티브 화면에서 찾는다
  async dismissNative () {
    // 시스템 알림(위치 권한 등)은 사파리 화면 밖이라 경고창 명령으로 닫는다
    let sys = 0
    for (let i = 0; i < 2; i++) { try { await wd(this.base, 'POST', '/alert/dismiss', {}); sys++; await sleep(400) } catch (e) { break } }
    const ctxs = await wd(this.base, 'GET', '/contexts'); const web = ctxs.find((x) => String(x.id || x).startsWith('WEBVIEW')); const webId = web && (web.id || web)
    await wd(this.base, 'POST', '/context', { name: 'NATIVE_APP' })
    let n = 0
    try {
      const els = await wd(this.base, 'POST', '/elements', { using: '-ios predicate string', value: "type == 'XCUIElementTypeButton' AND label IN {'지금 안 함', 'Not Now', '닫기', 'Close', '허용 안 함', \"Don't Allow\"}" }).catch(() => [])
      for (const e of els.slice(0, 3)) { await wd(this.base, 'POST', `/element/${e[EL]}/click`, {}).catch(() => {}); n++; await sleep(500) }
    } finally { if (webId) await wd(this.base, 'POST', '/context', { name: webId }) }
    return n + sys
  }
  async zoomNow () { return this.evaluate(() => { const v = window.visualViewport; return v ? Math.round(document.documentElement.clientWidth / v.width * 1000) / 1000 : 1 }) }
  // 확대 되돌리기: 뷰포트 설정에 잠깐 maximum-scale=1을 붙였다 원래대로 돌린다(사파리가 배율을 1로 되돌린다). 앱 코드는 바꾸지 않는다
  async unzoom () {
    if ((await this.zoomNow()) <= 1.01) return 1
    await this.evaluate(() => { let m = document.querySelector('meta[name=viewport]'); if (!m) { m = document.createElement('meta'); m.name = 'viewport'; m.content = 'width=device-width'; document.head.appendChild(m) } m.dataset.dqaOrig = m.content; m.content = m.content + ', maximum-scale=1' })
    await sleep(500)
    await this.evaluate(() => { const m = document.querySelector('meta[name=viewport]'); if (m && m.dataset.dqaOrig !== undefined) { m.content = m.dataset.dqaOrig; delete m.dataset.dqaOrig } ; window.scrollTo(0, 0) })
    await sleep(400)
    return this.zoomNow()
  }
  async timeouts () { await wd(this.base, 'POST', '/timeouts', { script: 120000, pageLoad: 60000 }).catch(() => {}) }
}

// 페이지 안: 대상(글자·선택자·aria·역할)에 맞는 보이는 맨 위 요소 하나. Playwright getByText처럼 가장 안쪽 요소를 고른다
function dqaIosFind (t) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  const alts = t.one_of ? t.one_of : [t]
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0 }
  const top = (e) => {
    const r = e.getBoundingClientRect(); const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1); const y = r.top + r.height / 2
    if (y < 0 || y > innerHeight) return t.offscreen ? true : null
    const hit = document.elementFromPoint(x, y); return !!hit && (hit === e || e.contains(hit) || hit.contains(e))
  }
  for (let a of alts) {
    if (typeof a === 'string') a = { text: a }
    let cands = []
    if (a.selector) cands = [...document.querySelectorAll(a.selector)]
    else if (a.aria) cands = [...document.querySelectorAll(`[aria-label="${a.aria}"]`)]
    else if (a.role) cands = [...document.querySelectorAll(a.role === 'button' ? 'button,[role=button]' : `[role=${a.role}]`)].filter((e) => !a.name || (a.exact ? norm(e.innerText) === a.name : norm(e.innerText).includes(a.name) || norm(e.getAttribute('aria-label')).includes(a.name)))
    else if (a.text) {
      const want = norm(a.text)
      cands = [...document.querySelectorAll('body *')].filter((e) => { const s = norm(e.innerText || e.textContent); return a.exact ? s === want : s.includes(want) })
      cands = cands.filter((e) => ![...e.children].some((c) => cands.includes(c))) // 가장 안쪽
    }
    for (const e of cands.slice(0, 40)) {
      if (!vis(e)) continue
      if (t.offscreen) return e // 기다리기·확인용: 화면 어딘가에 그려져 있으면 된다(크롬 레시피의 presence 판정과 같다)
      let ok = top(e)
      if (ok === null) { e.scrollIntoView({ block: 'center' }); ok = top(e) }
      if (ok) return e
    }
  }
  return null
}

async function find (page, target, ms, offscreen) {
  const t0 = Date.now()
  const t = typeof target === 'string' ? { text: target } : target
  while (Date.now() - t0 < ms) {
    const el = await page.evaluate(dqaIosFind, { ...t, offscreen: !!offscreen }).catch(() => null)
    if (el && el[EL]) return el
    await sleep(250)
  }
  return null
}

const subst = (v, fx) => (typeof v === 'string' ? v.replace(/\$fixture\.(\w+)/g, (_, k) => (fx[k] !== undefined ? fx[k] : '')) : v)

async function runSteps (page, steps, ctx) {
  for (let s of steps) {
    if (typeof s === 'string') s = { click: { text: s } }
    const ms = s.timeout || ctx.stepMs
    if (s.use) { const sub = loadRecipe(s.use); await runSteps(page, sub.steps || [], { ...ctx, fixtures: { ...ctx.fixtures, ...sub._fixtures } }) }
    else if (s.wait_text) { if (!(await find(page, { text: s.wait_text, exact: !!s.exact }, ms, true))) throw new Error(`글자가 나타나지 않았다: ${s.wait_text}`) }
    else if (s.wait_text_gone) { const t0 = Date.now(); while (Date.now() - t0 < ms && await find(page, { text: s.wait_text_gone, exact: true }, 1, true)) await sleep(250) }
    else if (s.click) {
      // 눌러도 화면이 그대로면(팝업이 가로챘거나 전환 중) 팝업을 닫고 두 번까지 다시 누른다
      const sig = () => page.evaluate(() => location.href + '|' + document.body.innerText.length).catch(() => '')
      for (let k = 0; k < 3; k++) {
        const el = await find(page, s.click, ms); if (!el) { if (k) break; throw new Error(`누를 대상을 찾지 못했다: ${JSON.stringify(s.click)}`) }
        const before = await sig()
        await page.tap(el)
        let changed = false; const t1 = Date.now()
        while (Date.now() - t1 < 2500) { await sleep(300); if ((await sig()) !== before) { changed = true; break } }
        if (ctx.onStep) await ctx.onStep()
        if (changed) break
      }
      await sleep(400)
      if (s.expect_text && !(await find(page, { text: s.expect_text }, ms, true))) throw new Error(`누른 뒤 기대한 글자가 없다: ${s.expect_text}`)
    } else if (s.fill) {
      const el = await find(page, s.fill, ms); if (!el) throw new Error(`입력칸을 찾지 못했다: ${JSON.stringify(s.fill)}`)
      await page.tap(el); await sleep(300); await page.type(el, subst(s.value, ctx.fixtures)); await page.evaluate(() => document.activeElement && document.activeElement.blur()); await sleep(400)
    } else if (s.goto) { await page.goto(ctx.origin + s.goto); await sleep(1500) }
    else if (s.if_visible) { const el = await find(page, s.if_visible, s.timeout || 1500); await runSteps(page, el ? (s.then || []) : (s.else || []), ctx) }
    else if (s.sleep) await sleep(Math.min(Number(s.sleep) || 0, 5000))
    else if (s.press) { /* 하드웨어 키는 건너뛴다 */ } else throw new Error(`알 수 없는 단계: ${JSON.stringify(s)}`)
  }
}

// 페이지 안: 하단 안전영역과 그 안에 들어간 글자·버튼(S1)
function dqaIosSafeArea () {
  const p = document.createElement('div'); p.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:0;padding-bottom:env(safe-area-inset-bottom);padding-top:env(safe-area-inset-top);pointer-events:none;visibility:hidden'
  document.body.appendChild(p); const cs = getComputedStyle(p); const inset = { bottom: parseFloat(cs.paddingBottom) || 0, top: parseFloat(cs.paddingTop) || 0 }; p.remove()
  const vv = window.visualViewport || { height: innerHeight, offsetTop: 0 }
  const H = vv.height; const zone = H - inset.bottom
  const out = []
  if (inset.bottom > 0) {
    for (const e of document.querySelectorAll('body *')) {
      if (e.children.length && !/^(BUTTON|A)$/.test(e.tagName) && e.getAttribute('role') !== 'button') continue
      const txt = (e.innerText || '').trim(); if (!txt && !/^(BUTTON|A)$/.test(e.tagName)) continue
      const r = e.getBoundingClientRect(); if (r.width === 0 || r.height === 0 || r.top >= H || r.bottom <= 0) continue
      const over = r.bottom - zone
      if (over > 1) out.push({ rule: 'S1', text: txt.slice(0, 30), box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, over_px: Math.round(over * 10) / 10 })
    }
  }
  return { inset, viewport: { w: innerWidth, h: innerHeight, vv_h: vv.height }, issues: out.slice(0, 30) }
}

// 페이지 안: 1~2글자 기호가 이 기기 글꼴에서 빈 네모(없는 글자)로 그려지는지(G2)
function dqaIosGlyphs () {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d', { willReadFrequently: true })
  const draw = (ch, font) => { g.clearRect(0, 0, 64, 64); g.font = font; g.fillStyle = '#000'; g.textBaseline = 'middle'; g.fillText(ch, 8, 32); return g.getImageData(0, 0, 64, 64).data }
  const same = (a, b) => { let d = 0; for (let i = 3; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 8) d++; return d < 4 }
  const out = []; const seen = new Set()
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const s = n.textContent.trim(); if (!s || s.length > 2) continue
    if (/^[\p{L}\p{N}\s.,:;!?'"()\-+%/]+$/u.test(s)) continue // 글자·숫자·흔한 문장부호는 뺀다
    const el = n.parentElement; const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el); const font = `${cs.fontWeight} 32px ${cs.fontFamily}`
    for (const ch of [...s]) {
      if (/\s/.test(ch) || seen.has(ch + font)) continue; seen.add(ch + font)
      const tofu = draw('͸', font) // 유니코드에 없는 글자 → 빈 네모
      if (same(draw(ch, font), tofu)) out.push({ rule: 'G2', text: s, char: ch, code: 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'), box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } })
    }
  }
  return out.slice(0, 30)
}

// 페이지 안: 보이는 입력칸 목록(키보드 검사 대상)
function dqaIosInputs () {
  return [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.disabled && !e.readOnly })
    .slice(0, 8).map((e, i) => ({ i, label: e.getAttribute('aria-label') || e.placeholder || e.name || e.type, sel: (() => { e.setAttribute('data-dqa-input', String(i)); return `[data-dqa-input="${i}"]` })() }))
}
// 페이지 안: 지금 초점 입력칸이 키보드 위 보이는 영역 안에 있는지(K1)
function dqaIosFocusVisible (sel) {
  const e = document.querySelector(sel); const vv = window.visualViewport
  if (!e || !vv) return null
  const r = e.getBoundingClientRect()
  const visTop = vv.offsetTop; const visBottom = vv.offsetTop + vv.height
  return { focused: document.activeElement === e, font_px: parseFloat(getComputedStyle(e).fontSize), zoom: Math.round(document.documentElement.clientWidth / vv.width * 1000) / 1000, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, vv: { top: visTop, bottom: visBottom, height: vv.height, full: innerHeight },
    keyboard_px: Math.round(innerHeight - vv.height), hidden_px: Math.round(Math.max(0, r.bottom - visBottom, visTop - r.top)) }
}

async function measureIOS ({ origin, recipeId, outDir, device, server, stepMs = 12000, keyboard = true }) {
  const recipe = loadRecipe(recipeId)
  const page = await new IOSPage(server, device).open()
  const res = { screen: recipeId, device, origin, ok: false, issues: [], t0: Date.now() }
  try {
    await page.timeouts()
    res.timings = []
    const tick = (what, t0) => res.timings.push({ what, sec: Math.round((Date.now() - t0) / 100) / 10 })
    const enter = async () => {
      const t0 = Date.now()
      // 깨끗한 상태에서 시작: 이전 실행의 로그인·저장값을 지우고 다시 연다
      await page.goto('about:blank'); await sleep(800) // 이전 실행의 확대·끌어올림을 지운다
      await page.goto(origin + '/'); await sleep(1500)
      await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch (e) {} })
      // 서비스 워커·캐시를 지운다(크롬 측정의 serviceWorkers: 'block'과 같게). 남아 있으면 옛 번들이 캐시에서 뜬다
      await page.evaluateAsync(async () => { try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister() } catch (e) {} try { for (const k of await caches.keys()) await caches.delete(k) } catch (e) {} return true })
      await page.goto(origin + ((recipe.start && recipe.start.path) || '/')); await sleep(2500)
      res.dismissed = await page.dismissNative()
      await runSteps(page, recipe.steps || [], { origin, stepMs, fixtures: recipe._fixtures || {}, onStep: () => page.dismissNative() })
      res.dismissed += await page.dismissNative()
      if (recipe.ready && recipe.ready.text && !(await find(page, { text: recipe.ready.text }, stepMs, true))) throw new Error(`화면 준비 글자가 없다: ${recipe.ready.text}`)
      tick('enter', t0)
    }
    await enter()
    await sleep(800)
    await page.screenshot(path.join(outDir, 'screen.png'))
    const scan = await page.evaluateAsync(dqaScan, { root: (recipe.scan && recipe.scan.root) || null, ignore: (recipe.scan && recipe.scan.ignore) || [], final: true, first: true, trace: null })
    res.viewport = scan.viewport; res.scale = scan.scale; res.leaves = scan.leaves
    for (const it of scan.issues) res.issues.push({ source: 'scan', rule: it.rule, metric: it.metric, text: it.el && (it.el.text || it.el.label), sev: it.severity, detail: it.detail || it.msg })
    const sa = await page.evaluate(dqaIosSafeArea); res.safe_area = { inset: sa.inset, viewport: sa.viewport }; for (const it of sa.issues) res.issues.push({ source: 'ios', ...it })
    for (const it of await page.evaluate(dqaIosGlyphs)) res.issues.push({ source: 'ios', ...it })
    if (keyboard) {
      res.inputs = []
      const list = await page.evaluate(dqaIosInputs)
      for (const inp of list) {
        // 입력칸마다 새로 들어간다: 앞 입력칸이 남긴 확대·끌어올림·키보드 상태가 다음 측정을 흐리지 않게
        if (inp.i > 0) { const t0 = Date.now(); await page.close(); await page.open(); await page.timeouts(); tick('reopen', t0); await enter(); await page.evaluate(dqaIosInputs) } // 사파리를 다시 켜야 확대가 풀린다
        const t1 = Date.now()
        const el = await find(page, { selector: inp.sel }, 3000); if (!el) continue
        await page.tap(el); await sleep(1300)
        const v = await page.evaluate(dqaIosFocusVisible, inp.sel)
        // K1 판정: iOS가 아는 초점 입력칸 위치가 키보드(+입력 보조 막대) 위쪽보다 아래이거나, 화면 위(상태 막대 62pt)보다 위면 가린 것
        const nf = await page.nativeFocus(inp.label).catch(() => null)
        if (v && nf) {
          const coverTop = nf.keyboard ? Math.min(nf.keyboard.y, nf.bar_top ?? nf.keyboard.y) : null
          v.native = { field: nf.field && { top: Math.round(nf.field.y), bottom: Math.round(nf.field.y + nf.field.height) }, cover_top: coverTop && Math.round(coverTop), keyboard_h: nf.keyboard && Math.round(nf.keyboard.height) }
          v.keyboard_px = nf.keyboard ? Math.round(nf.keyboard.height) : 0
          v.hidden_px = nf.field && coverTop ? Math.round(Math.max(0, nf.field.y + nf.field.height - coverTop, 62 - nf.field.y)) : 0
          v.native_found = !!nf.field
        }
        res.inputs.push({ ...inp, ...v, calib: page.lastCalib }); tick('input ' + inp.i, t1)
        // Z1: 누르자 화면이 확대됨(iOS는 글자 16px 미만 입력칸에 초점이 가면 확대한다). 이전 입력칸에서 이미 확대됐으면 새로 세지 않는다
        let focusShot = null
        if (v && v.focused) { focusShot = path.join(outDir, `focus_${inp.i}.png`); await page.screenshot(focusShot).catch(() => { focusShot = null }) }
        if (v && v.focused && v.zoom > 1.01) res.issues.push({ source: 'ios', rule: 'Z1', text: inp.label, font_px: v.font_px, zoom: v.zoom, shot: focusShot && path.basename(focusShot) })
        if (v && v.focused && v.keyboard_px > 50 && v.hidden_px > 4) {
          res.issues.push({ source: 'ios', rule: 'K1', text: inp.label, hidden_px: v.hidden_px, keyboard_px: v.keyboard_px, box: v.box, native: v.native, shot: focusShot && path.basename(focusShot) })
        }
        await page.evaluate(() => document.activeElement && document.activeElement.blur()); await sleep(700)
      }
    }
    res.ok = true
  } catch (e) {
    res.error = String(e.message).split('\n')[0]
    try { await page.screenshot(path.join(outDir, 'fail.png')); res.fail_shot = 'fail.png' } catch (e2) {}
    try { const logs = await wd(page.base, 'POST', '/se/log', { type: 'safariConsole' }); res.console = (logs || []).slice(-25).map((l) => String(l.message || l).slice(0, 300)) } catch (e3) { res.console_error = String(e3.message).slice(0, 150) }
  } finally {
    res.ms = Date.now() - res.t0; delete res.t0
    await page.close()
  }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'ios.json'), JSON.stringify(res, null, 1))
  return res
}

// 아이폰 전용 규칙을 dqa 결함 형식으로(눌러 보기 결함과 같은 모양, kind 'ios'). 크롬에서 이미 재는 규칙은 넣지 않는다
const IOS_RULES = {
  K1: { name: '키보드가 입력칸을 가림', sev: '높음', metric: 'keyboard_cover', what: (i) => `입력칸 "${i.text}"을 누르면 키보드(입력 보조 막대 포함)가 칸을 ${i.hidden_px}px 가린다`, px: (i) => i.hidden_px },
  Z1: { name: '입력칸을 누르면 화면이 확대됨', sev: '중간', metric: 'focus_zoom', what: (i) => `입력칸 "${i.text}"의 글자가 ${i.font_px}px(16px 미만)라 누르면 화면이 ${i.zoom}배로 확대된다`, px: (i) => Math.round((i.zoom - 1) * 100) },
  G2: { name: '기기 글꼴에 없는 기호(빈 네모)', sev: '높음', metric: 'missing_glyph', what: (i) => `"${i.text}"의 ${i.code} 기호가 이 기기 글꼴에 없어 빈 네모로 그려진다`, px: () => 1 },
  S1: { name: '하단 안전영역 침범', sev: '중간', metric: 'safe_area', what: (i) => `"${i.text}"가 하단 안전영역(홈 막대 자리)으로 ${i.over_px}px 들어간다`, px: (i) => i.over_px }
}
function iosDefects (res, { screen, side, ref, outRel }) {
  const crypto = require('crypto'); const sha1 = (x) => crypto.createHash('sha1').update(x).digest('hex')
  const out = new Map()
  const w = (res.viewport && res.viewport.w) || 402; const h = (res.viewport && res.viewport.h) || 874
  for (const i of res.issues || []) {
    const R = IOS_RULES[i.rule]; if (!R) continue
    const fp = `ios|${i.rule}|${i.text}|${i.char || ''}`
    const id = `${screen.replace(/\//g, '-')}-ios-${i.rule}-${sha1(fp).slice(0, 6)}`
    if (out.has(id)) continue
    const what = R.what(i); const shot = i.shot ? `${outRel}/${i.shot}` : `${outRel}/screen.png`
    out.set(id, { id, rule: i.rule, rule_name: R.name, severity: R.sev, kind: 'ios', screen, side, ref, fps: [fp], labels: [String(i.text || '').slice(0, 40)],
      elements: [{ fp, label: String(i.text || '').slice(0, 40), box: i.box || null }],
      widths: [{ w, h, px: R.px(i) || 1, metric: R.metric, canvas_px: R.px(i) || 1, items: 1, scroll_y: 0, step: 0, shot, clean: shot, text: what }],
      max_px: R.px(i) || 1, only_at: null, device: res.device ? `${res.device} · iOS 사파리` : 'iOS 사파리',
      evidence: [{ id: 'M1', metric: R.metric, value: R.px(i) || 1, threshold: 1, text: what }], ios: i, diag: [], shots: { crop: null } })
  }
  return [...out.values()]
}

module.exports = { measureIOS, IOSPage, iosDefects, IOS_RULES }

// 단독 실행: node measure/ios.js <origin> <recipe> <출력 폴더> [기기 이름]
if (require.main === module) {
  const [origin, recipeId, outDir, device] = process.argv.slice(2)
  measureIOS({ origin, recipeId, outDir, device }).then((r) => {
    console.log(JSON.stringify({ ok: r.ok, error: r.error, ms: r.ms, safe_area: r.safe_area, issues: r.issues.map((i) => `${i.rule} ${i.text || ''} ${i.hidden_px ? `가림 ${i.hidden_px}px` : ''}${i.over_px ? `침범 ${i.over_px}px` : ''}${i.code || ''}`) }, null, 1))
  }).catch((e) => { console.error(e); process.exit(1) })
}
