const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
const codec=process.env.SCREEN_SCENE_CODEC;
function fixture({appearanceEnabled=false,capabilities=appearanceEnabled?8189:0}={}){
 const html=require('./render_page.cjs')('DAIKIN/web/index.html'),dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local/#settings/device'}),w=dom.window;
 w.HTMLCanvasElement.prototype.getContext=()=>({font:'',measureText(text){return {width:text.length*parseFloat(this.font)*.64};}});w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.scrollTo=()=>{};w.setTimeout=()=>0;w.setInterval=()=>0;require('./legacy_device_fixture.cjs')(w);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);scripts.forEach((s,i)=>{if(i===scripts.length-1)w.UI.start=dev=>w.UI.device=dev;vm.runInContext(s,dom.getInternalVMContext());});
 w.I18N.set('en');w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{extension_supported:true,layout_revision:1,mcu_layout_revision:0,capabilities}});
 let current=codec?cp.execFileSync(codec,['default']):Buffer.from(w.ScreenLayout.encode({revision:1,pages:[{enabled:true,title:'Room'}],items:[{id:1,page:0,type:1,binding:6,x:0,y:0,w:2,h:2,source:1,title:'CO2',unit:'ppm'}]}));
 const writes=[];let staged,meta;let ap=w.ScreenAppearance.defaults(),rejectAppearance=false;
 const brightness={settings:{display:{luminance:60,data_type:1,power_screen_time:2,battery_screen_time:1}},saved_settings:{},snapshot_age_ms:0,request:{token:'',code:-1,state:'idle'},brightness:{available:true,supported:true,requested_percent:60,ceiling_percent:10,applied_percent:10,asleep:false}};
 let rejectBrightness=false;let policy={supported:true,revision:1,applied_revision:1,max_plans:8,ceiling:40,external_minutes:2,battery_minutes:1,idle_brightness:0,idle_page:255,plans:[]};
 w.command=async(action,params={})=>{
  writes.push({action,params:JSON.parse(JSON.stringify(params))});
  if(action==='screen.appearance.get')return {supported:true,revision:ap.revision,applied_revision:ap.revision,bytes:Buffer.from(w.ScreenAppearance.encode(ap)).toString('base64')};
  if(action==='screen.appearance.set'){if(rejectAppearance)throw Error('storage_error');const candidate=w.ScreenAppearance.decode(Buffer.from(params.bytes,'base64'));assert(candidate.revision>ap.revision);ap=candidate;return {revision:ap.revision};}
  if(action==='screen.display.get')return JSON.parse(JSON.stringify(policy));
  if(action==='screen.display.set'){policy={...policy,...params,revision:policy.revision+1};return {...policy};}
  if(action==='screen.settings.get')return JSON.parse(JSON.stringify(brightness));
  if(action==='screen.settings.set'){
   const token='brightness-test';brightness.request={token,code:rejectBrightness?1:0,state:rejectBrightness?'rejected':'confirmed'};
   if(!rejectBrightness){brightness.settings.display={...params.display};Object.assign(brightness.brightness,{requested_percent:params.display.luminance,applied_percent:Math.min(10,params.display.luminance)});}
   return {token};
  }
  if(action==='screen.layout.get')return {revision:current.readUInt32LE(4),offset:params.offset,total:current.length,crc:w.ScreenLayout.crc(current),bytes:current.subarray(params.offset,params.offset+params.limit).toString('base64')};
  if(action==='screen.layout.begin'){meta=params;staged=Buffer.alloc(params.total);return {};}
  if(action==='screen.layout.chunk'){Buffer.from(params.bytes,'base64').copy(staged,params.offset);return {};}
  if(action==='screen.layout.commit'){assert.equal(w.ScreenLayout.crc(staged),meta.crc);current=staged;return {revision:meta.revision};}
  if(action==='screen.reminders.get')return {timezone:480,wake:2,rules:[],notices:[]};
  if(action==='screen.weather.get')return {config:{provider:'qweather',host:'test.qweatherapi.com',enabled:true,key_set:true,latitude:31.2,longitude:121.4,label:'Shanghai',interval:900}};
  return {};
 };
 return {dom,w,writes,brightness,appearance:()=>ap,rejectAppearance:()=>rejectAppearance=true,rejectBrightness:()=>rejectBrightness=true,current:()=>current,flush:()=>new Promise(setImmediate),click:key=>w.document.querySelector(key).click()};
}
test('brightness reports the actual ceiling, preserves drafts and changes only luminance after a fresh read',async()=>{
 const {dom,w,writes,brightness,flush,click}=fixture();try{
  const d=w.document,slider=d.querySelector('#screenBrightness');assert.equal(slider.disabled,true);
  await w.ScreenUI.loadBrightness();assert.equal(slider.value,'60');assert.match(d.querySelector('#screenBrightnessReadback').textContent,/10%/);assert.match(d.querySelector('#screenBrightnessLimit').textContent,/10%/);
  slider.value='5';slider.dispatchEvent(new w.Event('input'));
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{settings:brightness.settings,brightness:brightness.brightness}});w.I18N.set('zh-CN');assert.equal(slider.value,'5');
  Object.assign(brightness.settings.display,{data_type:0,power_screen_time:1,battery_screen_time:2});
  click('#screenBrightnessSave');await flush();assert.deepEqual(writes.find(x=>x.action==='screen.settings.set').params,{display:{luminance:5,data_type:0,power_screen_time:1,battery_screen_time:2}});
  assert.equal(writes.filter(x=>x.action==='screen.settings.set').length,1);
  assert.match(d.querySelector('#screenBrightnessState').textContent,/确认/);assert.equal(slider.disabled,false);
  slider.value='0';slider.dispatchEvent(new w.Event('input'));click('#screenBrightnessSave');await flush();assert.equal(brightness.settings.display.luminance,0);assert.equal(brightness.brightness.applied_percent,0);assert.equal(slider.value,'0');
  assert.equal(writes.filter(x=>x.action==='screen.settings.set').length,2);
 }finally{dom.window.close();}
});
test('brightness never claims confirmation on rejection or invents stale PWM readings',async()=>{
 const {dom,w,brightness,rejectBrightness,flush,click}=fixture();try{
  const d=w.document;await w.ScreenUI.loadBrightness();rejectBrightness();d.querySelector('#screenBrightness').value='3';d.querySelector('#screenBrightness').dispatchEvent(new w.Event('input'));click('#screenBrightnessSave');await flush();
  assert.match(d.querySelector('#screenBrightnessState').textContent,/not been confirmed/i);assert.equal(brightness.settings.display.luminance,60);assert.equal(d.querySelector('#screenBrightness').value,'3');
  brightness.brightness={available:false,supported:true,requested_percent:null,ceiling_percent:null,applied_percent:null,asleep:null};await w.ScreenUI.loadBrightness();assert.match(d.querySelector('#screenBrightnessReadback').textContent,/No fresh brightness report/i);assert.equal(d.querySelector('#screenBrightnessLimit').textContent,'');
  delete brightness.settings.display;await w.ScreenUI.loadBrightness();assert.equal(d.querySelector('#screenBrightnessSave').disabled,true);
 }finally{dom.window.close();}
});
test('brightness reload blocks edits until the received setting is installed',async()=>{
 const {dom,w}=fixture();try{
  await w.ScreenUI.loadBrightness();const command=w.command;let resolve;
  w.command=()=>new Promise(r=>resolve=r);const loading=w.ScreenUI.loadBrightness();
  assert.equal(w.document.querySelector('#screenBrightness').disabled,true);assert.equal(w.document.querySelector('#screenBrightnessSave').disabled,true);
  resolve(await command('screen.settings.get'));await loading;assert.equal(w.document.querySelector('#screenBrightness').disabled,false);assert.equal(w.document.querySelector('#screenBrightness').value,'60');
 }finally{dom.window.close();}
});
test('screen layout uses the actual MCU SCN3 ABI and preserves edits after save',async()=>{
 const {dom,w,writes,current,flush,click}=fixture();try{
  await w.ScreenUI.load();const d=w.document;click('#screenEdit');assert.equal(d.querySelector('#screenEditor').hidden,false);
  const original=Buffer.from(current());assert.deepEqual(Buffer.from(w.ScreenLayout.encode(w.ScreenLayout.decode(original))),original);
  d.querySelector('[data-component]').click();let title=d.querySelector('[data-component-field="title"]');title.value='室内空气';title.dispatchEvent(new w.Event('change'));
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{extension_supported:true,layout_revision:1,mcu_layout_revision:0}});assert.match(d.querySelector('#screenDraft').textContent,/Draft|browser/);
  click('#screenSave');await flush();assert.equal(current().readUInt32LE(4),2);assert.equal(writes.filter(x=>x.action==='screen.layout.chunk').length,Math.ceil(current().length/512));
  assert.equal(w.ScreenLayout.decode(current()).items[0].title,'室内空气');
  let unit=d.querySelector('[data-component-field="unit"]');unit.value='API';unit.dispatchEvent(new w.Event('change'));click('#screenSave');await flush();assert.equal(w.ScreenLayout.decode(current()).items[0].unit,'API');assert.equal(current().readUInt32LE(4),3);
  if(codec){const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'screen-abi-'));try{const p=path.join(tmp,'scene.bin');fs.writeFileSync(p,current());assert.equal(cp.execFileSync(codec,[p],{encoding:'utf8'}).trim(),`3 ${w.ScreenLayout.crc(current())}`);}finally{fs.rmSync(tmp,{recursive:true});}}
  assert.equal(d.querySelector('#screenSync').textContent.includes('undefined'),false);
 }finally{dom.window.close();}
});
test('TVOC number and grade persist per component and require the negotiated capability',async()=>{
 const {dom,w,current,flush,click}=fixture();try{
  await w.ScreenUI.load();const d=w.document;
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{capabilities:253,extension_supported:true,layout_revision:1,mcu_layout_revision:1}});
  click('#screenEdit');d.querySelector('#screenPage').value='1';d.querySelector('#screenPage').dispatchEvent(new w.Event('change'));click('[data-component="10"]');
  const choose=mode=>{const el=d.querySelector('[data-component-field="value_mode"]');el.value=String(mode);el.dispatchEvent(new w.Event('change'));};
  choose(1);assert.match(d.querySelector('[data-component="10"]').textContent,/ppb.*375/);click('#screenSave');await flush();
  const saved=w.ScreenLayout.decode(current());assert.equal(saved.items.find(it=>it.id===10).value_mode,1);
  if(codec){const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'screen-value-mode-'));try{const p=path.join(tmp,'scene.bin');fs.writeFileSync(p,current());cp.execFileSync(codec,[p]);}finally{fs.rmSync(tmp,{recursive:true});}}
  choose(2);assert.match(d.querySelector('[data-component="10"]').textContent,/优/);assert.doesNotMatch(d.querySelector('[data-component="10"]').textContent,/ppb/);
  const bytes=w.ScreenLayout.encode({...saved,revision:3});assert.equal(w.ScreenLayout.decode(bytes).items.find(it=>it.id===10).value_mode,1);
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{capabilities:125,extension_supported:true}});click('[data-component="10"]');assert.equal(d.querySelector('[data-component-field="value_mode"]').disabled,true);
 }finally{dom.window.close();}
});
test('one-row readouts and 4x2 charts round-trip with the MCU and require responsive capability',async()=>{
 const {dom,w,writes,current,flush,click}=fixture();try{
  await w.ScreenUI.load();w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{capabilities:509,extension_supported:true}});
  const d=w.document;click('#screenEdit');click('#screenAddPage');
  d.querySelector('#screenAddType').value='1';click('#screenAddItem');d.querySelector('[data-component]').click();
  const field=(k,v)=>{const el=d.querySelector(`[data-component-field="${k}"]`);el.value=String(v);el.dispatchEvent(new w.Event('change'));};
  field('w',4);field('h',1);assert.equal(d.querySelector('[data-value-layout]').dataset.valueLayout,'row');
  click('#screenSave');await flush();let s=w.ScreenLayout.decode(current());assert.equal(s.items.at(-1).h,1);
  d.querySelector('#screenAddType').value='3';click('#screenAddItem');
  const tiles=d.querySelectorAll('[data-component]');tiles[tiles.length-1].click();
  field('chart',5);assert.equal(d.querySelector('[data-chart-layout]').dataset.chartLayout,'strip');
  click('#screenSave');await flush();s=w.ScreenLayout.decode(current());assert.equal(s.items.at(-1).w,4);assert.equal(s.items.at(-1).h,2);assert.equal(s.items.at(-1).chart,5);
  if(codec){const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'screen-responsive-'));try{const p=path.join(tmp,'scene.bin');fs.writeFileSync(p,current());cp.execFileSync(codec,[p]);}finally{fs.rmSync(tmp,{recursive:true});}}
  const before=writes.filter(x=>x.action==='screen.layout.begin').length;
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{capabilities:253,extension_supported:true}});click('#screenSave');await flush();
  assert.equal(writes.filter(x=>x.action==='screen.layout.begin').length,before);
  const it=s.items.at(-1);it.h=1;assert.throws(()=>w.ScreenLayout.encode(s));
 }finally{dom.window.close();}
});
test('compact weather, clock and readings round-trip only with the negotiated MCU capability',async()=>{
 const {dom,w,writes,current,flush,click}=fixture({capabilities:2097152|509});try{
  await w.ScreenUI.load();w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{capabilities:2097152|509,extension_supported:true}});const d=w.document;click('#screenEdit');click('#screenAddPage');
  const field=(k,v)=>{const el=d.querySelector(`[data-component-field="${k}"]`);el.value=String(v);el.dispatchEvent(new w.Event('change'));};
  const add=async(type,width,height)=>{d.querySelector('#screenAddType').value=String(type);click('#screenAddItem');await flush();[...d.querySelectorAll('[data-component]')].at(-1).click();field('w',width);field('h',height);};
  await add(0,4,1);assert.equal(d.querySelector('[data-compact-layout]').dataset.compactLayout,'clock-row');
  await add(6,4,1);assert.equal(d.querySelector('[data-compact-layout="weather-row"]')!==null,true);
  await add(6,4,2);assert.equal(d.querySelector('[data-compact-layout="weather-wide"]')!==null,true);
  await add(1,2,1);assert.equal(d.querySelector('[data-component-field="h"]').min,'1');
  assert.equal([...d.querySelectorAll('[data-value-layout]')].at(-1).dataset.valueLayout,'row');
  click('#screenSave');await flush();const saved=w.ScreenLayout.decode(current());
  assert.deepEqual(JSON.parse(JSON.stringify(saved.items.filter(it=>it.page===saved.pages.length-1).map(it=>[it.type,it.w,it.h]))),[[0,4,1],[6,4,1],[6,4,2],[1,2,1]]);
  if(codec){const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'screen-compact-'));try{const p=path.join(tmp,'scene.bin');fs.writeFileSync(p,current());cp.execFileSync(codec,[p]);}finally{fs.rmSync(tmp,{recursive:true});}}
  const before=writes.filter(x=>x.action==='screen.layout.begin').length;
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{capabilities:509,extension_supported:true}});click('#screenSave');await flush();
  assert.equal(writes.filter(x=>x.action==='screen.layout.begin').length,before);
  assert.equal(d.querySelector('[data-component-field="h"]').min,'2');
 }finally{dom.window.close();}
});
test('screen rejects overlapping and invalid UTF-8 sized layouts; load respects cancellation',async()=>{
 const {dom,w,writes,current,flush,click}=fixture();try{
  await w.ScreenUI.load();const scene=w.ScreenLayout.decode(current());
  scene.items.push({...scene.items[0],id:123});assert.throws(()=>w.ScreenLayout.encode(scene));scene.items.pop();scene.pages[0].title='中'.repeat(11);assert.throws(()=>w.ScreenLayout.encode(scene));
  const title=w.document.querySelector('#screenPageTitle');title.value='Draft';title.dispatchEvent(new w.Event('change'));const before=writes.length;w.UI.confirm=async opts=>{assert.ok(opts.body);return false;};click('#screenLoad');await flush();assert.equal(writes.length,before);assert.equal(title.value,'Draft');
  w.ScreenUI.status({hardware_model:'BRY88AX151K'});assert.equal(w.document.querySelector('#screenEditor').hidden,true);
 }finally{dom.window.close();}
});
test('reminders configure wake policy, weekly weekdays, API notices and timezone',async()=>{
 const {dom,w,writes,flush}=fixture();try{
  const d=w.document,buttons=[...d.querySelectorAll('#screenReminders button')];buttons.find(b=>b.dataset.i18n==='screen.load').click();await flush();assert.equal(d.querySelector('#screenDefaultWake').value,'2');
  d.querySelector('#screenReminderKind').value='2';d.querySelector('#screenReminderTitle').value='Ventilate';d.querySelector('#screenReminderText').value='Open a window';d.querySelector('#screenReminderAt').value='09:30';d.querySelector('#screenRuleEnabled').checked=false;
  buttons.find(b=>b.dataset.i18n==='common.save').click();await flush();const request=writes.find(r=>r.action==='screen.reminders.set');assert.equal(request.params.minute,570);assert.equal(request.params.days,31);assert.equal(request.params.kind,2);assert.equal(request.params.enabled,false);assert.equal(request.params.epoch,0);
  buttons.find(b=>b.dataset.i18n==='screen.save_timezone').click();await flush();assert.equal(writes.find(r=>r.action==='screen.reminders.configure').params.wake,2);
  buttons.find(b=>b.dataset.i18n==='screen.push').click();await flush();assert.equal(writes.find(r=>r.action==='screen.reminders.push').params.title,'Ventilate');
 }finally{dom.window.close();}
});
test('weather editor keeps saved API keys private and supports four providers',async()=>{
 const {dom,w,writes,flush}=fixture();try{
  const d=w.document,buttons=[...d.querySelectorAll('#screenWeather button')];buttons.find(b=>b.dataset.i18n==='screen.load').click();await flush();
  assert.equal(d.querySelector('#screenWeatherKey').value,'');assert.match(d.querySelector('#screenWeatherKey').placeholder,/saved/i);assert.equal(d.querySelector('#screenWeatherProvider').options.length,4);
  buttons.find(b=>b.dataset.i18n==='common.save').click();await flush();const saved=writes.find(r=>r.action==='screen.weather.set').params;assert.equal('key' in saved,false);assert.equal(saved.latitude,31.2);assert.equal(saved.clear_key,false);
  w.I18N.set('zh-CN');assert.match(d.querySelector('#screenWeather').textContent,/天气/);assert.ok(d.querySelector('#screenWeatherKey').placeholder.length);
 }finally{dom.window.close();}
});
test('Open-Meteo hides credential fields and saves coordinates without a stale key or host',async()=>{
 const {dom,w,writes,flush}=fixture();try{
  const d=w.document,buttons=[...d.querySelectorAll('#screenWeather button')];buttons.find(b=>b.dataset.i18n==='screen.load').click();await flush();
  const provider=d.querySelector('#screenWeatherProvider'),key=d.querySelector('#screenWeatherKey');key.value='previous-private-key';
  provider.value='openmeteo';provider.dispatchEvent(new w.Event('change'));
  assert.equal(key.closest('label').hidden,true);assert.equal(key.disabled,true);
  assert.equal(d.querySelector('#screenWeatherHost').closest('label').hidden,true);
  d.querySelector('#screenWeatherLat').value='23.1291';d.querySelector('#screenWeatherLon').value='113.2644';d.querySelector('#screenWeatherPlace').value='Guangzhou, Guangdong';
  buttons.find(b=>b.dataset.i18n==='common.save').click();await flush();const saved=writes.find(r=>r.action==='screen.weather.set').params;
  assert.equal(saved.provider,'openmeteo');assert.equal(saved.latitude,23.1291);assert.equal(saved.longitude,113.2644);assert.equal(saved.clear_key,true);assert.equal('key' in saved,false);assert.equal('host' in saved,false);
 }finally{dom.window.close();}
});

