// Serve the real minified M1 page with a controlled status endpoint.
const {chromium,webkit}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const html=require('node:child_process').execFileSync('python3',['common/web/page.py','M1/web/index.html','--minify']);
const engine=process.env.BROWSER||'chromium';
let barometer,failStatus=false;
const base={model:'m1',version:'test',device_id:'aabbccddeeff',name:'房间空气质量',wifi_connected:true,
 mqtt_connected:true,mqtt_status:'ready',mqtt_host:'broker',mqtt_user:'test',mqtt_port:1883,
 sensor_received:true,sensor_valid:true,age_ms:100,pm25:20,formaldehyde:.02,temperature:25,humidity:50,
 brightness_requested:2,timezone_minutes:480,ntp_host:'pool.ntp.org',ntp_synced:true,ntp_status:'synced',
 scd40:{serial:'test',ready:true,valid:true,age_ms:100,co2_ppm:646}};
const server=http.createServer((req,res)=>{
 if(req.method==='GET'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
  const request=JSON.parse(body);
  if(failStatus&&request.action==='status.get'){res.writeHead(503).end();return;}
  const data=request.action==='status.get'?{...base,barometer}:request.action==='capabilities.get'?{actions:['status.get']}:{};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:'ok',data}));
 });
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await ({chromium,webkit}[engine]).launch({headless:true});
 const evidence=path.resolve('build/evidence/m1-pressure');fs.mkdirSync(evidence,{recursive:true});
 try{for(const width of [1280,390,320]){
  failStatus=false;barometer=undefined;
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install();
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.UI?.state);
  assert.equal(await page.locator('#pressureReading').isVisible(),false);
  const count=await page.locator('#homePage .card').count();
  for(const [model,id,address,value] of [['BMP388',0x50,0x77,1013.24],['BMP390',0x60,0x76,815.77]]){
   barometer={model,chip_id:id,address,ready:true,valid:true,age_ms:0,pressure_hpa:value};
   await page.evaluate(()=>UI.reload());
   assert.equal(await page.locator('#pressureReading').isVisible(),true);
   assert.equal(await page.locator('#pressureValue').textContent(),value.toFixed(1));
   assert.equal(await page.locator('#pressureModel').textContent(),model);
   assert.equal(await page.locator('#homePage .card').count(),count);
   assert.equal(await page.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:path.join(evidence,`${engine}-${width}-${model}.png`),fullPage:true});
  }
  failStatus=true;
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  await page.clock.fastForward(11000);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  assert.equal(await page.locator('#pressureReading').isVisible(),false,'failed polls cannot keep pressure fresh');
  failStatus=false;barometer={...barometer,model:'BMP388',chip_id:0x50};
  await page.evaluate(()=>UI.reload());assert.equal(await page.locator('#pressureReading').isVisible(),true);
  barometer={...barometer,valid:false,ready:false,pressure_hpa:null};
  await page.evaluate(()=>UI.reload());assert.equal(await page.locator('#pressureReading').isVisible(),false);
  assert.deepEqual(errors,[]);await page.close();
  console.log(`${engine} ${width}: inline pressure, both models, expiry, recovery and layout PASS`);
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
