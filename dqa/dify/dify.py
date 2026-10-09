"""dqa를 Dify에 잇는 얇은 앱(수업 연속성용). 측정·판정은 dqa가 하고, Dify는 입력을 받아 dqa_check를 부르고 요약을 보여 준다.
api 컨테이너 안에서 Dify 서비스 함수를 직접 호출한다(API 키 불필요, w4/dify/register_api_tool.py·dify_run_workflow.py와 같은 방식).
사용:
  python3 dify.py register            # dqa serve의 /openapi.json으로 사용자 정의 API 도구 'dqa' 등록(이미 있으면 그대로) → provider_id
  python3 dify.py dsl <provider_id>    # dqa_check 워크플로 DSL을 dqa/dify/dqa-check.dsl.yml로 쓴다(이어서 ../../dify_import.py로 가져온다)
  python3 dify.py run <app_id> <dist> [<base_dist>] [<recipe>]   # 실행하고 결과 JSON 출력
전제: dqa serve가 127.0.0.1:8792에 떠 있고, Dify SSRF 프록시가 host.docker.internal을 허용한다(4주차 설정).
"""
import json, subprocess, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REF_APP = "17663f9b-4639-4cba-9273-73f5e7aaeced"  # 같은 테넌트·계정 기준으로 쓰는 기존 앱


def in_container(script):
    r = subprocess.run(["docker", "exec", "-i", "docker-api-1", "bash", "-c", "cd /app/api && python -"], input=script, text=True, capture_output=True)
    if "@@" not in r.stdout:
        raise SystemExit(r.stdout[-1500:] + r.stderr[-2500:])
    return json.loads(r.stdout.split("@@")[-1])


def register():
    schema = urllib.request.urlopen("http://127.0.0.1:8792/openapi.json", timeout=5).read().decode()
    inner = r'''
import contextlib, io, json
SCHEMA = __SCHEMA__
with contextlib.redirect_stdout(io.StringIO()):
    from app import app
    from extensions.ext_database import db
    from models import App, Account
    from models.tools import ApiToolProvider
    from services.tools.api_tools_manage_service import ApiToolManageService
    from core.tools.entities.tool_entities import ApiProviderSchemaType
    from sqlalchemy import select
with app.app_context():
    ref = db.session.get(App, "__REF__")
    account = db.session.get(Account, ref.created_by); account.set_tenant_id(ref.tenant_id)
    q = select(ApiToolProvider).where(ApiToolProvider.tenant_id == ref.tenant_id, ApiToolProvider.name == "dqa")
    if db.session.scalar(q) is not None:
        ApiToolManageService.update_api_tool_provider(
            user_id=account.id, tenant_id=ref.tenant_id, provider_name="dqa", original_provider="dqa",
            icon={"content": "📐", "background": "#EFF1F5"}, credentials={"auth_type": "none"},
            _schema_type=ApiProviderSchemaType.OPENAPI, schema=SCHEMA,
            privacy_policy="", custom_disclaimer="로컬 dqa 서버(측정·보고·수정 검증)", labels=[])
    else:
        ApiToolManageService.create_api_tool_provider(
            user_id=account.id, tenant_id=ref.tenant_id, provider_name="dqa",
            icon={"content": "📐", "background": "#EFF1F5"}, credentials={"auth_type": "none"},
            schema_type=ApiProviderSchemaType.OPENAPI, schema=SCHEMA,
            privacy_policy="", custom_disclaimer="로컬 dqa 서버(측정·보고 전용)", labels=[])
    p = db.session.scalar(q)
    print("@@" + json.dumps({"provider_id": p.id, "tools": [t["operation_id"] for t in json.loads(p.tools_str)] if p.tools_str else None}))
'''.replace("__SCHEMA__", repr(schema)).replace("__REF__", REF_APP)
    print(json.dumps(in_container(inner), ensure_ascii=False))


