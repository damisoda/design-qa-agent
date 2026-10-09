// dqa recipe test: 레시피로 화면에 들어가지는지 한 크기에서 확인하고, 그 화면의 이슈를 요약한다.
const { launch } = require('../measure/browser')
const { measureOne } = require('../measure/sweep')
const { loadRecipe } = require('../recipes/runner')
const { openDist, openUrl } = require('./targets')
const { createRun } = require('./util')

async function recipeTest (args, cfg) {
  const recipe = loadRecipe(args.recipe)
  const [w, h] = String(args.size || '375x812').split('x').map(Number)
  const t = args.url ? await openUrl(args.url, cfg, args.src) : await openDist(args.dist, cfg, args.src)
  const run = createRun(`recipe-test_${recipe.id}`)
  const browser = await launch()
  try {
    const r = await measureOne(browser, { origin: t.origin, recipe, width: w, height: h, side: 'head', run, cfg, shots: !!args.shots })
    if (!r.ok) {
      console.log(`실패: ${r.error}\n보이는 글자: ${(r.visible.texts || []).join(' | ')}\n입력칸: ${JSON.stringify(r.visible.inputs)}\n캡처: ${r.fail_shot ? run.file(r.fail_shot) : '없음'}`)
      return 1
    }
    console.log(`통과: ${recipe.id} ${w}x${h} — 진입 ${r.enter.trail}단계, 안정 ${r.enter.settled ? '예' : '아니오'}, 스크롤 ${r.scroll.kind} ${r.scroll.steps}단계, 배율 ${r.scale}, 글꼴 ${r.fonts.loaded.join(', ') || '없음'}, 차단 요청 ${r.blocked.length}건, ${(r.ms / 1000).toFixed(1)}초`)
    for (const it of r.issues) console.log(`  ${it.rule} [${it.el.label}] ${it.text} (스크롤 ${it.scroll_y})`)
    console.log(`실행 폴더: ${run.dir}`)
    return 0
  } finally { await browser.close(); t.close() }
}

module.exports = { recipeTest }
