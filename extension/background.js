importScripts('preferences.js', 'speech-text.js');
const HOST = 'com.codex.korean_dubber';
let owner = null;

const cliProviders = ['codex', 'claude', 'antigravity'];

async function localTranslate(lines, provider) {
  let result;
  try {
    result = await chrome.runtime.sendNativeMessage(HOST, {lines, provider});
  } catch {
    throw Error('로컬 연결 실패. README의 안내에 따라 연결 파일을 다시 실행해 주세요.');
  }
  if (result.error) throw Error(result.error);
  return result;
}

chrome.runtime.onMessage?.addListener((msg, sender, reply) => {
  if (msg.type !== 'translation-providers' || sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL('popup.html')) return;
  chrome.runtime.sendNativeMessage(HOST, {action: 'providers'})
    .then(result => reply({
      connected: Array.isArray(result.providers),
      providers: Array.isArray(result.providers) ? cliProviders.filter(id => result.providers.includes(id)) : [],
    }))
    .catch(() => reply({connected: false, providers: []}));
  return true;
});

// Remove credentials and model cache retained by earlier versions.
for (const key of ['geminiApiKey','officeSession','officeOrigin','translationMode']) chrome.storage?.local.remove(key).catch(() => {});
if (typeof caches !== 'undefined') caches.delete('supertonic-3-aafc6e32').catch(() => {});

async function selectVoice(key) {
  const voices = (await chrome.tts.getVoices()).filter(v => /^ko(?:-|$)/i.test(v.lang || ''));
  const voice = voices.find(v => voiceKey(v) === key) || voices[0];
  if (!voice) throw Error('Chrome에서 사용할 수 있는 한국어 음성이 없습니다. 운영체제의 한국어 음성을 설치한 뒤 Chrome을 다시 시작하세요.');
  return voice;
}
function speak(text, voice, rate, onEvent) {
  chrome.tts.speak(text, {
    ...(voice.extensionId ? {extensionId: voice.extensionId} : {}),
    voiceName: voice.voiceName, lang: voice.lang,
    rate,
    onEvent
  });
}
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'dub' || port.sender?.frameId !== 0 ||
      !port.sender.url?.startsWith('https://www.youtube.com/')) return;
  let busy = false, closed = false, voice, provider;
  let formulaSeen = new Set(), speechGeneration = 0;
  const send = msg => {if (!closed) port.postMessage(msg);};
  const current = {send};
  port.onDisconnect.addListener(() => {
    closed = true;
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
        provider = msg.provider || 'codex';
        if (provider !== 'chrome' && !cliProviders.includes(provider)) throw Error('지원하지 않는 번역 엔진입니다.');
        voice = await selectVoice(msg.voice);
        if (closed || owner !== current) return;
        send({type: 'ready'});
      } else if (owner === current) {
        if (msg.type === 'translate' && provider !== 'chrome' && !busy) {
          busy = true;
          try {
            const result = await localTranslate(msg.lines, provider);
            send({type: 'result', start: msg.start, lines: result.lines});
          } finally {busy = false;}
        } else if (msg.type === 'speak') {
          const generation = ++speechGeneration;
          const settings = await chrome.storage?.local.get?.('speechRate');
          if (closed || owner !== current || generation !== speechGeneration) return;
          const rate = normalizedSpeechRate(settings?.speechRate);
          const pendingSeen = new Set(formulaSeen);
          const spokenText = speechText(msg.text, pendingSeen);
          speak(spokenText, voice, rate, event => {
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
