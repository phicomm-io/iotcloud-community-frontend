<script setup>
import {t} from './i18n.js';

import {ref,reactive,computed,onMounted,onBeforeUnmount,watch} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import mqtt from 'mqtt';
import {account,api,restoreAccount} from './account';
import {server,scopeKey} from './serverConfig';
import {track} from './analytics';
import {autoConnect,setAutoConnect,rememberLogin,savedPassword,forgetLogin} from './connectionPreferences';
import {userKey,requestId,deviceKey,deviceEntry,localDevices,topics,applyMessage,statusSnapshot,command} from './deviceProtocol';
import {createDeviceTransport,loadPreference,savePreference,localAddress} from './deviceConnection';
import {deviceType} from './devicePresentation';
import {saveDeviceName} from './deviceName';
import DeviceSummary from './components/DeviceSummary.vue';
import DeviceNameDialog from './components/DeviceNameDialog.vue';
import DevicePicker from './components/DevicePicker.vue';
import AppIcon from './components/AppIcon.vue';
import DeviceHome from './components/DeviceHome.vue';
import {co2SourceCandidates} from './sensorSources.js';
import {applyTypedSensorFeed,displaySourceCandidates,typedSensorTopic} from './sensorFeed.js';
import PlatformSettings from './components/PlatformSettings.vue';
import ThemeToggle from './components/ThemeToggle.vue';
import LocalConnect from './components/LocalConnect.vue';
import {localScope,localListKey,localPasswords,savedLocalDevices} from './localConnection';
import InstallApp from './components/InstallApp.vue';

