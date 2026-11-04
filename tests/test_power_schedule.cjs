const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
async function setup(model,supported=true,unified=false){
 const html=require('./render_page.cjs')(model==='tc1'?'TC1/http_server/web/index.html':'S30/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;w.HTMLElement.prototype.scrollIntoView=()=>{};
 let tasks=[],fail=false;const calls=[],caps={model: model==='tc1'?model:'s30-v1b',outlet_count:model==='tc1'?6:1,actions:['outlet.set','indicator.set','child_lock.set','system.reboot','time.get','time.set','schedules.get','schedules.put'],...(supported?{schedule_triggers:model==='tc1'||unified?['weekly','once','power']:['power']}: {})};
 w.fetch=async(url,opt)=>{const q=JSON.parse(opt.body);calls.push(q);if(q.action==='schedules.put'&&!fail)tasks=[{...q.params,id:q.params.id||7,state:'waiting'}];return {ok:true,json:async()=>({code:fail?'storage_error':'ok',data:q.action==='schedules.get'?{items:tasks,next:8,capacity:8,count:tasks.length}:{}})};};
 require('./legacy_device_fixture.cjs')(w);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 scripts.forEach((s,i)=>{if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;w.UI.caps=caps;};w.UI.reload=async()=>w.UI.state;}vm.runInContext(s,dom.getInternalVMContext());});
 w.I18N.set('en');w.UI.state={time_synced:false,timezone_minutes:480};
 const page=w.automationPages(w.UI.device).schedule;w.document.body.append(page.el);await page.show();await settle();
 return {dom,w,page,calls,setFail:v=>{fail=v;}};
}
for(const model of ['tc1','s30'])test(model+' local power rules round-trip, retain drafts, reject invalid input and hide unsupported fields',async()=>{
 const x=await setup(model),{w,page,calls}=x;try{
  const r=page.el,form=r.querySelector('form'),pick=()=>r.querySelector('[data-value="power"]').click(),submit=async()=>{form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();};
  pick();const watts=r.querySelector('[data-power-watts]'),seconds=r.querySelector('[data-power-seconds]'),comparison=r.querySelector('[data-power-comparison]');
  assert.equal(watts.disabled,false);assert.equal(seconds.disabled,false);assert.equal(seconds.value,'600');
  const targets=r.querySelectorAll('[data-power-action] select');assert.equal(targets.length,model==='tc1'?2:1,'a single outlet has no unnecessary target picker');
  if(model==='tc1')targets[0].value='2';
  watts.value='5.123';seconds.value='600';await submit();
  assert.deepEqual(calls.findLast(q=>q.action==='schedules.put').params,{enabled:true,trigger:'power',action:'outlet.set',params:{...(model==='tc1'?{index:2}:{}),on:false},comparison:'below',power_milliwatts:5123,seconds:600});
  [...r.querySelectorAll('button')].find(b=>b.textContent==='Edit').click();
  assert.equal(watts.value,'5.123');assert.equal(comparison.value,'below');assert.equal(seconds.value,'600');
  comparison.value='above';seconds.value='0';watts.value='12';
  await page.show();assert.equal(watts.value,'12','background data refresh keeps unsaved fields');await submit();
  const edited=calls.findLast(q=>q.action==='schedules.put').params;assert.equal(edited.id,7);assert.equal(edited.seconds,0);assert.equal(edited.comparison,'above');
  let n=calls.filter(q=>q.action==='schedules.put').length;
  for(const [v,s] of [['','10'],['-1','10'],['25001','10'],['5',''],['5','-1'],['5','0.5'],['5','604801']]){pick();watts.value=v;seconds.value=s;await submit();}
  assert.equal(calls.filter(q=>q.action==='schedules.put').length,n);
  pick();watts.value='18.125';seconds.value='45';x.setFail(true);await submit();assert.equal(watts.value,'18.125');assert.equal(seconds.value,'45','storage failure keeps form contents');
  if(model==='s30')assert.equal(r.querySelector('.banner').hidden,true,'power-only rules need no wall-clock synchronization');
  else{r.querySelector('[data-value="weekly"]').click();assert.equal(watts.disabled,true);assert.equal(seconds.disabled,true);}
 }finally{x.dom.window.close();}
 const old=await setup(model,false);try{assert.equal(old.page.el.querySelector('[data-value="power"]'),null);assert.equal(old.page.el.querySelector('[data-power-watts]'),null);}finally{old.dom.window.close();}
});

for(const model of ['tc1','s30'])test(model+' advertises the same socket time/power editor with device-local time',async()=>{
 const x=await setup(model,true,true),{w,page,calls}=x;
 try{
  const r=page.el,form=r.querySelector('form'),submit=async()=>{form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();};
  for(const mode of ['weekly','once','power'])assert.ok(r.querySelector('[data-value="'+mode+'"]'));
  for(const action of ['outlet.set','indicator.set','child_lock.set','system.reboot'])assert.ok(r.querySelector('[data-value="'+action+'"]'));
  assert.equal(r.querySelector('.banner').hidden,false,'time rules show the unsynchronized-clock warning');
  r.querySelector('[data-value="weekly"]').click();r.querySelector('input[type=time]').value='08:35';
  await submit();let p=calls.findLast(q=>q.action==='schedules.put').params;
  assert.equal(p.trigger,'weekly');assert.equal(p.days,127);assert.equal(p.minute,515);assert.equal(p.action,'outlet.set');
  r.querySelector('[data-value="once"]').click();r.querySelector('input[type=datetime-local]').value='2030-01-07T12:34';[...r.querySelectorAll('[data-value="outlet.set"]')].find(b=>!b.closest('[hidden]')).click();
  await submit();p=calls.findLast(q=>q.action==='schedules.put').params;
  assert.equal(p.trigger,'once');assert.equal(p.at,Date.parse('2030-01-07T04:34:00Z')/1000);
  if(model==='s30'){
   const clock=w.UI.device.pages.clock;assert.ok(clock?.el);
   assert.ok(w.UI.device.groups.some(([,pages])=>pages.includes('clock')));
  }
 }finally{x.dom.window.close();}
});
