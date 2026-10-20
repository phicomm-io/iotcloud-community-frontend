const {test}=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
test('M1 pressure stays inline, follows detected model and expires without a successful poll',async()=>{
 const html=require('./render_page.cjs')('M1/web/index.html');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://device.local'}),w=dom.window;
 try{
  let now=100,timer,cleared=false;
  w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.setTimeout=()=>0;
  w.setInterval=fn=>{timer=fn;return 1;};
  w.clearInterval=()=>{cleared=true;};
  Object.defineProperty(w.performance,'now',{value:()=>now});
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  scripts.forEach((source,i)=>{
   if(i===scripts.length-1){w.UI.start=dev=>{w.UI.device=dev;};w.UI.reload=async()=>{};}
   vm.runInContext(source,dom.getInternalVMContext());
  });
  const row=w.document.getElementById('pressureReading'),value=w.document.getElementById('pressureValue');
  const base={sensor_received:true,sensor_valid:true,age_ms:100,pm25:20,formaldehyde:.02,temperature:25,humidity:50};
  function render(barometer,extra={}){w.UI.state={...base,...extra,barometer};w.UI.device.onStatus(w.UI.state);}
  const sensor={model:'BMP388',chip_id:0x50,address:0x77,ready:true,valid:true,age_ms:100,pressure_hpa:1013.24};
  render();assert.equal(row.hidden,true,'old firmware stays unchanged');
  render({...sensor,ready:false,valid:false,pressure_hpa:null});assert.equal(row.hidden,true);
  const cards=w.document.querySelectorAll('.card').length;
  render(sensor);assert.equal(row.hidden,false);assert.equal(value.textContent,'1013.2');
  assert.match(row.textContent,/hPa · BMP388/);assert.equal(row.closest('.card').id,'verdict');
  assert.equal(w.document.querySelectorAll('.card').length,cards,'no pressure card');
  render({...sensor,model:'BMP390',chip_id:0x60,address:0x76,pressure_hpa:815.77});
  assert.equal(value.textContent,'815.8','do not conceal or correct an unusual reading');
  assert.match(row.textContent,/BMP390/);
  for(const patch of [{ready:false},{valid:false},{model:'BMP280'},{age_ms:10000},
   {age_ms:-1},{age_ms:null},{pressure_hpa:null},{pressure_hpa:NaN},{pressure_hpa:Infinity},
   {pressure_hpa:'1013.2'},{pressure_hpa:0},{pressure_hpa:1250.1}]){
   render({...sensor,...patch});assert.equal(row.hidden,true);assert.equal(value.textContent,'');
  }
  render(sensor,{sensor_valid:false,sensor_received:false});
  assert.equal(row.hidden,false,'pressure is independent of the original UART sensor');
  w.UI.confirmed=w.UI.state;
  w.command=async()=>{throw Object.assign(Error('rejected'),{code:'invalid'});};
  now+=9000;
  await assert.rejects(w.UI.control('display.set',{brightness:25},{brightness_requested:1}),/rejected/);
  assert.equal(row.hidden,false,'optimistic and final control renders keep an unexpired measurement');
  now+=899;timer();assert.equal(row.hidden,false);
  now++;timer();assert.equal(row.hidden,true,'age plus elapsed time expires at 10 seconds');
  w.UI.device.onStatus(w.UI.state);
  assert.equal(row.hidden,true,'rendering the same measurement cannot restore stale pressure');
  render({...sensor,age_ms:0});assert.equal(row.hidden,false,'recovery displays fresh reading');
  w.dispatchEvent(new w.PageTransitionEvent('pagehide',{persisted:true}));
  assert.equal(cleared,false,'cache suspension must not permanently cancel expiry');
  now+=10000;
  w.dispatchEvent(new w.PageTransitionEvent('pageshow',{persisted:true}));
  assert.equal(row.hidden,true,'cache restoration expires pressure before another successful poll');
  render({...sensor,age_ms:0});now+=10000;timer();
  assert.equal(row.hidden,true,'periodic expiry remains active after restoration');
  render();assert.equal(row.hidden,true,'missing sensor clears last value immediately');
 }finally{dom.window.close();}
});
