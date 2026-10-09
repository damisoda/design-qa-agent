// dqa check: 대상 열기 → 크기별 측정 → 묶기 → 재측정 → 변경 전과 비교 → 원인 후보 → LLM 해석(검증) → 보고서.
// 순서는 코드가 정한다. LLM은 해석 단계에서만, 호출 상한 안에서 쓴다.
const fs = require('fs')
const path = require('path')
const { createRun, writeJSON } = require('./util')
const { openDist, openUrl } = require('./targets')
const { launch } = require('../measure/browser')
const { sweep, measureOne } = require('../measure/sweep')
const { buildDefects, crossWidth } = require('../measure/cluster')
const { loadRecipe } = require('../recipes/runner')
const { compare, applyAccept } = require('../diff/compare')
const { findCauses, changedHunks, tokenHex } = require('../code/cause')
const { preflight, judgeOne, ruleSentence, unload, summarizeRun } = require('../judge/ollama')
const { reportMd, prComment } = require('../report/md')
const { reportHtml } = require('../report/html')

function parseSizes (spec, recipe, cfg) {
  const s = spec || recipe.widths || cfg.default_profile
  if (cfg.profiles[s]) return cfg.profiles[s]
  return String(s).split(',').map((x) => x.trim().split('x').map(Number)).filter(([w, h]) => w >= 240 && w <= 2000 && h >= 400 && h <= 2400)
}

