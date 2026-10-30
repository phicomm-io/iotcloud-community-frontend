import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deviceSummary,pressureReading,meterReading} from './devicePresentation.js';
test('summaries prioritize useful readings and preserve unknown and offline states',()=>{
 assert.equal(deviceSummary({model:'tc1'},{power:23.5,socket_states:[true,false,true,false,false,false]},true),'23.5 W · 2 开 · 4 关');
 assert.equal(deviceSummary({model:'tc1'},{},true),'等待设备数据');
 assert.equal(deviceSummary({model:'a1'},{fan_on:true,applied_speed:70,led_enabled:false},true),'运行 70% · 灯光关闭');
 assert.equal(deviceSummary({model:'a1'},{fan_on:false,led_enabled:true},true),'已停止 · 灯光开启');
 assert.equal(deviceSummary({model:'a1'},{available:false,fan_on:true},true),'设备离线');
 assert.equal(deviceSummary({model:'m1'},{sensor_valid:true,sensorAt:100,pm25:19},true,101),'空气良好 · PM2.5 19');
 assert.equal(deviceSummary({model:'m1'},{sensor_valid:true,sensorAt:100,pm25:19},true,61000),'等待有效空气数据');
 assert.equal(deviceSummary({model:'tc1'},{power:23},false),'尚未连接');
});

test('S30 summaries show one outlet while preserving unknown, off and disconnected states',async()=>{
 const {socketStates,deviceType}=await import('./devicePresentation.js');
 const device={model:'s30-v1b'};
 assert.equal(deviceType(device),'ORVIBO S30-V1B');
 assert.deepEqual(socketStates({socket_states:[true]},1),[true]);
 assert.deepEqual(socketStates({},1),[undefined]);
 assert.equal(deviceSummary(device,{socket_states:[true],power_watts:5.25},true),'5.3 W · 1 开 · 0 关');
 assert.equal(deviceSummary(device,{socket_states:[false]},true),'0 开 · 1 关');
 assert.equal(deviceSummary(device,{},true),'等待设备数据');
 assert.equal(deviceSummary(device,{available:false,socket_states:[true]},true),'设备离线');
});

test('Legacy and TMCP numeric relay states render consistently without inventing unknown outlets',async()=>{
 const {socketStates}=await import('./devicePresentation.js');
 const {deviceEntry,applyMessage,baseTopic}=await import('./deviceProtocol.js');
 const legacy=deviceEntry({mac:'aabbccddeeff',version:'v1'}),state={};
 for(let i=0;i<6;i++)applyMessage(legacy,state,`homeassistant/switch/AABBCCDDEEFF/socket_${i}/state`,`set socket AABBCCDDEEFF ${i} ${i%2}`);
 assert.deepEqual(socketStates(state),[false,true,false,true,false,true]);
 assert.equal(deviceSummary(legacy,state,true),'3 开 · 3 关');
 const tmcp=deviceEntry({mac:'aabbccddeeff',model:'tc1',version:'v2'}),current={};
 applyMessage(tmcp,current,baseTopic(tmcp)+'/state',JSON.stringify({socket_states:[1,0,true,false,'1','0']}));
 assert.deepEqual(socketStates(current),[true,false,true,false,true,false]);
 assert.deepEqual(socketStates({socket_states:[1,null,'',2]}),[true,undefined,undefined,undefined,undefined,undefined]);
 assert.deepEqual(socketStates({plug_0:{on:0}}),[false,undefined,undefined,undefined,undefined,undefined]);
});

test('S30 metering keeps independent valid fields and never renders missing current as zero',()=>{
 const metering={valid:false,valid_fields:5,voltage:230.1,current:null,active_power:0};
 const state={metering,socket_states:[false],power_watts:0};
 assert.equal(meterReading(state,'voltage'),230.1);
 assert.equal(meterReading(state,'current'),null);
 assert.equal(meterReading(state,'active_power'),0);
 assert.equal(deviceSummary({model:'s30-v1b'},state,true),'0.0 W · 230.1 V · 0 开 · 1 关');
 assert.equal(meterReading({metering:{...metering,current:0,valid_fields:7}},'current'),0);
 for(const value of [null,undefined,'0','',NaN,Infinity,-1])
  assert.equal(meterReading({metering:{valid_fields:7,current:value}},'current'),null);
 assert.equal(meterReading({metering:{valid_fields:5,current:1}},'current'),null);
 assert.equal(meterReading({},'voltage'),null);
});

test('A1 summaries retain selected mode while idle or powered off',()=>{
 assert.equal(deviceSummary({model:'a1'},{fan_on:true,fan_mode:'auto',fan_state:'idle',led_enabled:false},true),'自动 待机 · 灯光关闭');
 assert.equal(deviceSummary({model:'a1'},{fan_on:false,fan_mode:'auto',led_enabled:false},true),'自动 已停止 · 灯光关闭');
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
