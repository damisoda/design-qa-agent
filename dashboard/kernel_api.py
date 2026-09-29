"""대시보드 백엔드: 실험 커널(~/robot-kernel)의 실제 파일에서 실행 기록·데이터셋·상태를 읽고,
사람이 승인한 학습 실험만 실행한다.

- 모든 수치는 실제 파일(config.json, logs/log.txt, *.time.log, 체크포인트 파일명, hdf5)에서 읽는다.
  값을 찾지 못하면 None을 돌려주고, 화면이 "기록 없음"으로 표시한다.
- 실험 파라미터는 열거형만 받는다. 학습 명령은 리스트 인자(shell=False)로만 실행한다.
- 동시에 학습 1개. 승인 순서대로 대기열에서 자동 시작한다.
- 상태 전이는 모두 activity.log_activity로 기록한다.
"""

import copy
import glob
import hashlib
import importlib.metadata
import json
import os
import re
import shutil
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime

import activity

# ---------------------------------------------------------------- 경로·상수
DASH_DIR = os.path.dirname(os.path.abspath(__file__))
KERNEL = os.path.dirname(DASH_DIR)
RUNS_DIR = os.path.join(KERNEL, "runs")
ARCHIVE_DIR = os.path.join(RUNS_DIR, ".archived")   # 취소·실패한 시도 보관(목록에서 제외)
CONFIGS_DIR = os.path.join(KERNEL, "configs")
DATASETS_DIR = os.path.join(KERNEL, "datasets")
DATA_DIR = os.path.join(DASH_DIR, "data")
EXP_PATH = os.path.join(DATA_DIR, "experiments.json")
HASH_CACHE_PATH = os.path.join(DATA_DIR, "dataset_hashes.json")
VENV_DIR = os.path.join(KERNEL, ".venv")
VENV_PY = os.path.join(VENV_DIR, "bin", "python")
TRAIN_SCRIPT = os.path.join(KERNEL, "src", "robomimic", "robomimic", "scripts", "train.py")
TEMPLATE_CONFIG = os.path.join(CONFIGS_DIR, "lift_ph_lowdim_bc_e50_s1.json")
TIME_BIN = "/usr/bin/time"

SUBSET_TO_FILTER = {"full": "train", "p50": "50_percent_train", "p20": "20_percent_train"}
FILTER_TO_SUBSET = {v: k for k, v in SUBSET_TO_FILTER.items()}
EPOCH_CHOICES = (50, 100, 200)
SEED_CHOICES = (1, 2, 3, 4, 5)
SOURCES = ("user", "verification")
ACTIVE_STATES = ("pending", "queued", "running")

# 예상 시간 = 에폭×0.45초 + 평가 60초 + 적재 40초 (첫 실행 실측 기반 추정)
EST_SEC_PER_EPOCH = 0.45
EST_ROLLOUT_SEC = 60.0
EST_LOAD_SEC = 40.0

TUNNEL_URL = "http://127.0.0.1:18434/api/tags"
MODEL_NAME = "gemma4:e4b-16k"
CONTAINER = "docker-api-1"
STATUS_TTL = 5.0            # 터널·컨테이너 점검 결과 재사용 시간(초)
KILL_GRACE_SEC = 10.0       # 취소 시 SIGTERM 후 SIGKILL까지 기다리는 시간


class NotFoundError(KeyError):
    """없는 실험 ID (HTTP 404)."""


class ConflictError(ValueError):
    """현재 상태에서 할 수 없는 요청 (HTTP 409)."""


def _now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _read_text(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def _read_json(path):
    text = _read_text(path)
    if text is None:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def _atomic_write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ---------------------------------------------------------------- 학습 로그 해석
_TRAIN_RE = re.compile(r"(?:^|\s)Train Epoch (\d+)\s*$")
_ROLLOUT_START_RE = re.compile(r"^rollout: env=(\S+), horizon=(\d+), .*num_episodes=(\d+)")
_ROLLOUT_DONE_RE = re.compile(r"^Epoch (\d+) Rollouts took ([0-9.eE+-]+)s \(avg\) with results:")
_ENV_CREATED_RE = re.compile(r"^Created environment with name (\S+)")
_SUCCESS_IN_NAME_RE = re.compile(r"_success_([0-9]*\.?[0-9]+)\.pth$")
_EPOCH_IN_NAME_RE = re.compile(r"model_epoch_(\d+)")


def _read_json_block(lines, i):
    """lines[i]부터 빈 줄을 건너뛰고 '{' … '}' 한 덩어리를 읽는다. (dict|None, 다음 인덱스)."""
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines) or lines[i].strip() != "{":
        return None, i
    for j in range(i, len(lines)):
        if lines[j].rstrip() == "}":
            try:
                return json.loads("\n".join(lines[i:j + 1])), j + 1
            except ValueError:
                return None, j + 1
    return None, len(lines)  # 아직 쓰는 중인 덩어리


