import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceTransport,localAddress,savePreference,loadPreference} from './deviceConnection.js';
const device={mac:'aabbccddeeff',model:'a1',version:'v2'};
const response=data=>({ok:true,status:200,json:async()=>data});
const info={code:'ok',data:{device_id:device.mac,model:'a1',api_version:1}};
const status={code:'ok',data:{device_id:device.mac,fan_on:true}};
function fixture(fetcher){const records={},seen=[];const t=createDeviceTransport({fetcher,records,onStatus:(...s)=>seen.push(s)});t.configure('d',device,{mode:'auto',address:'http://192.168.1.10'},'web-pass');return {t,records,seen};}
test('private addresses and preferences are validated and isolated without credentials',()=>{
 for(const value of ['https://192.168.1.1','192.168.1.1/path','127.0.0.1','8.8.8.8','192.168.1.1:0','http://user:pass@192.168.1.1'])assert.throws(()=>localAddress(value));
 assert.equal(localAddress('192.168.1.1:8080'),'http://192.168.1.1:8080');
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 savePreference('node/account','d',{mode:'mqtt',address:'192.168.1.10',password:'secret'},storage);
 assert.equal(loadPreference('node/account','d',storage).mode,'mqtt');assert.equal(loadPreference('node/other','d',storage).address,'');assert.ok(![...values.values()].join('').includes('secret'));
});
test('auth, identity and initial status are required; LAN works without MQTT',async()=>{
 const calls=[];const {t,records}=fixture(async(url,opts)=>{calls.push([url,opts]);return response(url.endsWith('/info')?info:status);});
 assert.equal(await t.probe('d'),true);assert.equal(records.d.ready,true);assert.match(calls[0][1].headers.Authorization,/^Basic /);assert.equal(calls[0][1].credentials,'omit');
 let mqtt=0;const result=await t.dispatch('d',{action:'status.get'},()=>{mqtt++;});assert.equal(result.code,'ok');assert.equal(mqtt,0);t.stop();
 for(const fetcher of [async()=>({status:401,ok:false}),async()=>response({...info,data:{...info.data,device_id:'000000000000'}}),async url=>response(url.endsWith('/info')?info:{code:'error'})]){const f=fixture(fetcher);assert.equal(await f.t.probe('d'),false);assert.equal(f.records.d.ready,false);f.t.stop();}
});
test('force MQTT makes no LAN requests; writes are never replayed after loss',async()=>{
 let fail=false;const calls=[];const {t,records}=fixture(async url=>{calls.push(url);if(fail)throw Error('lost');return response(url.endsWith('/info')?info:status);});
 await t.probe('d');fail=true;let mqtt=0;
 assert.equal((await t.dispatch('d',{action:'fan.set',request_id:'same-id'},()=>{mqtt++;})).code,'uncertain');assert.equal(mqtt,0);
 assert.equal((await t.dispatch('d',{action:'status.get'},()=>{mqtt++;return {code:'ok'};})).code,'ok');assert.equal(mqtt,1);t.stop();
});
test('read failure falls back; force MQTT disables probes and upload',async()=>{
 let fail=false,mqtt=0;const {t}=fixture(async url=>{if(fail)throw Error('blocked');return response(url.endsWith('/info')?info:status);});await t.probe('d');fail=true;
 assert.equal((await t.dispatch('d',{action:'status.get'},()=>{mqtt++;return {code:'ok'};})).code,'ok');assert.equal(mqtt,1);
 t.configure('d',device,{mode:'mqtt',address:'http://192.168.1.10'});assert.equal(await t.probe('d'),false);assert.equal((await t.upload('d',new Blob(),false).promise).status,0);t.stop();
});
test('only two probes run concurrently and stale identity replies cannot enable old addresses',async()=>{
 let active=0,max=0;const gates=[];const records={};const t=createDeviceTransport({records,fetcher:async url=>{active++;max=Math.max(max,active);await new Promise(r=>gates.push(r));active--;return response(url.endsWith('/info')?info:status);}});
 for(let i=0;i<3;i++)t.configure('d'+i,device,{mode:'auto',address:'http://192.168.1.'+(10+i)});
 const jobs=[0,1,2].map(i=>t.probe('d'+i));await new Promise(setImmediate);assert.equal(gates.length,2);
 t.configure('d0',device,{mode:'mqtt',address:''});
 while(gates.length||active){gates.splice(0).forEach(r=>r());await new Promise(setImmediate);}
 await Promise.all(jobs);assert.equal(max,2);assert.equal(records.d0.ready,false);t.stop();
});
