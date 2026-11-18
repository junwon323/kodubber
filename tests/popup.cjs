const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const preferences = fs.readFileSync(path.join(__dirname, '../extension/preferences.js'), 'utf8');
const source=fs.readFileSync(path.join(__dirname,'../extension/popup.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../extension/popup.html'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function popup(state){
 const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>['#'+m[1],{value:'',hidden:true,setAttribute(){},options:[],replaceChildren(){this.options=[];},add(option){this.options.push(option);}}]));
 const calls=[];
 const messages=[];
 const chrome={
  runtime:{sendMessage:async()=>state.discovery},
  tabs:{
   query:async()=>[{id:1,url:state.url||'https://www.youtube.com/watch?v=test'}],
   sendMessage:async(_,message)=>{
    if(state.missing)throw Error('Could not establish connection. Receiving end does not exist.');
    messages.push(message);
    return {enabled:false,status:'대기 중'};
   }
  },
  scripting:{executeScript:async args=>{calls.push(args.files.join(','));if(args.files.includes('player.js'))state.missing=false;}},
  tts:{getVoices:async()=>[]},
  storage:{local:{get:async()=>({speechRate:state.speechRate}),set:async data=>Object.assign(state,data)}}
 };
 const localStorage={getItem:key=>state[key]??null,setItem:(key,value)=>{state[key]=value;}};
 const c={chrome,Option:function(text,value){Object.assign(this,{text,value});},document:{querySelector:s=>nodes[s]},localStorage,setInterval(){},URL};
 vm.createContext(c);vm.runInContext(preferences + '\n' + source,c);return {nodes,calls,messages};
}
test('speech speed defaults to normal and is saved across popup reopening',async()=>{
 const state={};let f=popup(state);await flush();
 assert.equal(f.nodes['#speech-rate'].value,'2');assert.equal(f.nodes['#speech-rate'].disabled,false);
 for(const [position,speed] of [['0',1],['1',1.025],['2',1.05],['3',1.075],['4',1.1]]){
  f.nodes['#speech-rate'].value=position;await f.nodes['#speech-rate'].onchange();
  assert.equal(state.speechRate,Number(speed));f=popup(state);await flush();
  assert.equal(f.nodes['#speech-rate'].value,position);
 }
});

test('already-open YouTube tab reconnects automatically without a page reload',async()=>{
 const f=popup({missing:true,discovery:{connected:true,providers:['codex']}});await flush();await flush();
 assert.equal(f.calls.filter(x=>x==='caption-source.js').length,1);
 assert.equal(f.calls.filter(x=>x==='cues.js,player.js').length,1);
 assert.equal(f.nodes['#toggle'].disabled,false);
});
test('automatic reconnection never injects into an unrelated website',async()=>{
 const f=popup({missing:true,url:'https://example.com'});await flush();
 assert.equal(f.calls.includes('caption-source.js'),false);
 assert.match(f.nodes['#status'].textContent,/유튜브 영상 탭/);
});

test('Chrome translation is listed last and preserves the saved CLI preference', async () => {
 const state = {discovery:{connected:true,providers:['claude','antigravity']}};
 const detected = popup(state);
 await flush();
 const select = detected.nodes['#translation-provider'];
 assert.deepEqual(select.options.map(option=>option.value),['claude','antigravity','chrome']);
 assert.deepEqual(select.options.map(option=>option.text),['Claude Code','Antigravity','Chrome 번역']);
 assert.equal(select.value,'claude');

 select.value='antigravity';
 select.onchange();
 select.value='chrome';
 select.onchange();
 await flush();
 await detected.nodes['#toggle'].onclick();
 assert.equal(detected.messages.at(-1).type,'start');
 assert.equal(detected.messages.at(-1).provider,'chrome');

 const reopened = popup(state);
 await flush();
 assert.equal(reopened.nodes['#translation-provider'].value,'antigravity');
});

test('without a detected CLI, Chrome translation must be chosen explicitly', async () => {
 const state = {discovery:{connected:true,providers:[]},translationProvider:'chrome'};
 const fallback = popup(state);
 await flush();
 const select = fallback.nodes['#translation-provider'];
 const toggle = fallback.nodes['#toggle'];
 assert.deepEqual(select.options.map(option=>option.value),['','chrome']);
 assert.equal(select.value,'');
 assert.equal(select.disabled,false);
 assert.equal(toggle.disabled,true);

 select.value='chrome';
 select.onchange();
 await flush();
 assert.equal(toggle.disabled,false);
});
