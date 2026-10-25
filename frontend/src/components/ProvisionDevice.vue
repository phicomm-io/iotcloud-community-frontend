<script setup>
import {t} from '../i18n.js';

import {ref,computed,watch,onBeforeUnmount} from 'vue';
import {hubMode} from '../deployment';
import '../../../common/web/provision.js';
const props=defineProps({connection:Object,broker:Object});
const P=globalThis.IotProvision;
const suggestedHost=computed(()=>{if(props.broker?.host)return props.broker.host;try{return new URL(props.connection.host).hostname;}catch{return '';}});
const localHub=computed(()=>hubMode&&props.broker?.hub===true&&props.broker.host===location.hostname&&props.broker.port===1883);
const expanded=ref(false),address=ref(''),host=ref(''),port=ref(''),user=ref(''),password=ref(''),trusted=ref(false),state=ref(''),error=ref(''),pending=ref(false);
let stop=null;
function cancel(){stop?.();stop=null;password.value='';pending.value=false;}
function edit(){cancel();expanded.value=!expanded.value;state.value='';error.value='';trusted.value=false;if(expanded.value){let fallback='';try{fallback=new URL(props.connection.host).hostname;}catch{}host.value=props.broker?.host||fallback;port.value=props.broker?.port||'';user.value=props.connection.username||'';password.value=props.connection.password||'';}}
watch(()=>[props.connection.host,props.connection.username,props.connection.password],cancel);
function open(){
 cancelPending();error.value='';state.value='';
 let target,values;
 try{P.platformOrigin(location.origin);target=P.deviceURL(address.value);values=P.config({v:1,host:host.value.trim(),port:Number(port.value),user:user.value,password:password.value,protocol:'tmcp',expires:Date.now()+P.TTL});}
 catch{error.value=t('p.0a967b6950d7');return;}
 if(!trusted.value){error.value=t('p.2488b2ff288b');return;}
 const id=P.nonce(),expires=values.expires;
 target.hash=new URLSearchParams({'iotcloud-import':id,origin:location.origin,expires:String(expires),host:values.host,port:String(values.port),user:values.user}).toString();
 // Only public configuration enters the fragment; the password waits for consent.
 const popup=window.open('about:blank','_blank');
 if(!popup){error.value=t('p.0b419cf5ae78');return;}
 pending.value=true;state.value=t('p.c15d80fa76d6',{v0:(target.origin)});
 let sent=false;
 const cleanup=()=>{window.removeEventListener('message',receive);window.removeEventListener('pagehide',abort);clearTimeout(timer);clearInterval(closed);values=null;password.value='';pending.value=false;};
 const abort=()=>{cleanup();state.value=t('p.8db1b7ae8fa1');};
 const receive=e=>{
  if(P.packet(e,{source:popup,origin:target.origin,id,expires},'iotcloud.provision.ready')&&!sent){
   sent=true;popup.postMessage({type:'iotcloud.provision.config',id,password:values.password},target.origin);values=null;
   state.value=t('p.0ea30c4e0b04');
  }else if(sent&&P.packet(e,{source:popup,origin:target.origin,id,expires},'iotcloud.provision.received')){
   cleanup();stop=null;state.value=t('p.a22ceba27c52');
  }
 };
 const timer=setTimeout(()=>{abort();stop=null;},Math.max(0,expires-Date.now()));
 const closed=setInterval(()=>{if(popup.closed){abort();stop=null;}},1000);
 stop=cleanup;window.addEventListener('message',receive);window.addEventListener('pagehide',abort);
 popup.location.replace(target.href);
}
function cancelPending(){stop?.();stop=null;pending.value=false;}
onBeforeUnmount(cancel);
</script>
<template>
<section class="card provision-device" :aria-label="t('p.59a57675ecf9')">
<h2>{{t('p.59a57675ecf9')}}</h2>
<template v-if="localHub">
<p class="help">{{t('hub.provision.help')}}</p>
<dl class="hub-broker-details"><div><dt>{{t('hub.provision.host')}}</dt><dd>{{broker.host}}</dd></div><div><dt>{{t('hub.port')}}</dt><dd>1883</dd></div><div><dt>{{t('hub.username')}}</dt><dd>{{connection.username}}</dd></div></dl>
<p class="help">{{t('hub.provision.passwordHelp')}}</p>
</template>
<template v-else>
<p class="help">{{t('p.96ec8aafd7f9')}}</p>
<p v-if="suggestedHost" class="help">{{t('p.3ae9d76961b1')}}<strong style="overflow-wrap:anywhere">{{suggestedHost}}</strong><span v-if="broker?.port"> {{t('p.b150b246ee63')}}{{broker.port}}</span></p>
<button type="button" class="btn" :aria-expanded="expanded" @click="edit">{{expanded?t('p.afd4b783536b'):t('p.d702657fe4b1')}}</button>
<form v-if="expanded" class="stack" @submit.prevent="open">
<label>{{t('p.aa7796113bac')}}<input v-model="address" required :placeholder="t('p.0397f8edf0ac')" :disabled="pending" autocomplete="off"/></label>
<div class="fields"><label>{{t('p.400d86947612')}}<input v-model="host" required maxlength="127" :disabled="pending" placeholder="mqtt.example.com"/></label><label>{{t('p.7cdd03fad7b3')}}<input v-model="port" type="number" min="1" max="65535" required :disabled="pending" :placeholder="t('p.a78cac8b31e5')"/></label></div>
<div class="fields"><label>{{t('p.4728f324bd36')}}<input v-model="user" maxlength="63" :disabled="pending" autocomplete="off"/></label><label>{{t('p.e64c0f5fb1d9')}}<input v-model="password" type="password" maxlength="256" :disabled="pending" autocomplete="off"/></label></div>
<p class="help">{{t('p.eec6ef9a61f0')}}</p>
<label class="trust-device"><input v-model="trusted" type="checkbox" required :disabled="pending"/>{{t('p.edc6c15add1f')}}</label>
<p class="help">{{t('p.c7c635d758da')}}</p>
<div class="form-actions"><button class="btn primary" :disabled="pending">{{t('p.f8b047550169')}}</button><button v-if="pending" type="button" class="btn" @click="cancel();state=t('p.ada8240a84e9')">{{t('p.f007a463b503')}}</button></div>
</form>
<p v-if="state" role="status">{{state}}</p><p v-if="error" role="alert">{{error}}</p>
</template>
</section>
</template>
<style scoped>
.hub-broker-details{display:grid;gap:12px;margin:0}.hub-broker-details>div{display:grid;grid-template-columns:minmax(90px,1fr) minmax(0,2fr);gap:16px;font-size:13px}.hub-broker-details dt{color:var(--muted)}.hub-broker-details dd{margin:0;overflow-wrap:anywhere}
.provision-device{display:grid;gap:14px;padding:24px}.provision-device h2{font-size:17px}.provision-device>.btn{justify-self:start}.provision-device form{display:grid;gap:16px}.provision-device .fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.provision-device label{display:grid;gap:8px}.provision-device input{min-width:0}.provision-device .trust-device{display:flex;align-items:flex-start;font-weight:400;line-height:1.6}.trust-device input{width:18px;min-height:18px;flex-shrink:0;margin-top:3px}@media(max-width:600px){.provision-device .fields{grid-template-columns:1fr}}
</style>
