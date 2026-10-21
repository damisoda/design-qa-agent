// 눌러 보기 검사용 페이지 함수(page.evaluate로 넘긴다, 바깥 변수를 쓰지 않는다).

// 누를 수 있는 요소 목록: 버튼·링크·역할이 있는 요소·누름 처리기·손가락 커서. 요소마다 data-dqa-c 번호를 붙인다
function dqaClickables (opt) {
  opt = opt || {}
  const css = (e) => getComputedStyle(e)
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = css(e); return r.width >= 8 && r.height >= 8 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 }
  const SEM = 'a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=switch],[role=checkbox],[role=option],input[type=submit],input[type=button],input[type=reset],input[type=checkbox],input[type=radio],summary,[onclick]'
  const sem = new Set([...document.querySelectorAll(SEM)])
  // 의미 없는 요소라도 손가락 커서이고 부모는 아니면(바깥쪽 하나) 누를 수 있는 것으로 본다
  for (const el of document.body.querySelectorAll('div,span,li,img,svg,p,label,section,article')) {
    if (sem.has(el) || css(el).cursor !== 'pointer') continue
    const p = el.parentElement; if (p && css(p).cursor === 'pointer') continue
    if ([...sem].some((s) => el.contains(s) || s.contains(el))) continue
    sem.add(el)
  }
  // 시안에서 프로토타입 연결이 걸린 글자인데 위에서 잡히지 않은 것(href 없는 a, 처리기 없는 div 등)도 눌러 본다.
  // 그 글자를 감싼 가장 가까운 a·button·역할 요소, 없으면 글자 요소 자체를 후보로 넣고 시안에서 왔다고 표시한다
  const nl = (t) => String(t || '').normalize('NFC').replace(/\s+/g, ' ').trim()
  const fromDesign = new Set()
  for (const want of (opt.want || []).map(nl)) {
    if (!want || [...sem].some((s) => nl(s.getAttribute('aria-label') || s.textContent) === want)) continue
    const leaf = [...document.body.querySelectorAll('*')].find((e) => !e.children.length && nl(e.textContent) === want && vis(e))
    if (!leaf) continue
    const el = leaf.closest('a,button,[role],[onclick],[tabindex]') || leaf
    if (sem.has(el)) continue
    sem.add(el); fromDesign.add(el)
  }
  const label = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.value || el.getAttribute('alt') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
  const domPath = (el) => {
    const parts = []
    for (let e = el; e && e !== document.body && parts.length < 8; e = e.parentElement) {
      const p = e.parentElement; const same = p ? [...p.children].filter((c) => c.tagName === e.tagName) : []
      parts.unshift(e.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : ''))
    }
    return parts.join('>')
  }
  const out = []
  let k = 0
  for (const el of [...sem].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))) {
    if (!vis(el) || el.closest('[aria-hidden="true"]')) continue
    // 안쪽에 다른 후보가 있으면 바깥 것은 뺀다(카드 링크 안의 버튼은 버튼만)
    const inner = [...sem].some((s) => s !== el && el.contains(s) && vis(s))
    if (inner && !/^(A|BUTTON)$/.test(el.tagName)) continue
    const r = el.getBoundingClientRect()
    el.setAttribute('data-dqa-c', String(k))
    const href = el.getAttribute('href')
    // 지금 화면을 가리키는 링크·선택된 탭(눌러도 그대로인 것이 정상)
    let samePage = false; try { samePage = !!href && !href.startsWith('#') && new URL(href, location.href).pathname === location.pathname } catch (e) {}
    const current = samePage || el.getAttribute('aria-current') === 'page' || el.getAttribute('aria-current') === 'true' || (el.getAttribute('role') === 'tab' && el.getAttribute('aria-selected') === 'true')
    out.push({ current,
      k, tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), type: el.getAttribute('type'), label: label(el), path: domPath(el),
      cls: [...el.classList].slice(0, 6), pcls: el.parentElement ? [...el.parentElement.classList].slice(0, 4) : [],
      box: { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height },
      disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      href, external: !!(href && /^(https?:)?\/\//.test(href) && !href.startsWith(location.origin)), scheme: href && /^(mailto|tel|sms):/.test(href) ? href.split(':')[0] : null,
      target: el.getAttribute('target'), in_form: !!el.closest('form'), cursor: css(el).cursor,
      design_only: fromDesign.has(el), why_not: fromDesign.has(el) ? (el.tagName === 'A' && !href ? 'a에 href가 없다' : `<${el.tagName.toLowerCase()}>는 누를 수 있는 요소가 아니다`) : null
    })
    if (++k >= (opt.max || 30)) break
  }
  return out
}

