import {test} from 'node:test';
import assert from 'node:assert/strict';
import {co2SourceCandidates} from './sensorSources.js';
import {applyMessage,baseTopic,deviceKey,statusSnapshot} from './deviceProtocol.js';
test('CO2 picker accepts fresh same-account devices and excludes self, stale data and foreign accounts',()=>{
 const self={model:'m1',version:'v2',mac:'aabbccddeeff',username:'alice'};
 const sensor={...self,mac:'123456abcdef'},foreign={...sensor,mac:'abcdef123456',username:'bob'};
 const devices=[self,sensor,foreign],states={};
 for(const d of devices)states[deviceKey(d)]={name:'Sensor',available:true,sensorAt:1000,scd40:{ready:true,valid:true,co2_ppm:1234,age_ms:100}};
 assert.deepEqual(co2SourceCandidates(devices,states,self,'alice',2000),[{device_id:sensor.mac,name:'Sensor',ppm:1234}]);
 for(const patch of [{available:false},{sensorAt:NaN},{sensorAt:3000},{scd40:{ready:true,valid:true,co2_ppm:0,age_ms:0}},{scd40:{ready:true,valid:true,co2_ppm:1000,age_ms:19000}}]){
  const changed={...states,[deviceKey(sensor)]:{...states[deviceKey(sensor)],...patch}};
  assert.deepEqual(co2SourceCandidates(devices,changed,self,'alice',2000),[]);
 }
 states[deviceKey(sensor)]={sensorAt:1000,sensors:{co2:{valid:true,unit:'ppm',value:1500,age_ms:0}}};
 assert.equal(co2SourceCandidates(devices,states,self,'alice',2000)[0].ppm,1500);
 states[deviceKey(sensor)].sensors.co2.unit='mg/m³';assert.deepEqual(co2SourceCandidates(devices,states,self,'alice',2000),[]);
});
test('a complete LAN CO2 snapshot replaces old MQTT receipts in the combined device view',()=>{
 const self={model:'m1',version:'v2',mac:'aabbccddeeff',username:'alice'};
 const source={...self,model:'daikin',mac:'123456abcdef'},key=deviceKey(source);
 const representations=[
  ppm=>({sensors:{co2:{valid:true,unit:'ppm',value:ppm,age_ms:0}}}),
  ppm=>({scd40:{ready:true,valid:true,co2_ppm:ppm,age_ms:0}})
 ];
 for(const mqttSample of representations)for(const lanSample of representations){
  const mqtt={};applyMessage(source,mqtt,baseTopic(source)+'/state',JSON.stringify(mqttSample(800)),1000);
  const lan=statusSnapshot({device_id:source.mac,sensor_valid:true,...lanSample(900)},22000);
  const combined={...mqtt,...lan,available:true,lan_connected:true};
  assert.deepEqual(co2SourceCandidates([self,source],{[key]:combined},self,'alice',22001),[{device_id:source.mac,name:'DAIKIN',ppm:900}]);
  assert.deepEqual(co2SourceCandidates([self,source],{[key]:combined},self,'alice',42000),[]);
 }
});
test('LAN snapshots cannot inherit absent CO2 samples or accept injected receipt clocks',()=>{
 const self={model:'m1',version:'v2',mac:'aabbccddeeff',username:'alice'};
 const source={...self,mac:'123456abcdef'},key=deviceKey(source),mqtt={};
 applyMessage(source,mqtt,baseTopic(source)+'/state',JSON.stringify({sensors:{co2:{valid:true,unit:'ppm',value:800,age_ms:0}},scd40:{ready:true,valid:true,co2_ppm:850,age_ms:0}}),1000);
 for(const sample of [{temperature:22},{sensors:{temperature:{value:22}}},{scd40:{ready:true}}]){
  const lan=statusSnapshot({...sample,sensorAt:22000,sensorFresh:true,co2SensorAt:22000,co2Scd40At:22000},22000);
  assert.equal(lan.co2SensorAt,null);assert.equal(lan.co2Scd40At,null);
  assert.deepEqual(co2SourceCandidates([self,source],{[key]:{...mqtt,...lan}},self,'alice',22001),[]);
 }
 const fresh=statusSnapshot({sensors:{co2:{valid:true,unit:'ppm',value:900,age_ms:0}},sensorAt:999999,sensorFresh:true,co2SensorAt:999999,co2Scd40At:999999},22000);
 assert.equal(fresh.sensorAt,22000);assert.equal(fresh.sensorFresh,false);assert.equal(fresh.co2SensorAt,22000);assert.equal(fresh.co2Scd40At,null);
 for(const invalid of [null,[],false])assert.equal(statusSnapshot(invalid,22000),null);
});