FORMAT_CODE = '''import json

def main(text: str) -> dict:
    try:
        r = json.loads(text)
    except Exception:
        return {"result": "dqa 응답을 읽지 못했다: " + str(text)[:300]}
    if not r.get("ok"):
        return {"result": "검사 실패(" + str(r.get("error_type")) + "): " + str(r.get("message"))}
    s = r.get("summary", {})
    names = {"new": "새로 생김", "worsened": "악화", "unchanged": "기존", "improved": "줄어듦", "none": "상태 없음", "accepted": "무시"}
    lines = ["새로 생김 %d · 악화 %d · 기존 %d · 상태 없음 %d · 해결 %d (%.1f초)" % (s.get("new", 0), s.get("worsened", 0), s.get("unchanged", 0) + s.get("improved", 0), s.get("no_base", 0), s.get("resolved", 0), r.get("total_sec", 0))]
    for d in r.get("defects", []):
        sizes = ", ".join("%s %s" % (w["size"], w["px"]) for w in d.get("widths", []))
        lines.append("- [%s %s] %s: %s / %s%s" % (names.get(d.get("status"), d.get("status")), d.get("rule"), d.get("rule_name"), ", ".join(d.get("labels", [])), sizes, (" / 원인 후보 " + d["cause"]) if d.get("cause") else ""))
    lines.append("보고서: " + str(r.get("report_url")))
    return {"result": "\\n".join(lines)}
'''


def dsl(provider_id):
    dists = ["cbh-221-pre", "cbh-221-post"]
    recipes = ["cbh/report", "cbh/guardian_home"]
    node = lambda nid, data, x: {"id": nid, "type": "custom", "data": data, "position": {"x": x, "y": 200}, "positionAbsolute": {"x": x, "y": 200}, "width": 244, "height": 90, "selected": False, "sourcePosition": "right", "targetPosition": "left"}
    edge = lambda s, t, st, tt: {"id": f"{s}-{t}", "source": s, "target": t, "sourceHandle": "source", "targetHandle": "target", "type": "custom", "data": {"sourceType": st, "targetType": tt, "isInIteration": False}, "zIndex": 0}
    nodes = [
        node("start", {"type": "start", "title": "시작", "variables": [
            {"variable": "dist", "label": "검사할 빌드", "type": "select", "required": True, "options": dists},
            {"variable": "base_dist", "label": "비교 기준(변경 전, 선택)", "type": "select", "required": False, "options": dists},
            {"variable": "recipe", "label": "화면", "type": "select", "required": True, "options": recipes}]}, 0),
        node("dqa", {"type": "tool", "title": "dqa 검사(측정·비교·원인)", "provider_id": provider_id, "provider_name": "dqa", "provider_type": "api",
                     "tool_name": "dqa_check", "tool_label": "dqa_check", "tool_description": "빌드를 여러 크기로 열어 재고 결함 요약을 돌려준다",
                     "tool_configurations": {}, "is_team_authorization": True,
                     "tool_parameters": {"dist": {"type": "mixed", "value": "{{#start.dist#}}"}, "base_dist": {"type": "mixed", "value": "{{#start.base_dist#}}"}, "recipe": {"type": "mixed", "value": "{{#start.recipe#}}"}}}, 320),
        node("fmt", {"type": "code", "title": "요약 만들기", "code_language": "python3", "code": FORMAT_CODE,
                     "variables": [{"variable": "text", "value_selector": ["dqa", "text"]}], "outputs": {"result": {"type": "string", "children": None}}}, 640),
        node("end", {"type": "end", "title": "끝", "outputs": [{"variable": "summary", "value_selector": ["fmt", "result"]}]}, 960)]
    edges = [edge("start", "dqa", "start", "tool"), edge("dqa", "fmt", "tool", "code"), edge("fmt", "end", "code", "end")]
    doc = {"app": {"name": "dqa · 디자인 검수(로컬 도구 호출)", "mode": "workflow", "icon": "📐", "icon_background": "#EFF1F5", "icon_type": "emoji", "use_icon_as_answer_icon": False,
                   "description": "빌드와 화면을 고르면 로컬 dqa가 여러 크기로 재고 변경 전과 비교한 결함 요약을 돌려준다. LLM 없이 수십 초."},
           "kind": "app", "version": "0.7.0",
           "workflow": {"conversation_variables": [], "environment_variables": [], "features": {}, "graph": {"nodes": nodes, "edges": edges, "viewport": {"x": 0, "y": 0, "zoom": 1}}}}
    import yaml
    out = HERE / "dqa-check.dsl.yml"
    out.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False))
    print(out)


