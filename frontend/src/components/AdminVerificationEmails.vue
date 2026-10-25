<script setup>
import {t,errorMessage} from '../i18n.js';

import {computed, onBeforeUnmount, onMounted, ref} from 'vue';
import {api} from '../account';
const props=defineProps({enabled:Boolean});
const data=ref(null),error=ref(''),busy=ref(false),days=ref(30),email=ref(''),status=ref(''),page=ref(1),revealed=ref(new Set()),clock=ref(Date.now());
let timer,tick,sequence=0,stopped=false,serverOffset=0;
const labels=computed(()=>({unknown:t('p.f86c7c62d672'),sending:t('p.3b37f021cdd5'),sent:t('p.f265c8172a9a'),registered:t('p.1f4273cab151'),expired:t('p.2fe0e3339ac4'),failed:t('p.ac77953a1e06'),superseded:t('p.a33b54d252cb'),verified:t('p.0a633af7fba1'),registration_failed:t('p.c6bd7752642b')}));
const metrics=computed(()=>[['sent_emails',t('p.e304b9a44157')],['registered_emails',t('p.1aa7e450bd2c')],['unregistered_emails',t('p.05529fafb9d4')],['expired_unregistered_emails',t('p.19d879534849')],['failed_attempts',t('p.a31493d82034')]]);
const pages=computed(()=>Math.max(1,Math.ceil((data.value?.total||0)/50)));
function effectiveStatus(row){return row.status==='sent'&&row.expires_at*1000<=clock.value+serverOffset?'expired':row.status;}
function time(value){return value?new Date(value*1000).toLocaleString():'—';}
async function refresh(reset=false){
 if(reset)page.value=1;
 const id=++sequence;busy.value=true;revealed.value=new Set();
 const query=new URLSearchParams({days:String(days.value),email:email.value.trim(),status:status.value,page:String(page.value)});
 try{const next=await api('/admin/verification-emails?'+query);if(id===sequence&&!stopped){data.value=next;serverOffset=next.server_time*1000-Date.now();error.value='';}}
 catch(e){if(id===sequence&&!stopped){error.value=e.message;data.value=null;}}
 finally{if(id===sequence&&!stopped)busy.value=false;}
}
function reveal(id){const next=new Set(revealed.value);next.has(id)?next.delete(id):next.add(id);revealed.value=next;}
function turn(delta){page.value+=delta;refresh();}
onMounted(()=>{refresh();timer=setInterval(refresh,30000);tick=setInterval(()=>{clock.value=Date.now();},1000);});
onBeforeUnmount(()=>{stopped=true;clearInterval(timer);clearInterval(tick);});
</script>
<template>
<section class="card verification-records" aria-labelledby="verification-records-title">
 <header class="verification-heading"><div><h2 id="verification-records-title">{{t('p.97134c70031b')}}</h2><p class="help">{{props.enabled?t('p.d5caebd2ccc0'):t('p.62ea9dd51e1a')}} {{t('p.0283206648a9')}}</p></div><button type="button" :disabled="busy" @click="refresh()">{{busy?t('p.7f3c8312816f'):t('p.621e17c543bc')}}</button></header>
 <p class="help verification-note">{{t('p.7f17e34788a0')}}</p>
 <form class="verification-filters" @submit.prevent="refresh(true)"><label>{{t('p.3063640a272c')}}<select :aria-label="t('p.3063640a272c')" v-model="days" @change="refresh(true)"><option :value="1">{{t('p.79e81865effa')}}</option><option :value="7">{{t('p.2261b06712a3')}}</option><option :value="30">{{t('p.f729bb3d3f7e')}}</option><option :value="90">{{t('p.0909522d9092')}}</option></select></label><label>{{t('p.6320b4a8722a')}}<select :aria-label="t('p.6320b4a8722a')" v-model="status" @change="refresh(true)"><option value="">{{t('p.0a379c1e7398')}}</option><option v-for="(name,key) in labels" :key="key" :value="key">{{name}}</option></select></label><label>{{t('p.aa69adaa0edf')}}<input v-model="email" maxlength="254" :placeholder="t('p.34e19e49a5f2')" type="text" /></label><button :disabled="busy">{{t('p.bcd6771e08ec')}}</button></form>
 <p v-if="error" role="alert" class="error">{{error}}</p>
 <template v-if="data">
  <div class="verification-metrics"><div v-for="[key,title] in metrics" :key="key"><span>{{title}}</span><b>{{data.summary[key]}}</b></div></div>
  <p class="help">{{t('p.af243cce3556')}}</p>
  <ul v-if="data.records.length" class="verification-list"><li v-for="row in data.records" :key="row.id">
   <header><b class="verification-email">{{row.email}}</b><span class="verification-status" :class="{'is-failed':['failed','registration_failed'].includes(effectiveStatus(row)),'is-registered':effectiveStatus(row)==='registered'}">{{labels[effectiveStatus(row)]||row.status}}</span></header>
   <dl><div><dt>{{t('p.e9b5d944cc4b')}}</dt><dd>{{time(row.created_at)}}</dd></div><div><dt>{{t('p.4b474d377140')}}</dt><dd>{{time(row.sent_at)}}</dd></div><div><dt>{{t('p.4874fa5d4b3a')}}</dt><dd>{{time(row.expires_at)}}</dd></div><div v-if="row.username"><dt>{{t('p.679e917b16ef')}}</dt><dd>{{row.username}}</dd></div><div v-if="row.registered_at"><dt>{{t('p.4adc34616f3c')}}</dt><dd>{{time(row.registered_at)}}</dd></div></dl>
   <p v-if="row.detail" class="help">{{errorMessage({message:row.detail,message_key:row.detail_key})}}</p>
   <div v-if="row.code&&effectiveStatus(row)==='sent'" class="verification-code"><button type="button" :aria-expanded="revealed.has(row.id)" @click="reveal(row.id)">{{revealed.has(row.id)?t('p.e1e891038eb3'):t('p.d880027c29d7')}}</button><code v-if="revealed.has(row.id)" :aria-label="t('p.9d8b55031a5a')">{{row.code}}</code><span class="help">{{t('p.6015908ec331')}}</span></div>
  </li></ul>
  <p v-else class="help" role="status">{{t('p.c20842d98460')}}</p>
  <nav class="verification-pagination" :aria-label="t('p.fd13f9c90d50')"><span class="help">{{t('p.76e547a8fa54')}} {{data.total}} {{t('p.064f059f1a4f')}} {{page}} / {{pages}} {{t('p.d24d3c99460c')}}</span><button type="button" :disabled="busy||page<=1" @click="turn(-1)">{{t('p.c9b9ae7a6144')}}</button><button type="button" :disabled="busy||page>=pages" @click="turn(1)">{{t('p.8a8542f69648')}}</button></nav>
 </template><p v-else-if="busy" role="status" class="help">{{t('p.d245a6096374')}}</p>
