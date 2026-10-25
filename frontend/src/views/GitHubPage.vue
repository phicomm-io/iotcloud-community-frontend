<script setup>
import {t} from '../i18n.js';

import {onMounted, ref} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import AuthShell from '../components/AuthShell.vue';
import {completeGitHub} from '../githubAuth';
const route=useRoute(),router=useRouter(),ticket=String(route.query.ticket||'');
const busy=ref(true),message=ref(t('p.4a8dc8bf79fc')),registration=ref(false),username=ref(''),password=ref('');
async function finish(){
 busy.value=true;
 try{
  const result=await completeGitHub(ticket,registration.value?username.value:'',registration.value?password.value:'');
  if(result.needs_registration){
   registration.value=true;
   username.value=result.username||result.github_login.replace(/[^A-Za-z0-9_.-]/g,'').slice(0,32);
   if(username.value.length<3)username.value='gh-'+username.value;
   message.value='';
  }else{password.value='';await router.replace(result.linked?'/?github=linked':'/?github=login');}
 }catch(e){message.value=e.message;}
 finally{busy.value=false;}
}
onMounted(finish);
</script>
<template>
 <AuthShell>
  <span class="eyebrow">{{t('p.5b1886225bb0')}}</span>
  <h1>{{registration?t('p.5d805e2679d3'):t('p.5a73caed627a')}}</h1>
  <template v-if="registration">
   <p>{{t('p.d7872ca58142')}}</p>
   <form class="auth-form" @submit.prevent="finish">
    <label>{{t('p.b421c0b078ca')}}<input v-model="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_.\-]{3,32}" :placeholder="t('p.c8ea90209208')" autocomplete="username" /></label>
    <label>{{t('p.df387080f986')}}<input v-model="password" required type="password" minlength="6" maxlength="256" autocomplete="new-password" /></label>
    <button class="primary-button auth-submit" :disabled="busy">{{busy?t('p.7c0305bc0ce6'):t('p.f6ebe2b96b3c')}}</button>
   </form>
   <p class="auth-footnote">{{t('p.68303c415b24')}}</p>
  </template>
  <p v-if="message" :role="busy?'status':'alert'" class="form-message">{{message}}</p>
  <RouterLink v-if="!busy" to="/login">{{t('p.747b0f9082e6')}}</RouterLink>
 </AuthShell>
</template>
