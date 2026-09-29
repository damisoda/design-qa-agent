"""학습된 로봇 정책을 브라우저에서 직접 실행해 보는 로컬 뷰어.

http://127.0.0.1:8770 — 시도 횟수·시드를 고르고 실행하면, 시뮬레이터가 한 스텝씩 돌면서
카메라 화면을 MJPEG로 실시간 전송한다. 성공 여부는 시뮬레이터(env.is_success)가 판정한다.
읽기 전용 데모: 학습·데이터 수정은 하지 않는다. 127.0.0.1에만 바인딩한다.
"""
import glob
import io
import queue
import json
import os
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "shims"))  # macOS: egl_probe 대체 모듈 (오프스크린 렌더링용)

import numpy as np
import torch
from PIL import Image

import robomimic.utils.file_utils as FileUtils
import robomimic.utils.torch_utils as TorchUtils

PORT = 8770
CAMERA = "agentview"
SIZE = 384
HORIZON = 400
MAX_TRIALS = 10

CKPTS = sorted(glob.glob(os.path.join(ROOT, "runs", "*", "*", "models", "*.pth")))
state = {"loaded": None, "policy": None, "env": None}
jobs = queue.Queue()                 # 웹 스레드 → 메인 스레드: (ckpt, trials, seed)
frame_cv = threading.Condition()      # 메인 스레드 → 웹 스레드: 최신 JPEG 프레임
latest = {"jpeg": None, "seq": 0}
stats = {"status": "대기", "trial": 0, "trials": 0, "step": 0, "success": 0, "done": 0, "history": []}


def load(ckpt):
    if state["loaded"] == ckpt:
        return
    stats["status"] = "모델·환경 불러오는 중"
    device = TorchUtils.get_torch_device(try_to_use_cuda=False)
    policy, ckpt_dict = FileUtils.policy_from_checkpoint(ckpt_path=ckpt, device=device, verbose=False)
    env, _ = FileUtils.env_from_checkpoint(ckpt_dict=ckpt_dict, render=False, render_offscreen=True, verbose=False)
    state.update(loaded=ckpt, policy=policy, env=env)


def jpeg(frame):
    buf = io.BytesIO()
    Image.fromarray(frame).save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def publish(frame):
    data = jpeg(frame)
    with frame_cv:
        latest["jpeg"], latest["seq"] = data, latest["seq"] + 1
        frame_cv.notify_all()


def run_trials(ckpt, trials, seed):
    """정책을 trials번 실행하며 프레임을 하나씩 내보낸다."""
    load(ckpt)
    policy, env = state["policy"], state["env"]
    np.random.seed(seed)
    torch.manual_seed(seed)
    stats.update(status="실행 중", trial=0, trials=trials, step=0, success=0, done=0, history=[])
    for t in range(1, trials + 1):
        stats.update(trial=t, step=0)
        policy.start_episode()
        obs = env.reset()
        obs = env.reset_to(env.get_state())
        ok = False
        for step in range(HORIZON):
            obs, _, done, _ = env.step(policy(ob=obs))
            stats["step"] = step + 1
            yield env.render(mode="rgb_array", height=SIZE, width=SIZE, camera_name=CAMERA)
            ok = bool(env.is_success()["task"])
            if ok or done:
                break
        stats["done"] = t
        stats["success"] += int(ok)
        stats["history"].append({"trial": t, "success": ok, "steps": stats["step"]})
        for _ in range(8):  # 결과 화면을 잠깐 유지
            yield env.render(mode="rgb_array", height=SIZE, width=SIZE, camera_name=CAMERA)
    stats["status"] = "완료"


def main_loop():
    """macOS는 그래픽(CGL) 컨텍스트를 메인 스레드에서만 허용하므로 시뮬레이션·렌더링은 여기서만 한다."""
    load(CKPTS[0])
    stats["status"] = "대기"
    while True:
        ckpt, trials, seed = jobs.get()
        try:
            for frame in run_trials(ckpt, trials, seed):
                publish(frame)
                time.sleep(0.02)
        except Exception as e:
            stats["status"] = f"오류: {type(e).__name__}: {e}"


