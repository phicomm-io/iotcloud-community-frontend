import test from 'node:test';
import assert from 'node:assert/strict';
import {createHubAccountTransport} from './hubAccountTransport.js';
import {encodeWire,decodeWire} from './wireCodec.js';
test('hub account changes only envelope and preserves its account token, without WebUI login',async()=>{
 const calls=[],hub=createHubAccountTransport({fetcher:async(path,options)=>{
  calls.push({path,options});
  return new Response(encodeWire(path.endsWith('/info')?{code:'ok',data:{api_version:1,model:'daikin',device_id:'aabbccddeeff',firmware_version:'rc4',variant:'hub',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack'}}:{username:'owner'}),{headers:{'Content-Type':'application/msgpack'}});
 }});
 const response=await hub.request('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer hub-account','Accept-Language':'en'},body:JSON.stringify({username:'owner',password:'adminfjr'})});
 assert.equal((await hub.decodeResponse(response)).username,'owner');
 assert.deepEqual(calls.map(c=>c.path),['/api/v1/info','/api/auth/login']);
 const options=calls[1].options;assert.equal(options.headers['Content-Type'],'application/msgpack');assert.equal(options.headers.authorization,'Bearer hub-account');
 assert.deepEqual(decodeWire(options.body),{username:'owner',password:'adminfjr'});
 assert.equal(options.credentials,'include');
});

test('hub account device list preserves root arrays without relaxing device envelopes',async()=>{
 const hub=createHubAccountTransport();const devices=[{device_id:'aabbccddeeff',model:'m1'}],bytes=encodeWire(devices);
 assert.throws(()=>decodeWire(bytes));
 assert.deepEqual(await hub.decodeResponse(new Response(bytes,{headers:{'Content-Type':'application/msgpack'}})),devices);
 assert.deepEqual(await hub.decodeResponse(new Response(JSON.stringify(devices),{headers:{'Content-Type':'application/json'}})),devices);
});
