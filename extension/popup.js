const output = document.querySelector('#status');
const toggle = document.querySelector('#toggle');
let enabled = false;
let sequence = 0;
let updating = false;

let reconnecting=null;
const reconnectAttempted=new Set();
async function sendToVideo(tab, message) {
 try {return await chrome.tabs.sendMessage(tab.id,message);}
 catch(error){
  if(!/Receiving end|Could not establish connection|message port closed/i.test(error.message))throw error;
  if(!/^https:\/\/www\.youtube\.com\//.test(tab.url||''))throw Error('유튜브 영상 탭에서 확장을 열어 주세요.');
  if(!reconnecting){
   if(reconnectAttempted.has(tab.id))throw Error('영상 연결에 실패했습니다. 확장을 다시 열어 주세요.');
   reconnectAttempted.add(tab.id);
   output.textContent='영상에 자동으로 다시 연결하는 중';
   reconnecting=(async()=>{
    await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',files:['caption-source.js']});
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['cues.js','player.js']});
   })();
  }
  try {await reconnecting;}finally{reconnecting=null;}
  return chrome.tabs.sendMessage(tab.id,message);
 }
}
async function command(type) {
  const request = ++sequence;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const reply = await sendToVideo(tab, {type, voice: localStorage.getItem('voice') || ''});
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
let savedOfficeOrigin='';
let savingOfficeOrigin=false;
const officePermission=()=>({origins:[normalizeOfficeOrigin(savedOfficeOrigin)+'/*']});
let accountRevision=0;
async function refreshAccount(){
 const revision=++accountRevision;
 const [state,settings]=await Promise.all([chrome.runtime.sendMessage({type:'office-state'}),chrome.storage.local.get('officeOrigin')]);
 const origin=settings.officeOrigin||'';
 const granted=!!origin&&await chrome.permissions.contains({origins:[origin+'/*']});
 if(revision!==accountRevision||savingOfficeOrigin)return;
 if(savedOfficeOrigin!==origin||!document.querySelector('#office-address').value)document.querySelector('#office-address').value=origin;
 savedOfficeOrigin=origin;
 document.querySelector('#office-server').open=!granted;
 modeSelect.value=state.mode||'local';document.querySelector('#local-panel').hidden=modeSelect.value!=='local';document.querySelector('#office-panel').hidden=modeSelect.value!=='office';
 document.querySelector('#office-permission').hidden=granted;
 document.querySelector('#office-address').disabled=enabled;
 document.querySelector('#account-status').textContent=!granted?'먼저 사무실 연결을 허용해 주세요.':state.email?state.email+' · 로그인됨':'허용된 계정으로 로그인해 주세요.';
 document.querySelector('#login-form').hidden=!granted||!!state.email;document.querySelector('#logout').hidden=!state.email;
}
document.querySelector('#office-permission').onclick=async()=>{
 const button=document.querySelector('#office-permission'),status=document.querySelector('#login-status');button.disabled=true;
 try {
  if(enabled)throw Error('더빙을 끈 뒤 서버 주소를 변경해 주세요.');
  const origin=normalizeOfficeOrigin(document.querySelector('#office-address').value);
  savingOfficeOrigin=true;
  const save=chrome.storage.local.set({officeOrigin:origin,...(origin!==savedOfficeOrigin?{officeSession:null}:{})});
  const permission=chrome.permissions.request({origins:[origin+'/*']});
  await save;const granted=await permission;savingOfficeOrigin=false;
  status.textContent=granted?'':'연결을 허용해야 사무실 번역을 사용할 수 있습니다.';
  await refreshAccount();
 } catch(error){status.textContent=error.message;}finally{savingOfficeOrigin=false;button.disabled=false;}
};
document.querySelector('#office-address').oninput=()=>{document.querySelector('#office-permission').hidden=false;document.querySelector('#login-form').hidden=true;};
chrome.permissions.onAdded.addListener(()=>refreshAccount());
chrome.permissions.onRemoved.addListener(()=>refreshAccount());
modeSelect.onchange=async()=>{await chrome.storage.local.set({translationMode:modeSelect.value});await refreshAccount();};
document.querySelector('#login-form').onsubmit=async event=>{
 event.preventDefault();const button=document.querySelector('#login'),status=document.querySelector('#login-status');button.disabled=true;
 try{
  if(normalizeOfficeOrigin(document.querySelector('#office-address').value)!==savedOfficeOrigin||!await chrome.permissions.contains(officePermission())){await refreshAccount();throw Error('먼저 사무실 연결 허용 버튼을 눌러 주세요.');}
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

const rateSelect=document.querySelector('#speech-rate');
const speedValues=[1,1.025,1.05,1.075,1.1],speedLabels=['-2, 느리게','-1, 조금 느리게','0, 기본','1, 조금 빠르게','2, 빠르게'];
function updateSpeedLabel(){rateSelect.setAttribute('aria-valuetext',speedLabels[Number(rateSelect.value)]||'기본');}
rateSelect.oninput=updateSpeedLabel;
(async()=>{
 try {
  const settings=await chrome.storage.local.get('speechRate');
  const speechRate=({1.04:1,1.06:1.05,1.08:1.1,1.5:1.05,2:1.1})[settings.speechRate] ?? settings.speechRate;
  rateSelect.value=String(speedValues.includes(speechRate)?speedValues.indexOf(speechRate):2);
  updateSpeedLabel();
  rateSelect.disabled=false;
 } catch {output.textContent='속도 설정을 불러오지 못했습니다. 확장을 다시 열어 주세요.';}
})();
rateSelect.onchange=async()=>{
 const value=speedValues[Number(rateSelect.value)];
 if(value===undefined)return;
 updateSpeedLabel();
 try {await chrome.storage.local.set({speechRate:value});}
 catch {output.textContent='속도를 저장하지 못했습니다. 다시 선택해 주세요.';}
};
