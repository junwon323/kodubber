importScripts('speech-text.js');
const HOST = 'com.codex.korean_dubber';
let owner = null;

async function localTranslate(lines){
 try{const result=await chrome.runtime.sendNativeMessage(HOST,{lines});if(result.error)throw Error(result.error);return result;}
 catch (error) {throw Error('로컬 연결 실패: 다운로드하거나 clone한 폴더에서 Windows는 install-windows.cmd, macOS는 install.command, Linux는 sh ./install.command --no-gui를 실행하세요. CLI 설치·로그인과 상세 순서는 위의 로컬 연결 방법을 확인하세요. 원인: '+(error.message||'Chrome 연결 오류'));}
}


// Remove credentials and model cache retained by earlier versions.
for (const key of ['geminiApiKey','officeSession','officeOrigin','translationMode']) chrome.storage?.local.remove(key).catch(() => {});
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
    rate,
    onEvent
  });
}
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'dub' || port.sender?.frameId !== 0 ||
      !port.sender.url?.startsWith('https://www.youtube.com/')) return;
  let busy = false, closed = false, voice;
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
        voice = await selectVoice(msg.voice);
        if (closed || owner !== current) return;
        send({type: 'ready'});
      } else if (owner === current) {
        if (msg.type === 'translate' && !busy) {
          busy = true;
          try {
            const result = await localTranslate(msg.lines);
            if (result.error) throw Error(result.error);
            send({type: 'result', start: msg.start, lines: result.lines});
          } finally {busy = false;}
        } else if (msg.type === 'speak') {
          const generation = ++speechGeneration;
          const settings = await chrome.storage?.local.get?.('speechRate');
          if (closed || owner !== current || generation !== speechGeneration) return;
          const savedRate = ({1.04:1,1.06:1.05,1.08:1.1,1.5:1.05,2:1.1})[settings?.speechRate] ?? settings?.speechRate;
          const rate = [1,1.025,1.05,1.075,1.1].includes(savedRate) ? savedRate : 1.05;
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
