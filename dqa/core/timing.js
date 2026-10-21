const { performance } = require('node:perf_hooks')
function timer (rows, onRecord = () => {}) {
  return async (stage, fn, detail = {}) => {
    const start = performance.now()
    let ok = false
    try { const value = await fn(); ok = true; return value } finally {
      const row = { stage, ms: Math.round(performance.now() - start), ok, ...detail }
      rows.push(row); onRecord(row)
    }
  }
}
module.exports = { timer }
