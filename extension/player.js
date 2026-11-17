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
  // Reuse the caption URL requested by this player's CC control, including its signed parameters.
  for (const entry of performance.getEntriesByType('resource').reverse()) {
    const url = new URL(entry.name, location.href);
    if (url.origin !== location.origin || url.pathname !== '/api/timedtext' || url.searchParams.get('v') !== id) continue;
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(5000)});
      if (!response.ok) continue;
      const raw = await response.text();
      if (raw.trimStart().startsWith('WEBVTT')) return Captions.vtt(raw);
      const events = JSON.parse(raw).events || [];
      const rows = Captions.normalize(events.filter(e => e.segs).map(e => ({
        start: e.tStartMs / 1000, end: (e.tStartMs + e.dDurationMs) / 1000,
        text: e.segs.map(s => s.utf8 || '').join('')
      })));
      if (rows.length) return rows;
    } catch { /* Try an earlier response for the same video. */ }
  }
  throw Error('영상의 자막(CC)을 켜고 다시 시작하거나 VTT 파일을 선택하세요.');
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
    if (s.mutedByUs) s.video.muted = s.wasMuted;
  }
  status = message;
}

async function start(file) {
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
  const cache = new Map();
  let heartbeat = 0;
  let last = -1, pending = false, ready = false, talking = false;
  function quiet() {
    if (talking) port.postMessage({type: 'quiet'});
    talking = false;
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
    if (!active || video.paused || !cache.has(i)) {
      quiet();
      status = pending && !cache.has(next) ? '자막 번역 중' : '더빙 준비됨';
      return;
    }
    if (last === i) return;
    last = i;
    const text = cache.get(i);
    const remaining = (rows[i].end - t) / video.playbackRate;
    if (remaining < 0.35) { quiet(); return; }
    s.wasMuted = s.mutedByUs ? s.wasMuted : video.muted;
    video.muted = true;
    s.mutedByUs = true;
    port.postMessage({type: 'speak', text, rate: Math.max(0.9, Math.min(1.6, text.length / (6 * remaining)))});
    talking = true;
    status = '한국어 더빙 중';
  }
  port.onMessage.addListener(msg => {
    if (session !== s) return;
    if (msg.error) return finish(msg.error);
    if (msg.type === 'ready') ready = true;
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
  for (const event of ['pause', 'seeking', 'ratechange', 'ended']) {
    video.addEventListener(event, quiet, {signal: s.events.signal});
  }
  s.timer = setInterval(tick, 180);
  status = '한국어 음성 확인 중';
  port.postMessage({type: 'open'});
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'start' && !enabled) {
    const expected = revision + 1;
    start(msg.file).catch(e => { if (revision === expected) finish(e.message); });
  }
  if (msg.type === 'stop') finish('더빙 종료');
  reply({status, enabled});
});
window.addEventListener('pagehide', () => finish('더빙 종료'));
