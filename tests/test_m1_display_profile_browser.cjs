// Real compressed/minified page; controlled HTTP state, never a physical device.
const {chromium,webkit,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=require('node:child_process').execFileSync('python3',['common/web/page.py','M1/web/index.html','--minify']);
let now=1000,samples={0:1234};
const sandbox={window:{},structuredClone,performance:{now:()=>now}};
vm.runInNewContext(fs.readFileSync('M1/web/display-format.js','utf8'),sandbox);
vm.runInNewContext(fs.readFileSync('common/web/demo.js','utf8'),sandbox);
const engine=process.env.BROWSER||'chromium',evidence=path.resolve(process.env.M1_DISPLAY_EVIDENCE||'build/evidence/m1-display-profile');
let fixture,calls=[],nullRead=false;
const cases=[];
const server=http.createServer(async(req,res)=>{
 // Existing business scenarios exercise firmware without token endpoints.
 if(req.url==='/api/v1/info'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({code:'ok',data:{api_version:1,device_id:'aabbccddeeff',model:'m1',version:'legacy'}}));return;}
 if(req.url==='/api/v1/auth/login'){res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({code:'not_found'}));return;}
 try{
  if(req.method==='GET'){
   if(req.url!=='/'){res.writeHead(404).end();return;}
   fixture=sandbox.window.PhicommDemo.create('m1');calls=[];nullRead=false;now=1000;samples={0:1234};
   res.writeHead(200,{'Content-Type':'text/html'}).end(html);return;
  }
  let body='';for await(const chunk of req)body+=chunk;
  const request=JSON.parse(body);calls.push(request);
  const data=request.action==='display_profile.get'&&nullRead?null:fixture.command(request.action,request.params);
  if(request.action==='display_profile.get'&&data){
   // Simulated fresh typed MQTT input; conversion still uses the production form helper.
   for(const lane of data.lanes)if(lane.source==='mqtt'&&Object.hasOwn(samples,lane.slot)){
    const value=Math.fround(samples[lane.slot]),f=sandbox.window.M1DisplayFormat,encoded=f.encode(lane.display,lane.slot,value);
    Object.assign(data.runtime.lanes[lane.slot],{valid:true,value,unit:lane.unit,age_ms:0,remaining_ttl_seconds:lane.ttl_seconds,effective:false,reason:'ok',
     number:encoded.number,format:encoded.format,lamps:lane.color.mode==='fixed'?lane.color.lamps:f.uniformLamps(value<lane.color.low?'green':value<lane.color.high?'yellow':'red'),confirmed:false});
   }
  }
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({code:request.action.endsWith('.get')?'ok':'accepted',data}));
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({code:error.message}));}
});
(async()=>{
 await new Promise(done=>server.listen(0,'127.0.0.1',done));fs.mkdirSync(evidence,{recursive:true});
 const browser=await ({chromium,webkit}[engine]).launch({headless:true,...(engine==='webkit'&&process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH?{executablePath:process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH}:{})});
 try{for(const language of ['en','zh-CN'])for(const width of [390,1440]){
  const context=await browser.newContext({viewport:{width,height:950},locale:language}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(value=>localStorage.setItem('phicomm.language',value),language);
  await page.goto(`http://127.0.0.1:${server.address().port}/#settings/device`);
  const card=page.locator('#displaySourceConfig');await expect(card).toBeVisible();await expect(page.locator('#displaySourceSave')).toBeEnabled();
  assert.equal(await card.count(),1);await expect(page.locator('#co2SourceConfig')).toBeHidden();
  await expect(card.getByRole('heading',{name:language==='en'?'User readings on the device screen':'设备屏幕用户读数',exact:true})).toBeVisible();
  await page.locator('#displaySelectedSource').selectOption('user');await page.locator('#displayDoubleClick').selectOption('switch_display');
  await page.locator('#display0Source').selectOption('mqtt');await page.locator('#display0Device').fill('AA:BB:CC:DD:EE:FF');await page.locator('#display0FieldId').fill('custom_co2');await page.locator('#display0SourceUnit').fill('ppm');await page.locator('#display0Mode').selectOption('auto_kilo');
  await expect(page.locator('#display0Mode option')).toHaveCount(5);await page.locator('#display0Label').check();await page.locator('#display0Glyph').uncheck();
  const segments=['0red','0green','1yellow','2green','2yellow'];for(const segment of segments)await page.locator('#display0Lamp'+segment).check();
  await page.locator('#display1Source').selectOption('api');await expect(page.locator('#display1Mode')).toBeHidden();await expect(page.locator('#display1Decimal')).toBeHidden();
  await page.locator('#displaySourceSave').click();await expect(page.locator('#display1Write')).toBeEnabled();
  let saved=calls.findLast(request=>request.action==='display_profile.set');assert(saved);assert.equal(saved.params.lanes[0].device_id,'aabbccddeeff');
  assert.equal(saved.params.lanes[0].field_id,'custom_co2');assert.equal(saved.params.lanes[0].type,'number');assert.equal(saved.params.lanes[0].unit,'ppm');assert.equal(Object.hasOwn(saved.params.lanes[0],'metric'),false);
  assert.deepEqual(saved.params.lanes[0].color.lamps,[{red:true,green:true,yellow:false},{red:false,green:false,yellow:true},{red:false,green:true,yellow:true}]);
  assert.equal(saved.params.lanes[1].metric,'custom');assert.equal(saved.params.lanes[1].unit,'');
  assert.equal(calls[calls.indexOf(saved)+1].action,'display_profile.get');assert.equal(calls.some(request=>request.action==='display_source.get'),false);
  await expect(page.locator('#display0Status')).toContainText('1234 ppm');await expect(page.locator('#display0Preview')).toContainText('1.23');await expect(page.locator('#display0Preview')).not.toContainText('mg/m³');
  await page.locator('#display1Value').fill('999');await page.locator('#display1WriteTTL').fill('10');await page.locator('#display1WriteGlyph').check();await page.locator('#display1WriteLabel').check();await page.locator('#display1WriteLamp2yellow').check();await page.locator('#display1Write').click();
  // A completed click does not imply its HTTP request has reached this fixture.
  await expect.poll(()=>calls.some(request=>request.action==='display_value.set')).toBe(true);await expect(page.locator('#display1Write')).toBeEnabled();
  let written=calls.findLast(request=>request.action==='display_value.set');assert.deepEqual(written.params,{revision:2,slot:1,number:999,decimal:false,show_label:true,show_unit:true,lamps:[{red:false,green:false,yellow:false},{red:false,green:false,yellow:false},{red:false,green:false,yellow:true}],ttl_seconds:10});
  assert.equal(calls[calls.indexOf(written)+1].action,'display_profile.get');await expect(page.locator('#display1Status')).toContainText('999 µg/m³');await expect(page.locator('#display1WritePreview')).toContainText('999');
  now+=11000;await page.evaluate(()=>UI.userDisplay.load());await expect(page.locator('#display1Status')).toContainText(language==='en'?'Reading expired':'读数已过期');await expect(page.locator('#display0Status')).toContainText('1234 ppm');
  for(const [mode,value,preview] of [['decimal_1',1.26,'1.30'],['decimal_2',1.235,'1.24'],['milli',1234,'1.23'],['integer',1234,'999'],['auto_kilo',1234,'1.23']]){
   samples[0]=value;await page.locator('#display0Mode').selectOption(mode);await page.locator('#displaySourceSave').click();await expect(page.locator('#display1Write')).toBeEnabled();await expect(page.locator('#display0Preview')).toContainText(preview);
   for(const segment of segments)await expect(page.locator('#display0Lamp'+segment)).toBeChecked();
  }
  await page.locator('#toasts').evaluate(element=>element.replaceChildren());
  const physicalScreenshot=`${engine}-${language}-${width}-physical.png`;await page.screenshot({path:path.join(evidence,physicalScreenshot),fullPage:true});
  await page.locator('#display0Source').selectOption('api');await page.locator('#displaySourceSave').click();await expect(page.locator('#display0Write')).toBeEnabled();
  await expect(page.locator('#display0Mode')).toBeHidden();await page.locator('#display0Value').fill('123');await page.locator('#display0WriteTTL').fill('10');await page.locator('#display0Decimal').check();await page.locator('#display0WriteGlyph').check();
  for(const segment of segments)await page.locator('#display0WriteLamp'+segment).check();
  await page.locator('#display0Write').click();await expect(page.locator('#display0Write')).toBeEnabled();written=calls.findLast(request=>request.action==='display_value.set');assert.equal(written.params.number,123);assert.equal(written.params.decimal,true);assert.equal(Object.hasOwn(written.params,'value'),false);assert.equal(Object.hasOwn(written.params,'unit'),false);
  await expect(page.locator('#display0Status')).toContainText('1.23 mg/m³');await expect(page.locator('#display0WritePreview')).toContainText('1.23');
  await page.locator('#display1WriteTTL').fill('20');await page.locator('#display1Write').click();await expect(page.locator('#display1Write')).toBeEnabled();await expect(page.locator('#display1Status')).toContainText('999 µg/m³');
  await page.locator('#display0Clear').click();await expect(page.locator('#display0Write')).toBeEnabled();await expect(page.locator('#display1Status')).toContainText('999 µg/m³');await page.locator('#display0Write').click();await expect(page.locator('#display0Write')).toBeEnabled();
  // An unfinished raw frame must not block saving an unrelated persistent setting.
  await page.locator('#display0Value').fill('1.2');await page.locator('#displayDoubleClick').selectOption('none');await page.locator('#displaySourceSave').click();await expect(page.locator('#display0Write')).toBeEnabled();
  assert.equal(calls.findLast(request=>request.action==='display_profile.set').params.double_click,'none');assert.equal(await page.locator('#display0Value').inputValue(),'1.2');await page.locator('#display0Value').fill('123');
  nullRead=true;await page.locator('#display0Write').click();await expect(page.locator('#toasts .toast.bad')).toBeVisible();nullRead=false;
  await expect(page.locator('#displaySourceStatus')).toContainText(language==='en'?'Waiting for controller confirmation':'等待控制器确认');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`${engine} ${language} ${width} overflow`);assert.deepEqual(errors,[]);
  await page.locator('#toasts').evaluate(element=>element.replaceChildren());
  const screenshot=`${engine}-${language}-${width}.png`;await page.screenshot({path:path.join(evidence,screenshot),fullPage:true});
  await page.evaluate(()=>{location.hash='';});await expect(page.locator('#homePage')).toBeVisible();await page.evaluate(()=>{location.hash='settings/device';});await expect(card).toBeVisible();
  cases.push({engine,language,width,screenshot,physicalScreenshot,checks:['canonical_mac','18_independent_segments','all_five_hcho_modes','pm_integer_only','raw_api_digits_flags_lamps','independent_label_unit','independent_get','per_lane_expiry','null_read_failure','no_overflow','navigation'],result:'PASS'});
  await context.close();console.log(`PASS ${engine} ${language} ${width}: physical modes, raw API frames, independent lamps, expiry and null failure`);
 }}finally{await browser.close();}
 fs.writeFileSync(path.join(evidence,engine+'-results.json'),JSON.stringify({cases,device_mutations:false},null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
