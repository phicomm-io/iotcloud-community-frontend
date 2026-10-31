const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const html=require('./render_page.cjs')('TC1/http_server/web/index.html');
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

async function fixture(){
 const dom=new JSDOM(html,{url:'http://device.local',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 const identity={device_id:'aabbccddeeff',model:'tc1',firmware_version:'test-rc4',variant:'full'};
 const state={...identity,version:'test-rc4',name:'initial',socket_names:['1','2','3','4','5','6'],socket_states:[0,0,0,0,0,0],led_enabled:true,
  report_seconds:30,powerCoefficientX100:100,time_synced:true,timezone_minutes:480,ntp_host:'pool.ntp.org',uptime_seconds:100};
 const caps={...identity,business_status:true,status_views:['full','live'],actions:['status.get','capabilities.get','config.get','schedules.get','buttons.get','indicator.set']};
 const calls=[],gates=[],reloads=[];let active=0,maxActive=0;
 Object.assign(w,{TextEncoder,TextDecoder});w.scrollTo=()=>{};w.setTimeout=w.setInterval=()=>0;
 w.fetch=async(url,options)=>{
  assert.equal(url,'/api/v1/command');const request=JSON.parse(options.body);calls.push(request);maxActive=Math.max(maxActive,++active);
  const gate=gates.find(item=>!item.used&&item.action===request.action);if(gate){gate.used=true;gate.started.resolve();}
  try{
   if(request.action==='indicator.set')state.led_enabled=request.params.enabled;
   const data=request.action==='status.get'?{...state}:request.action==='capabilities.get'?{...caps}:request.action==='config.get'?{migration_state:'ready'}:
    ['buttons.get','schedules.get'].includes(request.action)?{items:[],capacity:0}:{};
   if(gate)await gate.release.promise;
   return {ok:true,status:200,json:async()=>({code:gate?.code||'ok',data})};
  }finally{active--;}
 };
 require('./legacy_device_fixture.cjs')(w);
 for(const script of w.document.scripts)w.eval(script.textContent);
 await settle();assert.equal(w.UI.state.name,'initial');
 const reload=w.UI.reload;w.UI.reload=(...args)=>{const result=reload(...args);reloads.push(result);return result;};
 return {dom,w,state,caps,calls,reloads,maxActive:()=>maxActive,
  hold(action,code='ok'){const gate={action,code,started:deferred(),release:deferred()};gates.push(gate);return gate;},
  navigate(route){w.history.replaceState(null,'','#settings/'+route);w.UI.showRoute();return reloads.at(-1);},
  reads:()=>calls.filter(call=>call.action==='status.get')};
}

test('three settings entries chase a second invalidated load and apply only the final status',async()=>{
 const f=await fixture();try{
  const before=f.reads().length,start=f.hold('config.get'),catchup=f.hold('config.get');
  const first=f.navigate('schedule');await start.started.promise;
  const second=f.navigate('buttons');start.release.resolve();await catchup.started.promise;
  assert.equal(await first,null,'a superseded status must not be applied');
  f.state.name='latest';const last=f.navigate('device');
  assert.equal(last,second,'overlapping full reloads share the serial catch-up task');
  catchup.release.resolve();const result=await last;await settle();
  assert.equal(result?.name,'latest','the final route must await its own full status generation');
  assert.equal(f.w.UI.state.name,'latest');assert.equal(f.reads().length-before,3);
  assert.equal(f.calls.some(call=>['schedules.get','buttons.get'].includes(call.action)),false,'superseded pages must not launch their own reads');
  assert.equal(f.w.location.hash,'#settings/device');assert.equal(f.maxActive(),1);
 }finally{f.dom.window.close();}
});

test('many invalidations during one read coalesce into one full catch-up',async()=>{
 const f=await fixture();try{
  const before=f.reads().length,gate=f.hold('config.get');const first=f.w.UI.reload({full:true});await gate.started.promise;
  const pending=f.w.UI.reload({full:true});for(let i=0;i<8;i++)assert.equal(f.w.UI.reload({full:true}),pending);
  f.state.name='coalesced';gate.release.resolve();assert.equal(await first,null);assert.equal((await pending)?.name,'coalesced');
  await settle();assert.equal(f.reads().length-before,2);assert.deepEqual(f.reads().at(-1).params,{});assert.equal(f.maxActive(),1);
 }finally{f.dom.window.close();}
});

for(const action of ['status.get','capabilities.get','config.get'])test(`current-generation ${action} business busy returns failure without retry`,async()=>{
 const f=await fixture();try{
  const before=f.reads().length,start=f.hold('config.get');const first=f.w.UI.reload({full:true});await start.started.promise;
  const failure=f.hold(action,'busy'),pending=f.w.UI.reload({full:true});start.release.resolve();await failure.started.promise;failure.release.resolve();
  assert.equal(await first,null);assert.equal(await pending,null);await settle();
  assert.equal(f.reads().length-before,2,'a settled current generation must not retry its business failure');
  assert.equal(f.w.UI.state.name,'initial');
  f.state.name='recovered';assert.equal((await f.w.UI.reload({full:true}))?.name,'recovered','a later explicit reload may recover');
 }finally{f.dom.window.close();}
});

for(const stop of ['pagehide','identity'])for(const phase of ['initial','catch-up'])test(`${stop} during ${phase} retires a pending catch-up without another read or stale status`,async()=>{
 const f=await fixture();try{
  const before=f.reads().length,gate=f.hold('config.get'),first=f.w.UI.reload({full:true});await gate.started.promise;
  const next=phase==='catch-up'?f.hold('config.get'):null,pending=f.w.UI.reload({full:true});
  if(next){gate.release.resolve();await next.started.promise;f.w.UI.reload({full:true});}
  f.state.name='stale';
  if(stop==='pagehide')f.w.dispatchEvent(new f.w.Event('pagehide'));
  else f.w.UI.invalidateIdentity({...f.caps,device_id:'112233445566'});
  (next||gate).release.resolve();assert.equal(await first,null);assert.equal(await pending,null);await settle();
  assert.equal(f.reads().length-before,next?2:1);assert.equal(f.w.UI.state.name,'initial');
 }finally{f.dom.window.close();}
});

test('catch-up preserves write priority, queued read cancellation, serial requests and unsaved input',async()=>{
 const f=await fixture();try{
  const input=f.w.document.querySelector('#deviceName');input.value='unsaved draft';
  const gate=f.hold('config.get'),first=f.w.UI.reload({full:true});await gate.started.promise;
  const pending=f.w.UI.reload({full:true}),controller=new f.w.AbortController();
  const cancelled=f.w.command('buttons.get',{}, {signal:controller.signal});const rejected=assert.rejects(cancelled,error=>error.name==='AbortError');
  const background=f.w.command('logs.get');const write=f.w.eval("command('indicator.set',{enabled:false})");controller.abort();
  const at=f.calls.length;gate.release.resolve();await Promise.all([first,pending,background,write,rejected]);await settle();
  assert.equal(f.calls[at].action,'indicator.set','a queued write must run before queued background and catch-up reads');
  assert.equal(f.calls.filter(call=>call.action==='indicator.set').length,1,'writes must never be replayed');
  assert.equal(f.calls.some(call=>call.action==='buttons.get'),false,'an aborted queued read must not reach the wire');
  assert.equal(f.w.UI.state.led_enabled,false);assert.equal(input.value,'unsaved draft');assert.equal(f.maxActive(),1);
 }finally{f.dom.window.close();}
});
