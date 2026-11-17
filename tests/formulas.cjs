const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const helper=fs.readFileSync(path.join(__dirname,'../extension/speech-text.js'),'utf8');
test('formula pronunciation keeps meaning, notation, space and repeat state',()=>{
 const c={};vm.createContext(c);vm.runInContext(helper,c);const seen=new Set();
 assert.equal(c.speechText('O(1) 시간에 조회합니다.',seen),'상수 시간인 빅오 일로 조회합니다.');
 assert.equal(c.speechText('O(1)입니다.',seen),'빅오 일입니다.');
 assert.equal(c.speechText('공간복잡도는 O(1)',seen),'공간복잡도는 상수 공간인 빅오 일');
 assert.equal(c.speechText('시간복잡도는 O(log n)'),'시간복잡도는 로그 시간인 빅오 로그 엔');
 assert.equal(c.speechText('O(n²)'),'제곱 시간인 빅오 엔 제곱');
 assert.equal(c.speechText('O(custom(n))'),'O(custom(n))');
 assert.equal(c.speechText('시간복잡도는 O(n) 시간입니다.'),'시간복잡도는 선형 시간인 빅오 엔입니다.');
});
test('only completed speech marks formulas as explained; seek and reopen reset',async()=>{
 let connect,receive;const spoken=[];
 const chrome={runtime:{onMessage:{addListener(){}},onConnect:{addListener:f=>connect=f}},tts:{stop(){},getVoices:async()=>[{voiceName:'한국어',lang:'ko-KR'}],speak:(text,options)=>spoken.push({text,options})}};
 vm.runInNewContext(helper+'\n'+fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),{chrome,importScripts(){}});
 connect({name:'dub',sender:{frameId:0,url:'https://www.youtube.com/watch'},onMessage:{addListener:f=>receive=f},onDisconnect:{addListener(){}},postMessage(){}});
 const say=()=>receive({type:'speak',text:'O(1) 시간에 조회합니다.',rate:1,speechId:1});
 await receive({type:'open'});await say();assert.match(spoken.at(-1).text,/상수 시간/);
 const interrupted=spoken.at(-1).options;await receive({type:'quiet'});interrupted.onEvent({type:'end'});
 await say();assert.match(spoken.at(-1).text,/상수 시간/);spoken.at(-1).options.onEvent({type:'end'});
 await say();assert.equal(spoken.at(-1).text,'빅오 일로 조회합니다.');
 await receive({type:'quiet',resetFormulas:true});await say();assert.match(spoken.at(-1).text,/상수 시간/);
 spoken.at(-1).options.onEvent({type:'end'});await receive({type:'open'});await say();assert.match(spoken.at(-1).text,/상수 시간/);
});
