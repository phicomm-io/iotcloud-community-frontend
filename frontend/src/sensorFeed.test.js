import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTypedSensorFeed,displaySourceCandidates,typedSensorTopic} from './sensorFeed.js';
import {deviceKey} from './deviceProtocol.js';
const self={mac:'aabbccddeeff',model:'m1',version:'v2',username:'alice'},tc1={...self,mac:'123456abcdef',model:'tc1'},a1={...self,mac:'abcdef123456',model:'a1'};
const topic=id=>typedSensorTopic('alice').replace('+',id);
const sample=(metric,value,unit,extra={})=>({schema:1,device_id:tc1.mac,model:'tc1',boot:7,sequence:1,sensors:{[metric]:{value,unit,valid:true,age_ms:100}},...extra});
const apply=(feeds,data,options={})=>applyTypedSensorFeed(feeds,topic(tc1.mac),JSON.stringify(data),{username:'alice',deviceIds:[tc1.mac,a1.mac],now:1000,...options});
test('display candidates use live same-account typed metrics, never ordinary power/status guesses',()=>{
 const feeds={},states={[deviceKey(tc1)]:{name:'Desk strip',available:true,power_watts:999}};
 assert.deepEqual(displaySourceCandidates([self,tc1],states,feeds,self,'alice',1000),[]);
 apply(feeds,sample('power',42.5,'W'));
 assert.deepEqual(displaySourceCandidates([self,tc1],states,feeds,self,'alice',2000),[{device_id:tc1.mac,model:'tc1',name:'Desk strip',metric:'power',unit:'W',value:42.5,age_ms:1100}]);
 assert.deepEqual(displaySourceCandidates([self,tc1],states,feeds,self,'alice',20900),[]);
 assert.deepEqual(displaySourceCandidates([self,{...tc1,username:'bob'}],states,feeds,self,'alice',2000),[]);
 assert.deepEqual(displaySourceCandidates([self,tc1],{[deviceKey(tc1)]:{available:false}},feeds,self,'alice',2000),[]);
 assert.equal(applyTypedSensorFeed(feeds,topic(tc1.mac).replace('u_616c696365','u_626f62'),JSON.stringify(sample('power',99,'W')),{username:'alice',deviceIds:[tc1.mac]}),false);
});
test('retained, duplicate and retired boot replay cannot renew a display lease; uint32 sequence wrap works',()=>{
 const feeds={};
 apply(feeds,sample('power',1,'W'),{retained:true});assert.deepEqual(feeds,{});
 apply(feeds,sample('power',1,'W',{sequence:0xffffffff}));
 apply(feeds,sample('power',2,'W',{sequence:1}),{now:2000});assert.equal(feeds[tc1.mac].sensors.power.value,2);
 apply(feeds,sample('power',3,'W',{sequence:1}),{now:3000});assert.equal(feeds[tc1.mac].receivedAt,2000);
 apply(feeds,sample('power',4,'W',{boot:8}),{now:4000});
 apply(feeds,sample('power',5,'W',{boot:7,sequence:2}),{now:5000});assert.equal(feeds[tc1.mac].receivedAt,4000);
});
test('typed source validation rejects missing, stale, wrong-unit and invalid readings without inventing energy',()=>{
 const feeds={};
 for(const extra of [{schema:2},{device_id:self.mac},{boot:0},{boot:'7'},{sequence:0},{sequence:1.5},{sensors:null}])apply(feeds,sample('power',42,'W',extra));
 for(const text of [JSON.stringify(sample('power',42,'W')).replace('"boot":7','"boot":7.0'),JSON.stringify(sample('power',42,'W')).replace('"sequence":1','"sequence":1e0')])applyTypedSensorFeed(feeds,topic(tc1.mac),text,{username:'alice',deviceIds:[tc1.mac]});
 assert.deepEqual(feeds,{});
 for(const field of [{value:null},{valid:false},{age_ms:20000},{age_ms:-1},{unit:'kW'}]){
  const data=sample('power',42,'W');Object.assign(data.sensors.power,field);apply(feeds,data);
  assert.deepEqual(feeds[tc1.mac].sensors,{});delete feeds[tc1.mac];
 }
 apply(feeds,sample('pressure',1013,'hPa',{model:'daikin'}));assert.deepEqual(feeds[tc1.mac].sensors,{});delete feeds[tc1.mac];
 apply(feeds,sample('power',0,'W'));assert.deepEqual(Object.keys(feeds[tc1.mac].sensors),['power']);
});
test('A1 candidates retain a bounded output percentage and explicit metric identity',()=>{
 const feeds={};
 for(const [sequence,value] of [[1,65],[2,0],[3,101]]){
  const data={schema:1,device_id:a1.mac,model:'a1',boot:9,sequence,sensors:{fan_speed_percent:{value,unit:'%',valid:true,age_ms:0}}};
  applyTypedSensorFeed(feeds,topic(a1.mac),JSON.stringify(data),{username:'alice',deviceIds:[a1.mac],now:1000});
  const candidates=displaySourceCandidates([self,a1],{},feeds,self,'alice',1000);
  assert.equal(candidates.length,value<=100?1:0);
  if(candidates.length){assert.equal(candidates[0].metric,'fan_speed_percent');assert.equal(candidates[0].value,value);assert.equal(candidates[0].unit,'%');}
 }
});
test('typed candidates enforce physical ranges, integer age and producer metrics while preserving legacy air feeds',()=>{
 const rejected=[['power',-1,'W','tc1'],['temperature',126,'°C','m1'],['temperature',-41,'°C','daikin'],['humidity',101,'%','m1'],
  ['co2',0,'ppm','m1'],['co2',65536,'ppm','daikin'],['pm25',-1,'µg/m³','m1'],['power',1,'W','other'],['power',1,'W','toString'],
  ['power',1,'W',null],['fan_speed_percent',50,'%','tc1'],['power',1,'W',undefined],['fan_speed_percent',50,'%',undefined]];
 for(const [metric,value,unit,model] of rejected){
  const feeds={};apply(feeds,sample(metric,value,unit,{model}));
  assert.deepEqual(displaySourceCandidates([self,tc1],{},feeds,self,'alice',1000),[],JSON.stringify([metric,value,model]));
 }
 for(const age_ms of [0.5,-1,20000]){const feeds={},data=sample('power',1,'W');data.sensors.power.age_ms=age_ms;apply(feeds,data);assert.deepEqual(feeds[tc1.mac].sensors,{});}
 for(const [metric,value,unit,model] of [['temperature',-40,'°C',undefined],['humidity',100,'%',undefined],['co2',65535,'ppm','daikin'],['power',0,'W','tc1']]){
  const feeds={};apply(feeds,sample(metric,value,unit,{model}));assert.equal(displaySourceCandidates([self,tc1],{},feeds,self,'alice',1000).length,1);
 }
});
test('root integer tokens ignore additive nested metadata and strings while rejecting root duplicates and floats',()=>{
 const data=sample('power',42,'W',{diagnostics:{boot:100,sequence:5,schema:2},note:'"boot": 900'}),feeds={};
 apply(feeds,data);assert.equal(feeds[tc1.mac].sensors.power.value,42);
 for(const text of [JSON.stringify(data).replace('"boot":7','"boot":7,"boot":7'),JSON.stringify(data).replace('"sequence":1,','"sequence":1.0,'),JSON.stringify(data).replace('"schema":1','"schema":1e0')]){
  const rejected={};applyTypedSensorFeed(rejected,topic(tc1.mac),text,{username:'alice',deviceIds:[tc1.mac]});assert.deepEqual(rejected,{});
 }
 const escaped=JSON.stringify(data).replace('"boot":7','"\\u0062oot":7'),decoded={};
 applyTypedSensorFeed(decoded,topic(tc1.mac),escaped,{username:'alice',deviceIds:[tc1.mac]});assert.equal(decoded[tc1.mac].sensors.power.value,42);
});
