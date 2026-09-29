# 로봇 데이터 에이전트 대시보드 — 구현 계약서

이 문서가 파일 구성·API·이벤트 형식의 단일 기준이다. 구현이 이 문서와 다르면 문서를 고치지 말고 구현을 고친다.

## 0. 목적과 원칙

사용자(조대흠)가 브라우저 한 화면에서 (1) 에이전트에게 질문하고 에이전트가 어떤 도구를 어떤 인자로 부르는지 실시간으로 보고, (2) 실험 결과를 보고, (3) 새 학습 실험을 제안·승인(사람 승인, HITL)하고, (4) 학습된 로봇을 시뮬레이터에서 직접 돌려 보는 로컬 대시보드.

원칙:
1. **가짜 데이터 금지.** 화면의 모든 수치는 실제 파일·실제 실행에서 온다. 데이터가 없으면 "기록 없음"/"미구현"을 그대로 보여 준다. 샘플·목업 값을 넣지 않는다.
2. **로컬 전용.** 서버는 `127.0.0.1:8780`에만 바인딩한다.
3. **입력은 허용값만.** 실험 파라미터는 열거형만 받는다. 사용자 입력을 셸 명령·경로에 그대로 넣지 않는다(subprocess는 리스트 인자, shell=False). 체크포인트는 서버가 스캔한 목록에 있는 상대경로만 허용한다.
4. **macOS 그래픽 규칙.** MuJoCo 오프스크린 렌더링(시뮬레이터)은 **메인 스레드에서만** 생성·실행한다. 보조 스레드에서 렌더링하면 프로세스가 SIGTRAP(코드 133)으로 죽는다(실측). HTTP 서버는 데몬 스레드에서 돌린다.
5. **쉬운 한국어 UI.** 약어는 풀어 쓴다: PH=숙련자 1명 데이터, MH=여러 명 데이터, low_dim=숫자(위치) 데이터, BC=시연 따라 하기 학습, 에폭=학습 반복 횟수, 시드=무작위 배치 번호.
6. 에이전트의 "다음 행동 결정"(재선별·추가 수집 제안·추가 진단·재평가·중단) 모듈은 **아직 없다**. 화면에는 5개 행동을 "결정 모듈 미구현 — 8주차 목표"로 표시만 하고, 추천을 지어내지 않는다.

## 1. 실행 환경 (실측, 2026-09-30)

