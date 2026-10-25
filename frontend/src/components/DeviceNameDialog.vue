<script setup>
import {t} from '../i18n.js';

import {ref} from 'vue';
const emit=defineEmits(['save']);
const dialog=ref(),device=ref(),name=ref(''),error=ref(''),busy=ref(false);
function open(d,current){device.value=d;name.value=current;error.value='';dialog.value.showModal();}
function save(value=name.value.trim()){error.value='';if(value&&new TextEncoder().encode(value).length>63){error.value=t('p.c1d68c97940d');return;}busy.value=true;emit('save',device.value,value,message=>{busy.value=false;if(message)error.value=message;else dialog.value.close();});}
defineExpose({open});
</script>
<template><dialog ref="dialog" class="rename-dialog" @cancel="busy&&$event.preventDefault()"><form @submit.prevent="save()"><h2>{{t('p.88eefc8e9773')}}</h2><p class="help">{{t('p.05dd0f135ab3')}}</p><label>{{t('p.65d8f92232ae')}}<input v-model="name" maxlength="63" :disabled="busy" autofocus/></label><p v-if="device?.version==='v1'" class="help">{{t('p.08b792515519')}}</p><p v-if="error" role="alert" class="error">{{error}}</p><footer><button class="btn ghost" type="button" :disabled="busy" @click="save('')">{{t('p.e7317522d3d1')}}</button><button class="btn" type="button" :disabled="busy" @click="dialog.close()">{{t('p.2cd0f3be8738')}}</button><button class="btn primary" :disabled="busy">{{busy?t('p.ff509c9ba052'):t('p.a759dd2529f1')}}</button></footer></form></dialog></template>
<style scoped>
.rename-dialog{width:min(440px,calc(100vw - 32px));padding:24px}.rename-dialog form{display:grid;gap:18px}.rename-dialog label{gap:8px}.rename-dialog footer{display:flex;justify-content:flex-end;gap:8px}
</style>
