<script setup>
import {t} from '../i18n.js';

import { ref, onMounted } from "vue";
import AuthShell from "../components/AuthShell.vue";
import { api } from "../account";
const username = ref(""),
  email = ref(""),
  password = ref(""),
  code = ref(""),
  message = ref(""),
  busy = ref(false),
  level = ref(0),
  contact = ref("");
onMounted(async () => {
  try {
    const s = await api("/register/status");
    level.value = s.register_level;
    contact.value = s.contact_info;
  } catch (e) {
    message.value = e.message;
  }
});
async function verify() {
  try {
    await api("/register/verify", {
      method: "POST",
      body: JSON.stringify({ email: email.value }),
    });
    message.value = t('p.2c1288e1d9f3');
  } catch (e) {
    message.value = e.message;
  }
}
async function register() {
  busy.value = true;
  try {
    await api("/register", {
      method: "POST",
      body: JSON.stringify({
        username: username.value,
        email: email.value,
        password: password.value,
        code: code.value,
      }),
    });
    message.value = t('p.0bf253bee02b');
    password.value = "";
  } catch (e) {
    message.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <AuthShell>
    <span class="eyebrow">{{t('p.66af5915cc75')}}</span>
    <h1>{{t('p.679e917b16ef')}}</h1>
    <p>{{t('p.06bdce5081f8')}}</p>
    <form class="auth-form" v-if="level" @submit.prevent="register">
      <label
        >{{t('p.1a3f0617d6de')}}<input
          v-model="username"
          type="text"
          minlength="3"
          maxlength="32"
          pattern="[A-Za-z0-9_.\-]{3,32}"
          :placeholder="t('p.c8ea90209208')"
          autocomplete="username"
          required /></label
      ><label
        >{{t('p.a621ab606db2')}}<input
          v-model="password"
          type="password"
          minlength="6"
          maxlength="256"
          autocomplete="new-password"
          required /></label
      ><template v-if="level === 2"
        ><label>{{t('p.7f98620a54e6')}}<input v-model="email" type="email" maxlength="254" autocomplete="email" required /></label><button type="button" @click="verify">{{t('p.4656fed515ae')}}</button
        ><label>{{t('p.bb015c60bafc')}}<input v-model="code" required /></label></template
      ><button class="primary-button auth-submit" :disabled="busy">{{t('p.c4fb62202bad')}}</button>
    </form>
    <p v-else>{{t('p.3885d9589040')}} {{ contact }}</p>
    <p role="alert" class="form-message">{{ message }}</p>
    <RouterLink to="/login">{{t('p.1e2df9c3075a')}}</RouterLink> ·
    <RouterLink to="/guest">{{t('p.b1c58c605cc1')}}</RouterLink>
  </AuthShell>
</template>
