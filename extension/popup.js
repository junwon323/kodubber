const output = document.querySelector('#status');
const toggle = document.querySelector('#toggle');
const voice = document.querySelector('#voice');
const rate = document.querySelector('#rate');
rate.value = localStorage.getItem('rate') || '0.9';
if (!rate.value) rate.value = '0.9';
rate.onchange = () => localStorage.setItem('rate', rate.value);
const style = document.querySelector('#style');
style.value = localStorage.getItem('style') || 'lecture';
if (!style.value) style.value = 'lecture';
style.onchange = () => localStorage.setItem('style', style.value);
voice.onchange = () => localStorage.setItem('voice', voice.value);

async function loadVoices() {
  const cloud = document.createElement('optgroup');
  cloud.label = 'Gemini · 온라인 음성 (API 키 필요)';
  for (const name of ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"]) cloud.append(new Option(name, 'gemini:' + name));
  voice.prepend(cloud);
  const voices = await chrome.tts.getVoices();
  for (const v of voices.filter(v => /^ko(?:-|$)/i.test(v.lang || ''))) {
    const key = JSON.stringify([v.extensionId || '', v.voiceName, v.lang]);
    voice.add(new Option(v.voiceName, key));
  }
  voice.value = localStorage.getItem('voice') ?? 'gemini:Kore';
  if (voice.selectedIndex < 0) {
    voice.value = 'gemini:Kore';
    localStorage.setItem('voice', voice.value);
  }
}
let enabled = false;
let sequence = 0;
let updating = false;

async function command(type) {
  const request = ++sequence;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const file = document.querySelector('#file').files[0];
    if (type === 'start' && file?.size > 2_000_000) throw Error('2MB 이하의 자막을 선택하세요.');
    const reply = await chrome.tabs.sendMessage(tab.id, {type, voice: voice.value, style: style.value, rate: Number(rate.value), file: type === 'start' && file ? await file.text() : null});
    if (request !== sequence) return;
    enabled = reply.enabled;
    voice.disabled = style.disabled = rate.disabled = enabled;
    document.querySelector('#preview').disabled = enabled;
    toggle.textContent = enabled ? '더빙 끄기' : '더빙 켜기';
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.disabled = false;
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
loadVoices().finally(() => {
  command('status');
  setInterval(() => { if (!updating) command('status'); }, 800);
});

const previewStatus = document.querySelector('#preview-status');
chrome.runtime.onMessage.addListener(msg => {
  if (msg.target === 'preview-status') previewStatus.textContent = msg.text;
});
document.querySelector('#preview').onclick = async () => {
  previewStatus.textContent = voice.value.startsWith('gemini:') ? 'Gemini 음성 생성 중' : '음성 준비 중';
  try {
    const result = await chrome.runtime.sendMessage({type: 'preview', voice: voice.value, rate: Number(rate.value)});
    if (result.error) previewStatus.textContent = result.error;
  } catch (error) { previewStatus.textContent = error.message; }
};
document.querySelector('#preview-stop').onclick = async () => {
  await chrome.runtime.sendMessage({type: 'preview-stop'});
  previewStatus.textContent = '미리듣기 중지';
};

const keyStatus = document.querySelector('#key-status');
async function updateKeyStatus() {
  await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  const settings = await chrome.storage.local.get('geminiApiKey');
  keyStatus.textContent = settings.geminiApiKey ? 'API 키가 저장되어 있습니다.' : '저장된 API 키가 없습니다.';
}
document.querySelector('#save-key').onclick = async () => {
  try {
    const input = document.querySelector('#gemini-key');
    const key = input.value.trim();
    if (!key || /\s/.test(key)) throw Error('올바른 API 키를 입력해 주세요.');
    await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
    await chrome.storage.local.set({geminiApiKey: key});
    input.value = '';
    voice.value = 'gemini:Kore';
    localStorage.setItem('voice', voice.value);
    await updateKeyStatus();
  } catch (error) {keyStatus.textContent = error.message;}
};
document.querySelector('#delete-key').onclick = async () => {
  await chrome.storage.local.remove('geminiApiKey');
  document.querySelector('#gemini-key').value = '';
  await updateKeyStatus();
};
updateKeyStatus().catch(error => {keyStatus.textContent = error.message;});
