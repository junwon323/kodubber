const HOST = 'com.codex.korean_dubber';
let owner = null;

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'dub' || port.sender?.frameId !== 0 ||
      !port.sender.url?.startsWith('https://www.youtube.com/')) return;
  let busy = false;
  let voice;
  let closed = false;
  const send = msg => { if (!closed) port.postMessage(msg); };
  function stop() {
    if (owner === port) { chrome.tts.stop(); owner = null; }
  }
  port.onDisconnect.addListener(() => { closed = true; stop(); });
  port.onMessage.addListener(async msg => {
    try {
      if (msg.type === 'open') {
        const voices = await chrome.tts.getVoices();
        voice = voices.find(v => /^ko(?:-|$)/i.test(v.lang || ''));
        if (!voice) throw Error('Chrome에서 한국어 TTS 음성을 찾지 못했습니다. 한국어 음성 엔진을 설치하세요.');
        if (closed) return;
        if (owner && owner !== port) {
          owner.postMessage({error: '다른 탭에서 더빙을 시작했습니다.'});
          chrome.tts.stop();
        }
        owner = port;
        send({type: 'ready'});
      } else if (owner === port) {
        if (msg.type === 'translate' && !busy) {
          busy = true;
          try {
            const result = await chrome.runtime.sendNativeMessage(HOST, {lines: msg.lines});
            if (result.error) throw Error(result.error);
            send({type: 'result', start: msg.start, lines: result.lines});
          } finally { busy = false; }
        } else if (msg.type === 'speak') {
          chrome.tts.speak(msg.text, {voiceName: voice.voiceName, lang: voice.lang, rate: msg.rate,
            onEvent: e => { if (e.type === 'error') send({error: e.errorMessage || '음성 재생 실패'}); }});
        } else if (msg.type === 'quiet') chrome.tts.stop();
      }
    } catch (err) { send({error: err.message}); }
  });
});
