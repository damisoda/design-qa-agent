"""학습된 로봇 정책을 시뮬레이터에서 실행하고 화면(JPEG)을 내보내는 부분.
~/robot-kernel/viewer/app.py의 로직을 옮겨 왔다.

macOS는 그래픽(CGL) 컨텍스트를 메인 스레드에서만 허용한다. 보조 스레드에서 MuJoCo 오프스크린
렌더링을 하면 프로세스가 SIGTRAP(코드 133)으로 죽는다(실측). 그래서 시뮬레이터 생성·실행·렌더링·
종료는 모두 main_loop()(메인 스레드)에서만 하고, 웹 스레드는 작업 큐에 넣고 최신 프레임만 읽는다.

robomimic 첫 import는 약 36초 걸리므로 main_loop() 안에서 늦게 불러오고, 그동안 stats()는
"라이브러리 불러오는 중"을 돌려준다.
"""

import glob
import io
import os
import queue
import re
import sys
import threading
import time

import activity

DASH_DIR = os.path.dirname(os.path.abspath(__file__))
KERNEL = os.path.dirname(DASH_DIR)
RUNS_DIR = os.path.join(KERNEL, "runs")
SHIMS_DIR = os.path.join(KERNEL, "shims")   # macOS: egl_probe 대체 모듈 (오프스크린 렌더링용)

CAMERA = "agentview"
SIZE = 384
HORIZON = 400
MAX_TRIALS = 10
HOLD_FRAMES = 8          # 시도가 끝난 뒤 결과 화면을 잠깐 유지하는 프레임 수
FRAME_SLEEP = 0.02
SEED_MAX = 2 ** 31 - 1

# phase 값(화면 분기용 보조 필드): loading_lib, loading_model, idle, queued, running, done, error, fatal
_jobs = queue.Queue()                      # 웹 스레드 → 메인 스레드
_frame_cv = threading.Condition()          # 메인 스레드 → 웹 스레드: 최신 JPEG
_latest = {"jpeg": None, "seq": 0}
_job_ids = {"submitted": 0, "finished": 0}  # _frame_cv로 보호
_lock = threading.Lock()                   # _stats 보호
_stats = {"status": "라이브러리 불러오는 중", "phase": "loading_lib", "trial": 0, "trials": 0, "step": 0,
          "success": 0, "done": 0, "history": [], "ckpt": None, "seed": None, "loaded_ckpt": None}
_sim = {"path": None, "rel": None, "policy": None, "env": None}
_libs = {}

_EPOCH_RE = re.compile(r"model_epoch_(\d+)")
_SUCCESS_RE = re.compile(r"_success_([0-9]*\.?[0-9]+)\.pth$")


def _set(**kw):
    with _lock:
        _stats.update(kw)


def stats():
    with _lock:
        s = dict(_stats)
        s["history"] = [dict(h) for h in _stats["history"]]
    return s


def list_checkpoints():
    """요청마다 runs/*/*/models/*.pth 를 다시 스캔한다. 최신 실행·높은 에폭 순."""
    items = []
    for path in glob.glob(os.path.join(RUNS_DIR, "*", "*", "models", "*.pth")):
        rel = os.path.relpath(path, RUNS_DIR).replace(os.sep, "/")
        parts = rel.split("/")
        if len(parts) != 4:
            continue
        run_name, ts, _, fname = parts
        m_ep, m_sr = _EPOCH_RE.search(fname), _SUCCESS_RE.search(fname)
        epoch = int(m_ep.group(1)) if m_ep else None
        sr = float(m_sr.group(1)) if m_sr else None
        label = run_name
        if epoch is not None:
            label += f" · {epoch}에폭"
        label += f" · 학습 중 평가 성공률 {sr * 100:.0f}%" if sr is not None else " · 성공률 기록 없음"
        items.append({"id": rel, "run_name": run_name, "label": label, "success_rate": sr,
                      "epoch": epoch, "timestamp": ts})
    items.sort(key=lambda c: (c["timestamp"], c["epoch"] or -1, c["id"]), reverse=True)
    return items


