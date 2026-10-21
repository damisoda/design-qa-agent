// 수정 모듈 단위 시험: 정적 사이트 소스 인식과 CSS 규칙 수정안
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { cssRuleEdits, staticSource, fixability } = require('../fix/fix')

function site (css, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-fix-'))
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><style>:root{--text:#111;--muted:#555}\n.photo{width:100%;height:240px}\n.serv b{width:28px}\n${css}</style></head><body><img class="photo" src="a.png"><div class="serv"><b>2인분</b></div></body></html>`)
  for (const [f, v] of Object.entries(extra)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), v) }
  return dir
}

test('정적 사이트: 번들 없는 index.html 폴더는 소스로 보고, 번들·소스 경로가 있으면 보지 않는다', () => {
  const a = site('')
  assert.ok(staticSource({ kind: 'dist', src: null, dist: a }))
  assert.strictEqual(staticSource({ kind: 'dist', src: '/somewhere', dist: a }), null)
  const b = site('', { '_expo/static/js/web/a/b/index.js': 'x' })
  assert.strictEqual(staticSource({ kind: 'dist', src: null, dist: b }), null)
  const c = site('', { 'assets/x/y/z/w/big.js': 'x'.repeat(200000) })
  assert.strictEqual(staticSource({ kind: 'dist', src: null, dist: c }), null)
  assert.strictEqual(fixability({ targets: { head: { kind: 'dist', src: null, dist: c } } }, { repos: {}, dists: {} }).ok, false)
  assert.strictEqual(fixability({ targets: { head: { kind: 'url' } } }, { repos: {}, dists: {} }).ok, false)
})

test('CSS 수정안: 늘어난 그림은 클래스 규칙에 object-fit, 클래스 없는 요소는 부모 클래스 + 태그 규칙, 대비는 토큰 색', () => {
  const dir = site('.photo{object-fit:fill}')
  const d4 = cssRuleEdits({ rule: 'D4', diag: [{ code: 'image_distorted' }], elements: [{ cls: ['photo'], tag: 'img' }] }, dir)
  // 같은 속성이 있으면 값을 바꾼다(줄 끝에 같은 속성을 또 붙이지 않는다)
  assert.ok(d4.length && d4[0].replace.includes('.photo{object-fit:cover}'), JSON.stringify(d4))
  const r6 = cssRuleEdits({ rule: 'R6', diag: [], elements: [{ cls: [], pcls: ['serv'], tag: 'b' }] }, dir)
  assert.ok(r6.some((e) => e.find.includes('.serv b{') && e.replace.includes('white-space:nowrap')), JSON.stringify(r6))
  const a2 = cssRuleEdits({ rule: 'A2', diag: [], elements: [{ cls: ['photo'], tag: 'img' }] }, dir)
  assert.deepStrictEqual(a2.map((e) => e.replace.match(/color:var\(--\w+\)/)[0]), ['color:var(--muted)', 'color:var(--text)'])
})

test('함께 적용: 같은 CSS 규칙을 고치는 수정 여러 개는 한 규칙에 합친다', () => {
  const { applyEdits } = require('../fix/fix')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-merge-'))
  fs.writeFileSync(path.join(dir, 'style.css'), '.a { color: red; }\n.join { width: 240px; background: #3366FF; }\n')
  const rule = '\n.join { width: 240px; background: #3366FF; }'
  const e1 = { file: 'style.css', find: rule, replace: '\n.join { width: 240px; background: var(--brand); }', decl: 'background-color:var(--brand)' }
  const e2 = { file: 'style.css', find: rule, replace: '\n.join { width: 240px; background: #3366FF; flex: 1 1 0%; min-width: 0; }', decl: 'flex:1 1 0%;min-width:0' }
  const out = applyEdits(dir, [e1, e2]).get('style.css').after
  assert.strictEqual(out, '.a { color: red; }\n.join { width: 240px; background: var(--brand); flex: 1 1 0%; min-width: 0; }\n')
})

test('누르면 오류의 원인: 스택의 번들 위치 코드와 같은 이름이 있는 소스 줄(타입 선언 줄은 뺀다)', () => {
  const { stackCauses } = require('../code/cause')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dqa-stack-'))
  fs.mkdirSync(path.join(root, 'src', 'screens'), { recursive: true }); fs.mkdirSync(path.join(root, 'dist', 'js'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'api.ts'), 'export type S = {\n  filled_keys: string[];\n}\n')
  fs.writeFileSync(path.join(root, 'src', 'screens', 'Chat.tsx'), 'export function Chat ({ session }) {\n  const filled = session?.filled_keys.length ?? 0\n  return filled\n}\n')
  const bundle = 'var a=1;\n' + 'function z(e){const A=e.s,N=A?.filled_keys.length??0;return N}'
  fs.writeFileSync(path.join(root, 'dist', 'js', 'index.js'), bundle)
  const col = bundle.split('\n')[1].indexOf('.length') + 1
  const c = stackCauses(`at z (/js/index.js:2:${col}) ← at x`, { distDir: path.join(root, 'dist'), srcDir: path.join(root, 'src'), srcRoot: root })
  assert.strictEqual(c.length, 1)
  assert.strictEqual(c[0].file, path.join('src', 'screens', 'Chat.tsx')); assert.strictEqual(c[0].line, 2)
})