def parse_train_log(text):
    """robomimic train.py 출력(log.txt 또는 stdout 로그)을 해석한다."""
    out = {"env_name": None, "loss_curve": [], "rollouts": [], "last_epoch": 0,
           "in_rollout": False, "rollout_n": None, "finished": False, "failed_msg": None}
    if not text:
        return out
    lines = text.splitlines()
    i = 0
    pending_n = None
    while i < len(lines):
        line = lines[i]
        m = _TRAIN_RE.search(line)
        if m:
            ep = int(m.group(1))
            out["last_epoch"] = ep
            out["in_rollout"] = False
            obj, i = _read_json_block(lines, i + 1)
            if isinstance(obj, dict) and isinstance(obj.get("Loss"), (int, float)):
                out["loss_curve"].append({"epoch": ep, "loss": obj["Loss"]})
            continue
        m = _ROLLOUT_START_RE.match(line)
        if m:
            out["in_rollout"] = True
            pending_n = int(m.group(3))
            out["rollout_n"] = pending_n
            i += 1
            continue
        m = _ROLLOUT_DONE_RE.match(line)
        if m:
            out["in_rollout"] = False
            ep = int(m.group(1))
            j = i + 1
            env = None
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines) and lines[j].startswith("Env:"):
                env = lines[j][4:].strip()
                j += 1
            obj, i = _read_json_block(lines, j)
            if isinstance(obj, dict):
                out["rollouts"].append({"epoch": ep, "env": env, "n": pending_n,
                                        "success_rate": obj.get("Success_Rate"),
                                        "horizon": obj.get("Horizon"), "return": obj.get("Return")})
            continue
        m = _ENV_CREATED_RE.match(line)
        if m and out["env_name"] is None:
            out["env_name"] = m.group(1)
        elif line.startswith("finished run successfully!"):
            out["finished"] = True
        elif line.startswith("run failed with error:"):
            detail = [ln.strip() for ln in lines[i + 1:i + 4] if ln.strip()]
            out["failed_msg"] = (detail[0] if detail else "원인 기록 없음")[:300]
        i += 1
    return out


def parse_time_log(text):
    """/usr/bin/time -l 출력에서 전체 시간(초)과 최대 메모리(MB, 10^6 바이트 기준)를 읽는다."""
    res = {"wall_sec": None, "peak_mem_mb": None, "max_rss_mb": None}
    if not text:
        return res
    m = re.search(r"([0-9.]+) real", text)
    if m:
        res["wall_sec"] = float(m.group(1))
    m = re.search(r"(\d+)\s+peak memory footprint", text)
    if m:
        res["peak_mem_mb"] = round(int(m.group(1)) / 1e6, 1)
    m = re.search(r"(\d+)\s+maximum resident set size", text)
    if m:
        res["max_rss_mb"] = round(int(m.group(1)) / 1e6, 1)
    if res["peak_mem_mb"] is None:
        res["peak_mem_mb"] = res["max_rss_mb"]
    return res


# ---------------------------------------------------------------- 실행 기록(Run)
_run_cache = {}          # ts_dir -> (signature, run dict)
_run_cache_lock = threading.Lock()


def _file_sig(path):
    try:
        st = os.stat(path)
        return (st.st_size, st.st_mtime_ns)
    except OSError:
        return None


def _ts_to_iso(ts):
    try:
        return datetime.strptime(ts, "%Y%m%d%H%M%S").astimezone().isoformat(timespec="seconds")
    except ValueError:
        return ts


def _dataset_label(data_path):
    if not data_path:
        return None
    try:
        rel = os.path.relpath(os.path.dirname(data_path), DATASETS_DIR)
    except ValueError:
        return None
    return None if rel.startswith("..") else rel.replace(os.sep, "/")


def _obs_kind(cfg):
    mods = (((cfg.get("observation") or {}).get("modalities") or {}).get("obs") or {})
    if mods.get("rgb") or mods.get("depth"):
        return "image"
    if mods.get("low_dim"):
        return "low_dim"
    return None


def _parse_run(run_name, ts, with_time_log):
    ts_dir = os.path.join(RUNS_DIR, run_name, ts)
    cfg_path = os.path.join(ts_dir, "config.json")
    log_path = os.path.join(ts_dir, "logs", "log.txt")
    time_path = os.path.join(RUNS_DIR, f"{run_name}.time.log")
    models = sorted(glob.glob(os.path.join(ts_dir, "models", "*.pth")))
    sig = (_file_sig(cfg_path), _file_sig(log_path),
           _file_sig(time_path) if with_time_log else None, tuple(models))
    with _run_cache_lock:
        hit = _run_cache.get(ts_dir)
        if hit and hit[0] == sig:
            return copy.deepcopy(hit[1])

    cfg = _read_json(cfg_path) or {}
    train = cfg.get("train") or {}
    exp = cfg.get("experiment") or {}
    data = train.get("data")
    data_path = data[0].get("path") if isinstance(data, list) and data and isinstance(data[0], dict) else data
    filter_key = train.get("hdf5_filter_key")
    log = parse_train_log(_read_text(log_path))
    times = parse_time_log(_read_text(time_path)) if with_time_log else parse_time_log(None)

    success_rate = avg_horizon = rollouts = None
    if log["rollouts"]:
        last = log["rollouts"][-1]
        success_rate, avg_horizon = last["success_rate"], last["horizon"]
        rollouts = last["n"] if last["n"] is not None else (exp.get("rollout") or {}).get("n")
    else:  # 로그에 평가 결과가 없으면 체크포인트 이름의 success_X 값을 쓴다
        best = None
        for p in models:
            m_sr, m_ep = _SUCCESS_IN_NAME_RE.search(p), _EPOCH_IN_NAME_RE.search(os.path.basename(p))
            if m_sr:
                ep = int(m_ep.group(1)) if m_ep else -1
                if best is None or ep > best[0]:
                    best = (ep, float(m_sr.group(1)))
        if best:
            success_rate = best[1]

    if log["finished"]:
        status = "done"
    elif log["failed_msg"]:
        status = "failed"
    else:
        status = "unfinished"  # 아래 list_runs에서 running/failed로 결정

    dataset = _dataset_label(data_path)
    run = {
        "run_name": run_name,
        "timestamp": _ts_to_iso(ts),
        "task": log["env_name"],
        "dataset": dataset,
        "obs": _obs_kind(cfg),
        "filter_key": filter_key,
        "subset": FILTER_TO_SUBSET.get(filter_key),
        "algo": cfg.get("algo_name"),
        "epochs": train.get("num_epochs"),
        "seed": train.get("seed"),
        "success_rate": success_rate,
        "rollouts": rollouts,
        "avg_horizon": avg_horizon,
        "wall_sec": times["wall_sec"],
        "peak_mem_mb": times["peak_mem_mb"],
        "loss_curve": log["loss_curve"],
        "checkpoints": [os.path.relpath(p, RUNS_DIR).replace(os.sep, "/") for p in models],
        "status": status,
        "dir": os.path.relpath(ts_dir, RUNS_DIR).replace(os.sep, "/"),
        "error": log["failed_msg"],
    }
    with _run_cache_lock:
        _run_cache[ts_dir] = (sig, copy.deepcopy(run))
    return run


