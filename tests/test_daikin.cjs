const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
test('DAIKIN uses shared metric scales, optional HCHO and expiring live data',()=>{
 const html=require('./render_page.cjs')('DAIKIN/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  let now=100;const ticks=[];w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;w.setInterval=fn=>{ticks.push(fn);return ticks.length;};
  Object.defineProperty(w.performance,'now',{value:()=>now});
 require('./legacy_device_fixture.cjs')(w);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{if(i===scripts.length-1)w.UI.start=dev=>{w.UI.device=dev;};vm.runInContext(source,dom.getInternalVMContext());});
  w.I18N.set('en');
  const state={sensors:{pm25:{valid:true,value:18,age_ms:100},temperature:{valid:true,value:24,age_ms:100},humidity:{valid:true,value:50,age_ms:100},tvoc:{valid:true,value:60,age_ms:100}},co2_warmup_seconds_remaining:30};
  w.UI.device.onStatus(state);
  const card=key=>w.document.querySelector(`[data-sensor="${key}"]`);
  assert.equal(card('formaldehyde').hidden,true);
  assert.equal(card('pm10').hidden,true,'PM10 is optional');
  assert.equal(w.document.querySelector('[data-indicator="formaldehyde"]'),null);
  assert.match(card('co2').textContent,/Warming up/);
  assert.ok(card('temperature').querySelector('.scale'));
  assert.ok(card('tvoc').querySelector('.scale'),'native ppb ventilation reference has a scale');
  assert.match(card('tvoc').textContent,/Reference ≤300 ppb/);
  assert.equal(card('tvoc').querySelector('.badge').textContent,'Within reference');
  w.UI.device.onStatus({...state,indicator_enabled:true,sensors:{...state.sensors,pm10:{valid:true,value:32,age_ms:100},tvoc:{valid:true,value:301,age_ms:100}}});
  assert.equal(card('pm10').hidden,false);assert.equal(card('pm10').querySelector('.num').textContent,'32');
  assert.equal(card('pm10').parentElement,card('pm25').parentElement,'PM10 is an independent card in the same row');
  assert.ok(card('pm10').querySelector('.scale'));
  assert.equal(w.document.querySelectorAll('.metrics>.metric:not([hidden])').length,6);
  assert.equal(card('tvoc').querySelector('.badge').textContent,'Ventilate');
  assert.equal(w.UI.grade('tvoc',300).cls,'ok');
  assert.equal(w.UI.grade('tvoc',301).cls,'warn');
  assert.equal(w.UI.grade('pm10',120).cls,'ok');
  assert.equal(w.UI.grade('pm10',121).cls,'warn');
  assert.equal(w.UI.grade('pm25',60).cls,'ok');
  assert.equal(w.UI.grade('pm25',61).cls,'warn');
  assert.equal(w.document.querySelector('[data-indicator="tvoc"]').dataset.active,'true');
  now+=20000;for(const fn of ticks)fn();assert.equal(card('pm25').querySelector('.num').textContent,'—');
  assert.equal(card('pm10').querySelector('.num').textContent,'—');
  assert.equal(w.document.querySelector('[data-indicator="tvoc"]').dataset.active,'false');
  w.UI.device.onStatus({...state,sensors:{...state.sensors,formaldehyde:{valid:true,value:.012,age_ms:0}}});
  assert.equal(card('formaldehyde').hidden,false);assert.equal(card('formaldehyde').querySelector('.num').textContent,'0.012');
  assert.ok(w.document.querySelector('[data-indicator="formaldehyde"]'));assert.equal(w.document.querySelector('[data-indicator="tvoc"]'),null);
  assert.equal(w.UI.device.otaName,'daikin_BRY88AX151K.ota.bin.signed');
 }finally{dom.window.close();}
});

