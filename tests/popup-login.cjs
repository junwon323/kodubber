const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../extension/popup.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../extension/popup.html'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function popup(state){
 state.officeOrigin??='https://office.example';
 const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>['#'+m[1],{value:'',hidden:true,setAttribute(){},replaceChildren(){},add(){}}]));
 const calls=[];let added,removed;
 const chrome={tabs:{query:async()=>[{id:1,url:state.url||'https://www.youtube.com/watch?v=test'}],sendMessage:async()=>{if(state.missing)throw Error('Could not establish connection. Receiving end does not exist.');return {enabled:false,status:'대기 중'};}},scripting:{executeScript:async args=>{calls.push(args.files.join(','));if(args.files.includes('player.js'))state.missing=false;}},tts:{getVoices:async()=>[]},storage:{local:{get:async()=>({speechRate:state.speechRate,officeOrigin:state.officeOrigin}),set:async data=>Object.assign(state,data)}},permissions:{contains:async()=>state.granted,request:async()=>{calls.push('permission');state.granted=state.allow;return state.granted;},onAdded:{addListener:f=>added=f},onRemoved:{addListener:f=>removed=f}},runtime:{sendMessage:async msg=>{calls.push(msg.type);if(msg.type==='office-login'){state.email=msg.email;return {email:state.email};}return {mode:'office',email:state.email};}}};
 const c={chrome,document:{querySelector:s=>nodes[s]},localStorage:{getItem:()=>'',setItem(){}},setInterval(){},URL};
 vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/remote-config.js'),'utf8'),c);vm.runInContext(source,c);return {nodes,calls,added:()=>added(),removed:()=>removed()};
}
test('permission precedes credentials, survives reopening, and login never prompts',async()=>{
 const state={granted:false,allow:true};let f=popup(state);await flush();
 assert.equal(f.nodes['#login-form'].hidden,true);assert.equal(f.nodes['#office-permission'].hidden,false);
 await f.nodes['#office-permission'].onclick();assert.equal(f.nodes['#login-form'].hidden,false);
 f=popup(state);await flush();assert.equal(f.nodes['#office-permission'].hidden,true);assert.equal(f.nodes['#login-form'].hidden,false);
 f.nodes['#email'].value='test@example.test';f.nodes['#password'].value='fixture-password';
 await f.nodes['#login-form'].onsubmit({preventDefault(){}});
 assert.equal(f.calls.includes('permission'),false);assert.equal(f.calls.filter(x=>x==='office-login').length,1);
 assert.equal(f.nodes['#password'].value,'');
 f=popup(state);await flush();assert.equal(f.nodes['#login-form'].hidden,true);assert.match(f.nodes['#account-status'].textContent,/로그인됨/);
 state.granted=false;f.removed();await flush();assert.equal(f.nodes['#office-permission'].hidden,false);
 state.granted=true;f.added();await flush();assert.equal(f.nodes['#login-form'].hidden,true,'existing session reused after permission restored');
});
test('denied permission keeps credentials hidden and sends no login',async()=>{
 const f=popup({granted:false,allow:false});await flush();await f.nodes['#office-permission'].onclick();
 assert.equal(f.nodes['#login-form'].hidden,true);assert.equal(f.calls.includes('office-login'),false);
});

test('speech speed defaults to normal and is saved across popup reopening',async()=>{
 const state={granted:true};let f=popup(state);await flush();
 assert.equal(f.nodes['#speech-rate'].value,'2');assert.equal(f.nodes['#speech-rate'].disabled,false);
 for(const [position,speed] of [['0',1],['1',1.025],['2',1.05],['3',1.075],['4',1.1]]){
  f.nodes['#speech-rate'].value=position;await f.nodes['#speech-rate'].onchange();
  assert.equal(state.speechRate,Number(speed));f=popup(state);await flush();
  assert.equal(f.nodes['#speech-rate'].value,position);
 }
});

test('already-open YouTube tab reconnects automatically without a page reload',async()=>{
 const f=popup({granted:true,missing:true});await flush();await flush();
 assert.equal(f.calls.filter(x=>x==='caption-source.js').length,1);
 assert.equal(f.calls.filter(x=>x==='cues.js,player.js').length,1);
 assert.equal(f.nodes['#toggle'].disabled,false);
});
test('automatic reconnection never injects into an unrelated website',async()=>{
 const f=popup({granted:true,missing:true,url:'https://example.com'});await flush();
 assert.equal(f.calls.includes('caption-source.js'),false);
 assert.match(f.nodes['#status'].textContent,/유튜브 영상 탭/);
});
