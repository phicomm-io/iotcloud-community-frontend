// Exercise the production iframe and host bridge, not a separately rendered page.
// Every request is fulfilled by this fixture; no LAN device is contacted.
import assert from 'node:assert/strict';
import {readFile,mkdir,readdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {chromium,webkit,expect} from '@playwright/test';

const app=fileURLToPath(new URL('..',import.meta.url)),source=resolve(app,'..');
const bundle=resolve(process.env.M1_DISPLAY_BUNDLE_ROOT||resolve(source,'build/bundle'));
const evidence=resolve(process.env.M1_DISPLAY_BUILT_EVIDENCE||resolve(source,'build/evidence/m1-display-built'));
const production=JSON.parse(await readFile(resolve(source,'tests/fixtures/m1-display-v4-production-get.json'),'utf8'));
const sandbox={window:{},structuredClone,performance};
vm.runInNewContext(await readFile(resolve(source,'M1/web/display-format.js'),'utf8'),sandbox);
vm.runInNewContext(await readFile(resolve(source,'common/web/demo.js'),'utf8'),sandbox);
const target='http://192.168.1.18',origin='http://127.0.0.1:25181',mac='aabbccdd0110';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const results=[];
await mkdir(evidence,{recursive:true});

async function scripts(directory){
 let text='';
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const file=resolve(directory,entry.name);
  if(entry.isDirectory())text+=await scripts(file);
  else if(entry.name.endsWith('.js'))text+=await readFile(file,'utf8');
 }
 return text;
}
// Catch omissions in all producer applications, including the Pages demo.
for(const kind of ['platform','local','hub','demos/platform']){
 const text=await scripts(resolve(bundle,kind));
 for(const symbol of ['M1DisplayFormat','display_profile.get','display_profile.set','display_value.set'])
  assert(text.includes(symbol),`${kind}: missing ${symbol} in actual production assets`);
}

