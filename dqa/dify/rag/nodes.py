"""Pure code used INSIDE Dify Code nodes, shared with evaluation. No external model calls."""
import json,re

def query_item(item: str) -> dict:
    x=json.loads(item)
    return {"query": x["query"], "rule":x.get("rule",""), "kind":x.get("kind","rule"), "item":item}

def rank(item: str, docs: list, cases: list) -> dict:
    x=json.loads(item); out=[]; seen=set()
    for r in (docs or [])+(cases or []):
        c=(r.get("content") or "").strip(); m=re.match(r"\[([A-Z]\d{1,2}-\d{3})\]",c)
        if not m or m.group(0) in seen: continue
        meta={}
        mm=re.search(r'^DQA_META: (.+)$',c,re.M)
        if mm:
            try: meta=json.loads(mm.group(1))
            except ValueError: continue
        # Strict applicability for structured data; legacy primary sources remain candidates.
        if meta and (meta.get('platform')!='web' or meta.get('scope') not in ('generic',x.get('project','generic'))): continue
        if x.get('kind')=='recipe':
            if meta.get('kind')!='recipe' or meta.get('recipe')!=x.get('recipe'):continue
        elif meta and (meta.get('kind')=='recipe' or meta.get('rule')!=x.get('rule')):continue
        # Legacy team tokens/cases lack applicability metadata. Keep only explicitly mapped generic primary sources.
        if not meta:
            allowed={'R1':['P02-003','O12-','O13-'],'F1':['P02-002','O07-'],'L2':['P02-001','O01-'],'D2':['P02-005','O06-']}.get(x.get('rule'),[])
            if x.get('project')=='cbh':
                if x.get('rule') in ('D2','D3','A2'):allowed=allowed+['C01-']
                case_keys={'R1':['넘침','min-width','minWidth'],'R2':['잘림','clipping'],'R3':['겹침'],'R4':['가려','safe-area'],'I1':['무반응','반응 없음'],'I2':['오류','exception'],'I4':['목적지','prototype'],'F1':['Fill','고정 너비']}.get(x.get('rule'),[])
                if m.group(1).startswith('C02-') and any(k.lower() in c.lower() for k in case_keys):allowed=allowed+['C02-']
            if not any(m.group(1).startswith(prefix) for prefix in allowed):continue
        # An exact rule card is preferred to semantically similar examples about another rule.
        score=float((r.get('metadata') or {}).get('score') or r.get('score') or 0)
        boost=4 if meta.get('rule')==x.get('rule') and x.get('rule') else 0
        if x.get('kind')=='recipe':boost=4
        seen.add(m.group(0));out.append({'id':m.group(0),'text':c,'score':round(score+boost,6),'metadata':meta,'document_id':(r.get('metadata') or {}).get('document_id')})
    out.sort(key=lambda r:(-r['score'],r['id']))
    selected=out[:(1 if x.get('kind')=='recipe' else 3)]
    result={'id':x['id'],'rule':x.get('rule'),'recipe':x.get('recipe'), 'selected':selected,'candidate_count':len(out), 'query':x['query']}
    return {'result':result}

def aggregate(items: list) -> dict:
    texts=[];links={}; contexts={}
    for x in items or []:
        rows=x.get('selected') or []
        text='\n\n'.join(r['text'] for r in rows) or '(관련 근거 없음)'
        contexts[x['id']]=text
        links[x['id']]=[{'id':r['id'],'title':r['text'].splitlines()[0][:100]} for r in rows]
        texts.append('[결함 '+x['id']+'의 근거]\n'+text)
    return {'text':'\n\n'.join(texts),'links':json.dumps(links,ensure_ascii=False),'contexts':json.dumps(contexts,ensure_ascii=False),'audit':json.dumps(items,ensure_ascii=False)}

def plan(items: list) -> dict:
    approved=[]
    for x in items or []:
        for r in x.get('selected') or []:
            m=r.get('metadata') or {}
            if m.get('kind')=='recipe' and m.get('recipe')==x.get('recipe') and m.get('platform')=='web':
                approved.append({'id':x['id'],'recipe':x['recipe'],'basis':r['id'],'document_id':r.get('document_id')});break
    return {'plan':json.dumps(approved,ensure_ascii=False),'audit':json.dumps(items,ensure_ascii=False)}
