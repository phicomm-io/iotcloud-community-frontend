import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {encodeWire,decodeWire} from '../src/wireCodec.js';
for(const model of ['a1','m1','tc1'])test(`${model} setup works offline and shares appearance at mobile and desktop widths`,async({page})=>{
 const html=execFileSync('python3',['-c',`import sys;sys.path.insert(0,'common/web');from setup import render_setup;sys.stdout.buffer.write(render_setup('${model}'))`],{cwd:'..',encoding:'utf8'});
 const requested=[],writes=[],logins=[];let password='';const token='a'.repeat(32);page.on('request',r=>requested.push(r.url()));
 await page.route('http://192.168.0.1/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/'){await route.fulfill({contentType:'text/html',body:html});return;}
  const reply=async(data,status=200)=>route.fulfill({status,contentType:'application/msgpack',body:Buffer.from(encodeWire({code:status===200?'ok':'unauthorized',data}))});
  if(path==='/api/v1/info'){await reply({device_id:'aabbccddeeff',model,api_version:1,firmware_version:'rc4',variant:'test',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack',password_set:!!password});return;}
  expect(request.headers()['content-type']).toBe('application/msgpack');
  const r=decodeWire(request.postDataBuffer(),'msgpack');
  if(path==='/api/v1/auth/login'){logins.push(r.password);await reply(r.password===password?{token}:{},r.password===password?200:401);return;}
  expect(request.headers().authorization).toBe('Bearer '+token);
  if(path==='/api/v1/auth/logout'){await reply({});return;}
  expect(path).toBe('/api/v1/command');
  if(r.action==='config.set'){writes.push(r.params.section);if(r.params.section==='auth')password=r.params.values.password;}
  await reply(r.action==='capabilities.get'?{device_id:'aabbccddeeff',model,firmware_version:'rc4',variant:'test'}:r.action==='status.get'?{mqtt_host:'broker',mqtt_port:1883,ssid:'home',ap_active:true,mqtt_connected:false}:{});
 });
 await page.goto('http://192.168.0.1/');await expect(page.locator('#status')).toContainText('设备热点已开启');
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});for(const theme of ['dark','light','system']){await page.getByLabel('外观').selectOption(theme);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(theme!=='system')expect(await page.locator('body').evaluate(()=>document.documentElement.dataset.theme)).toBe(theme);await page.screenshot({path:test.info().outputPath(`${model}-${width}-${theme}.png`),fullPage:true});}}
 await page.locator('#wifiPassword').fill('password123');await page.locator('#adminPassword').fill('adminfjr');await page.getByRole('button',{name:'保存并连接'}).click();await expect.poll(()=>writes).toEqual(['mqtt','auth','wifi']);await expect(page.locator('#message')).toContainText('实际连接状态');expect(logins).toEqual(['','adminfjr']);expect(requested.every(u=>u.startsWith('http://192.168.0.1/'))).toBe(true);
});
