"""로봇 데이터 에이전트 대시보드 서버 (진입점).

실행: ~/robot-kernel/.venv/bin/python ~/robot-kernel/dashboard/server.py  →  http://127.0.0.1:8780
- 127.0.0.1에만 바인딩한다(로컬 전용).
- HTTP는 데몬 스레드에서 먼저 띄우고(약 1~2초 안에 응답), 메인 스레드는 viewer_core.main_loop()을 돈다.
  macOS는 MuJoCo 오프스크린 렌더링을 메인 스레드에서만 허용하기 때문이다.
- 정적 파일(static/), /api/* JSON, SSE(/api/ask/<id>/events), MJPEG(/viewer/stream)을 제공한다.
"""

import json
import os
import re
import signal
import socket
import sys
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import activity      # noqa: E402
import kernel_api    # noqa: E402
import viewer_core   # noqa: E402

HOST, PORT = "127.0.0.1", 8780
STATIC_DIR = os.path.join(HERE, "static")
MODEL_NAME = "gemma4:e4b-16k"   # 워커가 워크플로에서 읽은 모델 이름을 아직 보고하지 않았을 때만 쓰는 기본값
MAX_BODY = 64 * 1024
MAX_QUERY_LEN = 1000
SOCKET_TIMEOUT = 30             # 초. 머리글·본문을 덜 보낸 연결이 처리 스레드를 붙잡지 않게 한다

# 다른 웹사이트의 요청(CSRF)과 DNS 재바인딩을 막는다: 이 두 주소로 연 화면에서 온 요청만 받는다.
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
ALLOWED_ORIGINS = {f"http://{h}" for h in ALLOWED_HOSTS}
ALLOWED_FETCH_SITES = {"same-origin", "none"}

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
    ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
    ".mp4": "video/mp4", ".webm": "video/webm",
}

_EXP_ACTION_RE = re.compile(r"^/api/experiments/([A-Za-z0-9_-]{1,80})/(approve|reject|cancel)$")
_ASK_EVENTS_RE = re.compile(r"^/api/ask/([A-Za-z0-9_-]{1,100})/events$")

# Dify 연동 모듈(dify_bridge.py)은 다른 담당이 작성한다. 불러오지 못해도 서버는 계속 돈다.
_bridge = {"mod": None, "obj": None, "error": "Dify 연동 모듈을 불러오는 중입니다."}


def _init_bridge():
    try:
        import dify_bridge
    except Exception as e:
        _bridge["error"] = f"Dify 연동 모듈(dify_bridge.py)을 불러오지 못했습니다: {type(e).__name__}: {e}"
        print(_bridge["error"], file=sys.stderr, flush=True)
        return
    obj = getattr(dify_bridge, "bridge", None)
    if obj is None:
        _bridge["error"] = "dify_bridge.py에 bridge 객체가 없습니다."
        return
    _bridge.update(mod=dify_bridge, obj=obj, error=None)
    try:
        obj.start()
    except Exception as e:  # start()는 예외를 내지 않아야 하지만, 내더라도 서버는 유지한다
        _bridge["error"] = f"Dify 워커 시작 실패: {type(e).__name__}: {e}"
        print(_bridge["error"], file=sys.stderr, flush=True)
        traceback.print_exc()


def _dify_status():
    obj = _bridge["obj"]
    if obj is None:
        return {"ok": False, "detail": _bridge["error"] or "Dify 연동 모듈 없음", "busy": False}
    try:
        st = obj.status()
        if not isinstance(st, dict):
            raise TypeError("status()가 dict가 아닙니다")
        out = {"ok": bool(st.get("ok")), "detail": st.get("detail", ""), "busy": bool(st.get("busy")),
               "ask_id": st.get("ask_id"), "models": st.get("models") or []}
        if _bridge["error"]:
            out["detail"] = f"{out['detail']} ({_bridge['error']})".strip()
        return out
    except Exception as e:
        return {"ok": False, "detail": f"Dify 상태 확인 실패: {type(e).__name__}: {e}", "busy": False}


def _model_and_tunnel(model_nodes, tunnel):
    """워커가 워크플로 그래프에서 읽은 모델 이름이 있으면 그 이름으로 모델 서버 목록을 대조한다.
    없으면(워커 준비 전) kernel_api의 기본 모델 이름 대조 결과를 그대로 쓴다."""
    names = sorted({m["model"] for m in model_nodes})
    if not names:
        return MODEL_NAME, tunnel
    if tunnel.get("connected"):
        have = set(tunnel.get("models") or [])
        missing = [n for n in names if n not in have]
        tunnel["model_available"] = not missing
        tunnel["ok"] = not missing
        tunnel["missing_models"] = missing
        tunnel["detail"] = (f"연결됨 · 모델 서버의 모델 {len(have)}개 · 워크플로 모델 {', '.join(names)} "
                            + ("확인" if not missing else f"목록에 없음({', '.join(missing)})"))
    return ", ".join(names), tunnel


