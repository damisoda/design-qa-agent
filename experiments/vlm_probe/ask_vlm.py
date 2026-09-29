"""VLM 실패 진단 시험 2단계: 장면 6장 이미지만 gemma4에 보여 주고(정답 비공개) 성공 여부와 원인 가설을 JSON으로 받는다.
조건 B는 도구가 만든 수치 요약(집게 명령 구간·큐브 높이)을 함께 준다."""
import base64, json, os, sys, time, urllib.request
MODEL = "gemma4:e4b-16k"; URL = "http://127.0.0.1:18434/api/chat"
EP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "episodes")
PROMPT = """이미지는 로봇팔 시뮬레이션에서 한 번의 시도를 시간 순서대로 찍은 장면 6장이다. 각 장 왼쪽 위에 순번과 step(시간)이 적혀 있다.
과제: 로봇이 탁자 위의 빨간 큐브를 집게로 집어서 들어 올리면 성공이다.
질문:
1) 이 시도는 성공했는가, 실패했는가?
2) 각 장면에서 무슨 일이 보이는지 한 줄씩 쓰라.
3) 실패라면 가장 그럴듯한 원인 가설을 1~2개 쓰고, 근거가 된 장면 번호를 적으라.
이미지에서 보이지 않는 것은 추측하지 말고 "확인 불가"라고 쓰라.
JSON으로만 답하라: {"verdict": "success" 또는 "failure", "per_frame": ["1: ...", ...], "hypotheses": [{"cause": "...", "evidence_frames": [번호]}], "confidence": 0~1}"""

def ask(img_path, extra=""):
    b64 = base64.b64encode(open(img_path, "rb").read()).decode()
    body = {"model": MODEL, "stream": False, "think": False, "format": "json",
            "options": {"temperature": 0, "num_predict": 1200},
            "messages": [{"role": "user", "content": PROMPT + extra, "images": [b64]}]}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    t = time.time()
    r = json.loads(urllib.request.urlopen(req, timeout=600).read())
    return round(time.time() - t, 1), r["message"].get("content", ""), r.get("eval_count"), r.get("prompt_eval_count")

results = {}
for name in ["seed00_fail", "seed18_fail", "seed01_success"]:
    img = os.path.join(EP, name + ".jpg")
    sec, content, n_out, n_in = ask(img)
    results[name] = {"condition": "A_image_only", "sec": sec, "tokens_in": n_in, "tokens_out": n_out, "raw": content}
    print(f"== {name} [A 이미지만] {sec}s in={n_in} out={n_out}\n{content}\n", flush=True)
for name, seed in [("seed00_fail", 0), ("seed18_fail", 18)]:
    s = json.load(open(os.path.join(EP, f"gt_seed{seed:02d}.json")))["summary"]
    tool = {"집게_닫기_명령_구간(step)": [[c["from"], c["to"]] for c in s["close_segments"]],
            "닫기_시작_때_손과_큐브_거리_cm": [c["dist_cm_at_start"] for c in s["close_segments"]],
            "큐브_최대_들림_cm": s["max_lift_cm"], "마지막_큐브_높이_cm": s["final_lift_cm"]}
    extra = "\n\n[분석 도구의 수치 요약] " + json.dumps(tool, ensure_ascii=False) + "\n(성공하려면 큐브가 약 4cm 이상 들려야 한다. 성공한 다른 시도에서는 손과 큐브 거리 0.6cm에서 닫았다.)"
    sec, content, n_out, n_in = ask(os.path.join(EP, name + ".jpg"), extra)
    results[name + "_B"] = {"condition": "B_image_plus_numbers", "tool_summary": tool, "sec": sec, "tokens_in": n_in, "tokens_out": n_out, "raw": content}
    print(f"== {name} [B 이미지+수치] {sec}s\n{content}\n", flush=True)
json.dump(results, open(os.path.join(os.path.dirname(EP), "vlm_results.json"), "w"), ensure_ascii=False, indent=2)
