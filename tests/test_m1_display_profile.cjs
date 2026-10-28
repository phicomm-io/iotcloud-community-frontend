const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const copy=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const lamps=()=>Array.from({length:3},()=>({red:false,green:false,yellow:false}));
const defaults=slot=>({slot,source:'none',device_id:'',metric:'custom',unit:'',display:{mode:'integer',show_label:false,show_unit:false},ttl_seconds:20,color:{mode:'fixed',lamps:lamps()}});
const remote=(f,slot,field_id='power',unit='W',device='123456abcdef')=>{f.edit(`display${slot}Source`,'mqtt');f.edit(`display${slot}Device`,device);f.edit(`display${slot}FieldId`,field_id);f.edit(`display${slot}SourceUnit`,unit);};
async function fixture(language='en',{initialRead=null,candidates=[],clock=null,fullCaps=true}={}){
 const html=require('./render_page.cjs')('M1/web/index.html'),dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local#settings/device'}),w=dom.window,calls=[];
 let config={revision:7,selected_source:'original',double_click:'none',lanes:[defaults(0),defaults(1)]},leases={},samples={},failure='',badRead=false,hold=null,override=null,transform=null,profile='formatted';
 const runtime=()=>({profile,selected_source:config.selected_source,mcu_supported:true,confirmed:false,confirmation:'pending_mcu_readback',lanes:config.lanes.map(lane=>{
  const lease=leases[lane.slot],age=lease?Math.floor(w.performance.now()-lease.started):null;
  if(lane.source==='api'){
   const valid=!!lease&&age<lease.ttl_seconds*1000;
   return {slot:lane.slot,valid,value:valid?Math.fround(lease.decimal?lease.number/100:lease.number):null,unit:valid&&lease.show_unit?(lane.slot?'µg/m³':'mg/m³'):'',age_ms:age,
    remaining_ttl_seconds:valid?Math.ceil((lease.ttl_seconds*1000-age)/1000):0,effective:false,reason:valid?'ok':lease?'stale':'missing',number:valid?lease.number:null,
    format:valid?Number(lease.decimal)|(lease.show_label?2:0)|(lease.show_unit?4:0):null,lamps:valid?copy(lease.lamps):null,confirmed:false};
  }
  const value=samples[lane.slot],encoded=value!==undefined?w.M1DisplayFormat.encode(lane.display,lane.slot,value):null,valid=!!encoded;
  return {slot:lane.slot,valid,value:valid?Math.fround(value):null,unit:lane.unit,age_ms:valid?0:null,remaining_ttl_seconds:valid?lane.ttl_seconds:0,
   effective:false,reason:valid?'ok':lease?'stale':lane.source==='none'?'disabled':'missing',number:encoded?.number??null,format:encoded?.format??null,
   lamps:valid?lane.color.mode==='fixed'?copy(lane.color.lamps):w.M1DisplayFormat.uniformLamps(value<lane.color.low?'green':value<lane.color.high?'yellow':'red'):null,confirmed:false};
 })});
 w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
 if(clock)Object.defineProperty(w.performance,'now',{value:clock});
 w.getDeviceSensorSources=async()=>candidates;
 w.fetch=async(url,options)=>{
  const request=JSON.parse(options.body);calls.push(request);let data={},code='ok';
  if(request.action==='display_profile.get'){if(initialRead)await initialRead;data=badRead?null:{schema:4,...copy(config),runtime:override||runtime()};}
  if(request.action==='display_source.get')data={revision:7,selected_source:'original',double_click:'none',lanes:[0,1].map(slot=>({slot,source:'none',device_id:'',metric:'custom',unit:'',decimals:0,scale:1,ttl_seconds:20,color:{mode:'fixed',value:'off'}})),runtime:{profile:'dual',selected_source:'original',mcu_supported:true,confirmed:false,confirmation:'pending_mcu_readback',lanes:[0,1].map(slot=>({slot,valid:false,value:null,unit:'',age_ms:null,remaining_ttl_seconds:0,effective:false,reason:'disabled',number:null,format:null,color:null,confirmed:false}))}};
  if(request.action==='display_profile.set'){
   if(hold)await hold;
   code=failure||(request.params.revision===config.revision?'accepted':'busy');
   if(code==='accepted'){config={...copy(request.params),revision:config.revision+1};config.lanes.forEach(lane=>{if(lane.color.mode==='thresholds'){lane.color.low=Math.fround(lane.color.low);lane.color.high=Math.fround(lane.color.high);}});leases={};override=null;profile='formatted';}data=null;
  }
  if(request.action==='display_value.set'){
   code=failure||'accepted';if(code==='accepted'){if(request.params.ttl_seconds)leases[request.params.slot]={...copy(request.params),started:w.performance.now()};else delete leases[request.params.slot];override=null;}data=null;
  }
  if(transform)data=transform(request.action,data);
  return {ok:true,status:200,json:async()=>({code,data})};
 };
 require('./legacy_device_fixture.cjs')(w);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
 scripts.forEach((source,index)=>{if(index===scripts.length-1)w.UI.start=device=>{w.UI.device=device;device.capabilities({actions:['co2_source.get','co2_source.set','display_source.get','display_source.set','display_data.set',...(fullCaps?['display_profile.get','display_profile.set','display_value.set']:['display_profile.get'])]});};vm.runInContext(source,dom.getInternalVMContext());});
 w.I18N.set(language);await settle();
 const card=w.document.getElementById('displaySourceConfig'),element=id=>w.document.getElementById(id);
 const edit=(id,value)=>{const input=element(id);if(input.type==='checkbox')input.checked=value;else input.value=String(value);input.dispatchEvent(new w.Event('input',{bubbles:true}));input.dispatchEvent(new w.Event('change',{bubbles:true}));};
 const submit=async()=>{card.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();};
 const click=async id=>{element(id).click();await settle();};
 return {dom,w,calls,card,element,edit,submit,click,runtime,getConfig:()=>copy(config),setRevision:value=>config.revision=value,setRuntime:value=>override=value,
  setFailure:value=>failure=value,setBadRead:value=>badRead=value,hold:value=>hold=value,setTransform:value=>transform=value,setProfile:value=>profile=value,
  setRead:value=>{config=copy(value);delete config.schema;delete config.runtime;override=copy(value.runtime);profile=value.runtime.profile;},
  setSamples:value=>samples=value,
  toasts:()=>[...w.document.querySelectorAll('#toasts .toast')],writes:()=>calls.filter(request=>!request.action.endsWith('.get'))};
}

