import {test,expect} from '@playwright/test';
const mac='aabbccddeeff',address='http://192.168.1.17';
async function setup(page,mode='auto'){
 await page.addInitScript(({mac,address,mode})=>{
  const broker='ws://'+location.host+'/mqtt';
  localStorage.setItem('iotcloud.devices.'+encodeURIComponent(broker)+'/',JSON.stringify([{model:'a1',mac,version:'v2'}]));
  const scope=location.origin+':guest:'+broker+':';
  localStorage.setItem('phicomm.device-connection.'+encodeURIComponent(scope)+':'+mac,JSON.stringify({mode,address}));
 },{mac,address,mode});
}
test('LAN controls and complete settings work with MQTT disconnected, upload goes to device',async({page})=>{
 const errors=[],commands=[],uploads=[];page.on('pageerror',e=>errors.push(e.message));
 await setup(page);
 const state={device_id:mac,model:'a1',version:'1.0.0',name:'LAN A1',fan_on:false,percentage:0,speed:0,brightness:50,red:0,green:0,blue:0,applied_speed:0,fan_ready:true,fan_mode:'manual',socket_states:[],mqtt_host:'broker',mqtt_port:1883,mqtt_user:'u',ssid:'wifi',wifi_connected:true,mqtt_connected:false,ip:'192.168.1.17'};
 const actions=['status.get','config.get','config.set','fan.set','light.set','schedules.get','schedules.put','schedules.delete','schedules.enable','buttons.get','binding.get','binding.status.get','binding.set','night.get','night.set','light_effect.get','ota.sources.get'];
 await page.route(address+'/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/v1/auth/login'){await route.fulfill({status:404,contentType:'application/json',body:'{}'});return;}
  if(path==='/api/v1/ota/upload'){uploads.push(route.request().url());await route.fulfill({status:202,body:'{"code":"accepted"}'});return;}
  let data=state;
  if(path==='/api/v1/info')data={device_id:mac,model:'a1',api_version:1};
  if(path==='/api/v1/command'){
   const request=route.request().postDataJSON();commands.push(request);
   if(request.action==='capabilities.get')data={actions};
   else if(request.action==='ota.sources.get')data={sources:[]};
   else if(request.action==='fan.set'){state.fan_on=request.params.on??!state.fan_on;data={};}
   else if(request.action==='status.get')data=state;
   else data={items:[],rules:[],enabled:false,sources:[]};
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:'ok',data})});
 });
 await page.goto('/#/guest');
 await expect(page.locator('.device-heading')).toContainText('内网已连接');
 await expect(page.locator('.console-nav')).toContainText('MQTT 未连接');
 const home=page.frameLocator('iframe');await expect(home.locator('#power')).toBeEnabled();await home.locator('#power').click();
 await expect.poll(()=>commands.filter(x=>x.action==='fan.set').length).toBe(1);
 await home.getByRole('link',{name:'设置',exact:true}).click();await expect(home.locator('#settingsPage')).toBeVisible();
 await home.locator('.side a[href="#settings/mqtt"]').click();await expect(home.locator('#mqttHost')).toBeVisible();
 await home.locator('.side a[href="#settings/firmware"]').click();
 await home.locator('#firmware').setInputFiles({name:'firmware.ota.bin.signed',mimeType:'application/octet-stream',buffer:Buffer.from('fixture')});
 await home.locator('#fileForm button[type=submit]').click();await expect.poll(()=>uploads.length).toBe(1);
 expect(uploads[0]).toBe(address+'/api/v1/ota/upload');expect(errors).toEqual([]);
});
test('always MQTT never probes a saved local address',async({page})=>{
 await setup(page,'mqtt');let probes=0;await page.route(address+'/**',async route=>{probes++;await route.abort();});
 await page.goto('/#/guest');await expect(page.locator('.device-select')).toBeVisible();await page.waitForTimeout(1000);expect(probes).toBe(0);
});
