<script setup>
import {onMounted,ref} from 'vue';
import {api} from '../account';
import {t} from '../i18n';
import HubHome from './HubHome.vue';
const enabled=ref(false),mappings=ref([]),mqtt=ref({host:'',port:1883,user:'',password:''}),keySet=ref(false),busy=ref(false),loaded=ref(false),error=ref(''),notice=ref('');
function apply(data){enabled.value=!!data.enabled;mappings.value=data.mappings||[];Object.assign(mqtt.value,{host:data.mqtt?.host||'',port:data.mqtt?.port||1883,user:data.mqtt?.user||'',password:''});keySet.value=!!data.mqtt?.password_set;loaded.value=true;}
async function load(){busy.value=true;error.value='';try{apply(await api('/hub/bridge'));}catch(e){error.value=e.message;}finally{busy.value=false;}}
function add(){if(mappings.value.length<8)mappings.value.push({direction:'out',local_topic:'',remote_topic:'',retain:false,allow_retained:false});}
async function save(){
 busy.value=true;error.value='';notice.value='';
 try{const upstream={...mqtt.value};if(!upstream.password)delete upstream.password;apply(await api('/hub/bridge',{method:'PUT',body:JSON.stringify({enabled:enabled.value,mappings:mappings.value,mqtt:upstream})}));notice.value=t('hub.saved');}
 catch(e){error.value=e.message;}finally{busy.value=false;}
}
onMounted(load);
</script>
<template>
<HubHome/>
<section class="card hub-settings">
<header><h2>{{t('hub.bridge')}}</h2><p class="help">{{t('hub.bridgeHelp')}}</p><a href="/">{{t('hub.deviceSettings')}}</a></header>
<p v-if="error" role="alert" class="error">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
<button v-if="!loaded" class="btn" :disabled="busy" @click="load">{{t('hub.reload')}}</button>
<form v-else @submit.prevent="save"><fieldset :disabled="busy">
<legend class="sr-only">{{t('hub.bridge')}}</legend>
<label class="enable"><input type="checkbox" v-model="enabled"/>{{t('hub.forwardEnabled')}}</label>
<div class="fields"><label>{{t('hub.upstreamHost')}}<input v-model="mqtt.host" maxlength="127" spellcheck="false"/></label><label>{{t('hub.port')}}<input type="number" v-model.number="mqtt.port" min="1" max="65535" required/></label><label>{{t('hub.username')}}<input v-model="mqtt.user" autocomplete="username" maxlength="63"/></label><label>{{t('hub.upstreamPassword')}}<input v-model="mqtt.password" type="password" autocomplete="new-password" maxlength="128" :placeholder="keySet?t('hub.keepPassword'):''"/></label></div>
<p class="help">{{t('hub.routesHelp')}}</p>
<div class="route" v-for="(route,index) in mappings" :key="index">
<label>{{t('hub.direction')}}<select v-model="route.direction"><option value="out">{{t('hub.out')}}</option><option value="in">{{t('hub.in')}}</option></select></label>
<label>{{t('hub.localTopic')}}<input v-model="route.local_topic" maxlength="256" required spellcheck="false"/></label>
<label>{{t('hub.remoteTopic')}}<input v-model="route.remote_topic" maxlength="256" required spellcheck="false"/></label>
<label class="enable"><input type="checkbox" v-model="route.retain"/>{{t('hub.retain')}}</label>
<label v-if="route.direction==='in'" class="enable"><input type="checkbox" v-model="route.allow_retained"/>{{t('hub.allowRetained')}}</label>
<button class="btn" type="button" @click="mappings.splice(index,1)">{{t('hub.remove')}}</button>
</div>
<div class="actions"><button class="btn" type="button" :disabled="mappings.length>=8" @click="add">{{t('hub.addRoute')}}</button><button class="btn primary" type="submit">{{busy?t('hub.saving'):t('hub.save')}}</button></div>
</fieldset></form>
</section>
</template>
<style scoped>
.hub-settings{padding:24px;display:grid;gap:20px;min-width:0}.hub-settings header{display:grid;gap:12px}.hub-settings h2{font-size:18px}.hub-settings a{color:var(--accent);font-size:13px}.hub-settings fieldset{display:grid;gap:20px;border:0;margin:0;padding:0;min-width:0}.fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}.hub-settings label{display:grid;gap:8px;font-size:13px;min-width:0}.hub-settings input,.hub-settings select{min-width:0;max-width:100%}.hub-settings .enable{display:flex;gap:10px;align-items:center}.enable input{width:18px}.route{display:grid;gap:16px;padding:18px;background:var(--surface-muted);border:1px solid var(--border);border-radius:var(--radius-s)}.route button{justify-self:end}.help{line-height:1.7}.actions{display:flex;gap:12px;flex-wrap:wrap}.error{color:var(--danger);overflow-wrap:anywhere}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:600px){.hub-settings{padding:18px}.fields{grid-template-columns:1fr}}
</style>
