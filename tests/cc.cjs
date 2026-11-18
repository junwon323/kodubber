const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(initial){
 let state=initial;const clicks=[];const button={isConnected:true,getAttribute:key=>key==='aria-pressed'?state:null,click(){state=state==='true'?'false':'true';clicks.push(state);}};
 const location={href:'https://www.youtube.com/watch?v=one'};
 const c={setTimeout:fn=>{queueMicrotask(fn);return 1;},URL,location,document:{querySelector:()=>button},chrome:{runtime:{onMessage:{addListener(){}}}},window:{addEventListener(){}}};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/player.js'),'utf8'),c);
 return {c,clicks,state:()=>state,set:s=>state=s,location};
}
test('initial CC off: enable for capture, hide, keep off on stop',()=>{const f=fixture('false');f.c.enableCC('one');assert.equal(f.state(),'true');f.c.hideCC();assert.equal(f.state(),'false');f.c.restoreCC();assert.deepEqual(f.clicks,['true','false']);});
test('initial CC on: hide after capture and restore on stop',()=>{const f=fixture('true');f.c.enableCC('one');f.c.hideCC();assert.equal(f.state(),'false');f.c.restoreCC();assert.equal(f.state(),'true');});
test('failure before capture restores CC and manual changes survive',()=>{const f=fixture('false');f.c.enableCC('one');f.c.restoreCC();assert.equal(f.state(),'false');f.c.enableCC('one');f.c.hideCC();f.set('true');f.c.restoreCC();assert.equal(f.state(),'true');});
test('navigation does not change the new video CC',()=>{const f=fixture('false');f.c.enableCC('one');f.location.href='https://www.youtube.com/watch?v=two';f.c.hideCC();f.c.restoreCC();assert.deepEqual(f.clicks,['true']);});

test('automatic retry cycles CC and preserves the original off state',async()=>{
 const f=fixture('false');f.c.enableCC('one');let calls=0;
 f.c.captions=async()=>{if(++calls===1)throw Error('empty response');return ['captions'];};
 const rows=await f.c.collectCaptions({},'one',0);
 assert.deepEqual(rows,['captions']);assert.equal(calls,2);
 assert.deepEqual(f.clicks,['true','false','true']);f.c.hideCC();f.c.restoreCC();assert.equal(f.state(),'false');
});
test('retry is bounded and stop prevents delayed CC toggles',async()=>{
 const f=fixture('true');f.c.enableCC('one');let calls=0;f.c.captions=async()=>{calls++;throw Error('empty');};
 await assert.rejects(()=>f.c.collectCaptions({},'one',0),/확보하지 못했습니다/);assert.equal(calls,2);
 f.c.restoreCC();assert.equal(f.state(),'true');
 f.c.enableCC('one');const pending=f.c.refreshCC('one',0);f.c.finish('stop');await pending;
 assert.equal(f.state(),'true');assert.equal(f.clicks.at(-1),'true');
});
test('no-caption result does not trigger a toggle loop',async()=>{
 const f=fixture('false');f.c.enableCC('one');f.c.captions=async()=>{throw Object.assign(Error('no captions'),{retryable:false});};
 await assert.rejects(()=>f.c.collectCaptions({},'one',0),/no captions/);assert.deepEqual(f.clicks,['true']);
});
