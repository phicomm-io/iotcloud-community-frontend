const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs');
const html=process.env.PHICOMM_DAIKIN_HTML?fs.readFileSync(process.env.PHICOMM_DAIKIN_HTML,'utf8'):require('./render_page.cjs')('DAIKIN/web/index.html');
let calibration='never',writes=[];
const state=()=>({model:'daikin',name:'CO2 test',hardware_model:'BRY88AX151K',wifi_connected:true,co2_warmup_seconds_remaining:0,
 sensors:{co2:{valid:calibration==='never',value:calibration==='never'?946:null,age_ms:0}},
 co2_diagnostics:{fresh:true,raw_ppm:946,status_raw:64,drift:true,age_ms:0,calibration_available:calibration==='never',cooldown_seconds:calibration==='never'?0:60,calibration:{state:calibration}}});
const server=http.createServer((req,res)=>{
 if(req.method==='GET'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  const {action,params}=JSON.parse(body);let data={};
  if(action==='status.get'||action==='config.get')data=state();
  if(action==='capabilities.get')data={model:'daikin',actions:['status.get','config.get','co2.calibrate']};
  if(action==='binding.status.get')data={peers:[],max_sessions:4};
  if(action==='co2.calibrate'){writes.push(params);calibration='waiting_ack';data={state:'queued'};}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:action.endsWith('.get')?'ok':'accepted',data}));
 });
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const lang of ['en','zh-CN']){
  calibration='never';writes=[];
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/#settings/device');
  await page.locator('#co2Diagnostic').filter({hasText:'946'}).waitFor();await page.evaluate(lang=>I18N.set(lang),lang);
  assert.equal(await page.locator('#co2Calibrate').isDisabled(),true);
  await page.locator('#co2Reference').fill('430');await page.locator('#co2ReferenceStable').check();
  await page.locator('#co2Calibrate').click();await page.locator('dialog .ghost').click();assert.equal(writes.length,0);
  await page.locator('#co2Calibrate').click();await page.locator('dialog .primary').click();
  await page.waitForFunction(()=>document.querySelector('#co2CalibrationResult').textContent.match(/waiting for module acknowledgement|等待模块应答/));
  assert.deepEqual(writes,[{reference_ppm:430,reference_stable:true}]);
  assert.equal(await page.locator('#co2ReferenceStable').isChecked(),false);assert.equal(await page.locator('#co2Calibrate').isDisabled(),true);
  calibration='acknowledged';await page.evaluate(()=>UI.reload());
  assert.match(await page.locator('#co2CalibrationResult').textContent(),/Compare fresh readings|参照值比较/);
  calibration='timeout_unknown';await page.evaluate(()=>UI.reload());
  assert.match(await page.locator('#co2CalibrationResult').textContent(),/Outcome unknown|结果未知/);assert.equal(writes.length,1);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);assert.deepEqual(errors,[]);
  fs.mkdirSync('build',{recursive:true});await page.screenshot({path:`build/daikin-co2-${width}-${lang}.png`,fullPage:true});
  await page.close();console.log(`PASS Chromium ${width} ${lang}: reference, cancel, single write, ACK, unknown timeout, layout`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
