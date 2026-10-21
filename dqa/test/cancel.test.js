const {test}=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {stopChild}=require('../server/process');
test('cancel terminates an owned child even when a dependency consumes SIGTERM',async()=>{
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
 await once(child.stdout,'data');const closed=once(child,'close');stopChild(child,{graceMs:50});const [code,signal]=await closed;
 assert.ok(signal==='SIGKILL'||process.platform==='win32');assert.equal(code,null)
});
