// 시안 비교 단계: 화면을 시안 프레임 크기로 열어 DOM을 추출하고 시안과 값 비교 → 결함 레코드.
// 크기 방식(Fill·고정)은 더 넓은 화면에서 한 번 더 재서 폭 변화로 본다.
const path = require('path')
const fs = require('fs')
const { newContext, settle, fonts } = require('../measure/browser')
const { enterScreen } = require('../recipes/runner')
const { dqaDesignDom, dqaDesignOutline } = require('./extract')
const { compareDesign, compareDesignLive, designDefects } = require('./compare')
const { readJSON, writeJSON } = require('../core/util')

const baseOf = (spec) => {
  const s = spec.base || (spec.frame ? `${spec.frame.width}x${spec.frame.height}` : null)
  const [w, h] = String(s || '').split('x').map(Number)
  return w > 0 && h > 0 ? [w, h] : null
}

async function openAndExtract (browser, { origin, recipe, w, h, cfg, widths }) {
  const blocked = []
  const ctx = await newContext(browser, { origin, width: w, height: h, allowHosts: recipe.allow_hosts, blocked, stubs: recipe._stubs, stubbed: [] })
  const page = await ctx.newPage()
  try {
    await enterScreen(page, recipe, { origin, stepMs: cfg.timeouts.step_ms, gotoMs: cfg.timeouts.goto_ms, settleMs: cfg.timeouts.settle_ms })
    await fonts(page); await settle(page, { stableMs: 200, timeoutMs: 2000 })
    const dom = await page.evaluate(dqaDesignDom, { widths })
    dom.blocked = blocked
    return { ctx, page, dom }
  } catch (e) { await ctx.close().catch(() => {}); throw e }
}

// 한 화면·한 쪽(변경 전·후)의 시안 비교. spec은 design.json, 결과는 결함 레코드와 요약
async function designPass (browser, { origin, recipe, spec, side, ref, run, cfg, altWidth }) {
  const base = baseOf(spec); if (!base) return { defects: [], summary: { skipped: '시안 기준 크기를 모른다' } }
  const [w, h] = base
  const tag = `${side}/${recipe.id.replace(/\//g, '_')}_design_${w}x${h}`
  const a = await openAndExtract(browser, { origin, recipe, w, h, cfg, widths: true })
  let alt = null
  try {
    const aw = altWidth && altWidth > w + 10 ? altWidth : w + 55
    const b = await openAndExtract(browser, { origin, recipe, w: aw, h, cfg, widths: true })
    alt = b.dom; alt.vw_used = aw; await b.ctx.close()
  } catch (e) { alt = null }
  // 세로 제약(아래 고정·위아래 늘림)이 있는 시안이면 더 긴 화면에서 한 번 더 잰다
  let tall = null
  const vcons = (ns) => (ns || []).some((n) => (n.constraints && ['MAX', 'STRETCH'].includes(n.constraints.v)) || vcons(n.children))
  if (vcons(spec.nodes)) {
    try { const c = await openAndExtract(browser, { origin, recipe, w, h: h + 120, cfg, widths: true }); tall = c.dom; tall.vh_used = h + 120; await c.ctx.close() } catch (e) { tall = null }
  }
  a.dom.vh_used = h
  const shot = path.join('shots', `${tag}.png`); const marked = path.join('shots', `${tag}_marked.png`)
  fs.mkdirSync(path.dirname(run.file(shot)), { recursive: true })
  await a.page.screenshot({ path: run.file(shot) })
  const context = { phase: 'design', side, screen: recipe.id, title: recipe.title, size: `${w}x${h}`, width: w, height: h, shot, figma_shot: run.live && run.live.state.design && run.live.state.design[recipe.id] && run.live.state.design[recipe.id].png, figma_width: w, figma_height: h }
  const cmp = run.live ? await compareDesignLive(spec, a.dom, alt, {}, tall, row => { run.live.inspect(context, row); return new Promise(resolve => setImmediate(resolve)) }) : compareDesign(spec, a.dom, alt, {}, tall)
  // 글꼴 없음인데 검사 중 외부 글꼴 요청을 막았으면, 구현이 안 불러온 것인지 알 수 없다(확인 불가로 바꾼다)
  const fontHosts = [...new Set((a.dom.blocked || []).filter((b) => b.type === 'font' || /fonts\.(googleapis|gstatic)\.com|use\.typekit\.net|fonts\.cdnfonts|cdn\.jsdelivr\.net\/.*font|\.(woff2?|ttf|otf)(\?|$)/i.test(b.url)).map((b) => { try { return new URL(b.url).host } catch (e) { return b.url.slice(0, 40) } }))]
  // 그림 없음(M2)인데 검사 중 외부 그림(지도 타일 등)을 막았으면, 구현이 안 그린 것인지 알 수 없다
  const imgHosts = [...new Set((a.dom.blocked || []).filter((b) => b.type === 'image').map((b) => { try { return new URL(b.url).host } catch (e) { return b.url.slice(0, 40) } }))]
  if (imgHosts.length) {
    for (const it of cmp.issues.filter((x) => x.rule === 'M2')) { it.metric = 'image_blocked'; it.blocked = true; it.text = `${it.text}. 다만 검사 중 외부 그림 요청(${imgHosts.slice(0, 3).join(', ')})을 막아 실제 화면에서 그려지는지는 확인하지 못했다` }
  }
  if (fontHosts.length) {
    for (const it of cmp.issues.filter((x) => x.font_kind === 'missing')) {
      it.font_kind = 'blocked'; it.metric = 'font_blocked'
      it.impl_value = `외부 글꼴(${fontHosts.join(', ')}) 요청이 검사 중 막힘`
      it.text = `글꼴: 시안 글꼴 ${it.design_value}가 검사 화면에 없다. 구현은 외부 글꼴(${fontHosts.join(', ')})을 불러오는데 dqa가 검사 중 외부 요청을 막아 적용 여부를 확인하지 못했다(레시피 allow_hosts에 넣으면 확인할 수 있다) · 글자 ${it.count || 1}개`
    }
  }
  const outline = cmp.issues.filter((x) => x.dom).map((x) => ({ i: x.dom.i }))
  if (outline.length) { await a.page.evaluate(dqaDesignOutline, outline); await a.page.screenshot({ path: run.file(marked) }) }
  await a.ctx.close()
  const defects = designDefects(cmp.issues, { screen: recipe.id, side, ref, w, h, shot, marked: outline.length ? marked : shot })
  writeJSON(run.file(path.join('design', `${side}_${recipe.id.replace(/\//g, '_')}_compare.json`)), { base: [w, h], alt: alt ? [alt.vw_used, h] : null, tall: tall ? [w, tall.vh_used] : null, ...cmp, dom_texts: a.dom.texts.length, dom_boxes: a.dom.boxes.length })
  return { defects, summary: { base: `${w}x${h}`, matched: cmp.matched, design_texts: cmp.design_texts, issues: cmp.issues.length, offset: cmp.offset }, size: [w, h], shot }
}

module.exports = { designPass, baseOf }
