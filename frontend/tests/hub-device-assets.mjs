import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import vm from 'node:vm';
import {chromium,webkit,expect} from '@playwright/test';
import {buildDeviceAssets} from '../deviceAssets.js';

const appRoot=fileURLToPath(new URL('..',import.meta.url)),sourceRoot=resolve(appRoot,'..');
const output=await buildDeviceAssets({sourceRoot,appRoot});
const refs=html=>[...html.matchAll(/(?:src|href)="(\/iotcloud\/device-assets\/[^"?#]+)"/g)].map(match=>match[1]);
const evidence=resolve(sourceRoot,'../review/hub-device-assets');

test('shared device assets keep all products and share the standalone DAIKIN code',()=>{
 assert.deepEqual(Object.keys(output.pages),['tc1','a1','m1','daikin']);
 for(const html of [...Object.values(output.pages),output.standalone]){
  assert(!/<style\b|<script\b[^>]*>[^<]+/i.test(html),'scripts and styles must use the local pool');
  assert(!/data-device-part|@include/.test(html));
  for(const url of refs(html))assert(output.assets.has(url.slice('/iotcloud/'.length)),url);
 }
 const root=new Set(refs(output.standalone)),embedded=new Set(refs(output.pages.daikin));
 assert([...root].every(url=>embedded.has(url)),'root must reuse the exact embedded DAIKIN assets');
 assert.equal(embedded.size-root.size,2,'only the transport bridge and embedded runtime differ');
 const dictionaries=Object.values(output.pages).map(html=>refs(html).filter(url=>url.endsWith('.js'))[1]);
 assert.equal(new Set(dictionaries).size,1,'all products must load the same translation dictionary');
 for(const [name,content] of output.assets){
  assert(name.includes(createHash('sha256').update(content).digest('hex').slice(0,20)));
 }
});

test('cold root and embedded pages work locally with Basic auth, typed controls and both languages',async()=>{
 await mkdir(evidence,{recursive:true});
 const sandbox={window:{},structuredClone,performance};
 vm.runInNewContext(await readFile(resolve(sourceRoot,'common/web/demo.js'),'utf8'),sandbox);
 let fixtures,writes,rootRequests;const requests=[];
 const reset=()=>{
  fixtures=Object.fromEntries(Object.keys(output.pages).map(model=>[model,sandbox.window.PhicommDemo.create(model)]));
  writes=[];rootRequests=[];
 };
 reset();
 const basic='Basic '+Buffer.from('admin:fixture-password').toString('base64');
 const host=model=>`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{display:block;width:100%;border:0}</style><iframe id="device" sandbox="allow-scripts allow-same-origin allow-modals allow-forms"></iframe><script>
 const frame=document.getElementById('device');
 window.addEventListener('message',async event=>{
  if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
  const message=event.data;
  if(message.type==='device-height'){frame.style.height=message.height+'px';return;}
  if(message.type==='device-sensor-sources'){frame.contentWindow.postMessage({type:'device-sensor-sources-result',id:message.id,sources:[]},location.origin);return;}
  if(message.type!=='device-command')return;
  const result=await fetch('/fixture/${model}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message.request)}).then(response=>response.json());
  frame.contentWindow.postMessage({type:'device-result',id:message.id,reply:result},location.origin);
 });
 frame.srcdoc=${JSON.stringify(output.pages[model]).replace(/</g,'\\u003c')};
 </script>`;
 const server=createServer(async(req,res)=>{
  try{
   const path=new URL(req.url,'http://fixture').pathname;
   if(path==='/'||path==='/api/v1/command'){
    if(req.headers.authorization!==basic){res.writeHead(401,{'WWW-Authenticate':'Basic realm="DAIKIN"'}).end();return;}
    if(path==='/'){res.writeHead(200,{'Content-Type':'text/html','Content-Encoding':'gzip'});res.end(gzipSync(output.standalone));return;}
   }
   if(path==='/api/v1/command'||path.startsWith('/fixture/')){
    let body='';for await(const chunk of req)body+=chunk;
    const request=JSON.parse(body),model=path==='/api/v1/command'?'daikin':path.slice('/fixture/'.length);
    if(path==='/api/v1/command')rootRequests.push({auth:req.headers.authorization,...request});
    if(!request.action.endsWith('.get'))writes.push({model,path,...request});
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:request.action.endsWith('.get')?'ok':'accepted',data:fixtures[model].command(request.action,request.params)}));return;
   }
   if(path.startsWith('/embedded/')){res.setHeader('Content-Type','text/html');res.end(host(path.slice('/embedded/'.length)));return;}
   const content=output.assets.get(path.slice('/iotcloud/'.length));
   if(!path.startsWith('/iotcloud/device-assets/')||content===undefined){res.writeHead(404).end();return;}
   requests.push(path);res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':'text/css','Content-Encoding':'gzip'});res.end(gzipSync(content));
  }catch(error){res.writeHead(500).end(error.message);}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(origin)).status,401,'root must retain its Basic challenge');
  for(const engine of [chromium,webkit]){
   const browser=await engine.launch(engine===webkit&&process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH?{executablePath:process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH}:{});
   try{for(const language of ['en','zh-CN'])for(const model of ['root','tc1','a1','m1','daikin']){
    reset();const errors=[],warnings=[],external=[];
    const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block',httpCredentials:{username:'admin',password:'fixture-password'}});
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='warning'&&!message.text().startsWith('An iframe which has both allow-scripts and allow-same-origin'))warnings.push(message.text());});
    await page.addInitScript(value=>localStorage.setItem('phicomm.language',value),language);
    await page.goto(origin+(model==='root'?'/':'/embedded/'+model));
    const view=model==='root'?page:page.frameLocator('#device');
    const body=view.locator('body');
    await expect.poll(()=>body.evaluate(()=>window.UI?.state?.model)).toBe(model==='root'?'daikin':model);
    assert.equal(await body.evaluate(()=>I18N.lang),language);
    assert.equal(await body.evaluate(()=>!!UI.embedded),model!=='root');
    if(model==='tc1'){
     await view.locator('#socket0').click();await expect.poll(()=>writes.length).toBe(1);
     assert.equal(writes[0].action,'outlet.set');assert.deepEqual(writes[0].params,{index:0,on:false});
    }else if(model==='a1'){
     await view.locator('#power').click();await expect.poll(()=>writes.length).toBe(1);
     assert.equal(writes[0].action,'fan.set');assert.deepEqual(writes[0].params,{on:false});
    }else if(model==='m1'){
     await view.locator('[data-control="brightness"]').getByRole('button',{name:'2',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);
     assert.equal(writes[0].action,'display.set');assert.deepEqual(writes[0].params,{brightness:50});
    }else{
     await view.locator('#indicator').uncheck();await expect.poll(()=>writes.length).toBe(1);
     assert.equal(writes[0].action,'indicator.set');assert.deepEqual(writes[0].params,{enabled:false});
    }
    await expect.poll(()=>body.evaluate(()=>UI.controlBusy)).toBeFalsy();
    if(model==='root'){
     assert(rootRequests.length>=3);assert(rootRequests.every(request=>request.auth===basic));
     await page.locator('[data-tab="settings"]').click();await page.locator('#side a[href="#settings/device"]').click();
    }else{
     assert.equal(rootRequests.length,0,'embedded pages must send commands through the host bridge');
     assert(writes.every(request=>request.path==='/fixture/'+model));
     await body.evaluate(()=>{UI.embeddedRoute='settings/device';UI.showRoute();});
    }
    await expect(view.locator('#deviceName')).toBeVisible();await expect(view.locator('#webPassword')).toBeVisible();
    assert.equal(await body.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'390px overflow: '+model);
    const settings=await body.innerText();assert(settings.includes(language==='en'?'Device name':'设备名称'),language+' settings translation');
    await page.screenshot({path:resolve(evidence,`${engine.name()}-${language}-${model}.png`),fullPage:true});
    assert.deepEqual(errors,[],model+' script errors');assert.deepEqual(warnings,[],model+' translation warnings');assert.deepEqual(external,[],model+' external requests');
    await context.close();console.log(`PASS ${engine.name()} ${language} 390 ${model}: cold local assets, control and settings`);
   }}finally{await browser.close();}
  }
  const gzipBytes=[...output.assets.values()].reduce((total,source)=>total+gzipSync(source,{level:9}).length,0);
  await writeFile(resolve(evidence,'sizes.json'),JSON.stringify({assets:output.assets.size,gzipBytes,rootGzip:gzipSync(output.standalone,{level:9}).length,requests:requests.length},null,2)+'\n');
 }finally{await new Promise(done=>server.close(done));}
});
