import test from 'node:test';
import assert from 'node:assert/strict';
import {deviceEntry,command,commandFormat,applyMessage,baseTopic,discoveryMessage} from './deviceProtocol.js';
import {encodeWire,decodeWire} from './wireCodec.js';
const mac='aabbccddeeff',announcement={schema:2,device_id:mac,model:'a1',version:'v2',protocol:'tmcp',protocol_version:2,firmware_version:'rc4',variant:'full',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack'};
test('validated discovery preserves identity-bound MP selection through account normalization',()=>{
 const d=deviceEntry({mac,...discoveryMessage(encodeWire(announcement),mac)});assert.equal(commandFormat(d),'msgpack');assert.equal(d.firmware_version,'rc4');assert.equal(d.variant,'full');const wire=command(d,{action:'fan.set',params:{speed:42},request_id:'fixed'});assert.deepEqual(decodeWire(wire.payload),{action:'fan.set',params:{speed:42},request_id:'fixed'});
 for(const bad of [{...announcement,device_id:'001122334455'},{...announcement,wire_version:2},{...announcement,default_wire_format:'json'},{...announcement,firmware_version:''}])assert.equal(discoveryMessage(encodeWire(bad),mac),null);
 assert.equal(discoveryMessage(JSON.stringify(announcement),mac),null,'new contract cannot be silently encoded in JSON');
});
test('unknown scoped discovery cannot send a mutation; legacy JSON remains explicit',()=>{
 const unknown=deviceEntry({mac,model:'a1',version:'v2',namespace:'account',username:'alice',wire_format:''});assert.throws(()=>command(unknown,{action:'fan.set',params:{speed:42}}),{code:'discovery_required'});
 const old=discoveryMessage(JSON.stringify({schema:1,protocol:'tmcp',protocol_version:2,version:'v2',model:'a1'}),mac);assert.equal(old.wire_format,'json');assert.equal(typeof command(deviceEntry({mac,...old}),{action:'status.get'}).payload,'string');
 const state={};applyMessage({mac,model:'a1',version:'v2'},state,baseTopic({mac,model:'a1'})+'/capabilities',JSON.stringify({wire_formats:['msgpack']}));assert.equal(commandFormat({mac,model:'a1',version:'v2',...state}),'json','unbound capability response cannot switch format');
});
test('MP MQTT complete state, capabilities and receipts decode directly from bytes',()=>{
 const d=deviceEntry({mac,...discoveryMessage(encodeWire(announcement),mac)}),state={pending:{id:'status.get'}};
 for(const [leaf,value] of [['state',{device_id:mac,percentage:0}],['capabilities',{actions:['fan.set'],device_id:mac,model:'a1',firmware_version:'rc4',variant:'full'}],['result',{request_id:'id',code:'ok',data:{device_id:mac,percentage:42}}]])assert(applyMessage(d,state,baseTopic(d)+'/'+leaf,encodeWire(value)));
 assert.equal(state.percentage,42);assert.equal(state.capabilities.firmware_version,'rc4');
 applyMessage(d,state,baseTopic(d)+'/state',JSON.stringify({percentage:99}));assert.equal(state.percentage,42,'mismatched format cannot override selected binary data');
});
test('retained and reply capabilities are rejected when their firmware binding differs',()=>{
 const d=deviceEntry({mac,...discoveryMessage(encodeWire(announcement),mac)}),state={capabilities:{actions:['old']},pending:{read:'capabilities.get'}};
 applyMessage(d,state,baseTopic(d)+'/capabilities',encodeWire({device_id:mac,model:'a1',firmware_version:'old',variant:'full',actions:['old']}));assert.equal(state.capabilities,undefined);
 applyMessage(d,state,baseTopic(d)+'/result',encodeWire({request_id:'read',code:'ok',data:{device_id:mac,model:'a1',firmware_version:'old',variant:'full',actions:['old']}}));assert.equal(state.result.code,'identity_mismatch');
});

test('S30 discovery binds binary commands to identity and never creates a JSON fallback',()=>{
 const value={...announcement,model:'s30-v1b',protocol:'openiot',command_protocol:'tmcp',wire_formats:['msgpack','cbor']};
 const discovered=discoveryMessage(encodeWire(value),mac);assert(discovered);
 const device=deviceEntry({mac,...discovered});assert.equal(commandFormat(device),'msgpack');
 const request=command(device,{action:'outlet.set',params:{index:0,on:false},request_id:'s30-outlet'});
 assert.equal(request.topic,`phicomm/v2/local/s30-v1b/${mac}/command`);
 assert.deepEqual(decodeWire(request.payload),{action:'outlet.set',params:{index:0,on:false},request_id:'s30-outlet'});
 for(const patch of [{device_id:'001122334455'},{firmware_version:''},{variant:''},{wire_version:2},{command_protocol:'unknown'},{schema:1}])assert.equal(discoveryMessage(encodeWire({...value,...patch}),mac),null);
 assert.equal(discoveryMessage(JSON.stringify(value),mac),null);
 assert.equal(discoveryMessage(JSON.stringify({...value,schema:1,protocol:'tmcp'}),mac),null);
 const manual=deviceEntry({mac,model:'s30-v1b'});assert.equal(manual.wire_format,'');
 assert.throws(()=>command(manual,{action:'outlet.set',params:{on:true}}),{code:'discovery_required'});
 assert.throws(()=>commandFormat({mac,model:'s30-v1b'}),{code:'discovery_required'});
 assert.throws(()=>deviceEntry({mac,model:'s30-v1b',wire_format:'json'}));
 assert.throws(()=>deviceEntry({mac,model:'s30-v1b',version:'v1'}));
});
