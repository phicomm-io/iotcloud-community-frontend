// Run against the released, minified native page, with HTTP fully intercepted.
// TC1 firmware writes str_mac using %02X; discovery canonicalizes it to lowercase.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async browser=>{
 const {encodeWire,decodeWire}=await import('../frontend/src/wireCodec.js');
 const html=fs.readFileSync(path.resolve('build/bundle/devices/tc1/index.html'));
 for(const deviceId of ['D0BAE4636D3D','d0bae4636d3d','D0:BA:E4:63:6D:3D']){
  const page=await browser.newPage({viewport:{width:1280,height:720}}),calls=[];
  const identity={device_id:deviceId,model:'tc1',firmware_version:'test-rc4',variant:'full'};
  const caps={...identity,actions:['status.get','capabilities.get','config.get','schedules.get','buttons.get','buttons.set','outlet.set'],status_views:['full'],config_backup:1};
  const state={...identity,version:'test-rc4',name:'TC1',socket_names:['1','2','3','4','5','6'],socket_states:[false,false,false,false,false,false],sensors:{},uptime_seconds:100,time_synced:true,report_seconds:30,powerCoefficientX100:100};
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   assert.equal(url.origin,'http://tc1-identity.test');
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
   let data={},action=url.pathname;
   if(url.pathname==='/api/v1/info')data={...identity,api_version:1,version:'test-rc4',wire_version:1,wire_formats:['msgpack'],default_wire_format:'msgpack',password_set:false};
   else if(url.pathname==='/api/v1/auth/login')data={token:'0'.repeat(32)};
   else if(url.pathname==='/api/v1/command'){
    action=decodeWire(request.postDataBuffer(),'msgpack').action;
    assert(action.endsWith('.get'),'Navigation must not send a write');
    data=action==='capabilities.get'?caps:['status.get','config.get'].includes(action)?state:action==='power.get'?{power_watts:0,energy_kwh:0}:['schedules.get','buttons.get'].includes(action)?{items:[],capacity:0}:{};
   }else return route.fulfill({status:404,body:''});
   calls.push(action);return route.fulfill({contentType:'application/msgpack',body:Buffer.from(encodeWire({code:'ok',data},'msgpack'))});
  });
  try{
   await page.goto('http://tc1-identity.test/');await page.waitForFunction(()=>UI?.state?.socket_names);
   assert(calls.includes('status.get'),'Initial status must not be silently blocked');
   assert.equal(await page.evaluate(()=>!!UI.identityChanged||document.querySelector('#homePage').inert),false);
   await page.locator('.tabs a[data-tab="settings"]').click();
   for(const route of ['schedule','buttons','network']){
    const link=page.locator(`.side a[href="#settings/${route}"]`);
    await link.click();
    assert.equal(await page.evaluate(()=>location.hash),'#settings/'+route);
    assert.equal(await page.locator('#settingsPage').evaluate(el=>el.inert),false);
   }
   // A genuinely different device still freezes old controls and prevents writes.
   const sent=calls.length;
   const guard=await page.evaluate(async()=>{
    const draft=document.querySelector('#deviceName');draft.value='unsaved TC1';
    UI.invalidateIdentity({...DeviceSession.wire.identity,device_id:'aabbccddeeff'});
    let error;try{await command('outlet.set',{index:0,on:true});}catch(e){error=e.code;}
    return {changed:UI.identityChanged,inert:document.querySelector('#settingsPage').inert,draft:draft.value,error};
   });
   assert.deepEqual(guard,{changed:true,inert:true,draft:'unsaved TC1',error:'identity_changed'});
   assert.equal(calls.length,sent,'Identity change must reject before any wire write');
  }finally{await page.close();}
 }
 console.log('TC1 canonical identity: uppercase/lowercase/separators navigate; different ID preserves draft and blocks writes');
};
