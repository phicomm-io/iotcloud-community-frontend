<script setup>
import {t} from '../i18n.js';

import { ref,onMounted } from "vue";
import {hubMode} from "../deployment";
import HubSetup from "../components/HubSetup.vue";
const setupRequired=ref(false);
onMounted(async()=>{if(hubMode){if(route.query.reason==='hub-session-expired')message.value=t('hub.home.sessionExpired');try{setupRequired.value=!!(await api("/register/status")).setup_required;}catch(e){message.value=e.message;}}});
import { useRoute,useRouter } from "vue-router";
import GitHubButton from "../components/GitHubButton.vue";
import AuthShell from "../components/AuthShell.vue";
import LocalConnect from "../components/LocalConnect.vue";
import AppIcon from "../components/AppIcon.vue";
import { api, account, applyAccount } from "../account";
import {track} from "../analytics";
import {legacyCredentials, rememberLogin, savedPassword} from "../connectionPreferences";
const candidate = legacyCredentials();
const route=useRoute();
const username = ref(candidate?.username || ""),
  password = ref(candidate?.password || ""),
  message = ref(""),
  busy = ref(false),
  showPassword = ref(false),
  router = useRouter();
async function login() {
  busy.value = true;
  message.value = "";
  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: username.value,
        password: password.value,
      }),
    });
    applyAccount(result);
    account.password = result.mqtt_password_separate ? savedPassword(account.username) : password.value;
    rememberLogin(account.username, account.password);
    track("login","/login");
    account.loaded = true;
    await router.push("/");
  } catch (e) {
    message.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
 <AuthShell>
  <LocalConnect navigate/>
  <div class="auth-card-heading"><span class="eyebrow">{{t('p.cb1d97794707')}}</span><h1>{{t('p.1e2df9c3075a')}}</h1><p>{{hubMode?t('hub.loginHelp'):t('p.a8045f2881b0')}}</p></div>
  <div v-if="candidate" class="migration-notice" role="status"><b>{{t('p.88f0124588d7')}}</b><p>{{t('p.0e05fbbc057e')}}</p><button type="button" class="btn ghost" @click="username=candidate.username;password=candidate.password">{{t('p.a015f43027ac')}}{{candidate.username}}</button></div>
  <HubSetup v-if="setupRequired" @created="values=>{username=values.username;password=values.password;setupRequired=false;login();}"/>
  <form v-else class="auth-form" @submit.prevent="login">
   <label>{{t('p.1a3f0617d6de')}}<input v-model="username" autocomplete="username" :placeholder="t('p.9365bcd27d6c')" required /></label>
   <label>{{t('p.a621ab606db2')}}<span class="password-field"><input v-model="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" :placeholder="t('p.2deb75f492ce')" required /><button class="icon-button" type="button" :aria-label="showPassword ? t('p.dd1d07bd9ceb') : t('p.ffe21a671190')" @click="showPassword = !showPassword"><AppIcon name="eye" :size="18" /></button></span></label>
   <p v-if="message" role="alert" class="form-message error">{{ message }}</p><p v-else role="alert" class="sr-only"></p>
   <button class="primary-button auth-submit" :disabled="busy">{{ busy ? t('p.3f06ed8f8c38') : t('p.1e2df9c3075a') }}<AppIcon name="arrow" :size="18" /></button>
  </form>
  <GitHubButton v-if="!hubMode"/>
  <p v-if="!hubMode" class="auth-register">{{t('p.23e526538b99')}}<RouterLink to="/register">{{t('p.679e917b16ef')}}</RouterLink></p>
  <div class="auth-divider"><span>{{t('p.5b7bbecff860')}}</span></div>
  <RouterLink to="/guest" class="guest-entry"><span class="guest-entry-icon"><AppIcon name="guest" :size="22" /></span><span><b>{{t('p.991156da0b0e')}}</b><small>{{t('p.69858466747e')}}</small></span><AppIcon name="arrow" :size="18" /></RouterLink>
  <p v-if="!hubMode" class="auth-footnote">{{t('p.7503c26d8c45')}}</p>
 </AuthShell>
</template>

<style scoped>
.migration-notice{padding:16px;margin:20px 0;background:var(--accent-soft);border:1px solid var(--border);border-radius:var(--radius-s);font-size:13px;line-height:1.7}.migration-notice b{color:var(--accent)}.migration-notice p{margin:8px 0;color:var(--muted)}.migration-notice button{max-width:100%;white-space:normal;overflow-wrap:anywhere;text-align:left}
</style>
