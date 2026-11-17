// Keys stay in extension-owned contexts, never in YouTube content scripts.
let controller;
let queue = Promise.resolve();
let revision = 0;
let credential;
let blocked = false;
const cache = new Map();
self.onmessage = ({data: msg}) => {
  if (msg.type === 'cancel') {revision++; controller?.abort(); return;}
  const version = revision;
  queue = queue.catch(() => {}).then(async () => {
    try {
      if (version !== revision) throw Error('음성 생성이 취소되었습니다.');
      if (credential !== msg.apiKey) {credential = msg.apiKey; cache.clear(); blocked = false;}
      if (!credential) throw Error('Gemini API 키를 저장해 주세요.');
      if (msg.type === 'init') {self.postMessage({id: msg.id, type: 'ready'}); return;}
      if (blocked) throw Error('Gemini 사용 한도에 도달했습니다. 한도를 확인한 뒤 더빙을 다시 시작하세요.');
      if (!/^gemini:(Fola|Kore|Puck|Charon|Aoede)$/.test(msg.voice) || typeof msg.text !== 'string' || !msg.text.trim() || msg.text.length > 4000) throw Error('Gemini 음성 또는 문장이 올바르지 않습니다.');
      const key = JSON.stringify([msg.voice, msg.text]);
      let wav = cache.get(key);
      if (!wav) {
        self.postMessage({id: msg.id, type: 'progress', text: 'Gemini 한국어 음성 생성 중 · 영상 잠시 멈춤'});
        controller = new AbortController();
        const timer = setTimeout(() => controller?.abort(), 90000);
        try {
          const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
            method: 'POST', signal: controller.signal,
            headers: {'Content-Type': 'application/json', 'x-goog-api-key': credential},
            body: JSON.stringify({model: 'gemini-3.8-flash-tts', store: false,
              input: [{type: 'user_input', content: [{type: 'text', text: msg.text}]}],
              response_format: {type: 'audio'},
              generation_config: {speech_config: [{voice: msg.voice.slice(7)}]}})
          });
          if (response.status === 429) {blocked = true; throw Error('Gemini 무료 사용량 또는 요청 속도 한도에 도달했습니다. 자동 재시도하지 않습니다. AI Studio에서 한도를 확인하세요.');}
          if ([400, 401, 403].includes(response.status)) throw Error('Gemini API 키 또는 모델 접근 권한을 확인하세요. 무료 등급 프로젝트의 키가 필요합니다.');
          if (!response.ok) throw Error('Gemini 음성 요청 실패 (HTTP ' + response.status + '). 잠시 후 다시 시작하세요.');
          const data = await response.json();
          const parts = (data.steps || []).filter(s => s.type === 'model_output').flatMap(s => s.content || []);
          const output = data.output_audio || parts.filter(p => p.type === 'audio').at(-1);
          if (!output?.data) throw Error('Gemini가 음성을 반환하지 않았습니다.');
          const bytes = Uint8Array.from(atob(output.data), c => c.charCodeAt(0));
          if (String.fromCharCode(...bytes.slice(0,4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8,12)) !== 'WAVE') throw Error('Gemini 응답이 WAV 음성 형식이 아닙니다.');
          wav = bytes.buffer;
          if (version !== revision) throw Error('음성 생성이 취소되었습니다.');
          cache.set(key, wav);
          while (cache.size > 3) cache.delete(cache.keys().next().value);
        } finally {clearTimeout(timer); controller = null;}
      }
      self.postMessage({id: msg.id, type: 'audio', wav});
    } catch (error) {
      if (version !== revision) {self.postMessage({id: msg.id, type: 'ready'}); return;}
      self.postMessage({id: msg.id, type: 'error', error: error.name === 'AbortError' ? 'Gemini 음성 요청이 취소되었거나 시간이 초과되었습니다.' : error.message});
    }
  });
};
