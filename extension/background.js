const HOST = 'com.codex.korean_dubber';
let owner = null;

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'dub' || port.sender?.frameId !== 0 ||
      !port.sender.url?.startsWith('https://www.youtube.com/')) return;
  let busy = false;
  let voice;
  let style;
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
        const korean = voices.filter(v => /^ko(?:-|$)/i.test(v.lang || ''));
        voice = korean.find(v => JSON.stringify([v.extensionId || '', v.voiceName, v.lang]) === msg.voice) || korean[0];
        style = msg.style || 'lecture';
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
            const result = await chrome.runtime.sendNativeMessage(HOST, {lines: msg.lines, ...(style === 'lecture' ? {} : {style})});
            if (result.error) throw Error(result.error);
            send({type: 'result', start: msg.start, lines: result.lines});
          } finally { busy = false; }
        } else if (msg.type === 'speak') {
          chrome.tts.speak(msg.text, {...(voice.extensionId ? {extensionId: voice.extensionId} : {}), voiceName: voice.voiceName, lang: voice.lang, rate: [0.75, 0.9, 1, 1.1].includes(msg.rate) ? msg.rate : 0.9,
            onEvent: e => {
              if (e.type === 'error') send({error: e.errorMessage || '음성 재생 실패'});
              if (e.type === 'end') send({type: 'speech-end', speechId: msg.speechId});
            }});
        } else if (msg.type === 'quiet') chrome.tts.stop();
      }
    } catch (err) { send({error: err.message}); }
  });
});
