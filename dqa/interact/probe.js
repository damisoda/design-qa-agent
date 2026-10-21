// 눌러 보기 검사: 화면의 버튼·링크를 하나씩 실제로 눌러, 아무 반응이 없거나(I1) 오류가 나거나(I2)
// 빈 화면·404로 가는(I3) 것을 찾는다. 반응은 주소 변화, DOM 변화, 입력 상태, 초점 이동, 스크롤, 요청, 새 창, 알림창, 화면 픽셀로 본다.
// 안전: 쓰기 요청(POST·PUT·PATCH·DELETE)은 서버에 보내지 않고 가짜 성공 응답을 준다(요청을 시도한 것 자체를 반응으로 센다).
// 반응이 있었던 요소 다음에는 화면에 다시 들어가 처음 상태에서 누른다.
const path = require('path')
const fs = require('fs')
const { newContext, settle, fonts } = require('../measure/browser')
const { enterScreen } = require('../recipes/runner')
const { dqaClickables, dqaObserveStart, dqaObserveEnd, dqaHitAt, dqaOutline } = require('./inpage')
const { sha1 } = require('../core/util')

const { checkDestination, destinationText } = require('./expected')
const RULE_NAME = { I1: '눌러도 반응 없음', I2: '누르면 오류', I3: '이동했지만 빈 화면', I4: '시안 연결과 다른 목적지' }
const norm = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim()

// 시안의 프로토타입 연결: 글자로 찾는다(버튼 노드나 그 안 글자의 내용이 라벨과 같으면)
function designReactions (spec) {
  const out = new Map()
  const walk = (ns, inherited) => {
    for (const n of ns || []) {
      const acts = (n.reactions || []).filter((r) => !r.trigger || r.trigger === 'ON_CLICK').flatMap((r) => r.actions || []).filter((a) => a && (a.type === 'NODE' || a.type === 'URL' || a.type === 'BACK'))
      const mine = acts.length ? { node: n.name, id: n.id, actions: acts } : inherited
      if (n.text && n.text.content && mine) out.set(norm(n.text.content), mine)
      if (acts.length && n.name) out.set(norm(n.name), mine)
      walk(n.children, mine)
    }
  }
  walk(spec && spec.nodes)
  return out
}

async function openScreen (browser, { origin, recipe, w, h, cfg, counters }) {
  const ctx = await newContext(browser, { origin, width: w, height: h, allowHosts: recipe.allow_hosts, blocked: counters.blocked, stubs: recipe._stubs, stubbed: [], writes: counters.writes })
  const page = await ctx.newPage()
  // 오류 메시지와 함께 스택 맨 위 몇 줄(번들 안의 함수 이름·위치)을 남긴다(원인 찾기용)
  page.on('pageerror', (e) => { counters.errors.push(String(e.message || e).split('\n')[0].slice(0, 200)); counters.stacks.push(String(e.stack || '').split('\n').slice(1, 4).map((l) => l.trim().replace(origin, '')).join(' ← ').slice(0, 300)) })
  page.on('console', (msg) => { if (msg.type() === 'error') counters.console.push(msg.text().slice(0, 200)) })
  page.on('request', () => { counters.requests++ })
  page.on('dialog', (d) => { counters.dialogs.push(d.type()); d.dismiss().catch(() => {}) })
  ctx.on('page', (p) => { counters.popups++; p.close().catch(() => {}) })
  await enterScreen(page, recipe, { origin, stepMs: cfg.timeouts.step_ms, gotoMs: cfg.timeouts.goto_ms, settleMs: cfg.timeouts.settle_ms })
  await fonts(page); await settle(page, { stableMs: 200, timeoutMs: 2000 })
  return { ctx, page }
}