ACT_FORMAT = '''import json

def main(text: str) -> dict:
    try:
        r = json.loads(text)
    except Exception:
        return {"result": "dqa 응답을 읽지 못했다: " + str(text)[:300]}
    if not r.get("ok"):
        return {"result": "실패(" + str(r.get("error_type")) + "): " + str(r.get("message"))}
    L = ["실행 " + str(r.get("run_id")) + (" (진행 중)" if r.get("running") else "")]
    if r.get("note"):
        L.append(r["note"])
    c = r.get("check")
    if c:
        s = c.get("summary", {})
        L.append("검사: 새로 생김 %d · 악화 %d · 상태 없음 %d · 해결 %d" % (s.get("new", 0), s.get("worsened", 0), s.get("no_base", 0), s.get("resolved", 0)))
        for d in c.get("defects", [])[:6]:
            L.append("- [%s] %s %s: %s%s" % (d.get("status"), d.get("rule"), d.get("rule_name"), ", ".join(d.get("labels", [])), (" / 원인 후보 " + d["cause"]) if d.get("cause") else ""))
    f = r.get("fix")
    if f and f.get("summary"):
        s = f["summary"]
        L.append("수정: 대상 %d건 중 검증된 수정 %d건, 함께 적용 시 %d건 사라짐" % (s.get("targets", 0), s.get("verified", 0), s.get("combined_fixed", 0)))
    p = r.get("pr")
    if p:
        L.append("PR: %s → %s, 커밋 %s, 검사 %s, %s" % (p.get("branch"), p.get("base"), str(p.get("commit"))[:8], ", ".join(("통과" if k.get("ok") else "실패") + " " + k.get("name", "") for k in p.get("checks", [])), ("올림 " + str(p.get("url"))) if p.get("pushed") else "올리지 않음"))
    L.append("자세히: " + str(r.get("view_url")))
    return {"result": "\\n".join(L)}
'''