def _started_exps_by_run():
    """run_name -> 그 이름으로 실제 학습을 시작한 대시보드 실험 중 가장 최근 것 {id, status, error}."""
    with _lock:
        _load()
        out = {}
        for e in sorted(_exps, key=lambda e: e.get("created_at") or ""):
            if e.get("run_name") and (e.get("started_at") or e.get("status") == "running"):
                out[e["run_name"]] = {"id": e.get("id"), "status": e.get("status"), "error": e.get("error")}
        return out


def list_runs():
    """runs/<run_name>/<YYYYMMDDHHMMSS>/ 마다 Run 하나. 최신순.
    완료 기록이 없는 실행은 대시보드 실험 기록(취소·실패)을 먼저 보고, 기록이 없을 때만 로그 갱신 시각으로 추정한다."""
    running_names = _running_run_names()
    exp_by_run = _started_exps_by_run()
    runs = []
    if not os.path.isdir(RUNS_DIR):
        return runs
    for run_name in sorted(os.listdir(RUNS_DIR)):
        rdir = os.path.join(RUNS_DIR, run_name)
        if not os.path.isdir(rdir) or run_name.startswith("."):
            continue
        stamps = sorted(d for d in os.listdir(rdir)
                        if re.fullmatch(r"\d{14}", d) and os.path.isdir(os.path.join(rdir, d)))
        for ts in stamps:
            run = _parse_run(run_name, ts, with_time_log=(ts == stamps[-1]))  # time.log는 가장 최근 실행 것
            run["cancelled"] = False
            if run["status"] == "unfinished":
                exp = exp_by_run.get(run_name) if ts == stamps[-1] else None
                if run_name in running_names and ts == stamps[-1]:
                    run["status"] = "running"
                elif exp is not None and exp["status"] == "cancelled":
                    # Run.status 값은 계약서의 done·running·failed만 쓴다. 사용자가 중단한 것은 cancelled 표시로 구분한다
                    run["status"] = "failed"
                    run["cancelled"] = True
                    run["error"] = f"사용자가 중단했습니다(실험 {exp['id']})."
                elif exp is not None and exp["status"] == "failed":
                    run["status"] = "failed"
                    run["error"] = run["error"] or exp["error"] or "학습이 실패했습니다(대시보드 실험 기록)."
                else:
                    log_path = os.path.join(rdir, ts, "logs", "log.txt")
                    sig = _file_sig(log_path)
                    # 대시보드 밖에서 돌고 있는 학습: 로그가 2분 안에 갱신됐으면 진행 중으로 본다
                    recent = sig is not None and (time.time() - sig[1] / 1e9) < 120
                    run["status"] = "running" if recent else "failed"
                    if not recent and not run["error"]:
                        run["error"] = "완료 기록 없이 끝났습니다(중단 또는 비정상 종료)."
            runs.append(run)
    runs.sort(key=lambda r: r["dir"].split("/")[1], reverse=True)
    return runs


def find_run(run_name):
    for r in list_runs():
        if r["run_name"] == run_name:
            return r
    return None


# ---------------------------------------------------------------- 데이터셋
_ds_cache = {}
_ds_lock = threading.Lock()


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _cached_sha256(path, rel):
    st = os.stat(path)
    key = {"size": st.st_size, "mtime_ns": st.st_mtime_ns}
    cache = _read_json(HASH_CACHE_PATH) or {}
    ent = cache.get(rel)
    if isinstance(ent, dict) and ent.get("size") == key["size"] and ent.get("mtime_ns") == key["mtime_ns"] and ent.get("sha256"):
        return ent["sha256"]
    digest = _sha256(path)
    cache[rel] = dict(key, sha256=digest, computed_at=_now())
    _atomic_write_json(HASH_CACHE_PATH, cache)
    return digest


