<script setup>
import {t} from '../i18n.js';

import AdminBanner from "../components/AdminBanner.vue";
import AdminVerificationEmails from "../components/AdminVerificationEmails.vue";
import AdminAnalytics from "../components/AdminAnalytics.vue";
import ThemeToggle from "../components/ThemeToggle.vue";
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { useRouter } from "vue-router";
import { api, account, refreshAccountRole } from "../account";
import { modelName, deviceKey } from "../deviceProtocol";
const message = ref(""),
  users = ref([]),
  devices = ref([]),
  newUser = ref(""),
  newPass = ref(""),
  owner = ref(""),
  mac = ref(""),
  model = ref("tc1"),
  version = ref("v2"),
  level = ref(1),
  savedRegisterLevel = ref(1),
  contact = ref("");
const request = (path, method = "GET", body) =>
  api("/admin" + path, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
async function refresh() {
  const [u, d, c] = await Promise.all([
    request("/users"),
    request("/devices"),
    request("/config"),
  ]);
  users.value = u;
  devices.value = d;
  level.value = c.register_level;
  savedRegisterLevel.value = c.register_level;
  contact.value = c.contact_info;
}
async function run(fn) {
  try {
    await fn();
    message.value = "";
    await refresh();
  } catch (e) {
    message.value = e.message;
  }
}
const router = useRouter();
let roleTimer;
onMounted(() => { run(async () => {}); roleTimer = setInterval(() => refreshAccountRole().catch(() => {}), 3000); });
onBeforeUnmount(() => clearInterval(roleTimer));
watch(() => account.isAdmin, allowed => { if (!allowed) router.replace("/"); });
function setRole(u) {
 const role = u.role === "admin" ? "user" : "admin";
 if (confirm(t(role === "admin" ? 'admin.grantConfirm' : 'admin.revokeConfirm', {username:u.username})))
  run(() => request("/user/" + encodeURIComponent(u.username) + "/role", "PUT", { role }));
}
function addUser() {
  return run(async () => {
    await request("/users", "POST", {
      username: newUser.value,
      password: newPass.value,
    });
    newUser.value = "";
    newPass.value = "";
  });
}
function reset(u) {
  const p = prompt(t('p.3c290672e11f'));
  if (p)
    run(() =>
      request("/user/" + encodeURIComponent(u), "PUT", { password: p }),
    );
}
function removeUser(u) {
  if (confirm(t('admin.removeUserConfirm', {username:u})))
    run(() => request("/user/" + encodeURIComponent(u), "DELETE"));
}
function removeDevice(d) {
  if (confirm(t('admin.removeDeviceConfirm', {mac:d.mac})))
    run(() => request("/device/" + (d.namespace ? "scoped/" : "") + d.mac + (d.namespace ? "?username=" + encodeURIComponent(d.username) + "&mqtt_username=" + encodeURIComponent(d.mqtt_username || d.username) : ""), "DELETE"));
}
function bind() {
  return run(async () => {
    await request("/devices", "POST", {
      username: owner.value,
      mac: mac.value,
      model: model.value,
      version: model.value === "tc1" ? version.value : "v2",
    });
    mac.value = "";
  });
}
</script>
<template>
  <main class="console-page">
    <header class="topbar console-topbar"><div class="brand"><span class="kind">{{t('p.c3fdeb90d7eb')}}</span><h1>{{t('p.89c84e4a0f2b')}}</h1></div><nav class="console-nav"><ThemeToggle/><RouterLink class="btn" to="/">{{t('p.e0e6dc51f626')}}</RouterLink></nav></header>
    <p class="error" role="alert">{{ message }}</p>
    <template v-if="account.isAdmin">
      <p class="helper-text">{{t('p.0f2ffdeb0496')}}{{ account.username }} {{t('p.16e86040b992')}}</p>
      <AdminAnalytics/>
      <AdminBanner/>
      <button @click="run(async () => {})">{{t('p.193b4ce1d76c')}}</button>
      <section class="card">
        <h2>{{t('p.311bb313fdec')}}</h2>
        <form @submit.prevent="addUser">
          <label>{{t('p.1a3f0617d6de')}}<input v-model="newUser" minlength="3" maxlength="32" pattern="[A-Za-z0-9_.\-]{3,32}" :placeholder="t('p.c8ea90209208')" required /></label
          ><label
            >{{t('p.df387080f986')}}<input
              v-model="newPass"
              type="password"
              minlength="6"
              required /></label
          ><button>{{t('p.f48d12cf530a')}}</button>
        </form>
        <ul class="admin-list">
          <li v-for="u in users" :key="u.username">
            <div class="admin-item-copy"><b>{{ u.username }}</b><p class="help">{{ u.status === 'active' ? t('p.dfb802238b38') : u.status }} · {{ u.role === "admin" ? t('p.e19796712f1c') : t('p.f6a2faaac200') }}</p></div><div class="admin-actions">
            <button @click="setRole(u)">{{ u.role === "admin" ? t('p.dca50b99ea7d') : t('p.ab8dd9cf52bd') }}</button>
            <button @click="reset(u.username)">{{t('p.d70928debc2e')}}</button>
            <button class="btn danger" @click="removeUser(u.username)">{{t('p.2f9daa828907')}}</button></div>
          </li>
        </ul>
      </section>
      <section class="card">
        <h2>{{t('p.956897464b95')}}</h2>
        <form @submit.prevent="bind">
          <label
            >{{t('p.311bb313fdec')}}<select v-model="owner" required>
              <option
                v-for="u in users.filter((u) => u.status === 'active')"
                :key="u.username"
              >
                {{ u.username }}
              </option>
            </select></label
          ><label>MAC<input v-model="mac" required /></label
          ><label
            >{{t('p.322408c53bed')}}<select v-model="model" :aria-label="t('p.322408c53bed')">
              <option value="tc1">TC1</option>
              <option value="m1">M1</option>
              <option value="a1">A1</option><option value="daikin">DAIKIN BRY88AX151K</option>
            </select></label
          ><label v-if="model === 'tc1'">{{t('p.ab2f31f30acf')}}<select v-model="version">
            <option value="v1">Legacy</option>
            <option value="v2">TMCP</option></select></label
          ><button>{{t('p.3dd97f4d2766')}}</button>
        </form>
        <ul class="admin-list">
          <li v-for="d in devices" :key="deviceKey(d)">
            <div class="admin-item-copy"><b>{{ modelName(d.model) }} · {{ d.mac }}</b><p class="help">{{ d.username }} · {{ d.version === 'v1' ? 'Legacy' : 'TMCP' }} · {{ d.status === 'active' ? t('p.dfb802238b38') : d.status }} · {{ d.namespace ? t('p.7acaf1da03d4') : t('p.970b826edb13') }}</p></div>
            <button class="btn danger" @click="removeDevice(d)">{{t('p.3ba0a291df80')}}</button>
          </li>
        </ul>
      </section>
      <section class="card">
        <h2>{{t('p.b416252d2209')}}</h2>
        <form
          @submit.prevent="
            run(() =>
              request('/config', 'PUT', {
                register_level: level,
                contact_info: contact,
              }),
            )
          "
        >
          <label>{{t('p.ac5ec1acb8e3')}}<select v-model="level">
            <option :value="0">{{t('p.198a9a535718')}}</option>
            <option :value="1">{{t('p.04f83ab519b2')}}</option>
            <option :value="2">{{t('p.72e5f9137420')}}</option></select></label
          ><label>{{t('p.2c1223c6e95a')}}<input v-model="contact" /></label
          ><button>{{t('p.a3030bf8f16d')}}</button>
        </form>
      </section>
      <AdminVerificationEmails :enabled="savedRegisterLevel === 2"/></template
    >
  </main>
</template>
