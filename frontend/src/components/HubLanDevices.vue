<script setup>
import {onBeforeUnmount,onMounted,ref} from 'vue';
import {api} from '../account';
import {t} from '../i18n';
import {createHubLanClient} from '../hubLan';

const lan=createHubLanClient(api);
const snapshot=ref(null),busy=ref(false),error=ref(''),notice=ref(''),dialog=ref(null),selected=ref(null),password=ref(''),workingPeer=ref('');
let timer,disposed=false,request;
const pendingPhases=new Set(['accepted','pending','queued','pairing','in_progress']);
const completedPhases=new Set(['paired','complete','completed','ready']);
function cancel(){clearTimeout(timer);request?.abort();request=undefined;}
function schedule(delay=5000){clearTimeout(timer);if(!disposed)timer=setTimeout(load,delay);}
async function load({preserveError=false}={}){
 if(disposed||busy.value)return;
 cancel();busy.value=true;
 const controller=new AbortController();request=controller;
 try{const data=await lan.discover(controller.signal);if(disposed)return;snapshot.value=data;if(!preserveError)error.value='';}
 catch(e){if(!disposed&&e.name!=='AbortError')error.value=e.message;}
 finally{if(request===controller)request=undefined;busy.value=false;schedule();}
}
function status(device){
 if(device.paired)return t('hub.lan.paired');
 if(!device.online)return t('hub.lan.offline');
 if(!device.compatible)return t('hub.lan.incompatible');
 if(device.registered)return t('hub.lan.registered');
 return t('hub.lan.discovered');
}
function canPair(device){return device.compatible&&device.online&&!device.paired&&!workingPeer.value;}
function openPair(device){if(!canPair(device))return;selected.value=device;password.value='';error.value='';notice.value='';dialog.value?.showModal();}
async function pair(){
 const device=selected.value;if(!device||!canPair(device)||password.value.length>32)return;
 const peer=device.device_id;busy.value=true;workingPeer.value=peer;error.value='';notice.value='';
 try{
  if(!device.registered)await lan.register(device);
  const started=await lan.pair({peer,ip:device.ip,password:password.value,scopes:1});
  password.value='';dialog.value?.close();selected.value=null;
  if(!['accepted','ok'].includes(started.code||'ok'))throw Object.assign(Error(started.message||started.code||'Pairing was not accepted'),{code:started.code});
  notice.value=t('hub.lan.pairing');await pollPair(peer);
 }catch(e){error.value=e.message;}
 finally{password.value='';workingPeer.value='';busy.value=false;await load({preserveError:!!error.value});}
}
async function pollPair(peer){
 for(let attempt=0;attempt<60&&!disposed;attempt++){
  const result=await lan.pairStatus(peer);const phase=String(result.phase||'').toLowerCase();
  if(completedPhases.has(phase)){notice.value=t('hub.lan.pairSuccess');return;}
  if(result.code&& !['ok','accepted','pending','busy'].includes(result.code))throw Object.assign(Error(result.message||result.code),{code:result.code});
  if(phase&&!pendingPhases.has(phase)&&!completedPhases.has(phase))throw Error(result.code||phase);
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 if(!disposed)throw Error(t('hub.lan.pairTimeout'));
}
async function unpair(device){
 if(busy.value||!device.paired||!window.confirm(t('hub.lan.confirmUnpair',{peer:device.device_id})))return;
 busy.value=true;error.value='';notice.value='';
 try{await lan.unpair(device.device_id);notice.value=t('hub.lan.unpaired');}
 catch(e){error.value=e.message;}
 finally{busy.value=false;await load({preserveError:!!error.value});}
}
async function unregister(device){
 if(busy.value||!device.registered||device.paired||!window.confirm(t('hub.lan.confirmRemove',{peer:device.device_id})))return;
 busy.value=true;error.value='';notice.value='';
 try{await lan.unregister(device.device_id);notice.value=t('hub.lan.removed');}
 catch(e){error.value=e.message;}
 finally{busy.value=false;await load({preserveError:!!error.value});}
}
function codeText(device){const code=device.code||(!device.online?'offline':!device.registered?'not_registered':device.paired?'ready':'');return code?t('hub.lan.code.'+code):'';}
onMounted(load);
onBeforeUnmount(()=>{disposed=true;cancel();});
</script>

<template>
<section class="card lan-devices" aria-labelledby="hub-lan-title">
 <header><div><h2 id="hub-lan-title">{{t('hub.lan.title')}}</h2><p class="help">{{t('hub.lan.help')}}</p></div><button class="btn" type="button" :disabled="busy" @click="load">{{t('hub.home.refresh')}}</button></header>
 <p v-if="error" class="error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
 <p v-if="snapshot&&!snapshot.ready" class="help" role="status">{{t('hub.lan.unavailable')}}</p>
 <p v-if="snapshot?.devices?.length===0" class="help">{{t('hub.lan.empty')}}</p>
 <ul v-if="snapshot?.devices?.length" class="lan-list">
  <li v-for="device in snapshot.devices" :key="device.device_id" class="lan-device">
   <div class="lan-copy"><strong>{{device.model}} <span v-if="device.variant">{{device.variant}}</span></strong><span>{{device.device_id}}</span><span v-if="device.ip">{{device.ip}}:{{device.port}}</span><small>{{status(device)}}<span v-if="device.firmware"> · {{device.firmware}}</span></small><small v-if="codeText(device)" class="help">{{codeText(device)}}</small></div>
   <div class="lan-actions">
    <button v-if="!device.paired" class="btn primary" type="button" :disabled="!canPair(device)||busy" @click="openPair(device)">{{t('hub.lan.pair')}}</button>
    <button v-else class="btn" type="button" :disabled="busy" @click="unpair(device)">{{t('hub.lan.unpair')}}</button>
    <button v-if="device.registered&&!device.paired" class="btn danger" type="button" :disabled="busy" @click="unregister(device)">{{t('hub.lan.remove')}}</button>
   </div>
  </li>
 </ul>
 <p v-else-if="snapshot&&!snapshot.devices?.length" class="help">{{t('hub.lan.discoveryOnly')}}</p>
 <dialog ref="dialog" class="pair-dialog" @cancel="password=''">
  <form @submit.prevent="pair"><h2>{{t('hub.lan.pairTitle')}}</h2><p>{{t('hub.lan.pairConfirm',{peer:selected?.device_id||''})}}</p><label>{{t('hub.lan.devicePassword')}}<input v-model="password" type="password" maxlength="32" autocomplete="current-password"/></label><p class="help">{{t('hub.lan.passwordHelp')}}</p><div class="dialog-actions"><button class="btn" type="button" @click="dialog.close();selected=null;password=''">{{t('hub.home.cancel')}}</button><button class="btn primary" :disabled="busy||password.length>32">{{t('hub.lan.pair')}}</button></div></form>
 </dialog>
</section>
</template>

<style scoped>
.lan-devices{padding:24px;display:grid;gap:18px;min-width:0}.lan-devices header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.lan-devices header>div{min-width:0}.lan-devices h2,.pair-dialog h2{font-size:17px}.lan-devices .help{font-size:13px;line-height:1.7}.lan-list{list-style:none;padding:0;margin:0}.lan-device{display:flex;align-items:center;gap:16px;padding:16px 0;border-top:1px solid var(--border)}.lan-copy{display:grid;gap:5px;min-width:0;flex:1}.lan-copy>span,.lan-copy small{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.lan-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.pair-dialog{width:min(440px,calc(100% - 32px));border:1px solid var(--border);border-radius:var(--radius-s);background:var(--surface);color:var(--text);padding:24px}.pair-dialog::backdrop{background:#1118}.pair-dialog form{display:grid;gap:16px}.pair-dialog p{font-size:13px;line-height:1.7}.pair-dialog label{display:grid;gap:8px;font-size:13px}.pair-dialog input{min-width:0}.dialog-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}.error{color:var(--danger);overflow-wrap:anywhere}@media(max-width:600px){.lan-devices{padding:18px}.lan-device{align-items:flex-start;flex-direction:column}.lan-actions{width:100%;justify-content:flex-start}.pair-dialog{padding:20px}}
</style>
