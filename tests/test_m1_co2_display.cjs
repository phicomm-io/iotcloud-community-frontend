const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
test('M1 screen CO2 controls require MCU and sensor, preserve editing and submit revision',async()=>{
 const html=require('./render_page.cjs')('M1/web/index.html');
 const dom=new JSDOM(html,{pretendToBeVisual:true,runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
  const calls=[];
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{
   if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;};w.UI.reload=async()=>{};w.UI.control=async(...args)=>calls.push(args);}
   vm.runInContext(source,dom.getInternalVMContext());
  });
  const base={sensor_received:true,sensor_valid:false,age_ms:100,pm25:null,formaldehyde:null,temperature:null,humidity:null};
  const sensor={serial:'module',ready:false,valid:false,age_ms:30000,co2_ppm:null};
  const cfg={available:true,mcu_supported:true,module_present:true,mode:2,slot:0,interval_seconds:5,low:1000,high:1500,revision:7};
  const card=w.document.getElementById('co2DisplayConfig');
  function render(co2_display,scd40){w.UI.state={...base,co2_display,scd40};w.UI.device.onStatus(w.UI.state);}
  render();assert.equal(card.hidden,true);
  render({...cfg,mcu_supported:false},sensor);assert.equal(card.hidden,true);
  render({...cfg,module_present:false},sensor);assert.equal(card.hidden,true);
  render(cfg,{...sensor,serial:''});assert.equal(card.hidden,false,'an external source does not require a local SCD40');
  render(cfg,sensor);assert.equal(card.hidden,false,'identified stale module can configure display');
  const interval=w.document.getElementById('co2DisplayInterval');
  assert.equal(interval.value,'5');interval.value='9';interval.dispatchEvent(new w.Event('input',{bubbles:true}));
  render(cfg,sensor);assert.equal(interval.value,'9','poll does not overwrite edits');
  card.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);assert.equal(calls[0][0],'co2_display.set');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])),{mode:2,slot:0,interval_seconds:9,low:1000,high:1500,revision:7});
  render({...cfg,revision:8,interval_seconds:9},sensor);assert.equal(interval.value,'9');
 }finally{dom.window.close();}
});
