import {test,expect} from '@playwright/test';
import packet from 'mqtt-packet';
import {encodeWire,decodeWire} from '../src/wireCodec.js';

test('G3 detail reads live MQTT publications when status receipts are empty, and samples still expire',async({page})=>{
 test.setTimeout(60000);
 const mac='aabbccddee15',root=`phicomm/v2/u_74657374/daikin/${mac}`,errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(mac=>{
  const host='ws://'+location.host+'/mqtt';
  localStorage.setItem('tmcp_broker',JSON.stringify({host,username:'test',password:'test'}));
  localStorage.setItem('iotcloud.devices.'+encodeURIComponent(host)+'/test',JSON.stringify([{model:'daikin',mac,version:'v2',wire_format:'msgpack',wire_version:1,firmware_version:'fixture',variant:'full'}]));
 },mac);
 await page.route('**/api/**',route=>route.fulfill({contentType:'application/json',body:'{}'}));
 const snapshot=pm25=>({device_id:mac,model:'daikin',version:'fixture',firmware_variant:'full',hardware_model:'BRY88BBA15G',wifi_connected:true,
  sensors:Object.fromEntries([['pm25',pm25],['co2',463],['temperature',27.4],['humidity',52],['tvoc',0]].map(([key,value])=>[key,{valid:true,received:true,value,age_ms:125}]))});
 let publish;
 await page.routeWebSocket(/\/mqtt$/,socket=>{
  const parser=packet.parser(),send=value=>socket.send(packet.generate(value));
  publish=(leaf,data,retain=false)=>send({cmd:'publish',qos:0,retain,topic:root+'/'+leaf,payload:typeof data==='string'?data:Buffer.from(encodeWire(data,'msgpack'))});
  socket.onMessage(message=>parser.parse(Buffer.from(message)));
  parser.on('packet',p=>{
   if(p.cmd==='connect')send({cmd:'connack',returnCode:0,sessionPresent:false});
   if(p.cmd==='pingreq')send({cmd:'pingresp'});
   if(p.cmd==='subscribe'){
    send({cmd:'suback',messageId:p.messageId,granted:p.subscriptions.map(()=>1)});
    if(p.subscriptions.some(s=>s.topic===root+'/#')){publish('availability','online',true);publish('state',snapshot(999),true);}
   }
   if(p.cmd!=='publish')return;
   if(p.qos===1)send({cmd:'puback',messageId:p.messageId});
   const request=decodeWire(p.payload);
   expect(request.action).toMatch(/\.get$/);
   const data=request.action==='capabilities.get'?{device_id:mac,model:'daikin',firmware_version:'fixture',variant:'full',hardware_model:'BRY88BBA15G',actions:['status.get','capabilities.get','binding.status.get']}
    :request.action==='binding.status.get'?{peers:[],max_sessions:4}:{};
   publish('result',{request_id:request.request_id,code:'ok',data});
  });
 });
 await page.goto('/#/guest');
 await expect(page.locator('.device-heading')).toContainText('DAIKIN G3',{timeout:30000});
 const home=page.frameLocator('iframe.device-home'),pm=home.locator('[data-sensor="pm25"] .num');
 await expect(pm).toHaveText('—');
 const refresh=()=>page.locator('.device-heading button').last().click();
 publish('state',snapshot(0));await refresh();
 await expect(pm).toHaveText('0',{timeout:10000});
 await expect(home.locator('[data-sensor="co2"] .num')).toHaveText('463');
 await expect(home.locator('[data-sensor="tvoc"] .num')).toHaveText('0');
 publish('state',snapshot(5));await refresh();await expect(pm).toHaveText('5',{timeout:10000});
 // Inventory resubscriptions replay retained data, and successful empty polls
 // continue throughout this wait. Neither may reset the sample's receipt time.
 await expect(pm).toHaveText('—',{timeout:25000});
 publish('state',{...snapshot(0),sensors:{...snapshot(0).sensors,co2:{valid:false,received:true,value:null,age_ms:21000}}});
 await refresh();await expect(pm).toHaveText('0',{timeout:10000});
 await expect(home.locator('[data-sensor="co2"] .num')).toHaveText('—');
 publish('availability','offline');await refresh();await expect(pm).toHaveText('—',{timeout:10000});
 expect(errors).toEqual([]);
});
