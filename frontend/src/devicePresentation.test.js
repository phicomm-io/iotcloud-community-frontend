import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pressureReading,meterReading} from './devicePresentation.js';

test('S30 labels and one-outlet states preserve unknown values',async()=>{
 const {socketStates,deviceType}=await import('./devicePresentation.js');
 const device={model:'s30-v1b'};
 assert.equal(deviceType(device),'ORVIBO S30-V1B');
 assert.deepEqual(socketStates({socket_states:[true]},1),[true]);
 assert.deepEqual(socketStates({},1),[undefined]);
});

test('Legacy and TMCP numeric relay states render consistently without inventing unknown outlets',async()=>{
 const {socketStates}=await import('./devicePresentation.js');
 const {deviceEntry,applyMessage,baseTopic}=await import('./deviceProtocol.js');
 const legacy=deviceEntry({mac:'aabbccddeeff',version:'v1'}),state={};
 for(let i=0;i<6;i++)applyMessage(legacy,state,`homeassistant/switch/AABBCCDDEEFF/socket_${i}/state`,`set socket AABBCCDDEEFF ${i} ${i%2}`);
 assert.deepEqual(socketStates(state),[false,true,false,true,false,true]);
 const tmcp=deviceEntry({mac:'aabbccddeeff',model:'tc1',version:'v2'}),current={};
 applyMessage(tmcp,current,baseTopic(tmcp)+'/state',JSON.stringify({socket_states:[1,0,true,false,'1','0']}));
 assert.deepEqual(socketStates(current),[true,false,true,false,true,false]);
 assert.deepEqual(socketStates({socket_states:[1,null,'',2]}),[true,undefined,undefined,undefined,undefined,undefined]);
 assert.deepEqual(socketStates({plug_0:{on:0}}),[false,undefined,undefined,undefined,undefined,undefined]);
});

test('S30 metering keeps independent valid fields and never renders missing current as zero',()=>{
 const metering={valid:false,valid_fields:5,voltage:230.1,current:null,active_power:0};
 const state={metering};
 assert.equal(meterReading(state,'voltage'),230.1);
 assert.equal(meterReading(state,'current'),null);
 assert.equal(meterReading(state,'active_power'),0);
 assert.equal(meterReading({metering:{...metering,current:0,valid_fields:7}},'current'),0);
 for(const value of [null,undefined,'0','',NaN,Infinity,-1])
  assert.equal(meterReading({metering:{valid_fields:7,current:value}},'current'),null);
 assert.equal(meterReading({metering:{valid_fields:5,current:1}},'current'),null);
 assert.equal(meterReading({},'voltage'),null);
});

test('pressure uses independent freshness and rejects stale, absent and malformed readings',()=>{
 const barometer={model:'BMP388',ready:true,valid:true,age_ms:100,pressure_hpa:1013.24};
 const state={sensorAt:1000,barometer,sensor_valid:false};
 assert.equal(pressureReading(state,1001),1013.24);
 assert.equal(pressureReading({...state,barometer:{...barometer,model:'BMP390'}},1001),1013.24);
 assert.equal(pressureReading(state,10899),1013.24);
 assert.equal(pressureReading(state,10900),null);
 assert.equal(pressureReading(state,999),null);
 assert.equal(pressureReading({barometer},1001),null);
 assert.equal(pressureReading({},1001),null);
 for(const patch of [{valid:false},{ready:false},{model:'unknown'},{age_ms:null},{age_ms:-1},
  {age_ms:10000},{pressure_hpa:null},{pressure_hpa:NaN},{pressure_hpa:Infinity},
  {pressure_hpa:'1013.24'},{pressure_hpa:0},{pressure_hpa:1250.1}])
  assert.equal(pressureReading({...state,barometer:{...barometer,...patch}},1001),null);
});
