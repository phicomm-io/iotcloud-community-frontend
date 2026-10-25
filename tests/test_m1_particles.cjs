const {test}=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),vm=require('node:vm');
test('M1 particle card gates capability, preserves zero, expires and exposes raw diagnostics',async()=>{
 const html=require('./render_page.cjs')('M1/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  let now=100,timer,calls=0;
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;w.setInterval=fn=>{timer=fn;return 1;};
  Object.defineProperty(w.performance,'now',{value:()=>now});Object.defineProperty(w.document,'hidden',{value:false});
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{if(i===scripts.length-1)w.UI.start=dev=>{w.UI.device=dev;};vm.runInContext(source,dom.getInternalVMContext());});
  const card=w.document.getElementById('particleCard'),flush=()=>new Promise(setImmediate);
  let data={supported:true,available:true,fresh:true,healthy:true,age_ms:628,pm:{atmospheric_ug_m3:{pm1:13,pm25:19,pm10:19},cf1_ug_m3:{pm1:13,pm25:19,pm10:19},particles_per_0_1_l:{gt_0_3:2196,gt_0_5:639,gt_1_0:114,gt_2_5:0,gt_5_0:0,gt_10_0:0}},diagnostics:{sht_aux:{raw_hex:'039ce8ad8480'},hcho:{raw_hex:'ff86000f0000000c00'}}};
  w.command=async action=>{assert.equal(action,'sensor_details.get');calls++;return structuredClone(data);};
  w.UI.device.capabilities({actions:[]});timer();await flush();assert.equal(card.hidden,true);assert.equal(calls,0);
  w.UI.device.capabilities({actions:['sensor_details.get']});await flush();assert.equal(card.hidden,false);
  assert.deepEqual([...card.querySelectorAll('dd span')].map(e=>e.textContent),['13','19','2196','639','114','0','0','0','13','19']);
  assert(!card.textContent.includes('PM2.5'));assert.match(card.textContent,/039ce8ad8480/);
  now+=5372;w.command=async()=>{throw Error('offline');};timer();
  assert([...card.querySelectorAll('dd span')].every(e=>e.textContent==='—'));await flush();
  for(const patch of [{available:false},{fresh:false},{healthy:false},{age_ms:null},{age_ms:-1},{supported:false}]){
   now+=2001;w.command=async()=>({...structuredClone(data),...patch});timer();await flush();
   assert([...card.querySelectorAll('dd span')].every(e=>e.textContent==='—'));
  }
  assert.equal(card.hidden,true);
  now+=2001;w.command=async()=>structuredClone(data);timer();await flush();assert.equal(card.hidden,false);
  now+=6000;w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));
  assert([...card.querySelectorAll('dd span')].every(e=>e.textContent==='—'));
 }finally{w.close();}
});