async function fixture(browser,kind,language,width,profileSupported=true){
 const context=await browser.newContext({viewport:{width,height:950},locale:language,serviceWorkers:'block'});
 const device=sandbox.window.PhicommDemo.create('m1'),calls=[],errors=[],requests=[];
 Object.assign(device.state,{device_id:mac,ip:'192.168.1.18'});
 let profile=structuredClone(production);
 await context.addInitScript(language=>{try{localStorage.setItem('phicomm.language',language);localStorage.setItem('mqtt_auto_connect','false');}catch{}},language);
 context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push(url.href);
  if(url.origin===target){
   const reply=data=>route.fulfill({headers:cors,json:{code:'ok',data}});
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors,body:''});
   if(url.pathname==='/api/v1/info')return reply({device_id:mac,model:'m1',api_version:1});
   if(url.pathname==='/api/v1/status')return reply(device.state);
   assert.equal(url.pathname,'/api/v1/command');
   const command=request.postDataJSON();calls.push(command);
   let data;
   if(command.action==='display_profile.get')data=structuredClone(profile);
   else if(command.action==='display_profile.set'){
    assert.equal(command.params.revision,profile.revision);
    profile={...profile,...structuredClone(command.params),revision:profile.revision+1};
    Object.assign(profile.runtime,{profile:'formatted',selected_source:profile.selected_source});
    data={};
   }else if(command.action==='display_value.set'){
    const p=command.params;
    assert.deepEqual(Object.keys(p).sort(),['revision','slot','ttl_seconds','number','decimal','show_label','show_unit','lamps'].sort());
    assert.equal(p.revision,profile.revision);assert(Number.isInteger(p.number)&&p.number>=0&&p.number<=999);assert(!p.slot||!p.decimal);
    assert.equal(typeof p.show_label,'boolean');assert.equal(typeof p.show_unit,'boolean');assert.equal(p.lamps.length,3);
    for(const lamp of p.lamps){assert.deepEqual(Object.keys(lamp).sort(),['green','red','yellow']);for(const flag of Object.values(lamp))assert.equal(typeof flag,'boolean');}
    const lane=profile.runtime.lanes[p.slot];
    Object.assign(lane,{valid:true,value:Number(Math.fround(p.decimal?p.number/100:p.number).toPrecision(9)),unit:p.show_unit?(p.slot?'µg/m³':'mg/m³'):'',
     age_ms:0,remaining_ttl_seconds:p.ttl_seconds,effective:profile.selected_source==='user',reason:'ok',number:p.number,
     format:Number(p.decimal)|(p.show_label?2:0)|(p.show_unit?4:0),lamps:structuredClone(p.lamps),confirmed:true});
    const confirmed=profile.runtime.mcu_supported&&profile.runtime.lanes.every(lane=>lane.confirmed);
    Object.assign(profile.runtime,{confirmed,confirmation:confirmed?'mcu_readback':profile.runtime.mcu_supported?'pending_mcu_readback':'requires_mcu_upgrade'});
    data={};
   }else{
    data=device.command(command.action,command.params);
    if(command.action==='capabilities.get'&&!profileSupported)data.actions=data.actions.filter(action=>!['display_profile.get','display_profile.set','display_value.set'].includes(action));
   }
   return reply(data);
  }
  assert.equal(url.origin,origin,'unexpected network request: '+url.href);
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:{enabled:false,providers:[]}});
  const prefix=kind==='hub'?'/iotcloud/':'/';
  assert(url.pathname.startsWith(prefix),url.pathname);
  const relative=url.pathname.slice(prefix.length)||'index.html',directory=resolve(bundle,kind),file=resolve(directory,relative);
  assert(file.startsWith(directory+'/'));
  return route.fulfill({contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file)});
 });
 const page=await context.newPage(),zh=language==='zh-CN';
 await page.goto(origin+(kind==='hub'?'/iotcloud/':'/')+'#/local');
 await page.getByRole('button',{name:zh?'本地连接':'Local connection',exact:true}).click();
 await page.getByLabel(zh?'设备 IP':'Device IP',{exact:true}).fill(target);
 await page.getByRole('button',{name:zh?'连接本地设备':'Connect local device',exact:true}).click();
 const frame=page.frameLocator('iframe.device-home');
 await expect(frame.locator('#homePage')).toBeVisible();
 await frame.locator('.tabs a[data-tab=settings]').click();await frame.locator('.side a[href="#settings/device"]').click();
 if(profileSupported)await expect(frame.locator('#displaySourceSave')).toBeEnabled();
 else await expect(frame.locator('#displaySourceSave')).toBeHidden();
 return {context,page,frame,calls,errors,requests};
}

