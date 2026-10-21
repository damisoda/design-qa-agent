"""로컬 Dify의 게시된 워크플로를 실행하고 실제 노드 이벤트만 전달한다.

기존 dify.py와 같은 컨테이너 서비스 호출. 프롬프트·검색 내용은 stdout에 싣지 않는다.
"""
import json
import subprocess
import sys


def decode_packets(packet):
    if isinstance(packet, dict):
        return [packet]
    out = []
    for line in str(packet).splitlines():
        if line.startswith('data:'):
            try:
                out.append(json.loads(line[5:]))
            except (ValueError, TypeError):
                pass
    return out


def public_event(obj):
    event = obj.get('event')
    if event not in ('workflow_started', 'workflow_finished', 'node_started', 'node_finished', 'error'):
        return None
    data = obj.get('data') or {}
    out = {'event': event, 'task_id': obj.get('task_id'), 'workflow_run_id': obj.get('workflow_run_id'),
           'node': data.get('node_id'), 'status': data.get('status'), 'error': data.get('error') or obj.get('message')}
    # 저장 결과/준비 실패의 짧은 제어 값만 전달. 측정값·검색문서·프롬프트는 제외.
    outputs = data.get('outputs') or {}
    if out['node'] == 'ready_read':
        out['ready'] = {k: outputs.get(k) for k in ('ok', 'reason')}
    if out['node'] == 'judge':
        try:
            value = json.loads(outputs.get('text') or '{}')
            out['judge'] = {k: value.get(k) for k in ('ok', 'saved', 'rejected', 'unloaded')}
        except (TypeError, ValueError):
            pass
    return out


def main():
    mode, app_id, payload = sys.argv[1:4]
    inputs = json.loads(payload) if mode == 'run' else {}
    inner = '''import contextlib,io,json
with contextlib.redirect_stdout(io.StringIO()):
 from app import app
 from extensions.ext_database import db
 from models import App,Account
 from services.app_generate_service import AppGenerateService
 from core.app.entities.app_invoke_entities import InvokeFrom
 from core.app.apps.base_app_queue_manager import AppQueueManager
 from sqlalchemy.orm import Session
with app.app_context():
 a=db.session.get(App,APP_ID)
 if a is None: raise RuntimeError('설정된 Dify 앱이 없습니다')
 acc=db.session.get(Account,a.created_by); acc.set_tenant_id(a.tenant_id)
 if MODE=='stop':
  AppQueueManager.set_stop_flag_no_user_check(PAYLOAD)
  print('@@'+json.dumps({'event':'stop_requested'}),flush=True)
 else:
  with Session(db.engine) as s:
   stream=AppGenerateService.generate(app_model=a,user=acc,args={'inputs':INPUTS,'files':[]},invoke_from=InvokeFrom.SERVICE_API,session=s,streaming=True)
   s.commit()
   for packet in stream:
    for obj in decode_packets(packet):
     out=public_event(obj)
     if out: print('@@'+json.dumps(out,ensure_ascii=False),flush=True)
'''
    import inspect
    script = ('APP_ID=' + repr(app_id) + '\nMODE=' + repr(mode) + '\nPAYLOAD=' + repr(payload)
              + '\nINPUTS=' + repr(inputs) + '\nimport json\n'
              + inspect.getsource(decode_packets) + '\n' + inspect.getsource(public_event) + '\n' + inner)
    child = subprocess.Popen(['docker', 'exec', '-i', 'docker-api-1', 'bash', '-c', 'cd /app/api && python -'],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr, text=True)
    child.stdin.write(script)
    child.stdin.close()
    for line in child.stdout:
        if line.startswith('@@'):
            print(line[2:].strip(), flush=True)
    sys.exit(child.wait())


if __name__ == '__main__':
    main()
