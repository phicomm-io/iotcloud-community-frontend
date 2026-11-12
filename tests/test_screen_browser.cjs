const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const html=cp.execFileSync('python3',['common/web/page.py','DAIKIN/web/index.html','--minify']);
const codec=import('../frontend/src/wireCodec.js');
const initial=cp.execFileSync(process.env.SCREEN_SCENE_CODEC,['default']);
let scene=Buffer.from(initial),upload,meta,writes=[],weatherConfig,display,brightnessRequest,brightnessPending,policy,moduleState,media,streamConfig,linkConfig,mediaUpload,mediaMeta;
const brightness=()=>({supported:true,available:true,requested_percent:display.luminance,ceiling_percent:10,applied_percent:Math.min(10,display.luminance),asleep:false,age_ms:0});
function crc(data){let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
const status=()=>({model:'daikin',hardware_model:'BRY88BBA15G',device_id:'aabbccddeeff',name:'Room air',version:'dev-dirty',wifi_connected:true,sensors:{co2:{valid:true,value:641,age_ms:0}},screen:{extension_supported:true,capabilities:1533|8192|4194304|8388608|16777216,module:moduleState,settings:{display},settings_request:brightnessRequest,brightness:brightness(),layout_revision:scene.readUInt32LE(4),mcu_layout_revision:scene.readUInt32LE(4),storage:'owned',ota:{state:'empty',installable:false,gate:'bootloader_unverified'}}});
const actions=['status.get','config.get','capabilities.get','binding.status.get','screen.settings.get','screen.settings.set','screen.display.get','screen.display.set','screen.layout.get','screen.layout.begin','screen.layout.chunk','screen.layout.commit','screen.reminders.get','screen.reminders.set','screen.reminders.configure','screen.reminders.push','screen.weather.get','screen.weather.set','screen.module.get','screen.module.set',...['link.get','link.set','media.begin','media.chunk','media.commit','media.cancel','media.get','push.send','push.get','push.dismiss','push.select','stream.get','stream.set','stream.start','stream.stop'].map(a=>'screen.'+a)];
const server=http.createServer(async(req,res)=>{
 try{
 const {encodeWire,decodeWire}=await codec,reply=(code,data={},n=200)=>res.writeHead(n,{'Content-Type':'application/msgpack'}).end(encodeWire({code,data}));
 if(req.url==='/api/v1/info')return reply('ok',{api_version:1,device_id:'aabbccddeeff',model:'daikin',firmware_version:'dev-dirty',variant:'full',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack',password_set:false});
 if(req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(html);return;}
 const chunks=[];for await(const p of req)chunks.push(p);const request=decodeWire(Buffer.concat(chunks),'msgpack');assert.equal(req.headers['content-type'],'application/msgpack');
 if(req.url==='/api/v1/auth/login')return reply('ok',{token:'a'.repeat(32)});
 const {action,params={}}=request;writes.push({action,params});let data={};
 if(action==='status.get'||action==='config.get')data=status();
 else if(action==='capabilities.get')data={device_id:'aabbccddeeff',model:'daikin',firmware_version:'dev-dirty',variant:'full',actions,business_status:true};
 else if(action==='binding.status.get')data={peers:[],max_sessions:4};
 else if(action==='screen.settings.get'){
  if(brightnessPending){if(brightnessPending.wait--){}else{display=brightnessPending.display;brightnessRequest={token:brightnessPending.token,code:0,state:'confirmed'};brightnessPending=null;}}
  data={settings:{display},saved_settings:{display},snapshot_age_ms:0,request:brightnessRequest,brightness:brightness()};
 }
 else if(action==='screen.settings.set'){const token='brightness-'+writes.length;brightnessRequest={token,code:-1,state:'pending'};brightnessPending={token,display:params.display,wait:1};data={token};}
 else if(action==='screen.display.get')data=policy;
 else if(action==='screen.display.set'){policy={...policy,...params,revision:policy.revision+1};policy.applied_revision=policy.revision;data=policy;}
 else if(action==='screen.layout.get')data={revision:scene.readUInt32LE(4),crc:crc(scene),total:scene.length,offset:params.offset,bytes:scene.subarray(params.offset,params.offset+params.limit).toString('base64')};
 else if(action==='screen.layout.begin'){meta=params;upload=Buffer.alloc(params.total);}
 else if(action==='screen.layout.chunk')Buffer.from(params.bytes,'base64').copy(upload,params.offset);
 else if(action==='screen.layout.commit'){assert.equal(crc(upload),meta.crc);scene=upload;data={revision:meta.revision};}
 else if(action==='screen.media.get'||action==='screen.push.get')data=media;
 else if(action.startsWith('screen.media.')||action==='screen.push.send'||action==='screen.push.dismiss'||action==='screen.push.select'||['screen.stream.set','screen.stream.start','screen.stream.stop'].includes(action)){
  const sequence=media.request.sequence+1;data={request:sequence,id:params.id||0,state:'pending'};
  media.request={sequence,id:params.id||0,state:'complete',result:0};
  if(action==='screen.media.begin'){mediaMeta=params;mediaUpload=Buffer.alloc(params.total);}
  if(action==='screen.media.chunk'){assert(params.offset<mediaUpload.length);assert(Buffer.from(params.bytes,'base64').length<=512);Buffer.from(params.bytes,'base64').copy(mediaUpload,params.offset);}
  if(action==='screen.media.commit'){assert.equal(crc(mediaUpload),mediaMeta.crc32);assert.equal(mediaUpload.readUInt16BE(0),0xffd8);assert.equal(mediaUpload.readUInt16BE(mediaUpload.length-2),0xffd9);const sof=mediaUpload.indexOf(Buffer.from([0xff,0xc0]));assert(sof>0);assert.equal(mediaUpload.readUInt16BE(sof+5),240);assert.equal(mediaUpload.readUInt16BE(sof+7),320);assert.equal(mediaUpload.indexOf(Buffer.from([0xff,0xc2])),-1);}
  if(action==='screen.push.select')media.view_index=params.index;
  if(action==='screen.push.send')media.messages.push({id:params.id,state:'displayed'});
  if(action==='screen.push.dismiss')media.messages.find(m=>m.id===params.id).state='dismissed';
  if(action==='screen.stream.set')streamConfig={...streamConfig,...params,password_set:true};
  if(action==='screen.stream.start')streamConfig.enabled=true;
  if(action==='screen.stream.stop')streamConfig.enabled=false;
 }
 else if(action==='screen.stream.get'){data={...streamConfig};delete data.password;}
 else if(action==='screen.link.get')data=linkConfig;
 else if(action==='screen.link.set')linkConfig={...linkConfig,...params};
 else if(action==='screen.reminders.get')data={timezone:480,wake:0,rules:[],notices:[]};
 else if(action==='screen.module.get')data=moduleState;
 else if(action==='screen.module.set'){moduleState={...moduleState,state:'complete',request:moduleState.request+1,set_high:params.set_high,remaining_ms:params.duration_ms};data={request:moduleState.request,state:'pending'};}
 else if(action==='screen.weather.get')data={config:weatherConfig};
 else if(action==='screen.weather.set')weatherConfig={...weatherConfig,...params,key_set:params.provider!=='openmeteo'};
 return reply(action.endsWith('.commit')?'accepted':'ok',data);
 }catch(e){console.error(e);res.writeHead(500).end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const lang of ['en','zh-CN']){
  scene=Buffer.from(initial);writes=[];media={request:{sequence:0,state:'idle'},messages:[],queue_capacity:16,image_capacity:4,stack_capacity:4,queued:0,view_index:0};streamConfig={url:'http://camera/mjpeg',username:'viewer',password_set:true,width:320,height:240,fps:1,verify_tls:true,enabled:false,state:'paused'};linkConfig={mode:'fixed',rate:115200,max_rate:921600,actual_rate:115200,state:'ready',crc_errors:0,fallbacks:0};moduleState={supported:true,available:true,initialized:true,set_high:true,remaining_ms:0,valid_frames:50,request:0,state:'idle'};policy={supported:true,revision:1,applied_revision:1,ceiling:40,external_minutes:2,battery_minutes:1,idle_brightness:0,idle_page:255,plans:[]};display={luminance:60,data_type:1,power_screen_time:2,battery_screen_time:1};brightnessRequest={token:'',code:-1,state:'idle'};brightnessPending=null;weatherConfig={enabled:true,provider:'openweather',key_set:true,latitude:31.2,longitude:121.4,label:'Shanghai',interval:900};const errors=[],page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/#settings/screen');await page.waitForFunction(()=>document.querySelector('#screenEditor')?.hidden===false,null,{timeout:10000}).catch(async e=>{console.error({errors,writes,debug:await page.evaluate(()=>({text:document.body.textContent.slice(-1800),state:UI.state,caps:UI.caps}))});throw e;});
  await page.evaluate(lang=>{I18N.set(lang);document.querySelectorAll('#screenEditor details').forEach(d=>d.open=true);},lang);
  await page.locator('#screenTab_advanced').click();await page.locator('#screenModuleSeconds').fill('2');await page.locator('#screenModuleLow').click();await page.waitForFunction(()=>!document.querySelector('#screenModuleHigh').disabled);assert.equal(moduleState.set_high,false);assert.equal(moduleState.remaining_ms,2000);await page.locator('#screenModuleHigh').click();await page.waitForFunction(()=>!document.querySelector('#screenModuleHigh').disabled);assert.equal(moduleState.set_high,true);assert(!await page.locator('body').textContent().then(s=>s.includes('vals is not defined')));assert.equal(moduleState.remaining_ms,0);
  await page.locator('#screenTab_display').click();await page.locator('#screenBrightnessLoad').click();await page.waitForFunction(()=>document.querySelector('#screenBrightness').value==='60'&&!document.querySelector('#screenBrightness').disabled);
  assert.match(await page.locator('#screenBrightnessReadback').textContent(),/10%/);assert.match(await page.locator('#screenBrightnessLimit').textContent(),/10%/);
  for(const value of [5,0,60]){
   const requestsBefore=writes.filter(w=>w.action==='screen.settings.set').length;
   await page.locator('#screenBrightness').evaluate((el,value)=>{el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));},value);await page.locator('#screenBrightnessSave').click();assert.equal(await page.locator('#screenBrightnessSave').isDisabled(),true);
   await page.waitForFunction(()=>document.querySelector('#screenBrightnessState').textContent.match(/confirmed by the controller|控制器已确认/));
   assert.deepEqual(display,{luminance:value,data_type:1,power_screen_time:2,battery_screen_time:1});assert.equal(await page.locator('#screenBrightnessSave').isDisabled(),false);
   assert.equal(writes.filter(w=>w.action==='screen.settings.set').length,requestsBefore+1,'One save click must send exactly one settings update');
  }
  const brightnessOut=process.env.SCREEN_BROWSER_ARTIFACTS||'build';fs.mkdirSync(brightnessOut,{recursive:true});await page.locator('#screenBrightnessSettings').screenshot({path:path.join(brightnessOut,`brightness-${width}-${lang}.png`)});
  await page.locator('#screenTab_layout').click();await page.locator('#screenLoad').click();await page.waitForFunction(()=>!document.querySelector('#screenLoad').hasAttribute('aria-busy'));await page.waitForSelector('[data-component="1"]');await page.locator('#screenEdit').click();
  const measurePreview=async()=>page.evaluate(()=>{
   const g=document.querySelector('#screenGrid').getBoundingClientRect();
   const box=selector=>{const b=document.querySelector(selector).getBoundingClientRect();return {x:(b.x-g.x)*480/g.width,y:(b.y-g.y)*854/g.height,w:b.width*480/g.width,h:b.height*854/g.height};};
   return {width:g.width,height:g.height,first:box('[data-cell="0"]'),last:box('[data-cell="23"]'),tile:box('[data-component="1"]')};
  });
  for(const previewWidth of [320,width]){
   await page.setViewportSize({width:previewWidth,height:900});const p=await measurePreview();
   assert(Math.abs(p.width/p.height-480/854)<.001);assert(p.width<=480);
   for(const [actual,expected] of [[p.first,{x:16,y:66,w:106,h:122}],[p.last,{x:358,y:716,w:106,h:122}],[p.tile,{x:16,y:66,w:448,h:252}]])
    for(const k of ['x','y','w','h'])assert(Math.abs(actual[k]-expected[k])<.15,`${previewWidth} ${k}: ${actual[k]} vs ${expected[k]}`);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.locator('#screenPage').selectOption('3');await page.waitForFunction(()=>document.querySelector('[data-component="14"]'));const weatherBounds=await page.locator('[data-component="14"]').boundingBox(),canvasBounds=await page.locator('#screenGrid').boundingBox();
  if(!weatherBounds)console.error(await page.evaluate(()=>({active:[...document.querySelectorAll('[role=tab]')].map(e=>[e.id,e.getAttribute('aria-selected')]),page:document.querySelector('#screenPage').value,items:[...document.querySelectorAll('[data-component]')].map(e=>e.dataset.component),hidden:[...document.querySelectorAll('[hidden]')].filter(e=>e.contains(document.querySelector('#screenGrid'))).map(e=>e.id),text:document.querySelector('#screenDraft').textContent})));
  assert(Math.abs(weatherBounds.height/canvasBounds.height-772/854)<.001);
  assert(Math.abs(weatherBounds.width/canvasBounds.width-448/480)<.001);
  const previewOut=process.env.SCREEN_BROWSER_ARTIFACTS||'build';fs.mkdirSync(previewOut,{recursive:true});await page.locator('#screenGrid').screenshot({path:path.join(previewOut,`screen-preview-${width}-${lang}.png`)});
  await page.locator('#screenPage').selectOption('1');await page.locator('[data-component="10"]').click();await page.locator('[data-component-field="value_mode"]').selectOption('1');
  assert.match(await page.locator('[data-component="10"]').textContent(),/ppb.*375/);await page.locator('#screenGrid').screenshot({path:path.join(previewOut,`tvoc-number-${width}-${lang}.png`)});
  await page.locator('[data-component-field="value_mode"]').selectOption('2');assert.match(await page.locator('[data-component="10"]').textContent(),/Good|优/);
  await page.locator('[data-component-field="value_mode"]').selectOption('1');
  await page.locator('#screenPage').selectOption('0');
  await page.locator('[data-component="1"]').click();await page.locator('[data-component-field="title"]').fill('室内空气');await page.locator('[data-component-field="title"]').press('Tab');
  await page.locator('#screenSave').click();await page.waitForFunction(()=>document.querySelector('#screenDraft').textContent.match(/^Saved|^已保存/));assert.equal(scene.readUInt32LE(4),2);
  await page.locator('#screenPageTitle').fill('Draft title');await page.locator('#screenPageTitle').press('Tab');await page.evaluate(()=>UI.reload());assert.equal(await page.locator('#screenPageTitle').inputValue(),'Draft title');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#screenEditor')?.hidden===false);await page.evaluate(()=>document.querySelectorAll('#screenEditor details').forEach(d=>d.open=true));await page.locator('#screenTab_layout').click();await page.waitForFunction(()=>document.querySelector('#screenPageTitle')?.value==='Draft title');
  // Compose a page with actual pointer drag and resize, then undo and save.
  await page.locator('#screenAddPage').click();await page.locator('#screenAddType').selectOption('1');await page.locator('#screenAddItem').click();
  await page.locator('#screenGrid').evaluate(el=>el.scrollIntoView({block:'center'}));let tile=page.locator('#screenGrid [data-component]');await tile.scrollIntoViewIfNeeded();let box=await tile.boundingBox(),gridBox=await page.locator('#screenGrid').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+2*107*gridBox.width/480,box.y+box.height/2,{steps:6});await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('[data-component-field="x"]')?.value==='2');
  let handle=page.locator('.screen-resize');await handle.scrollIntoViewIfNeeded();box=await handle.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height/2+2*120*gridBox.height/854,{steps:6});await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('[data-component-field="h"]')?.value==='4',null,{timeout:4000}).catch(async e=>{console.error(JSON.stringify({box,gridBox,debug:await page.evaluate(()=>({fields:[...document.querySelectorAll('[data-component-field]')].map(e=>[e.dataset.componentField,e.value]),draft:document.querySelector('#screenDraft').textContent,toasts:[...document.querySelectorAll('[role=status]')].map(e=>e.textContent)}))}));throw e;});await page.locator('#screenUndo').click();
  await page.locator('#screenGrid [data-component]').click();assert.equal(await page.locator('[data-component-field="h"]').inputValue(),'2');
  await page.locator('#screenSave').click();await page.waitForFunction(()=>document.querySelector('#screenDraft').textContent.match(/^Saved|^已保存/));
  // Resize a real value card across all supported shapes, then compose a 4x2 chart.
  await page.locator('#screenGrid [data-component]').click();await page.locator('#screenDelete').click();
  await page.locator('#screenAddType').selectOption('1');await page.locator('#screenAddItem').click();await page.locator('#screenGrid [data-component]').click();
  const resizeField=async(key,value)=>{const input=page.locator(`[data-component-field="${key}"]`);await input.fill(String(value));await input.press('Tab');};
  const fontSize=()=>page.locator('.screen-number-content .screen-widget-value').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  const smallFont=await fontSize();await resizeField('w',4);await resizeField('h',4);assert((await fontSize())>smallFont);
  await resizeField('h',1);assert.equal(await page.locator('[data-value-layout]').getAttribute('data-value-layout'),'row');
  const numberBounds=await page.locator('.screen-number-content').evaluate(el=>{
   const bounds=selector=>{const r=el.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
   return {title:bounds('.screen-widget-label'),unit:bounds('.screen-widget-unit'),value:bounds('.screen-widget-value')};
  });
  assert(numberBounds.unit.y>numberBounds.title.y);assert(numberBounds.value.x>numberBounds.title.x+numberBounds.title.w);
  await page.locator('#screenAddType').selectOption('3');await page.locator('#screenAddItem').click();await page.locator('#screenGrid [data-component]').last().click();
  assert.equal(await page.locator('[data-component-field="w"]').inputValue(),'4');assert.equal(await page.locator('[data-component-field="h"]').inputValue(),'2');
  await page.locator('[data-component-field="chart"]').selectOption('5');assert.equal(await page.locator('[data-chart-layout]').getAttribute('data-chart-layout'),'strip');
  await page.locator('#screenAddType').selectOption('6');await page.locator('#screenAddItem').click();
  await page.locator('#screenSave').click();await page.waitForFunction(()=>document.querySelector('#screenDraft').textContent.match(/^Saved|^已保存/));
  const composed=path.join(previewOut,`responsive-${width}-${lang}.bin`);fs.writeFileSync(composed,scene);cp.execFileSync(process.env.SCREEN_SCENE_CODEC,[composed]);
  await page.locator('#screenGrid').screenshot({path:path.join(previewOut,`responsive-${width}-${lang}.png`)});
  await page.locator('#screenTab_display').click();await page.locator('#screenPolicyLoad').click();await page.waitForFunction(()=>!document.querySelector('#screenAddPlan').disabled);await page.locator('#screenAddPlan').click();
  await page.locator('#screenPolicy_idle_page').selectOption('6');await page.locator('#screenPolicySave').click();await page.waitForFunction(()=>document.querySelector('#screenPolicyState').textContent.match(/Policy|策略/));
  assert.equal(writes.filter(w=>w.action==='screen.display.set').at(-1).params.plans[0].days,127);assert.equal(policy.idle_page,6);
  await page.evaluate(()=>document.querySelectorAll('#screenEditor details').forEach(d=>d.open=true));
  await page.locator('#screenTab_services').click();await page.locator('#screenWeather [data-i18n="screen.load"]').click();await page.waitForFunction(()=>document.querySelector('#screenWeatherKey').placeholder.length>0);
  assert.equal(await page.locator('#screenWeatherVerifyTls').isChecked(),false);await page.locator('#screenWeatherVerifyTls').check();assert.equal(await page.locator('#screenWeatherKey').inputValue(),'');await page.locator('#screenTab_services').click();await page.locator('#screenWeather [data-i18n="common.save"]').click();await page.waitForTimeout(150);assert.equal('key' in writes.find(w=>w.action==='screen.weather.set').params,false);assert.equal(weatherConfig.verify_tls,true);assert.equal(await page.locator('#screenWeatherVerifyTls').isChecked(),true);
  await page.locator('#screenWeatherProvider').selectOption('openmeteo');assert.equal(await page.locator('#screenWeatherKey').isVisible(),false);assert.equal(await page.locator('#screenWeatherHost').isVisible(),false);
  await page.locator('#screenWeatherVerifyTls').uncheck();await page.locator('#screenWeatherLat').fill('23.1291');await page.locator('#screenWeatherLon').fill('113.2644');await page.locator('#screenWeatherPlace').fill('Guangzhou, Guangdong');
  await page.locator('#screenTab_services').click();await page.locator('#screenWeather [data-i18n="common.save"]').click();await page.waitForTimeout(150);const free=writes.find(w=>w.action==='screen.weather.set'&&w.params.provider==='openmeteo').params;assert.equal('key' in free,false);assert.equal('host' in free,false);assert.equal(free.clear_key,true);assert.equal(free.latitude,23.1291);assert.equal(free.verify_tls,false);assert.equal(await page.locator('#screenWeatherVerifyTls').isChecked(),false);
  await page.locator('#screenReminderKind').selectOption('2');await page.locator('#screenReminderTitle').fill('通风提醒');await page.locator('#screenReminderText').fill('开窗 15 分钟');await page.locator('#screenReminders [data-i18n="common.save"]').click();await page.waitForTimeout(150);assert.equal(writes.find(w=>w.action==='screen.reminders.set').params.days,31);
  // Exercise actual browser-side JPEG compression, chunk upload and receipts.
  await page.locator('#screenPushTitle').fill('相机推送');await page.locator('#screenPushText').fill('门口有人\n请查看');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,640,480);x.fillStyle='blue';x.fillRect(320,0,320,480);return c.toDataURL().split(',')[1];});
  await page.locator('#screenPushFile').setInputFiles({name:'camera.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.locator('#screenPushSend').click();await page.waitForFunction(()=>document.querySelector('#screenPushState').textContent.match(/Displayed|已显示/));
  let pushed=writes.filter(w=>w.action==='screen.push.send').at(-1).params;assert.equal(pushed.wake,true);assert.equal(pushed.duration_ms,10000);assert.equal(pushed.mode,'timed');assert.equal(pushed.image_id,pushed.id);assert(mediaMeta.total<=131072);
  await page.locator('#screenPushDismiss').click();await page.waitForFunction(()=>document.querySelector('#screenPushState').textContent.match(/Dismissed|已撤回|已关闭/));
  await page.locator('#screenPushFile').setInputFiles([]);await page.locator('#screenPushWake').uncheck();await page.locator('#screenExternalPush select').first().selectOption('confirm');await page.locator('#screenPushSend').click();await page.waitForFunction(()=>document.querySelector('#screenPushState').textContent.match(/Displayed|已显示/));
  pushed=writes.filter(w=>w.action==='screen.push.send').at(-1).params;assert.equal(pushed.mode,'confirm');assert.equal(pushed.wake,false);assert.equal(pushed.image_id,0);
  await page.locator('#screenPushView').selectOption('0');await page.locator('#screenPushShow').click();await page.waitForTimeout(250);assert.equal(writes.filter(w=>w.action==='screen.push.select').at(-1).params.index,0);
  await page.locator('#screenCameraLoad').click();await page.waitForFunction(()=>document.querySelector('#screenCameraUrl').value==='http://camera/mjpeg');assert.equal(await page.locator('#screenCameraPassword').inputValue(),'');
  await page.locator('#screenCameraUrl').fill('http://camera/mjpeg?w={width}&h={height}&fps={fps}');await page.locator('#screenCameraSave').click();await page.waitForFunction(()=>!document.querySelector('#screenCameraSave').disabled);assert(!('password' in writes.filter(w=>w.action==='screen.stream.set').at(-1).params));
  await page.locator('#screenCameraPassword').fill('test-only');await page.locator('#screenCameraSave').click();await page.waitForFunction(()=>document.querySelector('#screenCameraPassword').value==='');assert.equal(writes.filter(w=>w.action==='screen.stream.set').at(-1).params.password,'test-only');
  await page.locator('#screenCameraStop').click();await page.waitForFunction(()=>!document.querySelector('#screenCameraStop').disabled);assert.equal(streamConfig.enabled,false);
  await page.locator('#screenCameraStart').click();await page.waitForFunction(()=>!document.querySelector('#screenCameraStart').disabled);assert.equal(streamConfig.enabled,true);
  const oldPages=scene[8];await page.locator('#screenCameraAddPage').click();await page.waitForSelector('[data-component-field="image_fit"]');await page.locator('[data-component-field="image_fit"]').selectOption('1');
  await page.locator('#screenSave').click();await page.waitForFunction(()=>document.querySelector('#screenDraft').textContent.match(/^Saved|^已保存/));assert.equal(scene[8],oldPages+1);assert.equal(scene.length,9520);
  const cameraScene=path.join(previewOut,`camera-${width}-${lang}.bin`);fs.writeFileSync(cameraScene,scene);cp.execFileSync(process.env.SCREEN_SCENE_CODEC,[cameraScene]);await page.locator('#screenGrid').screenshot({path:path.join(previewOut,`camera-${width}-${lang}.png`)});
  await page.locator('#screenTab_advanced').click();await page.locator('#screenLinkLoad').click();await page.waitForFunction(()=>!document.querySelector('#screenLinkLoad').disabled);await page.locator('#screenLinkMode').selectOption('auto');await page.locator('#screenLinkMaximum').selectOption('460800');await page.locator('#screenLinkApply').check();await page.locator('#screenLinkSave').click();await page.waitForFunction(()=>!document.querySelector('#screenLinkSave').disabled);assert.equal(linkConfig.mode,'auto');assert.equal(linkConfig.max_rate,460800);assert.equal(linkConfig.apply_now,true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  const out=process.env.SCREEN_BROWSER_ARTIFACTS||'build';fs.mkdirSync(out,{recursive:true});await page.locator('#screenEditor').screenshot({path:path.join(out,`screen-editor-${width}-${lang}.png`)});
  await page.close();console.log(`PASS Chromium ${width} ${lang}: actual minified page, MessagePack HTTP, SCN3 commit, pointer move/resize/undo, persisted browser drafts, sleep plans, weekly reminders, private key, compressed push, camera page, baud controls and no overflow`);
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
