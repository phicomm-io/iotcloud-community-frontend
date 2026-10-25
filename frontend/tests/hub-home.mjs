// Run after VITE_HUB=1 npm run build. HTTP fixtures exercise the real Vue UI;
// they do not establish Apple Home pairing or acceptance on a physical hub.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';

const root=resolve(process.env.HUB_TEST_DIST||'dist'),evidence=resolve('../../review/hub-home'),token='fixture-local-owner-token';
const code='246-81-357',uri='X-HM://0023ISYWYABCD';
const unpaired=()=>({enabled:true,protocol:'hap',ready:true,paired:false,devices:3,port:51826,code:'ok',setup_code:code,setup_uri:uri});
let home,readsFail=false,writeFails=false,offline=false,writes=[],homeReads=[];
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://fixture').pathname;
  if(path.startsWith('/api/')){
   if(offline){res.destroy();return;}
   let text='';for await(const chunk of req)text+=chunk;
   const body=text?JSON.parse(text):{},auth=req.headers.authorization;
   let result={},status=200;
   if(path==='/api/auth/me')result={username:'local',mqtt_username:'local',mqtt_password_separate:true};
   else if(path==='/api/register/status')result={setup_required:false,mqtt_uri:'mqtt://127.0.0.1:1',mqtt_ws_uri:'ws://127.0.0.1:1/mqtt'};
   else if(path==='/api/devices')result=[];
   else if(path==='/api/hub/bridge')result={enabled:false,mappings:[],mqtt:{host:'',port:1883,user:'',password_set:false}};
   else if(path==='/api/hub/homekit'&&req.method==='GET'){
    homeReads.push({auth,url:req.url});
    if(readsFail){status=503;result={code:'storage_error'};}else result=home;
   }else if(path==='/api/hub/homekit'||path==='/api/hub/homekit/pairing'){
    writes.push({path,method:req.method,body,auth});status=writeFails?503:202;result=writeFails?{code:'storage_error'}:{code:'accepted',restart_required:true};
   }
   res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));return;
  }
  assert(path.startsWith('/iotcloud/'));
  const file=resolve(root,path.slice('/iotcloud/'.length)||'index.html');assert(file.startsWith(root+'/'));
  res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/iotcloud/`,browser=await chromium.launch();
const words={
 'zh-CN':{settings:'设置',services:'中枢服务',enabled:'启用 HomeKit',refresh:'刷新状态',ready:'已就绪，等待配对',paired:'已配对',disabled:'已停用',unavailable:'暂不可用',qr:'HomeKit 配对二维码',reset:'重置配对',dialog:'重置 HomeKit 配对？',cancel:'取消',confirm:'重置配对并重启',apply:'应用并重启',restart:'操作已接受',signIn:'重新登录',storage:'HomeKit 无法读取或保存配置',identity:'请重置配对后'},
 en:{settings:'Settings',services:'Hub services',enabled:'Enable HomeKit',refresh:'Refresh status',ready:'Ready to pair',paired:'Paired',disabled:'Disabled',unavailable:'Unavailable',qr:'HomeKit pairing QR code',reset:'Reset pairing',dialog:'Reset HomeKit pairing?',cancel:'Cancel',confirm:'Reset pairing and restart',apply:'Apply and restart',restart:'Accepted.',signIn:'Sign in again',storage:'HomeKit could not read or save its settings',identity:'Reset pairing to add this hub'}
};
async function fixture(language,width){
 home=unpaired();readsFail=false;writeFails=false;offline=false;writes=[];homeReads=[];
 const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(({language,token})=>{localStorage.setItem('phicomm.language',language);localStorage.setItem('iotcloud.session.'+location.origin,token);},{language,token});
 await page.clock.install();
 await page.goto(base);
 const w=words[language];await page.getByRole('button',{name:w.settings,exact:true}).click();
 await page.getByRole('button',{name:new RegExp(w.services)}).click();
 const section=page.getByRole('region',{name:'HomeKit',exact:true});
 return {context,page,errors,w,section};
}
async function layout(f,label){
 await f.page.screenshot({path:resolve(evidence,label+'.png'),fullPage:true});
 assert(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow: '+label);
 assert(!/hub\.(home|services)/.test(await f.section.innerText()),'missing translation: '+label);
 assert.deepEqual(f.errors,[]);
 assert(!JSON.stringify(await f.page.evaluate(()=>({...localStorage,...sessionStorage}))).includes(code),'pairing code persisted');
 assert(!JSON.stringify(await f.page.evaluate(()=>({...localStorage,...sessionStorage}))).includes(uri),'setup URI persisted');
 assert(homeReads.every(r=>r.auth==='Bearer '+token&&r.url==='/api/hub/homekit'),'status must use the local owner session without credentials in the URL');
}
try{
 await mkdir(evidence,{recursive:true});
 for(const [language,width,scenario] of [['zh-CN',390,'pair-reset'],['en',390,'enable'],['zh-CN',1440,'disable'],['en',1440,'errors']]){
  const f=await fixture(language,width),{context,page,section,w}=f;
  try{
   await expect(section.getByText(w.ready,{exact:true})).toBeVisible();
   await expect(section.getByLabel(language==='zh-CN'?'配对码':'Pairing code',{exact:true})).toHaveText(code);
   const image=section.getByRole('img',{name:w.qr,exact:true});await expect(image).toBeVisible();
   assert((await image.getAttribute('src')).startsWith('data:image/png;base64,'));
   await expect(image).toHaveJSProperty('naturalWidth',216);
   assert(!(await section.innerText()).includes(uri),'setup URI must stay inside the QR image');
   await layout(f,`${language}-${width}`);
   if(scenario==='pair-reset'){
    await section.getByRole('checkbox',{name:w.enabled}).uncheck();await page.clock.fastForward(6000);
    await expect(section.getByRole('checkbox',{name:w.enabled})).not.toBeChecked();assert.equal(writes.length,0,'polling must preserve an unsaved toggle');
    await section.getByRole('checkbox',{name:w.enabled}).check();
    // Even a server accidentally returning old secrets when paired must hide them.
    home={...unpaired(),paired:true};await page.clock.fastForward(6000);
    await expect(section.getByText(w.paired,{exact:true})).toBeVisible();await expect(image).toHaveCount(0);assert(!(await section.innerText()).includes(code));
    await section.getByRole('button',{name:w.reset,exact:true}).click();
    const confirm=page.getByRole('dialog',{name:w.dialog,exact:true});await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button',{name:w.cancel,exact:true})).toBeFocused();
    await layout(f,`${language}-${width}-confirm`);
    await confirm.getByRole('button',{name:w.cancel,exact:true}).click();assert.equal(writes.length,0,'cancel must not reset pairing');
    await section.getByRole('button',{name:w.reset,exact:true}).click();await page.keyboard.press('Escape');await expect(confirm).not.toBeVisible();assert.equal(writes.length,0,'Escape must not reset pairing');
    await section.getByRole('button',{name:w.reset,exact:true}).click();await confirm.getByRole('button',{name:w.confirm,exact:true}).click();
    await expect(section.getByText(w.restart,{exact:false})).toBeVisible();await expect(confirm).not.toBeVisible();
    assert.deepEqual(writes,[{path:'/api/hub/homekit/pairing',method:'DELETE',body:{confirm:true},auth:'Bearer '+token}]);
    offline=true;await page.clock.fastForward(6000);await expect(section.getByText(w.restart,{exact:false})).toBeVisible();await expect(section.getByRole('alert')).toHaveCount(0);assert.equal(writes.length,1,'a reboot must not replay the write');
    await expect(section.getByRole('link',{name:w.signIn,exact:true})).toHaveAttribute('href','#/login');await layout(f,`${language}-${width}-restart`);
   }else if(scenario==='enable'||scenario==='disable'){
    if(scenario==='enable'){
     // A disabled service must hide setup information even if a response contains it.
     home={...unpaired(),enabled:false,ready:false,code:'disabled'};await section.getByRole('button',{name:w.refresh,exact:true}).click();
     await expect(section.getByText(w.disabled,{exact:true})).toBeVisible();await expect(image).toHaveCount(0);assert(!(await section.innerText()).includes(code));
     await section.getByRole('checkbox',{name:w.enabled}).check();
    }else await section.getByRole('checkbox',{name:w.enabled}).uncheck();
    await section.getByRole('button',{name:w.apply,exact:true}).click();await expect(section.getByText(w.restart,{exact:false})).toBeVisible();
    assert.deepEqual(writes,[{path:'/api/hub/homekit',method:'PUT',body:{enabled:scenario==='enable'},auth:'Bearer '+token}]);await expect(image).toHaveCount(0);assert(!(await section.innerText()).includes(code));
    await layout(f,`${language}-${width}-restart`);
   }else{
    readsFail=true;await section.getByRole('button',{name:w.refresh,exact:true}).click();await expect(section.getByRole('alert')).toBeVisible();await expect(image).toHaveCount(0);
    readsFail=false;home={...unpaired(),ready:false,code:'storage_error'};await section.getByRole('button',{name:w.refresh,exact:true}).click();await expect(section.getByText(w.unavailable,{exact:true})).toBeVisible();await expect(section.getByText(w.storage,{exact:false})).toBeVisible();await expect(section.getByRole('alert')).toHaveCount(0);
    home={...home,code:'identity_changed'};await section.getByRole('button',{name:w.refresh,exact:true}).click();await expect(section.getByText(w.identity,{exact:false})).toBeVisible();await expect(image).toHaveCount(0);await layout(f,`${language}-${width}-error`);
    home=unpaired();await section.getByRole('button',{name:w.refresh,exact:true}).click();await expect(image).toBeVisible();assert.equal(writes.length,0,'refresh and errors must not mutate settings');
    writeFails=true;await section.getByRole('button',{name:w.reset,exact:true}).click();await page.getByRole('dialog',{name:w.dialog,exact:true}).getByRole('button',{name:w.confirm,exact:true}).click();
    await expect(section.getByRole('alert')).toBeVisible();await expect(section.getByText(w.restart,{exact:false})).toHaveCount(0);await expect(image).toHaveCount(0);assert.equal(writes.length,1,'a rejected reset must not be replayed');
    writeFails=false;await section.getByRole('button',{name:w.refresh,exact:true}).click();await expect(image).toBeVisible();
   }
   assert.deepEqual(f.errors,[]);console.log(`PASS HomeKit ${language} ${width}: ${scenario}`);
  }finally{await context.close();}
 }
}finally{await browser.close();await new Promise(done=>server.close(done));}
