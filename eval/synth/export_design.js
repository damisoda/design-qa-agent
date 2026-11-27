#!/usr/bin/env node
// 합성 시안 명세 만들기: 맞게 만든 화면(ok)을 기준 크기로 띄워, Figma 플러그인이 내보낼 모양의 JSON으로 적는다.
//   프레임 → 노드 트리(FRAME·TEXT·RECTANGLE·IMAGE), 상자(프레임 기준 x·y·w·h), 오토 레이아웃(방향·간격·여백·정렬),
//   크기 방식(FILL·HUG·FIXED), 채움 색과 글자 스타일(가능하면 토큰 이름), 모서리·테두리
// 출력: screens/<화면>/design.json, design.png(시안 그림)
// 사용: node eval/synth/export_design.js
const fs = require('fs')
const path = require('path')
const { launch, newContext, settle } = require('../../dqa/measure/browser')
const { serveDist } = require('../../dqa/targets/static')

const SET = process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1] : ''
const HERE = SET ? path.join(__dirname, SET) : __dirname
// 기준 크기: 묶음의 cases.json에서 화면별 ok의 첫 크기
const BASE = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(HERE, 'cases.json'), 'utf8')).cases.filter((c) => c.variant === 'ok').map((c) => [c.screen, c.sizes[0].split('@')[0].split('x').map(Number)]))

// 크기 방식 추정용: 모든 요소에 번호를 붙이고 폭을 적는다(기준 크기와 넓힌 크기에서 한 번씩)
function widthsOf () {
  return [...document.querySelectorAll('.app, .app *')].map((el, i) => { el.setAttribute('data-ex-i', String(i)); return Math.round(el.getBoundingClientRect().width * 10) / 10 })
}

function walk (alt) {
  const app = document.querySelector('.app')
  const fr = app.getBoundingClientRect()
  const root = getComputedStyle(document.documentElement)
  const tokens = {}
  for (const k of ['bg', 'page', 'text', 'muted', 'line', 'brand', 'sale', 'point', 'chatbg', 'accent', 'surface']) { const v = root.getPropertyValue('--' + k).trim(); if (v) tokens[k] = v.toUpperCase() }
  const hex = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); if (v.length > 3 && v[3] < 0.05) return null; return '#' + v.slice(0, 3).map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase() }
  const alpha = (c) => { const m = String(c).match(/rgba\(([^)]+)\)/); if (!m) return 1; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return v.length > 3 ? Math.round(v[3] * 100) / 100 : 1 }
  const tok = (h) => { const k = Object.keys(tokens).find((t) => tokens[t] === h); return k ? `color/${k}` : null }
  // Figma 채움처럼 색과 불투명도를 따로 적는다(반투명 배경은 hex + opacity)
  const fill = (c) => { const h = hex(c); if (!h) return null; const a = alpha(c); return a < 1 ? { hex: h, opacity: a, token: tok(h) } : { hex: h, token: tok(h) } }
  let n = 0
  const node = (el, parentBox, parentStyle) => {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect()
    if (s.display === 'none' || r.width === 0 || r.height === 0) return null
    const isText = el.children.length === 0 && el.textContent.trim() && el.tagName !== 'IMG'
    const type = el.tagName === 'IMG' ? 'IMAGE' : el.tagName === 'svg' ? 'VECTOR' : isText ? 'TEXT' : 'FRAME'
    const d = { id: `1:${++n}`, name: el.getAttribute('aria-label') || [...el.classList][0] || el.tagName.toLowerCase(), type, x: Math.round(r.left - fr.left), y: Math.round(r.top - fr.top), w: Math.round(r.width), h: Math.round(r.height) }
    if (parentBox) {
      // 부모 안쪽 폭에서 자기 바깥 여백(margin)도 뺀다(margin: 0 20px로 채우는 요소도 Fill)
      const pw = parentBox.width - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight) - (parseFloat(s.marginLeft) || 0) - (parseFloat(s.marginRight) || 0)
      const grow = parseFloat(s.flexGrow) > 0
      // 디자이너가 정했을 크기 방식: 화면을 넓혔을 때 부모와 함께 늘면 Fill, 그대로면 고정, 글자·인라인은 Hug.
      // 인라인 요소는 폭을 정할 수 없으니 Hug. 같은 줄의 형제끼리는 늘어난 폭을 나눠 갖는다
      const inline = s.display === 'inline'
      const me = Number(el.getAttribute('data-ex-i')); const par = Number(el.parentElement.getAttribute('data-ex-i'))
      const g = alt && alt[me] !== undefined ? alt[me] - r.width : null; const pg = alt && alt[par] !== undefined ? alt[par] - parentBox.width : null
      const row = [...el.parentElement.children].filter((c) => { const q = c.getBoundingClientRect(); return q.width > 0 && Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top) > Math.min(q.height, r.height) * 0.5 }).length || 1
      const fills = g !== null && pg !== null ? pg >= 10 && g >= (pg / row) * 0.5 : Math.abs(r.width - pw) < 1.5 || (grow && /row/.test(parentStyle.flexDirection))
      d.sizing = { h: inline ? 'HUG' : fills ? 'FILL' : (isText || /inline/.test(s.display)) ? 'HUG' : 'FIXED' }
    }
    if (/flex|grid/.test(s.display) && !isText) d.layout = { mode: /grid/.test(s.display) ? 'GRID' : /row/.test(s.flexDirection) ? 'HORIZONTAL' : 'VERTICAL', gap: parseFloat(s.gap) || 0, padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map((v) => parseFloat(v) || 0), align: s.alignItems, justify: s.justifyContent, wrap: s.flexWrap === 'wrap' }
    const f = fill(s.backgroundColor); if (f) d.fill = f
    if (parseFloat(s.borderTopLeftRadius)) d.radius = parseFloat(s.borderTopLeftRadius)
    if (parseFloat(s.borderTopWidth) && s.borderTopStyle !== 'none') d.stroke = { width: parseFloat(s.borderTopWidth), ...fill(s.borderTopColor) }
    if (type === 'TEXT') d.text = { content: el.textContent.trim(), fontFamily: s.fontFamily.split(',')[0].replace(/"/g, ''), fontSize: parseFloat(s.fontSize), fontWeight: Number(s.fontWeight), lineHeight: parseFloat(s.lineHeight) || null, color: fill(s.color), wrap: s.whiteSpace === 'nowrap' ? 'NONE' : 'WRAP' }
    if (type === 'IMAGE') d.image = { src: el.getAttribute('src'), natural: [el.naturalWidth, el.naturalHeight], fit: s.objectFit }
    if (type === 'FRAME') { const kids = [...el.children].map((c) => node(c, r, s)).filter(Boolean); if (kids.length) d.children = kids }
    return d
  }
  return { frame: { name: document.title.split(' · ')[0], width: Math.round(fr.width), height: Math.round(fr.height), fill: fill(getComputedStyle(app).backgroundColor) }, tokens: Object.fromEntries(Object.entries(tokens).map(([k, v]) => [`color/${k}`, v])), nodes: [...app.children].map((c) => node(c, fr, getComputedStyle(app))).filter(Boolean) }
}

