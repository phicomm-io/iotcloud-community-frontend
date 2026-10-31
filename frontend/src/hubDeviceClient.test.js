import test from 'node:test';
import assert from 'node:assert/strict';
import {createHubDeviceClient,hubDeviceEntry,hubDeviceReadable} from './hubDeviceClient.js';
import {hubPowerReading} from './hubMeter.js';

const device=(mac='aabbccddee01',model='tc1')=>hubDeviceEntry({mac,model,version:'v2',firmware_version:'rc5',firmware_variant:'full',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const capability=(d,actions=['status.get','power.get'])=>({device_id:d.mac,model:d.model,firmware_version:d.firmware_version,firmware_variant:d.variant,actions});
async function read(f,device,action,data,code='ok'){
 const index=f.calls.length,pending=f.client.dispatch(device,{action});await tick();f.reply(index,data,code);return pending;
}
function fixture(options={}){
 const calls=[],status=[],caps=[];
 const client=createHubDeviceClient({onStatus:(...values)=>status.push(values),onCapabilities:(...values)=>caps.push(values),request:(path,options)=>new Promise((resolve,reject)=>{
  const data=JSON.parse(options.body);calls.push({path,options,data,resolve,reject});options.signal.addEventListener('abort',()=>reject(new DOMException('Timeout','AbortError')),{once:true});
 }),...options});
 const one=device(),two=device('aabbccddee02','m1');client.retain([one,two]);
 const reply=(index,data={},code='ok')=>{const call=calls[index];call.resolve({code,data,request_id:call.data.request_id});};
 return {client,calls,status,caps,one,two,reply};
}
test('discovery selects the binary contract and missing discovery blocks every device command',async()=>{
 const f=fixture(),unknown=hubDeviceEntry({mac:f.one.mac,model:'tc1'});f.client.retain([unknown]);
 assert.equal((await f.client.dispatch(unknown,{action:'outlet.set',params:{on:true}})).code,'discovery_required');
 assert.equal(f.calls.length,0);assert.equal(f.one.wire_format,'msgpack');assert.equal(f.one.variant,'full');
});
test('all targets and all settings share one lane through decoding; writes precede background reads',async()=>{
 const f=fixture(),first=f.client.dispatch(f.one,{action:'status.get'}),second=f.client.dispatch(f.two,{action:'status.get'},{background:true}),write=f.client.dispatch(f.two,{action:'time.set',params:{timezone_minutes:0}});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].path,'/hub/devices/aabbccddee01/command');
 f.reply(0,{device_id:f.one.mac,sensor_valid:true,power_watts:12});await first;await tick();
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].data.action,'time.set');
 f.reply(1,{},'accepted');await write;await tick();assert.equal(f.calls.length,3);assert.equal(f.calls[2].data.action,'status.get');
 f.reply(2,{device_id:f.two.mac,sensor_valid:true});await second;
 assert.equal(f.status[0][1].power_watts,12);assert.equal(f.status[0][1].sensorFresh,true);
});
test('overlapping reads merge with independent cancellation and mutations never merge',async()=>{
 const f=fixture(),cancel=new AbortController();
 const one=f.client.dispatch(f.one,{action:'config.get',params:{section:'time'},request_id:'read-one'},{signal:cancel.signal});
 const two=f.client.dispatch(f.one,{action:'config.get',params:{section:'time'},request_id:'read-two'});
 const rejected=assert.rejects(one,{name:'AbortError'});cancel.abort();await rejected;assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.signal.aborted,false);
 f.reply(0,{timezone_minutes:0});assert.deepEqual((await two).data,{timezone_minutes:0});
 const writes=[f.client.dispatch(f.one,{action:'indicator.set',params:{enabled:true}}),f.client.dispatch(f.one,{action:'indicator.set',params:{enabled:true}})];
 f.reply(1,{},'accepted');await writes[0];await tick();assert.equal(f.calls.length,3);f.reply(2,{},'accepted');await writes[1];
 assert.notEqual(f.calls[1].data.request_id,f.calls[2].data.request_id);
});
test('page cancellation retires queued reads and drains an active read before the next write',async()=>{
 const f=fixture(),one=f.client.dispatch(f.one,{action:'status.get'}),two=f.client.dispatch(f.two,{action:'status.get'});
 const rejected=[assert.rejects(one,{name:'AbortError'}),assert.rejects(two,{name:'AbortError'})];f.client.cancelReads();await Promise.all(rejected);
 const controller=new AbortController(),write=f.client.dispatch(f.two,{action:'indicator.set',params:{enabled:false}},{signal:controller.signal});controller.abort();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.signal.aborted,false);
 f.reply(0,{device_id:f.one.mac,sensor_valid:true});await tick();assert.equal(f.status.length,0);assert.equal(f.calls.length,2);
 f.reply(1,{},'accepted');assert.equal((await write).code,'accepted');assert.equal(f.calls.length,2);
});
test('old firmware, wrong device and stale pre-write status cannot update the current cache',async()=>{
 const f=fixture(),old=f.client.dispatch(f.one,{action:'status.get'}),rejected=assert.rejects(old,{name:'AbortError'});
 const next={...f.one,firmware_version:'rc6'};f.client.retain([next,f.two]);await rejected;f.reply(0,{device_id:f.one.mac,power_watts:999,sensor_valid:true});await tick();assert.equal(f.status.length,0);
 const wrong=f.client.dispatch(next,{action:'status.get'});f.reply(1,{device_id:f.two.mac});assert.equal((await wrong).code,'identity_mismatch');assert.equal(f.status.length,0);
 const before=f.client.dispatch(next,{action:'status.get'}),write=f.client.dispatch(next,{action:'outlet.set',params:{on:true}});
 f.reply(2,{device_id:next.mac,power_watts:1});await before;await tick();assert.equal(f.status.length,0);f.reply(3,{},'accepted');await write;
});
test('capabilities must match the discovery identity before being accepted',async()=>{
 const f=fixture(),bad=f.client.dispatch(f.one,{action:'capabilities.get'});f.reply(0,{device_id:f.one.mac,model:'m1',firmware_version:'rc5',firmware_variant:'full'});
 assert.equal((await bad).code,'identity_mismatch');assert.equal(f.caps.length,0);
 const good=f.client.dispatch(f.one,{action:'capabilities.get'});f.reply(1,{device_id:f.one.mac,model:'tc1',firmware_version:'rc5',firmware_variant:'full',actions:['status.get']});
 assert.equal((await good).code,'ok');assert.equal(f.caps.length,1);
});
test('busy, expiration, timeout and uncertain writes are never retried',async()=>{
 const f=fixture({timeoutMs:30});
 const busy=f.client.dispatch(f.one,{action:'outlet.set',params:{on:true}});f.calls[0].reject({reply:{code:'busy',request_id:f.calls[0].data.request_id}});assert.equal((await busy).code,'busy');
 const expired=f.client.dispatch(f.one,{action:'config.set',params:{section:'time'}});f.calls[1].reject({code:'unauthorized'});assert.equal((await expired).code,'unauthorized');
 const timeout=f.client.dispatch(f.one,{action:'outlet.set'});assert.equal((await timeout).code,'timeout');
 const uncertain=f.client.dispatch(f.one,{action:'outlet.set'});f.calls[3].reject(Error('Connection closed'));assert.equal((await uncertain).code,'uncertain');
 assert.equal(f.calls.length,4);
});
test('stopping a page cancels reads while an accepted queued write still completes',async()=>{
 const f=fixture(),read=f.client.dispatch(f.one,{action:'status.get'}),write=f.client.dispatch(f.two,{action:'indicator.set'}),rejected=assert.rejects(read,{name:'AbortError'});
 f.client.stop();await rejected;f.reply(0,{device_id:f.one.mac});await tick();assert.equal(f.calls.length,2);f.reply(1,{},'accepted');assert.equal((await write).code,'accepted');assert.equal(f.status.length,0);
});

