// 시안 비교 결함의 고칠 값(CSS 선언 후보)과 바이브코딩 도구에 붙여 넣을 수정 요청문.
// CSS 후보는 fix.js가 결함 요소의 CSS 규칙 끝에 한 줄씩 넣어 보고, 재측정으로 사라졌는지 확인한다.
const fs = require('fs')
const path = require('path')

// 토큰 이름(color/brand) → 같은 이름의 CSS 변수(--brand, --color-brand)가 소스에 있으면 그 변수
function tokenVar (token, vars) {
  if (!token || !vars) return null
  const last = String(token).split('/').pop().replace(/[^\w-]/g, '-')
  const full = String(token).replace(/[^\w-]+/g, '-')
  return [`--${last}`, `--${full}`, `--color-${last}`].find((v) => vars.has(v)) || null
}
const colorValue = (hex, token, opacity, vars) => {
  const v = tokenVar(token, vars)
  if (opacity !== undefined && opacity !== null && opacity < 1) {
    const n = parseInt(String(hex).replace('#', ''), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`
  }
  return v ? `var(${v})` : hex
}

// 결함 하나의 CSS 선언 후보: [[선언, 이유], …]. 바꿀 수 없는 것(간격·정렬·문구)은 빈 목록
function designCss (d, vars) {
  if (d.kind !== 'design' || !d.design) return []
  const out = []
  for (const v of d.design.values || []) {
    const tok = v.token || null
    if (v.prop === 'color') out.push([`color:${colorValue(v.design, tok, v.opacity, vars)}`, `글자색이 시안(${v.design}${tok ? `, ${tok}` : ''})과 다르다(구현 ${v.impl})`])
    else if (v.prop === 'background-color') out.push([`background-color:${colorValue(v.design, tok, v.opacity, vars)}`, `배경색이 시안(${v.design}${tok ? `, ${tok}` : ''})과 다르다(구현 ${v.impl})`])
    else if (['font-size', 'line-height', 'letter-spacing'].includes(v.prop)) out.push([`${v.prop}:${v.design}`, `글자 ${v.prop}가 시안(${v.design})과 다르다(구현 ${v.impl})`])
    else if (v.prop === 'font-family' && v.font_kind !== 'missing' && v.font_kind !== 'blocked') out.push([`font-family:"${v.design}",sans-serif`, `글꼴이 시안(${v.design})과 다르다(구현 ${v.impl})`])
    else if (v.prop === 'font-weight') out.push([`font-weight:${v.design}`, `글자 굵기가 시안(${v.design})과 다르다(구현 ${v.impl})`])
    else if (v.prop === 'border-radius') out.push([`border-radius:${v.design}px`, `모서리가 시안(${v.design}px)과 다르다(구현 ${v.impl}px)`])
    else if (v.prop === 'border-width') out.push([`border-width:${v.design}px`, `테두리 두께가 시안(${v.design}px)과 다르다`])
    else if (v.prop === 'border-color') out.push([`border-color:${colorValue(v.design, tok, null, vars)}`, `테두리 색이 시안(${v.design})과 다르다(구현 ${v.impl})`])
    else if (v.prop === 'width' && v.design === 'FILL') {
      out.push(['flex:1 1 0%;min-width:0', '시안은 부모를 채우는 Fill인데 구현은 고정 폭이다. 가로 줄 안이면 남는 폭을 나눠 갖게 한다'])
      out.push(['width:100%;align-self:stretch;box-sizing:border-box', '시안은 부모를 채우는 Fill인데 구현은 고정 폭이다. 부모 폭을 채운다'])
    } else if (v.prop === 'width' && /\(제약\)$/.test(String(v.design))) {
      out.push(['left:0;right:0;width:auto', '시안은 좌우 늘림 제약인데 구현은 고정 폭이다. 절대 위치라면 양쪽 끝에 붙인다'])
      out.push(['width:100%;box-sizing:border-box', '시안은 좌우 늘림 제약인데 구현은 고정 폭이다. 화면 폭을 채운다'])
    } else if (v.prop === 'bottom' && /제약 MAX/.test(String(v.design))) {
      const px = (String(v.design).match(/bottom (\d+)px/) || [])[1] || 0
      out.push([`top:auto;bottom:${px}px`, '시안은 화면 아래에 붙는 제약(MAX)인데 구현은 위에서부터 잰 위치다. 아래 기준으로 둔다'])
      out.push([`position:fixed;left:0;right:0;bottom:${px}px`, '스크롤해도 화면 아래에 붙어 있어야 하면 fixed로 둔다(본문 아래에 이 높이만큼 여백이 필요하다)'])
    } else if (v.prop === 'width' && v.design === 'FIXED' && d.design.node && d.design.node.box) out.push([`width:${d.design.node.box.w}px;flex:none`, `시안은 고정 폭(${d.design.node.box.w}px)인데 구현은 화면에 따라 늘어난다`])
  }
  // 같은 선언은 한 번만(글자 스타일 여러 개는 한 줄로 합쳐 한 번에 시도)
  const seen = new Set(); const uniq = out.filter(([x]) => (seen.has(x) ? false : seen.add(x)))
  if (d.rule === 'D3' && uniq.length > 1) return [[uniq.map(([x]) => x).join(';'), uniq.map(([, w]) => w).join(', ')]]
  return uniq
}

// 문구 다름(T1): 구현 문구가 소스 파일 전체에서 정확히 한 번 나오면 시안 문구로 바꾸는 수정 후보
const SRC_EXT = /\.(html|jsx|tsx|js|ts|vue|svelte|mdx?)$/
function srcFiles (root) {
  const out = []
  const walk = (dir, depth) => {
    let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
    for (const n of list) {
      if (n.name.startsWith('.') || /^(node_modules|dist|build|out|coverage)$/.test(n.name) || /^dist-dqa/.test(n.name)) continue
      const f = path.join(dir, n.name)
      if (n.isDirectory() && depth < 6) walk(f, depth + 1)
      else if (SRC_EXT.test(n.name)) { try { if (fs.statSync(f).size < 300000) out.push(f) } catch (e) {} }
    }
  }
  walk(root, 0)
  return out.slice(0, 400)
}
function textEdits (d, srcRoot) {
  if (d.kind !== 'design' || d.rule !== 'T1' || !srcRoot) return []
  const v = (d.design.values || [])[0]; if (!v || !v.impl || !v.design || v.impl.length < 2) return []
  const hits = []
  for (const f of srcFiles(srcRoot)) {
    const text = fs.readFileSync(f, 'utf8'); const k = text.split(v.impl).length - 1
    if (k) hits.push({ f, k, text })
    if (hits.length > 1) return []
  }
  if (hits.length !== 1 || hits[0].k !== 1) return []
  const h = hits[0]; const at = h.text.indexOf(v.impl)
  const ls = h.text.lastIndexOf('\n', at) + 1; const le = h.text.indexOf('\n', at); const line = h.text.slice(ls, le < 0 ? undefined : le)
  if (line.split(v.impl).length - 1 !== 1 || h.text.split(line).length - 1 !== 1) return []
  return [{ source: 'text', file: path.relative(srcRoot, h.f), line: h.text.slice(0, at).split('\n').length, find: line, replace: line.replace(v.impl, v.design), why: `문구가 시안("${v.design}")과 다르다(구현 "${v.impl}"). 소스에서 한 번만 나오는 문구를 시안 문구로 바꾼다` }]
}

// 소스의 CSS 변수 이름(--brand 등). 제안 CSS에서 토큰을 변수로 쓰려고 모은다
function cssVars (root) {
  const vars = new Set(); if (!root) return vars
  const walk = (dir, depth) => {
    let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
    for (const n of list) {
      if (n.name.startsWith('.') || /^(node_modules|coverage)$/.test(n.name) || /^dist-dqa/.test(n.name)) continue
      const f = path.join(dir, n.name)
      if (n.isDirectory() && depth < 5) walk(f, depth + 1)
      else if (/\.(css|scss|html)$/.test(n.name)) { try { if (fs.statSync(f).size < 400000) for (const m of fs.readFileSync(f, 'utf8').matchAll(/(--[\w-]+)\s*:/g)) vars.add(m[1]) } catch (e) {} }
    }
  }
  walk(root, 0)
  return vars
}

// Tailwind처럼 유틸리티 클래스로 스타일을 쓴 요소면, CSS 규칙 대신 바꿀 클래스를 제안한다(.flex { … } 같은 틀린 제안을 막는다)
const TW = /^(-?m[trblxy]?-|p[trblxy]?-|w-|h-|min-w-|max-w-|flex|grid|gap-|items-|justify-|self-|text-|bg-|rounded|border|font-|leading-|tracking-|shadow|opacity-|space-[xy]-|inline|block|hidden|relative|absolute|fixed|sticky|top-|left-|right-|bottom-|z-|overflow-|truncate|whitespace-|object-)/
const isTailwind = (cls) => (cls || []).filter((c) => TW.test(c)).length >= 2
const px = (v) => String(v).replace(/px$/, '')
function twSuggest (d) {
  const el = (d.elements || [])[0] || {}
  if (!isTailwind(el.cls)) return null
  const out = []
  const swap = (re, add, why) => { const old = (el.cls || []).filter((c) => re.test(c)); out.push(`${old.length ? `${old.join(' ')} → ` : ''}${add}${why ? ` (${why})` : ''}`) }
  for (const v of (d.design && d.design.values) || []) {
    if (v.prop === 'background-color') swap(/^bg-(?!opacity|clip|origin|cover|contain|center|no-repeat|gradient|fixed|local|scroll|none)/, `bg-[${v.design}]`, v.token || '')
    else if (v.prop === 'color') swap(/^text-(?!xs$|sm$|base$|lg$|xl$|\d|left|center|right|justify|start|end|wrap|nowrap|ellipsis|clip|\[\d)/, `text-[${v.design}]`, v.token || '')
    else if (v.prop === 'font-size') swap(/^text-(xs|sm|base|lg|xl|\dxl|\[\d)/, `text-[${px(v.design)}px]`)
    else if (v.prop === 'font-weight') swap(/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[)/, `font-[${v.design}]`)
    else if (v.prop === 'line-height') swap(/^leading-/, `leading-[${px(v.design)}px]`)
    else if (v.prop === 'letter-spacing') swap(/^tracking-/, `tracking-[${px(v.design)}px]`)
    else if (v.prop === 'border-radius') swap(/^rounded(-(none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]*\]))?$/, `rounded-[${px(v.design)}px]`)
    else if (v.prop === 'border-width') swap(/^border(-\d|-\[)?$/, `border-[${px(v.design)}px]`)
    else if (v.prop === 'border-color') swap(/^border-(?!\d|t$|b$|l$|r$|x$|y$|solid|dashed|dotted|none|\[\d)/, `border-[${v.design}]`)
    else if (v.prop === 'width' && v.design === 'FILL') swap(/^w-/, 'flex-1 min-w-0', '가로 줄 안이면. 세로 쌓임이면 w-full')
    else if (v.prop === 'width' && v.design === 'FIXED' && d.design.node && d.design.node.box) swap(/^(w-|flex-1$|grow$)/, `w-[${d.design.node.box.w}px] flex-none`)
    else if (v.prop === 'margin-top') swap(/^(mt-|my-)/, `mt-[?]`, `간격 ${v.impl}px → ${v.design}px가 되게`)
    else if (v.prop === 'margin-left') swap(/^(ml-|mx-)/, `ml-[?]`, `간격 ${v.impl}px → ${v.design}px가 되게`)
  }
  return out.length ? out : null
}

// 수정 요청문: 사람이나 바이브코딩 도구(Cursor·Claude Code 등)에 붙여 넣는 짧은 글. 숫자는 모두 dqa가 잰 값이다
function brief (d, { title, vars } = {}) {
  const el = (d.elements || [])[0] || {}
  const own = (el.cls || []).filter((c) => !/^(css-|r-)/.test(c)) // react-native-web의 자동 생성 클래스는 이름으로 쓸 수 없다
  const sel = isTailwind(el.cls) ? `class="${el.cls.join(' ')}${el.cls.length >= 6 ? ' …' : ''}"` : own.length ? `.${own[0]}` : (el.cls || []).length ? null : el.tag ? `${el.pcls && el.pcls.length ? `.${el.pcls[0]} ` : ''}${el.tag}` : null
  const sizes = (d.widths || []).map((w) => `${w.w}×${w.h}`)
  const lines = [`[dqa] ${title || d.screen_title || d.screen} · ${d.rule} ${d.rule_name}${d.diff ? ` · ${{ new: '새로 생김', worsened: '악화', unchanged: '기존', improved: '나아짐' }[d.diff.status] || d.diff.status}` : ''}`]
  const fontMissing = d.kind === 'design' && d.design && (d.design.values || []).every((v) => v.font_kind === 'missing' || v.font_kind === 'blocked')
  if (fontMissing) lines.push(`- 요소: 화면 전체(${(d.labels || [])[0] || ''})`)
  else lines.push(`- 요소: "${(d.labels || [])[0] || el.label || ''}"${sel ? ` (${sel})` : ''}${el.path ? `, DOM ${el.path}` : ''}`)
  if (d.kind === 'design' && d.design) {
    const n = d.design.node || {}
    lines.push(`- 시안: Figma 노드 "${n.name || ''}"(${n.id || ''}), ${n.box ? `${n.box.w}×${n.box.h}` : ''} · 비교 크기 ${sizes.join(', ')}`)
    for (const v of d.design.values || []) lines.push(`- ${v.prop || '값'}: 시안 ${v.design} / 구현 ${v.impl}${v.at === 'alt' ? ' (화면을 넓혔을 때)' : v.at === 'tall' ? ' (화면을 길게 했을 때)' : ''}`)
  } else if (d.kind === 'interact') {
    lines.push(`- 관찰(${sizes.join(', ')}): ${(d.widths || [])[0] ? d.widths[0].text : ''}`)
    if (d.interact && d.interact.errors && d.interact.errors.length) lines.push(`- 오류: ${d.interact.errors[0]}${d.interact.stack ? ` (스택: ${d.interact.stack})` : ''}`)
  } else {
    lines.push(`- 측정: ${(d.widths || []).slice(0, 5).map((w) => `${w.w}×${w.h} ${w.text || w.px}`).join(' · ')}`)
    if (d.rule_text) lines.push(`- 원인과 방향: ${d.rule_text.cause} ${d.rule_text.fix}`)
  }
  const css = d.kind === 'design' ? designCss(d, vars) : []
  const tw = d.kind === 'design' && !fontMissing ? twSuggest(d) : null
  if (tw) lines.push(`- 제안 클래스(Tailwind): ${tw.join(' · ')}`)
  else if (css.length && sel && !fontMissing) lines.push(`- 제안 CSS: \`${sel} { ${css[0][0].replace(/;/g, '; ')} }\`${css.length > 1 ? ` (안 되면 \`${css[1][0].replace(/;/g, '; ')}\`)` : ''}`)
  if (d.kind === 'design' && ['L1', 'L2'].includes(d.rule)) lines.push('- 방향: 위 숫자만큼 여백(margin·gap·padding)을 맞춘다. 어느 쪽 여백인지는 소스에서 확인한다')
  if (d.kind === 'design' && d.rule === 'M1') lines.push('- 방향: 시안에 있는 이 글자가 화면에 없다. 빠진 요소인지, 조건부로 숨겨졌는지 확인한다')
  if (d.kind === 'design' && d.rule === 'M2') lines.push('- 방향: 시안의 그림이 그 자리에 없다. 그림 파일 경로·불러오기 실패·조건부 렌더링을 확인한다')
  if (d.kind === 'design' && (d.design.values || []).some((v) => v.font_kind === 'missing')) lines.push('- 방향: 시안 글꼴 파일을 불러오지 않아 대체 글꼴로 그려진다. @font-face나 <link>로 글꼴을 불러온다(글꼴 이름만 적으면 설치된 컴퓨터에서만 보인다)')
  if (d.kind === 'design' && (d.design.values || []).some((v) => v.font_kind === 'blocked')) lines.push('- 방향: 구현은 외부 글꼴을 불러오지만 검사 중에는 외부 요청을 막아 적용 여부를 확인하지 못했다. 실제 화면에서 글꼴이 적용되는지 보거나, 글꼴 파일을 프로젝트에 넣어(self-host) 다시 검사한다')
  if (d.rule === 'G1') lines.push(`- 방향: 기호 글자를 SVG 아이콘(시안 아이콘을 내보낸 것)이나 앱에 넣은 아이콘 글꼴로 바꾼다. 기호 글자는 폰 글꼴에 없으면 □로 깨지고, 기기마다 모양·크기가 다르다`)
  if (d.kind === 'interact' && d.interact && d.interact.design_only) lines.push(`- 방향: 시안의 누름 연결을 구현한다. 이 요소를 button(또는 href 있는 a)으로 만들고 누름 처리기(시안 연결 대상)로 잇는다. 지금은 ${d.interact.why_not}`)
  if (d.kind === 'interact') lines.push(`- 방향: ${d.rule === 'I1' ? '누름 처리기(onClick·href·라우터 연결)가 없거나 빈 함수인지, 위에 투명한 요소가 덮여 있는지 확인한다' : d.rule === 'I2' ? '누를 때 나는 스크립트 오류를 고친다(콘솔 오류 참고)' : '이동하는 경로(라우트)가 실제로 있는지, 그 화면이 내용을 그리는지 확인한다'}`)
  const c = d.causes && d.causes.candidates && d.causes.candidates[0]
  if (c) lines.push(`- 원인 후보: ${c.file}:${c.line}${c.why && c.why.length ? ` (${c.why.slice(0, 2).join(', ')})` : ''}`)
  lines.push('- 확인: 고친 뒤 dqa로 다시 검사해 이 항목이 사라지는지 본다')
  return lines.join('\n')
}

// 실행 전체의 수정 요청문(brief.md): 새로 생김·악화·상태 없음 결함만, 심각도 순
function briefMd (m, defects) {
  const live = defects.filter((d) => !d.accepted && (!d.diff || ['new', 'worsened'].includes(d.diff.status)))
  const head = [`# dqa 수정 요청 · ${m.title}`, '', `대상 ${m.targets && m.targets.head ? m.targets.head.ref : ''} · 결함 ${live.length}건${m.design ? ` · 시안 ${Object.values(m.design).map((x) => x.frame).join(', ')}` : ''}. 숫자는 모두 dqa가 브라우저에서 잰 값이다. 한 항목씩 고치고 다시 검사한다.`, '']
  return head.concat(live.map((d, i) => `## ${i + 1}. ${d.rule} ${d.rule_name} · ${(d.labels || []).slice(0, 2).join(', ')}\n\n${d.brief || brief(d)}\n`)).join('\n')
}

module.exports = { designCss, textEdits, brief, briefMd, tokenVar, cssVars, twSuggest, isTailwind }
