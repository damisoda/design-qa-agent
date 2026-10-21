// 측정 규칙 단위 시험: 결함을 심은 페이지에서 해당 규칙이 잡히고, 깨끗한 페이지에서는 아무것도 안 잡히는지.
const { test, before, after } = require('node:test')
const assert = require('node:assert')
const path = require('path')
const { launch, newContext } = require('../measure/browser')
const { serveDist } = require('../targets/static')
const { dqaScan } = require('../measure/inpage')

let browser; let srv
before(async () => { browser = await launch(); srv = await serveDist(path.join(__dirname, 'fixtures')) })
after(async () => { await browser.close(); srv.close() })

async function scan (page, w = 375, h = 812, extra = {}, safe = null) {
  const ctx = await newContext(browser, { origin: srv.origin, width: w, height: h })
  const p = await ctx.newPage()
  if (safe) { const c = await ctx.newCDPSession(p); await c.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: safe[0], bottom: safe[1], left: 0, right: 0 } }) }
  await p.goto(`${srv.origin}/${page}`)
  await p.evaluate(() => Promise.all([...document.images].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r }))))
  const out = await p.evaluate(dqaScan, { root: '#root', final: true, ...extra })
  await ctx.close()
  return out
}
const rules = (out) => [...new Set(out.issues.map((i) => i.rule))]

