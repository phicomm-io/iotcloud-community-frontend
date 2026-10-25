import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import fs from 'node:fs';
import vm from 'node:vm';
function bridge(){
 const dom=new JSDOM('',{runScripts:'outside-only',url:'https://platform.test'}),w=dom.window,sent=[];
 w.Response=Response;w.postMessage=message=>sent.push(message);
 vm.runInContext(fs.readFileSync(new URL('./deviceBridge.js',import.meta.url),'utf8'),dom.getInternalVMContext());
 const request=(action,signal)=>w.fetch('/api/v1/command',{body:JSON.stringify({action,params:{}}),signal});
 const reply=(message)=>w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:'https://platform.test',data:{type:'device-result',id:message.id,reply:{code:'ok',data:{}}}}));
 return {dom,w,sent,request,reply};
}
test('device reads are serialized with status priority; writes are never deferred',async()=>{
 const f=bridge();try{
  const binding=f.request('binding.status.get'),light=f.request('light_effect.get'),status=f.request('status.get');
  assert.deepEqual(f.sent.map(x=>x.request.action),['binding.status.get']);
  const write=f.request('fan.set');assert.equal(f.sent[1].request.action,'fan.set');f.reply(f.sent[1]);await write;
  assert.equal(f.sent.length,2);
  f.reply(f.sent[0]);await binding;assert.equal(f.sent[2].request.action,'status.get');
  f.reply(f.sent[2]);await status;assert.equal(f.sent[3].request.action,'light_effect.get');
  f.reply(f.sent[3]);await light;
 }finally{f.dom.window.close();}
});
test('aborted queued reads are never sent and cancelled active reads unblock the queue',async()=>{
 const f=bridge();try{
  const active=new f.w.AbortController(),queued=new f.w.AbortController();
  const first=f.request('binding.status.get',active.signal),second=f.request('light_effect.get',queued.signal),third=f.request('status.get');
  const firstRejected=assert.rejects(first),secondRejected=assert.rejects(second);
  queued.abort();await secondRejected;assert.equal(f.sent.length,1);
  active.abort();await firstRejected;assert.deepEqual(f.sent.map(x=>x.request.action),['binding.status.get','status.get']);
  f.reply(f.sent[0]);assert.equal(f.sent.length,2);
  f.reply(f.sent[1]);await third;
 }finally{f.dom.window.close();}
});
test('sensor source replies require the current parent and origin and are cancelled on page close',async()=>{
 const f=bridge();try{
  const result=f.w.getDeviceSensorSources(),message=f.sent[0];let completed=false;result.then(()=>completed=true);
  const reply=origin=>f.w.dispatchEvent(new f.w.MessageEvent('message',{source:f.w,origin,data:{type:'device-sensor-sources-result',id:message.id,sources:[{device_id:'123456abcdef'}]}}));
  reply('https://unrelated.test');await Promise.resolve();assert.equal(completed,false);
  reply('https://platform.test');assert.deepEqual(JSON.parse(JSON.stringify(await result)),[{device_id:'123456abcdef'}]);
  const cancelled=f.w.getDeviceSensorSources();f.w.dispatchEvent(new f.w.Event('pagehide'));
  assert.deepEqual(JSON.parse(JSON.stringify(await cancelled)),[]);
 }finally{f.dom.window.close();}
});
test('upload bridge keeps ordinary and rescue uploads separate from explicit hub conversion',()=>{
 const f=bridge();try{
  const file=new f.w.Blob(['signed fixture']);
  for(const path of ['/api/v1/ota/upload','/api/v1/ota/upload-unsigned']){
   const xhr=f.w.createDeviceUpload();xhr.open('POST',path);
   xhr.setRequestHeader('X-IoTCloud-Target-Variant','hub');xhr.setRequestHeader('X-IoTCloud-Confirm','full-to-hub');xhr.send(file);
   assert.equal(f.sent.at(-1).rescue,path.endsWith('-unsigned'));
   assert.equal(Object.hasOwn(f.sent.at(-1),'target'),false,'ordinary routes never opt into conversion');
  }
  const xhr=f.w.createDeviceUpload();xhr.open('POST','/api/v1/ota/convert');
  assert.throws(()=>xhr.send(file),/Unsupported upload/);
  xhr.setRequestHeader('X-IoTCloud-Target-Variant','hub');xhr.setRequestHeader('X-IoTCloud-Confirm','hub-to-full');
  assert.throws(()=>xhr.send(file),/Unsupported upload/);
  xhr.setRequestHeader('X-IoTCloud-Confirm','full-to-hub');xhr.setRequestHeader('Authorization','must-not-leave-frame');xhr.send(file);
  const message=f.sent.at(-1);assert.equal(message.file,file);assert.equal(message.rescue,false);
  assert.deepEqual(JSON.parse(JSON.stringify(message.target)),{variant:'hub',confirm:'full-to-hub'});
  assert.equal(Object.hasOwn(message,'headers'),false);
  let progress=0,completed=0;xhr.upload.onprogress=e=>progress=e.loaded;xhr.onload=()=>completed++;
  const reply=(origin,type,data)=>f.w.dispatchEvent(new f.w.MessageEvent('message',{source:f.w,origin,data:{type,id:message.id,...data}}));
  reply('https://unrelated.test','device-upload-result',{result:{status:202,text:'accepted'}});assert.equal(completed,0);
  reply('https://platform.test','device-upload-progress',{loaded:4,total:8});assert.equal(progress,4);
  reply('https://platform.test','device-upload-result',{result:{status:202,text:'accepted'}});assert.equal(completed,1);assert.equal(xhr.status,202);
  assert.throws(()=>f.w.createDeviceUpload().open('POST','https://cloud.test/api/v1/ota/convert'),/Unsupported upload/);
 }finally{f.dom.window.close();}
});
