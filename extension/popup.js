const output = document.querySelector('#status');
const toggle = document.querySelector('#toggle');
const providerSelect = document.querySelector('#translation-provider');
const providers = {codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity', chrome: 'Chrome 번역'};
let providerReady = false;
let enabled = false;
let sequence = 0;
let updating = false;

async function loadProviders() {
  let result;
  try { result = await chrome.runtime.sendMessage({type: 'translation-providers'}); }
  catch { result = null; }
  const found = (result?.providers || []).filter(id => Object.hasOwn(providers, id) && id !== 'chrome');
  const saved = localStorage.getItem('translationProvider');
  providerSelect.replaceChildren();
  if (!found.length) {
    const prompt = new Option('번역 엔진을 선택하세요', '');
    prompt.disabled = true;
    providerSelect.add(prompt);
  }
  for (const id of [...found, 'chrome']) providerSelect.add(new Option(providers[id], id));
  providerSelect.value = found.includes(saved) ? saved : (found[0] ?? '');
  providerSelect.disabled = enabled;
  document.querySelector('#provider-note').hidden = found.length > 0;
  providerReady = true;
}
providerSelect.onchange = () => {
  const provider = providerSelect.value;
  if (provider && provider !== 'chrome') localStorage.setItem('translationProvider', provider);
  if (!updating) command('status');
};


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
    const reply = await sendToVideo(tab, {type, voice: localStorage.getItem('voice') || '', provider: providerSelect.value});
    if (request !== sequence) return;
    enabled = reply.enabled;
    toggle.textContent = enabled ? '더빙 끄기' : '더빙 켜기';
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.disabled = !enabled && (!providerReady || !providerSelect.value);
    providerSelect.disabled = !providerReady || enabled;
    document.querySelector('#voice').disabled = enabled;
    output.textContent = reply.status;
  } catch (e) {
    if (request !== sequence) return;
    toggle.disabled = type === 'status' || (!enabled && !providerSelect.value);
    output.textContent = e.message.includes('Receiving end') ? '유튜브 영상을 열거나 새로고침해 주세요.' : e.message;
  }
}

toggle.onclick = async () => {
  updating = true;
  toggle.disabled = true;
  try { await command(enabled ? 'stop' : 'start'); }
  finally { updating = false; }
};
loadProviders().then(() => command('status'));
setInterval(() => { if (!updating) command('status'); }, 800);

async function loadVoices() {
 const select=document.querySelector('#voice'), note=document.querySelector('#voice-note');
 try {
  const voices=[...new Map((await chrome.tts.getVoices()).filter(v=>/^ko(?:-|$)/i.test(v.lang||'')).map(v=>[voiceKey(v),v])).values()];
  const saved=localStorage.getItem('voice')||'';
  select.replaceChildren();
  for(const voice of voices) {
   const key=voiceKey(voice);
   select.add(new Option(voice.voiceName,key));
  }
  select.value=voices.some(v=>voiceKey(v)===saved)?saved:(voices[0]?voiceKey(voices[0]):'');
  localStorage.setItem('voice',select.value);
  document.querySelector('#voice-picker').hidden=voices.length<2;
  note.hidden=voices.length>0;
  note.textContent=voices.length?'':'한국어 음성이 없습니다. 운영체제에 한국어 음성을 추가해 주세요.';
 } catch {note.hidden=false;note.textContent='음성 목록을 가져오지 못했습니다. 확장을 다시 열어 주세요.';}
}
document.querySelector('#voice').onchange=event=>localStorage.setItem('voice',event.target.value);
loadVoices();

const rateSelect=document.querySelector('#speech-rate');
const speedLabels=['-2, 느리게','-1, 조금 느리게','0, 기본','1, 조금 빠르게','2, 빠르게'];
function updateSpeedLabel(){rateSelect.setAttribute('aria-valuetext',speedLabels[Number(rateSelect.value)]||'기본');}
rateSelect.oninput=updateSpeedLabel;
(async()=>{
 try {
  const settings=await chrome.storage.local.get('speechRate');
  const speechRate=normalizedSpeechRate(settings.speechRate);
  rateSelect.value=String(speechRates.indexOf(speechRate));
  updateSpeedLabel();
  rateSelect.disabled=false;
 } catch {output.textContent='속도 설정을 불러오지 못했습니다. 확장을 다시 열어 주세요.';}
})();
rateSelect.onchange=async()=>{
 const value=speechRates[Number(rateSelect.value)];
 if(value===undefined)return;
 updateSpeedLabel();
 try {await chrome.storage.local.set({speechRate:value});}
 catch {output.textContent='속도를 저장하지 못했습니다. 다시 선택해 주세요.';}
};