for(const language of ['en','zh-CN'])test(`formatted pair ${language}: physical modes, separate segments and raw API frame receipt`,async()=>{
 const f=await fixture(language);try{
  assert.equal(f.w.document.querySelectorAll('#displaySourceConfig').length,1);
  assert.equal(f.calls.some(request=>request.action==='display_source.get'),false,'new capabilities select only the current profile');
  assert.equal(f.element('co2SourceConfig').hidden,true);assert.equal(f.card.querySelectorAll('table input[type=checkbox]').length,36);
  assert.equal(f.element('display0Mode').options.length,5);assert.equal(f.element('display1Mode').options.length,1);assert.equal(f.element('display1Mode').disabled,true);
  f.edit('displaySelectedSource','user');f.edit('displayDoubleClick','switch_display');
  remote(f,0,'new_co2','ppm','AA:BB:CC:DD:EE:FF');f.edit('display0Mode','auto_kilo');f.edit('display0Label',true);f.edit('display0Glyph',false);
  f.edit('display0Lamp0red',true);f.edit('display0Lamp0green',true);f.edit('display0Lamp1yellow',true);f.edit('display0Lamp2green',true);
  f.edit('display1Source','api');f.edit('display1WriteGlyph',true);f.edit('display1WriteLamp2yellow',true);
  assert.equal(f.element('display1Write').disabled,true);await f.submit();
  const write=f.writes()[0];assert.equal(write.action,'display_profile.set');assert.equal(write.params.revision,7);assert.equal(Object.hasOwn(write.params,'schema'),false);
  assert.deepEqual(write.params.lanes[0],{slot:0,source:'mqtt',device_id:'aabbccddeeff',field_id:'new_co2',type:'number',unit:'ppm',ttl_seconds:20,display:{mode:'auto_kilo',show_label:true,show_unit:false},color:{mode:'fixed',lamps:[{red:true,green:true,yellow:false},{red:false,green:false,yellow:true},{red:false,green:true,yellow:false}]}});
  assert.deepEqual(write.params.lanes[1],{...defaults(1),source:'api'},'new API sources store neutral unused metadata');
  assert.equal(f.calls[f.calls.indexOf(write)+1].action,'display_profile.get');
  f.setSamples({0:1234});await f.w.UI.userDisplay.load();assert.match(f.element('display0Preview').textContent,/1\.23/);
  assert.match(f.element('display0Status').textContent,/1234 ppm/);assert.doesNotMatch(f.element('display0Preview').textContent,/mg\/m³/);
  f.edit('display1Value',123);f.edit('display1WriteTTL',10);assert.match(f.element('display1WritePreview').textContent,/123/);assert.match(f.element('display1WritePreview').textContent,/µg\/m³/);await f.click('display1Write');
  assert.deepEqual(f.writes()[1].params,{revision:8,slot:1,number:123,decimal:false,show_label:false,show_unit:true,lamps:[{red:false,green:false,yellow:false},{red:false,green:false,yellow:false},{red:false,green:false,yellow:true}],ttl_seconds:10});
  await f.click('display1Clear');assert.deepEqual(f.writes().at(-1).params,{revision:8,slot:1,ttl_seconds:0});
  assert.match(f.element('display0Status').textContent,/1234 ppm/);assert(f.toasts().every(toast=>!toast.classList.contains('bad')));
  assert.match(f.element('displaySourceStatus').textContent,language==='en'?/Waiting for controller confirmation/:/等待控制器确认/);
 }finally{f.dom.window.close();}
});
test('each of nine fixed segments is saved independently and the other region is untouched',async()=>{
 const f=await fixture();try{
  for(const slot of [0,1])remote(f,slot);await f.submit();
  const expected=lamps();
  for(const position of [0,1,2])for(const color of ['red','green','yellow']){
   f.edit(`display0Lamp${position}${color}`,true);expected[position][color]=true;await f.submit();
   const config=f.getConfig();assert.deepEqual(config.lanes[0].color.lamps,expected);assert.deepEqual(config.lanes[1].color.lamps,lamps());
  }
  f.edit('display0Lamp1green',false);expected[1].green=false;await f.submit();assert.deepEqual(f.getConfig().lanes[0].color.lamps,expected);
 }finally{f.dom.window.close();}
});
test('source MAC accepts either representation, candidates normalize, malformed IDs never write',async()=>{
 const f=await fixture('en',{candidates:[{device_id:'AA:BB:CC:DD:EE:FF',device_name:'Air purifier',name:'Effective fan output',field_id:'fan_speed_percent',type:'number',unit:'%',value:65}]});try{
  f.edit('display0Source','mqtt');f.edit('display0Candidate','0');await f.submit();assert.equal(f.writes()[0].params.lanes[0].device_id,'aabbccddeeff');
  for(const id of ['123456ABCDEF','12:34:56:AB:CD:EF']){f.edit('display0Device',id);await f.submit();assert.equal(f.writes().at(-1).params.lanes[0].device_id,'123456abcdef');}
  const count=f.writes().length;for(const id of ['aa-bb-cc-dd-ee-ff','a:ab:bc:cd:de:ef','123456abcdex','']){f.edit('display0Device',id);await f.submit();}assert.equal(f.writes().length,count);
 }finally{f.dom.window.close();}
});
test('physical source float32 thresholds and positive overflow keep their configured conversion',async()=>{
 const f=await fixture();try{
  remote(f,0,'custom_load','kVA');f.edit('display0Mode','decimal_1');f.edit('display0ColorMode','thresholds');
  f.edit('display0Low',.1);f.edit('display0High',.3);await f.submit();assert.equal(f.toasts().at(-1).classList.contains('bad'),false);
  f.setSamples({0:999999});await f.w.UI.userDisplay.load();assert.match(f.element('display0Preview').textContent,/9\.90/);
  const count=f.writes().length;
  f.edit('display0Low','');await f.submit();assert.equal(f.writes().length,count);
  f.edit('display0Low',.3);f.edit('display0High',.3);await f.submit();assert.equal(f.writes().length,count);
  f.edit('display0Source','none');await f.submit();assert.deepEqual(f.getConfig().lanes[0],defaults(0),'disabled lanes normalize unfinished fields');
 }finally{f.dom.window.close();}
});
test('generic candidate names and units replace model adapters and never choose unsupported types',async()=>{
 const candidates=[
  {device_id:'123456abcdef',device_name:'Custom publisher',field_id:'new_load',name:'Apparent load',type:'number',unit:'kVA',value:12.5},
  {device_id:'abcdef123456',device_name:'Future publisher',field_id:'new_mode',name:'Operating mode',type:'text',unit:'',value:'0'},
  {device_id:'abcdef123456',device_name:'Invalid publisher',field_id:'new_count',name:'Count',type:'number',unit:'',value:null}
 ];
 const f=await fixture('en',{candidates});try{
  f.edit('display0Source','mqtt');assert.equal(f.element('display0Candidate').options.length,2);assert.equal(f.element('display0FieldId').value,'','opening a source does not bind its first candidate');
  assert.match(f.element('display0Candidate').textContent,/Custom publisher · Apparent load · 12.5 kVA/);assert.doesNotMatch(f.element('display0Candidate').textContent,/Operating mode|Invalid publisher|display.metric/);
  f.edit('display0Candidate','0');await f.submit();const lane=f.getConfig().lanes[0];
  assert.equal(lane.field_id,'new_load');assert.equal(lane.type,'number');assert.equal(lane.unit,'kVA');assert.equal(Object.hasOwn(lane,'metric'),false);assert.equal(Object.hasOwn(lane,'model'),false);assert.equal(Object.hasOwn(lane,'name'),false);
  f.setSamples({0:12.5});await f.w.UI.userDisplay.load();assert.match(f.element('display0Status').textContent,/12.5 kVA/);assert.match(f.element('display0Preview').textContent,/13/);
  f.edit('display0FieldId','manual_load');f.edit('display0SourceUnit','界'.repeat(8));candidates.splice(0,1,{...candidates[0],name:'Renamed field',unit:'W'});await f.w.UI.userDisplay.load();
  assert.equal(f.element('display0FieldId').value,'manual_load');assert.equal(f.element('display0SourceUnit').value,'界'.repeat(8));
  await f.submit();assert.equal(f.getConfig().lanes[0].field_id,'manual_load');assert.equal(f.getConfig().lanes[0].unit,'界'.repeat(8));
  const writes=f.writes().length;for(const id of ['bad-id','Uppercase','a'.repeat(33),'']){f.edit('display0FieldId',id);await f.submit();}assert.equal(f.writes().length,writes);
  f.edit('display0FieldId','manual_load');for(const unit of ['界'.repeat(9),'x\u007f']){f.edit('display0SourceUnit',unit);await f.submit();}assert.equal(f.writes().length,writes);
 }finally{f.dom.window.close();}
});
test('independent profile receipts require exact field identity, type and unit',async()=>{
 const f=await fixture();try{
  remote(f,0,'custom_ratio','ratio');
  f.setTransform((action,data)=>{if(action==='display_profile.get'&&data?.lanes[0].source==='mqtt')data.lanes[0].field_id='other_ratio';return data;});
  await f.submit();assert.equal(f.toasts().at(-1).classList.contains('bad'),true);assert.equal(f.element('display0FieldId').value,'custom_ratio');
  for(const patch of [{type:'text'},{field_id:'Invalid'},{unit:'界'.repeat(9)},{metric:'power'}]){
   f.setTransform((action,data)=>{if(action==='display_profile.get')Object.assign(data.lanes[0],patch);return data;});await assert.rejects(f.w.UI.userDisplay.load());
  }
 }finally{f.dom.window.close();}
});
test('pending controls, CAS edit revision and failed independent confirmation preserve edits',async()=>{
 const f=await fixture();try{
  remote(f,0,'custom_load','kVA','AABBCCDDEEFF');f.edit('display0Lamp1yellow',true);f.setRevision(9);await f.w.UI.userDisplay.load();
  assert.equal(f.element('display0Device').value,'AABBCCDDEEFF');assert.equal(f.element('display0Lamp1yellow').checked,true);
  await f.submit();assert.equal(f.writes()[0].params.revision,7);assert.equal(f.toasts().at(-1).classList.contains('bad'),true);
  let release;f.hold(new Promise(resolve=>release=resolve));await f.submit();
  assert.equal(f.writes().at(-1).params.revision,9);assert.equal(f.element('display0Lamp1yellow').disabled,true);assert.equal(f.element('display1Mode').disabled,true);
  release();await settle();f.hold(null);assert.equal(f.element('display0Lamp1yellow').disabled,false);
  f.edit('display0Lamp1yellow',false);f.setBadRead(true);await f.submit();assert.equal(f.toasts().at(-1).classList.contains('bad'),true);
  assert.equal(f.element('display0Lamp1yellow').checked,false);assert.doesNotMatch(f.toasts().at(-1).textContent,/Object\.entries|undefined|null/);
 }finally{f.dom.window.close();}
});
test('contract example and strict runtime validation preserve confirmed, projected and expired semantics',async()=>{
 const sample=require('./fixtures/m1-display-v3-contract-get.json'),f=await fixture();try{
  f.setRead(copy(sample));await f.w.UI.userDisplay.load();assert.equal(f.element('display0Mode').value,'decimal_1');assert.equal(f.element('display0Lamp0green').checked,true);
  assert.equal(f.element('display0Label').checked,true);assert.equal(f.element('display0Glyph').checked,false);assert.equal(f.element('display1Glyph').checked,true);
  const expired=copy(sample.runtime);Object.assign(expired.lanes[0],{reason:'stale',age_ms:30000});f.setRuntime(expired);await f.w.UI.userDisplay.load();
  const confirmed=copy(sample.runtime);Object.assign(confirmed,{confirmed:true,confirmation:'mcu_readback'});confirmed.lanes.forEach(lane=>lane.confirmed=true);confirmed.lanes[1].effective=true;f.setRuntime(confirmed);await f.w.UI.userDisplay.load();assert.match(f.element('displaySourceStatus').textContent,/Controller confirmed/);
  const projected=copy(sample.runtime);projected.profile='dual';f.setRuntime(projected);await f.w.UI.userDisplay.load();assert.equal(f.element('display0Write').disabled,true);
  for(const mutate of [value=>value.profile='unsupported',value=>value.lanes[1].format=1,value=>value.lanes[1].lamps[0].red=1,
   value=>value.lanes[1].effective=true,value=>value.lanes[1].extra=true,value=>value.lanes[1].format=8,value=>value.lanes[1].age_ms=-1,
   value=>{value.profile='dual';value.lanes[1].confirmed=true;},value=>{value.mcu_supported=false;value.lanes[1].effective=true;}]){
   const runtime=copy(sample.runtime);mutate(runtime);f.setRuntime(runtime);await assert.rejects(f.w.UI.userDisplay.load());
  }
  const upgrade=copy(sample.runtime);upgrade.mcu_supported=false;upgrade.confirmation='requires_mcu_upgrade';f.setRuntime(upgrade);await f.w.UI.userDisplay.load();assert.match(f.element('displaySourceStatus').textContent,/Update the M1 sensor MCU/);
 }finally{f.dom.window.close();}
});
test('missing profile capabilities explain the required upgrade without using removed APIs',async()=>{
 const f=await fixture('en',{fullCaps:false});try{
  assert.equal(f.card.hidden,false);assert.equal(f.card.querySelector('form').hidden,true);assert.match(f.card.textContent,/Update this M1’s Wi-Fi firmware/);
  assert.equal(f.element('display0Decimals'),null);assert.equal(f.calls.some(request=>request.action.startsWith('display_')),false);
 }finally{f.dom.window.close();}
});
test('production C schema4 MQTT descriptors bind arbitrary field IDs and units without a model adapter',async()=>{
 const f=await fixture();try{
  const sample=copy(require('./fixtures/m1-display-v4-mqtt-production-get.json'));f.setRead(sample);await f.w.UI.userDisplay.load();
  assert.equal(f.element('display0FieldId').value,'custom_sensor');assert.equal(f.element('display0SourceUnit').value,'mSv/h');
  assert.equal(f.element('display1FieldId').value,'other_numeric');assert.equal(f.element('display1SourceUnit').value,'ticks/interval');
  assert.match(f.element('display0Status').textContent,/1234 mSv\/h/);assert.match(f.element('display0Preview').textContent,/1\.23/);
  assert.match(f.element('display1Status').textContent,/42 ticks\/interval/);assert.equal(f.element('display0Metric').closest('label').hidden,true);
  await f.submit();assert.deepEqual(f.writes().at(-1).params.lanes,sample.lanes,'saving preserves the production descriptor bindings exactly');
  const stale=copy(sample);for(const lane of stale.runtime.lanes)Object.assign(lane,{valid:false,value:null,age_ms:21000,remaining_ttl_seconds:0,reason:'stale',number:null,format:null,lamps:null});
  f.setRead(stale);await f.w.UI.userDisplay.load();assert.equal(f.element('display0FieldId').value,'custom_sensor');assert.equal(f.element('display0SourceUnit').value,'mSv/h');assert.match(f.element('display0Status').textContent,/Reading expired/);
 }finally{f.dom.window.close();}
});
test('same-value renewals require new age and TTL, with actual transport delay allowed',async()=>{
 let now=1000;const f=await fixture('en',{clock:()=>now});try{
  f.edit('display0Source','api');await f.submit();f.edit('display0Value',1);f.edit('display0Decimal',true);f.edit('display0WriteTTL',10);await f.click('display0Write');
  assert.equal(f.toasts().at(-1).classList.contains('bad'),false);
  f.setTransform((action,data)=>{if(action==='display_profile.get'&&data?.runtime.lanes[0].valid){data.runtime.lanes[0].age_ms=5000;data.runtime.lanes[0].remaining_ttl_seconds=5;}return data;});
  await f.click('display0Write');assert.equal(f.toasts().at(-1).classList.contains('bad'),true);
  f.setTransform(null);const fetch=f.w.fetch;f.w.fetch=async(...args)=>{const result=await fetch(...args);if(JSON.parse(args[1].body).action==='display_value.set')now+=1250;return result;};
  await f.click('display0Write');assert.equal(f.toasts().at(-1).classList.contains('bad'),false);
 }finally{f.dom.window.close();}
});
test('raw API digits and lamps are independent of saved physical modes, with exact receipt and strict bounds',async()=>{
 const f=await fixture();try{
  const sample=copy(require('./fixtures/m1-display-v4-production-get.json'));f.setRead(sample);await f.w.UI.userDisplay.load();
  assert.equal(f.element('display0Value').value,'123');assert.equal(f.element('display0Decimal').checked,true);assert.equal(f.element('display0WriteLabel').checked,false);assert.equal(f.element('display0WriteGlyph').checked,true);
  assert.equal(f.element('display1Value').value,'999');assert.equal(f.element('display1WriteLabel').checked,true);assert.equal(f.element('display1WriteGlyph').checked,false);
  assert.match(f.element('display0WritePreview').textContent,/1\.23.*mg\/m³/);assert.match(f.element('displaySourceStatus').textContent,/Waiting for controller confirmation/);
  f.edit('display0Value',234);f.edit('display0WriteLamp0red',true);assert.equal(f.element('display0Write').disabled,false,'raw edits do not dirty persistent configuration');
  await f.click('display0Write');const raw=f.writes().at(-1);assert.equal(raw.action,'display_value.set');assert.equal(raw.params.number,234);assert.equal(raw.params.decimal,true);assert.equal(raw.params.lamps[0].red,true);
  assert.equal(Object.hasOwn(raw.params,'value'),false);assert.equal(Object.hasOwn(raw.params,'unit'),false);assert.match(f.element('display0Status').textContent,/2\.34 mg\/m³/);
  const before=f.writes().length;
  for(const number of [-1,1000,1.2]){f.edit('display0Value',number);await f.click('display0Write');}assert.equal(f.writes().length,before);
  f.edit('display1Value',123);f.edit('display1Decimal',true);await f.click('display1Write');assert.equal(f.writes().length,before,'PM decimal is rejected');f.edit('display1Decimal',false);
  for(const field of ['number','format','lamps','profile']){
   f.edit('display0Value',123);f.setTransform((action,value)=>{if(action==='display_profile.get'&&value?.runtime.lanes[0].valid){if(field==='profile')value.runtime.profile='dual';else if(field==='lamps')value.runtime.lanes[0].lamps[0].red=!value.runtime.lanes[0].lamps[0].red;else value.runtime.lanes[0][field]++;}return value;});
   await f.click('display0Write');assert.equal(f.toasts().at(-1).classList.contains('bad'),true,`${field} mismatch is not acknowledged`);
  }
  f.setTransform(null);await f.click('display0Write');assert.equal(f.toasts().at(-1).classList.contains('bad'),false);
  await f.submit();const kept=f.writes().at(-1).params.lanes;assert.deepEqual(kept[0],sample.lanes[0],'saving another profile field preserves ignored API metadata');
 }finally{f.dom.window.close();}
});
test('demo keeps physical-source thresholds and raw API frames separate, with independent expiry and compatibility ownership',()=>{
 let now=1000;const sandbox={window:{},structuredClone,performance:{now:()=>now}};
 vm.runInNewContext(require('node:fs').readFileSync('M1/web/display-format.js','utf8'),sandbox);
 vm.runInNewContext(require('node:fs').readFileSync('common/web/demo.js','utf8'),sandbox);
 const demo=sandbox.window.PhicommDemo.create('m1');
 const profile={revision:1,selected_source:'user',double_click:'switch_display',lanes:[
  {...defaults(0),source:'local',metric:'temperature',unit:'°C',display:{mode:'milli',show_label:false,show_unit:false},color:{mode:'thresholds',low:20,high:30}},
  {...defaults(1),source:'api',metric:'power',unit:'W'}]};
 assert.equal(demo.command('display_profile.get').runtime.profile,'dual');
 demo.command('display_profile.set',profile);
 const frame={revision:2,slot:1,number:123,decimal:false,show_label:true,show_unit:true,lamps:lamps(),ttl_seconds:2};
 demo.command('display_value.set',frame);
 let state=demo.command('display_profile.get');assert.equal(state.runtime.profile,'formatted');assert.equal(state.runtime.lanes[0].number,3);
 assert.deepEqual(copy(state.runtime.lanes[0].lamps),Array.from({length:3},()=>({red:false,green:false,yellow:true})));assert.equal(state.runtime.lanes[1].number,123);assert.equal(state.runtime.lanes[1].unit,'µg/m³');
 const compatibility=demo.command('display_source.get');assert.equal(compatibility.revision,2);assert(compatibility.lanes.every(lane=>lane.source==='none'));assert(compatibility.runtime.lanes.every(lane=>!lane.effective&&!lane.confirmed));
 now+=2001;state=demo.command('display_profile.get');assert.equal(state.runtime.lanes[1].reason,'stale');assert.equal(state.runtime.lanes[0].valid,true);
 profile.revision=2;profile.lanes[0].source='api';demo.command('display_profile.set',profile);
 const direct={revision:3,slot:0,number:123,decimal:true,show_label:false,show_unit:true,lamps:[{red:true,green:true,yellow:true},{red:false,green:true,yellow:false},{red:false,green:false,yellow:true}],ttl_seconds:10};
 demo.command('display_value.set',direct);state=demo.command('display_profile.get');assert.equal(state.runtime.lanes[0].number,123);assert.equal(state.runtime.lanes[0].format,5);assert.equal(state.runtime.lanes[0].unit,'mg/m³');assert.deepEqual(copy(state.runtime.lanes[0].lamps),direct.lamps);
 for(const patch of [{number:1000},{number:1.5},{lamps:[]},{decimal:1},{value:1234,unit:'ppm'}])assert.throws(()=>demo.command('display_value.set',{...direct,...patch}),/invalid_params/);
 assert.throws(()=>demo.command('display_value.set',{...frame,revision:3,decimal:true}),/invalid_params/);
 demo.command('display_value.set',{...frame,revision:3,ttl_seconds:20});demo.command('display_value.set',{revision:3,slot:0,ttl_seconds:0});assert.equal(demo.command('display_profile.get').runtime.lanes[1].valid,true);
 const old={revision:3,selected_source:'original',double_click:'none',lanes:[0,1].map(slot=>({slot,source:'none',device_id:'',metric:'custom',unit:'',decimals:0,scale:1,ttl_seconds:20,color:{mode:'fixed',value:'off'}}))};
 demo.command('display_source.set',old);state=demo.command('display_profile.get');assert.equal(state.runtime.profile,'dual');assert.equal(state.revision,4);assert(state.runtime.lanes.every(lane=>!lane.confirmed&&!lane.effective));
 profile.revision=4;profile.lanes[0].color={mode:'thresholds',low:.100000002,high:.300000002};demo.command('display_profile.set',profile);
 state=demo.command('display_profile.get');assert.equal(state.lanes[0].color.low,Math.fround(.100000002));assert.equal(state.lanes[0].color.high,Math.fround(.300000002));
});