</section>
</template>
<style scoped>
.verification-records{margin-top:24px}.verification-heading,.verification-list li>header,.verification-pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.verification-heading h2{margin-bottom:8px}.verification-note{margin:16px 0;line-height:1.7}.verification-filters{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin:20px 0}.verification-filters label{display:grid;gap:8px;min-width:0;flex:1 1 160px}.verification-filters input,.verification-filters select{width:100%;min-width:0}.verification-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:20px 0 12px}.verification-metrics>div{display:grid;gap:10px;background:var(--surface-muted);border-radius:var(--radius-s);padding:16px}.verification-metrics span{font-size:12px;color:var(--muted)}.verification-metrics b{font-size:24px}.verification-list{list-style:none;padding:0;margin:20px 0}.verification-list li{padding:20px 0;border-bottom:1px solid var(--border)}.verification-email{overflow-wrap:anywhere}.verification-status{font-size:12px;color:var(--muted);padding:6px 10px;background:var(--surface-muted);border-radius:var(--radius-s)}.is-failed{color:var(--danger)}.is-registered{color:var(--accent)}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:16px 0}dl>div{min-width:0}dt{font-size:12px;color:var(--muted)}dd{margin:5px 0 0;font-size:13px;overflow-wrap:anywhere}.verification-code{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}.verification-code code{font-size:22px;letter-spacing:3px}.verification-code .help{flex:1 1 220px}.verification-pagination{justify-content:flex-end}.verification-pagination>span{margin-right:auto}.verification-records button{min-height:44px}@media(max-width:480px){.verification-filters label{flex-basis:100%}.verification-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}dl{grid-template-columns:1fr}}
</style>