- 커널 루트: `~/robot-kernel` (= `/Users/damisoda/robot-kernel`). 파이썬: `~/robot-kernel/.venv/bin/python` (3.10, torch 2.0.0, robosuite 1.5.1, mujoco 3.3.0, robomimic 0.5.0, h5py, Pillow, numpy 1.26).
- robomimic 첫 import 약 36초.
- 오프스크린 렌더링 시 `sys.path`에 `~/robot-kernel/shims` 추가(egl_probe 대체 모듈).
- 학습 설정 템플릿: `~/robot-kernel/configs/lift_ph_lowdim_bc_e50_s1.json` (첫 실행 설정. `experiment.name`, `train.num_epochs`, `train.seed`, `train.hdf5_filter_key`, `experiment.rollout.rate`만 바꿔 새 설정을 만든다).
- 학습 명령: `/usr/bin/time -l ~/robot-kernel/.venv/bin/python ~/robot-kernel/src/robomimic/robomimic/scripts/train.py --config <config>`; stdout은 `runs/<run_name>.stdout.log`, stderr(시간·메모리)는 `runs/<run_name>.time.log`.
- 실행 결과 폴더: `runs/<run_name>/<YYYYMMDDHHMMSS>/{config.json, logs/log.txt, models/*.pth, last.pth}`. 로그에는 `Train Epoch N` 다음 줄부터 JSON(Loss 등), 평가 뒤 `Epoch N Rollouts took ... with results:` + `Env: ...` + JSON(`Success_Rate`, `Horizon`, `Return`)이 찍힌다. 체크포인트 파일명에 `success_0.88` 형태로 성공률이 들어간다. `time.log`에 `NN.NN real`, `maximum resident set size`, `peak memory footprint`(bytes).
- 데이터: `~/robot-kernel/datasets/lift/ph/low_dim_v15.hdf5` (필터 키: train, valid, 20_percent_train, 50_percent_train 등).
- 기존 실행 1건: `lift_ph_lowdim_bc_e50_s1` (성공률 0.88, 84.34초, 최대 메모리 약 1.44GB).
- Dify: 도커 컨테이너 `docker-api-1`(Dify 1.17.0). 에이전트 앱 ID `23fc6b34-db8c-4a5e-8bc9-7009d46007ea`(워크플로: 시작(query) → Agent 노드(도구 kb_search·get_dataset_info) ∥ 기준선 LLM(도구 없음) → 끝(with_tools, without_tools)). 컨테이너 안에서 `cd /app/api && python`으로 Flask 앱 컨텍스트를 열어 `WorkflowAppGenerator().generate(...)`를 호출할 수 있다(API 키 불필요). 참고 구현: `~/Desktop/서강대학교/6학기/AI에이전트/4주차_도구/dify/run_agent_in_container.py`. 스트리밍 이벤트에 `agent_log`가 있다(`core/app/entities/task_entities.py`).
- 모델 서버: 맥미니 Ollama, SSH 터널 `127.0.0.1:18434`(Dify에서는 host.docker.internal:18434). 터널 확인: `GET http://127.0.0.1:18434/api/tags` 200. 터널은 자주 끊긴다 — 대시보드는 끊김을 상태로 보여 주고, 연결을 스스로 만들지 않는다.
- 과거 에이전트 실행 기록(실제): `~/Desktop/서강대학교/6학기/AI에이전트/4주차_도구/runs/q1_square_files_v2.json`, `q2_lift_mg_toolhang.json`, `q3_cupid_can.json`, `q4_failure_demo.json` (`q1_square_files.json`은 도구 설정이 꺼진 실패 사례). 형식: `{query, sec, run_id, status, outputs:{with_tools, without_tools}, nodes:[{node,type,status,elapsed,outputs,execution_metadata:{agent_log:[...]}}]}`. agent_log의 `label`이 `ROUND n`인 항목의 `data.output.tool_responses[]`에 `tool_call_name`, `tool_call_input`, `tool_response`가 있다.

## 2. 파일 구성 (`~/robot-kernel/dashboard/`)

| 파일 | 담당 | 내용 |
|---|---|---|
| `server.py` | 백엔드 | 진입점. `python server.py` → 127.0.0.1:8780. 정적 파일(`static/`) 서빙, `/api/*` 라우팅, SSE·MJPEG 응답. HTTP는 데몬 스레드, 메인 스레드는 `viewer_core.main_loop()`. |
| `kernel_api.py` | 백엔드 | 실행 기록·데이터셋·상태 조회, 실험 제안·승인·학습 프로세스 관리. |
| `viewer_core.py` | 백엔드 | `~/robot-kernel/viewer/app.py`의 시뮬레이터 로직 이전(메인 스레드 작업 큐, MJPEG 프레임 발행, 체크포인트 재스캔). |
| `activity.py` | (작성 완료) | 공용 활동 기록. 수정 금지. |
| `dify_bridge.py` | Dify 연동 | 컨테이너 안 상주 워커 관리, 질문 실행, 이벤트 중계, 기록 저장. |
| `dify_worker.py` | Dify 연동 | 컨테이너 안에서 도는 워커(표준입력 JSON 줄 → 표준출력 JSON 줄). |
| `static/index.html`, `static/style.css`, `static/app.js` | 화면 | 대시보드 UI. 외부 라이브러리 없이(폰트만 CDN 허용) 작성. |
| `static/img/hero.jpg`, `hero_lift.jpg` | (작성 완료) | 시뮬레이터 실제 렌더(1600×900, 학습된 로봇이 큐브를 잡는 장면). |
| `data/` | 실행 중 생성 | `activity.jsonl`, `asks.jsonl`, `experiments.json`. |

## 3. 모듈 인터페이스