test('TC1 refresh reads capabilities and power on the same lane and merges only into the complete status',async()=>{
 let now=1000;const f=fixture({now:()=>now}),pending=f.client.refreshState(f.one,{background:true});
 f.reply(0,{device_id:f.one.mac,name:'TC1',socket_states:[true,false,false,false,false,false]});await tick();
 assert.equal(f.calls[1].data.action,'capabilities.get');f.reply(1,capability(f.one));await tick();
 assert.equal(f.calls[2].data.action,'power.get');now=2000;f.reply(2,{power_watts:0,energy_kwh:.25});await pending;
 assert.equal(f.status.length,2);let state=f.status.at(-1)[1];
 assert.equal(state.name,'TC1');assert.deepEqual(state.socket_states,[true,false,false,false,false,false]);assert.equal(state.sensorAt,1000);
 assert.equal(state.hubPower.receivedAt,2000);assert.equal(hubPowerReading(state,2000),0);
 now=3000;await read(f,f.one,'status.get',{device_id:f.one.mac,name:'TC1',socket_states:[false,false,false,false,false,false]});
 state=f.status.at(-1)[1];assert.equal(state.sensorAt,3000);assert.equal(state.hubPower.receivedAt,2000);assert.equal(hubPowerReading(state,16999),0);assert.equal(hubPowerReading(state,17000),null);
 assert.deepEqual(state.socket_states,[false,false,false,false,false,false]);
});

