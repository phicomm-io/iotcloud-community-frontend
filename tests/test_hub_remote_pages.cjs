const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {JSDOM}=require('jsdom');
const render=require('./render_page.cjs');
const settle=async()=>{for(let i=0;i<16;i++)await new Promise(resolve=>setImmediate(resolve));};

async function fixture(model,remote){
 const dom=new JSDOM(render(model.toUpperCase()+'/web/index.html'),{url:'http://device.local',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 Object.assign(w,{TextEncoder,TextDecoder,structuredClone});w.scrollTo=()=>{};
 const timers=[];w.setTimeout=(callback,ms)=>{timers.push({callback,ms});return timers.length;};w.setInterval=()=>0;
 w.eval(readFileSync('common/web/demo.js','utf8'));
 const demo=w.PhicommDemo.create(model),calls=[];
 const caps={...demo.command('capabilities.get'),hub_remote:remote};
 caps.actions=remote?['status.get','capabilities.get','diagnostics.get',...(model==='m1'?['display.set']:['fan.set','filter.get','light.set'])]:[...caps.actions];
 if(model==='m1')caps.actions.push('wake_alarm.get','wake_alarm.start','wake_alarm.stop',...(!remote?['music.get']:[]));
 else{caps.fresh_air=true;caps.actions.push('fresh_air.config.get','fresh_air.linkage.get','fresh_air.set');}
 let release;const initialCaps=new Promise(resolve=>{release=resolve;});
 w.fetch=async(url,options)=>{
  assert.equal(url,'/api/v1/command');const request=JSON.parse(options.body);calls.push(request);
  if(request.action==='capabilities.get')await initialCaps;
  const data=request.action==='capabilities.get'?caps:request.action==='wake_alarm.get'?{active:false,tone_supported:true,tone_count:4,music_supported:true}:demo.command(request.action,request.params);
  return {ok:true,status:200,json:async()=>({code:'ok',data})};
 };
 require('./legacy_device_fixture.cjs')(w);
 for(const script of w.document.scripts)w.eval(script.textContent);
 await settle();
 assert.deepEqual(calls.map(call=>call.action),['capabilities.get'],'auxiliary reads wait for the capability handshake');
 release();await settle();
 return {dom,w,calls,async poll(){const pending=timers.splice(0);for(const timer of pending)if(timer.ms===5000)timer.callback();await settle();}};
}

for(const model of ['m1','a1'])for(const remote of [true,false])test(`${model} ${remote?'remote':'local'} helpers obey the advertised read capabilities`,async()=>{
 const f=await fixture(model,remote);try{
  if(!remote)assert.equal(f.calls.filter(call=>call.action==='binding.status.get').length,1,'local helpers load immediately after capabilities');
  await f.poll();
  assert(f.calls.some(call=>call.action==='status.get'));
  assert(f.w.UI.state,JSON.stringify({calls:f.calls,banners:f.w.document.getElementById('banners').textContent}));
  const auxiliaries=f.calls.filter(call=>['binding.status.get','light_effect.get'].includes(call.action)).map(call=>call.action);
  if(remote){
   assert.deepEqual(auxiliaries,[]);
   assert(f.calls.every(call=>f.w.UI.caps.actions.includes(call.action)),f.calls.map(call=>call.action).join(','));
   assert.equal(f.w.document.getElementById(model==='m1'?'peerCard':'autoCard').hidden,true);
   if(model==='a1'){
    assert.equal(f.w.document.getElementById('filterCard').hidden,false,'readable filter usage stays visible');
    assert.equal(f.w.document.getElementById('filterForm').hidden,true);
    assert.equal(f.w.document.getElementById('filterReset').hidden,true);
    assert.equal(f.w.document.querySelector('#effectNote a'),null);
    assert.equal(f.w.document.querySelectorAll('#freshAirCard a').length,0);
    assert(f.w.document.querySelector('#freshAirCard input[type="range"]'),'new-air controls stay visible');
   }else{
    assert.notEqual(f.w.document.querySelector('#metrics .num').textContent,'—','ordinary sensor readings stay visible');
    assert(f.calls.some(call=>call.action==='wake_alarm.get'));
    assert.equal(f.calls.some(call=>call.action.startsWith('music.')),false,'remote wake support does not grant music management');
    assert.equal(f.w.document.getElementById('m1Music').hidden,true);
   }
  }else{
   assert(auxiliaries.includes('binding.status.get'));
   assert.equal(auxiliaries.filter(action=>action==='binding.status.get').length,2,'one periodic read follows the initial capability read');
   assert.equal(f.w.document.getElementById(model==='m1'?'peerCard':'autoCard').hidden,false);
   if(model==='a1'){
    assert(auxiliaries.includes('light_effect.get'));
    assert.equal(f.w.document.getElementById('filterForm').hidden,false);
    assert.equal(f.w.document.getElementById('filterReset').hidden,false);
    assert(f.w.document.querySelector('#effectNote a'));
    assert.equal(f.w.document.querySelectorAll('#freshAirCard a').length,2);
   }
  }
 }finally{f.dom.window.close();}
});
