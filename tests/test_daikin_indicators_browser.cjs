const {chromium,webkit}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http');
const html=process.env.PHICOMM_DAIKIN_HTML?require('node:fs').readFileSync(process.env.PHICOMM_DAIKIN_HTML,'utf8'):require('./render_page.cjs')('DAIKIN/web/index.html');
const original={co2:[{threshold:1000,op:'gt',mode:'slow'},{threshold:1500,op:'gte',mode:'fast'}],tvoc:[{threshold:300,op:'gt',mode:'on'}],pm_source:'pm25',pm:[],formaldehyde:[]};
let rules=structuredClone(original),writes=[];
const state=()=>({model:'daikin',name:'Indicator test',hardware_model:'BRY88AX151K',indicator_enabled:true,indicator_rules_supported:true,indicator_rules_custom:true,indicator_rules:rules,system_indicator:'ready',wifi_connected:true,ssid:'Test',ip:'192.0.2.10',mqtt_connected:true,mqtt_host:'test.invalid',mqtt_protocol:'tmcp',sensors:Object.fromEntries([['pm25',60],['pm10',150],['co2',1600],['temperature',25],['humidity',50],['tvoc',400]].map(([key,value])=>[key,{valid:true,value,age_ms:0}]))});
const server=http.createServer((req,res)=>{
 // This business fixture represents legacy firmware without token endpoints.
 if(req.url==='/api/v1/auth/login'){res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({code:'not_found'}));return;}
 if(req.method==='GET'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{
  const {action,params}=JSON.parse(body);let data={};
  if(action==='status.get'||action==='config.get')data=state();
  if(action==='capabilities.get')data={model:'daikin',actions:['status.get','config.get','config.set','indicator.set','binding.status.get']};
  if(action==='binding.status.get')data={peers:[],max_sessions:4};
  if(action==='config.set'){assert.equal(params.section,'indicator_rules');rules=structuredClone(params.values);writes.push(structuredClone(params));}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:action.endsWith('.get')?'ok':'accepted',data}));
 });
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true,...(engine===webkit&&process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH?{executablePath:process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH}:{})});
  try{for(const width of [390,1280])for(const lang of ['en','zh-CN']){
   rules=structuredClone(original);writes=[];
   const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'no-preference'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(url+'/#settings/device');await page.locator('#indicatorRulesForm button[type=submit]:enabled').waitFor();
   await page.evaluate(lang=>I18N.set(lang),lang);
   const co2=page.locator('[data-rule-metric="co2"]'),pm=page.locator('[data-rule-metric="pm"]');
   assert.equal(await co2.locator('.indicator-rule').count(),2);assert.equal(await co2.locator(':scope>button').isDisabled(),true);
   await co2.locator('[data-rule-threshold]').first().fill('900');
   await page.evaluate(()=>UI.reload());assert.equal(await co2.locator('[data-rule-threshold]').first().inputValue(),'900');
   await page.locator('#indicatorPmSource').selectOption('pm10');
   await pm.locator(':scope>button').click();await pm.locator('[data-rule-threshold]').fill('120');await pm.locator('[data-rule-mode]').selectOption('fast');
   await page.locator('#indicatorRulesForm button[type=submit]').click();
   await page.waitForFunction(()=>!document.querySelector('#indicatorRulesForm button[type=submit]').disabled);
   assert.equal(writes.length,1);assert.equal(writes[0].values.co2[0].threshold,900);assert.equal(writes[0].values.pm_source,'pm10');assert.equal(writes[0].values.pm[0].mode,'fast');
   assert.equal(await page.locator('[data-rule-metric="formaldehyde"]').isVisible(),false);
   const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,fields:[...document.querySelectorAll('#indicatorRulesForm input,#indicatorRulesForm select')].every(el=>el.getBoundingClientRect().right<=innerWidth)}));
   assert.equal(layout.overflow,false);assert.equal(layout.fields,true);
   await page.screenshot({path:`build/daikin-indicators-${engine.name()}-${width}-${lang}.png`,fullPage:true});
   await page.reload();await page.locator('#indicatorRulesForm button[type=submit]:enabled').waitFor();
   assert.equal(await co2.locator('[data-rule-threshold]').first().inputValue(),'900');assert.equal(await pm.locator('[data-rule-mode]').inputValue(),'fast');assert.equal(await page.locator('#indicatorPmSource').inputValue(),'pm10');
   await page.locator('[data-tab="home"]').click();
   await page.locator('[data-indicator="pm"]').waitFor({state:'visible'});
   assert.equal(await page.locator('[data-indicator="pm"]').getAttribute('data-mode'),'fast');
   await page.waitForFunction(()=>document.querySelector('[data-indicator="pm"] .dot').getAnimations().length===1);
   const animationRetained=await page.evaluate(async()=>{
    const dot=document.querySelector('[data-indicator="pm"] .dot'),animation=dot.getAnimations()[0];
    animation.pause();animation.currentTime=200;await UI.reload();
    const current=document.querySelector('[data-indicator="pm"] .dot');
    return current===dot&&current.getAnimations()[0]===animation&&animation.currentTime===200;
   });
   assert.equal(animationRetained,true,'status polling must preserve the blink cycle');
   assert.match(await page.locator('#indicatorWifi').textContent(),/系统就绪|Ready/);
   assert.deepEqual(errors,[]);await page.close();console.log(`${engine.name()} ${width} ${lang}: rule edit, save, reload, shared output and layout passed`);
  }}finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
