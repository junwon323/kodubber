let session = null;
let revision = 0;
let enabled = false;
let status = '대기 중';
const videoId = () => new URL(location.href).searchParams.get('v');

async function captions(v, id) {
  for (const track of v.textTracks) {
    if (!['subtitles', 'captions'].includes(track.kind) || !track.cues?.length) continue;
    return Captions.normalize(Array.from(track.cues, c => ({start: c.startTime, end: c.endTime, text: c.text})));
  }
  const raw = await new Promise((resolve, reject) => {
    const request = crypto.randomUUID();
    const timer = setTimeout(() => {
      window.removeEventListener('message', receive);
      reject(Error('자막 수집기가 응답하지 않습니다. 확장과 영상 페이지를 새로고침해 주세요.'));
    }, 10000);
    function receive(event) {
      const msg = event.data;
      if (event.source !== window || event.origin !== location.origin ||
          msg?.type !== 'korean-dubber-caption-response' ||
          msg.request !== request || msg.video !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', receive);
      if (msg.error) reject(Error(String(msg.error).slice(0, 300)));
      else if (typeof msg.raw === 'string' && msg.raw.length <= 2_000_000) resolve(msg.raw);
      else reject(Error('자막 응답 형식이 올바르지 않습니다.'));
    }
    window.addEventListener('message', receive);
    window.postMessage({type: 'korean-dubber-caption-request', request, video: id}, location.origin);
  });
  let rows;
  if (raw.trimStart().startsWith('WEBVTT')) rows = Captions.vtt(raw);
  else if (raw.trimStart().startsWith('<')) {
    const xml = new DOMParser().parseFromString(raw, 'text/xml');
    rows = Captions.normalize(Array.from(xml.querySelectorAll('text, p'), node => {
      const start = node.hasAttribute('start') ? Number(node.getAttribute('start')) :
        Number(node.getAttribute('t')) / 1000;
      const duration = node.hasAttribute('dur') ? Number(node.getAttribute('dur')) :
        Number(node.getAttribute('d')) / 1000;
      return {start, end: start + duration, text: node.textContent};
    }));
  } else {
    let data;
    try { data = JSON.parse(raw); } catch { throw Error('유튜브 자막 응답을 해석하지 못했습니다.'); }
    rows = Captions.normalize((data.events || []).filter(e => Array.isArray(e.segs)).map(e => ({
      start: e.tStartMs / 1000, end: (e.tStartMs + e.dDurationMs) / 1000,
      text: e.segs.map(s => s.utf8 || '').join('')
    })));
  }
  if (rows.length) return rows;
  throw Error('자막 응답에 시간 정보가 없습니다. CC를 껐다 켠 뒤 다시 시도해 주세요.');
}

function finish(message) {
  revision++;
  enabled = false;
  const s = session;
  session = null;
  if (s) {
    clearInterval(s.timer);
    s.events.abort();
    s.port.disconnect();
    s.resume?.();
    if (s.mutedByUs) s.video.muted = s.wasMuted;
  }
  status = message;
}

async function start({file, voice, style, rate}) {
  finish('자막 확인 중');
  enabled = true;
  const version = revision;
  const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
  const id = videoId();
  if (!video || !id) throw Error('유튜브 강의 영상 페이지를 열어 주세요.');
  const rows = Captions.group(file ? Captions.vtt(file) : await captions(video, id));
  if (version !== revision) return;
  if (videoId() !== id) return finish('영상이 변경되어 종료했습니다.');
  if (!rows.length) throw Error('시간 정보가 있는 자막을 찾지 못했습니다.');
  const port = chrome.runtime.connect({name: 'dub'});
  const s = session = {video, port, events: new AbortController(), wasMuted: video.muted, mutedByUs: false};
  const speechRate = [0.75, 0.9, 1, 1.1].includes(Number(rate)) ? Number(rate) : 0.9;
  const cache = new Map();
  let heartbeat = 0;
  let last = -1, pending = false, ready = false, talking = false;
  let generating = false;
  const useLocal = /^gemini:(Zephyr|Puck|Charon|Kore|Fenrir|Leda|Orus|Aoede|Callirrhoe|Autonoe|Enceladus|Iapetus|Umbriel|Algieba|Despina|Erinome|Algenib|Rasalgethi|Laomedeia|Achernar|Alnilam|Schedar|Gacrux|Pulcherrima|Achird|Zubenelgenubi|Vindemiatrix|Sadachbia|Sadaltager|Sulafat)$/.test(voice || '');
  let held = false, speechId = 0, speechStarted = 0, speechBoundary = Infinity;
  function hold() {
    if (!video.paused) {
      held = true;
      video.pause();
    }
  }
  function resume() {
    if (!held) return;
    held = false;
    if (video.paused && !video.ended && !video.seeking) {
      video.play().catch(() => { status = '영상의 재생 버튼을 눌러 주세요.'; });
    }
  }
  s.resume = resume;
  function quiet() {
    if (talking) port.postMessage({type: 'quiet'});
    talking = false;
    generating = false;
    speechId++;
    last = -1;
    if (s.mutedByUs) { video.muted = s.wasMuted; s.mutedByUs = false; }
  }
  function tick() {
    if (session !== s) return;
    if (videoId() !== id || !video.isConnected) return finish('영상이 변경되어 종료했습니다.');
    if (Date.now() - heartbeat > 20000) {
      heartbeat = Date.now();
      port.postMessage({type: 'heartbeat'});
    }
    if (!ready) return;
    if (document.querySelector('#movie_player.ad-showing') || video.seeking || video.ended) return quiet();
    const t = video.currentTime;
    const i = Captions.at(rows, t);
    const active = i >= 0 && t < rows[i].end;
    const next = active ? i : i + 1;
    if (!pending && next < rows.length) {
      let from = next;
      while (from < rows.length && cache.has(from) && rows[from].start < t + 60) from++;
      if (from < rows.length && !cache.has(from) && (from === next || rows[from].start < t + 60)) {
        const batch = rows.slice(from, from + (cache.size ? 24 : 6));
        pending = true;
        port.postMessage({type: 'translate', start: from, lines: batch.map(r => r.text)});
      }
    }
    if (talking) {
      if (generating) {
        hold();
        if (Date.now() - speechStarted > 180000) finish('음성 생성 시간이 초과되었습니다. 다시 시작해 주세요.');
        return;
      }
      if (Date.now() - speechStarted > 60000) return finish('음성 완료 신호를 받지 못했습니다. 다른 목소리를 선택해 주세요.');
      if (t >= speechBoundary) {
        hold();
        status = '한국어 설명이 끝나면 영상이 이어집니다';
      }
      return;
    }
    if (video.paused && !held) return;
    if (!active) {
      resume();
      status = '다음 설명 대기 중';
      return;
    }
    if (!cache.has(i)) {
      hold();
      status = '번역 준비 중 · 영상 잠시 멈춤';
      return;
    }
    if (last === i) { resume(); return; }
    last = i;
    const text = cache.get(i);
    s.wasMuted = s.mutedByUs ? s.wasMuted : video.muted;
    video.muted = true;
    s.mutedByUs = true;
    talking = true;
    generating = useLocal;
    if (generating) hold();
    speechStarted = Date.now();
    speechBoundary = rows[i + 1]?.start ?? rows[i].end;
    port.postMessage({type: 'speak', text, rate: speechRate, speechId: ++speechId});
    if (!generating) resume();
    status = generating ? '한국어 음성 생성 중 · 영상 잠시 멈춤' : '한국어 더빙 중';
  }
  port.onMessage.addListener(msg => {
    if (session !== s) return;
    if (msg.error) return finish(msg.error);
    if (msg.type === 'progress') { status = msg.text; return; }
    if (msg.type === 'speech-start' && msg.speechId === speechId) {
      generating = false;
      speechStarted = Date.now();
      resume();
      status = '한국어 더빙 중';
    }
    if (msg.type === 'ready') ready = true;
    if (msg.type === 'speech-end' && msg.speechId === speechId) {
      talking = false;
      generating = false;
      resume();
    }
    if (msg.type === 'result') {
      msg.lines.forEach((line, n) => cache.set(msg.start + n, line));
      pending = false;
    }
    tick();
  });
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message;
    if (session === s) finish(reason || '연결 종료. 다시 시작해 주세요.');
  });
  video.addEventListener('pause', () => { if (!held) quiet(); }, {signal: s.events.signal});
  video.addEventListener('seeking', () => { held = false; quiet(); }, {signal: s.events.signal});
  video.addEventListener('ended', () => { held = false; quiet(); }, {signal: s.events.signal});
  s.timer = setInterval(tick, 180);
  status = '한국어 음성 확인 중';
  if (useLocal) hold();
  port.postMessage({type: 'open', voice, style});
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'start' && !enabled) {
    const expected = revision + 1;
    start(msg).catch(e => { if (revision === expected) finish(e.message); });
  }
  if (msg.type === 'stop') finish('더빙 종료');
  reply({status, enabled});
});
window.addEventListener('pagehide', () => finish('더빙 종료'));
