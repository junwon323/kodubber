const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../extension/popup.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../extension/popup.html'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function popup(state){
 const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>['#'+m[1],{value:'',hidden:true,setAttribute(){},replaceChildren(){},add(){}}]));
 const calls=[];let added,removed;
 const chrome={tabs:{query:async()=>[{id:1}],sendMessage:async()=>({enabled:false,status:'대기 중'})},tts:{getVoices:async()=>[]},storage:{local:{set:async()=>{}}},permissions:{contains:async()=>state.granted,request:async()=>{calls.push('permission');state.granted=state.allow;return state.granted;},onAdded:{addListener:f=>added=f},onRemoved:{addListener:f=>removed=f}},runtime:{sendMessage:async msg=>{calls.push(msg.type);if(msg.type==='office-login'){state.email=msg.email;return {email:state.email};}return {mode:'office',email:state.email};}}};
 const c={chrome,document:{querySelector:s=>nodes[s]},localStorage:{getItem:()=>'',setItem(){}},setInterval(){},OFFICE_ORIGIN:'https://office.example'};
 vm.createContext(c);vm.runInContext(source,c);return {nodes,calls,added:()=>added(),removed:()=>removed()};
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
