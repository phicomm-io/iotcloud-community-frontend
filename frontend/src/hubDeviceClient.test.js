import test from 'node:test';
import assert from 'node:assert/strict';
import {createHubDeviceClient,hubDeviceEntry} from './hubDeviceClient.js';

const device=(mac='aabbccddee01',model='tc1')=>hubDeviceEntry({mac,model,version:'v2',firmware_version:'rc5',firmware_variant:'full',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
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
