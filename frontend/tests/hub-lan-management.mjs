// Run after VITE_HUB=1 npm run build. HTTP fixtures verify the owner UI flow;
// they do not verify mDNS discovery or production UDP pairing.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {extname,resolve} from 'node:path';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {decodeWire,encodeWire} from '../src/wireCodec.js';

const root=resolve(process.env.HUB_LAN_DIST||process.env.HUB_TEST_DIST||'dist');
const evidence=resolve(process.env.HUB_LAN_EVIDENCE||'../../review/hub-lan-management');
const token='abcdef0123456789abcdef0123456789',peer='a1b2c3d4e5f6',ip='192.168.1.45';
let browser,inventory,events,pairPolls,paired,pairPhase,registered;
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://fixture').pathname;
  if(path.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const bytes=Buffer.concat(chunks),body=bytes.length?decodeWire(bytes,'msgpack'):{};
   if(path!=='/api/v1/info')assert.equal(req.headers.accept,'application/msgpack');
   if(bytes.length)assert.equal(req.headers['content-type'],'application/msgpack');
   const auth=req.headers.authorization;
   if(path.startsWith('/api/hub/lan')||path==='/api/devices'){
    events.push({path,method:req.method,body,auth});
    assert.equal(auth,'Bearer '+token,'LAN management must use the hub owner session');
   }
   let result={},status=200;
   if(path==='/api/v1/info')result={code:'ok',data:{api_version:1,device_id:'001122334455',model:'daikin',firmware_version:'fixture',variant:'hub',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack'}};
   else if(path==='/api/auth/me')result={username:'owner',mqtt_username:'owner'};
   else if(path==='/api/register/status')result={setup_required:false};
   else if(path==='/api/devices'&&req.method==='GET')result=registered?[{mac:peer,model:'tc1',version:'v2',status:'active'}]:[];
   else if(path==='/api/devices'&&req.method==='POST'){assert.deepEqual(body,{mac:peer,model:'tc1',version:'v2'});registered=true;result={code:'ok'};}
   else if(path==='/api/hub/lan'&&req.method==='GET')result={protocol:4,codec:'msgpack',discovery:'mdns',ready:true,devices:[{device_id:peer,model:'tc1',variant:'v2',firmware:'1.2.3',ip,port:80,compatible:true,registered,paired,online:true,code:paired?'ready':registered?'not_registered':'not_registered'}]};
   else if(path==='/api/hub/lan/pair'&&req.method==='POST'){
    assert.deepEqual(body,{peer,ip,password:'device-password',scopes:1});pairPhase='pending';pairPolls=0;status=202;result={code:'accepted'};
   }else if(path===`/api/hub/lan/pair/${peer}`&&req.method==='GET'){
    pairPolls++;if(pairPolls>1){pairPhase='paired';paired=true;}result={phase:pairPhase,code:'ok'};
   }else if(path==='/api/hub/lan/unpair'&&req.method==='POST'){
    assert.deepEqual(body,{peer});paired=false;pairPhase='';result={code:'ok'};
   }else if(path==='/api/hub/homekit')result={enabled:false,protocol:'hap',ready:false,paired:false,devices:0,code:'disabled'};
   else if(path==='/api/hub/bridge')result={enabled:false,mappings:[],mqtt:{host:'broker.example.net',port:1883,user:'upstream',password_set:false}};
   else if(path==='/api/integrations/bemfa')result={enabled:false,key_set:false,mappings:[],max_mappings:8,status:'disabled'};
   res.writeHead(status,{'Content-Type':'application/msgpack','Cache-Control':'no-store'}).end(encodeWire(result));return;
  }
  assert(path.startsWith('/iotcloud/'));
  const file=resolve(root,path.slice('/iotcloud/'.length)||'index.html');assert(file.startsWith(root+'/'));
  res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch(error){res.writeHead(500,{'Content-Type':'text/plain'}).end(error.message);}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/iotcloud/`;
const words={
 'zh-CN':{settings:'设置',devices:'设备管理',services:'中枢服务',lan:'局域网设备',pair:'配对设备',password:'设备 WebUI 密码',paired:'已配对',unpair:'取消配对',servicesTitle:'HomeKit',bemfa:'巴法云',haCopy:'Home Assistant 的 MQTT 接入需要配置外部 Broker。'},
 en:{settings:'Settings',devices:'Device management',services:'Hub services',lan:'LAN devices',pair:'Pair device',password:'Device WebUI password',paired:'Paired',unpair:'Unpair',servicesTitle:'HomeKit',bemfa:'Bemfa',haCopy:'Home Assistant MQTT access requires an external broker.'}
};
async function fixture(language,width){
 inventory='discovered';events=[];pairPolls=0;paired=false;registered=false;pairPhase='';
 const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(({language,token})=>{try{localStorage.setItem('phicomm.language',language);sessionStorage.setItem('iotcloud.device-session.v1',JSON.stringify({token,identity:{device_id:'001122334455',model:'daikin',firmware_version:'fixture',variant:'hub'},expires:Date.now()+1800000}));}catch{}},{language,token});
 await page.clock.install();await page.goto(base);
 const w=words[language];await page.getByRole('button',{name:w.settings,exact:true}).click();
 return {context,page,errors,w};
}
async function openLan(page,w){await page.locator('.settings-navigation').getByRole('button',{name:new RegExp(w.devices)}).click();return page.getByRole('region',{name:w.lan,exact:true});}
async function checkNoBrokerUI(page){
 const text=await page.locator('body').innerText();
 assert(!/\b(local|internal|embedded) broker\b|内置 Broker|本地 Broker/i.test(text),'removed local broker must not be offered in the UI');
}
async function checkLayout(page,label){
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow: '+label);
}
try{
 await mkdir(evidence,{recursive:true});browser=await chromium.launch();
 for(const [language,width] of [['zh-CN',390],['en',390],['zh-CN',1440],['en',1440]]){
  const f=await fixture(language,width),{context,page,errors,w}=f;
  try{
   const section=await openLan(page,w);
   await expect(section.getByText(w.haCopy,{exact:false})).toBeVisible();
   await expect(section.getByRole('button',{name:w.pair,exact:true})).toBeVisible();
   assert.deepEqual(events.filter(e=>e.path==='/api/hub/lan/pair'||(e.path==='/api/devices'&&e.method==='POST')).map(e=>e.path),[],'discovery must not register or pair a device');
   await checkNoBrokerUI(page);await checkLayout(page,`${language}-${width}-devices`);
   await page.screenshot({path:resolve(evidence,`${language}-${width}-devices.png`),fullPage:true});
   if(language==='en'&&width===390){
    await section.getByRole('button',{name:w.pair,exact:true}).click();
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
    await dialog.getByLabel(w.password).fill('device-password');
    await dialog.getByRole('button',{name:w.pair,exact:true}).click();
    await expect(section.getByRole('status')).toContainText('Device paired.');
    assert(pairPolls>=2,'pair result should be polled until completion');
    const pairRequest=events.find(e=>e.path==='/api/hub/lan/pair');assert(pairRequest);
    assert.equal(pairRequest.auth,'Bearer '+token);assert.deepEqual(pairRequest.body,{peer,ip,password:'device-password',scopes:1});
    page.once('dialog',dialog=>dialog.accept());await section.getByRole('button',{name:w.unpair,exact:true}).click();
    await expect(section.getByRole('button',{name:w.pair,exact:true})).toBeVisible();
    assert(events.some(e=>e.path==='/api/hub/lan/unpair'&&e.auth==='Bearer '+token));
   }
   await page.locator('.settings-navigation').getByRole('button',{name:new RegExp(w.services)}).click();
   const services=page.locator('.settings-content');
   await expect(services.getByRole('heading',{name:'HomeKit',exact:true})).toBeVisible();
   await expect(services.getByLabel(language==='zh-CN'?'上游 MQTT 地址':'Upstream MQTT host')).toBeVisible();
   await expect(services.getByLabel(language==='zh-CN'?'上游 MQTT 地址':'Upstream MQTT host')).toHaveValue('broker.example.net');
   await checkNoBrokerUI(page);
   await page.locator('.settings-navigation').getByRole('button',{name:new RegExp(w.bemfa)}).click();
   await expect(page.locator('.bemfa-card h2')).toBeVisible();
   assert.deepEqual(errors,[]);console.log(`PASS Hub LAN ${language} ${width}: owner UI fixture, discovery isolation, upstream/Bemfa/HomeKit`);
  }finally{await context.close();}
 }
}finally{await browser?.close();await new Promise(done=>server.close(done));}
