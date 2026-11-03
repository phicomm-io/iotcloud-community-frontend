const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
test('A1 ring animation never polls; fan controls share bounded confirmation without a private read loop',async()=>{
 const html=require('./render_page.cjs')('A1/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  let now=0,id=0,reads=0;const controls=[],timers=new Map(),intervals=new Map();
  Object.defineProperty(w.performance,'now',{value:()=>now});
  w.setTimeout=(fn,ms)=>{timers.set(++id,{fn,ms});return id;};w.clearTimeout=i=>timers.delete(i);
  w.setInterval=(fn,ms)=>{intervals.set(++id,{fn,ms});return id;};w.clearInterval=i=>intervals.delete(i);
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};
  w.fetch=async(url,options)=>{const r=JSON.parse(options.body);return {ok:true,json:async()=>({code:'ok',data:r.action==='light_effect.get'?{effect:2,segments:3,segment:[]}: {}})};};
  require('./legacy_device_fixture.cjs')(w);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((s,i)=>{if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;w.UI.caps={actions:['light_effect.get']};dev.capabilities(w.UI.caps);};w.UI.reload=async()=>{reads++;return w.UI.state;};w.UI.control=async(...args)=>controls.push(args);}vm.runInContext(s,dom.getInternalVMContext());});
  await flush();w.UI.state={applied_speed:0,percentage:60,fan_on:true};w.document.getElementById('homePage').hidden=false;
  Object.defineProperty(w.document,'hidden',{value:false,configurable:true});
  const animation=[...intervals.values()].find(t=>t.ms===50);assert(animation);
  for(let i=0;i<100;i++){now+=50;animation.fn();}await flush();assert.equal(reads,0,'ramping and animated effects never initiate reads');
  const speed=w.document.getElementById('speed');speed.value=70;speed.dispatchEvent(new w.Event('change'));await flush();assert.equal(controls.length,1);assert.equal(controls[0][0],'fan.set');assert.equal(controls[0][1].speed,70);assert.equal(controls[0][2].requested_speed,70);
  w.document.getElementById('power').click();await flush();assert.equal(controls[1][0],'fan.set');assert.equal(controls[1][2].fan_on,false);
  assert.equal(reads,0,'product controls delegate confirmation to the shared helper');assert.equal([...timers.values()].filter(t=>t.ms===500).length,0);
  w.dispatchEvent(new w.Event('pagehide'));assert.equal([...intervals.values()].filter(t=>t.ms===50).length,0);
  w.dispatchEvent(new w.Event('pageshow'));assert.equal([...intervals.values()].filter(t=>t.ms===50).length,1);
 }finally{dom.window.close();}
});