const iconURL=import.meta.env.BASE_URL+'icons/iotcloud.svg';
const demoMode=import.meta.env.VITE_DEMO === '1';
const demoDevices=demoMode?Object.fromEntries(['tc1','m1','a1','daikin'].map(m=>[m,window.PhicommDemo.create(m)])):null;
const route=useRoute(),router=useRouter();
const localMode=route.name==='Local';
const installApp=ref(null),listReady=ref(false);
const home=ref(null),devicePicker=ref(null),nameDialog=ref(null),aliases=ref({});
function displayName(d){const name=aliases.value[deviceKey(d)]||states[deviceKey(d)]?.name||d.name;if(name)return name;const peers=list.value.filter(x=>x.model===d.model);return deviceType(d)+(peers.length>1?' '+(peers.findIndex(x=>deviceKey(x)===deviceKey(d))+1):'');}
function renameDevice(d,name,done){
 if(d.version==='v1'){
  if(name)aliases.value[deviceKey(d)]=name;else delete aliases.value[deviceKey(d)];
  localStorage.setItem('phicomm.names.'+scopeKey()+':'+(account.username||'guest'),JSON.stringify(aliases.value));done();return;
 }
 saveDeviceName(deviceCommand,d,name,reply=>{if(!['ok','accepted'].includes(reply.code)){done(reply.message||t('p.6309a3bb5ba4'));return;}const state=states[deviceKey(d)]||={};if(name)state.name=name;else{delete state.name;sendTo(d,'status.get');}done();});
}
const settingsSection=ref(route.query.github==='linked'?'account':'connection');
function openSettings(section='connection'){settingsSection.value=section;page.value='settings';window.scrollTo({top:0});}
const deviceBroker=reactive({host:'',port:'',hub:false});
const page=ref(route.query.github==='linked'?'settings':'home'),thirdParty=ref(localMode||route.name==='Guest'),list=ref([]),selected=ref(''),states=reactive({}),connected=ref(false),error=ref(''),notice=ref(''),busy=ref(false),now=ref(Date.now());
const connection=reactive({host:`${location.protocol==='https:'?'wss':'ws'}://${location.host}/mqtt`,username:'',password:''});
const mqttDeviceHost=computed(()=>{try{return new URL(connection.host).hostname;}catch{return '';}});
const differentMqttHost=computed(()=>mqttDeviceHost.value && mqttDeviceHost.value!==location.hostname);
const hintDismissed=ref('');
const hintKey=computed(()=> 'iotcloud.device-host-hint.'+scopeKey()+':'+mqttDeviceHost.value);
const showDeviceHint=computed(()=>{if(!differentMqttHost.value||page.value!=='home'||demoMode)return false;try{return hintDismissed.value!==hintKey.value&&localStorage.getItem(hintKey.value)!=='1';}catch{return hintDismissed.value!==hintKey.value;}});
function dismissDeviceHint(){hintDismissed.value=hintKey.value;try{localStorage.setItem(hintKey.value,'1');}catch{}}
const addForm=reactive({mac:'',model:'tc1',version:'v2'});
const lanConnections=reactive({}),lanStates=reactive({}),devicePreferences=reactive({});
const sensorFeeds=reactive({});
const webPasswords=new Map();let preferenceScope='';
const transport=createDeviceTransport({records:lanConnections,onStatus:(key,state)=>{const snapshot=statusSnapshot(state);if(snapshot)lanStates[key]={...snapshot,available:true,lan_connected:true};}});
const viewStates=computed(()=>Object.fromEntries(list.value.map(d=>{const k=deviceKey(d);return [k,lanConnections[k]?.ready?{...states[k],...lanStates[k]}:states[k]||{}];})));
const activeConnected=computed(()=>!!active.value&&(connected.value||lanConnections[deviceKey(active.value)]?.ready));
function updateConnections(force=false){
 const scope=localMode?localScope():scopeKey()+':'+connectionOwner();
 if(scope!==preferenceScope){if(preferenceScope)for(const k of Object.keys(states))delete states[k];transport.retain([]);webPasswords.clear();for(const k of Object.keys(lanStates))delete lanStates[k];for(const k of Object.keys(devicePreferences))delete devicePreferences[k];preferenceScope=scope;}
 transport.retain(list.value.map(deviceKey));
 for(const d of list.value){
  const key=deviceKey(d);let p=devicePreferences[key]||loadPreference(scope,key);
  try{const address=localAddress(states[key]?.ip||'');if(address&&address!==p.lastAddress)p=savePreference(scope,key,{...p,lastAddress:address});}catch{}
  devicePreferences[key]=p;transport.configure(key,d,p,webPasswords.get(key)||(localMode?localPasswords.get(key):'')||'');
  if(!demoMode&&d.version==='v2')transport.probe(key,force);
 }
}
function saveConnection(d,values,done){
 try{const key=deviceKey(d);devicePreferences[key]=savePreference(preferenceScope,key,{...devicePreferences[key],...values});webPasswords.set(key,values.password);transport.configure(key,d,devicePreferences[key],values.password);transport.probe(key,true);done();}catch(e){done(e.message);}
}
async function deviceResource(path,options,done){
 const target=active.value;if(!target){done({error:t('backup.device_changed')});return;}
 try{done(await transport.resource(deviceKey(target),path,options));}catch(error){done({error:error.message});}
}
function uploadDevice(file,rescue,progress,done,registerAbort,conversion){const target=active.value;if(!target){done({status:0,text:t('p.fdbefb8e29e6')});return;}const upload=transport.upload(deviceKey(target),file,rescue,progress,undefined,conversion);registerAbort(upload.abort);upload.promise.then(done);}
async function deviceCommand(request,reply,target=active.value,options={}){
 if(demoMode){return mqttCommand(request,reply,target,options);}
 if(!target){reply({code:'offline',message:t('p.4d62b8d69d9d')});return;}
 const captured={...target},key=deviceKey(captured),scope=preferenceScope;
 const data={...request,request_id:request.request_id||requestId()};
 const result=await transport.dispatch(key,data,()=>new Promise(resolve=>mqttCommand(data,resolve,captured,options)));
 if(scope!==preferenceScope)return reply({code:'offline',message:t('p.f807ec3022b9')});
 if(['ok','accepted'].includes(result.code)&&data.action==='config.set'&&data.params?.section==='auth'){
  const password=data.params.values?.password;
  if(typeof password==='string'){webPasswords.set(key,password);transport.configure(key,captured,devicePreferences[key],password);transport.probe(key);}
 }
 reply(result);
}
const active=computed(()=>{const d=list.value.find(x=>deviceKey(x)===selected.value);return d?{...viewStates.value[deviceKey(d)],...d}:null;});
const localHubURL=computed(()=>{
 if(!localMode||active.value?.model!=='daikin')return '';
 const lan=lanConnections[deviceKey(active.value)];
 if(!lan?.ready||lan.info?.model!=='daikin'||lan.info?.firmware_variant!=='hub')return '';
 try{return localAddress(lan.address)+'/iotcloud/#/';}catch{return '';}
});
const sensorSources=computed(()=>co2SourceCandidates(list.value,viewStates.value,active.value,connection.username,now.value));
// A live feed can arrive between the one-second UI ticks. Use the current
// receipt clock too, so a new sample is never compared with the previous tick.
const displaySources=computed(()=>displaySourceCandidates(list.value,viewStates.value,sensorFeeds,active.value,connection.username,Math.max(now.value,Date.now())));

