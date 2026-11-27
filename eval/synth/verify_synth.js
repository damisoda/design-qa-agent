#!/usr/bin/env node
// 합성 예제 정답 확인: 변형마다 심은 결함 하나를 선택자 기반 측정으로 잰다(dqa 규칙과 따로).
// 결함 변형에서 결함이 있고, 같은 화면의 맞게 만든 구현(ok)에서는 같은 측정이 깨끗한 크기만 정답 크기로 적는다.
// 크기 "375x812@47,34"는 안전영역(위 47, 아래 34px)을 흉내 낸다.
// 사용: node eval/synth/verify_synth.js  → cases.json의 verified, shots/<id>_<크기>.png
const fs = require('fs')
const path = require('path')
const { launch, newContext, settle } = require('../../dqa/measure/browser')
const { serveDist } = require('../../dqa/targets/static')

const ROOT = path.resolve(__dirname, '../..')
// 예제 묶음: 기본은 eval/synth(개발용), --set blind면 eval/synth/blind
const SET = process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1] : ''
const HERE = SET ? path.join(__dirname, SET) : __dirname

// 브라우저 안에서 도는 측정. spec = cases.json의 check, safe = [위, 아래]
async function measure ({ spec, safe }) {
  const q = (s) => [...document.querySelectorAll(s)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' })
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  const textRect = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); return rg.getBoundingClientRect() }
  const devW = screen.width && screen.width < innerWidth - 1 ? screen.width : innerWidth
  const rgb = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(',').map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 } }
  const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const bgOf = (e) => { for (let a = e; a; a = a.parentElement) { const c = rgb(getComputedStyle(a).backgroundColor); if (c && c.a > 0.5) return c } return { r: 255, g: 255, b: 255 } }
  const T = spec.type
  if (T === 'overflow') { // 자식이 부모 오른쪽이나 화면 밖으로. allow_scroll이면 부모가 가로 스크롤 영역일 때는 의도된 넘침으로 본다
    let worst = 0
    for (const p of q(spec.sel)) { if (spec.allow_scroll && /(auto|scroll)/.test(getComputedStyle(p).overflowX)) continue; const pr = p.getBoundingClientRect(); for (const c of p.children) { const cr = c.getBoundingClientRect(); if (cr.width) worst = Math.max(worst, cr.right - pr.right, cr.right - devW) } }
    return { defect: worst > 2, value: Math.round(worst) }
  }
  if (T === 'overflow_text') { // 글자 자체가 자기 상자나 화면 밖으로
    let worst = 0
    for (const e of q(spec.sel)) { if (spec.allow_scroll && /(auto|scroll)/.test(getComputedStyle(e).overflowX)) continue; const r = e.getBoundingClientRect(); const t = textRect(e); worst = Math.max(worst, t.right - r.right, t.right - devW, e.scrollWidth - e.clientWidth) } // allow_scroll: 가로 스크롤 영역은 의도된 넘침
    return { defect: worst > 2, value: Math.round(worst) }
  }
  if (T === 'page_overflow') { const over = Math.max(document.documentElement.scrollWidth, innerWidth) - devW; return { defect: over > 2, value: Math.round(over) } }
  if (T === 'wrap') { const worst = Math.max(0, ...q(spec.sel).map((e) => e.getBoundingClientRect().height - (spec.pad || 0))); return { defect: worst > spec.line * 1.5, value: Math.round(worst) } }
  if (T === 'overlap_text') { // 글자 영역(Range)과 상대 상자가 겹침. 상대가 글자를 품은 조상이면 뺀다
    let worst = 0
    for (const e of q(spec.sel)) { const a = textRect(e); for (const o of q(spec.other)) { if (o.contains(e)) continue; worst = Math.max(worst, inter(a, o.getBoundingClientRect())) } }
    return { defect: worst > 4, value: Math.round(worst) }
  }
  if (T === 'covered') {
    for (const s of q(spec.scroll)) s.scrollTop = s.scrollHeight
    await new Promise((r) => setTimeout(r, 300))
    const t = q(spec.sel)[0]; if (!t) return { defect: null, value: null }
    const r = t.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(innerHeight - 1, r.top + r.height / 2))
    return { defect: !t.contains(hit) || r.bottom > innerHeight, value: `${Math.round(r.top)}~${Math.round(r.bottom)} ${hit ? hit.className || hit.tagName : ''}` }
  }
  if (T === 'offscreen') { // 화면 아래로 벗어나고, 감싸는 스크롤도 없어 닿을 수 없음
    const t = q(spec.sel)[0]; if (!t) return { defect: true, value: '보이지 않음' }
    const r = t.getBoundingClientRect()
    let clip = innerHeight
    for (let a = t.parentElement; a; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1) { clip = Infinity; break } if (/(hidden|clip)/.test(cs.overflowY)) clip = Math.min(clip, a.getBoundingClientRect().bottom) } // 더 가까운 스크롤 영역이 있으면 스크롤해서 닿는다
    return { defect: r.bottom > clip + 1, value: `버튼 ${Math.round(r.top)}~${Math.round(r.bottom)}, 보이는 끝 ${Math.round(clip)}` }
  }
  // label 옵션: 입력칸을 감싼 label이 있으면 label 전체가 누를 곳이다
  if (T === 'target') { const s = q(spec.sel).map((e) => ((spec.label && e.closest('label')) || e).getBoundingClientRect()); const worst = Math.min(...s.map((r) => Math.min(r.width, r.height))); return { defect: worst < spec.min, value: Math.round(worst) } }
  if (T === 'contrast') {
    let worst = 99
    for (const e of q(spec.sel)) { const fg = rgb(getComputedStyle(e).color); const bg = bgOf(e); const L1 = lum(fg); const L2 = lum(bg); worst = Math.min(worst, (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) }
    return { defect: worst < spec.min, value: Math.round(worst * 100) / 100 }
  }
  if (T === 'clipped_text') { let worst = 0; for (const e of q(spec.sel)) worst = Math.max(worst, e.scrollWidth - e.clientWidth, e.scrollHeight - e.clientHeight); return { defect: worst > 1, value: worst } }
  if (T === 'clipped_parent') { // 글자 영역이 잘라내는 조상 밖으로
    let worst = 0
    for (const e of q(spec.sel)) { const tr = textRect(e); for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowY)) break; if (/(hidden|clip)/.test(cs.overflowY + cs.overflowX)) { const ab = a.getBoundingClientRect(); worst = Math.max(worst, tr.bottom - ab.bottom, tr.right - ab.right); break } } } // 스크롤되는 조상 안이면 스크롤해서 볼 수 있어 잘린 것이 아니다
    return { defect: worst > 1, value: Math.round(worst) }
  }
  if (T === 'safe_bottom') { let worst = -99; for (const e of q(spec.sel)) worst = Math.max(worst, e.getBoundingClientRect().bottom - (innerHeight - safe[1])); return { defect: worst > 1, value: Math.round(worst) } }
  if (T === 'focus_ring') { // 포커스 전후 테두리·그림자·윤곽선이 달라지는가(키보드 사용자가 위치를 볼 수 있는가)
    const e = q(spec.sel)[0]; const pick = () => { const s = getComputedStyle(e); return [s.outlineStyle + s.outlineWidth, s.boxShadow, s.borderColor].join('|') }
    e.blur(); const before = pick(); e.focus(); const after = pick(); e.blur()
    return { defect: before === after, value: before === after ? '포커스 표시 없음' : '바뀜' }
  }
  if (T === 'fill_width') { // 시안에서 Fill인 요소가 부모 안쪽 폭을 채우는가
    const e = q(spec.sel)[0]; const p = e.parentElement; const ps = getComputedStyle(p); const pw = p.getBoundingClientRect().width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight)
    const gap = pw - e.getBoundingClientRect().width
    return { defect: Math.abs(gap) > 2, value: Math.round(gap) }
  }
  if (T === 'lines') { // 글자가 실제로 차지한 줄 수(Range의 줄 사각형)
    let worst = 1
    for (const e of q(spec.sel)) { const rg = document.createRange(); rg.selectNodeContents(e); const tops = []; for (const r of rg.getClientRects()) { if (r.width < 0.5) continue; if (!tops.some((y) => Math.abs(y - r.top) < r.height * 0.4)) tops.push(r.top) } worst = Math.max(worst, tops.length) }
    return { defect: worst >= 2, value: worst }
  }
  if (T === 'align_top') { const tops = q(spec.sel).map((e) => e.getBoundingClientRect().top); const d = Math.max(...tops) - Math.min(...tops); return { defect: d > 1, value: Math.round(d) } }
  if (T === 'img_ratio') {
    const e = q(spec.sel)[0]; const r = e.getBoundingClientRect(); const fit = getComputedStyle(e).objectFit
    const nat = e.naturalWidth / e.naturalHeight; const shown = r.width / r.height
    const dist = (fit === 'fill' || fit === '') ? Math.abs(shown / nat - 1) : 0
    return { defect: dist > 0.05, value: `${Math.round(nat * 100) / 100} → ${Math.round(shown * 100) / 100} (${fit})` }
  }
  if (T === 'img_broken') { const e = document.querySelector(spec.sel); return { defect: !!e && e.complete && e.naturalWidth === 0, value: e ? `${e.naturalWidth}x${e.naturalHeight}` : '없음' } }
  if (T === 'safe_top') { const e = q(spec.sel)[0]; const r = e.getBoundingClientRect(); return { defect: r.top < safe[0] - 1, value: `글자 위 ${Math.round(r.top)}, 안전영역 ${safe[0]}` } }
  if (T === 'frame_escape') { // 요소가 폰 크기 앱 틀(frame) 밖으로 벗어남
    const fr = q(spec.frame)[0].getBoundingClientRect(); let worst = 0
    for (const e of q(spec.sel)) { const r = e.getBoundingClientRect(); worst = Math.max(worst, fr.left - r.left, r.right - fr.right) }
    return { defect: worst > 2, value: Math.round(worst) }
  }
  if (T === 'contrast_img') { // 그림 위 글자: 글자 아래 그림 픽셀(글자 쪽 반투명 배경을 덮어 계산)과 글자색의 대비 중앙값. 그림은 object-fit: cover로 본다
    const e = q(spec.sel)[0]; const im = q(spec.img)[0]
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const g = c.getContext('2d'); g.drawImage(im, 0, 0)
    const ir = im.getBoundingClientRect(); const s = Math.max(ir.width / im.naturalWidth, ir.height / im.naturalHeight)
    const ox = (ir.width - im.naturalWidth * s) / 2; const oy = (ir.height - im.naturalHeight * s) / 2
    const tr = textRect(e); const fg = rgb(getComputedStyle(e).color); const own = rgb(getComputedStyle(e).backgroundColor) || { r: 0, g: 0, b: 0, a: 0 }
    const vals = []
    for (let i = 1; i <= 5; i++) {
      for (let j = 1; j <= 3; j++) {
        const ix = Math.floor((tr.left + tr.width * i / 6 - ir.left - ox) / s); const iy = Math.floor((tr.top + tr.height * j / 4 - ir.top - oy) / s)
        const d = g.getImageData(ix, iy, 1, 1).data
        const bg = { r: own.r * own.a + d[0] * (1 - own.a), g: own.g * own.a + d[1] * (1 - own.a), b: own.b * own.a + d[2] * (1 - own.a) }
        const L1 = lum(fg); const L2 = lum(bg); vals.push((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05))
      }
    }
    vals.sort((a, b) => a - b); const med = vals[Math.floor(vals.length / 2)]
    return { defect: med < spec.min, value: Math.round(med * 100) / 100 }
  }
  if (T === 'text_in_circle') { // 원 가운데 글자의 상자 모서리가 원의 안쪽 반지름(spec.r) 안에 드는가. 원 중심은 spec.circle 요소의 가운데
    const c = q(spec.circle)[0].getBoundingClientRect(); const cx = (c.left + c.right) / 2; const cy = (c.top + c.bottom) / 2
    let worst = -99
    for (const e of q(spec.sel)) { const t = textRect(e); for (const [x, y] of [[t.left, t.top], [t.right, t.top], [t.left, t.bottom], [t.right, t.bottom]]) worst = Math.max(worst, Math.hypot(x - cx, y - cy) - spec.r) }
    return { defect: worst > 2, value: Math.round(worst) }
  }
  if (T === 'line_overlap') { // 한 요소 안에서 이웃한 줄의 글자(글자 크기 높이)가 서로 겹치는가: 겹친 양 = 글자 크기 - 줄 간격
    let worst = -99
    for (const e of q(spec.sel)) {
      const rg = document.createRange(); rg.selectNodeContents(e); const fs = parseFloat(getComputedStyle(e).fontSize)
      const tops = [...rg.getClientRects()].filter((r) => r.width > 0.5).map((r) => r.top).sort((a, b) => a - b)
      for (let i = 1; i < tops.length; i++) { const d = tops[i] - tops[i - 1]; if (d > 1) worst = Math.max(worst, fs - d) }
    }
    return { defect: worst > 2, value: Math.round(worst) }
  }
  if (T === 'contrast_placeholder') { // 비어 있는 입력칸의 안내 글자(::placeholder)와 입력칸 배경의 대비
    let worst = 99
    for (const e of q(spec.sel)) { if (!e.placeholder || e.value) continue; const fg = rgb(getComputedStyle(e, '::placeholder').color); const bg = bgOf(e); const L1 = lum(fg); const L2 = lum(bg); worst = Math.min(worst, (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) }
    return { defect: worst < spec.min, value: Math.round(worst * 100) / 100 }
  }
  if (T === 'contrast_opacity') { // 요소와 조상의 opacity를 곱해, 글자색과 배경을 페이지(흰색) 위에 섞은 뒤의 대비
    let worst = 99
    for (const e of q(spec.sel)) {
      let op = 1; for (let a = e; a; a = a.parentElement) op *= Number(getComputedStyle(a).opacity)
      const mix = (c) => ({ r: c.r * op + 255 * (1 - op), g: c.g * op + 255 * (1 - op), b: c.b * op + 255 * (1 - op) })
      const f = mix(rgb(getComputedStyle(e).color)); const b = mix(bgOf(e)); const L1 = lum(f); const L2 = lum(b)
      worst = Math.min(worst, (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05))
    }
    return { defect: worst < spec.min, value: Math.round(worst * 100) / 100 }
  }
  if (T === 'style') { const e = q(spec.sel)[0]; const v = e ? getComputedStyle(e)[spec.prop.replace(/-(\w)/g, (_, c) => c.toUpperCase())] : null; return { defect: v !== spec.value, value: v } }
  return { defect: null, value: null, note: `모르는 측정 ${T}` }
}