test('composed pages support geometry, undo, browser persistence and separate sleep references',async()=>{
 const {dom,w,writes,flush,click}=fixture();try{
  await w.ScreenUI.load();await w.ScreenUI.loadPolicy();const d=w.document;
  click('#screenAddPage');click('#screenAddItem');const tile=d.querySelector('[data-component]');assert.ok(tile);tile.click();
  const height=d.querySelector('[data-component-field="h"]');height.value='4';height.dispatchEvent(new w.Event('change'));
  assert.ok(d.querySelector('.screen-widget-clock'));click('#screenUndo');assert.equal(d.querySelector('[data-component-field="h"]'),null);
  d.querySelector('[data-component]').click();assert.equal(d.querySelector('[data-component-field="h"]').value,'2');
  click('#screenSave');await flush();
  const dest=d.querySelector('#screenPolicy_idle_page');dest.value=String(d.querySelector('#screenPage').value);dest.dispatchEvent(new w.Event('change'));
  click('#screenDeletePage');assert.equal(dest.value,'255');click('#screenUndo');assert.equal(dest.value,'255','Undo must not restore deleted sleep references');
  click('#screenSave');await flush();click('#screenPolicySave');await flush();assert.equal(writes.find(x=>x.action==='screen.display.set').params.idle_page,255);
  assert.ok(w.localStorage.getItem('iotcloud.screen.layout.v3.device.local'));
  const prior=writes.filter(x=>x.action==='screen.layout.begin').length;await w.ScreenUI.load();assert.equal(writes.filter(x=>x.action==='screen.layout.begin').length,prior);
 }finally{dom.window.close();}
});
test('weekly sleep rejects an empty weekday set and layout sizes protect readability',async()=>{
 const {dom,w,writes,flush,click,current}=fixture();try{
  await w.ScreenUI.load();await w.ScreenUI.loadPolicy();const d=w.document;click('#screenAddPlan');
  d.querySelectorAll('#screenPlans .days input').forEach(el=>el.checked=false);d.querySelector('#screenPlans .days input').dispatchEvent(new w.Event('change',{bubbles:true}));
  click('#screenPolicySave');await flush();assert.equal(writes.some(x=>x.action==='screen.display.set'),false);
  const s=w.ScreenLayout.decode(current());s.items[0].w=1;assert.throws(()=>w.ScreenLayout.encode(s));
  const obsolete=w.ScreenLayout.decode(current());obsolete.schema=2;assert.throws(()=>w.ScreenLayout.encode(obsolete));const old=current();old.set(new TextEncoder().encode('SCN2'));assert.throws(()=>w.ScreenLayout.decode(old));
 }finally{dom.window.close();}
});

