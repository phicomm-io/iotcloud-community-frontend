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
const target='http://192.168.1.18',clockTarget='http://192.168.1.45',password='fixture-password',firmware='1.0.0-rc.5-fixture';
const sandbox={window:{},structuredClone,performance};
vm.runInNewContext(await readFile(resolve(app,'../M1/web/display-format.js'),'utf8'),sandbox);
vm.runInNewContext(await readFile(resolve(app,'../common/web/demo.js'),'utf8'),sandbox);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};
const results=[];
// Remote peer authorization is intentionally narrower than its local WebUI.
const lanActions=new Set(['status.get','capabilities.get','info.get','diagnostics.get','power.get','filter.get','alarm.get','wake_alarm.get','mcu.version.get','fan.set','fan.mode.set','fan.mode.toggle','light.set','child_lock.set','light_always.set','light_effect.select','light_effect.next','outlet.set','indicator.set','display.set','buzzer.set','wake_alarm.start','wake_alarm.stop','fresh_air.config.get','fresh_air.linkage.get','fresh_air.set']);

async function fixture(browser,language,passwordRequired){
 const context=await browser.newContext({viewport:{width:1280,height:960},serviceWorkers:'block'});
 const devices=['daikin','tc1','m1','a1','s30-v1b'].map(model=>{
  const demo=sandbox.window.PhicommDemo.create(model);
  Object.assign(demo.state,{name:'Fixture '+model,version:firmware,firmware_version:firmware,firmware_variant:model==='daikin'?'hub':'full',timezone_minutes:0,ntp_host:'pool.ntp.org',web_password_set:passwordRequired});
  return {model,mac:demo.state.device_id,self:model==='daikin',demo};
 });
 const local=devices[0],calls=[],errors=[],consoleIssues=[],tokens=new Set();let tokenSequence=1,pending=0,maxPending=0,expireWrite=false,stage='initial',meBusy=false,capabilitiesBusyFor='',powerWatts=36;
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
  // Local management retains its full capability surface. Use the production
  // local-connection entry to test its clock without exposing it over LAN.
  if(url.origin===clockTarget){
   const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS'},device=devices.find(device=>device.model==='m1');
   const localReply=value=>route.fulfill({headers,contentType:'application/msgpack',body:Buffer.from(encodeWire(JSON.parse(JSON.stringify(value))))});
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
   if(path==='/api/v1/info')return localReply({code:'ok',data:info(device)});
   if(path==='/api/v1/auth/login')return localReply({code:'ok',data:{token:'',password_required:false}});
   assert.equal(path,'/api/v1/command');const data=decodeWire(req.postDataBuffer());calls.push({origin:clockTarget,path,method:req.method(),data});
   let result=device.demo.command(data.action,data.params);
   if(data.action==='capabilities.get')Object.assign(result,info(device));
   if(data.action==='time.get')result={timezone_minutes:device.demo.state.timezone_minutes,ntp_host:'pool.ntp.org'};
   if(data.action==='time.set')device.demo.state.timezone_minutes=data.params.timezone_minutes;
   return localReply({code:data.action.endsWith('.get')?'ok':'accepted',data:result,request_id:data.request_id});
  }
  if(url.origin!==target){return route.abort();}
  if(path.startsWith('/api/')){
   const body=req.postDataBuffer(),data=body?.length?decodeWire(body):undefined,authorization=req.headers().authorization;
   const call={path,method:req.method(),data,authorization,at:Date.now()};calls.push(call);
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
   if(path==='/api/devices')return reply(devices.map(device=>({...info(device),mac:device.mac,version:'v2',status:'active',self:device.self,online:true,paired:true,route_confirmed:true,username:'preserved_namespace'})));
   const proxied=path.match(/^\/api\/hub\/devices\/([0-9a-f]{12})\/command$/);
   if(proxied||path==='/api/v1/command'){
    const device=proxied?devices.find(device=>device.mac===proxied[1]):local;
    assert(device);assert.equal(typeof data.request_id==='string'||data.action.endsWith('.get'),true);
    pending++;maxPending=Math.max(maxPending,pending);
    try{
     if(proxied&&!device.self&&!lanActions.has(data.action)){call.lanRejected=true;return await reply({code:'unsupported',request_id:data.request_id});}
     if(data.action==='capabilities.get'&&capabilitiesBusyFor===device.model){capabilitiesBusyFor='';call.injectedBusy=true;return await reply({code:'busy',request_id:data.request_id},503);}
     if(data.params?.delayed_test)await new Promise(resolve=>setTimeout(resolve,400));
     if(expireWrite&&!data.action.endsWith('.get')){expireWrite=false;tokens.clear();return await reply({code:'unauthorized',request_id:data.request_id},401);}
     let result=device.demo.command(data.action,data.params);
     if(data.action==='capabilities.get'){
      Object.assign(result,info(device));
      result.actions=[...new Set([...result.actions,'diagnostics.get'])];
      if(device.model==='tc1')result.actions=[...new Set([...result.actions,'power.get'])];
      if(device.model==='m1')result.actions=[...new Set([...result.actions,'wake_alarm.get','wake_alarm.start','wake_alarm.stop'])];
     }
     if(device.model==='tc1'&&data.action==='status.get'){result={...result};delete result.power_watts;delete result.power;}
     if(device.model==='tc1'&&data.action==='power.get')result={power_watts:powerWatts,energy_kwh:.28};
     if(device.model==='m1'&&data.action==='wake_alarm.get')result={active:false,tone_supported:true,tone_count:4,music_supported:true};
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
 return {context,calls,errors,consoleIssues,devices,setStage(value){stage=value;},get maxPending(){return maxPending;},get pending(){return pending;},setPower(value){powerWatts=value;},expireNextWrite(){expireWrite=true;},busyNextMe(){meBusy=true;},busyNextCapabilities(model){capabilitiesBusyFor=model;},changeFirmware(model){const device=devices.find(d=>d.model===model);device.firmware_version=firmware+'-updated';Object.assign(device.demo.state,{version:device.firmware_version,firmware_version:device.firmware_version});}};
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
   await expect(page.locator('.device-select').nth(1).locator('.stat')).toHaveText(/36\.0\s*W/);
   assert(f.calls.some(call=>call.data?.action==='power.get'),'TC1 list watts require the separate metering action');
   await expect(page.locator('.auth-form')).toHaveCount(0);
   assert(!f.calls.some(call=>call.path==='/api/hub/setup'||call.path==='/api/auth/login'));
   assert(!f.calls.some(call=>call.path.includes('mqtt')));
   const readyFrame=async(model,mark)=>{
    const device=f.devices.find(device=>device.model===model),identity={device_id:device.mac,model,firmware_version:device.firmware_version||firmware,variant:device.self?'hub':'full'};
    let snapshot;
    await expect.poll(async()=>{
     snapshot=await page.locator('iframe.device-home').evaluate((node,{identity,mark})=>{
      const view=node.contentWindow,caps=view?.UI?.caps,state=view?.UI?.state;
      if(!view||view.document.readyState!=='complete'||state?.device_id!==identity.device_id||caps?.device_id!==identity.device_id||caps.model!==identity.model||caps.firmware_version!==identity.firmware_version||(caps.variant||caps.firmware_variant)!==identity.variant||caps.wire_version!==1||caps.default_wire_format!=='msgpack')return null;
      // Check and mark one loaded document in the same browser evaluation.
      if(mark)view.__fixtureDocumentMarker=mark;
      return {identity,marker:view.__fixtureDocumentMarker||null};
     },{identity,mark});
     return snapshot?.identity;
    }).toEqual(identity);
    return snapshot;
   };
   const select=async model=>{
    f.setStage('select '+model);
    const index=f.devices.findIndex(device=>device.model===model);await page.locator('.device-select').nth(index).click();
    await readyFrame(model);
    return page.frameLocator('iframe.device-home');
   };
   for(const model of ['daikin','m1','a1','s30-v1b','tc1']){
    const frame=await select(model);
    if(model==='daikin')continue;
    const caps=await page.locator('iframe.device-home').evaluate(node=>node.contentWindow.UI.caps);
    assert.equal(caps.hub_remote,true);assert(caps.actions.every(action=>lanActions.has(action)));assert(!caps.actions.includes('config.set'));
    await frame.locator('.tabs a[data-tab="settings"]').click();
    await expect(frame.locator('#side a')).toHaveCount(1);
    await expect(frame.locator('#side a')).toHaveAttribute('href','#settings/diagnostics');
    for(const route of ['device','network','mqtt','maintenance','firmware']){
     await page.locator('iframe.device-home').evaluate((node,route)=>{node.contentWindow.UI.embeddedRoute='settings/'+route;node.contentWindow.UI.showRoute();},route);
     await expect(frame.locator('[data-settings-page="'+route+'"]:visible')).toHaveCount(0);
    }
    await expect(frame.locator('#deviceName,#webPassword')).toHaveCount(0);
   }
   await select('m1');assert.equal((await readyFrame('m1','before-firmware-change')).marker,'before-firmware-change');
   await page.evaluate(()=>{
    const counts={added:0,removed:0},frames=node=>node.nodeType===1?(node.matches('iframe.device-home')?1:0)+node.querySelectorAll('iframe.device-home').length:0;
    const observer=new MutationObserver(records=>{for(const record of records){for(const node of record.addedNodes)counts.added+=frames(node);for(const node of record.removedNodes)counts.removed+=frames(node);}});
    observer.observe(document.getElementById('app'),{childList:true,subtree:true});
    window.__firmwareFrameLifecycle={counts,observer};
   });
   f.busyNextCapabilities('m1');f.changeFirmware('m1');await page.locator('.devices-panel>button').last().click();
   assert.equal((await readyFrame('m1')).marker,null,'new discovery identity replaces the marked document and capabilities');
   await expect(page.frameLocator('iframe.device-home').locator('#wakeAlarmCard')).toHaveCount(1);
   assert.equal(await page.locator('iframe.device-home').evaluate(node=>node.contentWindow.UI.device.nav.schedule),'wake.schedules','the first busy capability read must recover product hooks');
   assert.equal(f.calls.filter(call=>call.injectedBusy).length,1);
   await readyFrame('m1','after-firmware-change');
   for(let i=0;i<2;i++){
    const inventoryReads=f.calls.filter(call=>call.path==='/api/devices').length;
    await page.locator('.devices-panel>button').last().click();
    await expect.poll(()=>f.calls.filter(call=>call.path==='/api/devices').length).toBeGreaterThan(inventoryReads);
    await expect.poll(()=>f.pending).toBe(0);
    assert.equal((await readyFrame('m1')).marker,'after-firmware-change','unchanged discovery preserves the loaded document');
   }
   const firmwareLifecycle=await page.evaluate(()=>{const {counts,observer}=window.__firmwareFrameLifecycle;observer.disconnect();return counts;});
   assert.deepEqual(firmwareLifecycle,{added:1,removed:1},'firmware change replaces the iframe once; ordinary refreshes preserve it');
   let frame=await select('tc1');
   f.setPower(0);await page.locator('iframe.device-home').evaluate(node=>node.contentWindow.command('power.get'));
   await expect(page.locator('.device-select').nth(1).locator('.stat')).toHaveText(/0\.0\s*W/);
   if(language==='en'&&!protectedDevice){
    await frame.locator('.tabs a[data-tab="settings"]').click();
    await expect(frame.locator('[data-settings-page="diagnostics"]')).toBeVisible();
    const powerPath='/api/hub/devices/'+f.devices.find(device=>device.model==='tc1').mac+'/command';
    const powerCalls=()=>f.calls.filter(call=>call.path===powerPath&&call.data?.action==='power.get');
    const powerReads=powerCalls().length;
    f.setPower(19);
    await expect(page.locator('.device-select').nth(1).locator('.stat')).toHaveText(/19\.0\s*W/,{timeout:12000});
    const began=Date.now();
    f.meterObservation={startedAt:began,samples:[]};
    // Freshness can defer a five-second owner poll to its next cycle while
    // foreground reads hold the serial lane. Observe all three conditions
    // together for up to three ten-second cycles, with two seconds to drain.
    await expect.poll(async()=>{
     const display=await page.locator('.device-select').nth(1).locator('.stat').textContent();
     f.meterObservation.samples.push({elapsedMs:Date.now()-began,display});
     assert.match(display,/19\.0\s*W/,'fresh selected watts must not flash blank');
     return Date.now()-began>15500&&powerCalls().length>=powerReads+3;
    },{timeout:32000,intervals:[250],message:'selected settings retain fresh watts across the TTL and at least three new power reads'}).toBe(true);
    f.meterObservation.reads=powerCalls().slice(powerReads).map(call=>({elapsedMs:call.at-began,request_id:call.data.request_id}));
    assert.equal(new Set(f.meterObservation.reads.map(read=>read.request_id)).size,f.meterObservation.reads.length,'every meter refresh uses a new request ID');
    f.setPower(0);await expect(page.locator('.device-select').nth(1).locator('.stat')).toHaveText(/0\.0\s*W/,{timeout:12000});
    await frame.locator('.tabs a[data-tab="home"]').click();
   }
   await frame.locator('#socket0').click();
   await expect.poll(()=>f.calls.filter(call=>call.data?.action==='outlet.set').length).toBe(1);
   assert.equal(f.calls.find(call=>call.data?.action==='outlet.set').path,'/api/hub/devices/aabbccddee01/command');
   const clockPage=await f.context.newPage();
   await clockPage.goto(target+'/iotcloud/#/local');
   await clockPage.getByRole('button',{name:zh?'本地连接':'Local connection',exact:true}).click();
   await clockPage.getByLabel(zh?'设备 IP':'Device IP',{exact:true}).fill(clockTarget);
   await clockPage.getByRole('button',{name:zh?'连接本地设备':'Connect local device',exact:true}).click();
   const clockFrame=clockPage.frameLocator('iframe.device-home');
   await expect(clockFrame.locator('#homePage')).toBeVisible();
   await clockFrame.locator('.tabs a[data-tab=settings]').click();await clockFrame.locator('.side a[href="#settings/device"]').click();
   const clock=clockFrame.locator('.card').filter({has:clockFrame.locator('[data-i18n="clock.title"]')});
   await expect(clock.locator('select')).toHaveValue('0');
   for(const timezone of [60,0]){
    await clock.locator('select').selectOption(String(timezone));await clock.locator('button[type="submit"]').click();
    await expect.poll(()=>f.calls.filter(call=>call.data?.action==='time.set').at(-1)?.data.params.timezone_minutes).toBe(timezone);
    await expect.poll(()=>f.pending).toBe(0);
    await clockPage.locator('iframe.device-home').evaluate(node=>node.contentWindow.UI.reload({full:true}));
    await expect.poll(()=>clockPage.locator('iframe.device-home').evaluate(node=>node.contentWindow.UI.state.timezone_minutes)).toBe(timezone);
   }
   await clockPage.close();
   frame=await select('tc1');
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
   assert.equal(f.maxPending,1,'gateway commands are serialized across targets');assert(!f.calls.some(call=>call.lanRejected),'filtered remote pages must not send local-only commands');assert.deepEqual(f.errors,[]);assert.deepEqual(f.consoleIssues,[]);
   results.push({engine:engine.name(),language,passwordRequired:protectedDevice,commands:f.calls.filter(call=>call.path.endsWith('/command')).length,maxPending:f.maxPending,firmwareLifecycle,meterObservation:f.meterObservation,passed:true});
   console.log('PASS',engine.name(),language,protectedDevice?'password':'open','binary controls, five models, UTC, cancelled reads, writes once, root/hub/reload session');
  }catch(error){
   if(evidence){await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true});await writeFile(resolve(evidence,'failure-calls.json'),JSON.stringify(f.calls,null,2)+'\n');}
   throw error;
  }finally{await f.context.close();}
 }}finally{await browser.close();}
}
if(evidence)await writeFile(resolve(evidence,'browser-results.json'),JSON.stringify(results,null,2)+'\n');