// 한 화면을 한 크기로 눌러 보기. 결과: 요소별 관찰과 결함 레코드
async function interactPass (browser, { origin, recipe, side, ref, run, cfg, size, spec, max }) {
  const [w, h] = size
  const counters = { blocked: [], writes: [], errors: [], stacks: [], console: [], requests: 0, dialogs: [], popups: 0 }
  const expected = designReactions(spec)
  let cur = await openScreen(browser, { origin, recipe, w, h, cfg, counters })
  const list = await cur.page.evaluate(dqaClickables, { max: max || 30, want: [...expected.keys()] })
  const results = []
  run.live?.stage('interact', 'running', `누를 수 있는 요소 ${list.length}개를 확인하고 있습니다`)
  const tag = `${side}/${recipe.id.replace(/\//g, '_')}_interact_${w}x${h}`
  fs.mkdirSync(path.dirname(run.file(path.join('shots', tag))), { recursive: true })
  try {
    for (const c of list) {
      run.live?.stage('interact', 'running', `${side === 'head' ? '변경 후' : '변경 전'} ${results.length + 1}/${list.length} · ${c.label || '요소'}의 반응을 기다리고 있습니다`)
      const exp = expected.get(norm(c.label)) || null
      const rec = { ...c, expected: exp ? { node: exp.node, actions: exp.actions } : null }
      results.push(rec)
      if (c.disabled) { rec.skip = '비활성(disabled)'; continue }
      if (c.external || c.scheme) { rec.skip = c.scheme ? `${c.scheme} 링크` : '외부 링크(누르지 않음)'; continue }
      // 같은 번호의 요소를 다시 찾는다(화면에 다시 들어갔으면 번호를 다시 붙인다)
      let hit = await cur.page.evaluate(dqaHitAt, { k: c.k }).catch(() => ({ ok: false, gone: true }))
      if (hit.gone) { rec.skip = '다시 들어간 화면에서 찾지 못함'; continue }
      if (!hit.inView) { await cur.page.locator(`[data-dqa-c="${c.k}"]`).scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {}); await settle(cur.page, { stableMs: 150, timeoutMs: 1000 }); hit = await cur.page.evaluate(dqaHitAt, { k: c.k }) }
      // 마우스를 먼저 올려 둔다(올리기만 해서 생기는 변화는 반응으로 세지 않는다)
      await cur.page.mouse.move(hit.x, hit.y); await cur.page.waitForTimeout(150)
      const before = await cur.page.screenshot({ type: 'png' }).catch(() => null)
      let inspection = null
      if (run.live && before) {
        const shot = path.join('shots', `${tag}_${c.k}_scan.png`); fs.writeFileSync(run.file(shot), before)
        const figmaNode = exp && require('../design/compare').flatten(spec).find(n => n.id === exp.id)
        const context = { phase: 'interact', side, screen: recipe.id, title: recipe.title, size: `${w}x${h}`, width: w, height: h, shot }
        const row = { test: 'click', ordinal: results.length, total: list.length, element: { ...c, path: c.path || String(c.k), box: hit.box || c.box, style: {} }, figma: figmaNode ? { id: figmaNode.id, name: figmaNode.name, box: { left: figmaNode.x, top: figmaNode.y, width: figmaNode.w, height: figmaNode.h } } : null }
        inspection = { context, row }; run.live.inspect(context, { ...row, status: 'checking' })
      }
      const n0 = { req: counters.requests, err: counters.errors.length, con: counters.console.length, dlg: counters.dialogs.length, pop: counters.popups, wr: counters.writes.length }
      await cur.page.evaluate(dqaObserveStart, c.k)
      await cur.page.mouse.click(hit.x, hit.y)
      await settle(cur.page, { stableMs: 250, timeoutMs: 1500 }).catch(() => {})
      const ob = await cur.page.evaluate(dqaObserveEnd).catch(() => null) // 다른 문서로 이동했으면 null
      const after = (ob || side.startsWith('fix')) ? await cur.page.screenshot({ type: 'png' }).catch(() => null) : null
      const urlNow = cur.page.url()
      const navigated = !ob || (ob.url !== ob.url_before)
      const onlyHash = ob && ob.url !== ob.url_before && ob.url.replace(/#$/, '') === ob.url_before.replace(/#$/, '') // href="#"만
      const errors = counters.errors.slice(n0.err)
      rec.stack = counters.stacks.slice(n0.err)[0] || null
      const signals = []
      if (navigated && !onlyHash) signals.push(`주소 이동 → ${urlNow.replace(origin, '') || '/'}`)
      if (ob && ob.hist > 0 && !onlyHash) signals.push('방문 기록 추가')
      if (ob && (ob.mut.child || ob.mut.attr || ob.mut.text)) signals.push(`DOM 변화(${ob.samples.join(', ')})`)
      if (ob && ob.inputs) signals.push('입력 상태 바뀜')
      if (ob && ob.focus) signals.push('초점 이동')
      if (ob && ob.scrolled) signals.push('스크롤')
      if (counters.requests > n0.req) signals.push(`요청 ${counters.requests - n0.req}건`)
      if (counters.writes.length > n0.wr) signals.push(`쓰기 요청 ${counters.writes.slice(n0.wr).map((x) => x.method).join(',')}(가짜 응답)`)
      if (counters.dialogs.length > n0.dlg) signals.push('알림창')
      if (counters.popups > n0.pop) signals.push('새 창')
      if (!signals.length && before && after && !before.equals(after)) signals.push('화면 픽셀 바뀜')
      if (side.startsWith('fix') && after) {
        rec.after_shot = path.join('shots', `${tag}_${c.k}_after.png`)
        fs.mkdirSync(path.dirname(run.file(rec.after_shot)), { recursive: true })
        fs.writeFileSync(run.file(rec.after_shot), after)
      }
      rec.signals = signals
      rec.errors = errors
      // 이동한 곳이 빈 화면이거나 404인지
      if (navigated && !onlyHash) {
        let page2 = ob
        if (!page2) { await settle(cur.page, { stableMs: 300, timeoutMs: 2500 }).catch(() => {}); page2 = await cur.page.evaluate(() => { const b = (document.body && document.body.innerText || '').trim(); return { body_len: b.length, not_found: /(^|\s)(404|not found|페이지를 찾을 수 없|존재하지 않는 페이지|cannot get)/i.test(b.slice(0, 400)) } }).catch(() => ({ body_len: 0, not_found: false })) }
        rec.landing = { url: urlNow.replace(origin, '') || '/', body_len: page2.body_len, not_found: page2.not_found }
      }
      if (exp) {
        const landingText = await cur.page.evaluate(destinationText).catch(() => undefined)
        rec.prototype_check = checkDestination(exp.actions, spec, { before_url: ob ? ob.url_before : origin, url: urlNow, body_text: landingText })
      }
      if (errors.length) rec.verdict = 'I2'
      else if (rec.landing && (rec.landing.not_found || rec.landing.body_len < 2)) rec.verdict = 'I3'
      else if (!signals.length && c.current) rec.skip = '지금 화면을 가리키는 링크·선택된 탭(반응 없음이 정상)'
      else if (!signals.length) rec.verdict = 'I1'
      else if (rec.prototype_check && rec.prototype_check.status === 'mismatch') rec.verdict = 'I4'
      if (!hit.ok && hit.top) rec.covered_by = hit.top
      // 결함이면 누르기 전 캡처에 윤곽선을 그린 그림을 남긴다
      if (rec.verdict && before) {
        rec.shot = path.join('shots', `${tag}_${c.k}.png`)
        fs.writeFileSync(run.file(rec.shot), before)
      }
      if (inspection) run.live.inspect(inspection.context, { ...inspection.row, status: 'checked', properties: [{ name: '관찰한 반응', impl: signals.join(' / ') || '화면·주소 변화 없음' }], findings: rec.verdict ? [{ rule: rec.verdict, text: rec.verdict === 'I2' ? errors.join(' / ') : rec.prototype_check && rec.prototype_check.text || '눌러도 화면과 주소에 변화가 없습니다' }] : [] })
      // 반응이 있었으면 처음 상태로 다시 들어간다
      if (signals.length || errors.length || navigated) {
        await cur.ctx.close().catch(() => {})
        cur = await openScreen(browser, { origin, recipe, w, h, cfg, counters })
        await cur.page.evaluate(dqaClickables, { max: max || 30, want: [...expected.keys()] })
      }
    }
    // 결함 요소에 윤곽선을 그린 캡처(처음 상태)
    for (const r of results.filter((x) => x.verdict)) {
      const page = cur.page
      await page.evaluate(() => document.querySelectorAll('[data-dqa-outline]').forEach((n) => n.remove()))
      await page.locator(`[data-dqa-c="${r.k}"]`).scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {})
      await page.evaluate(dqaOutline, r.k).catch(() => {})
      r.marked = path.join('shots', `${tag}_${r.k}_marked.png`)
      await page.screenshot({ path: run.file(r.marked) }).catch(() => { r.marked = r.shot })
    }
  } finally { await cur.ctx.close().catch(() => {}) }
  return { results, defects: interactDefects(results, { screen: recipe.id, side, ref, w, h }), counters: { writes: counters.writes.length, blocked: counters.blocked.length, clicked: results.filter((r) => !r.skip).length, total: results.length, prototype_matched: results.filter((r) => r.prototype_check && r.prototype_check.status === 'matched').length, prototype_unverified: results.filter((r) => r.prototype_check && r.prototype_check.status === 'unverified').length } }
}