test('six appearance palettes, independent component roles, undo and saved settings leave SCN3 untouched',async()=>{
 const {dom,w,writes,current,flush,click,appearance}=fixture({appearanceEnabled:true});try{
  await w.ScreenUI.load();const d=w.document,initial=Buffer.from(current());assert.equal(d.querySelector('#screenAppearance').hidden,false);
  click('[data-theme="ocean"]');assert.equal(d.querySelector('#screenGrid').style.getPropertyValue('--screen-bg'),'#0c1721');
  click('#screenUndo');assert.equal(d.querySelector('#screenGrid').style.getPropertyValue('--screen-bg'),'#101611');
  click('[data-theme="paper"]');click('[data-component="2"]');
  const component=d.querySelector('#screenComponentColors');assert(component);
  const color=component.querySelectorAll('input[type=color]')[2];color.value='#123456';color.dispatchEvent(new w.Event('change'));
  assert.equal(d.querySelector('[data-component="2"]').style.getPropertyValue('--component-value'),'#123456');
  click('#screenAppearanceSave');await flush();assert.equal(appearance().theme,'paper');assert.equal(appearance().items['2'].value,'#123456');
  assert.equal(writes.filter(x=>x.action==='screen.layout.begin').length,0);assert.deepEqual(Buffer.from(current()),initial);
  await w.ScreenUI.load();assert.equal(d.querySelector('#screenGrid').style.getPropertyValue('--screen-bg'),'#eeeee6');
  click('[data-component="2"]');d.querySelector('#screenComponentColors [data-i18n="screen.reset_colors"]').click();
  click('#screenAppearanceSave');await flush();assert.equal(Object.keys(appearance().items).length,0);
 }finally{dom.window.close();}
});
test('appearance drafts survive reload and errors preserve edits without claiming a save',async()=>{
 const {dom,w,flush,click,rejectAppearance}=fixture({appearanceEnabled:true});try{
  await w.ScreenUI.load();click('[data-theme="plum"]');await w.ScreenUI.load();
  assert.equal(w.document.querySelector('#screenGrid').style.getPropertyValue('--screen-bg'),'#1b1523');
  rejectAppearance();click('#screenAppearanceSave');await flush();assert.match(w.document.querySelector('#screenAppearanceState').textContent,/Unsaved/i);
  assert.equal(w.document.querySelector('#screenAppearanceSave').disabled,false);
 }finally{dom.window.close();}
});
test('the disabled sixth page accepts CO2, numeric TVOC and PM2.5 and rejects unsupported bindings',async()=>{
 const {dom,w,current}=fixture();try{
  await w.ScreenUI.load();let scene=w.ScreenLayout.decode(current());scene.pages.push({id:100,enabled:false,title:'Air quality'});
  const it={id:106,page:6,type:3,binding:2,x:0,y:0,w:4,h:6,source:0,title:'Air quality',unit:'',chart:1,hours:1,series_count:3,binding2:4,binding3:3,additive:0,text:''};scene.items.push(it);
  const bytes=w.ScreenLayout.encode(scene),decoded=w.ScreenLayout.decode(bytes);assert.equal(decoded.pages[6].enabled,false);assert.equal(decoded.items.at(-1).binding2,4);
  if(codec){const temp=fs.mkdtempSync(path.join(os.tmpdir(),'screen-multi-'));try{const file=path.join(temp,'scene.bin');fs.writeFileSync(file,bytes);cp.execFileSync(codec,[file]);}finally{fs.rmSync(temp,{recursive:true});}}
  it.binding2=5;assert.throws(()=>w.ScreenLayout.encode(scene));it.binding2=4;it.chart=2;assert.throws(()=>w.ScreenLayout.encode(scene));
 }finally{dom.window.close();}
});

