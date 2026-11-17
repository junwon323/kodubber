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
