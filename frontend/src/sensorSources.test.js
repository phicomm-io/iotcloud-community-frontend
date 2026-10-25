import {test} from 'node:test';
import assert from 'node:assert/strict';
import {co2SourceCandidates} from './sensorSources.js';
import {deviceKey} from './deviceProtocol.js';
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
