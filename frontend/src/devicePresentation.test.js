import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deviceSummary} from './devicePresentation.js';
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

test('A1 summaries retain selected mode while idle or powered off',()=>{
 assert.equal(deviceSummary({model:'a1'},{fan_on:true,fan_mode:'auto',fan_state:'idle',led_enabled:false},true),'自动 待机 · 灯光关闭');
 assert.equal(deviceSummary({model:'a1'},{fan_on:false,fan_mode:'auto',led_enabled:false},true),'自动 已停止 · 灯光关闭');
});
