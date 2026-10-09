// 빌드된 웹 앱(dist)을 127.0.0.1의 빈 포트에 띄운다. 없는 경로는 index.html로 돌려 SPA 라우팅을 살린다.
// tools/lib/static_server.js를 바탕으로, 빈 포트 선택과 파일 읽기 오류 처리를 더했다.
const http = require('http')
const fs = require('fs')
const path = require('path')

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.map': 'application/json', '.wasm': 'application/wasm'
}

function serveDist (root) {
  root = path.resolve(root)
  if (!fs.existsSync(path.join(root, 'index.html'))) return Promise.reject(new Error(`빌드 폴더에 index.html이 없다: ${root}`))
  const server = http.createServer((req, res) => {
    let url
    try { url = decodeURIComponent((req.url || '/').split('?')[0]) } catch (e) { res.writeHead(400); return res.end() }
    let file = path.join(root, url)
    if (!file.startsWith(root)) { res.writeHead(403); return res.end() }
    try { if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html') } catch (e) { file = path.join(root, 'index.html') }
    const stream = fs.createReadStream(file)
    stream.on('error', () => { if (!res.headersSent) res.writeHead(404); res.end() })
    stream.on('open', () => { res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' }); stream.pipe(res) })
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }))
  })
}

module.exports = { serveDist }
