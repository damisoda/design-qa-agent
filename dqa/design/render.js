// design.json만 있고 시안 그림이 없을 때(손으로 쓴 시안, 그림 내보내기가 실패한 REST 가져오기) 값으로 시안 그림을 그린다.
// 노드마다 절대 위치 상자(채움·테두리·모서리)와 글자(글꼴·크기·굵기·줄 높이·색)를 그리고, 그림 노드는 회색 자리로 둔다.
// 사용: node dqa/design/render.js <design.json> [<design.png>]  (기본: 같은 폴더의 design.png)
const fs = require('fs')
const path = require('path')
const { launch } = require('../measure/browser')

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const rgba = (f) => { if (!f || !f.hex) return null; const n = parseInt(f.hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${f.opacity === undefined ? 1 : f.opacity})` }

function html (spec) {
  const fr = spec.frame || { width: 375, height: 812 }
  const out = []
  const walk = (ns) => {
    for (const n of ns || []) {
      const st = [`left:${n.x}px`, `top:${n.y}px`, `width:${n.w}px`, `height:${n.h}px`]
      if (n.fill) st.push(`background:${rgba(n.fill)}`)
      if (n.stroke && n.stroke.width) st.push(`box-shadow:inset 0 0 0 ${n.stroke.width}px ${rgba(n.stroke)}`)
      if (n.radius) st.push(`border-radius:${n.radius}px`)
      if (n.opacity !== undefined) st.push(`opacity:${n.opacity}`)
      if (n.type === 'IMAGE') out.push(`<div class="n img" style="${st.join(';')}"><span>${esc(n.name)}</span></div>`)
      else if (n.type === 'TEXT' && n.text) {
        const t = n.text
        st.push(`font-family:'${String(t.fontFamily || 'sans-serif').replace(/'/g, '')}',-apple-system,'Apple SD Gothic Neo',sans-serif`, `font-size:${t.fontSize}px`, `font-weight:${t.fontWeight || 400}`, `line-height:${t.lineHeight ? t.lineHeight + 'px' : 'normal'}`, `letter-spacing:${t.letterSpacing || 0}px`, `color:${rgba(t.color) || '#000'}`, `text-align:${String(t.align || 'LEFT').toLowerCase().replace('justified', 'justify')}`, t.wrap === 'NONE' ? 'white-space:nowrap' : 'white-space:normal')
        out.push(`<div class="n" style="${st.join(';')}">${esc(t.content)}</div>`)
      } else if (!/^(status ?bar|home ?indicator)$/i.test(String(n.name || ''))) out.push(`<div class="n" style="${st.join(';')}"></div>`)
      walk(n.children)
    }
  }
  walk(spec.nodes)
  return `<!doctype html><meta charset="utf-8"><style>body{margin:0}.f{position:relative;width:${fr.width}px;height:${fr.height}px;overflow:hidden;background:${rgba(fr.fill) || '#fff'}}.n{position:absolute;box-sizing:border-box}.img{background:repeating-linear-gradient(45deg,#d9dde3 0 10px,#e6e9ee 10px 20px);display:flex;align-items:center;justify-content:center;font:12px sans-serif;color:#5b626d}</style><div class="f">${out.join('')}</div>`
}

async function renderDesign (specFile, outFile) {
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'))
  const fr = spec.frame || { width: 375, height: 812 }
  const browser = await launch()
  try {
    const ctx = await browser.newContext({ viewport: { width: fr.width, height: fr.height }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await page.setContent(html(spec))
    await page.locator('.f').screenshot({ path: outFile })
    await ctx.close()
  } finally { await browser.close() }
  return outFile
}

module.exports = { renderDesign, html }
if (require.main === module) {
  const f = process.argv[2]; const o = process.argv[3] || path.join(path.dirname(f), 'design.png')
  renderDesign(f, o).then((p) => console.log(p)).catch((e) => { console.error(e.message); process.exit(2) })
}
