const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');const flush=()=>new Promise(r=>setImmediate(r));
async function settle(){for(let i=0;i<8;i++)await flush();}
async function setup(supported=true,{timezone=0,now,toneSupport=false}={}){
 const html=require('./render_page.cjs')('M1/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 if(now!==undefined){const NativeDate=w.Date;w.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};}
 w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;w.HTMLElement.prototype.scrollIntoView=()=>{};
 const calls=[];let tasks=[],active=false,fail=false,seconds=0;
 const caps={actions:['display.set','schedules.get','schedules.put',...(supported?['wake_alarm.get','wake_alarm.start','wake_alarm.stop']:[])]};
 w.fetch=async(url,opt)=>{const req=JSON.parse(opt.body);calls.push(req);let data={};
  if(req.action==='wake_alarm.start'){active=true;seconds=req.params.duration_seconds;}
  if(req.action==='wake_alarm.stop')active=false;
  if(req.action.startsWith('wake_alarm.'))data={active,remaining_seconds:active?seconds:0,tone_supported:toneSupport,tone_count:toneSupport?4:0};
  if(req.action==='schedules.put'&&!fail)tasks=[{at:0,days:0,minute:0,...req.params,id:req.params.id||1,state:'waiting'}];
  if(req.action==='schedules.get')data={items:tasks,next:8,capacity:8,count:tasks.length};
  return {ok:true,json:async()=>({code:fail?'storage_error':'ok',data})};};
 require('./legacy_device_fixture.cjs')(w);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
 scripts.forEach((s,i)=>{if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;w.UI.caps=caps;dev.capabilities(caps);};w.UI.reload=async()=>w.UI.state;}vm.runInContext(s,dom.getInternalVMContext());});
 w.I18N.set('en');w.UI.state={time_synced:true,timezone_minutes:timezone};
 const page=w.automationPages(w.UI.device).schedule;w.document.body.append(page.el);await page.show();await settle();
 return {dom,w,calls,page,setFail:v=>{fail=v;},setToneSupport:v=>{toneSupport=v;}};
}
test('M1 alarm schedule defaults to 60 seconds, supports repeat/once/edit, and rejects invalid duration',async()=>{
 const x=await setup(),{w,page,calls}=x;try{
  const root=page.el,form=root.querySelector('form'),pick=()=>root.querySelector('[data-value="wake_alarm.start"]').click();
  pick();assert.equal(root.querySelector('[data-wake-duration]').value,'60');
  root.querySelector('input[type="time"]').value='07:30';form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.deepEqual(calls.findLast(x=>x.action==='schedules.put').params,{enabled:true,trigger:'weekly',action:'wake_alarm.start',params:{duration_seconds:60},days:127,minute:450});
  [...root.querySelectorAll('button')].find(b=>b.textContent==='Edit').click();root.querySelector('[data-wake-duration]').value=30;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.equal(calls.findLast(x=>x.action==='schedules.put').params.id,1);assert.equal(calls.findLast(x=>x.action==='schedules.put').params.params.duration_seconds,30);
  const count=calls.filter(x=>x.action==='schedules.put').length;
  for(const n of ['',0,181,1.5]){pick();root.querySelector('[data-wake-duration]').value=n;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();}
  assert.equal(calls.filter(x=>x.action==='schedules.put').length,count);
  pick();root.querySelector('[data-value="once"]').click();root.querySelector('input[type="datetime-local"]').value='2030-01-01T07:30';form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  const task=calls.findLast(x=>x.action==='schedules.put').params;assert.equal(task.trigger,'once');assert.equal(task.at,Date.parse('2030-01-01T07:30:00Z')/1000);assert.equal(task.params.duration_seconds,60);
  x.setFail(true);pick();root.querySelector('[data-wake-duration]').value=90;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();assert.equal(root.querySelector('[data-wake-duration]').value,'90');
 }finally{x.dom.window.close();}
});
test('one-time alarm uses device wall time independently of browser timezone and validates date range',async()=>{
 const now=Date.parse('2030-01-02T03:04:00Z');
 for(const timezone of [480,0,-330]){
  const x=await setup(true,{timezone,now}),{w,page,calls}=x;
  try{
   const root=page.el,form=root.querySelector('form');
   root.querySelector('[data-value="wake_alarm.start"]').click();root.querySelector('[data-value="once"]').click();
   const at=root.querySelector('input[type="datetime-local"]');
   const target=now+10*60000,local=new Date(target+timezone*60000).toISOString().slice(0,16);
   at.value=local;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
   let writes=calls.filter(c=>c.action==='schedules.put');
   assert.equal(writes.length,1,`future save: browser ${process.env.TZ}, device ${timezone}`);
   assert.equal(writes[0].params.at,target/1000,`UTC epoch: browser ${process.env.TZ}, device ${timezone}`);
   [...root.querySelectorAll('button')].find(b=>b.textContent==='Edit').click();
   assert.equal(at.value,local);form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
   writes=calls.filter(c=>c.action==='schedules.put');assert.equal(writes.length,2);assert.equal(writes[1].params.at,target/1000);
   for(const value of ['2039-01-01T12:00',new Date(now+timezone*60000-60000).toISOString().slice(0,16),'']){
    root.querySelector('[data-value="wake_alarm.start"]').click();root.querySelector('[data-value="once"]').click();at.value=value;
    form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
   }
   assert.equal(calls.filter(c=>c.action==='schedules.put').length,2,'invalid dates must not reach device');
  }finally{x.dom.window.close();}
 }
});
test('M1 alarm preview is bounded, stop remains reachable, older firmware hides controls',async()=>{
 const x=await setup(),{w,calls}=x;try{
  const get=id=>w.document.getElementById(id);assert.ok(get('wakeAlarmCard'));
  get('wakeAlarmPreview').click();await settle();assert.deepEqual(calls.findLast(x=>x.action==='wake_alarm.start').params,{duration_seconds:3});
  assert.equal(get('wakeAlarmPreview').disabled,true);assert.equal(get('wakeAlarmStop').disabled,false);assert.match(get('wakeAlarmState').textContent,/Ringing/);
  get('wakeAlarmStop').click();await settle();assert.equal(calls.at(-1).action,'wake_alarm.stop');assert.match(get('wakeAlarmState').textContent,/Not ringing/);
  w.UI.state={ota_active:true,pm25:5,formaldehyde:.01,temperature:20,humidity:50};w.UI.device.onStatus({...w.UI.state,sensor_fields:{},barometer:null});assert.equal(get('wakeAlarmPreview').disabled,true);assert.equal(get('wakeAlarmStop').disabled,false);
 }finally{x.dom.window.close();}
 const old=await setup(false);try{assert.equal(old.w.document.getElementById('wakeAlarmCard'),null);assert.equal(old.page.el.querySelector('[data-value="wake_alarm.start"]'),null);}finally{old.dom.window.close();}
});
test('MCU-gated tones support single preview, schedule persistence and capability loss',async()=>{
 const x=await setup(true,{toneSupport:true}),{w,page,calls}=x;
 try{
  const get=id=>w.document.getElementById(id);
  assert.equal(get('wakeAlarmToneField').hidden,false);
  get('wakeAlarmTone').value='3';get('wakeAlarmPreview').click();await settle();
  assert.deepEqual(calls.findLast(x=>x.action==='wake_alarm.start').params,{duration_seconds:1,tone:3});
  get('wakeAlarmStop').click();await settle();
  const root=page.el,form=root.querySelector('form');
  root.querySelector('[data-value="wake_alarm.start"]').click();
  root.querySelector('[data-wake-tone]').value='2';
  root.querySelector('input[type="time"]').value='07:30';
  root.querySelector('[data-wake-tone-field] button').click();await settle();
  assert.deepEqual(calls.findLast(x=>x.action==='wake_alarm.start').params,{duration_seconds:1,tone:2});
  get('wakeAlarmStop').click();await settle();
  form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.deepEqual(calls.findLast(x=>x.action==='schedules.put').params.params,{duration_seconds:60,tone:2});
  [...root.querySelectorAll('button')].find(b=>b.textContent==='Edit').click();
  assert.equal(root.querySelector('[data-wake-tone]').value,'2');
  x.setToneSupport(false);get('wakeAlarmStop').click();await settle();
  assert.equal(get('wakeAlarmToneField').hidden,true);
  assert.equal(root.querySelector('[data-wake-tone-field]').hidden,true);
  const before=calls.filter(x=>x.action==='schedules.put').length;
  form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();
  assert.equal(calls.filter(x=>x.action==='schedules.put').length,before,'retain unsupported saved tone rather than silently rewriting');
 }finally{x.dom.window.close();}
 const old=await setup();try{assert.equal(old.w.document.getElementById('wakeAlarmToneField').hidden,true);}finally{old.dom.window.close();}
});
