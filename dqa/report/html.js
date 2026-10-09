// report.html: 실행 폴더 안에서 그대로 열리는 단독 보고서(캡처는 상대 경로). 웹 화면이 없어도 볼 수 있다.
const { sortDefects, STATUS } = require('./md')

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const px = (w) => (w.metric === 'lines' ? `${w.px}줄` : w.metric === 'height_ratio' ? `${w.px}배` : `${w.px}px`)

function reportHtml (m, defects, resolved, codeFindings) {
  const s = m.summary || {}
  const rows = sortDefects(defects).map((d, i) => {
    const st = d.accepted ? '무시' : STATUS[d.diff ? d.diff.status : 'none']
    const c = (d.causes && d.causes.candidates) || []
    const j = d.judge || {}
    const interp = (d.rule_text ? `<p>${esc(d.rule_text.cause)} ${esc(d.rule_text.fix)}</p>` : '') + (j.status === 'ok' ? `<p><b>문제</b> ${esc(j.problem)}</p><p><b>원본(기대)</b> ${esc(j.expected)}</p><p><b>${esc(j.verdict)}</b> · 보고서 에이전트(${esc(j.model)}) · 숫자 검증 통과 — ${esc(j.reason)}</p>` : `<p class="muted">분류 없음(${esc(j.reason || j.status || '')})</p>`)
    return `<article class="d"><header><span class="tag ${d.diff ? d.diff.status : 'none'}">${esc(st)}</span><h3>${i + 1}. ${esc(d.rule)} ${esc(d.rule_name)} — ${esc(d.labels.slice(0, 4).join(', '))}</h3></header>
<div class="grid"><div>${d.shots && d.shots.crop ? `<img src="${esc(d.shots.crop)}" alt="${esc(d.id)}">` : '<div class="noimg">캡처 없음</div>'}</div><div>
<table><tr><th>크기</th><th>측정</th></tr>${d.widths.map((w) => `<tr><td>${w.w}x${w.h}</td><td>${px(w)}${w.canvas_px !== w.px && /px$/.test(w.metric) ? ` (시안 ${w.canvas_px})` : ''}</td></tr>`).join('')}</table>
<p class="muted">심각도 ${esc(d.severity)} · 신뢰도 ${esc(d.confidence ? d.confidence.level : '—')}${d.only_at ? ` · 이 크기에서만: ${esc(d.only_at.join(', '))}` : ''}</p>
<ul>${d.evidence.slice(0, 3).map((e) => `<li>${esc(e.id)} ${esc(e.text)}</li>`).join('')}${(d.diag || []).map((g) => `<li>진단: ${esc(g.text)}</li>`).join('')}</ul>
<h4>원인 후보</h4><ol>${c.map((x) => `<li><code>${esc(x.file)}:${x.line}</code> <span class="muted">(${x.score}) ${esc(x.why.join(', '))}</span></li>`).join('') || '<li class="muted">없음</li>'}</ol>
<h4>문제 정의</h4>${interp}<p class="muted">ID ${esc(d.id)}</p></div></div></article>`
  }).join('\n')
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>디자인 검수 보고서</title>
<style>
:root{--bg:#fff;--fg:#111;--muted:#666;--line:#ddd;--card:#fafafa;--accent:#e0245e}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#999;--line:#333;--card:#1c1c1c}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px}
h1{font-size:20px;margin:0 0 4px}h3{font-size:15px;margin:0}h4{font-size:13px;margin:12px 0 4px}
.muted{color:var(--muted)}.sum{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}.sum div{border:1px solid var(--line);padding:8px 12px;border-radius:6px;min-width:84px}.sum b{display:block;font-size:20px}
.d{border:1px solid var(--line);border-radius:8px;padding:14px;margin:12px 0;background:var(--card)}.d header{display:flex;gap:8px;align-items:center;margin-bottom:10px}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:16px}@media (max-width:720px){.grid{grid-template-columns:1fr}}
img{max-width:100%;border:1px solid var(--line);border-radius:4px}.noimg{border:1px dashed var(--line);padding:24px;text-align:center;color:var(--muted)}
table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:3px 8px;text-align:left}code{font-size:12px}
.tag{font-size:12px;border:1px solid var(--fg);border-radius:10px;padding:1px 8px;white-space:nowrap}.tag.new,.tag.worsened{background:var(--fg);color:var(--bg)}
</style></head><body><main>
<h1>디자인 검수 보고서 — ${esc(m.title)}</h1>
${m.overview ? `<p><b>${esc(m.overview.text)}</b></p>` : ''}<p class="muted">${esc(m.run_id)} · 소요 ${m.total_sec}초 · 대상 ${esc(m.targets.head.note || m.targets.head.ref)}${m.targets.base ? ` · 비교 기준 ${esc(m.targets.base.note || m.targets.base.ref)}` : ''} · LLM ${esc(m.llm.status === 'ok' ? `${m.llm.model} ${m.llm.calls}회` : `사용 안 함(${m.llm.reason})`)}</p>
<div class="sum"><div><b>${s.new || 0}</b>새로 생김</div><div><b>${s.worsened || 0}</b>악화</div><div><b>${(s.unchanged || 0) + (s.improved || 0)}</b>기존</div><div><b>${s.no_base || 0}</b>상태 없음</div><div><b>${s.resolved || 0}</b>해결</div><div><b>${s.accepted || 0}</b>무시</div><div><b>${s.failed_sizes || 0}</b>측정 실패</div></div>
${rows || '<p>결함 없음</p>'}
${resolved.length ? `<h2>해결된 결함</h2><ul>${resolved.map((d) => `<li>${esc(d.rule)} ${esc(d.rule_name)} — ${esc(d.labels.slice(0, 4).join(', '))} (변경 전 ${d.widths.map((w) => `${w.w}x${w.h} ${px(w)}`).join(', ')})</li>`).join('')}</ul>` : ''}
${codeFindings && codeFindings.length ? `<h2>코드 검사: 새로 쓴 색 값</h2><table><tr><th>파일:줄</th><th>값</th><th>토큰</th></tr>${codeFindings.map((f) => `<tr><td><code>${esc(f.file)}:${f.line}</code></td><td>${esc(f.hex)}</td><td>${esc(f.token || '없음')}</td></tr>`).join('')}</table>` : ''}
</main></body></html>`
}

module.exports = { reportHtml }
