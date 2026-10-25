<script setup>
import {ref} from 'vue';
import {api} from '../account';
import {t} from '../i18n';
const emit=defineEmits(['created']);
const username=ref(''),password=ref(''),devicePassword=ref(''),busy=ref(false),error=ref('');
async function setup(){
 busy.value=true;error.value='';
 try{
  const basic=btoa(String.fromCharCode(...new TextEncoder().encode('admin:'+devicePassword.value)));
  await api('/hub/setup',{method:'POST',headers:{Authorization:'Basic '+basic},body:JSON.stringify({username:username.value,password:password.value})});
  emit('created',{username:username.value,password:password.value});
 }catch(e){error.value=e.message;}finally{busy.value=false;}
}
</script>
<template>
<form class="auth-form hub-setup" @submit.prevent="setup">
<p>{{t('hub.setupHelp')}} <a href="/#settings/device">{{t('hub.deviceSettings')}}</a></p>
<label>{{t('hub.username')}}<input v-model="username" autocomplete="username" pattern="[A-Za-z0-9_]{3,32}" minlength="3" maxlength="32" required/></label>
<label>{{t('hub.password')}}<input v-model="password" type="password" autocomplete="new-password" minlength="8" maxlength="63" required/></label>
<label>{{t('hub.devicePassword')}}<input v-model="devicePassword" type="password" autocomplete="current-password" minlength="8" maxlength="32" required/></label>
<p v-if="error" class="form-message error" role="alert">{{error}}</p>
<button class="primary-button auth-submit" :disabled="busy">{{busy?t('hub.saving'):t('hub.create')}}</button>
</form>
</template>
<style scoped>
.hub-setup p{font-size:13px;line-height:1.7;color:var(--muted)}.hub-setup a{color:var(--accent)}
</style>
