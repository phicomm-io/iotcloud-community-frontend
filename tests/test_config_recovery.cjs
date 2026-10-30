/* Exercise rendered pages through the public command API, including a reboot
 * that disconnects the same browser tab. No device storage is simulated here. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const cp=require('node:child_process'),{JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const pages=new Map();
function render(model,setup){
 const key=model+setup;
 if(!pages.has(key)){
  let html=setup?cp.execFileSync('python3',['-c',`import sys;sys.path.insert(0,'common/web');from setup import render_setup;sys.stdout.buffer.write(render_setup('${model}'))`],{encoding:'utf8'}):require('./render_page.cjs')('M1/web/index.html');
  if(setup&&process.env.WEB_TEST_MINIFIED==='1')html=cp.execFileSync('node',['tools/minify_device.cjs'],{input:html,encoding:'utf8'});
  pages.set(key,html);
 }
 return pages.get(key);
}
async function fixture(model='m1',setup=false,recovery=true){
 const dom=new JSDOM(render(model,setup),{runScripts:'outside-only',url:'http://device.local/#settings/maintenance'}),w=dom.window,d=w.document,calls=[];
 const state={name:'monitor',device_id:'aabbccddeeff',version:'test',ssid:'old-network',mqtt_host:'old-broker',mqtt_port:1883,mqtt_user:'old-user',
  ap_active:true,ap_name:'test-ap',ip:'192.168.0.1',uptime_seconds:120,reboot_pending:false,mqtt_protocol:'tmcp',
  brightness_requested:4,brightness:255,led_enabled:true,time_synced:true,timezone_minutes:480,ntp_host:'pool.ntp.org',ota_state:'idle',ota_progress:0};
 const caps={model,config_recovery:recovery,status_views:['full','live'],actions:['status.get','capabilities.get','config.get','config.set','system.reset']};
 let online=true,confirmed=true,resetFailure='',readGate=null;
 w.localStorage.setItem('phicomm.language','zh-CN');
 w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.setTimeout=()=>0;w.setInterval=()=>0;w.scrollTo=()=>{};w.confirm=()=>confirmed;
 w.HTMLDialogElement.prototype.showModal=undefined;
 w.fetch=async(url,options)=>{
  // Existing firmware has no token endpoint; preserve its explicit legacy path.
  if(url==='/api/v1/info')return {ok:true,status:200,json:async()=>({code:'ok',data:{api_version:1,device_id:'aabbccddeeff',model,version:'legacy'}})};
  if(url==='/api/v1/auth/login')return {ok:false,status:404};
  assert.equal(url,'/api/v1/command');assert.equal(options.method,'POST');
  const request=JSON.parse(options.body);calls.push(request);
  if(!online)throw Error('disconnected');
  let data={};
  if(request.action==='status.get'){
   data={...state};
   if(request.params.view==='live')for(const key of ['ssid','mqtt_host','mqtt_user','mqtt_port'])delete data[key];
   if(readGate){const gate=readGate;readGate=null;await gate;}
  }
  if(request.action==='capabilities.get')data={...caps};
  if(request.action==='config.get')data={language:'zh-CN',migration_state:caps.config_recovery?'confirmation_required':'ready'};
  if(request.action==='system.reset'){
   assert.deepEqual(request.params,{full:true});assert(request.request_id);
   if(resetFailure)return {ok:false,status:503,headers:{get:()=> 'application/json'},json:async()=>({code:'storage_error',message:'storage failed'})};
   state.reboot_pending=true;
  }
  return {ok:true,status:200,json:async()=>({code:'ok',data})};
 };
 for(const script of d.scripts)w.eval(script.textContent);
 await settle();
 const element=id=>d.getElementById(id),reset=()=>setup?element('clearConfig'):d.querySelector('[data-settings-page="maintenance"] button.danger');
 const refresh=async(full=true)=>{if(setup)await element('refresh').onclick();else await w.UI.reload({full});await settle();};
 const clickReset=async()=>{assert(reset(),'clear action must be mounted');await reset().onclick();await settle();};
 const text=()=>setup?element('message').textContent:d.querySelector('#toasts')?.textContent||'';
 const ready=()=>{caps.config_recovery=false;Object.assign(state,{reboot_pending:false,uptime_seconds:2,ssid:'',mqtt_host:'',mqtt_user:''});};
 return {dom,w,d,calls,state,caps,element,reset,refresh,clickReset,text,ready,
  setOnline:value=>online=value,setConfirmed:value=>confirmed=value,setFailure:value=>resetFailure=value,
  holdRead:value=>readGate=value,writes:()=>calls.filter(r=>!r.action.endsWith('.get'))};
}

for(const setup of [true,false])test(`${setup?'setup':'full'}: confirmation, storage failure and same-tab recovery after reboot`,async()=>{
 const f=await fixture('m1',setup);try{
  if(setup){assert.equal(f.element('recovery').hidden,false);assert.equal(f.element('setup').hidden,true);}
  else {assert.equal(f.w.UI.caps.config_recovery,true);assert.match(f.d.querySelector('#banners').textContent,/原配置无法迁移/);}
  f.setConfirmed(false);await f.clickReset();assert.equal(f.writes().length,0);
  f.setConfirmed(true);f.setFailure('storage_error');await f.clickReset();
  assert.equal(f.writes().length,1);assert.equal(f.reset().disabled,false);assert.match(f.text(),/保存失败|存储|写入/);
  f.setFailure('');await f.clickReset();assert.equal(f.writes().length,2);assert.equal(f.reset().disabled,true);assert.match(f.text(),/等待设备重启/);
  await f.clickReset();assert.equal(f.writes().length,2,'pending reset cannot be submitted twice');
  // RAM may already contain defaults, but a pending reboot is not completion.
  f.caps.config_recovery=false;await f.refresh();assert.equal(f.reset().disabled,true);assert.doesNotMatch(f.text(),/配置已清空，可以重新配网/);
  f.setOnline(false);await f.refresh();assert.equal(f.reset().disabled,true);
  f.setOnline(true);f.ready();await f.refresh();assert.equal(f.reset().disabled,false);assert.match(f.text(),/配置已清空，可以重新配网/);
  assert.equal(f.element('ssid').value,'','defaults replace the stale form after confirmed clearing');
  if(setup){assert.equal(f.element('recovery').hidden,true);assert.equal(f.element('setup').hidden,false);}
  else {assert.equal(f.w.UI.caps.config_recovery,false);assert.doesNotMatch(f.d.querySelector('#banners').textContent,/原配置无法迁移/);}
  f.element('ssid').value='new-network';f.element('wifiPassword').value='new-password';await f.refresh();
  assert.equal(f.element('ssid').value,'new-network','ordinary refresh preserves an unsaved edit');
  const before=f.writes().length;
  if(setup)await f.element('setup').onsubmit({preventDefault(){}});
  else f.element('wifiForm').dispatchEvent(new f.w.Event('submit',{cancelable:true}));
  await settle();assert(f.writes().slice(before).some(r=>r.action==='config.set'&&r.params.section==='wifi'&&r.params.values.ssid==='new-network'));
 }finally{f.dom.window.close();}
});

for(const setup of [true,false])test(`${setup?'setup':'full'}: reboot with recovery still active reports an unconfirmed clear and permits retry`,async()=>{
 const f=await fixture('m1',setup);try{
  await f.clickReset();await f.refresh();f.state.reboot_pending=false;f.state.uptime_seconds=2;await f.refresh();
  assert.equal(f.reset().disabled,false);assert.match(f.text(),/清空结果未确认/);assert.doesNotMatch(f.text(),/配置已清空，可以重新配网/);
  if(setup){assert.equal(f.element('setup').hidden,true);assert.equal(f.element('recovery').hidden,false);}
  else assert.equal(f.w.UI.caps.config_recovery,true);
  await f.clickReset();assert.equal(f.writes().length,2);
 }finally{f.dom.window.close();}
});

for(const setup of [true,false])test(`${setup?'setup':'full'}: external clear refreshes capabilities and cached form without submitting another reset`,async()=>{
 const f=await fixture('m1',setup);try{
  f.ready();await f.refresh();assert.equal(f.element('ssid').value,'');assert.equal(f.writes().length,0);
  if(setup){assert.equal(f.element('recovery').hidden,true);assert.equal(f.element('setup').hidden,false);}
  else assert.equal(f.w.UI.caps.config_recovery,false);
 }finally{f.dom.window.close();}
});

for(const setup of [true,false])test(`${setup?'setup':'full'}: a read started before the reset cannot complete it`,async()=>{
 const f=await fixture('m1',setup);try{
  let release;f.holdRead(new Promise(resolve=>release=resolve));
  const old=f.refresh();await settle();const reset=f.clickReset();await settle();
  assert.equal(f.writes().length,0,'reset waits for the in-flight read in the serial HTTP queue');
  f.caps.config_recovery=false;release();await old;await reset;
  assert.equal(f.writes().length,1);assert.equal(f.reset().disabled,true);assert.doesNotMatch(f.text(),/配置已清空，可以重新配网/);
  await f.refresh();assert.equal(f.reset().disabled,true);f.ready();await f.refresh();assert.equal(f.reset().disabled,false);
 }finally{f.dom.window.close();}
});

test('full: automatic recovery polling reads complete post-reset network defaults',async()=>{
 const f=await fixture();try{
  f.ready();await f.refresh(false);
  const status=f.calls.filter(r=>r.action==='status.get').at(-1);
  assert.deepEqual(status.params,{},'recovery polling cannot use a live view without network fields');
  assert.equal(f.element('ssid').value,'');assert.equal(f.w.UI.caps.config_recovery,false);
 }finally{f.dom.window.close();}
});

for(const model of ['a1','m1','tc1','daikin'])test(`${model}: newly opened setup page uses current recovery state`,async()=>{
 const f=await fixture(model,true,false);try{
  assert.equal(f.element('setup').hidden,false);assert.equal(f.element('recovery').hidden,true);
  f.element('ssid').value='unsaved';await f.refresh();assert.equal(f.element('ssid').value,'unsaved');
 }finally{f.dom.window.close();}
});
