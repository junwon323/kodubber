/* Runs in the page world to read the player's response and caption responses. */
(() => {
  const originalFetch = window.fetch;
  const cache = new Map();
  const limit = 2_000_000;
  function captionURL(value) {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin && url.pathname === '/api/timedtext' ? url : null;
    } catch { return null; }
  }
  function remember(url, raw) {
    const id = url?.searchParams.get('v');
    if (!id || typeof raw !== 'string' || !raw.trim() || raw.length > limit) return;
    cache.delete(id);
    cache.set(id, raw);
    while (cache.size > 4) cache.delete(cache.keys().next().value);
  }
  window.fetch = async function(...args) {
    const response = await Reflect.apply(originalFetch, this, args);
    const url = captionURL(args[0]?.url || args[0]);
    if (url && response.ok) {
      response.clone().text().then(raw => remember(url, raw)).catch(() => {});
    }
    return response;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, address, ...rest) {
    const url = captionURL(address);
    if (url) this.addEventListener('load', () => {
      if (this.status !== 200) return;
      if (!this.responseType || this.responseType === 'text') remember(url, this.responseText);
      else if (this.responseType === 'json') remember(url, JSON.stringify(this.response));
    }, {once: true});
    return Reflect.apply(originalOpen, this, [method, address, ...rest]);
  };

  window.addEventListener('message', async event => {
    const msg = event.data;
    if (event.source !== window || event.origin !== location.origin ||
        msg?.type !== 'korean-dubber-caption-request' || typeof msg.request !== 'string' ||
        msg.request.length > 100 || msg.video !== new URL(location.href).searchParams.get('v')) return;
    const reply = data => window.postMessage({
      type: 'korean-dubber-caption-response', request: msg.request, video: msg.video, ...data
    }, location.origin);
    const cached = cache.get(msg.video);
    if (cached) return reply({raw: cached});
    try {
      const player = document.querySelector('#movie_player');
      const response = player?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
      if (response?.videoDetails?.videoId !== msg.video) return reply({error: '플레이어 정보를 읽지 못했습니다. 영상 페이지를 새로고침해 주세요.'});
      const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (!tracks.length) return reply({error: '이 영상에는 일반 자막과 자동 생성 자막이 없습니다. 시청자나 확장에서 자동 생성을 요청할 수 없습니다. 자막 파일이 있으면 선택해 주세요.'});
      const selected = player?.getOption?.('captions', 'track');
      const track = tracks.find(t => t.vssId === selected?.vssId) ||
        tracks.find(t => t.kind !== 'asr') || tracks[0];
      const url = captionURL(track.baseUrl);
      if (!url || url.searchParams.get('v') !== msg.video) return reply({error: '자막 주소를 확인하지 못했습니다.'});
      // Preserve the signed URL. Captured player responses take precedence.
      const result = await originalFetch.call(window, url.href, {credentials: 'same-origin', signal: AbortSignal.timeout(8000)});
      const raw = result.ok ? await result.text() : '';
      if (!raw.trim() || raw.length > limit) return reply({error: '자막 응답이 비어 있습니다. CC를 껐다 켠 뒤 다시 더빙을 켜 주세요.'});
      remember(url, raw);
      reply({raw});
    } catch {
      reply({error: '유튜브 자막 요청에 실패했습니다. CC를 껐다 켠 뒤 다시 시도해 주세요.'});
    }
  });
})();
