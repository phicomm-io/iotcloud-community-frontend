// Built cloud UI + a local MQTT fixture. No physical device writes.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import packet from 'mqtt-packet';
import {chromium,webkit,expect} from '@playwright/test';
import {encodeWire,decodeWire} from '../src/wireCodec.js';
const root=resolve('dist'),calls=[],ids=new Set();let watts=12,pm25=39,drop=false,fields=7;
const devices=['aabbccddeeff','112233445566','223344556677','334455667788'];
const models=['tc1','tc1','s30-v1b','m1'];
const meter=()=>({valid:fields===7,valid_fields:fields,active_power:watts,voltage:230.4,current:.054});
const pulse=setInterval(()=>{if(drop)return;for(const socket of ws.clients)if(socket.readyState===1)socket.send(packet.generate({cmd:'publish',qos:0,topic:'phicomm/v2/u_74657374/m1/'+devices[3]+'/state',payload:Buffer.from(encodeWire({code:'ok',data:{sensor_valid:true,age_ms:100,pm25}},'msgpack'))}));},1000);
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
const ws=new WebSocketServer({server});
ws.on('connection',socket=>{const parser=packet.parser();const send=p=>socket.send(packet.generate(p));socket.on('message',b=>parser.parse(b));parser.on('packet',p=>{
 if(p.cmd==='connect')send({cmd:'connack',returnCode:0,sessionPresent:false});
 if(p.cmd==='pingreq')send({cmd:'pingresp'});
 if(p.cmd==='subscribe')send({cmd:'suback',messageId:p.messageId,granted:p.subscriptions.map(()=>1)});
 if(p.cmd!=='publish')return;if(p.qos===1)send({cmd:'puback',messageId:p.messageId});
 const data=decodeWire(p.payload);calls.push(data);assert(data.action.endsWith('.get'),'fixture must receive reads only');
 if(data.action==='power.get'){assert(!ids.has(data.request_id));ids.add(data.request_id);if(drop)return;}
 const mac=p.topic.split('/').at(-2),model=models[devices.indexOf(mac)],result=data.action==='power.get'?{power_watts:watts,energy_kwh:1,...(model==='s30-v1b'?{on:true,metering:meter()}:{})}:data.action==='status.get'?{device_id:mac,socket_states:[true,false,false,false,false,false]}:data.action==='capabilities.get'?{actions:['status.get','power.get']}:{};
 send({cmd:'publish',qos:0,topic:p.topic.replace(/\/command$/,'/result'),payload:Buffer.from(encodeWire({code:'ok',request_id:data.request_id,data:result},['s30-v1b','m1'].includes(model)?'msgpack':'json'))});
 });});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port,broker=origin.replace('http','ws')+'/mqtt';
const browser=await (process.env.BROWSER==='webkit'?webkit:chromium).launch();
try{
 const context=await browser.newContext({locale:'zh-CN',serviceWorkers:'block'});
 await context.addInitScript(({broker,devices,models})=>{localStorage.setItem('phicomm.language','zh-CN');localStorage.setItem('tmcp_broker',JSON.stringify({host:broker,username:'test',password:'test'}));localStorage.setItem('iotcloud.devices.'+encodeURIComponent(broker)+'/test',JSON.stringify(devices.map((mac,i)=>({mac,model:models[i],version:'v2',wire_format:i>1?'msgpack':'json',wire_version:1,firmware_version:'fixture',variant:'full'}))));},{broker,devices,models});
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/#/guest');
 await expect(p.locator('.device-select')).toHaveCount(4);
 await expect(p.locator('.device-select').nth(1)).toContainText('12.0');
 // The second strip stays unselected throughout the continuity check.
 const start=calls.filter(c=>c.action==='power.get').length;
 for(const value of [23,0,45,67]){watts=value;pm25=value;await expect(p.locator('.device-select').nth(1)).toContainText(value.toFixed(1),{timeout:8000});await expect(p.locator('.device-select').nth(2).locator('.stat')).toContainText(value.toFixed(1));await expect(p.locator('.device-select').nth(3).locator('.stat')).toContainText(String(pm25));await expect(p.locator('.device-select').nth(3)).not.toContainText('等待数据');}
 assert(calls.filter(c=>c.action==='power.get').length-start>=6);
 fields=1;await expect(p.locator('.device-select').nth(2).locator('.stat')).toContainText('—',{timeout:8000});await expect(p.locator('.device-select').nth(2)).toContainText('230.4 V');await expect(p.locator('.device-select').nth(2)).toContainText('— A');
 drop=true;await expect(p.locator('.device-select').nth(1).locator('.stat')).toContainText('—',{timeout:20000});
 await expect(p.locator('.device-select').nth(2).locator('.stat')).toContainText('—');await expect(p.locator('.device-select').nth(2)).toContainText('— V');await expect(p.locator('.device-select').nth(3)).toContainText('等待数据',{timeout:5000});
 drop=false;fields=7;watts=89;pm25=19;await expect(p.locator('.device-select').nth(1)).toContainText('89.0',{timeout:10000});
 await expect(p.locator('.device-select').nth(2).locator('.stat')).toContainText('89.0',{timeout:10000});await expect(p.locator('.device-select').nth(3).locator('.stat')).toContainText('19');await p.setViewportSize({width:390,height:844});await expect(p.locator('.device-select').nth(2)).toContainText('230.4 V');assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({unselected_tc1_s30_m1_continuity:'PASS',binary_business_envelopes:'PASS',per_field_validity:'PASS',mobile:'PASS',zero_watts:'PASS',expiry_and_recovery:'PASS',unique_meter_requests:ids.size,page_errors:errors}));await context.close();
}finally{clearInterval(pulse);await browser.close();for(const client of ws.clients)client.terminate();ws.close();server.close();}