const engines=process.env.BROWSER?[[process.env.BROWSER,{chromium,webkit}[process.env.BROWSER]]]:[['chromium',chromium],['webkit',webkit]];
for(const [engine,type] of engines){
 const browser=await type.launch(engine==='webkit'&&process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH?{executablePath:process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH}:{});
 try{for(const kind of ['platform','local','hub']){
  for(const language of ['en','zh-CN'])for(const width of [390,1440]){
   const {context,page,frame,calls,errors}=await fixture(browser,kind,language,width);
   try{
    assert.equal(await frame.locator('body').evaluate(()=>typeof M1DisplayFormat.encode),'function');
    await expect(frame.locator('#display0Mode option')).toHaveCount(5);
    // The initial GET is a real serialized C snapshot, including float32 error.
    await expect(frame.locator('#display0Value')).toHaveValue('123');await expect(frame.locator('#display0Status')).toContainText('1.23 mg/m³');
    await frame.locator('#displaySelectedSource').selectOption('user');await frame.locator('#displayDoubleClick').selectOption('switch_display');
    await frame.locator('#displaySourceSave').click();await expect(frame.locator('#display0Write')).toBeEnabled();
    assert(calls.some(request=>request.action==='display_profile.set'));
    const patterns=[['0red','0green','1yellow','2green','2yellow'],['0yellow','1red','1green','2red']];
    for(const slot of [0,1]){
     const prefix='#display'+slot;
     await frame.locator(prefix+'Value').fill(slot?'864':'321');await frame.locator(prefix+'WriteTTL').fill('10');
     if(!slot)await frame.locator(prefix+'Decimal').check();
     await frame.locator(prefix+'WriteGlyph').check();await frame.locator(prefix+'WriteLabel').setChecked(!slot);
     for(let position=0;position<3;position++)for(const color of ['red','green','yellow'])
      await frame.locator(prefix+'WriteLamp'+position+color).setChecked(patterns[slot].includes(position+color));
     await frame.locator(prefix+'Write').click();await expect(frame.locator(prefix+'Write')).toBeEnabled();
     const written=calls.findLast(request=>request.action==='display_value.set');assert.equal(written.params.slot,slot);
     assert.equal(written.params.number,slot?864:321);assert.equal(written.params.decimal,!slot);
     assert.deepEqual(written.params.lamps,Array.from({length:3},(_,position)=>Object.fromEntries(['red','green','yellow'].map(color=>[color,patterns[slot].includes(position+color)]))));
     assert(calls.slice(calls.indexOf(written)+1).some(request=>request.action==='display_profile.get'),'write must use an independent GET receipt');
     await expect(frame.locator(prefix+'Status')).toContainText(slot?'864 µg/m³':'3.21 mg/m³');
    }
    const before=calls.filter(request=>request.action==='display_value.set').length;
    for(const invalid of ['1000','1.2']){await frame.locator('#display0Value').fill(invalid);await frame.locator('#display0Write').click();}
    assert.equal(calls.filter(request=>request.action==='display_value.set').length,before,'raw API values must not be silently converted');
    assert.equal(calls.some(request=>request.action==='display_source.get'),false,'schema4 must own the embedded form');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);
    const screenshot=`${kind}-${engine}-${language}-${width}.png`;
    await page.screenshot({path:resolve(evidence,screenshot),fullPage:true});
    results.push({kind,engine,language,width,result:'PASS',screenshot,checks:['built_scripts','real_C_GET','profile_save','raw_digits_and_18_lamps','independent_receipt','invalid_raw_rejected','no_overflow']});
    console.log(`PASS built ${kind} ${engine} ${language} ${width}: schema4 GET/config/raw frame/18 lamps and independent readback`);
   }finally{await context.close();}
  }
  const {context,frame,calls,errors}=await fixture(browser,kind,'en',390,false);
  try{await expect(frame.locator('#displaySourceConfig')).toContainText('Update this M1’s Wi-Fi firmware');await expect(frame.locator('#displaySourceSave')).toBeHidden();assert.equal(await frame.locator('body').evaluate(()=>UI.userDisplay.enabled),false);assert.equal(calls.some(request=>/^display_(profile|value|source|data)\./.test(request.action)),false);assert.deepEqual(errors,[]);console.log(`PASS built ${kind} ${engine}: unsupported profile upgrade hint`);}finally{await context.close();}
 }}finally{await browser.close();}
}
// The compiled demo runs its simulator in the host window. A helper inside its
// device iframe cannot satisfy that separate runtime dependency.
for(const [engine,type] of engines){
 const browser=await type.launch(engine==='webkit'&&process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH?{executablePath:process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH}:{});
 try{for(const kind of ['demos/platform','demos/m1'])for(const language of ['en','zh-CN'])for(const width of kind==='demos/platform'?[390,1440]:[390]){
  const context=await browser.newContext({viewport:{width,height:950},locale:language,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],network=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.addInitScript(language=>{
   try{localStorage.setItem('phicomm.language',language);}catch{}
   window.__m1DisplayCalls=[];
   window.addEventListener('message',event=>{if(event.data?.type==='device-command')window.__m1DisplayCalls.push(event.data.request);});
  },language);
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());network.push(url.href);assert.equal(url.origin,origin,'demo attempted a real network request');
   if(url.pathname.endsWith('/config.json'))return route.fulfill({json:{}});
   const directory=resolve(bundle,kind),file=resolve(directory,url.pathname.slice(1)||'index.html');
   assert(file.startsWith(directory+'/'));
   return route.fulfill({contentType:types[extname(file)]||'application/octet-stream',body:await readFile(file)});
  });
  try{
   await page.goto(origin+(kind==='demos/platform'?'/#/':'/#settings/device'));
   if(kind==='demos/platform'){
    await expect.poll(()=>page.evaluate(()=>typeof window.M1DisplayFormat?.encode),'the demo host must load the shared formatter itself').toBe('function');
    if(width>800)await page.locator('.device-list .device-select').nth(1).click();
    else{await page.locator('.device-picker-trigger').click();await page.locator('.picker-list > li button').nth(1).click();}
   }else{
    await page.evaluate(()=>{const original=window.fetch;window.fetch=(url,options={})=>{if(url==='/api/v1/command')window.__m1DisplayCalls.push(JSON.parse(options.body));return original(url,options);};});
   }
   const view=kind==='demos/platform'?page.frameLocator('iframe.device-home'):page;
   await expect.poll(()=>view.locator('body').evaluate(()=>UI.state?.model)).toBe('m1');
   if(kind==='demos/platform'){await view.locator('.tabs a[data-tab=settings]').click();await view.locator('.side a[href="#settings/device"]').click();}
   await expect(view.locator('#displaySourceSave')).toBeEnabled();
   await expect(view.locator('#displaySourceConfig h2')).toHaveText(language==='en'?'User readings on the device screen':'设备屏幕用户读数');
   await view.locator('#displaySelectedSource').selectOption('user');await view.locator('#displayDoubleClick').selectOption('switch_display');
   for(const slot of [0,1])await view.locator('#display'+slot+'Source').selectOption('api');
   await view.locator('#displaySourceSave').click();await expect(view.locator('#display0Write')).toBeEnabled();
   for(const slot of [0,1]){
    const id='#display'+slot;
    await view.locator(id+'Value').fill(slot?'864':'123');await view.locator(id+'WriteTTL').fill('10');
    if(!slot)await view.locator(id+'Decimal').check();
    await view.locator(id+'WriteGlyph').check();await view.locator(id+'WriteLamp0red').check();await view.locator(id+'WriteLamp1yellow').check();await view.locator(id+'WriteLamp2green').check();
    await view.locator(id+'Write').click();await expect(view.locator(id+'Write')).toBeEnabled();
    await expect(view.locator(id+'Status')).toContainText(slot?'864 µg/m³':'1.23 mg/m³');
    const calls=await page.evaluate(()=>window.__m1DisplayCalls),write=calls.findLast(request=>request.action==='display_value.set');
    assert.equal(write.params.slot,slot);assert.equal(write.params.number,slot?864:123);assert.equal(write.params.decimal,!slot);
    assert.deepEqual(write.params.lamps,[{red:true,green:false,yellow:false},{red:false,green:false,yellow:true},{red:false,green:true,yellow:false}]);
    assert(calls.slice(calls.indexOf(write)+1).some(request=>request.action==='display_profile.get'));
   }
   for(const slot of [0,1]){
    await view.locator('#display'+slot+'Clear').click();await expect(view.locator('#display'+slot+'Write')).toBeEnabled();
    const calls=await page.evaluate(()=>window.__m1DisplayCalls),write=calls.findLast(request=>request.action==='display_value.set');
    assert.deepEqual(write.params,{revision:2,slot,ttl_seconds:0});
    assert(calls.slice(calls.indexOf(write)+1).some(request=>request.action==='display_profile.get'));
   }
   assert.equal(await view.locator('#toasts .toast.bad').count(),0);assert.deepEqual(errors,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await view.locator('body').evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const screenshot=`${kind.replaceAll('/','-')}-${engine}-${language}-${width}.png`;
   await page.screenshot({path:resolve(evidence,screenshot),fullPage:true});
   results.push({kind,engine,language,width,result:'PASS',screenshot,checks:['real_demo_dependency','profile_get_set','raw_frame_and_lamps','independent_get','both_TTL_zero_clears','translated_form','no_pageerror','no_external_request']});
   console.log(`PASS built ${kind} ${engine} ${language} ${width}: simulator dependency, three actions, two raw frames/lamps and TTL0 readback`);
  }finally{await context.close();}
 }}finally{await browser.close();}
}
await writeFile(resolve(evidence,'results.json'),JSON.stringify({result:'PASS',cases:results,device_mutations:false},null,2)+'\n');
