// 무반응 측정만으로 가림 원인을 확정하지 않는다. 숫자 검증과 별개인 관측 사실 검사.
function unsupportedClaims (answer, defect) {
  if (defect.rule !== 'I1' || (defect.interact && defect.interact.covered_by)) return []
  const observation = [answer.problem, answer.reason].filter(Boolean).join(' ')
  return /가려|가림|덮여|덮고|겹쳐|겹침|occlud|obscur|covered|overlap|pointer-events|z-index/i.test(observation)
    ? ['가림 원인을 뒷받침하는 측정이 없다'] : []
}
module.exports = { unsupportedClaims }