const SEVERITY = { I1: '높음', I2: '높음', I3: '높음', I4: '높음' }
function interactDefects (results, { screen, side, ref, w, h }) {
  return results.filter((r) => r.verdict).map((r) => {
    const fp = `interact|${r.verdict}|${r.path}|${norm(r.label).slice(0, 30)}`
    // 조사(이/가, 으로/로)가 이름에 따라 달라지지 않게 화살표로 쓴다
    const exp = r.expected ? `시안의 연결: "${r.expected.node}" 누름 → ${r.expected.actions.map((a) => a.type === 'NODE' ? `${a.dest_name ? `"${a.dest_name}"` : `화면 ${a.dest}`} ${a.navigation === 'OVERLAY' ? '겹쳐 열기' : '이동'}` : a.type === 'URL' ? `주소 ${a.url} 이동` : '뒤로 가기').join(', ')}` : null
    const what = r.verdict === 'I1' ? `눌러도 아무 반응이 없다(주소·DOM·입력·초점·요청·화면 변화 없음)${r.covered_by ? `. 가운데를 누르면 다른 요소(${r.covered_by})가 눌린다` : ''}${r.href === '#' ? '. href="#"뿐인 링크' : ''}${r.design_only ? `. 구현 요소가 누를 수 있는 요소로 만들어지지 않았다(${r.why_not}, 키보드로도 누를 수 없다)` : ''}`
      : r.verdict === 'I2' ? `누르면 스크립트 오류가 난다: ${r.errors[0]}`
        : r.verdict === 'I4' ? r.prototype_check.text
        : `이동했지만 ${r.landing.not_found ? '404·없는 페이지' : '빈 화면'}이다(${r.landing.url})`
    const label = r.label || r.tag
    // 시안이 반응을 기대하거나 진짜 버튼·링크면 높음, 손가락 커서만 있는 요소는 사람 확인
    const semantic = /^(a|button|summary|input)$/.test(r.tag) || r.role
    return {
      id: `${screen.replace(/\//g, '-')}-${r.verdict}-${sha1(fp).slice(0, 6)}`,
      rule: r.verdict, rule_name: RULE_NAME[r.verdict], severity: r.verdict !== 'I1' || semantic || r.expected ? SEVERITY[r.verdict] : '사람 확인 필요', kind: 'interact',
      screen, side, ref, fps: [fp], labels: [label.slice(0, 40)],
      elements: [{ fp, label: label.slice(0, 40), tag: r.tag, cls: r.cls, pcls: r.pcls, path: r.path, box: r.box }],
      widths: [{ w, h, px: 1, metric: r.verdict === 'I1' ? 'no_reaction' : r.verdict === 'I2' ? 'click_error' : r.verdict === 'I4' ? 'prototype_destination' : 'blank_landing', canvas_px: 1, items: 1, scroll_y: 0, step: 0, shot: r.marked || r.shot || null, clean: r.shot || null, text: `${what}${exp ? `. ${exp}` : ''}` }],
      max_px: 1, only_at: null,
      evidence: [{ id: 'M1', metric: r.verdict, value: 1, threshold: 1, text: what }, ...(exp ? [{ id: 'M2', metric: 'design_reaction', value: 1, threshold: 1, text: exp }] : [])],
      interact: { signals: r.signals || [], errors: r.errors || [], stack: r.stack || null, landing: r.landing || null, covered_by: r.covered_by || null, expected: r.expected, prototype_check: r.prototype_check || null, href: r.href || null, design_only: !!r.design_only, why_not: r.why_not || null },
      diag: [...(r.covered_by ? [{ code: 'covered_click', text: `가운데를 누르면 ${r.covered_by}가 눌린다(위에 덮인 요소)` }] : []), ...(r.design_only ? [{ code: 'not_clickable', text: `시안에는 누름 연결이 있는데 구현은 누를 수 있는 요소가 아니다(${r.why_not})` }] : [])], shots: { crop: null }
    }
  })
}

module.exports = { interactPass, interactDefects, designReactions, RULE_NAME }
