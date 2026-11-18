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
    muted: false, paused: false, playbackRate: 1,
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); },
    async play() { this.paused = false; }
  });
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
  const state = type => new Promise(resolve => message({type, file}, {}, resolve));
  assert.equal((await state('status')).enabled, false);
  assert.equal((await state('start')).enabled, true);
  fromWorker({type: 'ready'});
  assert.deepEqual(Array.from(sent.find(m => m.type === 'translate').lines), ['Binary search.', 'Next.']);
  fromWorker({type: 'result', start: 0, lines: ['이진 탐색.', '다음.']});
  assert.equal(sent.at(-1).text, '이진 탐색.');
  assert.equal(video.muted, true);
  const firstSpeech = sent.at(-1);
  video.currentTime = 5.1;
  tick();
  assert.equal(video.paused, true, 'video waits for the complete sentence');
  assert.equal(sent.at(-1), firstSpeech, 'speech is not interrupted at the next cue');
  fromWorker({type: 'speech-end', speechId: firstSpeech.speechId});
  assert.equal(video.paused, false);
  assert.equal(sent.at(-1).text, '다음.');
  const count = sent.length;
  fromWorker({type: 'speech-end', speechId: firstSpeech.speechId});
  assert.equal(sent.length, count, 'stale completion cannot restart speech');
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
  assert.equal((await state('stop')).enabled, false);
  fromWorker({type: 'result', start: 0, lines: ['늦게 도착한 결과']});
  assert.equal((await state('status')).enabled, false);
  assert.equal(video.muted, false);
});

test('short sentences are translated together but spoken only at their own start', async () => {
  let tick, message, receive;
  const sent=[];
  const video=Object.assign(new EventTarget(),{isConnected:true,currentTime:0,muted:false,paused:false,
    pause(){this.paused=true;this.dispatchEvent(new Event('pause'));},async play(){this.paused=false;}});
  const port={onMessage:{addListener:f=>receive=f},onDisconnect:{addListener(){}},postMessage:m=>sent.push(m),disconnect(){}};
  const ctx=vm.createContext({URL,AbortController,window:new EventTarget(),location:{href:'https://www.youtube.com/watch?v=timing'},document:{querySelector:s=>s.startsWith('video')?video:null},chrome:{runtime:{connect:()=>port,onMessage:{addListener:f=>message=f}}},setInterval:f=>{tick=f;return 1;},clearInterval(){}});
  vm.runInContext(script('cues.js'),ctx);vm.runInContext(script('player.js'),ctx);
  message({type:'start',file:'WEBVTT\n\n00:00.000 --> 00:04.000\nFirst sentence.\n\n00:04.000 --> 00:08.000\nSecond sentence.'},{},()=>{});
  receive({type:'ready'});
  const req=sent.find(m=>m.type==='translate');assert.equal(req.lines.length,2);
  receive({type:'result',start:0,lines:['첫 문장.','둘째 문장.']});
  const first=sent.at(-1);assert.equal(first.text,'첫 문장.');
  video.currentTime=2;receive({type:'speech-end',speechId:first.speechId});
  video.currentTime=3.9;tick();assert.equal(sent.filter(m=>m.type==='speak').length,1,'early completion must not read the next sentence early');
  video.currentTime=4;tick();assert.equal(sent.at(-1).text,'둘째 문장.');assert.equal(video.paused,false);
});

test('player waits for delayed video and reinjection does not duplicate listeners',async()=>{
 let message,available=false,listeners=0;
 const video={muted:false,paused:true,textTracks:[],addEventListener(){}};
 const port={onMessage:{addListener(){}},onDisconnect:{addListener(){}},postMessage(){}};
 const ctx=vm.createContext({URL,AbortController,window:{addEventListener(){}},location:{href:'https://www.youtube.com/watch?v=test'},document:{querySelector:s=>s.startsWith('video')&&available?video:null},chrome:{runtime:{onMessage:{addListener:f=>{listeners++;message=f;}},connect:()=>port}},setTimeout:fn=>{available=true;queueMicrotask(fn);},setInterval:()=>1,clearInterval(){}});
 vm.runInContext(script('cues.js'),ctx);vm.runInContext(script('player.js'),ctx);
 vm.runInContext(script('cues.js'),ctx);vm.runInContext(script('player.js'),ctx);assert.equal(listeners,1);
 message({type:'start',file:'WEBVTT\n\n00:00.000 --> 00:01.000\nHello.'},{},()=>{});
 await new Promise(resolve=>setImmediate(resolve));
 let result;message({type:'status'},{},r=>result=r);assert.equal(result.enabled,true);assert.match(result.status,/음성 확인/);
});
