import json,subprocess,urllib.request,time
from pathlib import Path
R=Path(__file__).resolve().parents[3];E=R/'eval/rag-20261014';E.mkdir(parents=True,exist_ok=True);cards=json.load(open(Path(__file__).with_name('corpus.json')))
key=subprocess.run(['docker','exec','docker-db_postgres-1','psql','-U','postgres','-d','dify','-At','-c',"select token from api_tokens where type='dataset' order by created_at limit 1"],capture_output=True,text=True,check=True).stdout.strip()
def api(method,p,b=None):
 req=urllib.request.Request('http://localhost/v1'+p,method=method,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},data=json.dumps(b).encode() if b is not None else None)
 with urllib.request.urlopen(req,timeout=120) as r:return json.load(r)
ids={'docs':'e6310412-dd63-400f-9239-ea6961ab129a','cases':'5bc9d9a1-3c39-440e-83ca-5d5aef6b3e30'};out=[]
for kind,kb in ids.items():
 existing={d['name']:d for d in api('GET',f'/datasets/{kb}/documents?limit=100')['data']}
 for c in [x for x in cards if x['kb']==kind]:
  name='dqa-rag-v6-'+c['id']+'.txt';text='['+c['id']+'] '+c['title']+'\nDQA_META: '+json.dumps(c['meta'],ensure_ascii=False)+'\n'+c['text']
  if name not in existing:
   r=api('POST',f'/datasets/{kb}/document/create-by-text',{'name':name,'text':text,'indexing_technique':'high_quality','doc_form':'text_model','doc_language':'Korean','process_rule':{'mode':'custom','rules':{'pre_processing_rules':[],'segmentation':{'separator':'<<<CHUNK>>>','max_tokens':2000,'chunk_overlap':0}}}})
   for _ in range(90):
    st=api('GET',f"/datasets/{kb}/documents/{r['batch']}/indexing-status")['data'][0]
    if st['indexing_status'] in ['completed','error','paused']:break
    time.sleep(1)
   if st['indexing_status']!='completed':raise RuntimeError(st)
   doc=r['document']
  else:doc=existing[name]
  segs=api('GET',f"/datasets/{kb}/documents/{doc['id']}/segments?limit=100")
  out.append({'id':c['id'],'dataset':kb,'document':doc['id'],'segments':len(segs['data']),'status':st['indexing_status'] if name not in existing else doc.get('indexing_status'),'sha256':__import__('hashlib').sha256(text.encode()).hexdigest()})
  print(c['id'],'indexed',flush=True)
(E/'corpus-load.json').write_text(json.dumps(out,indent=2))

# Native Dify metadata is required by the planning search filter.
loaded=out;by_id={c['id']:c for c in cards}
for kb in ids.values():
 fields={m['name']:m['id'] for m in api('GET',f'/datasets/{kb}/metadata').get('doc_metadata',[])}
 for name in ['dqa_kind','dqa_platform','dqa_rule','dqa_scope','dqa_version']:
  if name not in fields:fields[name]=api('POST',f'/datasets/{kb}/metadata',{'name':name,'type':'string'})['id']
 operations=[]
 for row in loaded:
  if row['dataset']!=kb:continue
  meta=by_id[row['id']]['meta'];values={'dqa_kind':meta['kind'],'dqa_platform':'web','dqa_rule':meta.get('rule',''),'dqa_scope':'generic','dqa_version':'6'}
  operations.append({'document_id':row['document'],'metadata_list':[{'id':fields[k],'name':k,'value':v} for k,v in values.items()],'partial_update':True})
 api('POST',f'/datasets/{kb}/documents/metadata',{'operation_data':operations})
print('Dify metadata verified')
