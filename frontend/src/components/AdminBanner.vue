<script setup>
import {t} from '../i18n.js';

import {onMounted,reactive,ref} from 'vue';
import {api} from '../account';
import {refreshBanner} from '../banner';
import BannerView from './BannerView.vue';
const form=reactive({enabled:false,audience:'before_login',text:'',url:'',label:''}),loading=ref(true),loaded=ref(false),busy=ref(false),error=ref(''),message=ref('');
async function load(){loading.value=true;try{Object.assign(form,await api('/admin/banner'));loaded.value=true;error.value='';}catch(e){error.value=e.message;}finally{loading.value=false;}}
async function save(){busy.value=true;error.value='';message.value='';try{Object.assign(form,await api('/admin/banner',{method:'PUT',body:JSON.stringify(form)}));await refreshBanner();message.value=t('p.1b0dc321c3c8');}catch(e){error.value=e.message;}finally{busy.value=false;}}
onMounted(load);
</script>
<template>
 <section class="card admin-banner" aria-labelledby="admin-banner-title">
  <h2 id="admin-banner-title">{{t('p.d29a8a2a1b33')}}</h2>
  <p class="help">{{t('p.1132e7886a51')}}</p>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <button v-if="loading" type="button" disabled>{{t('p.c3d3f3e3daf6')}}</button>
  <button v-else-if="!loaded" type="button" @click="load">{{t('p.39c4c70ab1c3')}}</button>
  <form v-if="loaded" @submit.prevent="save">
   <label class="banner-toggle"><input v-model="form.enabled" type="checkbox"/>{{t('p.5719bc2720eb')}}</label>
   <label>{{t('p.974a0e5bd97c')}}<select v-model="form.audience"><option value="before_login">{{t('p.8ac85e1ce1e6')}}</option><option value="after_login">{{t('p.a1292d0cb26d')}}</option></select></label>
   <label>{{t('p.99dc3230f341')}}<textarea v-model="form.text" maxlength="300" rows="3" :required="form.enabled" :placeholder="t('p.c4ebfd5fe606')"/></label>
   <div class="banner-fields"><label>{{t('p.be237f8b811d')}}<input v-model="form.url" type="url" maxlength="1000" :required="!!form.label" placeholder="https://"/></label><label>{{t('p.2b79301b1f55')}}<input v-model="form.label" maxlength="40" :required="!!form.url" :placeholder="t('p.6c5ce47372b0')"/></label></div>
   <div class="banner-preview"><p class="help">{{t('p.13d61fea9f17')}}</p><BannerView :banner="form"/><p v-if="!form.enabled||!form.text" class="help">{{t('p.8709feac2cd9')}}</p></div>
   <button class="btn primary" :disabled="busy">{{busy?t('p.ff509c9ba052'):t('p.62df6a530355')}}</button><p v-if="message" role="status" class="help">{{message}}</p>
  </form>
 </section>
</template>
<style scoped>
.admin-banner{margin-top:24px}.admin-banner>h2{margin-bottom:8px}.admin-banner>.help{line-height:1.7}.admin-banner form{display:grid;gap:18px;margin-top:20px}.admin-banner label{display:grid;gap:8px;min-width:0}.admin-banner .banner-toggle{display:flex;align-items:center;gap:10px}.banner-toggle input{width:18px;min-height:18px;height:18px;margin:0}.admin-banner textarea,.admin-banner input:not([type=checkbox]){width:100%;min-width:0}.admin-banner textarea{resize:vertical;min-height:90px;padding:12px;font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-s)}.banner-fields{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:16px}.banner-preview{min-width:0}.banner-preview>.help{margin-bottom:10px}.admin-banner button{min-height:44px;justify-self:start}@media(max-width:600px){.banner-fields{grid-template-columns:1fr}}
</style>