test('unsupported and failed power reads preserve the last sample and other state; invalid data invalidates only watts',async()=>{
 let now=1000;const f=fixture({now:()=>now});
 await read(f,f.one,'status.get',{device_id:f.one.mac,name:'TC1',socket_states:[true,false,false,false,false,false]});
 await read(f,f.one,'power.get',{power_watts:12});const accepted=f.status.length;
 await read(f,f.one,'power.get',{},'unsupported');assert.equal(f.status.length,accepted);
 const failed=f.client.dispatch(f.one,{action:'power.get'});f.calls.at(-1).reject(Error('offline'));await failed;assert.equal(f.status.length,accepted);
 now=6000;await read(f,f.one,'status.get',{device_id:f.one.mac,name:'same TC1',socket_states:[true,false,false,false,false,false]});
 assert.equal(f.status.at(-1)[1].hubPower.receivedAt,1000);assert.equal(hubPowerReading(f.status.at(-1)[1],6000),12);
 await read(f,f.one,'power.get',{power_watts:99,valid:false});const state=f.status.at(-1)[1];
 assert.equal(state.name,'same TC1');assert.equal(state.sensorAt,6000);assert.equal(state.socket_states[0],true);assert.equal(hubPowerReading(state,6000),null);
});

test('a power-only reply cannot replace a device snapshot and a mismatched meter identity is rejected',async()=>{
 const f=fixture();await read(f,f.one,'power.get',{power_watts:8});assert.equal(f.status.length,0);
 assert.equal((await read(f,f.one,'power.get',{device_id:f.two.mac,power_watts:999})).code,'identity_mismatch');
 await read(f,f.one,'status.get',{device_id:f.one.mac,name:'full'});assert.equal(f.status.at(-1)[1].hubPower.power_watts,8);assert.equal(f.status.at(-1)[1].name,'full');
});

test('cancelled, replaced and pre-write meter replies cannot populate the current device',async()=>{
 for(const change of ['cancel','identity','write']){
  const f=fixture();await read(f,f.one,'status.get',{device_id:f.one.mac,name:'old'});
  const pending=f.client.dispatch(f.one,{action:'power.get'}),index=f.calls.length-1;let next=f.one,write;
  if(change==='write')write=f.client.dispatch(f.one,{action:'indicator.set'});
  else{
   const rejected=assert.rejects(pending,{name:'AbortError'});
   if(change==='identity'){next={...f.one,firmware_version:'rc6'};f.client.retain([next,f.two]);}else f.client.cancelReads();
   await rejected;
  }
  f.reply(index,{power_watts:999});await pending.catch(()=>{});await tick();assert.equal(f.status.length,1,change);
  if(write){f.reply(f.calls.length-1,{},'accepted');await write;}
  await read(f,next,'status.get',{device_id:next.mac,name:'new'});
  assert.equal(f.status.at(-1)[1].hubPower,null,change);assert.equal(f.status.at(-1)[1].name,'new');
 }
});

test('refresh cancellation, epoch changes and unsupported capabilities stop the follow-up meter read',async()=>{
 for(const change of ['cancel','write','unsupported']){
  const f=fixture(),pending=f.client.refreshState(f.one,{background:true});
  f.reply(0,{device_id:f.one.mac});await tick();assert.equal(f.calls[1].data.action,'capabilities.get');
  let write;
  if(change==='cancel'){const rejected=assert.rejects(pending,{name:'AbortError'});f.client.cancelReads();await rejected;}
  if(change==='write')write=f.client.dispatch(f.one,{action:'indicator.set'});
  f.reply(1,capability(f.one,change==='unsupported'?['status.get']:['status.get','power.get']));await pending.catch(()=>{});await tick();
  assert(!f.calls.some(call=>call.data.action==='power.get'),change);
  if(write){f.reply(2,{},'accepted');await write;}
 }
});

