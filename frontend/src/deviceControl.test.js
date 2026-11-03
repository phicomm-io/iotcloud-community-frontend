import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ui=readFileSync(new URL('../../common/web/ui.js',import.meta.url),'utf8');
const source=ui.slice(ui.indexOf('let pendingControl=null;'),ui.indexOf('function header(dev)'));
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(){
 let id=0,reads=0,writes=0,read=()=>{},write=()=>{};const timers=new Map(),window=new EventTarget();
 const UI={state:{fan_on:false},confirmed:{fan_on:false},device:{},confirm:'dialog'};
 vm.runInNewContext(source,{UI,window,location:{hash:'#home'},t:k=>k,command:async()=>{writes++;await write();},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 UI.reload=async options=>{assert.equal(options.priority,1);reads++;await read();};
 return {UI,window,get reads(){return reads;},get writes(){return writes;},set read(fn){read=fn;},set write(fn){write=fn;},async tick(ms){const entry=[...timers].find(([,t])=>t.ms===ms);assert(entry,'missing timer '+ms);timers.delete(entry[0]);entry[1].fn();await flush();},timers};
}
test('control confirms actual accepted status, preserves dialog API and never resends a write',async()=>{
 const f=fixture();f.read=()=>f.UI.acceptStatus({fan_on:true});
 const result=await f.UI.control('fan.set',{on:true},{fan_on:true});
 assert.equal(result.fan_on,true);assert.equal(f.reads,1);assert.equal(f.writes,1);assert.equal(f.UI.controlBusy,false);assert.equal(f.UI.confirm,'dialog');assert.equal(f.timers.size,0);
});
test('three confirmation reads are the limit; ordinary polling can confirm slower application',async()=>{
 const f=fixture();f.read=()=>f.UI.acceptStatus({fan_on:false});
 const pending=f.UI.control('fan.set',{on:true},{fan_on:true});await flush();
 assert.equal(f.UI.state.fan_on,true,'old device state cannot replace optimistic output');
 await f.tick(250);await f.tick(750);assert.equal(f.reads,3);assert.equal(f.UI.controlBusy,true);
 f.UI.acceptStatus({fan_on:true});assert.equal((await pending).fan_on,true);assert.equal(f.reads,3);assert.equal(f.writes,1);assert.equal(f.timers.size,0);
});
test('deadline and page exit retire confirmation even while a response is stalled',async()=>{
 for(const exit of ['deadline','pagehide']){
  const f=fixture();let release;f.read=()=>new Promise(resolve=>release=resolve);
  const pending=f.UI.control('fan.set',{on:true},{fan_on:true});const rejected=assert.rejects(pending,/control.unconfirmed/);await flush();
  if(exit==='deadline')await f.tick(12000);else f.window.dispatchEvent(new Event('pagehide'));
  await rejected;assert.equal(f.UI.controlBusy,false);assert.equal(f.UI.state.fan_on,false);assert.equal(f.writes,1);
  release();await flush();assert.equal(f.reads,1,'late response cannot start another confirmation read');assert.equal(f.timers.size,0);
 }
});
test('busy is surfaced immediately; an ambiguous connection failure only reads for confirmation',async()=>{
 const busy=fixture();busy.write=()=>{throw Object.assign(Error('busy'),{code:'busy'});};
 await assert.rejects(busy.UI.control('fan.set',{on:true},{fan_on:true}),/busy/);assert.equal(busy.reads,0);assert.equal(busy.writes,1);
 const uncertain=fixture();uncertain.write=()=>{throw new TypeError('connection reset');};uncertain.read=()=>uncertain.UI.acceptStatus({fan_on:true});
 assert.equal((await uncertain.UI.control('fan.set',{on:true},{fan_on:true})).fan_on,true);assert.equal(uncertain.writes,1);assert.equal(uncertain.reads,1);
});
