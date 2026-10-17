import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveDeviceName} from './deviceName.js';
function fixture(name='客厅',model='a1'){
 const requests=[],results=[],timers=new Map();let id=0;
 saveDeviceName((request,reply,device,options)=>requests.push({request,reply,device,options}),{model,mac:'b0f893303134'},name,r=>results.push(r),{schedule:fn=>{timers.set(++id,fn);return id;},cancel:id=>timers.delete(id)});
 return {requests,results,tick(){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();},timers};
}
test('rename succeeds only after a fresh matching read when the write receipt is lost',()=>{
 const f=fixture();f.tick();assert.equal(f.requests[1].request.action,'config.get');
 f.requests[1].reply({code:'ok',data:{name:'旧名称'}});assert.equal(f.results.length,0);
 f.tick();f.requests[2].reply({code:'ok',data:{name:'客厅'}});
 assert.equal(f.results[0].code,'ok');f.requests[0].reply({code:'timeout'});assert.equal(f.results.length,1);
 assert.equal(f.requests.filter(r=>r.request.action==='config.set').length,1);assert.equal(f.timers.size,0);
});
test('rename rejection or unconfirmed timeout remains an error; late reads cannot turn it into success',()=>{
 for(const code of ['invalid_params','offline','timeout']){
  const f=fixture();f.tick();f.requests[0].reply({code});f.requests[1].reply({code:'ok',data:{name:'客厅'}});
  assert.deepEqual(f.results,[{code}]);assert.equal(f.timers.size,0);
 }
});
test('normal acknowledgements cancel verification, and A1/M1 default names can be verified',()=>{
 const f=fixture();f.requests[0].reply({code:'accepted'});assert.equal(f.timers.size,0);assert.equal(f.results.length,1);
 for(const model of ['a1','m1']){const f=fixture('',model);f.tick();f.requests[1].reply({code:'ok',data:{name:model.toUpperCase()+'-3134'}});assert.equal(f.results[0].code,'ok');}
});

test('lost verification reads retry without resending the write',()=>{
 const f=fixture();f.tick();assert.equal(f.requests[1].options.timeoutMs,3000);
 f.requests[1].reply({code:'timeout'});assert.equal(f.results.length,0);
 f.tick();f.requests[2].reply({code:'ok',data:{name:'客厅'}});
 assert.equal(f.results[0].code,'ok');assert.equal(f.requests.filter(r=>r.request.action==='config.set').length,1);
});