test('screen controls have independent accessible tabs and preserve the layout draft',async()=>{
 const {dom,w,click}=fixture({appearanceEnabled:true,capabilities:131069});try{
  await w.ScreenUI.load();const d=w.document;
  assert.equal(d.querySelector('[data-settings-page="device"] #screenEditor'),null);
  assert(d.querySelector('[data-settings-page="screen"] #screenEditor'));
  assert.equal(d.querySelectorAll('[role=tab]').length,7);
  click('#screenTab_appearance');assert.equal(d.querySelector('#screenPanel_layout').hidden,true);
  const tab=d.querySelector('#screenTab_appearance');tab.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(d.querySelector('#screenTab_display').getAttribute('aria-selected'),'true');
  assert.equal(d.querySelector('#screenPanel_display').hidden,false);
  d.querySelector('#screenTab_display').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true}));
  assert.equal(d.querySelector('#screenPanel_layout').hidden,false);
 }finally{dom.window.close();}
});
test('hidden component headings reclaim value space and configurable 256-point charts round trip',async()=>{
 const {dom,w,click,current,flush}=fixture({appearanceEnabled:true,capabilities:131069});try{
  await w.ScreenUI.load();click('#screenEdit');const d=w.document;click('[data-component="2"]');
  const value=()=>d.querySelector('[data-component="2"] .screen-widget-value');const oldTop=parseFloat(value().style.top);
  let hide=d.querySelector('[data-component-field="hide_title"]');assert.equal(hide.disabled,false);hide.checked=true;hide.dispatchEvent(new w.Event('change'));
  assert.equal(d.querySelector('[data-component="2"] .screen-widget-label').textContent,'');assert(parseFloat(value().style.top)<oldTop);
  click('#screenSave');await flush();assert.equal(w.ScreenLayout.decode(current()).items.find(it=>it.id===2).hide_title,1);
  const chart=w.ScreenLayout.decode(current()).items.find(it=>[3,4,5].includes(it.type));
  d.querySelector('#screenPage').value=String(chart.page);d.querySelector('#screenPage').dispatchEvent(new w.Event('change'));click(`[data-component="${chart.id}"]`);
  const points=d.querySelector('[data-component-field="points"]');points.value='256';points.dispatchEvent(new w.Event('change'));
  click('#screenSave');await flush();assert.equal(w.ScreenLayout.decode(current()).items.find(it=>it.id===chart.id).points,256);
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{extension_supported:true,capabilities:8189}});
  assert.equal(d.querySelector('[data-component-field="points"]').disabled,true);assert.equal(d.querySelector('[data-component-field="hide_title"]').disabled,true);
 }finally{dom.window.close();}
});
test('screen language persists independently of browser locale and layout',async()=>{
 const {dom,w,click,current,appearance,flush}=fixture({appearanceEnabled:true,capabilities:131069});try{
  await w.ScreenUI.load();const before=Buffer.from(current()),d=w.document;w.I18N.set('zh-CN');click('#screenTab_display');
  const language=d.querySelector('#screenLanguage');assert.equal(language.disabled,false);language.value='en';language.dispatchEvent(new w.Event('change'));click('#screenLanguageSave');await flush();
  assert.equal(appearance().language,'en');assert.deepEqual(current(),before);
  click('#screenTab_layout');const weather=w.ScreenLayout.decode(current()).items.find(it=>it.type===6);
  d.querySelector('#screenPage').value=String(weather.page);d.querySelector('#screenPage').dispatchEvent(new w.Event('change'));
  assert.equal(d.querySelector('.screen-weather-condition').textContent,'Partly cloudy');assert.match(d.querySelector('.screen-weather-summary').textContent,/Feels like.*Humidity.*Wind/);
  assert.equal(d.querySelector('.screen-page-title').textContent,'Outdoor weather');
 }finally{dom.window.close();}
});