```python
# activity.py (작성 완료)
log_activity(kind: str, message: str, data: dict | None = None) -> dict
recent(limit: int = 100) -> list[dict]      # 최신순

# dify_bridge.py
class BusyError(Exception): ...
class DifyBridge:
    def start(self) -> None                  # 워커 기동(비동기 가능). 실패해도 예외로 서버를 죽이지 않고 status()에 반영
    def status(self) -> dict                 # {"ok": bool, "detail": str, "busy": bool}
    def ask(self, query: str) -> str         # ask_id 반환. 실행 중이면 BusyError
    def events(self, ask_id: str, timeout: float = 1.0)  # 제너레이터: 이미 쌓인 이벤트부터 재생 후 새 이벤트를 차례로 yield.
                                              # 'final' 또는 'error' 이벤트 뒤 종료. 새 이벤트가 없으면 timeout마다 {"type":"ping"} yield
    def history(self, limit: int = 50) -> list[dict]
bridge = DifyBridge()                         # 모듈 단일 인스턴스

# kernel_api.py
def status() -> dict                          # /api/status의 kernel·training·tunnel·dify_container 부분
def list_runs() -> list[dict]
def list_datasets() -> list[dict]
def list_experiments() -> list[dict]
def propose_experiment(params: dict, source: str = "user") -> dict   # ValueError(한국어 메시지) on invalid
def approve_experiment(exp_id: str) -> dict
def reject_experiment(exp_id: str) -> dict
def cancel_experiment(exp_id: str) -> dict

# viewer_core.py
def list_checkpoints() -> list[dict]          # 요청마다 재스캔
def submit(ckpt_rel: str, trials: int, seed: int) -> None   # ValueError / RuntimeError("이미 실행 중")
def stats() -> dict
def frames(timeout: float = 1.0)              # 제너레이터: 새 JPEG bytes. 실행이 끝나면 종료
def main_loop() -> None                       # 메인 스레드 전용, 반환하지 않음
```

## 4. HTTP API (모두 JSON, 한국어 오류 메시지 `{"error": "..."}`)

| 메서드·경로 | 응답 |
|---|---|
| `GET /` | `static/index.html` |
| `GET /static/<path>` | 정적 파일(경로 이탈 차단) |
| `GET /api/status` | `{"dify": {"ok","detail","busy"}, "tunnel": {"ok","detail"}, "dify_container": {"ok","detail"}, "model": "gemma4:e4b-16k", "kernel": {"python","torch","robosuite","mujoco","robomimic"}, "training": {"busy": bool, "experiment_id", "run_name"}, "viewer": {"status"}}` |
| `GET /api/runs` | `{"runs": [Run]}` 최신순 |
| `GET /api/datasets` | `{"datasets": [Dataset]}` |
| `GET /api/experiments` | `{"experiments": [Experiment]}` 최신순 |
| `POST /api/experiments` body `{"subset":"full"|"p50"|"p20","epochs":50|100|200,"seed":1..5}` | 201 `Experiment`(status `pending`) / 400 |
| `POST /api/experiments/<id>/approve` | `Experiment`(status `running` 또는 `queued`) |
| `POST /api/experiments/<id>/reject` | `Experiment`(status `rejected`) |
| `POST /api/experiments/<id>/cancel` | `Experiment`(status `cancelled`) |
| `GET /api/viewer/checkpoints` | `{"checkpoints": [{"id": "<runs 기준 상대경로>", "run_name", "label", "success_rate"}]}` |
| `GET /api/viewer/stats` | `{"status","trial","trials","step","success","done","history":[{"trial","success","steps"}],"ckpt"}` |
| `GET /viewer/stream?ckpt=<id>&trials=1..10&seed=<int>` | `multipart/x-mixed-replace; boundary=frame` JPEG 스트림. 이미 실행 중이면 409 |
| `POST /api/ask` body `{"query": 1~1000자}` | 202 `{"id"}` / 409 실행 중 / 503 워커·터널 불가 |
| `GET /api/ask/<id>/events` | `text/event-stream`. 각 이벤트 `data: <JSON>\n\n` |
| `GET /api/asks` | `{"asks": [Ask]}` 최신순(과거 4주차 기록 포함, `source` 구분) |
| `GET /api/activity` | `{"activity": [Activity]}` 최신순 100개 |

### 자료형