PAGE = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>로봇 정책 뷰어</title>
<style>
:root{--bg:#fff;--fg:#111;--muted:#666;--line:#ddd;--ok:#111;--no:#999}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--muted:#aaa;--line:#333;--ok:#eee;--no:#666}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,system-ui,sans-serif}
h1{font-size:18px;margin:0 0 4px} p{margin:0 0 12px;color:var(--muted)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:12px}
label{display:flex;flex-direction:column;font-size:12px;color:var(--muted)}
select,input,button{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
button{cursor:pointer;font-weight:600} button:disabled{opacity:.5;cursor:default}
#view{width:100%;max-width:384px;aspect-ratio:1;border:1px solid var(--line);border-radius:8px;display:block;background:#000}
#stat{margin:10px 0;font-variant-numeric:tabular-nums}
#hist{display:flex;gap:4px;flex-wrap:wrap} .dot{width:22px;height:22px;border-radius:4px;border:1px solid var(--line);font-size:11px;display:flex;align-items:center;justify-content:center}
.s{background:var(--ok);color:var(--bg)} .f{background:transparent;color:var(--no)}
</style></head><body>
<h1>큐브 들기 — 학습한 로봇 직접 실행</h1>
<p>실행을 누르면 시뮬레이터에서 로봇이 실제로 움직입니다. 성공 판정은 시뮬레이터가 합니다.</p>
<div class="row">
<label>모델<select id="ckpt">__OPTIONS__</select></label>
<label>시도 횟수<input id="trials" type="number" min="1" max="__MAX__" value="3" style="width:70px"></label>
<label>시드(큐브 배치)<input id="seed" type="number" value="0" style="width:80px"></label>
<button id="go">실행</button>
</div>
<img id="view" alt="시뮬레이터 화면">
<div id="stat">대기 중</div>
<div id="hist"></div>
<script>
const $=id=>document.getElementById(id);let timer=null;
$('go').onclick=()=>{
  const q=new URLSearchParams({ckpt:$('ckpt').value,trials:$('trials').value,seed:$('seed').value,t:Date.now()});
  $('view').src='/stream?'+q; $('go').disabled=true; clearInterval(timer); timer=setInterval(poll,300);
};
async function poll(){
  try{const s=await (await fetch('/stats')).json();
    $('stat').textContent=`${s.status} · ${s.trial}/${s.trials}번째 시도 · ${s.step}스텝 · 성공 ${s.success}/${s.done}`;
    $('hist').innerHTML=s.history.map(h=>`<div class="dot ${h.success?'s':'f'}" title="${h.steps}스텝">${h.success?'O':'X'}</div>`).join('');
    if(s.status==='완료'||s.status.startsWith('오류')){clearInterval(timer);$('go').disabled=false;}
  }catch(e){}
}
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        if u.path == "/":
            opts = "".join(f'<option value="{i}">{os.path.relpath(c, os.path.join(ROOT, "runs"))}</option>' for i, c in enumerate(CKPTS))
            body = PAGE.replace("__OPTIONS__", opts).replace("__MAX__", str(MAX_TRIALS)).encode()
            self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers(); self.wfile.write(body)
        elif u.path == "/stats":
            body = json.dumps(stats, ensure_ascii=False).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
        elif u.path == "/stream":
            try:
                ckpt = CKPTS[int(q.get("ckpt", 0))]
                trials = max(1, min(MAX_TRIALS, int(q.get("trials", 3))))
                seed = int(q.get("seed", 0))
            except (ValueError, IndexError):
                self.send_error(400, "잘못된 입력"); return
            if stats["status"] in ("실행 중", "모델·환경 불러오는 중") or not jobs.empty():
                self.send_error(409, "이미 실행 중"); return
            stats["status"] = "실행 중"
            jobs.put((ckpt, trials, seed))
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            seen = latest["seq"]
            try:
                while True:
                    with frame_cv:
                        frame_cv.wait_for(lambda: latest["seq"] != seen, timeout=1.0)
                        data, seen = latest["jpeg"], latest["seq"]
                    if data:
                        self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(data)).encode() + b"\r\n\r\n" + data + b"\r\n")
                    if stats["status"] == "완료" or stats["status"].startswith("오류"):
                        break
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            self.send_error(404)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print(f"로봇 정책 뷰어: http://127.0.0.1:{PORT} (체크포인트 {len(CKPTS)}개)", flush=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    main_loop()
