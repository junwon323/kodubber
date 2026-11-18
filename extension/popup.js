const output = document.querySelector('#status');
const toggle = document.querySelector('#toggle');
let enabled = false;
let sequence = 0;
let updating = false;

async function command(type) {
  const request = ++sequence;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const reply = await chrome.tabs.sendMessage(tab.id, {type, voice: localStorage.getItem('voice') || ''});
    if (request !== sequence) return;
    enabled = reply.enabled;
    toggle.textContent = enabled ? '더빙 끄기' : '더빙 켜기';
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.disabled = false;
    document.querySelector('#translation-mode').disabled = enabled;
    document.querySelector('#voice').disabled = enabled;
    output.textContent = reply.status;
    if (reply.status?.startsWith('로컬 codex 연결 실패')) document.querySelector('#local-help').open = true;
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
 modeSelect.value=state.mode||'local';document.querySelector('#local-panel').hidden=modeSelect.value!=='local';document.querySelector('#office-panel').hidden=modeSelect.value!=='office';
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
  status.textContent=`번역 완료 중앙값: 로컬 codex ${median('local').toFixed(2)}초 / 준원사무실codex ${median('office').toFixed(2)}초. 네트워크·번역 대기를 포함하며 첫 음성 재생 시간은 아닙니다.`;
 }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
};
refreshAccount();

async function loadVoices() {
 const select=document.querySelector('#voice'), note=document.querySelector('#voice-note');
 try {
  const voices=(await chrome.tts.getVoices()).filter(v=>/^ko(?:-|$)/i.test(v.lang||''));
  const saved=localStorage.getItem('voice')||'';
  select.replaceChildren(new Option('기본 한국어 음성',''));
  for(const voice of voices) {
   const key=JSON.stringify([voice.extensionId||'',voice.voiceName,voice.lang]);
   select.add(new Option(voice.voiceName+(voice.remote?' · 온라인':''),key));
  }
  select.value=voices.some(v=>JSON.stringify([v.extensionId||'',v.voiceName,v.lang])===saved)?saved:'';
  note.textContent=voices.length?`사용 가능한 한국어 음성 ${voices.length}개. 선택은 다음 더빙부터 적용됩니다.`:'한국어 음성이 없습니다. 운영체제에 한국어 음성을 설치한 뒤 Chrome을 다시 시작하세요.';
 } catch {note.textContent='음성 목록을 가져오지 못했습니다. 확장을 다시 열어 주세요.';}
}
document.querySelector('#voice').onchange=event=>localStorage.setItem('voice',event.target.value);
loadVoices();
