const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('A1 mode controls, idle state, automatic cap and manual speed remain distinct',async()=>{
 const html=require('./render_page.cjs')('A1/web/index.html');
 const dom=new JSDOM(html,{pretendToBeVisual:true,runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
  const writes=[];
  w.fetch=async(url,options)=>{const req=JSON.parse(options.body);writes.push(req);return {ok:true,json:async()=>({code:'ok',data:{linkage_status:'disabled',effect:0}})};};
 require('./legacy_device_fixture.cjs')(w);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;};w.UI.reload=async()=>w.UI.acceptStatus({...w.UI.state});}vm.runInContext(source,dom.getInternalVMContext());});
  await flush();w.I18N.set('en');
  w.UI.caps={actions:['fan.mode.set']};
  w.UI.state={red:0,green:0,blue:255,brightness:255,requested_speed:64,percentage:0,applied_speed:0,fan_on:true,fan_mode:'auto',fan_state:'idle',auto_max_speed:45,panel_ready:true};
  const render=()=>w.UI.device.onStatus(w.UI.state),d=w.document;
  render();assert.equal(d.getElementById('fanMode').hidden,false);
  assert.equal(d.getElementById('fanState').textContent,'Idle');
  assert.equal(d.getElementById('speed').value,'45');
  assert.equal(d.getElementById('speedLabel').textContent,'Maximum speed');
  d.getElementById('speed').value=37;d.getElementById('speed').dispatchEvent(new w.Event('change'));
  for(let i=0;i<3;i++)await flush();
  const speed=writes.findLast(r=>r.action==='fan.set');assert.equal(speed.params.speed,37);assert.equal(speed.params.mode,undefined);
  d.querySelector('#fanMode button').click();for(let i=0;i<3;i++)await flush();
  assert.equal(writes.findLast(r=>r.action==='fan.mode.set').params.mode,'manual');
  Object.assign(w.UI.state,{fan_mode:'manual',fan_state:'running',percentage:64});render();
  assert.equal(d.getElementById('speed').value,'64');
  w.UI.state.fan_on=false;w.UI.state.fan_state='off';render();
  d.querySelectorAll('#fanMode button')[1].click();for(let i=0;i<3;i++)await flush();
  const mode=writes.findLast(r=>r.action==='fan.mode.set');assert.equal(mode.params.mode,'auto');assert.equal(mode.params.on,undefined);
  w.UI.state.ota_active=true;render();assert.equal(d.querySelector('#fanMode button').disabled,true);
  w.UI.caps={actions:[]};render();assert.equal(d.getElementById('fanMode').hidden,true);
 }finally{dom.window.close();}
});
test('A1 hysteresis settings validate and save through the shared local/platform UI',async()=>{
 const html=require('./render_page.cjs')('A1/web/index.html');
 const dom=new JSDOM(html,{pretendToBeVisual:true,runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
  const writes=[],config={revision:10,enabled:1,mode:2,metrics:3,hysteresis_enabled:0,target_pm:35,on_pm:50,target_hcho:.08,on_hcho:.1,min_speed:20,max_speed:80,fallback_speed:30,statistic:0,debounce_seconds:15,min_switch_seconds:60,kp:20,ki:.02,kd:0};
  w.fetch=async(url,options)=>{const req=JSON.parse(options.body);writes.push(req);let data={};if(req.action==='binding.status.get')data={average:{valid:true,fields:{pm25:true,formaldehyde:true}}};if(req.action==='linkage.get')data={...config};if(req.action==='linkage.set'){assert.equal(req.params.revision,config.revision,'save must use latest acknowledged revision');config.revision++;data={revision:config.revision};}return {ok:true,json:async()=>({code:'ok',data})};};
 require('./legacy_device_fixture.cjs')(w);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;w.UI.pages=dev.pages;};w.UI.reload=async()=>w.UI.state;}vm.runInContext(source,dom.getInternalVMContext());});
  w.I18N.set('en');w.UI.caps={actions:['fan.mode.set']};
  await w.UI.pages.linkage.show();
  const page=w.document.querySelector('[data-settings-page="linkage"]');
  const label=text=>[...page.querySelectorAll('label')].find(el=>el.textContent.includes(text));
  const toggle=label('Enable start/idle hysteresis').querySelector('input');
  toggle.checked=true;toggle.dispatchEvent(new w.Event('change'));
  assert.equal(page.textContent.split('PM2.5 target / idle at').length-1,1,'PID shares the outer target');
  const change=(title,value)=>{const el=label(title).querySelector('input');el.value=value;el.dispatchEvent(new w.Event('input'));};
  change('PM2.5 start threshold',60);change('PM2.5 target / idle at',30);
  page.querySelector('.form-actions button').click();for(let i=0;i<4;i++)await flush();
  const saved=writes.findLast(r=>r.action==='linkage.set');
  assert.equal(saved.params.hysteresis_enabled,1);assert.equal(saved.params.on_pm,60);assert.equal(saved.params.target_pm,30);
  change('PM2.5 start threshold',50);change('PM2.5 target / idle at',35);
  page.querySelector('.form-actions button').click();for(let i=0;i<4;i++)await flush();
  assert.equal(writes.findLast(r=>r.action==='linkage.set').params.revision,11);
  assert.equal(writes.findLast(r=>r.action==='linkage.set').params.target_pm,35);
  const count=writes.filter(r=>r.action==='linkage.set').length;
  change('Formaldehyde start threshold',.07);page.querySelector('.form-actions button').click();for(let i=0;i<3;i++)await flush();
  assert.equal(writes.filter(r=>r.action==='linkage.set').length,count,'invalid thresholds never sent');
  delete config.hysteresis_enabled;await w.UI.pages.linkage.show();
  assert.equal(page.textContent.includes('Enable start/idle hysteresis'),false,'older firmware stays supported');
 }finally{dom.window.close();}
});
test('A1 optional CO2 choices, thresholds and absent/stale capability',async()=>{
 const html=require('./render_page.cjs')('A1/web/index.html');
 const dom=new JSDOM(html,{pretendToBeVisual:true,runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
  const writes=[],config={revision:1,enabled:1,mode:1,metrics:1,hysteresis_enabled:1,target_co2:1000,on_co2:1500,low_co2:800,high_co2:2000,min_speed:0,max_speed:80,fallback_speed:23};
  let supported=false;
  w.fetch=async(url,options)=>{const req=JSON.parse(options.body);writes.push(req);let data={};if(req.action==='linkage.get')data={...config};if(req.action==='binding.status.get')data={average:{valid:true,co2_valid:supported,fields:{pm25:true,formaldehyde:false,co2:supported}}};if(req.action==='linkage.set')data={revision:++config.revision};return {ok:true,json:async()=>({code:'ok',data})};};
 require('./legacy_device_fixture.cjs')(w);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;w.UI.pages=dev.pages;};w.UI.reload=async()=>w.UI.state;}vm.runInContext(source,dom.getInternalVMContext());});
  w.I18N.set('en');w.UI.caps={actions:['fan.mode.set']};
  const page=w.document.querySelector('[data-settings-page="linkage"]');
  const co2Button=()=>[...page.querySelectorAll('label')].find(b=>b.textContent==='CO₂')?.querySelector('input');
  await w.UI.pages.linkage.show();assert.equal(co2Button(),undefined);
  supported=true;await w.UI.pages.linkage.show();assert.ok(co2Button());co2Button().click();[...page.querySelectorAll('label')].find(b=>b.textContent==='PM2.5').querySelector('input').click();
  assert.ok(page.textContent.includes('CO₂ at minimum speed'));assert.ok(page.textContent.includes('CO₂ start threshold'));
  const label=text=>[...page.querySelectorAll('label')].find(el=>el.textContent.includes(text));
  const change=(title,value)=>{const el=label(title).querySelector('input');el.value=value;el.dispatchEvent(new w.Event('input'));};
  change('CO₂ start threshold',1600);page.querySelector('.form-actions button').click();for(let i=0;i<4;i++)await flush();
  assert.equal(writes.findLast(r=>r.action==='linkage.set').params.metrics,4);
  assert.equal(writes.findLast(r=>r.action==='linkage.set').params.on_co2,1600);
  const count=writes.filter(r=>r.action==='linkage.set').length;
  change('CO₂ start threshold',900);page.querySelector('.form-actions button').click();for(let i=0;i<3;i++)await flush();
  assert.equal(writes.filter(r=>r.action==='linkage.set').length,count);
  supported=false;config.metrics=4;await w.UI.pages.linkage.show();assert.equal(co2Button(),undefined,'missing measurement hides choices while retaining saved rules');assert.equal(config.metrics,4);
  delete config.target_co2;config.metrics=1;await w.UI.pages.linkage.show();assert.equal(co2Button(),undefined,'older A1 firmware hides CO2');
 }finally{dom.window.close();}
});
