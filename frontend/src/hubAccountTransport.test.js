import test from 'node:test';
import assert from 'node:assert/strict';
import {createHubAccountTransport} from './hubAccountTransport.js';
import {encodeWire,decodeWire} from './wireCodec.js';
const token='0123456789abcdef0123456789abcdef';
const info={api_version:1,model:'daikin',device_id:'aabbccddeeff',firmware_version:'rc5',variant:'hub',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack'};
const response=(data,status=200)=>new Response(encodeWire(data),{status,headers:{'Content-Type':'application/msgpack'}});
test('hub sign-in uses the WebUI password and routes every API with the common token',async()=>{
 const calls=[],hub=createHubAccountTransport({fetcher:async(path,options)=>{
  calls.push({path,options});
  return response(path.endsWith('/info')?{code:'ok',data:info}:path==='/api/v1/auth/login'?{code:'ok',data:{token}}:{username:'existing_namespace'});
 }});
 const result=await hub.request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token.repeat(2),'Accept-Language':'en'},body:JSON.stringify({username:'ignored-account',password:'fixture-password'})});
 assert.equal((await hub.decodeResponse(result)).username,'existing_namespace');
 await hub.request('/api/hub/bridge',{method:'PUT',headers:{Authorization:'Bearer '+token.repeat(2)},body:JSON.stringify({enabled:false})});
 assert.deepEqual(calls.map(c=>c.path),['/api/v1/info','/api/v1/auth/login','/api/auth/me','/api/hub/bridge']);
 assert.deepEqual(decodeWire(calls[1].options.body),{password:'fixture-password'});
 for(const call of calls.slice(2)){assert.equal(call.options.headers.Authorization,'Bearer '+token);assert.equal(call.options.credentials,'omit');}
 assert.equal(calls[3].options.headers['Content-Type'],'application/msgpack');
 assert.deepEqual(decodeWire(calls[3].options.body),{enabled:false});
 await hub.request('/api/auth/logout',{method:'POST',body:'{}'});
 assert.equal(calls.at(-1).path,'/api/v1/auth/logout');
 assert.equal(calls.at(-1).options.headers.Authorization,'Bearer '+token);
});

test('password-free hub enters directly without a token or independent owner setup',async()=>{
 const calls=[],hub=createHubAccountTransport({fetcher:async(path,options)=>{
  calls.push({path,options});
  return response(path.endsWith('/info')?{code:'ok',data:info}:path==='/api/v1/auth/login'?{code:'ok',data:{password_required:false,token:''}}:{username:'admin'});
 }});
 const me=await hub.decodeResponse(await hub.request('/api/auth/me'));
 assert.equal(me.username,'admin');assert.deepEqual(calls.map(c=>c.path),['/api/v1/info','/api/v1/auth/login','/api/auth/me']);
 assert.equal(calls[2].options.headers.Authorization,undefined);
 await hub.request('/api/devices');assert.equal(calls.filter(c=>c.path==='/api/v1/auth/login').length,1);
});

test('expired WebUI session fails a hub write once without replaying or using an account token',async()=>{
 const calls=[];let required=0;
 const hub=createHubAccountTransport({onRequired:()=>required++,fetcher:async(path,options)=>{
  calls.push({path,options});
  return response(path.endsWith('/info')?{code:'ok',data:info}:path==='/api/v1/auth/login'?{code:'ok',data:{token}}:{code:'unauthorized'},path==='/api/hub/bridge'?401:200);
 }});
 await hub.login('fixture-password');
 assert.equal((await hub.request('/api/hub/bridge',{method:'PUT',body:'{}'})).status,401);
 assert.equal(required,1);
 await assert.rejects(hub.request('/api/hub/bridge',{method:'PUT',body:'{}'}),{code:'unauthorized'});
 assert.equal(calls.filter(c=>c.path==='/api/hub/bridge').length,1);
 assert.equal(calls.filter(c=>c.path==='/api/v1/auth/login').length,1);
});

test('hub account device list preserves root arrays without relaxing device envelopes',async()=>{
 const hub=createHubAccountTransport();const devices=[{device_id:'aabbccddeeff',model:'m1'}],bytes=encodeWire(devices);
 assert.throws(()=>decodeWire(bytes));
 assert.deepEqual(await hub.decodeResponse(new Response(bytes,{headers:{'Content-Type':'application/msgpack'}})),devices);
 assert.deepEqual(await hub.decodeResponse(new Response(JSON.stringify(devices),{headers:{'Content-Type':'application/json'}})),devices);
});
