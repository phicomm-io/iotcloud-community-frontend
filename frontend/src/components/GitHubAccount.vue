<script setup>
import {t} from '../i18n.js';

import {ref,onMounted} from 'vue';
import {useRouter} from 'vue-router';
import {account, api} from '../account';
import {sessionToken} from '../serverConfig';
import {forgetLogin} from '../connectionPreferences';
import GitHubButton from './GitHubButton.vue';
const enabled=ref(false);
onMounted(async()=>{try{enabled.value=(await api('/auth/github/status')).enabled===true;}catch{}});
const password=ref(''),message=ref(''),busy=ref(false),router=useRouter();
async function unlink(){
 busy.value=true;message.value='';
 try{
  await api('/auth/github/unlink',{method:'POST',body:JSON.stringify({current_password:password.value})});
  sessionToken('');forgetLogin();Object.assign(account,{username:null,mqttUsername:null,isAdmin:false,aliases:[],githubLogin:'',password:'',loaded:false});
  await router.replace('/login');
 }catch(e){message.value=e.message;}finally{busy.value=false;}
}
</script>
<template>
 <section v-if="enabled&&!account.githubLogin" class="card settings-card"><header class="settings-card-heading"><div><h2>{{t('p.5b1886225bb0')}}</h2><p class="help">{{t('p.b3989220ac0b')}}</p><GitHubButton link/></div></header></section>
 <section v-else-if="account.githubLogin" class="card settings-card"><header class="settings-card-heading"><div><h2>{{t('p.5b1886225bb0')}}</h2><p class="help">{{t('p.e53c52b38456')}}{{account.githubLogin}}{{t('p.917bda0d5a63')}}</p></div></header><form class="github-unlink" @submit.prevent="unlink"><label>{{t('p.138b9098032c')}}<input v-model="password" type="password" autocomplete="current-password" required/></label><p v-if="message" role="alert" class="form-message error">{{message}}</p><button class="btn" :disabled="busy">{{busy?t('p.69b5666844a3'):t('p.20b48e218e46')}}</button></form></section>
</template>
<style scoped>
.settings-card{padding:0;overflow:hidden}.settings-card-heading{padding:24px;border-bottom:1px solid var(--border)}.settings-card-heading h2{font-size:17px}.settings-card-heading .help{margin-top:6px}.github-unlink{display:grid;gap:16px;padding:24px}.github-unlink input{min-height:44px}.github-unlink button{justify-self:start;min-height:44px}
</style>
