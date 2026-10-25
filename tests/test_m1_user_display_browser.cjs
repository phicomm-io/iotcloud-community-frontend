// Real minified native page, controlled HTTP endpoint, no physical device.
const {chromium,webkit,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=require('node:child_process').execFileSync('python3',['common/web/page.py','M1/web/index.html','--minify']);
const sandbox={window:{},structuredClone,performance};vm.runInNewContext(fs.readFileSync('common/web/demo.js','utf8'),sandbox);
const engine=process.env.BROWSER||'chromium',evidence=path.resolve(process.env.M1_DISPLAY_EVIDENCE||'build/evidence/m1-user-display');
let fixture,calls=[],nullRead=false;
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method==='GET'){
   if(req.url!=='/'){res.writeHead(404).end();return;}
   fixture=sandbox.window.PhicommDemo.create('m1');calls=[];nullRead=false;
   res.writeHead(200,{'Content-Type':'text/html'}).end(html);return;
  }
  let body='';for await(const chunk of req)body+=chunk;
  const request=JSON.parse(body);calls.push(request);
  const data=request.action==='display_source.get'&&nullRead?null:fixture.command(request.action,request.params);
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({code:request.action.endsWith('.get')?'ok':'accepted',data}));
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({code:error.message}));}
});
(async()=>{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));fs.mkdirSync(evidence,{recursive:true});
 const browser=await ({chromium,webkit}[engine]).launch({headless:true,...(engine==='webkit'&&process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH?{executablePath:process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH}:{})});
 try{for(const language of ['en','zh-CN'])for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:950},locale:language}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(value=>localStorage.setItem('phicomm.language',value),language);
  await page.goto(`http://127.0.0.1:${server.address().port}/#settings/device`);
  const card=page.locator('#displaySourceConfig');await expect(card).toBeVisible();await expect(page.locator('#displaySourceSave')).toBeEnabled();
  await expect(card.getByRole('heading',{name:language==='en'?'User readings on the device screen':'设备屏幕用户读数',exact:true})).toBeVisible();
  await expect(page.locator('#co2SourceConfig')).toBeHidden();
  await page.locator('#displaySelectedSource').selectOption('user');await page.locator('#displayDoubleClick').selectOption('switch_display');
  await page.locator('#display0Source').selectOption('api');await page.locator('#display0Metric').selectOption('power');
  await page.locator('#display0Color').selectOption('red');
  await page.locator('#display1Source').selectOption('local');await page.locator('#display1Metric').selectOption('pm25');
  await page.locator('#display1ColorMode').selectOption('thresholds');await page.locator('#display1Low').fill('15');await page.locator('#display1High').fill('35');
  await page.locator('#displaySourceSave').click();await expect(page.locator('#display0Write')).toBeEnabled();
  const set=calls.find(request=>request.action==='display_source.set');assert(set);assert.equal(set.params.lanes.length,2);
  assert.equal(set.params.double_click,'switch_display');assert.equal(set.params.lanes[0].source,'api');assert.equal(set.params.lanes[1].source,'local');
  assert.equal(calls[calls.indexOf(set)+1].action,'display_source.get','configuration receipt must be followed by independent readback');
  await expect(page.locator('#displaySourceStatus')).toContainText(language==='en'?'Waiting for controller confirmation':'等待控制器确认');
  await expect(page.locator('#display1Status')).toContainText('18 µg/m³');
  await page.locator('#display0Value').fill('42');await page.locator('#display0WriteTTL').fill('10');await page.locator('#display0Write').click();
  await expect(page.locator('#display0Status')).toContainText('42 W');await expect(page.locator('#display0Preview')).toContainText('42');
  const data=calls.find(request=>request.action==='display_data.set');assert.deepEqual(data.params,{revision:2,slot:0,value:42,unit:'W',ttl_seconds:10});
  assert.equal(calls[calls.indexOf(data)+1].action,'display_source.get');
  await page.locator('#display0Clear').click();await expect(page.locator('#display0Status')).toContainText(language==='en'?'Waiting for a reading':'等待读数');
  await expect(page.locator('#display1Status')).toContainText('18 µg/m³');
  nullRead=true;await page.locator('#display0Write').click();
  await expect(page.locator('#toasts .toast.bad')).toBeVisible();nullRead=false;
  const overflow=await page.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`${engine} ${language} ${width} overflow`);
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(evidence,`${engine}-${language}-${width}.png`),fullPage:true});
  await page.locator('body').evaluate(()=>{location.hash='';});await expect(page.locator('#homePage')).toBeVisible();
  await page.locator('body').evaluate(()=>{location.hash='settings/device';});await expect(card).toBeVisible();
  await context.close();console.log(`PASS ${engine} ${language} ${width}: native two-position save/readback, API write/clear, null failure, pending controller and navigation`);
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
