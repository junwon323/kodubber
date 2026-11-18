const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(paused=false, translator){
 let tick,message,receive;const sent=[];
 const video=Object.assign(new EventTarget(),{isConnected:true,currentTime:0,muted:false,paused,seeking:false,
 pause(){this.paused=true;this.dispatchEvent(new Event('pause'));},async play(){this.paused=false;}});
 const port={onMessage:{addListener:f=>receive=f},onDisconnect:{addListener(){}},postMessage:m=>sent.push(m),disconnect(){}};
 const c=vm.createContext({URL,AbortController,AbortSignal,setTimeout,clearTimeout,Translator:translator,window:new EventTarget(),location:{href:'https://www.youtube.com/watch?v=test'},document:{querySelector:s=>s.startsWith('video')?video:null},chrome:{runtime:{connect:()=>port,onMessage:{addListener:f=>message=f}}},setInterval:f=>{tick=f;return 1;},clearInterval(){}});
 for(const f of ['cues.js','player.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension',f),'utf8'),c);
 const stamp=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}.000`;
 const file='WEBVTT\n\n'+Array.from({length:80},(_,i)=>`${stamp(i*10)} --> ${stamp(i*10+8)}\nSentence ${i}.`).join('\n\n');
 const command=type=>message({type,file,provider:translator?'chrome':undefined},{},()=>{});
 command('start');
 return {video,sent,command,tick:()=>tick(),receive:m=>receive(m),result:()=>{const req=sent.filter(m=>m.type==='translate').at(-1);receive({type:'result',start:req.start,lines:req.lines.map((_,i)=>`번역 ${req.start+i}.`)});}};
}
test('buffers before playback, replenishes while speaking, bounds each batch',()=>{
 const f=fixture();assert.equal(f.video.paused,true);f.receive({type:'ready'});
 const request=f.sent.find(m=>m.type==='translate');assert.equal(request.lines.length,18);assert.equal(f.sent.some(m=>m.type==='speak'),false);
 f.result();assert.equal(f.video.paused,false);assert.equal(f.sent.at(-1).type,'speak');
 f.video.currentTime=70;f.tick();const next=f.sent.filter(m=>m.type==='translate').at(-1);
 assert.equal(next.start,18);assert.equal(next.lines.length,7);
});
test('seek prioritizes new position after in-flight response and waits for its buffer',()=>{
 const f=fixture();f.receive({type:'ready'});
 f.video.currentTime=400;f.video.dispatchEvent(new Event('seeking'));f.tick();f.result();
 const request=f.sent.filter(m=>m.type==='translate').at(-1);assert.equal(request.start,40);
 assert.equal(f.sent.some(m=>m.type==='speak'),false);assert.equal(f.video.paused,true);
 f.result();assert.equal(f.video.paused,false);assert.equal(f.sent.at(-1).text,'번역 40.');
});
test('initial manual pause survives buffering; end of video needs only remaining captions',()=>{
 const f=fixture(true);f.video.currentTime=790;f.receive({type:'ready'});
 assert.equal(f.sent.at(-1).lines.length,1);f.result();assert.equal(f.video.paused,true);
 assert.equal(f.sent.some(m=>m.type==='speak'),false);
 f.video.paused=false;f.tick();assert.equal(f.sent.at(-1).text,'번역 79.');
});
test('missing translations fail instead of silently skipping speech',()=>{
 const f=fixture();f.receive({type:'ready'});f.receive({type:'result',start:0,lines:[]});
 assert.equal(f.video.paused,false);assert.equal(f.sent.some(m=>m.type==='speak'),false);
});

test('Chrome translation fills the speech buffer without issuing a native translation request', async () => {
 let destroyed = false;
 const calls = [];
 const f = fixture(false, {
  availability: async options => { calls.push(options); return 'available'; },
  create: async () => ({
   translate: async () => '브라우저 번역입니다.',
   destroy: () => { destroyed = true; },
  }),
 });
 const flush = () => new Promise(resolve => setImmediate(resolve));
 await flush();
 f.receive({type: 'ready'});
 await flush();
 assert.equal(calls[0].sourceLanguage, 'en');
 assert.equal(calls[0].targetLanguage, 'ko');
 assert.equal(f.sent.some(msg => msg.type === 'translate'), false);
 assert.equal(f.sent.at(-1).text, '브라우저 번역입니다.');
 f.command('stop');
 assert.equal(destroyed, true);
});
