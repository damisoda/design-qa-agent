"""대시보드 ↔ Dify 에이전트 연동.

- Dify api 컨테이너(docker-api-1) 안에 상주 워커(dify_worker.py)를 하나 띄우고, 질문을 한 번에 하나씩 보낸다.
- 워커가 내보내는 이벤트를 질문(ask)별로 쌓아 두었다가 SSE로 재생·중계한다(events()).
- 질문 기록은 data/asks.jsonl에, 주요 사건(질문 시작·도구 호출·완료·오류)은 activity 기록에 남긴다.
- 모델 서버 SSH 터널(127.0.0.1:18434)은 확인만 한다. 연결을 스스로 만들지 않는다.
- history()는 4주차에 실제로 실행한 기록 4건도 함께 돌려준다(source="4주차 기록").

외부에서 쓰는 것: BusyError, UnavailableError, DifyBridge, bridge (CONTRACT.md 3장)
ask()의 예외: ValueError(질문 형식) → 400, BusyError → 409, UnavailableError(워커·터널 불가) → 503.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from collections import OrderedDict, deque
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import activity  # noqa: E402  (공용 활동 기록, 수정 금지 모듈)

DATA_DIR = os.path.join(HERE, "data")
ASKS_PATH = os.path.join(DATA_DIR, "asks.jsonl")
WORKER_SRC = os.path.join(HERE, "dify_worker.py")
CONTAINER = "docker-api-1"
WORKER_DST = "/tmp/dashboard_worker.py"
WORKER_CMD = f"cd /app/api && python -u {WORKER_DST}"
TUNNEL_URL = "http://127.0.0.1:18434/api/tags"
MARK = "@@EV "
MAX_QUERY = 1000
ASK_TIMEOUT = 600          # 초. 이보다 오래 걸리면 중단하고 워커를 다시 띄운다
KEEP_ASKS = 20             # 메모리에 이벤트를 보관할 최근 질문 수
SUMMARY_MAX = 300

WEEK4_DIR = os.path.expanduser("~/Desktop/서강대학교/6학기/AI에이전트/4주차_도구/runs")
# q1_square_files.json은 도구 설정이 꺼진 채 실행된 실패 사례라 넣지 않는다.
WEEK4_FILES = ["q1_square_files_v2.json", "q2_lift_mg_toolhang.json", "q3_cupid_can.json", "q4_failure_demo.json"]
WEEK4_SOURCE = "4주차 기록"

# 일부러 만든 실패를 일반 실패와 구분해 보여 준다(원본 기록 파일은 고치지 않는다). 값: (tag, 설명)
# 근거: 4주차_도구/README.md 4장 표 Q4 "도구 실패 시연(조회 주소를 없는 호스트로 바꿈)".
WEEK4_NOTES = {
    "q4_failure_demo.json": ("demo", "의도적 실패 시연: 조회 주소를 없는 호스트로 바꿔 도구가 실패하도록 한 기록입니다"
                                     "(4주차 README 4장 Q4)."),
}
# 대시보드 개발 중 시험으로 만든 질문 기록. asks.jsonl은 그대로 두고 화면에서만 구분한다.
# 근거: 연동 시험 스크립트(crash_test)가 질문 도중 'docker exec docker-api-1 kill -9 <워커 pid>'로 워커를 종료함.
ASK_NOTES = {
    "1ec99e7b6e8c": ("test", "시험 기록: 연동 개발 중 질문 도중 Dify 워커를 일부러 강제 종료(kill -9)해 "
                             "오류 처리를 확인한 기록입니다. 에이전트 자체의 실패가 아닙니다."),
}


def _annotate(rec, note=None):
    """기록에 tag·note를 붙인 사본을 돌려준다(해당 없으면 그대로)."""
    note = note or ASK_NOTES.get(rec.get("id"))
    if not note:
        return rec
    return dict(rec, tag=note[0], note=note[1])


class BusyError(Exception):
    """이미 다른 질문을 실행 중일 때."""


class UnavailableError(RuntimeError):
    """Dify 워커가 준비되지 않았거나 모델 서버 터널이 끊겼을 때."""


def _now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _clip(text, n=SUMMARY_MAX):
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 1] + "…"


def _docker_bin():
    found = shutil.which("docker")
    if found:
        return found
    for cand in ("/opt/homebrew/bin/docker", "/usr/local/bin/docker",
                 "/Applications/Docker.app/Contents/Resources/bin/docker"):
        if os.path.exists(cand):
            return cand
    return None


_NO_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def check_tunnel(timeout=2.0):
    """모델 서버 터널 확인. (ok, 설명) — 연결을 만들지는 않는다."""
    try:
        with _NO_PROXY.open(TUNNEL_URL, timeout=timeout) as r:
            return r.status == 200, f"HTTP {r.status}"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


# ---------------------------------------------------------------- 도구 호출 해석
def _tool_text(response):
    """Dify tool_response 문자열('{"text": "..."}') → 도구가 돌려준 본문 문자열."""
    if response is None:
        return None
    obj = response
    if isinstance(response, str):
        try:
            obj = json.loads(response)
        except ValueError:
            return response
    if isinstance(obj, dict) and "text" in obj:
        inner = obj["text"]
        return inner if isinstance(inner, str) else json.dumps(inner, ensure_ascii=False)
    return obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)


def _fmt_bytes(v):
    return f"{v:,} B" if isinstance(v, int) else str(v)


def tool_call_from_raw(round_no, tool, tool_input, response, error=None):
    """도구 1회 호출 → ToolCall {round, tool, input, ok, error_type, summary}.

    판정 근거(실제 도구 출력 형식):
    - get_dataset_info: 본문이 JSON이고 ok/error_type/message/files 필드가 있다.
    - kb_search: 결과가 있으면 '[n] 문서: 이름 | score x' 머리글, 없으면 '검색 결과 0건: ...'.
    그 밖의 형식은 ok=None(판정 불가)로 두고 본문 앞부분을 요약으로 쓴다.
    """
    if isinstance(tool_input, str):
        try:
            tool_input = json.loads(tool_input)
        except ValueError:
            tool_input = {"raw": tool_input}
    ok, error_type = None, None
    text = _tool_text(response)
    if error:
        ok, error_type, summary = False, "tool_error", f"도구 실행 오류: {error}"
    elif text is None:
        summary = "도구 응답 없음"
    else:
        payload = None
        try:
            payload = json.loads(text)
        except ValueError:
            pass
        if isinstance(payload, dict) and "ok" in payload:
            ok = bool(payload.get("ok"))
            if ok:
                files = payload.get("files") or []
                parts = [f"{f.get('name')} {_fmt_bytes(f.get('size_bytes'))}" for f in files if isinstance(f, dict)]
                summary = f"{payload.get('path') or ''} 파일 {len(files)}개" + (": " + ", ".join(parts) if parts else "")
            else:
                error_type = payload.get("error_type") or "error"
                summary = f"{error_type}: {payload.get('message') or ''}"
        elif text.startswith("검색 결과 0건"):
            ok, error_type, summary = False, "no_results", text
        else:
            heads = re.findall(r"^\[(\d+)\] 문서: (.+?)(?: \| score ([0-9.]+))?$", text, re.M)
            if heads:
                ok = True
                docs = OrderedDict()        # 문서명 -> [청크 수, 최고 유사도]
                for _, name, score in heads:
                    cnt_best = docs.setdefault(name, [0, None])
                    cnt_best[0] += 1
                    if score and (cnt_best[1] is None or float(score) > float(cnt_best[1])):
                        cnt_best[1] = score
                summary = f"검색 결과 {len(heads)}건: " + ", ".join(
                    f"{name} {cnt}건" + (f"(최고 유사도 {best})" if best else "")
                    for name, (cnt, best) in docs.items())
            else:
                summary = text
    return {"round": round_no, "tool": tool, "input": tool_input if isinstance(tool_input, dict) else {},
            "ok": ok, "error_type": error_type, "summary": _clip(summary)}


def _tool_call_brief(tc):
    args = ", ".join(f"{k}={v}" for k, v in (tc.get("input") or {}).items())
    verdict = {True: "성공", False: f"실패({tc.get('error_type')})", None: "판정 불가"}[tc.get("ok")]
    return _clip(f"도구 호출 {tc.get('tool')}({args}) → {verdict}", 160)


# ---------------------------------------------------------------- 4주차 기록
def _load_week4():
    out = []
    for fn in WEEK4_FILES:
        path = os.path.join(WEEK4_DIR, fn)
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
            mtime = os.path.getmtime(path)
        except (OSError, ValueError):
            continue
        tool_calls, nodes = [], []
        for n in d.get("nodes") or []:
            el = n.get("elapsed")
            nodes.append({"node_id": None, "title": n.get("node"), "node_type": n.get("type"),
                          "status": n.get("status"),
                          "elapsed": round(el, 2) if isinstance(el, (int, float)) else None,
                          "error": n.get("error")})
            for e in (n.get("execution_metadata") or {}).get("agent_log") or []:
                m = re.match(r"ROUND (\d+)$", str(e.get("label") or ""))
                if not m:
                    continue
                o = (e.get("data") or {}).get("output") or {}
                for tr in o.get("tool_responses") or []:
                    tool_calls.append(tool_call_from_raw(int(m.group(1)), tr.get("tool_call_name"),
                                                         tr.get("tool_call_input"), tr.get("tool_response")))
        sec = d.get("sec")
        outputs = d.get("outputs") or {}
        started = datetime.fromtimestamp(mtime - (sec if isinstance(sec, (int, float)) else 0), timezone.utc)
        out.append(_annotate({
            "id": "w4-" + os.path.splitext(fn)[0],
            "query": d.get("query"),
            "status": "done" if d.get("status") == "succeeded" else "error",
            "source": WEEK4_SOURCE,
            "started_at": started.isoformat(timespec="seconds"),
            "started_at_note": "기록 파일 저장 시각에서 실행 시간을 빼서 계산한 값",
            "elapsed_sec": sec,
            "run_id": d.get("run_id"),
            "tool_calls": tool_calls,
            "with_tools": (outputs.get("with_tools") or "").strip() or None,
            "without_tools": (outputs.get("without_tools") or "").strip() or None,
            "error": d.get("error"),
            "nodes": nodes,
            "file": fn,
        }, WEEK4_NOTES.get(fn)))
    return out


# ---------------------------------------------------------------- 질문 1건
class _Ask:
    def __init__(self, query):
        self.id = uuid.uuid4().hex[:12]
        self.t0 = time.monotonic()
        self.events = []
        self.done = False
        self.rec = {"id": self.id, "query": query, "status": "running", "source": "dashboard",
                    "started_at": _now_iso(), "elapsed_sec": None, "run_id": None, "tool_calls": [],
                    "with_tools": None, "without_tools": None, "error": None, "total_tokens": None,
                    "nodes": []}


class DifyBridge:
    def __init__(self):
        self._lock = threading.RLock()
        self._cv = threading.Condition(self._lock)
        self._write_lock = threading.Lock()
        self._started = False
        self._stopping = False
        self._proc = None
        self._ready = False
        self._worker_pid = None
        self._detail = "시작 전"
        self._current = None
        self._reserving = False
        self._asks = OrderedDict()      # id -> _Ask (최근 KEEP_ASKS개)
        self._stored = self._load_stored()   # id -> Ask 기록(파일에서 읽은 것 + 끝난 것)
        self._week4 = None
        self._stderr_tail = deque(maxlen=60)
        self._was_ready = False
        self._fatal = None
        self._models = []

    # ------------------------------------------------------------ 수명 관리
    def start(self):
        with self._lock:
            if self._started:
                return
            self._started = True
            self._stopping = False
        threading.Thread(target=self._supervise, name="dify-bridge", daemon=True).start()
        threading.Thread(target=self._watchdog, name="dify-watchdog", daemon=True).start()

    def stop(self):
        """워커를 끝낸다(테스트·종료용)."""
        with self._lock:
            self._stopping = True
            proc = self._proc
        if proc is not None:
            self._kill_worker(proc)

    def _set(self, ready, detail):
        with self._lock:
            self._ready = ready
            self._detail = detail

    def _supervise(self):
        backoff = 5
        while True:
            with self._lock:
                if self._stopping:
                    return
            t_start = time.monotonic()
            try:
                self._run_worker_once()
            except Exception as e:  # noqa: BLE001 - 서버를 죽이지 않고 상태로 남긴다
                self._set(False, f"워커 관리 오류: {type(e).__name__}: {e}")
            with self._lock:
                if self._stopping:
                    return
                detail = self._detail
            if time.monotonic() - t_start > 120:
                backoff = 5
            self._set(False, f"{detail} — {backoff}초 뒤 다시 시도합니다")
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)

    def _run_worker_once(self):
        docker = _docker_bin()
        if not docker:
            self._set(False, "docker 명령을 찾을 수 없습니다")
            return
        self._set(False, "워커 파일을 Dify 컨테이너에 복사하는 중")
        try:
            r = subprocess.run([docker, "cp", WORKER_SRC, f"{CONTAINER}:{WORKER_DST}"],
                               capture_output=True, text=True, timeout=60)
        except subprocess.TimeoutExpired:
            self._set(False, "docker cp가 60초 안에 끝나지 않았습니다(Docker 응답 없음)")
            return
        if r.returncode != 0:
            self._set(False, _clip(f"Dify 컨테이너({CONTAINER})에 워커를 복사하지 못했습니다: "
                                   f"{(r.stderr or r.stdout).strip()}", 200))
            return
        self._stderr_tail.clear()
        self._fatal = None
        with self._lock:
            if self._stopping:
                return
            proc = subprocess.Popen([docker, "exec", "-i", CONTAINER, "bash", "-c", WORKER_CMD],
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self._proc = proc
            self._worker_pid = None
        self._set(False, "워커 시작 중(Dify 앱을 불러오는 데 약 20초 걸립니다)")
        threading.Thread(target=self._drain_stderr, args=(proc,), daemon=True).start()
        for raw in proc.stdout:
            line = raw.decode("utf-8", "replace")
            i = line.find(MARK)
            if i < 0:
                continue
            try:
                ev = json.loads(line[i + len(MARK):])
            except ValueError:
                continue
            if isinstance(ev, dict):
                self._on_event(ev)
        rc = proc.wait()
        # 표준오류 끝부분 중 오류로 보이는 줄만 원인으로 보여 준다(경고 줄은 원인이 아니다)
        tail = next((ln.strip() for ln in reversed(self._stderr_tail)
                     if re.search(r"Error|Exception|Traceback|No such container|not running", ln)), "")
        with self._lock:
            self._proc = None
            self._ready = False
            self._worker_pid = None
            cur = self._current
            stopping = self._stopping
        if stopping:
            msg = "워커를 중지했습니다"
        elif self._fatal:
            msg = f"워커 준비 실패: {self._fatal}"
        else:
            msg = _clip(f"Dify 워커가 종료되었습니다(종료 코드 {rc})" + (f": {tail}" if tail else ""), 200)
        self._set(False, msg)
        if cur is not None:
            self._finish(cur, error=f"실행 중 Dify 워커가 종료되었습니다(종료 코드 {rc})")
        if self._was_ready and not stopping:
            activity.log_activity("dify", msg, {"returncode": rc})
        self._was_ready = False

    def _drain_stderr(self, proc):
        for raw in proc.stderr:
            self._stderr_tail.append(raw.decode("utf-8", "replace").rstrip())

    def _kill_worker(self, proc):
        pid = self._worker_pid
        docker = _docker_bin()
        if pid and docker:
            try:  # docker exec 클라이언트만 죽이면 컨테이너 안 프로세스가 남을 수 있어 직접 끝낸다
                subprocess.run([docker, "exec", CONTAINER, "bash", "-c", f"kill -TERM {int(pid)}"],
                               capture_output=True, timeout=15)
            except (subprocess.TimeoutExpired, OSError, ValueError):
                pass
        try:
            proc.kill()
        except OSError:
            pass

    def _watchdog(self):
        while True:
            time.sleep(5)
            with self._lock:
                if self._stopping:
                    return
                cur, proc = self._current, self._proc
            if cur is not None and time.monotonic() - cur.t0 > ASK_TIMEOUT:
                # 먼저 준비 상태를 내려 둔다. 그래야 워커를 끝내는 동안(최대 15초) 새 질문이 멈춘 워커로 가지 않는다.
                with self._lock:
                    if self._proc is proc:
                        self._ready = False
                        self._detail = "시간 초과로 워커를 다시 시작하는 중"
                self._finish(cur, error=f"{ASK_TIMEOUT}초 안에 끝나지 않아 중단했습니다. 워커를 다시 시작합니다.")
                if proc is not None:
                    self._kill_worker(proc)

    # ------------------------------------------------------------ 워커 이벤트
    def _on_event(self, ev):
        kind = ev.get("type")
        if kind == "ready":
            models = ev.get("models")
            with self._lock:
                self._worker_pid = ev.get("pid")
                # 워커가 게시된 워크플로 그래프에서 읽은 노드별 모델 이름 [{node, title, type, model}]
                self._models = [m for m in models if isinstance(m, dict)] if isinstance(models, list) else []
            self._set(True, f"준비됨 (Dify 앱: {ev.get('app_name')}, 컨테이너 Python {ev.get('python')})")
            if not self._was_ready:
                activity.log_activity("dify", "Dify 에이전트 워커가 준비되었습니다",
                                      {"app_name": ev.get("app_name"), "workflow_id": ev.get("workflow_id")})
            self._was_ready = True
            return
        if kind == "fatal":
            self._fatal = str(ev.get("message"))
            self._set(False, self._fatal)
            return
        if kind == "pong":
            return
        with self._lock:
            ask = self._asks.get(ev.pop("ask_id", None))
        if ask is None or ask.done:
            return
        if kind == "tool_call_raw":
            tc = tool_call_from_raw(ev.get("round"), ev.get("tool"), ev.get("input"),
                                    ev.get("response"), ev.get("error"))
            with self._lock:
                ask.rec["tool_calls"].append(tc)
            self._push(ask, {"type": "tool_call", **tc})
            activity.log_activity("tool_call", _tool_call_brief(tc),
                                  {"ask_id": ask.id, "tool": tc["tool"], "input": tc["input"],
                                   "ok": tc["ok"], "error_type": tc["error_type"]})
        elif kind == "final":
            self._finish(ask, final=ev)
        elif kind == "error":
            self._finish(ask, error=str(ev.get("message")))
        else:
            with self._lock:
                if kind == "status" and ev.get("run_id"):
                    ask.rec["run_id"] = ev["run_id"]
                if kind == "node_finished":
                    ask.rec["nodes"].append({k: ev.get(k) for k in
                                             ("node_id", "title", "node_type", "status", "elapsed", "error")})
            self._push(ask, ev)

    def _push(self, ask, ev):
        with self._cv:
            if ask.done:
                return
            ask.events.append(ev)
            self._cv.notify_all()

    def _finish(self, ask, final=None, error=None):
        with self._cv:
            if ask.done:
                return
            rec = ask.rec
            elapsed = round(time.monotonic() - ask.t0, 1)
            if final is not None:
                rec.update(status="done", with_tools=final.get("with_tools"),
                           without_tools=final.get("without_tools"),
                           elapsed_sec=final.get("elapsed_sec") or elapsed,
                           run_id=final.get("run_id") or rec["run_id"],
                           total_tokens=final.get("total_tokens"))
                ev = {"type": "final", "with_tools": rec["with_tools"], "without_tools": rec["without_tools"],
                      "elapsed_sec": rec["elapsed_sec"], "run_id": rec["run_id"],
                      "total_tokens": rec["total_tokens"]}
            else:
                rec.update(status="error", error=error, elapsed_sec=elapsed)
                ev = {"type": "error", "message": error}
            ask.events.append(ev)
            ask.done = True
            if self._current is ask:
                self._current = None
            self._stored[rec["id"]] = dict(rec)
            self._cv.notify_all()
            snapshot = dict(rec)
        self._persist(snapshot)
        if final is not None:
            activity.log_activity("ask", f"에이전트 답변 완료({snapshot['elapsed_sec']}초, 도구 호출 "
                                         f"{len(snapshot['tool_calls'])}회)",
                                  {"ask_id": snapshot["id"], "run_id": snapshot["run_id"]})
        else:
            activity.log_activity("ask", _clip(f"에이전트 실행 실패: {error}", 200), {"ask_id": snapshot["id"]})

    # ------------------------------------------------------------ 기록 파일
    def _load_stored(self):
        stored = {}
        try:
            with open(ASKS_PATH, encoding="utf-8") as f:
                for line in f:
                    try:
                        rec = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(rec, dict) and rec.get("id"):
                        stored[rec["id"]] = rec     # 같은 id는 마지막 줄이 최종 상태
        except OSError:
            pass
        for rec in stored.values():
            if rec.get("status") == "running":   # 이전 서버 실행 중에 끊긴 질문
                rec["status"] = "error"
                rec["error"] = "대시보드 서버가 실행 도중 종료되어 결과를 받지 못했습니다"
        return stored

    def _persist(self, rec):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            with open(ASKS_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except OSError as e:
            activity.log_activity("ask", f"질문 기록 저장 실패: {e}", {"ask_id": rec.get("id")})

    # ------------------------------------------------------------ 공개 인터페이스
    def status(self):
        with self._lock:
            ok = self._ready and self._proc is not None and self._proc.poll() is None
            busy = self._current is not None or self._reserving
            return {"ok": ok, "detail": self._detail, "busy": busy,
                    "ask_id": self._current.id if self._current is not None else None,
                    "models": [dict(m) for m in self._models]}

    def ask(self, query):
        if not isinstance(query, str):
            raise ValueError("질문은 문자열이어야 합니다.")
        q = query.strip()
        if not 1 <= len(q) <= MAX_QUERY:
            raise ValueError(f"질문은 1자 이상 {MAX_QUERY}자 이하로 입력하십시오.")
        with self._lock:
            if self._current is not None or self._reserving:
                raise BusyError("이미 다른 질문을 실행 중입니다. 끝난 뒤 다시 시도하십시오.")
            if not self._ready or self._proc is None:
                raise UnavailableError(f"Dify 에이전트 워커가 준비되지 않았습니다: {self._detail}")
            self._reserving = True
        try:
            ok, why = check_tunnel(2.0)
            if not ok:
                raise UnavailableError("모델 서버 터널(127.0.0.1:18434)에 연결할 수 없습니다. "
                                       f"맥미니 SSH 터널을 다시 연결한 뒤 시도하십시오. ({why})")
            ask = _Ask(q)
            with self._cv:
                proc = self._proc
                if not self._ready or proc is None:
                    raise UnavailableError(f"Dify 에이전트 워커가 준비되지 않았습니다: {self._detail}")
                self._current = ask
                self._asks[ask.id] = ask
                while len(self._asks) > KEEP_ASKS:
                    old_id, old = next(iter(self._asks.items()))
                    if not old.done:
                        break
                    self._asks.pop(old_id)
                ask.events.append({"type": "status", "message": "질문을 Dify 에이전트에 보냈습니다"})
                self._reserving = False
            self._persist(dict(ask.rec))
            activity.log_activity("ask", _clip(f"에이전트 질문 시작: {q}", 120), {"ask_id": ask.id})
            try:
                with self._write_lock:
                    proc.stdin.write((json.dumps({"id": ask.id, "query": q}) + "\n").encode("ascii"))
                    proc.stdin.flush()
            except (OSError, ValueError) as e:
                self._finish(ask, error=f"워커에 질문을 보내지 못했습니다: {e}")
                raise UnavailableError(f"Dify 에이전트 워커에 질문을 보내지 못했습니다: {e}") from e
            return ask.id
        finally:
            with self._lock:
                self._reserving = False

    def events(self, ask_id, timeout=1.0):
        """쌓인 이벤트부터 재생하고 새 이벤트를 차례로 내는 이터레이터. 없는 id면 KeyError."""
        with self._lock:
            ask = self._asks.get(ask_id)
            stored = None if ask is not None else self._stored.get(ask_id)
        if ask is not None:
            return self._iter_live(ask, timeout)
        if stored is None:
            stored = next((r for r in self._week4_records() if r["id"] == ask_id), None)
        if stored is None:
            raise KeyError(ask_id)
        return self._iter_stored(_annotate(stored))

    def _iter_live(self, ask, timeout):
        i = 0
        while True:
            deadline = time.monotonic() + timeout
            with self._cv:
                while i >= len(ask.events) and not ask.done:
                    left = deadline - time.monotonic()
                    if left <= 0:
                        break
                    self._cv.wait(left)
                new = ask.events[i:]
                i += len(new)
                done = ask.done
            if not new:
                if done:
                    return
                yield {"type": "ping"}
                continue
            for ev in new:
                yield ev
                if ev.get("type") in ("final", "error"):
                    return

    @staticmethod
    def _iter_stored(rec):
        """저장된 기록(실행 중 이벤트는 남아 있지 않음)을 같은 형식으로 재생한다."""
        yield {"type": "status", "message": f"저장된 기록입니다({rec.get('source')}). 실시간 실행이 아닙니다."}
        if rec.get("note"):
            yield {"type": "status", "message": rec["note"]}
        for n in rec.get("nodes") or []:
            yield {"type": "node_finished", **n}
        for tc in rec.get("tool_calls") or []:
            yield {"type": "tool_call", **tc}
        if rec.get("status") == "done":
            yield {"type": "final", "with_tools": rec.get("with_tools"), "without_tools": rec.get("without_tools"),
                   "elapsed_sec": rec.get("elapsed_sec"), "run_id": rec.get("run_id"),
                   "total_tokens": rec.get("total_tokens")}
        else:
            yield {"type": "error", "message": rec.get("error") or "결과 없음"}

    def _week4_records(self):
        if self._week4 is None:
            self._week4 = _load_week4()
        return self._week4

    def history(self, limit=50):
        with self._lock:
            recs = {k: dict(v) for k, v in self._stored.items()}
            for a in self._asks.values():
                recs[a.id] = dict(a.rec, tool_calls=list(a.rec["tool_calls"]), nodes=list(a.rec["nodes"]))
        items = [_annotate(r) for r in recs.values()] + [dict(r) for r in self._week4_records()]
        items.sort(key=lambda r: r.get("started_at") or "", reverse=True)
        return items[:max(0, int(limit))]


bridge = DifyBridge()
