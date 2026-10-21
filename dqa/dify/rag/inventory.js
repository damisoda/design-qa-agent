// Browser facts only. CSSOM media conditions include currently inactive rules.
function collectInventory () {
  const media = []; let inaccessible = 0
  const walk = rules => { for (const r of rules) { if (r.conditionText && /(?:min|max)-(?:width|height)/.test(r.conditionText)) media.push(r.conditionText); if (r.cssRules) walk(r.cssRules) } }
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules) } catch (e) { inaccessible++ } }
  return { media: [...new Set(media)].slice(0, 32), inaccessible_stylesheets: inaccessible,
    clickables: [...document.querySelectorAll('button,a[href],[role="button"]')].filter(e => !e.disabled && e.getBoundingClientRect().width > 0).slice(0, 12).map(e => ({ tag: e.tagName.toLowerCase(), label: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 80) })) }
}
function boundarySizes (media, sizes) {
  const base = sizes[0] || [375,812]; const known = new Set(sizes.map(s => s.slice(0,2).join('x'))); const out = []
  for (const condition of media || []) {
    for (const m of condition.matchAll(/(?:min|max)-(width|height)\s*:\s*(\d+(?:\.\d+)?)px/gi)) {
      const axis = m[1].toLowerCase(); const n = Number(m[2]); if (!Number.isFinite(n)) continue
      for (const v of [Math.ceil(n), Math.ceil(n) + 1, Math.floor(n) - 1]) {
        const size = axis === 'width' ? [v, base[1]] : [base[0], v]
        if (size[0] < 320 || size[0] > 430 || size[1] < 568 || size[1] > 932 || known.has(size.join('x'))) continue
        known.add(size.join('x')); out.push(size)
      }
    }
  }
  return out.slice(0, 4)
}
function queriesFor (screen, inventory, sizes, interact) {
  const queries = []
  if (boundarySizes(inventory.media, sizes).length) queries.push({ id:screen+'/viewport',screen,kind:'recipe',recipe:'viewport-boundary',query:'web viewport-boundary media query breakpoint responsive viewport width height 경계 반응형 추가 측정' })
  if (interact && inventory.clickables.length) queries.push({ id:screen+'/click',screen,kind:'recipe',recipe:'interaction-width',query:'web interaction-width button link click navigation responsive narrow wide 눌림 반응 추가 측정' })
  return queries
}
module.exports = { collectInventory, boundarySizes, queriesFor }