watch(page,value=>track('pageview',thirdParty.value?(value==='settings'?'/guest/settings':'/guest'):(value==='settings'?'/settings':'/')));
watch(()=>active.value?deviceKey(active.value):'',value=>{if(value)track('device_view',thirdParty.value?'/guest':'/',active.value.model);});
let client,timer,poll,lanPoll;
function visibilityProbe(){if(!document.hidden)updateConnections(true);}
const replies=new Map();
async function mqttCommand(request,reply,target=active.value,{timeoutMs=20000}={}){
 // A newly mounted device page can request data before MQTT finishes connecting.
 // Wait only for reads; never queue a device write for a later connection.
 if(!connected.value&&busy.value&&request.action.endsWith('.get')){
  await new Promise(resolve=>{
   const finish=()=>{clearTimeout(timer);stop();resolve();};
   const stop=watch([connected,busy],([ready,connecting])=>{if(ready||!connecting)finish();});
   const timer=setTimeout(finish,5000);
  });
 }

 if(demoMode&&target){const data=demoDevices[target.model].command(request.action,request.params);Object.assign(states[deviceKey(target)]||={},demoDevices[target.model].state);reply({code:request.action.endsWith('.get')?'ok':'accepted',data});return;}
 if(!connected.value||!target){reply({code:'offline',message:t('p.2779217ebc7d')});return;}
 if(target.version==='v1'){legacyRequest(request,reply,target);return;}
 const signature=JSON.stringify([deviceKey(target),request.action,request.params||{}]);
 if(request.action.endsWith('.get')){const existing=[...replies.values()].find(p=>p.signature===signature);if(existing){const previous=existing.reply;existing.reply=value=>{previous(value);reply(value);};return;}}
 const id=request.request_id||requestId(),d={...target};
 const state=states[deviceKey(d)]||={};(state.pending||={})[id]=request.action;
 const timeout=setTimeout(()=>{const pending=replies.get(id);replies.delete(id);delete state.pending[id];pending?.reply({code:'timeout',message:t('p.f9ce625a07fc')});},timeoutMs);
 replies.set(id,{reply,timeout,key:deviceKey(d),signature});
 const c=command(d,{...request,request_id:id});
 client.publish(c.topic,c.payload,{qos:1,retain:false},e=>{if(e){clearTimeout(timeout);const pending=replies.get(id);replies.delete(id);delete state.pending[id];pending?.reply({code:'error',message:t('p.ac77953a1e06')});}});
}
const guestKey=()=>localMode?localListKey:'iotcloud.devices.'+encodeURIComponent(connection.host)+'/'+encodeURIComponent(connection.username);
const guestStorage={getItem:key=>key==='phicomm_devices'?localStorage.getItem(guestKey()):null};
watch(()=>[connection.host,connection.username],()=>{if(thirdParty.value){disconnect();for(const key of Object.keys(states))delete states[key];refresh();}});
const connectionOwner=()=>thirdParty.value?'guest:'+connection.host+':'+connection.username:account.username;
function manualDisconnect(){setAutoConnect(connectionOwner(),false);disconnect();}
function manualConnect(){setAutoConnect(connectionOwner(),true);connect();}
function disconnect(){busy.value=false;for(const {reply,timeout} of replies.values()){clearTimeout(timeout);reply({code:'offline',message:t('p.d830845257a1')});}replies.clear();for(const key of Object.keys(sensorFeeds))delete sensorFeeds[key];client?.end(true);client=null;connected.value=false;}
function subscribe(){if(demoMode)return;if(thirdParty.value)client?.subscribe(`phicomm/v2/${connection.username?userKey(connection.username):'local'}/discovery/+`,{qos:1});if(list.value.some(d=>d.model==='m1'&&d.version==='v2'))client?.subscribe(typedSensorTopic(connection.username),{qos:0});for(const d of list.value.filter(d=>!d.status||d.status==='active'))client?.subscribe(topics(d),{qos:1},(e,g)=>{if(e||g?.some(x=>x.qos===128))error.value=t('p.d5aa311ed18a');});}
async function refresh(){try{list.value=(localMode?savedLocalDevices():thirdParty.value?localDevices(guestStorage).map(d=>({...d,username:connection.username})):await api('/devices')).map(deviceEntry);if(!list.value.some(d=>deviceKey(d)===selected.value))selected.value=list.value[0]?deviceKey(list.value[0]):'';if(connected.value)subscribe();listReady.value=true;updateConnections();}catch(e){error.value=e.message;}}
function connect(){if(demoMode){connected.value=true;busy.value=false;for(const d of list.value)Object.assign(states[deviceKey(d)]||={},demoDevices[d.model].state);return;}if(!thirdParty.value&&connection.password)rememberLogin(account.username,connection.password);disconnect();error.value='';if(location.protocol==='https:'&&!connection.host.startsWith('wss://')){error.value=t('p.22211d965247');return;}if(!/^wss?:\/\//.test(connection.host)){error.value=t('p.5da207244bf4');return;}busy.value=true;
 client=mqtt.connect(connection.host,{username:connection.username,password:connection.password,clientId:'web_'+requestId(),connectTimeout:5000,reconnectPeriod:3000,clean:true});
 client.on('connect',()=>{connected.value=true;busy.value=false;subscribe();track('mqtt_connect',thirdParty.value?'/guest':'/');});
 client.on('close',()=>{connected.value=false;busy.value=false;});client.on('error',()=>{error.value=t('p.cc9962611a5b');busy.value=false;});
 client.on('message',(topic,payload,packet)=>{if(applyTypedSensorFeed(sensorFeeds,topic,payload.toString(),{username:connection.username,retained:packet?.retain===true,deviceIds:list.value.filter(d=>d.version==='v2').map(d=>d.mac)}))return;if(thirdParty.value && topic.startsWith(`phicomm/v2/${connection.username?userKey(connection.username):'local'}/discovery/`)){try{const a=JSON.parse(payload.toString());if(a.protocol!=='tmcp'||a.protocol_version!==2||a.version!=='v2')return;const d=deviceEntry({mac:topic.split('/')[4],model:a.model,version:'v2',username:connection.username});if(!list.value.some(x=>deviceKey(x)===deviceKey(d))){list.value.push(d);updateConnections();localStorage.setItem(guestKey(),JSON.stringify(list.value));if(!selected.value)selected.value=deviceKey(d);subscribe();sendTo(d,'status.get');}}catch{}return;}for(const d of list.value){const s=states[deviceKey(d)] ||= {};if(applyMessage(d,s,topic,payload.toString())){if(s.ip)updateConnections();if(topic.endsWith('/result')){const pending=replies.get(s.result?.request_id);if(pending&&pending.key===deviceKey(d)){clearTimeout(pending.timeout);replies.delete(s.result.request_id);pending.reply(s.result);}delete s.pending?.[s.result?.request_id];}break;}}});
 if(thirdParty.value)localStorage.setItem('tmcp_broker',JSON.stringify({host:connection.host,username:connection.username}));
}
function legacyRequest({action,params={}},reply,d){
 const ok=data=>reply({code:'ok',data});
 const fail=message=>reply({code:'unsupported',message});
 if(action==='capabilities.get'){ok({actions:['outlet.set','child_lock.set','indicator.set']});return;}
 if(action==='status.get'){
  if(!Array.from({length:6},(_,i)=>d[`plug_${i}`]).every(p=>p?.on!==undefined)){fail(t('p.cf487f63716d'));return;}
  ok({name:d.name||'TC1',socket_states:Array.from({length:6},(_,i)=>!!d[`plug_${i}`]?.on),socket_names:Array.from({length:6},(_,i)=>d[`plug_${i}`]?.setting?.name||t('p.b8e4960b36a2',{v0:(i+1)})),child_lock:!!(d.child_lock?.on??d.child_lock),led_enabled:!!(d.led_lock?.on??d.led_lock),mqtt_connected:true,mqtt_host:connection.host});return;
 }
 if(action==='power.get'){
  if(d.power_watts===undefined&&d.power===undefined){fail(t('p.24fb06fbc210'));return;}
  ok({power_watts:d.power_watts??Number(d.power),energy_kwh:d.energy_kwh??Number(d.powerConsumption)});return;
 }
 let values;
 if(action==='outlet.set'){
  const indexes=params.index===undefined?[0,1,2,3,4,5]:[params.index];
  if(indexes.some(i=>!Number.isInteger(i)||i<0||i>5)){fail(t('p.4638fe11ee01'));return;}
  values=Object.fromEntries(indexes.map(i=>[`plug_${i}`,{on:params.on?1:0}]));
 }else if(action==='child_lock.set')values={child_lock:{on:params.enabled?1:0}};
 else if(action==='indicator.set')values={led_lock:{on:params.enabled?1:0}};
 else if(action==='config.set'&&params.section==='socket'&&!d.legacyText)values={[`plug_${params.values.index}`]:{setting:{name:params.values.name}}};
 else {fail(t('p.4fb191a59f15'));return;}
 try{
  // Text protocol accepts one outlet per publication.
  for(const [key,value] of Object.entries(values)){
   const c=command(d,{[key]:value});client.publish(c.topic,c.payload,{qos:1,retain:false},e=>{if(e)error.value=t('p.ac77953a1e06');});
  }
  reply({code:'accepted',data:{}});
 }catch(e){fail(e.message);}
}
function sendTo(d,action,params={}){deviceCommand({action,params},r=>{if(!['ok','accepted'].includes(r.code))error.value=r.message||r.code;},d);}
async function localConnected(d){await refresh();selected.value=deviceKey(d);updateConnections(true);page.value='home';}
async function changeMode(){if(localMode){connection.host='';await refresh();return;}transport.retain([]);for(const k of Object.keys(lanStates))delete lanStates[k];for(const k of Object.keys(states))delete states[k];Object.assign(deviceBroker,{host:'',port:'',hub:false});disconnect();notice.value='';error.value='';if(thirdParty.value){Object.assign(connection,{host:`${location.protocol==='https:'?'wss':'ws'}://${location.host}/mqtt`,username:'',password:''},JSON.parse(localStorage.getItem('tmcp_broker')||'{}'));}else{const s=await api('/register/status');try{const u=new URL(s.mqtt_uri.includes('://')?s.mqtt_uri:'mqtt://'+s.mqtt_uri);if(u.protocol==='mqtt:'&&u.hostname&&!u.username&&!u.password)Object.assign(deviceBroker,{host:u.hostname,port:Number(u.port||1883),hub:s.hub===true&&u.hostname===location.hostname&&Number(u.port||1883)===1883});}catch{}Object.assign(connection,{host:server.mqttWS||s.mqtt_ws_uri||`${location.protocol==='https:'?'wss':'ws'}://${location.host}/mqtt`,username:account.mqttUsername||account.username,password:account.password||savedPassword(account.username)});}await refresh();if(demoMode||(autoConnect(connectionOwner())&&connection.password))connect();}
async function add(){try{const d=deviceEntry({...addForm,version:addForm.model==='tc1'?addForm.version:'v2',...(thirdParty.value?{username:connection.username}:{})});if(thirdParty.value){if(list.value.some(x=>x.mac===d.mac))throw Error(t('p.bf5557c8f16a'));localStorage.setItem(guestKey(),JSON.stringify([...list.value,d]));}else await api('/devices',{method:'POST',body:JSON.stringify(d)});await refresh();addForm.mac='';}catch(e){error.value=e.message;}}
async function remove(d){if(!confirm(t('p.4c8411974d35',{v0:(d.mac)})))return;try{client?.unsubscribe(topics(d));if(thirdParty.value)localStorage.setItem(guestKey(),JSON.stringify(list.value.filter(x=>deviceKey(x)!==deviceKey(d))));else await api(`/devices/${d.namespace?'scoped/':''}${d.mac}${d.namespace?'?mqtt_username='+encodeURIComponent(d.mqtt_username||d.username):''}`,{method:'DELETE'});await refresh();}catch(e){error.value=e.message;}}
async function logout(){try{await api('/auth/logout',{method:'POST',body:'{}'});}catch(e){error.value=e.message;}account.username=null;account.mqttUsername=null;account.isAdmin=false;account.aliases=[];account.githubLogin='';account.password='';forgetLogin();disconnect();await router.replace('/login');}
async function changeMQTTPassword(values){try{await api('/auth/mqtt-password',{method:'POST',body:JSON.stringify({current_password:values.current,password:values.password})});account.password=values.password;rememberLogin(account.username,values.password);if(!thirdParty.value){connection.password=values.password;connect();}notice.value=t('p.14c896de34db');}catch(e){error.value=e.message;}}
async function changePassword(values){try{await api('/auth/password',{method:'POST',body:JSON.stringify({current_password:values.current,password:values.password})});await logout();}catch(e){error.value=e.message;}}
onMounted(async()=>{if(!localMode&&route.name!=='Guest')await restoreAccount();try{aliases.value=JSON.parse(localStorage.getItem('phicomm.names.'+scopeKey()+':'+(account.username||'guest'))||'{}');}catch{}await changeMode();if(route.query.github==='linked')notice.value=t('p.034b28c46590');else if(route.query.github==='login'&&!connection.password)notice.value=t('p.dfcf6ba14455');timer=setInterval(()=>now.value=Date.now(),1000);lanPoll=setInterval(()=>{if(!document.hidden)updateConnections();},30000);document.addEventListener('visibilitychange',visibilityProbe);poll=setInterval(()=>{if(!thirdParty.value&&!document.hidden)refresh();},5000);});
onBeforeUnmount(()=>{disconnect();clearInterval(timer);clearInterval(poll);clearInterval(lanPoll);transport.stop();webPasswords.clear();document.removeEventListener('visibilitychange',visibilityProbe);});
</script>
<template>
<main class="console-page">
<header class="console-topbar topbar"><div class="brand"><span class="kind">{{localMode?t('p.4ba8ad7e3075'):t('p.c3fdeb90d7eb')}}</span><h1><img :src="iconURL" width="30" height="30" alt="" style="vertical-align:middle;margin-right:8px">IotCloud</h1></div><nav class="console-nav"><span v-if="!localMode" class="status-pill" :class="{online:connected}">{{connected?t('p.91a6918c1b13'):t('p.c3ba111be9cb')}}</span><RouterLink v-if="!localMode&&account.isAdmin" class="btn console-admin" to="/admin">{{t('p.1ffea8d7039e')}}</RouterLink><ThemeToggle/><button v-if="!localMode&&account.username" @click="logout">{{t('p.498e1d59b4d7')}}</button><RouterLink v-else-if="!localMode" to="/login">{{t('p.1e2df9c3075a')}}</RouterLink></nav></header>
<nav class="platform-tabs tabs" :aria-label="t('p.9bae68040509')"><button :aria-current="page==='home'?'page':undefined" @click="page='home'">{{t('p.203c08e0d44a')}}</button><button :aria-current="page==='settings'?'page':undefined" @click="openSettings()">{{t('p.df3d58c7d84b')}}</button></nav>
<div v-if="showDeviceHint" role="status" class="feedback device-host-hint"><details><summary>{{t('p.390bf998195f')}}<strong>{{mqttDeviceHost}}</strong></summary><p>{{t('p.af0f3d5d3468')}}</p></details><button type="button" @click="dismissDeviceHint">{{t('p.348f1cf1243e')}}</button></div>
<p v-if="error" role="alert" class="feedback error">{{error}}</p><p v-if="notice" role="status" class="feedback">{{notice}}</p>
<LocalConnect v-if="localMode" @connected="localConnected"/>
<section v-if="localHubURL" class="card local-hub-entry" aria-labelledby="local-hub-title"><h2 id="local-hub-title">{{t('hub.manage')}}</h2><p class="help">{{t('hub.localHelp')}}</p><a class="btn primary" :href="localHubURL" target="_blank" rel="noopener noreferrer">{{t('hub.manage')}}</a></section>
<template v-if="page==='home'">
<div class="dashboard-grid"><aside class="surface devices-panel"><h2>{{t('p.e1506406a5bd')}}</h2><button class="add-device-entry" type="button" @click="openSettings('devices')"><AppIcon name="plus" :size="17"/>{{t('p.3aea0927d015')}}</button><ul class="device-list"><li v-for="d in list" :key="deviceKey(d)" class="device-list-item"><button class="device-select" :aria-pressed="selected===deviceKey(d)" @click="selected=deviceKey(d)"><DeviceSummary :device="d" :state="viewStates[deviceKey(d)]||{}" :name="displayName(d)" :connected="connected" :now="now"/></button><button class="device-rename btn ghost icon" :aria-label="t('p.0237e5999393',{v0:(displayName(d))})" @click="nameDialog.open(d,displayName(d))"><AppIcon name="edit" :size="15"/></button></li></ul><button @click="refresh">{{t('p.e28be7098db1')}}</button><p v-if="!list.length" class="helper-text">{{t('p.c31cc68bb6bb')}}</p></aside>
<div v-if="active" class="device-area"><div class="mobile-device-heading">
<button class="device-picker-trigger" type="button" aria-haspopup="dialog" :aria-label="t('p.e7819c97f607',{v0:(displayName(active))})" @click="devicePicker.open()"><span class="current-device"><b :title="displayName(active)">{{displayName(active)}}</b><small>{{!activeConnected?t('p.5e8b7d10afc5'):active.lan_connected?t('p.a2d6d3fd2463'):active.available===false?t('p.be1b4f3c6c1c'):active.available===true?t('p.b9086662b1df'):t('p.21a94004577c')}}</small></span><span class="switch-device-label">{{t('p.28465d512f3a')}}<AppIcon name="arrow" :size="16"/></span></button>
<button class="device-refresh" type="button" :aria-label="t('p.f51eeae36b84')" :disabled="!activeConnected" @click="home?.refresh()"><AppIcon name="refresh"/></button>
</div><div class="device-heading"><div><h2>{{displayName(active)}}</h2><p class="help">{{deviceType(active)}}</p></div><span class="badge" :class="active.available===true&&activeConnected?'ok':''">{{!activeConnected?t('p.5e8b7d10afc5'):active.lan_connected?t('p.a2d6d3fd2463'):active.available===false?t('p.be1b4f3c6c1c'):active.available===true?t('p.b9086662b1df'):t('p.21a94004577c')}}</span><button :disabled="!activeConnected" @click="home?.refresh()">{{t('p.802a407c7743')}}</button></div>
<DeviceHome ref="home" :key="selected" :device="active" :sensor-sources="sensorSources" :display-sources="displaySources" @command="deviceCommand" @upload="uploadDevice" @resource="deviceResource" @settings="openSettings()"/>
</div><section v-else class="surface empty-control"><h2>{{t('p.7549828062bc')}}</h2><p>{{localMode?t('p.48e36ea6f1e3'):t('p.17784e8330b1')}}</p><button @click="openSettings('devices')">{{t('p.3aea0927d015')}}</button></section></div>
<DevicePicker ref="devicePicker" :devices="list" :selected="selected" :states="viewStates" :device-name="displayName" :connected="connected" :now="now" @select="selected=$event" @refresh="refresh" @add="openSettings('devices')"/>
</template>
<template v-else>
<PlatformSettings :local-mode="localMode" :device-preferences="devicePreferences" :lan-connections="lanConnections" @device-connection="saveConnection" :initial-section="settingsSection" :device-broker="deviceBroker" :connection="connection" :connected="connected" :busy="busy" :third-party="thirdParty" :devices="list" :states="viewStates" :add-form="addForm" :device-name="displayName" :now="now" @install="installApp?.open()" @rename="nameDialog.open($event,displayName($event))" @mode-change="thirdParty=$event;changeMode()" @connect="manualConnect" @disconnect="manualDisconnect" @add="add" @remove="remove" @password="changePassword" @mqtt-password="changeMQTTPassword" @home="page='home'" @refresh="refresh"/>
</template>
<InstallApp v-if="!demoMode" ref="installApp" :eligible="page==='home'&&listReady&&!!account.username&&!thirdParty"/>
<DeviceNameDialog ref="nameDialog" @save="renameDevice"/>
<footer class="console-footer copyright">Copyright &copy; Phicomm Community · <a href="https://github.com/phicomm-io/iotcloud-community-mqtt" target="_blank" rel="noopener noreferrer">{{t('p.8ea335ab405f')}}</a> · <a href="https://phicomm-io.github.io" target="_blank" rel="noopener noreferrer">{{t('p.3f2111a48779')}}</a></footer></main>
</template>

<style scoped>
.local-hub-entry{display:grid;gap:12px;margin:20px 0}.local-hub-entry>.btn{justify-self:start}
</style>
