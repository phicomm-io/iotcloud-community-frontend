import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceHttpSession} from './deviceHttpSession.js';
import {createDeviceTransport} from './deviceConnection.js';
import {connectLocal,localPasswords} from './localConnection.js';
import {encodeWire,decodeWire} from './wireCodec.js';
const id='aabbccddeeff',token='1'.repeat(32);
const identity={api_version:1,device_id:id,model:'a1',firmware_version:'rc4',variant:'full',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack'};
const reply=(value,status=200)=>new Response(encodeWire(value),{status,headers:{'Content-Type':'application/msgpack'}});
function server({loginStatus=200,commandStatus=200,device_id=id}={}){
 const calls=[],state={commandStatus};
 return {calls,state,fetcher:async(url,options={})=>{
  calls.push({url,options});
  if(url.endsWith('/info'))return reply({code:'ok',data:identity});
  assert.equal(options.headers['Content-Type'],'application/msgpack');
  const value=decodeWire(options.body);
  if(url.endsWith('/auth/login')){assert.equal(value.password,'adminfjr');return reply(loginStatus===200?{code:'ok',data:{token}}:{code:loginStatus===503?'busy':'unauthorized'},loginStatus);}
  assert.equal(options.headers.Authorization,'Bearer '+token);
  if(url.endsWith('/auth/logout'))return reply({code:'ok'});
  return reply({code:state.commandStatus===503?'busy':'ok',data:{device_id}},state.commandStatus);
 }};
}
test('host session uses discovered MP for auth and commands and retires only its own token',async()=>{
 const s=server(),session=createDeviceHttpSession({...s,password:'adminfjr'});
 await session.fetch('/api/v1/command',{method:'POST',value:{action:'status.get'}});
 assert.equal(s.calls[0].options.headers.Authorization,undefined);
 await session.release();
 assert.equal(s.calls.filter(c=>c.url.endsWith('/auth/logout')).length,1);
 await assert.rejects(session.ready(),{name:'AbortError'});
});
test('wrong password and capacity never downgrade or submit business requests',async()=>{
 for(const loginStatus of [401,503]){
  const s=server({loginStatus}),session=createDeviceHttpSession({...s,password:'adminfjr'});
  await assert.rejects(session.fetch('/api/v1/command',{method:'POST',value:{action:'fan.set'}}));
  assert.equal(s.calls.length,2);assert.equal(session.wire.format,'msgpack');await session.release();
 }
});
test('MP host write busy is explicit and never replayed over MQTT or another codec',async()=>{
 const s=server(),records={},transport=createDeviceTransport({...s,records});
 transport.configure('d',{mac:id,model:'a1',version:'v2'},{mode:'auto',address:'192.168.1.10'},'adminfjr');
 assert.equal(await transport.probe('d'),true);
 s.state.commandStatus=503;
 // Change the response after the successful initial status without changing discovery.
 const commands=s.calls.filter(c=>c.url.endsWith('/command')).length;
 let mqtt=0;
 const result=await transport.dispatch('d',{action:'fan.set',params:{on:true}},()=>{mqtt++;});
 assert.equal(result.code,'busy');assert.equal(mqtt,0);
 assert.equal(s.calls.filter(c=>c.url.endsWith('/command')).length,commands+1);
 assert.equal(decodeWire(s.calls.at(-1).options.body).action,'fan.set');
 transport.stop();
});
test('temporary local connection validates status identity and releases token without saving credentials',async()=>{
 const oldStorage=globalThis.localStorage,oldLocation=globalThis.location,values=new Map();
 globalThis.localStorage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};globalThis.location={origin:'http://localhost'};
 try{
  const s=server();const device=await connectLocal('192.168.1.10','adminfjr',s.fetcher);
  assert.equal(device.mac,id);assert(s.calls.at(-1).url.endsWith('/auth/logout'));assert(!JSON.stringify([...values]).includes('adminfjr'));
  const mismatch=server({device_id:'000000000000'});await assert.rejects(connectLocal('192.168.1.10','adminfjr',mismatch.fetcher));assert(mismatch.calls.at(-1).url.endsWith('/auth/logout'));
 }finally{localPasswords.clear();globalThis.localStorage=oldStorage;globalThis.location=oldLocation;}
});
test('host raw OTA uses Bearer once and replacing/removing entries retires sessions',async()=>{
 const s=server(),transport=createDeviceTransport({...s}),device={mac:id,model:'a1',version:'v2'},prefs={mode:'auto',address:'192.168.1.10'};
 transport.configure('d',device,prefs,'adminfjr');assert.equal(await transport.probe('d'),true);
 let sent=0,last;
 class XHR{constructor(){this.upload={};this.headers={};last=this;}open(){}setRequestHeader(k,v){this.headers[k]=v;}send(blob){this.blob=blob;sent++;this.status=401;this.responseText='expired';this.onload();}}
 const blob=new Blob(['firmware']);assert.equal((await transport.upload('d',blob,true,()=>{},XHR).promise).status,401);
 assert.equal(sent,1);assert.equal(last.headers.Authorization,'Bearer '+token);assert.equal(last.headers['Content-Type'],'application/octet-stream');assert.equal(last.blob,blob);
 transport.configure('d',device,prefs,'adminfjr',true);assert.equal(await transport.probe('d'),true);
 transport.retain([]);await new Promise(setImmediate);
 assert.equal(s.calls.filter(c=>c.url.endsWith('/auth/logout')).length,1,'only still-active owned token is retired');transport.stop();
});
test('shared discovery owns a deadline; a cancelled subscriber cannot cancel peers',async()=>{
 const s=server();let finish,first=true,discoverySignal;
 const session=createDeviceHttpSession({...s,password:'adminfjr',discoveryTimeout:1000,fetcher:async(url,options)=>{
  if(url.endsWith('/info')&&first){first=false;discoverySignal=options.signal;await new Promise(resolve=>{finish=resolve;});}
  return s.fetcher(url,options);
 }});
 const caller=new AbortController(),cancelled=session.ready(caller.signal),peer=session.ready();
 caller.abort();await assert.rejects(cancelled,{name:'AbortError'});assert.equal(discoverySignal.aborted,false);
 finish();await peer;assert.equal(session.auth.authenticated,true);await session.release();
});
test('timed-out discovery is aborted and subsequent discovery can recover',async()=>{
 const s=server();let first=true,aborted=false;
 const session=createDeviceHttpSession({...s,password:'adminfjr',discoveryTimeout:10,fetcher:async(url,options)=>{
  if(first&&url.endsWith('/info')){first=false;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('timeout','AbortError'));},{once:true}));}
  return s.fetcher(url,options);
 }});
 await assert.rejects(session.ready(),{name:'AbortError'});assert.equal(aborted,true);
 await session.ready();assert.equal(session.auth.authenticated,true);await session.release();
});
test('firmware and wire metadata changes replace discovery and retire the prior session',async()=>{
 for(const field of ['firmware_version','firmware_variant','variant','wire_format','wire_version']){
  const s=server(),transport=createDeviceTransport({...s}),prefs={mode:'auto',address:'192.168.1.10'},device={mac:id,model:'a1',version:'v2',firmware_version:'rc4',firmware_variant:'full',variant:'full',wire_format:'msgpack',wire_version:1};
  transport.configure('d',device,prefs,'adminfjr');await transport.probe('d');
  transport.configure('d',{...device},prefs,'adminfjr');await transport.probe('d');assert.equal(s.calls.filter(c=>c.url.endsWith('/info')).length,1);
  transport.configure('d',{...device,[field]:field==='wire_version'?2:field==='wire_format'?'json':field==='firmware_version'?'rc5':'lite'},prefs,'adminfjr');
  await transport.probe('d');assert.equal(s.calls.filter(c=>c.url.endsWith('/info')).length,2,field);assert.equal(s.calls.filter(c=>c.url.endsWith('/auth/logout')).length,1,field);transport.stop();
 }
});

