// Children are created by this server with detached process groups on POSIX.
// Playwright installs signal handlers; SIGTERM alone may leave an awaited model call alive.
function stopChild(child,{graceMs=2000}={}){
 if(!child?.pid||child.exitCode!==null||child.signalCode)return
 const signal=s=>{try{if(process.platform!=='win32')process.kill(-child.pid,s);else child.kill(s)}catch(e){if(e.code!=='ESRCH')throw e}}
 try{signal('SIGTERM')}catch(e){return}
 const timer=setTimeout(()=>{if(child.exitCode===null&&!child.signalCode){try{signal('SIGKILL')}catch(e){}}},graceMs)
 timer.unref();child.once('close',()=>clearTimeout(timer))
}
module.exports={stopChild}