def _dataset_info(path):
    import h5py  # 필요할 때만 불러온다

    rel = os.path.relpath(path, KERNEL).replace(os.sep, "/")
    st = os.stat(path)
    sig = (st.st_size, st.st_mtime_ns)
    with _ds_lock:
        hit = _ds_cache.get(path)
        if hit and hit[0] == sig:
            return copy.deepcopy(hit[1])
        sha = _cached_sha256(path, rel)
        task = None
        lens = []
        filter_keys = {}
        with h5py.File(path, "r") as f:
            data = f.get("data")
            if data is not None:
                env_args = data.attrs.get("env_args")
                if env_args is not None:
                    try:
                        task = json.loads(env_args).get("env_name")
                    except (ValueError, TypeError, AttributeError):
                        task = None
                for k in data.keys():
                    n = data[k].attrs.get("num_samples")
                    if n is not None:
                        lens.append(int(n))
            mask = f.get("mask")
            if mask is not None:
                for k in mask.keys():
                    filter_keys[k] = int(mask[k].shape[0])
        stem = os.path.splitext(os.path.basename(path))[0]
        obs = "low_dim" if stem.startswith("low_dim") else ("image" if stem.startswith("image") else stem)
        info = {
            "path": rel,
            "task": task,
            "source": os.path.basename(os.path.dirname(path)),
            "obs": obs,
            "size_bytes": st.st_size,
            "sha256": sha,
            "num_demos": len(lens) if lens else None,
            "avg_len": round(sum(lens) / len(lens), 2) if lens else None,
            "min_len": min(lens) if lens else None,
            "max_len": max(lens) if lens else None,
            "filter_keys": filter_keys,
        }
        _ds_cache[path] = (sig, copy.deepcopy(info))
        return info


def list_datasets():
    out = []
    for path in sorted(glob.glob(os.path.join(DATASETS_DIR, "**", "*.hdf5"), recursive=True)):
        try:
            out.append(_dataset_info(path))
        except Exception as e:  # 읽을 수 없는 파일도 목록에는 남긴다
            out.append({"path": os.path.relpath(path, KERNEL).replace(os.sep, "/"),
                        "error": f"파일을 읽지 못했습니다: {type(e).__name__}: {e}"})
    return out


# ---------------------------------------------------------------- 실험(제안·승인·학습)
_lock = threading.RLock()
_exps = []                   # 내부 기록('_'로 시작하는 키는 외부에 내보내지 않음)
_proc = {"exp_id": None, "popen": None, "pid": None}
_state = {"loaded": False, "started": False}


def _load():
    if _state["loaded"]:
        return
    data = _read_json(EXP_PATH)
    if isinstance(data, list):
        _exps[:] = [e for e in data if isinstance(e, dict) and e.get("id")]
    _state["loaded"] = True


def _save():
    _atomic_write_json(EXP_PATH, _exps)


def _public(exp):
    return copy.deepcopy({k: v for k, v in exp.items() if not k.startswith("_")})


def _get(exp_id):
    for e in _exps:
        if e.get("id") == exp_id:
            return e
    raise NotFoundError(f"실험을 찾을 수 없습니다: {exp_id}")


def _running_run_names():
    with _lock:
        _load()
        return {e["run_name"] for e in _exps if e.get("status") == "running"}


def _template():
    cfg = _read_json(TEMPLATE_CONFIG)
    if not isinstance(cfg, dict):
        raise ValueError("학습 설정 템플릿(configs/lift_ph_lowdim_bc_e50_s1.json)을 읽을 수 없습니다.")
    return cfg


def _template_dataset_path(cfg):
    data = (cfg.get("train") or {}).get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        return data[0].get("path")
    return data if isinstance(data, str) else None


def _as_choice(value, choices, name):
    if isinstance(value, bool):
        raise ValueError(f"{name} 값이 올바르지 않습니다. 허용값: {', '.join(map(str, choices))}")
    if isinstance(value, str) and value.strip().isdigit():
        value = int(value.strip())
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if not isinstance(value, int) or value not in choices:
        raise ValueError(f"{name} 값이 올바르지 않습니다. 허용값: {', '.join(map(str, choices))}")
    return value


def _validate_params(params):
    if not isinstance(params, dict):
        raise ValueError("요청 본문은 {\"subset\", \"epochs\", \"seed\"} 형식이어야 합니다.")
    subset = params.get("subset")
    if not isinstance(subset, str) or subset not in SUBSET_TO_FILTER:
        raise ValueError("데이터 범위(subset) 값이 올바르지 않습니다. 허용값: full(전체), p50(50%), p20(20%)")
    epochs = _as_choice(params.get("epochs"), EPOCH_CHOICES, "학습 반복 횟수(에폭)")
    seed = _as_choice(params.get("seed"), SEED_CHOICES, "무작위 배치 번호(시드)")
    return subset, epochs, seed


def _estimate_sec(epochs):
    return round(epochs * EST_SEC_PER_EPOCH + EST_ROLLOUT_SEC + EST_LOAD_SEC, 1)


def list_experiments():
    with _lock:
        _load()
        return [_public(e) for e in sorted(_exps, key=lambda e: e.get("created_at") or "", reverse=True)]


