const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('stopping synthesis discards late audio and prefetch never interrupts playback', async () => {
  let listener, worker;
  const played = [], messages = [], replies = [];
  class FakeWorker {
    constructor() {worker = this; this.sent = [];}
    postMessage(msg) {this.sent.push(msg);}
    terminate() {}
  }
  class Audio {
    play() {played.push(this); return Promise.resolve();}
    pause() {this.paused = true;}
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/offscreen.mjs'), 'utf8'), {
    Worker: FakeWorker, Audio, Blob, URL: {createObjectURL: () => 'blob:audio', revokeObjectURL() {}},
    chrome: {runtime: {id: 'test', onMessage: {addListener: fn => listener = fn},
      sendMessage: async msg => {messages.push(msg);}}}
  });
  const send = msg => listener({target: 'local-speech', token: 'session', voice: 'gemini:Kore', ...msg},
    {id: 'test'}, reply => replies.push(reply));
  send({type: 'speak', speechId: 1, text: '첫 문장'});
  const first = worker.sent.at(-1).id;
  send({type: 'stop'});
  send({type: 'speak', speechId: 2, text: '둘째 문장'});
  const second = worker.sent.at(-1).id;
  worker.onmessage({data: {type: 'audio', id: first, wav: new ArrayBuffer(44)}});
  assert.equal(played.length, 0);
  worker.onmessage({data: {type: 'audio', id: second, wav: new ArrayBuffer(44)}});
  await Promise.resolve();
  assert.equal(played.length, 1);
  send({type: 'prepare', text: '다음 문장'});
  worker.onmessage({data: {type: 'audio', id: worker.sent.at(-1).id, wav: new ArrayBuffer(44)}});
  assert.equal(played.length, 1);
  assert.equal(played[0].paused, undefined);
  played[0].onended();
  assert.equal(messages.at(-1).type, 'end');
  assert.equal(messages.at(-1).speechId, 2);
});

test('Gemini voice starts without installed Korean system voices and releases the engine on disconnect', async () => {
  let connect, receive, disconnect, created = false, released = false;
  const sent = [], commands = [];
  const chrome = {
    storage: {local: {setAccessLevel: async () => {}, get: async () => ({geminiApiKey: "test-only"})}},
    runtime: {
      id: 'test', getURL: p => 'chrome-extension://test/' + p,
      onMessage: {addListener() {}}, onConnect: {addListener: fn => connect = fn},
      getContexts: async () => created ? [{}] : [],
      sendMessage: async msg => {commands.push(msg); return {ready: true};}
    },
    offscreen: {createDocument: async () => {created = true;}, closeDocument: async () => {released = true;}},
    tts: {stop() {}, getVoices: async () => {throw Error('system voices must not be required');}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), {chrome});
  connect({name: 'dub', sender: {frameId: 0, url: 'https://www.youtube.com/watch?v=test'},
    onMessage: {addListener: fn => receive = fn},
    onDisconnect: {addListener: fn => disconnect = fn}, postMessage: msg => sent.push(msg)});
  await receive({type: 'open', voice: 'gemini:Kore', style: 'lecture'});
  assert.ok(created);
  assert.equal(commands.find(m => m.type === 'init').voice, 'gemini:Kore');
  assert.equal(sent.at(-1).type, 'ready');
  await receive({type: 'speak', text: '시험 문장', speechId: 1, rate: 0.9});
  assert.equal(commands.at(-1).type, 'speak');
  assert.equal(commands.at(-1).speechId, 1);
  disconnect();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(released);
});
