const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
const cfg={available:true,mcu_supported:true,module_present:true,mode:2,slot:0,interval_seconds:5,low:1000,high:1500,revision:7};
const sensor={serial:'module',ready:false,valid:false,age_ms:30000,co2_ppm:null};
function fixture(reply){
 const html=require('./render_page.cjs')('M1/web/index.html');
 const dom=new JSDOM(html,{pretendToBeVisual:true,runScripts:'outside-only',url:'http://device.local'}),w=dom.window,calls=[];
 w.TextEncoder=TextEncoder;w.scrollTo=()=>{};
 w.setTimeout=(fn,delay)=>delay===750?setImmediate(fn):0;w.clearTimeout=()=>{};
 w.fetch=async(url,options)=>{
  assert.equal(url,'/api/v1/command');const request=JSON.parse(options.body);
  if(request.action==='binding.status.get')return {ok:true,status:200,json:async()=>({code:'ok',data:{peers:[],members:[]}})};
  calls.push(request);const body=await reply(request);return {ok:true,status:200,json:async()=>body};
 };
 require('./legacy_device_fixture.cjs')(w);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 scripts.forEach((source,i)=>{
  if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;};w.UI.reload=async()=>{render(w.UI.state.co2_display);return w.UI.state;};}
  vm.runInContext(source,dom.getInternalVMContext());
 });
 function render(co2_display,scd40=sensor){
  w.UI.acceptStatus({sensor_received:true,sensor_valid:false,age_ms:100,pm25:null,formaldehyde:null,temperature:null,humidity:null,co2_display,scd40});
  w.UI.device.onStatus(w.UI.state);
 }
 const card=w.document.getElementById('co2DisplayConfig'),interval=w.document.getElementById('co2DisplayInterval');
 async function submit(value=9){interval.value=String(value);interval.dispatchEvent(new w.Event('input',{bubbles:true}));card.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));}
 return {dom,w,calls,render,card,interval,submit,toasts:()=>[...w.document.querySelectorAll('#toasts .toast')]};
}
test('M1 screen save independently reads persisted settings, refreshes revision and preserves edits before saving',async()=>{
 let saved={...cfg};
 const f=fixture(({action,params})=>{
  if(action==='co2_display.set'){saved={...saved,...params,revision:params.revision+1};return {code:'accepted',data:saved};}
  if(action==='co2_display.get')return {code:'ok',data:saved};
  throw Error('Unexpected action '+action);
 });
 try{
  f.render();assert.equal(f.card.hidden,true);
  f.render({...cfg,mcu_supported:false});assert.equal(f.card.hidden,true);
  f.render({...cfg,module_present:false});assert.equal(f.card.hidden,true);
  f.render(cfg,{...sensor,serial:''});assert.equal(f.card.hidden,false,'an external source does not require a local SCD40');
  assert.equal(f.interval.value,'5');f.interval.value='9';f.interval.dispatchEvent(new f.w.Event('input',{bubbles:true}));
  f.render(cfg);assert.equal(f.interval.value,'9','poll does not overwrite edits');
  await f.submit();
  assert.deepEqual(f.calls.map(c=>c.action),['co2_display.set','co2_display.get']);
  assert.deepEqual(f.calls[0].params,{mode:2,slot:0,interval_seconds:9,low:1000,high:1500,revision:7});
  assert.equal(f.w.UI.state.co2_display.revision,8);assert.equal(f.interval.value,'9');
  assert.equal(f.toasts().length,1);assert.equal(f.toasts()[0].classList.contains('bad'),false);
  await f.submit(10);
  assert.equal(f.calls[2].params.revision,8,'the next save uses the independently read revision');
  assert.equal(f.w.UI.state.co2_display.revision,9);
 }finally{f.dom.window.close();}
});
for(const failure of ['rejected','null read','mismatched read','unchanged revision','failed read'])test('M1 screen '+failure+' cannot report a successful save',async()=>{
 const f=fixture(({action,params})=>{
  if(action==='co2_display.set')return failure==='rejected'?{code:'storage_error'}:{code:'accepted',data:{...cfg,...params,revision:8}};
  if(failure==='failed read')throw Error('read unavailable');
  return {code:'ok',data:failure==='null read'?null:{...cfg,interval_seconds:failure==='mismatched read'?5:9,revision:failure==='unchanged revision'?7:8}};
 });
 try{
  f.render(cfg);await f.submit();
  assert.equal(f.toasts().length,1);assert.equal(f.toasts()[0].classList.contains('bad'),true,'no accepted toast for an unconfirmed or rejected save');
  assert.doesNotMatch(f.toasts()[0].textContent,/Object\.entries|undefined|null/);
  assert.equal(f.w.UI.state.co2_display.revision,7,'failed confirmation does not promote submitted settings');
  f.render(cfg);assert.equal(f.interval.value,'9','the user can retry the edited value');
  assert.equal(f.card.querySelector('button[type=submit]').disabled,false);
 }finally{f.dom.window.close();}
});
test('output controls still wait for matching status and reject missing confirmation patches before sending',async()=>{
 const f=fixture(()=>({code:'accepted',data:{}}));
 try{
  f.render(cfg);f.w.UI.confirmed={...f.w.UI.state,brightness_requested:2};f.w.UI.state=f.w.UI.confirmed;
  for(const patch of [undefined,null,{},[]])await assert.rejects(f.w.UI.control('display.set',{brightness:25},patch));
  assert.equal(f.calls.length,0);assert.equal(f.w.UI.controlBusy,undefined);
  const seen=[];let reads=0;
  f.w.UI.reload=async()=>{
   seen.push(f.w.UI.state.brightness_requested);
   const status={...f.w.UI.confirmed,brightness_requested:++reads===1?2:1};f.w.UI.acceptStatus(status);return status;
  };
  await f.w.UI.control('display.set',{brightness:25},{brightness_requested:1});
  assert.equal(reads,2,'an accepted write with the old status is not success');assert.deepEqual(seen,[1,1]);
  assert.equal(f.w.UI.state.brightness_requested,1);assert.equal(f.w.UI.controlBusy,false);
 }finally{f.dom.window.close();}
});