def _as_int(value, name, lo, hi):
    if isinstance(value, bool):
        raise ValueError(f"{name}는 {lo}~{hi} 사이 정수여야 합니다.")
    if isinstance(value, str) and re.fullmatch(r"-?\d{1,12}", value.strip()):
        value = int(value.strip())
    if not isinstance(value, int) or not (lo <= value <= hi):
        raise ValueError(f"{name}는 {lo}~{hi} 사이 정수여야 합니다.")
    return value


def submit(ckpt_rel, trials, seed):
    """실행 요청을 메인 스레드 큐에 넣는다. 입력 오류는 ValueError, 실행 중·준비 중은 RuntimeError."""
    ckpts = {c["id"]: c for c in list_checkpoints()}
    if not isinstance(ckpt_rel, str) or ckpt_rel not in ckpts:
        raise ValueError("목록에 없는 체크포인트입니다. 체크포인트 목록에서 골라 주세요.")
    trials = _as_int(trials, "시도 횟수", 1, MAX_TRIALS)
    seed = _as_int(seed, "시드(무작위 배치 번호)", 0, SEED_MAX)
    path = os.path.join(RUNS_DIR, *ckpt_rel.split("/"))  # 서버가 스캔한 목록의 항목만 사용
    with _lock:
        phase = _stats["phase"]
        if phase == "loading_lib":
            raise RuntimeError("시뮬레이터 라이브러리를 불러오는 중입니다(처음 약 40초). 잠시 후 다시 실행하세요.")
        if phase == "fatal":
            raise RuntimeError(f"시뮬레이터를 쓸 수 없습니다: {_stats['status']}")
        with _frame_cv:
            if _job_ids["submitted"] != _job_ids["finished"]:
                raise RuntimeError("이미 실행 중입니다. 지금 실행이 끝난 뒤 다시 시도하세요.")
            _job_ids["submitted"] += 1
            job_id = _job_ids["submitted"]
        _stats.update(status="실행 준비 중", phase="queued", trial=0, trials=trials, step=0, success=0,
                      done=0, history=[], ckpt=ckpt_rel, seed=seed)
    _jobs.put((job_id, path, ckpt_rel, trials, seed))


def frames(timeout=1.0):
    """가장 최근 요청의 새 JPEG 프레임을 차례로 내보낸다. 그 실행이 끝나면 종료한다."""
    with _frame_cv:
        job_id = _job_ids["submitted"]
        seen = _latest["seq"]
    while True:
        with _frame_cv:
            _frame_cv.wait_for(lambda: _latest["seq"] != seen or _job_ids["finished"] >= job_id, timeout=timeout)
            data, seq = _latest["jpeg"], _latest["seq"]
            finished = _job_ids["finished"] >= job_id
        if seq != seen and data:
            seen = seq
            yield data
        elif finished:
            return


def _publish(frame):
    buf = io.BytesIO()
    _libs["Image"].fromarray(frame).save(buf, format="JPEG", quality=80)
    with _frame_cv:
        _latest["jpeg"], _latest["seq"] = buf.getvalue(), _latest["seq"] + 1
        _frame_cv.notify_all()


def _render():
    return _sim["env"].render(mode="rgb_array", height=SIZE, width=SIZE, camera_name=CAMERA)


def _load(path, rel):
    """체크포인트가 바뀌었을 때만 정책·환경을 다시 만든다(메인 스레드 전용)."""
    if _sim["path"] == path and _sim["env"] is not None:
        return
    _set(status="모델·환경 불러오는 중", phase="loading_model")
    old_env = _sim["env"]
    _sim.update(path=None, rel=None, policy=None, env=None)
    _set(loaded_ckpt=None)
    if old_env is not None:
        try:
            old_env.env.close()  # 이전 시뮬레이터·렌더 컨텍스트 해제 (메인 스레드)
        except Exception:
            pass
        del old_env
    FileUtils, TorchUtils = _libs["FileUtils"], _libs["TorchUtils"]
    device = TorchUtils.get_torch_device(try_to_use_cuda=False)
    policy, ckpt_dict = FileUtils.policy_from_checkpoint(ckpt_path=path, device=device, verbose=False)
    env, _ = FileUtils.env_from_checkpoint(ckpt_dict=ckpt_dict, render=False, render_offscreen=True, verbose=False)
    _sim.update(path=path, rel=rel, policy=policy, env=env)
    _set(loaded_ckpt=rel)


