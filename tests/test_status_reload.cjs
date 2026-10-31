const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const html=require('./render_page.cjs')('TC1/http_server/web/index.html');
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

async function fixture({firstCapsBusy=false,model='tc1',hubRemote=false}={}){
 const page=model==='m1'?'M1/web/index.html':model==='daikin'?'DAIKIN/web/index.html':null;
 const dom=new JSDOM(page?require('./render_page.cjs')(page):html,{url:'http://device.local',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 const identity={device_id:'aabbccddeeff',model,firmware_version:'test-rc4',variant:model==='daikin'?'hub':'full'};
 const state={...identity,version:'test-rc4',name:'initial',socket_names:['1','2','3','4','5','6'],socket_states:[0,0,0,0,0,0],led_enabled:true,
  report_seconds:30,powerCoefficientX100:100,time_synced:true,timezone_minutes:480,ntp_host:'pool.ntp.org',uptime_seconds:100};
 const caps={...identity,business_status:true,status_views:['full','live'],actions:['status.get','capabilities.get','config.get','schedules.get','buttons.get','indicator.set']};
 if(model==='daikin')caps.firmware_variant='hub';
 if(model==='m1')caps.actions.push('sensor_details.get','alarm.get','alarm.set','wake_alarm.get','wake_alarm.start','wake_alarm.stop');
 if(hubRemote){caps.hub_remote=true;caps.actions=['status.get','capabilities.get','diagnostics.get','power.get'];}
 const calls=[],gates=[],reloads=[];let active=0,maxActive=0,capsReads=0;
 Object.assign(w,{TextEncoder,TextDecoder});w.scrollTo=()=>{};w.setTimeout=w.setInterval=()=>0;
 w.fetch=async(url,options)=>{
  assert.equal(url,'/api/v1/command');const request=JSON.parse(options.body);calls.push(request);maxActive=Math.max(maxActive,++active);
  const gate=gates.find(item=>!item.used&&item.action===request.action);if(gate){gate.used=true;gate.started.resolve();}
  try{
   if(request.action==='indicator.set')state.led_enabled=request.params.enabled;
   const data=request.action==='status.get'?{...state}:request.action==='capabilities.get'?{...caps}:request.action==='config.get'?{migration_state:'ready'}:
    ['buttons.get','schedules.get'].includes(request.action)?{items:[],capacity:0}:{};
   if(gate)await gate.release.promise;
   const code=request.action==='config.get'?'unsupported':request.action==='capabilities.get'&&++capsReads===1&&firstCapsBusy?'busy':gate?.code||'ok';
   return {ok:true,status:200,json:async()=>({code,data})};
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

test('a failed initial capability read recovers without configuration access',async()=>{
 const f=await fixture({firstCapsBusy:true});try{
  assert(f.w.UI.caps.actions.includes('status.get'));
  assert.equal(f.w.UI.state.name,'initial');
  assert.equal(f.calls.some(call=>call.action==='config.get'),false);
  assert.equal((await f.w.UI.reload({full:true}))?.name,'initial');
  assert.equal(f.calls.some(call=>call.action==='config.get'),false);
 }finally{f.dom.window.close();}
});

test('the first M1 status precedes queued auxiliary initialization reads',async()=>{
 const f=await fixture({model:'m1'});try{
  const actions=f.calls.map(call=>call.action);
  assert(actions.includes('alarm.get'));
  assert(actions.indexOf('status.get')<actions.indexOf('alarm.get'),actions.join(','));
  assert.equal(f.maxActive(),1);
 }finally{f.dom.window.close();}
});

test('M1 initializes its capability-dependent controls once after the first handshake fails',async()=>{
 const f=await fixture({firstCapsBusy:true,model:'m1'});try{
  for(const action of ['sensor_details.get','alarm.get','wake_alarm.get'])assert(f.calls.some(call=>call.action===action),action);
  assert.equal(f.w.UI.device.nav.schedule,'wake.schedules');
  const alarm=f.w.document.querySelector('#wakeAlarmStop');assert(alarm);
  const count=f.w.document.querySelectorAll('#wakeAlarmStop').length;
  const name=f.w.document.querySelector('#deviceName');name.value='retained draft';
  await f.w.UI.reload({full:true});await f.w.UI.reload({full:true});await settle();
  assert.equal(f.w.document.querySelectorAll('#wakeAlarmStop').length,count);
  assert.equal(f.w.document.querySelector('#wakeAlarmStop'),alarm);
  assert.equal(f.w.document.querySelector('#deviceName').value,'retained draft');
 }finally{f.dom.window.close();}
});

for(const firstCapsBusy of [false,true])test(`DAIKIN hub entry is installed once (first busy: ${firstCapsBusy})`,async()=>{
 const f=await fixture({firstCapsBusy,model:'daikin'});try{
  const entry=f.w.document.querySelector('.hub-management-entry');assert(entry);
  assert.equal(entry.getAttribute('href'),'/iotcloud/#/');
  await f.w.UI.reload({full:true});await f.w.UI.reload({full:true});await settle();
  assert.equal(f.w.document.querySelectorAll('.hub-management-entry').length,1);
  assert.equal(f.w.document.querySelector('.hub-management-entry'),entry);
 }finally{f.dom.window.close();}
});

for(const firstCapsBusy of [false,true])test(`paired remote pages expose diagnostics and cannot route to local configuration (first busy: ${firstCapsBusy})`,async()=>{
 const f=await fixture({hubRemote:true,firstCapsBusy});try{
  assert.deepEqual([...f.w.document.querySelectorAll('#side a')].map(a=>a.hash),['#settings/diagnostics']);
  assert.equal(f.w.document.querySelector('#deviceName'),null);
  assert.equal(f.w.document.querySelector('#webPassword'),null);
  for(const page of ['network','mqtt','device','maintenance']){
   await f.navigate(page);await settle();
   assert.deepEqual([...f.w.document.querySelectorAll('[data-settings-page]')].filter(el=>!el.hidden).map(el=>el.dataset.settingsPage),['diagnostics']);
  }
  assert(f.calls.every(call=>['status.get','capabilities.get','diagnostics.get','power.get'].includes(call.action)));
 }finally{f.dom.window.close();}
});

test('three settings entries chase a second invalidated load and apply only the final status',async()=>{
 const f=await fixture();try{
  const before=f.reads().length,start=f.hold('capabilities.get'),catchup=f.hold('capabilities.get');
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
  const before=f.reads().length,gate=f.hold('capabilities.get');const first=f.w.UI.reload({full:true});await gate.started.promise;
  const pending=f.w.UI.reload({full:true});for(let i=0;i<8;i++)assert.equal(f.w.UI.reload({full:true}),pending);
  f.state.name='coalesced';gate.release.resolve();assert.equal(await first,null);assert.equal((await pending)?.name,'coalesced');
  await settle();assert.equal(f.reads().length-before,2);assert.deepEqual(f.reads().at(-1).params,{});assert.equal(f.maxActive(),1);
 }finally{f.dom.window.close();}
});

for(const action of ['status.get','capabilities.get'])test(`current-generation ${action} business busy returns failure without retry`,async()=>{
 const f=await fixture();try{
  const before=f.reads().length,start=f.hold('capabilities.get');const first=f.w.UI.reload({full:true});await start.started.promise;
  const failure=f.hold(action,'busy'),pending=f.w.UI.reload({full:true});start.release.resolve();await failure.started.promise;failure.release.resolve();
  assert.equal(await first,null);assert.equal(await pending,null);await settle();
  assert.equal(f.reads().length-before,2,'a settled current generation must not retry its business failure');
  assert.equal(f.w.UI.state.name,'initial');
  f.state.name='recovered';assert.equal((await f.w.UI.reload({full:true}))?.name,'recovered','a later explicit reload may recover');
 }finally{f.dom.window.close();}
});

for(const stop of ['pagehide','identity'])for(const phase of ['initial','catch-up'])test(`${stop} during ${phase} retires a pending catch-up without another read or stale status`,async()=>{
 const f=await fixture();try{
  const before=f.reads().length,gate=f.hold('capabilities.get'),first=f.w.UI.reload({full:true});await gate.started.promise;
  const next=phase==='catch-up'?f.hold('capabilities.get'):null,pending=f.w.UI.reload({full:true});
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
  const gate=f.hold('capabilities.get'),first=f.w.UI.reload({full:true});await gate.started.promise;
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
