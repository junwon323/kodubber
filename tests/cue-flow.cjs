const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/cues.js'),'utf8')+'\nglobalThis.captions=Captions;',c);const C=c.captions;
test('markup removed before translation but math and spoken content kept',()=>{
 const rows=C.normalize([{start:0,end:2,text:'** aa ** and __hello__ and `x`'},{start:2,end:3,text:'***'},{start:3,end:4,text:'2**3 and a * b'}]);
 assert.equal(rows.length,2);assert.equal(rows[0].text,'aa and hello and x');assert.equal(rows[1].text,'2**3 and a * b');
 assert.equal(C.normalize([{start:0,end:1,text:'A\n   B'}])[0].text,'A B');
});
test('long sentence stays together past eight seconds; short sentences join',()=>{
 const rows=[{start:0,end:4,text:'When we look at'},{start:4,end:8,text:'this example we can'},{start:8,end:12,text:'understand the reason.'}];
 const grouped=C.group(rows);assert.equal(grouped.length,1);assert.equal(grouped[0].end,12);
 assert.equal(C.group([{start:0,end:2,text:'First.'},{start:2,end:5,text:'Second.'}]).length,1);
 assert.equal(C.group([{start:0,end:3,text:'Wait'},{start:5,end:8,text:'then continue.'}]).length,2);
 assert.equal(C.group([{start:0,end:35,text:'Long unfinished'},{start:35,end:42,text:'sentence.'}]).length,2);
});
test('real multiline subtitle files parse',()=>{
 const rows=C.vtt('WEBVTT\n\n00:00.000 --> 00:02.000\n** hello **\n\n00:02.000 --> 00:04.000\nworld.\n');
 assert.equal(rows.length,2);assert.equal(rows[0].text,'hello');
});

test('unfinished sentence crosses a short gap and the old 24 second cutoff',()=>{
 const rows=[{start:0,end:10,text:'If the condition holds'},{start:11.2,end:23,text:'we search until'},{start:24,end:30,text:'the answer is found.'},{start:30,end:37,text:'A new sentence.'}];
 const grouped=C.group(rows);assert.equal(grouped.length,2);assert.equal(grouped[0].end,30);assert.equal(grouped[1].start,30);
});
