chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
async function configuredOfficeOrigin(){return normalizeOfficeOrigin((await chrome.storage.local.get('officeOrigin')).officeOrigin);}
async function officeRequest(path, {body,token,signal,origin}={}) {
  origin=origin||await configuredOfficeOrigin();
  if(origin!==await configuredOfficeOrigin())throw Error('서버 주소가 변경되었습니다. 다시 로그인해 주세요.');
  if(token){const s=await officeSession();if(s.token!==token||s.origin!==origin)throw Error('로그인 세션이 변경되었습니다.');}
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',credentials:'omit',redirect:'error',cache:'no-store',
    headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal||AbortSignal.timeout(130000)});
  let result;try{result=await response.json();}catch{throw Error('사무실 서버 응답을 읽지 못했습니다.');}
  if(!response.ok){if(response.status===401&&token){const s=(await chrome.storage.local.get('officeSession')).officeSession;if(s?.token===token)await chrome.storage.local.remove('officeSession');}throw Error(result.error||'사무실 서버 요청 실패');}
  return result;
}
async function officeSession() {
 const {officeSession:s}=await chrome.storage.local.get('officeSession');
 if(!s || s.expiresAt<=Date.now() || s.origin!==await configuredOfficeOrigin()){await chrome.storage.local.remove('officeSession');throw Error('사무실 모드를 사용하려면 로그인해 주세요.');}return s;
}
async function officeTranslate(lines,signal){
 const session=await officeSession();const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),135000);
 const onAbort=()=>controller.abort();if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',onAbort,{once:true});
 const combined=controller.signal;let jobId,complete=false;
 try{
  const started=await officeRequest('/v1/translate',{body:{lines,async:true},token:session.token,origin:session.origin,signal:combined});
  if(!started.jobId)throw Error('서버 작업 응답이 올바르지 않습니다.');jobId=started.jobId;
  while(true){
   await chrome.storage.local.get('translationMode');
   const result=await officeRequest('/v1/jobs/'+encodeURIComponent(jobId),{token:session.token,origin:session.origin,signal:combined});
   if(result.error)throw Error(result.error);if(result.done){complete=true;return result;}
   await new Promise((resolve,reject)=>{
    if(combined.aborted){reject(combined.reason);return;}
    const abort=()=>{clearTimeout(timer);reject(combined.reason);};
    const timer=setTimeout(()=>{combined.removeEventListener('abort',abort);resolve();},1000);
    combined.addEventListener('abort',abort,{once:true});
   });
  }
 }finally{
  clearTimeout(timeout);signal?.removeEventListener('abort',onAbort);
  if(jobId&&!complete)fetch(session.origin+'/v1/jobs/'+encodeURIComponent(jobId),{method:'DELETE',credentials:'omit',redirect:'error',headers:{Authorization:'Bearer '+session.token},signal:AbortSignal.timeout(5000)}).catch(()=>{});
 }
}
async function translationMode(){return (await chrome.storage.local.get('translationMode')).translationMode==='office'?'office':'local';}
async function localTranslate(lines){
 try{const result=await chrome.runtime.sendNativeMessage(HOST,{lines});if(result.error)throw Error(result.error);return result;}
 catch (error) {throw Error('로컬 codex 연결 실패: 다운로드하거나 clone한 폴더에서 Windows는 install-windows.cmd, macOS는 install.command, Linux는 sh ./install.command --no-gui를 실행하세요. CLI 설치·로그인과 상세 순서는 위의 로컬 codex 연결 방법을 확인하세요. 원인: '+(error.message||'Chrome 연결 오류'));}
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
 if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('popup.html'))return;
 (async()=>{
  if(msg.type==='office-login'){
   const origin=await configuredOfficeOrigin();
   const result=await officeRequest('/v1/login',{origin,body:{email:msg.email,password:msg.password}});
   if(origin!==await configuredOfficeOrigin())throw Error('서버 주소가 변경되었습니다. 다시 로그인해 주세요.');
   await chrome.storage.local.set({officeSession:{...result,origin}});return {email:result.email,expiresAt:result.expiresAt};
  }
  if(msg.type==='office-logout'){
   let s;try{s=await officeSession();}catch{}
   try{if(s)await officeRequest('/v1/logout',{body:{},token:s.token});}finally{await chrome.storage.local.remove('officeSession');}
   return {ok:true};
  }
  if(msg.type==='office-state'){
   const s=(await chrome.storage.local.get('officeSession')).officeSession;
   return {mode:await translationMode(),email:s?.expiresAt>Date.now()&&s.origin===(await chrome.storage.local.get('officeOrigin')).officeOrigin?s.email:null};
  }
  throw Error('지원하지 않는 요청입니다.');
 })().then(reply,error=>reply({error:error.message}));return true;
});