function rulesFixture(){return {co2:[{threshold:1000,op:'gt',mode:'slow'},{threshold:1500,op:'gte',mode:'fast'}],tvoc:[{threshold:300,op:'gt',mode:'on'}],pm_source:'pm25',pm:[{threshold:50,op:'gt',mode:'on'}],formaldehyde:[]};}
function editorFixture(){
 const html=require('./render_page.cjs')('DAIKIN/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local/#settings/device'}),w=dom.window;
 w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;w.setInterval=()=>0;
 require('./legacy_device_fixture.cjs')(w);
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 scripts.forEach((source,i)=>{if(i===scripts.length-1)w.UI.start=dev=>{w.UI.device=dev;};vm.runInContext(source,dom.getInternalVMContext());});
 w.I18N.set('en');
 const state={indicator_enabled:true,indicator_rules_supported:true,indicator_rules_custom:true,indicator_rules:rulesFixture(),system_indicator:'mqtt_down',sensors:{co2:{valid:true,value:1600,age_ms:0},tvoc:{valid:true,value:400,age_ms:0},pm25:{valid:true,value:60,age_ms:0},pm10:{valid:true,value:150,age_ms:0}}};
 w.UI.device.onStatus(state);
 return {dom,w,state,group:key=>w.document.querySelector(`[data-rule-metric="${key}"]`),flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
test('DAIKIN indicator editor saves two rules, confirms device state and preserves unsaved edits during polling',async()=>{
 const {dom,w,state,group,flush}=editorFixture();
 try{
  const co2=group('co2'),tvoc=group('tvoc'),pm=group('pm'),form=w.document.querySelector('#indicatorRulesForm');
  const input=co2.querySelector('[data-rule-threshold]');input.value='900';input.dispatchEvent(new w.Event('input',{bubbles:true}));
  w.UI.device.onStatus({...state,sensors:{...state.sensors,co2:{valid:true,value:1700,age_ms:0}}});
  assert.equal(co2.querySelector('[data-rule-threshold]').value,'900','status polling keeps unsaved input');
  assert.equal(co2.querySelectorAll('.indicator-rule').length,2);assert.equal(co2.querySelector(':scope>button').disabled,true);
  tvoc.querySelector(':scope>button').click();assert.equal(tvoc.querySelectorAll('.indicator-rule').length,2);assert.equal(tvoc.querySelector(':scope>button').disabled,true);
  const source=w.document.querySelector('#indicatorPmSource');source.value='pm10';source.dispatchEvent(new w.Event('change'));
  pm.querySelector('[data-rule-threshold]').value='120';pm.querySelector('[data-rule-mode]').value='fast';
  assert.equal(group('formaldehyde').hidden,true);
  let write;w.command=async(action,params)=>{write={action,params:JSON.parse(JSON.stringify(params))};};
  w.UI.reload=async()=>({...state,indicator_rules:write.params.values});
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();
  assert.equal(write.action,'config.set');assert.equal(write.params.section,'indicator_rules');
  assert.equal(write.params.values.co2[0].threshold,900);assert.equal(write.params.values.co2.length,2);
  assert.equal(write.params.values.pm_source,'pm10');assert.deepEqual(write.params.values.pm,[{threshold:120,op:'gt',mode:'fast'}]);
  assert.equal(form.querySelector('[type=submit]').disabled,false);
  assert.match(w.document.querySelector('#toasts').textContent,/Saved/);
  const persisted=JSON.parse(JSON.stringify(write.params.values));
  w.UI.device.onStatus({...state,indicator_rules:persisted});
  assert.equal(co2.querySelector('[data-rule-threshold]').value,'900');
 }finally{dom.window.close();}
});
test('DAIKIN rejects duplicate thresholds and keeps the editor after failed or unconfirmed saves',async()=>{
 const {dom,w,state,group,flush}=editorFixture();
 try{
  const form=w.document.querySelector('#indicatorRulesForm'),inputs=group('co2').querySelectorAll('[data-rule-threshold]');
  inputs[1].value=inputs[0].value;let writes=0;
  w.command=async()=>{writes++;throw Error('storage_error');};
  const submit=async()=>{form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();};
  await submit();assert.equal(writes,0);assert.match(w.document.querySelector('#toasts').textContent,/different thresholds/);
  inputs[1].value='2000';inputs[1].dispatchEvent(new w.Event('input',{bubbles:true}));
  await submit();assert.equal(writes,1);assert.match(w.document.querySelector('#toasts').textContent,/storage_error/);
  w.UI.device.onStatus({...state});assert.equal(inputs[1].value,'2000');
  w.command=async()=>{writes++;};w.UI.reload=async()=>state;
  await submit();assert.equal(writes,2);assert.match(w.document.querySelector('#toasts').textContent,/could not be confirmed/);
  assert.equal(inputs[1].value,'2000');
 }finally{dom.window.close();}
});
test('DAIKIN uses only the selected PM source and shows blink modes, stale blackout and system status',()=>{
 const {dom,w,state}=editorFixture();
 try{
  const light=key=>w.document.querySelector(`[data-indicator="${key}"]`);
  assert.equal(light('co2').dataset.mode,'fast');
  assert.match(w.document.querySelector('#indicatorWifi').textContent,/MQTT not ready.*slow blink/);
  const rules=rulesFixture();rules.pm_source='pm10';rules.pm=[{threshold:120,op:'gte',mode:'slow'}];
  w.UI.device.onStatus({...state,indicator_rules:rules});assert.equal(light('pm').dataset.mode,'slow');
  const dot=light('pm').querySelector('.dot');
  w.UI.device.onStatus({...state,indicator_rules:rules});assert.equal(light('pm').querySelector('.dot'),dot,'polling preserves the animation instead of restarting it');
  w.UI.device.onStatus({...state,indicator_rules:rules,sensors:{...state.sensors,pm10:{valid:true,value:150,age_ms:20000}}});assert.equal(light('pm').dataset.mode,'off');
  w.UI.device.onStatus({...state,indicator_rules:rules,sensors:{...state.sensors,pm25:{valid:true,value:9999,age_ms:0},pm10:{valid:true,value:119,age_ms:0}}});assert.equal(light('pm').dataset.mode,'off','unselected PM2.5 cannot trigger the lamp');
  w.UI.device.onStatus({...state,indicator_rules:{...rules,pm_source:'pm25'},sensors:{...state.sensors,pm25:{valid:true,value:120,age_ms:0},pm10:{valid:true,value:0,age_ms:0}}});assert.equal(light('pm').dataset.mode,'slow');
  w.UI.device.onStatus({...state,indicator_enabled:false});assert.equal(light('co2').dataset.mode,'off');assert.match(w.document.querySelector('#indicatorWifi').textContent,/MQTT not ready/);
  w.UI.device.onStatus({...state,indicator_rules_supported:false,indicator_rules:undefined});
  assert.equal(w.document.querySelector('#indicatorRulesForm [type=submit]').disabled,true);
 }finally{dom.window.close();}
});

test('DAIKIN CO2 diagnostics gate calibration, confirm the reference, and distinguish ACK from accuracy',async()=>{
 const {dom,w,state,flush}=editorFixture();
 try{
  const find=id=>w.document.getElementById(id),button=find('co2Calibrate'),stable=find('co2ReferenceStable'),form=find('co2CalibrationForm');
  assert.equal(button.disabled,true);assert.match(find('co2Diagnostic').textContent,/Upgrade firmware/);
  const diagnostic={fresh:true,raw_ppm:946,status_raw:64,age_ms:0,drift:true,calibration_available:true,cooldown_seconds:0,calibration:{state:'never'}};
  const show=d=>w.UI.device.onStatus({...state,co2_diagnostics:d});show(diagnostic);
  assert.match(find('co2Diagnostic').textContent,/946.*64.*Drift/);
  show({...diagnostic,status_flags_supported:false,status_raw:1,drift:null});
  assert.match(find('co2Diagnostic').textContent,/Legacy protocol/);
  assert.doesNotMatch(find('co2Diagnostic').textContent,/No status flags|Preheating/);
  show(diagnostic);
  assert.equal(button.disabled,true,'explicit stable reference confirmation required');
  stable.checked=true;stable.dispatchEvent(new w.Event('change'));assert.equal(button.disabled,false);
  show({...diagnostic,fresh:false});assert.equal(button.disabled,true);show(diagnostic);
  let writes=[],confirmed=false;w.UI.confirm=async()=>confirmed;
  w.command=async(action,params)=>{writes.push({action,params:JSON.parse(JSON.stringify(params))});};
  w.UI.reload=async()=>{show({...diagnostic,calibration_available:false,cooldown_seconds:60,calibration:{state:'waiting_ack'}});};
  const submit=async()=>{form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await flush();};
  await submit();assert.equal(writes.length,0,'cancel sends no command');
  confirmed=true;find('co2Reference').value='1501';await submit();assert.equal(writes.length,0,'range checked');
  find('co2Reference').value='430';
  let finish;w.UI.confirm=()=>new Promise(resolve=>{finish=resolve;});
  await submit();await submit();assert.equal(writes.length,0);assert.equal(button.disabled,true);
  finish(true);await flush();assert.deepEqual(writes,[{action:'co2.calibrate',params:{reference_ppm:430,reference_stable:true}}]);
  assert.equal(stable.checked,false);assert.equal(button.disabled,true);
  assert.match(find('co2CalibrationResult').textContent,/waiting for module acknowledgement/);
  show({...diagnostic,calibration:{state:'acknowledged'}});
  assert.match(find('co2CalibrationResult').textContent,/Compare fresh readings with the reference/);
  show({...diagnostic,calibration:{state:'timeout_unknown'}});
  assert.match(find('co2CalibrationResult').textContent,/Outcome unknown.*not retried/);
  assert.equal(writes.length,1,'polling never repeats calibration');
  w.I18N.set('zh-CN');assert.match(find('co2Diagnostic').textContent,/漂移/);
  assert.match(find('co2CalibrationResult').textContent,/结果未知/);
  w.I18N.set('en');show(diagnostic);stable.checked=true;stable.dispatchEvent(new w.Event('change'));
  w.UI.confirm=async()=>true;w.command=async()=>{writes.push({});throw Error('transport timeout');};
  await submit();assert.equal(writes.length,2);assert.equal(stable.checked,false);
  assert.match(find('co2CalibrationResult').textContent,/outcome is unknown/);
 }finally{dom.window.close();}
});

test('DAIKIN climate settings save, preserve drafts, restore defaults and reject unconfirmed writes',async()=>{
 const {dom,w,state,flush}=editorFixture();
 try{
  const d=w.document,temp=d.querySelector('#climateTemperature'),hum=d.querySelector('#climateHumidity'),form=d.querySelector('#climateForm');
  const initial={...state,climate_compensation:{temperature_offset:4.9,humidity_offset:0}};
  w.UI.device.onStatus(initial);assert.equal(temp.value,'4.9');
  temp.value='3.2';temp.dispatchEvent(new w.Event('input'));hum.value='2';hum.dispatchEvent(new w.Event('input'));
  w.UI.device.onStatus(initial);assert.equal(temp.value,'3.2');
  let stored,writes=0;w.command=async(a,p)=>{if(a==='config.set'){writes++;stored=JSON.parse(JSON.stringify(p));return {};}return {climate_compensation:stored.values};};
  form.dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
  assert.equal(stored.section,'climate');assert.deepEqual(stored.values,{temperature_offset:3.2,humidity_offset:2});
  assert.match(d.querySelector('#climateResult').textContent,/Saved and read back/);
  w.UI.confirm=async()=>false;d.querySelector('#climateDefaults').click();await flush();assert.equal(writes,1);
  w.UI.confirm=async()=>true;d.querySelector('#climateDefaults').click();await flush();
  assert.deepEqual(stored.values,{temperature_offset:4.9,humidity_offset:0});assert.equal(temp.value,'4.9');
  temp.value='5.5';temp.dispatchEvent(new w.Event('input'));
  w.command=async(a)=>a==='config.get'?initial:{};
  form.dispatchEvent(new w.Event('submit',{cancelable:true}));await flush();
  assert.match(d.querySelector('#climateResult').textContent,/could not be confirmed/);assert.equal(temp.value,'5.5');
  w.UI.device.onStatus(state);assert.equal(d.querySelector('#climateSettings').hidden,true);
 }finally{dom.window.close();}
});
