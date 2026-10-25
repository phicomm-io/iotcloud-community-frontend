// Build first: npm run build. Runs only on an isolated local static server.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const root=resolve('dist');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
let update=false;
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(!path.startsWith('/iotcloud/'))throw Error();
  const file=resolve(root,decodeURIComponent(path.slice('/iotcloud/'.length))||'index.html');
  if(!file.startsWith(root+'/'))throw Error();
  res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');const data=await readFile(file);res.end(update&&file.endsWith('/sw.js')?data.toString().replace(/iotcloud-([a-f0-9]+)/g,'iotcloud-update-$1'):data);
 }catch{res.statusCode=404;res.end('Not found');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch();
try{
 const context=await browser.newContext({locale:'zh-CN'});const page=await context.newPage();
 const failures=[];page.on('pageerror',e=>failures.push(e.message));
 const url=`http://127.0.0.1:${server.address().port}/iotcloud/`;
 await page.goto(url+'#/login');await page.getByRole('heading',{name:'登录',exact:true}).waitFor();
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const manifest=await page.evaluate(async()=>await (await fetch('manifest.webmanifest')).json());assert.equal(manifest.name,'IotCloud');
 await page.locator('summary').click();await page.getByPlaceholder('https://api.example.com（留空使用本站）').fill('https://api.example.test');
 await Promise.all([page.waitForEvent('load'),page.getByRole('button',{name:'保存并重新加载'}).click()]);await page.waitForFunction(()=>JSON.parse(localStorage.getItem('iotcloud.server')).apiOrigin==='https://api.example.test');
 await page.getByRole('heading',{name:'登录',exact:true}).waitFor();
 await page.evaluate(()=>localStorage.setItem('tmcp_broker',JSON.stringify({host:'wss://broker.example.test/mqtt',username:''})));
 await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'登录',exact:true}).waitFor();
 await page.getByRole('link',{name:/自建 Broker 模式/}).click();await page.getByRole('heading',{name:'IotCloud',exact:true}).waitFor();
 const reminder=page.getByRole('status').filter({hasText:'配置 IoT 设备时'});
 await reminder.waitFor();assert.equal(await reminder.locator('strong').textContent(),'broker.example.test');
 await reminder.getByRole('button',{name:'我知道了'}).click();assert.equal(await reminder.count(),0);
 await page.reload();await page.getByRole('heading',{name:'IotCloud',exact:true}).waitFor();assert.equal(await page.getByText('配置 IoT 设备时',{exact:false}).count(),0);
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('heading',{name:'配置本地 IoT 设备',exact:true}).waitFor();
 const cached=await page.evaluate(async()=>{const keys=await caches.keys();return (await Promise.all(keys.map(async key=>(await (await caches.open(key)).keys()).map(r=>r.url)))).flat();});
 assert(cached.length>10);assert(!cached.some(url=>url.includes('/api/')||url.endsWith('/config.json')));assert.deepEqual(failures,[]);
 await context.setOffline(false);
 update=true;page.on('dialog',dialog=>dialog.accept());
 await page.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;await registration.update();});
 await page.waitForFunction(async()=>{const keys=await caches.keys();return keys.length===1&&keys[0].startsWith('iotcloud-update-');});
 console.log('PASS: subpath, manifest, runtime configuration, offline login/guest, static-only cache, confirmed update and old-cache cleanup');
}finally{await browser.close();await new Promise(done=>server.close(done));}
