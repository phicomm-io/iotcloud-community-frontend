// Exercise the production bundle with isolated HTTP and MQTT fixtures, never real devices.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import {chromium,webkit,expect} from '@playwright/test';
import mqttPacket from 'mqtt-packet';

const dist=resolve('dist'),demo=resolve(process.env.PHICOMM_DEMO_DIST||'../build/bundle/demos/platform'),evidence=resolve('../build/mobile-layout');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://local').pathname,root=path.startsWith('/demo/')?demo:dist;
  const relative=root===demo?path.slice('/demo'.length):path,file=resolve(root,'.'+(relative==='/'?'/index.html':relative));
  assert(file.startsWith(root+'/'));res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}`;
const sandbox={window:{},structuredClone};
runInNewContext(await readFile('../common/web/demo.js','utf8'),sandbox);
const createDevice=sandbox.window.PhicommDemo.create;
const engines=process.env.BROWSER?[process.env.BROWSER]:['chromium','webkit'];
const defaultDevices=['tc1','a1','m1'].map((model,i)=>({model,mac:'aabbccddee0'+i,version:'v2',username:'layout-test'}));
await mkdir(evidence,{recursive:true});

async function fixture(browser,{admin=false,guest=false,count=3,hint=false,connectDelay=0,loseNameReceipt=false}={}){
 const context=await browser.newContext({locale:'zh-CN',viewport:{width:375,height:667},hasTouch:true,serviceWorkers:'block'});
 const page=await context.newPage(),errors=[],commands=[],connections=[],apiRequests=[],channels=new Set();
 page.on('pageerror',error=>errors.push(error.message));
 const state={devices:Array.from({length:count},(_,i)=>({...defaultDevices[i%3],mac:(0xaabbccddee00+i).toString(16)})),online:true};
 const devices=new Map(state.devices.map(d=>[d.mac,createDevice(d.model)])),lostNameReads=new Set();
 for(const [mac,device] of devices){device.state.device_id=mac;device.state.name=device.state.model.toUpperCase()+' 客厅设备';}
 const mqttURL=hint?'wss://broker.example.test/mqtt':base.replace('http:','ws:')+'/mqtt';
 await page.addInitScript(({base,mqttURL,guest,devices})=>{
  if(guest){
   localStorage.setItem('tmcp_broker',JSON.stringify({host:mqttURL,username:'layout-test'}));
   localStorage.setItem('iotcloud.devices.'+encodeURIComponent(mqttURL)+'/layout-test',JSON.stringify(devices));
  }else sessionStorage.setItem('phicomm.mqtt-login.'+base,JSON.stringify({owner:'layout-test',password:'fixture-only'}));
 },{base,mqttURL,guest,devices:state.devices});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/config.json')return route.fulfill({json:{}});
  if(url.pathname.startsWith('/api/')){
   apiRequests.push({origin:url.origin,headers:route.request().headers()});
   const remote=url.origin!==base;
   let data={};
   if(url.pathname==='/api/auth/me')data={username:remote?'other-node':'layout-test',mqtt_username:remote?'other-node':'layout-test',is_admin:admin};
   if(url.pathname==='/api/devices')data=remote?[]:state.devices;
   if(url.pathname==='/api/register/status')data={enabled:true,mqtt_ws_uri:mqttURL,mqtt_uri:'mqtt://broker.example.test:1883'};
   return route.fulfill({json:data});
  }
  if(url.origin!==base)return route.abort();
  return route.continue();
 });
 await page.routeWebSocket('**/mqtt',socket=>{
  const parser=mqttPacket.parser();
  const send=packet=>socket.send(mqttPacket.generate(packet));
  const channel={send,topics:new Set()};channels.add(channel);socket.onClose(()=>channels.delete(channel));
  parser.on('packet',packet=>{
   if(packet.cmd==='connect'){connections.push(packet.username);setTimeout(()=>send({cmd:'connack',returnCode:0,sessionPresent:false}),connectDelay);}
   if(packet.cmd==='subscribe'){
    send({cmd:'suback',messageId:packet.messageId,granted:packet.subscriptions.map(()=>0)});
    for(const subscription of packet.subscriptions){
     const topic=subscription.topic.replace(/\/#$/,''),device=devices.get(topic.split('/').pop());
     if(device){channel.topics.add(topic);send({cmd:'publish',topic:topic+'/availability',payload:state.online?'online':'offline',qos:0});send({cmd:'publish',topic:topic+'/state',payload:JSON.stringify(device.state),qos:0});}
    }
   }
   if(packet.cmd==='publish'){
    if(packet.qos===1)send({cmd:'puback',messageId:packet.messageId});
    const mac=packet.topic.split('/').at(-2),device=devices.get(mac),request=JSON.parse(packet.payload.toString());
    assert(device,'Command must target a fixture device');commands.push({mac,...request});
    const data=device.command(request.action,request.params);
    if(loseNameReceipt&&request.action==='config.set'&&request.params.section==='device'){lostNameReads.add(mac);return;}
    if(request.action==='config.get'&&lostNameReads.delete(mac))return;
    send({cmd:'publish',topic:packet.topic.replace(/\/command$/,'/result'),qos:0,payload:JSON.stringify({request_id:request.request_id,code:request.action.endsWith('.get')?'ok':'accepted',data})});
   }
   if(packet.cmd==='pingreq')send({cmd:'pingresp'});
   if(packet.cmd==='unsubscribe')send({cmd:'unsuback',messageId:packet.messageId});
  });
  socket.onMessage(message=>parser.parse(Buffer.from(message)));
 });
 await page.goto(base+(guest?'/#/guest':'/#/'));
 const setOnline=value=>{state.online=value;for(const channel of channels)for(const topic of channel.topics)channel.send({cmd:'publish',topic:topic+'/availability',payload:value?'online':'offline',qos:0});};
 return {context,page,errors,commands,devices,state,connections,apiRequests,setOnline};
}
const settings=page=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'设置',exact:true});
const home=page=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'首页',exact:true});
async function choose(page,model){
 await page.locator('.device-picker-trigger').click();
 await page.getByRole('dialog',{name:/切换设备/}).getByRole('button',{name:new RegExp(model)}).first().click();
 await expect(page.getByRole('dialog',{name:/切换设备/})).not.toBeVisible();
 await expect(page.locator('iframe')).toHaveAttribute('title',model+' 首页');
 await expect(page.frameLocator('iframe').locator('#homePage')).toBeVisible();
}
async function inViewport(locator,height){
 await expect(locator).toBeVisible();
 const box=await locator.boundingBox();
 if(box.y<0||box.y+box.height>height)await locator.page().screenshot({path:resolve(evidence,'first-screen-failure.png')});
 assert(box.y>=0&&box.y+box.height<=height,`Control outside first screen (${locator}): ${JSON.stringify(box)}`);
}
try{
 for(const engine of engines){
  assert(['chromium','webkit'].includes(engine));
  const browser=await ({chromium,webkit}[engine]).launch();
  try{
   // Initial reads wait for MQTT readiness rather than the next 3-second poll.
   const delayed=await fixture(browser,{connectDelay:1200});
   await choose(delayed.page,'A1');
   await expect(delayed.page.frameLocator('iframe').locator('#power')).toBeEnabled({timeout:2200});
   await expect(delayed.page.frameLocator('iframe').locator('[data-settings-page="light"]')).toHaveJSProperty('hidden',true);
   await delayed.page.waitForTimeout(1200);
   assert.equal(delayed.commands.filter(c=>c.action==='status.get'&&c.mac===delayed.state.devices[1].mac).length,1,'Hidden light settings must not trigger rapid status polling');
   assert.deepEqual(delayed.errors,[]);await delayed.context.close();
   const renamed=await fixture(browser,{loseNameReceipt:true});
   await renamed.page.setViewportSize({width:1440,height:900});
   for(const model of ['A1','M1']){
    await expect(renamed.page.getByRole('button',{name:`修改 ${model} 客厅设备 的名称`,exact:true})).toBeVisible();
    await renamed.page.getByRole('button',{name:`修改 ${model} 客厅设备 的名称`,exact:true}).click();
    await renamed.page.getByLabel('设备名称',{exact:true}).fill(model+' 已确认');
    await renamed.page.getByRole('button',{name:'保存名称',exact:true}).click();
    await expect(renamed.page.locator('.rename-dialog')).not.toBeVisible({timeout:10000});
    await expect(renamed.page.getByRole('button',{name:`修改 ${model} 已确认 的名称`,exact:true})).toBeVisible();
   }
   assert.equal(renamed.commands.filter(c=>c.action==='config.set').length,2);
   assert.deepEqual(renamed.errors,[]);await renamed.context.close();
   const f=await fixture(browser),{page}=f;
   await expect(page.frameLocator('iframe').locator('#allOn')).toBeEnabled();
   for(const viewport of [{width:375,height:667},{width:390,height:844},{width:320,height:667}]){
    await page.setViewportSize(viewport);
    await expect(page.locator('.node-bar')).toHaveCount(0);
    await expect(page.locator('.devices-panel')).toBeHidden();
    for(const model of ['TC1','A1','M1']){
     await choose(page,model);
     const frame=page.frameLocator('iframe');
     await expect(frame.locator('body > p[role=status]')).toBeHidden();
     const top=(await page.locator('iframe').boundingBox()).y;assert(top<=300,`${model} content starts at ${top}`);
     if(model==='TC1'){await inViewport(frame.locator('#allOn'),viewport.height);await inViewport(frame.locator('#tiles .tile').first(),viewport.height);}
     if(model==='A1'){await inViewport(frame.locator('#power'),viewport.height);await inViewport(frame.locator('#speed'),viewport.height);}
     if(model==='M1'){await inViewport(frame.locator('#verdict'),viewport.height);await inViewport(frame.locator('#metrics').locator('> *').first(),viewport.height);}
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
     if(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth))console.log(await frame.locator('body').evaluate(()=>({width:innerWidth,elements:[...document.querySelectorAll('#homePage *')].filter(e=>e.getBoundingClientRect().right>innerWidth).map(e=>({tag:e.tagName,cls:e.className,id:e.id,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).slice(0,20)})));
     assert(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${engine} ${model} ${viewport.width}: device horizontal overflow`);
     if(viewport.width===375)await page.screenshot({path:resolve(evidence,`${engine}-${model}-375.png`)});
    }
   }
   // Controls must route writes to the selected device's MAC.
   await page.setViewportSize({width:375,height:667});
   await choose(page,'A1');
   await page.frameLocator('iframe').locator('#power').click();
   await expect.poll(()=>f.commands.filter(c=>c.action==='fan.set').length).toBe(1);
   assert.equal(f.commands.find(c=>c.action==='fan.set').mac,f.state.devices[1].mac);
   const autoFrame=page.frameLocator('iframe');
   await expect(autoFrame.locator('#fanMode')).toBeVisible();
   await autoFrame.locator('#fanMode button').nth(1).click();
   await expect.poll(()=>f.devices.get(f.state.devices[1].mac).state.fan_mode).toBe('auto');
   assert.equal(f.devices.get(f.state.devices[1].mac).state.fan_on,false,'Platform mode selection preserves off');
   await autoFrame.locator('#autoSettings').click();
   const autoPage=autoFrame.locator('[data-settings-page="linkage"]');
   await expect(autoPage).toBeVisible();
   await autoPage.getByText('启用启停回差',{exact:true}).click();
   await autoPage.getByText('PM2.5 启动阈值',{exact:true}).locator('..').locator('input').fill('65');
   await autoPage.getByText('PM2.5 目标值（待机）',{exact:true}).locator('..').locator('input').fill('30');
   await autoPage.getByRole('button',{name:'保存',exact:true}).click();
   await expect.poll(()=>f.commands.filter(c=>c.action==='linkage.set').length).toBe(1);
   const rule=f.commands.find(c=>c.action==='linkage.set');
   assert.equal(rule.mac,f.state.devices[1].mac);assert.equal(rule.params.hysteresis_enabled,1);assert.equal(rule.params.on_pm,65);assert.equal(rule.params.target_pm,30);
   await autoFrame.getByRole('link',{name:'首页',exact:true}).click();
   await expect(autoFrame.locator('#homePage')).toBeVisible();
   await choose(page,'TC1');
   await page.frameLocator('iframe').locator('#tiles .tile').first().click();
   await expect.poll(()=>f.commands.filter(c=>c.action==='outlet.set').length).toBe(1);
   assert.equal(f.commands.find(c=>c.action==='outlet.set').mac,f.state.devices[0].mac);
   // Opening/closing the picker preserves the iframe, focus and page position.
   const frame=await page.locator('iframe').elementHandle();
   const scroll=await page.evaluate(()=>scrollY);
   await page.locator('.device-picker-trigger').click();
   for(let i=0;i<7;i++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>!!document.activeElement.closest('.device-picker')),'Focus stays inside the modal');}
   await page.screenshot({path:resolve(evidence,`${engine}-device-picker.png`)});
   await page.keyboard.press('Escape');
   await expect(page.locator('.device-picker-trigger')).toBeFocused();
   assert(await frame.evaluate(el=>el===document.querySelector('iframe')));
   assert.equal(await page.evaluate(()=>scrollY),scroll);
   assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'');
   await page.locator('.device-picker-trigger').click();await page.mouse.click(5,5);
   await expect(page.locator('.device-picker')).not.toBeVisible();
   await page.locator('.device-picker-trigger').click();
   await page.setViewportSize({width:1440,height:900});
   await expect(page.locator('.device-picker')).not.toBeVisible();
   await expect(page.locator('.devices-panel')).toBeVisible();
   await expect(page.locator('.device-picker-trigger')).toBeHidden();
   await page.screenshot({path:resolve(evidence,`${engine}-desktop.png`)});
   await settings(page).click();await expect(page.getByLabel('选择平台节点')).toBeVisible();
   await page.evaluate(()=>sessionStorage.setItem('iotcloud.session.'+location.origin,'original-node-token'));
   await page.getByLabel('选择平台节点').selectOption('us');
   await expect(page.getByRole('heading',{name:'从一台设备开始'})).toBeVisible();
   await expect(page.locator('.node-bar')).toHaveCount(0);
   assert(!f.apiRequests.filter(r=>r.origin==='https://mqtt.fjrcn.com').some(r=>r.headers.authorization));
   assert(!f.connections.includes('other-node'),'Other node must not inherit MQTT credentials');
   await page.goto(base+'/#/login');await expect(page.getByLabel('选择平台节点')).toBeVisible();
   await page.goto(base+'/#/register');await expect(page.getByLabel('选择平台节点')).toBeVisible();
   assert.deepEqual(f.errors,[]);await f.context.close();

   const many=await fixture(browser,{admin:true,count:20,hint:true});
   const long='客厅空气净化设备名称很长'.repeat(5);
   many.devices.get(many.state.devices[0].mac).state.name=long;
   await expect(many.page.locator('.current-device b')).toHaveText(long);
   const hintTop=(await many.page.locator('iframe').boundingBox()).y;
   if(hintTop>300)await many.page.screenshot({path:resolve(evidence,'host-hint-failure.png')});
   assert(hintTop<=300,`Collapsed host hint leaves room for device: ${hintTop}`);
   await many.page.locator('.device-host-hint summary').click();await expect(many.page.locator('.device-host-hint p')).toBeVisible();
   await many.page.getByRole('button',{name:'我知道了'}).click();await expect(many.page.locator('.device-host-hint')).toHaveCount(0);
   await many.page.locator('.device-picker-trigger').click();
   await expect(many.page.locator('.picker-list > li')).toHaveCount(20);
   assert(await many.page.locator('.picker-list').evaluate(el=>el.scrollHeight>el.clientHeight));
   const last=many.page.locator('.picker-list > li button').last();await last.click();
   await expect(many.page.locator('iframe')).toHaveAttribute('title','A1 首页');
   await many.page.frameLocator('iframe').locator('#power').click();
   await expect.poll(()=>many.commands.filter(c=>c.action==='fan.set').length).toBe(1);
   assert.equal(many.commands.find(c=>c.action==='fan.set').mac,many.state.devices.at(-1).mac);
   await many.page.locator('.device-picker-trigger').click();
   await expect(many.page.locator('.picker-list [aria-pressed=true]')).toBeInViewport();
   // Refresh removal while open updates selection without losing the dialog.
   many.state.devices=many.state.devices.slice(0,1);many.setOnline(false);
   await many.page.getByRole('button',{name:'刷新设备列表',exact:true}).click();
   await expect(many.page.locator('.picker-list > li')).toHaveCount(1);
   await many.page.getByRole('button',{name:'完成',exact:true}).click();
   await expect(many.page.locator('iframe')).toHaveAttribute('title','TC1 首页');
   await expect(many.page.locator('.current-device small')).toHaveText('离线');
   await settings(many.page).click();
   await many.page.getByRole('button',{name:/账号安全/}).click();await expect(many.page.getByRole('link',{name:/平台管理/}).last()).toBeVisible();
   await home(many.page).click();await expect(many.page.locator('.node-bar')).toHaveCount(0);
   await many.page.reload();await expect(many.page.locator('.device-host-hint')).toHaveCount(0);
   assert.deepEqual(many.errors,[]);await many.context.close();

   for(const count of [0,1]){
    const g=await fixture(browser,{guest:true,count});
    if(count){await g.page.locator('.device-picker-trigger').click();await expect(g.page.locator('.picker-list > li')).toHaveCount(1);await g.page.getByRole('button',{name:'完成',exact:true}).click();}
    else{await expect(g.page.getByRole('heading',{name:'从一台设备开始'})).toBeVisible();await expect(g.page.locator('.device-picker-trigger')).toHaveCount(0);}
    await expect(g.page.locator('.node-bar')).toHaveCount(0);await settings(g.page).click();await expect(g.page.getByLabel('选择平台节点')).toBeVisible();
    assert.deepEqual(g.errors,[]);await g.context.close();
   }
   const demoContext=await browser.newContext({locale:'zh-CN',viewport:{width:390,height:844},serviceWorkers:'block'}),demoPage=await demoContext.newPage();
   const external=[];demoPage.on('request',request=>{if(!request.url().startsWith(base+'/'))external.push(request.url());});
   await demoPage.route('**/*',route=>route.request().url().startsWith(base+'/demo/')?route.continue():route.abort());
   await demoPage.goto(base+'/demo/');
   await expect(demoPage.getByRole('link',{name:'打开正式管理平台 ↗'})).toHaveAttribute('href','https://phicomm-io.github.io/iotcloud/');
   await expect(demoPage.locator('.device-picker-trigger')).toBeVisible();
   for(const [i,model] of ['TC1','M1','A1'].entries()){
    await demoPage.locator('.device-picker-trigger').click();await demoPage.locator('.picker-list > li button').nth(i).click();
    await expect(demoPage.locator('iframe')).toHaveAttribute('title',model+' 首页');
   }
   await expect(demoPage.frameLocator('iframe').locator('#power')).toBeEnabled();
   await demoPage.frameLocator('iframe').locator('#power').click();
   await settings(demoPage).click();await expect(demoPage.locator('.node-bar')).toHaveCount(0);
   assert.deepEqual(external,[]);
   await demoPage.route('https://phicomm-io.github.io/iotcloud/',route=>route.fulfill({contentType:'text/html',body:'<h1>Formal platform destination</h1>'}));
   await demoPage.getByRole('link',{name:'打开正式管理平台 ↗'}).click();
   await expect(demoPage).toHaveURL('https://phicomm-io.github.io/iotcloud/');
   await expect(demoPage.getByRole('heading',{name:'Formal platform destination'})).toBeVisible();
   await demoContext.close();
   console.log(`PASS ${engine}: first-screen controls, picker/focus/scroll, target routing, desktop, node isolation, long names, 0/1/20 devices, admin, guest and demo`);
  }finally{await browser.close();}
 }
}finally{await new Promise(done=>server.close(done));}
