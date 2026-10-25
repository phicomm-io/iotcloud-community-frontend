<script setup>
import {t} from '../i18n.js';

import {computed,onMounted,onUnmounted,ref} from 'vue';
import {api} from '../account';
import {deviceKey} from '../deviceProtocol';
const props=defineProps({devices:{type:Array,default:()=>[]},deviceName:Function});
const enabled=ref(false),key=ref(''),keySet=ref(false),mappings=ref([]),status=ref('disabled'),busy=ref(true),error=ref(''),notice=ref(''),loaded=ref(false);
const maxMappings=ref(64);
const selected=ref(''),channel=ref(0),topic=ref('');
const supported=computed(()=>props.devices.filter(d=>d.version==='v2'&&d.status==='active'&&['tc1','a1'].includes(d.model)));
const device=computed(()=>supported.value.find(d=>deviceKey(d)===selected.value));
const channels=computed(()=>device.value?.model==='tc1'?Array.from({length:6},(_,i)=>({value:i,label:t('p.a0b3216a77cb',{v0:(i+1)})})):[{value:0,label:t('p.8ee97098c6f6')},{value:1,label:t('p.f3b08532004f')}]);
const statusText=computed(()=>({disabled:t('p.f95ea7f4c063'),configuration_error:t('p.1e44d1cf25a8'),connecting:t('p.282cbc2cda20'),subscription_error:t('p.8a60f395f483'),connected:t('p.702b9b17e6cd'),disconnected:t('p.ec5ff725b789'),device_offline:t('p.d6aee18bff9d'),device_rejected:t('p.24a88b22e1b1'),device_timeout:t('p.a9ac1026881c'),busy:t('p.b0ca770379de')}[status.value]||t('p.005a25a303c2')));
function name(d){return props.deviceName?.(d)||`${d.model.toUpperCase()} · ${d.mac}`;}
function label(m){return `${name(m.device)} · ${m.device.model==='tc1'?t('p.5fd2b31223cf',{v0:(m.channel+1)}):m.channel===0?t('p.3e41bc3fa911'):t('p.0d91f5aabd3c')}`;}
function apply(data){maxMappings.value=data.max_mappings||64;enabled.value=!!data.enabled;keySet.value=!!data.key_set;mappings.value=data.mappings||[];status.value=data.status;key.value='';loaded.value=true;}
async function load(){busy.value=true;error.value='';try{apply(await api('/integrations/bemfa'));}catch(e){error.value=e.message;}finally{busy.value=false;}}
function add(){
 error.value='';const d=device.value,selectedTopic=topic.value.trim(),c=Number(channel.value);
 if(!d){error.value=t('p.534789b9143b');return;}
 const suffix=d.model==='tc1'?'001':c===0?'003':'002';
 if(!/^[A-Za-z0-9_]{1,61}(001|002|003)$/.test(selectedTopic)||!selectedTopic.endsWith(suffix)){error.value=t('p.32b5c7b1aac4',{v0:(suffix)});return;}
 if(mappings.value.some(m=>m.topic===selectedTopic||(deviceKey(m.device)===deviceKey(d)&&m.channel===c))){error.value=t('p.cba6e923c026');return;}
 if(mappings.value.length>=maxMappings.value){error.value=t('p.11f74b9c9966');return;}
 mappings.value.push({device:{...d},channel:c,topic:selectedTopic});topic.value='';notice.value=t('p.5ab151cd4df8');
}
async function save(){busy.value=true;error.value='';notice.value='';try{apply(await api('/integrations/bemfa',{method:'PUT',body:JSON.stringify({enabled:enabled.value,api_key:key.value,mappings:mappings.value})}));notice.value=t('p.d6082ea33870');}catch(e){error.value=e.message;}finally{busy.value=false;}}
async function clear(){
 if(!window.confirm(t('p.df1e3148b269')))return;
 busy.value=true;error.value='';notice.value='';try{await api('/integrations/bemfa',{method:'DELETE'});apply({enabled:false,key_set:false,mappings:[],status:'disabled'});notice.value=t('p.4208ff06f442');}catch(e){error.value=e.message;}finally{busy.value=false;}
}
let timer,alive=true;onMounted(async()=>{await load();if(!alive)return;timer=setInterval(async()=>{if(!loaded.value||busy.value)return;try{const data=await api('/integrations/bemfa');status.value=data.status;}catch{/* Keep unsaved edits; explicit refresh shows connection errors. */}},10000);});onUnmounted(()=>{alive=false;clearInterval(timer);});
</script>
<template>
<section class="card bemfa-card">
<header><h2>{{t('p.1565532c2b7e')}}</h2><p class="help">{{t('p.ba2711093460')}}</p><p role="status">{{statusText}}</p></header>
<p v-if="error" class="message error" role="alert">{{error}}</p><p v-if="notice" class="message" role="status">{{notice}}</p>
<button v-if="!loaded" class="btn" :disabled="busy" @click="load">{{busy?t('p.86b6d0d63062'):t('p.5d3bf702b137')}}</button>
<form v-else @submit.prevent="save">
<fieldset :disabled="busy"><legend class="sr-only">{{t('p.12f4c4927405')}}</legend>
<label class="enable"><input v-model="enabled" type="checkbox"/>{{t('p.f33beccc32ee')}}</label>
<label>{{t('p.700b0ed14eb8')}}<input v-model="key" :aria-label="t('p.700b0ed14eb8')" type="password" autocomplete="new-password" spellcheck="false" :placeholder="keySet?t('p.a49b8d3b397e'):t('p.b7b2dba75319')" maxlength="128"/><small class="help">{{keySet?t('p.8b92631a20b9'):t('p.e74de673d8fa')}}{{t('p.d11251c23c46')}}</small></label>
<p class="help">{{t('p.4c598c68c9fe')}}</p>
<h3>{{t('p.8032259682f9')}}</h3><p class="help">{{t('p.e66d7a3821e3')}}</p>
<ul v-if="mappings.length" class="mappings"><li v-for="(m,i) in mappings" :key="m.topic"><span><b>{{label(m)}}</b><code>{{m.topic}}</code></span><button class="btn" type="button" :aria-label="t('p.5c3f3559eb60',{v0:(m.topic)})" @click="mappings.splice(i,1);notice=t('p.0e34c21ee919')">{{t('p.6135d4159e89')}}</button></li></ul><p v-else class="help">{{t('p.18f1017d9b6e')}}</p>
<div v-if="supported.length" class="add-mapping">
<label>{{t('p.869b1771e072')}}<select v-model="selected" @change="channel=0"><option value="">{{t('p.8033585819c2')}}</option><option v-for="d in supported" :key="deviceKey(d)" :value="deviceKey(d)">{{name(d)}}</option></select></label>
<label>{{t('p.80d13f0f3343')}}<select v-model="channel" :disabled="!device"><option v-for="c in channels" :key="c.value" :value="c.value">{{c.label}}</option></select></label>
<label>{{t('p.49c65b3b2e5e')}}<input v-model="topic" :placeholder="t('p.8494aef45dc9')" maxlength="64" spellcheck="false"/></label>
<button class="btn" type="button" :disabled="!device||!topic" @click="add">{{t('p.99049e59a6e8')}}</button>
</div><p v-else class="help">{{t('p.40cc2400ae19')}}</p>
<div class="actions"><button class="btn primary" type="submit">{{busy?t('p.ff509c9ba052'):t('p.ed89698c99f9')}}</button><button class="btn danger" type="button" :disabled="!keySet&&!mappings.length" @click="clear">{{t('p.e2e2a866c456')}}</button></div>
<p class="help">{{t('p.2989693c15e9')}}<a href="https://cloud.bemfa.com/docs/src/speaker_mi.html" target="_blank" rel="noopener noreferrer">{{t('p.b9b039a0e927')}}</a></p>
</fieldset></form>
</section>
</template>
<style scoped>
.bemfa-card{padding:24px;min-width:0}.bemfa-card header{display:grid;gap:12px;margin-bottom:20px}.bemfa-card h2{font-size:18px}.bemfa-card h3{font-size:15px;margin:8px 0 0}.bemfa-card fieldset{border:0;padding:0;margin:0;min-width:0;display:grid;gap:18px}.bemfa-card label{display:grid;gap:8px;font-size:13px}.bemfa-card input,.bemfa-card select,.bemfa-card button{min-height:44px;max-width:100%}.bemfa-card .enable{display:flex;align-items:center;gap:10px}.enable input{width:18px;min-height:18px}.help{line-height:1.7}.message{padding:12px;background:var(--accent-soft);border-radius:var(--radius-s);margin-bottom:16px;overflow-wrap:anywhere}.error{color:var(--danger)}.mappings{list-style:none;padding:0;margin:0;display:grid}.mappings li{display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--border)}.mappings li>span{min-width:0;flex:1;display:grid;gap:8px}.mappings b,.mappings code{overflow-wrap:anywhere}.mappings code{color:var(--muted)}.add-mapping{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:end}.actions{display:flex;gap:12px;flex-wrap:wrap}.bemfa-card a{color:var(--accent)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:600px){.bemfa-card{padding:18px}.add-mapping{grid-template-columns:1fr}.actions>*{flex:1}}
</style>