test('layout save waits for a language acknowledgement across tabs and does not save appearance twice',async()=>{
 const {dom,w,writes,click,appearance,flush}=fixture({appearanceEnabled:true,capabilities:131069});try{
  await w.ScreenUI.load();const d=w.document,command=w.command;let submitted=false,release;
  w.command=async(action,params)=>{const result=await command(action,params);
   if(action==='screen.appearance.set')submitted=true;
   else if(action==='screen.appearance.get'&&submitted&&!release)await new Promise(resolve=>release=resolve);
   return result;
  };
  click('#screenEdit');const title=d.querySelector('#screenPageTitle');title.value+=' edited';title.dispatchEvent(new w.Event('change'));
  click('#screenTab_display');const language=d.querySelector('#screenLanguage');language.value='en';language.dispatchEvent(new w.Event('change'));click('#screenLanguageSave');await flush();
  assert.equal(typeof release,'function');const revision=appearance().revision;
  click('#screenTab_layout');assert.equal(d.querySelector('#screenSave').disabled,true);click('#screenSave');await flush();
  assert.equal(writes.filter(x=>x.action==='screen.layout.begin').length,0);assert.equal(writes.filter(x=>x.action==='screen.appearance.set').length,1);
  release();await flush();assert.equal(d.querySelector('#screenSave').disabled,false);
  const previous=w.command;let releaseLayout;
  w.command=async(action,params)=>{const result=await previous(action,params);if(action==='screen.layout.begin')await new Promise(resolve=>releaseLayout=resolve);return result;};
  click('#screenSave');await flush();assert.equal(typeof releaseLayout,'function');w.I18N.set('en');assert.equal(d.querySelector('#screenSave').disabled,true);
  releaseLayout();await flush();
  assert.equal(writes.filter(x=>x.action==='screen.layout.begin').length,1);assert.equal(writes.filter(x=>x.action==='screen.appearance.set').length,1);assert.equal(appearance().revision,revision);
 }finally{dom.window.close();}
});

