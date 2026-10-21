// Only measured, paired captures are presented as repair evidence.
function coverage (before, after) {
  const errors = []
  const key = x => `${x.screen}|${x.w}x${x.h}`
  for (const b of before.measurements || []) {
    const a = (after.measurements || []).find(x => key(x) === key(b))
    if (!b.ok || !a?.ok) errors.push(`${key(b)} 측정 누락 또는 실패`)
    if (a && (a.page_errors || []).length > (b.page_errors || []).length) errors.push(`${key(b)} 실행 오류 증가`)
    if(a && Array.isArray(b.content) && Array.isArray(a.content)) {
      const counts=new Map();for(const c of a.content)counts.set(c,(counts.get(c)||0)+1)
      let missing=0;for(const c of b.content){const n=counts.get(c)||0;if(n)counts.set(c,n-1);else missing++}
      if(missing) errors.push(`${key(b)} 화면 콘텐츠 ${missing}개가 없어 삭제·숨김 여부 확인 필요`)
    } else if (a && Math.max(0, ...(a.steps || []).map(s => s.leaves || 0)) < Math.max(0, ...(b.steps || []).map(s => s.leaves || 0))) errors.push(`${key(b)} 화면 요소가 줄어 삭제·숨김 여부 확인 필요`)
  }
  for (const [screen, b] of Object.entries(before.designs || {})) {
    const a = (after.designs || {})[screen]
    if (!a || a.matched < b.matched) errors.push(`${screen} 시안 대응 요소 감소`)
  }
  for (const b of before.interactions || []) {
    const a = (after.interactions || []).find(x => x.screen === b.screen && x.size === b.size)
    if (!a || a.clicked < b.clicked || a.prototype_matched < b.prototype_matched) errors.push(`${b.screen} ${b.size} 버튼 검사 누락`)
  }
  return errors
}

function comparison (before, after, manifest, verdict) {
  const frames = []; const remeasured = Array.isArray(after.measurements) && after.measurements.length > 0
  for (const b of before.measurements || []) {
    const a = (after.measurements || []).find(x => x.screen === b.screen && x.w === b.w && x.h === b.h)
    const reference = manifest.design?.[b.screen] || null
    for (const step of b.steps || []) {
      // Never pair a different scroll offset or substitute an old screenshot.
      const next = a?.steps?.find(s => s.y === step.y)
      frames.push({ screen: b.screen, title: reference?.frame || manifest.recipes?.find(r => r.id === b.screen)?.title || b.screen, size: `${b.w}x${b.h}`, scroll_y: step.y, before: step.shot || null,
        after: next?.shot || null, paired: !!(b.ok && a?.ok && step.shot && next?.shot),
        figma: reference?.png || null, figma_base: reference?.base || null,
        figma_same_size: reference?.base === `${b.w}x${b.h}` && !step.y,
        before_targets: step.targets || {}, after_targets: next?.targets || {}, before_issues: step.issues, after_issues: next?.issues ?? null })
    }
  }
  const ignore = d => d.rule !== 'R5' && !d.accepted
  return { version: 1, created_at: new Date().toISOString(), verified: verdict.ok === true,
    before_count: before.filter(ignore).length, after_count: remeasured ? after.filter(ignore).length : null,
    fixed: verdict.fixed || [], regress: verdict.regress || [], coverage_errors: verdict.coverage_errors || [],
    remaining: (remeasured ? after : before).filter(ignore).map(d => ({ id: d.id, rule: d.rule, labels: d.labels })),
    frames, journeys: after.journeys || [], before_journeys: before.journeys || [], interactions: after.interactions || [], before_interactions: before.interactions || [], designs: after.designs || {},
    note: '표시된 화면·크기·버튼의 재검증 결과입니다. 다른 화면 및 실기기 검증을 뜻하지 않습니다.' }
}
module.exports = { comparison, coverage }
