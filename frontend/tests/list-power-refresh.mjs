// Built cloud UI + a local MQTT fixture. No physical device writes.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import packet from 'mqtt-packet';
import {chromium,expect} from '@playwright/test';
const root=resolve('dist'),calls=[],ids=new Set();let watts=12,drop=false;
const devices=['aabbccddeeff','112233445566'];
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
const ws=new WebSocketServer({server});
ws.on('connection',socket=>{const parser=packet.parser();const send=p=>socket.send(packet.generate(p));socket.on('message',b=>parser.parse(b));parser.on('packet',p=>{
 if(p.cmd==='connect')send({cmd:'connack',returnCode:0,sessionPresent:false});
 if(p.cmd==='pingreq')send({cmd:'pingresp'});
 if(p.cmd==='subscribe')send({cmd:'suback',messageId:p.messageId,granted:p.subscriptions.map(()=>1)});
 if(p.cmd!=='publish')return;if(p.qos===1)send({cmd:'puback',messageId:p.messageId});
 const data=JSON.parse(p.payload.toString());calls.push(data);assert(data.action.endsWith('.get'),'fixture must receive reads only');
 if(data.action==='power.get'){assert(!ids.has(data.request_id));ids.add(data.request_id);if(drop)return;}
 const mac=p.topic.split('/').at(-2),result=data.action==='power.get'?{power_watts:watts,energy_kwh:1}:data.action==='status.get'?{device_id:mac,socket_states:[true,false,false,false,false,false]}:data.action==='capabilities.get'?{actions:['status.get','power.get']}:{};
 send({cmd:'publish',qos:0,topic:p.topic.replace(/\/command$/,'/result'),payload:JSON.stringify({code:'ok',request_id:data.request_id,data:result})});
 });});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port,broker=origin.replace('http','ws')+'/mqtt';
const browser=await chromium.launch();
try{
 const context=await browser.newContext({locale:'zh-CN',serviceWorkers:'block'});
 await context.addInitScript(({broker,devices})=>{localStorage.setItem('phicomm.language','zh-CN');localStorage.setItem('tmcp_broker',JSON.stringify({host:broker,username:'test',password:'test'}));localStorage.setItem('iotcloud.devices.'+encodeURIComponent(broker)+'/test',JSON.stringify(devices.map(mac=>({mac,model:'tc1',version:'v2',wire_format:'json',wire_version:1,firmware_version:'fixture'}))));},{broker,devices});
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/#/guest');
 await expect(p.locator('.device-select')).toHaveCount(2);
 await expect(p.locator('.device-select').nth(1)).toContainText('12.0');
 // The second strip stays unselected throughout the continuity check.
 const start=calls.filter(c=>c.action==='power.get').length;
 for(const value of [23,0,45,67]){watts=value;await expect(p.locator('.device-select').nth(1)).toContainText(value.toFixed(1),{timeout:8000});}
 assert(calls.filter(c=>c.action==='power.get').length-start>=6);
 drop=true;await expect(p.locator('.device-select').nth(1).locator('.stat')).toContainText('—',{timeout:20000});
 drop=false;watts=89;await expect(p.locator('.device-select').nth(1)).toContainText('89.0',{timeout:10000});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({unselected_meter_continuity:'PASS',zero_watts:'PASS',expiry_and_recovery:'PASS',unique_meter_requests:ids.size,page_errors:errors}));await context.close();
}finally{await browser.close();for(const client of ws.clients)client.terminate();ws.close();server.close();}
