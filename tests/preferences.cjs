const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('worker selects the requested Korean voice and passes the translation style', async () => {
  let connect, receive, request, speech;
  const voices = ['first', 'second'].map(extensionId => ({extensionId, lang: 'ko-KR', voiceName: '한국어'}));
  const chrome = {
    runtime: {onMessage: {addListener() {}}, sendMessage: async () => ({}), getContexts: async () => [], onConnect: {addListener: fn => connect = fn},
      sendNativeMessage: async (_, msg) => {request = msg; return {lines: ['안녕하세요']};}},
    tts: {stop() {}, getVoices: async () => voices, speak: (_, options) => {speech = options;}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), {chrome});
  connect({name: 'dub', sender: {frameId: 0, url: 'https://www.youtube.com/watch'},
    onMessage: {addListener: fn => receive = fn}, onDisconnect: {addListener() {}}, postMessage() {}});
  await receive({type: 'open', voice: JSON.stringify(['second', '한국어', 'ko-KR']), style: 'friendly'});
  await receive({type: 'translate', lines: ['Hello']});
  await receive({type: 'speak', text: '안녕하세요', rate: 1});
  assert.equal(request.style, 'friendly');
  assert.equal(speech.extensionId, 'second');
  assert.equal(speech.lang, 'ko-KR');
});

test('Chrome preview works without an API key and ignores playback after cancellation', async () => {
  let listener, finishLookup, spoken = 0;
  const removed = [], replies = [];
  const chrome = {
    storage: {local: {remove: async key => removed.push(key)}},
    runtime: {id: 'test', getURL: p => 'chrome-extension://test/' + p,
      onMessage: {addListener: fn => listener = fn}, onConnect: {addListener() {}}, sendMessage: async () => ({})},
    tts: {stop() {}, getVoices: () => new Promise(resolve => {finishLookup = resolve;}), speak: () => {spoken++;}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), {chrome});
  const send = msg => listener(msg, {id: 'test', url: chrome.runtime.getURL('popup.html')}, reply => replies.push(reply));
  send({type: 'preview', voice: ''});
  send({type: 'preview-stop'});
  finishLookup([{voiceName: '한국어', lang: 'ko-KR'}]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spoken, 0);
  send({type: 'preview', voice: ''});
  finishLookup([{voiceName: '한국어', lang: 'ko-KR'}]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spoken, 1);
  assert.deepEqual(removed, ['geminiApiKey']);
  assert.equal(replies.at(-1).ok, true);
});