test('font preparation failure cancels once and releases the resource controls',async()=>{
 const {dom,w,writes,click,flush}=fixture({appearanceEnabled:true,capabilities:131069});try{
  await w.ScreenUI.load();const d=w.document,bytes=Buffer.alloc(57);bytes.write('IOTFNT02');bytes.writeUInt32LE(57,8);bytes.writeUInt32LE(w.ScreenLayout.crc(bytes.subarray(32)),12);bytes.writeUInt32LE(w.ScreenLayout.crc(bytes.subarray(0,28)),28);
  Object.defineProperty(d.querySelector('#screenFontFile'),'files',{value:[{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}]});
  const command=w.command;let query=0;
  w.command=async(action,params)=>{
   if(!action.startsWith('screen.font.'))return command(action,params);
   writes.push({action,params});
   if(action==='screen.font.begin')return {request:1};
   if(action==='screen.font.cancel')return {request:2};
   query++;return {request:query<=2?1:2,state:'complete',code:0,active:query===1,resource_state:query===1?7:5};
  };
  click('#screenFontUpload');for(let i=0;i<8;i++)await flush();
  assert.equal(writes.filter(x=>x.action==='screen.font.cancel').length,1);
  assert.equal(writes.filter(x=>x.action==='screen.font.chunk').length,0);
  assert.equal(d.querySelector('#screenFontUpload').disabled,false);
  assert.equal(d.querySelector('#screenFontProgress').hidden,true);
 }finally{dom.window.close();}
});

