const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const html=require('./render_page.cjs')('A1/web/index.html');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(fetch){
 const dom=new JSDOM(html,{url:'http://device.local',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.fetch=(url,options)=>url.endsWith('/api/v1/info')?Promise.resolve(response(200,{code:'ok',data:{api_version:1,device_id:'aabbccddeeff',model:'a1',version:'old'}})):fetch(url,options);w.scrollTo=()=>{};
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
 for(const source of scripts.slice(0,-1))vm.runInContext(source,dom.getInternalVMContext());
 return {dom,w};
}
const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
const token='a'.repeat(32);
test('unset device password obtains a token without opening a dialog; logout releases only that token',async()=>{
 const calls=[],x=setup(async(url,options)=>{calls.push({url,options});return response(200,{code:'ok',data:url.endsWith('/login')?{token}:{}});});
 try{await x.w.DeviceSession.ready();assert.equal(x.w.document.querySelector('dialog'),null);assert.deepEqual(JSON.parse(calls[0].options.body),{password:''});
 await x.w.DeviceSession.fetch('/api/v1/command',{method:'POST',body:'{}'});assert.equal(calls[1].options.headers.Authorization,'Bearer '+token);
 await x.w.DeviceSession.logout();assert.equal(calls[2].url,'/api/v1/auth/logout');assert.equal(calls[2].options.headers.Authorization,'Bearer '+token);assert.equal(x.w.document.querySelector('dialog'),null);
 }finally{x.dom.window.close();}
});
test('wrong password opens a styled dialog, clears submitted passwords and acquires a new session',async()=>{
 const calls=[],x=setup(async(url,options)=>{calls.push({url,options});const password=JSON.parse(options.body).password;return password==='adminfjr'?response(200,{code:'ok',data:{token}}):response(401,{code:'unauthorized'});});
 try{const ready=x.w.DeviceSession.ready();await tick();const dialog=x.w.document.querySelector('dialog');assert(dialog);assert(dialog.querySelector('button').classList.contains('primary'));
 dialog.querySelector('input').value='adminfjr';dialog.querySelector('form').dispatchEvent(new x.w.Event('submit',{cancelable:true}));await ready;assert.equal(x.w.document.querySelector('dialog'),null);assert.equal(x.w.DeviceSession.headers().Authorization,'Bearer '+token);
 }finally{x.dom.window.close();}
});
test('session capacity busy remains retryable without asking for a password',async()=>{
 const x=setup(async()=>response(503,{code:'busy'}));try{await assert.rejects(x.w.DeviceSession.ready(),{status:503});assert.equal(x.w.document.querySelector('dialog'),null);assert.equal(x.w.DeviceSession.needsLogin,false);}finally{x.dom.window.close();}
});
test('expired write reports its original 401 and is never replayed',async()=>{
 let writes=0;const x=setup(async(url)=>url.endsWith('/login')?response(200,{code:'ok',data:{token}}):(writes++,response(401,{code:'unauthorized'})));
 try{await x.w.DeviceSession.login('adminfjr');const result=await x.w.DeviceSession.fetch('/api/v1/command',{method:'POST',body:'{}'});assert.equal(result.status,401);assert.equal(writes,1);assert(x.w.document.querySelector('dialog'));}finally{x.dom.window.close();}
});
test('minified native page discovers MP, logs in without a dialog and writes exactly once on busy',async()=>{
 const {encodeWire,decodeWire}=await import('../frontend/src/wireCodec.js'),calls=[];
 const source=require('node:child_process').execFileSync('python3',['common/web/page.py','A1/web/index.html','--minify'],{encoding:'utf8'});
 const dom=new JSDOM(source,{url:'http://device.local',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 Object.assign(w,{TextEncoder,TextDecoder,Response,AbortController});w.scrollTo=()=>{};
 w.fetch=async(url,options)=>{
  if(url.endsWith('/info'))return new Response(encodeWire({code:'ok',data:{api_version:1,device_id:'aabbccddeeff',model:'a1',firmware_version:'rc4',variant:'full',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack'}}),{headers:{'Content-Type':'application/msgpack'}});
  assert.equal(options.headers['Content-Type'],'application/msgpack');const request=decodeWire(options.body,'msgpack');calls.push({url,options,request});
  const login=url.endsWith('/login');return new Response(encodeWire(login?{code:'ok',data:{token}}:{code:'busy'}),{status:login?200:503,headers:{'Content-Type':'application/msgpack'}});
 };
 try{
  const scripts=[...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);for(const script of scripts.slice(0,-1))vm.runInContext(script,dom.getInternalVMContext());await w.DeviceSession.ready();assert.equal(w.document.querySelector('dialog'),null);
  await assert.rejects(w.eval("command('fan.set',{speed:42})"),error=>error.code==='busy');assert.equal(calls.filter(x=>x.request.action==='fan.set').length,1);assert.equal(calls.at(-1).options.headers.Authorization,'Bearer '+token);assert.equal(w.DeviceSession.wire.format,'msgpack');
 }finally{dom.window.close();}
});
