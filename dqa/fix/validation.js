// 실패하거나 불완전한 재측정은 검증된 수정으로 취급하지 않는다.
function assertVerifiedCombined (c) {
  if (!c || c.ok !== true || c.build_ok !== true || (c.coverage_errors || []).length || (c.failed_sizes || 0) !== 0 || !Array.isArray(c.regress) || c.regress.length || !Array.isArray(c.edits) || !c.edits.length || !(c.fixed_count > 0)) {
    throw new Error('묶음 수정 검증이 성공하지 않았다(빌드·재측정 실패, 결함 남음 또는 회귀). 다시 수정 검증한 뒤 적용·PR을 준비한다')
  }
  return c
}
module.exports = { assertVerifiedCombined }
