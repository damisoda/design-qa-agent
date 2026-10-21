#!/usr/bin/env node
// dqa — 디자인-구현 결함 검수 도구(로컬).
//   dqa check  --dist <빌드|이름> [--base-dist <빌드|이름>] --recipe <id>[,<id>] [--widths mobile5|notch3|375x812,390x844] [--safe 47,34] [--scroll none] [--design <design.json|폴더>] [--run-id <ID>] [--llm auto|off] [--src <소스>] [--base-src <소스>]
//   dqa check  --url <http://127.0.0.1:포트> --recipe <id> [--base-url <주소>] [--src <소스>]
//   dqa check  --repo cbh --pr <번호> | --ref <sha|브랜치> [--base <ref>] [--recipe ...]
//   dqa check  --local <작업 폴더> [--base HEAD|none|<ref>] [--recipe ...]   (작업 폴더는 읽기만, 기본 비교는 커밋 전 HEAD)
//   dqa recipe test --dist <빌드|이름> --recipe <id> [--size 375x812]
//   dqa recipe list
//   dqa fix --run <실행 ID> [--llm auto|off] [--keep]   (수정안 → 사본에 적용·빌드·재측정으로 검증)
//   dqa pr --run <실행 ID> [--onto <브랜치>] [--push --confirm "PR 올리기"]   (검증된 패치로 수정 브랜치·커밋·PR 본문, 올리기는 확인 필요)
//   dqa apply --run <실행 ID> [--defect <ID>] [--confirm "적용"] | --undo --confirm "되돌리기"   (로컬 모드: 검증된 수정을 작업 폴더에)
//   dqa design list | dqa design pull --url <Figma 프레임 링크> [--name <이름>] [--group <묶음>]   (토큰은 환경 변수 FIGMA_TOKEN)
//   dqa doctor | dqa up | dqa serve [--port 8792]
const { loadConfig } = require('./core/util')

function parseArgs (argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      if (v !== undefined) out[k] = v
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[k] = argv[++i]
      else out[k] = true
    } else out._.push(a)
  }
  return out
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const cfg = loadConfig()
  const [cmd, sub] = args._
  if (cmd === 'check') {
    const { check } = require('./core/run')
    const r = await check(args, cfg)
    process.exitCode = r.exit_code
  } else if (cmd === 'recipe' && sub === 'list') {
    for (const r of require('./recipes/runner').listRecipes()) console.log(`${r.id}\t${r.title}`)
  } else if (cmd === 'recipe' && sub === 'test') {
    process.exitCode = await require('./core/recipe_test').recipeTest(args, cfg)
  } else if (cmd === 'fix') {
    const r = await require('./fix/fix').fixRun(args, cfg)
    process.exitCode = r.summary && r.summary.verified ? 0 : 1
  } else if (cmd === 'pr') {
    const r = await require('./fix/pr').makePr(args, cfg)
    console.log(JSON.stringify({ branch: r.branch, base: r.base, commit: r.commit, checks: r.checks, pushed: r.pushed, url: r.url || null }, null, 1))
  } else if (cmd === 'apply') {
    const r = require('./fix/apply').applyFix(args, cfg)
    process.exitCode = r.applied || r.undone || r.applied === false ? 0 : 1
  } else if (cmd === 'design' && sub === 'list') {
    for (const d of require('./design/library').list()) console.log(`${d.name}\t${d.frame}\t${d.base || ''}\t${d.source || ''}\t${d.saved_at || ''}`)
  } else if (cmd === 'design' && sub === 'pull') {
    const r = await require('./design/figma_rest').pull({ url: args.url, name: args.name, group: args.group })
    console.log(`시안 목록에 넣음: ${r.name} (${r.base}, 노드 ${r.nodes}개, 스타일 토큰 ${r.tokens}개${r.png ? '' : ', 그림 없음'}) → dqa check … --design ${r.name}`)
  } else if (cmd === 'doctor') {
    process.exitCode = await require('./ops/doctor').doctor(args, cfg)
  } else if (cmd === 'up') {
    process.exitCode = await require('./ops/doctor').up(args, cfg)
  } else if (cmd === 'serve') {
    await require('./server/http').serve(args, cfg)
  } else {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
    process.exitCode = cmd ? 2 : 0
  }
}

// serve 말고는 일이 끝나면 바로 끝낸다(남은 연결이 프로세스를 붙잡지 않게)
main().then(() => { if (process.argv[2] !== 'serve') process.exit(process.exitCode || 0) })
  .catch((e) => { console.error(`dqa 실패: ${e.message}`); process.exit(2) })
