const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('office login stores only session, rejects foreign callers, supports logout and local mode',async()=>{
 let listener,level;const store={},calls=[];
 const chrome={storage:{local:{setAccessLevel:async x=>level=x.accessLevel,get:async key=>({[key]:store[key]}),set:async data=>Object.assign(store,data),remove:async key=>delete store[key]}},runtime:{id:'extension',getURL:p=>'chrome-extension://extension/'+p,onMessage:{addListener:f=>listener=f},sendNativeMessage:async(_,body)=>({lines:body.lines.map(()=> '로컬 번역')})}};
 const c={chrome,AbortController,AbortSignal,performance,setTimeout,clearTimeout,OFFICE_ORIGIN:'https://office.example',HOST:'test',owner:null,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>url.endsWith('/login')?{token:'test-session',email:'test@example.test',expiresAt:Date.now()+14*86400000}:url.endsWith('/translate')?{jobId:'test-job'}:{ok:true,done:true,lines:['원격 번역']}}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/remote-client.js'),'utf8'),c);
 const send=msg=>new Promise(resolve=>listener(msg,{id:'extension',url:chrome.runtime.getURL('popup.html')},resolve));
 assert.equal(listener({type:'office-login'},{id:'extension',url:'https://www.youtube.com/'},()=>{throw Error('untrusted reply')}),undefined);
 let result=await send({type:'office-login',email:'test@example.test',password:'not-a-real-password'});assert.equal(result.email,'test@example.test');assert.equal(level,'TRUSTED_CONTEXTS');assert.equal(JSON.stringify(store).includes('not-a-real-password'),false);assert.equal(JSON.stringify(result).includes('test-session'),false);
 assert.equal(await c.translationMode(),'local');await c.officeTranslate(['English']);assert.equal(calls.at(-1).options.headers.Authorization,'Bearer test-session');assert.equal(calls.at(-1).options.credentials,'omit');
 assert.equal((await c.localTranslate(['English'])).lines[0],'로컬 번역');await send({type:'office-logout'});assert.equal(store.officeSession,undefined);
});
