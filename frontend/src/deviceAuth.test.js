import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceAuth} from './deviceAuth.js';
const encodeWire=value=>JSON.stringify(value);
const decodeWire=value=>JSON.parse(typeof value==='string'?value:new TextDecoder().decode(value));
const token='1'.repeat(32),other='2'.repeat(32);
const reply=(data,status=200)=>new Response(encodeWire(data),{status,headers:{'Content-Type':'application/json'}});
const logged=(value=token)=>reply({code:'ok',data:{token:value,expires_in_ms:1800000,max_age_ms:86400000}});
test('empty password is exchanged once and concurrent business requests only send bearer',async()=>{
 const calls=[];let open;const gate=new Promise(resolve=>open=resolve);
 const auth=createDeviceAuth({origin:'http://192.168.1.10',fetcher:async(url,options)=>{calls.push({url,options});if(url.endsWith('/login')){await gate;assert.deepEqual(decodeWire(options.body),{password:''});return logged();}return reply({code:'ok'});}});
 const a=auth.fetch('/api/v1/info'),b=auth.fetch('/api/v1/status');await new Promise(setImmediate);assert.equal(calls.length,1);open();await Promise.all([a,b]);
 assert.equal(calls.length,3);assert.equal(calls[0].options.headers.Authorization,undefined);
 for(const call of calls.slice(1)){assert.equal(call.options.headers.Authorization,'Bearer '+token);assert.equal(call.options.credentials,'omit');assert(!call.url.includes(token));}
 assert.equal(auth.authenticated,true);
});
test('password 401 blocks automatic retries, explicit login accepts a new session',async()=>{
 let attempts=0,required=0;
 const auth=createDeviceAuth({onRequired:()=>required++,fetcher:async(_,options)=>{attempts++;return decodeWire(options.body).password==='correct'?logged():reply({code:'unauthorized'},401);}});
 await assert.rejects(auth.login('wrong'),{status:401});await assert.rejects(auth.ensure(),{status:401});assert.equal(attempts,1);assert.equal(required,1);
 await auth.login('correct');assert.equal(auth.authenticated,true);assert.equal(auth.needsLogin,false);
});
test('expired 401 retires bearer and never replays a mutation; 503 does not log out',async()=>{
 let mode=503,required=0;const calls=[];
 const auth=createDeviceAuth({onRequired:()=>required++,fetcher:async(url,options)=>{calls.push([url,options]);return url.endsWith('/login')?logged():reply({code:mode===401?'unauthorized':'busy'},mode);}});
 await auth.login('secret');assert.equal((await auth.fetch('/api/v1/command',{method:'POST',body:new Uint8Array([1])})).status,503);assert.equal(auth.authenticated,true);assert.equal(required,0);
 mode=401;assert.equal((await auth.fetch('/api/v1/command',{method:'POST',body:new Uint8Array([2])})).status,401);assert.equal(auth.authenticated,false);assert.equal(required,1);
 await assert.rejects(auth.fetch('/api/v1/command',{method:'POST'}),{status:401});assert.equal(calls.length,3);
});
test('busy login is not mistaken for wrong credentials and can be explicitly retried',async()=>{
 let attempts=0,required=0;
 const auth=createDeviceAuth({onRequired:()=>required++,fetcher:async()=>++attempts===1?reply({code:'busy'},503):logged()});
 await assert.rejects(auth.login(''),{status:503});assert.equal(required,0);assert.equal(auth.needsLogin,false);await auth.login('');assert.equal(auth.authenticated,true);
});
test('logout and password change revoke local token without persisting it',async()=>{
 const calls=[];let required=0;const auth=createDeviceAuth({onRequired:()=>required++,fetcher:async(url,options)=>{calls.push([url,options]);return url.endsWith('/login')?logged():reply({code:'accepted',data:{}});}});
 await auth.login('initial');await auth.changePassword('new-password');assert.equal(auth.authenticated,false);assert.equal(required,1);
 assert.equal(calls[1][0],'/api/v1/command');const changed=decodeWire(calls[1][1].body);assert.equal(changed.action,'config.set');assert.deepEqual(changed.params,{section:'auth',values:{password:'new-password'}});assert.equal(typeof changed.request_id,'string');assert.equal(calls[1][1].headers.Authorization,'Bearer '+token);
 await auth.login('new-password');await auth.logout();assert.equal(auth.authenticated,false);assert.equal(required,2);assert.equal(calls.at(-1)[0],'/api/v1/auth/logout');
});
test('page reload has no inherited token and stale in-flight login cannot restore one',async()=>{
 let release;const first=createDeviceAuth({fetcher:url=>url.endsWith('/logout')?Promise.resolve(reply({code:'ok'})):new Promise(resolve=>release=resolve)});
 const pending=first.login('');first.reset();release(logged());await assert.rejects(pending,{code:'cancelled'});assert.equal(first.authenticated,false);
 const second=createDeviceAuth({fetcher:async()=>logged(other)});assert.equal(second.authenticated,false);await second.login('');assert.deepEqual(second.headers(),{Authorization:'Bearer '+other});
});
test('only explicit not-found login permits legacy Basic; malformed success never does',async()=>{
 const old=createDeviceAuth({fetcher:async()=>new Response('',{status:404})});await old.login('legacy-password');assert.equal(old.headers().Authorization,'Basic '+btoa('admin:legacy-password'));
 const invalid=createDeviceAuth({fetcher:async()=>reply({code:'ok',data:{token:'bad'}})});await assert.rejects(invalid.login(''),/Invalid device session/);assert.deepEqual(invalid.headers(),{});
 const strict=createDeviceAuth({allowLegacy:false,fetcher:async()=>new Response('',{status:404})});await assert.rejects(strict.login(''),{status:404});assert.deepEqual(strict.headers(),{});
});

