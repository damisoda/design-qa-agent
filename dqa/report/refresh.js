// Dify 저장 후 파일 보고서도 웹 화면과 같은 정의서를 사용한다.
const fs = require('fs'); const path = require('path')
const { RUNS, readJSON, writeJSON } = require('../core/util')
function refreshReports (id) {
  const dir = path.join(RUNS, id); const m = readJSON(path.join(dir, 'manifest.json'), null)
  if (!m || !m.summary) return
  const ds = readJSON(path.join(dir, 'defects.json'), []); const diff = readJSON(path.join(dir, 'diff.json'), { resolved: [] }); const cf = readJSON(path.join(dir, 'code_findings.json'), [])
  const { brief, briefMd, cssVars } = require('../design/suggest')
  const vars = cssVars(m.targets && m.targets.head && (m.targets.head.src || m.targets.head.dist))
  for (const d of ds) d.brief = brief(d, { title: d.screen_title, vars })
  writeJSON(path.join(dir, 'defects.json'), ds)
  fs.writeFileSync(path.join(dir, 'brief.md'), briefMd(m, ds))
  const { reportMd, prComment } = require('./md')
  fs.writeFileSync(path.join(dir, 'report.md'), reportMd(m, ds, diff.resolved, cf))
  fs.writeFileSync(path.join(dir, 'report.html'), require('./html').reportHtml(m, ds, diff.resolved, cf))
  fs.writeFileSync(path.join(dir, 'pr_comment.md'), prComment(m, ds, diff.resolved))
}
module.exports = { refreshReports }
