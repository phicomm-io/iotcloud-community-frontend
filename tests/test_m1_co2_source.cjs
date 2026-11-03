const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
async function setup(lang='en',supported=true){
 const html=require('./render_page.cjs')('M1/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
 let config={source:'local',device_id:'',double_click:'none',revision:7,valid:false,button_events_supported:true},failure='',hold,nullRead=false;
 const calls=[];
 w.fetch=async(url,opt)=>{
  const req=JSON.parse(opt.body);calls.push(req);let code='ok';
  if(req.action==='co2_source.set'){
   if(hold)await hold;
   code=failure||'accepted';
   if(!failure)config={...config,...req.params,revision:config.revision+1};
  }
  return {ok:true,json:async()=>({code,data:req.action==='co2_source.set'||nullRead?null:{...config}})};
 };
 require('./legacy_device_fixture.cjs')(w);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 scripts.forEach((source,i)=>{
  if(i===scripts.length-1){
   w.getDeviceSensorSources=async()=>[{device_id:'123456abcdef',name:'Office',ppm:812}];
   w.UI.start=dev=>{w.UI.device=dev;dev.capabilities({actions:supported?['co2_source.get','co2_source.set']:[]});};
  }
  vm.runInContext(source,dom.getInternalVMContext());
 });
 w.I18N.set(lang);await settle();
 const card=w.document.getElementById('co2SourceConfig'),form=card.querySelector('form');
 const mode=w.document.getElementById('co2SourceMode'),id=w.document.getElementById('co2SourceID'),action=w.document.getElementById('co2DoubleClick');
 const edit=(el,value)=>{el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));el.dispatchEvent(new w.Event('change',{bubbles:true}));};
 const submit=async()=>{form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();};
 return {dom,w,calls,card,form,mode,id,action,edit,submit,setFailure:v=>failure=v,setConfig:v=>config={...config,...v},hold:v=>hold=v,setNullRead:v=>nullRead=v};
}
for(const lang of ['en','zh-CN'])test('M1 CO2 source form '+lang+': candidates, local/external switch, revision and pending state',async()=>{
 const x=await setup(lang),{w,calls,card,mode,id,action,edit,submit}=x;
 try{
  assert.equal(card.hidden,false);assert.equal(mode.value,'local');assert.equal(id.disabled,true);
  assert.equal(id.getAttribute('list'),'co2SourceCandidates');
  assert.equal(w.document.querySelector('#co2SourceCandidates option').value,'123456abcdef');
  assert.equal(card.querySelector('h2').textContent,lang==='en'?'Wi-Fi display source':'Wi-Fi 显示数据源');
  edit(mode,'mqtt');assert.equal(id.disabled,false);assert.equal(id.required,true);
  edit(id,'123456ABCDEF');edit(action,'switch_display');
  // A poll cannot silently advance the revision of an unsaved edit.
  x.setConfig({revision:9});await w.UI.device.pages.device.show();await settle();
  assert.equal(id.value,'123456ABCDEF');
  let release;x.hold(new Promise(r=>release=r));await submit();
  assert.equal(mode.disabled,true);assert.equal(id.disabled,true);assert.equal(action.disabled,true);
  assert.deepEqual(calls.findLast(c=>c.action==='co2_source.set').params,{source:'mqtt',device_id:'123456abcdef',double_click:'switch_display',revision:7});
  release();await settle();x.hold(null);
  const saved=calls.findLast(c=>c.action==='co2_source.set');assert.equal(calls[calls.indexOf(saved)+1].action,'co2_source.get');
  assert.equal(w.document.querySelector('#toasts .toast').classList.contains('bad'),false);
  assert.equal(mode.disabled,false);assert.equal(id.disabled,false);
  edit(mode,'local');await submit();
  assert.deepEqual(calls.findLast(c=>c.action==='co2_source.set').params,{source:'local',device_id:'',double_click:'switch_display',revision:10});
 }finally{x.dom.window.close();}
});
for(const failure of ['storage_error','null read'])test('legacy CO2 source '+failure+' cannot produce a successful save toast',async()=>{
 const x=await setup();try{
  x.edit(x.mode,'mqtt');x.edit(x.id,'123456abcdef');
  if(failure==='null read')x.setNullRead(true);else x.setFailure(failure);
  await x.submit();const toast=x.w.document.querySelector('#toasts .toast');assert(toast);assert.equal(toast.classList.contains('bad'),true);
  assert.equal(x.id.value,'123456abcdef');assert.equal(x.mode.disabled,false);assert.doesNotMatch(toast.textContent,/Object\.entries|undefined|null/);
 }finally{x.dom.window.close();}
});
test('M1 CO2 source rejects bad IDs, recovers conflicts, and gates unsupported MCU/button features',async()=>{
 const x=await setup(),{w,calls,mode,id,action,edit,submit}=x;
 try{
  edit(mode,'mqtt');for(const value of ['', '123', '123456abcdeg']){edit(id,value);await submit();}
  assert.equal(calls.filter(c=>c.action==='co2_source.set').length,0);
  edit(id,'123456abcdef');x.setFailure('conflict');x.setConfig({revision:12});await submit();
  assert.equal(id.value,'123456abcdef');x.setFailure('');await submit();
  assert.equal(calls.findLast(c=>c.action==='co2_source.set').params.revision,12);
  x.setConfig({button_events_supported:false});await w.UI.device.pages.device.show();await settle();
  assert.equal(action.disabled,true);
 }finally{x.dom.window.close();}
 const old=await setup('en',false);try{assert.equal(old.card.hidden,true);assert.equal(old.calls.some(c=>c.action.startsWith('co2_source.')),false);}finally{old.dom.window.close();}
});
test('legacy CO2 source accepts compact or colon-separated MACs and normalizes before sending',async()=>{
 const x=await setup();try{
  x.edit(x.mode,'mqtt');
  for(const value of ['AA:BB:CC:DD:EE:FF','AABBCCDDEEFF']){x.edit(x.id,value);await x.submit();assert.equal(x.calls.findLast(c=>c.action==='co2_source.set').params.device_id,'aabbccddeeff');}
  const count=x.calls.filter(c=>c.action==='co2_source.set').length;
  for(const value of ['aa-bb-cc-dd-ee-ff','a:ab:bc:cd:de:ef','aa:bb:cc:dd:ee:ff:']){x.edit(x.id,value);await x.submit();}
  assert.equal(x.calls.filter(c=>c.action==='co2_source.set').length,count);
 }finally{x.dom.window.close();}
});
