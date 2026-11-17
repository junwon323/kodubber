const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup(fetch) {
  const messages = [];
  const context = {self: {postMessage: msg => messages.push(msg)}, fetch, AbortController, setTimeout, clearTimeout, Uint8Array, atob};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/gemini-worker.mjs'), 'utf8'), context);
  return {messages, send: msg => context.self.onmessage({data: {id: 1, apiKey: 'test-only', voice: 'gemini:Fola', text: '이진 탐색입니다.', type: 'speak', ...msg}})};
}
const wav = Buffer.alloc(48); wav.write('RIFF'); wav.write('WAVE',8);
const result = () => ({ok:true,status:200,json:async()=>({steps:[{type:'model_output',content:[{type:'audio',data:wav.toString('base64')}]}]})});
const flush = () => new Promise(resolve => setImmediate(resolve));
test('Gemini sends only transcript, uses header credential, decodes WAV and reuses cache', async () => {
  let calls = 0;
  const runner = setup(async (url, init) => {
    calls++;
    assert.ok(!url.includes('test-only'));
    assert.equal(init.headers['x-goog-api-key'],'test-only');
    const body = JSON.parse(init.body);
    assert.equal(body.input[0].content[0].text, '이진 탐색입니다.');
    assert.equal(body.store,false);
    assert.equal(body.generation_config.speech_config[0].voice,'Fola');
    return result();
  });
  runner.send({}); await flush();
  assert.equal(runner.messages.at(-1).type,'audio');
  assert.equal(Buffer.from(runner.messages.at(-1).wav).toString('ascii',0,4),'RIFF');
  runner.send({id:2}); await flush(); assert.equal(calls,1);
});
test('quota stops further network requests without retrying or leaking response details', async () => {
  let calls=0;
  const runner=setup(async()=>{calls++; return {ok:false,status:429};});
  runner.send({}); await flush();
  assert.match(runner.messages.at(-1).error,/한도/);
  runner.send({id:2,text:'다음 문장'}); await flush(); assert.equal(calls,1);
});
test('cancelled response cannot play or fail the next utterance', async () => {
  let complete;
  const runner=setup(()=>new Promise(resolve=>{complete=resolve;}));
  runner.send({}); await flush(); runner.send({type:'cancel'});
  complete(result()); await flush();
  assert.equal(runner.messages.at(-1).type,'ready');
  assert.ok(!runner.messages.some(m=>m.type==='audio'));
});