test('verified capability cache expires by identity, epoch and time without replaying mutations',async()=>{
 let now=1000;const f=fixture({now:()=>now});await read(f,f.one,'capabilities.get',capability(f.one));
 const cached=await f.client.dispatch(f.one,{action:'capabilities.get',request_id:'caller-id'});assert.equal(cached.request_id,'caller-id');assert.equal(f.calls.length,1);
 cached.data.actions.push('fake.set');assert(!(await f.client.dispatch(f.one,{action:'capabilities.get'})).data.actions.includes('fake.set'));
 now=31000;await read(f,f.one,'capabilities.get',capability(f.one));assert.equal(f.calls.length,2);
 const write=f.client.dispatch(f.one,{action:'indicator.set'});f.reply(2,{},'accepted');await write;
 await read(f,f.one,'capabilities.get',capability(f.one));assert.equal(f.calls.length,4);
 const next={...f.one,firmware_version:'rc6'};f.client.retain([next]);await read(f,next,'capabilities.get',capability(next));assert.equal(f.calls.length,5);
 now=30000;await read(f,next,'capabilities.get',capability(next));assert.equal(f.calls.length,6,'a backwards clock cannot extend a cached receipt');
});

test('visible business reads precede optional settings and background work while writes keep highest priority',async()=>{
 const f=fixture(),first=f.client.dispatch(f.one,{action:'status.get'},{background:true}),optional=f.client.dispatch(f.two,{action:'alarm.get'}),background=f.client.dispatch(f.two,{action:'status.get'},{background:true}),caps=f.client.dispatch(f.two,{action:'capabilities.get'}),write=f.client.dispatch(f.one,{action:'indicator.set'});
 f.reply(0,{device_id:f.one.mac});await first;await tick();assert.equal(f.calls[1].data.action,'indicator.set');f.reply(1,{},'accepted');await write;await tick();
 assert.equal(f.calls[2].data.action,'capabilities.get');f.reply(2,capability(f.two));await caps;await tick();assert.equal(f.calls[3].data.action,'alarm.get');f.reply(3,{});await optional;await tick();assert.equal(f.calls[4].data.action,'status.get');f.reply(4,{device_id:f.two.mac});await background;
});

test('only ready inventory peers are polled and only full status receipts suppress duplicate visible reads',async()=>{
 assert.equal(hubDeviceReadable({self:true}),true);
 const ready=hubDeviceEntry({...device(),online:true,paired:true,route_confirmed:true});assert.equal(hubDeviceReadable(ready),true);assert.equal(ready.route_confirmed,true);
 for(const flags of [{online:false},{paired:false},{route_confirmed:false}])assert.equal(hubDeviceReadable({...ready,...flags}),false);
 let now=1000;const f=fixture({now:()=>now});assert.equal(f.client.hasFreshStatus(f.one),false);
 const live=f.client.dispatch(f.one,{action:'status.get',params:{view:'live'}});f.reply(0,{device_id:f.one.mac});await live;assert.equal(f.client.hasFreshStatus(f.one),false);
 await read(f,f.one,'status.get',{device_id:f.one.mac});assert.equal(f.client.hasFreshStatus(f.one),true);
 now=5000;await read(f,f.one,'power.get',{power_watts:0});assert.equal(f.client.hasFreshStatus(f.one),true);
 now=5500;assert.equal(f.client.hasFreshStatus(f.one),false,'a power read cannot renew the full status receipt');
});

test('a selected TC1 with fresh status refreshes its meter independently and does not renew the status clock',async()=>{
 let now=1000;const f=fixture({now:()=>now});
 await read(f,f.one,'capabilities.get',capability(f.one));
 await read(f,f.one,'status.get',{device_id:f.one.mac,name:'selected TC1'});
 await read(f,f.one,'power.get',{power_watts:5});
 const before=f.calls.length;assert.equal(f.client.hasFreshMeter(f.one),true);assert.equal(await f.client.refreshMeter(f.one),null);assert.equal(f.calls.length,before);
 now=16000;await read(f,f.one,'status.get',{device_id:f.one.mac,name:'selected TC1'});now=17000;
 assert.equal(f.client.hasFreshStatus(f.one),true);assert.equal(f.client.hasFreshMeter(f.one),false);
 const refresh=f.client.refreshMeter(f.one,{background:true});await tick();assert.equal(f.calls.at(-1).data.action,'power.get');
 f.reply(f.calls.length-1,{power_watts:0});await refresh;
 assert.equal(f.status.at(-1)[1].sensorAt,16000);assert.equal(f.status.at(-1)[1].hubPower.receivedAt,17000);
 assert.equal(hubPowerReading(f.status.at(-1)[1],17000),0);assert.equal(f.client.hasFreshMeter(f.one),true);
 assert.equal(f.calls.filter(call=>call.data.action==='status.get').length,2);
 now=16999;assert.equal(f.client.hasFreshMeter(f.one),false,'a backwards clock must not extend meter freshness');
});
