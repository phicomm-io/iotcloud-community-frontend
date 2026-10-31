// Built hub + complete embedded pages, using binary gateway fixtures only.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {chromium,webkit,expect} from '@playwright/test';
import {encodeWire,decodeWire} from '../src/wireCodec.js';

const app=fileURLToPath(new URL('..',import.meta.url));
const dist=resolve(process.env.HUB_TEST_DIST||resolve(app,'../build/hub-session'));
const evidence=process.env.HUB_SESSION_EVIDENCE;
if(evidence)await mkdir(evidence,{recursive:true});
const target='http://192.168.1.18',password='fixture-password',firmware='1.0.0-rc.5-fixture';
const sandbox={window:{},structuredClone,performance};
vm.runInNewContext(await readFile(resolve(app,'../M1/web/display-format.js'),'utf8'),sandbox);
vm.runInNewContext(await readFile(resolve(app,'../common/web/demo.js'),'utf8'),sandbox);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
const results=[];

async function fixture(browser,language,passwordRequired){
 const context=await browser.newContext({viewport:{width:1280,height:960},serviceWorkers:'block'});
 const devices=['daikin','tc1','m1','a1','s30-v1b'].map(model=>{
  const demo=sandbox.window.PhicommDemo.create(model);
  Object.assign(demo.state,{name:'Fixture '+model,version:firmware,firmware_version:firmware,firmware_variant:model==='daikin'?'hub':'full',timezone_minutes:0,ntp_host:'pool.ntp.org',web_password_set:passwordRequired});
  return {model,mac:demo.state.device_id,self:model==='daikin',demo};
 });
 const local=devices[0],calls=[],errors=[],consoleIssues=[],tokens=new Set();let tokenSequence=1,pending=0,maxPending=0,expireWrite=false,stage='initial',meBusy=false;
 const info=device=>({api_version:1,device_id:device.mac,model:device.model,firmware_version:device.firmware_version||firmware,firmware_variant:device.self?'hub':'full',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack'});
 await context.addInitScript(language=>{try{localStorage.setItem('phicomm.language',language);localStorage.setItem('iotcloud.session.'+location.origin,'f'.repeat(64));}catch{}},language);
 context.on('page',page=>{
  page.on('pageerror',error=>errors.push({message:error.message,stack:error.stack,url:page.url(),stage}));
  page.on('console',message=>{
   const text=message.text();
   if(['error','warning'].includes(message.type())&&!/^Failed to load resource: the server responded with a status of (401|503)\b/.test(text)&&!text.startsWith('An iframe which has both allow-scripts and allow-same-origin'))consoleIssues.push({type:message.type(),text,stage});
  });
 });
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  const reply=(value,status=200)=>route.fulfill({status,contentType:'application/msgpack',body:Buffer.from(encodeWire(JSON.parse(JSON.stringify(value))))});
  if(url.origin!==target){return route.abort();}
  if(path.startsWith('/api/')){
   const body=req.postDataBuffer(),data=body?.length?decodeWire(body):undefined,authorization=req.headers().authorization;
   const call={path,method:req.method(),data,authorization};calls.push(call);
   if(data)assert.equal(req.headers()['content-type'],'application/msgpack');
   assert(!authorization||/^Bearer [0-9a-f]{32}$/.test(authorization),'only the common WebUI token may authorize hub APIs');
   if(path==='/api/v1/info')return reply({code:'ok',data:info(local)});
   if(path==='/api/v1/auth/login'){
    if(passwordRequired&&data?.password!==password)return reply({code:'unauthorized'},401);
    const token=passwordRequired?(tokenSequence++).toString(16).padStart(32,'0'):'';if(token)tokens.add(token);
    return reply({code:'ok',data:{token,password_required:passwordRequired}});
   }
   if(path==='/api/v1/auth/logout'){tokens.delete(authorization?.slice(7));return reply({code:'ok'});}
   if(passwordRequired&&!tokens.has(authorization?.slice(7)))return reply({code:'unauthorized',request_id:data?.request_id},401);
   if(path==='/api/auth/me'){if(meBusy){meBusy=false;return reply({code:'busy'},503);}return reply({username:'preserved_namespace',mqtt_username:'preserved_namespace',is_admin:false});}
   if(path==='/api/devices')return reply(devices.map(device=>({...info(device),mac:device.mac,version:'v2',status:'active',self:device.self,online:true,paired:true,username:'preserved_namespace'})));
   const proxied=path.match(/^\/api\/hub\/devices\/([0-9a-f]{12})\/command$/);
   if(proxied||path==='/api/v1/command'){
    const device=proxied?devices.find(device=>device.mac===proxied[1]):local;
    assert(device);assert.equal(typeof data.request_id==='string'||data.action.endsWith('.get'),true);
    pending++;maxPending=Math.max(maxPending,pending);
    try{
     if(data.params?.delayed_test)await new Promise(resolve=>setTimeout(resolve,400));
     if(expireWrite&&!data.action.endsWith('.get')){expireWrite=false;tokens.clear();return await reply({code:'unauthorized',request_id:data.request_id},401);}
     let result=device.demo.command(data.action,data.params);
     if(data.action==='capabilities.get')Object.assign(result,info(device));
     if(data.action==='time.get')result={timezone_minutes:device.demo.state.timezone_minutes,ntp_host:'pool.ntp.org'};
     if(data.action==='time.set')device.demo.state.timezone_minutes=data.params.timezone_minutes;
     if(data.action==='status.get'&&data.params?.delayed_test)result={...result,power_watts:999};
     return await reply({code:data.action.endsWith('.get')?'ok':'accepted',data:result,request_id:data.request_id});
    }finally{pending--;}
   }
   if(path==='/api/hub/lan')return reply({ready:true,protocol:4,codec:'msgpack',devices:devices.slice(1).map(device=>({device_id:device.mac,model:device.model,ip:'192.168.1.45',port:80,registered:true,paired:true,compatible:true,online:true,code:'ready'}))});
   if(path==='/api/hub/homekit')return reply({enabled:false,ready:false,paired:false,code:'disabled'});
   if(path==='/api/hub/bridge')return reply({enabled:false,mappings:[],mqtt:{host:'',port:1883,user:'',password_set:false}});
   if(path==='/api/integrations/bemfa')return reply({enabled:false,key_set:false,mappings:[],max_mappings:8,status:'disabled'});
   return reply({code:'not_found'},404);
  }
  const name=path==='/'?'standalone-daikin.html':path.startsWith('/iotcloud/')?path.slice('/iotcloud/'.length)||'index.html':null;
  if(!name)return route.abort();
  const file=resolve(dist,name);assert(file.startsWith(dist+'/'));
  try{return route.fulfill({contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 return {context,calls,errors,consoleIssues,devices,setStage(value){stage=value;},get maxPending(){return maxPending;},get pending(){return pending;},expireNextWrite(){expireWrite=true;},busyNextMe(){meBusy=true;},changeFirmware(model){const device=devices.find(d=>d.model===model);device.firmware_version=firmware+'-updated';Object.assign(device.demo.state,{version:device.firmware_version,firmware_version:device.firmware_version});}};
}

for(const engine of [chromium,webkit].filter(engine=>!process.env.BROWSER||engine.name()===process.env.BROWSER)){
 const browser=await engine.launch(engine===webkit&&process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH?{executablePath:process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH}:{});
 try{for(const language of ['en','zh-CN'])for(const protectedDevice of [false,true]){
  const f=await fixture(browser,language,protectedDevice),page=await f.context.newPage(),zh=language==='zh-CN';
  try{
   await page.goto(target+'/iotcloud/#/');
   if(protectedDevice){
    await expect(page.locator('.auth-form')).toBeVisible();await expect(page.locator('.auth-form input')).toHaveCount(1);
    await page.getByLabel(zh?'设备 WebUI 密码':'Device WebUI password',{exact:true}).fill(password);await page.locator('.auth-submit').click();
   }
   await expect(page.locator('.device-list-item')).toHaveCount(5);
   await expect(page.locator('.device-list .presence-pill.online')).toHaveCount(5);
   await expect(page.locator('.auth-form')).toHaveCount(0);
   assert(!f.calls.some(call=>call.path==='/api/hub/setup'||call.path==='/api/auth/login'));
   assert(!f.calls.some(call=>call.path.includes('mqtt')));
   const select=async model=>{
    f.setStage('select '+model);
    const index=f.devices.findIndex(device=>device.model===model);await page.locator('.device-select').nth(index).click();
    await expect.poll(()=>page.locator('iframe.device-home').evaluate(node=>node.contentWindow?.UI?.state?.device_id)).toBe(f.devices[index].mac);
    return page.frameLocator('iframe.device-home');
   };
   for(const model of ['daikin','m1','a1','s30-v1b','tc1'])await select(model);
   await select('m1');await page.locator('iframe.device-home').evaluate(node=>{node.contentWindow.__oldFirmwarePage=true;});
   f.changeFirmware('m1');await page.locator('.devices-panel>button').last().click();
   await expect.poll(()=>page.locator('iframe.device-home').evaluate(node=>node.contentWindow.UI?.caps?.firmware_version)).toBe(firmware+'-updated');
   assert.equal(await page.locator('iframe.device-home').evaluate(node=>!!node.contentWindow.__oldFirmwarePage),false,'new discovery identity replaces the old page and capabilities');
   let frame=await select('tc1');
   await frame.locator('#socket0').click();
   await expect.poll(()=>f.calls.filter(call=>call.data?.action==='outlet.set').length).toBe(1);
   assert.equal(f.calls.find(call=>call.data?.action==='outlet.set').path,'/api/hub/devices/aabbccddee01/command');
   frame=await select('m1');
   await page.locator('iframe.device-home').evaluate(node=>{node.contentWindow.UI.embeddedRoute='settings/device';node.contentWindow.UI.showRoute();});
   const clock=frame.locator('.card').filter({has:frame.locator('[data-i18n="clock.title"]')});
   await expect(clock.locator('select')).toHaveValue('0');
   for(const timezone of [60,0]){
    await clock.locator('select').selectOption(String(timezone));await clock.locator('button[type="submit"]').click();
    await expect.poll(()=>f.calls.filter(call=>call.data?.action==='time.set').at(-1)?.data.params.timezone_minutes).toBe(timezone);
    await expect.poll(()=>f.pending).toBe(0);
    await page.locator('iframe.device-home').evaluate(node=>node.contentWindow.UI.reload({full:true}));
    await expect.poll(()=>page.locator('iframe.device-home').evaluate(node=>node.contentWindow.UI.state.timezone_minutes)).toBe(timezone);
   }
   frame=await select('tc1');
   await page.locator('iframe.device-home').evaluate(node=>{node.contentWindow.UI.embeddedRoute='settings/maintenance';node.contentWindow.UI.showRoute();});
   await expect(frame.locator('.card').filter({has:frame.locator('[data-i18n="backup.title"]')})).toBeHidden();
   await page.locator('iframe.device-home').evaluate(node=>{node.contentWindow.UI.embeddedRoute='settings/firmware';node.contentWindow.UI.showRoute();});
   await expect(frame.locator('#firmware')).toBeHidden();
   // An old page stops reading while the single HTTP lane drains its response.
   await page.locator('iframe.device-home').evaluate(node=>{node.contentWindow.command('status.get',{delayed_test:true}).catch(()=>{});});
   await expect.poll(()=>f.calls.filter(call=>call.data?.params?.delayed_test).length).toBe(1);
   await select('m1');assert(!await page.locator('.device-select').nth(1).innerText().then(text=>text.includes('999')));
   // A page change never cancels or resends an accepted write.
   await select('tc1');
   await page.locator('iframe.device-home').evaluate(node=>{node.contentWindow.command('indicator.set',{enabled:false,delayed_test:true}).catch(()=>{});});
   await expect.poll(()=>f.calls.filter(call=>call.data?.action==='indicator.set'&&call.data.params.delayed_test).length).toBe(1);
   await select('m1');assert.equal(f.calls.filter(call=>call.data?.action==='indicator.set'&&call.data.params.delayed_test).length,1);
   await page.getByRole('button',{name:zh?'设置':'Settings',exact:true}).click();
   await expect.poll(()=>f.pending).toBe(0);
   const authenticatedLogins=()=>f.calls.filter(call=>call.path==='/api/v1/auth/login'&&call.data.password).length;
   const before=authenticatedLogins();
   let loginNavigation=false;
   const observe=frame=>{if(frame===page.mainFrame()&&new URL(frame.url()).hash==='#/login')loginNavigation=true;};page.on('framenavigated',observe);
   f.setStage('reload');await page.reload();await expect(page.locator('.device-list-item')).toHaveCount(5);assert.equal(authenticatedLogins(),before);
   await page.getByRole('button',{name:zh?'设置':'Settings',exact:true}).click();
   await page.locator('.settings-navigation').getByRole('button',{name:zh?/账号安全/:/Account security/}).click();
   await expect.poll(()=>f.pending).toBe(0);
   f.setStage('root navigation');await page.locator('.hub-security a').click();await expect(page.locator('.hub-management-entry')).toBeVisible();await expect(page.locator('.device-auth-dialog')).toHaveCount(0);
   f.setStage('hub navigation');await page.locator('.hub-management-entry').click();await expect(page.locator('.device-list-item')).toHaveCount(5);
   assert.equal(authenticatedLogins(),before,'root and hub reuse one tab session');assert.equal(loginNavigation,false,'refresh and cross-page reuse must not enter login');
   const storage=await page.evaluate(()=>({session:Object.fromEntries(Object.entries(sessionStorage)),local:Object.fromEntries(Object.entries(localStorage))}));
   assert(!JSON.stringify(storage).includes(password));
   if(protectedDevice)assert.equal(JSON.parse(storage.session['iotcloud.device-session.v1']).token.length,32);
   await page.getByRole('button',{name:zh?'设置':'Settings',exact:true}).click();
   await page.locator('.settings-navigation').getByRole('button',{name:zh?/账号安全/:/Account security/}).click();
   await expect(page.locator('.hub-security')).toBeVisible();await expect(page.locator('.settings-content input[type="password"]')).toHaveCount(0);
   assert.equal(await page.locator('.hub-security a').getAttribute('href'),'/#settings/device');
   if(evidence)await page.screenshot({path:resolve(evidence,engine.name()+'-'+language+'-'+(protectedDevice?'password':'open')+'.png'),fullPage:true});
   if(!protectedDevice){
    page.off('framenavigated',observe);f.busyNextMe();await page.goto(target+'/iotcloud/#/login');
    await expect(page.locator('.hub-session-retry')).toBeVisible();await expect(page.locator('.auth-form')).toHaveCount(0);
    await page.locator('.hub-session-retry button').click();await expect(page.locator('.device-list-item')).toHaveCount(5);
   }
   if(protectedDevice){
    await page.getByRole('button',{name:zh?'首页':'Home',exact:true}).click();frame=await select('tc1');
    f.expireNextWrite();await frame.locator('#socket0').click();
    await expect(page.locator('.auth-form')).toBeVisible();
    assert.equal(f.calls.filter(call=>call.data?.action==='outlet.set').length,2,'expired write is sent once');
   }
   assert.equal(f.maxPending,1,'gateway commands are serialized across targets');assert.deepEqual(f.errors,[]);assert.deepEqual(f.consoleIssues,[]);
   results.push({engine:engine.name(),language,passwordRequired:protectedDevice,commands:f.calls.filter(call=>call.path.endsWith('/command')).length,maxPending:f.maxPending,passed:true});
   console.log('PASS',engine.name(),language,protectedDevice?'password':'open','binary controls, five models, UTC, cancelled reads, writes once, root/hub/reload session');
  }catch(error){
   if(evidence){await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true});await writeFile(resolve(evidence,'failure-calls.json'),JSON.stringify(f.calls,null,2)+'\n');}
   throw error;
  }finally{await f.context.close();}
 }}finally{await browser.close();}
}
if(evidence)await writeFile(resolve(evidence,'browser-results.json'),JSON.stringify(results,null,2)+'\n');
