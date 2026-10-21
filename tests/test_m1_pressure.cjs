const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
test('M1 pressure stays inline, follows detected model and expires without a successful poll',async()=>{
 const html=require('./render_page.cjs')('M1/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  let now=100,timer,cleared=false;
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
  w.setInterval=fn=>{timer=fn;return 1;};
  w.clearInterval=()=>{cleared=true;};
  Object.defineProperty(w.performance,'now',{value:()=>now});
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{
   if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;};w.UI.reload=async()=>{};}
   vm.runInContext(source,dom.getInternalVMContext());
  });
  const row=w.document.getElementById('pressureReading'),value=w.document.getElementById('pressureValue');
  const base={sensor_received:true,sensor_valid:true,age_ms:100,pm25:20,formaldehyde:.02,temperature:25,humidity:50};
  function render(barometer,extra={}){w.UI.state={...base,...extra,barometer};w.UI.device.onStatus(w.UI.state);}
  const sensor={model:'BMP388',chip_id:0x50,address:0x77,ready:true,valid:true,age_ms:100,pressure_hpa:1013.24};
  render();assert.equal(row.hidden,true,'old firmware stays unchanged');
  render({...sensor,ready:false,valid:false,pressure_hpa:null});assert.equal(row.hidden,true);
  const cards=w.document.querySelectorAll('.card').length;
  render(sensor);assert.equal(row.hidden,false);assert.equal(value.textContent,'1013.2');
  assert.match(row.textContent,/hPa · BMP388/);assert.equal(row.closest('.card').id,'verdict');
  assert.equal(w.document.querySelectorAll('.card').length,cards,'no pressure card');
  render({...sensor,model:'BMP390',chip_id:0x60,address:0x76,pressure_hpa:815.77});
  assert.equal(value.textContent,'815.8','do not conceal or correct an unusual reading');
  assert.match(row.textContent,/BMP390/);
  for(const patch of [{ready:false},{valid:false},{model:'BMP280'},{age_ms:10000},
   {age_ms:-1},{age_ms:null},{pressure_hpa:null},{pressure_hpa:NaN},{pressure_hpa:Infinity},
   {pressure_hpa:'1013.2'},{pressure_hpa:0},{pressure_hpa:1250.1}]){
   render({...sensor,...patch});assert.equal(row.hidden,true);assert.equal(value.textContent,'');
  }
  render(sensor,{sensor_valid:false,sensor_received:false});
  assert.equal(row.hidden,false,'pressure is independent of the original UART sensor');
  w.UI.confirmed=w.UI.state;
  w.command=async()=>{throw Object.assign(Error('rejected'),{code:'invalid'});};
  now+=9000;
  await assert.rejects(w.UI.control('display.set',{brightness:25},{brightness_requested:1}),/rejected/);
  assert.equal(row.hidden,false,'optimistic and final control renders keep an unexpired measurement');
  now+=899;timer();assert.equal(row.hidden,false);
  now++;timer();assert.equal(row.hidden,true,'age plus elapsed time expires at 10 seconds');
  w.UI.device.onStatus(w.UI.state);
  assert.equal(row.hidden,true,'rendering the same measurement cannot restore stale pressure');
  render({...sensor,age_ms:0});assert.equal(row.hidden,false,'recovery displays fresh reading');
  w.dispatchEvent(new w.PageTransitionEvent('pagehide',{persisted:true}));
  assert.equal(cleared,false,'cache suspension must not permanently cancel expiry');
  now+=10000;
  w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));
  assert.equal(row.hidden,true,'cache restoration expires pressure before another successful poll');
  render({...sensor,age_ms:0});now+=10000;timer();
  assert.equal(row.hidden,true,'periodic expiry remains active after restoration');
  render();assert.equal(row.hidden,true,'missing sensor clears last value immediately');
 }finally{dom.window.close();}
});