```
Run = {"run_name","timestamp","task":"Lift","dataset":"lift/ph","obs":"low_dim","filter_key","subset":"full"|"p50"|"p20","algo":"bc",
       "epochs","seed","success_rate": float|null,"rollouts": int|null,"avg_horizon": float|null,
       "wall_sec": float|null,"peak_mem_mb": float|null,"loss_curve":[{"epoch","loss"}],
       "checkpoints":["<runs 기준 상대경로>"],"status":"done"|"running"|"failed"}
Dataset = {"path":"datasets/lift/ph/low_dim_v15.hdf5","task","source":"ph","obs":"low_dim","size_bytes","sha256",
           "num_demos","avg_len","min_len","max_len","filter_keys":{"train": n, "20_percent_train": n, ...}}
Experiment = {"id","status":"pending"|"queued"|"running"|"done"|"failed"|"rejected"|"cancelled","params":{"subset","epochs","seed"},
              "run_name","filter_key","num_demos": int,"estimate_sec","created_at","approved_at","finished_at","source":"user"|"verification",
              "progress":{"phase":"load"|"train"|"rollout"|"done","epoch","epochs"},"result":{"success_rate","wall_sec"}|null,"error"}
Ask = {"id","query","status":"running"|"done"|"error","source":"dashboard"|"4주차 기록","started_at","elapsed_sec",
       "run_id","tool_calls":[ToolCall],"with_tools","without_tools","error"}
ToolCall = {"round","tool","input":{...},"ok": bool|null,"error_type": str|null,"summary": str}
Activity = {"ts","kind","message","data"}
```

실험 이름 규칙: `lift_ph_lowdim_bc_{subset}_e{epochs}_s{seed}` (subset: full·p50·p20). 이미 같은 이름의 실행 폴더나 진행 중 실험이 있으면 400. 필터 키: full→`train`, p50→`50_percent_train`, p20→`20_percent_train`. 평가 설정은 첫 실행과 같게(50회, 최대 400스텝, 학습 끝에 1번: `rollout.rate = epochs`). 동시 학습은 1개. 대기 중인 승인 건은 앞 학습이 끝나면 자동 시작. 예상 시간 = 에폭×0.45초 + 평가 60초 + 적재 40초(첫 실행 실측 기반, 화면에 "추정"으로 표기).

### SSE 이벤트 (`/api/ask/<id>/events`)

```
{"type":"status","message":"..."}                       # 워커 준비, 실행 시작 등
{"type":"node_started","node_id","title","node_type"}
{"type":"node_finished","node_id","title","node_type","status","elapsed"}
{"type":"tool_call","round","tool","input":{...},"ok","error_type","summary"}   # 도구 1회 호출 결과(요약 300자 이내)
{"type":"text","node_id","chunk"}                        # 가능하면 답변 조각
{"type":"final","with_tools","without_tools","elapsed_sec","run_id"}
{"type":"error","message"}
{"type":"ping"}
```

## 5. 화면 구성 (디자인 레퍼런스: 어두운 유리 카드 + 주황 포인트의 피트니스 대시보드)

- 전체: 어두운 배경, 반투명 유리 카드(둥근 모서리 20px 안팎, 얇은 밝은 테두리), 주황 포인트 색 하나, 큰 숫자 + 작은 설명 조합.
- 왼쪽 세로 아이콘 막대(홈·에이전트·실험·로봇·데이터로 이동), 위쪽: 로고(주황 원) + "로봇 데이터 에이전트 / 대시보드", 오른쪽: 상태 알약(Dify·모델 터널·학습 중 여부) + 사용자 표시 "조대흠".
- 히어로: `img/hero.jpg`를 어둡게 덮은 배경 위 가운데 "무엇을 도와드릴까요?" + 큰 입력창 "무엇이든 물어보세요" + 추천 질문 칩(과거 실제 질문에서).
- 카드: 에이전트 실행 추적(노드 진행·도구 호출 타임라인) / 답변 비교(도구 사용 vs 도구 없음) / 실험 결과(성공률 막대·학습 손실 곡선) / 승인 대기열(실험 제안 폼 + 승인·거절 + 진행률) / 로봇 뷰어(실시간 화면 + 반원 게이지로 이번 시도 성공률) / 데이터셋 / 시스템 상태 / 활동 기록 / 다음 행동 결정(5개 행동, "미구현" 배지).
- 폭이 좁으면(<900px) 카드가 한 줄씩 쌓인다. 가로 스크롤 없음.
