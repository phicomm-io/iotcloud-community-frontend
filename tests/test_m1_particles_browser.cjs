const {chromium,webkit}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const html=require('node:child_process').execFileSync('python3',['common/web/page.py','M1/web/index.html','--minify']);
const engine=process.env.BROWSER||'chromium';let supported=true,available=true;
const base={model:'m1',version:'test',device_id:'aabbccddeeff',name:'房间空气质量',wifi_connected:true,mqtt_connected:true,mqtt_status:'ready',sensor_received:true,sensor_valid:true,age_ms:100,pm25:19,formaldehyde:.02,temperature:25,humidity:50,brightness_requested:2};
const details=()=>({supported,available,fresh:available,healthy:available,age_ms:628,pm:{atmospheric_ug_m3:{pm1:13,pm25:19,pm10:19},cf1_ug_m3:{pm1:13,pm25:19,pm10:19},particles_per_0_1_l:{gt_0_3:2196,gt_0_5:639,gt_1_0:114,gt_2_5:0,gt_5_0:0,gt_10_0:0}},diagnostics:{sht_aux:{raw_hex:'039ce8ad8480'}}});
const server=http.createServer((req,res)=>{
 if(req.method==='GET'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  const {action}=JSON.parse(body);const data=action==='status.get'?base:action==='sensor_details.get'?details():action==='capabilities.get'?{actions:['status.get','sensor_details.get']}:{};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:'ok',data}));
 });
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await ({chromium,webkit}[engine]).launch({headless:true});
 const out=path.resolve('build/evidence/m1-particles');fs.mkdirSync(out,{recursive:true});
 try{for(const width of [1280,390,320]){
  supported=available=true;const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>document.querySelector('#particleCard dd span')?.textContent==='13');
  assert.equal(await page.locator('#particleCard').isVisible(),true);
  assert.equal(await page.locator('#particleCard dd span').nth(5).textContent(),'0');
  assert(!await page.locator('#particleCard').textContent().then(t=>t.includes('PM2.5')));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify(await page.locator("body *").evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>[e.outerHTML,e.parentElement.outerHTML,e.getBoundingClientRect().right]))));
  await page.screenshot({path:path.join(out,`${engine}-${width}.png`),fullPage:true});
  available=false;await page.clock.fastForward(3000);await page.waitForFunction(()=>document.querySelector('#particleCard dd span')?.textContent==='—');
  supported=false;await page.clock.fastForward(3000);await page.waitForFunction(()=>document.querySelector('#particleCard').hidden);
  supported=available=true;await page.clock.fastForward(3000);await page.waitForFunction(()=>document.querySelector('#particleCard dd span')?.textContent==='13');
  await page.route('**/api/v1/command',route=>route.abort());await page.clock.fastForward(7000);
  assert.equal(await page.locator('#particleCard dd span').first().textContent(),'—');
  assert.deepEqual(errors,[]);await page.close();console.log(`${engine} ${width}: particle card, zero, unavailable, legacy, recovery and expiry PASS`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
