const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('worker selects the requested Korean voice and uses the teacher translation style', async () => {
  let connect, receive, request, speech;
  const voices = ['first', 'second'].map(extensionId => ({extensionId, lang: 'ko-KR', voiceName: '한국어'}));
  let savedRate;
  const chrome = {
    storage:{local:{get:async()=>({speechRate:savedRate}),remove:async()=>{}}},
    runtime: {onMessage: {addListener() {}}, sendMessage: async () => ({}), getContexts: async () => [], onConnect: {addListener: fn => connect = fn},
      sendNativeMessage: async (_, msg) => {request = msg; return {lines: ['안녕하세요']};}},
    tts: {stop() {}, getVoices: async () => voices, speak: (_, options) => {speech = options;}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/speech-text.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8'), {chrome, importScripts() {}, translationMode:async()=>"local", localTranslate:lines=>chrome.runtime.sendNativeMessage("test",{lines}), AbortController});
  connect({name: 'dub', sender: {frameId: 0, url: 'https://www.youtube.com/watch'},
    onMessage: {addListener: fn => receive = fn}, onDisconnect: {addListener() {}}, postMessage() {}});
  await receive({type: 'open', voice: JSON.stringify(['second', '한국어', 'ko-KR']), style: 'friendly'});
  await receive({type: 'translate', lines: ['Hello']});
  await receive({type: 'speak', text: '안녕하세요', rate: 1});
  assert.equal(request.style, undefined);
  assert.equal(speech.extensionId, 'second');
  assert.equal(speech.lang, 'ko-KR');
  assert.equal(speech.rate, 1.5);
  for(const rate of [1,2,1.5]){
    savedRate=rate;
    assert.notEqual(speech.rate,undefined);
    const previous=speech;
    await receive({type:'speak',text:'다음 문장',rate:9});
    assert.equal(speech.rate,rate);assert.notEqual(speech,previous);
  }
  for(const [oldRate,newRate] of [[1.04,1],[1.06,1.5],[1.08,2]]){savedRate=oldRate;await receive({type:'speak',text:'이전 설정'});assert.equal(speech.rate,newRate);}
  savedRate=9;await receive({type:'speak',text:'잘못된 설정'});assert.equal(speech.rate,1.5);
});

test('old API key is removed on worker startup', async () => {
  const removed=[];
  const chrome={storage:{local:{remove:async key=>removed.push(key)}},runtime:{onConnect:{addListener(){}}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/speech-text.js'),'utf8')+'\n'+fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),{chrome,importScripts(){}, translationMode:async()=>"local", localTranslate:lines=>chrome.runtime.sendNativeMessage("test",{lines}), AbortController});
  assert.deepEqual(removed,['geminiApiKey']);
});
