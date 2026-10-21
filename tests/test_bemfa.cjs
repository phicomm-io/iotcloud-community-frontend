const {JSDOM}=require('jsdom'),assert=require('node:assert/strict');
const render=require('./render_page.cjs'),vm=require('node:vm');
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
for(const [model,dual] of [['A1',true],['TC1',true],['A1',false],['TC1',false],['M1',false]]){
 const path=model==='TC1'?'TC1/http_server/web/index.html':model+'/web/index.html';
 const dom=new JSDOM(render(path),{url:'http://device.local/#settings/mqtt',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document,calls=[];w.TextEncoder=TextEncoder;w.setTimeout=()=>0;
 const topics=model==='TC1'?Array.from({length:6},(_,i)=>'socket'+(i+1)+'001'):['fan003','ring002'];
 const state={model:model.toLowerCase(),device_id:'aabbccddeeff',name:'test',mqtt_host:'primary',mqtt_port:1883,mqtt_user:'original',mqtt_enabled:false,bemfa_enabled:true,bemfa_connected:true,socket_states:[0,0,0,0,0,0],socket_names:[],percentage:50,fan_on:true};
 w.fetch=async(url,opts)=>{const req=JSON.parse(opts.body);calls.push(req);let data={};
  if(req.action==='capabilities.get')data={actions:['status.get','config.get','config.set'],dual_mqtt:dual};
  if(req.action==='status.get')data=state;
  if(req.action==='config.get')data={mqtt_enabled:false,bemfa:{enabled:true,app_id:'user-app',secret_key_set:true,topics}};
  return {ok:true,status:200,json:async()=>({code:req.action.endsWith('.get')?'ok':'accepted',data})};};
 for(const m of render(path).matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],dom.getInternalVMContext());
 for(let i=0;i<16;i++)await tick();
 assert.equal(!!d.querySelector('#bemfaForm'),dual);
 assert.equal(!!d.querySelector('#mqttEnabled'),dual);
 if(dual){
  assert.equal(d.querySelector('#mqttEnabled').checked,false);
  assert.equal(d.querySelectorAll('[id^=bemfaTopic]').length,topics.length);
  assert.equal(d.querySelector('#bemfaTopic0').value,topics[0]);
  assert.equal(d.querySelector('#bemfaSecret').value,'');
  d.querySelector('#bemfaForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<6;i++)await tick();
  let save=calls.findLast(x=>x.action==='config.set');assert.equal(save.params.section,'bemfa');assert(!('secret_key' in save.params.values));
  d.querySelector('#bemfaSecret').value='new-private-key';
  d.querySelector('#bemfaForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<6;i++)await tick();
  save=calls.findLast(x=>x.action==='config.set');assert.equal(save.params.values.secret_key,'new-private-key');assert.equal(d.querySelector('#bemfaSecret').value,'');
  d.querySelector('#bemfaEnabled').checked=false;d.querySelector('#clearBemfaSecret').checked=true;
  d.querySelector('#bemfaForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<6;i++)await tick();
  save=calls.findLast(x=>x.action==='config.set');assert.equal(save.params.values.secret_key,'');assert.equal(save.params.values.enabled,false);
  d.querySelector('#mqttForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<6;i++)await tick();
  save=calls.findLast(x=>x.action==='config.set');assert.equal(save.params.section,'mqtt');assert.equal(save.params.values.enabled,false);
  assert(!Object.values(w.localStorage).join('').includes('private-key'));
 }else{
  d.querySelector('#mqttForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<6;i++)await tick();
  const save=calls.findLast(x=>x.action==='config.set');assert.equal(save.params.section,'mqtt');assert(!('enabled' in save.params.values));
  assert(!calls.some(x=>x.action==='config.get'));
 }
 dom.window.close();console.log(model+' dual='+dual+': configuration, independent toggles, secret omission/replacement/clear and old-firmware compatibility PASS');
}
})().catch(e=>{console.error(e);process.exit(1)});
