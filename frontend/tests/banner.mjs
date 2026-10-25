// Isolated fixtures exercise editor persistence, public rendering and safe links.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium,webkit,expect} from '@playwright/test';
const root=resolve('dist'),evidence=resolve('../build/banner');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;assert(path.startsWith('/iotcloud/'));const file=resolve(root,path.slice(10)||'index.html');assert(file.startsWith(root+'/'));res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/iotcloud/`,api='https://api.banner.example';
const settled=p=>p.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
async function reload(p){const ready=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/banner');await p.reload();await ready;await settled(p);}
async function open(p,url){const ready=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/banner');await p.goto(url);await ready;await settled(p);}
await mkdir(evidence,{recursive:true});
const engines=process.env.BROWSER?[[process.env.BROWSER,{chromium,webkit}[process.env.BROWSER]]]:[['chromium',chromium],['webkit',webkit]];
try{for(const [engine,type] of engines){const browser=await type.launch();try{for(const width of [375,1280]){
 const context=await browser.newContext({locale:'zh-CN',viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 let saved={enabled:false,audience:'before_login',text:'',url:'',label:''},fail=false,failLoad=true,adminName='banner-admin';page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname;
  if(p==='/iotcloud/config.json')return route.fulfill({json:{apiOrigin:api}});
  if(p==='/api/auth/me')return route.fulfill({json:{username:adminName,is_admin:true}});
  if(p==='/api/admin/config')return route.fulfill({json:{register_level:1,contact_info:''}});
  if(p==='/api/admin/analytics'||p==='/api/admin/verification-emails')return route.fulfill({status:503,json:{error:'fixture disabled'}});
  if(p==='/api/admin/banner'){
   if(req.method()==='PUT'){
    if(fail)return route.fulfill({status:503,json:{error:'公告保存失败，请重试'}});
    saved=req.postDataJSON();return route.fulfill({json:saved});
   }
   return failLoad?route.fulfill({status:503,json:{error:'公告加载失败'}}):route.fulfill({json:saved});
  }
  if(p==='/api/banner')return route.fulfill({json:saved.enabled?saved:{enabled:false,text:'',url:'',label:''}});
  if(p==='/api/admin/users'||p==='/api/admin/devices'||p==='/api/devices')return route.fulfill({json:[]});
  if(p.startsWith('/api/'))return route.fulfill({json:{}});
  return route.continue();
 });
 await page.goto(base+'#/admin');const editor=page.getByRole('region',{name:'平台公告'});
 await expect(editor.getByRole('button',{name:'重新加载公告'})).toBeVisible();await expect(editor.getByRole('button',{name:'保存公告'})).toHaveCount(0);
 failLoad=false;await editor.getByRole('button',{name:'重新加载公告'}).click();await expect(editor.getByLabel('公告正文')).toBeVisible();
 await editor.getByLabel('显示平台公告').check();await editor.getByLabel('展示时机').selectOption('after_login');await editor.getByLabel('公告正文').fill('斐讯社区交流 QQ 群：1021750178');await editor.getByLabel('链接地址（可选）').fill('https://qm.qq.com/q/9L150V85kk?from=tim');await editor.getByLabel('按钮文字').fill('加入 QQ 群');
 await editor.getByRole('button',{name:'保存公告',exact:true}).click();await expect(editor.getByRole('status')).toHaveText('平台公告已保存');assert.equal(saved.enabled,true);
 const banner=page.locator('#app > .platform-banner');await expect(banner).toContainText('1021750178');const link=banner.getByRole('link',{name:'加入 QQ 群'});await expect(link).toHaveAttribute('href','https://qm.qq.com/q/9L150V85kk?from=tim');await expect(link).toHaveAttribute('rel','noopener noreferrer');
 await reload(page);await expect(editor.getByLabel('公告正文')).toHaveValue(saved.text);await expect(banner).toBeVisible();
 await page.screenshot({path:resolve(evidence,engine+'-'+width+'-editor.png'),fullPage:true});
 await editor.getByLabel('显示平台公告').uncheck();await editor.getByRole('button',{name:'保存公告',exact:true}).click();await expect(banner).toHaveCount(0);
 await editor.getByLabel('显示平台公告').check();fail=true;await editor.getByRole('button',{name:'保存公告',exact:true}).click();await expect(editor.getByRole('alert')).toHaveText('公告保存失败，请重试');assert.equal(saved.enabled,false);fail=false;
 await editor.getByLabel('公告正文').fill('<img src=x onerror="window.bannerXSS=1">');await editor.getByRole('button',{name:'保存公告',exact:true}).click();await expect(banner).toContainText('<img');assert.equal(await banner.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.bannerXSS),undefined);
 saved={enabled:true,audience:'before_login',text:'交流群 QQ：1021750178',url:'javascript:alert(1)',label:'unsafe'};await page.goto(base+'#/login');await reload(page);await expect(banner).toBeVisible();await expect(banner.locator('a')).toHaveCount(0);
 saved.url='https://qm.qq.com/q/9L150V85kk?from=tim';saved.label='加入 QQ 群';await reload(page);await expect(banner.getByRole('link',{name:'加入 QQ 群'})).toBeVisible();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert((await banner.getByRole('link').boundingBox()).height>=44);
 await page.screenshot({path:resolve(evidence,engine+'-'+width+'-login.png'),fullPage:true});
 // Public-login announcements disappear after account restoration, and are absent in guest control.
 await page.goto(base+'#/admin');await expect(editor.getByLabel('展示时机')).toHaveValue('before_login');await expect(banner).toHaveCount(0);
 saved.audience='after_login';await reload(page);await expect(banner).toBeVisible();
 await page.goto(base+'#/login');await reload(page);await expect(banner).toHaveCount(0);
 saved.audience='before_login';await reload(page);await expect(banner).toBeVisible();
 // Snooze survives reload, expires after 24 hours and is isolated by node.
 await banner.getByRole('button',{name:'稍后提醒',exact:true}).click();await expect(banner).toHaveCount(0);await reload(page);await expect(banner).toHaveCount(0);
 const reminder=await page.evaluate(()=>{const k=Object.keys(localStorage).find(k=>k.startsWith('iotcloud.banner.'));return {key:k,value:JSON.parse(localStorage.getItem(k))};});assert.equal(reminder.value.choice,'snooze');assert(Math.abs(reminder.value.until-Date.now()-86400000)<10000);
 await page.evaluate(k=>{const v=JSON.parse(localStorage.getItem(k));v.until=Date.now()-1;localStorage.setItem(k,JSON.stringify(v));window.dispatchEvent(new StorageEvent('storage',{key:k}));},reminder.key);await expect(banner).toBeVisible();
 await banner.getByRole('button',{name:'忽略',exact:true}).click();await reload(page);await expect(banner).toHaveCount(0);
 const otherTab=await context.newPage();await open(otherTab,base+'#/login');await expect(otherTab.locator('#app > .platform-banner')).toBeVisible();await otherTab.close();
 // A permanent dismissal survives a fresh browser context. Updated content remains eligible.
 await page.evaluate(()=>sessionStorage.clear());await reload(page);await expect(banner).toBeVisible();await banner.getByRole('button',{name:'不再显示',exact:true}).click();await reload(page);await expect(banner).toHaveCount(0);
 const state=await context.storageState();const restarted=await browser.newContext({locale:'zh-CN',storageState:state,viewport:{width,height:900},serviceWorkers:'block'});await restarted.route('**/*',async route=>{const p=new URL(route.request().url()).pathname;if(p==='/iotcloud/config.json')return route.fulfill({json:{apiOrigin:api}});if(p==='/api/banner')return route.fulfill({json:saved});if(p.startsWith('/api/'))return route.fulfill({json:{}});return route.continue();});const fresh=await restarted.newPage();await open(fresh,base+'#/login');await expect(fresh.locator('#app > .platform-banner')).toHaveCount(0);
 saved.text+='（公告已更新）';await reload(fresh);await expect(fresh.locator('#app > .platform-banner')).toBeVisible();await restarted.close();
 saved.text=saved.text.replace('（公告已更新）','');await reload(page);await expect(banner).toHaveCount(0);
 await page.evaluate(()=>{const x=JSON.parse(localStorage.getItem('iotcloud.server')||'{}');x.apiOrigin='https://second.banner.example';localStorage.setItem('iotcloud.server',JSON.stringify(x));});await reload(page);await expect(banner).toBeVisible();
 saved.audience='after_login';await page.goto(base+'#/admin');await expect(banner).toBeVisible();await banner.getByRole('button',{name:'不再显示',exact:true}).click();await reload(page);await expect(banner).toHaveCount(0);adminName='second-admin';await reload(page);await expect(banner).toBeVisible();
 assert.deepEqual(errors,[]);await context.close();
}console.log('PASS '+engine+': banner editor, login audience, persistent snooze/dismiss, tab ignore, expiry, content/node isolation, safe rendering and mobile/desktop layout');}finally{await browser.close();}}}finally{await new Promise(done=>server.close(done));}