// 누르기 전 관찰 시작: DOM 변화, 입력 상태, 주소, 스크롤, 초점
function dqaObserveStart (k) {
  const el = document.querySelector(`[data-dqa-c="${k}"]`)
  const inputs = [...document.querySelectorAll('input,select,textarea,details,dialog')].map((e) => [e.checked, e.value, e.open].join('|'))
  const st = { mut: { child: 0, attr: 0, text: 0 }, samples: [], url: location.href, hist: history.length, scroll: [scrollX, scrollY], inputs, active: document.activeElement, el }
  st.obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'attributes' && /^data-dqa/.test(m.attributeName)) continue
      if (m.type === 'attributes' && m.target === el && /^(class|style)$/.test(m.attributeName) && m.target === document.activeElement) { st.mut.attr += 0; continue } // 눌린 요소 자체의 초점 모양만 바뀐 것은 반응이 아니다
      if (m.type === 'childList') st.mut.child += m.addedNodes.length + m.removedNodes.length
      else if (m.type === 'attributes') st.mut.attr++
      else st.mut.text++
      if (st.samples.length < 5) st.samples.push(m.type === 'attributes' ? `${m.target.tagName.toLowerCase()}@${m.attributeName}` : m.type === 'childList' ? `${m.target.tagName ? m.target.tagName.toLowerCase() : '#'}+${m.addedNodes.length}-${m.removedNodes.length}` : 'text')
    }
  })
  st.obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
  window.__dqaObs = st
  return true
}

// 누른 뒤 관찰 끝: 무엇이 바뀌었는지
function dqaObserveEnd () {
  const st = window.__dqaObs
  if (!st) return null
  st.obs.disconnect()
  const inputs = [...document.querySelectorAll('input,select,textarea,details,dialog')].map((e) => [e.checked, e.value, e.open].join('|'))
  const changedInputs = inputs.length !== st.inputs.length || inputs.some((v, i) => v !== st.inputs[i])
  const ae = document.activeElement
  const focusMoved = ae && ae !== st.active && ae !== st.el && !(st.el && st.el.contains(ae)) && ae !== document.body
  const body = (document.body && document.body.innerText || '').trim()
  return {
    mut: st.mut, samples: st.samples, url_before: st.url, url: location.href, hist: history.length - st.hist,
    scrolled: Math.abs(scrollX - st.scroll[0]) + Math.abs(scrollY - st.scroll[1]) > 2, inputs: changedInputs, focus: !!focusMoved,
    body_len: body.length, not_found: /(^|\s)(404|not found|페이지를 찾을 수 없|존재하지 않는 페이지|cannot get)/i.test(body.slice(0, 400))
  }
}

// 눌렀을 때 실제로 맞는 요소(가려져 있으면 다른 요소)
function dqaHitAt (arg) {
  const el = document.querySelector(`[data-dqa-c="${arg.k}"]`)
  if (!el) return { ok: false, gone: true }
  const r = el.getBoundingClientRect()
  const x = r.left + r.width / 2; const y = r.top + r.height / 2
  const top = document.elementFromPoint(x, y)
  const lab = (n) => n ? `${n.tagName.toLowerCase()}${n.classList.length ? '.' + [...n.classList].slice(0, 2).join('.') : ''}` : null
  const ok = !!top && (top === el || el.contains(top) || (top.tagName === 'LABEL' && top.control === el))
  return { ok, x, y, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, top: ok ? null : lab(top), inView: y >= 0 && y <= innerHeight && x >= 0 && x <= innerWidth }
}

function dqaOutline (k) {
  const el = document.querySelector(`[data-dqa-c="${k}"]`)
  if (!el) return
  const r = el.getBoundingClientRect()
  const d = document.createElement('div')
  d.setAttribute('data-dqa-outline', '1')
  Object.assign(d.style, { position: 'fixed', left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px`, border: '3px solid #e5487a', borderRadius: '6px', zIndex: 2147483647, pointerEvents: 'none', boxSizing: 'border-box' })
  document.body.appendChild(d)
}

module.exports = { dqaClickables, dqaObserveStart, dqaObserveEnd, dqaHitAt, dqaOutline }
