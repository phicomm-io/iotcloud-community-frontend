import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTypedSensorFeed,displaySourceCandidates,typedSensorTopic} from './sensorFeed.js';
import {deviceKey} from './deviceProtocol.js';
const self={mac:'aabbccddeeff',model:'m1',version:'v2',username:'alice'},tc1={...self,mac:'123456abcdef',model:'tc1'},a1={...self,mac:'abcdef123456',model:'a1'};
const topic=id=>typedSensorTopic('alice').replace('+',id);
const reading=(value,unit='W',extra={})=>({name:'Published reading',type:'number',value,unit,valid:true,age_ms:100,...extra});
const sample=(field_id,value,unit,extra={})=>({schema:2,device_id:tc1.mac,boot:7,sequence:1,sensors:{[field_id]:reading(value,unit)},...extra});
const apply=(feeds,data,options={})=>applyTypedSensorFeed(feeds,topic(tc1.mac),JSON.stringify(data),{username:'alice',deviceIds:[tc1.mac,a1.mac],now:1000,...options});
const candidates=(feeds,now=1000)=>displaySourceCandidates([self,tc1],{},feeds,self,'alice',now);

test('numeric descriptors are discovered without a model or metric registry',()=>{
 const feeds={},states={[deviceKey(tc1)]:{name:'Desk strip',available:true,power_watts:999}};
 assert.deepEqual(displaySourceCandidates([self,tc1],states,feeds,self,'alice',1000),[]);
 apply(feeds,sample('custom_load',42.5,'kVA',{model:'future_device'}));
 assert.deepEqual(displaySourceCandidates([self,tc1],states,feeds,self,'alice',2000),[{device_id:tc1.mac,device_name:'Desk strip',field_id:'custom_load',name:'Published reading',type:'number',unit:'kVA',value:42.5,age_ms:1100}]);
 assert.deepEqual(candidates(feeds,20900),[]);
 assert.deepEqual(displaySourceCandidates([self,{...tc1,username:'bob'}],states,feeds,self,'alice',2000),[]);
 assert.deepEqual(displaySourceCandidates([self,tc1],{[deviceKey(tc1)]:{available:false}},feeds,self,'alice',2000),[]);
 assert.equal(applyTypedSensorFeed(feeds,topic(tc1.mac).replace('u_616c696365','u_626f62'),JSON.stringify(sample('custom_load',99,'kVA')),{username:'alice',deviceIds:[tc1.mac]}),false);
 assert.deepEqual(displaySourceCandidates([self],states,{[self.mac]:feeds[tc1.mac]},self,'alice',1000),[]);
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
test('unknown field types and invalid samples never become zero or erase valid siblings',()=>{
 const feeds={},data=sample('power',0,'W');
 Object.assign(data.sensors,{
  future_text:reading({nested:true},'',{type:'text'}),false_number:reading(false),null_number:reading(null),string_number:reading('0'),
  unavailable:reading(null,'W',{valid:false}),missing_valid:{name:'Missing',type:'number',value:0,unit:'W',age_ms:0}
 });
 apply(feeds,data);assert.deepEqual(Object.keys(feeds[tc1.mac].sensors),['power']);assert.equal(candidates(feeds)[0].value,0);
 data.sequence=2;data.sensors={power:reading(null,'W',{valid:false}),future_text:reading('0','',{type:'text'})};apply(feeds,data,{now:2000});
 assert.deepEqual(feeds[tc1.mac].sensors,{});assert.deepEqual(candidates(feeds,2000),[],'a fresh invalid snapshot withdraws the old sample');
});
test('complete snapshots withdraw removed fields and empty snapshots retain replay protection',()=>{
 const feeds={};apply(feeds,sample('power',42,'W'));
 apply(feeds,sample('custom_load',3,'kVA',{sequence:2}),{now:2000});assert.deepEqual(Object.keys(feeds[tc1.mac].sensors),['custom_load']);
 apply(feeds,sample('power',0,'W',{sequence:3,sensors:{}}),{now:3000});assert.deepEqual(candidates(feeds,3000),[]);assert.equal(feeds[tc1.mac].sequence,3);
 apply(feeds,sample('power',99,'W',{sequence:2}),{now:4000});assert.deepEqual(candidates(feeds,4000),[]);assert.equal(feeds[tc1.mac].receivedAt,3000);
 apply(feeds,sample('power',0,'W',{sequence:4}),{now:5000});assert.equal(candidates(feeds,5000)[0].value,0);
 const withoutModel={...tc1};delete withoutModel.model;
 assert.equal(displaySourceCandidates([self,withoutModel],{},feeds,self,'alice',5000)[0].device_name,tc1.mac);
});
test('field identity, names and units use bounded UTF-8 descriptors',()=>{
 for(const field_id of ['a','constructor','a'.repeat(32),'new_field_2']){
  const feeds={};apply(feeds,sample(field_id,1,'界'.repeat(8)));assert.equal(candidates(feeds).length,1,field_id);
 }
 for(const field_id of ['','a'.repeat(33),'Uppercase','9field','_field','with.dot','with/slash','with-dash','__proto__']){
  const feeds={};apply(feeds,sample(field_id,1,'W'));assert.deepEqual(candidates(feeds),[],field_id);
 }
 for(const patch of [{name:''},{name:'a'.repeat(65)},{name:'界'.repeat(22)},{name:'a\n'},{name:'\ud800'},{unit:'界'.repeat(9)},{unit:'x\u007f'},{unit:'\udfff'},{unit:null}]){
  const feeds={},data=sample('power',1,'W');Object.assign(data.sensors.power,patch);apply(feeds,data);assert.deepEqual(candidates(feeds),[],JSON.stringify(patch));
 }
 const feeds={},data=sample('power',1,'');data.sensors.power.name='界'.repeat(21)+'a';apply(feeds,data);assert.equal(candidates(feeds)[0].unit,'');
});
test('generic numeric fields preserve producer values and do not apply model-specific ranges',()=>{
 for(const [field_id,value,unit] of [['fan_speed_percent',101,'%'],['power',-1,'W'],['temperature',126,'°C'],['co2',0,'ppm'],['new_ratio',9999999,'ratio']]){
  const feeds={};apply(feeds,sample(field_id,value,unit));assert.equal(candidates(feeds)[0].value,value);
 }
 for(const patch of [{value:1e39},{value:null},{value:''},{value:false},{valid:false},{age_ms:20000},{age_ms:-1},{age_ms:.5}]){
  const feeds={},data=sample('power',42,'W');Object.assign(data.sensors.power,patch);apply(feeds,data);assert.deepEqual(candidates(feeds),[],JSON.stringify(patch));
 }
});
test('envelope checks reject old schema, wrong identity, invalid clocks and excessive field counts',()=>{
 for(const extra of [{schema:1},{device_id:self.mac},{boot:0},{boot:'7'},{sequence:0},{sequence:1.5},{sensors:null},
  {sensors:Object.fromEntries(Array.from({length:17},(_,i)=>['field_'+i,reading(i)]))}]){
  const feeds={};apply(feeds,sample('power',42,'W',extra));assert.deepEqual(feeds,{});
 }
 const feeds={};apply(feeds,sample('power',1,'W'),{deviceIds:[]});assert.deepEqual(feeds,{});
 const sixteen={};apply(sixteen,sample('power',1,'W',{sensors:Object.fromEntries(Array.from({length:16},(_,i)=>['field_'+i,reading(i)]))}));assert.equal(candidates(sixteen).length,16);
});
test('root integer tokens ignore additive metadata while rejecting duplicates and floats',()=>{
 const data=sample('power',42,'W',{diagnostics:{boot:100,sequence:5,schema:1},note:'"boot": 900'}),feeds={};
 apply(feeds,data);assert.equal(feeds[tc1.mac].sensors.power.value,42);
 for(const text of [JSON.stringify(data).replace('"boot":7','"boot":7,"boot":7'),JSON.stringify(data).replace('"sequence":1,','"sequence":1.0,'),JSON.stringify(data).replace('"schema":2','"schema":2e0')]){
  const rejected={};applyTypedSensorFeed(rejected,topic(tc1.mac),text,{username:'alice',deviceIds:[tc1.mac]});assert.deepEqual(rejected,{});
 }
 const escaped=JSON.stringify(data).replace('"boot":7','"\\u0062oot":7'),decoded={};
 applyTypedSensorFeed(decoded,topic(tc1.mac),escaped,{username:'alice',deviceIds:[tc1.mac]});assert.equal(decoded[tc1.mac].sensors.power.value,42);
});
test('sample ages use integer tokens for every generic field, including prototype names',()=>{
 for(const field_id of ['new_field','constructor']){
  const data=sample(field_id,42,'W',{diagnostics:{age_ms:0.5}});data.sensors[field_id].diagnostics={age_ms:0.5};
  for(const token of ['0','100','0.0','0e0','1.0','1e2']){
   const feeds={},text=JSON.stringify(data).replace('"age_ms":100','"age_ms":'+token);
   applyTypedSensorFeed(feeds,topic(tc1.mac),text,{username:'alice',deviceIds:[tc1.mac],now:1000});assert.equal(candidates(feeds).length,/^[0-9]+$/.test(token)?1:0,field_id+' '+token);
  }
  const duplicate={},text=JSON.stringify(data).replace('"age_ms":100','"age_ms":100,"age_ms":100');
  applyTypedSensorFeed(duplicate,topic(tc1.mac),text,{username:'alice',deviceIds:[tc1.mac],now:1000});assert.deepEqual(duplicate[tc1.mac].sensors,{});
 }
});
