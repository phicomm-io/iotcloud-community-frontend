// Local fixtures only: device root -> owner setup/settings, and cloud /local -> hub.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {chromium,webkit,expect} from '@playwright/test';

const app=fileURLToPath(new URL('..',import.meta.url));
const hub=resolve(process.env.HUB_TEST_DIST||resolve(app,'../build/hub-webui-entry-hub'));
const cloud=resolve(process.env.CLOUD_TEST_DIST||resolve(app,'../build/hub-webui-entry-cloud'));
const target='http://192.168.1.18',platform='http://console-audit.test',mac='aabbccddeeff';
const secret='adminfjr',webSecret='adminfjr';
const sandbox={window:{},structuredClone,performance};
vm.runInNewContext(await readFile(resolve(app,'../common/web/demo.js'),'utf8'),sandbox);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
const evidence=process.env.HUB_ENTRY_EVIDENCE;
if(evidence)await mkdir(evidence,{recursive:true});
const screenshot=async(page,name)=>{if(evidence)await page.screenshot({path:resolve(evidence,name+'.png'),fullPage:true});};

async function fixtureContext(browser,language,{variant='hub',owner=false,webPasswordSet=false,selfDevice=false}={}){
 const context=await browser.newContext({viewport:{width:390,height:950},serviceWorkers:'block'});
 const device=sandbox.window.PhicommDemo.create('daikin');
 Object.assign(device.state,{device_id:mac,ip:'192.168.1.18',firmware_variant:variant});
 if(selfDevice){device.state.name='Local hub sensor';device.state.sensors.pm25={value:12,unit:'ug/m3',valid:true,age_ms:0};}
 const records=[],requests=[],errors=[],setups=[];let setup=owner,identityUnavailable=false;
 await context.addInitScript(({language,selfDevice,mac,target})=>{try{localStorage.setItem('phicomm.language',language);localStorage.setItem('mqtt_auto_connect','false');if(selfDevice)localStorage.setItem('phicomm.device-connection.'+encodeURIComponent(target+':local')+':'+encodeURIComponent(mac),JSON.stringify({mode:'auto',address:target,lastAddress:''}));}catch{}},{language,selfDevice,mac,target});
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push({origin:url.origin,path:url.pathname,method:request.method()});
  if(url.pathname==='/api/v1/info')return identityUnavailable?route.fulfill({status:401,json:{code:'unauthorized'}}):route.fulfill({json:{code:'ok',data:{api_version:1,model:'daikin',firmware_variant:variant,device_id:mac}}});
  // Explicit verified old JSON firmware has no token route; preserve Basic
  // compatibility checks independently from the MP hub HomeKit fixture.
  if(url.pathname==='/api/v1/auth/login')return route.fulfill({status:404,json:{code:'not_found'}});
  if(url.pathname==='/api/v1/status')return route.fulfill({json:{code:'ok',data:device.state}});
  if(url.pathname==='/api/v1/command'){
   const body=request.postDataJSON();assert(body.action.endsWith('.get'),'fixture must not issue device writes');
   const data=device.command(body.action,body.params);
   if(body.action==='capabilities.get')Object.assign(data,{model:'daikin',firmware_variant:variant});
   return route.fulfill({json:{code:'ok',data}});
  }
  if(url.pathname.startsWith('/api/')){
   const path=url.pathname.slice(4);let data={};
   if(path==='/register/status')data={hub:true,enabled:false,setup_required:!setup,mqtt_uri:'mqtt://192.168.1.18:1883',mqtt_ws_uri:'ws://192.168.1.18:9001/mqtt'};
   else if(path==='/auth/me')return route.fulfill({status:401,json:{code:'unauthorized'}});
   else if(path==='/hub/setup'){
    assert.equal(url.origin,target);const authorization=request.headers().authorization;setups.push({authorization,body:request.postDataJSON()});
    assert.deepEqual(request.postDataJSON(),{username:'local',password:secret});
    if(webPasswordSet&&authorization!=='Basic '+Buffer.from('admin:'+webSecret).toString('base64'))return route.fulfill({status:401,json:{code:'unauthorized'}});
    if(!webPasswordSet)assert.equal(authorization,undefined,'password-free setup must omit device authentication');
    setup=true;data={code:'accepted'};
   }else if(path==='/auth/login')data={username:'local',mqtt_username:'local',is_admin:false};
   else if(path==='/devices'){
    if(request.method()==='POST')records.push({...request.postDataJSON(),status:'active',username:'local'});
    data=[...(selfDevice?[{mac,model:'daikin',version:'v2',status:'active',username:'local',self:true}]:[]),...records];
   }else if(path==='/hub/homekit')data={enabled:false,protocol:'hap',ready:false,paired:false,devices:0,code:'disabled'};
   else if(path==='/hub/bridge')data={enabled:false,mappings:[],mqtt:{host:'',port:1883,user:'',password_set:false}};
   else if(path==='/integrations/bemfa')data={enabled:false,key_set:false,mappings:[],max_mappings:8,status:'disabled'};
   else data={enabled:false,providers:[]};
   return route.fulfill({headers:path==='/auth/login'?{'X-IotCloud-Session':'fixture-token'}:{},json:data});
  }
  let base,path;
  if(url.origin===target){base=hub;path=url.pathname==='/'?'standalone-daikin.html':url.pathname.startsWith('/iotcloud/')?url.pathname.slice(10)||'index.html':null;}
  else if(url.origin===platform){base=cloud;path=url.pathname==='/'?'index.html':url.pathname.slice(1);}
  if(!path)return route.abort();
  const file=resolve(base,path);assert(file.startsWith(base+'/'));
  try{return route.fulfill({contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 return {context,requests,errors,setups,setIdentityUnavailable(){identityUnavailable=true;}};
}

async function passwordBounds(page,language,isHub,requests){
 const zh=language==='zh-CN';
 await page.getByRole('button',{name:zh?/账号安全/:/Account security/}).click();
 const forms=page.locator('.settings-content form').filter({has:page.locator('input[autocomplete="new-password"]')});
 await expect(forms).toHaveCount(2);
 for(let index=0;index<2;index++){
  const form=forms.nth(index),input=form.locator('input[autocomplete="new-password"]');
  await form.locator('input[autocomplete="current-password"]').fill(secret);
  assert.equal(await input.getAttribute('minlength'),isHub?'8':'6');
  assert.equal(await input.getAttribute('maxlength'),isHub?'63':null);
  if(isHub){
   await expect(form.getByText(zh?'8–63 个字符':'8–63 characters',{exact:true})).toBeVisible();
   await input.fill('x'.repeat(7));assert.equal(await input.evaluate(node=>node.checkValidity()),false);
   const before=requests.filter(request=>request.path==='/api/auth/password'||request.path==='/api/auth/mqtt-password').length;
   await form.getByRole('button').click();
   assert.equal(requests.filter(request=>request.path==='/api/auth/password'||request.path==='/api/auth/mqtt-password').length,before,'invalid password must not be submitted');
   for(const length of [8,63]){await input.fill('x'.repeat(length));assert.equal(await input.evaluate(node=>node.checkValidity()),true);}
   await input.press('End');await input.press('x');assert.equal((await input.inputValue()).length,63,'maxlength must prevent a 64th character');
  }else{
   await input.fill('x'.repeat(6));assert.equal(await input.evaluate(node=>node.checkValidity()),true,'cloud keeps six-character minimum');
   await input.fill('x'.repeat(64));assert.equal((await input.inputValue()).length,64,'cloud keeps its existing length policy');
  }
 }
}

for(const engine of [chromium,webkit].filter(engine=>!process.env.BROWSER||engine.name()===process.env.BROWSER)){
 const browser=await engine.launch(engine===webkit&&process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH?{executablePath:process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH}:{});
 try{for(const language of ['en','zh-CN']){
  const zh=language==='zh-CN',manage=zh?'中枢管理':'Hub management';
  for(const variant of ['hub','full','lite']){
   const {context,errors}=await fixtureContext(browser,language,{variant}),page=await context.newPage();
   await page.goto(target+'/');await page.waitForFunction(()=>window.UI?.state?.model==='daikin');
   await expect(page.locator('.copyright [data-i18n="footer.firmware"]')).toHaveText(zh?'固件仓库':'Firmware repository');await expect(page.locator('.copyright [data-i18n="footer.website"]')).toHaveText(zh?'项目网站':'Project website');
   const entry=page.locator('.hub-management-entry');
   if(variant==='hub'){
    await expect(entry).toBeVisible();assert.equal(await entry.innerText(),manage);assert.equal(await entry.getAttribute('href'),'/iotcloud/#/');
    assert.equal(await page.locator('.broker-platform-link').getAttribute('href'),'/iotcloud/#/');
    await screenshot(page,`${engine.name()}-${language}-root`);
    await entry.click();await expect(page.getByRole('button',{name:zh?'创建本地账户':'Create local account',exact:true})).toBeVisible();
    const back=page.locator('.hub-setup a');assert.equal(await back.getAttribute('href'),'/#settings/device');await back.click();await expect(page.locator('#webPassword')).toBeVisible();
   }else{
    await expect(entry).toHaveCount(0);assert.equal(await page.locator('.broker-platform-link').getAttribute('href'),'https://phicomm-io.github.io/iotcloud/#/');
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,variant+' root overflow');
   assert.deepEqual(errors,[]);await context.close();
  }
  // Existing device authentication still protects setup, while a hub without
  // a device WebUI password can create its independent owner account directly.
  const protectedHub=await fixtureContext(browser,language,{webPasswordSet:true}),protectedPage=await protectedHub.context.newPage();await protectedPage.goto(target+'/iotcloud/');
  await protectedPage.getByLabel(zh?'用户名':'Username',{exact:true}).fill('local');await protectedPage.getByLabel(zh?'本地账户密码':'Local account password',{exact:true}).fill(secret);
  const optionalPassword=protectedPage.getByLabel(zh?'设备 WebUI 密码':'Device WebUI password',{exact:true});assert.equal(await optionalPassword.getAttribute('required'),null);
  await protectedPage.getByRole('button',{name:zh?'创建本地账户':'Create local account',exact:true}).click();await expect(protectedPage.getByRole('alert')).toBeVisible();assert.equal(protectedHub.setups.length,1);assert.equal(protectedHub.setups[0].authorization,undefined);
  await optionalPassword.fill(webSecret);await protectedPage.getByRole('button',{name:zh?'创建本地账户':'Create local account',exact:true}).click();await expect(protectedPage.getByRole('button',{name:zh?'设置':'Settings',exact:true})).toBeVisible();
  assert.deepEqual(protectedHub.setups.map(item=>item.authorization),[undefined,'Basic '+Buffer.from('admin:'+webSecret).toString('base64')]);assert.deepEqual(protectedHub.errors,[]);await protectedHub.context.close();
  const {context,requests,errors,setups}=await fixtureContext(browser,language,{selfDevice:true}),page=await context.newPage();
  await page.goto(target+'/iotcloud/');await page.getByRole('button',{name:zh?'创建本地账户':'Create local account',exact:true}).waitFor();
  await page.getByLabel(zh?'用户名':'Username',{exact:true}).fill('local');const ownerPassword=page.getByLabel(zh?'本地账户密码':'Local account password',{exact:true});
  await ownerPassword.fill('x'.repeat(7));assert.equal(await ownerPassword.evaluate(node=>node.checkValidity()),false);await page.getByRole('button',{name:zh?'创建本地账户':'Create local account',exact:true}).click();assert.equal(setups.length,0,'independent owner password remains required');
  assert.equal(await ownerPassword.getAttribute('minlength'),'8');assert.equal(await ownerPassword.getAttribute('maxlength'),'63');await ownerPassword.fill(secret);
  await page.getByRole('button',{name:zh?'创建本地账户':'Create local account',exact:true}).click();await page.getByRole('button',{name:zh?'设置':'Settings',exact:true}).click();
  assert.deepEqual(setups,[{authorization:undefined,body:{username:'local',password:secret}}]);
  const manual=page.locator('.provision-device');await expect(manual.locator('.hub-broker-details')).toBeVisible();
  const details=await manual.innerText();assert(details.includes('192.168.1.18'));assert(details.includes('1883'));assert(details.includes('local'));assert(!details.includes(secret));assert(!details.includes(webSecret));
  await expect(manual.getByRole('button')).toHaveCount(0);
  await page.getByRole('button',{name:zh?/中枢服务/:/Hub services/}).click();await expect(page.getByRole('heading',{name:'HomeKit',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:zh?'上游转发':'Upstream forwarding',exact:true})).toBeVisible();
  await screenshot(page,`${engine.name()}-${language}-owner`);
  await page.getByRole('button',{name:zh?/设备管理/:/Device management/}).click();
  const selfRow=page.locator('.managed-device').filter({has:page.getByText(zh?'本机中枢':'This hub',{exact:true})});await expect(selfRow).toHaveCount(1);await expect(selfRow.locator('.device-summary .stat')).toContainText('12');await expect(selfRow.locator('.rack-head b')).toHaveText('Local hub sensor');
  await selfRow.locator('.device-details summary').click();await expect(selfRow.locator('.local-connection')).toHaveCount(0);await expect(selfRow.locator('button.danger')).toHaveCount(0);await expect(selfRow.locator('.device-details dd').first()).toHaveText(mac);
  await page.getByRole('button',{name:zh?'添加设备':'Add device',exact:true}).click();
  await page.locator('.add-device-panel input').fill('AABBCCDDEE01');await page.locator('.add-device-panel').getByRole('button').click();await expect(page.locator('.managed-device')).toHaveCount(2);
  const remoteRow=page.locator('.managed-device').nth(1);await expect(remoteRow.locator('.local-connection')).toHaveCount(1);await expect(remoteRow.locator('button.danger')).toHaveCount(1);await screenshot(page,`${engine.name()}-${language}-self-device`);
  await page.getByRole('button',{name:/Bemfa|巴法/}).click();await expect(page.locator('.bemfa-card')).toBeVisible();await expect(page.locator('.bemfa-card option[value="'+mac+'"]')).toHaveCount(0);
  await passwordBounds(page,language,true,requests);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'owner settings overflow');assert.deepEqual(errors,[]);await context.close();
  const cloudOwner=await fixtureContext(browser,language,{owner:true}),cloudPage=await cloudOwner.context.newPage();await cloudPage.goto(platform+'/#/login');
  await cloudPage.locator('.auth-form input[autocomplete="username"]').fill('local');await cloudPage.locator('.auth-form input[autocomplete="current-password"]').fill(secret);await cloudPage.locator('.auth-submit').click();await cloudPage.getByRole('button',{name:zh?'设置':'Settings',exact:true}).click();
  await passwordBounds(cloudPage,language,false,cloudOwner.requests);assert.deepEqual(cloudOwner.errors,[]);await cloudOwner.context.close();
  for(const variant of ['hub','full']){
   const {context,requests,errors,setIdentityUnavailable}=await fixtureContext(browser,language,{variant}),page=await context.newPage();await page.goto(platform+'/#/local');
   await page.getByRole('button',{name:zh?'本地连接':'Local connection',exact:true}).click();
   await page.getByLabel(zh?'设备 IP':'Device IP',{exact:true}).fill('192.168.1.18');await page.getByRole('button',{name:zh?'连接本地设备':'Connect local device',exact:true}).click();
   await expect(page.locator('.device-heading')).toContainText(zh?'内网已连接':'LAN connected');
   const entry=page.locator('.local-hub-entry a');
   if(variant==='hub'){
    await expect(entry).toBeVisible();assert.equal(await entry.innerText(),manage);assert.equal(await entry.getAttribute('href'),target+'/iotcloud/#/');assert.equal(await entry.getAttribute('rel'),'noopener noreferrer');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('phicomm.local-devices'))[0].firmware_variant),'hub');
    await screenshot(page,`${engine.name()}-${language}-local`);
   }else await expect(entry).toHaveCount(0);
   await expect(page.frameLocator('.device-home').locator('.hub-management-entry')).toHaveCount(0);
   await expect(page.frameLocator('.device-home').locator('.copyright [data-i18n="footer.firmware"]')).toHaveText(zh?'固件仓库':'Firmware repository');await expect(page.frameLocator('.device-home').locator('.copyright [data-i18n="footer.website"]')).toHaveText(zh?'项目网站':'Project website');
   await page.getByRole('button',{name:zh?'设置':'Settings',exact:true}).click();await expect(page.getByRole('button',{name:zh?/中枢服务/:/Hub services/})).toHaveCount(0);
   assert(!requests.some(r=>r.path.startsWith('/api/hub/')),'local control must not call owner APIs');
   if(variant==='hub'){
    setIdentityUnavailable();await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/info'&&response.status()===401),page.reload()]);await expect(page.locator('.device-picker-trigger')).toContainText(zh?'设备未连接':'Device disconnected');await expect(page.locator('.local-hub-entry')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('phicomm.local-devices'))[0].firmware_variant),'hub','saved metadata alone must not authorize the link');
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'local overflow');assert.deepEqual(errors,[]);await context.close();
  }
  const localHub=await fixtureContext(browser,language),localPage=await localHub.context.newPage();await localPage.goto(target+'/iotcloud/#/local');await localPage.getByRole('button',{name:zh?'设置':'Settings',exact:true}).click();
  await expect(localPage.getByRole('button',{name:zh?/中枢服务/:/Hub services/})).toHaveCount(0);assert(!localHub.requests.some(r=>r.path.startsWith('/api/hub/')));await localHub.context.close();
  console.log(`PASS ${engine.name()} ${language} 390: conditional root/iframe entry, password-free/authenticated owner setup + back link, manual broker details, devices/Bemfa/HomeKit, hub/cloud password bounds, cloud local hub/full identity`);
 }}finally{await browser.close();}
}
