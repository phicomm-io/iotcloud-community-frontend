const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),cp=require('node:child_process'),vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('A1 mode controls, idle state, automatic cap and manual speed remain distinct',async()=>{
 const html=cp.execFileSync('python3',['common/web/page.py','A1/web/index.html'],{encoding:'utf8'});
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
  const writes=[];
  w.fetch=async(url,options)=>{const req=JSON.parse(options.body);writes.push(req);return {ok:true,json:async()=>({code:'ok',data:{linkage_status:'disabled',effect:0}})};};
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;};w.UI.reload=async()=>w.UI.state;}vm.runInContext(source,dom.getInternalVMContext());});
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
