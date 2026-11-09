const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const html=cp.execFileSync('python3',['common/web/page.py','DAIKIN/web/index.html','--minify']);
const codec=import('../frontend/src/wireCodec.js');
const initial=cp.execFileSync(process.env.SCREEN_SCENE_CODEC,['default']);
let scene=Buffer.from(initial),upload,meta,writes=[],weatherConfig,display,brightnessRequest,brightnessPending,policy,moduleState,calibration;
const brightness=()=>({supported:true,available:true,requested_percent:display.luminance,ceiling_percent:10,applied_percent:Math.min(10,display.luminance),asleep:false,age_ms:0});
function crc(data){let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
const status=()=>({model:'daikin',hardware_model:'BRY88BBA15G',device_id:'aabbccddeeff',name:'Room air',version:'dev-dirty',wifi_connected:true,sensors:{co2:{valid:true,value:641,age_ms:0}},screen:{extension_supported:true,capabilities:1533,module:moduleState,calibration,settings:{display},settings_request:brightnessRequest,brightness:brightness(),layout_revision:scene.readUInt32LE(4),mcu_layout_revision:scene.readUInt32LE(4),storage:'owned',ota:{state:'empty',installable:false,gate:'bootloader_unverified'}}});
const actions=['status.get','config.get','capabilities.get','binding.status.get','screen.settings.get','screen.settings.set','screen.display.get','screen.display.set','screen.layout.get','screen.layout.begin','screen.layout.chunk','screen.layout.commit','screen.reminders.get','screen.reminders.set','screen.reminders.configure','screen.reminders.push','screen.weather.get','screen.weather.set','screen.module.get','screen.module.set','screen.calibration.get','screen.calibration.start','screen.calibration.cancel'];
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
 else if(action==='screen.reminders.get')data={timezone:480,wake:0,rules:[],notices:[]};
 else if(action==='screen.calibration.get')data=calibration;
 else if(action==='screen.calibration.start'){assert.equal(params.environment_confirmed,true);calibration.pending=params.channel==='co2'?1:2;calibration[params.channel].state='sampling';data={token:'cal-test',state:'pending'};}
 else if(action==='screen.calibration.cancel'){calibration.pending=0;calibration.co2.state='cancelled';data={token:'cal-cancel',state:'pending'};}
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
  calibration={version:1,supported:true,available:true,pending:0,co2:{ready:true,state:'idle',samples:0},tvoc:{ready:false,state:'warming',warmup_seconds:120},request:{state:'idle'}};scene=Buffer.from(initial);writes=[];moduleState={supported:true,available:true,initialized:true,set_high:true,remaining_ms:0,valid_frames:50,request:0,state:'idle'};policy={supported:true,revision:1,applied_revision:1,ceiling:40,external_minutes:2,battery_minutes:1,idle_brightness:0,idle_page:255,plans:[]};display={luminance:60,data_type:1,power_screen_time:2,battery_screen_time:1};brightnessRequest={token:'',code:-1,state:'idle'};brightnessPending=null;weatherConfig={enabled:true,provider:'openweather',key_set:true,latitude:31.2,longitude:121.4,label:'Shanghai',interval:900};const errors=[],page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/#settings/screen');await page.waitForFunction(()=>document.querySelector('#screenEditor')?.hidden===false,null,{timeout:10000}).catch(async e=>{console.error({errors,writes,debug:await page.evaluate(()=>({text:document.body.textContent.slice(-1800),state:UI.state,caps:UI.caps}))});throw e;});
  await page.evaluate(lang=>{I18N.set(lang);document.querySelectorAll('#screenEditor details').forEach(d=>d.open=true);},lang);
  await page.locator('#screenTab_services').click();
  await page.locator('#screenCalibration').evaluate(el=>el.open=true);
  assert(await page.locator('#screenCalibrationStart').isDisabled());
  await page.locator('#screenCalibrationConfirmed').check();
  await page.locator('#screenCalibrationStart').click();await page.locator('dialog .ghost').click();
  assert.equal(writes.filter(w=>w.action==='screen.calibration.start').length,0);
  await page.locator('#screenCalibrationStart').click();await page.locator('dialog .primary').click();
  await page.waitForFunction(()=>document.querySelector('#screenCalibrationState').textContent.match(/Sampling|采样中/));
  assert.deepEqual(writes.filter(w=>w.action==='screen.calibration.start').map(w=>w.params),[{channel:'co2',environment_confirmed:true}]);
  assert.equal(await page.locator('#screenCalibrationConfirmed').isChecked(),false);
  await page.locator('#screenCalibrationCancel').click();
  await page.waitForFunction(()=>document.querySelector('#screenCalibrationState').textContent.match(/cancelled|已取消/));
  await page.locator('#screenCalibrationChannel').selectOption('tvoc');await page.locator('#screenCalibrationConfirmed').check();
  assert(await page.locator('#screenCalibrationStart').isDisabled());
  assert.match(await page.locator('#screenCalibrationHelp').textContent(),/manufacturer|厂家/);
  calibration.co2.state='command_sent';await page.evaluate(()=>UI.reload());
  assert.match(await page.locator('#screenCalibrationState').textContent(),/unconfirmed|尚无/);
  calibration.co2.state='acknowledged';await page.evaluate(()=>UI.reload());
  assert.match(await page.locator('#screenCalibrationState').textContent(),/acknowledged|已应答/);
  assert.equal(writes.filter(w=>w.action==='screen.calibration.start').length,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  fs.mkdirSync('build',{recursive:true});await page.locator('#screenCalibration').screenshot({path:`build/g3-calibration-${width}-${lang}.png`});
  await page.close();console.log(`PASS G3 calibration ${width} ${lang}: conditions, cancel, single write, warm-up, command and ACK states`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
