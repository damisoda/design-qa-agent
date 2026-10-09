// 이슈 묶기: 같은 요소의 중복을 합치고(요소 단위) → 같은 규칙·같은 줄(가로 띠)끼리 묶고(크기 단위) → 크기 사이에서 이어 붙인다(결함 단위).
const { sha1 } = require('../core/util')

const RULE_NAME = { R1: '넘침', R2: '잘림', R3: '겹침', R4: '가려짐', R5: '크기별 줄바꿈', R6: '원치 않는 줄바꿈', R7: '화면 틀 이탈' }
const SEVERITY = { R1: '높음', R2: '중간', R3: '높음', R4: '높음', R5: '낮음', R6: '중간', R7: '높음' }

// 같은 요소·같은 규칙의 이슈를 하나로: 값이 큰 근거를 대표로, 나머지는 보조 근거로 둔다
function mergeByElement (issues) {
  const m = new Map()
  for (const it of issues) {
    const k = `${it.rule}|${it.el.fp}`
    const cur = m.get(k)
    if (!cur) { m.set(k, { ...it, evidence: [ev(it)] }); continue }
    if (!cur.evidence.some((e) => e.text === it.text)) cur.evidence.push(ev(it))
    if (it.metric === 'overflow_px' && cur.metric !== 'overflow_px') Object.assign(cur, { ...it, evidence: cur.evidence })
    else if (it.metric === cur.metric && it.value > cur.value) Object.assign(cur, { ...it, evidence: cur.evidence })
  }
  return [...m.values()]
}
const ev = (it) => ({ metric: it.metric, value: it.value, threshold: it.threshold, text: it.text })

// 같은 규칙이고, 페이지 좌표(스크롤 포함)로 같은 가로 띠에 있거나, 같은 상대(막대·가린 요소)를 가지면 한 묶음
function bandClusters (issues) {
  const items = mergeByElement(issues)
  const clusters = []
  const top = (it) => it.el.box.top + (it.scroll_y || 0); const bot = (it) => it.el.box.bottom + (it.scroll_y || 0)
  for (const it of items) {
    const otherKey = it.other && it.other.kind !== 'text' && it.other.box ? `${it.other.kind}:${it.other.box.top}:${it.other.box.left}` : null
    let c = clusters.find((c) => c.rule === it.rule && ((otherKey && c.otherKey === otherKey) || (!otherKey && !c.otherKey && c.items.some((x) => {
      const ov = Math.min(bot(x), bot(it)) - Math.max(top(x), top(it))
      return ov >= 0.5 * Math.min(bot(x) - top(x), bot(it) - top(it)) || Math.abs(top(x) - top(it)) <= 6
    }))))
    if (!c) { c = { rule: it.rule, otherKey, items: [] }; clusters.push(c) }
    c.items.push(it)
  }
  for (const c of clusters) c.key = `${c.rule}-${sha1(c.items.map((x) => x.el.fp).sort().join('|')).slice(0, 6)}`
  return clusters
}

