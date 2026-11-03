import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDeviceOrder,sortDevices,moveDevice} from './deviceOrder.js';
const devices=[{mac:'a',model:'tc1',name:'插座 10'},{mac:'b',model:'a1',name:'风机'},{mac:'c',model:'tc1',name:'插座 2'}];
const keys=list=>list.map(d=>d.mac),name=d=>d.name;
test('name and type sorting keep input intact and compare numbers naturally',()=>{
 assert.deepEqual(keys(sortDevices(devices,{mode:'name'},name,'zh-CN')),['c','a','b']);
 assert.deepEqual(keys(sortDevices(devices,{mode:'type'},name,'zh-CN')),['b','c','a']);
 assert.deepEqual(keys(devices),['a','b','c']);
});
test('custom order survives removal, appends new devices and uses scoped identities',()=>{
 const preference={mode:'custom',order:['removed','c','a']};
 assert.deepEqual(keys(sortDevices(devices,preference,name,'en')),['c','a','b']);
 assert.deepEqual(moveDevice(devices,'a',-1),['a','b','c']);
 assert.deepEqual(moveDevice(devices,'b',1),['a','c','b']);
 const scoped=[{namespace:'account',username:'one',mac:'a'},{namespace:'account',username:'two',mac:'a'}];
 assert.equal(sortDevices(scoped,{mode:'custom',order:['account:two:two:a']},name,'en')[0].username,'two');
});
test('invalid storage falls back safely; account preferences stay separate',()=>{
 const values={one:JSON.stringify({mode:'custom',order:['c','c',9,'a']}),two:JSON.stringify({mode:'type'}),bad:'{'};
 const storage={getItem:key=>values[key]};
 assert.deepEqual(readDeviceOrder('one',storage),{mode:'custom',order:['c','a']});
 assert.deepEqual(readDeviceOrder('two',storage),{mode:'type',order:[]});
 for(const key of ['missing','bad'])assert.deepEqual(readDeviceOrder(key,storage),{mode:'default',order:[]});
});
