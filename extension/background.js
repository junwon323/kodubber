const HOST = 'com.codex.korean_dubber';
let owner = null;
let previewToken = 0;

// Remove credentials and model cache retained by earlier versions.
chrome.storage?.local.remove('geminiApiKey').catch(() => {});
if (typeof caches !== 'undefined') caches.delete('supertonic-3-aafc6e32').catch(() => {});

async function selectVoice(key) {
  const voices = (await chrome.tts.getVoices()).filter(v => /^ko(?:-|$)/i.test(v.lang || ''));
  const voice = voices.find(v => JSON.stringify([v.extensionId || '', v.voiceName, v.lang]) === key) || voices[0];
  if (!voice) throw Error('Chrome에서 사용할 수 있는 한국어 음성이 없습니다. 운영체제의 한국어 음성을 설치한 뒤 Chrome을 다시 시작하세요.');
  return voice;
}
function speak(text, voice, rate, onEvent) {
  chrome.tts.speak(text, {
    ...(voice.extensionId ? {extensionId: voice.extensionId} : {}),
    voiceName: voice.voiceName, lang: voice.lang,
    rate: [0.75, 0.9, 1, 1.1].includes(rate) ? rate : 0.9,
    onEvent
  });
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
  if (msg.type === 'preview') {
    if (owner) {reply({error: '더빙을 끈 뒤 미리듣기를 눌러 주세요.'}); return;}
    const token = ++previewToken;
    chrome.tts.stop();
    selectVoice(msg.voice).then(voice => {
      if (token !== previewToken || owner) {reply({ok: true}); return;}
      speak('안녕하세요. 이진 탐색은 정렬된 배열에서 탐색 범위를 절반으로 줄이는 방법입니다.', voice, msg.rate, event => {
        if (token !== previewToken || owner) return;
        const text = event.type === 'error' ? event.errorMessage || '음성 재생 실패' :
          event.type === 'start' ? '음성 재생 중' : event.type === 'end' ? '미리듣기 완료' : null;
        if (text) chrome.runtime.sendMessage({target: 'preview-status', text}).catch(() => {});
      });
      reply({ok: true});
    }).catch(error => reply({error: error.message}));
    return true;
  }
  if (msg.type === 'preview-stop') {
    previewToken++;
    if (!owner) chrome.tts.stop();
    reply({ok: true});
  }
});
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'dub' || port.sender?.frameId !== 0 ||
      !port.sender.url?.startsWith('https://www.youtube.com/')) return;
  let busy = false, closed = false, voice, style;
  const send = msg => {if (!closed) port.postMessage(msg);};
  const current = {send};
  port.onDisconnect.addListener(() => {
    closed = true;
    if (owner === current) {owner = null; chrome.tts.stop();}
  });
  port.onMessage.addListener(async msg => {
    try {
      if (msg.type === 'open') {
        if (owner && owner !== current) owner.send({error: '다른 탭에서 더빙을 시작했습니다.'});
        owner = current;
        previewToken++;
        chrome.tts.stop();
        style = msg.style || 'lecture';
        voice = await selectVoice(msg.voice);
        if (closed || owner !== current) return;
        send({type: 'ready'});
      } else if (owner === current) {
        if (msg.type === 'translate' && !busy) {
          busy = true;
          try {
            const result = await chrome.runtime.sendNativeMessage(HOST, {lines: msg.lines, ...(style === 'lecture' ? {} : {style})});
            if (result.error) throw Error(result.error);
            send({type: 'result', start: msg.start, lines: result.lines});
          } finally {busy = false;}
        } else if (msg.type === 'speak') {
          speak(msg.text, voice, msg.rate, event => {
            if (owner !== current) return;
            if (event.type === 'error') send({error: event.errorMessage || '음성 재생 실패'});
            if (event.type === 'start') send({type: 'speech-start', speechId: msg.speechId});
            if (event.type === 'end') send({type: 'speech-end', speechId: msg.speechId});
          });
        } else if (msg.type === 'quiet') chrome.tts.stop();
      }
    } catch (error) {if (owner === current) send({error: error.message});}
  });
});