// 크기별 묶음을 크기 사이에서 이어 붙여 결함 레코드로 만든다
function buildDefects (results, { screen, side, ref }) {
  const order = results.map((r) => `${r.w}x${r.h}`) // 크기 목록 순서(첫 번째가 기준 크기)
  const defects = []
  const okSizes = results.filter((r) => r.ok).map((r) => `${r.w}x${r.h}`)
  for (const r of results.filter((x) => x.ok)) {
    for (const c of bandClusters(r.issues)) {
      const fps = new Set(c.items.map((x) => x.el.fp))
      let d = defects.find((d) => d.rule === c.rule && [...fps].some((f) => d._fps.has(f)))
      if (!d) { d = { rule: c.rule, _fps: new Set(), _el: new Map(), widths: [], evidence: [] }; defects.push(d) }
      for (const f of fps) d._fps.add(f)
      const main = c.items.reduce((a, b) => (b.value > a.value ? b : a))
      for (const it of c.items) if (!d._el.has(it.el.fp)) d._el.set(it.el.fp, { ...it.el, other: it.other || null })
      d.widths.push({ w: r.w, h: r.h, px: main.value, metric: main.metric, canvas_px: r.scale && r.scale !== 1 && /px$/.test(main.metric) ? Math.round(main.value / r.scale) : main.value, scale: r.scale, items: c.items.length, scroll_y: main.scroll_y, step: main.step || 0, crop: main.crop || null, shot: main.shot || null, clean: main.clean || null, text: main.text })
      if (!d.evidence.length) d.evidence = [...new Map(c.items.flatMap((x) => x.evidence || [ev(x)]).map((e) => [e.text, e])).values()].slice(0, 6)
      if (c.items.some((x) => x.intent === 'ellipsis')) d.intent = 'ellipsis'
      d.diag = d.diag || []
      for (const x of c.items) if (x.diag && !d.diag.some((g) => g.code === x.diag.code)) d.diag.push(x.diag)
    }
  }
  return defects.map((d) => {
    const fps = [...d._fps].sort()
    const elements = [...d._el.values()]
    const seen = d.widths.map((x) => `${x.w}x${x.h}`)
    const out = {
      id: `${screen.replace(/\//g, '-')}-${d.rule}-${sha1(fps.join('|')).slice(0, 6)}`,
      rule: d.rule, rule_name: RULE_NAME[d.rule] || d.rule,
      severity: d.intent === 'ellipsis' ? '사람 확인 필요' : SEVERITY[d.rule] || '중간',
      screen, side, ref,
      fps, labels: [...new Set(elements.map((e) => e.label).filter(Boolean))],
      elements: elements.slice(0, 6),
      widths: d.widths.sort((a, b) => a.w - b.w || a.h - b.h),
      max_px: Math.max(...d.widths.map((x) => x.px)),
      only_at: seen.length < okSizes.length ? seen : null,
      evidence: d.evidence.map((e, i) => ({ id: `M${i + 1}`, ...e })),
      diag: (d.diag || []).map((g) => ({ code: g.code, text: g.text })),
      shots: { crop: ([...d.widths].sort((a, b) => order.indexOf(`${a.w}x${a.h}`) - order.indexOf(`${b.w}x${b.h}`)).find((x) => x.crop) || {}).crop || null }
    }
    return out
  })
}

// R5 크기별 줄바꿈: 넓은 화면에서 한 줄인 짧은 글자(8자 이하)가 좁은 화면에서 두 줄 이상이 됨(R6과 겹치면 뺀다)
function crossWidth (results, defects, { screen, side, ref }) {
  const ok = results.filter((r) => r.ok).sort((a, b) => b.w - a.w)
  if (ok.length < 2) return []
  const r6 = new Set(defects.filter((d) => d.rule === 'R6').flatMap((d) => d.fps))
  const widest = new Map(ok[0].lines.map((l) => [l.fp, l.lines]))
  const found = new Map()
  for (const r of ok.slice(1)) {
    for (const l of r.lines) {
      if (widest.get(l.fp) === 1 && l.lines >= 2 && !r6.has(l.fp)) {
        if (!found.has(l.fp)) found.set(l.fp, [])
        found.get(l.fp).push({ w: r.w, h: r.h, px: l.lines, metric: 'lines', canvas_px: l.lines, text: `${ok[0].w}px에서 1줄 → ${r.w}px에서 ${l.lines}줄` })
      }
    }
  }
  return [...found.entries()].map(([fp, widths]) => ({
    id: `${screen.replace(/\//g, '-')}-R5-${sha1(fp).slice(0, 6)}`, rule: 'R5', rule_name: RULE_NAME.R5, severity: SEVERITY.R5,
    screen, side, ref, fps: [fp], labels: [fp.split('|').slice(1).join('|')], elements: [{ fp, label: fp.split('|').slice(1).join('|') }],
    widths, max_px: Math.max(...widths.map((x) => x.px)), only_at: widths.map((x) => `${x.w}x${x.h}`),
    evidence: widths.map((x, i) => ({ id: `M${i + 1}`, metric: 'lines', value: x.px, threshold: 2, text: x.text })), shots: { crop: null }
  }))
}

module.exports = { bandClusters, buildDefects, crossWidth, RULE_NAME, SEVERITY }
