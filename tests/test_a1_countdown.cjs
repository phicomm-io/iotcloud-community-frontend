const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('A1 countdown creates a typed shutdown task, edits, cancels, restarts and rejects invalid duration',async()=>{
 const html=require('./render_page.cjs')('A1/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;w.HTMLElement.prototype.scrollIntoView=()=>{};
  const writes=[];let items=[];
  w.fetch=async(url,options)=>{const req=JSON.parse(options.body);writes.push(req);let data={};
   if(req.action==='schedules.put'){assert.equal(typeof req.params.enabled,'boolean');const x={...req.params,id:req.params.id||1,state:'waiting',remaining_seconds:req.params.seconds};items=[x];}
   if(req.action==='schedules.enable'){assert.equal(typeof req.params.enabled,'boolean');items[0].enabled=req.params.enabled;items[0].remaining_seconds=items[0].seconds;}
   if(req.action==='schedules.get')data={items,count:items.length,capacity:8,next:8};
   return {ok:true,json:async()=>({code:'ok',data})};};
 require('./legacy_device_fixture.cjs')(w);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;};w.UI.reload=async()=>w.UI.state;}vm.runInContext(source,dom.getInternalVMContext());});
  await flush();w.I18N.set('en');w.UI.state={time_synced:false};w.UI.caps={schedule_countdown:true,actions:['schedules.get','fan.set']};
  const page=w.automationPages({model:'A1',scheduleLead:'sch.lead_a1'}).schedule;
  w.document.body.append(page.el);await page.show();
  const root=page.el,form=root.querySelector('form'),pick=()=>root.querySelector('[data-value="countdown"]').click();
  const settle=async()=>{for(let i=0;i<6;i++)await flush();};
  pick();root.querySelector('[aria-label="Hours"]').value=1;root.querySelector('[aria-label="Minutes"]').value=15;
  form.querySelector('[type="submit"]').click();await settle();
  assert.deepEqual(writes.findLast(x=>x.action==='schedules.put').params,{enabled:true,trigger:'countdown',action:'fan.set',params:{on:false},seconds:4500});
  assert.match(root.querySelector('[data-countdown-id]').textContent,/01:15:00/);
  const button=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text);
  button('Cancel').click();await settle();assert.equal(items[0].enabled,false);
  button('Restart').click();await settle();assert.equal(items[0].enabled,true);
  button('Edit').click();assert.equal(root.querySelector('[aria-label="Hours"]').value,'1');
  root.querySelector('[aria-label="Minutes"]').value=5;form.querySelector('[type="submit"]').click();await settle();
  assert.equal(writes.findLast(x=>x.action==='schedules.put').params.id,1);assert.equal(items[0].seconds,3900);
  const count=writes.filter(x=>x.action==='schedules.put').length;
  for(const [h,m] of [[0,0],[24,1],[-1,5],[0,1.5]]){pick();root.querySelector('[aria-label="Hours"]').value=h;root.querySelector('[aria-label="Minutes"]').value=m;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await settle();}
  assert.equal(writes.filter(x=>x.action==='schedules.put').length,count);
  w.UI.caps.schedule_countdown=false;const old=w.automationPages({model:'A1'}).schedule;assert.equal(old.el.querySelector('[data-value="countdown"]'),null);
 }finally{dom.window.close();}
});
