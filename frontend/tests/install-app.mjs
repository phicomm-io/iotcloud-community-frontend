// Browser signals are simulated; all requests use isolated fixtures, never real devices.
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium, webkit, expect} from '@playwright/test';
const root=resolve('dist'), evidence=resolve('../build/install-app');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://local').pathname;assert(path.startsWith('/iotcloud/'));const file=resolve(root,path.slice(10)||'index.html');assert(file.startsWith(root+'/'));res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}
 catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/iotcloud/`;
await mkdir(evidence,{recursive:true});
async function fixture(browser,{ua='Mozilla/5.0 Android Chrome/140.0',standalone=false,appleStandalone=false,gate=false,width=375}={}){
 const context=await browser.newContext({viewport:{width,height:740},userAgent:ua,serviceWorkers:'block'});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let release;const ready=new Promise(resolve=>{release=resolve;});if(!gate)release();
 await context.addInitScript(({standalone,appleStandalone})=>{
  localStorage.setItem('mqtt_auto_connect','false');
  Object.defineProperty(navigator,'standalone',{value:appleStandalone,configurable:true});
  const original=window.matchMedia.bind(window),signal=new EventTarget();signal.matches=standalone;
  window.matchMedia=query=>query==='(display-mode: standalone)'?signal:original(query);
  window.setStandalone=value=>{signal.matches=value;signal.dispatchEvent(new Event('change'));};
  window.offerInstall=outcome=>{const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{window.nativePromptCalls=(window.nativePromptCalls||0)+1;};event.userChoice=Promise.resolve({outcome});window.dispatchEvent(event);};
 },{standalone,appleStandalone});
 await context.route('**/*',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p==='/iotcloud/config.json')return route.fulfill({json:{}});
  if(p==='/api/auth/me')return route.fulfill({json:{username:'install-fixture'}});
  if(p==='/api/devices'){await ready;return route.fulfill({json:[]});}
  if(p==='/api/register/status')return route.fulfill({json:{enabled:true,mqtt_uri:'localhost:1883'}});
  if(p.startsWith('/api/'))return route.fulfill({json:{}});
  return route.continue();
 });
 await page.goto(base+'#/');await page.getByRole('heading',{name:'IotCloud',exact:true}).waitFor();
 return {context,page,release,errors};
}
const promo=page=>page.locator('.install-promotion');
const dialog=page=>page.getByRole('dialog',{name:'添加到桌面',exact:true});
async function settings(page){await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'设置',exact:true}).click();await page.locator('.install-settings-entry').getByRole('button',{name:'添加到桌面',exact:true}).click();await expect(dialog(page)).toBeVisible();}
async function layout(page){
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page horizontal overflow');
 const d=dialog(page),b=await d.boundingBox();assert(b.x>=0&&b.x+b.width<=page.viewportSize().width+1);
 assert(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'dialog horizontal overflow');
 for(const button of await d.locator('button:visible').all())assert((await button.boundingBox()).height>=44,'small touch target');
}
const engines=process.env.BROWSER?[[process.env.BROWSER,{chromium,webkit}[process.env.BROWSER]]]:[['chromium',chromium],['webkit',webkit]];
try{for(const [engine,type] of engines){
 const browser=await type.launch();
 try{
  {
   const f=await fixture(browser,{gate:true}),p=f.page;
   await expect(promo(p)).toHaveCount(0);f.release();await expect(promo(p)).toBeVisible();
   await promo(p).getByRole('button',{name:'稍后提示',exact:true}).click();await expect(promo(p)).toHaveCount(0);
   const at=await p.evaluate(()=>JSON.parse(localStorage.getItem('iotcloud.install-prompt')).remindAt);assert(Math.abs(at-Date.now()-7*86400000)<10000);
   await p.reload();await p.getByRole('heading',{name:'IotCloud',exact:true}).waitFor();await expect(promo(p)).toHaveCount(0);
   await settings(p);await expect(p.getByRole('heading',{name:'通过浏览器菜单添加'})).toBeVisible();await expect(p.getByRole('button',{name:'安装应用',exact:true})).toHaveCount(0);
   await dialog(p).getByRole('button',{name:'不再提示',exact:true}).click();
   await p.reload();await p.getByRole('heading',{name:'IotCloud',exact:true}).waitFor();await expect(promo(p)).toHaveCount(0);
   await settings(p);await expect(p.getByText('已关闭主动提示，仍可随时从设置查看。')).toBeVisible();assert.deepEqual(f.errors,[]);await f.context.close();
  }
  {
   const f=await fixture(browser,{ua:'Mozilla/5.0 Windows Chrome/140.0',width:1280}),p=f.page;
   await expect(promo(p)).toHaveCount(0);await p.evaluate(()=>window.offerInstall('dismissed'));
   await promo(p).getByRole('button',{name:'添加到桌面',exact:true}).click();await expect(p.getByText('已取消安装，7 天内不再主动提示。也可以随时从设置打开。')).toBeVisible();assert.equal(await p.evaluate(()=>window.nativePromptCalls),1);
   await p.evaluate(()=>window.offerInstall('accepted'));await p.getByRole('button',{name:'安装应用',exact:true}).click();await expect(dialog(p)).toHaveCount(0);assert.equal(await p.evaluate(()=>window.nativePromptCalls),2);await expect(promo(p)).toHaveCount(0);assert.deepEqual(f.errors,[]);await f.context.close();
  }
  {
   const f=await fixture(browser,{ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',width:320}),p=f.page;
   await promo(p).getByRole('button',{name:'添加到桌面',exact:true}).click();await expect(p.getByRole('heading',{name:'在 Safari 中添加'})).toBeVisible();await expect(p.getByRole('img',{name:'分享图标'})).toBeVisible();await layout(p);
   await p.screenshot({path:resolve(evidence,engine+'-iphone.png'),fullPage:true});await p.keyboard.press('Escape');await expect(dialog(p)).toHaveCount(0);await expect.poll(()=>p.evaluate(()=>document.documentElement.style.overflow)).toBe('');await expect(p.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'首页',exact:true})).toBeFocused();assert.deepEqual(f.errors,[]);await f.context.close();
  }
  {
   const f=await fixture(browser,{ua:'Mozilla/5.0 iPhone MicroMessenger/8.0'}),p=f.page;
   await promo(p).getByRole('button',{name:'添加到桌面',exact:true}).click();await expect(p.getByRole('heading',{name:'先在系统浏览器中打开'})).toBeVisible();await expect(p.getByRole('button',{name:'安装应用',exact:true})).toHaveCount(0);await layout(p);assert.deepEqual(f.errors,[]);await f.context.close();
  }
  for(const mode of [{standalone:true},{appleStandalone:true}]){
   const f=await fixture(browser,mode),p=f.page;await expect(promo(p)).toHaveCount(0);await settings(p);await expect(p.getByText('当前已在独立窗口中打开，无需重复添加。')).toBeVisible();await p.getByRole('button',{name:'完成',exact:true}).click();assert.deepEqual(f.errors,[]);await f.context.close();
  }
  for(const event of ['installed','standalone']){
   const f=await fixture(browser),p=f.page;await expect(promo(p)).toBeVisible();await p.evaluate(event=>event==='installed'?window.dispatchEvent(new Event('appinstalled')):window.setStandalone(true),event);await expect(promo(p)).toHaveCount(0);assert.deepEqual(f.errors,[]);await f.context.close();
  }
  console.log(`PASS ${engine}: list-ready gate, 7-day reminder, never, settings, native prompt, iPhone/in-app guidance, layout, focus and standalone/installed events`);
 }finally{await browser.close();}
}}finally{await new Promise(done=>server.close(done));}
