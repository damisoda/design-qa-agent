// dqa check: 대상 열기 → 크기별 측정 → 묶기 → 재측정 → 변경 전과 비교 → 원인 후보 → LLM 해석(검증) → 보고서.
// 순서는 코드가 정한다. LLM은 해석 단계에서만, 호출 상한 안에서 쓴다.
const fs = require('fs')
const path = require('path')
const { createRun, writeJSON, readJSON } = require('./util')
const { openDist, openUrl } = require('./targets')
const { launch } = require('../measure/browser')
const { sweep, measureOne } = require('../measure/sweep')
const { buildDefects, crossWidth } = require('../measure/cluster')
const { loadRecipe } = require('../recipes/runner')
const { compare, applyAccept } = require('../diff/compare')
const { findCauses, changedHunks, tokenHex, stackCauses } = require('../code/cause')
const { preflight, judgeOne, ruleSentence, unload, summarizeRun } = require('../judge/ollama')
const { reportMd, prComment } = require('../report/md')
const { reportHtml } = require('../report/html')

// 크기: [폭, 높이] 또는 [폭, 높이, 위 안전영역, 아래 안전영역]. --safe 47,34는 모든 크기에 안전영역을 준다
function parseSizes (spec, recipe, cfg, safe) {
  const s = spec || recipe.widths || cfg.default_profile
  const list = cfg.profiles[s] ? cfg.profiles[s] : String(s).split(',').map((x) => x.trim().split('x').map(Number)).filter(([w, h]) => w >= 240 && w <= 2000 && h >= 400 && h <= 2400)
  if (!safe) return list
  const [st, sb] = String(safe).split(',').map(Number)
  return list.map(([w, h]) => [w, h, st || 0, sb || 0])
}

async function openTargets (args, cfg) {
  if (args.local) {
    const { openLocal } = require('../targets/local')
    return openLocal(args, cfg)
  }
  if (args.repo) {
    const { openRepo } = require('../targets/cbh_git')
    return openRepo(args, cfg)
  }
  const head = args.url ? await openUrl(args.url, cfg, args.src) : args.dist ? await openDist(args.dist, cfg, args.src) : null
  if (!head) throw new Error('대상이 없다: --dist, --url, --repo 중 하나가 필요하다')
  const base = args['base-url'] ? await openUrl(args['base-url'], cfg, args['base-src']) : args['base-dist'] ? await openDist(args['base-dist'], cfg, args['base-src']) : null
  return { head, base }
}

function confidence (d) {
  const basis = []; let s = 0
  if (d.widths.length >= 3) { s += 2; basis.push(`${d.widths.length}개 크기에서 재현`) } else if (d.widths.length === 2) { s += 1; basis.push('2개 크기에서 재현') } else basis.push('1개 크기에서만')
  if (d.remeasured === true) { s += 1; basis.push('재측정 일치') } else if (d.remeasured === false) { s -= 2; basis.push('재측정 불일치') }
  const th = (d.evidence[0] && d.evidence[0].threshold) || 1
  if (d.max_px >= th * 3) { s += 1; basis.push(`기준(${th}) 대비 여유 큼`) }
  const c = d.causes && d.causes.candidates && d.causes.candidates[0]
  if (c && c.score >= 0.4) { s += 1; basis.push(`원인 1위 점수 ${c.score}`) }
  if (d.severity === '사람 확인 필요') s -= 1
  return { level: s >= 4 ? '높음' : s >= 2 ? '중간' : '낮음', basis }
}

