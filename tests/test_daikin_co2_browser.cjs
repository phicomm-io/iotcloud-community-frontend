const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs');
const html=process.env.PHICOMM_DAIKIN_HTML?fs.readFileSync(process.env.PHICOMM_DAIKIN_HTML,'utf8'):require('./render_page.cjs')('DAIKIN/web/index.html');
let calibration='never',writes=[];
const state=()=>({model:'daikin',name:'CO2 test',hardware_model:'BRY88AX151K',wifi_connected:true,co2_warmup_seconds_remaining:0,
 sensors:{co2:{valid:calibration==='never',value:calibration==='never'?946:null,age_ms:0}},
 co2_diagnostics:{calibration_available:calibration==='never',cooldown_seconds:calibration==='never'?0:60,calibration:{state:calibration}}});
const server=http.createServer((req,res)=>{
 // This business fixture represents legacy firmware without token endpoints.
 if(req.url==='/api/v1/info'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({code:'ok',data:{api_version:1,device_id:'aabbccddeeff',model:'daikin',version:'legacy'}}));return;}
 if(req.url==='/api/v1/auth/login'){res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({code:'not_found'}));return;}
 if(req.method==='GET'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  const {action,params}=JSON.parse(body);let data={};
  if(action==='status.get'||action==='config.get')data=state();
  if(action==='capabilities.get')data={model:'daikin',actions:['status.get','config.get','diagnostics.get','co2.calibrate'],diagnostics_schema:1,business_status:true};
  if(action==='diagnostics.get')data={schema:1,fields:[[77,true],[81,946],[82,64],[83,0],[90,true]]};
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
  await page.waitForFunction(()=>document.querySelector('#co2Diagnostic')?.textContent.includes('946'),null,{timeout:10000}).catch(async error=>{console.error('DAIKIN detail diagnostic did not render',{text:await page.locator('#co2Diagnostic').textContent().catch(()=>''),errors,debug:await page.evaluate(()=>({page:UI.activePage(),pages:UI.device.diagnosticPages,actions:UI.caps.actions}))});throw error;});await page.evaluate(lang=>I18N.set(lang),lang);
  assert(await page.evaluate(()=>UI.device.diagnosticPages.includes('device')));
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