test('startup auto-resume preserves drafts, saves the switch and keeps failed writes editable',async()=>{
 const {dom,w,click,flush}=fixture();try{
  const d=w.document,original=w.command;let saved=true,reject=false;
  w.command=async(action,params)=>{
   if(action==='screen.startup.get')return {auto_resume:saved,delay_seconds:5,window_seconds:30};
   if(action==='screen.startup.set'){if(reject)throw Error('storage_error');saved=params.auto_resume;return {auto_resume:saved};}
   return original(action,params);
  };
  await w.ScreenUI.loadStartup();const checkbox=d.querySelector('#screenStartupAuto');
  assert(checkbox.checked&&!checkbox.disabled);checkbox.checked=false;checkbox.dispatchEvent(new w.Event('change'));
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{startup:{auto_resume:true}}});assert.equal(checkbox.checked,false);
  click('#screenStartupSave');await flush();assert.equal(saved,false);assert.match(d.querySelector('#screenStartupState').textContent,/30/);
  await w.ScreenUI.loadStartup();assert.equal(checkbox.checked,false);
  checkbox.checked=true;checkbox.dispatchEvent(new w.Event('change'));reject=true;
  click('#screenStartupSave');await flush();assert.equal(saved,false);assert.equal(checkbox.checked,true);assert.equal(d.querySelector('#screenStartupSave').disabled,false);
  reject=false;click('#screenStartupSave');await flush();assert(saved);assert.match(d.querySelector('#screenStartupState').textContent,/5/);
 }finally{dom.window.close();}
});
test('layout preview follows the current LVGL geometry and full-width page rail',async()=>{
 const {dom,w,current}=fixture();try{
  await w.ScreenUI.load();const d=w.document;
  const tile=d.querySelector('[data-component]');const actual=w.ScreenLayout.decode(current());
  const it=actual.items.find(it=>it.id===Number(tile.dataset.component));
  assert(Math.abs(parseFloat(tile.style.left)-(16+114*it.x)/480*100)<1e-8);
  assert(Math.abs(parseFloat(tile.style.top)-(66+130*it.y)/854*100)<1e-8);
  assert(Math.abs(parseFloat(tile.style.width)-(114*it.w-8)/480*100)<1e-8);
  assert(Math.abs(parseFloat(tile.style.height)-(130*it.h-8)/854*100)<1e-8);
  const rail=[...d.querySelectorAll('.screen-page-dot')];assert(rail.length>0);
  assert.equal(parseFloat(rail[0].style.left),0);assert.equal(parseFloat(rail[0].style.top),0);
  assert(Math.abs(rail.reduce((n,o)=>n+parseFloat(o.style.width),0)-100)<1e-8);
  assert.equal(rail.filter(o=>o.style.opacity==='0.9').length,1);
 }finally{dom.window.close();}
});
test('page rail thickness previews, undo, save and reload without changing layout bytes',async()=>{
 const {dom,w,current,appearance,click,flush}=fixture({appearanceEnabled:true,capabilities:262141});try{
  await w.ScreenUI.load();const d=w.document,before=Buffer.from(current());
  const height=()=>parseFloat(d.querySelector('.screen-page-dot').style.height)*854/100;
  assert(Math.abs(height()-12)<1e-8);click('#screenTab_appearance');
  let control=d.querySelector('#screenPageRailHeight');assert(!control.disabled);control.value='20';control.dispatchEvent(new w.Event('change'));
  assert(Math.abs(height()-20)<1e-8);click('#screenUndo');assert(Math.abs(height()-12)<1e-8);
  control=d.querySelector('#screenPageRailHeight');control.value='6';control.dispatchEvent(new w.Event('change'));
  click('#screenAppearanceSave');await flush();assert.equal(appearance().pageRailHeight,6);assert.deepEqual(Buffer.from(current()),before);
  await w.ScreenUI.load();assert.equal(d.querySelector('#screenPageRailHeight').value,'6');assert(Math.abs(height()-6)<1e-8);
 }finally{dom.window.close();}
});
test('startup control waits for the MCU acknowledgement and normal mode before completing',async()=>{
 const {dom,w,click,flush}=fixture();try{
  const d=w.document,original=w.command;let release,requested=false,gets=0;
  const recovery={available:true,mode:'window',window_ms:27000,session:19,request:0,state:'ready'};
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{recovery}});
  assert.equal(d.querySelector('#screenRecoveryResume').disabled,false);
  assert.match(d.querySelector('#screenRecoveryState').textContent,/27/);
  w.command=async(action,params)=>{
   if(action==='screen.recovery.get'){
    gets++;if(requested)return await new Promise(resolve=>release=()=>resolve({...recovery,mode:'normal',request:4,state:'complete',result:0}));
    return recovery;
   }
   if(action==='screen.recovery.resume'){requested=true;return {session:19,request:4};}
   return original(action,params);
  };
  click('#screenRecoveryResume');await flush();assert(requested&&gets===2);
  assert.equal(d.querySelector('#screenRecoveryResume').disabled,true);assert.equal(d.querySelector('#screenRecoveryHold').disabled,true);
  assert.match(d.querySelector('#screenRecoveryState').textContent,/Minimal/);
  release();await flush();assert.equal(d.querySelector('#screenRecoveryState').textContent,'Running');
  assert.equal(d.querySelector('#screenRecoveryResume').disabled,true);
 }finally{dom.window.close();}
});
test('startup control protects fault recovery, offline MCU and active OTA, and rechecks stale window state',async()=>{
 const {dom,w,click,flush}=fixture();try{
  const d=w.document,original=w.command;let resumes=0;
  w.command=async(action,params)=>{
   if(action==='screen.recovery.get')return {available:true,mode:'fault_recovery'};
   if(action==='screen.recovery.resume')resumes++;
   return original(action,params);
  };
  for(const recovery of [{available:false},{available:true,mode:'fault_recovery'},{available:true,mode:'normal'}]){
   w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{recovery}});assert.equal(d.querySelector('#screenRecoveryResume').disabled,true);
  }
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{recovery:{available:true,mode:'window'},ota:{active:true}}});
  assert.equal(d.querySelector('#screenRecoveryResume').disabled,true);
  w.ScreenUI.status({hardware_model:'BRY88BBA15G',screen:{recovery:{available:true,mode:'window'}}});
  click('#screenRecoveryResume');await flush();assert.equal(resumes,0);
 }finally{dom.window.close();}
});

