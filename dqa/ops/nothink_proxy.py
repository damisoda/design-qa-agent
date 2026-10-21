"""생각하기 끔 중계기(127.0.0.1:18435 → Ollama 터널 127.0.0.1:18434). 6주차 bench/nothink_proxy.py를 옮겨 왔다(10-12).
dqa up이 터널과 함께 띄운다. Dify 작업 앱의 보고서 에이전트(LLM 노드, 모델 gemma4:e4b-16k-nothink)가 이 중계기를 거친다.
Dify의 OpenAI 호환 플러그인(0.0.68)은 생각하기를 끄는 값을 Ollama에 보내지 못한다. 그래서 모델 이름이 '-nothink'로 끝나는
/v1/chat/completions 요청에만 "reasoning_effort": "none"을 붙여 넘긴다. 나머지는 손대지 않고 그대로 중계한다(스트리밍 포함).
요청마다 모델 이름과 주입 여부를 runs/proxy_log.jsonl에 남긴다.
사용: python3 dqa/ops/nothink_proxy.py (보통은 node dqa/cli.js up)
"""
import http.client, http.server, json, socketserver, time
from pathlib import Path

UP = ("127.0.0.1", 18434)
LOG = Path(__file__).resolve().parents[1] / "runs" / "proxy_log.jsonl"  # dqa/runs(저장소에 올리지 않음)
LOG.parent.mkdir(exist_ok=True)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _relay(self, method):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else None
        injected, model = False, None
        if method == "POST" and self.path.startswith("/v1/chat/completions") and body:
            try:
                d = json.loads(body)
                model = d.get("model")
                if str(model or "").endswith("-nothink"):
                    d["reasoning_effort"] = "none"
                    body = json.dumps(d).encode()
                    injected = True
            except ValueError:
                pass
        headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "content-length", "connection", "accept-encoding")}
        if body is not None:
            headers["Content-Length"] = str(len(body))
        up = http.client.HTTPConnection(*UP, timeout=1200)
        t0 = time.time()
        up.request(method, self.path, body=body, headers=headers)
        r = up.getresponse()
        self.send_response(r.status)
        for k, v in r.getheaders():
            if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                self.send_header(k, v)
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        while True:
            chunk = r.read1(65536)
            if not chunk:
                break
            self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
            self.wfile.flush()
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()
        up.close()
        if method == "POST":
            with LOG.open("a") as f:
                f.write(json.dumps({"t": time.strftime("%H:%M:%S"), "path": self.path, "model": model, "injected": injected,
                                    "status": r.status, "sec": round(time.time() - t0, 1)}, ensure_ascii=False) + "\n")

    def do_GET(self):
        self._relay("GET")

    def do_POST(self):
        self._relay("POST")

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    Server(("127.0.0.1", 18435), Handler).serve_forever()
