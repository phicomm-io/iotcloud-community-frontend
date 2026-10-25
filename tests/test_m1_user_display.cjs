const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const copy=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const defaults=slot=>({slot,source:'none',device_id:'',metric:'custom',unit:'',decimals:0,scale:1,ttl_seconds:20,color:{mode:'fixed',value:'off'}});
async function fixture(language='en',{supported=true,candidates=[],floatStorage=false,initialRead=null}={}){
 const html=require('./render_page.cjs')('M1/web/index.html'),dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local#settings/device'}),w=dom.window,calls=[],sourceRequests=[];
 let config={revision:7,selected_source:'original',double_click:'none',lanes:[defaults(0),defaults(1)]},leases={},failure='',badRead=false,hold=null,override=null;
 const runtime=()=>({profile:'dual',selected_source:config.selected_source,mcu_supported:true,confirmed:false,confirmation:'pending_mcu_readback',lanes:config.lanes.map(lane=>{
  const value=leases[lane.slot];return {slot:lane.slot,valid:!!value,value:value?.value??null,unit:lane.unit,age_ms:value?0:null,remaining_ttl_seconds:value?.ttl_seconds||0,
   effective:false,reason:value?'ok':lane.source==='none'?'disabled':'missing',number:value?123:null,format:value?1:null,color:value?'red':null,confirmed:false};
 })});
 w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
 w.getDeviceSensorSources=async kind=>{sourceRequests.push(kind);return candidates;};
 w.fetch=async(url,options)=>{
  const request=JSON.parse(options.body);calls.push(request);let data={},code='ok';
  if(request.action==='display_source.get'){if(initialRead)await initialRead;data=badRead?null:{...copy(config),runtime:override||runtime()};}
  if(request.action==='display_source.set'){
   if(hold)await hold;
   code=failure|| (request.params.revision===config.revision?'accepted':'busy');
   if(code==='accepted'){config={...copy(request.params),revision:config.revision+1};leases={};if(floatStorage)config.lanes.forEach(lane=>{if(lane.color.mode==='thresholds'){lane.color.low=Math.fround(lane.color.low);lane.color.high=Math.fround(lane.color.high);}});}
   data=null;
  }
  if(request.action==='display_data.set'){
   code=failure||'accepted';if(code==='accepted'){if(request.params.ttl_seconds){leases[request.params.slot]=copy(request.params);if(floatStorage)leases[request.params.slot].value=Math.fround(request.params.value);}else delete leases[request.params.slot];}data=null;
  }
  return {ok:true,status:200,json:async()=>({code,data})};
 };
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
 scripts.forEach((source,index)=>{if(index===scripts.length-1)w.UI.start=device=>{w.UI.device=device;device.capabilities({actions:['co2_source.get','co2_source.set',...(supported?['display_source.get','display_source.set','display_data.set']:[])]});};vm.runInContext(source,dom.getInternalVMContext());});
 w.I18N.set(language);await settle();
 const card=w.document.getElementById('displaySourceConfig'),element=id=>w.document.getElementById(id);
 const edit=(id,value)=>{const input=element(id);input.value=String(value);input.dispatchEvent(new w.Event('input',{bubbles:true}));input.dispatchEvent(new w.Event('change',{bubbles:true}));};
 const submit=async()=>{card.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();};
 const click=async id=>{element(id).click();await settle();};
 return {dom,w,calls,card,element,edit,submit,click,sourceRequests,getConfig:()=>copy(config),setConfig:patch=>{Object.assign(config,patch);},setBadRead:value=>badRead=value,setFailure:value=>failure=value,hold:value=>hold=value,
  setRuntime:value=>override=value,runtime,toasts:()=>[...w.document.querySelectorAll('#toasts .toast')],writes:()=>calls.filter(request=>!request.action.endsWith('.get'))};
}
for(const language of ['en','zh-CN'])test('two M1 positions '+language+': full configuration, explicit save readback, API write/clear and global double-press',async()=>{
 const f=await fixture(language);try{
  assert.equal(f.card.hidden,false);assert.equal(f.card.querySelector('h2').textContent,language==='en'?'User readings on the device screen':'设备屏幕用户读数');
  assert.equal(f.w.document.getElementById('co2SourceConfig').hidden,true);assert.deepEqual(f.sourceRequests,['display']);
  assert.doesNotMatch(f.card.textContent,/Below 1000|小于 1000/);
  f.edit('displaySelectedSource','user');f.edit('displayDoubleClick','switch_display');
  f.edit('display0Source','api');f.edit('display0Metric','temperature');f.edit('display0Decimals',1);f.edit('display0Color','red');
  f.edit('display1Source','local');f.edit('display1Metric','pm25');f.edit('display1ColorMode','thresholds');f.edit('display1Low',35);f.edit('display1High',60);
  assert.equal(f.element('display0Write').disabled,true,'unsaved settings cannot write a lease');
  await f.submit();
  const write=f.writes()[0];assert.equal(write.action,'display_source.set');assert.equal(write.params.revision,7);
  assert.equal(write.params.selected_source,'user');assert.equal(write.params.double_click,'switch_display');assert.equal(write.params.lanes.length,2);
  assert.deepEqual(write.params.lanes[0],{...defaults(0),source:'api',metric:'temperature',unit:'°C',decimals:1,color:{mode:'fixed',value:'red'}});
  assert.deepEqual(write.params.lanes[1],{...defaults(1),source:'local',metric:'pm25',unit:'µg/m³',color:{mode:'thresholds',low:35,high:60}});
  assert.equal(f.calls[f.calls.indexOf(write)+1].action,'display_source.get','a null accepted receipt is followed by an independent read');
  f.edit('display0Value',25.3);f.edit('display0WriteTTL',10);await f.click('display0Write');
  assert.deepEqual(f.writes()[1].params,{revision:8,slot:0,value:25.3,unit:'°C',ttl_seconds:10});
  assert.match(f.element('display0Status').textContent,/25\.3 °C/);assert.equal(f.element('display1Status').textContent.includes('25.3'),false);
  assert.equal(f.toasts().length,2);assert(f.toasts().every(toast=>!toast.classList.contains('bad')));
  assert.match(f.element('displaySourceStatus').textContent,language==='en'?/Waiting for controller confirmation/:/等待控制器确认/,'HTTP readback does not claim MCU completion');
  await f.click('display0Clear');assert.deepEqual(f.writes()[2].params,{revision:8,slot:0,ttl_seconds:0});
  assert.equal(f.getConfig().lanes[1].source,'local','clearing one lease keeps both persisted sources');
  const status=f.runtime();status.selected_source='original';f.setRuntime(status);await f.w.UI.userDisplay.load();
  assert.match(f.element('displaySourceStatus').textContent,language==='en'?/Original readings/:/原始读数/);
  assert.equal(f.element('displaySelectedSource').value,'user','a button override is runtime state, not a rewritten saved preference');
 }finally{f.dom.window.close();}
});
test('typed TC1/A1 candidates select exact units and can configure both screen positions simultaneously',async()=>{
 const f=await fixture('en',{candidates:[{device_id:'123456abcdef',name:'Desk strip',metric:'power',unit:'W',value:42},
  {device_id:'abcdef123456',name:'Bedroom purifier',metric:'fan_speed_percent',unit:'%',value:65}]});
 try{
  for(const [slot,index] of [[0,0],[1,1]]){f.edit('display'+slot+'Source','mqtt');f.edit('display'+slot+'Candidate',index);}
  assert.equal(f.element('display0Metric').value,'power');assert.equal(f.element('display0Unit').value,'W');
  assert.equal(f.element('display1Metric').value,'fan_speed_percent');assert.equal(f.element('display1FanHelp').hidden,false);assert.equal(f.element('display0FanHelp').hidden,true);
  assert.match(f.card.textContent,/current effective output/);assert.doesNotMatch(f.card.textContent,/measured RPM/);
  await f.submit();const lanes=f.writes()[0].params.lanes;
  assert.equal(lanes[0].device_id,'123456abcdef');assert.equal(lanes[1].device_id,'abcdef123456');assert.equal(lanes[1].metric,'fan_speed_percent');assert.equal(lanes[1].unit,'%');
 }finally{f.dom.window.close();}
});
test('two API leases and their fallback states remain independent',async()=>{
 const f=await fixture();try{
  f.edit('displaySelectedSource','user');for(const slot of [0,1]){f.edit('display'+slot+'Source','api');f.edit('display'+slot+'Metric','custom');}
  await f.submit();
  for(const [slot,value] of [[0,12],[1,34]]){f.edit('display'+slot+'Value',value);await f.click('display'+slot+'Write');}
  assert.match(f.element('display0Status').textContent,/12/);assert.match(f.element('display1Status').textContent,/34/);
  const runtime=f.runtime();Object.assign(runtime,{confirmed:true,confirmation:'mcu_readback'});runtime.lanes.forEach(lane=>Object.assign(lane,{confirmed:true,effective:true}));
  Object.assign(runtime.lanes[0],{valid:false,value:null,effective:false,reason:'stale',remaining_ttl_seconds:0,number:null,format:null,color:null});f.setRuntime(runtime);
  await f.w.UI.userDisplay.load();assert.match(f.element('display0Status').textContent,/Reading expired/);assert.match(f.element('display1Status').textContent,/Using user reading.*34/);
 }finally{f.dom.window.close();}
});
test('float32 persistence confirms decimal physical values and disabling an unfinished position is saveable',async()=>{
 const f=await fixture('en',{floatStorage:true});try{
  f.edit('display0Source','api');f.edit('display0Metric','temperature');f.edit('display0ColorMode','thresholds');f.edit('display0Low',20.1);f.edit('display0High',25.6);
  f.edit('display1Source','api');f.edit('display1ColorMode','thresholds');f.edit('display1Source','none');await f.submit();
  assert.equal(f.toasts().at(-1).classList.contains('bad'),false);assert.deepEqual(f.writes()[0].params.lanes[1],defaults(1));
  f.edit('display0Value',25.3);await f.click('display0Write');
  assert.equal(f.toasts().at(-1).classList.contains('bad'),false);assert.match(f.element('display0Status').textContent,/25\.3 °C/);
 }finally{f.dom.window.close();}
});
test('slow initial configuration keeps inputs disabled until a valid CAS revision is read',async()=>{
 let release;const f=await fixture('en',{initialRead:new Promise(done=>release=done)});try{
  for(const id of ['displaySelectedSource','displayDoubleClick','display0Source','display1Source','displaySourceSave'])assert.equal(f.element(id).disabled,true);
  assert.equal(f.writes().length,0);release();await settle();assert.equal(f.element('display0Source').disabled,false);
  f.edit('display0Source','local');f.edit('display0Metric','humidity');await f.submit();
  assert.equal(f.writes()[0].params.revision,7);assert.equal(f.toasts().at(-1).classList.contains('bad'),false);
 }finally{release();f.dom.window.close();}
});
for(const failure of ['storage_error','null read'])test('generic display '+failure+' never reports save success or unlocks API writes',async()=>{
 const f=await fixture();try{
  f.edit('display0Source','api');f.edit('display0Metric','power');if(failure==='null read')f.setBadRead(true);else f.setFailure(failure);
  await f.submit();assert.equal(f.toasts().length,1);assert.equal(f.toasts()[0].classList.contains('bad'),true);
  assert.equal(f.element('display0Source').value,'api');assert.equal(f.element('display0Write').disabled,true);
  assert.doesNotMatch(f.toasts()[0].textContent,/Object\.entries|undefined|null/);
 }finally{f.dom.window.close();}
});
test('generic writes reject invalid thresholds, wrong IDs, excessive values and null confirmation',async()=>{
 const f=await fixture();try{
  f.edit('display0Source','mqtt');f.edit('display0Device','bad-id');await f.submit();assert.equal(f.writes().length,0);
  f.edit('display0Source','api');f.edit('display0Metric','power');f.edit('display0ColorMode','thresholds');f.edit('display0Low',10);f.edit('display0High',10);
  await f.submit();assert.equal(f.writes().length,0);f.edit('display0High',100);await f.submit();
  f.edit('display0Value',1000);await f.click('display0Write');assert.equal(f.writes().length,1);
  f.edit('display0Value',42);f.setBadRead(true);await f.click('display0Write');assert.equal(f.writes().length,2);
  assert.equal(f.toasts().at(-1).classList.contains('bad'),true,'an accepted write without valid independent data is not success');
 }finally{f.dom.window.close();}
});
test('background reads preserve edit revision and pending saves disable controls',async()=>{
 const f=await fixture();try{
  f.edit('display0Source','local');f.edit('display0Metric','co2');f.setConfig({revision:9});await f.w.UI.userDisplay.load();await f.submit();
  assert.equal(f.writes()[0].params.revision,7,'a background read cannot silently bypass CAS');assert.equal(f.toasts().at(-1).classList.contains('bad'),true);
  let release;f.hold(new Promise(resolve=>release=resolve));const save=f.submit();await settle();
  assert.equal(f.element('display0Source').disabled,true);assert.equal(f.element('displayDoubleClick').disabled,true);
  release();await save;await settle();assert.equal(f.writes()[1].params.revision,9);assert.equal(f.element('display0Source').disabled,false);
 }finally{f.dom.window.close();}
});
test('generic controls are capability gated and unsupported controllers get an explicit upgrade status',async()=>{
 const old=await fixture('en',{supported:false});try{assert.equal(old.card.hidden,true);assert.equal(old.calls.some(call=>call.action.startsWith('display_source.')),false);}finally{old.dom.window.close();}
 const f=await fixture();try{const runtime=f.runtime();runtime.mcu_supported=false;runtime.confirmation='requires_mcu_upgrade';f.setRuntime(runtime);await f.w.UI.userDisplay.load();assert.match(f.element('displaySourceStatus').textContent,/Update the M1 display controller/);}finally{f.dom.window.close();}
});
test('production-C GET example, wire formats and independent MCU confirmation stay consistent',async()=>{
 const production=require('./fixtures/m1-display-production-get.json'),f=await fixture();
 try{
  f.setConfig(copy(production));f.setRuntime(copy(production.runtime));await f.w.UI.userDisplay.load();
  assert.match(f.element('displaySourceStatus').textContent,/Controller confirmed/);
  assert.equal(f.element('display0Scale').value,'1000');assert.equal(f.element('display0Decimals').value,'2');
  assert.match(f.element('display0Preview').textContent,/1\.23/);assert.equal(f.element('display0Co2Help').hidden,false);
  assert.equal(f.element('display1Co2Help').hidden,true);
  for(const format of [0,1,2,4,5,6]){const runtime=copy(production.runtime);runtime.lanes[0].format=format;f.setRuntime(runtime);await f.w.UI.userDisplay.load();}
  const cleared=copy(production.runtime);Object.assign(cleared.lanes[0],{valid:false,value:null,remaining_ttl_seconds:0,age_ms:null,effective:false,reason:'missing',number:null,format:null,color:null});
  f.setRuntime(cleared);await f.w.UI.userDisplay.load();assert.match(f.element('displaySourceStatus').textContent,/Controller confirmed/,'a cleared value can be independently confirmed');
  for(const mutate of [r=>r.lanes[0].format=3,r=>r.lanes[0].format=7,r=>r.lanes[0].number=1000,r=>r.lanes[0].confirmed=false,r=>r.confirmation='pending_mcu_readback',r=>r.mcu_supported=false,
   r=>r.lanes[0].value=null,r=>r.lanes[0].age_ms=null,r=>r.lanes[0].remaining_ttl_seconds=0,r=>r.lanes[0].reason='missing',r=>r.lanes[0].valid=false]){
   const runtime=copy(production.runtime);mutate(runtime);f.setRuntime(runtime);await assert.rejects(f.w.UI.userDisplay.load());
  }
 }finally{f.dom.window.close();}
});
test('in-memory M1 demo keeps API leases independent and colors use physical values before scaling',()=>{
 let now=1000;const sandbox={window:{},structuredClone,performance:{now:()=>now}};
 vm.runInNewContext(require('node:fs').readFileSync('common/web/demo.js','utf8'),sandbox);
 const demo=sandbox.window.PhicommDemo.create('m1'),params={revision:1,selected_source:'user',double_click:'switch_display',lanes:[
  {...defaults(0),source:'api',metric:'co2',unit:'ppm',decimals:2,scale:1000,color:{mode:'thresholds',low:1000,high:1500}},
  {...defaults(1),source:'api',metric:'power',unit:'W',color:{mode:'fixed',value:'red'}}
 ]};
 assert.equal(demo.command('display_source.set',params),null);
 demo.command('display_data.set',{revision:2,slot:0,value:1230,unit:'ppm',ttl_seconds:2});
 demo.command('display_data.set',{revision:2,slot:1,value:42,unit:'W',ttl_seconds:20});
 let read=demo.command('display_source.get');assert.equal(read.runtime.lanes[0].number,123);assert.equal(read.runtime.lanes[0].color,'yellow');
 assert.equal(read.runtime.confirmed,false);assert(read.runtime.lanes.every(lane=>lane.valid&&!lane.effective));
 now+=2001;read=demo.command('display_source.get');assert.equal(read.runtime.lanes[0].reason,'stale');assert.equal(read.runtime.lanes[0].value,null);
 assert.equal(read.runtime.lanes[1].value,42);assert.equal(read.runtime.lanes[1].color,'red');
 demo.command('display_data.set',{revision:2,slot:1,ttl_seconds:0});read=demo.command('display_source.get');
 assert.equal(read.runtime.lanes[1].valid,false);assert.equal(read.lanes[0].source,'api');assert.equal(read.lanes[1].source,'api');
});
