// VITE_HUB=1 build + the firmware account/broker/relay host adapter. Fixtures only.
import {createServer} from 'node:http';
import {createServer as netServer} from 'node:net';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import mqtt from 'mqtt';
import {chromium,webkit,expect} from '@playwright/test';
const root=resolve(process.env.HUB_TEST_DIST||'dist'),evidence=resolve(process.env.HUB_TEST_EVIDENCE||'../../review/hub-browser');
const freePort=async()=>{const s=netServer();await new Promise(done=>s.listen(0,'127.0.0.1',done));const p=s.address().port;await new Promise(done=>s.close(done));return p;};
const tcp=await freePort(),ws=await freePort(),child=spawn(process.env.HUB_TEST_CONSOLE||'/tmp/iotcloud-hub-console',[String(tcp),String(ws)],{stdio:['pipe','pipe','pipe']});
let id=0,errors='',ready;child.stderr.on('data',d=>errors+=d);
const pending=new Map(),events=[],started=new Promise(done=>ready=done);
createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);if(m.ready)return ready();if(m.event)events.push(m);else{pending.get(m.id)?.(m);pending.delete(m.id);}});
const request=async data=>{const key=++id;return new Promise((done,reject)=>{const timer=setTimeout(()=>{pending.delete(key);reject(Error('Native service timeout'));},8000);pending.set(key,r=>{clearTimeout(timer);done(r);});child.stdin.write(JSON.stringify({id:key,...data})+'\n');});};
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://local').pathname;
 if(path.startsWith('/api/')){
  let body='';for await(const chunk of req)body+=chunk;
  const auth=req.headers.authorization||'',reply=await request({method:req.method,path,body,token:auth.startsWith('Bearer ')?auth.slice(7):'',setup:auth==='Basic '+Buffer.from('admin:fixture-device-password').toString('base64'),host:'127.0.0.1'});
  if(path==='/api/register/status')Object.assign(reply.body,{mqtt_uri:`mqtt://127.0.0.1:${tcp}`,mqtt_ws_uri:`ws://127.0.0.1:${ws}/mqtt`});
  if(reply.token)res.setHeader('X-IotCloud-Session',reply.token);
  res.writeHead(reply.status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(reply.body));return;
 }
 assert(path.startsWith('/iotcloud/'));const file=resolve(root,path.slice(10)||'index.html');assert(file.startsWith(root+'/'));
 res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await started;await new Promise(done=>server.listen(0,'127.0.0.1',done));
