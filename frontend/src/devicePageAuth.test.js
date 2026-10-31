import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceAuth,createDevicePageAuth,createDeviceWire} from './deviceAuth.js';
import {encodeWire} from './wireCodec.js';

const identity={api_version:1,device_id:'aabbccddeeff',model:'daikin',firmware_version:'rc5',variant:'hub',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack'};
const token='7'.repeat(32);
const response=(data,status=200)=>new Response(encodeWire(data),{status,headers:{'Content-Type':'application/msgpack'}});
function fixture({storageFailure=false}={}){
 let stored=null,protectedNow=true,reject=false,logins=0,writes=0,required=0;
 const calls=[];
 const store={read:()=>{if(storageFailure)throw Error('storage disabled');return stored;},write:value=>{if(storageFailure)throw Error('storage disabled');stored=structuredClone(value);},clear:()=>{if(storageFailure)throw Error('storage disabled');stored=null;}};
 const fetcher=async(path,options={})=>{
  calls.push({path,options});
  if(path.endsWith('/info'))return response({code:'ok',data:identity});
  if(path.endsWith('/login')){logins++;return response({code:'ok',data:protectedNow?{token}:{token:'',password_required:false}});}
  if(path.endsWith('/logout'))return response({code:'ok'});
  if(options.method==='POST')writes++;
  return response({code:reject?'unauthorized':'ok'},reject?401:200);
 };
 const page=()=>createDeviceAuth({fetcher,wire:createDeviceWire({fetcher}),sessionStore:store,onRequired:()=>required++});
 return {page,fetcher,calls,get stored(){return stored;},set stored(value){stored=value;},get logins(){return logins;},get writes(){return writes;},get required(){return required;},set protected(value){protectedNow=value;},set reject(value){reject=value;}};
}
test('root and hub pages reuse the same token after independently verifying identity',async()=>{
 const f=fixture();await f.page().login('adminfjr');
 assert(f.stored);assert(!JSON.stringify(f.stored).includes('adminfjr'));
 const hub=f.page();await Promise.all([hub.fetch('/api/auth/me'),hub.fetch('/api/devices')]);
 assert.equal(f.logins,1);assert.equal(f.calls.filter(c=>c.path.endsWith('/info')).length,2);
 assert.deepEqual(hub.headers(),{Authorization:'Bearer '+token});
 await hub.logout();assert.equal(f.stored,null);
 await f.page().ensure();assert.equal(f.logins,2);
});
test('expired authorization clears the shared token and never repeats a write',async()=>{
 const f=fixture();await f.page().login('adminfjr');const hub=f.page();f.reject=true;
 assert.equal((await hub.fetch('/api/hub/devices/aabbccddeeff/command',{method:'POST',value:{action:'indicator.set',params:{enabled:true}}})).status,401);
 assert.equal(f.writes,1);assert.equal(f.required,1);assert.equal(f.stored,null);assert.equal(f.logins,1);
 await assert.rejects(hub.ensure(),{status:401});assert.equal(f.writes,1);
});
test('device, firmware, token and expiry mismatches cannot restore a shared token',async()=>{
 const f=fixture();await f.page().login('adminfjr');const good=structuredClone(f.stored);
 for(const mutate of [s=>s.identity.device_id='000000000001',s=>s.identity.firmware_version='old',s=>s.token='bad',s=>s.expires=Date.now()-1,s=>s.expires=Date.now()+86400000]){
  f.stored=structuredClone(good);mutate(f.stored);const before=f.logins;
  await f.page().ensure();assert.equal(f.logins,before+1);
 }
});
test('an unprotected page never saves an empty session and disabled storage still permits login',async()=>{
 const f=fixture();f.protected=false;await f.page().ensure();assert.equal(f.stored,null);
 const disabled=fixture({storageFailure:true});const auth=disabled.page();await auth.login('adminfjr');assert.equal(auth.authenticated,true);
 await auth.logout();assert.equal(auth.authenticated,false);
});
test('password change clears the shared token before the next page can resume it',async()=>{
 const f=fixture(),auth=f.page();await auth.login('adminfjr');await auth.changePassword('changed-password');
 assert.equal(f.stored,null);assert.equal(auth.needsLogin,true);assert.equal(f.required,1);
});
test('page factory shares only same-origin tab tokens and preserves unrelated storage',async()=>{
 const names=['location','sessionStorage','localStorage'],original=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 const saved=new Map([['unrelated','keep']]);
 try{
  Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'http://device.local',href:'http://device.local/iotcloud/'}});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('must not persist a device token across browser sessions');}});
  const f=fixture();await createDevicePageAuth({fetcher:f.fetcher,wire:createDeviceWire({fetcher:f.fetcher})}).login('adminfjr');
  const stored=saved.get('iotcloud.device-session.v1');assert(stored);assert.equal(saved.get('unrelated'),'keep');
  const remote=fixture();await createDevicePageAuth({origin:'http://other.local',fetcher:remote.fetcher,wire:createDeviceWire({fetcher:remote.fetcher,origin:'http://other.local'})}).login('adminfjr');
  assert.equal(saved.get('iotcloud.device-session.v1'),stored);
 }finally{for(const name of names){const value=original.get(name);if(value)Object.defineProperty(globalThis,name,value);else delete globalThis[name];}}
});