for(const model of ['M1','A1','TC1'])test(model+' restores one status polling chain across cached navigation and in-flight races',async()=>{
 const path=model==='TC1'?'TC1/http_server/web/index.html':model+'/web/index.html';
 const html=require('./render_page.cjs')(path);
 const dom=new JSDOM(html,{pretendToBeVisual:true,runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  let now=100,nextTimer=0,fail=false,hold=null,active=0,peak=0;
  const timers=new Map(),reads=[],rendered=[];
  const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};
  w.setTimeout=(fn,delay)=>{const id=++nextTimer;timers.set(id,{id,fn,delay});return id;};
  w.clearTimeout=id=>timers.delete(id);w.setInterval=()=>++nextTimer;
  Object.defineProperty(w.performance,'now',{value:()=>now});
  const state={name:'current',device_id:'aabbccddeeff',version:'test',wifi_connected:true,mqtt_status:'ready',
   mqtt_connected:true,brightness_requested:2,brightness:255,led_enabled:true,fan_on:true,fan_ready:true,
   speed:60,percentage:60,applied_speed:60,requested_speed:60,panel_ready:true,
   sensor_received:true,sensor_valid:true,age_ms:100,temperature:25,humidity:50,formaldehyde:.02,pm25:20,
   socket_names:['1','2','3','4','5','6'],socket_states:[1,1,1,1,1,1],
   barometer:{model:'BMP388',ready:true,valid:true,age_ms:0,pressure_hpa:1013.24}};
  const decoded=()=>JSON.parse(JSON.stringify(state));
  const command=async(action,params={})=>{
   if(action==='capabilities.get')return {actions:[],status_views:['full','live']};
   if(action==='binding.status.get')return {peers:[],members:[],linkage_status:'disabled'};
   if(action!=='status.get')return {};
   reads.push(JSON.parse(JSON.stringify(params)));active++;peak=Math.max(peak,active);
   try{if(hold){const pending=hold;hold=null;return await pending;}
    if(fail)throw Error('offline');return decoded();
   }finally{active--;}
  };
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{if(i===scripts.length-1)w.command=command;vm.runInContext(source,dom.getInternalVMContext());});
  await flush();assert.equal(reads.length,1);assert.equal(w.UI.state.name,'current');
  const onStatus=w.UI.device.onStatus;w.UI.device.onStatus=s=>{rendered.push(s.name);onStatus?.(s);};
  const interval=w.UI.device.interval||2000;
  const pending=()=>[...timers.values()].filter(t=>t.delay===interval);
  const tick=async()=>{assert.equal(pending().length,1,'exactly one home status timer');const timer=pending()[0];timers.delete(timer.id);const result=timer.fn();await flush();return result;};
  assert.equal(pending().length,1);
  const oldTimer=pending()[0];
  w.dispatchEvent(new w.PageTransitionEvent('pagehide',{persisted:true}));
  assert.equal(pending().length,0,'pagehide cancels the pending status timer');
  fail=true;now+=10000;
  w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));
  w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));
  await flush();assert.equal(reads.length,2,'restore starts one full status read');assert.deepEqual(reads.at(-1),{});
  if(model==='M1')assert.equal(w.document.getElementById('pressureReading').hidden,true,'failed restore read cannot renew stale pressure');
  await oldTimer.fn();await flush();assert.equal(reads.length,2,'a previously queued timer cannot restart its old loop');
  await tick();assert.equal(reads.length,3,'failed restore still resumes periodic polling');
  fail=false;
  let release;hold=new Promise(resolve=>{release=resolve;});
  const current=pending()[0];timers.delete(current.id);const unfinished=current.fn();await flush();
  assert.equal(active,1);assert.equal(reads.length,4);
  for(let i=0;i<2;i++){
   w.dispatchEvent(new w.PageTransitionEvent('pagehide',{persisted:true}));
   w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));
   await flush();assert.equal(reads.length,4,'restoration waits for the old in-flight read');
  }
  release({...decoded(),name:'old response'});await unfinished;await flush();
  assert.equal(reads.length,5,'only the newest restore generation performs a replacement read');
  assert.deepEqual(reads.at(-1),{},'replacement is full even if the old response was full');
  assert.equal(w.UI.state.name,'current');assert(!rendered.includes('old response'),'pre-hide response is never rendered as fresh');
  assert.equal(peak,1,'lifecycle restore does not overlap status requests');assert.equal(pending().length,1);
  if(model==='M1')assert.equal(w.document.getElementById('pressureReading').hidden,false,'a newly decoded successful read restores pressure');
  await tick();assert.equal(reads.length,6);assert.equal(pending().length,1);
  Object.defineProperty(w.document,'hidden',{value:true,configurable:true});
  await tick();assert.equal(reads.length,6,'background polling remains paused');assert.equal(pending().length,1);
  Object.defineProperty(w.document,'hidden',{value:false,configurable:true});
  w.document.dispatchEvent(new w.Event('visibilitychange'));await flush();
  assert.equal(reads.length,7);assert.deepEqual(reads.at(-1),{});assert.equal(pending().length,1);
 }finally{dom.window.close();}
});