async function openTargets (args, cfg) {
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
  if (!recipeIds.length && !args.repo) throw new Error('--recipe가 필요하다(dqa recipe list)')
  const t = await openTargets(args, cfg)
  if (!t.repoCfg && t.head.repo && cfg.repos[t.head.repo]) t.repoCfg = { ...cfg.repos[t.head.repo], name: t.head.repo }
  const recipes = (recipeIds.length ? recipeIds : t.recipes || []).map(loadRecipe)
  const slug = `${t.head.ref}${t.base ? '_vs_' + t.base.ref : ''}`
  const run = createRun(slug, args['run-id'])
  const m = {
    run_id: run.id, title: args.title || `${recipes.map((r) => r.title).join(', ')} · ${t.head.ref}`,
    started_at: new Date().toISOString(), command: process.argv.slice(2).join(' '),
    targets: { head: { kind: t.head.kind, ref: t.head.ref, note: t.head.note, src: t.head.src, dist: t.head.dir || null, url: t.head.kind === 'url' ? t.head.origin + (t.head.start || '') : null, repo: t.head.repo || null }, base: t.base ? { kind: t.base.kind, ref: t.base.ref, note: t.base.note, src: t.base.src, dist: t.base.dir || null } : null },
    repo: t.repoCfg ? t.repoCfg.name : null,
    recipes: recipes.map((r) => ({ id: r.id, title: r.title, version: r.version || 1 })),
    llm: { mode: args.llm || 'auto' }, stages: {}, failures: [], status: 'running'
  }
  if (t.build) m.build = t.build
  const save = () => writeJSON(run.file('manifest.json'), m)
  save()
  run.event('start', `${m.title}${t.base ? ` (비교: ${t.base.ref})` : ''}`)
  const stage = async (name, fn) => { const t0 = Date.now(); try { return await fn() } finally { m.stages[name] = Math.round((Date.now() - t0) / 100) / 10; save() } }
  const browser = await launch()
  let defects = []; let resolved = []; let codeFindings = []
  try {
    const sizesBy = new Map(recipes.map((r) => [r.id, parseSizes(args.widths, r, cfg)]))
    m.sizes = [...new Map([...sizesBy.values()].flat().map((s) => [s.join('x'), s])).values()]
    const sides = t.base ? [['base', t.base], ['head', t.head]] : [['head', t.head]]
    const measured = { base: [], head: [] }
    await stage('measure', async () => {
      for (const [side, tg] of sides) {
        for (const r of recipes) {
          const rr = { ...r, start: tg.start && tg.start !== '/' ? { path: tg.start } : r.start }
          const res = await sweep(browser, { origin: tg.origin, recipe: rr, sizes: sizesBy.get(r.id), side, run, cfg })
          for (const x of res.filter((x) => !x.ok)) m.failures.push({ side, screen: r.id, size: `${x.w}x${x.h}`, error: x.error, fail_shot: x.fail_shot || null })
          measured[side].push({ recipe: r, res, ref: tg.ref })
        }
      }
    })
    // 비교 보기용 캡처 색인: 쪽(변경 전·후) → 화면 → 크기 → 스크롤 단계별 원본 캡처
    const shotIndex = {}
    for (const side of ['base', 'head']) for (const { recipe, res } of measured[side]) for (const r of res) {
      if (!r.ok) continue
      ;((shotIndex[side] = shotIndex[side] || {})[recipe.id] = shotIndex[side][recipe.id] || {})[`${r.w}x${r.h}`] = (r.steps || []).map((s) => ({ y: s.y, shot: s.shot || null, marked: s.marked || null }))
    }
    writeJSON(run.file('shots.json'), shotIndex)
    m.blocked_total = [...measured.base, ...measured.head].flatMap((x) => x.res).reduce((a, r) => a + (r.blocked ? r.blocked.length : 0), 0)
    fs.writeFileSync(run.file('blocked_requests.jsonl'), [...measured.base, ...measured.head].flatMap((x) => x.res).flatMap((r) => (r.blocked || []).map((b) => JSON.stringify({ side: r.side, screen: r.screen, size: `${r.w}x${r.h}`, ...b }))).join('\n'))
    const toDefects = (side) => measured[side].flatMap(({ recipe, res, ref }) => {
      const ds = buildDefects(res, { screen: recipe.id, side, ref })
      return [...ds, ...crossWidth(res, ds, { screen: recipe.id, side, ref })].map((d) => ({ ...d, screen_title: recipe.title }))
    })
    defects = toDefects('head')
    const baseDefects = t.base ? toDefects('base') : []
    run.event('cluster', `결함 묶음: 변경 후 ${defects.length}건${t.base ? `, 변경 전 ${baseDefects.length}건` : ''}`)

    // 재측정: 결함이 가장 많이 나온 크기 하나를 다시 열어 같은 규칙·요소가 또 나오는지 본다
    await stage('verify', async () => {
      for (const { recipe, res } of measured.head) {
        const mine = defects.filter((d) => d.screen === recipe.id && d.rule !== 'R5')
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

    if (t.base) { resolved = compare(baseDefects, defects).resolved }
    applyAccept(defects)

    // 원인 후보
    await stage('cause', async () => {
      let changed = null
      if (t.base && t.base.src && t.head.src && !args['no-diff-rank']) {
        const sub = (t.repoCfg && t.repoCfg.src_dir) || 'frontend/src'
        const dh = changedHunks(t.base.src, t.head.src, fs.existsSync(path.join(t.head.src, sub)) ? sub : '')
        changed = dh.changed
        const tok = tokenHex(path.join(t.head.src, (t.repoCfg && t.repoCfg.tokens) || 'frontend/src/theme/tokens.ts'))
        codeFindings = dh.addedHex.map((h) => ({ ...h, token: tok.get(h.hex) || null }))
        m.changed_files = [...changed.keys()]
      }
      const srcSub = (t.repoCfg && t.repoCfg.src_dir) || 'frontend/src'
      for (const d of defects) {
        const r = recipes.find((x) => x.id === d.screen)
        const srcRoot = t.head.src
        const minified = measured.head.flatMap((x) => x.res).some((x) => x.ok && x.minified)
        d.causes = findCauses(d, { srcRoot, srcDir: srcRoot && fs.existsSync(path.join(srcRoot, srcSub)) ? path.join(srcRoot, srcSub) : srcRoot, hints: (r && r.source_hints) || [], changed, minified })
      }
      run.event('cause', `원인 후보: ${defects.filter((d) => d.causes.candidates.length).length}/${defects.length}건${changed ? `, 바뀐 파일 ${changed.size}개 반영` : ''}`)
    })
    for (const d of defects) d.confidence = confidence(d)

    // LLM 해석: 새로 생김·악화 우선, 심각도 순, 상한 안에서
    await stage('judge', async () => {
      const want = defects.filter((d) => !d.accepted && (!d.diff || ['new', 'worsened'].includes(d.diff.status)))
      const order = { 높음: 0, 중간: 1, '사람 확인 필요': 2, 낮음: 3 }
      want.sort((a, b) => order[a.severity] - order[b.severity] || b.max_px - a.max_px)
      if (m.llm.mode === 'off') m.llm = { ...m.llm, status: 'off', reason: '--llm off' }
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
  m.exit_code = m.error || (m.failures.length && m.failures.length >= (m.sizes || []).length * recipes.length) ? 2 : blocking > 0 ? 1 : 0
  m.status = m.error ? 'error' : 'done'
  m.finished_at = new Date().toISOString()
  m.total_sec = Math.round((Date.now() - run.t0) / 100) / 10
  writeJSON(run.file('defects.json'), defects)
  writeJSON(run.file('diff.json'), { resolved, changed_files: m.changed_files || [] })
  writeJSON(run.file('code_findings.json'), codeFindings)
  writeJSON(run.file('summary.json'), { run_id: run.id, title: m.title, exit_code: m.exit_code, summary: m.summary, llm: m.llm, total_sec: m.total_sec, defects: defects.map((d) => ({ id: d.id, status: d.accepted ? 'accepted' : d.diff ? d.diff.status : 'none', rule: d.rule, rule_name: d.rule_name, screen: d.screen, labels: d.labels.slice(0, 4), widths: d.widths.map((w) => ({ size: `${w.w}x${w.h}`, px: w.px, metric: w.metric })), cause: d.causes && d.causes.candidates[0] ? `${d.causes.candidates[0].file}:${d.causes.candidates[0].line}` : null, judge: d.judge.status === 'ok' ? { verdict: d.judge.verdict, cause: d.judge.cause, fix: d.judge.fix } : null })) })
  fs.writeFileSync(run.file('report.md'), reportMd(m, defects, resolved, codeFindings))
  fs.writeFileSync(run.file('report.html'), reportHtml(m, defects, resolved, codeFindings))
  fs.writeFileSync(run.file('pr_comment.md'), prComment(m, defects, resolved))
  save()
  run.event('done', `종료 코드 ${m.exit_code} — 새로 생김 ${m.summary.new}, 악화 ${m.summary.worsened}, 기존 ${m.summary.unchanged + m.summary.improved}, 상태 없음 ${m.summary.no_base}, 해결 ${m.summary.resolved}, 무시 ${m.summary.accepted} (${m.total_sec}초) → ${run.file('report.md')}`)
  return { run_id: run.id, dir: run.dir, exit_code: m.exit_code, summary: m.summary }
}

module.exports = { check, parseSizes }
