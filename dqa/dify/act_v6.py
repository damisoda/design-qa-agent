"""Dify-native RAG v6: bounded probe planning, per-defect retrieval, explicit applicability reranking."""
import copy,inspect,json
import act_v5
from rag import nodes as funcs
DOCS=act_v5.DOCS_KB;CASES=act_v5.CASES_KB

def code(fn):
    return 'import json,re\n'+inspect.getsource(fn).replace('def '+fn.__name__+'(', 'def main(')

def build(provider_id,recipes):
    doc=act_v5.build(provider_id,recipes);g=doc['workflow']['graph'];N=g['nodes'];E=g['edges']
    by={n['id']:n for n in N}
    def node(nid,data,x=0,y=1100,parent=None):
        n={'id':nid,'type':'custom-iteration-start' if data['type']=='iteration-start' else 'custom','data':data,'position':{'x':x,'y':y},'positionAbsolute':{'x':x,'y':y},'width':244,'height':98,'sourcePosition':'right','targetPosition':'left'}
        if parent:n.update(parentId=parent,extent='parent');data.update(isInIteration=True,iteration_id=parent)
        N.append(n);by[nid]=n;return n
    def edge(s,t,handle='source',parent=None):
        E.append({'id':s+'-'+handle+'-'+t,'source':s,'target':t,'sourceHandle':handle,'targetHandle':'target','type':'custom','data':{'sourceType':by[s]['data']['type'],'targetType':by[t]['data']['type'],'isInIteration':bool(parent),'iteration_id':parent},'zIndex':1002 if parent else 0})
    def cn(nid,fn,variables,outputs,parent=None):
        return node(nid,{'type':'code','title':nid,'code_language':'python3','code':code(fn),'variables':[{'variable':k,'value_selector':s} for k,s in variables],'outputs':{k:{'type':v,'children':None} for k,v in outputs}},parent=parent)
    def tool(nid,name,params):
        data=copy.deepcopy(by['facts']['data']);data.update(title=nid,tool_name=name,tool_label=name,tool_parameters={k:{'type':'mixed','value':v} for k,v in params.items()});return node(nid,data)
    def iteration(nid,selector,kind):
        node(nid,{'type':'iteration','title':'검사 방법 검색' if kind=='recipe' else '결함별 근거 검색·재정렬','iterator_selector':selector,'output_selector':[nid+'_rank','result'],'output_type':'array[object]','start_node_id':nid+'_start','is_parallel':False,'parallel_nums':1,'error_handle_mode':'terminated','flatten_output':False,'width':1300,'height':270},y=1500 if kind=='recipe' else 1950)
        node(nid+'_start',{'type':'iteration-start','title':'요소 하나'},30,50,nid)
        cn(nid+'_query',funcs.query_item,[('item',[nid,'item'])],[('query','string'),('rule','string'),('kind','string'),('item','string')],nid)
        for suffix,kb in [('docs',DOCS),('cases',CASES)]:
            data=copy.deepcopy(by['kr_docs']['data']);data.update(title='Dify 문서 검색' if suffix=='docs' else 'Dify 사례 검색',dataset_ids=[kb],query_variable_selector=[nid+'_query','query'])
            data['multiple_retrieval_config'].update(top_k=12,reranking_enable=True,score_threshold=None)
            if kind=='recipe':data.update(metadata_filtering_mode='manual',metadata_filtering_conditions={'logical_operator':'and','conditions':[{'name':'dqa_kind','comparison_operator':'is','value':'recipe'},{'name':'dqa_platform','comparison_operator':'is','value':'web'}]})
            node(nid+'_'+suffix,data,300 if suffix=='docs' else 600,60,nid)
        cn(nid+'_rank',funcs.rank,[('item',[nid+'_query','item']),('docs',[nid+'_docs','result']),('cases',[nid+'_cases','result'])],[('result','object')],nid)
        for i,suffix in enumerate(['query','rank']):by[nid+'_'+suffix]['position']={'x':100+i*850,'y':100}
        edge(nid+'_start',nid+'_query',parent=nid);edge(nid+'_query',nid+'_docs',parent=nid);edge(nid+'_docs',nid+'_cases',parent=nid);edge(nid+'_cases',nid+'_rank',parent=nid)
    # A read-only inventory request happens for every completed web check, even with zero findings / LLM off.
    tool('inventory','dqa_inventory',{'run_id':'{{#start.run_id#}}','ui_request':'{{#start.ui_request#}}'})
    node('inventory_read',{'type':'code','title':'관측한 검사 후보 읽기','code_language':'python3','code':'import json\ndef main(text:str)->dict:\n r=json.loads(text);return {"queries":r.get("queries",[])}','variables':[{'variable':'text','value_selector':['inventory','text']}],'outputs':{'queries':{'type':'array[string]','children':None}}})
    iteration('probe_search',['inventory_read','queries'],'recipe')
    cn('probe_plan',funcs.plan,[('items',['probe_search','output'])],[('plan','string'),('audit','string')])
    tool('adaptive','dqa_adaptive',{'run_id':'{{#start.run_id#}}','ui_request':'{{#start.ui_request#}}','plan':'{{#probe_plan.plan#}}','audit':'{{#probe_plan.audit#}}','text':'{{#wait_11.text#}}'})
    # Insert after the original completion waits. Non-web/status jobs are read-only no-ops.
    E[:]=[e for e in E if not(e['source']=='wait_11' and e['target']=='gate')]
    edge('wait_11','inventory');edge('inventory','inventory_read');edge('inventory_read','probe_search');edge('probe_search','probe_plan');edge('probe_plan','adaptive');edge('adaptive','gate')
    # Tool calls stay below the provider timeout; Dify owns bounded completion waits for multi-screen work.
    E[:]=[e for e in E if not(e['source']=='adaptive' and e['target']=='gate')]
    previous='adaptive'
    for i in range(12):
        nid='adaptive_wait_%d'%i
        n=copy.deepcopy(by['wait_0']);n['id']=nid;n['data']['title']='앱 추가 검사 완료 대기 %d'%(i+1)
        n['data']['tool_parameters']['text']['value']='{{#'+previous+'.text#}}'
        N.append(n);by[nid]=n;edge(previous,nid);previous=nid
    edge(previous,'gate')
    by['gate']['data']['variables'][0]['value_selector']=[previous,'text']
    # Keep the legacy nodes as a blueprint until both iteration subgraphs have copied their retrieval settings.
    by['facts_read']['data']['code']=by['facts_read']['data']['code'].replace('"facts": str(r.get("facts")', '"queries": r.get("queries", []), "facts": str(r.get("facts")')
    by['facts_read']['data']['outputs']['queries']={'type':'array[string]','children':None}
    iteration('issue_search',['facts_read','queries'],'rule')
    cn('issue_context',funcs.aggregate,[('items',['issue_search','output'])],[('text','string'),('links','string'),('contexts','string'),('audit','string')])
    tool('retrieval_audit','dqa_retrieval',{'run_id':'{{#gate.run_id#}}','ui_request':'{{#start.ui_request#}}','audit':'{{#issue_context.audit#}}'})
    removed={'qx','kr_docs','kr_cases','merge','pair'}
    E[:]=[e for e in E if e['source'] not in removed and e['target'] not in removed]
    N[:]=[n for n in N if n['id'] not in removed]
    edge('if_ok','issue_search','ok');edge('issue_search','issue_context');edge('issue_context','retrieval_audit');edge('retrieval_audit','llm')
    by['llm']['data']['prompt_template'][1]['text']=act_v5.USER.replace('{{#pair.text#}}','{{#issue_context.text#}}')
    p=by['judge']['data']['tool_parameters'];p['context']['value']='{{#issue_context.text#}}';p['related']['value']='{{#issue_context.links#}}';p['contexts']={'type':'mixed','value':'{{#issue_context.contexts#}}'}
    layout={'start':(0,0),'dqa':(300,0),'inventory':(600,0),'inventory_read':(900,0),'probe_search':(0,700),'probe_plan':(1500,750),'adaptive':(1800,750),'gate':(0,1200),'if_go':(300,1200),'facts':(600,1200),'facts_read':(900,1200),'ready':(1200,1200),'ready_read':(1500,1200),'if_ok':(1800,1200),'show_skip':(2100,1200),'show_plain':(600,1450),'issue_search':(0,1700),'issue_context':(1500,1750),'retrieval_audit':(1800,1750),'llm':(0,2200),'judge':(300,2200),'show_llm':(600,2200),'agg':(1000,2450),'end':(1300,2450)}
    for n in N:
        if n.get('parentId'):
            suffix=n['id'].rsplit('_',1)[-1];x={'start':20,'query':100,'docs':400,'cases':700,'rank':1000}[suffix];y=100
            px,py=layout[n['parentId']];n['position']={'x':x,'y':y};n['positionAbsolute']={'x':px+x,'y':py+y}
        elif n['id'] in layout:
            x,y=layout[n['id']];n['position']={'x':x,'y':y};n['positionAbsolute']={'x':x,'y':y}
            if n['data']['type']=='iteration':n.update(width=1350,height=280);n['data'].update(width=1350,height=280)
    names={'inventory':'추가 검사 후보 관측','inventory_read':'관측한 화면·요소 읽기','probe_plan':'검색 근거로 검사 계획 확정','adaptive':'추가 크기·버튼 실제 재측정','issue_context':'결함별 근거 분리','retrieval_audit':'검색 근거 기록'}
    for n in N:
        if n['id'] in names:n['data']['title']=names[n['id']]
        elif n['id'].endswith('_query'):n['data']['title']='요소별 검색어'
        elif n['id'].endswith('_rank'):n['data']['title']='적용 조건 필터·순위 정리'
    doc['app']['description']='실제 Figma·프런트를 측정하고 Dify 지식베이스에서 검사 방법을 검색해 추가 측정한다. 결함별 근거 검색·재정렬과 Gemma 설명을 거친 뒤 측정 수치·인용을 검증해 저장한다. 적용·되돌리기·PR 올리기는 사람의 확인 문구가 필요하다.'
    return doc
