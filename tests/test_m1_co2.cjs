const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
test('M1 CO2 identification, fresh values, expiration and old firmware',()=>{
 const html=require('./render_page.cjs')('M1/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{
   if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;};w.UI.reload=async()=>{};}
   vm.runInContext(source,dom.getInternalVMContext());
  });
  const base={sensor_received:true,sensor_valid:true,age_ms:100,pm25:20,formaldehyde:.02,temperature:25,humidity:50};
  const card=w.document.getElementById('co2Card'),value=w.document.getElementById('co2Value');
  function render(scd40){w.UI.state={...base,scd40};w.UI.device.onStatus(w.UI.state);}
  render();assert.equal(card.hidden,true);
  render({bus_initialized:true,ready:false,serial:'',samples:0});assert.equal(card.hidden,true);
  const sensor={serial:'f701a3073b32',samples:4,ready:true,valid:true,age_ms:100,co2_ppm:646};
  render({...sensor,valid:false,age_ms:30000,co2_ppm:null});assert.equal(card.hidden,true,'fresh page hides expired sensor');
  render(sensor);assert.equal(card.hidden,false);assert.equal(value.textContent,'646');
  assert.equal(card.querySelectorAll('.scale i').length,3);
  for(const [ppm,cls] of [[1000,'ok'],[1001,'warn'],[1500,'warn'],[1501,'bad']]){
   render({...sensor,co2_ppm:ppm});assert.ok(card.querySelector('.badge').classList.contains(cls));
  }
  render(sensor);
  for(const patch of [{valid:false},{ready:false},{age_ms:20000},{co2_ppm:null},{co2_ppm:0},{co2_ppm:NaN}]){
   render({...sensor,...patch});assert.equal(card.hidden,false);assert.equal(value.textContent,'646');assert.equal(value.style.color,'var(--muted)');assert.match(card.textContent,/Outdated|已过期/);
  }
  render({...sensor,serial:'another',valid:false,co2_ppm:null});assert.equal(value.textContent,'—');assert.equal(card.hidden,true);
  render(sensor);render();assert.equal(card.hidden,false,'current session retains last reading even when sensor disappears');assert.match(card.textContent,/Outdated|已过期/);
 }finally{dom.window.close();}
});
