import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
for(const model of ['a1','m1','tc1'])test(`${model} setup works offline and shares appearance at mobile and desktop widths`,async({page})=>{
 const html=execFileSync('python3',['-c',`import sys;sys.path.insert(0,'common/web');from setup import render_setup;sys.stdout.buffer.write(render_setup('${model}'))`],{cwd:'..',encoding:'utf8'});
 const requested=[],writes=[];page.on('request',r=>requested.push(r.url()));
 await page.route('http://192.168.0.1/**',async route=>{
  if(new URL(route.request().url()).pathname==='/'){await route.fulfill({contentType:'text/html',body:html});return;}
  const r=route.request().postDataJSON();if(r.action==='config.set')writes.push(r.params.section);
  await route.fulfill({contentType:'application/json',body:JSON.stringify({code:'ok',data:r.action==='status.get'?{mqtt_host:'broker',mqtt_port:1883,ssid:'home',ap_active:true,mqtt_connected:false}:{}})});
 });
 await page.goto('http://192.168.0.1/');await expect(page.locator('#status')).toContainText('设备热点已开启');
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});for(const theme of ['dark','light','system']){await page.getByLabel('外观').selectOption(theme);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(theme!=='system')expect(await page.locator('body').evaluate(()=>document.documentElement.dataset.theme)).toBe(theme);await page.screenshot({path:test.info().outputPath(`${model}-${width}-${theme}.png`),fullPage:true});}}
 await page.locator('#wifiPassword').fill('password123');await page.locator('#adminPassword').fill('admin1234');await page.getByRole('button',{name:'保存并连接'}).click();await expect.poll(()=>writes).toEqual(['mqtt','auth','wifi']);await expect(page.locator('#message')).toContainText('实际连接状态');expect(requested.every(u=>u.startsWith('http://192.168.0.1/'))).toBe(true);
});