test('깨끗한 페이지에서는 결함 0건', async () => {
  const out = await scan('index.html')
  assert.deepStrictEqual(out.issues.map((i) => `${i.rule} ${i.text}`), [])
})
test('R1 넘침: min-width auto 입력칸 3개가 300px 줄을 넘침 + 진단', async () => {
  const out = await scan('r1.html')
  assert.ok(rules(out).includes('R1'), JSON.stringify(rules(out)))
  assert.ok(out.issues.some((i) => i.rule === 'R1' && i.diag && i.diag.code === 'flex_min_auto'))
})
test('R2 잘림: overflow hidden 상자 안의 긴 글', async () => {
  assert.ok(rules(await scan('r2.html')).includes('R2'))
})
test('R3 겹침: 글자끼리, 글자와 얇은 막대', async () => {
  const out = await scan('r3.html')
  assert.ok(out.issues.some((i) => i.rule === 'R3' && i.other && i.other.kind === 'text'))
  assert.ok(out.issues.some((i) => i.rule === 'R3' && i.other && i.other.kind === 'bar'))
})
test('R4 가려짐: 화면 아래 고정 탭바가 버튼을 덮음', async () => {
  const out = await scan('r4.html')
  assert.ok(out.issues.some((i) => i.rule === 'R4' && i.el.label.includes('신고 접수하기')), JSON.stringify(rules(out)))
})
test('R6 줄바꿈: 좁은 상자의 두 글자 라벨', async () => {
  const out = await scan('r6.html')
  assert.ok(out.issues.some((i) => i.rule === 'R6' && i.diag && i.diag.code.startsWith('narrow_box')))
})
test('R7 틀 이탈: 430 화면에서 375 앱 틀 밖으로 나간 시트', async () => {
  assert.ok(rules(await scan('r7.html', 430, 932)).includes('R7'))
})
test('R1 화면 가로 넘침: 375 폭 화면이 320 기기에서 넘침(레이아웃 폭이 늘어남)', async () => {
  const out = await scan('r1_page.html', 320, 568)
  assert.ok(out.issues.some((i) => i.rule === 'R1' && i.metric === 'page_overflow_px'), JSON.stringify(out.issues.map((i) => i.rule + ' ' + i.metric)))
  assert.ok(out.page_horizontal_overflow_px > 2)
})
test('R1 화면 가로 넘침: 같은 페이지가 375 기기에서는 0건', async () => {
  const out = await scan('r1_page.html', 375, 812)
  assert.ok(!out.issues.some((i) => i.metric === 'page_overflow_px'))
})
test('R7 틀 이탈: #root는 창 전체이고 안쪽 375 앱 틀 밖으로 나간 모달', async () => {
  assert.ok(rules(await scan('r7_inner.html', 1024, 768)).includes('R7'))
})
test('깨끗한 페이지는 데스크톱 폭에서도 0건', async () => {
  const out = await scan('index.html', 1024, 768)
  assert.deepStrictEqual(out.issues.map((i) => `${i.rule} ${i.text}`), [])
})
test('로컬 모드: index.html만 있는 폴더는 정적 사이트로 본다', () => {
  const { detectProject } = require('../targets/local')
  const pj = detectProject(path.join(__dirname, 'fixtures'))
  assert.strictEqual(pj.kind, 'static')
  assert.strictEqual(pj.build, null)
})
test('A1 작은 터치 영역, A2 낮은 글자 대비, R6 띄어쓰기 없는 가격 꺾임', async () => {
  const out = await scan('a12.html')
  const r = rules(out)
  assert.ok(r.includes('A1') && r.includes('A2'), JSON.stringify(r))
  assert.ok(out.issues.some((i) => i.rule === 'R6' && i.el.label.includes('12,900원')), JSON.stringify(out.issues.map((i) => i.rule + ' ' + i.el.label)))
})
test('R3 상자끼리 겹침(지도 핀 칩과 버튼)은 잡고, 아이콘 위 배지·여러 줄 해시태그·FAB 아래 스크롤 내용은 겹침이 아니다', async () => {
  const out = await scan('r3_box.html')
  const r3 = out.issues.filter((i) => i.rule === 'R3')
  assert.ok(r3.some((i) => i.metric === 'box_overlap_px' && i.el.label.includes('숲속로스터리')), JSON.stringify(r3.map((i) => i.text)))
  assert.deepStrictEqual(r3.filter((i) => !i.el.label.includes('숲속로스터리')).map((i) => i.text), [])
})
test('R4 큰 아래 시트가 지도 버튼을 가림, A2 footer 안의 옅은 글자', async () => {
  const out = await scan('r4_sheet.html')
  assert.ok(out.issues.some((i) => i.rule === 'R4' && /확대|축소/.test(i.el.label)), JSON.stringify(out.issues.map((i) => i.rule + ' ' + i.text)))
  assert.ok(out.issues.some((i) => i.rule === 'A2' && i.el.tag === 'footer'))
})
test('블라인드 2 빈틈: <time> 글자, 아이콘이 섞인 버튼 글자, 글자를 덮는 작은 배지, 그림 위로 올라간 설명, 머리글 아래 고정 탭', async () => {
  const out = await scan('gaps2.html', 375, 812, { first: true })
  const has = (rule, re, metric) => out.issues.some((i) => i.rule === rule && re.test(i.el.label) && (!metric || i.metric === metric))
  const all = JSON.stringify(out.issues.map((i) => `${i.rule} ${i.metric} ${i.el.label.slice(0, 16)}`))
  assert.ok(has('R6', /2026\.10\.09/), all)
  assert.ok(has('A2', /필터 적용/), all)
  assert.ok(has('R3', /모노레일|무손실/), all)
  assert.ok(has('R3', /채소 코너/, 'image_overlap_px'), all)
  assert.ok(has('R4', /12,480|걸음/), all)
  assert.ok(!out.issues.some((i) => /강의 소개/.test(i.el.label)), '대비를 맞춰 그림 위에 얹은 글자는 결함이 아니다: ' + all)
  assert.ok(!out.issues.some((i) => /알림 아래|임시 저장/.test(i.el.label)), '잠깐 뜨는 알림이 덮은 글자는 겹침이 아니다: ' + all)
})
test('블라인드 3 빈틈: 앱 틀 밖 낮은 고정 막대(R7), 아이콘 링크(A1), 반투명 카드 위 글자(A2), 노치 아래 아이콘 버튼(R4). 큰 숫자·자기 넘침 숨김은 겹침 아님', async () => {
  const out = await scan('gaps3.html', 768, 1024)
  const all = JSON.stringify(out.issues.map((i) => `${i.rule} ${i.metric} ${i.el.label.slice(0, 16)}`))
  const has = (rule, re) => out.issues.some((i) => i.rule === rule && re.test(i.el.label))
  assert.ok(has('R7', /다음 단계까지/), all)
  assert.ok(has('A1', /자료 받기/), all)
  assert.ok(has('A2', /최저 12°/), all)
  assert.ok(!out.issues.some((i) => i.rule === 'R3'), '큰 숫자의 글자 영역, 숨긴 줄은 겹침이 아니다: ' + all)
  const notch = await scan('gaps3.html', 375, 812, { first: true }, [47, 34])
  assert.ok(notch.issues.some((i) => i.rule === 'R4' && i.metric === 'safe_area_px' && /뒤로|공유/.test(i.el.label)), JSON.stringify(notch.issues.map((i) => `${i.rule} ${i.metric} ${i.el.label.slice(0, 16)}`)))
})
test('블라인드 4 빈틈: 작은 로고 왜곡(D4), 도넛 링에 걸친 글자(R3), 그림 위 반투명 칩(A2), 줄끼리 겹침(R3), placeholder·흐린 글자 대비(A2). 위아래로 쌓은 라벨은 R6 아님', async () => {
  const out = await scan('gaps4.html', 375, 1200)
  const all = JSON.stringify(out.issues.map((i) => `${i.rule} ${i.metric} ${i.el.label.slice(0, 16)}`))
  const has = (rule, re, metric) => out.issues.some((i) => i.rule === rule && re.test(i.el.label) && (!metric || i.metric === metric))
  assert.ok(has('D4', /항공사 로고/), all)
  assert.ok(has('R3', /식비 32%/, 'svg_overlap_px'), all)
  assert.ok(!has('R3', /교통 18%/), '링 안에 들어간 가운데 글자는 겹침이 아니다: ' + all)
  assert.ok(!has('R3', /12,480원/), '불투명 말풍선 글자는 차트 선과 겹침이 아니다: ' + all)
  assert.ok(has('A2', /도착 예정/), all)
  assert.ok(has('R3', /비타민D/, 'line_overlap_px'), all)
  assert.ok(has('A2', /동, 호수/, 'placeholder_contrast_x100'), all)
  assert.ok(has('A2', /주간 회의/), all)
  assert.ok(!out.issues.some((i) => i.rule === 'R6'), '위아래로 쌓은 월/13은 꺾인 라벨이 아니다: ' + all)
})