def propose_experiment(params, source="user"):
    if source not in SOURCES:
        raise ValueError("source 값은 user 또는 verification만 허용합니다.")
    subset, epochs, seed = _validate_params(params)
    filter_key = SUBSET_TO_FILTER[subset]
    run_name = f"lift_ph_lowdim_bc_{subset}_e{epochs}_s{seed}"

    cfg = _template()
    data_path = _template_dataset_path(cfg)
    if not data_path or not os.path.isfile(data_path):
        raise ValueError("템플릿에 지정된 데이터셋 파일을 찾을 수 없습니다.")
    info = _dataset_info(data_path)
    if filter_key not in info["filter_keys"]:
        raise ValueError(f"데이터셋에 필터 키 {filter_key}가 없습니다.")
    num_demos = info["filter_keys"][filter_key]

    with _lock:
        _load()
        if os.path.exists(os.path.join(RUNS_DIR, run_name)):
            raise ValueError(f"같은 이름의 실행 기록이 이미 있습니다: {run_name}")
        for e in _exps:
            if e.get("run_name") == run_name and e.get("status") in ACTIVE_STATES:
                raise ValueError(f"같은 설정의 실험이 이미 진행 중이거나 승인 대기 중입니다: {run_name}")
        exp = {
            "id": f"exp-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}",
            "status": "pending",
            "params": {"subset": subset, "epochs": epochs, "seed": seed},
            "run_name": run_name,
            "filter_key": filter_key,
            "num_demos": num_demos,
            "estimate_sec": _estimate_sec(epochs),
            "created_at": _now(),
            "approved_at": None,
            "started_at": None,
            "finished_at": None,
            "source": source,
            "progress": {"phase": None, "epoch": 0, "epochs": epochs},
            "result": None,
            "error": None,
        }
        _exps.append(exp)
        _save()
        out = _public(exp)
    activity.log_activity("experiment", f"실험 제안: {run_name} (시연 {num_demos}개, {epochs}에폭, 시드 {seed})",
                          {"experiment_id": exp["id"], "run_name": run_name, "source": source,
                           "params": out["params"], "estimate_sec": out["estimate_sec"]})
    return out


def approve_experiment(exp_id):
    with _lock:
        _load()
        exp = _get(exp_id)
        if exp["status"] != "pending":
            raise ConflictError(f"승인 대기 상태가 아닙니다(현재: {exp['status']}).")
        if os.path.exists(os.path.join(RUNS_DIR, exp["run_name"])):
            raise ConflictError(f"같은 이름의 실행 기록이 이미 있어 승인할 수 없습니다: {exp['run_name']}")
        exp["status"] = "queued"
        exp["approved_at"] = _now()
        _save()
        activity.log_activity("experiment", f"실험 승인: {exp['run_name']}",
                              {"experiment_id": exp_id, "run_name": exp["run_name"]})
        _maybe_start_next()
        return _public(exp)


def reject_experiment(exp_id):
    with _lock:
        _load()
        exp = _get(exp_id)
        if exp["status"] != "pending":
            raise ConflictError(f"승인 대기 상태가 아니라 거절할 수 없습니다(현재: {exp['status']}).")
        exp["status"] = "rejected"
        exp["finished_at"] = _now()
        _save()
        out = _public(exp)
    activity.log_activity("experiment", f"실험 거절: {out['run_name']}",
                          {"experiment_id": exp_id, "run_name": out["run_name"]})
    return out


def cancel_experiment(exp_id):
    with _lock:
        _load()
        exp = _get(exp_id)
        st = exp["status"]
        if st not in ACTIVE_STATES:
            raise ConflictError(f"이미 끝난 실험이라 취소할 수 없습니다(현재: {st}).")
        exp["status"] = "cancelled"
        exp["finished_at"] = _now()
        if st == "running":
            exp["_cancel_at"] = time.time()
            pid = _proc["pid"] if _proc["exp_id"] == exp_id else exp.get("_pid")
            if pid:
                _signal_group(pid, signal.SIGTERM)
        _save()
        out = _public(exp)
    activity.log_activity("experiment", f"실험 취소: {out['run_name']} (취소 전 상태: {st})",
                          {"experiment_id": exp_id, "run_name": out["run_name"], "previous_status": st})
    return out


def _signal_group(pid, sig):
    try:
        os.killpg(pid, sig)  # start_new_session=True 로 띄웠으므로 pgid == pid
    except ProcessLookupError:
        pass
    except PermissionError:
        try:
            os.kill(pid, sig)
        except OSError:
            pass


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _pid_is_our_training(pid, run_name):
    try:
        out = subprocess.run(["ps", "-p", str(int(pid)), "-o", "command="], capture_output=True,
                             text=True, timeout=5, shell=False).stdout
    except (OSError, subprocess.SubprocessError, ValueError):
        return False
    return TRAIN_SCRIPT in out and f"{run_name}.json" in out


