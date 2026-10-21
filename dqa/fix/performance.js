// Reuse only a full successful validation of the exact same static source in this fix run.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function sourceDigest (root) {
  const hash = crypto.createHash('sha256')
  let symlink = false
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git' || /^dist-dqa-(baseline|fix\d+)$/.test(entry.name)) continue
      if (entry.name === 'node_modules') { symlink = true; continue }
      const file = path.join(dir, entry.name)
      hash.update(path.relative(root, file) + '\0')
      if (entry.isSymbolicLink()) { symlink = true; hash.update('link:' + fs.readlinkSync(file)) }
      else if (entry.isDirectory()) walk(file)
      else hash.update(fs.readFileSync(file))
    }
  }
  walk(root)
  return symlink ? null : hash.digest('hex')
}

function reusable (entry, key) {
  return !!(entry && entry.key === key && entry.verdict.ok === true && entry.verdict.build_ok === true &&
    !entry.after.failed && entry.after.measurements?.length && entry.after.measurements.every(m => m.ok) &&
    !(entry.verdict.coverage_errors || []).length && !(entry.verdict.regress || []).length &&
    !(entry.after.journeys || []).some(j => !j.ok))
}

function quickTarget (targets, targetIds, recipes, sizes) {
  const ds = targets.filter(d => targetIds.includes(d.id))
  // Cross-width, design and interaction rules require their complete checks.
  if (!ds.length || ds.some(d => d.rule !== 'R1' || d.kind)) return null
  const options = ds.flatMap(d => (d.widths || []).map(w => ({ d, w })))
    .filter(({ w }) => sizes.some(s => s[0] === w.w && s[1] === w.h))
    .sort((a, b) => (b.w.px || 0) - (a.w.px || 0))
  const pick = options[0]
  if (!pick) return null
  const recipe = recipes.find(r => r.id === pick.d.screen)
  return recipe ? { recipe, size: [pick.w.w, pick.w.h], ids: ds.filter(d => d.screen === recipe.id && d.widths.some(w => w.w === pick.w.w && w.h === pick.w.h)).map(d => d.id) } : null
}

module.exports = { sourceDigest, reusable, quickTarget }
