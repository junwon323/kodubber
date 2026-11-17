const HOST = 'com.codex.korean_dubber';
let owner = null;
let previewToken = null;
let nextToken = 0;
let localRevision = 0;
let lifecycle = Promise.resolve();
const gemini = voice => /^gemini:(Zephyr|Puck|Charon|Kore|Fenrir|Leda|Orus|Aoede|Callirrhoe|Autonoe|Enceladus|Iapetus|Umbriel|Algieba|Despina|Erinome|Algenib|Rasalgethi|Laomedeia|Achernar|Alnilam|Schedar|Gacrux|Pulcherrima|Achird|Zubenelgenubi|Vindemiatrix|Sadachbia|Sadaltager|Sulafat)$/.test(voice || '');
const local = gemini;
const storageReady = chrome.storage?.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});

function ensureLocal() {
  lifecycle = lifecycle.catch(() => {}).then(async () => {
    const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
    if (!contexts.length) await chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['WORKERS', 'AUDIO_PLAYBACK'],
      justification: 'Generate Korean speech in a dedicated worker and play the result.'
    });
  });
  return lifecycle;
}
function releaseLocal() {
  lifecycle = lifecycle.catch(() => {}).then(async () => {
    if (owner || previewToken) return;
    const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
    if (contexts.length) await chrome.offscreen.closeDocument();
  }).catch(() => {});
}
async function localCommand(msg) {
  const revision = msg.type === 'prepare' ? localRevision : ++localRevision;
  await ensureLocal();
  if (revision !== localRevision || (owner?.token !== msg.token && previewToken !== msg.token)) return;
  if (gemini(msg.voice)) {
    await storageReady;
    const settings = await chrome.storage.local.get('geminiApiKey');
    if (!settings.geminiApiKey) throw Error('확장 설정에서 Gemini API 키를 저장해 주세요.');
    msg = {...msg, apiKey: settings.geminiApiKey};
  }
  const result = await chrome.runtime.sendMessage({target: 'local-speech', ...msg});
  if (result?.error) throw Error(result.error);
  return result;
}
function quietLocal() {
  localRevision++;
  chrome.runtime.sendMessage({target: 'local-speech', type: 'stop'}).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg.target === 'speech-events' && sender.url === chrome.runtime.getURL('offscreen.html')) {
    if (owner?.token === msg.token) {
      if (msg.type === 'progress') owner.send({type: 'progress', text: msg.text});
      if (msg.type === 'start') owner.send({type: 'speech-start', speechId: msg.speechId});
      if (msg.type === 'end') owner.send({type: 'speech-end', speechId: msg.speechId});
      if (msg.type === 'error') owner.send({error: msg.error});
    }
    if (previewToken === msg.token) {
      chrome.runtime.sendMessage({target: 'preview-status', text: msg.error || msg.text ||
        (msg.type === 'end' ? '미리듣기 완료' : '음성 재생 중')}).catch(() => {});
      if (['end', 'error'].includes(msg.type)) { previewToken = null; releaseLocal(); }
    }
  }
  if (msg.type === 'preview' && sender.url === chrome.runtime.getURL('popup.html')) {
    if (owner) { reply({error: '더빙을 끈 뒤 미리듣기를 눌러 주세요.'}); return; }
    if (!local(msg.voice)) { reply({error: 'Gemini 목소리를 선택해 주세요.'}); return; }
    const token = previewToken = 'preview-' + ++nextToken;
    localCommand({type: 'speak', token, voice: msg.voice, rate: msg.rate,
      text: '안녕하세요. 이진 탐색은 정렬된 배열에서 탐색 범위를 절반으로 줄이는 방법입니다.'})
      .then(() => reply({ok: true})).catch(error => {
        if (previewToken === token) { previewToken = null; releaseLocal(); }
        reply({error: error.message});
      });
    return true;
  }
  if (msg.type === 'preview-stop' && sender.url === chrome.runtime.getURL('popup.html')) {
    if (previewToken) { previewToken = null; quietLocal(); releaseLocal(); }
    reply({ok: true});
  }
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'dub' || port.sender?.frameId !== 0 ||
      !port.sender.url?.startsWith('https://www.youtube.com/')) return;
  let busy = false, closed = false, voice, style, useLocal = false;
  const send = msg => { if (!closed) port.postMessage(msg); };
  const current = {token: 'dub-' + ++nextToken, send};
  function stop() {
    if (owner !== current) return;
    owner = null;
    chrome.tts.stop();
    quietLocal();
    releaseLocal();
  }
  port.onDisconnect.addListener(() => { closed = true; stop(); });
  port.onMessage.addListener(async msg => {
    try {
      if (msg.type === 'open') {
        if (owner && owner !== current) owner.send({error: '다른 탭에서 더빙을 시작했습니다.'});
        owner = current;
        previewToken = null;
        chrome.tts.stop();
        quietLocal();
        style = msg.style || 'lecture';
        useLocal = local(msg.voice);
        if (useLocal) {
          voice = msg.voice;
          send({type: 'progress', text: 'Gemini 음성 연결 준비 중'});
          await localCommand({type: 'init', token: current.token, voice});
        } else {
          const voices = await chrome.tts.getVoices();
          const korean = voices.filter(v => /^ko(?:-|$)/i.test(v.lang || ''));
          voice = korean.find(v => JSON.stringify([v.extensionId || '', v.voiceName, v.lang]) === msg.voice) || korean[0];
          if (!voice) throw Error('한국어 음성이 없습니다. Gemini 목소리를 선택해 주세요.');
        }
        if (closed || owner !== current) return;
        send({type: 'ready'});
      } else if (owner === current) {
        if (msg.type === 'translate' && !busy) {
          busy = true;
          try {
            const result = await chrome.runtime.sendNativeMessage(HOST, {lines: msg.lines, ...(style === 'lecture' ? {} : {style})});
            if (result.error) throw Error(result.error);
            send({type: 'result', start: msg.start, lines: result.lines});
          } finally { busy = false; }
        } else if (msg.type === 'speak') {
          if (useLocal) {
            await localCommand({type: 'speak', token: current.token, voice,
              text: msg.text, rate: msg.rate, speechId: msg.speechId});
          } else {
            chrome.tts.speak(msg.text, {
              ...(voice.extensionId ? {extensionId: voice.extensionId} : {}),
              voiceName: voice.voiceName, lang: voice.lang,
              rate: [0.75, 0.9, 1, 1.1].includes(msg.rate) ? msg.rate : 0.9,
              onEvent: e => {
                if (e.type === 'error') send({error: e.errorMessage || '음성 재생 실패'});
                if (e.type === 'start') send({type: 'speech-start', speechId: msg.speechId});
                if (e.type === 'end') send({type: 'speech-end', speechId: msg.speechId});
              }
            });
          }
        } else if (msg.type === 'prepare' && useLocal) {
          await localCommand({type: 'prepare', token: current.token, voice,
            text: msg.text, rate: msg.rate});
        } else if (msg.type === 'quiet') {
          chrome.tts.stop();
          if (useLocal) quietLocal();
        }
      }
    } catch (err) {
      if (owner === current) send({error: err.message});
    }
  });
});

// Release the retired local model cache after updating the extension.
if (typeof caches !== 'undefined') {
  caches.delete('supertonic-3-aafc6e32').catch(() => {});
}
