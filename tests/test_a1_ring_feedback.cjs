const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
test('A1 ring animation never polls; successful controls enable bounded non-overlapping feedback',async()=>{
 const html=require('./render_page.cjs')('A1/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  let now=0,id=0,reads=0,fail=false,hold=null;const timers=new Map(),intervals=new Map();
  Object.defineProperty(w.performance,'now',{value:()=>now});
  w.setTimeout=(fn,ms)=>{timers.set(++id,{fn,ms});return id;};w.clearTimeout=i=>timers.delete(i);
  w.setInterval=(fn,ms)=>{intervals.set(++id,{fn,ms});return id;};w.clearInterval=i=>intervals.delete(i);
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};
  w.fetch=async(url,options)=>{const r=JSON.parse(options.body);return {ok:true,json:async()=>({code:fail&&r.action==='fan.set'?'busy':'ok',data:r.action==='light_effect.get'?{effect:2,segments:3,segment:[]}: {}})};};
  require('./legacy_device_fixture.cjs')(w);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((s,i)=>{if(i===scripts.length-1){w.UI.start=dev=>w.UI.device=dev;w.UI.reload=async()=>{reads++;if(hold)await hold;return w.UI.state;};}vm.runInContext(s,dom.getInternalVMContext());});
  await flush();w.UI.state={applied_speed:0,percentage:60};w.document.getElementById('homePage').hidden=false;
  Object.defineProperty(w.document,'hidden',{value:false,configurable:true});
  const animation=[...intervals.values()].find(t=>t.ms===50);assert(animation);
  for(let i=0;i<100;i++){now+=50;animation.fn();}await flush();assert.equal(reads,0,'ramping and animated effects never initiate reads');
  const speed=w.document.getElementById('speed');speed.value=70;speed.dispatchEvent(new w.Event('change'));await flush();assert.equal(reads,1,'write refresh remains immediate');
  const tick=async()=>{const t=[...timers.entries()].find(([,t])=>t.ms===500);assert(t);timers.delete(t[0]);now+=500;t[1].fn();await flush();};
  let release;hold=new Promise(r=>release=r);await tick();assert.equal(reads,2);assert.equal([...timers.values()].filter(t=>t.ms===500).length,0,'no overlapping feedback reads');
  now+=4500;release();hold=null;await flush();assert.equal([...timers.values()].filter(t=>t.ms===500).length,0,'slow response cannot prolong the window');
  speed.dispatchEvent(new w.Event('change'));await flush();
  const before=reads;for(let i=0;i<8;i++)await tick();
  assert.equal(reads-before,8,'at most eight extra reads per four-second window');
  assert.equal([...timers.values()].filter(t=>t.ms===500).length,0);
  speed.dispatchEvent(new w.Event('change'));await flush();
  Object.defineProperty(w.document,'hidden',{value:true,configurable:true});
  const hiddenReads=reads;await tick();assert.equal(reads,hiddenReads,'hidden pages do not poll');
  Object.defineProperty(w.document,'hidden',{value:false,configurable:true});
  speed.dispatchEvent(new w.Event('change'));await flush();assert([...timers.values()].some(t=>t.ms===500));
  w.dispatchEvent(new w.Event('pagehide'));assert.equal([...timers.values()].filter(t=>t.ms===500).length,0);assert.equal([...intervals.values()].filter(t=>t.ms===50).length,0);
  w.dispatchEvent(new w.Event('pageshow'));assert.equal([...intervals.values()].filter(t=>t.ms===50).length,1);
  fail=true;speed.dispatchEvent(new w.Event('change'));await flush();assert.equal([...timers.values()].filter(t=>t.ms===500).length,0,'rejected write does not start feedback');
 }finally{dom.window.close();}
});