test('G1 글자 기호 아이콘: 재생·메뉴·편집·내 위치·설정 기호와 없는 아이콘 글꼴을 잡는다', async () => {
  const out = await scan('g1.html')
  const g = out.issues.filter((i) => i.rule === 'G1')
  assert.deepStrictEqual(g.map((i) => i.glyph.ch).sort(), ['⌖', '⚙', '☰', '▶', '✎', '\uE5CD'].sort(), JSON.stringify(g.map((i) => i.text)))
  assert.deepStrictEqual(g.map((i) => i.glyph.pos).sort(), ['alone', 'alone', 'alone', 'prefix', 'prefix', 'suffix'].sort())
  // 없는 아이콘 글꼴은 확인 불가로 적는다
  assert.ok(g.find((i) => i.glyph.ch === '\uE5CD').text.includes('확인하지 못했다'))
})
test('G1 정상: 흔한 기호(• ‹ › × ※ → ✓), 이모지, 별점, 문장 가운데 기호, 코드, SVG 아이콘은 잡지 않는다', async () => {
  const out = await scan('g1_ok.html')
  assert.deepStrictEqual(out.issues.filter((i) => i.rule === 'G1').map((i) => i.text), [])
})
test('G1 앱이 불러온 글꼴이 기호를 직접 그리면 잡지 않는다(이 컴퓨터에 기호 글꼴이 있을 때만 확인)', async () => {
  const ctx = await newContext(browser, { origin: srv.origin, width: 375, height: 812 })
  const p = await ctx.newPage()
  await p.goto(`${srv.origin}/g1_webfont.html`)
  const ok = await p.evaluate(() => window.symReady)
  const out = await p.evaluate(dqaScan, { root: '#root', final: true })
  await ctx.close()
  if (!ok) return // 기호 글꼴이 없는 컴퓨터에서는 이 경우를 만들 수 없다
  assert.deepStrictEqual(out.issues.filter((i) => i.rule === 'G1').map((i) => i.text), [])
})

