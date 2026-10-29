const {test}=require('node:test');const assert=require('node:assert/strict')
const {launchPlugin,outcome}=require('../design/launch-plugin')
const {createFigmaConnection}=require('../design/connection')
const {connectionMessage}=require('../ui/figma')
test('launcher uses a fixed script and interprets permission denial without claiming connection',async()=>{
 let args
 const r=await launchPlugin({platform:'darwin',execute:(...a)=>{args=a;a[3](new Error('not authorized (-1743)'),'')}})
 assert.equal(r.status,'permission_required');assert.equal(args[0],'/usr/bin/osascript');assert.equal(args[1].length,1);assert.ok(args[1][0].endsWith('/launch-plugin.applescript'))
 assert.equal(outcome(null,'requested').status,'requested')
 assert.equal(outcome({killed:true},'').status,'timeout')
 assert.equal((await launchPlugin({platform:'linux'})).status,'unsupported')
})
test('connect requests plugin only when explicitly requested and leaves waiting until actual heartbeat',async()=>{
 let n=0;const c=createFigmaConnection(async()=>{},async()=>{n++;return {status:'requested'}})
 await c.connect({});assert.equal(n,0)
 const r=await c.connect({launch_plugin:true});assert.equal(n,1);assert.equal(r.session.launch.status,'requested');assert.equal(r.files.length,0);assert.equal(r.session.state,'waiting')
 c.poll({client_id:'actual-client-123',file:'My design',frames:[]});assert.equal(c.snapshot().files.length,1)
})
test('launch denial is returned as actionable state and no unsolicited retry occurs',async()=>{
 let n=0;const c=createFigmaConnection(async()=>{},async()=>{n++;return {status:'permission_required',message:'권한 필요'}})
 const r=await c.connect({launch_plugin:true});assert.equal(r.session.launch.status,'permission_required')
 c.snapshot();c.snapshot();assert.equal(n,1)
 const st={figmaSelecting:true,figmaLaunch:r.session.launch}
 assert.equal(connectionMessage(st,[],false),'권한 필요')
 assert.match(connectionMessage(st,[{frames:[]}],false),/플러그인이 연결/)
})
test('overlapping launch requests cannot click Figma menu twice',async()=>{
 let resolve;const c=createFigmaConnection(async()=>{},()=>new Promise(r=>resolve=r))
 const p=c.connect({launch_plugin:true});await new Promise(r=>setImmediate(r));await assert.rejects(c.connect({launch_plugin:true}),/이전 요청/)
 resolve({status:'requested'});await p
})

test('pending launch does not ask the user to launch the plugin manually',()=>{
 const {guide}=require('../ui/figma')
 const html=guide({figmaSelecting:true,figmaOpening:true},[])
 assert.match(html,/비교할 파일/)
 assert.doesNotMatch(html,/개발 →/)
})

test('automatic mode passes a fixed foreground-only flag',async()=>{
 let argv;const r=await launchPlugin({platform:'darwin',automatic:true,execute:(...a)=>{argv=a[1];a[3](null,'inactive')}})
 assert.equal(r.status,'inactive');assert.equal(argv[1],'auto')
})
test('watch is throttled, cannot double launch and does not invent an active plugin',async()=>{
 let calls=0,resolve;const c=createFigmaConnection(async()=>{throw Error('must not open')},options=>{assert.equal(options.automatic,true);calls++;return new Promise(r=>resolve=r)})
 const first=c.watch();await new Promise(r=>setImmediate(r));await c.watch();assert.equal(calls,1)
 resolve({status:'requested'});const r=await first;assert.equal(r.session.state,'waiting');assert.equal(r.files.length,0)
 await c.watch();assert.equal(calls,1)
})
test('watch blocks permission retries until an explicit connect and preserves imported state',async()=>{
 let calls=0;const c=createFigmaConnection(async()=>{},async()=>{calls++;return {status:'permission_required'}})
 await c.watch();await c.watch();assert.equal(calls,1)
 await c.connect({});assert.equal(calls,1);await c.watch();assert.equal(calls,2)
})
test('watch skips pending exports and inactive Figma creates no session',async()=>{
 let calls=0;const c=createFigmaConnection(async()=>{},async()=>{calls++;return {status:'inactive'}})
 assert.equal((await c.watch()).session,null)
 c.poll({client_id:'test-live-client',file:'Design',frames:[{id:'1:2',name:'Frame',w:375,h:812}]})
 const pending=c.importSelection({client_id:'test-live-client'})
 await c.watch();assert.equal(calls,1);assert.equal(c.snapshot().session.request_id,pending.session.request_id)
})

test('automatic following shows current Figma file while keeping other clients for explicit refresh',async()=>{
 const c=createFigmaConnection(async()=>{},async()=>({status:'already_running',file:'New file'}))
 c.poll({client_id:'old-file-client',file:'Old file',frames:[{id:'1:2',w:375,h:812}]})
 c.poll({client_id:'new-file-client',file:'New file',frames:[{id:'2:3',w:375,h:812}]})
 const r=await c.watch();assert.deepEqual(r.files.map(x=>x.file),['New file'])
 assert.equal(c.refresh('old',{file:'Old file',frame:{id:'1:2'},figma:{client_id:'old-file-client'}}).session.state,'exporting')
 assert.deepEqual(outcome(null,'already_running\tNew file'),{status:'already_running',file:'New file'})
})

test('active file with a healthy plugin never triggers another menu launch',async()=>{
 const calls=[];const c=createFigmaConnection(async()=>{},async options=>{calls.push(options);return {status:'active',file:'Current'}})
 c.poll({client_id:'healthy-current',file:'Current',frames:[{id:'1:2',w:375,h:812}]})
 const r=await c.watch();assert.equal(calls.length,1);assert.equal(calls[0].probe,true);assert.equal(r.auto.status,'already_running')
})
test('missing active file plugin launches once then waits for its heartbeat',async()=>{
 const calls=[];const c=createFigmaConnection(async()=>{},async options=>{calls.push(options);return options.probe?{status:'active',file:'Current'}:{status:'requested',file:'Current'}})
 const r=await c.watch();assert.equal(calls.length,2);assert.equal(r.session.launch.status,'requested');assert.equal(r.files.length,0)
 const now=Date.now;const t=now();Date.now=()=>t+4000
 try {const waiting=await c.watch();assert.equal(calls.length,3);assert.equal(waiting.auto.status,'waiting')}finally{Date.now=now}
})
