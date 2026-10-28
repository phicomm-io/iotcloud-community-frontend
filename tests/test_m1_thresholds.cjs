const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
async function setup(supported=true,alarmSupported=true){
 const html=require('./render_page.cjs')('M1/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
 let config={revision:7,hcho_configured:true,pm25_configured:true,hcho_yellow:80,hcho_red:200,pm25_yellow:35,pm25_red:75,
  hcho_buzzer_enabled:false,pm25_buzzer_enabled:false,buzzer_supported:alarmSupported,buzzer_confirmed:false,mcu_hcho_buzzer_enabled:null,mcu_pm25_buzzer_enabled:null},failure='';
 const calls=[];
 w.fetch=async(url,opt)=>{
  const req=JSON.parse(opt.body);calls.push(req);let code='ok';
  if(req.action==='alarm.set'){
   code=failure||'accepted';
   if(!failure){const {sensor,yellow,red,revision,buzzer_enabled}=req.params;assert.equal(revision,config.revision);config={...config,revision:revision+1,[sensor+'_configured']:true,[sensor+'_yellow']:yellow,[sensor+'_red']:red,buzzer_confirmed:false};if(buzzer_enabled!==undefined)config[sensor+'_buzzer_enabled']=buzzer_enabled;}
  }
  return {ok:true,json:async()=>({code,data:{...config}})};
 };
 require('./legacy_device_fixture.cjs')(w);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 scripts.forEach((source,i)=>{
  if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;dev.capabilities({actions:supported?['alarm.get','alarm.set']:[]});};}
  vm.runInContext(source,dom.getInternalVMContext());
 });
 w.I18N.set('en');await settle();
 const form=s=>w.document.querySelector(`[data-threshold-sensor="${s}"]`);
 const input=(s,k)=>w.document.getElementById(`m1Threshold_${s}_${k}`);
 const edit=(s,k,v)=>{const el=input(s,k);el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 return {dom,w,calls,form,input,edit,setFailure:v=>failure=v,setConfig:v=>config={...config,...v}};
}
test('M1 threshold forms read actual values, preserve edits, use shared revision and restore each stock pair',async()=>{
 const x=await setup(),{w,calls,form,input,edit}=x;
 try{
  assert.equal(w.document.getElementById('m1Thresholds').hidden,false);
  assert.equal(input('hcho','low').value,'80');assert.equal(input('pm25','high').value,'75');
  edit('pm25','low',40);edit('hcho','low',90);edit('hcho','high',250);
  form('hcho').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.deepEqual(calls.findLast(x=>x.action==='alarm.set').params,{sensor:'hcho',yellow:90,red:250,revision:7,buzzer_enabled:false});
  assert.equal(input('pm25','low').value,'40');
  form('pm25').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.equal(calls.findLast(x=>x.action==='alarm.set').params.revision,8);
  for(const [sensor,yellow,red,revision] of [['hcho',100,300,9],['pm25',75,150,10]]){
   form(sensor).querySelector('button[type=button]').click();await settle();
   assert.deepEqual(calls.findLast(x=>x.action==='alarm.set').params,{sensor,yellow,red,revision});
   assert.equal(input(sensor,'low').value,String(yellow));assert.equal(input(sensor,'high').value,String(red));
  }
 }finally{x.dom.window.close();}
});
test('M1 buzzers default off, persist independently and distinguish saved settings from MCU readback',async()=>{
 const x=await setup(),{w,calls,form}=x;
 const buzzer=s=>w.document.getElementById('m1Alarm_'+s);
 const refresh=async()=>{w.document.querySelector('#m1Thresholds > button').click();await settle();};
 try{
  assert.equal(buzzer('hcho').checked,false);assert.equal(buzzer('pm25').checked,false);
  assert.equal(buzzer('hcho').disabled,false);
  assert.match(w.document.getElementById('m1AlarmActual_hcho').textContent,/unknown/);
  buzzer('hcho').checked=true;buzzer('hcho').dispatchEvent(new w.Event('input',{bubbles:true}));
  form('hcho').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.equal(calls.findLast(x=>x.action==='alarm.set').params.buzzer_enabled,true);
  assert.equal(buzzer('hcho').checked,true);assert.equal(buzzer('pm25').checked,false);
  assert.match(w.document.getElementById('m1AlarmStatus').textContent,/waiting for MCU readback/);
  x.setConfig({buzzer_confirmed:true,mcu_hcho_buzzer_enabled:true,mcu_pm25_buzzer_enabled:false});await refresh();
  assert.match(w.document.getElementById('m1AlarmStatus').textContent,/read back and confirmed/);
  assert.equal(w.document.getElementById('m1AlarmActual_hcho').textContent,'MCU readback: enabled');
  assert.equal(w.document.getElementById('m1AlarmActual_pm25').textContent,'MCU readback: disabled');
  form('hcho').querySelector('button[type=button]').click();await settle();
  assert.equal(Object.hasOwn(calls.findLast(x=>x.action==='alarm.set').params,'buzzer_enabled'),false);
  assert.equal(buzzer('hcho').checked,true); // Restoring thresholds preserves the saved buzzer selection.
  buzzer('pm25').checked=true;buzzer('pm25').dispatchEvent(new w.Event('input',{bubbles:true}));
  x.setFailure('storage_error');form('pm25').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.equal(buzzer('pm25').checked,true); // Failed writes retain the user's edit.
  assert.equal(buzzer('hcho').checked,true);
  x.setFailure('');form('pm25').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.equal(calls.findLast(x=>x.action==='alarm.set').params.revision,9);
  await refresh();assert.equal(buzzer('hcho').checked,true);assert.equal(buzzer('pm25').checked,true);
  w.I18N.set('zh-CN');assert.match(w.document.getElementById('m1AlarmStatus').textContent,/等待主控读回确认/);
 }finally{x.dom.window.close();}
});
test('M1 older MCU keeps thresholds editable and labels unknown buzzer state with an upgrade prompt',async()=>{
 const x=await setup(true,false),{w,calls,form,edit}=x;
 try{
  assert.equal(w.document.getElementById('m1Alarm_hcho').disabled,true);
  assert.equal(w.document.getElementById('m1Alarm_pm25').disabled,true);
  assert.match(w.document.getElementById('m1AlarmStatus').textContent,/Upgrade.*unknown/);
  edit('hcho','low',88);form('hcho').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.deepEqual(calls.findLast(x=>x.action==='alarm.set').params,{sensor:'hcho',yellow:88,red:200,revision:7});
  assert.equal(w.document.getElementById('m1AlarmActual_hcho').textContent,'MCU readback: unknown');
 }finally{x.dom.window.close();}
});
test('M1 threshold validation, storage conflicts, unconfigured defaults and unsupported firmware',async()=>{
 const x=await setup(),{w,calls,form,input,edit}=x;
 try{
  for(const [low,high] of [['',300],[100,''],[-1,300],[301,300],[0,0],[0,65536],[1.5,300]]){
   edit('hcho','low',low);edit('hcho','high',high);form('hcho').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  }
  assert.equal(calls.filter(x=>x.action==='alarm.set').length,0);
  edit('hcho','low',99);edit('hcho','high',222);x.setConfig({revision:12});x.setFailure('busy');
  form('hcho').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.equal(input('hcho','low').value,'99');assert.equal(input('hcho','high').value,'222');
  x.setFailure('');form('hcho').dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.equal(calls.findLast(x=>x.action==='alarm.set').params.revision,12);
  x.setConfig({pm25_configured:false,pm25_yellow:0,pm25_red:0});
  w.document.querySelector('#m1Thresholds > button').click();await settle();
  assert.equal(input('pm25','low').value,'75');assert.equal(input('pm25','high').value,'150');
 }finally{x.dom.window.close();}
 const old=await setup(false);try{assert.equal(old.w.document.getElementById('m1Thresholds').hidden,true);assert.equal(old.calls.some(x=>x.action.startsWith('alarm.')),false);}finally{old.dom.window.close();}
});
