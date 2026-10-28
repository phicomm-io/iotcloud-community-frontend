import test from 'node:test';
import assert from 'node:assert/strict';
import {connectLocal,savedLocalDevices,localPasswords} from './localConnection.js';

test('LAN identity preserves the firmware variant across reload without storing the WebUI password',async()=>{
 const values=new Map();
 const previous={location:globalThis.location,localStorage:globalThis.localStorage};
 globalThis.location={origin:'https://console.example'};
 globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};
 try{
  const calls=[];
  const device=await connectLocal('192.168.1.18','fixture-secret',async(url,options)=>{
   calls.push({url,options});if(url.endsWith('/auth/login'))return {ok:false,status:404};
   return {ok:true,status:200,json:async()=>({code:'ok',data:{api_version:1,model:'daikin',device_id:'AABBCCDDEEFF',firmware_variant:'hub'}})};
  });
  assert.equal(device.firmware_variant,'hub');
  assert.deepEqual(savedLocalDevices(),[device]);
  assert.equal(calls[0].url,'http://192.168.1.18/api/v1/info');
  assert.equal(calls[0].options.credentials,'omit');
  assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.equal(calls.find(call=>call.url.endsWith('/command')).options.headers.Authorization,'Basic '+btoa('admin:fixture-secret'));
  assert.equal(localPasswords.get(device.mac),'fixture-secret');
  assert(!JSON.stringify([...values]).includes('fixture-secret'));
 }finally{
  localPasswords.clear();
  for(const [key,value] of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;
 }
});
