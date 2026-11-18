(()=>{
if(globalThis.__koreanDubberPlayerInstalled)return;
globalThis.__koreanDubberPlayerInstalled=true;
let session = null;
let revision = 0;
let enabled = false;
let status = '대기 중';
let ccLease = null;
function enableCC(id) {
  const button = document.querySelector('.ytp-subtitles-button');
  if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
  const pressed = button.getAttribute('aria-pressed');
  if (!['true', 'false'].includes(pressed)) return;
  ccLease = {id, button, original: pressed, expected: pressed};
  if (pressed === 'false') {
    button.click();
    ccLease.expected = 'true';
  }
}
async function refreshCC(id, version) {
  const lease = ccLease;
  const current = () => revision === version && ccLease === lease && lease &&
    videoId() === id && lease.button.isConnected && !lease.button.disabled &&
    lease.button.getAttribute('aria-pressed') === lease.expected;
  if (!current()) return false;
  if (lease.expected === 'true') {
    lease.button.click(); lease.expected = 'false';
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!current()) return false;
  lease.button.click(); lease.expected = 'true';
  await new Promise(resolve => setTimeout(resolve, 1000));
  return !!current();
}
async function collectCaptions(video, id, version) {
  try { return await captions(video, id); }
  catch (error) {
    if (version !== revision || videoId() !== id) return [];
    if (error.retryable === false) throw error;
    status = '자막을 자동으로 다시 불러오는 중';
    if (!await refreshCC(id, version)) {
      if (version !== revision || videoId() !== id) return [];
      throw Error('자막을 자동으로 켜지 못했습니다. 영상 페이지를 새로고침한 뒤 다시 더빙을 켜 주세요.');
    }
    try { return await captions(video, id); }
    catch (retryError) {
      if (retryError.retryable === false) throw retryError;
      throw Error('자막을 자동으로 다시 불러왔지만 확보하지 못했습니다. 영상 페이지를 새로고침한 뒤 다시 더빙을 켜 주세요.');
    }
  }
}
function hideCC() {
  const lease = ccLease;
  if (!lease || videoId() !== lease.id || !lease.button.isConnected) return;
  if (lease.button.getAttribute('aria-pressed') === 'true') {
    lease.button.click();
    lease.expected = 'false';
  }
}
function restoreCC() {
  const lease = ccLease;
  ccLease = null;
  if (lease && videoId() === lease.id && lease.button.isConnected &&
      lease.button.getAttribute('aria-pressed') === lease.expected &&
      lease.expected !== lease.original) lease.button.click();
}
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
      if (msg.error) reject(Object.assign(Error(String(msg.error).slice(0, 300)), {retryable:msg.retryable !== false}));
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
    rows = Captions.json(data);
  }
  if (rows.length) return rows;
  throw Error('자막 응답에 시간 정보가 없습니다.');
}

