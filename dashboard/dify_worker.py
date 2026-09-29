"""Dify api 컨테이너(docker-api-1) 안에서 상주하는 대시보드 워커.

실행: docker exec -i docker-api-1 bash -c "cd /app/api && python -u /tmp/dashboard_worker.py"
(dify_bridge.py가 이 파일을 docker cp로 /tmp/dashboard_worker.py에 복사한 뒤 위 명령으로 띄운다.)

- Flask 앱(Dify api)을 한 번만 불러온다(약 20초). 이후 질문마다 다시 불러오지 않는다.
- 표준입력: 한 줄에 JSON 작업 하나. {"id": "<ask_id>", "query": "<질문>"} 또는 {"cmd": "ping"}.
- 표준출력: 한 줄에 이벤트 하나. 줄 앞에 '@@EV '를 붙인다(라이브러리가 표준출력에 찍는 잡음과 구분).
- 게시된 에이전트 워크플로를 WorkflowAppGenerator().generate(streaming=True)로 실행하고,
  Dify 스트림 이벤트를 대시보드 계약(CONTRACT.md 4장 SSE 이벤트)의 형식으로 바꿔 내보낸다.
  도구 호출은 원문 응답을 그대로 'tool_call_raw'로 보내고, 요약·성공 판정은 dify_bridge.py가 한다
  (4주차 기록 파일과 같은 규칙을 한곳에서 쓰기 위해).
- 표준입력이 닫히면(대시보드 종료) 스스로 끝난다.
"""
import json
import os
import sys
import time
import traceback

MARK = "@@EV "
APP_ID = "23fc6b34-db8c-4a5e-8bc9-7009d46007ea"

_OUT = sys.stdout.buffer          # 이벤트 전용 통로
sys.stdout = sys.stderr           # 라이브러리 print는 표준오류로 보낸다


def emit(ev):
    line = MARK + json.dumps(ev, ensure_ascii=True, default=str) + "\n"
    _OUT.write(line.encode("ascii"))
    _OUT.flush()


def _clip(text, n=500):
    text = str(text)
    return text if len(text) <= n else text[: n - 1] + "…"


sys.path.insert(0, "/app/api")
try:
    from app import app
    from extensions.ext_database import db
    from models import App, Account
    from models.workflow import Workflow
    from core.app.apps.workflow.app_generator import WorkflowAppGenerator
    from core.app.entities.app_invoke_entities import InvokeFrom
except Exception as e:  # noqa: BLE001 - 어떤 이유든 준비 실패를 알리고 끝낸다
    traceback.print_exc()
    emit({"type": "fatal", "message": _clip(f"Dify 앱을 불러오지 못했습니다: {type(e).__name__}: {e}")})
    sys.exit(2)


def _load_app():
    a = db.session.get(App, APP_ID)
    if a is None:
        raise RuntimeError(f"에이전트 앱({APP_ID})을 Dify에서 찾을 수 없습니다")
    if not a.workflow_id:
        raise RuntimeError("에이전트 앱에 게시된 워크플로가 없습니다")
    acc = db.session.get(Account, a.created_by)
    acc.set_tenant_id(a.tenant_id)
    wf = db.session.get(Workflow, a.workflow_id)
    if wf is None:
        raise RuntimeError(f"워크플로({a.workflow_id})를 찾을 수 없습니다")
    return a, acc, wf