for(const mode of ['verified','wrong-hash','failed-stage','wrong-model','invalid-path'])test('online screen update: '+mode,async()=>{
 const {dom,w,writes,flush,click}=fixture({capabilities:0x1ffffd});try{
  const data=Buffer.alloc(421888,7),sha=require('node:crypto').createHash('sha256').update(data).digest('hex');
  const screen={target:mode==='wrong-model'?'other':'BRY88BBA15G-screen',version:'1.0.0-rc.6',firmware:{path:mode==='invalid-path'?'/admin/upload':'/releases/v1.0.0-rc.6/screen.bin',size:data.length,sha256:sha}};
  let downloads=0,uploads=0;w.fetch=async url=>{
   if(url.endsWith('/index.json'))return {ok:true,json:async()=>({releases:[]})};
   if(url.endsWith('/candidates.json'))return {ok:true,json:async()=>({releases:[{version:'1.0.0-rc.6',screen}]})};
   assert.equal(url,'https://phicomm-io.github.io/releases/v1.0.0-rc.6/screen.bin');downloads++;return {ok:true,headers:{get:()=>String(data.length)},arrayBuffer:async()=>data};
  };
  w.UI.confirm=async()=>true;w.DeviceSession.fetch=async (url,options)=>{uploads++;assert.equal(url,'/api/v1/screen/ota/upload');assert.equal(options.body.length,data.length);return {ok:true,json:async()=>({code:'ok',data:{sha256:mode==='wrong-hash'?'0'.repeat(64):sha}})};};
  const command=w.command;w.command=async(action,params)=>{
   if(action==='screen.update.get'){writes.push({action,params});return {ota:{state:mode==='failed-stage'?'failed':'staged_verified'}};}
   return command(action,params);
  };
  click('#screenOnlineCheck');await flush();assert.equal(w.document.querySelector('#screenOnlineFirmware').disabled,mode==='wrong-model');
  if(mode==='wrong-model')return;
  click('#screenOnlineFirmware');await flush();await flush();
  assert.equal(downloads,mode==='invalid-path'?0:1);assert.equal(uploads,mode==='invalid-path'?0:1);
  assert.equal(writes.filter(v=>v.action==='screen.update.start').length,['wrong-hash','invalid-path'].includes(mode)?0:1,w.document.body.textContent.slice(-1500));
  const install=writes.filter(v=>v.action==='screen.update.install');assert.equal(install.length,mode==='verified'?1:0);
  if(install.length)assert.equal(install[0].params.sha256,sha);
 }finally{dom.window.close();}
});