const engine=process.env.BROWSER||'chromium';
const base=`http://127.0.0.1:${server.address().port}/iotcloud/`,browser=await ({chromium,webkit}[engine]).launch({headless:true,...(engine==='webkit'&&process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH?{executablePath:process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH}:{})}),clients=[];
let typedTimer;
try{
 const notice=(await readFile(resolve('src/hubPaho.js'),'utf8')).match(/^\/\*![\s\S]*?\*\//)?.[0];assert(notice);
 const app=(await readdir(resolve(root,'assets'))).find(name=>/^App-.*\.js$/.test(name));assert(app);
 assert((await readFile(resolve(root,'assets',app),'utf8')).replace(/\s+/g,' ').includes(notice.replace(/\s+/g,' ')),'hub bundle must retain the complete Paho EDL notice');
 await mkdir(evidence,{recursive:true});
 for(const [index,width] of [390,1440].entries())for(const language of ['zh-CN','en']){
  const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage(),pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(e.message));await page.addInitScript(l=>localStorage.setItem('phicomm.language',l),language);await page.goto(base);const zh=language==='zh-CN';
  if(index===0&&zh){
   await expect(page.getByRole('button',{name:'创建本地账户'})).toBeVisible();await page.getByLabel('用户名',{exact:true}).fill('local');await page.getByLabel('本地账户密码',{exact:true}).fill('fixture-local-password');await page.getByLabel('设备 WebUI 密码',{exact:true}).fill('fixture-device-password');await page.getByRole('button',{name:'创建本地账户'}).click();
  }else{await page.getByLabel(zh?'用户名':'Username',{exact:true}).fill('local');await page.locator('input[autocomplete="current-password"]').fill('fixture-local-password');await page.getByRole('button',{name:zh?'登录':'Sign in',exact:true}).click();}
  try{await page.getByRole('button',{name:zh?'设置':'Settings',exact:true}).click();}catch(e){await page.screenshot({path:resolve(evidence,`failure-${engine}-${language}-${width}.png`),fullPage:true});console.error(await page.locator('body').innerText());throw e;}
  await page.getByRole('button',{name:zh?/中枢服务/:/Hub services/}).click();await expect(page.getByRole('heading',{name:zh?'上游转发':'Upstream forwarding',exact:true})).toBeVisible();
  if(index===0&&zh){await page.getByLabel('上游 MQTT 地址').fill('fixture-upstream.lan');await page.getByLabel('用户名',{exact:true}).fill('upstream');await page.getByLabel('上游 MQTT 密码').fill('fixture-upstream-password');await page.getByLabel('启用转发').check();await page.getByRole('button',{name:'添加映射',exact:true}).click();await page.getByLabel('本地主题').fill('home/local');await page.getByLabel('上游主题').fill('home/remote');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'已保存，本地 Broker 继续运行。'})).toBeVisible();assert.equal(await page.getByLabel('上游 MQTT 密码').inputValue(),'');}
  await page.screenshot({path:resolve(evidence,`${engine}-${language}-${width}.png`),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow '+language+' '+width+' '+JSON.stringify(await page.locator('body *').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().right>innerWidth).map(n=>[n.tagName,n.className,n.getBoundingClientRect().width]).slice(0,8))));assert.deepEqual(pageErrors,[]);await context.close();
 }
 const login=await request({method:'POST',path:'/api/auth/login',body:JSON.stringify({username:'local',password:'fixture-local-password'})});assert.equal(login.status,200);const token=login.token;
 const deviceRecords=[['aabbccddeeff','tc1'],['aabbccddee01','a1'],['aabbccddee02','m1'],['aabbccddee03','daikin']];
 for(const [mac,model] of deviceRecords)assert.equal((await request({method:'POST',path:'/api/devices',token,body:JSON.stringify({mac,model,version:'v2'})})).status,201);
 const connection=await mqtt.connectAsync(`mqtt://127.0.0.1:${tcp}`,{username:'local',password:'fixture-local-password',clientId:'fixture-tc1'});clients.push(connection);
 const sandbox={window:{},structuredClone,performance};
 vm.runInNewContext(await readFile(resolve('../M1/web/display-format.js'),'utf8'),sandbox);
 vm.runInNewContext(await readFile(resolve('../common/web/demo.js'),'utf8'),sandbox);
 let fixtures={};const deviceWrites=[],deviceCommands=[];
 connection.on('message',(topic,payload)=>{
  const [,model,mac]=topic.match(/^phicomm\/v2\/u_6c6f63616c\/([^/]+)\/([^/]+)\/command$/)||[];
  if(!fixtures[model]||!deviceRecords.some(([id,kind])=>id===mac&&kind===model))return;
  const command=JSON.parse(payload.toString()),data=fixtures[model].command(command.action,command.params);
  const observed={model,...command,data:JSON.parse(JSON.stringify(data??null))};deviceCommands.push(observed);
  if(!command.action.endsWith('.get'))deviceWrites.push(observed);
  connection.publish(topic.replace(/\/command$/,'/result'),JSON.stringify({request_id:command.request_id,code:command.action.endsWith('.get')?'ok':'accepted',data}),{qos:1});
 });
 await connection.subscribeAsync('phicomm/v2/u_6c6f63616c/+/+/command',{qos:1});
 const readback=(write,action)=>{
  assert(write,'the expected write must traverse the real Broker');
  const index=deviceCommands.indexOf(write);assert(index>=0,'the write must belong to the observed Broker transcript');
  const read=deviceCommands.slice(index+1).find(command=>command.model===write.model&&command.action===action);
  assert(read,`${write.action} must be followed by an independent ${action} through the Broker`);
  assert.notEqual(read.request_id,write.request_id,'a SET reply cannot stand in for a GET receipt');return read.data;
 };
 let sensorSequence=1;
 const publishSources=()=>Promise.all([
  ['aabbccddeeff','tc1',{power:{value:42,unit:'W',valid:true,age_ms:100}}],
  ['aabbccddee01','a1',{fan_speed_percent:{value:65,unit:'%',valid:true,age_ms:100}}],
  ['aabbccddee03','daikin',{pm10:{value:28,unit:'µg/m³',valid:true,age_ms:100}}]
 ].map(([device_id,model,sensors])=>connection.publishAsync('phicomm/v2/u_6c6f63616c/sensor/'+device_id+'/state',JSON.stringify({schema:1,device_id,model,boot:1234,sequence:sensorSequence++,sensors}),{qos:0,retain:false})));
 typedTimer=setInterval(()=>publishSources().catch(error=>console.error('Typed fixture publication failed',error)),1000);
 for(const language of ['en','zh-CN']){
  const languageStart=deviceCommands.length;
  const lastWrite=action=>{const write=deviceCommands.slice(languageStart).findLast(command=>command.model==='m1'&&command.action===action);assert(write,`${language}: expected ${action} through the Broker`);return write;};
  fixtures=Object.fromEntries(deviceRecords.map(([,model])=>{const fixture=sandbox.window.PhicommDemo.create(model);fixture.state.name='Fixture '+model.toUpperCase();fixture.state.ip='';return [model,fixture];}));
  for(const [mac,model] of deviceRecords){const base='phicomm/v2/u_6c6f63616c/'+model+'/'+mac;await connection.publishAsync(base+'/availability','online',{qos:1,retain:true});await connection.publishAsync(base+'/state',JSON.stringify(fixtures[model].state),{qos:1,retain:true});}
  const context=await browser.newContext({viewport:{width:390,height:950},serviceWorkers:'block'}),page=await context.newPage(),pageErrors=[],external=[];
  page.on('pageerror',error=>pageErrors.push(error.message));await page.addInitScript(value=>localStorage.setItem('phicomm.language',value),language);
  await context.route('**/*',route=>{if(!route.request().url().startsWith(new URL(base).origin+'/')){external.push(route.request().url());return route.abort();}return route.continue();});
  await page.goto(base);await page.getByLabel(language==='en'?'Username':'用户名',{exact:true}).fill('local');await page.locator('input[autocomplete="current-password"]').fill('fixture-local-password');await page.getByRole('button',{name:language==='en'?'Sign in':'登录',exact:true}).click();
  for(const [,model] of deviceRecords){
   await page.locator('.device-picker-trigger').click();await page.locator('.picker-list>li>button').filter({hasText:'Fixture '+model.toUpperCase()}).click();
   const frame=page.frameLocator('iframe.device-home');await expect.poll(()=>frame.locator('body').evaluate(()=>window.UI?.state?.model)).toBe(model);
   const before=deviceWrites.length;
   if(model==='tc1')await frame.locator('#socket0').click();else if(model==='a1')await frame.locator('#power').click();else if(model==='m1')await frame.locator('[data-control="brightness"]').getByRole('button',{name:'2',exact:true}).click();else await frame.locator('#indicator').uncheck();
   await expect.poll(()=>deviceWrites.length).toBe(before+1);
   const expected={tc1:['outlet.set',{index:0,on:false}],a1:['fan.set',{on:false}],m1:['display.set',{brightness:50}],daikin:['indicator.set',{enabled:false}]}[model];
   assert.equal(deviceWrites.at(-1).model,model);assert.equal(deviceWrites.at(-1).action,expected[0]);assert.deepEqual(deviceWrites.at(-1).params,expected[1]);
   await expect.poll(()=>frame.locator('body').evaluate(()=>UI.controlBusy)).toBeFalsy();
   await frame.locator('.tabs a[data-tab=settings]').click();await frame.locator('.side a[href="#settings/device"]').click();await expect(frame.locator('#deviceName')).toBeVisible();await expect(frame.locator('#webPassword')).toBeVisible();
   if(model==='m1'){
    await expect(frame.locator('#displaySourceConfig')).toBeVisible();
    await frame.locator('#displaySelectedSource').selectOption('user');await frame.locator('#displayDoubleClick').selectOption('switch_display');
    await frame.locator('#display0Source').selectOption('mqtt');await frame.locator('#display1Source').selectOption('mqtt');
    await expect(frame.locator('#display0Candidate option').filter({hasText:'Fixture TC1'})).toHaveCount(1);
    await expect(frame.locator('#display1Candidate option').filter({hasText:'Fixture A1'})).toHaveCount(1);
    await frame.locator('#display0Candidate').selectOption({label:await frame.locator('#display0Candidate option').filter({hasText:'Fixture TC1'}).textContent()});
    await frame.locator('#display1Candidate').selectOption({label:await frame.locator('#display1Candidate option').filter({hasText:'Fixture A1'}).textContent()});
    await expect(frame.locator('#display0Metric')).toHaveValue('power');await expect(frame.locator('#display1Metric')).toHaveValue('fan_speed_percent');
    await expect(frame.locator('#display0Mode option')).toHaveCount(5);await expect(frame.locator('#display1Mode option')).toHaveCount(1);
    await frame.locator('#displaySourceSave').click();await expect(frame.locator('#displaySourceSave')).toBeEnabled();
    const sourceWrite=lastWrite('display_profile.set');
    assert.equal(sourceWrite.params.revision,1);assert.equal(sourceWrite.params.double_click,'switch_display');
    assert.equal(sourceWrite.params.lanes[0].device_id,'aabbccddeeff');assert.equal(sourceWrite.params.lanes[0].metric,'power');assert.equal(sourceWrite.params.lanes[0].unit,'W');
    assert.equal(sourceWrite.params.lanes[1].device_id,'aabbccddee01');assert.equal(sourceWrite.params.lanes[1].metric,'fan_speed_percent');assert.equal(sourceWrite.params.lanes[1].unit,'%');
    const sourceReceipt=readback(sourceWrite,'display_profile.get');assert.equal(sourceReceipt.schema,3);assert.equal(sourceReceipt.revision,2);assert.equal(sourceReceipt.runtime.profile,'formatted');
    assert.deepEqual(sourceReceipt.lanes,sourceWrite.params.lanes);
    for(const slot of [0,1]){await frame.locator('#display'+slot+'Source').selectOption('api');await frame.locator('#display'+slot+'TTL').fill('60');}
    await frame.locator('#displaySourceSave').click();await expect(frame.locator('#display0Write')).toBeEnabled();await expect(frame.locator('#display1Write')).toBeEnabled();
    const apiWrite=lastWrite('display_profile.set'),apiReceipt=readback(apiWrite,'display_profile.get');
    assert.equal(apiWrite.params.revision,2);assert.equal(apiReceipt.revision,3);assert(apiReceipt.lanes.every(lane=>lane.source==='api'&&lane.ttl_seconds===60));
    const patterns=[['0red','0green','1yellow','2green','2yellow'],['0yellow','1red','1green','2red']];
    for(const slot of [0,1]){
     const prefix='#display'+slot,lamps=Array.from({length:3},(_,position)=>Object.fromEntries(['red','green','yellow'].map(color=>[color,patterns[slot].includes(position+color)])));
     await frame.locator(prefix+'Value').fill(slot?'864':'321');await frame.locator(prefix+'WriteTTL').fill('60');
     if(!slot)await frame.locator(prefix+'Decimal').check();
     await frame.locator(prefix+'WriteLabel').setChecked(!slot);await frame.locator(prefix+'WriteGlyph').check();
     for(let position=0;position<3;position++)for(const color of ['red','green','yellow'])await frame.locator(prefix+'WriteLamp'+position+color).setChecked(lamps[position][color]);
     await frame.locator(prefix+'Write').click();await expect(frame.locator(prefix+'Write')).toBeEnabled();
     const write=lastWrite('display_value.set');
     assert.deepEqual(write.params,{revision:3,slot,number:slot?864:321,decimal:!slot,show_label:!slot,show_unit:true,lamps,ttl_seconds:60});
     const receipt=readback(write,'display_profile.get'),lane=receipt.runtime.lanes[slot];
     assert.equal(receipt.revision,3);assert.equal(lane.valid,true);assert.equal(lane.number,slot?864:321);assert.equal(lane.format,slot?4:7);assert.deepEqual(lane.lamps,lamps);
     assert.equal(lane.value,slot?864:Math.fround(3.21));assert.equal(lane.unit,slot?'µg/m³':'mg/m³');
     await expect(frame.locator(prefix+'Status')).toContainText(slot?'864 µg/m³':'3.21 mg/m³');
    }
    await page.screenshot({path:resolve(evidence,`m1-v3-raw-${engine}-${language}-390.png`),fullPage:true});
    await expect(frame.locator('#displaySourceStatus')).toContainText(language==='en'?'Waiting for controller confirmation':'等待控制器确认');
    for(const slot of [0,1]){
     await frame.locator('#display'+slot+'Clear').click();await expect(frame.locator('#display'+slot+'Write')).toBeEnabled();
     const clear=lastWrite('display_value.set');assert.deepEqual(clear.params,{revision:3,slot,ttl_seconds:0});
     const receipt=readback(clear,'display_profile.get'),lane=receipt.runtime.lanes[slot];
     assert.equal(lane.valid,false);assert.equal(lane.number,null);assert.equal(lane.format,null);assert.equal(lane.lamps,null);assert.equal(lane.remaining_ttl_seconds,0);
     if(!slot){assert.equal(receipt.runtime.lanes[1].number,864);assert.equal(receipt.runtime.lanes[1].valid,true);assert.equal(receipt.lanes[1].source,'api','clearing one frame preserves the other position');}
     else assert(receipt.runtime.lanes.every(lane=>!lane.valid));
     await expect(frame.locator('#display'+slot+'Status')).toContainText(language==='en'?'Waiting for a reading':'等待读数');
    }
    assert.equal(deviceCommands.slice(languageStart).some(command=>command.model==='m1'&&['display_source.get','display_source.set','display_data.set'].includes(command.action)),false,'current firmware must use v3 rather than the legacy display API');
    console.log(`PASS hub ${engine} ${language}: v3 typed TC1/A1 candidates through native TCP/WS MQTT + Vue iframe; both raw numbers/flags/18 lamps, independent GET receipts and two TTL0 clears`);
   }
   assert(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth),model+' embedded overflow');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'hub overflow');
   await page.screenshot({path:resolve(evidence,`device-${engine}-${language}-${model}-390.png`),fullPage:true});
   console.log(`PASS hub ${language} 390 ${model}: Vue iframe + native TCP/WS MQTT command/result and full settings`);
  }
  // An old controller advertises only v2 and rejects every v3 command. Reloading
  // the real host/iframe prevents a cached current-device form from hiding this.
  const legacy=sandbox.window.PhicommDemo.create('m1'),legacyCommand=legacy.command,v3=['display_profile.get','display_profile.set','display_value.set'],legacyStart=deviceCommands.length;
  legacy.state.name='Fixture M1';legacy.state.ip='';legacy.command=(action,params)=>{
   assert(!v3.includes(action),'the old-controller fixture rejects v3');const data=legacyCommand(action,params);
   if(action==='capabilities.get')data.actions=data.actions.filter(action=>!v3.includes(action));return data;
  };fixtures.m1=legacy;
  await connection.publishAsync('phicomm/v2/u_6c6f63616c/m1/aabbccddee02/state',JSON.stringify(legacy.state),{qos:1,retain:true});
  await page.reload();await page.locator('.device-picker-trigger').click();await page.locator('.picker-list>li>button').filter({hasText:'Fixture M1'}).click();
  const old=page.frameLocator('iframe.device-home');await expect.poll(()=>old.locator('body').evaluate(()=>window.UI?.state?.model)).toBe('m1');
  // Reload clears the parent's live feed registry. Observe new TCP publications
  // through the actual iframe bridge before opening the legacy settings form.
  await expect.poll(()=>old.locator('body').evaluate(async()=>{
   const sources=await getDeviceSensorSources('display');return [['aabbccddeeff','power'],['aabbccddee01','fan_speed_percent']].every(([id,metric])=>sources.some(source=>source.device_id===id&&source.metric===metric));
  })).toBe(true);
  await old.locator('.tabs a[data-tab=settings]').click();await old.locator('.side a[href="#settings/device"]').click();await expect(old.locator('#displaySourceSave')).toBeEnabled();
  await expect(old.locator('#display0Mode')).toHaveCount(0);
  const legacyCaps=deviceCommands.slice(legacyStart).findLast(command=>command.model==='m1'&&command.action==='capabilities.get');assert(legacyCaps);assert(v3.every(action=>!legacyCaps.data.actions.includes(action)));
  await old.locator('#displaySelectedSource').selectOption('user');await old.locator('#displayDoubleClick').selectOption('switch_display');
  for(const [slot,name] of [[0,'Fixture TC1'],[1,'Fixture A1']]){
   await old.locator('#display'+slot+'Source').selectOption('mqtt');const option=old.locator('#display'+slot+'Candidate option').filter({hasText:name});await expect(option).toHaveCount(1);await old.locator('#display'+slot+'Candidate').selectOption({label:await option.textContent()});
  }
  await old.locator('#displaySourceSave').click();await expect(old.locator('#displaySourceSave')).toBeEnabled();
  const legacySource=lastWrite('display_source.set'),legacyReceipt=readback(legacySource,'display_source.get');
  assert.equal(legacySource.params.revision,1);assert.equal(legacyReceipt.revision,2);assert.equal(legacySource.params.lanes[0].device_id,'aabbccddeeff');assert.equal(legacySource.params.lanes[1].device_id,'aabbccddee01');
  await old.locator('#display0Source').selectOption('api');await old.locator('#display0Metric').selectOption('power');await old.locator('#displaySourceSave').click();await expect(old.locator('#display0Write')).toBeEnabled();
  const legacyAPI=lastWrite('display_source.set');assert.equal(readback(legacyAPI,'display_source.get').revision,3);
  await old.locator('#display0Value').fill('42');await old.locator('#display0Write').click();await expect(old.locator('#display0Write')).toBeEnabled();await expect(old.locator('#display0Status')).toContainText('42 W');
  const lease=lastWrite('display_data.set');assert.deepEqual(lease.params,{revision:3,slot:0,value:42,unit:'W',ttl_seconds:20});assert.equal(readback(lease,'display_source.get').runtime.lanes[0].value,42);
  await old.locator('#display0Clear').click();await expect(old.locator('#display0Write')).toBeEnabled();const clear=lastWrite('display_data.set');assert.deepEqual(clear.params,{revision:3,slot:0,ttl_seconds:0});
  const cleared=readback(clear,'display_source.get');assert.equal(cleared.runtime.lanes[0].valid,false);assert.equal(cleared.lanes[1].device_id,'aabbccddee01');
  assert.equal(deviceCommands.slice(legacyStart).some(command=>command.model==='m1'&&v3.includes(command.action)),false);
  await expect(old.locator('#display0Status')).toContainText(language==='en'?'Waiting for a reading':'等待读数');
  await writeFile(resolve(evidence,`m1-native-broker-${engine}-${language}.json`),JSON.stringify(deviceCommands.slice(languageStart).filter(command=>command.model==='m1'&&/^display_(profile|value|source|data)\./.test(command.action)),null,2)+'\n');
  console.log(`PASS hub ${engine} ${language}: old-controller v2 capabilities, typed source/data writes, independent GET and TTL0 fallback through native Broker + Vue iframe`);
  assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);await context.close();
 }
 const observer=await mqtt.connectAsync(`ws://127.0.0.1:${ws}/mqtt`,{username:'local',password:'fixture-local-password',clientId:'fixture-ha'});clients.push(observer);
 const messages=[];observer.on('message',(t,b)=>messages.push({topic:t,body:b.toString()}));await observer.subscribeAsync('#');
 const wait=async f=>{const began=Date.now();while(!f()){if(Date.now()-began>4000)throw Error('MQTT observation timeout');await new Promise(done=>setTimeout(done,20));}};
 await connection.publishAsync('home/local','event',{qos:1});await wait(()=>events.some(e=>e.event==='upstream'&&e.payload==='event'));
 assert.equal((await request({method:'PUT',path:'/api/hub/bridge',token,body:JSON.stringify({enabled:true,mappings:[{direction:'out',local_topic:'home/local',remote_topic:'home/remote',retain:false,allow_retained:false},{direction:'in',local_topic:'home/in',remote_topic:'home/remote',retain:false,allow_retained:false}]})})).status,200);
 await request({op:'incoming',source:0,topic:'home/remote',payload:'upstream event'});await wait(()=>messages.some(m=>m.topic==='home/in'&&m.body==='upstream event'));
 await connection.publishAsync('home/local','echo',{qos:1});await wait(()=>events.some(e=>e.event==='upstream'&&e.payload==='echo'));await request({op:'incoming',source:0,topic:'home/remote',payload:'echo'});assert(!messages.some(m=>m.topic==='home/in'&&m.body==='echo'));
 const device={mac:'aabbccddeeff',model:'tc1',version:'v2',status:'active',username:'local'};
 assert.equal((await request({method:'PUT',path:'/api/integrations/bemfa',token,body:JSON.stringify({enabled:true,api_key:'fixture_bemfa_key_123456789',mappings:[{device,channel:2,topic:'socket001'}]})})).status,200);
 const topic='phicomm/v2/u_6c6f63616c/tc1/aabbccddeeff';await connection.publishAsync(topic+'/availability','online',{qos:1,retain:true});await connection.publishAsync(topic+'/state',JSON.stringify({socket_states:[0,0,0,0,0,0]}),{qos:1,retain:true});await wait(()=>events.some(e=>e.event==='bemfa'&&e.payload==='off'));
 await request({op:'incoming',source:1,topic:'socket001',payload:'on'});await wait(()=>messages.some(m=>m.topic===topic+'/command'));
 const command=JSON.parse(messages.find(m=>m.topic===topic+'/command').body);assert.equal(command.action,'outlet.set');assert.deepEqual(command.params,{index:2,on:true});
 console.log('PASS hub console: local account/API + real TCP/WebSocket broker; bilingual/mobile setup/login/bridge; upstream echo and Bemfa outlet forwarding');
}finally{clearInterval(typedTimer);for(const c of clients)await c.endAsync();await browser.close();await new Promise(done=>server.close(done));child.kill('SIGTERM');await new Promise(done=>child.on('exit',done));assert.equal(child.exitCode,0,errors);assert(!errors.includes('runtime error:'),errors);}