test('host raw upload decodes a MessagePack error without reading responseText or replaying',async()=>{
 const s=server(),transport=createDeviceTransport({...s});transport.configure('d',{mac:id,model:'a1',version:'v2'},{mode:'auto',address:'192.168.1.10'},'adminfjr');assert(await transport.probe('d'));let sent=0;
 class XHR{constructor(){this.upload={};}open(){}setRequestHeader(){}getResponseHeader(){return 'application/msgpack';}get responseText(){throw Error('binary responseText is unavailable');}send(){sent++;this.status=503;this.response=encodeWire({code:'busy',message:'Try again'}).buffer;this.onload();}}
 assert.deepEqual(await transport.upload('d',new Blob(['firmware']),true,()=>{},XHR).promise,{status:503,text:'Try again'});assert.equal(sent,1);transport.stop();
});
test('release queued immediately after readiness cannot relogin or send a command',async()=>{
 const s=server(),session=createDeviceHttpSession({...s,password:'adminfjr'});
 const ready=session.ready();ready.then(()=>session.release());
 await assert.rejects(session.fetch('/api/v1/command',{method:'POST',value:{action:'status.get',params:{}}}),{name:'AbortError'});
 await new Promise(setImmediate);
 assert.equal(s.calls.filter(c=>c.url.endsWith('/auth/login')).length,1);
 assert.equal(s.calls.filter(c=>c.url.endsWith('/command')).length,0);
 assert.equal(session.auth.authenticated,false);
});
