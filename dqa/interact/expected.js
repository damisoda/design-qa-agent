// 프로토타입의 목적지와 구현의 이동 주소·목적지 글자를 결정적으로 비교한다.
const norm = (s) => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim()
function textsOf (nodes) {
  return (nodes || []).flatMap((n) => [...(n.text && n.text.content ? [norm(n.text.content)] : []), ...textsOf(n.children)])
}
function checkDestination (actions, spec, observed) {
  const sourceTexts = new Set(textsOf(spec && spec.nodes))
  const checks = (actions || []).map((a) => {
    if (a.type === 'URL') {
      try {
        const want = new URL(a.url, observed.before_url).href
        const actual = new URL(observed.url).href
        return { status: want === actual ? 'matched' : 'mismatch', text: `시안 이동 주소 ${want}, 실제 이동 주소 ${actual}` }
      } catch (e) { return { status: 'unverified', text: '시안 또는 구현의 이동 주소를 해석할 수 없다' } }
    }
    if (a.type !== 'NODE') return { status: 'unverified', text: '뒤로 가기의 목적지 주소 정보가 없다' }
    const target = spec && spec.prototype_targets && spec.prototype_targets[a.dest]
    const route = a.dest_route || (target && target.route)
    if (route) {
      try {
        const want = new URL(route, observed.before_url).href
        return { status: observed.url === want ? 'matched' : 'mismatch', text: `시안 목적지 ${a.dest_name || a.dest} 경로 ${want}, 실제 이동 주소 ${observed.url}` }
      } catch (e) { return { status: 'unverified', text: '시안 목적지 경로를 해석할 수 없다' } }
    }
    // 시작 화면과 공유하는 메뉴·버튼 글자는 목적지를 구별하는 근거가 될 수 없다.
    const anchors = [...new Set(((target && target.texts) || []).map(norm))].filter((t) => t.length >= 2 && !sourceTexts.has(t))
    if (!anchors.length) return { status: 'unverified', text: `시안 목적지 ${a.dest_name || a.dest}를 구별할 경로·글자 정보가 없다` }
    if (observed.body_text === undefined) return { status: 'unverified', text: '이동한 화면의 글자를 읽지 못했다' }
    const body = norm(observed.body_text)
    const missing = anchors.filter((t) => !body.includes(t))
    return { status: missing.length ? 'mismatch' : 'matched', text: `시안 목적지 ${target.name || a.dest_name || a.dest}${missing.length ? `의 글자가 구현 화면에 없다: ${missing.slice(0, 5).join(' / ')}` : `의 글자 ${anchors.slice(0, 5).join(' / ')}가 구현 화면에 있다`}`, anchors, missing }
  })
  const status = checks.some((c) => c.status === 'matched') ? 'matched' : checks.length && checks.every((c) => c.status === 'mismatch') ? 'mismatch' : 'unverified'
  return { status, text: checks.map((c) => c.text).join('; '), checks }
}
// Native inputs do not expose their displayed value/placeholder through body.innerText.
function destinationText () {
  const controls = [...document.querySelectorAll('input,textarea,select')].filter(el => {
    const r=el.getBoundingClientRect(),s=getComputedStyle(el)
    return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden' && el.type!=='password' && el.type!=='hidden'
  }).map(el=>el.tagName==='SELECT' ? el.selectedOptions[0]?.textContent || '' : el.value || el.placeholder || '')
  return [(document.body?.innerText || ''),...controls].join('\n')
}
module.exports = { checkDestination, textsOf, destinationText }
