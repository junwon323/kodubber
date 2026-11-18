const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/cues.js'),'utf8')+'\nglobalThis.captions=Captions;',c);const C=c.captions;
test('markup removed before translation but math and spoken content kept',()=>{
 const rows=C.normalize([{start:0,end:2,text:'** aa ** and __hello__ and `x`'},{start:2,end:3,text:'***'},{start:3,end:4,text:'2**3 and a * b'}]);
 assert.equal(rows.length,2);assert.equal(rows[0].text,'aa and hello and x');assert.equal(rows[1].text,'2**3 and a * b');
 assert.equal(C.normalize([{start:0,end:1,text:'A\n   B'}])[0].text,'A B');
});
test('long sentence stays together past eight seconds; completed short sentences keep their timing',()=>{
 const rows=[{start:0,end:4,text:'When we look at'},{start:4,end:8,text:'this example we can'},{start:8,end:12,text:'understand the reason.'}];
 const grouped=C.group(rows);assert.equal(grouped.length,1);assert.equal(grouped[0].end,12);
 assert.equal(C.group([{start:0,end:2,text:'First.'},{start:2,end:5,text:'Second.'}]).length,2);
 assert.equal(C.group([{start:0,end:3,text:'Wait'},{start:5,end:8,text:'then continue.'}]).length,2);
 assert.equal(C.group([{start:0,end:35,text:'Long unfinished'},{start:35,end:42,text:'sentence.'}]).length,2);
});
test('real multiline subtitle files parse',()=>{
 const rows=C.vtt('WEBVTT\n\n00:00.000 --> 00:02.000\n** hello **\n\n00:02.000 --> 00:04.000\nworld.\n');
 assert.equal(rows.length,2);assert.equal(rows[0].text,'hello');
});

test('unpunctuated captions stop at source boundaries within fifteen seconds',()=>{
 const rows=Array.from({length:20},(_,i)=>({start:i*2,end:i*2+2,text:'word'+i}));
 const grouped=C.group(rows);
 assert.ok(grouped.every(row=>row.end-row.start<=15));
 assert.deepEqual(Array.from(grouped,r=>r.start),[0,14,28]);
 assert.equal(grouped.map(r=>r.text).join(' '),rows.map(r=>r.text).join(' '));
});
test('clause boundaries take priority over filling fifteen seconds',()=>{
 const rows=C.group([{start:0,end:7,text:'we have checked this case'},{start:7,end:12,text:'however another case remains'}]);
 assert.equal(rows.length,2);assert.equal(rows[1].start,7);
});

test('JSON word offsets keep later sentences at their actual source time',()=>{
 const rows=C.group(C.json({events:[{tStartMs:1000,dDurationMs:10000,segs:[
  {utf8:'First sentence.',tOffsetMs:0},{utf8:' Next sentence',tOffsetMs:4000},{utf8:' continues.',tOffsetMs:6000}
 ]}]}));
 assert.equal(rows.length,2);assert.equal(rows[0].start,1);assert.equal(rows[1].start,5);
 assert.equal(rows[1].text,'Next sentence continues.');
 const unknown=C.json({events:[{tStartMs:1000,dDurationMs:10000,segs:[{utf8:'One.'},{utf8:' Two.'}]}]});
 assert.equal(unknown.length,1,'without source timestamps do not invent alignment');
});

test('long automatic-caption event uses real word timestamps for shorter chunks',()=>{
 const segments=Array.from({length:20},(_,i)=>({utf8:(i?' ':'')+'word'+i,tOffsetMs:i*2000}));
 const rows=C.group(C.json({events:[{tStartMs:1000,dDurationMs:40000,segs:segments}]}));
 assert.ok(rows.length>=3);assert.ok(rows.every(r=>r.end-r.start<=15));
 assert.ok(rows.every(r=>(r.start-1)%2===0));
 assert.equal(rows.map(r=>r.text).join(' '),segments.map(s=>s.utf8).join(''));
});
