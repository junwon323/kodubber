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
 vm.runInNewContext(helper+'\n'+fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8'),{chrome,importScripts(){}, AbortController});
 connect({name:'dub',sender:{frameId:0,url:'https://www.youtube.com/watch'},onMessage:{addListener:f=>receive=f},onDisconnect:{addListener(){}},postMessage(){}});
 const say=()=>receive({type:'speak',text:'O(1) 시간에 조회합니다.',rate:1,speechId:1});
 await receive({type:'open'});await say();assert.match(spoken.at(-1).text,/상수 시간/);
 const interrupted=spoken.at(-1).options;await receive({type:'quiet'});interrupted.onEvent({type:'end'});
 await say();assert.match(spoken.at(-1).text,/상수 시간/);spoken.at(-1).options.onEvent({type:'end'});
 await say();assert.equal(spoken.at(-1).text,'빅오 일로 조회합니다.');
 await receive({type:'quiet',resetFormulas:true});await say();assert.match(spoken.at(-1).text,/상수 시간/);
 spoken.at(-1).options.onEvent({type:'end'});await receive({type:'open'});await say();assert.match(spoken.at(-1).text,/상수 시간/);
});

test('common formula symbols are pronounced without losing signs or operand order',()=>{
 const c={};vm.createContext(c);vm.runInContext(helper,c);
 const cases=[['10^5','십의 오 제곱'],['10⁵','십의 오 제곱'],['n²','엔의 제곱'],['n³','엔의 세제곱'],['2^n','이의 엔 제곱'],['a ** b','에이의 비 제곱'],['10^(-3)','십의 마이너스 삼 제곱'],['10의 마이너스 3제곱','십의 마이너스 삼 제곱'],['2^-n','이의 마이너스 엔 제곱'],['1e5','일 곱하기 십의 오 제곱'],['2.5e-3','이 점 오 곱하기 십의 마이너스 삼 제곱'],['exp(x)','자연상수 이의 엑스 제곱'],['√n','엔의 제곱근'],['sqrt(n)','엔의 제곱근'],['log_2(8)','밑이 이인 로그 팔'],['log₂ n','밑이 이인 로그 엔'],['n!','엔 팩토리얼'],['a/b','에이 나누기 비'],['x <= y','엑스 작거나 같음 와이'],['a != b','에이 같지 않음 비'],['0 <= n < 5','영 작거나 같음 엔 작음 오'],['2 × 3','이 곱하기 삼']];
 for(const [input,expected] of cases)assert.equal(c.speechText(input),expected,input);
 for(const input of ['https://example.com/1e5?q=x','buffer1e5','foo_bar','C++','std::vector','v1.2.3','/n/m','./n/m'])assert.equal(c.speechText(input),input);
 assert.equal(c.speechText('Python 코드 a ^ b는 XOR'),'Python 코드 a ^ b는 엑스오어');
 assert.equal(c.speechText('`mask ^ n`'),'mask ^ n','quoted code must not be interpreted as a power');
});
