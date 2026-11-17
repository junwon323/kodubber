const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const {test} = require('node:test');
const script = name => fs.readFileSync(path.join(__dirname, '../extension', name), 'utf8');
test('subtitle parsing, lookahead, seek, pause, speed and restoring mute', async () => {
  let tick, message, fromWorker;
  const sent = [];
  const video = Object.assign(new EventTarget(), {isConnected: true, currentTime: 0,
    muted: false, paused: false, playbackRate: 1});
  const port = {onMessage: {addListener: fn => fromWorker = fn},
    onDisconnect: {addListener() {}}, postMessage: m => sent.push(m), disconnect() {}};
  const ctx = vm.createContext({URL, AbortController, window: new EventTarget(),
    location: {href: 'https://www.youtube.com/watch?v=fixture'},
    document: {querySelector: s => s.startsWith('video') ? video : null},
    chrome: {runtime: {connect: () => port, onMessage: {addListener: fn => message = fn}}},
    setInterval: fn => {tick = fn; return 1;}, clearInterval() {}});
  vm.runInContext(script('cues.js'), ctx);
  vm.runInContext(script('player.js'), ctx);
  const file = 'WEBVTT\n\n00:00.000 --> 00:02.000\nBinary\n\n00:02.000 --> 00:04.000\nsearch.\n\n00:05.000 --> 00:08.000\nNext.';
  await new Promise(resolve => message({type: 'start', file}, {}, resolve));
  fromWorker({type: 'ready'});
  assert.deepEqual(Array.from(sent.find(m => m.type === 'translate').lines), ['Binary search.', 'Next.']);
  fromWorker({type: 'result', start: 0, lines: ['이진 탐색.', '다음.']});
  assert.equal(sent.at(-1).text, '이진 탐색.');
  assert.equal(video.muted, true);
  video.dispatchEvent(new Event('seeking'));
  video.currentTime = 5.1;
  tick();
  assert.equal(sent.at(-1).text, '다음.');
  video.paused = true;
  video.dispatchEvent(new Event('pause'));
  assert.equal(sent.at(-1).type, 'quiet');
  assert.equal(video.muted, false);
  video.paused = false;
  video.playbackRate = 2;
  video.dispatchEvent(new Event('ratechange'));
  tick();
  assert.equal(sent.at(-1).type, 'speak');
  message({type: 'stop'}, {}, () => {});
  assert.equal(video.muted, false);
});
