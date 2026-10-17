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
 const reply=(message)=>w.dispatchEvent(new w.MessageEvent('message',{source:w,data:{type:'device-result',id:message.id,reply:{code:'ok',data:{}}}}));
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
