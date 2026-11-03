import test from 'node:test';
import assert from 'node:assert/strict';
import {createHubLanClient} from './hubLan.js';

test('LAN discovery is read-only and pairing actions use owner-authenticated hub routes',async()=>{
 const calls=[];const request=async(path,options)=>{calls.push([path,options]);return {code:'accepted'};};
 const lan=createHubLanClient(request);
 await lan.discover();
 await lan.register({device_id:'aabbccddeeff',model:'a1'});
 await lan.pair({peer:'aabbccddeeff',ip:'192.0.2.3',password:'secret',scopes:1});
 await lan.pairStatus('aabbccddeeff');
 await lan.unpair('aabbccddeeff');
 await lan.unregister('aabbccddeeff');
 assert.deepEqual(calls.map(([path])=>path),[
  '/hub/lan','/devices','/hub/lan/pair','/hub/lan/pair/aabbccddeeff','/hub/lan/unpair','/devices/aabbccddeeff',
 ]);
 assert.equal(calls[0][1].method,undefined);
 assert.deepEqual(JSON.parse(calls[1][1].body),{mac:'aabbccddeeff',model:'a1',version:'v2'});
 assert.deepEqual(JSON.parse(calls[2][1].body),{peer:'aabbccddeeff',ip:'192.0.2.3',password:'secret',scopes:1});
 assert.deepEqual(JSON.parse(calls[4][1].body),{peer:'aabbccddeeff'});
 assert.equal(calls[5][1].method,'DELETE');
});

test('peer identifiers are URL encoded in status and registration removal paths',async()=>{
 const paths=[];const lan=createHubLanClient(async path=>{paths.push(path);return {};});
 await lan.pairStatus('peer/with space');await lan.unregister('peer/with space');
 assert.deepEqual(paths,['/hub/lan/pair/peer%2Fwith%20space','/devices/peer%2Fwith%20space']);
});