def _write_config(exp):
    cfg = _template()
    cfg["experiment"]["name"] = exp["run_name"]
    cfg["train"]["num_epochs"] = exp["params"]["epochs"]
    cfg["train"]["seed"] = exp["params"]["seed"]
    cfg["train"]["hdf5_filter_key"] = exp["filter_key"]
    cfg["experiment"]["rollout"]["rate"] = exp["params"]["epochs"]  # 학습 끝에 한 번 평가
    path = os.path.join(CONFIGS_DIR, f"{exp['run_name']}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    return path


def _maybe_start_next():
    """학습이 없으면 승인 순서가 가장 이른 대기 건을 시작한다. _lock 안에서 호출."""
    if _proc["exp_id"] is not None:
        return
    queued = sorted((e for e in _exps if e.get("status") == "queued"), key=lambda e: e.get("approved_at") or "")
    for exp in queued:
        if _start_training(exp):
            return


def _start_training(exp):
    """_lock 안에서 호출. 시작하면 True."""
    run_name = exp["run_name"]
    if os.path.exists(os.path.join(RUNS_DIR, run_name)):
        exp.update(status="failed", finished_at=_now(),
                   error=f"같은 이름의 실행 폴더가 이미 있어 시작하지 않았습니다: {run_name}")
        _save()
        activity.log_activity("training", f"학습 시작 실패: {run_name}", {"experiment_id": exp["id"], "error": exp["error"]})
        return False
    try:
        cfg_path = _write_config(exp)
        os.makedirs(RUNS_DIR, exist_ok=True)
        stdout_path = os.path.join(RUNS_DIR, f"{run_name}.stdout.log")
        time_path = os.path.join(RUNS_DIR, f"{run_name}.time.log")
        env = dict(os.environ, PYTHONUNBUFFERED="1")
        with open(stdout_path, "w") as fo, open(time_path, "w") as fe:
            popen = subprocess.Popen(
                [TIME_BIN, "-l", VENV_PY, TRAIN_SCRIPT, "--config", cfg_path],
                stdout=fo, stderr=fe, stdin=subprocess.DEVNULL, cwd=KERNEL, env=env,
                shell=False, start_new_session=True)
    except Exception as e:
        exp.update(status="failed", finished_at=_now(), error=f"학습 프로세스를 시작하지 못했습니다: {type(e).__name__}: {e}")
        _save()
        activity.log_activity("training", f"학습 시작 실패: {run_name}", {"experiment_id": exp["id"], "error": exp["error"]})
        return False
    exp.update(status="running", started_at=_now(), error=None,
               progress={"phase": "load", "epoch": 0, "epochs": exp["params"]["epochs"]})
    exp["_pid"] = popen.pid
    exp["_config"] = cfg_path
    _proc.update(exp_id=exp["id"], popen=popen, pid=popen.pid)
    _save()
    activity.log_activity("training", f"학습 시작: {run_name}",
                          {"experiment_id": exp["id"], "run_name": run_name, "pid": popen.pid,
                           "config": os.path.relpath(cfg_path, KERNEL)})
    threading.Thread(target=_watch, args=(exp["id"], popen, popen.pid), name=f"watch-{run_name}", daemon=True).start()
    return True


def _rollout_tqdm(text, total):
    """평가 진행(예: 12/50)을 마지막 평가 시작 줄 뒤의 tqdm 출력(stdout 로그)에서 읽는다."""
    if not text or not total:
        return None
    start = text.rfind("rollout: env=")
    if start < 0:
        return None
    hits = [int(a) for a, b in re.findall(r"(\d+)/(\d+) \[", text[start:]) if int(b) == total]
    return hits[-1] if hits else 0


def _update_progress(exp_id):
    with _lock:
        exp = _get(exp_id)
        run_name, epochs = exp["run_name"], exp["params"]["epochs"]
    text = _read_text(os.path.join(RUNS_DIR, f"{run_name}.stdout.log"))
    parsed = parse_train_log(text)
    if parsed["finished"]:
        phase = "done"
    elif parsed["in_rollout"]:
        phase = "rollout"
    elif parsed["last_epoch"] > 0:
        phase = "train"
    else:
        phase = "load"
    prog = {"phase": phase, "epoch": parsed["last_epoch"], "epochs": epochs}
    if phase == "rollout" and parsed["rollout_n"]:
        prog["rollout_total"] = parsed["rollout_n"]
        prog["rollout_done"] = _rollout_tqdm(text, parsed["rollout_n"])
    if parsed["loss_curve"]:
        prog["last_loss"] = parsed["loss_curve"][-1]["loss"]
    with _lock:
        if exp.get("status") != "running":
            return
        changed_phase = (exp.get("progress") or {}).get("phase") != phase
        exp["progress"] = prog
        if changed_phase:
            _save()


def _watch(exp_id, popen, pid):
    """학습 프로세스 감시: 1초마다 진행률 갱신, 끝나면 결과 기록 후 다음 대기 건 시작."""
    while True:
        alive = (popen.poll() is None) if popen is not None else _pid_alive(pid)
        try:
            _update_progress(exp_id)
        except Exception:
            pass
        if not alive:
            break
        with _lock:
            try:
                exp = _get(exp_id)
            except NotFoundError:
                exp = {}
            cancel_at = exp.get("_cancel_at")
        if exp.get("status") == "cancelled" and cancel_at and time.time() - cancel_at > KILL_GRACE_SEC:
            _signal_group(pid, signal.SIGKILL)
        time.sleep(1.0)
    rc = popen.returncode if popen is not None else None
    try:
        _finish(exp_id, rc)
    finally:
        with _lock:
            if _proc["exp_id"] == exp_id:
                _proc.update(exp_id=None, popen=None, pid=None)
            _maybe_start_next()


def _archive_attempt(run_name):
    """취소·실패한 시도의 실행 폴더와 로그를 runs/.archived/<run_name>-<시각>/로 옮긴다(지우지 않는다).

    robomimic은 같은 이름의 실행 폴더가 있으면 덮어쓸지 표준입력으로 묻는데, 대시보드는 표준입력을 주지 않으므로
    학습이 바로 실패한다. 그래서 끝나지 못한 시도는 옮겨 두어야 같은 설정을 다시 제안할 수 있다.
    list_runs()와 체크포인트 목록은 '.'으로 시작하는 폴더를 읽지 않는다. 옮긴 위치(runs 기준 상대경로) 또는 None."""
    src_dir = os.path.join(RUNS_DIR, run_name)
    logs = [os.path.join(RUNS_DIR, f"{run_name}{ext}") for ext in (".stdout.log", ".time.log")]
    if not os.path.isdir(src_dir) and not any(os.path.isfile(p) for p in logs):
        return None
    base = os.path.join(ARCHIVE_DIR, f"{run_name}-{datetime.now().strftime('%Y%m%d%H%M%S')}")
    dest, n = base, 1
    while os.path.exists(dest):
        dest, n = f"{base}-{n}", n + 1
    os.makedirs(dest)
    if os.path.isdir(src_dir):
        shutil.move(src_dir, os.path.join(dest, run_name))
    for p in logs:
        if os.path.isfile(p):
            shutil.move(p, os.path.join(dest, os.path.basename(p)))
    return os.path.relpath(dest, RUNS_DIR).replace(os.sep, "/")


def _finish(exp_id, rc):
    with _lock:
        exp = _get(exp_id)
        run_name = exp["run_name"]
    parsed = parse_train_log(_read_text(os.path.join(RUNS_DIR, f"{run_name}.stdout.log")))
    run = find_run(run_name) if os.path.isdir(os.path.join(RUNS_DIR, run_name)) else None
    with _lock:
        exp.pop("_cancel_at", None)
        if exp["status"] == "cancelled":
            _save()
            msg, kind_data = f"학습 중단 확인(취소): {run_name}", {"returncode": rc}
        elif parsed["finished"] and run is not None:
            exp["status"] = "done"
            exp["finished_at"] = _now()
            exp["result"] = {"success_rate": run["success_rate"], "wall_sec": run["wall_sec"]}
            exp["progress"] = {"phase": "done", "epoch": exp["params"]["epochs"], "epochs": exp["params"]["epochs"]}
            exp["error"] = None
            _save()
            sr = run["success_rate"]
            sr_txt = f"{sr * 100:.0f}%" if isinstance(sr, (int, float)) else "기록 없음"
            wall = run["wall_sec"]
            wall_txt = f"{wall:.1f}초" if isinstance(wall, (int, float)) else "기록 없음"
            msg = f"학습 완료: {run_name} — 성공률 {sr_txt}, 걸린 시간 {wall_txt}"
            kind_data = {"success_rate": sr, "wall_sec": wall, "returncode": rc}
        else:
            reason = parsed["failed_msg"]
            if not reason:
                reason = f"완료 기록 없이 종료되었습니다(종료 코드 {rc if rc is not None else '확인 불가'})."
            exp["status"] = "failed"
            exp["finished_at"] = _now()
            exp["error"] = f"학습 실패: {reason}"
            _save()
            msg = f"학습 실패: {run_name} — {reason}"
            kind_data = {"returncode": rc, "error": reason}
        final_status = exp["status"]
    if final_status in ("cancelled", "failed"):
        try:
            archived = _archive_attempt(run_name)
        except OSError as e:
            archived = None
            kind_data = dict(kind_data, archive_error=f"{type(e).__name__}: {e}")
            msg += " · 실행 폴더를 보관 폴더로 옮기지 못했습니다(같은 설정을 다시 제안하려면 runs 폴더 정리 필요)"
        if archived:
            with _lock:
                exp["archived_to"] = archived
                _save()
            kind_data = dict(kind_data, archived_to=archived)
            msg += f" · 이전 시도 기록은 runs/{archived}/에 보관했습니다"
    activity.log_activity("training", msg, dict(kind_data, experiment_id=exp_id, run_name=run_name))


def start():
    """서버 시작 때 한 번 호출: 이전 서버가 남긴 running 건을 다시 붙잡고, 대기 건을 시작한다."""
    with _lock:
        _load()
        if _state["started"]:
            return
        _state["started"] = True
        reattach = []
        for exp in _exps:
            if exp.get("status") != "running":
                continue
            pid = exp.get("_pid")
            if pid and _pid_alive(pid) and _pid_is_our_training(pid, exp["run_name"]):
                reattach.append((exp["id"], pid))
            else:
                reattach.append((exp["id"], None))
        for exp_id, pid in reattach:
            if pid:
                if _proc["exp_id"] is None:
                    _proc.update(exp_id=exp_id, popen=None, pid=pid)
                activity.log_activity("training", "서버 재시작 후 진행 중인 학습을 다시 추적합니다.",
                                      {"experiment_id": exp_id, "pid": pid})
                threading.Thread(target=_watch, args=(exp_id, None, pid), daemon=True).start()
            else:  # 프로세스가 이미 끝났다: 로그로 결과를 확정한다
                _finish(exp_id, None)
        _maybe_start_next()


# ---------------------------------------------------------------- 상태
_status_cache = {}
_status_lock = threading.Lock()


def _cached(key, fn):
    with _status_lock:
        hit = _status_cache.get(key)
        if hit and time.time() - hit[0] < STATUS_TTL:
            return copy.deepcopy(hit[1])
    val = fn()
    with _status_lock:
        _status_cache[key] = (time.time(), val)
    return copy.deepcopy(val)


def _kernel_versions():
    """커널 가상환경의 패키지 메타데이터만 읽는다(robomimic을 import하지 않음)."""
    out = {"python": None, "torch": None, "robosuite": None, "mujoco": None, "robomimic": None}
    cfg = _read_text(os.path.join(VENV_DIR, "pyvenv.cfg")) or ""
    m = re.search(r"^version(?:_info)?\s*=\s*(\S+)", cfg, re.M)
    if m:
        out["python"] = m.group(1)
    sites = glob.glob(os.path.join(VENV_DIR, "lib", "python*", "site-packages"))
    wanted = {"torch", "robosuite", "mujoco", "robomimic"}
    for dist in importlib.metadata.distributions(path=sites):
        name = (dist.metadata.get("Name") or "").lower()
        if name in wanted and out[name] is None:
            out[name] = dist.version
    return out


_versions_cache = {}


def _versions():
    if not _versions_cache:
        _versions_cache.update(_kernel_versions())
    return dict(_versions_cache)


def _tunnel_check():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(TUNNEL_URL, timeout=2) as r:
            code = r.status
            body = r.read()
    except urllib.error.HTTPError as e:
        return {"ok": False, "connected": False, "detail": f"모델 서버가 오류로 응답했습니다(HTTP {e.code})."}
    except Exception as e:
        reason = getattr(e, "reason", e)
        if "refused" in str(reason).lower():
            why = "연결 거부"
        elif "timed out" in str(reason).lower():
            why = "2초 안에 응답 없음"
        else:
            why = f"{type(reason).__name__}: {reason}"
        return {"ok": False, "connected": False,
                "detail": f"연결 안 됨({why}). 맥미니 모델 서버 SSH 터널(127.0.0.1:18434)을 확인하세요."}
    try:
        names = [m.get("name") for m in json.loads(body).get("models", [])]
    except (ValueError, AttributeError):
        names = []
    has = MODEL_NAME in names
    # 연결만 되고 에이전트가 쓰는 모델이 없으면 질문해도 실패하므로 ok가 아니다
    return {"ok": code == 200 and has, "connected": code == 200,
            "detail": f"연결됨 · 모델 {len(names)}개 · {MODEL_NAME} {'확인' if has else '목록에 없음'}",
            "model_available": has, "models": [n for n in names if isinstance(n, str)]}


def _docker_bin():
    found = shutil.which("docker")
    if found:
        return found
    for p in ("/opt/homebrew/bin/docker", "/usr/local/bin/docker",
              "/Applications/Docker.app/Contents/Resources/bin/docker"):
        if os.path.exists(p):
            return p
    return None


def _container_check():
    docker = _docker_bin()
    if not docker:
        return {"ok": False, "detail": "docker 명령을 찾을 수 없습니다."}
    try:
        r = subprocess.run([docker, "inspect", "--format", "{{json .State}}", CONTAINER],
                           capture_output=True, text=True, timeout=5, shell=False)
    except subprocess.TimeoutExpired:
        return {"ok": False, "detail": "docker 응답이 5초 안에 오지 않았습니다(Docker Desktop 상태 확인)."}
    except OSError as e:
        return {"ok": False, "detail": f"docker 실행 실패: {e}"}
    if r.returncode != 0:
        err = (r.stderr or "").strip().splitlines()
        return {"ok": False, "detail": f"컨테이너 {CONTAINER} 확인 실패: {err[-1] if err else '원인 불명'}"}
    try:
        st = json.loads(r.stdout)
    except ValueError:
        return {"ok": False, "detail": "docker inspect 결과를 해석하지 못했습니다."}
    status = st.get("Status")
    health = (st.get("Health") or {}).get("Status")
    ok = status == "running" and health in (None, "healthy")
    status_ko = {"running": "실행 중", "exited": "중지됨", "paused": "일시 정지", "restarting": "재시작 중",
                 "created": "생성만 됨", "dead": "비정상 종료"}.get(status, status)
    detail = f"{CONTAINER} {status_ko}"
    if health:
        detail += f" · 상태 점검 {'정상' if health == 'healthy' else health}"
    return {"ok": ok, "detail": detail}


def _training_status():
    with _lock:
        _load()
        exp = None
        if _proc["exp_id"]:
            try:
                exp = _get(_proc["exp_id"])
            except NotFoundError:
                exp = None
        queued = sum(1 for e in _exps if e.get("status") == "queued")
        pending = sum(1 for e in _exps if e.get("status") == "pending")
        return {"busy": exp is not None,
                "experiment_id": exp["id"] if exp else None,
                "run_name": exp["run_name"] if exp else None,
                "progress": copy.deepcopy(exp.get("progress")) if exp else None,
                "queued": queued, "pending": pending}


def status():
    return {
        "kernel": _versions(),
        "training": _training_status(),
        "tunnel": _cached("tunnel", _tunnel_check),
        "dify_container": _cached("container", _container_check),
    }

