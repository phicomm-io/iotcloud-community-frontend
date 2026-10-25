// Real iframe -> host -> local HTTP uploads, using isolated fixtures only.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium,webkit,expect} from '@playwright/test';
const root=resolve(process.env.PHICOMM_OTA_DIST||'dist'),evidence=resolve('../build/ota-conversion');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://local').pathname,file=resolve(root,'.'+(path==='/'?'/index.html':path));assert(file.startsWith(root+'/'));res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`,address='http://192.168.1.115',mac='aabbccdd0115',password='fixture-conversion-web';
const bytes=Buffer.from('PHOTA001 — test-only signed-upload transport fixture');
await mkdir(evidence,{recursive:true});
const engines=process.env.BROWSER?[[process.env.BROWSER,{chromium,webkit}[process.env.BROWSER]]]:[['chromium',chromium],['webkit',webkit]];
try{for(const [engine,type] of engines){
 const browser=await type.launch();
 try{for(const language of ['zh-CN','en'])for(const width of [375,1280]){
  const context=await browser.newContext({locale:language,viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[],uploads=[],sentBytes=[];
  // WebKit's intercepted Blob requests can omit postDataBuffer. Observe the
  // bytes at the native XHR boundary as well, without replacing or delaying send.
  await context.exposeBinding('recordUploadBytes',(_,value)=>sentBytes.push(value));
  await context.addInitScript(()=>{
   const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
   XMLHttpRequest.prototype.open=function(method,url,...args){this.uploadObservation=String(url);return open.call(this,method,url,...args);};
   XMLHttpRequest.prototype.send=function(body){if(this.uploadObservation?.includes('/api/v1/ota/')&&body instanceof Blob){const url=this.uploadObservation;body.arrayBuffer().then(buffer=>window.recordUploadBytes({url,bytes:Array.from(new Uint8Array(buffer))}));}return send.call(this,body);};
  });
  page.on('pageerror',e=>errors.push(e.message));
  let webPassword='';
  const state=()=>({device_id:mac,model:'daikin',version:'1.0.0',firmware_variant:'full',name:'Conversion fixture',web_password_set:!!webPassword,ip:'192.168.1.115',wifi_connected:true,mqtt_connected:false,sensors:{}});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===address){
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type, X-IoTCloud-Target-Variant, X-IoTCloud-Confirm','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const auth=request.headers().authorization;
    if(webPassword&&auth!=='Basic '+Buffer.from('admin:'+webPassword).toString('base64'))return route.fulfill({status:401,json:{code:'unauthorized'},headers});
    if(url.pathname.startsWith('/api/v1/ota/')){uploads.push({path:url.pathname,headers:request.headers(),bytes:request.postDataBuffer()});return route.fulfill({status:202,json:{code:'accepted'},headers});}
    let data=state();
    if(url.pathname==='/api/v1/info')data={device_id:mac,model:'daikin',api_version:1,firmware_variant:'full'};
    if(url.pathname==='/api/v1/command'){
     const command=request.postDataJSON();
     if(command.action==='capabilities.get')data={model:'daikin',firmware_variant:'full',ota_variant_conversion:'full-to-hub',actions:['status.get','config.get','config.set']};
     else if(command.action==='config.set'&&command.params.section==='auth'){webPassword=command.params.values.password;data={};}
     else if(!['status.get','config.get'].includes(command.action))data={};
    }
    return route.fulfill({json:{code:'ok',data},headers});
   }
   if(url.pathname==='/config.json')return route.fulfill({json:{}});
   if(url.pathname.startsWith('/api/'))return route.fulfill({json:{}});
   if(url.origin!==origin)return route.abort();
   return route.continue();
  });
  await page.goto(origin+'/#/local');
  const connect=page.locator('.local-connect form');await connect.locator('input').first().fill(address);await connect.locator('button[type=submit],button:not([type])').click();
  const frame=page.frameLocator('iframe');await expect(frame.locator('#homePage')).toBeVisible();
  await frame.locator('.tabs a[data-tab=settings]').click();await frame.locator('.side a[href="#settings/firmware"]').click();
  await frame.locator('#fileForm > .more > summary').click();await frame.locator('#hubConversion').check();
  await expect(frame.locator('#unsignedRescue')).toBeDisabled();await expect(frame.locator('#hubConversionPassword')).toBeVisible();
  await frame.locator('#hubConversionPassword button').click();await expect(frame.locator('#webPassword')).toBeFocused();
  await frame.locator('#webPassword').fill(password);await frame.locator('#authForm button[type=submit]').click();await expect.poll(()=>webPassword).toBe(password);
  await frame.locator('.side a[href="#settings/firmware"]').click();await expect(frame.locator('#hubConversionPassword')).toBeHidden();await expect(frame.locator('#hubConversion')).toBeChecked();
  await frame.locator('#firmware').setInputFiles({name:'daikin-hub.ota.bin.signed',mimeType:'application/octet-stream',buffer:bytes});
  let confirmation='';page.once('dialog',dialog=>{confirmation=dialog.message();return dialog.dismiss();});await frame.locator('#fileForm button[type=submit]').click();assert.equal(uploads.length,0);
  assert.match(confirmation,/Wi-Fi/);assert.match(confirmation,/MQTT/);assert.match(confirmation,/HTTP/);assert.match(confirmation,language==='en'?/password will be kept/:/网页管理密码/);
  page.once('dialog',dialog=>dialog.accept());await frame.locator('#fileForm button[type=submit]').click();await expect.poll(()=>uploads.length).toBe(1);
  assert.equal(uploads[0].path,'/api/v1/ota/convert');assert.equal(uploads[0].headers['x-iotcloud-target-variant'],'hub');assert.equal(uploads[0].headers['x-iotcloud-confirm'],'full-to-hub');assert.equal(uploads[0].headers.authorization,'Basic '+Buffer.from('admin:'+password).toString('base64'));
  await expect.poll(()=>sentBytes.length).toBe(1);assert.equal(sentBytes[0].url,address+'/api/v1/ota/convert');assert.deepEqual(Buffer.from(sentBytes[0].bytes),bytes);if(uploads[0].bytes!==null)assert.deepEqual(uploads[0].bytes,bytes);
  await frame.locator('#hubConversion').uncheck();await frame.locator('#fileForm button[type=submit]').click();await expect.poll(()=>uploads.length).toBe(2);
  await frame.locator('#unsignedRescue').check();page.once('dialog',dialog=>dialog.accept());await frame.locator('#fileForm button[type=submit]').click();await expect.poll(()=>uploads.length).toBe(3);
  assert.deepEqual(uploads.slice(1).map(x=>x.path),['/api/v1/ota/upload','/api/v1/ota/upload-unsigned']);for(const upload of uploads.slice(1)){assert.equal(upload.headers['x-iotcloud-target-variant'],undefined);assert.equal(upload.headers['x-iotcloud-confirm'],undefined);}
  await expect.poll(()=>sentBytes.length).toBe(3);for(const sent of sentBytes)assert.deepEqual(Buffer.from(sent.bytes),bytes);
  // A same-origin iframe still cannot smuggle a reverse/unknown target to HTTP.
  await frame.locator('body').evaluate(()=>{window.invalidUpload=null;window.addEventListener('message',e=>{if(e.data?.type==='device-upload-result'&&e.data.id==='invalid-conversion')window.invalidUpload=e.data.result;});parent.postMessage({type:'device-upload',id:'invalid-conversion',file:new Blob(['fixture']),rescue:false,target:{variant:'full',confirm:'hub-to-full'}},parent.location.origin);});
  await expect.poll(()=>frame.locator('body').evaluate(()=>window.invalidUpload?.status)).toBe(0);assert.equal(uploads.length,3);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const layout=await frame.locator('body').evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,id:el.id,class:el.className,text:el.textContent?.slice(0,100),right:el.getBoundingClientRect().right,left:el.getBoundingClientRect().left})).filter(el=>el.right>innerWidth||el.left<0)}));
  await page.screenshot({path:resolve(evidence,`${engine}-${language}-${width}.png`),fullPage:true});assert(layout.scroll<=layout.width,JSON.stringify(layout));assert.deepEqual(errors,[]);
  const storage=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));assert.equal(storage.includes(password),false);
  await context.close();
  console.log(`PASS ${engine} ${language} ${width}: password setup, explicit signed conversion/cancel, exact Basic and target headers, original uploads, invalid target, private storage, layout`);
 }}finally{await browser.close();}
}}finally{await new Promise(done=>server.close(done));}
