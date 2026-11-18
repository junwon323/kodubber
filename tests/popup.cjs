const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../extension/popup.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../extension/popup.html'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function popup(state){
 const nodes=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>['#'+m[1],{value:'',hidden:true,setAttribute(){},replaceChildren(){},add(){}}]));
 const calls=[];
 const chrome={tabs:{query:async()=>[{id:1,url:state.url||'https://www.youtube.com/watch?v=test'}],sendMessage:async()=>{if(state.missing)throw Error('Could not establish connection. Receiving end does not exist.');return {enabled:false,status:'대기 중'};}},scripting:{executeScript:async args=>{calls.push(args.files.join(','));if(args.files.includes('player.js'))state.missing=false;}},tts:{getVoices:async()=>[]},storage:{local:{get:async()=>({speechRate:state.speechRate}),set:async data=>Object.assign(state,data)}}};
 const c={chrome,document:{querySelector:s=>nodes[s]},localStorage:{getItem:()=>'',setItem(){}},setInterval(){},URL};
 vm.createContext(c);vm.runInContext(source,c);return {nodes,calls};
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
 const f=popup({missing:true});await flush();await flush();
 assert.equal(f.calls.filter(x=>x==='caption-source.js').length,1);
 assert.equal(f.calls.filter(x=>x==='cues.js,player.js').length,1);
 assert.equal(f.nodes['#toggle'].disabled,false);
});
test('automatic reconnection never injects into an unrelated website',async()=>{
 const f=popup({missing:true,url:'https://example.com'});await flush();
 assert.equal(f.calls.includes('caption-source.js'),false);
 assert.match(f.nodes['#status'].textContent,/유튜브 영상 탭/);
});