function finish(message) {
  revision++;
  restoreCC();
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

async function start({file, voice}) {
  finish('자막 확인 중');
  enabled = true;
  const version = revision;
  const id = videoId();
  if (!id) throw Error('유튜브 영상 페이지를 열어 주세요.');
  let video = document.querySelector('video.html5-main-video') || document.querySelector('video');
  for (let attempt = 0; !video && attempt < 20; attempt++) {
    status = '영상 플레이어가 준비되기를 기다리는 중';
    await new Promise(resolve => setTimeout(resolve, 250));
    if (version !== revision || videoId() !== id) return;
    video = document.querySelector('video.html5-main-video') || document.querySelector('video');
  }
  if (!video) throw Error('영상 플레이어가 아직 준비되지 않았습니다. 영상이 표시된 뒤 더빙을 다시 켜 주세요.');
  enableCC(id);
  const rows = Captions.group(file ? Captions.vtt(file) : await collectCaptions(video, id, version));
  if (version !== revision) return;
  if (videoId() !== id) return finish('영상이 변경되어 종료했습니다.');
  if (!rows.length) throw Error('시간 정보가 있는 자막을 찾지 못했습니다.');
  hideCC();
  const port = chrome.runtime.connect({name: 'dub'});
  const s = session = {video, port, events: new AbortController(), wasMuted: video.muted, mutedByUs: false};
  const cache = new Map();
  let heartbeat = 0;
  let last = -1, pending = null, ready = false, talking = false;
  let buffering = true;
  const startupSeconds = 45, aheadSeconds = 180;
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
  function quiet(resetFormulas = false) {
    if (talking || resetFormulas) port.postMessage({type: 'quiet', resetFormulas});
    talking = false;
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
    // Contiguous cached coverage matters: a cached distant batch cannot fill a seek gap.
    let missing = next;
    while (missing < rows.length && cache.has(missing)) missing++;
    const coveredUntil = missing < rows.length ? rows[missing].start : Infinity;
    if (!pending && missing < rows.length && coveredUntil < t + 120) {
      let end = missing;
      while (end < rows.length && end - missing < 24 &&
             rows[end].start < t + aheadSeconds && !cache.has(end)) end++;
      const batch = rows.slice(missing, end);
      pending = {start: missing, count: batch.length};
      port.postMessage({type: 'translate', start: missing, lines: batch.map(r => r.text)});
    }
    if (buffering && !talking) {
      if (coveredUntil < t + startupSeconds) {
        hold();
        status = '미리 번역 중 · 준비되면 자동으로 재생합니다';
        return;
      }
      buffering = false;
      resume();
    }
    if (talking) {
      if (Date.now() - speechStarted > 120000) return finish('음성 완료 신호를 받지 못했습니다. 다른 목소리를 선택해 주세요.');
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
      buffering = true;
      hold();
      status = '다음 구간을 미리 번역 중 · 준비되면 이어집니다';
      return;
    }
    if (last === i) { resume(); status = '다음 문장 시작 대기 중'; return; }
    last = i;
    const text = cache.get(i);
    s.wasMuted = s.mutedByUs ? s.wasMuted : video.muted;
    video.muted = true;
    s.mutedByUs = true;
    talking = true;
    speechStarted = Date.now();
    speechBoundary = rows[i + 1]?.start ?? rows[i].end;
    port.postMessage({type: 'speak', text, speechId: ++speechId});
    resume();
    status = '한국어 더빙 중';
  }
  port.onMessage.addListener(msg => {
    if (session !== s) return;
    if (msg.error) return finish(msg.error);
    if (msg.type === 'progress') { status = msg.text; return; }
    if (msg.type === 'speech-start' && msg.speechId === speechId) {
      speechStarted = Date.now();
      resume();
      status = '한국어 더빙 중';
    }
    if (msg.type === 'ready') ready = true;
    if (msg.type === 'speech-end' && msg.speechId === speechId) {
      talking = false;
      resume();
    }
    if (msg.type === 'result') {
      if (!pending || msg.start !== pending.start) return;
      if (!Array.isArray(msg.lines) || msg.lines.length !== pending.count ||
          msg.lines.some(line => typeof line !== 'string' || !line.trim())) {
        return finish('번역 결과가 누락되었습니다. 다시 시작해 주세요.');
      }
      msg.lines.forEach((line, n) => cache.set(msg.start + n, line));
      pending = null;
    }
    tick();
  });
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message;
    if (session === s) finish(reason || '연결 종료. 다시 시작해 주세요.');
  });
  video.addEventListener('pause', () => { if (!held) quiet(); }, {signal: s.events.signal});
  video.addEventListener('seeking', () => { buffering = true; quiet(true); }, {signal: s.events.signal});
  video.addEventListener('ended', () => { held = false; quiet(); }, {signal: s.events.signal});
  s.timer = setInterval(tick, 180);
  hold();
  status = '한국어 음성 확인 및 미리 번역 준비 중';
  port.postMessage({type: 'open', voice});
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

})();
