// 대상 해석: --dist(이름 또는 폴더) / --url / --repo(cbh_git). 결과는 { origin, src, ref, note, close }.
const fs = require('fs')
const path = require('path')
const { home, assertAllowedPath } = require('./util')
const { serveDist } = require('../targets/static')

function resolveDistSpec (spec, cfg) {
  const named = cfg.dists && cfg.dists[spec]
  if (named) return { dir: assertAllowedPath(named.dir, cfg), src: named.src ? assertAllowedPath(named.src, cfg) : null, note: named.note, name: spec, repo: named.repo || null }
  const dir = assertAllowedPath(spec, cfg)
  if (!fs.existsSync(dir)) throw new Error(`빌드 폴더가 없다: ${spec}`)
  return { dir, src: null, note: path.basename(dir), name: path.basename(dir) }
}

async function openDist (spec, cfg, srcOverride) {
  const d = resolveDistSpec(spec, cfg)
  const s = await serveDist(d.dir)
  return { kind: 'dist', origin: s.origin, src: srcOverride ? assertAllowedPath(srcOverride, cfg) : d.src, ref: d.name, note: d.note, dir: d.dir, repo: d.repo || null, close: s.close }
}

async function openUrl (url, cfg, src) {
  const u = new URL(url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && !u.hostname.endsWith('.localhost') && !u.hostname.endsWith('.test')) throw new Error(`로컬 주소만 검사한다(받은 값: ${u.hostname}). 외부 사이트는 대상이 아니다`)
  return { kind: 'url', origin: u.origin, start: u.pathname + u.search, src: src ? assertAllowedPath(src, cfg) : null, ref: u.host, note: url, close: () => {} }
}

module.exports = { openDist, openUrl, resolveDistSpec, home }
