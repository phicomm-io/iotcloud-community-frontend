(()=>{
'use strict';
const $=id=>document.getElementById(id), model='__MODEL__', {t}=I18N;
I18N.apply();$('language').value=I18N.preference;$('language').onchange=()=>I18N.set($('language').value);
document.title=t('setup.title',{m:model});I18N.onChange(()=>{document.title=t('setup.title',{m:model});if(initialized)refresh().catch(()=>{});});
let caps={};
let initialized=false,saving=false,stopped=false,ticket=null,received=false,importedOriginal=null;
const message=(text,kind='info')=>{$('message').textContent=text;$('message').className='banner '+kind;};
$('protocolField').hidden=model!=='TC1';
try{$('theme').value=localStorage.getItem('phicomm.appearance')||'system';}catch{}
$('theme').onchange=()=>{const theme=$('theme').value;if(theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;try{localStorage.setItem('phicomm.appearance',theme);}catch{}};
async function refresh(){
 const s=await command('status.get');
 $('status').textContent=t('setup.status',{wifi:t(s.wifi_connected?'setup.connected':s.ap_active?'setup.hotspot':'setup.disconnected'),ssid:s.ssid||'—',ip:s.ip||'—',mqtt:t(s.mqtt_connected?'setup.connected':'setup.disconnected')})+(s.wifi_trial_status?' · '+s.wifi_trial_status:'');
 if(!initialized){caps=await command('capabilities.get');const config=await command('config.get');$('recovery').hidden=!caps.config_recovery;$('setup').hidden=!!caps.config_recovery;$('deviceLanguageRow').hidden=!caps.device_language;$('deviceLanguage').value=config.language||'zh-CN';$('host').value=s.mqtt_host||'';$('port').value=s.mqtt_port||1883;$('user').value=s.mqtt_user||'';$('ssid').value=s.ssid||'';$('protocol').value=s.mqtt_protocol||'tmcp';initialized=true;if(ticket)$('accept').disabled=false;message(t('setup.85fb2e4e23'));}
 return s;
}
$('clearConfig').onclick=async()=>{if(!confirm(t('recovery.confirm')))return;try{await command('system.reset',{full:true});message(t('setup.resetting'));}catch(e){message(e.message,'warn');}};
$('refresh').onclick=()=>refresh().catch(e=>message(e.message,'warn'));
$('scan').onclick=async()=>{
 $('scan').disabled=true;
 try{await command('wifi.scan');for(let i=0;i<25;i++){await new Promise(r=>setTimeout(r,700));if(stopped)return;const r=await command('wifi.scan.get');if(r.scanning)continue;$('networks').replaceChildren(...(r.networks||[]).sort((a,b)=>b.rssi-a.rssi).map(n=>{const o=document.createElement('option');o.value=n.ssid;o.label=n.rssi+' dBm'+(n.security===0?t('setup.f803459a02'):'');return o;}));message(t('setup.9b8e58bc4b'));return;}throw Error(t('setup.21e341916d'));}catch(e){message(e.message,'warn');}finally{$('scan').disabled=false;}
};
$('setup').onsubmit=async e=>{
 e.preventDefault();if(saving)return;if(!initialized){message(t('setup.10bfe8eea2'),'warn');return;}
 const admin=$('adminPassword').value,bytes=s=>new TextEncoder().encode(s).length;
 if(admin&&!/^[\x20-\x7e]{8,32}$/.test(admin)){message(t('setup.5a5f5ab562'),'warn');return;}
 if(bytes($('ssid').value)>32||bytes($('user').value)>63||bytes($('mqttPassword').value)>256||bytes($('wifiPassword').value)>63){message(t('setup.3a2a307ad0'),'warn');return;}
 const wifi={ssid:$('ssid').value};
 if($('openNetwork').checked)wifi.password='';else if($('wifiPassword').value)wifi.password=$('wifiPassword').value;
 if(wifi.password&&new TextEncoder().encode(wifi.password).length<8){message(t('setup.064a97c4bf'),'warn');return;}
 const mqtt={host:$('host').value.trim(),port:Number($('port').value),user:$('user').value};
 if($('clearMqtt').checked)mqtt.password='';else if($('mqttPassword').value)mqtt.password=$('mqttPassword').value;
 if(model==='TC1')mqtt.protocol=$('protocol').value;
 saving=true;$('save').disabled=true;let wifiStarted=false;
 try{
  if(caps.device_language)await command('config.set',{section:'device',values:{language:$('deviceLanguage').value}});
  message(t('setup.ae49332c8b'));await command('config.set',{section:'mqtt',values:mqtt});$('mqttPassword').value='';received=false;importedOriginal=null;
  if($('adminPassword').value){message(t('setup.5ea9986202'));const password=$('adminPassword').value;await command('config.set',{section:'auth',values:{password}});setPassword(password);$('adminPassword').value='';}
  message(t('setup.340b70ed88'));wifiStarted=true;await command('config.set',{section:'wifi',values:wifi});$('wifiPassword').value='';message(t('setup.673c7d6bfe'));
 }catch(e){message(wifiStarted?t('setup.6bf4396e1e'):e.message,'warn');}
 finally{saving=false;$('save').disabled=false;}
};
// Changing Basic credentials must also update subsequent same-page requests.
const originalFetch=window.fetch.bind(window);let authorization='';
function setPassword(password){authorization='Basic '+btoa(String.fromCharCode(...new TextEncoder().encode('admin:'+password)));}
window.fetch=(url,options={})=>originalFetch(url,{...options,headers:{...options.headers,...(authorization?{Authorization:authorization}:{})}});
try{ticket=IotProvision.readTicket(location.hash);if(ticket){history.replaceState(null,'',location.pathname+location.search);if(!window.opener)throw Error(t('setup.fbc2acb09e'));$('import').hidden=false;$('accept').disabled=!initialized;setTimeout(()=>{if(importedOriginal){for(const [id,value] of Object.entries(importedOriginal))$(id).value=value;$('mqttPassword').value='';}ticket=null;received=false;$('accept').disabled=true;},Math.max(0,ticket.expires-Date.now()));}}
catch{ticket=null;message(t('setup.b8f77a99a1'),'warn');}
$('accept').onclick=()=>{if(!ticket||Date.now()>=ticket.expires){message(t('setup.4d3a340da9'),'warn');return;}$('accept').disabled=true;window.opener.postMessage({type:'iotcloud.provision.ready',id:ticket.id},ticket.origin);};
window.addEventListener('message',event=>{
 if(!ticket||received||!$('accept').disabled||!IotProvision.packet(event,{source:window.opener,...ticket},'iotcloud.provision.config'))return;
 try{const d=event.data;if(Object.keys(d).sort().join(',')!=='id,password,type')throw Error();const c=IotProvision.config({v:1,host:ticket.host,port:ticket.port,user:ticket.user,password:d.password,protocol:'tmcp',expires:ticket.expires});importedOriginal={host:$('host').value,port:$('port').value,user:$('user').value,protocol:$('protocol').value};$('host').value=c.host;$('port').value=c.port;$('user').value=c.user;$('mqttPassword').value=c.password;$('clearMqtt').checked=c.password==='';$('protocol').value='tmcp';received=true;event.source.postMessage({type:'iotcloud.provision.received',id:ticket.id},ticket.origin);message(t('setup.d53e51f858'));}catch{message(t('setup.344bb96da6'),'warn');}
});
window.addEventListener('pagehide',()=>{stopped=true;$('mqttPassword').value='';});
(async function poll(){try{if(!saving)await refresh();}catch(e){if(!saving)message(t('setup.31afde9ba7'),'warn');}if(!stopped)setTimeout(poll,3000);})();
})();