async function check (args, cfg) {
  const recipeIds = String(args.recipe || '').split(',').filter(Boolean)
  if (!recipeIds.length && !args.repo && !args.local) throw new Error('--recipe가 필요하다(dqa recipe list)')
  const run = createRun('check', args['run-id'])
  const progress = require('./live').createLive(run); run.live = progress
  writeJSON(run.file('manifest.json'), { run_id: run.id, title: args.title || '검사 준비 중', started_at: progress.state.started_at, status: 'running', llm: { mode: args.llm || 'auto' }, failures: [] })
  progress.stage('prepare', 'running', '작업 폴더를 준비하고 사본에서 빌드하고 있습니다')
  let t
  try { t = await openTargets(args, cfg) } catch (e) {
    progress.stage('prepare', 'failed', e.message)
    writeJSON(run.file('manifest.json'), { run_id: run.id, title: '검사 준비 실패', started_at: progress.state.started_at, status: 'error', exit_code: 2, error: e.message, failures: [] })
    throw e
  }
  progress.stage('prepare', 'done', '검사할 화면 준비가 끝났습니다')
  if (!t.repoCfg && t.head.repo && cfg.repos[t.head.repo]) t.repoCfg = { ...cfg.repos[t.head.repo], name: t.head.repo }
  const recipes = (recipeIds.length ? recipeIds : t.recipes || []).map(loadRecipe)
  const slug = `${t.head.ref}${t.base ? '_vs_' + t.base.ref : ''}`
  const m = {
    run_id: run.id, title: args.title || `${recipes.map((r) => r.title).join(', ')} · ${t.head.ref}`,
    started_at: progress.state.started_at, command: process.argv.slice(2).join(' '),
    targets: { head: { kind: t.head.kind, ref: t.head.ref, note: t.head.note, src: t.head.src, dist: t.head.dir || null, url: t.head.kind === 'url' ? t.head.origin + (t.head.start || '') : null, repo: t.head.repo || null }, base: t.base ? { kind: t.base.kind, ref: t.base.ref, note: t.base.note, src: t.base.src, dist: t.base.dir || null } : null },
    repo: t.repoCfg ? t.repoCfg.name : null,
    recipes: recipes.map((r) => ({ id: r.id, title: r.title, version: r.version || 1 })),
    llm: { mode: args.llm || 'auto' }, stages: {}, failures: [], status: 'running'
  }
  if (t.build) m.build = t.build
  if (t.local) m.local = t.local
  // 시안(Figma 내보내기 design.json·design.png)이 있으면 실행 폴더에 붙인다. 검토 화면의 비교 기준이 된다
  m.design = require('./design').resolveDesign(args, t, recipes, run, cfg)
  progress.state.design = m.design
  if (m.design) run.event('design', `시안 연결: ${Object.entries(m.design).map(([k, v]) => `${k} → ${v.frame || '프레임'}(${v.base}, 노드 ${v.nodes}개)`).join(', ')}`)
  const save = () => writeJSON(run.file('manifest.json'), m)
  save()
  run.event('start', `${m.title}${t.base ? ` (비교: ${t.base.ref})` : ''}`)
  const stage = async (name, fn) => {
    const labels = { measure: '화면을 크기별로 측정하고 있습니다', design: 'Figma 시안 값과 구현 값을 비교하고 있습니다', interact: '버튼과 링크를 눌러 반응을 확인하고 있습니다', verify: '재측정과 변경 비교를 확인하고 있습니다', cause: '원인 파일과 줄을 찾고 있습니다', judge: '문제 설명 단계를 준비하고 있습니다' }
    const t0 = Date.now(); progress.stage(name, 'running', labels[name] || name)
    try { const out = await fn(); progress.stage(name, m.failures.length && ['measure', 'design', 'interact'].includes(name) ? 'incomplete' : 'done', (labels[name] || name).replace('하고 있습니다', '했습니다')); return out }
    catch (e) { progress.stage(name, 'failed', e.message); throw e }
    finally { m.stages[name] = Math.round((Date.now() - t0) / 100) / 10; save() }
  }
  const browser = await launch()
  let defects = []; let resolved = []; let codeFindings = []
  try {
    const sizesBy = new Map(recipes.map((r) => [r.id, parseSizes(args.widths || t.widths, r, cfg, args.safe)]))
    m.sizes = [...new Map([...sizesBy.values()].flat().map((s) => [s.join('x'), s])).values()]
    const sides = t.base ? [['base', t.base], ['head', t.head]] : [['head', t.head]]
    const measured = { base: [], head: [] }
    const early = { head: new Map(), design: [], interact: [] }
    const publish = () => progress.publish([...early.head].flatMap(([screen, res]) => buildDefects(res, { screen, side: 'head', ref: t.head.ref })).concat(early.design, early.interact))
    run.onMeasured = (r) => { if (r.side === 'head') { const rows = early.head.get(r.screen) || []; rows.push(r); early.head.set(r.screen, rows); publish() } }
    for (const [side] of sides) for (const r of recipes) for (const [w, h] of sizesBy.get(r.id)) progress.task(`${side}/${r.id}/${w}x${h}`, { side, screen: r.id, title: r.title, size: `${w}x${h}`, status: 'pending' })
    progress.state.stages.design = { status: m.design && !args['no-design'] ? 'pending' : 'skipped', message: m.design ? '' : '선택된 시안이 없습니다' }
    progress.state.stages.interact = { status: args.interact ? 'pending' : 'skipped', message: args.interact ? '' : '눌러 보기 꺼짐' }
    save()
    await stage('measure', async () => {
      for (const [side, tg] of sides) {
        for (const r of recipes) {
          const rr = { ...r, start: tg.start && tg.start !== '/' ? { path: tg.start } : r.start }
          // --scroll none: 첫 화면 한 장만 잰다(기준선 B1용)
          if (args.scroll === 'none') rr.scan = { ...(rr.scan || {}), scroll: 'none' }
          const res = await sweep(browser, { origin: tg.origin, recipe: rr, sizes: sizesBy.get(r.id), side, run, cfg })
          for (const x of res.filter((x) => !x.ok)) m.failures.push({ side, screen: r.id, size: `${x.w}x${x.h}`, error: x.error, fail_shot: x.fail_shot || null })
          measured[side].push({ recipe: r, res, ref: tg.ref })
        }
      }
    })
    // 시안 비교: 시안이 있는 화면은 시안 프레임 크기로 한 번 더 열어 값(색·글자·간격·정렬·크기 방식·문구)을 비교한다
    const designDs = { base: [], head: [] }
    if (m.design && !args['no-design']) {
      await stage('design', async () => {
        const { designPass } = require('../design/pass')
        m.design_summary = {}
        for (const [side, tg] of sides) {
          for (const r of recipes) {
            const dz = m.design[r.id]; if (!dz) continue
            const spec = readJSON(run.file(dz.json), null); if (!spec) continue
            const rr = { ...r, start: tg.start && tg.start !== '/' ? { path: tg.start } : r.start }
            const widest = Math.max(...sizesBy.get(r.id).map((x) => x[0]))
            try {
              const out = await designPass(browser, { origin: tg.origin, recipe: rr, spec, side, ref: tg.ref, run, cfg, altWidth: widest })
              designDs[side].push(...out.defects.map((d) => ({ ...d, screen_title: r.title })))
              if (side === 'head') { m.design_summary[r.id] = out.summary; early.design.push(...out.defects); publish() }
              progress.preview({ phase: 'design', side, screen: r.id, title: r.title, size: out.summary.base, shot: out.shot, label: '시안 값 비교 완료' })
              // 시안 크기가 측정 크기에 없으면 크기 목록과 캡처 색인에 넣는다(검토 화면에서 고를 수 있게)
              if (out.size && !m.sizes.some((x) => x[0] === out.size[0] && x[1] === out.size[1])) { m.sizes.push(out.size); (m.design_sizes = m.design_sizes || []).push(out.size) }
              if (out.shot) measured[side].push({ recipe: r, res: [{ ok: true, w: out.size[0], h: out.size[1], design_only: true, issues: [], lines: [], steps: [{ y: 0, shot: out.shot }] }], ref: tg.ref, design_only: true })
              run.event('design', `${side} ${r.id}: 시안 비교(${out.summary.base}) 글자 ${out.summary.matched}/${out.summary.design_texts} 짝, 차이 ${out.defects.length}건${out.summary.offset && (out.summary.offset.x || out.summary.offset.y) ? `, 전체 어긋남 ${out.summary.offset.x},${out.summary.offset.y}px` : ''}`)
            } catch (e) {
              m.failures.push({ side, screen: r.id, size: 'design', error: `시안 비교 실패: ${String(e.message).split('\n')[0]}` })
              run.event('design', `${side} ${r.id}: 시안 비교 실패 — ${String(e.message).split('\n')[0]}`)
            }
          }
        }
      })
    }
    // 눌러 보기(--interact): 버튼·링크를 하나씩 눌러 반응이 없거나 오류·빈 화면으로 가는 것을 찾는다. 첫 크기 하나에서만
    const interactDs = { base: [], head: [] }
    if (args.interact) {
      await stage('interact', async () => {
        const { interactPass } = require('../interact/probe')
        m.interact_summary = {}
        for (const [side, tg] of sides) {
          for (const r of recipes) {
            const rr = { ...r, start: tg.start && tg.start !== '/' ? { path: tg.start } : r.start }
            const clickSizes = [...new Map([sizesBy.get(r.id)[0], ...(args["interact-widths"] ? parseSizes(args["interact-widths"], r, cfg) : [])].map(s => [s.slice(0,2).join("x"), s])).values()]
            for (const size of clickSizes) {
              const spec = m.design && m.design[r.id] ? readJSON(run.file(m.design[r.id].json), null) : null
              try {
                const out = await interactPass(browser, { origin: tg.origin, recipe: rr, side, ref: tg.ref, run, cfg, size, spec, max: Number(args['interact-max']) || 30 })
                interactDs[side].push(...out.defects.map((d) => ({ ...d, screen_title: r.title })))
                if (side === 'head') { early.interact.push(...out.defects); publish() }
                if (side === 'head') m.interact_summary[r.id + (size === clickSizes[0] ? '' : '@' + size.join('x'))] = { size: `${size[0]}x${size[1]}`, ...out.counters, defects: out.defects.length }
                writeJSON(run.file(`interact/${side}_${r.id.replace(/\//g, '_')}${size === clickSizes[0] ? '' : '_' + size.join('x')}.json`), out.results)
                run.event('interact', `${side} ${r.id}: 누를 수 있는 요소 ${out.counters.total}개 중 ${out.counters.clicked}개 눌러 봄, 반응 없음·오류·빈 화면 ${out.defects.length}건${out.counters.prototype_unverified ? `, 시안 목적지 확인 불가 ${out.counters.prototype_unverified}건` : ''}${out.counters.writes ? `, 쓰기 요청 ${out.counters.writes}건은 가짜 응답` : ''}`)
              } catch (e) {
                m.failures.push({ side, screen: r.id, size: 'interact', error: `눌러 보기 실패: ${String(e.message).split('\n')[0]}` })
                run.event('interact', `${side} ${r.id}: 눌러 보기 실패 — ${String(e.message).split('\n')[0]}`)
              }
            }
          }
        }
      })
    }
    // 비교 보기용 캡처 색인: 쪽(변경 전·후) → 화면 → 크기 → 스크롤 단계별 원본 캡처
    const shotIndex = {}
    for (const side of ['base', 'head']) for (const { recipe, res } of measured[side]) for (const r of res) {
      if (!r.ok) continue
      const idx = ((shotIndex[side] = shotIndex[side] || {})[recipe.id] = shotIndex[side][recipe.id] || {})
      if (r.design_only && idx[`${r.w}x${r.h}`]) continue // 측정 크기와 같으면 측정 캡처를 쓴다
      idx[`${r.w}x${r.h}`] = (r.steps || []).map((s) => ({ y: s.y, shot: s.shot || null, marked: s.marked || null }))
    }
    writeJSON(run.file('shots.json'), shotIndex)
    m.blocked_total = [...measured.base, ...measured.head].flatMap((x) => x.res).reduce((a, r) => a + (r.blocked ? r.blocked.length : 0), 0)
    m.writes_total = [...measured.base, ...measured.head].flatMap((x) => x.res).reduce((a, r) => a + (r.writes || []).length, 0)
    fs.writeFileSync(run.file('write_requests.jsonl'), [...measured.base, ...measured.head].flatMap((x) => x.res).flatMap((r) => (r.writes || []).map((q) => JSON.stringify({ side: r.side, screen: r.screen, size: `${r.w}x${r.h}`, ...q }))).join('\n'))
    m.stubbed_total = [...measured.base, ...measured.head].flatMap((x) => x.res).reduce((a, r) => a + (r.stubbed ? r.stubbed.length : 0), 0)
    fs.writeFileSync(run.file('blocked_requests.jsonl'), [...measured.base, ...measured.head].flatMap((x) => x.res).flatMap((r) => (r.blocked || []).map((b) => JSON.stringify({ side: r.side, screen: r.screen, size: `${r.w}x${r.h}`, ...b }))).join('\n'))
    const toDefects = (side) => measured[side].filter((x) => !x.design_only).flatMap(({ recipe, res, ref }) => {
      const ds = buildDefects(res, { screen: recipe.id, side, ref })
      return [...ds, ...crossWidth(res, ds, { screen: recipe.id, side, ref })].map((d) => ({ ...d, screen_title: recipe.title }))
    })
    const mergeClicks = rows => [...rows.reduce((m,d) => { const old=m.get(d.id); if(old) { old.widths.push(...d.widths); old.max_px=Math.max(old.max_px||0,d.max_px||0) } else m.set(d.id,d); return m }, new Map()).values()]
    defects = [...toDefects('head'), ...designDs.head, ...mergeClicks(interactDs.head)]
    const baseDefects = t.base ? [...toDefects('base'), ...designDs.base, ...mergeClicks(interactDs.base)] : []
    run.event('cluster', `결함 묶음: 변경 후 ${defects.length}건${t.base ? `, 변경 전 ${baseDefects.length}건` : ''}`)

    writeJSON(run.file('defects.json'), defects) // 설명을 기다리지 않고 최종 묶음을 먼저 공개

    // 재측정: 결함이 가장 많이 나온 크기 하나를 다시 열어 같은 규칙·요소가 또 나오는지 본다
    await stage('verify', async () => {
      for (const { recipe, res } of measured.head.filter((x) => !x.design_only)) {
        const mine = defects.filter((d) => d.screen === recipe.id && d.rule !== 'R5' && !d.kind)
        if (!mine.length) continue
        const best = res.filter((x) => x.ok).sort((a, b) => b.issues.length - a.issues.length)[0]
        if (!best) continue
        const tg = t.head
        const rr = { ...recipe, start: tg.start && tg.start !== '/' ? { path: tg.start } : recipe.start }
        const again = await measureOne(browser, { origin: tg.origin, recipe: rr, width: best.w, height: best.h, side: 'verify', run, cfg, shots: false })
        for (const d of mine) {
          if (!d.widths.some((w) => w.w === best.w && w.h === best.h)) continue
          d.remeasured = again.ok && again.issues.some((it) => it.rule === d.rule && d.fps.includes(it.el.fp))
        }
        run.event('verify', `${recipe.id} ${best.w}x${best.h} 재측정: ${mine.filter((d) => d.remeasured === true).length}/${mine.filter((d) => d.remeasured !== undefined).length} 일치`)
      }
    })

    if (t.base && !m.failures.length) { resolved = compare(baseDefects, defects).resolved }
    else if (t.base) { m.comparison_incomplete = true; run.event('compare', '일부 검사가 실패해 새로 생김·해결 판정을 보류한다') }
    applyAccept(defects)

    // 원인 후보
    await stage('cause', async () => {
      let changed = null
      if (t.base && t.base.src && t.head.src && !args['no-diff-rank']) {
        const sub = (t.repoCfg && t.repoCfg.src_dir !== undefined && t.repoCfg.src_dir !== null ? t.repoCfg.src_dir : 'frontend/src')
        const dh = changedHunks(t.base.src, t.head.src, fs.existsSync(path.join(t.head.src, sub)) ? sub : '')
        changed = dh.changed
        const tok = tokenHex(path.join(t.head.src, (t.repoCfg && t.repoCfg.tokens) || 'frontend/src/theme/tokens.ts'))
        codeFindings = dh.addedHex.map((h) => ({ ...h, token: tok.get(h.hex) || null }))
        m.changed_files = [...changed.keys()]
      }
      const srcSub = (t.repoCfg && t.repoCfg.src_dir !== undefined && t.repoCfg.src_dir !== null ? t.repoCfg.src_dir : 'frontend/src')
      for (const d of defects) {
        const r = recipes.find((x) => x.id === d.screen)
        const srcRoot = t.head.src
        const minified = measured.head.flatMap((x) => x.res).some((x) => x.ok && x.minified)
        const srcDir = srcRoot && fs.existsSync(path.join(srcRoot, srcSub)) ? path.join(srcRoot, srcSub) : srcRoot
        d.causes = findCauses(d, { srcRoot, srcDir, hints: (r && r.source_hints) || [], changed, minified })
        // 누르면 오류: 스택이 가리키는 번들 코드와 같은 이름이 있는 소스 줄을 맨 앞에
        if (d.kind === 'interact' && d.interact && d.interact.stack && srcRoot) {
          const sc = stackCauses(d.interact.stack, { distDir: t.head.dir, srcDir, srcRoot })
          if (sc.length) d.causes.candidates = [...sc, ...d.causes.candidates.filter((c) => !sc.some((x) => x.file === c.file))].slice(0, 3)
        }
      }
      run.event('cause', `원인 후보: ${defects.filter((d) => d.causes.candidates.length).length}/${defects.length}건${changed ? `, 바뀐 파일 ${changed.size}개 반영` : ''}`)
    })
    for (const d of defects) d.confidence = confidence(d)
    writeJSON(run.file('defects.json'), defects)

    // LLM 해석: 새로 생김·악화 우선, 심각도 순, 상한 안에서
    await stage('judge', async () => {
      const want = defects.filter((d) => !d.accepted && (!d.diff || ['new', 'worsened'].includes(d.diff.status)))
      const order = { 높음: 0, 중간: 1, '사람 확인 필요': 2, 낮음: 3 }
      want.sort((a, b) => order[a.severity] - order[b.severity] || b.max_px - a.max_px)
      if (m.failures.length) m.llm = { ...m.llm, status: 'skipped', reason: '검사가 불완전해 문제 정의를 보류한다' }
      else if (m.llm.mode === 'off') m.llm = { ...m.llm, status: 'off', reason: '--llm off' }
      else if (!want.length) m.llm = { ...m.llm, status: 'off', reason: '해석할 새 결함이 없다' }
      else {
        const pf = await preflight(cfg)
        if (!pf.ok) m.llm = { ...m.llm, status: 'skipped', reason: pf.reason }
        else {
          m.llm = { ...m.llm, status: 'ok', model: cfg.ollama.model, calls: 0, mac_free_pct: pf.free }
          for (const d of want.slice(0, cfg.ollama.max_calls)) {
            run.event('judge', `${d.rule} ${d.labels.slice(0, 2).join(',')} 해석 중`)
            try { d.judge = await judgeOne(d, cfg, d.screen_title, run.file('judge')); m.llm.calls += d.judge.tries } catch (e) { d.judge = { status: 'fallback', reason: `호출 실패: ${e.message}` } }
          }
          if (want.length > cfg.ollama.max_calls) m.llm.capped = want.length - cfg.ollama.max_calls
          m.llm.ready = true
        }
      }
      for (const d of defects) {
        if (!d.judge) d.judge = { status: 'skipped', reason: d.accepted ? '무시로 분류됨' : d.diff && !['new', 'worsened'].includes(d.diff.status) ? '기존 결함' : m.llm.reason || '호출 상한' }
        d.rule_text = ruleSentence(d)
      }
      run.event('judge', m.llm.status === 'ok' ? `LLM 분류 ${defects.filter((d) => d.judge.status === 'ok').length}건 통과(${defects.filter((d) => d.judge.status === 'ok').map((d) => `${d.rule} ${d.judge.verdict}`).join(', ')}), ${defects.filter((d) => d.judge.status === 'fallback').length}건 검증 실패` : `LLM 사용 안 함: ${m.llm.reason}`)
    })
  } catch (e) {
    m.error = e.message
    run.event('error', e.message)
  } finally {
    await browser.close().catch(() => {})
    t.head.close(); if (t.base) t.base.close()
  }

  const live = defects.filter((d) => !d.accepted)
  m.summary = {
    total: defects.length,
    new: live.filter((d) => d.diff && d.diff.status === 'new').length,
    worsened: live.filter((d) => d.diff && d.diff.status === 'worsened').length,
    unchanged: live.filter((d) => d.diff && d.diff.status === 'unchanged').length,
    improved: live.filter((d) => d.diff && d.diff.status === 'improved').length,
    no_base: live.filter((d) => !d.diff).length,
    resolved: resolved.length,
    accepted: defects.length - live.length,
    failed_sizes: m.failures.length,
    code_findings: codeFindings.length
  }
  if (m.llm && m.llm.ready) {
    run.event('report', '한눈 요약 쓰는 중')
    m.overview = await summarizeRun(m, defects, resolved, cfg)
    m.llm.calls += 1; delete m.llm.ready
    if (cfg.ollama.unload_after !== false) m.llm.unloaded = await unload(cfg) // 맥미니 메모리를 바로 돌려준다
  }
  const blocking = m.summary.new + m.summary.worsened + m.summary.no_base
  m.exit_code = m.error || m.failures.length ? 2 : blocking > 0 ? 1 : 0
  m.status = m.error ? 'error' : m.failures.length ? 'incomplete' : 'done'
  m.finished_at = new Date().toISOString()
  m.total_sec = Math.round((Date.now() - run.t0) / 100) / 10
  // 수정 요청문: 결함마다 붙여 넣을 글(검토 화면의 복사 버튼)과 실행 전체 글(brief.md)
  const { brief, briefMd, cssVars } = require('../design/suggest')
  const vars = cssVars(t.head.src || t.head.dir || null)
  for (const d of defects) d.brief = brief(d, { title: d.screen_title, vars })
  writeJSON(run.file('defects.json'), defects)
  fs.writeFileSync(run.file('brief.md'), briefMd(m, defects))
  writeJSON(run.file('diff.json'), { resolved, changed_files: m.changed_files || [] })
  writeJSON(run.file('code_findings.json'), codeFindings)
  writeJSON(run.file('summary.json'), { run_id: run.id, title: m.title, exit_code: m.exit_code, summary: m.summary, llm: m.llm, total_sec: m.total_sec, defects: defects.map((d) => ({ id: d.id, status: d.accepted ? 'accepted' : d.diff ? d.diff.status : 'none', rule: d.rule, rule_name: d.rule_name, screen: d.screen, labels: d.labels.slice(0, 4), widths: d.widths.map((w) => ({ size: `${w.w}x${w.h}`, px: w.px, metric: w.metric })), cause: d.causes && d.causes.candidates[0] ? `${d.causes.candidates[0].file}:${d.causes.candidates[0].line}` : null, judge: d.judge.status === 'ok' ? { verdict: d.judge.verdict, cause: d.judge.cause, fix: d.judge.fix } : null })) })
  fs.writeFileSync(run.file('report.md'), reportMd(m, defects, resolved, codeFindings))
  fs.writeFileSync(run.file('report.html'), reportHtml(m, defects, resolved, codeFindings))
  fs.writeFileSync(run.file('pr_comment.md'), prComment(m, defects, resolved))
  save()
  progress.stage('complete', m.status === 'done' ? 'done' : 'incomplete', m.status === 'done' ? '화면 측정이 끝났습니다' : '일부 검사를 완료하지 못했습니다')
  run.event('done', `종료 코드 ${m.exit_code} — 새로 생김 ${m.summary.new}, 악화 ${m.summary.worsened}, 기존 ${m.summary.unchanged + m.summary.improved}, 상태 없음 ${m.summary.no_base}, 해결 ${m.summary.resolved}, 무시 ${m.summary.accepted} (${m.total_sec}초) → ${run.file('report.md')}`)
  return { run_id: run.id, dir: run.dir, exit_code: m.exit_code, summary: m.summary }
}

module.exports = { check, parseSizes }