def dsl_act(provider_id):
    node = lambda nid, data, x: {"id": nid, "type": "custom", "data": data, "position": {"x": x, "y": 200}, "positionAbsolute": {"x": x, "y": 200}, "width": 244, "height": 90, "selected": False, "sourcePosition": "right", "targetPosition": "left"}
    edge = lambda s, t, st, tt: {"id": f"{s}-{t}", "source": s, "target": t, "sourceHandle": "source", "targetHandle": "target", "type": "custom", "data": {"sourceType": st, "targetType": tt, "isInIteration": False}, "zIndex": 0}
    v = lambda name, label, typ="text-input", req=False, options=None: {"variable": name, "label": label, "type": typ, "required": req, "max_length": 80, "options": options or []}
    nodes = [
        node("start", {"type": "start", "title": "시작", "variables": [
            v("action", "작업", "select", True, ["검사", "상태", "수정 시작", "PR 준비", "PR 올리기"]),
            v("ref", "검사: 브랜치나 커밋(돌아오길)"), v("base", "검사: 비교 기준 브랜치나 커밋(선택)"),
            v("recipe", "검사: 화면", "select", False, ["cbh/report", "cbh/guardian_home"]),
            v("run_id", "상태·수정·PR: 실행 ID"), v("onto", "PR: 향할 브랜치(선택)"),
            v("confirm", "PR 올리기: 확인 문구(PR 올리기)")]}, 0),
        node("dqa", {"type": "tool", "title": "dqa 작업(보고서·코드 에이전트)", "provider_id": provider_id, "provider_name": "dqa", "provider_type": "api",
                     "tool_name": "dqa_act", "tool_label": "dqa_act", "tool_description": "사람이 고른 작업을 dqa에 시킨다",
                     "tool_configurations": {}, "is_team_authorization": True,
                     "tool_parameters": {k: {"type": "mixed", "value": "{{#start.%s#}}" % k} for k in ["action", "ref", "base", "recipe", "run_id", "onto", "confirm"]}}, 320),
        node("fmt", {"type": "code", "title": "결과 정리", "code_language": "python3", "code": ACT_FORMAT,
                     "variables": [{"variable": "text", "value_selector": ["dqa", "text"]}], "outputs": {"result": {"type": "string", "children": None}}}, 640),
        node("end", {"type": "end", "title": "끝", "outputs": [{"variable": "result", "value_selector": ["fmt", "result"]}]}, 960)]
    edges = [edge("start", "dqa", "start", "tool"), edge("dqa", "fmt", "tool", "code"), edge("fmt", "end", "code", "end")]
    doc = {"app": {"name": "dqa · 검사→문제 정의→수정→PR", "mode": "workflow", "icon": "🛠️", "icon_background": "#EFF1F5", "icon_type": "emoji", "use_icon_as_answer_icon": False,
                   "description": "작업을 고르면 dqa가 검사(보고서 에이전트의 문제 정의), 수정(코드 에이전트, 재측정 검증), PR 준비·올리기(확인 문구 필요)를 한다. 작업 순서는 사람이 고른다."},
           "kind": "app", "version": "0.7.0",
           "workflow": {"conversation_variables": [], "environment_variables": [], "features": {}, "graph": {"nodes": nodes, "edges": edges, "viewport": {"x": 0, "y": 0, "zoom": 1}}}}
    import yaml
    out = HERE / "dqa-act.dsl.yml"
    out.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False))
    print(out)


def run(app_id, inputs):
    inner = r'''
import contextlib, io, json, time
with contextlib.redirect_stdout(io.StringIO()):
    from app import app
    from extensions.ext_database import db
    from models import App, Account
    from services.app_generate_service import AppGenerateService
    from core.app.entities.app_invoke_entities import InvokeFrom
    from sqlalchemy.orm import Session
with app.app_context():
    a = db.session.get(App, __APP__)
    acc = db.session.get(Account, a.created_by); acc.set_tenant_id(a.tenant_id)
    t0 = time.monotonic()
    with Session(db.engine) as s:
        res = AppGenerateService.generate(app_model=a, user=acc, args={"inputs": __INPUTS__, "files": []}, invoke_from=InvokeFrom.SERVICE_API, session=s, streaming=False)
        s.commit()
    res = dict(res) if not isinstance(res, dict) else res
    data = res.get("data", res)
    print("@@" + json.dumps({"sec": round(time.monotonic() - t0, 1), "status": data.get("status"), "outputs": data.get("outputs"), "error": data.get("error")}, ensure_ascii=False, default=str))
'''.replace("__APP__", repr(app_id)).replace("__INPUTS__", repr(inputs))
    print(json.dumps(in_container(inner), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "register":
        register()
    elif cmd == "dsl":
        dsl(sys.argv[2])
    elif cmd == "dsl-act":
        dsl_act(sys.argv[2])
    elif cmd == "act":
        a = dict(x.split("=", 1) for x in sys.argv[3:])
        run(sys.argv[2], a)
    elif cmd == "run":
        a = sys.argv[2:]
        run(a[0], {"dist": a[1], "base_dist": a[2] if len(a) > 2 else "", "recipe": a[3] if len(a) > 3 else "cbh/report"})
