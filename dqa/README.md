# dqa — 디자인-구현 결함 검수 도구(로컬)

화면을 여러 크기로 실제로 열어 재고, 변경 전과 비교해 새로 생긴 결함을 찾고, 원인 코드를 짚고, 고치는 패치까지 검증해 준다. 측정 결과와 팀 코드는 이 컴퓨터와 맥미니(로컬 모델) 밖으로 나가지 않는다.

## 빠른 시작

```bash
cd dqa
npm install                        # playwright-core 1개(크롬은 Playwright 캐시의 chromium을 찾아 쓴다)
node cli.js doctor                 # 준비 상태 점검(크롬, 맥미니 터널, 모델, 메모리, gh, 빌드)
node cli.js up                     # 맥미니 터널 열기(LLM 해석을 쓸 때만)
node cli.js serve                  # 웹 화면 http://127.0.0.1:8792
```

명령 한 줄로 검사:

```bash
# 빌드 비교: 결함 전(PR #221 병합 전)을 수정 후와 비교 → 새로 생긴 결함 3건, 종료 코드 1
node cli.js check --dist cbh-221-pre --base-dist cbh-221-post --recipe cbh/report
# 실행 중인 아무 웹앱(로컬 주소만)
node cli.js check --url http://127.0.0.1:3000/ --recipe local/home --src ~/my-app   # 첫 화면만. 다른 화면은 레시피를 만든다
# 저장소 브랜치·PR 검사(독립 클론 ~/design-qa-cases/cbh-gh, 커밋별 빌드 캐시)
node cli.js check --repo cbh --ref develop
node cli.js check --repo cbh --pr 221
# 코드 에이전트: 문제 정의서를 받아 수정 → 평가용 사본에 적용·빌드·재측정으로 검증
node cli.js fix --run <실행 ID>
# PR 준비(로컬 브랜치·커밋·타입 검사·PR 본문). 올리기는 확인 문구가 있어야 하고 항상 초안
node cli.js pr --run <실행 ID> [--onto develop]
node cli.js pr --run <실행 ID> --push --confirm "PR 올리기"
# 측정 규칙 단위 시험
node --test test/
```

## 하는 일

| 단계 | 하는 일 | 어디 |
|---|---|---|
| 진입 | 레시피(JSON)대로 눌러 화면에 들어간다. 보이고 맨 위인 요소만 누른다 | `recipes/` |
| 측정 | 크기마다 새 브라우저로 열고, 배치가 멈출 때까지 기다린 뒤 스크롤 단계마다 규칙 적용 | `measure/` |
| 규칙 | R1 넘침 · R2 잘림 · R3 겹침 · R4 가려짐 · R5 크기별 줄바꿈 · R6 원치 않는 줄바꿈 · R7 틀 이탈(`../knowledge/P03`) | `measure/inpage.js` |
| 진단 | 계산 스타일로 원인 패턴 확인: flex 항목 min-width auto, 눌린 라벨, 홈 인디케이터 모양 막대, 하단 고정 요소 가림 | `measure/inpage.js` |
| 묶기·재측정 | 같은 줄의 같은 규칙을 한 결함으로, 크기 사이를 이어 붙이고, 한 크기를 다시 열어 확인 | `measure/cluster.js` |
| 비교 | 변경 전과 대조해 새로 생김·악화·기존·해결 | `diff/compare.js` |
| 원인 | 라벨·aria 글자로 소스 검색(흔한 글자는 낮춤), 컴포넌트 정의, 함께 쓰는 스타일 모듈, 바뀐 줄 | `code/cause.js` |
| 보고서 에이전트 | 결함마다 문제 정의서: 무엇이 문제인가 · 원본(기대: 변경 전 상태, 판정 기준, 지식의 대응, 2단계부터 Figma 값) · 결함인가 의도인가. 맨 위 한눈 요약 1회. 사실에 없는 숫자를 쓰면 버린다 | `judge/` (Gemma 4 E4B, 생각 끔) |
| 코드 에이전트 | 문제 정의서를 받아 규칙 수정안 → 코드 읽기·검색·수정 루프(수정 3번까지). 수정마다 사본에 적용·빌드·재측정하고, 결함이 사라지고 다른 결함이 생기거나 커지지 않을 때만 채택 | `fix/agent.js`, `fix/fix.js` |
| PR | 검증된 패치로 수정 브랜치·커밋, 프로젝트 검사(tsc·테스트), 팀 PR 양식의 본문. 올리기(push + 초안 PR)는 확인 문구 "PR 올리기"가 있을 때만, 병합은 하지 않는다 | `fix/pr.js` |
| 보고서 출력 | report.md·report.html·defects.json·fix/fix_all.patch·fix/pr_body.md(템플릿) | `report/`, 웹 화면 |

## 지키는 것

- 원본 소스와 사용자 작업본(`~/Come-back-home`)에는 쓰지 않는다. 그 경로는 코드에서 거부한다. 수정 검증은 `~/design-qa-cases/fix/` 사본에서만 하고 끝나면 지운다.
- 검사 대상은 로컬 주소와 설정에 등록한 빌드만. 브라우저는 앱 출처 밖 요청을 모두 막고 기록한다(`blocked_requests.jsonl`).
- LLM은 맥미니 로컬 모델만 쓴다. 다른 모델이 올라가 있거나 여유 메모리가 20% 미만이면 부르지 않고, 끝나면 내린다. 이미지는 보내지 않는다.
- GitHub에는 확인 문구가 있을 때만 쓴다(push + 초안 PR). 브랜치·커밋은 독립 클론 안에서만 만들고, 병합은 하지 않는다.
- 웹 화면은 127.0.0.1에서만 열리고, 브라우저 요청은 `X-DQA` 머리글이 있어야 받는다.

## 새 화면·새 앱 추가

1. `recipes/<앱>/<화면>.json`을 만든다(예: `recipes/cbh/report.json`). 단계는 `click`·`fill`·`wait_text`·`if_visible`·`use`.
2. `node cli.js recipe test --dist <빌드> --recipe <id> --size 375x812`로 들어가지는지 확인한다. 실패하면 그때 보이는 글자와 캡처를 보여 준다.
3. 빌드 이름은 `config/default.json`의 `dists`, 저장소 빌드 설정은 `config/repos.json`.

## Dify 앱

- `dqa · 검사→문제 정의→수정→PR`: 작업(검사·상태·수정 시작·PR 준비·PR 올리기)을 사람이 고르면 `dqa_act` 도구가 한다. 작업 순서는 LLM이 정하지 않는다. 수정은 몇 분 걸려 시작만 하고 "상태"로 확인한다(Dify API 도구 제한 60초). PR 올리기는 확인 문구 입력란에 "PR 올리기"를 넣어야 한다.
- `dqa · 디자인 검수(로컬 도구 호출)`: 빌드·화면을 고르면 `dqa_check`가 검사 요약을 돌려준다.
- 만들기: `dify/dify.py register` → `dify.py dsl-act <provider_id>` → `../dify_import.py dify/dqa-act.dsl.yml`.

## 아직 없는 것

- main(10-09)처럼 lock이 바뀐 커밋은 npm ci(다운로드)가 필요하다. `--allow-install`을 줄 때만 받는다.
- 평가 세트·채점기·기준선(2단계), Figma 플러그인 비교(2단계), 상태(눌림·포커스)·키보드 검사(3단계).
