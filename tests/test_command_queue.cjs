/* Real command scheduler, optionally composed with firmware's body-drain adapter. */
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const tick=()=>new Promise(r=>setImmediate(r));
function harness(){
 const sent=[],pending=[];let invalidations=0;
 const w={Promise,Response,AbortController,DOMException,setTimeout,clearTimeout,console,Date,Math,UI:{invalidateStatus(){invalidations++;}},
  fetch(url,options){assert.equal(url,'/api/v1/command');sent.push(JSON.parse(options.body));return new Promise((resolve,reject)=>{pending.push({resolve,reject});options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});}};
 w.window=w;vm.createContext(w);
 if(process.argv[2])vm.runInContext(fs.readFileSync(process.argv[2],'utf8'),w);
 vm.runInContext(fs.readFileSync('common/web/service.js','utf8'),w);
 const command=(...args)=>w.command(...args);
 const reply=async(index,data={},code='ok',status=200)=>{await tick();pending[index].resolve(new Response(JSON.stringify({code,data}),{status}));await tick();};
 return {w,command,sent,pending,reply,invalidations:()=>invalidations};
}
(async()=>{
 {
  const h=harness();const reads=Array.from({length:10},()=>h.command('status.get'));
  await tick();assert.equal(h.sent.length,1);
  const bg=h.command('config.get',{section:'bg'},{background:true});const bgRejected=assert.rejects(bg,e=>e.code==='superseded');
  const foreground=h.command('config.get',{section:'first'});
  const write1=h.command('fan.set',{on:true}),write2=h.command('fan.set',{speed:50});
  const confirm=h.command('status.get');
  await bgRejected;assert.equal(h.invalidations(),2);
  let finishBody;
  h.pending[0].resolve({ok:true,status:200,statusText:'OK',headers:{},arrayBuffer:()=>new Promise(r=>finishBody=r),json:()=>new Promise(r=>finishBody=x=>r(JSON.parse(new TextDecoder().decode(x))))});
  await tick();assert.equal(h.sent.length,1,'headers cannot release active command');
  finishBody(new TextEncoder().encode('{"code":"ok","data":{"value":1}}'));await tick();
  assert.equal(h.sent[1].action,'fan.set');assert.deepEqual(JSON.parse(JSON.stringify(h.sent[1].params)),{on:true});
  await h.reply(1);assert.equal(h.sent[2].action,'fan.set');assert.notEqual(h.sent[1].request_id,h.sent[2].request_id);
  await h.reply(2);assert.equal(h.sent[3].action,'config.get');await h.reply(3);assert.equal(h.sent[4].action,'status.get');await h.reply(4,{value:2});
  const result=await Promise.all(reads);result[0].value=100;assert.equal(result[1].value,1,'subscribers own separate data');
  await Promise.all([foreground,write1,write2]);assert.equal((await confirm).value,2,'write barrier prevents joining old read');
 }
 {
  const h=harness(),a=new AbortController();const cancelled=h.command('status.get',{}, {signal:a.signal});const rejected=assert.rejects(cancelled,e=>e.code==='cancelled');
  const shared=h.command('status.get',{view:'full'});a.abort();await rejected;assert.equal(h.sent.length,1);await h.reply(0,{ok:true});assert.equal((await shared).ok,true);
  const live=h.command('status.get',{view:'live'}),full=h.command('status.get');await tick();await h.reply(1);await h.reply(2);await Promise.all([live,full]);assert.equal(h.sent.length,3);
 }
 {
  const h=harness();const active=h.command('status.get');const controller=new AbortController();
  const write=h.command('fan.set',{on:false},{signal:controller.signal});const cancelled=assert.rejects(write,e=>e.code==='cancelled');controller.abort();await cancelled;
  const timeout=h.command('fan.set',{on:false},{timeoutMs:5});await assert.rejects(timeout,e=>e.code==='timeout');
  await h.reply(0);await active;assert.equal(h.sent.length,1,'cancelled/expired queued writes never send');
  const failure=h.command('fan.set',{on:true});const failed=assert.rejects(failure,e=>e.code==='offline');await tick();h.pending[1].reject(Error('network'));await failed;
  const busy=h.command('status.get');const busyFailure=assert.rejects(busy,e=>e.code==='busy');await h.reply(2,{},'busy',503);await busyFailure;
  const after=h.command('status.get');await h.reply(3,{recovered:true});assert.equal((await after).recovered,true);assert.equal(h.sent.filter(x=>x.action==='fan.set').length,1,'unknown write result is not replayed');
 }
 {
  const h=harness(),all=[];all.push(h.command('status.get'));
  for(let i=0;i<12;i++)all.push(h.command('config.get',{section:i}));
  await assert.rejects(h.command('config.get',{section:12}),e=>e.code==='queue_full');
  for(let i=0;i<4;i++)all.push(h.command('fan.set',{speed:i}));
  await assert.rejects(h.command('fan.set',{speed:5}),e=>e.code==='queue_full');
  for(let i=0;i<17;i++)await h.reply(i);await Promise.all(all);assert.equal(h.sent.length,17);
 }
 console.log('Command scheduler: dedup, write epoch/priority/FIFO, body drain, independent cancellation/deadline, limits, recovery and no write retry PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
