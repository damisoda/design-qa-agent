"""호스트에서 실행: DSL 파일을 로컬 Dify에 가져와 게시한다. 도구 명세를 주면 워크플로 도구로도 등록한다.
4주차_도구/dify/import_workflow_tool.py와 같은 방식(api 컨테이너 안에서 Dify 서비스 함수를 직접 호출, API 키 불필요).
사용: python3 dify_import.py <dsl 파일> [<도구 명세 JSON 파일> <도구 이름>]
      python3 dify_import.py <dsl 파일> --app <기존 앱 id> [--name v4]   # 기존 앱을 이 DSL로 덮어쓰고 다시 게시
"""
import json, subprocess, sys

INNER = r'''
import contextlib, io, json
DSL = __DSL__
SPEC = __SPEC__
TARGET_APP = __TARGET__
VERSION_NAME = __NAME__
REF_APP = "17663f9b-4639-4cba-9273-73f5e7aaeced"  # 같은 테넌트·계정 기준으로 쓰는 기존 앱(9월 3주차 RAG)
with contextlib.redirect_stdout(io.StringIO()):
    from app import app
    from extensions.ext_database import db
    from models import App, Account
    from services.app_dsl_service import AppDslService
    from services.workflow_service import WorkflowService
    from services.tools.workflow_tools_manage_service import WorkflowToolManageService
    from core.tools.entities.tool_entities import WorkflowToolParameterConfiguration
    from sqlalchemy.orm import Session
with app.app_context():
    ref = db.session.get(App, REF_APP)
    account = db.session.get(Account, ref.created_by)
    account.set_tenant_id(ref.tenant_id)
    with Session(db.engine) as s:
        imp = AppDslService(s).import_app(account=account, import_mode="yaml-content", yaml_content=DSL, app_id=TARGET_APP)
        s.commit()
    if not imp.app_id:
        raise SystemExit(f"import failed: {imp.status} {imp.error}")
    new_app = db.session.get(App, imp.app_id)
    with Session(db.engine) as s:
        wf = WorkflowService().publish_workflow(session=s, app_model=new_app, account=account, marked_name=VERSION_NAME)
        s.get(App, new_app.id).workflow_id = wf.id
        s.commit()
        wf_id = wf.id
    out = {"app_id": imp.app_id, "import_status": str(imp.status), "published_workflow": wf_id}
    if SPEC:
        WorkflowToolManageService.create_workflow_tool(
            user_id=account.id, tenant_id=ref.tenant_id, workflow_app_id=imp.app_id,
            name=SPEC["name"], label=SPEC["label"], icon=SPEC["icon"], description=SPEC["description"],
            parameters=[WorkflowToolParameterConfiguration(**p) for p in SPEC["parameters"]], labels=[])
        out["tool"] = SPEC["name"]
    print(json.dumps(out))
'''

dsl = open(sys.argv[1], encoding="utf-8").read()
spec = None
target = None
name = "v1"
if "--name" in sys.argv:
    name = sys.argv[sys.argv.index("--name") + 1]
if len(sys.argv) > 3 and sys.argv[2] == "--app":
    target = sys.argv[3]
elif len(sys.argv) > 3:
    spec = json.load(open(sys.argv[2], encoding="utf-8"))[sys.argv[3]]
    spec["name"] = sys.argv[3]
script = INNER.replace("__DSL__", repr(dsl)).replace("__SPEC__", repr(spec)).replace("__TARGET__", repr(target)).replace("__NAME__", repr(name))
r = subprocess.run(["docker", "exec", "-i", "docker-api-1", "bash", "-c", "cd /app/api && python -"], input=script, text=True, capture_output=True)
print(r.stdout[-3000:])
if r.returncode:
    print(r.stderr[-3000:])
    sys.exit(r.returncode)