test('late unauthorized request cannot retire a newly exchanged session',async()=>{
 let release,logins=0;const auth=createDeviceAuth({fetcher:async url=>url.endsWith('/login')?logged(++logins===1?token:other):url.endsWith('/logout')?reply({code:'ok'}):new Promise(resolve=>release=resolve)});await auth.login('');const stale=auth.fetch('/api/v1/status');await new Promise(setImmediate);await auth.login('new');release(reply({code:'unauthorized'},401));await stale;assert.equal(auth.headers().Authorization,'Bearer '+other);assert.equal(auth.needsLogin,false);
});

test('explicit legacy login keeps password change compatible with JSON-only command APIs',async()=>{
 let sent;const auth=createDeviceAuth({fetcher:async(url,options)=>{if(url.endsWith('/login'))return new Response('',{status:404});sent={url,options};return new Response(JSON.stringify({code:'ok',data:{}}),{headers:{'Content-Type':'application/json'}});}});await auth.login('legacy-password');await auth.changePassword('changed');assert.equal(sent.url,'/api/v1/command');assert.equal(sent.options.headers['Content-Type'],'application/json');assert.equal(sent.options.headers.Authorization,'Basic '+btoa('admin:legacy-password'));assert.equal(JSON.parse(sent.options.body).params.values.password,'changed');assert.equal(auth.authenticated,false);
});

test('page release dispatches keepalive logout immediately and retires local session',async()=>{
 const calls=[];let required=0,fail=false;
 const auth=createDeviceAuth({onRequired:()=>required++,fetcher:(url,options)=>{
  calls.push({url,options});if(url.endsWith('/login'))return Promise.resolve(logged());
  if(fail)throw Error('page closed');return Promise.resolve(reply({code:'ok'}));
 }});
 await auth.login('');const released=auth.release();
 assert.equal(calls.at(-1).url,'/api/v1/auth/logout');assert.equal(calls.at(-1).options.keepalive,true);
 assert.equal(calls.at(-1).options.headers.Authorization,'Bearer '+token);assert.deepEqual(decodeWire(calls.at(-1).options.body),{});
 assert.equal(auth.authenticated,false);assert.equal(auth.needsLogin,false);assert.equal(required,0);await released;
 await auth.ensure();fail=true;await auth.release();assert.equal(required,0);
 const count=calls.length;await auth.release();assert.equal(calls.length,count);
});
test('full session pool blocks automatic repeated login attempts',async()=>{
 let attempts=0;
 const auth=createDeviceAuth({fetcher:async()=>{attempts++;return reply({code:'unauthorized'},401);}});
 await assert.rejects(auth.ensure(),{status:401});await assert.rejects(auth.ensure(),{status:401});assert.equal(attempts,1);
});

