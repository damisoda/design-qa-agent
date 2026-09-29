# robot-kernel — L1 실험 커널 (로봇 학습 데이터 에이전트 프로젝트)

학습·평가 수치를 만드는 유일한 곳. 에이전트(L2, Dify)는 여기서 나온 결과 파일만 인용한다.
프로젝트 문서: `~/Desktop/서강대학교/6학기/AI에이전트/` (한글 경로는 빌드 도구 문제를 피하려고 커널만 여기 둔다)

## 환경 (2026-09-29 설치, Apple M5 · 16GB · CUDA 없음)

| 항목 | 설치 값 | 공식 문서 권장 | 차이 이유 |
|---|---|---|---|
| Python | 3.10.20 (uv) | 3.8.0 | robosuite 1.5.1이 요구하는 mujoco>=3.3.0이 Python 3.9 이상만 지원 |
| torch / torchvision | 2.0.0 / 0.15.1 | 같음 | — |
| numpy | 1.26.4 | — | torch 2.0 호환을 위해 2.0 미만 고정 |
| robosuite | 1.5.1 (소스, 태그 v1.5.1) | v1.5.1 | 공개 데이터셋 v1.5와 맞춤 |
| mujoco | 3.3.0 | — | 3.14.0에서 환경 생성 실패(관절 종류 assert). 3.3.0으로 고정 후 정상 |
| robomimic | 0.5.0 (소스, 태그 v0.5.0, `--no-deps`) | 소스 설치 | PyPI는 0.3.0뿐 |
| egl_probe | 미설치 | 의존성 | macOS에서 빌드 불가(리눅스 EGL 전용). 오프스크린 렌더링을 켤 때만 import되므로 low_dim·영상 끔에서는 불필요 |

재현:
```
uv python install 3.10 && uv venv .venv --python 3.10
uv pip install --python .venv/bin/python "torch==2.0.0" "torchvision==0.15.1" "numpy<2"
git clone --depth 1 --branch v1.5.1 https://github.com/ARISE-Initiative/robosuite.git src/robosuite
git clone --depth 1 --branch v0.5.0 https://github.com/ARISE-Initiative/robomimic.git src/robomimic
uv pip install --python .venv/bin/python -e src/robosuite "mujoco==3.3.0"
uv pip install --python .venv/bin/python --no-deps -e src/robomimic
uv pip install --python .venv/bin/python h5py psutil tqdm termcolor tensorboard tensorboardX imageio imageio-ffmpeg matplotlib "huggingface_hub==0.23.4" "transformers==4.41.2" "diffusers==0.11.1"
```

주의: robomimic 첫 import는 transformers·diffusers 적재로 약 36초 걸린다(멈춘 것이 아님).

## 데이터

| 파일 | 크기 | sha256 (HF LFS 값과 일치 확인) |
|---|---|---|
| datasets/lift/ph/low_dim_v15.hdf5 | 21,084,088 B | 2067777cb8b532e9263dd09fd6448c41cc31224bb27be4a3b734010ae13eb540 |

Lift PH: 시연 200개, 길이 평균 48.3(36~64) 스텝, 행동 7차원, 필터 키 train/valid 및 20·50% 부분집합. 로봇 Panda.

## 실행 기록

| run | 설정 | 결과 |
|---|---|---|
| lift_ph_lowdim_bc_e50_s1 | `configs/lift_ph_lowdim_bc_e50_s1.json` — BC(MLP), 50 에폭×100 스텝, 배치 100, seed 1, 평가 50회·최대 400 스텝 | **성공률 0.88 (44/50)**, 평균 에피소드 길이 84.6 스텝. 전체 84초(학습 약 20초 + 평가 53초 + 적재), 최대 메모리 1.44GB. 체크포인트 `runs/lift_ph_lowdim_bc_e50_s1/20260929181133/models/model_epoch_50_low_dim_v15_success_0.88.pth` |

해석 주의 (lift_ph_lowdim_bc_e50_s1):
- 시드 1개·평가 50회라 성공률의 불확실성이 크다(대략 ±9%p). 비교 실험에는 다중 시드와 고정된 평가 초기 상태가 필요하다.
- 학습 스크립트 내장 평가(무작위 초기 상태)이며, 프로젝트의 개발/최종 평가셋 분리는 아직 적용하지 않았다.
- 기본 학습량(2,000 에폭)의 2.5%만 돌린 점검용 실행이다.

## 직접 실행해 보기

- 브라우저 뷰어: `.venv/bin/python viewer/app.py` → http://127.0.0.1:8770 . 모델·시도 횟수·시드를 고르고 실행하면 시뮬레이터 화면이 실시간으로 나오고, 성공 여부는 `env.is_success()`로 판정한다. macOS는 그래픽 컨텍스트를 메인 스레드에서만 허용하므로 시뮬레이션은 메인 스레드, 웹 서버는 보조 스레드에서 돈다(보조 스레드에서 렌더링하면 SIGTRAP으로 종료됨, 실측).
- 영상 파일: `PYTHONPATH=shims .venv/bin/python src/robomimic/robomimic/scripts/run_trained_agent.py --agent <ckpt> --n_rollouts 5 --horizon 400 --seed 0 --video_path videos/<이름>.mp4 --video_skip 1 --camera_names agentview`
- `shims/egl_probe`: macOS용 대체 모듈(빈 장치 목록 반환). 오프스크린 렌더링 때만 경로에 넣는다.

## 에이전트 대시보드 (2026-09-30)

- 실행: `.venv/bin/python dashboard/server.py` → http://127.0.0.1:8780 (로컬 전용, 다른 사이트의 요청은 403으로 차단). 설계 기준은 `dashboard/CONTRACT.md`.
- 기능: 질문창(Dify 에이전트 실시간 추적·도구 호출·전/후 답변 비교), 질문 기록(4주차 기록 포함), 실험 결과(성공률·손실 곡선), 실험 승인 대기열(제안 → 승인해야 실제 학습 시작, 한 번에 1개), 로봇 뷰어(대시보드 내장, 체크포인트 자동 재스캔), 데이터셋, 시스템 상태, 활동 기록, 다음 행동 결정(미구현 표시).
- Dify 연결은 컨테이너 안 상주 워커(`dashboard/dify_worker.py`, docker cp → docker exec)로 한다. API 키를 쓰지 않는다.
- 검증 학습 1회: `lift_ph_lowdim_bc_p20_e50_s1`(학습용 20% = 시연 36개) 성공률 0.92, 95.11초. 전체 데이터(180개) 0.88과 시드 1개 기준으로 차이가 없다 — Lift는 데이터가 적어도 쉽게 성공하는 작업이라 판단 실험용으로는 부족하다는 근거.