class ApiError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


class Handler(BaseHTTPRequestHandler):
    server_version = "RobotAgentDashboard/1.0"
    timeout = SOCKET_TIMEOUT  # StreamRequestHandler.setup()이 연결 소켓에 settimeout으로 적용한다

    # ------------------------------------------------------------ 요청 출처 확인
    def _guard(self, method, path):
        """Host는 모든 요청에서, Origin·Sec-Fetch-Site는 상태를 바꾸거나 실행을 시작하는 요청에서 확인한다."""
        host = (self.headers.get("Host") or "").strip().lower()
        if host not in ALLOWED_HOSTS:
            raise ApiError(403, f"허용되지 않은 호스트 이름입니다({host or '없음'}). "
                                f"http://127.0.0.1:{PORT} 으로 접속하십시오.")
        starts_work = method == "POST" or path == "/viewer/stream" or bool(_ASK_EVENTS_RE.match(path))
        if not starts_work:
            return
        origin = self.headers.get("Origin")
        if origin is not None and origin.strip().lower() not in ALLOWED_ORIGINS:
            raise ApiError(403, "다른 웹사이트에서 보낸 요청은 받지 않습니다.")
        site = self.headers.get("Sec-Fetch-Site")
        if site is not None and site.strip().lower() not in ALLOWED_FETCH_SITES:
            raise ApiError(403, "다른 웹사이트에서 보낸 요청은 받지 않습니다.")
        if method == "POST":
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                raise ApiError(400, "Content-Length 값이 올바르지 않습니다.")
            ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if length > 0 and ctype != "application/json":
                raise ApiError(415, "요청 본문은 Content-Type: application/json 형식이어야 합니다.")

    # ------------------------------------------------------------ 공통 응답
    def _json(self, code, obj, extra_headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, code, message):
        self._json(code, {"error": message})

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ApiError(400, "Content-Length 값이 올바르지 않습니다.")
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ApiError(413, "요청 본문이 너무 큽니다(최대 64KB).")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ApiError(400, "요청 본문이 올바른 JSON이 아닙니다.")
        if not isinstance(data, dict):
            raise ApiError(400, "요청 본문은 JSON 객체여야 합니다.")
        return data

    def _dispatch(self, fn):
        try:
            self._guard(self.command, urllib.parse.urlparse(self.path).path)
            fn()
        except ApiError as e:
            self._safe_error(e.code, e.message)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, socket.timeout):
            pass
        except Exception as e:
            traceback.print_exc()
            self._safe_error(500, f"서버 내부 오류: {type(e).__name__}: {e}")

    def _safe_error(self, code, message):
        try:
            self._error(code, message)
        except Exception:
            pass

    # ------------------------------------------------------------ 메서드
    def do_GET(self):
        self._dispatch(self._get)

    def do_POST(self):
        self._dispatch(self._post)

    def do_HEAD(self):
        # 미리보기 도구·브라우저의 HEAD 확인용. 본문 없이 GET과 같은 머리글만 보낸다(_json·_static이 HEAD면 본문 생략).
        # 스트림 주소는 HEAD로 시뮬레이터 실행이나 질문 재생이 시작되지 않도록 막는다.
        self._dispatch(self._head)

    def _head(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/viewer/stream" or _ASK_EVENTS_RE.match(path):
            raise ApiError(405, "이 주소는 GET 요청만 받습니다.")
        return self._get()

    def _get(self):
        u = urllib.parse.urlparse(self.path)
        path = u.path
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        if path == "/" or path == "/index.html":
            return self._static("index.html")
        if path == "/favicon.ico":  # 아이콘은 index.html에 인라인 SVG로 들어 있다. 브라우저 자동 요청에는 빈 응답
            self.send_response(204)
            self.send_header("Cache-Control", "max-age=86400")
            self.end_headers()
            return
        if path.startswith("/api/"):
            return self._api_get(path, q)
        if path == "/viewer/stream":
            return self._mjpeg(q)
        if path.startswith("/static/"):
            return self._static(path[len("/static/"):])
        # index.html이 상대경로(style.css, img/hero.jpg)로 참조해도 동작하도록 static/ 에서 찾아 본다
        return self._static(path.lstrip("/"))

    def _api_get(self, path, q):
        if path == "/api/status":
            st = kernel_api.status()
            vs = viewer_core.stats()
            dify = _dify_status()
            model_nodes = [m for m in dify.pop("models", []) if isinstance(m, dict) and m.get("model")]
            model, tunnel = _model_and_tunnel(model_nodes, dict(st["tunnel"]))
            out = {"dify": dify, "tunnel": tunnel, "dify_container": st["dify_container"],
                   "model": model, "model_source": "workflow" if model_nodes else "default",
                   "model_nodes": model_nodes, "kernel": st["kernel"], "training": st["training"],
                   "viewer": {"status": vs["status"], "phase": vs.get("phase")}}
            return self._json(200, out)
        if path == "/api/runs":
            return self._json(200, {"runs": kernel_api.list_runs()})
        if path == "/api/datasets":
            return self._json(200, {"datasets": kernel_api.list_datasets()})
        if path == "/api/experiments":
            return self._json(200, {"experiments": kernel_api.list_experiments()})
        if path == "/api/viewer/checkpoints":
            return self._json(200, {"checkpoints": viewer_core.list_checkpoints()})
        if path == "/api/viewer/stats":
            return self._json(200, viewer_core.stats())
        if path == "/api/activity":
            return self._json(200, {"activity": activity.recent(100)})
        if path == "/api/asks":
            obj = self._require_bridge()
            return self._json(200, {"asks": obj.history(50)})
        m = _ASK_EVENTS_RE.match(path)
        if m:
            return self._sse(m.group(1))
        if path in ("/api/experiments", "/api/ask") or _EXP_ACTION_RE.match(path):
            raise ApiError(405, "이 주소는 POST 요청만 받습니다.")
        raise ApiError(404, f"없는 API 경로입니다: {path}")

    def _post(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/experiments":
            body = self._read_json_body()
            params = {k: body.get(k) for k in ("subset", "epochs", "seed")}
            source = body.get("source", "user")
            try:
                exp = kernel_api.propose_experiment(params, source=source)
            except ValueError as e:
                raise ApiError(400, str(e))
            return self._json(201, exp)
        m = _EXP_ACTION_RE.match(path)
        if m:
            exp_id, action = m.groups()
            fn = {"approve": kernel_api.approve_experiment, "reject": kernel_api.reject_experiment,
                  "cancel": kernel_api.cancel_experiment}[action]
            try:
                return self._json(200, fn(exp_id))
            except kernel_api.NotFoundError as e:
                raise ApiError(404, e.args[0] if e.args else "실험을 찾을 수 없습니다.")
            except kernel_api.ConflictError as e:
                raise ApiError(409, str(e))
            except ValueError as e:
                raise ApiError(400, str(e))
        if path == "/api/ask":
            return self._ask()
        if self._is_get_only(path) or _ASK_EVENTS_RE.match(path):
            raise ApiError(405, "이 주소는 GET 요청만 받습니다.")
        if path.startswith("/api/"):
            raise ApiError(404, f"없는 API 경로입니다: {path}")
        raise ApiError(405, "이 주소는 POST 요청을 받지 않습니다.")

    @staticmethod
    def _is_get_only(path):
        return path in ("/api/status", "/api/runs", "/api/datasets", "/api/viewer/checkpoints",
                        "/api/viewer/stats", "/api/activity", "/api/asks")

    # ------------------------------------------------------------ Dify 질문
    def _require_bridge(self):
        obj = _bridge["obj"]
        if obj is None:
            raise ApiError(503, _bridge["error"] or "Dify 연동 모듈을 쓸 수 없습니다.")
        return obj

    def _ask(self):
        body = self._read_json_body()
        query = body.get("query")
        if not isinstance(query, str) or not query.strip():
            raise ApiError(400, "질문(query)을 입력하세요.")
        query = query.strip()
        if len(query) > MAX_QUERY_LEN:
            raise ApiError(400, f"질문은 {MAX_QUERY_LEN}자 이내여야 합니다(현재 {len(query)}자).")
        obj = self._require_bridge()
        # 워커 준비·터널 연결 점검은 bridge.ask()가 매번 새로 한다(UnavailableError → 503)
        busy_cls = getattr(_bridge["mod"], "BusyError", None)
        try:
            ask_id = obj.ask(query)
        except Exception as e:
            if busy_cls is not None and isinstance(e, busy_cls):
                raise ApiError(409, str(e) or "에이전트가 다른 질문을 처리하는 중입니다.")
            if isinstance(e, ValueError):
                raise ApiError(400, str(e))
            raise ApiError(503, str(e) or f"질문을 시작하지 못했습니다: {type(e).__name__}")
        return self._json(202, {"id": ask_id})

    def _sse(self, ask_id):
        obj = self._require_bridge()
        try:
            gen = obj.events(ask_id, timeout=1.0)
            first = next(gen)
        except StopIteration:
            gen, first = None, None
        except KeyError:
            raise ApiError(404, f"질문 기록을 찾을 수 없습니다: {ask_id}")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            if first is not None:
                self._sse_write(first)
            if gen is not None:
                for ev in gen:
                    self._sse_write(ev)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, socket.timeout):
            pass  # 브라우저가 연결을 끊음
        finally:
            if gen is not None:
                gen.close()
        self.close_connection = True

    def _sse_write(self, ev):
        data = json.dumps(ev, ensure_ascii=False)
        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
        self.wfile.flush()

    # ------------------------------------------------------------ 로봇 뷰어
    def _mjpeg(self, q):
        ckpt = q.get("ckpt")
        if not ckpt:
            ckpts = viewer_core.list_checkpoints()
            if not ckpts:
                raise ApiError(404, "실행할 체크포인트가 없습니다(학습 기록 없음).")
            ckpt = ckpts[0]["id"]
        try:
            viewer_core.submit(ckpt, q.get("trials", "3"), q.get("seed", "0"))
        except ValueError as e:
            raise ApiError(400, str(e))
        except RuntimeError as e:
            raise ApiError(409, str(e))
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-cache, no-store")
        self.send_header("Pragma", "no-cache")
        self.end_headers()
        try:
            for data in viewer_core.frames(timeout=1.0):
                self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                 + str(len(data)).encode() + b"\r\n\r\n" + data + b"\r\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, socket.timeout):
            pass  # 화면을 닫아도 이번 실행은 끝까지 돈다(메인 스레드)
        self.close_connection = True

    # ------------------------------------------------------------ 정적 파일
    def _static(self, rel):
        rel = urllib.parse.unquote(rel)
        if not rel or "\x00" in rel:
            raise ApiError(404, "파일을 찾을 수 없습니다.")
        root = os.path.realpath(STATIC_DIR)
        full = os.path.realpath(os.path.join(root, rel))
        if not full.startswith(root + os.sep) or not os.path.isfile(full):
            if rel == "index.html":
                raise ApiError(404, "화면 파일(static/index.html)이 아직 없습니다.")
            raise ApiError(404, "파일을 찾을 수 없습니다.")
        ctype = CONTENT_TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def log_request(self, code="-", size="-"):
        try:
            if int(code) >= 400:
                super().log_request(code, size)
        except (TypeError, ValueError):
            pass

    def log_error(self, format, *args):
        # 소켓 시간 초과로 닫은 연결은 정상 처리이므로 서버 로그에 오류로 남기지 않는다
        if format.startswith("Request timed out"):
            return
        super().log_error(format, *args)


def main():
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError as e:
        print(f"포트 {PORT}을 열 수 없습니다(이미 다른 서버가 쓰는 중일 수 있음): {e}", file=sys.stderr, flush=True)
        sys.exit(1)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, name="http", daemon=True).start()
    print(f"로봇 데이터 에이전트 대시보드: http://{HOST}:{PORT}", flush=True)
    activity.log_activity("system", "대시보드 서버 시작", {"url": f"http://{HOST}:{PORT}", "pid": os.getpid()})
    threading.Thread(target=_init_bridge, name="dify-bridge-init", daemon=True).start()
    try:
        kernel_api.start()
    except Exception as e:
        traceback.print_exc()
        activity.log_activity("system", f"실험 관리 시작 오류: {type(e).__name__}: {e}", {})
    def _on_sigterm(signum, frame):
        raise KeyboardInterrupt  # 메인 스레드에서 아래 정리 코드로 빠져나간다

    signal.signal(signal.SIGTERM, _on_sigterm)
    try:
        viewer_core.main_loop()  # 메인 스레드: 시뮬레이터 전용, 반환하지 않음
    except KeyboardInterrupt:
        print("서버를 종료합니다.", flush=True)
    finally:
        # 학습 프로세스는 일부러 남긴다(별도 세션). 다시 시작하면 kernel_api.start()가 다시 추적한다.
        if _bridge["obj"] is not None and hasattr(_bridge["obj"], "stop"):
            try:
                _bridge["obj"].stop()
            except Exception:
                traceback.print_exc()
        server.shutdown()


if __name__ == "__main__":
    main()
