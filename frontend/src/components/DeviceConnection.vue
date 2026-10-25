<script setup>
import {t} from '../i18n.js';

import {ref,watch} from 'vue';
const props=defineProps({preference:Object,connection:Object});
const emit=defineEmits(['save']);
const address=ref(''),mode=ref('auto'),password=ref(''),error=ref('');
watch(()=>props.preference,p=>{address.value=p?.address||'';mode.value=p?.mode||'auto';},{immediate:true});
function save(){error.value='';emit('save',{address:address.value,mode:mode.value,password:password.value},message=>{error.value=message||'';if(!message)password.value='';});}
</script>
<template><form class="local-connection" @submit.prevent="save"><h3>{{t('p.a43615418478')}}</h3><label>{{t('p.485a26050ce5')}}<select v-model="mode"><option value="auto">{{t('p.cc85cb584b23')}}</option><option value="mqtt">{{t('p.148579fd130e')}}</option></select></label><label>{{t('p.731c637dd40e')}}<input v-model="address" placeholder="192.168.1.100:80" autocomplete="off" spellcheck="false"></label><p class="help">{{t('p.818e60f35bd5')}}</p><label>{{t('p.1c03f7a96fb2')}}<input v-model="password" type="password" autocomplete="off" :placeholder="t('p.fd0c3856def0')"></label><p class="help">{{t('p.5bd4c31ec3cf')}}</p><p class="help" role="status">{{connection?.checking?t('p.8978135fdb79'):connection?.reason||t('p.fed0dc5b0c2f')}}</p><p v-if="error" role="alert">{{error}}</p><button class="btn" type="submit">{{t('p.524304bb0d64')}}</button></form></template>
<style scoped>.local-connection{display:grid;gap:12px;min-width:220px;max-width:360px;padding:12px 0}.local-connection label{display:grid;gap:6px}.local-connection p{overflow-wrap:anywhere}@media(max-width:600px){.local-connection{min-width:0}}</style>
