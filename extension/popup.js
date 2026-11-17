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
  const group = document.createElement('optgroup');
  group.label = 'Supertonic · 이 컴퓨터에서 생성';
  for (const gender of ['F', 'M']) for (let n = 1; n <= 5; n++) {
    group.append(new Option((gender === 'F' ? '여성' : '남성') + ' ' + n, 'local:' + gender + n));
  }
  voice.prepend(group);
  const voices = await chrome.tts.getVoices();
  for (const v of voices.filter(v => /^ko(?:-|$)/i.test(v.lang || ''))) {
    const key = JSON.stringify([v.extensionId || '', v.voiceName, v.lang]);
    voice.add(new Option(v.voiceName, key));
  }
  voice.value = localStorage.getItem('voice') || 'local:F1';
  if (voice.selectedIndex < 0) voice.value = '';
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
  previewStatus.textContent = '로컬 음성 준비 중';
  try {
    const result = await chrome.runtime.sendMessage({type: 'preview', voice: voice.value, rate: Number(rate.value)});
    if (result.error) previewStatus.textContent = result.error;
  } catch (error) { previewStatus.textContent = error.message; }
};
document.querySelector('#preview-stop').onclick = async () => {
  await chrome.runtime.sendMessage({type: 'preview-stop'});
  previewStatus.textContent = '미리듣기 중지';
};