test('legacy endpoint 404 followed by business 401 requests a password and accepts explicit Basic login',async()=>{
 let required=0;const calls=[];
 const authorization='Basic '+btoa('admin:adminfjr');
 const auth=createDeviceAuth({onRequired:()=>required++,fetcher:async(url,options)=>{
  calls.push({url,options});if(url.endsWith('/login'))return new Response('',{status:404});
  return options.headers.Authorization===authorization?reply({code:'ok',data:{name:'legacy'}}):reply({code:'unauthorized'},401);
 }});
 assert.equal((await auth.fetch('/api/v1/command',{method:'POST',body:'{}'})).status,401);
 assert.equal(required,1);assert.equal(auth.authenticated,false);assert.equal(auth.needsLogin,true);
 assert.equal(calls.length,2,'legacy 401 must not silently repeat empty-password login');
 await assert.rejects(auth.ensure(),{status:401});assert.equal(calls.length,2);
 await auth.login('adminfjr');assert.equal(calls.length,3);assert.equal(auth.needsLogin,false);
 const response=await auth.fetch('/api/v1/command',{method:'POST',body:'{}'});
 assert.equal(response.status,200);assert.equal(calls.at(-1).options.headers.Authorization,authorization);assert.equal(required,1);
});
test('a real empty-password token 401 renews silently without replaying the original command',async()=>{
 let required=0,logins=0,writes=0;
 const auth=createDeviceAuth({onRequired:()=>required++,fetcher:async url=>{
  if(url.endsWith('/login'))return logged(++logins===1?token:other);
  writes++;return reply({code:'unauthorized'},401);
 }});
 assert.equal((await auth.fetch('/api/v1/command',{method:'POST',body:'{}'})).status,401);
 assert.equal(logins,2);assert.equal(writes,1);assert.equal(required,0);assert.equal(auth.headers().Authorization,'Bearer '+other);
});

for(const retire of ['release','logout'])test(`late password-change reply after ${retire} cannot clear a new session`,async()=>{
 let finishChange,required=0,logins=0;const retired=[];
 const auth=createDeviceAuth({onRequired:()=>required++,fetcher:async(url,options)=>{
  if(url.endsWith('/login'))return logged(++logins===1?token:other);
  if(url.endsWith('/logout')){retired.push(options.headers.Authorization);return reply({code:'ok'});}
  return new Promise(resolve=>finishChange=()=>resolve(reply({code:'ok',data:{saved:true}})));
 }});
 await auth.login('adminfjr');const change=auth.changePassword('adminfjr');await new Promise(setImmediate);
 await auth[retire]();await auth.login('adminfjr');const previousRequired=required;
 assert.deepEqual(retired,['Bearer '+token]);finishChange();assert.equal((await change).data.saved,true);
 assert.equal(auth.headers().Authorization,'Bearer '+other);assert.equal(auth.authenticated,true);assert.equal(auth.needsLogin,false);assert.equal(required,previousRequired);
 assert.deepEqual(retired,['Bearer '+token],'the late result must not revoke the replacement token');
});

test('late logout completion cannot clear or revoke a replacement session',async()=>{
 let finishLogout,required=0,logins=0;const retired=[];
 const auth=createDeviceAuth({onRequired:()=>required++,fetcher:async(url,options)=>{
  if(url.endsWith('/login'))return logged(++logins===1?token:other);
  retired.push(options.headers.Authorization);
  if(retired.length===1)return new Promise(resolve=>finishLogout=()=>resolve(reply({code:'ok'})));
  return reply({code:'ok'});
 }});
 await auth.login('adminfjr');const logout=auth.logout();await new Promise(setImmediate);
 await auth.login('adminfjr');assert.equal(auth.headers().Authorization,'Bearer '+other);
 finishLogout();await logout;assert.equal(auth.headers().Authorization,'Bearer '+other);assert.equal(auth.authenticated,true);assert.equal(auth.needsLogin,false);assert.equal(required,0);
 assert.deepEqual(retired,['Bearer '+token,'Bearer '+token],'both logout requests target only the original session');
});

test('late unauthenticated legacy 401 cannot clear a replacement Basic identity',async()=>{
 let finishOld,required=0;const authorization='Basic '+btoa('admin:adminfjr');
 const auth=createDeviceAuth({onRequired:()=>required++,fetcher:async(url,options)=>{
  if(url.endsWith('/login'))return new Response('',{status:404});
  if(options.headers.Authorization===authorization)return reply({code:'ok'});
  return new Promise(resolve=>finishOld=()=>resolve(reply({code:'unauthorized'},401)));
 }});
 const old=auth.fetch('/api/v1/command',{method:'POST',body:'{}'});await new Promise(setImmediate);
 await auth.login('adminfjr');assert.equal(auth.headers().Authorization,authorization);
 finishOld();assert.equal((await old).status,401);assert.equal(auth.headers().Authorization,authorization);assert.equal(auth.authenticated,true);assert.equal(auth.needsLogin,false);assert.equal(required,0);
 assert.equal((await auth.fetch('/api/v1/command',{method:'POST',body:'{}'})).status,200);
});
