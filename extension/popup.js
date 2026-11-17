const output = document.querySelector('output');
let issuing = false;
async function command(type) {
  if (issuing) return;
  issuing = true;
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    const file = document.querySelector('#file').files[0];
    if (type === 'start' && file?.size > 2_000_000) throw Error('2MB 이하의 자막을 선택하세요.');
    const reply = await chrome.tabs.sendMessage(tab.id, {type, file: type === 'start' && file ? await file.text() : null});
    output.textContent = reply.status;
  } catch (e) {
    output.textContent = e.message.includes('Receiving end') ? '유튜브 영상을 열거나 새로고침해 주세요.' : e.message;
  } finally { issuing = false; }
}
for (const id of ['start', 'stop']) document.getElementById(id).onclick = () => command(id);
command('status');
setInterval(() => command('status'), 800);
