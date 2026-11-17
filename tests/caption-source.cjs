const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../extension/caption-source.js'), 'utf8');

function fixture() {
  const replies = [], fetched = [];
  const location = {href: 'https://www.youtube.com/watch?v=video1', origin: 'https://www.youtube.com'};
  const payload = JSON.stringify({events: [{tStartMs: 0, dDurationMs: 2000, segs: [{utf8: 'Binary search.'}]}]});
  const player = {
    getPlayerResponse: () => ({videoDetails: {videoId: 'video1'}, captions: {
      playerCaptionsTracklistRenderer: {captionTracks: [
        {vssId: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?v=video1&lang=en'},
        {vssId: 'ko', baseUrl: 'https://www.youtube.com/api/timedtext?v=video1&lang=ko'}
      ]}
    }}),
    getOption: () => ({vssId: 'en'})
  };
  let handler;
  const window = {
    fetch: async url => {fetched.push(String(url)); return new Response(payload);},
    addEventListener: (_, fn) => {handler = fn;},
    postMessage: data => replies.push(data)
  };
  class XHR {open() {}}
  vm.runInNewContext(code, {window, location, document: {querySelector: () => player},
    XMLHttpRequest: XHR, URL, AbortSignal});
  const request = video => handler({source: window, origin: location.origin,
    data: {type: 'korean-dubber-caption-request', request: 'request1', video}});
  return {window, replies, fetched, request, payload, player};
}
test('uses the current player caption track when resource timing is unavailable', async () => {
  const f = fixture();
  await f.request('video1');
  assert.match(f.fetched[0], /lang=en/);
  assert.equal(f.replies[0].raw, f.payload);
});
test('reuses the original player response without re-fetching a signed URL', async () => {
  const f = fixture();
  const response = await f.window.fetch('https://www.youtube.com/api/timedtext?v=video1');
  assert.equal(await response.text(), f.payload);
  await new Promise(resolve => setTimeout(resolve, 30));
  f.player.getPlayerResponse = () => {throw Error('must use cache');};
  await f.request('video1');
  assert.equal(f.fetched.length, 1);
  assert.equal(f.replies[0].raw, f.payload);
});
test('does not return subtitles for a different video', async () => {
  const f = fixture();
  await f.request('video2');
  assert.equal(f.replies.length, 0);
  f.player.getPlayerResponse = () => ({videoDetails: {videoId: 'old-video'}});
  await f.request('video1');
  assert.ok(f.replies[0].error);
  assert.equal(f.fetched.length, 0);
});
test('uses automatic captions when they are the only available track', async () => {
  const f=fixture();
  f.player.getPlayerResponse=()=>({videoDetails:{videoId:'video1'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{kind:'asr',vssId:'a.en',baseUrl:'https://www.youtube.com/api/timedtext?v=video1&lang=en&kind=asr'}]}}});
  f.player.getOption=()=>({});await f.request('video1');assert.match(f.fetched[0],/kind=asr/);assert.equal(f.replies[0].raw,f.payload);
});
test('explains when neither normal nor automatic captions are provided', async () => {
  const f=fixture();f.player.getPlayerResponse=()=>({videoDetails:{videoId:'video1'}});await f.request('video1');assert.match(f.replies[0].error,/자동 생성 자막이 없습니다/);assert.equal(f.fetched.length,0);
});
