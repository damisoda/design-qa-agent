// Fixed macOS menu action: explicit connection or foreground-only import-page following.
// No user text is interpolated into AppleScript. Permissions are never granted here.
const path = require('path')
const { execFile } = require('child_process')
const messages = {
  permission_required: '자동 실행에 macOS 권한이 필요합니다. 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 dqa 서버를 실행한 앱을 허용하고, 자동화에서 System Events 제어 요청을 허용해 주세요. 권한을 바꾼 뒤 이 버튼을 다시 누르세요.',
  plugin_not_found: 'dqa 플러그인이 등록되어 있지 않습니다. Figma → 플러그인 → 개발 → 매니페스트에서 플러그인 가져오기에서 figma-plugin/manifest.json을 한 번 등록해 주세요.',
  file_required: 'Figma에서 디자인 파일을 연 뒤 다시 눌러 주세요. 홈 화면에서는 플러그인을 실행할 수 없습니다.',
  app_unavailable: 'Figma 앱을 찾지 못했습니다. 앱을 연 뒤 다시 눌러 주세요.',
  unsupported: '플러그인 자동 실행은 현재 macOS에서 지원합니다. Figma에서 dqa 시안 내보내기를 직접 실행해 주세요.',
  timeout: 'Figma 메뉴의 응답을 기다리다 중단했습니다. 열려 있는 대화상자를 확인하고 다시 눌러 주세요.',
  failed: 'Figma 메뉴에서 dqa 플러그인을 실행하지 못했습니다. 디자인 파일과 플러그인 등록 상태를 확인해 주세요.'
}
function outcome (error, stdout='') {
  const [rawStatus, ...fileParts]=String(stdout).trim().split('\t')
  let status=rawStatus
  if(error) {
    const message=String(error.message || '')
    status=/-1743|-25211|not authorized|not allowed assistive|보조 접근|권한|허용되지/i.test(message)?'permission_required':error.killed?'timeout':'failed'
  }
  if(!['requested','inactive','busy','already_running','active'].includes(status) && !Object.hasOwn(messages,status))status='failed'
  return {status, ...(!error && fileParts.length ? {file:fileParts.join('\t').slice(0,200)} : {}), ...(messages[status]?{message:messages[status]}:{})}
}
function launchPlugin ({platform=process.platform,execute=execFile,automatic=false,probe=false}={}) {
  if(platform!=='darwin')return Promise.resolve({status:'unsupported',message:messages.unsupported})
  return new Promise(resolve=>execute('/usr/bin/osascript',[path.join(__dirname,'launch-plugin.applescript'), ...(automatic ? ['auto', ...(probe ? ['probe'] : [])] : [])],{timeout:10000,maxBuffer:4096},(e,out)=>{ if(e && outcome(e,out).status==='failed') console.warn('[figma-launch]', String(e.message).slice(-1200)); resolve(outcome(e,out)) }))
}
module.exports={launchPlugin,outcome}
