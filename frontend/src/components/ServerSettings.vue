<script setup>
import {t} from '../i18n.js';

import {reactive,ref,computed} from 'vue';
import {server,saveServer} from '../serverConfig';
const form=reactive({...server}),error=ref('');
const differentHost=computed(()=>{try{return new URL(form.mqttWS||form.apiOrigin).hostname!==location.hostname;}catch{return false;}});
function save(){try{saveServer(form);}catch(e){error.value=e.message;}}
</script>
<template><details class="server-settings"><summary>{{t('p.31cd6f527973')}}</summary><form class="auth-form" @submit.prevent="save"><label>{{t('p.6e473aa96011')}}<input v-model="form.apiOrigin" type="url" :placeholder="t('p.3d2f935b745f')" /></label><label>{{t('p.be3bb07c2ab8')}}<input v-model="form.mqttWS" type="url" :placeholder="t('p.47e7229961bc')" /></label><p v-if="differentHost" role="status">{{t('p.e1f756c917f5')}}</p><p>{{t('p.a9dba097f41f')}}</p><p v-if="error" role="alert">{{error}}</p><button class="primary-button">{{t('p.b44c55c57cd1')}}</button></form></details></template>
<style scoped>.server-settings{margin:20px 0;font-size:14px}.server-settings summary{cursor:pointer}.server-settings p{color:var(--muted);line-height:1.6}</style>
