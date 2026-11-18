importScripts('speech-text.js', 'remote-config.js', 'remote-client.js');
const HOST = 'com.codex.korean_dubber';
let owner = null;

// Remove credentials and model cache retained by earlier versions.
chrome.storage?.local.remove('geminiApiKey').catch(() => {});
if (typeof caches !== 'undefined') caches.delete('supertonic-3-aafc6e32').catch(() => {});

async function selectVoice(key) {
  const voices = (await chrome.tts.getVoices()).filter(v => /^ko(?:-|$)/i.test(v.lang || ''));
  const voice = voices.find(v => JSON.stringify([v.extensionId || '', v.voiceName, v.lang]) === key) || voices[0];
  if (!voice) throw Error('Chrome에서 사용할 수 있는 한국어 음성이 없습니다. 운영체제의 한국어 음성을 설치한 뒤 Chrome을 다시 시작하세요.');
  return voice;
}
function speak(text, voice, onEvent) {
  chrome.tts.speak(text, {
    ...(voice.extensionId ? {extensionId: voice.extensionId} : {}),
    voiceName: voice.voiceName, lang: voice.lang,
    rate: 1.05,
    onEvent
  });
}
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'dub' || port.sender?.frameId !== 0 ||
      !port.sender.url?.startsWith('https://www.youtube.com/')) return;
  let busy = false, closed = false, voice, mode;
  let translationController;
  let formulaSeen = new Set(), speechGeneration = 0;
  const send = msg => {if (!closed) port.postMessage(msg);};
  const current = {send};
  port.onDisconnect.addListener(() => {
    closed = true;
    translationController?.abort();
    speechGeneration++;
    if (owner === current) {owner = null; chrome.tts.stop();}
  });
  port.onMessage.addListener(async msg => {
    try {
      if (msg.type === 'open') {
        if (owner && owner !== current) owner.send({error: '다른 탭에서 더빙을 시작했습니다.'});
        owner = current;
        chrome.tts.stop();
        formulaSeen.clear();
        speechGeneration++;
        mode = await translationMode();
        if (mode === 'office') {
          const session = await officeSession();
          await officeRequest('/v1/session', {token:session.token});
        }
        voice = await selectVoice(msg.voice);
        if (closed || owner !== current) return;
        send({type: 'ready'});
      } else if (owner === current) {
        if (msg.type === 'translate' && !busy) {
          busy = true;
          try {
            translationController = new AbortController();
            const result = mode === 'office' ? await officeTranslate(msg.lines, translationController.signal) : await localTranslate(msg.lines);
            if (result.error) throw Error(result.error);
            send({type: 'result', start: msg.start, lines: result.lines});
          } finally {busy = false;}
        } else if (msg.type === 'speak') {
          const generation = ++speechGeneration;
          const pendingSeen = new Set(formulaSeen);
          const spokenText = speechText(msg.text, pendingSeen);
          speak(spokenText, voice, event => {
            if (closed || owner !== current || generation !== speechGeneration) return;
            if (event.type === 'error') send({error: event.errorMessage || '음성 재생 실패'});
            if (event.type === 'start') send({type: 'speech-start', speechId: msg.speechId});
            if (event.type === 'end') {
              formulaSeen = pendingSeen;
              send({type: 'speech-end', speechId: msg.speechId});
            }
          });
        } else if (msg.type === 'quiet') {
          speechGeneration++;
          chrome.tts.stop();
          if (msg.resetFormulas) formulaSeen.clear();
        }
      }
    } catch (error) {if (owner === current) send({error: error.message});}
  });
});
