// Isolated real browser windows: HTTPS platform -> HTTP device. No real DUTs.
import {createServer} from 'node:http';
import {createServer as secureServer} from 'node:https';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const root=resolve('..'),dist=resolve('dist'),temp=await mkdtemp(join(tmpdir(),'iotcloud-provision-test-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key.pem'),'-out',join(temp,'cert.pem'),'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
const pages=Object.fromEntries(['tc1','a1','m1'].map(model=>[model,execFileSync('python3',['common/web/page.py',model==='tc1'?'TC1/http_server/web/index.html':model.toUpperCase()+'/web/index.html'],{cwd:root,encoding:'utf8'})]));
let model='tc1',writes=[],requests=[];
const original={mqtt_host:'original.example',mqtt_port:1884,mqtt_user:'original-user',mqtt_protocol:'legacy',mqtt_topic_mode:'legacy'};
const state={...original,name:'Isolated device',device_id:'020000000001',version:'simulated',ip:'127.0.0.1',wifi_connected:true,mqtt_connected:false,mqtt_status:'disconnected',socket_states:[0,0,0,0,0,0],socket_names:['1','2','3','4','5','6'],uptime_seconds:10,brightness_requested:3};
const device=createServer(async(req,res)=>{
 requests.push({url:req.url,referer:req.headers.referer||'',method:req.method});
 // The provisioning fixture models a pre-token firmware device.
 if(req.url==='/api/v1/auth/login'){res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({code:'not_found'}));return;}
 if(req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(pages[model]);return;}
 let body='';for await(const chunk of req)body+=chunk;
 const request=JSON.parse(body);if(!request.action.endsWith('.get'))writes.push(request);
 const data=request.action==='status.get'?state:request.action==='capabilities.get'?{actions:['status.get','config.set'],model}:{};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:'ok',data}));
});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const platform=secureServer({key:await readFile(join(temp,'key.pem')),cert:await readFile(join(temp,'cert.pem'))},async(req,res)=>{
 if(req.url.startsWith('/api/')){res.writeHead(401,{'Content-Type':'application/json'});res.end('{}');return;}
 try{const path=new URL(req.url,'https://localhost').pathname,file=resolve(dist,'.'+(path==='/'?'/index.html':path));assert(file.startsWith(dist+'/'));res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
});
await Promise.all([new Promise(done=>device.listen(0,'127.0.0.1',done)),new Promise(done=>platform.listen(0,'127.0.0.1',done))]);
const deviceURL=`http://127.0.0.1:${device.address().port}/`,platformURL=`https://127.0.0.1:${platform.address().port}/`;
const browser=await chromium.launch(),secret='test-only-汉字-<tag>&?#',username='provision-test';
try{
 for(const scenario of ['tc1','a1','m1','expiry']){
  model=scenario==='expiry'?'tc1':scenario;
  writes=[];requests=[];const context=await browser.newContext({locale:'zh-CN',ignoreHTTPSErrors:true}),page=await context.newPage(),errors=[];
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
  if(scenario==='expiry')await page.clock.install();
  await page.addInitScript(()=>localStorage.setItem('tmcp_broker',JSON.stringify({host:'wss://broker.example.test/mqtt',username:''})));
  await page.goto(platformURL+'#/guest');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'设置',exact:true}).click();
  const form=page.getByRole('region',{name:'配置本地 IoT 设备'});
  await form.getByRole('button',{name:'填写到本地设备',exact:true}).click();
  for(const [label,value] of [['设备 IP 或本地网址',deviceURL],['设备 MQTT Host','broker.example.test'],['设备 MQTT 端口','1883'],['设备 MQTT 用户名',username],['设备 MQTT 密码',secret]])await form.getByLabel(label,{exact:true}).fill(value);
  await form.getByRole('checkbox').check();
  const opened=page.waitForEvent('popup');await form.getByRole('button',{name:'打开设备并填写',exact:true}).click();const popup=await opened;
  await popup.getByRole('button',{name:'接收并预填',exact:true}).waitFor();await popup.waitForFunction(()=>!document.querySelector('#mqttImport button').disabled);
  assert(popup.url().endsWith('#settings/mqtt'));assert(!popup.url().includes('iotcloud-import'));
  assert.equal(await popup.locator('#mqttHost').inputValue(),original.mqtt_host);assert.equal(writes.length,0);
  await popup.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://evil.example',source:window.opener,data:{type:'iotcloud.provision.config',id:'wrong',config:{password:'attacker'}}})));
  assert.equal(await popup.locator('#mqttPassword').inputValue(),'');
  await popup.evaluate(()=>window.addEventListener('message',e=>{if(e.data?.type==='iotcloud.provision.config')window.receivedPasswordKeys=Object.keys(e.data).sort();}));
  await popup.getByRole('button',{name:'接收并预填',exact:true}).click();await popup.getByText('配置已预填。',{exact:false}).waitFor();
  for(const [id,value] of [['mqttHost','broker.example.test'],['mqttPort','1883'],['mqttUser',username],['mqttPassword',secret]])assert.equal(await popup.locator('#'+id).inputValue(),value);
  if(model==='tc1')assert.equal(await popup.locator('#mqttMode').inputValue(),'tmcp');
  const link=popup.getByRole('link',{name:'打开 IotCloud',exact:true});assert.equal(await link.getAttribute('href'),'https://phicomm-io.github.io/iotcloud/#/');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
  assert.deepEqual(await popup.evaluate(()=>window.receivedPasswordKeys),['id','password','type'],'handshake transfers only the password, not broker configuration');
  assert.equal(await popup.evaluate(()=>window.opener),null);assert.equal(writes.length,0,'receive must not save');
  await popup.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://evil.example',source:null,data:{type:'iotcloud.provision.config',id:'wrong',config:{host:'attacker'}}})));
  assert.equal(await popup.locator('#mqttHost').inputValue(),'broker.example.test','replay is ignored');
  assert.equal(await form.getByLabel('设备 MQTT 密码',{exact:true}).inputValue(),'','clear transient sender secret after ACK');
  assert(!(await popup.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).includes(secret));
  assert(requests.every(r=>!r.url.includes('password')&&!r.url.includes('iotcloud-import')&&!r.url.includes(secret)&&!r.referer),'no credentials/handshake in HTTP URL/referrer');
  if(scenario==='expiry'){
   await popup.clock.fastForward(121000);
   assert.equal(await popup.locator('#mqttPassword').inputValue(),'');assert.equal(await popup.locator('#mqttHost').inputValue(),original.mqtt_host);assert.equal(writes.length,0);
  }else if(model==='m1'){
   await popup.locator('#mqttImport').getByRole('button',{name:'取消',exact:true}).click();
   assert.equal(await popup.locator('#mqttPassword').inputValue(),'');assert.equal(await popup.locator('#mqttHost').inputValue(),original.mqtt_host);assert.equal(writes.length,0);
  }else{
   await popup.locator('#mqttForm').getByRole('button',{name:'保存',exact:true}).click();await popup.waitForFunction(()=>document.querySelector('#mqttPassword').value==='');
   assert.equal(writes.length,1);assert.deepEqual(writes[0].params,{section:'mqtt',values:{host:'broker.example.test',port:1883,user:username,password:secret,...(model==='tc1'?{protocol:'tmcp'}:{})}});
  }
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${scenario}: HTTPS -> HTTP, consent, prefill-only, explicit save/cancel, no URL/storage/referrer credentials`);
 }
}finally{await browser.close();await Promise.all([new Promise(done=>platform.close(done)),new Promise(done=>device.close(done))]);await rm(temp,{recursive:true,force:true});}
