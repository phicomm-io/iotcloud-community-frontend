(()=>{
'use strict';
const $=id=>document.getElementById(id), model='__MODEL__';
let initialized=false,saving=false,stopped=false,ticket=null,received=false,importedOriginal=null;
const message=(text,kind='info')=>{$('message').textContent=text;$('message').className='banner '+kind;};
$('protocolField').hidden=model!=='TC1';
try{$('theme').value=localStorage.getItem('phicomm.appearance')||'system';}catch{}
$('theme').onchange=()=>{const theme=$('theme').value;if(theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;try{localStorage.setItem('phicomm.appearance',theme);}catch{}};
async function refresh(){
 const s=await command('status.get');
 $('status').textContent=`Wi-Fi：${s.wifi_connected?'已连接':s.ap_active?'设备热点已开启':'未连接'} · ${s.ssid||'—'} · ${s.ip||'—'}；MQTT：${s.mqtt_connected?'已连接':'未连接'}${s.wifi_trial_status?'；Wi-Fi 试连：'+s.wifi_trial_status:''}`;
 if(!initialized){$('host').value=s.mqtt_host||'';$('port').value=s.mqtt_port||1883;$('user').value=s.mqtt_user||'';$('ssid').value=s.ssid||'';$('protocol').value=s.mqtt_protocol||'tmcp';initialized=true;if(ticket)$('accept').disabled=false;message('请确认连接配置后保存。');}
 return s;
}
$('refresh').onclick=()=>refresh().catch(e=>message(e.message,'warn'));
$('scan').onclick=async()=>{
 $('scan').disabled=true;
 try{await command('wifi.scan');for(let i=0;i<25;i++){await new Promise(r=>setTimeout(r,700));if(stopped)return;const r=await command('wifi.scan.get');if(r.scanning)continue;$('networks').replaceChildren(...(r.networks||[]).sort((a,b)=>b.rssi-a.rssi).map(n=>{const o=document.createElement('option');o.value=n.ssid;o.label=n.rssi+' dBm'+(n.security===0?' · 开放':'');return o;}));message('扫描完成，可从网络名称列表选择或手动输入。');return;}throw Error('扫描超时，请重试或手动输入。');}catch(e){message(e.message,'warn');}finally{$('scan').disabled=false;}
};
$('setup').onsubmit=async e=>{
 e.preventDefault();if(saving)return;if(!initialized){message('请先连接设备并读取状态。','warn');return;}
 const admin=$('adminPassword').value,bytes=s=>new TextEncoder().encode(s).length;
 if(admin&&!/^[\x20-\x7e]{8,32}$/.test(admin)){message('网页密码需要 8 至 32 位可打印 ASCII 字符。','warn');return;}
 if(bytes($('ssid').value)>32||bytes($('user').value)>63||bytes($('mqttPassword').value)>256||bytes($('wifiPassword').value)>63){message('配置内容过长，请检查网络名称和密码。','warn');return;}
 const wifi={ssid:$('ssid').value};
 if($('openNetwork').checked)wifi.password='';else if($('wifiPassword').value)wifi.password=$('wifiPassword').value;
 if(wifi.password&&new TextEncoder().encode(wifi.password).length<8){message('Wi-Fi 密码至少需要 8 字节。','warn');return;}
 const mqtt={host:$('host').value.trim(),port:Number($('port').value),user:$('user').value};
 if($('clearMqtt').checked)mqtt.password='';else if($('mqttPassword').value)mqtt.password=$('mqttPassword').value;
 if(model==='TC1')mqtt.protocol=$('protocol').value;
 saving=true;$('save').disabled=true;let wifiStarted=false;
 try{
  message('正在保存 MQTT 配置…');await command('config.set',{section:'mqtt',values:mqtt});$('mqttPassword').value='';received=false;importedOriginal=null;
  if($('adminPassword').value){message('正在保存网页管理密码…');const password=$('adminPassword').value;await command('config.set',{section:'auth',values:{password}});setPassword(password);$('adminPassword').value='';}
  message('MQTT 配置已保存，正在试连 Wi-Fi…');wifiStarted=true;await command('config.set',{section:'wifi',values:wifi});$('wifiPassword').value='';message('配置已保存，Wi-Fi 正在试连。热点断开后请切回内网，再用设备地址确认 Wi-Fi 和 MQTT 实际连接状态。');
 }catch(e){message(wifiStarted?'MQTT 配置已保存，Wi-Fi 试连结果尚未确认。请重新连接设备查看状态；试连失败会恢复原 Wi-Fi。':e.message,'warn');}
 finally{saving=false;$('save').disabled=false;}
};
// Changing Basic credentials must also update subsequent same-page requests.
const originalFetch=window.fetch.bind(window);let authorization='';
function setPassword(password){authorization='Basic '+btoa(String.fromCharCode(...new TextEncoder().encode('admin:'+password)));}
window.fetch=(url,options={})=>originalFetch(url,{...options,headers:{...options.headers,...(authorization?{Authorization:authorization}:{})}});
try{ticket=IotProvision.readTicket(location.hash);if(ticket){history.replaceState(null,'',location.pathname+location.search);if(!window.opener)throw Error('请从管理平台重新打开配置');$('import').hidden=false;$('accept').disabled=!initialized;setTimeout(()=>{if(importedOriginal){for(const [id,value] of Object.entries(importedOriginal))$(id).value=value;$('mqttPassword').value='';}ticket=null;received=false;$('accept').disabled=true;},Math.max(0,ticket.expires-Date.now()));}}
catch{ticket=null;message('平台配置链接已失效，请手动填写或从平台重新打开。','warn');}
$('accept').onclick=()=>{if(!ticket||Date.now()>=ticket.expires){message('配置链接已过期。','warn');return;}$('accept').disabled=true;window.opener.postMessage({type:'iotcloud.provision.ready',id:ticket.id},ticket.origin);};
window.addEventListener('message',event=>{
 if(!ticket||received||!$('accept').disabled||!IotProvision.packet(event,{source:window.opener,...ticket},'iotcloud.provision.config'))return;
 try{const d=event.data;if(Object.keys(d).sort().join(',')!=='id,password,type')throw Error();const c=IotProvision.config({v:1,host:ticket.host,port:ticket.port,user:ticket.user,password:d.password,protocol:'tmcp',expires:ticket.expires});importedOriginal={host:$('host').value,port:$('port').value,user:$('user').value,protocol:$('protocol').value};$('host').value=c.host;$('port').value=c.port;$('user').value=c.user;$('mqttPassword').value=c.password;$('clearMqtt').checked=c.password==='';$('protocol').value='tmcp';received=true;event.source.postMessage({type:'iotcloud.provision.received',id:ticket.id},ticket.origin);message('平台配置已填入，点击保存并连接后生效。');}catch{message('平台配置无效，请手动填写。','warn');}
});
window.addEventListener('pagehide',()=>{stopped=true;$('mqttPassword').value='';});
(async function poll(){try{if(!saving)await refresh();}catch(e){if(!saving)message('暂时无法读取设备状态，请确认连接后刷新。','warn');}if(!stopped)setTimeout(poll,3000);})();
})();
