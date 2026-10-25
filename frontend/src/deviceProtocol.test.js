import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceEntry,userKey,baseTopic,topics,command,applyMessage,normalizeMAC} from './deviceProtocol.js';
import {co2SourceCandidates} from './sensorSources.js';
test('current TMCP roots and request envelope for all models',()=>{for(const model of ['tc1','m1','a1','daikin']){const d=deviceEntry({mac:'AA:BB:CC:DD:EE:FF',model,username:'alice',version:'v2'});const base=`phicomm/v2/${userKey('alice')}/${model}/aabbccddeeff`;assert.equal(baseTopic(d),base);assert.deepEqual(topics(d),[base+'/#']);const c=command(d,{action:'status.get',request_id:'test-1'});assert.equal(c.topic,base+'/command');assert.deepEqual(JSON.parse(c.payload),{request_id:'test-1',action:'status.get',params:{}});const state={};assert(applyMessage(d,state,base+'/state',JSON.stringify({name:'demo',sensor_valid:true,temperature:22}),1000));assert.equal(state.temperature,22);assert.equal(state.sensorAt,1000);assert.equal(applyMessage(d,state,base.replace(userKey('alice'),userKey('bob'))+'/state','{}'),false);assert.equal(applyMessage(d,state,`phicomm/${model}/aabbccddeeff/state`,'{}'),false);}});
test('Legacy TC1 identities and original JSON control remain supported',()=>{const d=deviceEntry({mac:'AABBCCDDEEFF',version:'v1'});assert(topics(d).includes('device/ztc1/AA:BB:CC:DD:EE:FF/state'));const c=command(d,{plug_0:{on:1}});assert.equal(c.topic,'device/ztc1/aabbccddeeff/set');assert.equal(JSON.parse(c.payload).plug_0.on,1);const state={};assert(applyMessage(d,state,'device/ztc1/AABBCCDDEEFF/state','{"plug_0":{"on":1}}'));assert.equal(state.plug_0.on,1);assert(!applyMessage(d,state,'device/ztc1/001122334455/state','{}'));});
test('obsolete project versions and mixed MAC syntax rejected',()=>{assert.throws(()=>deviceEntry({model:'m1',mac:'aabbccddeeff',version:'community'}));assert.throws(()=>deviceEntry({model:'a1',mac:'aabbccddeeff',version:'v1'}));assert.throws(()=>normalizeMAC('AA:BB-CC:DD:EE:FF'));});
test('known firmware variants survive device list normalization without altering MQTT identity',()=>{
 for(const firmware_variant of ['full','lite','hub']){
  const d=deviceEntry({model:'daikin',mac:'AABBCCDDEEFF',username:'local',firmware_variant});
  assert.equal(deviceEntry(d).firmware_variant,firmware_variant);
  assert.equal(baseTopic(d),'phicomm/v2/u_6c6f63616c/daikin/aabbccddeeff');
 }
 assert.equal(deviceEntry({mac:'aabbccddeeff',firmware_variant:'unknown'}).firmware_variant,undefined);
});
test('result query merges only matching status receipts',()=>{const d=deviceEntry({mac:'aabbccddeeff',model:'m1'}),state={pending:{q:'status.get'}};applyMessage(d,state,baseTopic(d)+'/result',JSON.stringify({request_id:'q',code:'ok',data:{sensor_valid:false,temperature:1}}),10);assert.equal(state.temperature,1);assert.equal(state.sensorFresh,false);applyMessage(d,state,baseTopic(d)+'/state','{"__proto__":{"polluted":true},"model":"tc1"}');assert.equal({}.polluted,undefined);assert.equal(state.model,undefined);});
test('malformed status results cannot throw, overwrite measurements or renew freshness',()=>{
 const d=deviceEntry({mac:'aabbccddeeff',model:'m1'}),topic=baseTopic(d)+'/result';
 for(const payload of [undefined,null,[],42,'bad',false,{}]){
  const state={pending:{q:'status.get'},temperature:22,sensorAt:5,sensorFresh:false};
  const result={request_id:'q',code:'ok',data:payload};
  assert.doesNotThrow(()=>applyMessage(d,state,topic,JSON.stringify(result),100));
  assert.equal(state.temperature,22);assert.equal(state.sensorAt,5);assert.equal(state.sensorFresh,false);
  assert.equal(state.result.request_id,'q','result remains available for request correlation');
 }
 const state={pending:{q:'status.get'}};
 applyMessage(d,state,topic,JSON.stringify({request_id:'q',code:'ok',data:{sensor_valid:true,temperature:23}}),200);
 assert.equal(state.temperature,23);assert.equal(state.sensorAt,200);assert.equal(state.sensorFresh,true);
});
test('empty and metadata-only state receipts cannot revive an expired physical CO2 source',()=>{
 const target=deviceEntry({mac:'123456abcdef',model:'m1',username:'alice'}),source=deviceEntry({mac:'aabbccddeeff',model:'daikin',username:'alice'});
 for(const leaf of ['state','result'])for(const payload of [{},{name:'Updated name'},{sensor_valid:true},{sensors:{}},{sensorAt:21000,sensorFresh:true}]){
  const state={pending:{q:'status.get'},sensorAt:1000,sensorFresh:false,sensors:{co2:{value:800,unit:'ppm',valid:true,age_ms:0}}};
  applyMessage(source,state,baseTopic(source)+'/'+leaf,JSON.stringify(leaf==='result'?{request_id:'q',code:'ok',data:payload}:payload),21000);
  assert.equal(state.sensorAt,1000);assert.equal(state.sensorFresh,false);
  assert.deepEqual(co2SourceCandidates([source,target],{[source.mac]:state},target,'alice',21000),[]);
  const live={sensor_valid:true,sensors:{co2:{value:900,unit:'ppm',valid:true,age_ms:0}}};
  applyMessage(source,state,baseTopic(source)+'/'+leaf,JSON.stringify(leaf==='result'?{request_id:'q',code:'ok',data:live}:live),22000);
  assert.equal(state.sensorAt,22000);assert.equal(state.sensorFresh,true);
  assert.equal(co2SourceCandidates([source,target],{[source.mac]:state},target,'alice',22000)[0].ppm,900);
 }
});
test('partial readings keep independent CO2 receipt times and new complete CO2 samples remain usable',()=>{
 const target=deviceEntry({mac:'123456abcdef',model:'m1',username:'alice'}),source=deviceEntry({mac:'aabbccddeeff',model:'daikin',username:'alice'});
 for(const leaf of ['state','result'])for(const initial of [{sensors:{co2:{value:800,unit:'ppm',valid:true,age_ms:0}}},{scd40:{ready:true,valid:true,co2_ppm:800,age_ms:0}}]){
  for(const payload of [{temperature:22},{barometer:{ready:true}},{scd40:{ready:true}},{sensors:{humidity:{value:50,unit:'%',valid:true,age_ms:0}}}]){
   const state={pending:{q:'status.get'},sensorAt:1000,...structuredClone(initial)};
   const send=(data,now)=>applyMessage(source,state,baseTopic(source)+'/'+leaf,JSON.stringify(leaf==='result'?{request_id:'q',code:'ok',data}:data),now);
   send(payload,21000);assert.deepEqual(co2SourceCandidates([source,target],{[source.mac]:state},target,'alice',21000),[],JSON.stringify([leaf,initial,payload]));
   send({sensors:{co2:{value:900,unit:'ppm',valid:true,age_ms:0}}},22000);
   assert.equal(co2SourceCandidates([source,target],{[source.mac]:state},target,'alice',22000)[0].ppm,900);
   send({scd40:{ready:true,valid:true,co2_ppm:1000,age_ms:0}},23000);
   assert.equal(co2SourceCandidates([source,target],{[source.mac]:state},target,'alice',23000)[0].ppm,1000,'the newest complete representation wins');
  }
 }
});
test('Legacy HA text mode keeps original uppercase topics and controls',()=>{const d=deviceEntry({mac:'aabbccddeeff',version:'v1'}),state={};assert(applyMessage(d,state,'homeassistant/switch/AABBCCDDEEFF/socket_2/state','set socket AABBCCDDEEFF 2 1'));assert.equal(state.plug_2.on,1);assert.deepEqual(command({...d,...state},{plug_2:{on:0}}),{topic:'device/ztc1/AABBCCDDEEFF/set',payload:'set socket AABBCCDDEEFF 2 0'});assert(!applyMessage(d,state,'homeassistant/switch/001122334455/socket_2/state','set socket AABBCCDDEEFF 2 0'));});
test('migrated HA outlet names survive retained state replay and later status updates',()=>{
 const d=deviceEntry({mac:'d0bae4632b42',version:'v1'}),state={};
 const base='homeassistant/switch/D0BAE4632B42/socket_1';
 applyMessage(d,state,base+'/config',JSON.stringify({name:'服务器',device:{name:'TC1-2B42'}}));
 applyMessage(d,state,base+'/state','set socket D0BAE4632B42 1 1');
 assert.equal(state.name,'TC1-2B42');assert.equal(state.plug_1.setting.name,'服务器');assert.equal(state.plug_1.on,1);
 applyMessage(d,state,'device/ztc1/D0BAE4632B42/state','{"plug_1":{"on":0}}');
 assert.equal(state.plug_1.setting.name,'服务器');assert.equal(state.plug_1.on,0);
 applyMessage(d,state,base+'/config','{"name":"主机"}');assert.equal(state.plug_1.setting.name,'主机');assert.equal(state.plug_1.on,0);
});
test('separate legacy meter messages preserve valid numeric power and energy in any order',()=>{
 const d=deviceEntry({mac:'d0bae4632b42',version:'v1'}),state={};
 const send=(entity,data)=>applyMessage(d,state,`homeassistant/sensor/D0BAE4632B42/${entity}/state`,JSON.stringify(data));
 send('powerConsumption',{powerConsumption:'54.598'});assert.equal(state.energy_kwh,54.598);assert.equal(state.power_watts,undefined);
 send('power',{power:'71.605'});send('startupTime',{startupTime:'3 - 08:50:25'});send('powerConsumptionToday',{powerConsumptionToday:'0.999'});
 assert.equal(state.power_watts,71.605);assert.equal(state.energy_kwh,54.598);
 send('powerConsumption',{powerConsumption:'54.599'});assert.equal(state.power_watts,71.605);assert.equal(state.energy_kwh,54.599);
 for(const power of ['',null,'invalid'])send('power',{power});assert.equal(state.power_watts,71.605);
 send('power',{power:'0'});assert.equal(state.power_watts,0);
 const original={};applyMessage(d,original,'device/ztc1/d0bae4632b42/sensor','{"power":"12.5","powerConsumption":"1.25"}');
 assert.equal(original.power_watts,12.5);assert.equal(original.energy_kwh,1.25);
});
test('legacy HA indicator state uses the same key as the device home adapter',()=>{
 const d=deviceEntry({mac:'d0bae4632b42',version:'v1'}),state={};
 applyMessage(d,state,'homeassistant/switch/D0BAE4632B42/led/state','set led D0BAE4632B42 1');
 assert.equal(state.led_lock.on,1);
});
test('A1 filter state survives MQTT replay and refresh, and filter controls use TMCP',()=>{
 const d=deviceEntry({mac:'aabbccddeeff',model:'a1',username:'alice'}),state={};
 const filter={used_seconds:3600,lifetime_hours:4320,remaining_percent:100,replacement_due:false};
 applyMessage(d,state,baseTopic(d)+'/state',JSON.stringify({filter}));
 assert.deepEqual(state.filter,filter);
 applyMessage(d,state,baseTopic(d)+'/state','{"fan_on":true}');
 assert.deepEqual(state.filter,filter,'partial status does not discard filter');
 state.pending={refresh:'status.get'};
 applyMessage(d,state,baseTopic(d)+'/result',JSON.stringify({request_id:'refresh',code:'ok',data:{filter:{...filter,used_seconds:0}}}));
 assert.equal(state.filter.used_seconds,0);
 for(const [action,params] of [['filter.set',{lifetime_hours:6000}],['filter.reset',{}]]){
  const request=command(d,{action,params,request_id:'filter-test'});
  assert.equal(request.topic,baseTopic(d)+'/command');
  assert.deepEqual(JSON.parse(request.payload),{request_id:'filter-test',action,params});
 }
});
