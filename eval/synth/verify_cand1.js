#!/usr/bin/env node
// 후보 묶음 1 정답 확인(dqa 규칙과 무관): 결함 변형에서는 truth.actual이, 같은 화면의 ok에서는 truth.expected가 실제로 보이는지 브라우저로 본다.
//   text: sel 요소의 글자 / link: 버튼(label)을 눌러 도착한 화면의 제목(#title) / action: 버튼을 누른 뒤 카드·글자 상태
// 통과한 사례만 cases.json에 verified를 적는다. 사용: node eval/synth/verify_cand1.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const { launch } = require(path.join(ROOT, 'dqa', 'measure', 'browser'))
const FILE = path.join(__dirname, 'cand1', 'cases.json')
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()

async function observe (page, dir, t) {
  await page.goto('file://' + path.join(ROOT, dir, 'index.html'))
  await page.waitForTimeout(150)
  if (t.kind === 'text') return norm(await page.locator(t.sel).first().innerText())
  const btn = page.getByText(t.label, { exact: true }).first()
  if (t.kind === 'link') {
    await btn.click(); await page.waitForLoadState('load')
    return norm(await page.locator('#title').innerText().catch(() => '(제목 없음)'))
  }
  if (t.kind === 'action') {
    await btn.click(); await page.waitForTimeout(150)
    const cards = await page.locator('.card').count()
    if (!cards) return '카드가 사라짐'
    return norm(await page.locator('.card p').first().innerText()).split(' · ')[0]
  }
  throw new Error('kind ' + t.kind)
}

async function main () {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  const b = await launch(); const ctx = await b.newContext({ viewport: { width: 375, height: 812 } })
  let pass = 0; const defects = data.cases.filter((c) => c.truth)
  for (const c of data.cases) delete c.verified
  for (const c of defects) {
    const page = await ctx.newPage()
    const okDir = c.dir.replace(/[^/]+$/, 'ok')
    const got = await observe(page, c.dir, c.truth); const okGot = await observe(page, okDir, c.truth)
    const want = norm(c.truth.actual); const exp = norm(c.truth.expected)
    const good = (c.truth.kind === 'text' ? got === want : got === want) && (c.truth.kind === 'action' ? okGot === exp : okGot === exp)
    console.log(`${c.id.padEnd(26)} ${good ? '통과' : '실패'}  결함 화면: ${got} | ok: ${okGot}`)
    if (good) { c.verified = { at: new Date().toISOString(), observed: got, ok_observed: okGot }; pass++ }
    await page.close()
  }
  await b.close()
  fs.writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n')
  console.log(`정답 확인 ${pass}/${defects.length}`)
  process.exit(pass === defects.length ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(2) })
