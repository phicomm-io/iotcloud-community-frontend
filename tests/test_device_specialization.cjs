const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {JSDOM}=require('../frontend/node_modules/jsdom');
const minify=require('../tools/minify_device.cjs'),styles=require('../tools/trim_device_styles.cjs');

test('dead product branches disappear before translation collection; shared builds retain them',async()=>{
 const html=`<script>(()=>{const D={'mcu.query':['MCU','主控'],'fan.name':['Fan','风机'],'dynamic.one':['One','一']};window.dictionary=D;})();</script><script>const PRODUCT=/* @device-product */null;if(PRODUCT===null?window.isM1:PRODUCT==='m1')use('mcu.query');else use('fan.name');use('dynamic.'+window.suffix);</script>`;
 for(const [deviceModel,expected,absent] of [['a1','fan.name','mcu.query'],['m1','mcu.query','fan.name'],[null,'mcu.query',null]]){
  const packed=await minify(html,{deviceModel}),context={use:()=>{},suffix:'one'};context.window=context;
  for(const script of packed.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInNewContext(script[1],context);
  assert.ok(context.dictionary[expected]);assert.ok(context.dictionary['dynamic.one']);
  if(absent)assert.equal(context.dictionary[absent],undefined);else assert.ok(context.dictionary['fan.name']);
 }
});

test('product style pruning retains common rules, optional hardware, and functional selectors',()=>{
 const css='.common,.ring,.particle-grid,.tiles{color:red}@media(max-width:700px){.ring .ring-guide{fill:none}.particle-grid{display:grid}.tiles{gap:2px}.common:not(.ring){color:blue}}';
 for(const [model,keep,drop] of [['a1','.ring','.particle-grid'],['m1','.particle-grid','.tiles'],['tc1','.tiles','.particle-grid']]){
  const packed=styles(css,model);assert.ok(packed.includes(keep));assert.ok(!packed.includes(drop));
  assert.ok(packed.includes('.common'));assert.ok(packed.includes(':not(.ring)'));
 }
 assert.equal(styles(css,null),css);
});

test('actual native product editors retain the complete firmware action upper bounds',async()=>{
 const cp=require('node:child_process');
 const bounds={a1:['fan.panel','fan.mode.set','fan.mode.toggle','fan.set','light.set','child_lock.set','system.reboot','light_effect.next','light_effect.select','filter.reset','light_always.set'],m1:['display.set','system.reboot','wake_alarm.start'],tc1:['outlet.set','child_lock.set','indicator.set','system.reboot']};
 const all=Object.values(bounds).flat(),sources={a1:'A1/web/index.html',m1:'M1/web/index.html',tc1:'TC1/http_server/web/index.html'};
 for(const [model,bound] of Object.entries(bounds)){
  const html=cp.execFileSync('python3',['common/web/page.py',sources[model],'--minify'],{encoding:'utf8'});
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
  try{
   w.TextEncoder=TextEncoder;w.deviceParentTransport=true;w.setTimeout=()=>0;w.scrollTo=()=>{};
   w.fetch=async()=>({ok:true,status:200,json:async()=>({code:'ok',data:{items:[]}})});
   const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
   scripts.forEach((source,i)=>{if(i===scripts.length-1)w.UI.start=dev=>{w.UI.device=dev;};vm.runInContext(source,dom.getInternalVMContext());});
   w.I18N.set('en');w.UI.caps={model,actions:[...all,'schedules.get','buttons.set','night.get','filter.get'],button_keys:['combination']};
   const dev={...w.UI.device,hasButtons:true},pages=w.automationPages(dev);
   const select=[...pages.buttons.el.querySelectorAll('[data-button-editor] select')].find(el=>[...el.options].some(option=>option.value==='none')); 
   assert.deepEqual([...select.options].map(option=>option.value),['none',...bound.filter(action=>action!=='wake_alarm.start')],model+' button actions preserve order');
   const scheduled=[...pages.schedule.el.querySelectorAll('[data-value]')].map(el=>el.dataset.value).filter(value=>all.includes(value));
   assert.deepEqual(scheduled,bound.filter(action=>!['light_effect.next','light_effect.select','filter.reset','fan.mode.toggle','fan.panel'].includes(action)),model+' schedule actions preserve order');
   assert.equal(!!pages.night,model!=='tc1');
   const css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
   if(model==='m1')for(const selector of ['.particle-grid','.metrics.with-co2','.indicator-rule'])assert.ok(css.includes(selector),selector+' optional hardware remains');
   if(model==='a1')assert.ok(css.includes('.ring-light-segment'));
   for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
  }finally{w.close();}
 }
});
