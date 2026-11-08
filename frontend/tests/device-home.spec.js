import {test,expect} from '@playwright/test';
import packet from 'mqtt-packet';
import {encodeWire,decodeWire} from '../src/wireCodec.js';
for(const transport of ['LAN','MQTT'])for(const hardware of ['BRY88BBA15G','BRY88AX151K'])test(`${hardware} selects its hardware page after ${transport} status arrives`,async({page})=>{
 const mac='aabbccddee15',address='http://192.168.1.15',g3=hardware==='BRY88BBA15G',errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(({mac,address,transport})=>{
  const broker='ws://'+location.host+'/mqtt';
  const username=transport==='MQTT'?'test':'';
  if(username)localStorage.setItem('tmcp_broker',JSON.stringify({host:broker,username,password:'test'}));
  localStorage.setItem('iotcloud.devices.'+encodeURIComponent(broker)+'/'+username,JSON.stringify([{model:'daikin',mac,version:'v2',wire_format:'msgpack',wire_version:1,firmware_version:'fixture',variant:'full'}]));
  if(username)return;
  localStorage.setItem('phicomm.device-connection.'+encodeURIComponent(location.origin+':guest:'+broker+':')+':'+mac,JSON.stringify({mode:'auto',address}));
 },{mac,address,transport});
 const actions=['status.get','capabilities.get','binding.status.get','screen.layout.get'];
 const result=action=>action==='status.get'?{device_id:mac,model:'daikin',hardware_model:hardware,wifi_connected:true,sensors:Object.fromEntries([['pm25',0],['co2',641],['temperature',24],['humidity',50],['tvoc',132]].map(([key,value])=>[key,{valid:true,value,age_ms:0}]))}
  :action==='capabilities.get'?{device_id:mac,model:'daikin',firmware_version:'fixture',variant:'full',actions:g3?actions:actions.filter(a=>!a.startsWith('screen.'))}
  :action==='binding.status.get'?{peers:[],max_sessions:4}:{};
 await page.route('**/api/**',route=>route.fulfill({contentType:'application/json',body:'{}'}));
 if(transport==='MQTT')await page.routeWebSocket(/\/mqtt$/,socket=>{
  const parser=packet.parser(),send=value=>socket.send(packet.generate(value));
  socket.onMessage(message=>parser.parse(Buffer.from(message)));
  parser.on('packet',p=>{
   if(p.cmd==='connect')send({cmd:'connack',returnCode:0,sessionPresent:false});
   if(p.cmd==='pingreq')send({cmd:'pingresp'});
   if(p.cmd==='subscribe')send({cmd:'suback',messageId:p.messageId,granted:p.subscriptions.map(()=>1)});
   if(p.cmd!=='publish')return;
   if(p.qos===1)send({cmd:'puback',messageId:p.messageId});
   const request=decodeWire(p.payload);
   expect(request.action).toMatch(/\.get$/);
   send({cmd:'publish',qos:0,topic:p.topic.replace(/\/command$/,'/result'),payload:Buffer.from(encodeWire({code:'ok',request_id:request.request_id,data:result(request.action)},'msgpack'))});
  });
 });
 await page.route(address+'/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/v1/auth/login')return route.fulfill({status:404,body:'{}'});
  let data={};
  if(path==='/api/v1/info')data={device_id:mac,model:'daikin',api_version:1};
  if(path==='/api/v1/command'){
   const {action}=route.request().postDataJSON();
   data=result(action);
  }
  await route.fulfill({contentType:'application/json',body:JSON.stringify({code:'ok',data})});
 });
 await page.goto('/#/guest');
 await expect(page.locator('.device-heading')).toContainText(g3?'DAIKIN G3':'DAIKIN G1/G2');
 const home=page.frameLocator('iframe.device-home');
 await expect(home.locator('[data-sensor="pm25"] .num')).toHaveText('0');
 await expect(home.locator('[data-sensor="co2"] .num')).toHaveText('641');
 await expect(home.locator('[data-sensor="tvoc"] .num')).toHaveText('132');
 await expect(home.locator('title')).toHaveJSProperty('textContent',g3?'DAIKIN G3':'DAIKIN G1/G2');
 if(g3)await expect(home.locator('section.card:has(#indicator)')).toBeHidden();
 else await expect(home.locator('section.card:has(#indicator)')).toBeVisible();
 await home.locator('.tabs [data-tab="settings"]').click();
 await home.locator('a[href="#settings/device"]').click();
 if(g3){
  await expect(home.locator('#indicatorSettings')).toBeHidden();
  await expect(home.locator('#co2Settings')).toBeHidden();
  await expect(home.locator('a[href="#settings/screen"]')).toBeVisible();
 }else{
  await expect(home.locator('#indicatorSettings')).toBeVisible();
  await expect(home.locator('a[href="#settings/screen"]')).toHaveCount(0);
 }
 await home.locator('a[href="#settings/firmware"]').click();
 await expect(home.locator('#otaUrl')).toHaveAttribute('placeholder',new RegExp((g3?'BRY88BBA15G':'BRY88AX151K')+'\\.ota\\.bin\\.signed$'));
 expect(errors).toEqual([]);
});
test('product home components share platform design and expose full settings',async({page})=>{
 // Four products each wait for the ordinary status loop to declare offline.
 test.setTimeout(90000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('iotcloud.devices.'+encodeURIComponent(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/mqtt`)+'/',JSON.stringify(['tc1','m1','a1','daikin'].map((model,i)=>({model,mac:'aabbccddee0'+i,version:'v2'})))));
 await page.goto('/#/guest');
 for(const model of ['TC1','M1','A1','DAIKIN']){
  await page.locator('.device-select').filter({hasText:model}).click();
  const home=page.frameLocator('iframe');
  await expect(home.locator('#banners')).toContainText('连接已中断',{timeout:15000});
  await expect(home.locator('.topbar')).toBeHidden();
  await expect(home.locator('#settingsPage')).toBeHidden();
  await expect(home.locator('#homePage')).toBeVisible();
  // Auxiliary renderers can replace controls or refresh their disabled state
  // after an offline response. The whole disconnected home must stay inert.
  await expect(home.locator('#homePage')).toHaveJSProperty('inert',true);
  const buttons=home.locator('#homePage button');
  for(let i=0;i<await buttons.count();i++)expect(await buttons.nth(i).evaluate(el=>el.disabled||!!el.closest('[inert]'))).toBe(true);
  expect(await home.locator('body').evaluate(()=>document.documentElement.outerHTML.includes('@include'))).toBe(false);
  const shared=await page.locator('body').evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent'));
  expect(await home.locator('body').evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent'))).toBe(shared);
 }
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const home=page.frameLocator('iframe');
 expect(await home.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await expect(page.getByRole('heading',{name:'MQTT 连接',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
});
test('daily list hides protocol details and legacy names can be changed and restored',async({page})=>{
 await page.addInitScript(()=>{if(!localStorage.getItem('iotcloud.devices.'+encodeURIComponent(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/mqtt`)+'/'))localStorage.setItem('iotcloud.devices.'+encodeURIComponent(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/mqtt`)+'/',JSON.stringify([{model:'tc1',mac:'aabbccddee01',version:'v1'}]));});
 await page.goto('/#/guest');
 await expect(page.locator('.device-list')).not.toContainText(/Legacy|TMCP|aabbccddee01/);
 await page.getByRole('button',{name:/修改.*的名称/}).click();
 await page.getByLabel('设备名称',{exact:true}).fill('书房插排');
 await page.getByRole('button',{name:'保存名称'}).click();
 await expect(page.locator('.device-select')).toContainText('书房插排');
 await page.reload();await expect(page.locator('.device-select')).toContainText('书房插排');
 await page.getByRole('button',{name:/修改.*的名称/}).click();
 await page.getByRole('button',{name:'恢复默认名称'}).click();
 await expect(page.locator('.device-select')).toContainText('TC1 智能插排');
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/设备管理/}).click();
 await expect(page.locator('.managed-device')).toContainText('TC1 智能插排');
 await page.locator('.device-details summary').click();
 await expect(page.locator('.device-details')).toContainText('Legacy');
});
