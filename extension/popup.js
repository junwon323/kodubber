const output = document.querySelector('#status');
const toggle = document.querySelector('#toggle');
let enabled = false;
let sequence = 0;
let updating = false;

async function command(type) {
  const request = ++sequence;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const file = document.querySelector('#file').files[0];
    if (type === 'start' && file?.size > 2_000_000) throw Error('2MB 이하의 자막을 선택하세요.');
    const reply = await chrome.tabs.sendMessage(tab.id, {type, voice: localStorage.getItem('voice') || '', file: type === 'start' && file ? await file.text() : null});
    if (request !== sequence) return;
    enabled = reply.enabled;
    toggle.textContent = enabled ? '더빙 끄기' : '더빙 켜기';
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.disabled = false;
    document.querySelector('#translation-mode').disabled = enabled;
    output.textContent = reply.status;
  } catch (e) {
    if (request !== sequence) return;
    toggle.disabled = type === 'status';
    output.textContent = e.message.includes('Receiving end') ? '유튜브 영상을 열거나 새로고침해 주세요.' : e.message;
  }
}

toggle.onclick = async () => {
  updating = true;
  toggle.disabled = true;
  try { await command(enabled ? 'stop' : 'start'); }
  finally { updating = false; }
};
command('status');
setInterval(() => { if (!updating) command('status'); }, 800);

const modeSelect=document.querySelector('#translation-mode');
async function refreshAccount(){
 const state=await chrome.runtime.sendMessage({type:'office-state'});
 modeSelect.value=state.mode||'local';document.querySelector('#office-panel').hidden=modeSelect.value!=='office';
 document.querySelector('#account-status').textContent=state.email?state.email+' · 로그인됨':'허용된 계정으로 로그인해 주세요.';
 document.querySelector('#login-form').hidden=!!state.email;document.querySelector('#logout').hidden=!state.email;
}
modeSelect.onchange=async()=>{await chrome.storage.local.set({translationMode:modeSelect.value});await refreshAccount();};
document.querySelector('#login-form').onsubmit=async event=>{
 event.preventDefault();const button=document.querySelector('#login'),status=document.querySelector('#login-status');button.disabled=true;
 try{
  const granted=await chrome.permissions.request({origins:[OFFICE_ORIGIN+'/*']});if(!granted)throw Error('사무실 서버 연결 권한이 필요합니다.');
  const result=await chrome.runtime.sendMessage({type:'office-login',email:document.querySelector('#email').value,password:document.querySelector('#password').value});
  if(result.error)throw Error(result.error);status.textContent='로그인되었습니다.';await refreshAccount();
 }catch(error){status.textContent=error.message;}finally{document.querySelector('#password').value='';button.disabled=false;}
};
document.querySelector('#logout').onclick=async()=>{
 if(enabled)await command('stop');const result=await chrome.runtime.sendMessage({type:'office-logout'});document.querySelector('#login-status').textContent=result.error||'로그아웃되었습니다.';await refreshAccount();
};
document.querySelector('#compare').onclick=async()=>{
 const button=document.querySelector('#compare'),status=document.querySelector('#benchmark-status');button.disabled=true;status.textContent='각 모드 3회 측정 중입니다. 완료될 때까지 팝업을 열어 두세요.';
 try{
  const result=await chrome.runtime.sendMessage({type:'compare-speed'});if(result.error)throw Error(result.error);
  const median=mode=>result.measurements.filter(x=>x.mode===mode).map(x=>x.totalMs).sort((a,b)=>a-b)[1]/1000;
  status.textContent=`번역 완료 중앙값: 내 PC ${median('local').toFixed(2)}초 / 사무실 ${median('office').toFixed(2)}초. 네트워크·번역 대기를 포함하며 첫 음성 재생 시간은 아닙니다.`;
 }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
};
refreshAccount();