def run_job(ask_id, query):
    def ev(d):
        d["ask_id"] = ask_id
        emit(d)

    t0 = time.monotonic()
    rounds = {}          # agent_log ROUND 항목 id -> 회차 번호
    sent_calls = set()   # 이미 보낸 tool_call_id (CALL 항목과 ROUND 항목이 같은 호출을 두 번 담는다)
    run_id = None
    finished = False

    def send_call(n, out, error=None):
        cid = out.get("tool_call_id")
        if cid and cid in sent_calls:
            return
        if cid:
            sent_calls.add(cid)
        ev({"type": "tool_call_raw", "round": n, "tool": out.get("tool_call_name"),
            "input": out.get("tool_call_input"), "tool_call_id": cid,
            "response": out.get("tool_response"), "error": error})

    try:
        with app.app_context():
            a, acc, wf = _load_app()
            gen = WorkflowAppGenerator().generate(
                app_model=a, workflow=wf, user=acc, args={"inputs": {"query": query}},
                invoke_from=InvokeFrom.DEBUGGER, streaming=True, call_depth=0)
            for ch in gen:
                if not isinstance(ch, dict):   # "ping" 문자열
                    continue
                kind = ch.get("event")
                d = ch.get("data") or {}
                if kind == "workflow_started":
                    run_id = ch.get("workflow_run_id") or d.get("id")
                    ev({"type": "status", "message": "워크플로 실행을 시작했습니다", "run_id": run_id})
                elif kind == "node_started":
                    ev({"type": "node_started", "node_id": d.get("node_id"), "title": d.get("title"),
                        "node_type": d.get("node_type")})
                elif kind == "node_finished":
                    el = d.get("elapsed_time")
                    ev({"type": "node_finished", "node_id": d.get("node_id"), "title": d.get("title"),
                        "node_type": d.get("node_type"), "status": d.get("status"),
                        "elapsed": round(el, 2) if isinstance(el, (int, float)) else None,
                        "error": d.get("error")})
                elif kind == "agent_log":
                    label = str(d.get("label") or "")
                    st = d.get("status")
                    data = d.get("data") or {}
                    if label.startswith("ROUND "):
                        try:
                            n = int(label.split()[1])
                        except (IndexError, ValueError):
                            n = None
                        rounds[d.get("id")] = n
                        if st == "start":
                            ev({"type": "status", "message": f"에이전트 {n}회차 판단을 시작했습니다"})
                        else:
                            out = data.get("output") if isinstance(data.get("output"), dict) else {}
                            for tr in out.get("tool_responses") or []:
                                if isinstance(tr, dict):
                                    send_call(n, tr)
                    elif label.startswith("CALL "):
                        tool = label[5:]
                        n = rounds.get(d.get("parent_id"))
                        if st == "start":
                            ev({"type": "status", "message": f"도구 호출 중: {tool}"})
                        else:
                            out = data.get("output") if isinstance(data.get("output"), dict) else {}
                            if not out.get("tool_call_name"):
                                out = dict(out, tool_call_name=tool)
                            send_call(n, out, error=d.get("error"))
                    # 모델 'Thought' 항목은 도구 입력 예고뿐이라 따로 보내지 않는다(CALL 항목에 실제 호출이 있다)
                elif kind == "text_chunk":
                    text = d.get("text")
                    if text:
                        sel = d.get("from_variable_selector") or []
                        ev({"type": "text", "node_id": sel[0] if sel else None, "chunk": text})
                elif kind == "error":
                    finished = True
                    ev({"type": "error", "message": _clip(f"Dify 오류({ch.get('code')}): {ch.get('message')}")})
                elif kind == "workflow_paused":
                    finished = True
                    ev({"type": "error", "message": "워크플로가 사람 입력을 기다리며 멈췄습니다. 대시보드는 이 단계를 지원하지 않습니다."})
                elif kind == "workflow_finished":
                    finished = True
                    status = d.get("status")
                    outputs = d.get("outputs") or {}
                    if status in ("succeeded", "partial-succeeded"):
                        ev({"type": "final",
                            "with_tools": (outputs.get("with_tools") or "").strip() or None,
                            "without_tools": (outputs.get("without_tools") or "").strip() or None,
                            "elapsed_sec": round(time.monotonic() - t0, 1),
                            "run_id": run_id or d.get("id"),
                            "workflow_status": status,
                            "total_tokens": d.get("total_tokens")})
                    else:
                        ev({"type": "error",
                            "message": _clip(f"워크플로 실행 실패(상태 {status}): {d.get('error')}")})
    except Exception as e:  # noqa: BLE001 - 워커는 살아 있고 이번 질문만 실패로 알린다
        traceback.print_exc()
        if not finished:
            finished = True
            ev({"type": "error", "message": _clip(f"Dify 실행 중 예외: {type(e).__name__}: {e}")})
    if not finished:
        ev({"type": "error", "message": "워크플로가 완료 이벤트 없이 끝났습니다"})


def _graph_models(wf):
    """게시된 워크플로 그래프에서 노드별 모델 이름을 읽는다. 형식을 모르면 빈 목록(추측하지 않음).
    llm 노드: data.model.name / agent 노드: data.agent_parameters.model.value.model"""
    try:
        graph = getattr(wf, "graph_dict", None) or json.loads(wf.graph or "{}")
        out = []
        for n in graph.get("nodes") or []:
            d = n.get("data") or {}
            kind = d.get("type")
            name = None
            if kind == "llm":
                name = (d.get("model") or {}).get("name")
            elif kind == "agent":
                model = ((d.get("agent_parameters") or {}).get("model") or {}).get("value") or {}
                name = model.get("model") if isinstance(model, dict) else None
            if isinstance(name, str) and name:
                out.append({"node": n.get("id"), "title": d.get("title"), "type": kind, "model": name})
        return out
    except Exception:  # noqa: BLE001 - 모델 이름은 보조 정보라 실패해도 워커는 계속 준비한다
        traceback.print_exc()
        return []


def main():
    try:
        with app.app_context():
            a, _, wf = _load_app()
            info = {"app_name": a.name, "workflow_id": wf.id, "models": _graph_models(wf)}
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        emit({"type": "fatal", "message": _clip(f"에이전트 앱 확인 실패: {type(e).__name__}: {e}")})
        sys.exit(3)
    emit({"type": "ready", "pid": os.getpid(), "python": sys.version.split()[0], **info})
    for raw in sys.stdin.buffer:
        line = raw.decode("utf-8", "replace").strip()
        if not line:
            continue
        try:
            job = json.loads(line)
        except ValueError:
            continue
        if job.get("cmd") == "ping":
            emit({"type": "pong"})
            continue
        ask_id, query = job.get("id"), job.get("query")
        if not ask_id or not isinstance(query, str) or not query.strip():
            continue
        run_job(ask_id, query)


if __name__ == "__main__":
    main()
