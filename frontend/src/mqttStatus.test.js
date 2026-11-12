import test from 'node:test';
import assert from 'node:assert/strict';
import {createMqttStatusCache} from './mqttStatus.js';
import {baseTopic} from './deviceProtocol.js';
import {encodeWire} from './wireCodec.js';

const device={model:'daikin',version:'v2',mac:'aabbccddee15',username:'alice',firmware_version:'rc6',variant:'full'};
const state={device_id:device.mac,model:'daikin',version:'rc6',firmware_variant:'full',hardware_model:'BRY88BBA15G',wifi_connected:true,
 sensors:{pm25:{valid:true,value:0,age_ms:125},co2:{valid:true,value:463,age_ms:125},tvoc:{valid:true,value:0,age_ms:125}},
 screen:{clock:{sync_age_ms:1000},module:{age_ms:730}}};
const empty={code:'ok',request_id:'read-1',data:{}};
const status={action:'status.get'};
test('empty G3 status receipts use a live, matching publication and preserve elapsed sample age',()=>{
 let now=1000;const cache=createMqttStatusCache(()=>now);
 cache.observe(device,baseTopic(device)+'/state',encodeWire(state,'msgpack'),{retain:false});
 now=6000;
 const reply=cache.reply(device,status,empty);
 assert.equal(reply.request_id,empty.request_id);
 assert.equal(reply.data.sensors.pm25.value,0);assert.equal(reply.data.sensors.tvoc.value,0);
 assert.equal(reply.data.sensors.co2.age_ms,5125);assert.equal(reply.data.screen.clock.sync_age_ms,6000);
 assert.equal(reply.data.screen.module.age_ms,5730);assert.equal(state.sensors.co2.age_ms,125);
 now=21000;assert.equal(cache.reply(device,status,empty),empty,'empty polls never renew the publication');
 now=22000;cache.observe(device,baseTopic(device)+'/state',encodeWire({...state,sensors:{co2:{valid:true,value:464,age_ms:0}}},'msgpack'));
 assert.equal(cache.reply(device,status,empty).data.sensors.co2.value,464);
});
test('retained replays, metadata, HA state and other identities cannot supply or renew a snapshot',()=>{
 let now=1000;const cache=createMqttStatusCache(()=>now),topic=baseTopic(device)+'/state';
 const observe=(data,packet={},path=topic)=>cache.observe(device,path,encodeWire(data,'msgpack'),packet);
 observe(state,{retain:true});assert.equal(cache.reply(device,status,empty),empty);
 for(const data of [{},{sensors:{}},{...state,device_id:'112233445566'},{...state,model:'m1'},{...state,version:'rc5'},
  {...state,firmware_variant:'hub'},{...state,hardware_model:'BRY88AX151K'},{code:'busy',data:state}]){
  observe(data);assert.equal(cache.reply(device,status,empty),empty);
 }
 observe(state,{},baseTopic({...device,username:'bob'})+'/state');
 observe(state,{},baseTopic(device)+'/ha/state');assert.equal(cache.reply(device,status,empty),empty);
 observe({code:'ok',data:state});assert.notEqual(cache.reply(device,status,empty),empty);
 assert.equal(cache.reply({...device,username:'bob'},status,empty),empty);
 assert.equal(cache.reply({...device,firmware_version:'rc7'},status,empty),empty);
 now=22000;observe(state,{retain:true});observe({name:'new name'});
 assert.equal(cache.reply(device,status,empty),empty);
});
test('offline, reconnect and firmware invalidation retire snapshots; errors and other operations retain their receipts',()=>{
 const cache=createMqttStatusCache(()=>1000),topic=baseTopic(device);
 const publish=()=>cache.observe(device,topic+'/state',encodeWire(state,'msgpack'));
 publish();
 for(const result of [{code:'busy',data:{}},{code:'ok',data:{name:'actual reply'}},{code:'ok',data:null},{code:'ok',data:[]}])assert.equal(cache.reply(device,status,result),result);
 for(const action of ['config.get','capabilities.get','config.set','system.reboot'])assert.equal(cache.reply(device,{action},empty),empty);
 cache.observe(device,topic+'/availability',Buffer.from('offline'));assert.equal(cache.reply(device,status,empty),empty);
 publish();assert.equal(cache.reply(device,status,empty),empty);
 cache.observe(device,topic+'/availability',Buffer.from('online'));
 assert.equal(cache.reply(device,status,empty),empty,'online alone is not a new business publication');
 publish();cache.invalidate(device);assert.equal(cache.reply(device,status,empty),empty);
 publish();cache.clear();assert.equal(cache.reply(device,status,empty),empty);
});
