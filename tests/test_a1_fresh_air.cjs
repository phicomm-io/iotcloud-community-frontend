const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Fresh air capability, mapping preview, revisions and independent automatic settings',async()=>{
 const html=require('./render_page.cjs')('A1/web/index.html');
 const dom=new JSDOM(html,{pretendToBeVisual:true,runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
  const writes=[];
  const mapping={pulses_per_rev:2,revision:1,on:false,speed:60,mode:'manual',coupling:0,cap_ratio:100,boost_ratio:100,active_low:false,a:1,b:0,pwm_min:0,pwm_max:100};
  const policy={revision:1,enabled:1,metrics:4,mode:1,statistic:0,min_speed:20,max_speed:100,fallback_speed:30,low_co2:800,high_co2:2000,target_co2:1000,on_co2:1500};
  w.fetch=async(url,options)=>{const r=JSON.parse(options.body);writes.push(r);let data={linkage_status:'disabled',effect:0};
   if(r.action==='fresh_air.config.get')data={...mapping};
   if(r.action==='fresh_air.config.set'){assert.equal(r.params.revision,mapping.revision);Object.assign(mapping,r.params);mapping.revision++;data={...mapping};}
   if(r.action==='fresh_air.linkage.get')data={...policy};
   if(r.action==='fresh_air.linkage.set'){assert.equal(r.params.revision,policy.revision);Object.assign(policy,r.params);policy.revision++;data={...policy};}
   return {ok:true,json:async()=>({code:'ok',data})};};
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;w.UI.pages=dev.pages;};w.UI.reload=async()=>w.UI.state;}vm.runInContext(source,dom.getInternalVMContext());});
  await flush();w.I18N.set('en');const dev=w.UI.device;
  dev.capabilities({actions:[]});assert.equal(dev.pages.freshair,undefined);
  w.UI.caps={fresh_air:true,actions:['fan.mode.set']};dev.capabilities(w.UI.caps);
  for(const key of ['freshair','freshauto']){const box=w.document.createElement('div');box.dataset.settingsPage=key;w.document.body.append(box);}
  await dev.pages.freshair.show();let page=w.document.querySelector('[data-settings-page="freshair"]');
  assert.match(page.textContent,/25% → 25.0%/);
  [...page.querySelectorAll('button')].find(b=>b.textContent.includes('Active-low preset')).click();
  assert.match(page.textContent,/0% → 100.0%/);assert.match(page.textContent,/25% → 75.0%/);
  const edit=(label,value)=>{const input=[...page.querySelectorAll('label')].find(l=>l.textContent.includes(label)).querySelector('input');input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  edit('Feedback pulses per revolution',4);edit('Slope a',-.5);edit('Maximum high duty',80);
  page.querySelector('.form-actions button').click();for(let i=0;i<4;i++)await flush();
  const saved=writes.findLast(r=>r.action==='fresh_air.config.set');assert.equal(saved.params.pulses_per_rev,4);assert.equal(saved.params.a,-.5);assert.equal(saved.params.pwm_max,80);assert.equal(saved.params.active_low,true);assert.equal(saved.params.on,undefined);
  edit('Offset b',90);page.querySelector('.form-actions button').click();for(let i=0;i<4;i++)await flush();assert.equal(mapping.revision,3);
  const n=writes.length;edit('Minimum high duty',90);page.querySelector('.form-actions button').click();for(let i=0;i<4;i++)await flush();assert.equal(writes.length,n);
  await dev.pages.freshauto.show();page=w.document.querySelector('[data-settings-page="freshauto"]');assert.match(page.textContent,/CO₂/);
  page.querySelector('.form-actions button').click();for(let i=0;i<4;i++)await flush();assert.ok(writes.some(r=>r.action==='fresh_air.linkage.set'));assert.ok(!writes.some(r=>r.action==='linkage.set'));
  w.UI.state={red:0,green:0,blue:255,brightness:255,requested_speed:60,percentage:0,applied_speed:0,fan_on:false,fan_mode:'manual',panel_ready:true,fresh_air_mode:'manual',fresh_air_requested_speed:60,fresh_air_requested_on:true,fresh_air_target:60,fresh_air_speed:0,fresh_air_pwm_milli:100000,fresh_air_rpm:0,fresh_air_limit_reason:1};
  dev.onStatus(w.UI.state);assert.match(w.document.getElementById('freshAirCard').textContent,/Primary power is off/);
  const calls=[];w.UI.control=async(a,p,patch)=>calls.push({a,p,patch});
  const toggle=w.document.querySelector('#freshAirCard input[type="checkbox"]');toggle.checked=false;toggle.dispatchEvent(new w.Event('change'));await flush();assert.equal(calls[0].a,'fresh_air.set');assert.equal(calls[0].patch.fresh_air_requested_on,false);
 }finally{dom.window.close();}
});