def _run_job(path, rel, trials, seed):
    np, torch = _libs["np"], _libs["torch"]
    _load(path, rel)
    policy, env = _sim["policy"], _sim["env"]
    np.random.seed(seed)
    torch.manual_seed(seed)
    _set(status="실행 중", phase="running", trial=0, trials=trials, step=0, success=0, done=0, history=[])
    activity.log_activity("viewer", f"로봇 뷰어 실행 시작: {rel.split('/')[0]} · 시도 {trials}회 · 시드 {seed}",
                          {"ckpt": rel, "trials": trials, "seed": seed})
    t0 = time.time()
    for t in range(1, trials + 1):
        _set(trial=t, step=0)
        policy.start_episode()
        obs = env.reset()
        obs = env.reset_to(env.get_state())
        ok = False
        steps = 0
        for step in range(HORIZON):
            obs, _, done, _ = env.step(policy(ob=obs))
            steps = step + 1
            _set(step=steps)
            _publish(_render())
            time.sleep(FRAME_SLEEP)
            ok = bool(env.is_success()["task"])
            if ok or done:
                break
        with _lock:
            _stats["done"] = t
            _stats["success"] += int(ok)
            _stats["history"].append({"trial": t, "success": ok, "steps": steps})
        for _ in range(HOLD_FRAMES):  # 결과 화면을 잠깐 유지
            _publish(_render())
            time.sleep(FRAME_SLEEP)
    s = stats()
    _set(status="완료", phase="done")
    activity.log_activity("viewer", f"로봇 뷰어 실행 완료: {rel.split('/')[0]} · 성공 {s['success']}/{trials}",
                          {"ckpt": rel, "trials": trials, "seed": seed, "success": s["success"],
                           "history": s["history"], "sec": round(time.time() - t0, 1)})


def main_loop():
    """메인 스레드 전용. 반환하지 않는다."""
    _set(status="라이브러리 불러오는 중", phase="loading_lib")
    t0 = time.time()
    try:
        if SHIMS_DIR not in sys.path:
            sys.path.insert(0, SHIMS_DIR)
        import numpy as np
        import torch
        from PIL import Image
        import robomimic.utils.file_utils as FileUtils
        import robomimic.utils.torch_utils as TorchUtils
        _libs.update(np=np, torch=torch, Image=Image, FileUtils=FileUtils, TorchUtils=TorchUtils)
    except Exception as e:
        msg = f"오류: 시뮬레이터 라이브러리를 불러오지 못했습니다({type(e).__name__}: {e})"
        _set(status=msg, phase="fatal")
        activity.log_activity("viewer", msg, {})
        while True:
            time.sleep(3600)
    _set(status="대기", phase="idle", lib_load_sec=round(time.time() - t0, 1))

    ckpts = list_checkpoints()
    if ckpts:  # 가장 최근 체크포인트를 미리 불러 둔다(첫 실행 대기 시간 단축)
        try:
            _load(os.path.join(RUNS_DIR, *ckpts[0]["id"].split("/")), ckpts[0]["id"])
            idle_status = ("대기", "idle")
        except Exception as e:
            idle_status = (f"오류: 모델을 불러오지 못했습니다({type(e).__name__}: {e})", "error")
        with _lock, _frame_cv:
            if _job_ids["submitted"] == _job_ids["finished"]:  # 미리 불러오는 사이 들어온 요청이 없을 때만
                _stats.update(status=idle_status[0], phase=idle_status[1])
            else:
                _stats.update(status="실행 준비 중", phase="queued")

    while True:
        job_id, path, rel, trials, seed = _jobs.get()
        try:
            _run_job(path, rel, trials, seed)
        except Exception as e:
            msg = f"오류: {type(e).__name__}: {e}"
            _set(status=msg, phase="error")
            _sim.update(path=None)  # 다음 요청 때 다시 불러오도록
            activity.log_activity("viewer", f"로봇 뷰어 실행 오류: {msg}", {"ckpt": rel})
        finally:
            with _frame_cv:
                _job_ids["finished"] = job_id
                _frame_cv.notify_all()
