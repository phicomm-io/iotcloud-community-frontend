<script setup>
import {onMounted, ref} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import AuthShell from '../components/AuthShell.vue';
import {completeGitHub} from '../githubAuth';
const route=useRoute(),router=useRouter(),ticket=String(route.query.ticket||'');
const busy=ref(true),message=ref('正在完成 GitHub 登录…'),registration=ref(false),username=ref(''),password=ref('');
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
  <span class="eyebrow">GitHub 登录</span>
  <h1>{{registration?'完成账号创建':'连接你的账号'}}</h1>
  <template v-if="registration">
   <p>选择平台用户名和初始密码。此密码也用于设备连接 MQTT，之后可在设置中独立修改；下次可直接用 GitHub 登录。</p>
   <form class="auth-form" @submit.prevent="finish">
    <label>平台用户名<input v-model="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_.\-]{3,32}" autocomplete="username" /></label>
    <label>初始密码<input v-model="password" required type="password" minlength="6" maxlength="256" autocomplete="new-password" /></label>
    <button class="primary-button auth-submit" :disabled="busy">{{busy?'正在创建…':'创建账号并登录'}}</button>
   </form>
   <p class="auth-footnote">已有平台账号？请使用密码登录，在设置的账号安全中绑定 GitHub，保留原有设备。</p>
  </template>
  <p v-if="message" :role="busy?'status':'alert'" class="form-message">{{message}}</p>
  <RouterLink v-if="!busy" to="/login">返回登录</RouterLink>
 </AuthShell>
</template>
