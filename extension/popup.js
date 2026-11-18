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
refreshAccount();

async function loadVoices() {
 const select=document.querySelector('#voice'), note=document.querySelector('#voice-note');
 try {
  const keyOf=v=>JSON.stringify([v.extensionId||'',v.voiceName,v.lang]);
  const voices=[...new Map((await chrome.tts.getVoices()).filter(v=>/^ko(?:-|$)/i.test(v.lang||'')).map(v=>[keyOf(v),v])).values()];
  const saved=localStorage.getItem('voice')||'';
  select.replaceChildren();
  for(const voice of voices) {
   const key=JSON.stringify([voice.extensionId||'',voice.voiceName,voice.lang]);
   select.add(new Option(voice.voiceName,key));
  }
  select.value=voices.some(v=>keyOf(v)===saved)?saved:(voices[0]?keyOf(voices[0]):'');
  localStorage.setItem('voice',select.value);
  document.querySelector('#voice-picker').hidden=voices.length<2;
  note.hidden=voices.length>0;
  note.textContent=voices.length?'':'한국어 음성이 없습니다. 운영체제에 한국어 음성을 추가해 주세요.';
 } catch {note.hidden=false;note.textContent='음성 목록을 가져오지 못했습니다. 확장을 다시 열어 주세요.';}
}
document.querySelector('#voice').onchange=event=>localStorage.setItem('voice',event.target.value);
loadVoices();
