// Isolated platform UI scenarios. No real account, Bemfa key or device connection.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
const root=resolve('dist'),evidence=resolve('../build/bemfa-cloud');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;assert(path.startsWith('/iotcloud/'));const file=resolve(root,path.slice(10)||'index.html');assert(file.startsWith(root+'/'));res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`,base=origin+'/iotcloud/';
const devices=[{namespace:'account',username:'alice',mqtt_username:'alice',mac:'aabbccddeeff',model:'tc1',version:'v2',status:'active'},{namespace:'account',username:'alice',mqtt_username:'alice',mac:'aabbccddee01',model:'a1',version:'v2',status:'active'},{mac:'aabbccddee02',model:'m1',version:'v2',status:'active'},{mac:'aabbccddee03',model:'tc1',version:'v1',status:'active'}];
await mkdir(evidence,{recursive:true});const browser=await chromium.launch();
try{for(const width of [375,1280]){
 const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage(),errors=[],writes=[];
 let config={enabled:false,key_set:false,mappings:[],status:'disabled'},failRead=true,failSave=false,failDelete=false;
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path==='/iotcloud/config.json')return route.fulfill({json:{apiOrigin:''}});
  if(path==='/api/auth/me')return route.fulfill({json:{username:'alice',mqtt_username:'alice',aliases:[],is_admin:false}});
  if(path==='/api/register/status')return route.fulfill({json:{register_level:1,mqtt_uri:'',mqtt_ws_uri:''}});
  if(path==='/api/devices')return route.fulfill({json:devices});
  if(path==='/api/integrations/bemfa'){
   if(request.method()==='GET'){if(failRead)return route.fulfill({status:503,json:{error:'节点暂不可用'}});return route.fulfill({json:config});}
   if(request.method()==='DELETE'){if(failDelete)return route.fulfill({status:503,json:{error:'清除失败，请重试'}});config={enabled:false,key_set:false,mappings:[],status:'disabled'};return route.fulfill({json:{ok:true}});}
   const body=request.postDataJSON();writes.push(body);if(failSave)return route.fulfill({status:400,json:{error:'该设备已移除，请重新选择'}});
   config={enabled:body.enabled,key_set:true,mappings:body.mappings,status:body.enabled?'connecting':'disabled'};return route.fulfill({json:config});
  }
  if(path.startsWith('/api/'))return route.fulfill({json:{}});
  if(url.origin!==origin)return route.abort();return route.continue();
 });
 await page.addInitScript(({origin})=>localStorage.setItem('phicomm.connection.'+origin+':alice','false'),{origin});
 await page.goto(base);await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:/巴法云/}).click();
 await expect(page.getByRole('alert')).toContainText('节点暂不可用');failRead=false;await page.getByRole('button',{name:'重新读取配置'}).click();
 await expect(page.getByRole('heading',{name:'巴法云',exact:true})).toBeVisible();
 await expect(page.getByLabel('映射设备').locator('option')).toHaveCount(3); // Placeholder + TC1 + A1 only.
 await page.getByLabel('巴法云私钥',{exact:true}).fill('fixture-key-never-real-123456789');
 await page.getByLabel('映射设备').selectOption({index:1});await page.getByLabel('设备通道').selectOption('5');await page.getByLabel('巴法云主题',{exact:true}).fill('lastplug003');await page.getByRole('button',{name:'添加映射',exact:true}).click();await expect(page.getByRole('alert')).toContainText('001');
 await page.getByLabel('巴法云主题',{exact:true}).fill('lastplug001');await page.getByRole('button',{name:'添加映射',exact:true}).click();
 await page.getByLabel('映射设备').selectOption({index:2});await page.getByLabel('设备通道').selectOption('0');await page.getByLabel('巴法云主题',{exact:true}).fill('fan003');await page.getByRole('button',{name:'添加映射',exact:true}).click();
 await page.getByLabel('设备通道').selectOption('1');await page.getByLabel('巴法云主题',{exact:true}).fill('ring002');await page.getByRole('button',{name:'添加映射',exact:true}).click();
 await page.getByLabel('启用巴法云转发').check();await page.getByRole('button',{name:'保存巴法云配置',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'巴法云配置已保存'})).toBeVisible();
 assert.equal(writes[0].api_key,'fixture-key-never-real-123456789');assert.deepEqual(writes[0].mappings.map(m=>m.channel),[5,0,1]);assert.equal(writes[0].enabled,true);await expect(page.getByLabel('巴法云私钥',{exact:true})).toHaveValue('');
 assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('fixture-key-never-real')),false,'secret persisted in browser storage');
 await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:/巴法云/}).click();await expect(page.getByLabel('巴法云私钥',{exact:true})).toHaveAttribute('placeholder','已设置；留空保留原密钥');
 await page.getByRole('button',{name:'移除映射 ring002'}).click();failSave=true;await page.getByRole('button',{name:'保存巴法云配置',exact:true}).click();await expect(page.getByRole('alert')).toContainText('该设备已移除');assert.equal(writes.at(-1).api_key,'');failSave=false;
 await page.getByLabel('启用巴法云转发').uncheck();await page.getByRole('button',{name:'保存巴法云配置',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'巴法云配置已保存'})).toBeVisible();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');await page.screenshot({path:resolve(evidence,`chromium-${width}-configured.png`),fullPage:true});
 page.on('dialog',dialog=>dialog.accept());failDelete=true;await page.getByRole('button',{name:'清除配置',exact:true}).click();await expect(page.getByRole('alert')).toContainText('清除失败');failDelete=false;await page.getByRole('button',{name:'清除配置',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'巴法云配置已清除'})).toBeVisible();await expect(page.getByRole('button',{name:'移除映射 lastplug001'})).toHaveCount(0);assert.deepEqual(errors,[]);await context.close();
 console.log(`PASS Chromium ${width}: load retry, supported models, six sockets, A1 fan/light, suffix validation, write-only key, persistence, save/delete failures, disable and clear`);
}}finally{await browser.close();await new Promise(done=>server.close(done));}
