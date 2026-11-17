const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(initial){
 let state=initial;const clicks=[];const button={isConnected:true,getAttribute:key=>key==='aria-pressed'?state:null,click(){state=state==='true'?'false':'true';clicks.push(state);}};
 const location={href:'https://www.youtube.com/watch?v=one'};
 const c={URL,location,document:{querySelector:()=>button},chrome:{runtime:{onMessage:{addListener(){}}}},window:{addEventListener(){}}};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/player.js'),'utf8'),c);
 return {c,clicks,state:()=>state,set:s=>state=s,location};
}
test('initial CC off: enable for capture, hide, keep off on stop',()=>{const f=fixture('false');f.c.enableCC('one');assert.equal(f.state(),'true');f.c.hideCC();assert.equal(f.state(),'false');f.c.restoreCC();assert.deepEqual(f.clicks,['true','false']);});
test('initial CC on: hide after capture and restore on stop',()=>{const f=fixture('true');f.c.enableCC('one');f.c.hideCC();assert.equal(f.state(),'false');f.c.restoreCC();assert.equal(f.state(),'true');});
test('failure before capture restores CC and manual changes survive',()=>{const f=fixture('false');f.c.enableCC('one');f.c.restoreCC();assert.equal(f.state(),'false');f.c.enableCC('one');f.c.hideCC();f.set('true');f.c.restoreCC();assert.equal(f.state(),'true');});
test('navigation does not change the new video CC',()=>{const f=fixture('false');f.c.enableCC('one');f.location.href='https://www.youtube.com/watch?v=two';f.c.hideCC();f.c.restoreCC();assert.deepEqual(f.clicks,['true']);});
