// Figma 데스크톱의 로컬 플러그인과 연결한다. 디자인 값은 실제 플러그인 내보내기에서만 온다.
const { execFile } = require('child_process'); const { randomUUID, createHash } = require('crypto')
const { slug } = require('./library')
function figmaLink (raw) {
  if (!String(raw || '').trim()) return null
  let url; try { url = new URL(String(raw).trim()) } catch (e) { throw new Error('Figma 파일 또는 프레임 링크를 넣어 주세요') }
  if (url.protocol !== 'https:' || !['figma.com', 'www.figma.com'].includes(url.hostname) || url.username || url.password) throw new Error('figma.com의 디자인 파일 링크만 열 수 있습니다')
  const parts = url.pathname.split('/').filter(Boolean)
  if (!['design', 'file'].includes(parts[0]) || !/^[a-zA-Z0-9]{5,100}$/.test(parts[1] || '')) throw new Error('Figma Design 파일 링크를 넣어 주세요')
  const node = url.searchParams.get('node-id')
  if (node && !/^[a-zA-Z0-9:;-]{1,120}$/.test(node)) throw new Error('프레임 링크의 노드 번호가 올바르지 않습니다')
  const clean = new URL(`https://www.figma.com/design/${parts[1]}`)
  if (node) clean.searchParams.set('node-id', node)
  const desktop = new URL(`figma://file/${parts[1]}`)
  if (node) desktop.searchParams.set('node-id', node)
  return { url: clean.href, desktop: desktop.href, file_key: parts[1], node_id: node && node.replace(/(\d)-(\d)/g, '$1:$2') }
}
function openFigma (link) {
  if (process.platform !== 'darwin') throw new Error('Figma 앱 열기는 현재 macOS에서 지원합니다. Figma에서 파일을 열고 dqa 플러그인을 실행해 주세요')
  return new Promise((resolve, reject) => execFile('open', ['-a', 'Figma', ...(link ? [link.desktop] : [])], { timeout: 8000 }, e => e ? reject(new Error('Figma 앱을 열지 못했습니다. Figma 데스크톱 앱이 설치되어 있는지 확인해 주세요')) : resolve()))
}
function createFigmaConnection (open = openFigma, launch = options => require('./launch-plugin').launchPlugin(options)) {
  const clients = new Map(); let session = null; let autoState = null; let activeFile = null
  const publicClient = c => ({ id: c.id, file: c.file, page: c.page, frames: c.frames, seen_at: new Date(c.seen).toISOString() })
  const snapshot = () => {
    if (session?.state === 'exporting' && Date.now() - session.export_started > 60000) {
      session.state = 'error'; session.error = 'Figma 내보내기 응답이 없습니다. 기존 시안은 유지됩니다. 플러그인 연결을 확인하고 다시 가져와 주세요.'
      const c = clients.get(session.client_id); if (c?.command?.id === session.request_id) delete c.command
    }
    return { auto: autoState, session: session ? { id: session.id, state: session.state, request_id: session.request_id, launch: session.launch || null, link: session.link && session.link.url, saved: session.saved || [], error: session.error || null } : null,
    files: [...clients.values()].filter(c => Date.now() - c.seen < 8000 && (!activeFile || c.file === activeFile)).map(publicClient) }
  }
  const validSession = id => { if (!session || session.id !== id || Date.now() - session.created > 30 * 60 * 1000) throw new Error('Figma 연결 요청이 만료됐습니다. Figma 열기로 다시 연결해 주세요'); return session }
  let connecting = false; let nextWatch = 0; let watchBlocked = false; let pendingAuto = null
  const watch = async () => {
    snapshot() // expire stalled exports before checking the guard
    if (connecting || session?.state === 'exporting' || watchBlocked || Date.now() < nextWatch) return snapshot()
    connecting = true
    try {
      let result = await launch({automatic:true,probe:true})
      if (result.status === 'active' && result.file) {
        activeFile = result.file
        const healthy = [...clients.values()].some(c => c.file === result.file && Date.now()-c.seen < 5000)
        if (healthy) { result = {status:'already_running',file:result.file}; pendingAuto = null }
        else if (pendingAuto?.file === result.file && Date.now()-pendingAuto.at < 15000) result = {status:'waiting',file:result.file}
        else {
          result = await launch({automatic:true})
          if (result.status === 'requested') pendingAuto = {file:result.file,at:Date.now()}
        }
      }
      autoState = {...result, checked_at:Date.now()}
      if (result.file) activeFile = result.file
      nextWatch = Date.now() + (['requested','inactive','busy','already_running','waiting'].includes(result.status) ? 3000 : 30000)
      watchBlocked = ['permission_required','unsupported','plugin_not_found'].includes(result.status)
      if (!['inactive','busy'].includes(result.status)) {
        if (!session || Date.now()-session.created > 30*60*1000) session = {id:randomUUID(),created:Date.now(),state:'waiting',link:null}
        // Keep the imported snapshot/session until the user explicitly imports a new selection.
        if (!['already_running','waiting'].includes(result.status)) session.launch = {...result,requested_at:Date.now()}
      }
      return snapshot()
    } finally { connecting = false }
  }
  const connect = async body => {
    if (connecting || session?.state === 'exporting') throw new Error('Figma의 이전 요청을 처리하고 있습니다. 잠시 뒤 다시 눌러 주세요.')
    connecting = true
    try {
      watchBlocked = false; nextWatch = 0
      const link = figmaLink(body.url); await open(link)
      const s = { id: randomUUID(), created: Date.now(), state: 'waiting', link }; session = s
      if (body.launch_plugin === true) {
        s.launch = { status:'starting' }
        // A fresh plugin heartbeat means it is already running. Do not restart it.
        if (!link && snapshot().files.length) {
          await new Promise(resolve => setTimeout(resolve, 1100))
        }
        const live = !link && [...clients.values()].some(c => c.seen >= s.created)
        const result = live ? {status:'already_connected'} : await launch()
        if(result.file) activeFile = result.file
        if (session === s) s.launch = {...result, requested_at:Date.now()}
      }
      return snapshot()
    } finally { connecting = false }
  }
  const poll = body => {
    if (!/^[\w-]{8,100}$/.test(body.client_id || '')) throw new Error('플러그인 연결 ID가 없습니다')
    const old = clients.get(body.client_id) || {}
    const frames = (body.frames || []).slice(0, 30).filter(f => f && /^[a-zA-Z0-9:;-]{1,120}$/.test(f.id) && Number.isFinite(f.w) && Number.isFinite(f.h)).map(f => ({ id: f.id, name: String(f.name || '').slice(0, 160), w: f.w, h: f.h }))
    const c = { ...old, id: body.client_id, seen: Date.now(), file: String(body.file || '').slice(0, 200), page: String(body.page || '').slice(0, 200), frames }
    if (body.ack && c.command && body.ack.id === c.command.id) { if (body.ack.ok === false && session && session.request_id === c.command.id) { session.state = 'error'; session.error = String(body.ack.error || '프레임을 가져오지 못했습니다').slice(0, 300) } c.result = body.ack; delete c.command }
    clients.set(c.id, c)
    for (const [id, item] of clients) if (Date.now() - item.seen > 60000) clients.delete(id)
    return { session_id: session && session.id, command: c.command || null }
  }
  const importSelection = body => {
    const c = clients.get(body.client_id)
    if (!c || Date.now() - c.seen > 8000) throw new Error('Figma 플러그인 연결이 끊겼습니다. 파일에서 dqa 플러그인을 다시 실행해 주세요')
    if (!c.frames.length) throw new Error('Figma에서 비교할 프레임을 선택해 주세요')
    if (c.command) throw new Error('프레임을 가져오고 있습니다. 잠시 기다려 주세요')
    // An explicit import can start a session directly from an active local plugin.
    if (!body.session_id) session = { id: randomUUID(), created: Date.now(), state: 'waiting', link: null }
    const s = validSession(body.session_id || session.id)
    s.export_started = Date.now(); s.error = null; s.refresh_name = null; s.state = 'exporting'; s.client_id = c.id; s.request_id = randomUUID(); s.file = c.file; s.frame_ids = c.frames.map(f => f.id)
    c.command = { id: s.request_id, type: 'export', session_id: s.id, frame_ids: c.frames.map(f => f.id) }
    return snapshot()
  }
  // Refresh only the imported frame through its original live plugin session.
  // Never infer file identity from a matching display name after reconnecting.
  const refresh = (name, spec) => {
    const c = clients.get(spec.figma?.client_id)
    if (!c || Date.now() - c.seen > 8000 || c.file !== spec.file) throw new Error('이 시안을 가져온 플러그인 연결이 끝났습니다. 같은 Figma 파일에서 프레임을 선택한 뒤 새로 가져와 주세요. 기존 시안은 유지됩니다.')
    if (c.command) throw new Error('Figma에서 이전 요청을 처리하고 있습니다. 잠시 뒤 다시 눌러 주세요.')
    if (!spec.frame?.id) throw new Error('가져온 프레임 ID가 없습니다. Figma에서 다시 선택해 주세요.')
    session = { id: randomUUID(), created: Date.now(), export_started: Date.now(), state: 'exporting', link: null, client_id: c.id, file: c.file, frame_ids: [spec.frame.id], request_id: randomUUID(), refresh_name: name, refresh_key: spec.figma?.file_key || null }
    c.command = { id: session.request_id, type: 'export', session_id: session.id, frame_ids: session.frame_ids }
    return snapshot()
  }
  const importContext = body => {
    snapshot()
    const s = validSession(body.session_id)
    if (s.state === 'error') throw new Error(s.error)
    if (s.client_id !== body.client_id || s.request_id !== body.request_id) throw new Error('이 연결에서 요청하지 않은 프레임입니다')
    const c = clients.get(body.client_id); if (!c || c.file !== s.file) throw new Error('Figma 파일이 바뀌었습니다. 다시 프레임을 선택해 주세요')
    return s
  }
  const decorate = (body, item) => {
    const s = importContext(body); const spec = item.spec
    if (!spec || spec.file !== s.file || !spec.frame || !s.frame_ids.includes(spec.frame.id)) throw new Error('선택한 실제 Figma 파일·프레임과 내보내기가 일치하지 않습니다')
    if (s.refresh_key && spec.figma?.file_key !== s.refresh_key) throw new Error('원래 Figma 파일과 다릅니다. 기존 시안을 유지합니다.')
    const key = createHash('sha1').update((spec.figma && spec.figma.file_key) || s.file + '|' + body.client_id).digest('hex').slice(0, 8)
    const figma = { ...(spec.figma || {}), client_id: body.client_id, linked_url: s.link && s.link.url, link_verified: !!(s.link && spec.figma && spec.figma.file_key === s.link.file_key) }
    return { ...item, name: s.refresh_name || `${slug(spec.frame.name).slice(0, 36)}-${key}-${slug(spec.frame.id)}`, spec: { ...spec, figma } }
  }
  const imported = (body, saved) => { const s = importContext(body); s.state = 'ready'; s.saved = saved; const c = clients.get(body.client_id); if (c && c.command && c.command.id === body.request_id) delete c.command; return snapshot() }
  const focus = async (spec, nodeId) => {
    const origin = spec.figma || {}; const c = clients.get(origin.client_id)
    if (!c || Date.now() - c.seen > 8000 || c.file !== spec.file) throw new Error('해당 Figma 파일에서 dqa 플러그인을 실행해 주세요. 현재 파일에 연결되어야 요소를 선택할 수 있습니다')
    if (c.command) throw new Error('Figma에서 이전 작업을 처리하고 있습니다. 잠시 뒤 다시 눌러 주세요')
    await open(null)
    c.command = { id: randomUUID(), type: 'focus', node_id: nodeId, page_id: spec.page_id || null }
    return { ok: true, request_id: c.command.id, file: c.file }
  }
  const result = id => { for (const c of clients.values()) if (c.result && c.result.id === id) return c.result; return null }
  return { connect, watch, snapshot, poll, importSelection, refresh, decorate, imported, focus, result }
}
module.exports = { figmaLink, openFigma, createFigmaConnection }