function parseSize (s) { const [wh, sa] = s.split('@'); const [w, h] = wh.split('x').map(Number); return { w, h, safe: sa ? sa.split(',').map(Number) : [0, 0] } }

async function run (browser, dir, size, spec, shot) {
  const s = await serveDist(dir)
  const { w, h, safe } = parseSize(size)
  const ctx = await newContext(browser, { origin: s.origin, width: w, height: h, allowHosts: [], blocked: [] })
  const page = await ctx.newPage()
  if (safe[0] || safe[1]) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: safe[0], bottom: safe[1], left: 0, right: 0 } }) }
  try {
    await page.goto(s.origin + '/'); await settle(page, { stableMs: 300, timeoutMs: 3000 })
    if (shot) { fs.mkdirSync(path.dirname(shot), { recursive: true }); await page.screenshot({ path: shot }) }
    return spec ? await page.evaluate(measure, { spec, safe }) : null
  } finally { await ctx.close(); s.close() }
}

async function main () {
  const file = path.join(HERE, 'cases.json')
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const browser = await launch()
  try {
    for (const c of data.cases.filter((x) => x.check)) {
      const ok = data.cases.find((x) => x.screen === c.screen && x.variant === 'ok')
      const res = { bad: {}, ok: {} }
      for (const size of c.sizes) {
        res.bad[size] = await run(browser, path.join(ROOT, c.dir), size, c.check, path.join(HERE, 'shots', `${c.id}_${size.replace('@', '_')}.png`))
        res.ok[size] = await run(browser, path.join(ROOT, ok.dir), size, c.check, null)
      }
      const expected = c.sizes.filter((s) => res.bad[s].defect === true && res.ok[s].defect === false)
      c.verified = { expected_sizes: expected, bad: Object.fromEntries(c.sizes.map((s) => [s, res.bad[s].value])), ok: Object.fromEntries(c.sizes.map((s) => [s, res.ok[s].value])), ok_clean: c.sizes.every((s) => res.ok[s].defect === false) }
      console.log(`${c.id.padEnd(24)} ${c.code} 정답 ${expected.length}/${c.sizes.length} ${expected.join(',') || '없음'} | 결함 ${JSON.stringify(Object.values(c.verified.bad)).slice(0, 90)} | ok ${JSON.stringify(Object.values(c.verified.ok)).slice(0, 60)}`)
    }
    for (const c of data.cases.filter((x) => !x.check)) await run(browser, path.join(ROOT, c.dir), c.sizes[0], null, path.join(HERE, 'shots', `${c.id}_${c.sizes[0].replace('@', '_')}.png`))
  } finally { await browser.close() }
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n')
}
main().catch((e) => { console.error(e); process.exit(2) })
