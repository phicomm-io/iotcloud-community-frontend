import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceWire} from './deviceWire.js';
import {createDeviceAuth} from './deviceAuth.js';
import {encodeWire,decodeWire} from './wireCodec.js';
const id='aabbccddeeff',token='f'.repeat(32);
const info={api_version:1,device_id:id,model:'a1',firmware_version:'rc4',variant:'full',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack'};
const reply=(data,format='msgpack',status=200)=>new Response(encodeWire(data,format),{status,headers:{'Content-Type':format==='msgpack'?'application/msgpack':'application/json'}});
test('public discovery binds format to device/firmware and all auth commands use MP',async()=>{
 const calls=[];const fetcher=async(path,options)=>{calls.push([path,options]);if(path.endsWith('/info'))return reply({code:'ok',data:info});assert.equal(options.headers['Content-Type'],'application/msgpack');const value=decodeWire(options.body,'msgpack');if(path.endsWith('/login')){assert.deepEqual(value,{password:'adminfjr'});return reply({code:'ok',data:{token}});}return reply({code:'ok',data:value});};
 const wire=createDeviceWire({fetcher,expectedIdentity:{mac:id,model:'a1'}}),auth=createDeviceAuth({fetcher,wire});
 await auth.login('adminfjr');const response=await auth.fetch('/api/v1/command',{method:'POST',value:{action:'fan.set',params:{speed:30}}});assert.equal((await wire.decodeResponse(response)).code,'ok');await auth.logout();assert.equal(calls[0][1].headers.Authorization,undefined);assert.equal(calls[2][1].headers.Authorization,'Bearer '+token);assert.deepEqual(wire.identity,{device_id:id,model:'a1',firmware_version:'rc4',variant:'full'});assert.equal(calls.filter(([p])=>p.endsWith('/info')).length,1);
});
test('legacy discovery selects JSON and only explicit login404 permits Basic',async()=>{
 const calls=[],fetcher=async(p,o)=>{calls.push([p,o]);if(p.endsWith('/info'))return reply({code:'ok',data:{api_version:1,device_id:id,model:'a1',version:'old'}},'json');if(p.endsWith('/login'))return reply({code:'not_found'},'json',404);return reply({code:'ok'},'json');};
 const wire=createDeviceWire({fetcher}),auth=createDeviceAuth({fetcher,wire});await auth.login('adminfjr');await auth.fetch('/api/v1/command',{method:'POST',value:{action:'status.get'}});assert.equal(wire.format,'json');assert.equal(calls.at(-1)[1].headers.Authorization,'Basic '+btoa('admin:adminfjr'));assert.equal(typeof calls.at(-1)[1].body,'string');
});
test('busy, timeout, malformed contract and mismatched identity never downgrade or send writes',async()=>{
 for(const fetcher of [async()=>reply({code:'busy'},'msgpack',503),async()=>{throw new DOMException('Timeout','AbortError');},async()=>reply({code:'ok',data:{...info,wire_version:99}}),async()=>reply({code:'ok',data:{...info,device_id:'001122334455'}})]){
  let calls=0;const wire=createDeviceWire({expectedIdentity:{mac:id},fetcher:(...args)=>{calls++;return fetcher(...args);}});await assert.rejects(wire.request('/api/v1/command',{method:'POST',value:{action:'fan.set'}}));assert.equal(calls,1);assert.equal(wire.format,null);
 }
});
test('business busy and network error preserve selected MP and never replay writes',async()=>{
 let attempts=0;const wire=createDeviceWire({fetcher:async(p)=>{if(p.endsWith('/info'))return reply({code:'ok',data:info});attempts++;if(attempts===1)return reply({code:'busy'},'msgpack',503);throw new TypeError('network');}});
 assert.equal((await wire.request('/api/v1/command',{method:'POST',value:{action:'fan.set'}})).status,503);await assert.rejects(wire.request('/api/v1/command',{method:'POST',value:{action:'fan.set'}}));assert.equal(attempts,2);assert.equal(wire.format,'msgpack');
});
test('forced rediscovery invalidates previous authenticated identity when firmware changes',async()=>{
 let firmware='rc4';const fetcher=async p=>p.endsWith('/info')?reply({code:'ok',data:{...info,firmware_version:firmware}}):reply({code:'ok',data:{token}});const wire=createDeviceWire({fetcher}),auth=createDeviceAuth({fetcher,wire});await auth.login('adminfjr');assert(auth.authenticated);firmware='rc5';await wire.discover({force:true});assert.equal(auth.authenticated,false);assert.equal(wire.identity.firmware_version,'rc5');
});
test('explicit password may verify a Basic-protected legacy info endpoint but never downgrade new info',async()=>{
 for(const newer of [false,true]){
  let calls=0;const fetcher=async(p,o)=>{calls++;if(!o.headers.Authorization)return reply({code:'unauthorized'},'json',401);assert.equal(o.headers.Authorization,'Basic '+btoa('admin:adminfjr'));return reply({code:'ok',data:newer?info:{api_version:1,device_id:id,model:'a1',version:'old'}},newer?'msgpack':'json');};const wire=createDeviceWire({fetcher});
  if(newer)await assert.rejects(wire.discover({legacyPassword:'adminfjr'}),/Invalid legacy discovery/);else {await wire.discover({legacyPassword:'adminfjr'});assert.equal(wire.format,'json');}assert.equal(calls,2);
 }
});
test('explicit login after verified firmware change rebinds before one token exchange',async()=>{
 let firmware='rc4',logins=0;const fetcher=async p=>p.endsWith('/info')?reply({code:'ok',data:{...info,firmware_version:firmware}}):p.endsWith('/login')?(logins++,reply({code:'ok',data:{token}})):reply({code:'ok'});
 const wire=createDeviceWire({fetcher}),auth=createDeviceAuth({fetcher,wire});await auth.login('adminfjr');firmware='rc5';await auth.login('adminfjr');assert.equal(auth.authenticated,true);assert.equal(wire.identity.firmware_version,'rc5');assert.equal(logins,2,'rebind does not replay login');
});

test('final send guard runs after discovery and prevents an obsolete waiting write',async()=>{
 const paths=[],wire=createDeviceWire({fetcher:async path=>{paths.push(path);return reply({code:'ok',data:info});}});
 await wire.discover();let current=true;
 const pending=wire.request('/api/v1/command',{method:'POST',value:{action:'fan.set'},beforeSend(){if(!current)throw Object.assign(Error('identity changed'),{code:'identity_changed'});}});
 current=false;await assert.rejects(pending,{code:'identity_changed'});assert.deepEqual(paths,['/api/v1/info']);
});
