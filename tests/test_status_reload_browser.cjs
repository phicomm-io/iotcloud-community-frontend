// The released native TC1 page, real MessagePack/session/HTTP queue and browser
// navigation. Only the device responses are gated; no DUT or remote host is used.
const {chromium,webkit}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const html=require('node:child_process').execFileSync('python3',['common/web/page.py','TC1/http_server/web/index.html','--minify']);
const engine=process.env.BROWSER||'chromium';
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

(async()=>{
 const {encodeWire,decodeWire}=await import('../frontend/src/wireCodec.js');
 const browser=await ({chromium,webkit}[engine]).launch({headless:true,...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],calls=[],gates=[];
 const identity={device_id:'aabbccddeeff',model:'tc1',firmware_version:'test-rc4',variant:'full'};
 const caps={...identity,business_status:true,status_views:['full','live'],actions:['status.get','capabilities.get','config.get','schedules.get','buttons.get','outlet.set']};
 const state={...identity,version:'test-rc4',name:'initial',socket_names:['1','2','3','4','5','6'],socket_states:[false,false,false,false,false,false],
  report_seconds:30,powerCoefficientX100:100,time_synced:true,uptime_seconds:100};
 let active=0,maxActive=0;
 page.on('pageerror',error=>errors.push(error.message));
 const hold=action=>{const gate={action,started:deferred(),release:deferred()};gates.push(gate);return gate;};
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());assert.equal(url.origin,'http://status-reload.test');
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
  let data={},action=url.pathname;
  if(url.pathname==='/api/v1/info')data={...identity,api_version:1,wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack',password_set:false};
  else if(url.pathname==='/api/v1/auth/login')data={token:'0'.repeat(32)};
  else if(url.pathname==='/api/v1/command'){
   const command=decodeWire(request.postDataBuffer(),'msgpack');action=command.action;
   assert(action.endsWith('.get'),'Navigation must not write');
   data=action==='capabilities.get'?caps:action==='status.get'?{...state}:action==='config.get'?{migration_state:'ready'}:
    ['buttons.get','schedules.get'].includes(action)?{items:[],capacity:0}:{};
  }else return route.fulfill({status:404,body:''});
  calls.push({action,code:'ok'});maxActive=Math.max(maxActive,++active);
  try{
   const gate=gates.find(item=>!item.used&&item.action===action);
   if(gate){gate.used=true;gate.started.resolve();await gate.release.promise;}
   await route.fulfill({contentType:'application/msgpack',body:Buffer.from(encodeWire({code:'ok',data},'msgpack'))});
  }finally{active--;}
 });
 try{
  await page.goto('http://status-reload.test/');await page.waitForFunction(()=>UI?.state?.name==='initial');
  await page.evaluate(()=>{
   document.querySelector('#deviceName').value='unsaved draft';
   const reload=UI.reload;window.__reloads=[];
   UI.reload=(...args)=>{
    const record={settled:false};__reloads.push(record);const pending=reload(...args);
    pending.then(data=>Object.assign(record,{settled:true,ok:!!data,name:data?.name}));return pending;
   };
  });
  const navigate=route=>page.evaluate(route=>{history.replaceState(null,'','#settings/'+route);UI.showRoute();return __reloads.length-1;},route);
  const before=calls.length,start=hold('config.get'),catchup=hold('config.get');
  await navigate('schedule');await start.started.promise;
  await navigate('buttons');start.release.resolve();await catchup.started.promise;
  state.name='latest';const last=await navigate('device');catchup.release.resolve();
  await page.waitForFunction(index=>__reloads[index]?.settled,last);
  const result=await page.evaluate(index=>({reload:__reloads[index],state:UI.state.name,route:location.hash,
   draft:document.querySelector('#deviceName').value,visible:[...document.querySelectorAll('[data-settings-page]')].filter(el=>!el.hidden).map(el=>el.dataset.settingsPage),
   errors:[...document.querySelectorAll('.page-load-error')].map(el=>el.textContent)}),last);
  assert.equal(result.reload.ok,true,'the final tab must await the latest generation, not the superseded catch-up');
  assert.equal(result.reload.name,'latest');assert.equal(result.state,'latest');assert.equal(result.route,'#settings/device');
  assert.equal(result.draft,'unsaved draft');assert.deepEqual(result.visible,['device']);assert.deepEqual(result.errors,[]);
  const reads=calls.slice(before);assert.equal(reads.filter(call=>call.action==='status.get').length,3);
  assert.equal(reads.some(call=>['buttons.get','schedules.get'].includes(call.action)),false,'superseded tabs must not issue page reads');
  assert.equal(maxActive,1);assert.deepEqual(errors,[]);
  const out=path.resolve('build/evidence/status-reload');fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,engine+'.json'),JSON.stringify({engine,version:browser.version(),result,reads,maxActive,errors},null,2)+'\n');
  console.log(`${engine}: minified TC1 + MessagePack, three generations, final status, cancelled old pages, serial reads and draft retention PASS`);
 }finally{for(const gate of gates)gate.release.resolve();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
