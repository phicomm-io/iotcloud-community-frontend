import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTypedSensorFeed,displaySourceCandidates} from './sensorFeed.js';
import {encodeWire} from './wireCodec.js';
const id='001122334455',target={mac:'aabbccddeeff',model:'m1',version:'v2',username:'alice'},source={mac:id,model:'a1',version:'v2',username:'alice'};
const descriptor={schema:3,device_id:id,boot:7,descriptor_revision:1,fields:{custom_load:{name:'Load',type:'number',unit:'kVA'},constructor:{name:'Generic',type:'number',unit:''}}};
const state={schema:3,device_id:id,boot:7,descriptor_revision:1,sequence:1,sensors:{custom_load:{value:42.5,valid:true,age_ms:100},constructor:{value:0,valid:true,age_ms:0}}};
const apply=(feeds,leaf,data,extra={})=>applyTypedSensorFeed(feeds,`phicomm/v2/u_616c696365/sensor/${id}/${leaf}`,encodeWire(data),{username:'alice',deviceIds:[id],now:1000,...extra});
const candidates=(feeds,now=1000)=>displaySourceCandidates([target,source],{},feeds,target,'alice',now);
test('retained descriptors plus nonretained complete values support arbitrary numeric source fields',()=>{
 const feeds={};apply(feeds,'metadata',descriptor,{retained:true});assert.deepEqual(candidates(feeds),[]);apply(feeds,'state',state);assert.deepEqual(candidates(feeds).map(x=>[x.field_id,x.value,x.unit]),[['custom_load',42.5,'kVA'],['constructor',0,'']]);
 apply(feeds,'state',{...state,sequence:2,sensors:{constructor:{value:null,valid:false,age_ms:0}}},{now:2000});assert.deepEqual(candidates(feeds,2000),[],'complete snapshot withdraws missing and invalid fields');
});
test('unknown or mismatched descriptors revoke old values; metadata never renews their TTL',()=>{
 const feeds={};apply(feeds,'state',state);assert.deepEqual(candidates(feeds),[]);apply(feeds,'metadata',descriptor,{now:1500});assert.deepEqual(candidates(feeds,1500),[]);apply(feeds,'state',{...state,sequence:2},{now:2000});assert.equal(candidates(feeds,2000).length,2);apply(feeds,'metadata',descriptor,{retained:true,now:20000});assert.deepEqual(candidates(feeds,22000),[]);
 apply(feeds,'state',{...state,sequence:3,descriptor_revision:2},{now:3000});assert.deepEqual(candidates(feeds,3000),[]);apply(feeds,'metadata',{...descriptor,descriptor_revision:2},{now:3000});apply(feeds,'state',{...state,sequence:4,descriptor_revision:2},{now:4000});assert.equal(candidates(feeds,4000).length,2);
 apply(feeds,'metadata',{...descriptor,boot:8},{now:5000});assert.deepEqual(candidates(feeds,5000),[]);apply(feeds,'state',{...state,boot:8},{now:5000});assert.equal(candidates(feeds,5000).length,2);apply(feeds,'state',{...state,sequence:99},{now:6000});assert.equal(feeds[id].boot,8,'retired boot replay cannot replace new boot');
});
test('owner, device, retained states, duplicate sequences and bounded descriptors are validated',()=>{
 const feeds={};apply(feeds,'metadata',descriptor);apply(feeds,'state',state,{retained:true});assert.deepEqual(candidates(feeds),[]);apply(feeds,'state',state);apply(feeds,'state',{...state,sensors:{}},{now:2000});assert.equal(feeds[id].receivedAt,1000);assert.equal(candidates(feeds).length,2);
 apply(feeds,'metadata',{...descriptor,descriptor_revision:2,fields:{x:{name:'界'.repeat(22),type:'number',unit:'W'}}});assert.equal(feeds[id].metadata.revision,1);
 assert.deepEqual(displaySourceCandidates([target,{...source,username:'bob'}],{},feeds,target,'alice'),[]);apply(feeds,'state',{...state,device_id:target.mac,sequence:2,sensors:{}},{now:2000});assert.equal(candidates(feeds).length,2);
});