async function main () {
  const browser = await launch()
  try {
    for (const [scr, [w, h]] of Object.entries(BASE)) {
      const dir = path.join(HERE, 'screens', scr, 'ok')
      const s = await serveDist(dir)
      const ctx = await newContext(browser, { origin: s.origin, width: w, height: h, allowHosts: [], blocked: [] })
      const page = await ctx.newPage()
      await page.goto(s.origin + '/'); await settle(page, { stableMs: 300, timeoutMs: 3000 })
      await page.evaluate(widthsOf)
      await page.setViewportSize({ width: w + 60, height: h }); await settle(page, { stableMs: 200, timeoutMs: 2000 })
      const alt = await page.evaluate(() => [...document.querySelectorAll('.app, .app *')].map((el) => Math.round(el.getBoundingClientRect().width * 10) / 10))
      await page.setViewportSize({ width: w, height: h }); await settle(page, { stableMs: 200, timeoutMs: 2000 })
      const spec = await page.evaluate(walk, alt)
      const out = { source: 'synthetic design spec (dqa eval, 2026-10-10). Figma 플러그인 내보내기와 같은 모양이며, 맞게 만든 구현을 기준 크기로 재서 만들었다.', screen: scr, base: `${w}x${h}`, ...spec }
      fs.writeFileSync(path.join(HERE, 'screens', scr, 'design.json'), JSON.stringify(out, null, 1) + '\n')
      await page.screenshot({ path: path.join(HERE, 'screens', scr, 'design.png') })
      const count = (ns) => ns.reduce((a, x) => a + 1 + (x.children ? count(x.children) : 0), 0)
      console.log(`${scr}: 노드 ${count(out.nodes)}개, 토큰 ${Object.keys(out.tokens).length}개, 글자 ${JSON.stringify(out).match(/"type":"TEXT"/g).length}개`)
      await ctx.close(); s.close()
    }
  } finally { await browser.close() }
}
main().catch((e) => { console.error(e); process.exit(2) })
