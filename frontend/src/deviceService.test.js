import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../common/web/service.js',import.meta.url),'utf8');
function service(fetch){return new Function('fetch','globalThis',source+'\nreturn command;')(fetch,{crypto:globalThis.crypto});}
const binary=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function delayedService(){
 const calls=[];
 const call=service(async(url,options)=>{
  if(url.endsWith('/info'))return binary({code:'ok',data:{}});
  return new Promise((resolve,reject)=>{calls.push({options,resolve:data=>resolve(binary({code:'ok',data}))});options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});
 });return {call,calls};
}
test('overlapping equal reads share wire but cancellation and mutable results belong to subscribers',async()=>{
 const {call,calls}=delayedService(),a=new AbortController();
 const first=call('binding.status.get',{b:2,a:1},{signal:a.signal}),second=call('binding.status.get',{a:1,b:2});
 const rejected=assert.rejects(first,e=>e.name==='AbortError');await tick();assert.equal(calls.length,1);
 a.abort();await rejected;assert.equal(calls[0].options.signal.aborted,false);
 calls[0].resolve({peers:[{mac:'one'}]});assert.equal((await second).peers[0].mac,'one');
 const x=call('status.get'),y=call('status.get');await tick();assert.equal(calls.length,2);calls[1].resolve({nested:{value:1}});
 const [one,two]=await Promise.all([x,y]);one.nested.value=9;assert.equal(two.nested.value,1);
 const fresh=call('status.get');await tick();assert.equal(calls.length,3);calls[2].resolve({});await fresh;
});
test('all retired subscribers abort wire; late old replies never replace new read; writes stay distinct',async()=>{
 const {call,calls}=delayedService(),a=new AbortController(),b=new AbortController();
 const old=call('linkage.get',{}, {signal:a.signal}),other=call('linkage.get',{}, {signal:b.signal});
 const rejectOld=assert.rejects(old,e=>e.name==='AbortError'),rejectOther=assert.rejects(other,e=>e.name==='AbortError');
 await tick();a.abort();assert.equal(calls[0].options.signal.aborted,false);b.abort();await Promise.all([rejectOld,rejectOther]);assert.equal(calls[0].options.signal.aborted,true);
 const latest=call('linkage.get');await tick();assert.equal(calls.length,2);calls[0].resolve({old:true});calls[1].resolve({latest:true});assert.equal((await latest).latest,true);
 const writeA=call('fan.set',{speed:10}),writeB=call('fan.set',{speed:10});await tick();assert.equal(calls.length,3);calls[2].resolve({});await writeA;await tick();assert.equal(calls.length,4);calls[3].resolve({});await writeB;
});
test('successful mutation separates pending read generations and unequal views never merge',async()=>{
 const {call,calls}=delayedService();const old=call('status.get'),live=call('status.get',{view:'live'});await tick();assert.equal(calls.length,1);
 const write=call('fan.set',{speed:10});
 calls[0].resolve({old:true});await old;await tick();assert.equal(JSON.parse(calls[1].options.body).action,'fan.set','write precedes queued reads');
 calls[1].resolve({});await write;
 const fresh=call('status.get');await tick();assert.equal(calls.length,3);assert.deepEqual(JSON.parse(calls[2].options.body).params,{view:'live'});
 calls[2].resolve({live:true});await live;await tick();assert.equal(calls.length,4);calls[3].resolve({fresh:true});assert.equal((await fresh).fresh,true);
});

test('password changes retire the pending config read generation and invalidate status',async()=>{
 const reads=[];let invalidations=0;
 const session={fetch:async()=>new Promise(resolve=>reads.push(resolve)),changePassword:async password=>{assert.equal(password,'adminfjr');return {code:'ok',data:{saved:true}};}};
 const {call,api}=new Function('DeviceSession','globalThis',source+'\nreturn {call:command,api};')(session,{DeviceSession:session,crypto:globalThis.crypto,UI:{invalidateStatus(){invalidations++;}}});
 const old=call('config.get');await tick();assert.equal(reads.length,1);
 const password=api('/auth/password',{password:'adminfjr'});
 reads[0](binary({code:'ok',data:{old:true}}));await old;
 assert.equal((await password).saved,true);assert.equal(invalidations,1);
 const fresh=call('config.get');await tick();assert.equal(reads.length,2,'new read must not share the pre-password response');
 reads[1](binary({code:'ok',data:{fresh:true}}));
 assert.deepEqual(await Promise.all([old,fresh]),[{old:true},{fresh:true}]);
});

test('the lane includes body decoding, prioritizes writes then confirmations and drops cancelled queued reads',async()=>{
 const sent=[];let release;
 const call=service(async(url,options)=>{
  const request=JSON.parse(options.body);sent.push(request.action);
  return {ok:true,json:()=>request.action==='status.get'?new Promise(resolve=>release=()=>resolve({code:'ok',data:{}})):Promise.resolve({code:'ok',data:{}})};
 });
 const active=call('status.get');await tick();
 const cancelled=new AbortController(),writeSignal=new AbortController();
 const retired=call('binding.get',{}, {signal:cancelled.signal});
 const rejected=assert.rejects(retired,e=>e.name==='AbortError');
 const background=call('config.get'),confirmation=call('power.get',{}, {priority:1}),write=call('indicator.set',{enabled:true},{signal:writeSignal.signal});
 cancelled.abort();writeSignal.abort();await rejected;await tick();assert.deepEqual(sent,['status.get'],'headers alone must not release the lane');
 release();await Promise.all([active,background,confirmation,write]);
 assert.deepEqual(sent,['status.get','indicator.set','power.get','config.get']);
});

test('busy and network errors release the lane without retrying mutations',async()=>{
 const sent=[];
 const call=service(async(url,options)=>{
  const {action}=JSON.parse(options.body);sent.push(action);
  if(action==='fan.set')return new Response('unavailable',{status:503});
  if(action==='light.set')throw new TypeError('connection reset');
  return binary({code:'ok',data:{}});
 });
 const a=assert.rejects(call('fan.set',{speed:10}),e=>e.code==='busy');
 const b=assert.rejects(call('light.set',{enabled:true}),/connection reset/);
 await Promise.all([a,b,call('status.get')]);
 assert.deepEqual(sent,['fan.set','light.set','status.get']);
});
